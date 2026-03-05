import * as path from "path";
import * as fs from "fs";
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
// Pass 1: Overlay Effects (blur, spotlight, callout)
// These apply timed filters on the full video — no duration change
// ═════════════════════════════════════════════════════════════

function applyBlurPass(
  inputPath: string,
  blurActions: Action[],
  outputPath: string,
  res: { width: number; height: number },
  totalDuration: number,
  emit: (msg: string) => void,
): void {
  emit(`\n[Pass: Blur] Applying ${blurActions.length} blur effect(s)...`);

  // Build a chain of timed blur filters
  // For each blur action, we split, crop, blur, overlay with enable
  let filterChain = "";
  let lastLabel = "0:v";
  let idx = 0;

  for (const action of blurActions) {
    const rects = action.blurRects ?? [];
    if (rects.length === 0) continue;

    const radius = action.blurRadius ?? 20;
    const start = action.timestamp;
    const end = start + (action.blurDuration ?? 3);
    const enableExpr = `between(t,${start.toFixed(3)},${Math.min(end, totalDuration).toFixed(3)})`;

    emit(`  Blur at ${start.toFixed(1)}s-${end.toFixed(1)}s (${rects.length} region${rects.length > 1 ? "s" : ""})`);

    for (const [bx, by, bw, bh] of rects) {
      const x = Math.max(0, Math.min(bx, res.width - 1));
      const y = Math.max(0, Math.min(by, res.height - 1));
      const w = Math.min(bw, res.width - x);
      const h = Math.min(bh, res.height - y);
      if (w <= 0 || h <= 0) continue;

      const sep = filterChain ? ";" : "";
      filterChain += `${sep}[${lastLabel}]split[base${idx}][src${idx}]`;
      filterChain += `;[src${idx}]crop=${w}:${h}:${x}:${y},boxblur=${radius}:${radius}[blur${idx}]`;
      filterChain += `;[base${idx}][blur${idx}]overlay=${x}:${y}:enable='${enableExpr}'[out${idx}]`;
      lastLabel = `out${idx}`;
      idx++;
    }
  }

  if (!filterChain) {
    fs.copyFileSync(inputPath, outputPath);
    return;
  }

  const args = ["-y", "-i", inputPath, "-filter_complex", filterChain];
  args.push("-map", `[${lastLabel}]`);
  if (hasAudioStream(inputPath)) {
    args.push("-map", "0:a", "-c:a", "copy");
  }
  args.push("-c:v", "libx264", "-preset", "fast", "-crf", "18", "-pix_fmt", "yuv420p");
  args.push(outputPath);
  ffmpegSync(args);
}

function applySpotlightPass(
  inputPath: string,
  spotActions: Action[],
  outputPath: string,
  res: { width: number; height: number },
  totalDuration: number,
  emit: (msg: string) => void,
): void {
  emit(`\n[Pass: Spotlight] Applying ${spotActions.length} spotlight effect(s)...`);

  // For each spotlight action (which may have multiple rects):
  // 1. Dim the full frame
  // 2. For each rect, crop the bright region from original and overlay onto dimmed
  // 3. Overlay the composite onto passthrough, enabled only during time range

  let filterChain = "";
  let lastLabel = "0:v";
  let idx = 0;

  for (const action of spotActions) {
    // Merge legacy single rect + multi-rect
    const rects = action.spotlightRects ?? (action.spotlightRect ? [action.spotlightRect] : []);
    if (rects.length === 0) continue;

    const alpha = (action.dimOpacity ?? 0.7).toFixed(2);
    const start = action.timestamp;
    const end = start + (action.spotlightDuration ?? 3);
    const enableExpr = `between(t,${start.toFixed(3)},${Math.min(end, totalDuration).toFixed(3)})`;

    emit(`  Spotlight at ${start.toFixed(1)}s-${end.toFixed(1)}s (${rects.length} region${rects.length > 1 ? "s" : ""})`);

    const sep = filterChain ? ";" : "";
    // Split: passthrough + dark + one copy per bright region
    const splitCount = 2 + rects.length;
    const splitLabels = [`pass${idx}`, `dark${idx}`, ...rects.map((_, ri) => `crop${idx}_${ri}`)];
    filterChain += `${sep}[${lastLabel}]split=${splitCount}${splitLabels.map((l) => `[${l}]`).join("")}`;

    // Dim the full frame
    filterChain += `;[dark${idx}]drawbox=x=0:y=0:w=iw:h=ih:color=black@${alpha}:t=fill[dimmed${idx}]`;

    // For each rect: crop bright region from original copy, overlay onto dimmed
    let compositeLabel = `dimmed${idx}`;
    for (let ri = 0; ri < rects.length; ri++) {
      const [sx, sy, sw, sh] = rects[ri];
      filterChain += `;[crop${idx}_${ri}]crop=${sw}:${sh}:${sx}:${sy}[bright${idx}_${ri}]`;
      const outLabel = ri < rects.length - 1 ? `comp${idx}_${ri}` : `spotlight${idx}`;
      filterChain += `;[${compositeLabel}][bright${idx}_${ri}]overlay=${sx}:${sy}[${outLabel}]`;
      compositeLabel = outLabel;
    }

    // Overlay the composite onto passthrough, only during time range
    filterChain += `;[pass${idx}][spotlight${idx}]overlay=0:0:enable='${enableExpr}'[out${idx}]`;
    lastLabel = `out${idx}`;
    idx++;
  }

  if (!filterChain) {
    fs.copyFileSync(inputPath, outputPath);
    return;
  }

  const args = ["-y", "-i", inputPath, "-filter_complex", filterChain];
  args.push("-map", `[${lastLabel}]`);
  if (hasAudioStream(inputPath)) {
    args.push("-map", "0:a", "-c:a", "copy");
  }
  args.push("-c:v", "libx264", "-preset", "fast", "-crf", "18", "-pix_fmt", "yuv420p");
  args.push(outputPath);
  ffmpegSync(args);
}

function escapeDrawtext(text: string): string {
  // For ffmpeg drawtext inside filter_complex:
  // 1. Escape single quotes for the text='...' wrapper
  // 2. Escape colons (: is key=value separator in drawtext)
  // 3. Escape backslashes
  return text
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\u2019")  // Replace with unicode right single quote (safest)
    .replace(/:/g, "\\:")
    .replace(/;/g, "\\;");
}

function applyCalloutPass(
  inputPath: string,
  calloutActions: Action[],
  outputPath: string,
  totalDuration: number,
  emit: (msg: string) => void,
): void {
  emit(`\n[Pass: Callout] Applying ${calloutActions.length} callout(s)...`);

  // Build a filter_complex chain: [0:v]drawtext=...,drawtext=...[vout]
  // Using filter_complex avoids -vf comma-parsing issues with enable expressions
  const filters: string[] = [];

  for (const action of calloutActions) {
    const start = action.timestamp;
    const end = start + (action.calloutDuration ?? 3);
    const enableExpr = `between(t,${start.toFixed(3)},${Math.min(end, totalDuration).toFixed(3)})`;
    const style = action.calloutStyle || "label";
    const step = action.calloutStep;

    // Modern: calloutPanels with positioned text regions
    const panels = action.calloutPanels;
    if (panels && panels.length > 0) {
      emit(`  Callout at ${start.toFixed(1)}s-${end.toFixed(1)}s (${panels.length} panel${panels.length > 1 ? "s" : ""})`);
      for (const panel of panels) {
        if (!panel.text) continue;
        let displayText = panel.text;
        if (style === "step-counter" && step) {
          displayText = `Step ${step}: ${displayText}`;
        }
        displayText = escapeDrawtext(displayText);
        const fontSize = panel.fontSize || 24;
        const x = panel.rect[0];
        const y = panel.rect[1];
        filters.push(
          `drawtext=text='${displayText}':fontsize=${fontSize}:fontcolor=white:x=${x}:y=${y}:box=1:boxcolor=black@0.7:boxborderw=10:enable='${enableExpr}'`,
        );
      }
      continue;
    }

    // Legacy fallback: single calloutText with calloutPosition
    const text = action.calloutText;
    if (!text) continue;

    emit(`  Callout at ${start.toFixed(1)}s-${end.toFixed(1)}s: "${text.slice(0, 30)}..."`);

    let displayText = text;
    if (style === "step-counter" && step) {
      displayText = `Step ${step}: ${text}`;
    }
    displayText = escapeDrawtext(displayText);

    const position = action.calloutPosition as [number, number] | undefined;
    if (style === "lower-third") {
      filters.push(
        `drawtext=text='${displayText}':fontsize=36:fontcolor=white:x=(w-text_w)/2:y=h-80:box=1:boxcolor=black@0.7:boxborderw=15:enable='${enableExpr}'`,
      );
    } else if (style === "step-counter") {
      const x = position ? position[0] : 100;
      const y = position ? position[1] : 100;
      filters.push(
        `drawtext=text='${displayText}':fontsize=28:fontcolor=white:x=${x}:y=${y}:box=1:boxcolor=0x2563EB@0.9:boxborderw=12:enable='${enableExpr}'`,
      );
    } else {
      const x = position ? position[0] : 100;
      const y = position ? position[1] : 100;
      filters.push(
        `drawtext=text='${displayText}':fontsize=28:fontcolor=white:x=${x}:y=${y}:box=1:boxcolor=black@0.8:boxborderw=10:enable='${enableExpr}'`,
      );
    }
  }

  if (filters.length === 0) {
    fs.copyFileSync(inputPath, outputPath);
    return;
  }

  // Use filter_complex with semicolons between drawtext filters chained on [0:v]
  // Each filter takes the previous output as input
  let chain = "";
  let lastLabel = "0:v";
  for (let i = 0; i < filters.length; i++) {
    const outLabel = i < filters.length - 1 ? `dt${i}` : "vout";
    const sep = chain ? ";" : "";
    chain += `${sep}[${lastLabel}]${filters[i]}[${outLabel}]`;
    lastLabel = outLabel;
  }

  const args = ["-y", "-i", inputPath, "-filter_complex", chain];
  args.push("-map", "[vout]");
  if (hasAudioStream(inputPath)) {
    args.push("-map", "0:a", "-c:a", "copy");
  }
  args.push("-c:v", "libx264", "-preset", "fast", "-crf", "18", "-pix_fmt", "yuv420p");
  args.push(outputPath);
  ffmpegSync(args);
}

// ═════════════════════════════════════════════════════════════
// Pass 2: Segment-based pass (zoom, pause, narrate, speed, skip, mute)
// These change the timeline duration, so they're handled together
// using the segment cut/concat approach
// ═════════════════════════════════════════════════════════════

type SegmentPlan =
  | { kind: "clip"; start: number; end: number; speed?: number; muted?: boolean }
  | { kind: "insert"; ts: number; action: Action; insertType: "zoom" | "pause" | "narrate" };

function getSkipRanges(actions: Action[]): Array<{ start: number; end: number }> {
  return actions
    .filter((a) => a.type === "skip" && a.skipEndTimestamp)
    .map((a) => ({ start: a.timestamp, end: a.skipEndTimestamp! }))
    .sort((a, b) => a.start - b.start);
}

function getSpeedRanges(actions: Action[]): Array<{ start: number; end: number; factor: number }> {
  return actions
    .filter((a) => a.type === "speed" && a.speedEndTimestamp && a.speedFactor)
    .map((a) => ({ start: a.timestamp, end: a.speedEndTimestamp!, factor: a.speedFactor! }))
    .sort((a, b) => a.start - b.start);
}

function getMuteRanges(actions: Action[]): Array<{ start: number; end: number }> {
  return actions
    .filter((a) => a.type === "mute" && a.muteEndTimestamp)
    .map((a) => ({ start: a.timestamp, end: a.muteEndTimestamp as number }))
    .sort((a, b) => a.start - b.start);
}

function isRangeSkipped(start: number, end: number, skipRanges: Array<{ start: number; end: number }>): boolean {
  return skipRanges.some((r) => start >= r.start - 0.05 && end <= r.end + 0.05);
}

function isInSkipRange(time: number, skipRanges: Array<{ start: number; end: number }>): boolean {
  return skipRanges.some((r) => time >= r.start && time < r.end);
}

function isInMuteRange(start: number, end: number, muteRanges: Array<{ start: number; end: number }>): boolean {
  return muteRanges.some((r) => start >= r.start - 0.05 && end <= r.end + 0.05);
}

function getSpeedForRange(start: number, end: number, speedRanges: Array<{ start: number; end: number; factor: number }>): number | null {
  const range = speedRanges.find((r) => start >= r.start - 0.1 && end <= r.end + 0.1);
  return range ? range.factor : null;
}

function getSplitPoints(
  from: number,
  to: number,
  skipRanges: Array<{ start: number; end: number }>,
  speedRanges: Array<{ start: number; end: number; factor: number }>,
  muteRanges: Array<{ start: number; end: number }>,
): number[] {
  const points = new Set<number>();
  for (const r of skipRanges) {
    if (r.start > from + 0.05 && r.start < to - 0.05) points.add(r.start);
    if (r.end > from + 0.05 && r.end < to - 0.05) points.add(r.end);
  }
  for (const r of speedRanges) {
    if (r.start > from + 0.05 && r.start < to - 0.05) points.add(r.start);
    if (r.end > from + 0.05 && r.end < to - 0.05) points.add(r.end);
  }
  for (const r of muteRanges) {
    if (r.start > from + 0.05 && r.start < to - 0.05) points.add(r.start);
    if (r.end > from + 0.05 && r.end < to - 0.05) points.add(r.end);
  }
  return [...points].sort((a, b) => a - b);
}

function planClipsBetween(
  from: number,
  to: number,
  skipRanges: Array<{ start: number; end: number }>,
  speedRanges: Array<{ start: number; end: number; factor: number }>,
  muteRanges: Array<{ start: number; end: number }>,
): SegmentPlan[] {
  const plans: SegmentPlan[] = [];
  const splitPts = getSplitPoints(from, to, skipRanges, speedRanges, muteRanges);
  const edges = [from, ...splitPts, to];

  for (let i = 0; i < edges.length - 1; i++) {
    const segStart = edges[i];
    const segEnd = edges[i + 1];
    if (segEnd - segStart < 0.1) continue;
    if (isRangeSkipped(segStart, segEnd, skipRanges)) continue;

    const speedFactor = getSpeedForRange(segStart, segEnd, speedRanges);
    const muted = isInMuteRange(segStart, segEnd, muteRanges);
    plans.push({
      kind: "clip",
      start: segStart,
      end: segEnd,
      speed: (speedFactor && speedFactor !== 1) ? speedFactor : undefined,
      muted: muted || undefined,
    });
  }
  return plans;
}

function estimateInsertDuration(action: Action, narration?: NarrationResult): number {
  let dur = 3;
  if (narration && narration.audioDuration > 0) dur = narration.audioDuration + 0.5;
  if (typeof action.resumeAfter === "number") return action.resumeAfter;
  if (action.type === "zoom") dur = Math.max(dur, (action.zoomDuration ?? 1) * 2 + (action.zoomHold ?? 2));
  if (action.type === "pause" && typeof action.resumeAfter === "number") dur = action.resumeAfter;
  return dur;
}

function planSegmentPass(
  insertActions: Action[],
  skipRanges: Array<{ start: number; end: number }>,
  speedRanges: Array<{ start: number; end: number; factor: number }>,
  muteRanges: Array<{ start: number; end: number }>,
  totalDuration: number,
): SegmentPlan[] {
  const sorted = [...insertActions].sort((a, b) => a.timestamp - b.timestamp);
  const plans: SegmentPlan[] = [];
  let currentTime = 0;

  for (const action of sorted) {
    const ts = action.timestamp;
    if (isInSkipRange(ts, skipRanges)) continue;

    // Clips between currentTime and this insert point
    if (ts > currentTime + 0.1) {
      plans.push(...planClipsBetween(currentTime, ts, skipRanges, speedRanges, muteRanges));
    }

    const insertType = action.type as "zoom" | "pause" | "narrate";
    plans.push({ kind: "insert", ts, action, insertType });

    // For zoom/pause, video resumes from the same timestamp (freeze frame inserted)
    // For narrate without freeze, video continues playing during narration
    if (action.type === "zoom" || action.type === "pause" || action.freeze === true) {
      currentTime = ts;
    } else {
      // narrate without freeze: video plays during narration
      currentTime = Math.min(ts + estimateInsertDuration(action), totalDuration);
    }
  }

  // Trailing clip after last insert
  if (currentTime < totalDuration - 0.1) {
    plans.push(...planClipsBetween(currentTime, totalDuration, skipRanges, speedRanges, muteRanges));
  }

  return plans;
}

// ─── Subtitle Utilities ──────────────────────────────────────

function secToAssTs(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const cs = Math.round((sec - Math.floor(sec)) * 100);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

function generateSubtitleFile(
  text: string, duration: number, outputPath: string,
  res: { width: number; height: number }, fontSize: number = 28,
): void {
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
  let currentTime = 0;
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
    dialogues.push(`Dialogue: 0,${startTs},${endTs},Default,,0000,0000,0000,karaoke,${karokeParts}`);
    currentTime += entryDuration;
  }

  const assContent = `[Script Info]
Title: Demo Subtitle
ScriptType: v4.00+
PlayResX: ${res.width}
PlayResY: ${res.height}

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Noto Sans,${fontSize},&H00FFFFFF,&H0000FFFF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,2,1,2,20,20,50,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${dialogues.join("\n")}
`;
  fs.writeFileSync(outputPath, assContent, "utf-8");
}

function burnSubtitles(videoPath: string, subtitlePath: string, outputPath: string): boolean {
  ffmpegSync([
    "-y", "-i", videoPath,
    "-vf", `ass=${subtitlePath}`,
    "-c:v", "libx264", "-preset", "fast", "-crf", "18", "-pix_fmt", "yuv420p",
    "-c:a", "copy",
    outputPath,
  ]);
  return fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0;
}

// ─── Insert Segment Builders ─────────────────────────────────

function buildZoomInsert(
  action: Action,
  recordingPath: string,
  tempDir: string,
  segIdx: number,
  res: { width: number; height: number },
  narration: NarrationResult | undefined,
  emit: (msg: string) => void,
): string[] {
  const zoomRect = action.zoomRect!;
  const zoomDuration = action.zoomDuration ?? 1;
  const holdDuration = narration ? narration.audioDuration + 0.5 : (action.zoomHold ?? 2);

  const framePath = path.join(tempDir, `frame_${String(segIdx).padStart(3, "0")}.png`);
  extractFrame(recordingPath, action.timestamp, framePath);
  emit(`  Zoom at ${action.timestamp.toFixed(1)}s hold=${holdDuration.toFixed(1)}s`);

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

  const paths: string[] = [];

  // Zoom-in
  const zoomInPath = path.join(tempDir, `zoomin_${String(segIdx).padStart(3, "0")}.mp4`);
  const zpIn = [
    `zoompan=z='1+(${maxZ.toFixed(4)}-1)*${ssForward}'`,
    `x='${xExpr}'`, `y='${yExpr}'`,
    `d=${inFrames}`, `s=${outW}x${outH}`, `fps=30`,
  ].join(":");
  ffmpegSync(["-y", "-i", framePath, "-vf", zpIn, "-c:v", "libx264", "-preset", "fast", "-crf", "18", "-pix_fmt", "yuv420p", zoomInPath]);
  paths.push(zoomInPath);

  // Hold (with narration audio if available)
  const holdPath = path.join(tempDir, `zoomhold_${String(segIdx + 1).padStart(3, "0")}.mp4`);
  const zpHold = [`zoompan=z='${maxZ.toFixed(4)}'`, `x='${xExpr}'`, `y='${yExpr}'`, `d=${holdFrames}`, `s=${outW}x${outH}`, `fps=30`].join(":");
  const holdArgs = ["-y", "-i", framePath];
  if (narration) holdArgs.push("-i", narration.audioPath);
  holdArgs.push("-vf", zpHold, "-c:v", "libx264", "-preset", "fast", "-crf", "18", "-pix_fmt", "yuv420p");
  if (narration) holdArgs.push("-c:a", "aac", "-b:a", "192k", "-shortest");
  holdArgs.push(holdPath);
  ffmpegSync(holdArgs);
  paths.push(holdPath);

  // Zoom-out
  const zoomOutPath = path.join(tempDir, `zoomout_${String(segIdx + 2).padStart(3, "0")}.mp4`);
  const zpOut = [`zoompan=z='1+(${maxZ.toFixed(4)}-1)*${ssReverse}'`, `x='${xExpr}'`, `y='${yExpr}'`, `d=${inFrames}`, `s=${outW}x${outH}`, `fps=30`].join(":");
  ffmpegSync(["-y", "-i", framePath, "-vf", zpOut, "-c:v", "libx264", "-preset", "fast", "-crf", "18", "-pix_fmt", "yuv420p", zoomOutPath]);
  paths.push(zoomOutPath);

  return paths;
}

function buildPauseInsert(
  action: Action,
  recordingPath: string,
  tempDir: string,
  segIdx: number,
  res: { width: number; height: number },
  narration: NarrationResult | undefined,
  emit: (msg: string) => void,
): string[] {
  const framePath = path.join(tempDir, `frame_${String(segIdx).padStart(3, "0")}.png`);
  extractFrame(recordingPath, action.timestamp, framePath);

  let duration = 3;
  if (narration && narration.audioDuration > 0) duration = narration.audioDuration + 0.5;
  if (typeof action.resumeAfter === "number") duration = action.resumeAfter;

  emit(`  Pause at ${action.timestamp.toFixed(1)}s (${duration.toFixed(1)}s)`);

  const { width, height } = res;
  const vf = `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`;
  const freezePath = path.join(tempDir, `freeze_${String(segIdx).padStart(3, "0")}.mp4`);

  const args = ["-y", "-loop", "1", "-framerate", "30", "-i", framePath];
  if (narration) args.push("-i", narration.audioPath);
  args.push("-t", duration.toFixed(3), "-r", "30", "-vf", vf);
  args.push("-c:v", "libx264", "-preset", "fast", "-crf", "18", "-pix_fmt", "yuv420p");
  if (narration) args.push("-c:a", "aac", "-b:a", "192k", "-shortest");
  args.push(freezePath);
  ffmpegSync(args);

  return [freezePath];
}

function buildNarrateInsert(
  action: Action,
  recordingPath: string,
  tempDir: string,
  segIdx: number,
  res: { width: number; height: number },
  totalDuration: number,
  narration: NarrationResult | undefined,
  emit: (msg: string) => void,
): string[] {
  const ts = action.timestamp;

  // If freeze requested, build a freeze frame
  if (action.freeze === true || action.type === "pause") {
    return buildPauseInsert(action, recordingPath, tempDir, segIdx, res, narration, emit);
  }

  // Otherwise, play video with narration overlay
  let duration = narration ? narration.audioDuration + 0.5 : 3;
  if (typeof action.resumeAfter === "number") duration = action.resumeAfter;
  const clipEnd = Math.min(ts + duration, totalDuration);

  emit(`  Narrate at ${ts.toFixed(1)}s (${duration.toFixed(1)}s)`);

  const playPath = path.join(tempDir, `play_${String(segIdx).padStart(3, "0")}.mp4`);
  cutClip(recordingPath, ts, clipEnd, playPath);

  if (narration) {
    const withAudioPath = path.join(tempDir, `playaudio_${String(segIdx).padStart(3, "0")}.mp4`);
    ffmpegSync([
      "-y", "-i", playPath, "-i", narration.audioPath,
      "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest",
      withAudioPath,
    ]);
    if (fs.existsSync(withAudioPath) && fs.statSync(withAudioPath).size > 0) {
      return [withAudioPath];
    }
  }

  return [playPath];
}

function executeSegmentPass(
  inputPath: string,
  insertActions: Action[],
  skipActions: Action[],
  speedActions: Action[],
  muteActions: Action[],
  outputPath: string,
  tempDir: string,
  res: { width: number; height: number },
  project: Record<string, unknown>,
  emit: (msg: string) => void,
): { narrationTimestamps: Array<{ start: number; end: number }> } {
  const totalDuration = probeDuration(inputPath);
  const skipRanges = getSkipRanges(skipActions);
  const speedRanges = getSpeedRanges(speedActions);
  const muteRanges = getMuteRanges(muteActions);

  // Log what this pass includes
  const parts: string[] = [];
  if (insertActions.length > 0) parts.push(`${insertActions.length} insert(s)`);
  if (speedActions.length > 0) parts.push(`${speedActions.length} speed ramp(s)`);
  if (skipActions.length > 0) parts.push(`${skipActions.length} skip/cut(s)`);
  if (muteActions.length > 0) parts.push(`${muteActions.length} mute(s)`);
  emit(`\n[Pass: Segments] Processing ${parts.join(", ")}...`);

  const plans = planSegmentPass(insertActions, skipRanges, speedRanges, muteRanges, totalDuration);
  emit(`  Planned ${plans.length} segments`);

  // Pre-generate narration audio for all insert actions
  const narrations = new Map<number, NarrationResult>();
  for (let i = 0; i < plans.length; i++) {
    const plan = plans[i];
    if (plan.kind !== "insert") continue;

    const action = plan.action;
    // Find narration for this action (narrate type, or zoom/spotlight with narration)
    const narr = findNarration(action);
    if (!narr) continue;

    const audioPath = path.join(tempDir, `narr_${String(i).padStart(3, "0")}.wav`);
    const { hasAudio, audioDuration } = prepareNarrationAudio(action, audioPath, project, emit, plan.ts);
    if (hasAudio) {
      narrations.set(i, { audioPath, audioDuration, text: narr.text || "", lang: narr.lang || "en" });
    }
  }

  // Build all segments
  const segments: string[] = [];
  const narrationTimestamps: Array<{ start: number; end: number }> = [];
  let segIdx = 0;
  let runningDuration = 0;

  for (let i = 0; i < plans.length; i++) {
    const plan = plans[i];

    if (plan.kind === "clip") {
      const clipPath = path.join(tempDir, `clip_${String(segIdx).padStart(3, "0")}.mp4`);
      if (plan.speed) {
        emit(`  Speed ramp ${plan.speed}x: ${plan.start.toFixed(1)}s-${plan.end.toFixed(1)}s`);
        cutSpeedClip(inputPath, plan.start, plan.end, plan.speed, clipPath);
      } else if (plan.muted) {
        emit(`  Muted clip ${plan.start.toFixed(1)}s-${plan.end.toFixed(1)}s`);
        cutClipMuted(inputPath, plan.start, plan.end, clipPath);
      } else {
        cutClip(inputPath, plan.start, plan.end, clipPath);
      }
      if (fs.existsSync(clipPath) && fs.statSync(clipPath).size > 0) {
        runningDuration += probeDuration(clipPath);
        segments.push(clipPath);
        segIdx++;
      }
      continue;
    }

    // Insert plan
    const narration = narrations.get(i);
    let insertPaths: string[];

    if (plan.insertType === "zoom" && plan.action.zoomRect) {
      insertPaths = buildZoomInsert(plan.action, inputPath, tempDir, segIdx, res, narration, emit);
    } else if (plan.insertType === "pause") {
      insertPaths = buildPauseInsert(plan.action, inputPath, tempDir, segIdx, res, narration, emit);
    } else {
      insertPaths = buildNarrateInsert(plan.action, inputPath, tempDir, segIdx, res, totalDuration, narration, emit);
    }

    // Apply subtitles if narration has text
    if (narration?.text && plan.action.showSubtitles !== false && insertPaths.length > 0) {
      const lastPath = insertPaths[insertPaths.length - 1];
      const subPath = path.join(tempDir, `sub_${String(segIdx).padStart(3, "0")}.ass`);
      const subOutPath = path.join(tempDir, `subseg_${String(segIdx).padStart(3, "0")}.mp4`);
      generateSubtitleFile(narration.text, narration.audioDuration, subPath, res, plan.action.subtitleSize ?? 28);
      if (burnSubtitles(lastPath, subPath, subOutPath)) {
        insertPaths[insertPaths.length - 1] = subOutPath;
      }
    }

    // Track narration timestamps for music ducking
    if (narration) {
      const totalEffectDur = insertPaths.reduce((s, p) => s + probeDuration(p), 0);
      narrationTimestamps.push({ start: runningDuration, end: runningDuration + totalEffectDur });
    }

    for (const p of insertPaths) {
      runningDuration += probeDuration(p);
      segments.push(p);
      segIdx++;
    }
  }

  if (segments.length === 0) {
    // No segments — just copy input
    fs.copyFileSync(inputPath, outputPath);
    return { narrationTimestamps };
  }

  // Normalize & concat
  emit(`  Normalizing ${segments.length} segments...`);
  const normalized = segments.map((seg, i) => {
    if (i % 10 === 0) emit(`  Normalizing ${i + 1}/${segments.length}...`);
    return normalizeSegmentAudio(seg, seg.replace(".mp4", "_norm.mp4"));
  });

  emit("  Concatenating...");
  const concatList = path.join(tempDir, "concat_list.txt");
  concatSegments(normalized, outputPath, concatList);

  return { narrationTimestamps };
}

// ═════════════════════════════════════════════════════════════
// Pass 3: Mute pass (audio filter)
// ═════════════════════════════════════════════════════════════

function applyMutePass(
  inputPath: string,
  muteActions: Action[],
  outputPath: string,
  emit: (msg: string) => void,
): void {
  emit(`\n[Pass: Mute] Applying ${muteActions.length} mute range(s)...`);

  const filters: string[] = [];
  for (const action of muteActions) {
    if (!action.muteEndTimestamp) continue;
    const start = action.timestamp;
    const end = action.muteEndTimestamp;
    emit(`  Mute ${start.toFixed(1)}s-${end.toFixed(1)}s`);
    filters.push(`volume=enable='between(t,${start.toFixed(3)},${end.toFixed(3)})':volume=0`);
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
// Main Orchestrator — Multi-Pass Pipeline
// ═════════════════════════════════════════════════════════════

export async function produceTimelineVideo(
  sessionDir: string,
  emit: (msg: string) => void,
  version?: string,
  selectedActionIds?: string[],
): Promise<string> {
  // ─── Setup ───
  const project = JSON.parse(fs.readFileSync(path.join(sessionDir, "demo-project.json"), "utf-8"));
  const recordingPath = project.recordingPath;
  let allActions: Action[] = project.actions || [];
  const videoDir = path.join(sessionDir, "video");
  const tempDir = path.join(videoDir, "temp");
  fs.mkdirSync(videoDir, { recursive: true });
  fs.mkdirSync(tempDir, { recursive: true });
  const totalDuration = probeDuration(recordingPath);
  const res = probeResolution(recordingPath);
  emit(`Recording: ${res.width}x${res.height}, ${totalDuration.toFixed(1)}s`);

  // ─── Filter by selection ───
  if (selectedActionIds && selectedActionIds.length > 0) {
    allActions = allActions.filter((a: Action & { id?: string }) => selectedActionIds.includes(a.id ?? ""));
    emit(`Selected ${allActions.length} action(s) for processing`);
  }

  // ─── Categorize actions by type ───
  const blurActions = allActions.filter((a) => a.type === "blur" && a.blurRects && a.blurRects.length > 0);
  const spotlightActions = allActions.filter((a) => a.type === "spotlight" && (a.spotlightRect || (a.spotlightRects && a.spotlightRects.length > 0)));
  const calloutActions = allActions.filter((a) => a.type === "callout" && (a.calloutText || (a.calloutPanels && a.calloutPanels.length > 0)));
  const zoomActions = allActions.filter((a) => a.type === "zoom" && a.zoomRect);
  const pauseActions = allActions.filter((a) => a.type === "pause");
  const narrateActions = allActions.filter((a) => a.type === "narrate");
  const speedActions = allActions.filter((a) => a.type === "speed" && a.speedEndTimestamp && a.speedFactor);
  const skipActions = allActions.filter((a) => a.type === "skip" && a.skipEndTimestamp);
  const muteActions = allActions.filter((a) => a.type === "mute" && a.muteEndTimestamp);
  const musicAction = allActions.find((a) => a.type === "music" && a.musicPath);

  // Track intermediate files for cleanup
  let currentInput = recordingPath;
  let passIdx = 0;

  const nextOutput = () => {
    passIdx++;
    return path.join(tempDir, `pass_${passIdx}.mp4`);
  };

  // ═══════════════════════════════════════════════════════════
  // Pass 1: Overlay Effects (applied on full video, no duration change)
  // Order: blur → spotlight → callout
  // ═══════════════════════════════════════════════════════════

  if (blurActions.length > 0) {
    const out = nextOutput();
    applyBlurPass(currentInput, blurActions, out, res, totalDuration, emit);
    if (fs.existsSync(out) && fs.statSync(out).size > 0) {
      currentInput = out;
    } else {
      emit("  Warning: Blur pass produced no output, skipping");
    }
  }

  if (spotlightActions.length > 0) {
    const out = nextOutput();
    applySpotlightPass(currentInput, spotlightActions, out, res, totalDuration, emit);
    if (fs.existsSync(out) && fs.statSync(out).size > 0) {
      currentInput = out;
    } else {
      emit("  Warning: Spotlight pass produced no output, skipping");
    }
  }

  if (calloutActions.length > 0) {
    const out = nextOutput();
    applyCalloutPass(currentInput, calloutActions, out, totalDuration, emit);
    if (fs.existsSync(out) && fs.statSync(out).size > 0) {
      currentInput = out;
    } else {
      emit("  Warning: Callout pass produced no output, skipping");
    }
  }

  // ═══════════════════════════════════════════════════════════
  // Pass 2: Segment pass (zoom, pause, narrate, speed, skip, mute-as-clip)
  // All time-altering effects handled together to avoid timestamp remapping
  // Skip/cut is inherently last in the segment planner (skipped ranges excluded)
  // ═══════════════════════════════════════════════════════════

  const insertActions = [...zoomActions, ...pauseActions, ...narrateActions];
  const hasSegmentWork = insertActions.length > 0 || speedActions.length > 0 || skipActions.length > 0;

  let narrationTimestamps: Array<{ start: number; end: number }> = [];

  if (hasSegmentWork) {
    const out = nextOutput();
    const result = executeSegmentPass(
      currentInput, insertActions, skipActions, speedActions, muteActions,
      out, tempDir, res, project, emit,
    );
    narrationTimestamps = result.narrationTimestamps;
    if (fs.existsSync(out) && fs.statSync(out).size > 0) {
      currentInput = out;
    } else {
      emit("  Warning: Segment pass produced no output, skipping");
    }
  }

  // ═══════════════════════════════════════════════════════════
  // Pass 3: Mute (audio filter — only if no segment pass handled it)
  // If segment pass ran, mute was already applied via muted clips
  // If no segment pass, apply mute as a standalone audio filter
  // ═══════════════════════════════════════════════════════════

  if (muteActions.length > 0 && !hasSegmentWork) {
    const out = nextOutput();
    applyMutePass(currentInput, muteActions, out, emit);
    if (fs.existsSync(out) && fs.statSync(out).size > 0) {
      currentInput = out;
    }
  }

  // ═══════════════════════════════════════════════════════════
  // Pass 4: Music
  // ═══════════════════════════════════════════════════════════

  const versionLabel = version || computeVersionLabel(videoDir);
  const finalPath = path.join(videoDir, `final_${versionLabel}.mp4`);

  if (musicAction) {
    emit(`\n[Pass: Music] Mixing background music...`);
    mixBackgroundMusic(currentInput, musicAction, narrationTimestamps, finalPath, emit);
  } else if (currentInput === recordingPath) {
    // No effects applied at all — just copy the recording
    emit("\nNo effects to apply, copying original recording...");
    fs.copyFileSync(currentInput, finalPath);
  } else {
    // Move the last intermediate to final
    fs.renameSync(currentInput, finalPath);
  }

  // ─── Cleanup ───
  try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { /* ignore */ }

  emit("\nDone!");
  return finalPath;
}
