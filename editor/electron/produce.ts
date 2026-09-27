import * as path from "path";
import * as fs from "fs";
import { spawnSync } from "child_process";
import { FFMPEG_PATH } from "./bin-paths";
import {
  ffmpegSync,
  probeDuration,
  probeResolution,
  extractFrame,
  cutClip,
  cutClipMuted,
  normalizeSegmentAudio,
  concatSegments,
  hasAudioStream,
  segmentDuration,
  probeFrameRate,
  ffTime,
  INTERMEDIATE_VIDEO,
  FILTER_THREADS,
} from "./ffmpeg";
import { generateTTS } from "./tts";
import {
  type Action,
  type NarrationResult,
  cutSpeedClip,
  mixBackgroundMusic,
} from "./effects";

// ─── Helpers ─────────────────────────────────────────────────

const LANG_CODES: Record<string, string> = {
  en: "a", "en-gb": "b", hi: "h", es: "e", fr: "f", ja: "j", zh: "z", pt: "p", it: "i",
};

function findNarration(action: Action): { text: string; lang: string; audioPath?: string } | null {
  if (action.customAudioPath && fs.existsSync(action.customAudioPath)) {
    return { text: "", lang: "custom", audioPath: action.customAudioPath };
  }
  if (action.audioPath) {
    for (const [lang, ap] of Object.entries(action.audioPath)) {
      if (ap && fs.existsSync(ap)) {
        const text = action.narrations?.[lang] || (lang === "en" ? action.narration : undefined) || (lang === "hi" ? action.narration_hi : undefined) || "";
        return { text, lang, audioPath: ap };
      }
    }
  }
  if (action.narrations) {
    for (const [lang, text] of Object.entries(action.narrations)) {
      if (text?.trim()) return { text, lang };
    }
  }
  if (action.narration?.trim()) return { text: action.narration, lang: "en" };
  if (action.narration_hi?.trim()) return { text: action.narration_hi, lang: "hi" };
  return null;
}

function prepareNarrationAudio(
  action: Action,
  audioOutputPath: string,
  project: Record<string, unknown>,
  emit: (msg: string) => void,
  ts: number,
): { hasAudio: boolean; audioDuration: number } {
  const narr = findNarration(action);
  if (!narr) return { hasAudio: false, audioDuration: 0 };

  if (narr.audioPath) {
    emit(`  Using pre-generated ${narr.lang} audio for action at ${ts.toFixed(1)}s`);
    fs.copyFileSync(narr.audioPath, audioOutputPath);
  } else {
    emit(`  Generating ${narr.lang} TTS for action at ${ts.toFixed(1)}s`);
    const tts = project.tts as { voiceEn?: string; voiceHi?: string; speed?: number; kokoroEndpoint?: string; voices?: Record<string, string[]> } | undefined;
    const voice = tts?.voices?.[narr.lang]?.[0] || (narr.lang === "hi" ? tts?.voiceHi || "hf_alpha" : tts?.voiceEn || "af_heart");
    const speed = tts?.speed || 1;
    const langCode = LANG_CODES[narr.lang] || "a";
    generateTTS(narr.text, voice, speed, langCode, audioOutputPath, tts?.kokoroEndpoint);
  }

  if (fs.existsSync(audioOutputPath) && fs.statSync(audioOutputPath).size > 100) {
    const dur = probeDuration(audioOutputPath);
    return { hasAudio: true, audioDuration: dur > 0 ? dur : 0 };
  }
  return { hasAudio: false, audioDuration: 0 };
}

function computeVersionLabel(videoDir: string): string {
  const existing = fs.readdirSync(videoDir).filter((f) => f.match(/^final_v\d+\.mp4$/));
  const maxV = existing.reduce((max, f) => {
    const m = f.match(/^final_v(\d+)\.mp4$/);
    return m ? Math.max(max, parseInt(m[1])) : max;
  }, 0);
  return `v${maxV + 1}`;
}

// ═════════════════════════════════════════════════════════════
// Overlay Passes (blur, spotlight, callout)
// These apply timed filters on the full video — no duration change
// ═════════════════════════════════════════════════════════════

function getOverlayTimeRange(action: Action): { start: number; end: number } {
  const start = action.timestamp;
  switch (action.type) {
    case "blur": return { start, end: start + (action.blurDuration ?? 3) };
    case "spotlight": return { start, end: start + (action.spotlightDuration ?? 3) };
    case "callout": return { start, end: start + (action.calloutDuration ?? 3) };
    default: return { start, end: start };
  }
}

/** Group overlay actions into batches where no two in the same batch overlap in time. */
function batchNonOverlapping(actions: Action[]): Action[][] {
  if (actions.length === 0) return [];
  const sorted = [...actions].sort((a, b) => a.timestamp - b.timestamp);
  const batches: Action[][] = [];

  for (const action of sorted) {
    const range = getOverlayTimeRange(action);
    let placed = false;
    for (const batch of batches) {
      const lastRange = getOverlayTimeRange(batch[batch.length - 1]);
      if (range.start >= lastRange.end) {
        batch.push(action);
        placed = true;
        break;
      }
    }
    if (!placed) {
      batches.push([action]);
    }
  }
  return batches;
}

/**
 * How one blur region is cut out, blurred and put back (yuv420p, video px).
 *
 *  - The pasted patch is the rect grown to even edges: crop and overlay round x/y
 *    (and crop w/h) DOWN to even on subsampled video, which used to leave the
 *    rect's last row or column unblurred.
 *  - The blur works on that patch plus up to `radius` px of surroundings
 *    (`crop`), then cuts the patch back out (`inner`), so a short element (a
 *    20 px e-mail line) still gets the full radius instead of a clamped one.
 *  - boxblur reads one pixel past the plane when 2·r + 1 > its length (it only
 *    rejects 2·r > length): a radius of exactly half an even side painted the
 *    region solid magenta. Each plane's radius is clamped to (side − 1) / 2 of
 *    what it really gets: luma = the even crop, chroma = half of it.
 * Exported for tests.
 */
export function blurGeometry(
  rect: [number, number, number, number],
  radius: number,
  res: { width: number; height: number },
): { crop: [number, number, number, number]; inner: [number, number, number, number]; at: [number, number]; lumaR: number; chromaR: number; power: number } | null {
  const W = res.width - (res.width % 2);
  const H = res.height - (res.height % 2);
  const down = (v: number) => Math.floor(v / 2) * 2;
  const up = (v: number) => Math.ceil(v / 2) * 2;
  const [bx, by, bw, bh] = rect.map((v) => Math.round(v));
  const x0 = Math.max(0, down(bx));
  const y0 = Math.max(0, down(by));
  const x1 = Math.min(W, up(bx + bw));
  const y1 = Math.min(H, up(by + bh));
  if (x1 - x0 < 2 || y1 - y0 < 2) return null;
  const r = Math.max(0, Math.round(radius));
  const pad = up(r);
  const cx0 = Math.max(0, x0 - pad);
  const cy0 = Math.max(0, y0 - pad);
  const cx1 = Math.min(W, x1 + pad);
  const cy1 = Math.min(H, y1 + pad);
  const cw = cx1 - cx0;
  const ch = cy1 - cy0;
  const maxR = (side: number) => Math.max(0, Math.floor((side - 1) / 2));
  return {
    crop: [cw, ch, cx0, cy0],
    inner: [x1 - x0, y1 - y0, x0 - cx0, y0 - cy0],
    at: [x0, y0],
    lumaR: Math.min(r, maxR(Math.min(cw, ch))),
    chromaR: Math.min(r, maxR(Math.min(cw, ch) / 2)),
    power: Math.max(2, Math.min(r, 20)),
  };
}

function applyBlurBatch(
  inputPath: string,
  actions: Action[],
  outputPath: string,
  res: { width: number; height: number },
  totalDuration: number,
  emit: (msg: string) => void,
): void {
  let filterChain = "";
  let lastLabel = "0:v";
  let idx = 0;

  for (const action of actions) {
    const rects = action.blurRects ?? [];
    if (rects.length === 0) continue;

    const radius = action.blurRadius ?? 20;
    const start = action.timestamp;
    const end = start + (action.blurDuration ?? 3);
    const enableExpr = `between(t,${start.toFixed(3)},${Math.min(end, totalDuration).toFixed(3)})`;

    emit(`    Blur at ${start.toFixed(1)}s-${end.toFixed(1)}s (${rects.length} region${rects.length > 1 ? "s" : ""})`);

    for (const rect of rects) {
      const g = blurGeometry(rect, radius, res);
      if (!g) continue;
      const sep = filterChain ? ";" : "";
      filterChain += `${sep}[${lastLabel}]split[base${idx}][src${idx}]`;
      filterChain +=
        `;[src${idx}]crop=${g.crop.join(":")},` +
        `boxblur=luma_radius=${g.lumaR}:luma_power=${g.power}:chroma_radius=${g.chromaR}:chroma_power=${g.power},` +
        `crop=${g.inner.join(":")}[blur${idx}]`;
      filterChain += `;[base${idx}][blur${idx}]overlay=${g.at[0]}:${g.at[1]}:enable='${enableExpr}'[out${idx}]`;
      lastLabel = `out${idx}`;
      idx++;
    }
  }

  if (!filterChain) { fs.copyFileSync(inputPath, outputPath); return; }

  const args = ["-y", "-i", inputPath, "-filter_complex_threads", FILTER_THREADS, "-filter_complex", filterChain];
  args.push("-map", `[${lastLabel}]`);
  if (hasAudioStream(inputPath)) {
    args.push("-map", "0:a", "-c:a", "copy");
  }
  args.push(...INTERMEDIATE_VIDEO);
  args.push(outputPath);
  ffmpegSync(args);
}

/**
 * Spotlight filters for the final graph, from [inLabel] to the returned label.
 *
 * Spotlights never overlap in time, and every filter that touches pixels is
 * switched on only inside its spotlight's window (`enable=`), so the frames
 * with no spotlight pass straight through. (Before, each spotlight blurred and
 * blended the WHOLE video: 17 soft spotlights in a 7-minute video meant 17
 * full-frame blurs per frame — 40 minutes of a 44-minute render.)
 *
 * Hard spotlights: darken, then paste the element's own pixels back (crop).
 * Soft (feather) and animated (converge) spotlights share one mask chain:
 * white boxes on black, snapped to exact 0/255, blurred by the feather, used as
 * the lit copy's alpha over the darkened frame. A converging box is re-aimed
 * every 1/60 s by sendcmd (commands in `cmdFile`, relative to ffmpeg's cwd).
 */
function spotlightGraph(
  actions: Action[],
  res: { width: number; height: number },
  totalDuration: number,
  emit: (msg: string) => void,
  inLabel: string,
  cmdFile: string,
): { graph: string[]; out: string; commands: string[] } {
  const graph: string[] = [];
  const commands: { at: number; line: string }[] = [];
  let last = inLabel;
  const soft: { win: string; alpha: string; feather: number; boxes: string[] }[] = [];

  actions.forEach((action, ai) => {
    const rects = action.spotlightRects ?? (action.spotlightRect ? [action.spotlightRect] : []);
    if (rects.length === 0) return;
    const alpha = (action.dimOpacity ?? 0.7).toFixed(2);
    const start = action.timestamp;
    const end = start + (action.spotlightDuration ?? 3);
    const win = `between(t,${start.toFixed(3)},${Math.min(end, totalDuration).toFixed(3)})`;
    emit(`    Spotlight at ${start.toFixed(1)}s-${end.toFixed(1)}s (${rects.length} region${rects.length > 1 ? "s" : ""})`);

    // Soft edge (spotlightFeather px): the mask box is grown by the feather so the
    // element itself stays fully lit and the falloff happens outside it.
    // Converge (spotlightConverge s): the box starts as the whole frame and closes
    // in on the element, easing out.
    const feather = Math.max(0, Math.round(action.spotlightFeather ?? 0));
    const converge = Math.min(Math.max(0, action.spotlightConverge ?? 0), (end - start) / 2);
    if (feather > 0 || converge > 0) {
      const target = (r: number[]) => [r[0] - feather, r[1] - feather, r[2] + 2 * feather, r[3] + 2 * feather];
      const full = [-feather, -feather, res.width + 2 * feather, res.height + 2 * feather];
      const box = (b: number[]) => `x=${Math.round(b[0])}:y=${Math.round(b[1])}:w=${Math.round(b[2])}:h=${Math.round(b[3])}`;
      const boxes = rects.map((r, ri) => `drawbox@sp${ai}_${ri}=${box(converge > 0 ? full : target(r))}:color=white:t=fill:enable='${win}'`);
      if (converge > 0) {
        const steps = Math.max(1, Math.round(converge * 60));
        for (let k = 1; k <= steps; k++) {
          const e = 1 - Math.pow(1 - k / steps, 3);
          const at = start + (converge * k) / steps;
          const sets = rects.flatMap((r, ri) => {
            const tg = target(r);
            const b = full.map((f, i) => f + (tg[i] - f) * e);
            return ["x", "y", "w", "h"].map((key, i) => `drawbox@sp${ai}_${ri} ${key} ${Math.round(b[i])}`);
          });
          commands.push({ at, line: `${at.toFixed(3)} ${sets.join(", ")};` });
        }
      }
      soft.push({ win, alpha, feather, boxes });
      return;
    }

    // Hard-edged: darken, then paste the element's own pixels back.
    const labels = [`pass${ai}`, `dark${ai}`, ...rects.map((_, ri) => `crop${ai}_${ri}`)];
    graph.push(`[${last}]split=${labels.length}${labels.map((l) => `[${l}]`).join("")}`);
    graph.push(`[dark${ai}]drawbox=x=0:y=0:w=iw:h=ih:color=black@${alpha}:t=fill:enable='${win}'[dimmed${ai}]`);
    let comp = `dimmed${ai}`;
    rects.forEach(([sx, sy, sw, sh], ri) => {
      graph.push(`[crop${ai}_${ri}]crop=${sw}:${sh}:${sx}:${sy}[bright${ai}_${ri}]`);
      const o = ri < rects.length - 1 ? `comp${ai}_${ri}` : `spotlight${ai}`;
      graph.push(`[${comp}][bright${ai}_${ri}]overlay=${sx}:${sy}:enable='${win}'[${o}]`);
      comp = o;
    });
    graph.push(`[pass${ai}][spotlight${ai}]overlay=0:0:enable='${win}'[spout${ai}]`);
    last = `spout${ai}`;
  });

  if (soft.length) {
    const any = soft.map((x) => x.win).join("+");
    graph.push(`[${last}]split=3[sfpass][sflit][sfmk]`);
    // Darken (each spotlight its own dimOpacity, only in its window).
    graph.push(`[sfpass]${soft.map((x) => `drawbox=x=0:y=0:w=iw:h=ih:color=black@${x.alpha}:t=fill:enable='${x.win}'`).join(",")}[sfdim]`);
    // The mask. drawbox writes limited-range levels (black 16, white 235): snap to
    // exact 0/255 before blurring, or the "dark" part would let the lit copy bleed through.
    const blurs = soft.filter((x) => x.feather > 0).map((x) => `gblur=sigma=${(x.feather / 2).toFixed(1)}:enable='${x.win}'`);
    const mask = [
      "format=gray",
      `drawbox=x=0:y=0:w=iw:h=ih:color=black:t=fill:enable='${any}'`,
      ...(commands.length ? [`sendcmd=f=${cmdFile}`] : []),
      ...soft.flatMap((x) => x.boxes),
      `lut=y='if(gt(val,128),255,0)':enable='${any}'`,
      ...blurs,
    ];
    graph.push(`[sfmk]${mask.join(",")}[sfmask]`);
    graph.push(`[sflit]format=yuva420p[sflita]`);
    graph.push(`[sflita][sfmask]alphamerge=enable='${any}'[sfsoft]`);
    graph.push(`[sfdim][sfsoft]overlay=0:0:enable='${any}'[sfout]`);
    last = "sfout";
  }
  commands.sort((x, y) => x.at - y.at);
  return { graph, out: last, commands: commands.map((c) => c.line) };
}

// Callouts are drawn by libass (in the final ASS pass, see calloutEvents), not
// drawtext: libass falls back across fonts and shapes complex scripts, so
// Hindi, CJK and mixed-script text ("Settings / सेटिंग्स") render correctly.

/** ASS font size that matches drawtext's pixel size (ASS sizes the whole line
 *  box, drawtext the em) — keeps the callouts the size they always were. */
const ASS_FONT_SCALE = 1.25;

/** Plain text → ASS dialogue text. `{…}` would start an override block and a
 *  backslash an escape (\N, \h, …): braces are escaped, and a backslash gets
 *  an invisible word joiner so it is drawn as-is. Newlines become \N. */
function assEscape(text: string): string {
  return text
    .replace(/\\/g, "\\⁠")
    .replace(/\{/g, "\\{")
    .replace(/\}/g, "\\}")
    .replace(/\r?\n/g, "\\N");
}

/** &HAABBGGRR for a colour at an opacity (ASS alpha 00 = opaque). */
function assColor(rgb: number, opacity: number): string {
  const hex = (n: number) => n.toString(16).toUpperCase().padStart(2, "0");
  const a = Math.round((1 - opacity) * 255);
  return `&H${hex(a)}${hex(rgb & 0xff)}${hex((rgb >> 8) & 0xff)}${hex((rgb >> 16) & 0xff)}`;
}

/**
 * Box padding (x, y) of callouts positioned at an element (calloutPanels): a
 * compact box — the text's line is already 1.25 × its size — so a label above
 * an element covers as little as possible of what sits above it. The compiler
 * (api/compiler.ts PANEL_PAD) places labels with the same numbers.
 */
export const PANEL_PAD = { label: { x: 10, y: 6 }, step: { x: 12, y: 7 } } as const;

/** Callout styles: white text on a box (BorderStyle 4 = one box per event,
 *  BackColour, Outline = padding), same colours/paddings as the old drawtext:
 *  label black@0.8/10, step-counter blue@0.9/12, lower-third black@0.7/15,
 *  panels black@0.7/10. */
const CALLOUT_STYLES = [
  { name: "CLabel", size: 28, box: assColor(0x000000, 0.8), pad: 10, align: 7 },
  { name: "CStep", size: 28, box: assColor(0x2563eb, 0.9), pad: 12, align: 7 },
  { name: "CLower", size: 36, box: assColor(0x000000, 0.7), pad: 15, align: 8 },
  { name: "CPanel", size: 24, box: assColor(0x000000, 0.7), pad: 10, align: 7 },
].map(
  (s) =>
    `Style: ${s.name},Noto Sans,${Math.round(s.size * ASS_FONT_SCALE)},&H00FFFFFF,&H00FFFFFF,&HFF000000,${s.box},` +
    `0,0,0,0,100,100,0,0,4,${s.pad},0,${s.align},0,0,0,1`,
).concat(
  // Arrow shapes (vector drawings): fill set per event; white halo + soft shadow for contrast on any background.
  `Style: CArrow,Noto Sans,20,&H001673F9,&H00FFFFFF,&H00FFFFFF,&H80000000,0,0,0,0,100,100,0,0,1,2,0,7,0,0,0,1`,
);

// ─── arrow callouts ──────────────────────────────────────────────────
//
// calloutStyle "arrow": an arrow pointing at calloutPanels[0].rect (the target),
// drawn in as a dashed line — each dash appears in turn, then the head — plus
// the panel's text (if any) as a label at the arrow's tail.

export type ArrowFrom = "left" | "right" | "above" | "below" | "top-left" | "top-right" | "bottom-left" | "bottom-right";
const ARROW_DIRS: Record<ArrowFrom, [number, number]> = {
  left: [-1, 0], right: [1, 0], above: [0, -1], below: [0, 1],
  "top-left": [-1, -1], "top-right": [1, -1], "bottom-left": [-1, 1], "bottom-right": [1, 1],
};
/** Tried in order when `arrowFrom` is not set: the first whose tail fits in the frame wins. */
const ARROW_AUTO: ArrowFrom[] = ["bottom-left", "bottom-right", "top-left", "top-right", "left", "right", "below", "above"];
export const ARROW_DEFAULT_COLOR = "#F97316";

/** Where the arrow's tail and tip go for a target box (video pixels). */
export function arrowGeometry(
  rect: [number, number, number, number],
  res: { width: number; height: number },
  from?: ArrowFrom,
  scaleOverride?: number,
): { tail: [number, number]; tip: [number, number]; scale: number; from: ArrowFrom } {
  const scale = scaleOverride ?? Math.max(0.6, Math.min(res.height, res.width * 0.625) / 900);
  const len = 150 * scale;
  const gap = 10 * scale;
  const margin = 16 * scale;
  const [x, y, w, h] = rect;
  // Wide targets (a full-width list row, a banner): an arrow at the edge would read
  // as pointing at the neighbour, so the tip lands INSIDE, on the right-hand part
  // (usually empty in rows), coming from the lower right.
  if (w > res.width * 0.6 && h < res.height * 0.6) {
    const d = Math.SQRT1_2;
    const tip: [number, number] = [x + w * 0.66, y + h * 0.55];
    const pick = (f: ArrowFrom): [number, number] => {
      const [dx, dy] = ARROW_DIRS[f];
      return [tip[0] + dx * d * len, tip[1] + dy * d * len];
    };
    const inFrame = (p: [number, number]) => p[0] >= margin && p[0] <= res.width - margin && p[1] >= margin && p[1] <= res.height - margin;
    const order: ArrowFrom[] = from ? [from] : ["bottom-right", "top-right", "bottom-left", "top-left"];
    const f = order.find((o) => inFrame(pick(o))) ?? order[0];
    const tail = pick(f);
    return { tip, tail: [Math.max(margin, Math.min(res.width - margin, tail[0])), Math.max(margin, Math.min(res.height - margin, tail[1]))], scale, from: f };
  }
  const cx = x + w / 2;
  const cy = y + h / 2;
  const place = (f: ArrowFrom) => {
    const [dx0, dy0] = ARROW_DIRS[f];
    const n = Math.hypot(dx0, dy0);
    const dx = dx0 / n;
    const dy = dy0 / n;
    // distance from the centre to the box edge along d
    const t = Math.min(dx ? w / 2 / Math.abs(dx) : Infinity, dy ? h / 2 / Math.abs(dy) : Infinity);
    const tip: [number, number] = [cx + dx * (t + gap), cy + dy * (t + gap)];
    const tail: [number, number] = [cx + dx * (t + gap + len), cy + dy * (t + gap + len)];
    const inside = (p: [number, number]) => p[0] >= margin && p[0] <= res.width - margin && p[1] >= margin && p[1] <= res.height - margin;
    return { tip, tail, fits: inside(tip) && inside(tail), d: [dx, dy] as const };
  };
  for (const f of from ? [from] : ARROW_AUTO) {
    const g = place(f);
    if (g.fits || from) {
      const clamp = (p: [number, number]): [number, number] => [
        Math.max(margin, Math.min(res.width - margin, p[0])),
        Math.max(margin, Math.min(res.height - margin, p[1])),
      ];
      return { tail: clamp(g.tail), tip: clamp(g.tip), scale, from: f };
    }
  }
  // Nothing fits (the element fills the frame): point at its centre from the lower left, inside it.
  const tip: [number, number] = [cx, cy];
  const d = Math.SQRT1_2;
  return { tip, tail: [cx - d * len, cy + d * len].map((v, i) => Math.max(margin, Math.min((i ? res.height : res.width) - margin, v))) as [number, number], scale, from: "bottom-left" };
}

function assBgr(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex) ?? /^#?([0-9a-f]{6})$/i.exec(ARROW_DEFAULT_COLOR)!;
  const v = m[1].toUpperCase();
  return `&H${v.slice(4, 6)}${v.slice(2, 4)}${v.slice(0, 2)}&`;
}

type Pt = [number, number];

/** The arrow as shapes (video px): the curve it follows and, for any drawn length
 *  along it, the stroke so far and the chevron at its end. Exported for tests. */
export function arrowShape(g: { tail: Pt; tip: Pt; scale: number }, frameCenter?: Pt): {
  point(t: number): Pt;
  length: number;
  at(s: number): Pt;
  stroke(s: number): Pt[];
  head(s: number): { arms: [Pt, Pt]; tip: Pt };
  thickness: number;
} {
  const [tx, ty] = g.tail;
  const [px, py] = g.tip;
  const len = Math.hypot(px - tx, py - ty);
  const ux = (px - tx) / len;
  const uy = (py - ty) / len;
  // A gentle bow: the control point sits off the straight line by 16% of the length.
  // Its side follows the direction: a diagonal bows toward the corner (tip x, tail y),
  // so it leaves the tail sideways and arrives at the target vertically — bottom-left →
  // top-right is a ")", bottom-right → top-left a "(", and the top ones mirror them.
  // Straight across/up/down arrows bow toward the frame's centre, away from the edge.
  const bow = 0.16 * len;
  const mx = (tx + px) / 2;
  const my = (ty + py) / 2;
  const nx = uy;
  const ny = -ux;
  let side = (px - mx) * nx + (ty - my) * ny;
  if (Math.abs(side) < 0.2 * len) side = frameCenter ? (frameCenter[0] - mx) * nx + (frameCenter[1] - my) * ny : 1;
  const sgn = side < 0 ? -1 : 1;
  const c: Pt = [mx + nx * bow * sgn, my + ny * bow * sgn];
  const point = (t: number): Pt => {
    const a = (1 - t) * (1 - t);
    const b = 2 * (1 - t) * t;
    const d = t * t;
    return [a * tx + b * c[0] + d * px, a * ty + b * c[1] + d * py];
  };
  // Arc length → t (the bow makes t uneven along the curve).
  const N = 96;
  const cum = [0];
  let prev = point(0);
  for (let i = 1; i <= N; i++) {
    const p = point(i / N);
    cum.push(cum[i - 1] + Math.hypot(p[0] - prev[0], p[1] - prev[1]));
    prev = p;
  }
  const total = cum[N];
  const tAt = (s: number) => {
    const target = Math.max(0, Math.min(total, s));
    let i = 1;
    while (i < N && cum[i] < target) i++;
    const f = (target - cum[i - 1]) / Math.max(1e-6, cum[i] - cum[i - 1]);
    return (i - 1 + f) / N;
  };
  const at = (s: number) => point(tAt(s));
  const thickness = 6 * g.scale;
  const fullHead = Math.min(24 * g.scale, total * 0.35);
  const stroke = (s: number): Pt[] => Array.from({ length: 25 }, (_, i) => at((Math.max(1, s) * i) / 24));
  // Open chevron at the stroke's end, along the curve's direction there; it grows in with the line.
  const head = (s: number) => {
    const end = at(s);
    const back = at(s - 2);
    const dx = end[0] - back[0];
    const dy = end[1] - back[1];
    const dl = Math.hypot(dx, dy) || 1;
    const hx = dx / dl;
    const hy = dy / dl;
    const hl = fullHead * Math.min(1, s / (total * 0.35));
    const arm = (sign: number): Pt => {
      const a = (sign * 34 * Math.PI) / 180;
      const rx = hx * Math.cos(a) - hy * Math.sin(a);
      const ry = hx * Math.sin(a) + hy * Math.cos(a);
      return [end[0] - rx * hl, end[1] - ry * hl];
    };
    return { arms: [arm(1), arm(-1)] as [Pt, Pt], tip: end };
  };
  return { point, length: total, at, stroke, head, thickness };
}

/** A thick stroke along `pts` with round caps, as one polygon. */
function capsule(pts: Pt[], th: number): Pt[] {
  const r = th / 2;
  const n = pts.length;
  // left normal at each point (the stroke's direction turned 90°)
  const norm = (i: number): Pt => {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(n - 1, i + 1)];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [-(b[1] - a[1]) / l, (b[0] - a[0]) / l];
  };
  const left: Pt[] = pts.map((p, i) => [p[0] + norm(i)[0] * r, p[1] + norm(i)[1] * r]);
  const right: Pt[] = pts.map((p, i): Pt => [p[0] - norm(i)[0] * r, p[1] - norm(i)[1] * r]).reverse();
  // Half circle from `fromAngle`, sweeping 180° through the stroke's outward end.
  const cap = (c: Pt, fromAngle: number): Pt[] =>
    Array.from({ length: 7 }, (_, k) => {
      const a = fromAngle - (Math.PI * (k + 1)) / 8;
      return [c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r] as Pt;
    });
  const nEnd = norm(n - 1);
  const nStart = norm(0);
  return [...left, ...cap(pts[n - 1], Math.atan2(nEnd[1], nEnd[0])), ...right, ...cap(pts[0], Math.atan2(-nStart[1], -nStart[0]))];
}

/** Where the label pill goes: just beyond the tail, on the side away from the arrow, inside the frame. Exported for tests. */
export function arrowLabelBox(
  g: { tail: Pt; scale: number },
  shape: { point(t: number): Pt },
  text: string,
  fontSize: number,
  res: { width: number; height: number },
): { cx: number; cy: number; pw: number; ph: number; fs: number } {
  const [tx, ty] = g.tail;
  const vx = tx - shape.point(0.08)[0];
  const vy = ty - shape.point(0.08)[1];
  const vl = Math.hypot(vx, vy) || 1;
  const dx = vx / vl;
  const dy = vy / vl;
  const fs = fontSize * ASS_FONT_SCALE;
  const graphemes = [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text)].length;
  const ph = fs * 1.25;
  const pw = graphemes * fs * 0.55 + ph * 0.9;
  const gap = 14 * g.scale;
  let cx = tx + dx * gap + (dx < -0.3 ? -pw / 2 : dx > 0.3 ? pw / 2 : 0);
  let cy = ty + dy * gap + (dy < -0.3 ? -ph / 2 : dy > 0.3 ? ph / 2 : 0);
  const edge = 10;
  cx = Math.max(edge + pw / 2, Math.min(res.width - edge - pw / 2, cx));
  cy = Math.max(edge + ph / 2, Math.min(res.height - edge - ph / 2, cy));
  return { cx, cy, pw, ph, fs };
}

/** A rounded rectangle as one polygon. */
function roundedRect(x: number, y: number, w: number, h: number, r: number): Pt[] {
  const out: Pt[] = [];
  const corner = (cx: number, cy: number, a0: number) => {
    for (let k = 0; k <= 6; k++) {
      const a = a0 + (Math.PI / 2) * (k / 6);
      out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
  };
  corner(x + w - r, y + r, -Math.PI / 2);
  corner(x + w - r, y + h - r, 0);
  corner(x + r, y + h - r, Math.PI / 2);
  corner(x + r, y + r, Math.PI);
  return out;
}

/** One ASS drawing event for a polygon (absolute video coords). */
function assPolygon(layer: number, start: number, end: number, pts: Pt[], tags: string, dx = 0, dy = 0, fade = "\\fad(90,200)"): string {
  const minX = Math.min(...pts.map((p) => p[0]));
  const minY = Math.min(...pts.map((p) => p[1]));
  const rel = pts.map(([px, py]) => `${Math.round(px - minX)} ${Math.round(py - minY)}`);
  // \an7 + \pos at the bounding box's corner: libass aligns a drawing by its bbox.
  return (
    `Dialogue: ${layer},${secToAssTs(start)},${secToAssTs(end)},CArrow,,0,0,0,,` +
    `{\\an7\\pos(${Math.round(minX + dx)},${Math.round(minY + dy)})${tags}${fade}\\p1}m ${rel[0]} l ${rel.slice(1).join(" ")}{\\p0}`
  );
}

/**
 * A hand-drawn loop around a box (video px), like a pencil circle: it hugs the
 * element's shape (a circle for square things, flatter and boxier for wide rows),
 * spirals out a little and overshoots its start, with a slight wobble and tilt.
 * Kept inside the frame. Exported for tests.
 */
export function pencilLoop(rect: [number, number, number, number], res: { width: number; height: number }, scale: number): Pt[] {
  const [x, y, w, h] = rect;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const pad = 6 * scale;
  const grow = 7 * scale; // how far the overshoot spirals out
  const wob = 2.5 * scale;
  const margin = 6 * scale + grow + wob;
  // Superellipse |x/rx|^n + |y/ry|^n = 1: n = 2 is an ellipse, higher is boxier.
  const aspect = Math.max(w, h) / Math.max(1, Math.min(w, h));
  const n = 2 + Math.min(4, (aspect - 1) * 0.6);
  const k = Math.pow(2, 1 / n); // equal stretch that puts the box's corners on the curve
  const maxRx = Math.max(12 * scale, Math.min(cx - margin, res.width - cx - margin));
  const maxRy = Math.max(10 * scale, Math.min(cy - margin, res.height - cy - margin));
  let rx = Math.min((w / 2) * k + pad, maxRx);
  let ry = Math.min((h / 2) * k + pad, maxRy);
  // Squeezed by the frame on one axis: open the other to clear the corners, but only a
  // little (a full-width row's loop may clip the row's far ends; it must not cover the next row).
  const fit = (half: number, r: number) => Math.pow(Math.min(0.95, half / r), n);
  if (rx < (w / 2) * k + pad) ry = Math.min(maxRy, h / 2 + 1.5 * pad, (h / 2 + pad) / Math.pow(1 - fit(w / 2, rx), 1 / n));
  else if (ry < (h / 2) * k + pad) rx = Math.min(maxRx, w / 2 + 1.5 * pad, (w / 2 + pad) / Math.pow(1 - fit(h / 2, ry), 1 / n));
  // Tilt a few degrees, but never enough to lift a wide loop into the next row.
  const tilt = -Math.min((3 * Math.PI) / 180, Math.atan((0.12 * ry) / rx));
  const a0 = (-160 * Math.PI) / 180; // starts upper left, goes clockwise
  const sweep = 2 * Math.PI + 0.45; // a little past a full turn
  const e = 2 / n;
  const N = 120;
  return Array.from({ length: N + 1 }, (_, i): Pt => {
    const u = i / N;
    const a = a0 + sweep * u;
    const c = Math.cos(a);
    const sn = Math.sin(a);
    const off = grow * u + wob * Math.sin(3 * a + 1);
    // On a flat (or tall) loop the spiral and wobble shrink across the thin side, so it stays snug.
    const ex = Math.sign(c) * Math.pow(Math.abs(c), e) * rx + c * off * Math.max(0.3, Math.min(1, rx / ry));
    const ey = Math.sign(sn) * Math.pow(Math.abs(sn), e) * ry + sn * off * Math.max(0.3, Math.min(1, ry / rx));
    return [cx + ex * Math.cos(tilt) - ey * Math.sin(tilt), cy + ex * Math.sin(tilt) + ey * Math.cos(tilt)];
  });
}

/** The part of a polyline between arc lengths s0 and s1. */
function polySlice(pts: Pt[], cum: number[], s0: number, s1: number): Pt[] {
  const at = (s: number): Pt => {
    let i = 1;
    while (i < cum.length - 1 && cum[i] < s) i++;
    const f = (s - cum[i - 1]) / Math.max(1e-6, cum[i] - cum[i - 1]);
    return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * f, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * f];
  };
  const out: Pt[] = [at(s0)];
  for (let i = 1; i < pts.length - 1; i++) if (cum[i] > s0 && cum[i] < s1) out.push(pts[i]);
  out.push(at(s1));
  return out;
}

/**
 * ASS events for the arrow's `highlight`: once the arrow has landed, a pencil loop is
 * drawn around the element, held for a moment, then wiped away from its start like a
 * laser-pointer trail. Squeezed to fit the time left; skipped when there is too little.
 */
function highlightEvents(rect: [number, number, number, number], res: { width: number; height: number }, scale: number, color: string, from: number, end: number): string[] {
  const avail = end - from - 0.05;
  if (avail < 0.6) return [];
  const drawSec = Math.min(0.55, avail * 0.3);
  const eraseSec = Math.min(0.45, avail * 0.25);
  const holdSec = Math.max(0, Math.min(0.9, avail - drawSec - eraseSec));
  const pts = pencilLoop(rect, res, scale);
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const total = cum[cum.length - 1];
  const th = 4 * scale;
  const halo = `\\1c&HFFFFFF&\\3c&HFFFFFF&\\bord${(1.6 * scale).toFixed(1)}\\shad0`;
  const fill = `\\1c${color}\\bord0\\shad0`;
  const out: string[] = [];
  // The loop crosses itself where it overshoots: drawn as short pieces (each a simple
  // polygon) so no fill rule can punch a hole where the stroke overlaps.
  const frame = (t0: number, t1: number, s0: number, s1: number) => {
    if (s1 - s0 < 1) return;
    const pieces = Math.max(1, Math.ceil((s1 - s0) / (total / 4)));
    const step = (s1 - s0) / pieces;
    const polys = Array.from({ length: pieces }, (_, k) => capsule(polySlice(pts, cum, s0 + k * step, s0 + (k + 1) * step), th));
    for (const poly of polys) out.push(assPolygon(2, t0, t1, poly, halo, 0, 0, ""));
    for (const poly of polys) out.push(assPolygon(3, t0, t1, poly, fill, 0, 0, ""));
  };
  const easeInOut = (u: number) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);
  const easeIn = (u: number) => u * u;
  const nDraw = Math.max(1, Math.round(drawSec * ARROW_DRAW_FPS));
  const nErase = Math.max(1, Math.round(eraseSec * ARROW_DRAW_FPS));
  const drawAt = (k: number) => from + (drawSec * k) / nDraw;
  for (let k = 0; k < nDraw; k++) frame(drawAt(k), drawAt(k + 1), 0, total * easeInOut((k + 1) / nDraw));
  const eraseFrom = from + drawSec + holdSec;
  frame(drawAt(nDraw), eraseFrom, 0, total);
  const eraseAt = (k: number) => eraseFrom + (eraseSec * k) / nErase;
  for (let k = 0; k < nErase - 1; k++) frame(eraseAt(k), eraseAt(k + 1), total * easeIn((k + 1) / nErase), total);
  return out;
}

/** Frames per second of the arrow's draw-in (one ASS event per frame). */
const ARROW_DRAW_FPS = 30;

/**
 * ASS events for one arrow callout: one smooth curved line that draws itself
 * from the tail to the target (easing out), the chevron head riding its tip,
 * then the label in a rounded pill. White halo + soft shadow keep it readable
 * on light and dark pages.
 */
function arrowEvents(action: Action, res: { width: number; height: number }, start: number, end: number): string[] {
  const panel = action.calloutPanels?.[0];
  if (!panel) return [];
  const g = arrowGeometry(panel.rect, res, action.arrowFrom as ArrowFrom | undefined, action.arrowScale);
  if (Math.hypot(g.tip[0] - g.tail[0], g.tip[1] - g.tail[1]) < 4) return [];
  const hex = action.arrowColor ?? ARROW_DEFAULT_COLOR;
  const color = assBgr(hex);
  const shape = arrowShape(g, [res.width / 2, res.height / 2]);
  const th = shape.thickness;
  const fill = `\\1c${color}\\bord0\\shad0`;
  const halo = `\\1c&HFFFFFF&\\3c&HFFFFFF&\\bord${(2.2 * g.scale).toFixed(1)}\\shad0`;
  const shadow = `\\1c&H000000&\\1a&HB0&\\3a&HFF&\\bord0\\shad0\\blur${(4 * g.scale).toFixed(1)}`;
  const sdy = 3 * g.scale;
  const out: string[] = [];
  // One frame of the arrow: every piece's shadow, then every halo, then every fill,
  // so the halo never cuts across the line where the head joins it.
  const frame = (from: number, to: number, s: number, fade: string) => {
    const h = shape.head(s);
    const pieces = [capsule(shape.stroke(s), th), capsule([h.arms[0], h.tip], th), capsule([h.arms[1], h.tip], th)];
    for (const poly of pieces) out.push(assPolygon(1, from, to, poly, shadow, 0, sdy, fade));
    for (const poly of pieces) out.push(assPolygon(2, from, to, poly, halo, 0, 0, fade));
    for (const poly of pieces) out.push(assPolygon(3, from, to, poly, fill, 0, 0, fade));
  };
  // The draw-in takes ≤ 0.5 s, and never more than a third of the arrow's time on screen.
  const drawSec = Math.min(0.5, (end - start) / 3);
  const steps = Math.max(1, Math.round(drawSec * ARROW_DRAW_FPS));
  const easeOut = (u: number) => 1 - Math.pow(1 - u, 3);
  const at = (k: number) => start + (drawSec * k) / steps;
  for (let k = 0; k < steps - 1; k++) frame(at(k), at(k + 1), shape.length * easeOut((k + 1) / steps), "");
  const drawnAt = at(steps - 1);
  frame(drawnAt, end, shape.length, "\\fad(0,200)");
  if (action.arrowHighlight) out.push(...highlightEvents(panel.rect, res, g.scale, action.arrowHighlightColor ? assBgr(action.arrowHighlightColor) : color, start + drawSec + 0.1, end));

  if (panel.text) {
    const { cx, cy, pw, ph, fs } = arrowLabelBox(g, shape, panel.text, panel.fontSize || 24, res);
    const pill = roundedRect(cx - pw / 2, cy - ph / 2, pw, ph, ph / 2);
    const rise = Math.round(8 * g.scale);
    const fade = "\\fad(140,200)";
    out.push(assPolygon(4, drawnAt, end, pill, shadow, 0, sdy, fade));
    out.push(assPolygon(5, drawnAt, end, pill, `\\1c${color}\\3c&HFFFFFF&\\bord${(1.6 * g.scale).toFixed(1)}\\shad0`, 0, 0, fade));
    out.push(
      `Dialogue: 6,${secToAssTs(drawnAt)},${secToAssTs(end)},CLabel,,0,0,0,,` +
        `{\\an5\\move(${Math.round(cx)},${Math.round(cy + rise)},${Math.round(cx)},${Math.round(cy)},0,180)\\bord0\\shad0\\3a&HFF&\\4a&HFF&\\b1\\1c&HFFFFFF&` +
        `\\fs${Math.round(fs)}${fade}}${assEscape(panel.text)}`,
    );
  }
  return out;
}

/** ASS dialogue lines for every callout, on the final timeline. Positions are
 *  the drawtext ones: top-left of the text at calloutPosition (default
 *  100,100) or at each panel's rect; lower-third centred with its top at h−80. */
function calloutEvents(actions: Action[], res: { width: number; height: number }, totalDuration: number, emit: (msg: string) => void): string[] {
  const out: string[] = [];
  for (const action of actions) {
    const start = action.timestamp;
    const end = Math.min(start + (action.calloutDuration ?? 3), totalDuration);
    if (!(end > start)) continue;
    const style = action.calloutStyle || "label";
    if (style === "arrow") {
      const lines = arrowEvents(action, res, start, end);
      if (lines.length) emit(`    Arrow at ${start.toFixed(1)}s-${end.toFixed(1)}s${action.calloutPanels?.[0]?.text ? `: "${action.calloutPanels[0].text.slice(0, 30)}"` : ""}`);
      out.push(...lines);
      continue;
    }
    const step = action.calloutStep;
    const prefix = (t: string) => (style === "step-counter" && step ? `Step ${step}: ${t}` : t);
    const line = (st: string, x: number, y: number, text: string, fs?: number, pad?: { x: number; y: number }) =>
      out.push(
        `Dialogue: 0,${secToAssTs(start)},${secToAssTs(end)},${st},,0,0,0,,` +
          `{\\q2\\pos(${Math.round(x)},${Math.round(y)})${fs ? `\\fs${Math.round(fs * ASS_FONT_SCALE)}` : ""}${pad ? `\\xbord${pad.x}\\ybord${pad.y}` : ""}}${assEscape(text)}`,
      );

    const panels = action.calloutPanels;
    if (panels && panels.length > 0) {
      emit(`    Callout at ${start.toFixed(1)}s-${end.toFixed(1)}s (${panels.length} panel${panels.length > 1 ? "s" : ""})`);
      for (const panel of panels) {
        // a step-counter keeps its blue box when it is positioned as a panel
        if (panel.text) {
          const step = style === "step-counter";
          line(step ? "CStep" : "CPanel", panel.rect[0], panel.rect[1], prefix(panel.text), panel.fontSize || 24, step ? PANEL_PAD.step : PANEL_PAD.label);
        }
      }
      continue;
    }
    const text = action.calloutText;
    if (!text) continue;
    emit(`    Callout at ${start.toFixed(1)}s-${end.toFixed(1)}s: "${text.slice(0, 30)}..."`);
    const position = action.calloutPosition as [number, number] | undefined;
    if (style === "lower-third") line("CLower", res.width / 2, res.height - 80, text);
    else line(style === "step-counter" ? "CStep" : "CLabel", position ? position[0] : 100, position ? position[1] : 100, prefix(text));
  }
  return out;
}

// ═════════════════════════════════════════════════════════════
// Pass: Skip/Cut — removes sections from the video
// ═════════════════════════════════════════════════════════════

function getSkipRanges(actions: Action[]): Array<{ start: number; end: number }> {
  return actions
    .filter((a) => a.type === "skip" && a.skipEndTimestamp)
    .map((a) => ({ start: a.timestamp, end: a.skipEndTimestamp! }))
    .sort((a, b) => a.start - b.start);
}

function applySkipPass(
  inputPath: string,
  skipRanges: Array<{ start: number; end: number }>,
  outputPath: string,
  tempDir: string,
  emit: (msg: string) => void,
): void {
  const totalDuration = probeDuration(inputPath);
  emit(`\n[Pass: Skip] Removing ${skipRanges.length} section(s)...`);

  const segments: string[] = [];
  let cursor = 0;
  let segIdx = 0;

  for (const range of skipRanges) {
    if (cursor < range.start - 0.05) {
      emit(`  Keep ${cursor.toFixed(1)}s-${range.start.toFixed(1)}s`);
      const clipPath = path.join(tempDir, `keep_${String(segIdx).padStart(3, "0")}.mp4`);
      cutClip(inputPath, cursor, range.start, clipPath);
      if (fs.existsSync(clipPath) && fs.statSync(clipPath).size > 0) {
        segments.push(clipPath);
        segIdx++;
      }
    }
    emit(`  Skip ${range.start.toFixed(1)}s-${range.end.toFixed(1)}s`);
    cursor = range.end;
  }

  if (cursor < totalDuration - 0.05) {
    const clipPath = path.join(tempDir, `keep_${String(segIdx).padStart(3, "0")}.mp4`);
    cutClip(inputPath, cursor, totalDuration, clipPath);
    if (fs.existsSync(clipPath) && fs.statSync(clipPath).size > 0) {
      segments.push(clipPath);
    }
  }

  if (segments.length === 0) {
    fs.copyFileSync(inputPath, outputPath);
    return;
  }

  emit(`  Normalizing ${segments.length} segments...`);
  const normalized = segments.map((seg) => normalizeSegmentAudio(seg, seg.replace(".mp4", "_norm.mp4")));
  const concatList = path.join(tempDir, "skip_concat.txt");
  concatSegments(normalized, outputPath, concatList);
}

// ═════════════════════════════════════════════════════════════
// Pass: Speed — applies speed ramps to sections
// ═════════════════════════════════════════════════════════════

function getSpeedRanges(actions: Action[]): Array<{ start: number; end: number; factor: number }> {
  return actions
    .filter((a) => a.type === "speed" && a.speedEndTimestamp && a.speedFactor)
    .map((a) => ({ start: a.timestamp, end: a.speedEndTimestamp!, factor: a.speedFactor! }))
    .sort((a, b) => a.start - b.start);
}

function applySpeedPass(
  inputPath: string,
  speedRanges: Array<{ start: number; end: number; factor: number }>,
  outputPath: string,
  tempDir: string,
  emit: (msg: string) => void,
): void {
  const totalDuration = probeDuration(inputPath);
  emit(`\n[Pass: Speed] Applying ${speedRanges.length} speed ramp(s)...`);

  const segments: string[] = [];
  let cursor = 0;
  let segIdx = 0;

  for (const range of speedRanges) {
    if (cursor < range.start - 0.05) {
      const clipPath = path.join(tempDir, `spd_${String(segIdx).padStart(3, "0")}.mp4`);
      cutClip(inputPath, cursor, range.start, clipPath);
      if (fs.existsSync(clipPath) && fs.statSync(clipPath).size > 0) {
        segments.push(clipPath);
        segIdx++;
      }
    }

    emit(`  Speed ${range.factor}x: ${range.start.toFixed(1)}s-${range.end.toFixed(1)}s`);
    const clipPath = path.join(tempDir, `spd_${String(segIdx).padStart(3, "0")}.mp4`);
    cutSpeedClip(inputPath, range.start, range.end, range.factor, clipPath);
    if (fs.existsSync(clipPath) && fs.statSync(clipPath).size > 0) {
      segments.push(clipPath);
      segIdx++;
    }

    cursor = range.end;
  }

  if (cursor < totalDuration - 0.05) {
    const clipPath = path.join(tempDir, `spd_${String(segIdx).padStart(3, "0")}.mp4`);
    cutClip(inputPath, cursor, totalDuration, clipPath);
    if (fs.existsSync(clipPath) && fs.statSync(clipPath).size > 0) {
      segments.push(clipPath);
    }
  }

  if (segments.length === 0) {
    fs.copyFileSync(inputPath, outputPath);
    return;
  }

  emit(`  Normalizing ${segments.length} segments...`);
  const normalized = segments.map((seg) => normalizeSegmentAudio(seg, seg.replace(".mp4", "_norm.mp4")));
  const concatList = path.join(tempDir, "speed_concat.txt");
  concatSegments(normalized, outputPath, concatList);
}

// ═════════════════════════════════════════════════════════════
// Timestamp Remapping
// Maps original timestamps → post-skip/speed coordinates
// ═════════════════════════════════════════════════════════════

function buildSkipRemap(
  skipRanges: Array<{ start: number; end: number }>,
): (ts: number) => number {
  return (ts: number): number => {
    let offset = 0;
    for (const range of skipRanges) {
      if (range.end <= ts) {
        offset += range.end - range.start;
      } else if (range.start < ts) {
        // Inside a skip range — clamp to the start of the skip
        return range.start - offset;
      }
    }
    return ts - offset;
  };
}

function buildSpeedRemap(
  speedRanges: Array<{ start: number; end: number; factor: number }>,
): (ts: number) => number {
  return (ts: number): number => {
    let outputTime = 0;
    let cursor = 0;

    for (const range of speedRanges) {
      if (ts <= range.start) {
        return outputTime + (ts - cursor);
      }
      outputTime += range.start - cursor;
      cursor = range.start;

      if (ts <= range.end) {
        return outputTime + (ts - range.start) / range.factor;
      }
      outputTime += (range.end - range.start) / range.factor;
      cursor = range.end;
    }

    return outputTime + (ts - cursor);
  };
}

function remapRanges<T extends { start: number; end: number }>(
  ranges: T[],
  remap: (ts: number) => number,
): T[] {
  return ranges
    .map((r) => ({ ...r, start: remap(r.start), end: remap(r.end) }))
    .filter((r) => r.end > r.start + 0.05);
}

// ═════════════════════════════════════════════════════════════
// Pass: Mute (audio filter)
// ═════════════════════════════════════════════════════════════

function applyMutePass(
  inputPath: string,
  muteRanges: Array<{ start: number; end: number }>,
  outputPath: string,
  emit: (msg: string) => void,
): void {
  emit(`\n[Pass: Mute] Applying ${muteRanges.length} mute range(s)...`);

  const filters: string[] = [];
  for (const range of muteRanges) {
    emit(`  Mute ${range.start.toFixed(1)}s-${range.end.toFixed(1)}s`);
    filters.push(`volume=enable='between(t,${range.start.toFixed(3)},${range.end.toFixed(3)})':volume=0`);
  }

  if (filters.length === 0 || !hasAudioStream(inputPath)) {
    fs.copyFileSync(inputPath, outputPath);
    return;
  }

  ffmpegSync([
    "-y", "-i", inputPath,
    "-af", filters.join(","),
    "-c:v", "copy",
    "-c:a", "aac", "-ar", "44100", "-ac", "2", "-b:a", "192k",
    outputPath,
  ]);
}

// ═════════════════════════════════════════════════════════════
// Subtitle Utilities
// ═════════════════════════════════════════════════════════════

function secToAssTs(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const cs = Math.round((sec - Math.floor(sec)) * 100);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

/** One narration's subtitles, placed on the final timeline. */
interface SubtitleCue {
  text: string;
  start: number;
  duration: number;
  size: number;
  /** Distance of the subtitle baseline from the bottom (default 50 px). */
  marginV?: number;
}

const SUBTITLE_MARGIN_V = 50;

/** Karaoke dialogue lines for one narration, starting at `offset` seconds. */
function subtitleDialogues(text: string, duration: number, offset: number, style: string): string[] {
  const sentences = text.match(/[^.!?\n]+[.!?\n]*/g) || [text];
  const entries: string[] = [];
  for (const sentence of sentences) {
    const trimmed = sentence.trim();
    if (!trimmed) continue;
    if (trimmed.length <= 60) {
      entries.push(trimmed);
    } else {
      const clauses = trimmed.split(/(?<=[,;])\s+/);
      let current = "";
      for (const clause of clauses) {
        if (current.length + clause.length > 60 && current.length > 0) {
          entries.push(current.trim());
          current = "";
        }
        current += (current ? " " : "") + clause;
      }
      if (current.trim()) entries.push(current.trim());
    }
  }

  const totalChars = entries.reduce((sum, e) => sum + e.length, 0);
  let currentTime = offset;
  const dialogues: string[] = [];

  for (const entry of entries) {
    const entryDuration = totalChars > 0 ? duration * (entry.length / totalChars) : duration / entries.length;
    const startTs = secToAssTs(currentTime);
    const endTs = secToAssTs(currentTime + entryDuration);
    const words = entry.trim().split(/\s+/);
    const wordChars = words.reduce((sum, w) => sum + w.length, 0);
    const karokeParts = words.map((w) => {
      const wordDur = wordChars > 0 ? entryDuration * (w.length / wordChars) : entryDuration / words.length;
      const cs = Math.max(1, Math.round(wordDur * 100));
      return `{\\kf${cs}}${w} `;
    }).join("").trim();
    dialogues.push(`Dialogue: 0,${startTs},${endTs},${style},,0000,0000,0000,karaoke,${karokeParts}`);
    currentTime += entryDuration;
  }
  return dialogues;
}

/**
 * The subtitle look, in the recording's pixels (PlayRes = the video size, so it
 * scales with the output from 480p to 4K): white text (words fill from yellow as
 * they are spoken) on a soft 65 % black box with a little letter spacing.
 * (A 2 px black outline + shadow used to close the gaps between letters and
 * words, most at 480p.) BorderStyle 4 = one box per line in BackColour, padded
 * by Outline; the outline itself is fully transparent.
 */
function subtitleStyle(name: string, size: number, marginV: number): string {
  const pad = Math.round(size * 0.3);
  const spacing = (size * 0.02).toFixed(1);
  return `Style: ${name},Noto Sans,${size},&H00FFFFFF,&H0000FFFF,&HFF000000,&H59000000,0,0,0,0,100,100,${spacing},0,4,${pad},0,2,20,20,${marginV + pad},1`;
}

/** One ASS file for every narration of the video (one style per font size). */
function writeSubtitleFile(
  cues: SubtitleCue[],
  outputPath: string,
  res: { width: number; height: number },
  callouts: string[] = [],
): void {
  const styleOf = (c: SubtitleCue) => `S${c.size}_${c.marginV ?? SUBTITLE_MARGIN_V}`;
  const styles = [...new Map(cues.map((c) => [styleOf(c), c])).values()].map((c) => subtitleStyle(styleOf(c), c.size, c.marginV ?? SUBTITLE_MARGIN_V));
  // Subtitles on layer 1: drawn above any callout box they meet.
  const dialogues = cues.flatMap((c) => subtitleDialogues(c.text, c.duration, c.start, styleOf(c))).map((d) => d.replace(/^Dialogue: 0,/, "Dialogue: 1,"));
  if (callouts.length) styles.push(...CALLOUT_STYLES);
  const assContent = `[Script Info]
Title: Demo Subtitle
ScriptType: v4.00+
PlayResX: ${res.width}
PlayResY: ${res.height}

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
${styles.join("\n")}

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${[...callouts, ...dialogues].join("\n")}
`;
  fs.writeFileSync(outputPath, assContent, "utf-8");
}


// ═════════════════════════════════════════════════════════════
// Insert Effect Builders (zoom, pause, narrate)
// ═════════════════════════════════════════════════════════════

function buildSingleZoom(
  zoomRect: [number, number, number, number],
  framePath: string,
  tempDir: string,
  segIdx: number,
  zoomIdx: number,
  res: { width: number; height: number },
  zoomDuration: number,
  holdDuration: number,
  narration: NarrationResult | undefined,
  emit: (msg: string) => void,
  /** Subtitle size for this narration (null/undefined = no subtitles). */
  subtitleSize?: number | null,
  /** Where subtitle cues are collected, keyed by the segment they belong to. */
  cues?: Map<string, Omit<SubtitleCue, "start">>,
): string[] {
  const [zx, zy, zw, zh] = zoomRect;
  const { width: outW, height: outH } = res;
  const cx = Math.round(zx + zw / 2);
  const cy = Math.round(zy + zh / 2);
  const maxZ = Math.min(outW / zw, outH / zh);
  const inFrames = Math.max(Math.round(30 * zoomDuration), 2);
  const holdFrames = Math.max(Math.round(30 * holdDuration), 2);
  const N = inFrames - 1;

  const ssForward = `(on/${N})*(on/${N})*(3-2*on/${N})`;
  const ssReverse = `(1-(on/${N})*(on/${N})*(3-2*on/${N}))`;
  const xExpr = `${cx}-iw/zoom/2`;
  const yExpr = `${cy}-ih/zoom/2`;

  const tag = `${String(segIdx).padStart(3, "0")}_z${zoomIdx}`;
  const paths: string[] = [];

  // Zoom-in
  const zoomInPath = path.join(tempDir, `zoomin_${tag}.mp4`);
  const zpIn = [
    `zoompan=z='1+(${maxZ.toFixed(4)}-1)*${ssForward}'`,
    `x='${xExpr}'`, `y='${yExpr}'`,
    `d=${inFrames}`, `s=${outW}x${outH}`, `fps=30`,
  ].join(":");
  ffmpegSync(["-y", "-i", framePath, "-vf", zpIn, ...INTERMEDIATE_VIDEO, zoomInPath]);
  paths.push(zoomInPath);

  // Hold (with narration audio if provided)
  const holdPath = path.join(tempDir, `zoomhold_${tag}.mp4`);
  const zpHold = [`zoompan=z='${maxZ.toFixed(4)}'`, `x='${xExpr}'`, `y='${yExpr}'`, `d=${holdFrames}`, `s=${outW}x${outH}`, `fps=30`].join(":");
  const holdArgs = ["-y", "-i", framePath];
  if (narration) holdArgs.push("-i", narration.audioPath);
  holdArgs.push("-vf", zpHold, ...INTERMEDIATE_VIDEO);
  if (narration) holdArgs.push("-c:a", "aac", "-b:a", "192k", "-shortest");
  holdArgs.push(holdPath);
  ffmpegSync(holdArgs);
  paths.push(holdPath);

  // Subtitles belong on the hold — that is where the narration plays.
  if (narration?.text && subtitleSize && cues) {
    cues.set(holdPath, { text: narration.text, duration: narration.audioDuration, size: subtitleSize });
  }

  // Zoom-out
  const zoomOutPath = path.join(tempDir, `zoomout_${tag}.mp4`);
  const zpOut = [`zoompan=z='1+(${maxZ.toFixed(4)}-1)*${ssReverse}'`, `x='${xExpr}'`, `y='${yExpr}'`, `d=${inFrames}`, `s=${outW}x${outH}`, `fps=30`].join(":");
  ffmpegSync(["-y", "-i", framePath, "-vf", zpOut, ...INTERMEDIATE_VIDEO, zoomOutPath]);
  paths.push(zoomOutPath);

  return paths;
}

function findZoomTargetNarration(
  target: { narrations?: Record<string, string>; audioPath?: Record<string, string>; customAudioPath?: string },
): { text: string; lang: string; audioPath?: string } | null {
  if (target.customAudioPath && fs.existsSync(target.customAudioPath)) {
    return { text: "", lang: "custom", audioPath: target.customAudioPath };
  }
  if (target.audioPath) {
    for (const [lang, ap] of Object.entries(target.audioPath)) {
      if (ap && fs.existsSync(ap)) {
        const text = target.narrations?.[lang] || "";
        return { text, lang, audioPath: ap };
      }
    }
  }
  if (target.narrations) {
    for (const [lang, text] of Object.entries(target.narrations)) {
      if (text?.trim()) return { text, lang };
    }
  }
  return null;
}

function prepareZoomTargetAudio(
  target: { narrations?: Record<string, string>; audioPath?: Record<string, string>; customAudioPath?: string },
  audioOutputPath: string,
  project: Record<string, unknown>,
  emit: (msg: string) => void,
  label: string,
): NarrationResult | undefined {
  const narr = findZoomTargetNarration(target);
  if (!narr) return undefined;

  if (narr.audioPath) {
    emit(`    Using pre-generated ${narr.lang} audio for ${label}`);
    fs.copyFileSync(narr.audioPath, audioOutputPath);
  } else {
    emit(`    Generating ${narr.lang} TTS for ${label}`);
    const tts = project.tts as { voiceEn?: string; voiceHi?: string; speed?: number; kokoroEndpoint?: string; voices?: Record<string, string[]> } | undefined;
    const voice = tts?.voices?.[narr.lang]?.[0] || (narr.lang === "hi" ? tts?.voiceHi || "hf_alpha" : tts?.voiceEn || "af_heart");
    const speed = tts?.speed || 1;
    const langCode = LANG_CODES[narr.lang] || "a";
    generateTTS(narr.text, voice, speed, langCode, audioOutputPath, tts?.kokoroEndpoint);
  }

  if (fs.existsSync(audioOutputPath) && fs.statSync(audioOutputPath).size > 100) {
    const dur = probeDuration(audioOutputPath);
    if (dur > 0) return { audioPath: audioOutputPath, audioDuration: dur, text: narr.text, lang: narr.lang };
  }
  return undefined;
}

function buildZoomInsert(
  action: Action,
  videoPath: string,
  tempDir: string,
  segIdx: number,
  res: { width: number; height: number },
  narration: NarrationResult | undefined,
  project: Record<string, unknown>,
  emit: (msg: string) => void,
  frameTs: number,
  cues?: Map<string, Omit<SubtitleCue, "start">>,
): string[] {
  type ZoomTarget = { rect: [number, number, number, number]; narrations?: Record<string, string>; audioPath?: Record<string, string>; customAudioPath?: string };
  let targets: ZoomTarget[];
  if (action.zoomTargets?.length) {
    targets = action.zoomTargets as ZoomTarget[];
  } else if (action.zoomRects?.length) {
    targets = action.zoomRects.map((r) => ({ rect: r as [number, number, number, number] }));
  } else if (action.zoomRect) {
    targets = [{ rect: action.zoomRect }];
  } else {
    return [];
  }

  const zoomDuration = action.zoomDuration ?? 1;
  const holdDuration = action.zoomHold ?? 2;

  const framePath = path.join(tempDir, `frame_${String(segIdx).padStart(3, "0")}.png`);
  extractFrame(videoPath, frameTs, framePath);

  emit(`  Zoom at ${frameTs.toFixed(1)}s (${targets.length} target${targets.length > 1 ? "s" : ""})`);

  const allPaths: string[] = [];

  for (let i = 0; i < targets.length; i++) {
    const target = targets[i];

    let narrForThis: NarrationResult | undefined;
    const hasTargetNarration = findZoomTargetNarration(target) !== null;

    if (hasTargetNarration) {
      const audioPath = path.join(tempDir, `zoomnarr_${String(segIdx).padStart(3, "0")}_z${i}.wav`);
      narrForThis = prepareZoomTargetAudio(target, audioPath, project, emit, `zoom target ${i + 1}`);
    } else if (i === 0 && narration) {
      narrForThis = narration;
    }

    const thisHold = narrForThis ? narrForThis.audioDuration + 0.5 : holdDuration;

    emit(`    Target ${i + 1}: ${target.rect[2]}x${target.rect[3]} hold=${thisHold.toFixed(1)}s${narrForThis ? " (with narration)" : ""}`);

    const paths = buildSingleZoom(
      target.rect, framePath, tempDir, segIdx, i, res,
      zoomDuration, thisHold, narrForThis, emit,
      action.showSubtitles !== false ? action.subtitleSize ?? 28 : null,
      cues,
    );
    allPaths.push(...paths);
  }

  return allPaths;
}

function buildPauseInsert(
  action: Action,
  videoPath: string,
  tempDir: string,
  segIdx: number,
  res: { width: number; height: number },
  narration: NarrationResult | undefined,
  emit: (msg: string) => void,
  frameTs: number,
): string[] {
  const framePath = path.join(tempDir, `frame_${String(segIdx).padStart(3, "0")}.png`);
  extractFrame(videoPath, frameTs, framePath);

  let duration = 3;
  if (narration && narration.audioDuration > 0) duration = narration.audioDuration + 0.5;
  if (typeof action.resumeAfter === "number") duration = action.resumeAfter;

  emit(`  Pause at ${frameTs.toFixed(1)}s (${duration.toFixed(1)}s)`);

  const { width, height } = res;
  const vf = `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`;
  const freezePath = path.join(tempDir, `freeze_${String(segIdx).padStart(3, "0")}.mp4`);

  const args = ["-y", "-loop", "1", "-framerate", "30", "-i", framePath];
  if (narration) args.push("-i", narration.audioPath);
  args.push("-t", duration.toFixed(3), "-r", "30", "-vf", vf);
  args.push(...INTERMEDIATE_VIDEO);
  if (narration) args.push("-c:a", "aac", "-b:a", "192k", "-shortest");
  args.push(freezePath);
  ffmpegSync(args);

  return [freezePath];
}

function buildNarrateInsert(
  action: Action,
  videoPath: string,
  tempDir: string,
  segIdx: number,
  res: { width: number; height: number },
  totalDuration: number,
  narration: NarrationResult | undefined,
  emit: (msg: string) => void,
  frameTs: number,
): string[] {
  // If freeze requested, build a freeze frame
  if (action.freeze === true || action.type === "pause") {
    return buildPauseInsert(action, videoPath, tempDir, segIdx, res, narration, emit, frameTs);
  }

  // Otherwise the video keeps playing under the voice: `duration` (speech +
  // 0.5 s) of source, and the insert pass resumes exactly there, so no source
  // time is lost and everything after it stays where the trace put it. (It used
  // to mux with -shortest, which cut the clip to the speech: the 0.5 s tail of
  // source video vanished and every later callout ran 0.5 s late.) Only where
  // the video ends first is its last frame held for the rest of the speech.
  const duration = narrateInsertSeconds(action, narration);
  const avail = Math.max(0, Math.min(duration, totalDuration - frameTs));
  const hold = duration - avail;

  emit(`  Narrate at ${frameTs.toFixed(1)}s (${duration.toFixed(1)}s over the video${hold > 0.01 ? `, last frame held ${hold.toFixed(1)}s` : ""})`);

  const playPath = path.join(tempDir, `play_${String(segIdx).padStart(3, "0")}.mp4`);
  const clipHasAudio = hasAudioStream(videoPath);
  const args = ["-y", "-ss", ffTime(frameTs), "-t", avail.toFixed(4), "-i", videoPath];
  const graph = [`[0:v]tpad=stop_mode=clone:stop_duration=${(hold + 1).toFixed(3)}[v]`];
  let audio = false;
  if (narration) {
    args.push("-i", narration.audioPath);
    if (clipHasAudio) {
      emit(`    Mixing narration with original audio (ducking original to 20%)`);
      // normalize=0: amix otherwise halves both, so this narration came out ~6 dB
      // quieter than the frozen ones (a clip after a skip/speed pass always has a track).
      graph.push("[0:a]volume=0.2,apad[bg];[1:a]apad[narr];[bg][narr]amix=inputs=2:duration=longest:dropout_transition=0:normalize=0,alimiter=limit=0.95:level=0[aout]");
    } else {
      graph.push("[1:a]apad[aout]");
    }
    audio = true;
  } else if (clipHasAudio) {
    graph.push("[0:a]apad[aout]");
    audio = true;
  }
  // Every stream is padded past the end; -t cuts the clip at exactly `duration`.
  args.push("-filter_complex", graph.join(";"), "-map", "[v]");
  if (audio) args.push("-map", "[aout]", "-c:a", "aac", "-ar", "44100", "-ac", "2", "-b:a", "192k");
  args.push("-t", duration.toFixed(3), ...INTERMEDIATE_VIDEO, playPath);
  ffmpegSync(args);
  if (!fs.existsSync(playPath) || fs.statSync(playPath).size === 0) {
    emit(`  Warning: narration clip at ${frameTs.toFixed(1)}s produced no output, skipping`);
    return [];
  }
  return [playPath];
}

/** Seconds a narrate/pause insert lasts: resumeAfter, else the speech + 0.5 s, else 3 s. */
function narrateInsertSeconds(action: Action, narration: NarrationResult | undefined): number {
  if (typeof action.resumeAfter === "number") return action.resumeAfter;
  return narration && narration.audioDuration > 0 ? narration.audioDuration + 0.5 : 3;
}

// ═════════════════════════════════════════════════════════════
// Pass: Insert Effects (zoom, pause, narrate)
// Walks forward through the video, cutting clips and inserting effects
// ═════════════════════════════════════════════════════════════

function executeInsertPass(
  inputPath: string,
  insertActions: Action[],
  narrations: Map<Action, NarrationResult>,
  outputPath: string,
  tempDir: string,
  res: { width: number; height: number },
  project: Record<string, unknown>,
  emit: (msg: string) => void,
  remapTs: (ts: number) => number,
): {
  narrationTimestamps: Array<{ start: number; end: number }>;
  insertExpansions: Array<{ at: number; added: number }>;
  subtitleCues: SubtitleCue[];
} {
  const totalDuration = probeDuration(inputPath);
  // Subtitles are NOT burned into the segments: they go on in one pass after
  // spotlight/callout, so dimming never darkens them. Each cue is tied to its
  // segment; its start is known once the segments are normalized.
  const cueOf = new Map<string, Omit<SubtitleCue, "start">>();

  // Sort inserts by their remapped timestamp
  const sorted = insertActions
    .map((a) => ({ action: a, mappedTs: remapTs(a.timestamp) }))
    .filter((a) => a.mappedTs >= 0 && a.mappedTs < totalDuration)
    .sort((a, b) => a.mappedTs - b.mappedTs);

  emit(`\n[Pass: Inserts] Processing ${sorted.length} insert(s)...`);

  const segments: string[] = [];
  const narrationTimestamps: Array<{ start: number; end: number }> = [];
  // Records how much wall-clock time each insert ADDS at its (post-skip/speed)
  // input position. A freeze insert (pause/zoom/narrate-freeze) adds its full
  // effect duration AT mappedTs without consuming source; a narrate-without-
  // freeze consumes the section it plays over, so it adds (effectDur - consumed).
  // Overlay timestamps are remapped through these so spotlights/callouts land on
  // the SAME frame after inserts stretch the timeline (else they drift early).
  const insertExpansions: Array<{ at: number; added: number }> = [];
  let cursor = 0;
  let segIdx = 0;
  let runningDuration = 0;

  for (const { action, mappedTs: stamped } of sorted) {
    // An insert inside the stretch a talk-over narration already played starts
    // when that narration ends (else those frames would play twice); one a few
    // ms after the cursor starts right at it (else those frames would be lost).
    const mappedTs = stamped < cursor + 0.05 ? cursor : stamped;
    if (stamped < cursor - 0.05) emit(`  ${action.type} at ${stamped.toFixed(1)}s waits for the narration playing until ${cursor.toFixed(1)}s`);
    // Clip before this insert
    if (mappedTs > cursor) {
      const clipPath = path.join(tempDir, `ins_clip_${String(segIdx).padStart(3, "0")}.mp4`);
      cutClip(inputPath, cursor, mappedTs, clipPath);
      if (fs.existsSync(clipPath) && fs.statSync(clipPath).size > 0) {
        runningDuration += segmentDuration(clipPath);
        segments.push(clipPath);
        segIdx++;
      }
    }

    // Build the insert effect
    const narration = narrations.get(action);
    let insertPaths: string[];

    if (action.type === "zoom" && (action.zoomRect || action.zoomRects?.length || action.zoomTargets?.length)) {
      insertPaths = buildZoomInsert(action, inputPath, tempDir, segIdx, res, narration, project, emit, mappedTs, cueOf);
    } else if (action.type === "pause" || action.freeze === true) {
      insertPaths = buildPauseInsert(action, inputPath, tempDir, segIdx, res, narration, emit, mappedTs);
    } else {
      insertPaths = buildNarrateInsert(action, inputPath, tempDir, segIdx, res, totalDuration, narration, emit, mappedTs);
    }

    // Subtitles for the narration (zooms registered theirs on each hold)
    if (narration?.text && action.showSubtitles !== false && insertPaths.length > 0 && action.type !== "zoom") {
      cueOf.set(insertPaths[insertPaths.length - 1], { text: narration.text, duration: narration.audioDuration, size: action.subtitleSize ?? 28 });
    }

    const totalEffectDur = insertPaths.reduce((s, p) => s + segmentDuration(p), 0);

    // Track narration timestamps for music ducking
    if (narration) {
      narrationTimestamps.push({ start: runningDuration, end: runningDuration + totalEffectDur });
    }

    for (const p of insertPaths) {
      runningDuration += segmentDuration(p);
      segments.push(p);
      segIdx++;
    }

    // Advance cursor — freeze inserts resume from same point, narrate-without-freeze advances.
    // Record the net time ADDED at this input position for overlay remapping:
    //  - freeze: consumes 0 source, adds the full effect duration.
    //  - narrate-no-freeze: plays `consumed` s of source in `totalEffectDur`, so it
    //    adds their difference: 0, or the last frame held where the video ends.
    if (action.type === "zoom" || action.type === "pause" || action.freeze === true) {
      insertExpansions.push({ at: mappedTs, added: totalEffectDur });
      cursor = mappedTs;
    } else if (insertPaths.length) {
      // Narrate without freeze — video played during narration, so skip past that section
      const consumed = Math.max(0, Math.min(narrateInsertSeconds(action, narration), totalDuration - mappedTs));
      insertExpansions.push({ at: mappedTs, added: totalEffectDur - consumed });
      cursor = mappedTs + consumed;
    } else {
      cursor = mappedTs; // the clip failed (reported above): keep the source instead
    }
  }

  // Trailing clip after last insert
  if (cursor < totalDuration - 0.05) {
    const clipPath = path.join(tempDir, `ins_clip_${String(segIdx).padStart(3, "0")}.mp4`);
    cutClip(inputPath, cursor, totalDuration, clipPath);
    if (fs.existsSync(clipPath) && fs.statSync(clipPath).size > 0) {
      segments.push(clipPath);
    }
  }

  if (segments.length === 0) {
    fs.copyFileSync(inputPath, outputPath);
    return { narrationTimestamps, insertExpansions, subtitleCues: [] };
  }

  // Normalize & concat
  emit(`  Normalizing ${segments.length} segments...`);
  const normalized = segments.map((seg, i) => {
    if (i % 10 === 0) emit(`  Normalizing ${i + 1}/${segments.length}...`);
    return normalizeSegmentAudio(seg, seg.replace(".mp4", "_norm.mp4"));
  });

  emit("  Concatenating...");
  const concatList = path.join(tempDir, "insert_concat.txt");
  concatSegments(normalized, outputPath, concatList);

  // The concat demuxer starts each file where the previous one ended, so
  // the normalized durations give each segment's start on the final timeline.
  const subtitleCues: SubtitleCue[] = [];
  let at = 0;
  segments.forEach((seg, i) => {
    const cue = cueOf.get(seg);
    if (cue) subtitleCues.push({ ...cue, start: at });
    at += segmentDuration(normalized[i]);
  });

  return { narrationTimestamps, insertExpansions, subtitleCues };
}

// Build a remap from post-skip/speed time → final (post-insert) time. An insert
// at `at` shifts everything strictly after it forward by `added`. An overlay
// whose anchor is exactly the resumed frame of a freeze insert sits AFTER the
// freeze, so `> at` (not `>=`) is correct: the spotlight rect was captured on
// the frame the insert resumes to.
function buildInsertRemap(
  expansions: Array<{ at: number; added: number }>,
): (ts: number) => number {
  const sorted = [...expansions].sort((a, b) => a.at - b.at);
  return (ts: number): number => {
    let shift = 0;
    for (const e of sorted) {
      if (e.at < ts) shift += e.added;
    }
    return ts + shift;
  };
}

// ═════════════════════════════════════════════════════════════
// Main Orchestrator — N-Pass Pipeline
//
// Order of passes:
// 1. Trim (pre-cut source)
// 2. Skip — removes skipped sections
// 3. Speed — applies speed ramps (remapped timestamps)
// 4. Mute — silences audio ranges (remapped timestamps)
// 4b. Blur — before inserts, so freezes and zooms stay blurred
// 5. Insert pass — zoom/pause/narrate (remapped timestamps)
// 5b. Music — background music mixing (audio only)
// 6. Final — ONE encode: spotlights, callouts/arrows + subtitles, scaling,
//    title/end cards. Passes 1–5 write fast near-lossless intermediates.
// ═════════════════════════════════════════════════════════════

/** Extra settings for produceTimelineVideo (all optional; the desktop app passes none). */
export interface ProduceOptions {
  /** Project file to read (default <sessionDir>/demo-project.json). */
  projectFile?: string;
  /** Final frame size, letterboxed, applied in the final pass only (inserts stay at the recording size). */
  letterbox?: { width: number; height: number };
  /** Clips joined before/after the video in the final pass (title/end cards). */
  wrap?: { before?: string; after?: string };
  /** Seconds per pass (skip, speed, mute, blur, inserts, music, final). */
  onTimings?: (timings: Record<string, number>) => void;
}

export async function produceTimelineVideo(
  sessionDir: string,
  emit: (msg: string) => void,
  version?: string,
  selectedActionIds?: string[],
  resolution?: { width: number; height: number },
  crf?: number,
  trim?: { start: number; end: number },
  opts: ProduceOptions = {},
): Promise<string> {
  // ─── Setup ───
  const project = JSON.parse(fs.readFileSync(opts.projectFile ?? path.join(sessionDir, "demo-project.json"), "utf-8"));
  const recordingPath = project.recordingPath;
  let allActions: Action[] = project.actions || [];
  const videoDir = path.join(sessionDir, "video");
  // One temp folder per version, so two languages can render at the same time.
  const tempDir = path.join(videoDir, version ? `temp-${version}` : "temp");
  fs.mkdirSync(videoDir, { recursive: true });
  fs.mkdirSync(tempDir, { recursive: true });
  const totalDuration = probeDuration(recordingPath);
  const nativeRes = probeResolution(recordingPath);
  const res = resolution || nativeRes;
  emit(`Recording: ${nativeRes.width}x${nativeRes.height}, ${totalDuration.toFixed(1)}s`);
  if (resolution) emit(`Output resolution: ${resolution.width}x${resolution.height}`);
  if (crf) emit(`Output quality CRF: ${crf}`);

  // ─── Trim: pre-cut the source video if trim range is specified ───
  let effectiveRecording = recordingPath;
  let trimOffset = 0;
  if (trim) {
    emit(`\n[Trim] Cutting source video ${trim.start.toFixed(1)}s - ${trim.end.toFixed(1)}s...`);
    const trimmedPath = path.join(tempDir, "trimmed_source.mp4");
    cutClip(recordingPath, trim.start, trim.end, trimmedPath);
    if (fs.existsSync(trimmedPath) && fs.statSync(trimmedPath).size > 0) {
      effectiveRecording = trimmedPath;
      trimOffset = trim.start;
      emit(`  Trimmed source: ${probeDuration(trimmedPath).toFixed(1)}s`);
    } else {
      emit("  Warning: Trim failed, using full source");
    }
  }

  // ─── Filter by selection ───
  if (selectedActionIds && selectedActionIds.length > 0) {
    allActions = allActions.filter((a: Action & { id?: string }) => selectedActionIds.includes(a.id ?? ""));
    emit(`Selected ${allActions.length} action(s) for processing`);
  }

  // ─── Remap action timestamps if trimmed ───
  if (trimOffset > 0) {
    allActions = allActions.map((a) => {
      const remapped = { ...a, timestamp: a.timestamp - trimOffset };
      if (remapped.muteEndTimestamp != null) remapped.muteEndTimestamp -= trimOffset;
      if (remapped.speedEndTimestamp != null) remapped.speedEndTimestamp -= trimOffset;
      if (remapped.skipEndTimestamp != null) remapped.skipEndTimestamp -= trimOffset;
      if (remapped.musicEndTimestamp != null) remapped.musicEndTimestamp -= trimOffset;
      return remapped;
    });
  }

  // ─── Categorize actions by type ───
  const blurActions = allActions.filter((a) => a.type === "blur" && a.blurRects && a.blurRects.length > 0);
  const spotlightActions = allActions.filter((a) => a.type === "spotlight" && (a.spotlightRect || (a.spotlightRects && a.spotlightRects.length > 0)));
  const calloutActions = allActions.filter((a) => a.type === "callout" && (a.calloutText || (a.calloutPanels && a.calloutPanels.length > 0)));
  // (an arrow callout always has its target as calloutPanels[0])
  const zoomActions = allActions.filter((a) => a.type === "zoom" && (a.zoomRect || (a.zoomRects && a.zoomRects.length > 0) || (a.zoomTargets && a.zoomTargets.length > 0)));
  const pauseActions = allActions.filter((a) => a.type === "pause");
  const narrateActions = allActions.filter((a) => a.type === "narrate");
  const speedActions = allActions.filter((a) => a.type === "speed" && a.speedEndTimestamp && a.speedFactor);
  const skipActions = allActions.filter((a) => a.type === "skip" && a.skipEndTimestamp);
  const muteActions = allActions.filter((a) => a.type === "mute" && a.muteEndTimestamp);
  const musicAction = allActions.find((a) => a.type === "music" && a.musicPath);

  // Track intermediate files
  let currentInput = effectiveRecording;
  let passIdx = 0;

  const nextOutput = () => {
    passIdx++;
    return path.join(tempDir, `pass_${passIdx}.mp4`);
  };

  const effectiveTotalDuration = probeDuration(effectiveRecording);

  // How long each pass took (seconds), logged and reported through opts.onTimings.
  const timings: Record<string, number> = {};
  const timed = <T>(name: string, fn: () => T): T => {
    const t0 = Date.now();
    try {
      return fn();
    } finally {
      const sec = (Date.now() - t0) / 1000;
      timings[name] = Math.round(((timings[name] ?? 0) + sec) * 10) / 10;
      emit(`  (${name} took ${sec.toFixed(1)}s)`);
    }
  };

  // NOTE: Overlay effects (blur/spotlight/callout) are applied LAST (after
  // inserts), not here. Inserts (narrate freezes etc.) stretch the timeline, so
  // an overlay burned in on the original timeline would land BEFORE its content
  // (drift growing with each narration). We remap overlay timestamps through the
  // skip/speed/insert expansions so each spotlight lands on the exact same frame.

  // ═══════════════════════════════════════════════════════════
  // Pass 2: Skip/Cut — remove skipped sections
  // ═══════════════════════════════════════════════════════════

  // Cut on frame boundaries: a skip keeps the frames before its start and
  // resumes at the first frame after its end — exactly what the cut does — and
  // the remap uses the same boundaries. So anything placed at (or just after)
  // the end of a skip lands on the first frame after the cut; a freeze there
  // used to show the last frame before it.
  const fps = probeFrameRate(effectiveRecording);
  const onFrame = (t: number) => Math.ceil(t * fps - 1e-6) / fps;
  const skipRanges = getSkipRanges(skipActions)
    .map((r) => ({ start: onFrame(r.start), end: onFrame(r.end) }))
    .filter((r) => r.end > r.start);
  const skipRemap = buildSkipRemap(skipRanges);

  if (skipRanges.length > 0) {
    const out = nextOutput();
    timed("skip", () => applySkipPass(currentInput, skipRanges, out, tempDir, emit));
    if (fs.existsSync(out) && fs.statSync(out).size > 0) {
      currentInput = out;
    } else {
      emit("  Warning: Skip pass produced no output, skipping");
    }
  }

  // ═══════════════════════════════════════════════════════════
  // Pass 3: Speed — apply speed ramps (remapped through skip)
  // ═══════════════════════════════════════════════════════════

  const rawSpeedRanges = getSpeedRanges(speedActions);
  const postSkipSpeedRanges = remapRanges(rawSpeedRanges, skipRemap);
  const speedRemap = buildSpeedRemap(postSkipSpeedRanges);

  if (postSkipSpeedRanges.length > 0) {
    const out = nextOutput();
    timed("speed", () => applySpeedPass(currentInput, postSkipSpeedRanges, out, tempDir, emit));
    if (fs.existsSync(out) && fs.statSync(out).size > 0) {
      currentInput = out;
    } else {
      emit("  Warning: Speed pass produced no output, skipping");
    }
  }

  // Combined remap: original → post-skip → post-speed
  const remapTs = (ts: number) => speedRemap(skipRemap(ts));

  // ═══════════════════════════════════════════════════════════
  // Pass 4: Mute — silence audio ranges (remapped timestamps)
  // Applied BEFORE inserts so muted audio stays muted in clips
  // ═══════════════════════════════════════════════════════════

  if (muteActions.length > 0) {
    const rawMuteRanges = muteActions
      .filter((a) => a.muteEndTimestamp)
      .map((a) => ({ start: a.timestamp, end: a.muteEndTimestamp! }))
      .sort((a, b) => a.start - b.start);
    const remappedMuteRanges = remapRanges(rawMuteRanges, remapTs);

    if (remappedMuteRanges.length > 0) {
      const out = nextOutput();
      timed("mute", () => applyMutePass(currentInput, remappedMuteRanges, out, emit));
      if (fs.existsSync(out) && fs.statSync(out).size > 0) {
        currentInput = out;
      }
    }
  }

  // ═══════════════════════════════════════════════════════════
  // Pass 4b: Blur — BEFORE inserts, on the post-skip/speed timeline.
  // Freeze frames and zoom frames are cut from this video, so a narration or
  // pause inside a blur stays blurred for its whole length and a zoom into a
  // blurred region shows blurred pixels. (Blurring after inserts left freezes
  // and zooms made from the unblurred video: the secret showed.) blurDuration
  // is in recording seconds, like every other timestamp of the action.
  // ═══════════════════════════════════════════════════════════

  const preInsertBlur = blurActions
    .map((a) => {
      const start = remapTs(a.timestamp);
      const end = remapTs(a.timestamp + (a.blurDuration ?? 3));
      return { ...a, timestamp: start, blurDuration: end - start };
    })
    .filter((a) => a.timestamp >= 0 && (a.blurDuration ?? 0) > 0.05);
  if (preInsertBlur.length > 0) {
    const batches = batchNonOverlapping(preInsertBlur);
    const blurInputDuration = probeDuration(currentInput);
    emit(`\n[Pass: Blur] ${preInsertBlur.length} action(s) → ${batches.length} pass(es)`);
    for (let bi = 0; bi < batches.length; bi++) {
      const out = nextOutput();
      emit(`  Pass ${bi + 1}/${batches.length} (${batches[bi].length} blur${batches[bi].length > 1 ? "s" : ""}):`);
      timed("blur", () => applyBlurBatch(currentInput, batches[bi], out, nativeRes, blurInputDuration, emit));
      if (fs.existsSync(out) && fs.statSync(out).size > 0) {
        currentInput = out;
      } else {
        emit(`    Warning: blur batch pass produced no output, skipping`);
      }
    }
  }

  // ═══════════════════════════════════════════════════════════
  // Pass 5: Insert Effects (zoom, pause, narrate)
  // Uses remapped timestamps for cutting the processed video
  // ═══════════════════════════════════════════════════════════

  const insertActions = [...zoomActions, ...pauseActions, ...narrateActions];
  let narrationTimestamps: Array<{ start: number; end: number }> = [];
  // original(post-skip/speed) → final time, accounting for insert stretching.
  let insertRemap: (ts: number) => number = (ts) => ts;
  let subtitleCues: SubtitleCue[] = [];

  if (insertActions.length > 0) {
    // Pre-generate narration audio
    const narrations = new Map<Action, NarrationResult>();
    for (let i = 0; i < insertActions.length; i++) {
      const action = insertActions[i];
      const narr = findNarration(action);
      if (!narr) continue;

      const audioPath = path.join(tempDir, `narr_${String(i).padStart(3, "0")}.wav`);
      const { hasAudio, audioDuration } = prepareNarrationAudio(action, audioPath, project, emit, action.timestamp);
      if (hasAudio) {
        narrations.set(action, { audioPath, audioDuration, text: narr.text || "", lang: narr.lang || "en" });
      }
    }

    const out = nextOutput();
    const result = timed("inserts", () => executeInsertPass(
      currentInput, insertActions, narrations,
      out, tempDir, res, project, emit, remapTs,
    ));
    narrationTimestamps = result.narrationTimestamps;
    insertRemap = buildInsertRemap(result.insertExpansions);
    subtitleCues = result.subtitleCues;
    if (fs.existsSync(out) && fs.statSync(out).size > 0) {
      currentInput = out;
    } else {
      emit("  Warning: Insert pass produced no output, skipping");
    }
  }

  // ═══════════════════════════════════════════════════════════
  // Pass 5b: Music — mix background music (audio only; the video is copied).
  // Before the final pass, so title/end cards joined there stay music-free.
  // ═══════════════════════════════════════════════════════════

  if (musicAction) {
    emit(`\n[Pass: Music] Mixing background music...`);
    const out = nextOutput();
    // The action's timestamp → musicEndTimestamp, on the final timeline (after
    // skips, speed ramps and inserts), like every other effect.
    const finalAt = (ts: number) => insertRemap(remapTs(ts));
    const window = {
      start: Math.max(0, finalAt(musicAction.timestamp ?? 0)),
      end: musicAction.musicEndTimestamp != null ? finalAt(musicAction.musicEndTimestamp) : undefined,
    };
    timed("music", () => mixBackgroundMusic(currentInput, musicAction, narrationTimestamps, out, emit, window));
    if (fs.existsSync(out) && fs.statSync(out).size > 0) currentInput = out;
    else emit("  Warning: music pass produced no output, skipping");
  }

  // ═══════════════════════════════════════════════════════════
  // Pass 6: Final — ONE encode for everything drawn on the finished timeline:
  // spotlights, then callouts/arrows + subtitles (libass, burned last so
  // dimming never covers them), then scaling, then any title/end cards.
  // Overlay timestamps are remapped through skip/speed/insert so each lands on
  // the SAME frame its rect was captured on. (These used to be separate full
  // re-encodes; the earlier passes write fast near-lossless intermediates.)
  // ═══════════════════════════════════════════════════════════

  const overlayRemap = (ts: number) => insertRemap(remapTs(ts));
  const remapOverlayActions = (actions: Action[]): Action[] =>
    actions
      .map((a) => ({ ...a, timestamp: overlayRemap(a.timestamp) }))
      .filter((a) => a.timestamp >= 0);

  const remappedSpotlights = remapOverlayActions(spotlightActions);
  const remappedCallouts = remapOverlayActions(calloutActions);

  // Validate: no overlapping spotlights (use multiple rects on one spotlight instead)
  if (remappedSpotlights.length > 1) {
    const sorted = [...remappedSpotlights].sort((a, b) => a.timestamp - b.timestamp);
    for (let i = 0; i < sorted.length - 1; i++) {
      const endI = sorted[i].timestamp + (sorted[i].spotlightDuration ?? 3);
      const startNext = sorted[i + 1].timestamp;
      if (startNext < endI) {
        throw new Error(
          `Overlapping spotlights: one at ${sorted[i].timestamp.toFixed(1)}s-${endI.toFixed(1)}s overlaps with another at ${startNext.toFixed(1)}s. ` +
          `Use multiple regions on a single spotlight action instead (click "Add Another Region" in the spotlight editor).`,
        );
      }
    }
  }

  const finalDuration = probeDuration(currentInput);
  const graph: string[] = [];
  let vLabel = "0:v";
  const cmdFile = "spotlight.cmd";
  if (remappedSpotlights.length > 0) {
    emit(`\n[Overlay: spotlight] ${remappedSpotlights.length} action(s)`);
    const sp = spotlightGraph(remappedSpotlights, res, finalDuration, emit, vLabel, cmdFile);
    if (sp.commands.length) fs.writeFileSync(path.join(tempDir, cmdFile), sp.commands.join("\n") + "\n");
    graph.push(...sp.graph);
    vLabel = sp.out;
  }

  const calloutLines = remappedCallouts.length
    ? (emit(`\n[Overlay: callout] ${remappedCallouts.length} action(s)`), calloutEvents(remappedCallouts, res, finalDuration, emit))
    : [];
  if (subtitleCues.length > 0 || calloutLines.length > 0) {
    emit(`\n[Pass: Subtitles] ${subtitleCues.length} narration(s)${calloutLines.length ? `, ${calloutLines.length} callout line(s)` : ""}`);
    // A lower-third banner shares the bottom band with subtitles: while one is
    // on screen, lift the subtitles just above its box so neither hides the other.
    const banners = remappedCallouts
      .filter((a) => a.calloutStyle === "lower-third")
      .map((a) => {
        const panel = a.calloutPanels?.[0];
        // producer banner: text top at h-80, 36 px, 15 px box border; panel: its y, PANEL_PAD above
        const boxTop = panel ? panel.rect[1] - PANEL_PAD.label.y : res.height - 95;
        return { start: a.timestamp, end: a.timestamp + (a.calloutDuration ?? 3), lift: res.height - boxTop + 12 };
      });
    for (const cue of subtitleCues) {
      const over = banners.filter((b) => b.start < cue.start + cue.duration && b.end > cue.start);
      if (over.length) cue.marginV = Math.max(SUBTITLE_MARGIN_V, ...over.map((b) => b.lift));
    }
    writeSubtitleFile(subtitleCues, path.join(tempDir, "subtitles.ass"), res, calloutLines);
    // ffmpeg runs IN tempDir with bare file names: the `ass=` argument can't carry
    // paths with , ' [ ] : or a Windows drive letter without fragile escaping.
    graph.push(`[${vLabel}]ass=subtitles.ass[subbed]`);
    vLabel = "subbed";
  }

  const outSize = opts.letterbox ?? resolution;
  const needsScale = !!outSize && (outSize.width !== nativeRes.width || outSize.height !== nativeRes.height);
  if (needsScale) {
    emit(`\n[Final] Scaling to ${outSize!.width}x${outSize!.height}`);
    const { width: W, height: H } = outSize!;
    graph.push(`[${vLabel}]scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1[scaled]`);
    vLabel = "scaled";
  }

  const versionLabel = version || computeVersionLabel(videoDir);
  const finalPath = path.join(videoDir, `final_${versionLabel}.mp4`);
  const wrapParts = [opts.wrap?.before, opts.wrap?.after].filter((x): x is string => !!x);
  const finalCrf = crf || 18;

  if (currentInput === effectiveRecording && graph.length === 0 && finalCrf === 18 && wrapParts.length === 0) {
    emit("\nNo effects to apply, copying original recording...");
    fs.copyFileSync(currentInput, finalPath);
  } else {
    emit(`\n[Final] Encoding final_${versionLabel}.mp4 (CRF ${finalCrf})${wrapParts.length ? " with title/end cards" : ""}...`);
    const finished = path.join(tempDir, "finished.mp4");
    const args = ["-y", "-i", path.resolve(currentInput)];
    let aMap: string | null = hasAudioStream(currentInput) ? "0:a" : null;
    if (wrapParts.length) {
      // intro + video + outro, each normalised to the output size, 30 fps and
      // stereo 48 kHz (a part without sound gets silence), joined by concat.
      const size = outSize ?? nativeRes;
      // setpts/asetpts: concat places each part right after the previous one's
      // end, so every part must start at 0 (a rendered video can start a frame
      // late, which showed as the intro card's last frame held one frame longer).
      const norm = `setpts=PTS-STARTPTS,scale=${size.width}:${size.height}:force_original_aspect_ratio=decrease,pad=${size.width}:${size.height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p`;
      const parts = [opts.wrap?.before, "main", opts.wrap?.after].filter((x): x is string => !!x);
      let idx = 1;
      const labels = parts.map((part, k) => {
        const file = part === "main" ? currentInput : part;
        const vi = part === "main" ? -1 : idx++;
        if (vi >= 0) args.push("-i", path.resolve(file));
        graph.push(`[${vi < 0 ? vLabel : `${vi}:v`}]${norm}[cv${k}]`);
        if (hasAudioStream(file)) {
          graph.push(`[${vi < 0 ? 0 : vi}:a]asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo[ca${k}]`);
        } else {
          args.push("-f", "lavfi", "-t", String(probeDuration(file)), "-i", "anullsrc=channel_layout=stereo:sample_rate=48000");
          graph.push(`[${idx++}:a]anull[ca${k}]`);
        }
        return `[cv${k}][ca${k}]`;
      });
      graph.push(`${labels.join("")}concat=n=${parts.length}:v=1:a=1[cv][ca]`);
      vLabel = "cv";
      aMap = "[ca]";
    }
    if (graph.length) args.push("-filter_complex_threads", FILTER_THREADS, "-filter_complex", graph.join(";"), "-map", vLabel.includes(":") ? vLabel : `[${vLabel}]`);
    else args.push("-map", "0:v");
    if (aMap) args.push("-map", aMap);
    // Cards used to be joined in a separate "medium" re-encode; keep that preset for them.
    args.push("-c:v", "libx264", "-preset", wrapParts.length ? "medium" : "fast", "-crf", String(finalCrf), "-pix_fmt", "yuv420p");
    if (aMap) args.push(...(wrapParts.length ? ["-c:a", "aac", "-b:a", "192k"] : ["-c:a", "copy"]));
    args.push("-movflags", "+faststart", path.resolve(finished));
    const r = timed("final", () => spawnSync(FFMPEG_PATH, args, { cwd: tempDir, stdio: ["pipe", "pipe", "ignore"] }));
    if (r.status === 0 && fs.existsSync(finished) && fs.statSync(finished).size > 0) {
      fs.renameSync(finished, finalPath);
    } else {
      emit(`  Warning: final pass produced no output, skipping (ffmpeg exit ${r.status})`);
      fs.copyFileSync(currentInput, finalPath);
    }
  }
  opts.onTimings?.(timings);

  // ─── Cleanup ───
  try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { /* ignore */ }

  emit("\nDone!");
  return finalPath;
}
