"use strict";
Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
const fs = require("fs");
const path = require("path");
const child_process = require("child_process");
const index = require("./job-W-Szny1w.cjs");
const narration = require("./narration-C9OhKhcT.cjs");
const playwrightCore = require("playwright-core");
require("os");
require("crypto");
function _interopNamespaceDefault(e) {
  const n = Object.create(null, { [Symbol.toStringTag]: { value: "Module" } });
  if (e) {
    for (const k in e) {
      if (k !== "default") {
        const d = Object.getOwnPropertyDescriptor(e, k);
        Object.defineProperty(n, k, d.get ? d : {
          enumerable: true,
          get: () => e[k]
        });
      }
    }
  }
  n.default = e;
  return Object.freeze(n);
}
const fs__namespace = /* @__PURE__ */ _interopNamespaceDefault(fs);
const path__namespace = /* @__PURE__ */ _interopNamespaceDefault(path);
function cutSpeedClip(inputPath, startTime, endTime, speedFactor, outputPath) {
  const pts = (1 / speedFactor).toFixed(4);
  const hasAudio = index.hasAudioStream(inputPath);
  const args = [
    "-y",
    "-ss",
    startTime.toFixed(3),
    // Input option: read exactly (end - start) of source; the output is then
    // (end - start) / speedFactor long. (As an output option it capped the
    // OUTPUT instead, consuming speedFactor x the range of source.)
    "-t",
    (endTime - startTime).toFixed(3),
    "-i",
    inputPath,
    // fps=30 resamples the re-timed frames onto the 30 fps grid exactly
    // (letting the encoder do it duplicated a few frames at the start).
    "-vf",
    `setpts=${pts}*PTS,fps=30`,
    ...index.INTERMEDIATE_VIDEO
  ];
  if (hasAudio) {
    args.push("-af", atempoChain(speedFactor));
    args.push("-c:a", "aac", "-b:a", "192k");
  } else {
    args.push("-an");
  }
  args.push(outputPath);
  index.ffmpegSync(args);
}
function atempoChain(factor) {
  const parts = [];
  let f = factor;
  while (f < 0.5) {
    parts.push(0.5);
    f /= 0.5;
  }
  while (f > 2) {
    parts.push(2);
    f /= 2;
  }
  parts.push(f);
  return parts.map((x) => `atempo=${Number(x.toFixed(6))}`).join(",");
}
function mixBackgroundMusic(videoPath, musicAction, narrationTimestamps, outputPath, emit, window = { start: 0 }) {
  const musicPath = musicAction.musicPath;
  if (!musicPath || !fs__namespace.existsSync(musicPath)) {
    emit("Music file not found, skipping music mix");
    fs__namespace.copyFileSync(videoPath, outputPath);
    return;
  }
  const volume = musicAction.musicVolume ?? 0.5;
  const duckTo = musicAction.musicDuckTo ?? 0.2;
  const videoSec = index.probeDuration(videoPath);
  const start = Math.max(0, window.start);
  const end = window.end != null && window.end < videoSec - 0.05 ? window.end : void 0;
  if (start >= videoSec - 0.05 || end != null && end <= start + 0.05) {
    emit(`Music starts at ${start.toFixed(1)}s${end != null ? ` and ends at ${end.toFixed(1)}s` : ""}, outside the ${videoSec.toFixed(1)}s video: no music`);
    fs__namespace.copyFileSync(videoPath, outputPath);
    return;
  }
  const len = (end ?? videoSec) - start;
  emit(`Mixing background music (vol=${volume}, duck=${duckTo}, ${start.toFixed(1)}s–${(end ?? videoSec).toFixed(1)}s)...`);
  const chain = ["aloop=loop=-1:size=2e9", "asetpts=N/SR/TB", `atrim=0:${len.toFixed(3)}`];
  const fade = Math.min(1, len / 4);
  if (start > 0) chain.push(`afade=t=in:st=0:d=${fade.toFixed(3)}`);
  if (end != null) chain.push(`afade=t=out:st=${(len - fade).toFixed(3)}:d=${fade.toFixed(3)}`);
  if (start > 0) chain.push(`adelay=${Math.round(start * 1e3)}:all=1`);
  chain.push("apad", "asetpts=N/SR/TB", `volume=${volume}`);
  for (const seg of narrationTimestamps) {
    chain.push(`volume=enable='between(t,${seg.start.toFixed(3)},${seg.end.toFixed(3)})':volume=${duckTo / volume}`);
  }
  chain.push(`atrim=0:${videoSec.toFixed(3)}`);
  const music = `[1:a]aresample=44100,${chain.join(",")}`;
  const mix = index.hasAudioStream(videoPath) ? `${music}[music];[0:a][music]amix=inputs=2:duration=first:dropout_transition=0:normalize=0,alimiter=limit=0.95:level=0[aout]` : `${music}[aout]`;
  index.ffmpegSync([
    "-y",
    "-i",
    videoPath,
    "-i",
    musicPath,
    "-filter_complex",
    mix,
    "-map",
    "0:v",
    "-map",
    "[aout]",
    "-c:v",
    "copy",
    "-c:a",
    "aac",
    "-ar",
    "44100",
    "-ac",
    "2",
    "-b:a",
    "192k",
    outputPath
  ]);
}
const ASS_FONT_SCALE = 1.25;
const ARROW_DRAW_FPS = 30;
const ARROW_DIRS = {
  left: [-1, 0],
  right: [1, 0],
  above: [0, -1],
  below: [0, 1],
  "top-left": [-1, -1],
  "top-right": [1, -1],
  "bottom-left": [-1, 1],
  "bottom-right": [1, 1]
};
const ARROW_AUTO = ["bottom-left", "bottom-right", "top-left", "top-right", "left", "right", "below", "above"];
const ARROW_DEFAULT_COLOR = "#F97316";
function arrowGeometry(rect, res, from, scaleOverride) {
  const scale = scaleOverride ?? Math.max(0.6, Math.min(res.height, res.width * 0.625) / 900);
  const len = 150 * scale;
  const gap = 10 * scale;
  const margin = 16 * scale;
  const [x, y, w, h] = rect;
  if (w > res.width * 0.6 && h < res.height * 0.6) {
    const d2 = Math.SQRT1_2;
    const tip2 = [x + w * 0.66, y + h * 0.55];
    const pick = (f2) => {
      const [dx, dy] = ARROW_DIRS[f2];
      return [tip2[0] + dx * d2 * len, tip2[1] + dy * d2 * len];
    };
    const inFrame = (p) => p[0] >= margin && p[0] <= res.width - margin && p[1] >= margin && p[1] <= res.height - margin;
    const order = from ? [from] : ["bottom-right", "top-right", "bottom-left", "top-left"];
    const f = order.find((o) => inFrame(pick(o))) ?? order[0];
    const tail = pick(f);
    return { tip: tip2, tail: [Math.max(margin, Math.min(res.width - margin, tail[0])), Math.max(margin, Math.min(res.height - margin, tail[1]))], scale, from: f };
  }
  const cx = x + w / 2;
  const cy = y + h / 2;
  const place = (f) => {
    const [dx0, dy0] = ARROW_DIRS[f];
    const n = Math.hypot(dx0, dy0);
    const dx = dx0 / n;
    const dy = dy0 / n;
    const t = Math.min(dx ? w / 2 / Math.abs(dx) : Infinity, dy ? h / 2 / Math.abs(dy) : Infinity);
    const tip2 = [cx + dx * (t + gap), cy + dy * (t + gap)];
    const tail = [cx + dx * (t + gap + len), cy + dy * (t + gap + len)];
    const inside = (p) => p[0] >= margin && p[0] <= res.width - margin && p[1] >= margin && p[1] <= res.height - margin;
    return { tip: tip2, tail, fits: inside(tip2) && inside(tail), d: [dx, dy] };
  };
  for (const f of from ? [from] : ARROW_AUTO) {
    const g = place(f);
    if (g.fits || from) {
      const clamp = (p) => [
        Math.max(margin, Math.min(res.width - margin, p[0])),
        Math.max(margin, Math.min(res.height - margin, p[1]))
      ];
      return { tail: clamp(g.tail), tip: clamp(g.tip), scale, from: f };
    }
  }
  const tip = [cx, cy];
  const d = Math.SQRT1_2;
  return { tip, tail: [cx - d * len, cy + d * len].map((v, i) => Math.max(margin, Math.min((i ? res.height : res.width) - margin, v))), scale, from: "bottom-left" };
}
function arrowShape(g, frameCenter) {
  const [tx, ty] = g.tail;
  const [px, py] = g.tip;
  const len = Math.hypot(px - tx, py - ty);
  const ux = (px - tx) / len;
  const uy = (py - ty) / len;
  const bow = 0.16 * len;
  const mx = (tx + px) / 2;
  const my = (ty + py) / 2;
  const nx = uy;
  const ny = -ux;
  let side = (px - mx) * nx + (ty - my) * ny;
  if (Math.abs(side) < 0.2 * len) side = frameCenter ? (frameCenter[0] - mx) * nx + (frameCenter[1] - my) * ny : 1;
  const sgn = side < 0 ? -1 : 1;
  const c = [mx + nx * bow * sgn, my + ny * bow * sgn];
  const point = (t) => {
    const a = (1 - t) * (1 - t);
    const b = 2 * (1 - t) * t;
    const d = t * t;
    return [a * tx + b * c[0] + d * px, a * ty + b * c[1] + d * py];
  };
  const N = 96;
  const cum = [0];
  let prev = point(0);
  for (let i = 1; i <= N; i++) {
    const p = point(i / N);
    cum.push(cum[i - 1] + Math.hypot(p[0] - prev[0], p[1] - prev[1]));
    prev = p;
  }
  const total = cum[N];
  const tAt = (s) => {
    const target = Math.max(0, Math.min(total, s));
    let i = 1;
    while (i < N && cum[i] < target) i++;
    const f = (target - cum[i - 1]) / Math.max(1e-6, cum[i] - cum[i - 1]);
    return (i - 1 + f) / N;
  };
  const at = (s) => point(tAt(s));
  const thickness = 6 * g.scale;
  const fullHead = Math.min(24 * g.scale, total * 0.35);
  const stroke = (s) => Array.from({ length: 25 }, (_, i) => at(Math.max(1, s) * i / 24));
  const head = (s) => {
    const end = at(s);
    const back = at(s - 2);
    const dx = end[0] - back[0];
    const dy = end[1] - back[1];
    const dl = Math.hypot(dx, dy) || 1;
    const hx = dx / dl;
    const hy = dy / dl;
    const hl = fullHead * Math.min(1, s / (total * 0.35));
    const arm = (sign) => {
      const a = sign * 34 * Math.PI / 180;
      const rx = hx * Math.cos(a) - hy * Math.sin(a);
      const ry = hx * Math.sin(a) + hy * Math.cos(a);
      return [end[0] - rx * hl, end[1] - ry * hl];
    };
    return { arms: [arm(1), arm(-1)], tip: end };
  };
  return { point, length: total, at, stroke, head, thickness };
}
function capsule(pts, th) {
  const r = th / 2;
  const n = pts.length;
  const norm = (i) => {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(n - 1, i + 1)];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [-(b[1] - a[1]) / l, (b[0] - a[0]) / l];
  };
  const left = pts.map((p, i) => [p[0] + norm(i)[0] * r, p[1] + norm(i)[1] * r]);
  const right = pts.map((p, i) => [p[0] - norm(i)[0] * r, p[1] - norm(i)[1] * r]).reverse();
  const cap = (c, fromAngle) => Array.from({ length: 7 }, (_, k) => {
    const a = fromAngle - Math.PI * (k + 1) / 8;
    return [c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r];
  });
  const nEnd = norm(n - 1);
  const nStart = norm(0);
  return [...left, ...cap(pts[n - 1], Math.atan2(nEnd[1], nEnd[0])), ...right, ...cap(pts[0], Math.atan2(-nStart[1], -nStart[0]))];
}
function arrowLabelBox(g, shape, text, fontSize, res) {
  const [tx, ty] = g.tail;
  const vx = tx - shape.point(0.08)[0];
  const vy = ty - shape.point(0.08)[1];
  const vl = Math.hypot(vx, vy) || 1;
  const dx = vx / vl;
  const dy = vy / vl;
  const fs2 = fontSize * ASS_FONT_SCALE;
  const graphemes = [...new Intl.Segmenter(void 0, { granularity: "grapheme" }).segment(text)].length;
  const ph = fs2 * 1.25;
  const pw = graphemes * fs2 * 0.55 + ph * 0.9;
  const gap = 14 * g.scale;
  let cx = tx + dx * gap + (dx < -0.3 ? -pw / 2 : dx > 0.3 ? pw / 2 : 0);
  let cy = ty + dy * gap + (dy < -0.3 ? -ph / 2 : dy > 0.3 ? ph / 2 : 0);
  const edge = 10;
  cx = Math.max(edge + pw / 2, Math.min(res.width - edge - pw / 2, cx));
  cy = Math.max(edge + ph / 2, Math.min(res.height - edge - ph / 2, cy));
  return { cx, cy, pw, ph, fs: fs2 };
}
function roundedRect(x, y, w, h, r) {
  const out = [];
  const corner = (cx, cy, a0) => {
    for (let k = 0; k <= 6; k++) {
      const a = a0 + Math.PI / 2 * (k / 6);
      out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
  };
  corner(x + w - r, y + r, -Math.PI / 2);
  corner(x + w - r, y + h - r, 0);
  corner(x + r, y + h - r, Math.PI / 2);
  corner(x + r, y + r, Math.PI);
  return out;
}
function pencilLoop(rect, res, scale) {
  const [x, y, w, h] = rect;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const pad = 6 * scale;
  const grow = 7 * scale;
  const wob = 2.5 * scale;
  const margin = 6 * scale + grow + wob;
  const aspect = Math.max(w, h) / Math.max(1, Math.min(w, h));
  const n = 2 + Math.min(4, (aspect - 1) * 0.6);
  const k = Math.pow(2, 1 / n);
  const maxRx = Math.max(12 * scale, Math.min(cx - margin, res.width - cx - margin));
  const maxRy = Math.max(10 * scale, Math.min(cy - margin, res.height - cy - margin));
  let rx = Math.min(w / 2 * k + pad, maxRx);
  let ry = Math.min(h / 2 * k + pad, maxRy);
  const fit = (half, r) => Math.pow(Math.min(0.95, half / r), n);
  if (rx < w / 2 * k + pad) ry = Math.min(maxRy, h / 2 + 1.5 * pad, (h / 2 + pad) / Math.pow(1 - fit(w / 2, rx), 1 / n));
  else if (ry < h / 2 * k + pad) rx = Math.min(maxRx, w / 2 + 1.5 * pad, (w / 2 + pad) / Math.pow(1 - fit(h / 2, ry), 1 / n));
  const tilt = -Math.min(3 * Math.PI / 180, Math.atan(0.12 * ry / rx));
  const a0 = -160 * Math.PI / 180;
  const sweep = 2 * Math.PI + 0.45;
  const e = 2 / n;
  const N = 120;
  return Array.from({ length: N + 1 }, (_, i) => {
    const u = i / N;
    const a = a0 + sweep * u;
    const c = Math.cos(a);
    const sn = Math.sin(a);
    const off = grow * u + wob * Math.sin(3 * a + 1);
    const ex = Math.sign(c) * Math.pow(Math.abs(c), e) * rx + c * off * Math.max(0.3, Math.min(1, rx / ry));
    const ey = Math.sign(sn) * Math.pow(Math.abs(sn), e) * ry + sn * off * Math.max(0.3, Math.min(1, ry / rx));
    return [cx + ex * Math.cos(tilt) - ey * Math.sin(tilt), cy + ex * Math.sin(tilt) + ey * Math.cos(tilt)];
  });
}
function polySlice(pts, cum, s0, s1) {
  const at = (s) => {
    let i = 1;
    while (i < cum.length - 1 && cum[i] < s) i++;
    const f = (s - cum[i - 1]) / Math.max(1e-6, cum[i] - cum[i - 1]);
    return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * f, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * f];
  };
  const out = [at(s0)];
  for (let i = 1; i < pts.length - 1; i++) if (cum[i] > s0 && cum[i] < s1) out.push(pts[i]);
  out.push(at(s1));
  return out;
}
const easeOut = (u) => 1 - Math.pow(1 - u, 3);
const easeIn = (u) => u * u;
const easeInOut = (u) => u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
function arrowTiming(start, end) {
  const drawSec = Math.min(0.5, (end - start) / 3);
  const n = Math.max(1, Math.round(drawSec * ARROW_DRAW_FPS));
  const at = (k) => start + drawSec * k / n;
  const steps = [];
  for (let k = 0; k < n - 1; k++) steps.push({ t0: at(k), t1: at(k + 1), s0: 0, s1: easeOut((k + 1) / n) });
  steps.push({ t0: at(n - 1), t1: end, s0: 0, s1: 1 });
  return { steps, drawnAt: at(n - 1), highlightFrom: start + drawSec + 0.1 };
}
function highlightTiming(from, end) {
  const avail = end - from - 0.05;
  if (avail < 0.6) return [];
  const drawSec = Math.min(0.55, avail * 0.3);
  const eraseSec = Math.min(0.45, avail * 0.25);
  const holdSec = Math.max(0, Math.min(0.9, avail - drawSec - eraseSec));
  const nDraw = Math.max(1, Math.round(drawSec * ARROW_DRAW_FPS));
  const nErase = Math.max(1, Math.round(eraseSec * ARROW_DRAW_FPS));
  const drawAt = (k) => from + drawSec * k / nDraw;
  const steps = [];
  for (let k = 0; k < nDraw; k++) steps.push({ t0: drawAt(k), t1: drawAt(k + 1), s0: 0, s1: easeInOut((k + 1) / nDraw) });
  const eraseFrom = from + drawSec + holdSec;
  steps.push({ t0: drawAt(nDraw), t1: eraseFrom, s0: 0, s1: 1 });
  const eraseAt = (k) => eraseFrom + eraseSec * k / nErase;
  for (let k = 0; k < nErase - 1; k++) steps.push({ t0: eraseAt(k), t1: eraseAt(k + 1), s0: easeIn((k + 1) / nErase), s1: 1 });
  return steps;
}
function arrowStyle(scale) {
  return {
    loopThickness: 4 * scale,
    halo: 2.2 * scale,
    loopHalo: 1.6 * scale,
    labelHalo: 1.6 * scale,
    shadowOffset: 3 * scale,
    shadowBlur: 4 * scale,
    labelRise: Math.round(8 * scale)
  };
}
function arcLengths(pts) {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  return cum;
}
function loopPieces(pts, cum, s0, s1, thickness) {
  const total = cum[cum.length - 1];
  if (s1 - s0 < 1) return [];
  const pieces = Math.max(1, Math.ceil((s1 - s0) / (total / 4)));
  const step = (s1 - s0) / pieces;
  return Array.from({ length: pieces }, (_, k) => capsule(polySlice(pts, cum, s0 + k * step, s0 + (k + 1) * step), thickness));
}
const LANG_CODES = {
  en: "a",
  "en-gb": "b",
  hi: "h",
  es: "e",
  fr: "f",
  ja: "j",
  zh: "z",
  pt: "p",
  it: "i"
};
function findNarration(action) {
  if (action.customAudioPath && fs__namespace.existsSync(action.customAudioPath)) {
    return { text: "", lang: "custom", audioPath: action.customAudioPath };
  }
  if (action.audioPath) {
    for (const [lang, ap] of Object.entries(action.audioPath)) {
      if (ap && fs__namespace.existsSync(ap)) {
        const text = action.narrations?.[lang] || (lang === "en" ? action.narration : void 0) || (lang === "hi" ? action.narration_hi : void 0) || "";
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
function prepareNarrationAudio(action, audioOutputPath, project, emit, ts) {
  const narr = findNarration(action);
  if (!narr) return { hasAudio: false, audioDuration: 0 };
  if (narr.audioPath) {
    emit(`  Using pre-generated ${narr.lang} audio for action at ${ts.toFixed(1)}s`);
    fs__namespace.copyFileSync(narr.audioPath, audioOutputPath);
  } else {
    emit(`  Generating ${narr.lang} TTS for action at ${ts.toFixed(1)}s`);
    const tts = project.tts;
    const voice = tts?.voices?.[narr.lang]?.[0] || (narr.lang === "hi" ? tts?.voiceHi || "hf_alpha" : tts?.voiceEn || "af_heart");
    const speed = tts?.speed || 1;
    const langCode = LANG_CODES[narr.lang] || "a";
    narration.generateTTS(narr.text, voice, speed, langCode, audioOutputPath, tts?.kokoroEndpoint);
  }
  if (fs__namespace.existsSync(audioOutputPath) && fs__namespace.statSync(audioOutputPath).size > 100) {
    const dur = index.probeDuration(audioOutputPath);
    return { hasAudio: true, audioDuration: dur > 0 ? dur : 0 };
  }
  return { hasAudio: false, audioDuration: 0 };
}
function computeVersionLabel(videoDir) {
  const existing = fs__namespace.readdirSync(videoDir).filter((f) => f.match(/^final_v\d+\.mp4$/));
  const maxV = existing.reduce((max, f) => {
    const m = f.match(/^final_v(\d+)\.mp4$/);
    return m ? Math.max(max, parseInt(m[1])) : max;
  }, 0);
  return `v${maxV + 1}`;
}
function getOverlayTimeRange(action) {
  const start = action.timestamp;
  switch (action.type) {
    case "blur":
      return { start, end: start + (action.blurDuration ?? 3) };
    case "spotlight":
      return { start, end: start + (action.spotlightDuration ?? 3) };
    case "callout":
      return { start, end: start + (action.calloutDuration ?? 3) };
    default:
      return { start, end: start };
  }
}
function batchNonOverlapping(actions) {
  if (actions.length === 0) return [];
  const sorted = [...actions].sort((a, b) => a.timestamp - b.timestamp);
  const batches = [];
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
function blurGeometry(rect, radius, res) {
  const W = res.width - res.width % 2;
  const H = res.height - res.height % 2;
  const down = (v) => Math.floor(v / 2) * 2;
  const up = (v) => Math.ceil(v / 2) * 2;
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
  const maxR = (side) => Math.max(0, Math.floor((side - 1) / 2));
  return {
    crop: [cw, ch, cx0, cy0],
    inner: [x1 - x0, y1 - y0, x0 - cx0, y0 - cy0],
    at: [x0, y0],
    lumaR: Math.min(r, maxR(Math.min(cw, ch))),
    chromaR: Math.min(r, maxR(Math.min(cw, ch) / 2)),
    power: Math.max(2, Math.min(r, 20))
  };
}
function applyBlurBatch(inputPath, actions, outputPath, res, totalDuration, emit) {
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
      filterChain += `;[src${idx}]crop=${g.crop.join(":")},boxblur=luma_radius=${g.lumaR}:luma_power=${g.power}:chroma_radius=${g.chromaR}:chroma_power=${g.power},crop=${g.inner.join(":")}[blur${idx}]`;
      filterChain += `;[base${idx}][blur${idx}]overlay=${g.at[0]}:${g.at[1]}:enable='${enableExpr}'[out${idx}]`;
      lastLabel = `out${idx}`;
      idx++;
    }
  }
  if (!filterChain) {
    fs__namespace.copyFileSync(inputPath, outputPath);
    return;
  }
  const args = ["-y", "-i", inputPath, "-filter_complex_threads", index.FILTER_THREADS, "-filter_complex", filterChain];
  args.push("-map", `[${lastLabel}]`);
  if (index.hasAudioStream(inputPath)) {
    args.push("-map", "0:a", "-c:a", "copy");
  }
  args.push(...index.INTERMEDIATE_VIDEO);
  args.push(outputPath);
  index.ffmpegSync(args);
}
function spotlightGraph(actions, res, totalDuration, emit, inLabel, cmdFile) {
  const graph = [];
  const commands = [];
  let last = inLabel;
  const soft = [];
  actions.forEach((action, ai) => {
    const rects = action.spotlightRects ?? (action.spotlightRect ? [action.spotlightRect] : []);
    if (rects.length === 0) return;
    const alpha = (action.dimOpacity ?? 0.7).toFixed(2);
    const start = action.timestamp;
    const end = start + (action.spotlightDuration ?? 3);
    const win = `between(t,${start.toFixed(3)},${Math.min(end, totalDuration).toFixed(3)})`;
    emit(`    Spotlight at ${start.toFixed(1)}s-${end.toFixed(1)}s (${rects.length} region${rects.length > 1 ? "s" : ""})`);
    const feather = Math.max(0, Math.round(action.spotlightFeather ?? 0));
    const converge = Math.min(Math.max(0, action.spotlightConverge ?? 0), (end - start) / 2);
    if (feather > 0 || converge > 0) {
      const target = (r) => [r[0] - feather, r[1] - feather, r[2] + 2 * feather, r[3] + 2 * feather];
      const full = [-feather, -feather, res.width + 2 * feather, res.height + 2 * feather];
      const box = (b) => `x=${Math.round(b[0])}:y=${Math.round(b[1])}:w=${Math.round(b[2])}:h=${Math.round(b[3])}`;
      const boxes = rects.map((r, ri) => `drawbox@sp${ai}_${ri}=${box(converge > 0 ? full : target(r))}:color=white:t=fill:enable='${win}'`);
      if (converge > 0) {
        const steps = Math.max(1, Math.round(converge * 60));
        for (let k = 1; k <= steps; k++) {
          const e = 1 - Math.pow(1 - k / steps, 3);
          const at = start + converge * k / steps;
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
    graph.push(`[sfpass]${soft.map((x) => `drawbox=x=0:y=0:w=iw:h=ih:color=black@${x.alpha}:t=fill:enable='${x.win}'`).join(",")}[sfdim]`);
    const blurs = soft.filter((x) => x.feather > 0).map((x) => `gblur=sigma=${(x.feather / 2).toFixed(1)}:enable='${x.win}'`);
    const mask = [
      "format=gray",
      `drawbox=x=0:y=0:w=iw:h=ih:color=black:t=fill:enable='${any}'`,
      ...commands.length ? [`sendcmd=f=${cmdFile}`] : [],
      ...soft.flatMap((x) => x.boxes),
      `lut=y='if(gt(val,128),255,0)':enable='${any}'`,
      ...blurs
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
function assEscape(text) {
  return text.replace(/\\/g, "\\⁠").replace(/\{/g, "\\{").replace(/\}/g, "\\}").replace(/\r?\n/g, "\\N");
}
function assColor(rgb, opacity) {
  const hex = (n) => n.toString(16).toUpperCase().padStart(2, "0");
  const a = Math.round((1 - opacity) * 255);
  return `&H${hex(a)}${hex(rgb & 255)}${hex(rgb >> 8 & 255)}${hex(rgb >> 16 & 255)}`;
}
const PANEL_PAD$1 = { label: { x: 10, y: 6 }, step: { x: 12, y: 7 } };
const CALLOUT_STYLES = [
  { name: "CLabel", size: 28, box: assColor(0, 0.8), pad: 10, align: 7 },
  { name: "CStep", size: 28, box: assColor(2450411, 0.9), pad: 12, align: 7 },
  { name: "CLower", size: 36, box: assColor(0, 0.7), pad: 15, align: 8 },
  { name: "CPanel", size: 24, box: assColor(0, 0.7), pad: 10, align: 7 }
].map(
  (s) => `Style: ${s.name},Noto Sans,${Math.round(s.size * ASS_FONT_SCALE)},&H00FFFFFF,&H00FFFFFF,&HFF000000,${s.box},0,0,0,0,100,100,0,0,4,${s.pad},0,${s.align},0,0,0,1`
).concat(
  // Arrow shapes (vector drawings): fill set per event; white halo + soft shadow for contrast on any background.
  `Style: CArrow,Noto Sans,20,&H001673F9,&H00FFFFFF,&H00FFFFFF,&H80000000,0,0,0,0,100,100,0,0,1,2,0,7,0,0,0,1`
);
function assBgr(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex) ?? /^#?([0-9a-f]{6})$/i.exec(ARROW_DEFAULT_COLOR);
  const v = m[1].toUpperCase();
  return `&H${v.slice(4, 6)}${v.slice(2, 4)}${v.slice(0, 2)}&`;
}
function assPolygon(layer, start, end, pts, tags, dx = 0, dy = 0, fade = "\\fad(90,200)") {
  const minX = Math.min(...pts.map((p) => p[0]));
  const minY = Math.min(...pts.map((p) => p[1]));
  const rel = pts.map(([px, py]) => `${Math.round(px - minX)} ${Math.round(py - minY)}`);
  return `Dialogue: ${layer},${secToAssTs(start)},${secToAssTs(end)},CArrow,,0,0,0,,{\\an7\\pos(${Math.round(minX + dx)},${Math.round(minY + dy)})${tags}${fade}\\p1}m ${rel[0]} l ${rel.slice(1).join(" ")}{\\p0}`;
}
function highlightEvents(rect, res, scale, color, from, end) {
  const steps = highlightTiming(from, end);
  if (!steps.length) return [];
  const pts = pencilLoop(rect, res, scale);
  const cum = arcLengths(pts);
  const total = cum[cum.length - 1];
  const style = arrowStyle(scale);
  const halo = `\\1c&HFFFFFF&\\3c&HFFFFFF&\\bord${style.loopHalo.toFixed(1)}\\shad0`;
  const fill = `\\1c${color}\\bord0\\shad0`;
  const out = [];
  for (const st of steps) {
    const polys = loopPieces(pts, cum, total * st.s0, total * st.s1, style.loopThickness);
    for (const poly of polys) out.push(assPolygon(2, st.t0, st.t1, poly, halo, 0, 0, ""));
    for (const poly of polys) out.push(assPolygon(3, st.t0, st.t1, poly, fill, 0, 0, ""));
  }
  return out;
}
function arrowEvents(action, res, start, end) {
  const panel = action.calloutPanels?.[0];
  if (!panel) return [];
  const g = arrowGeometry(panel.rect, res, action.arrowFrom, action.arrowScale);
  if (Math.hypot(g.tip[0] - g.tail[0], g.tip[1] - g.tail[1]) < 4) return [];
  const hex = action.arrowColor ?? ARROW_DEFAULT_COLOR;
  const color = assBgr(hex);
  const shape = arrowShape(g, [res.width / 2, res.height / 2]);
  const th = shape.thickness;
  const style = arrowStyle(g.scale);
  const fill = `\\1c${color}\\bord0\\shad0`;
  const halo = `\\1c&HFFFFFF&\\3c&HFFFFFF&\\bord${style.halo.toFixed(1)}\\shad0`;
  const shadow = `\\1c&H000000&\\1a&HB0&\\3a&HFF&\\bord0\\shad0\\blur${style.shadowBlur.toFixed(1)}`;
  const sdy = style.shadowOffset;
  const out = [];
  const frame = (from, to, s, fade) => {
    const h = shape.head(s);
    const pieces = [capsule(shape.stroke(s), th), capsule([h.arms[0], h.tip], th), capsule([h.arms[1], h.tip], th)];
    for (const poly of pieces) out.push(assPolygon(1, from, to, poly, shadow, 0, sdy, fade));
    for (const poly of pieces) out.push(assPolygon(2, from, to, poly, halo, 0, 0, fade));
    for (const poly of pieces) out.push(assPolygon(3, from, to, poly, fill, 0, 0, fade));
  };
  const timing = arrowTiming(start, end);
  timing.steps.forEach((st, k) => frame(st.t0, st.t1, shape.length * st.s1, k === timing.steps.length - 1 ? "\\fad(0,200)" : ""));
  const drawnAt = timing.drawnAt;
  if (action.arrowHighlight) out.push(...highlightEvents(panel.rect, res, g.scale, action.arrowHighlightColor ? assBgr(action.arrowHighlightColor) : color, timing.highlightFrom, end));
  if (panel.text) {
    const { cx, cy, pw, ph, fs: fs2 } = arrowLabelBox(g, shape, panel.text, panel.fontSize || 24, res);
    const pill = roundedRect(cx - pw / 2, cy - ph / 2, pw, ph, ph / 2);
    const rise = style.labelRise;
    const fade = "\\fad(140,200)";
    out.push(assPolygon(4, drawnAt, end, pill, shadow, 0, sdy, fade));
    out.push(assPolygon(5, drawnAt, end, pill, `\\1c${color}\\3c&HFFFFFF&\\bord${style.labelHalo.toFixed(1)}\\shad0`, 0, 0, fade));
    out.push(
      `Dialogue: 6,${secToAssTs(drawnAt)},${secToAssTs(end)},CLabel,,0,0,0,,{\\an5\\move(${Math.round(cx)},${Math.round(cy + rise)},${Math.round(cx)},${Math.round(cy)},0,180)\\bord0\\shad0\\3a&HFF&\\4a&HFF&\\b1\\1c&HFFFFFF&\\fs${Math.round(fs2)}${fade}}${assEscape(panel.text)}`
    );
  }
  return out;
}
function calloutEvents(actions, res, totalDuration, emit) {
  const out = [];
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
    const prefix = (t) => style === "step-counter" && step ? `Step ${step}: ${t}` : t;
    const line = (st, x, y, text2, fs2, pad) => out.push(
      `Dialogue: 0,${secToAssTs(start)},${secToAssTs(end)},${st},,0,0,0,,{\\q2\\pos(${Math.round(x)},${Math.round(y)})${fs2 ? `\\fs${Math.round(fs2 * ASS_FONT_SCALE)}` : ""}${pad ? `\\xbord${pad.x}\\ybord${pad.y}` : ""}}${assEscape(text2)}`
    );
    const panels = action.calloutPanels;
    if (panels && panels.length > 0) {
      emit(`    Callout at ${start.toFixed(1)}s-${end.toFixed(1)}s (${panels.length} panel${panels.length > 1 ? "s" : ""})`);
      for (const panel of panels) {
        if (panel.text) {
          const step2 = style === "step-counter";
          line(step2 ? "CStep" : "CPanel", panel.rect[0], panel.rect[1], prefix(panel.text), panel.fontSize || 24, step2 ? PANEL_PAD$1.step : PANEL_PAD$1.label);
        }
      }
      continue;
    }
    const text = action.calloutText;
    if (!text) continue;
    emit(`    Callout at ${start.toFixed(1)}s-${end.toFixed(1)}s: "${text.slice(0, 30)}..."`);
    const position = action.calloutPosition;
    if (style === "lower-third") line("CLower", res.width / 2, res.height - 80, text);
    else line(style === "step-counter" ? "CStep" : "CLabel", position ? position[0] : 100, position ? position[1] : 100, prefix(text));
  }
  return out;
}
function getSkipRanges(actions) {
  return actions.filter((a) => a.type === "skip" && a.skipEndTimestamp).map((a) => ({ start: a.timestamp, end: a.skipEndTimestamp })).sort((a, b) => a.start - b.start);
}
function applySkipPass(inputPath, skipRanges, outputPath, tempDir, emit) {
  const totalDuration = index.probeDuration(inputPath);
  emit(`
[Pass: Skip] Removing ${skipRanges.length} section(s)...`);
  const segments = [];
  let cursor = 0;
  let segIdx = 0;
  for (const range of skipRanges) {
    if (cursor < range.start - 0.05) {
      emit(`  Keep ${cursor.toFixed(1)}s-${range.start.toFixed(1)}s`);
      const clipPath = path__namespace.join(tempDir, `keep_${String(segIdx).padStart(3, "0")}.mp4`);
      index.cutClip(inputPath, cursor, range.start, clipPath);
      if (fs__namespace.existsSync(clipPath) && fs__namespace.statSync(clipPath).size > 0) {
        segments.push(clipPath);
        segIdx++;
      }
    }
    emit(`  Skip ${range.start.toFixed(1)}s-${range.end.toFixed(1)}s`);
    cursor = range.end;
  }
  if (cursor < totalDuration - 0.05) {
    const clipPath = path__namespace.join(tempDir, `keep_${String(segIdx).padStart(3, "0")}.mp4`);
    index.cutClip(inputPath, cursor, totalDuration, clipPath);
    if (fs__namespace.existsSync(clipPath) && fs__namespace.statSync(clipPath).size > 0) {
      segments.push(clipPath);
    }
  }
  if (segments.length === 0) {
    fs__namespace.copyFileSync(inputPath, outputPath);
    return;
  }
  emit(`  Normalizing ${segments.length} segments...`);
  const normalized = segments.map((seg) => index.normalizeSegmentAudio(seg, seg.replace(".mp4", "_norm.mp4")));
  const concatList = path__namespace.join(tempDir, "skip_concat.txt");
  index.concatSegments(normalized, outputPath, concatList);
}
function getSpeedRanges(actions) {
  return actions.filter((a) => a.type === "speed" && a.speedEndTimestamp && a.speedFactor).map((a) => ({ start: a.timestamp, end: a.speedEndTimestamp, factor: a.speedFactor })).sort((a, b) => a.start - b.start);
}
function applySpeedPass(inputPath, speedRanges, outputPath, tempDir, emit) {
  const totalDuration = index.probeDuration(inputPath);
  emit(`
[Pass: Speed] Applying ${speedRanges.length} speed ramp(s)...`);
  const segments = [];
  let cursor = 0;
  let segIdx = 0;
  for (const range of speedRanges) {
    if (cursor < range.start - 0.05) {
      const clipPath2 = path__namespace.join(tempDir, `spd_${String(segIdx).padStart(3, "0")}.mp4`);
      index.cutClip(inputPath, cursor, range.start, clipPath2);
      if (fs__namespace.existsSync(clipPath2) && fs__namespace.statSync(clipPath2).size > 0) {
        segments.push(clipPath2);
        segIdx++;
      }
    }
    emit(`  Speed ${range.factor}x: ${range.start.toFixed(1)}s-${range.end.toFixed(1)}s`);
    const clipPath = path__namespace.join(tempDir, `spd_${String(segIdx).padStart(3, "0")}.mp4`);
    cutSpeedClip(inputPath, range.start, range.end, range.factor, clipPath);
    if (fs__namespace.existsSync(clipPath) && fs__namespace.statSync(clipPath).size > 0) {
      segments.push(clipPath);
      segIdx++;
    }
    cursor = range.end;
  }
  if (cursor < totalDuration - 0.05) {
    const clipPath = path__namespace.join(tempDir, `spd_${String(segIdx).padStart(3, "0")}.mp4`);
    index.cutClip(inputPath, cursor, totalDuration, clipPath);
    if (fs__namespace.existsSync(clipPath) && fs__namespace.statSync(clipPath).size > 0) {
      segments.push(clipPath);
    }
  }
  if (segments.length === 0) {
    fs__namespace.copyFileSync(inputPath, outputPath);
    return;
  }
  emit(`  Normalizing ${segments.length} segments...`);
  const normalized = segments.map((seg) => index.normalizeSegmentAudio(seg, seg.replace(".mp4", "_norm.mp4")));
  const concatList = path__namespace.join(tempDir, "speed_concat.txt");
  index.concatSegments(normalized, outputPath, concatList);
}
function buildSkipRemap(skipRanges) {
  return (ts) => {
    let offset = 0;
    for (const range of skipRanges) {
      if (range.end <= ts) {
        offset += range.end - range.start;
      } else if (range.start < ts) {
        return range.start - offset;
      }
    }
    return ts - offset;
  };
}
function buildSpeedRemap(speedRanges) {
  return (ts) => {
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
function remapRanges$1(ranges, remap) {
  return ranges.map((r) => ({ ...r, start: remap(r.start), end: remap(r.end) })).filter((r) => r.end > r.start + 0.05);
}
function applyMutePass(inputPath, muteRanges, outputPath, emit) {
  emit(`
[Pass: Mute] Applying ${muteRanges.length} mute range(s)...`);
  const filters = [];
  for (const range of muteRanges) {
    emit(`  Mute ${range.start.toFixed(1)}s-${range.end.toFixed(1)}s`);
    filters.push(`volume=enable='between(t,${range.start.toFixed(3)},${range.end.toFixed(3)})':volume=0`);
  }
  if (filters.length === 0 || !index.hasAudioStream(inputPath)) {
    fs__namespace.copyFileSync(inputPath, outputPath);
    return;
  }
  index.ffmpegSync([
    "-y",
    "-i",
    inputPath,
    "-af",
    filters.join(","),
    "-c:v",
    "copy",
    "-c:a",
    "aac",
    "-ar",
    "44100",
    "-ac",
    "2",
    "-b:a",
    "192k",
    outputPath
  ]);
}
function secToAssTs(sec2) {
  const h = Math.floor(sec2 / 3600);
  const m = Math.floor(sec2 % 3600 / 60);
  const s = Math.floor(sec2 % 60);
  const cs = Math.round((sec2 - Math.floor(sec2)) * 100);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}
const SUBTITLE_MARGIN_V = 50;
function subtitleDialogues(text, duration, offset, style) {
  const sentences = text.match(/[^.!?\n]+[.!?\n]*/g) || [text];
  const entries = [];
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
  const dialogues = [];
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
function subtitleStyle(name, size, marginV) {
  const pad = Math.round(size * 0.3);
  const spacing = (size * 0.02).toFixed(1);
  return `Style: ${name},Noto Sans,${size},&H00FFFFFF,&H0000FFFF,&HFF000000,&H59000000,0,0,0,0,100,100,${spacing},0,4,${pad},0,2,20,20,${marginV + pad},1`;
}
function writeSubtitleFile(cues, outputPath, res, callouts = []) {
  const styleOf = (c) => `S${c.size}_${c.marginV ?? SUBTITLE_MARGIN_V}`;
  const styles = [...new Map(cues.map((c) => [styleOf(c), c])).values()].map((c) => subtitleStyle(styleOf(c), c.size, c.marginV ?? SUBTITLE_MARGIN_V));
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
  fs__namespace.writeFileSync(outputPath, assContent, "utf-8");
}
function buildSingleZoom(zoomRect, framePath, tempDir, segIdx, zoomIdx, res, zoomDuration, holdDuration, narration2, emit, subtitleSize, cues) {
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
  const paths = [];
  const zoomInPath = path__namespace.join(tempDir, `zoomin_${tag}.mp4`);
  const zpIn = [
    `zoompan=z='1+(${maxZ.toFixed(4)}-1)*${ssForward}'`,
    `x='${xExpr}'`,
    `y='${yExpr}'`,
    `d=${inFrames}`,
    `s=${outW}x${outH}`,
    `fps=30`
  ].join(":");
  index.ffmpegSync(["-y", "-i", framePath, "-vf", zpIn, ...index.INTERMEDIATE_VIDEO, zoomInPath]);
  paths.push(zoomInPath);
  const holdPath = path__namespace.join(tempDir, `zoomhold_${tag}.mp4`);
  const zpHold = [`zoompan=z='${maxZ.toFixed(4)}'`, `x='${xExpr}'`, `y='${yExpr}'`, `d=${holdFrames}`, `s=${outW}x${outH}`, `fps=30`].join(":");
  const holdArgs = ["-y", "-i", framePath];
  if (narration2) holdArgs.push("-i", narration2.audioPath);
  holdArgs.push("-vf", zpHold, ...index.INTERMEDIATE_VIDEO);
  if (narration2) holdArgs.push("-c:a", "aac", "-b:a", "192k", "-shortest");
  holdArgs.push(holdPath);
  index.ffmpegSync(holdArgs);
  paths.push(holdPath);
  if (narration2?.text && subtitleSize && cues) {
    cues.set(holdPath, { text: narration2.text, duration: narration2.audioDuration, size: subtitleSize });
  }
  const zoomOutPath = path__namespace.join(tempDir, `zoomout_${tag}.mp4`);
  const zpOut = [`zoompan=z='1+(${maxZ.toFixed(4)}-1)*${ssReverse}'`, `x='${xExpr}'`, `y='${yExpr}'`, `d=${inFrames}`, `s=${outW}x${outH}`, `fps=30`].join(":");
  index.ffmpegSync(["-y", "-i", framePath, "-vf", zpOut, ...index.INTERMEDIATE_VIDEO, zoomOutPath]);
  paths.push(zoomOutPath);
  return paths;
}
function findZoomTargetNarration(target) {
  if (target.customAudioPath && fs__namespace.existsSync(target.customAudioPath)) {
    return { text: "", lang: "custom", audioPath: target.customAudioPath };
  }
  if (target.audioPath) {
    for (const [lang, ap] of Object.entries(target.audioPath)) {
      if (ap && fs__namespace.existsSync(ap)) {
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
function prepareZoomTargetAudio(target, audioOutputPath, project, emit, label) {
  const narr = findZoomTargetNarration(target);
  if (!narr) return void 0;
  if (narr.audioPath) {
    emit(`    Using pre-generated ${narr.lang} audio for ${label}`);
    fs__namespace.copyFileSync(narr.audioPath, audioOutputPath);
  } else {
    emit(`    Generating ${narr.lang} TTS for ${label}`);
    const tts = project.tts;
    const voice = tts?.voices?.[narr.lang]?.[0] || (narr.lang === "hi" ? tts?.voiceHi || "hf_alpha" : tts?.voiceEn || "af_heart");
    const speed = tts?.speed || 1;
    const langCode = LANG_CODES[narr.lang] || "a";
    narration.generateTTS(narr.text, voice, speed, langCode, audioOutputPath, tts?.kokoroEndpoint);
  }
  if (fs__namespace.existsSync(audioOutputPath) && fs__namespace.statSync(audioOutputPath).size > 100) {
    const dur = index.probeDuration(audioOutputPath);
    if (dur > 0) return { audioPath: audioOutputPath, audioDuration: dur, text: narr.text, lang: narr.lang };
  }
  return void 0;
}
function buildZoomInsert(action, videoPath, tempDir, segIdx, res, narration2, project, emit, frameTs, cues) {
  let targets;
  if (action.zoomTargets?.length) {
    targets = action.zoomTargets;
  } else if (action.zoomRects?.length) {
    targets = action.zoomRects.map((r) => ({ rect: r }));
  } else if (action.zoomRect) {
    targets = [{ rect: action.zoomRect }];
  } else {
    return [];
  }
  const zoomDuration = action.zoomDuration ?? 1;
  const holdDuration = action.zoomHold ?? 2;
  const framePath = path__namespace.join(tempDir, `frame_${String(segIdx).padStart(3, "0")}.png`);
  index.extractFrame(videoPath, frameTs, framePath);
  emit(`  Zoom at ${frameTs.toFixed(1)}s (${targets.length} target${targets.length > 1 ? "s" : ""})`);
  const allPaths = [];
  for (let i = 0; i < targets.length; i++) {
    const target = targets[i];
    let narrForThis;
    const hasTargetNarration = findZoomTargetNarration(target) !== null;
    if (hasTargetNarration) {
      const audioPath = path__namespace.join(tempDir, `zoomnarr_${String(segIdx).padStart(3, "0")}_z${i}.wav`);
      narrForThis = prepareZoomTargetAudio(target, audioPath, project, emit, `zoom target ${i + 1}`);
    } else if (i === 0 && narration2) {
      narrForThis = narration2;
    }
    const thisHold = narrForThis ? narrForThis.audioDuration + 0.5 : holdDuration;
    emit(`    Target ${i + 1}: ${target.rect[2]}x${target.rect[3]} hold=${thisHold.toFixed(1)}s${narrForThis ? " (with narration)" : ""}`);
    const paths = buildSingleZoom(
      target.rect,
      framePath,
      tempDir,
      segIdx,
      i,
      res,
      zoomDuration,
      thisHold,
      narrForThis,
      emit,
      action.showSubtitles !== false ? action.subtitleSize ?? 28 : null,
      cues
    );
    allPaths.push(...paths);
  }
  return allPaths;
}
function buildPauseInsert(action, videoPath, tempDir, segIdx, res, narration2, emit, frameTs) {
  const framePath = path__namespace.join(tempDir, `frame_${String(segIdx).padStart(3, "0")}.png`);
  index.extractFrame(videoPath, frameTs, framePath);
  let duration = 3;
  if (narration2 && narration2.audioDuration > 0) duration = narration2.audioDuration + 0.5;
  if (typeof action.resumeAfter === "number") duration = action.resumeAfter;
  emit(`  Pause at ${frameTs.toFixed(1)}s (${duration.toFixed(1)}s)`);
  const { width, height } = res;
  const vf = `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`;
  const freezePath = path__namespace.join(tempDir, `freeze_${String(segIdx).padStart(3, "0")}.mp4`);
  const args = ["-y", "-loop", "1", "-framerate", "30", "-i", framePath];
  if (narration2) args.push("-i", narration2.audioPath);
  args.push("-t", duration.toFixed(3), "-r", "30", "-vf", vf);
  args.push(...index.INTERMEDIATE_VIDEO);
  if (narration2) args.push("-c:a", "aac", "-b:a", "192k", "-shortest");
  args.push(freezePath);
  index.ffmpegSync(args);
  return [freezePath];
}
function buildNarrateInsert(action, videoPath, tempDir, segIdx, res, totalDuration, narration2, emit, frameTs) {
  if (action.freeze === true || action.type === "pause") {
    return buildPauseInsert(action, videoPath, tempDir, segIdx, res, narration2, emit, frameTs);
  }
  const duration = narrateInsertSeconds(action, narration2);
  const avail = Math.max(0, Math.min(duration, totalDuration - frameTs));
  const hold = duration - avail;
  emit(`  Narrate at ${frameTs.toFixed(1)}s (${duration.toFixed(1)}s over the video${hold > 0.01 ? `, last frame held ${hold.toFixed(1)}s` : ""})`);
  const playPath = path__namespace.join(tempDir, `play_${String(segIdx).padStart(3, "0")}.mp4`);
  const clipHasAudio = index.hasAudioStream(videoPath);
  const args = ["-y", "-ss", index.ffTime(frameTs), "-t", avail.toFixed(4), "-i", videoPath];
  const graph = [`[0:v]tpad=stop_mode=clone:stop_duration=${(hold + 1).toFixed(3)}[v]`];
  let audio = false;
  if (narration2) {
    args.push("-i", narration2.audioPath);
    if (clipHasAudio) {
      emit(`    Mixing narration with original audio (ducking original to 20%)`);
      graph.push("[0:a]volume=0.2,apad[bg];[1:a]apad[narr];[bg][narr]amix=inputs=2:duration=longest:dropout_transition=0:normalize=0,alimiter=limit=0.95:level=0[aout]");
    } else {
      graph.push("[1:a]apad[aout]");
    }
    audio = true;
  } else if (clipHasAudio) {
    graph.push("[0:a]apad[aout]");
    audio = true;
  }
  args.push("-filter_complex", graph.join(";"), "-map", "[v]");
  if (audio) args.push("-map", "[aout]", "-c:a", "aac", "-ar", "44100", "-ac", "2", "-b:a", "192k");
  args.push("-t", duration.toFixed(3), ...index.INTERMEDIATE_VIDEO, playPath);
  index.ffmpegSync(args);
  if (!fs__namespace.existsSync(playPath) || fs__namespace.statSync(playPath).size === 0) {
    emit(`  Warning: narration clip at ${frameTs.toFixed(1)}s produced no output, skipping`);
    return [];
  }
  return [playPath];
}
function narrateInsertSeconds(action, narration2) {
  if (typeof action.resumeAfter === "number") return action.resumeAfter;
  return narration2 && narration2.audioDuration > 0 ? narration2.audioDuration + 0.5 : 3;
}
function executeInsertPass(inputPath, insertActions, narrations, outputPath, tempDir, res, project, emit, remapTs) {
  const totalDuration = index.probeDuration(inputPath);
  const cueOf = /* @__PURE__ */ new Map();
  const sorted = insertActions.map((a) => ({ action: a, mappedTs: remapTs(a.timestamp) })).filter((a) => a.mappedTs >= 0 && a.mappedTs < totalDuration).sort((a, b) => a.mappedTs - b.mappedTs);
  emit(`
[Pass: Inserts] Processing ${sorted.length} insert(s)...`);
  const segments = [];
  const narrationTimestamps = [];
  const insertExpansions = [];
  let cursor = 0;
  let segIdx = 0;
  let runningDuration = 0;
  for (const { action, mappedTs: stamped } of sorted) {
    const mappedTs = stamped < cursor + 0.05 ? cursor : stamped;
    if (stamped < cursor - 0.05) emit(`  ${action.type} at ${stamped.toFixed(1)}s waits for the narration playing until ${cursor.toFixed(1)}s`);
    if (mappedTs > cursor) {
      const clipPath = path__namespace.join(tempDir, `ins_clip_${String(segIdx).padStart(3, "0")}.mp4`);
      index.cutClip(inputPath, cursor, mappedTs, clipPath);
      if (fs__namespace.existsSync(clipPath) && fs__namespace.statSync(clipPath).size > 0) {
        runningDuration += index.segmentDuration(clipPath);
        segments.push(clipPath);
        segIdx++;
      }
    }
    const narration2 = narrations.get(action);
    let insertPaths;
    if (action.type === "zoom" && (action.zoomRect || action.zoomRects?.length || action.zoomTargets?.length)) {
      insertPaths = buildZoomInsert(action, inputPath, tempDir, segIdx, res, narration2, project, emit, mappedTs, cueOf);
    } else if (action.type === "pause" || action.freeze === true) {
      insertPaths = buildPauseInsert(action, inputPath, tempDir, segIdx, res, narration2, emit, mappedTs);
    } else {
      insertPaths = buildNarrateInsert(action, inputPath, tempDir, segIdx, res, totalDuration, narration2, emit, mappedTs);
    }
    if (narration2?.text && action.showSubtitles !== false && insertPaths.length > 0 && action.type !== "zoom") {
      cueOf.set(insertPaths[insertPaths.length - 1], { text: narration2.text, duration: narration2.audioDuration, size: action.subtitleSize ?? 28 });
    }
    const totalEffectDur = insertPaths.reduce((s, p) => s + index.segmentDuration(p), 0);
    if (narration2) {
      narrationTimestamps.push({ start: runningDuration, end: runningDuration + totalEffectDur });
    }
    for (const p of insertPaths) {
      runningDuration += index.segmentDuration(p);
      segments.push(p);
      segIdx++;
    }
    if (action.type === "zoom" || action.type === "pause" || action.freeze === true) {
      insertExpansions.push({ at: mappedTs, added: totalEffectDur });
      cursor = mappedTs;
    } else if (insertPaths.length) {
      const consumed = Math.max(0, Math.min(narrateInsertSeconds(action, narration2), totalDuration - mappedTs));
      insertExpansions.push({ at: mappedTs, added: totalEffectDur - consumed });
      cursor = mappedTs + consumed;
    } else {
      cursor = mappedTs;
    }
  }
  if (cursor < totalDuration - 0.05) {
    const clipPath = path__namespace.join(tempDir, `ins_clip_${String(segIdx).padStart(3, "0")}.mp4`);
    index.cutClip(inputPath, cursor, totalDuration, clipPath);
    if (fs__namespace.existsSync(clipPath) && fs__namespace.statSync(clipPath).size > 0) {
      segments.push(clipPath);
    }
  }
  if (segments.length === 0) {
    fs__namespace.copyFileSync(inputPath, outputPath);
    return { narrationTimestamps, insertExpansions, subtitleCues: [] };
  }
  emit(`  Normalizing ${segments.length} segments...`);
  const normalized = segments.map((seg, i) => {
    if (i % 10 === 0) emit(`  Normalizing ${i + 1}/${segments.length}...`);
    return index.normalizeSegmentAudio(seg, seg.replace(".mp4", "_norm.mp4"));
  });
  emit("  Concatenating...");
  const concatList = path__namespace.join(tempDir, "insert_concat.txt");
  index.concatSegments(normalized, outputPath, concatList);
  const subtitleCues = [];
  let at = 0;
  segments.forEach((seg, i) => {
    const cue = cueOf.get(seg);
    if (cue) subtitleCues.push({ ...cue, start: at });
    at += index.segmentDuration(normalized[i]);
  });
  return { narrationTimestamps, insertExpansions, subtitleCues };
}
function buildInsertRemap(expansions) {
  const sorted = [...expansions].sort((a, b) => a.at - b.at);
  return (ts) => {
    let shift = 0;
    for (const e of sorted) {
      if (e.at < ts) shift += e.added;
    }
    return ts + shift;
  };
}
async function produceTimelineVideo(sessionDir, emit, version, selectedActionIds, resolution, crf, trim, opts = {}) {
  const project = JSON.parse(fs__namespace.readFileSync(opts.projectFile ?? path__namespace.join(sessionDir, "demo-project.json"), "utf-8"));
  const recordingPath = project.recordingPath;
  let allActions = project.actions || [];
  const videoDir = path__namespace.join(sessionDir, "video");
  const tempDir = path__namespace.join(videoDir, version ? `temp-${version}` : "temp");
  fs__namespace.mkdirSync(videoDir, { recursive: true });
  fs__namespace.mkdirSync(tempDir, { recursive: true });
  const totalDuration = index.probeDuration(recordingPath);
  const nativeRes = index.probeResolution(recordingPath);
  const res = nativeRes;
  emit(`Recording: ${nativeRes.width}x${nativeRes.height}, ${totalDuration.toFixed(1)}s`);
  if (crf) emit(`Output quality CRF: ${crf}`);
  let effectiveRecording = recordingPath;
  const blurActions = allActions.filter((a) => a.type === "blur" && a.blurRects && a.blurRects.length > 0);
  const spotlightActions = allActions.filter((a) => a.type === "spotlight" && (a.spotlightRect || a.spotlightRects && a.spotlightRects.length > 0));
  const calloutActions = allActions.filter((a) => a.type === "callout" && (a.calloutText || a.calloutPanels && a.calloutPanels.length > 0));
  const zoomActions = allActions.filter((a) => a.type === "zoom" && (a.zoomRect || a.zoomRects && a.zoomRects.length > 0 || a.zoomTargets && a.zoomTargets.length > 0));
  const pauseActions = allActions.filter((a) => a.type === "pause");
  const narrateActions = allActions.filter((a) => a.type === "narrate");
  const speedActions = allActions.filter((a) => a.type === "speed" && a.speedEndTimestamp && a.speedFactor);
  const skipActions = allActions.filter((a) => a.type === "skip" && a.skipEndTimestamp);
  const muteActions = allActions.filter((a) => a.type === "mute" && a.muteEndTimestamp);
  const musicAction = allActions.find((a) => a.type === "music" && a.musicPath);
  let currentInput = effectiveRecording;
  let passIdx = 0;
  const nextOutput = () => {
    passIdx++;
    return path__namespace.join(tempDir, `pass_${passIdx}.mp4`);
  };
  index.probeDuration(effectiveRecording);
  const timings = {};
  const timed = (name, fn) => {
    const t0 = Date.now();
    try {
      return fn();
    } finally {
      const sec2 = (Date.now() - t0) / 1e3;
      timings[name] = Math.round(((timings[name] ?? 0) + sec2) * 10) / 10;
      emit(`  (${name} took ${sec2.toFixed(1)}s)`);
    }
  };
  const fps = index.probeFrameRate(effectiveRecording);
  const onFrame = (t) => Math.ceil(t * fps - 1e-6) / fps;
  const skipRanges = getSkipRanges(skipActions).map((r) => ({ start: onFrame(r.start), end: onFrame(r.end) })).filter((r) => r.end > r.start);
  const skipRemap2 = buildSkipRemap(skipRanges);
  if (skipRanges.length > 0) {
    const out = nextOutput();
    timed("skip", () => applySkipPass(currentInput, skipRanges, out, tempDir, emit));
    if (fs__namespace.existsSync(out) && fs__namespace.statSync(out).size > 0) {
      currentInput = out;
    } else {
      emit("  Warning: Skip pass produced no output, skipping");
    }
  }
  const rawSpeedRanges = getSpeedRanges(speedActions);
  const postSkipSpeedRanges = remapRanges$1(rawSpeedRanges, skipRemap2);
  const speedRemap2 = buildSpeedRemap(postSkipSpeedRanges);
  if (postSkipSpeedRanges.length > 0) {
    const out = nextOutput();
    timed("speed", () => applySpeedPass(currentInput, postSkipSpeedRanges, out, tempDir, emit));
    if (fs__namespace.existsSync(out) && fs__namespace.statSync(out).size > 0) {
      currentInput = out;
    } else {
      emit("  Warning: Speed pass produced no output, skipping");
    }
  }
  const remapTs = (ts) => speedRemap2(skipRemap2(ts));
  if (muteActions.length > 0) {
    const rawMuteRanges = muteActions.filter((a) => a.muteEndTimestamp).map((a) => ({ start: a.timestamp, end: a.muteEndTimestamp })).sort((a, b) => a.start - b.start);
    const remappedMuteRanges = remapRanges$1(rawMuteRanges, remapTs);
    if (remappedMuteRanges.length > 0) {
      const out = nextOutput();
      timed("mute", () => applyMutePass(currentInput, remappedMuteRanges, out, emit));
      if (fs__namespace.existsSync(out) && fs__namespace.statSync(out).size > 0) {
        currentInput = out;
      }
    }
  }
  const preInsertBlur = blurActions.map((a) => {
    const start = remapTs(a.timestamp);
    const end = remapTs(a.timestamp + (a.blurDuration ?? 3));
    return { ...a, timestamp: start, blurDuration: end - start };
  }).filter((a) => a.timestamp >= 0 && (a.blurDuration ?? 0) > 0.05);
  if (preInsertBlur.length > 0) {
    const batches = batchNonOverlapping(preInsertBlur);
    const blurInputDuration = index.probeDuration(currentInput);
    emit(`
[Pass: Blur] ${preInsertBlur.length} action(s) → ${batches.length} pass(es)`);
    for (let bi = 0; bi < batches.length; bi++) {
      const out = nextOutput();
      emit(`  Pass ${bi + 1}/${batches.length} (${batches[bi].length} blur${batches[bi].length > 1 ? "s" : ""}):`);
      timed("blur", () => applyBlurBatch(currentInput, batches[bi], out, nativeRes, blurInputDuration, emit));
      if (fs__namespace.existsSync(out) && fs__namespace.statSync(out).size > 0) {
        currentInput = out;
      } else {
        emit(`    Warning: blur batch pass produced no output, skipping`);
      }
    }
  }
  const insertActions = [...zoomActions, ...pauseActions, ...narrateActions];
  let narrationTimestamps = [];
  let insertRemap = (ts) => ts;
  let subtitleCues = [];
  if (insertActions.length > 0) {
    const narrations = /* @__PURE__ */ new Map();
    for (let i = 0; i < insertActions.length; i++) {
      const action = insertActions[i];
      const narr = findNarration(action);
      if (!narr) continue;
      const audioPath = path__namespace.join(tempDir, `narr_${String(i).padStart(3, "0")}.wav`);
      const { hasAudio, audioDuration } = prepareNarrationAudio(action, audioPath, project, emit, action.timestamp);
      if (hasAudio) {
        narrations.set(action, { audioPath, audioDuration, text: narr.text || "", lang: narr.lang || "en" });
      }
    }
    const out = nextOutput();
    const result = timed("inserts", () => executeInsertPass(
      currentInput,
      insertActions,
      narrations,
      out,
      tempDir,
      res,
      project,
      emit,
      remapTs
    ));
    narrationTimestamps = result.narrationTimestamps;
    insertRemap = buildInsertRemap(result.insertExpansions);
    subtitleCues = result.subtitleCues;
    if (fs__namespace.existsSync(out) && fs__namespace.statSync(out).size > 0) {
      currentInput = out;
    } else {
      emit("  Warning: Insert pass produced no output, skipping");
    }
  }
  if (musicAction) {
    emit(`
[Pass: Music] Mixing background music...`);
    const out = nextOutput();
    const finalAt = (ts) => insertRemap(remapTs(ts));
    const window = {
      start: Math.max(0, finalAt(musicAction.timestamp ?? 0)),
      end: musicAction.musicEndTimestamp != null ? finalAt(musicAction.musicEndTimestamp) : void 0
    };
    timed("music", () => mixBackgroundMusic(currentInput, musicAction, narrationTimestamps, out, emit, window));
    if (fs__namespace.existsSync(out) && fs__namespace.statSync(out).size > 0) currentInput = out;
    else emit("  Warning: music pass produced no output, skipping");
  }
  const overlayRemap = (ts) => insertRemap(remapTs(ts));
  const remapOverlayActions = (actions) => actions.map((a) => ({ ...a, timestamp: overlayRemap(a.timestamp) })).filter((a) => a.timestamp >= 0);
  const remappedSpotlights = remapOverlayActions(spotlightActions);
  const remappedCallouts = remapOverlayActions(calloutActions);
  if (remappedSpotlights.length > 1) {
    const sorted = [...remappedSpotlights].sort((a, b) => a.timestamp - b.timestamp);
    for (let i = 0; i < sorted.length - 1; i++) {
      const endI = sorted[i].timestamp + (sorted[i].spotlightDuration ?? 3);
      const startNext = sorted[i + 1].timestamp;
      if (startNext < endI) {
        throw new Error(
          `Overlapping spotlights: one at ${sorted[i].timestamp.toFixed(1)}s-${endI.toFixed(1)}s overlaps with another at ${startNext.toFixed(1)}s. Use multiple regions on a single spotlight action instead (click "Add Another Region" in the spotlight editor).`
        );
      }
    }
  }
  const finalDuration = index.probeDuration(currentInput);
  const graph = [];
  let vLabel = "0:v";
  const cmdFile = "spotlight.cmd";
  if (remappedSpotlights.length > 0) {
    emit(`
[Overlay: spotlight] ${remappedSpotlights.length} action(s)`);
    const sp = spotlightGraph(remappedSpotlights, res, finalDuration, emit, vLabel, cmdFile);
    if (sp.commands.length) fs__namespace.writeFileSync(path__namespace.join(tempDir, cmdFile), sp.commands.join("\n") + "\n");
    graph.push(...sp.graph);
    vLabel = sp.out;
  }
  const calloutLines = remappedCallouts.length ? (emit(`
[Overlay: callout] ${remappedCallouts.length} action(s)`), calloutEvents(remappedCallouts, res, finalDuration, emit)) : [];
  if (subtitleCues.length > 0 || calloutLines.length > 0) {
    emit(`
[Pass: Subtitles] ${subtitleCues.length} narration(s)${calloutLines.length ? `, ${calloutLines.length} callout line(s)` : ""}`);
    const banners = remappedCallouts.filter((a) => a.calloutStyle === "lower-third").map((a) => {
      const panel = a.calloutPanels?.[0];
      const boxTop = panel ? panel.rect[1] - PANEL_PAD$1.label.y : res.height - 95;
      return { start: a.timestamp, end: a.timestamp + (a.calloutDuration ?? 3), lift: res.height - boxTop + 12 };
    });
    for (const cue of subtitleCues) {
      const over = banners.filter((b) => b.start < cue.start + cue.duration && b.end > cue.start);
      if (over.length) cue.marginV = Math.max(SUBTITLE_MARGIN_V, ...over.map((b) => b.lift));
    }
    writeSubtitleFile(subtitleCues, path__namespace.join(tempDir, "subtitles.ass"), res, calloutLines);
    graph.push(`[${vLabel}]ass=subtitles.ass[subbed]`);
    vLabel = "subbed";
  }
  const outSize = opts.letterbox ?? resolution;
  const needsScale = !!outSize && (outSize.width !== nativeRes.width || outSize.height !== nativeRes.height);
  if (needsScale) {
    emit(`
[Final] Scaling to ${outSize.width}x${outSize.height}`);
    const { width: W, height: H } = outSize;
    graph.push(`[${vLabel}]scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1[scaled]`);
    vLabel = "scaled";
  }
  const versionLabel = version || computeVersionLabel(videoDir);
  const finalPath = path__namespace.join(videoDir, `final_${versionLabel}.mp4`);
  const wrapParts = [opts.wrap?.before, opts.wrap?.after].filter((x) => !!x);
  const finalCrf = crf || 18;
  if (currentInput === effectiveRecording && graph.length === 0 && finalCrf === 18 && wrapParts.length === 0) {
    emit("\nNo effects to apply, copying original recording...");
    fs__namespace.copyFileSync(currentInput, finalPath);
  } else {
    emit(`
[Final] Encoding final_${versionLabel}.mp4 (CRF ${finalCrf})${wrapParts.length ? " with title/end cards" : ""}...`);
    const finished = path__namespace.join(tempDir, "finished.mp4");
    const args = ["-y", "-i", path__namespace.resolve(currentInput)];
    let aMap = index.hasAudioStream(currentInput) ? "0:a" : null;
    if (wrapParts.length) {
      const size = outSize ?? nativeRes;
      const norm = `setpts=PTS-STARTPTS,scale=${size.width}:${size.height}:force_original_aspect_ratio=decrease,pad=${size.width}:${size.height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p`;
      const parts = [opts.wrap?.before, "main", opts.wrap?.after].filter((x) => !!x);
      let idx = 1;
      const labels = parts.map((part, k) => {
        const file = part === "main" ? currentInput : part;
        const vi = part === "main" ? -1 : idx++;
        if (vi >= 0) args.push("-i", path__namespace.resolve(file));
        graph.push(`[${vi < 0 ? vLabel : `${vi}:v`}]${norm}[cv${k}]`);
        if (index.hasAudioStream(file)) {
          graph.push(`[${vi < 0 ? 0 : vi}:a]asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo[ca${k}]`);
        } else {
          args.push("-f", "lavfi", "-t", String(index.probeDuration(file)), "-i", "anullsrc=channel_layout=stereo:sample_rate=48000");
          graph.push(`[${idx++}:a]anull[ca${k}]`);
        }
        return `[cv${k}][ca${k}]`;
      });
      graph.push(`${labels.join("")}concat=n=${parts.length}:v=1:a=1[cv][ca]`);
      vLabel = "cv";
      aMap = "[ca]";
    }
    if (graph.length) args.push("-filter_complex_threads", index.FILTER_THREADS, "-filter_complex", graph.join(";"), "-map", vLabel.includes(":") ? vLabel : `[${vLabel}]`);
    else args.push("-map", "0:v");
    if (aMap) args.push("-map", aMap);
    args.push("-c:v", "libx264", "-preset", wrapParts.length ? "medium" : "fast", "-crf", String(finalCrf), "-pix_fmt", "yuv420p");
    if (aMap) args.push(...wrapParts.length ? ["-c:a", "aac", "-b:a", "192k"] : ["-c:a", "copy"]);
    args.push("-movflags", "+faststart", path__namespace.resolve(finished));
    const r = timed("final", () => child_process.spawnSync(index.FFMPEG_PATH, args, { cwd: tempDir, stdio: ["pipe", "pipe", "ignore"] }));
    if (r.status === 0 && fs__namespace.existsSync(finished) && fs__namespace.statSync(finished).size > 0) {
      fs__namespace.renameSync(finished, finalPath);
    } else {
      emit(`  Warning: final pass produced no output, skipping (ffmpeg exit ${r.status})`);
      fs__namespace.copyFileSync(currentInput, finalPath);
    }
  }
  opts.onTimings?.(timings);
  try {
    fs__namespace.rmSync(tempDir, { recursive: true, force: true });
  } catch {
  }
  emit("\nDone!");
  return finalPath;
}
const ANIM_IN_SEC = 1.2;
const FADE_OUT_SEC = 0.5;
const VOICE_DELAY_SEC = 0.5;
const VOICE_TAIL_SEC = 0.8;
const DEFAULT_CARD_SEC = 3;
const DEFAULT_ACCENT = "#4F46E5";
function cardTheme(template, accent) {
  return {
    clean: { bg: "#F8FAFC", fg: "#0F172A", sub: "#475569", pillBg: accent, pillFg: "#FFFFFF", line: accent },
    bold: { bg: accent, fg: "#FFFFFF", sub: "rgba(255,255,255,0.85)", pillBg: "#FFFFFF", pillFg: accent, line: "rgba(255,255,255,0.9)" },
    minimal: { bg: "#0B0F19", fg: "#F8FAFC", sub: "#94A3B8", pillBg: "transparent", pillFg: "#F8FAFC", line: accent }
  }[template];
}
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
function cardText(v, lang) {
  if (v == null) return "";
  if (typeof v === "string") return v.trim() ? v : "";
  const text = v[lang] != null ? v[lang] : v["en"];
  return text?.trim() ? text : "";
}
function cardHtml(card, lang, durationSec, logoSrc) {
  const template = card.template ?? "clean";
  const accent = card.accent ?? DEFAULT_ACCENT;
  const title = cardText(card.title, lang);
  const subtitle = cardText(card.subtitle, lang);
  const cta = cardText(card.cta, lang);
  const logo = logoSrc;
  const out = Math.max(0, durationSec - FADE_OUT_SEC);
  const theme = cardTheme(template, accent);
  return `<!doctype html><html lang="${esc(lang)}"><head><meta charset="utf-8"><style>
  html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; }
  body {
    background: ${theme.bg}; color: ${theme.fg};
    font-family: "Noto Sans", "Noto Sans Devanagari", "Noto Sans CJK SC", system-ui, sans-serif;
    display: flex; align-items: center; justify-content: center;
    animation: fadeOut ${FADE_OUT_SEC}s ease-in ${out}s both;
  }
  .wrap { width: 84vw; display: flex; flex-direction: column; align-items: ${template === "minimal" ? "flex-start" : "center"}; text-align: ${template === "minimal" ? "left" : "center"}; gap: 3.2vmin; }
  .logo { height: 11vmin; max-width: 50vw; object-fit: contain; animation: up 0.6s cubic-bezier(.2,.7,.2,1) 0.1s both;
          ${template === "bold" ? "background: #FFFFFF; padding: 1.8vmin 2.8vmin; border-radius: 2.4vmin;" : ""} }
  h1 { margin: 0; font-size: ${template === "bold" ? "9.5vmin" : "7.6vmin"}; font-weight: ${template === "minimal" ? 600 : 800}; line-height: 1.12; letter-spacing: -0.02em;
       animation: up 0.7s cubic-bezier(.2,.7,.2,1) 0.25s both; }
  .line { height: 0.8vmin; width: 16vmin; background: ${theme.line}; border-radius: 1vmin; transform-origin: ${template === "minimal" ? "left" : "center"};
          animation: grow 0.6s cubic-bezier(.2,.7,.2,1) 0.5s both; }
  .sub { margin: 0; font-size: 3.9vmin; color: ${theme.sub}; line-height: 1.35; max-width: 70vw; animation: up 0.7s cubic-bezier(.2,.7,.2,1) 0.45s both; }
  .cta { margin-top: 1.5vmin; font-size: 3.6vmin; font-weight: 700; padding: 1.8vmin 4.2vmin; border-radius: 99vmin;
         background: ${theme.pillBg}; color: ${theme.pillFg}; ${template === "minimal" ? `border: 0.35vmin solid ${accent};` : ""}
         animation: pop 0.55s cubic-bezier(.2,1.4,.4,1) 0.7s both; }
  ${template === "bold" ? `.stripe { position: fixed; inset: auto -10vw -18vmin -10vw; height: 34vmin; background: rgba(255,255,255,0.08); transform: skewY(-6deg); animation: slide 0.9s cubic-bezier(.2,.7,.2,1) 0s both; }` : ""}
  @keyframes up { from { opacity: 0; transform: translateY(4vmin); } to { opacity: 1; transform: none; } }
  @keyframes grow { from { transform: scaleX(0); } to { transform: scaleX(1); } }
  @keyframes pop { from { opacity: 0; transform: scale(0.85); } to { opacity: 1; transform: none; } }
  @keyframes slide { from { transform: translateY(40vmin) skewY(-6deg); } to { transform: skewY(-6deg); } }
  @keyframes fadeOut { from { opacity: 1; } to { opacity: 0; } }
</style></head><body>
  ${template === "bold" ? `<div class="stripe"></div>` : ""}
  <div class="wrap">
    ${logo ? `<img class="logo" src="${esc(logo)}" alt="">` : ""}
    <h1>${esc(title)}</h1>
    <div class="line"></div>
    ${subtitle ? `<p class="sub">${esc(subtitle)}</p>` : ""}
    ${cta ? `<div class="cta">${esc(cta)}</div>` : ""}
  </div>
</body></html>`;
}
const FPS$1 = 30;
async function renderCards(script, lang, size, work, crf, log) {
  const cards = ["intro", "outro"].filter((w) => script[w]).map((w) => ({ which: w, card: script[w] }));
  if (!cards.length) return { results: [] };
  index.stage("render", `Rendering ${cards.map((c) => c.which).join(" + ")} card${cards.length > 1 ? "s" : ""} [${lang}]`, { lang });
  fs__namespace.mkdirSync(work.tmpDir, { recursive: true });
  const results = [];
  const clips = {};
  for (const { which, card } of cards) {
    let voice;
    let voicePath;
    if (card.narrate != null) {
      const mini = {
        ...script,
        steps: [{ id: which, beat: [{ fx: "narrate", narrate: card.narrate, ...card.voice ? { voice: card.voice } : {} }] }]
      };
      const got = [...(await narration.synthesizeNarrations(mini, lang, work.audioDir, log)).values()][0];
      if (got) {
        voicePath = got.audioPath;
        voice = { text: got.text, voice: got.voice, durationSec: Math.round(got.durationSec * 100) / 100, cached: got.cached };
      }
    }
    const needed = voice ? VOICE_DELAY_SEC + voice.durationSec + VOICE_TAIL_SEC : 0;
    let durationSec = typeof card.duration === "number" ? card.duration : voice ? needed : DEFAULT_CARD_SEC;
    if (durationSec < needed) {
      log(`${which}: duration ${durationSec}s is shorter than its narration — using ${needed.toFixed(1)}s`);
      durationSec = needed;
    }
    durationSec = Math.round(durationSec * FPS$1) / FPS$1;
    const clip = path__namespace.join(work.tmpDir, `${which}_${lang}.mp4`);
    await renderCard(card, lang, size, durationSec, clip, voicePath, crf, path__namespace.join(work.tmpDir, `${which}_${lang}_frames`));
    clips[which] = clip;
    results.push({ which, durationSec: Math.round(durationSec * 100) / 100, ...voice ? { narration: voice } : {} });
    log(`${which} card ${durationSec.toFixed(1)}s (${card.template ?? "clean"})`);
  }
  return { results, intro: clips.intro, outro: clips.outro };
}
async function renderCard(card, lang, size, durationSec, outPath, voicePath, crf, framesDir) {
  fs__namespace.rmSync(framesDir, { recursive: true, force: true });
  fs__namespace.mkdirSync(framesDir, { recursive: true });
  const browser = await playwrightCore.chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: size, deviceScaleFactor: 1 });
    await page.setContent(cardHtml(card, lang, durationSec, logoDataUri(card.logo)), { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    const total = Math.round(durationSec * FPS$1);
    let hold;
    for (let f = 0; f < total; f++) {
      const t = f / FPS$1;
      const file = path__namespace.join(framesDir, `f${String(f).padStart(5, "0")}.png`);
      const still = t > ANIM_IN_SEC && t < durationSec - FADE_OUT_SEC;
      if (still && hold) {
        fs__namespace.copyFileSync(hold, file);
        continue;
      }
      await page.evaluate((ms) => {
        for (const a of document.getAnimations()) {
          a.pause();
          a.currentTime = ms;
        }
      }, t * 1e3);
      await page.screenshot({ path: file, type: "png" });
      if (still) hold = file;
    }
  } finally {
    await browser.close().catch(() => {
    });
  }
  const args = ["-y", "-framerate", String(FPS$1), "-i", path__namespace.join(framesDir, "f%05d.png")];
  if (voicePath) {
    args.push("-i", voicePath, "-filter_complex", `[1:a]adelay=${Math.round(VOICE_DELAY_SEC * 1e3)}:all=1,aresample=48000,aformat=channel_layouts=stereo,apad[a]`, "-map", "0:v", "-map", "[a]");
  } else {
    args.push("-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000", "-map", "0:v", "-map", "1:a");
  }
  args.push("-t", String(durationSec), "-c:v", "libx264", "-preset", "medium", "-crf", String(crf), "-pix_fmt", "yuv420p", "-r", String(FPS$1), "-c:a", "aac", "-b:a", "192k", outPath);
  const res = index.ffmpegSync(args);
  fs__namespace.rmSync(framesDir, { recursive: true, force: true });
  if (res.status !== 0 || !fs__namespace.existsSync(outPath)) {
    throw new index.AgentError("RENDER_FAILED", `Could not encode the ${path__namespace.basename(outPath)} card`, {
      hint: "Run `narascreen doctor` (ffmpeg). If it repeats, report it with details.",
      details: { status: res.status }
    });
  }
}
function logoDataUri(file) {
  if (!file || !fs__namespace.existsSync(file)) return void 0;
  const ext = path__namespace.extname(file).toLowerCase();
  const mime = ext === ".svg" ? "image/svg+xml" : ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
  return `data:${mime};base64,${fs__namespace.readFileSync(file).toString("base64")}`;
}
class CompileError extends index.AgentError {
  constructor(message, init = {}) {
    super("COMPILE_FAILED", message, {
      ...init,
      hint: init.hint ?? "The recording's trace does not match the script. Re-record (`narascreen record <script> --out <job> --force`, or `make --force`) and produce again."
    });
    this.name = "CompileError";
  }
}
const AUTO_FALLBACK_SEC = 3;
const END_OPEN_SEC = 60;
const BLUR_END_PAD_SEC = 0.1;
const AUTO_MIN_SEC = 0.5;
const NARRATION_TAIL_SEC = 0.5;
const CAP_GAP_SEC = 0.05;
const MIN_RANGE_SEC = 0.05;
const FPS = 30;
const CALLOUT_FONT = 28;
const EDGE = 8;
const LINE = 1.25;
const PANEL_PAD = { label: { x: 10, y: 6 }, step: { x: 12, y: 7 } };
const PANEL_GAP = 6;
function indexTrace(trace) {
  const m = /* @__PURE__ */ new Map();
  for (const e of trace) m.set(`${e.beat}:${e.i}`, e);
  return m;
}
function isOverlay(fx) {
  return fx.fx === "spotlight" || fx.fx === "callout" || fx.fx === "blur" || fx.fx === "arrow";
}
function isRange(fx) {
  return fx.fx === "speed" || fx.fx === "skip" || fx.fx === "mute";
}
function overlayDuration(fx) {
  if (typeof fx.duration === "number") return { value: fx.duration, mode: "fixed" };
  if (fx.duration === "step-end" || fx.duration === "end") return { value: AUTO_FALLBACK_SEC, mode: fx.duration };
  if (fx.duration === "auto") return { value: AUTO_FALLBACK_SEC, mode: "auto" };
  return { value: AUTO_FALLBACK_SEC, mode: fx.fx === "blur" ? "step-end" : "auto" };
}
function nextStepSlots(script, byKey, k) {
  const next = script.steps[k + 1];
  if (!next) return [];
  return next.beat.map((_, j) => byKey.get(`${next.id}:${j}`)).filter((x) => x != null);
}
function stepEndTime(script, byKey, k, endOfRecording) {
  const slots = nextStepSlots(script, byKey, k);
  if (!slots.length) return endOfRecording;
  const starts = slots.map((e) => e.start).filter((x) => x != null);
  return Math.min(...starts.length ? starts : slots.map((e) => e.t));
}
function blurStepEndTime(script, byKey, k, endOfRecording) {
  const slots = nextStepSlots(script, byKey, k);
  const boundary = stepEndTime(script, byKey, k, endOfRecording);
  if (!slots.length) return boundary;
  const first = slots[0];
  return Math.min(endOfRecording, Math.max(boundary, first.end ?? first.t));
}
function narrationFields(src, lang, clip, fail, what) {
  const narr = narration.resolveNarration(src, lang);
  const audio = narration.resolveAudio(src, lang);
  if (audio) {
    return narr ? { narrations: { [narr.lang]: narr.text }, audioPath: { [narr.lang]: audio.path } } : { customAudioPath: audio.path };
  }
  if (!narr) throw fail(`${what} (for lang "${lang}")`, `Add "${lang}" (or "en") to this entry's narrate map, or give it \`audio\`.`);
  return { narrations: { [narr.lang]: narr.text }, ...clip ? { audioPath: { [narr.lang]: clip.audioPath } } : {} };
}
function padRect([x, y, w, h], p, vp) {
  const x0 = Math.max(0, x - p);
  const y0 = Math.max(0, y - p);
  const x1 = Math.min(vp.width, x + w + p);
  const y1 = Math.min(vp.height, y + h + p);
  return [Math.round(x0), Math.round(y0), Math.round(x1 - x0), Math.round(y1 - y0)];
}
function calloutPanel(fx, text, rect, vp) {
  const shown = fx.style === "step-counter" && fx.step ? `Step ${fx.step}: ${text}` : text;
  if (fx.style === "lower-third") {
    if (fx.fontSize == null) return void 0;
    const f2 = fx.fontSize;
    const w2 = Math.round(0.6 * f2 * shown.length);
    return { text, rect: [Math.max(EDGE, Math.round((vp.width - w2) / 2)), vp.height - 44 - f2, w2, f2], fontSize: f2 };
  }
  if (!rect) return void 0;
  const f = fx.fontSize ?? CALLOUT_FONT;
  const pad = fx.style === "step-counter" ? PANEL_PAD.step : PANEL_PAD.label;
  const w = Math.round(0.6 * f * shown.length);
  const [rx, ry, , rh] = rect;
  const above = ry - PANEL_GAP - pad.y - LINE * f;
  const below = ry + rh + PANEL_GAP + pad.y;
  const placement = fx.placement ?? "above";
  let y = placement === "over" ? ry + pad.y : placement === "below" ? below : above - pad.y < EDGE ? below : above;
  const x = Math.max(EDGE + pad.x, Math.min(rx + pad.x, vp.width - w - EDGE - pad.x));
  y = Math.max(EDGE + pad.y, Math.min(y, vp.height - EDGE - pad.y - LINE * f));
  return { text, rect: [Math.round(x), Math.round(y), w, f], fontSize: f };
}
function calloutBox(a, vp) {
  if (a.type !== "callout" || a.calloutStyle === "arrow") return void 0;
  const style = a.calloutStyle ?? "label";
  const text = a.calloutText ?? a.calloutPanels?.[0]?.text ?? "";
  const shown = style === "step-counter" && a.calloutStep ? `Step ${a.calloutStep}: ${text}` : text;
  const width = (fs2) => 0.6 * fs2 * shown.length;
  const p = a.calloutPanels?.[0];
  if (p) {
    const pad = style === "step-counter" ? PANEL_PAD.step : PANEL_PAD.label;
    return [p.rect[0] - pad.x, p.rect[1] - pad.y, width(p.fontSize) + 2 * pad.x, LINE * p.fontSize + 2 * pad.y];
  }
  if (style === "lower-third") {
    const w = width(36) + 30;
    return [(vp.width - w) / 2, vp.height - 95, w, LINE * 36 + 30];
  }
  const [x, y] = a.calloutPosition ?? [100, 100];
  return [x - 10, y - 10, width(28) + 20, LINE * 28 + 20];
}
function takesSlot(a, b, vp) {
  if (a.type === "spotlight" || b.type === "spotlight") return a.type === b.type;
  if (a.type !== "callout" || b.type !== "callout") return false;
  const kind = (x) => x.calloutStyle === "arrow" ? "arrow" : x.calloutStyle ?? "label";
  const [ka, kb] = [kind(a), kind(b)];
  if (ka === "arrow" || kb === "arrow") return ka === kb;
  if (ka === kb && (ka === "lower-third" || ka === "step-counter")) return true;
  const [ba, bb] = [calloutBox(a, vp), calloutBox(b, vp)];
  return !!ba && !!bb && ba[0] < bb[0] + bb[2] && bb[0] < ba[0] + ba[2] && ba[1] < bb[1] + bb[3] && bb[1] < ba[1] + ba[3];
}
function emitAction(fx, id, tr, c) {
  const base = { id, type: fx.fx, timestamp: tr.t };
  const fail = (msg, hint) => new CompileError(`${c.ctx}: ${msg}`, { where: c.where, hint });
  const rects = tr.rects?.length ? tr.rects : tr.rect ? [tr.rect] : [];
  const clips = [];
  const clipOf = (key) => {
    const clip = c.clips?.get(key);
    if (clip) clips.push(clip);
    return clip;
  };
  const done = () => ({ action: base, clips });
  switch (fx.fx) {
    case "zoom": {
      base.zoomDuration = fx.zoomDuration ?? c.d.zoomDuration;
      base.zoomHold = fx.zoomHold ?? c.d.zoomHold;
      if (fx.targets?.length) {
        if (rects.length < fx.targets.length) {
          throw fail(`zoom has ${fx.targets.length} targets but the recording measured ${rects.length} rect(s)`);
        }
        base.zoomTargets = fx.targets.map((_, k) => {
          const sp2 = c.speakers.get(`${c.key}:t${k}`);
          if (!sp2) return { rect: rects[k] };
          return { rect: rects[k], ...narrationFields(sp2.src, c.lang, clipOf(sp2.key), fail, `zoom target ${k} has no narration`) };
        });
        return done();
      }
      if (!rects[0]) throw fail("zoom needs a rect (anchor an element)");
      const sp = c.speakers.get(c.key);
      if (sp) {
        base.zoomTargets = [{ rect: rects[0], ...narrationFields(sp.src, c.lang, clipOf(sp.key), fail, "zoom narration has no text") }];
      } else {
        base.zoomRect = rects[0];
      }
      return done();
    }
    case "spotlight": {
      if (!rects.length) throw fail("spotlight needs a rect (anchor an element)");
      base.spotlightRects = fx.padding ? rects.map((r) => padRect(r, fx.padding, c.viewport)) : rects;
      base.dimOpacity = fx.dimOpacity ?? 0.7;
      if (fx.feather) base.spotlightFeather = fx.feather;
      if (fx.converge) base.spotlightConverge = fx.converge;
      base.spotlightDuration = overlayDuration(fx).value;
      return done();
    }
    case "blur": {
      if (!rects.length) throw fail("blur needs a rect (anchor an element)");
      base.blurRects = rects;
      base.blurRadius = fx.radius ?? 20;
      base.blurDuration = overlayDuration(fx).value;
      return done();
    }
    case "callout": {
      const text = narration.resolveNarration({ narrate: fx.text }, c.lang)?.text;
      if (!text) throw fail("callout needs text", `Add a \`text\` to the callout entry (for "${c.lang}", or an "en" fallback).`);
      base.calloutText = text;
      base.calloutStyle = fx.style ?? "label";
      base.calloutDuration = overlayDuration(fx).value;
      if (fx.step != null) base.calloutStep = fx.step;
      const panel = calloutPanel(fx, text, rects[0], c.viewport);
      if (panel) base.calloutPanels = [panel];
      return done();
    }
    case "arrow": {
      if (!rects[0]) throw fail("arrow needs a rect (anchor an element)");
      const text = fx.text != null ? narration.resolveNarration({ narrate: fx.text }, c.lang)?.text ?? "" : "";
      base.type = "callout";
      base.calloutStyle = "arrow";
      base.calloutText = text || void 0;
      base.calloutPanels = [{ text, rect: rects[0], fontSize: fx.fontSize ?? 24 }];
      base.calloutDuration = overlayDuration(fx).value;
      if (fx.from) base.arrowFrom = fx.from;
      if (fx.color) base.arrowColor = fx.color;
      if (fx.highlight) base.arrowHighlight = true;
      if (fx.highlight && fx.highlightColor) base.arrowHighlightColor = fx.highlightColor;
      return done();
    }
    case "pause": {
      if (fx.seconds != null) base.resumeAfter = fx.seconds;
      return done();
    }
    case "narrate": {
      const sp = c.speakers.get(c.key);
      if (!sp) throw fail(`narrate needs text (for lang "${c.lang}")`, "Give it `narrate` text or an `audio` file.");
      Object.assign(base, narrationFields(sp.src, c.lang, clipOf(sp.key), fail, "narrate needs text"));
      base.freeze = fx.freeze ?? true;
      base.showSubtitles = fx.subtitles ?? true;
      if (fx.subtitleSize != null) base.subtitleSize = fx.subtitleSize;
      return done();
    }
    case "speed":
      base.speedFactor = fx.factor ?? 2;
      return done();
    case "skip":
    case "mute":
      return done();
    default:
      throw fail(`unknown fx "${fx.fx}"`);
  }
}
function compile(scriptIn, trace, lang = "en", clips, warnings = [], opts = {}) {
  const plugins = index.pluginsFor(scriptIn);
  const script = plugins.reduce((acc, p) => p.compileScript?.(acc) ?? acc, scriptIn);
  const d = { ...index.BUILTIN_DEFAULTS, ...script.defaults };
  const byKey = indexTrace(trace);
  const speakers = new Map(narration.narrationSlots(script).map((sp) => [sp.key, sp]));
  for (const sp of speakers.values()) {
    const note = narration.narrationLanguageNote(sp.src, lang);
    if (note) warnings.push(`${sp.path}: ${note}`);
  }
  script.steps.forEach(
    (beat, s) => beat.beat.forEach((e, i) => {
      if (index.isFx(e) && (e.fx === "callout" || e.fx === "arrow") && !e.disabled && e.text && typeof e.text === "object" && e.text[lang] == null && e.text.en != null) {
        warnings.push(`steps[${s}].beat[${i}]: no ${lang} callout text — used en. Add "${lang}": "…" to the text map.`);
      }
    })
  );
  const endOfRecording = opts.durationSec ?? Math.max(0, ...trace.map((e) => e.t)) + 0.5;
  const slots = [];
  let n = 0;
  script.steps.forEach((beat, s) => {
    beat.beat.forEach((entry, i) => {
      if (!index.isFx(entry) || entry.disabled) return;
      const path2 = `steps[${s}].beat[${i}]`;
      const where = { step: beat.id, entry: i, path: path2 };
      const ctx = `${path2} (${entry.fx}, step "${beat.id}")`;
      const tr = byKey.get(`${beat.id}:${i}`);
      if (!tr) {
        throw new CompileError(`${ctx}: no trace entry — the recording never reached this entry (trace has ${trace.length} entries)`, { where });
      }
      if (tr.kind !== "fx" || tr.fx !== entry.fx) {
        throw new CompileError(`${ctx}: script/recording mismatch — the trace has ${tr.kind}:${tr.fx ?? tr.act} here`, { where });
      }
      if (clips) {
        for (const [key2, sp] of speakers) {
          if (sp.step !== beat.id || sp.entry !== i || clips.has(key2)) continue;
          if (narration.resolveNarration(sp.src, lang) || narration.resolveAudio(sp.src, lang)) {
            throw new CompileError(`${sp.path}: no narration audio was generated for this entry`, {
              where: { ...where, path: sp.path },
              hint: "Run produce again; if it repeats, report it (the TTS step skipped this entry)."
            });
          }
        }
      }
      const key = `${beat.id}:${i}`;
      const out = emitAction(entry, `action-${++n}`, tr, { d, lang, viewport: script.viewport, ctx, where, key, speakers, clips });
      out.action.name = `${beat.id} #${i} ${entry.fx}`;
      out.action.source = { step: beat.id, entry: i };
      if (isRange(entry)) setRangeEnd(out.action, rangeEnd(script, byKey, s, i, entry, tr.t, endOfRecording, opts.durationSec));
      const mode = overlayDuration(entry).mode;
      const windowEnd = mode === "end" ? endOfRecording : mode === "step-end" ? (entry.fx === "blur" ? blurStepEndTime : stepEndTime)(script, byKey, s, endOfRecording) : void 0;
      slots.push({ s, i, step: beat.id, path: path2, fx: entry, t: tr.t, action: out.action, clips: out.clips, mode, windowEnd });
    });
  });
  const kept = tidyRanges(slots, warnings);
  const actions = kept.map((sl) => sl.action).sort((a, b) => a.timestamp - b.timestamp);
  if (script.music) {
    actions.unshift({
      id: `action-${++n}`,
      type: "music",
      timestamp: 0,
      name: "music",
      musicPath: script.music.path,
      musicVolume: script.music.volume ?? 0.5,
      musicDuckTo: script.music.duckTo ?? 0.2
    });
  }
  const clipSec = /* @__PURE__ */ new Map();
  for (const c of clips?.values() ?? []) clipSec.set(c.audioPath, c.durationSec);
  const tl = modelTimeline(actions, (p) => clipSec.get(p), opts.durationSec);
  resolveOverlays(kept, actions, tl, warnings, script.viewport);
  for (const p of plugins) p.adjustActions?.(actions);
  return actions;
}
function setRangeEnd(a, end) {
  if (a.type === "speed") a.speedEndTimestamp = end;
  else if (a.type === "skip") a.skipEndTimestamp = end;
  else if (a.type === "mute") a.muteEndTimestamp = end;
}
function rangeEndOf(a) {
  return (a.type === "speed" ? a.speedEndTimestamp : a.type === "skip" ? a.skipEndTimestamp : a.muteEndTimestamp) ?? a.timestamp;
}
function rangeEnd(script, byKey, s, i, fx, t, endOfRecording, durationSec) {
  const clamp = (x) => durationSec != null ? Math.min(x, durationSec) : x;
  if (fx.seconds != null) return clamp(t + fx.seconds);
  const stepEnd = (k2) => stepEndTime(script, byKey, k2, endOfRecording);
  const until = fx.until ?? index.RANGE_DEFAULT_UNTIL[fx.fx];
  if (until === "next-act") {
    const beat = script.steps[s];
    for (let j = i + 1; j < beat.beat.length; j++) {
      const tr = index.isAct(beat.beat[j]) ? byKey.get(`${beat.id}:${j}`) : void 0;
      if (tr) return clamp(tr.t);
    }
    return clamp(stepEnd(s));
  }
  if (until === "step-end") return clamp(stepEnd(s));
  const k = script.steps.findIndex((b) => b.id === until);
  return clamp(stepEnd(k >= 0 ? k : s));
}
function tidyRanges(slots, warnings) {
  const dropped = /* @__PURE__ */ new Set();
  for (const kind of ["speed", "skip", "mute"]) {
    const ranges = slots.filter((sl) => sl.fx.fx === kind).sort((a, b) => a.action.timestamp - b.action.timestamp);
    let prev;
    for (const sl of ranges) {
      const end = rangeEndOf(sl.action);
      if (end - sl.action.timestamp < MIN_RANGE_SEC) {
        const len = Math.max(0, end - sl.action.timestamp).toFixed(2);
        const what = kind === "skip" ? "nothing to cut" : kind === "speed" ? "nothing to speed up" : "nothing to mute";
        warnings.push(
          `${sl.path} (${kind}): has ${what} (${len}s) — it was ignored. ` + (sl.fx.until == null || sl.fx.until === "next-act" ? `It ends when the next action finishes, and that action was instant: put the slow action (the one to ${kind === "skip" ? "cut" : kind === "speed" ? "speed up" : "mute"}) right after it, or use \`seconds\`.` : "Check `until` / `seconds`.")
        );
        dropped.add(sl);
        continue;
      }
      if (kind !== "mute" && prev && sl.action.timestamp < rangeEndOf(prev.action)) {
        const start = rangeEndOf(prev.action);
        if (end - start < MIN_RANGE_SEC) {
          warnings.push(`${sl.path} (${kind}): lies entirely inside the ${kind} at ${prev.path}, so it is left out.`);
          dropped.add(sl);
          continue;
        }
        warnings.push(`${sl.path} (${kind}): starts inside the ${kind} at ${prev.path}; it now begins where that one ends (${start.toFixed(1)}s of the recording).`);
        sl.action.timestamp = start;
      }
      prev = sl;
    }
  }
  const kept = slots.filter((sl) => !dropped.has(sl));
  for (const skip of kept.filter((sl) => sl.fx.fx === "skip")) {
    const [a, b] = [skip.action.timestamp, rangeEndOf(skip.action)];
    for (const sl of kept) {
      if (sl === skip || sl.fx.fx === "skip" || !(sl.t > a + 0.01 && sl.t < b - 0.01)) continue;
      warnings.push(
        `${sl.path} (${sl.fx.fx}) sits inside the part that ${skip.path} cuts out (${a.toFixed(1)}s–${b.toFixed(1)}s of the recording), so it starts at the cut instead: on the first frame after the skipped part. Move it after the skip (or end the skip earlier) if that is not what you want.`
      );
    }
  }
  return kept;
}
function frames(sec2) {
  return Math.max(Math.round(FPS * sec2), 2) / FPS;
}
function narrationSec(src, audioSec) {
  for (const p of [src.customAudioPath, ...Object.values(src.audioPath ?? {})]) {
    const s = p ? audioSec(p) : void 0;
    if (s != null && s > 0) return s;
  }
  return void 0;
}
function skipRemap(ranges) {
  return (t) => {
    let offset = 0;
    for (const r of ranges) {
      if (r.end <= t) offset += r.end - r.start;
      else if (r.start < t) return r.start - offset;
    }
    return t - offset;
  };
}
function remapRanges(ranges, remap) {
  return ranges.map((r) => ({ ...r, start: remap(r.start), end: remap(r.end) })).filter((r) => r.end > r.start + 0.05);
}
function speedRemap(ranges) {
  return (t) => {
    let out = 0;
    let cursor = 0;
    for (const r of ranges) {
      if (t <= r.start) return out + (t - cursor);
      out += r.start - cursor;
      cursor = r.start;
      if (t <= r.end) return out + (t - r.start) / r.factor;
      out += (r.end - r.start) / r.factor;
      cursor = r.end;
    }
    return out + (t - cursor);
  };
}
function modelTimeline(actions, audioSec, recordingSec) {
  const skips = actions.filter((a) => a.type === "skip" && a.skipEndTimestamp).map((a) => ({ start: a.timestamp, end: a.skipEndTimestamp, action: a })).sort((a, b) => a.start - b.start);
  const skipMap = skipRemap(skips);
  const speeds = remapRanges(
    actions.filter((a) => a.type === "speed" && a.speedEndTimestamp && a.speedFactor).map((a) => ({ start: a.timestamp, end: a.speedEndTimestamp, factor: a.speedFactor, action: a })).sort((a, b) => a.start - b.start),
    skipMap
  );
  const speedMap = speedRemap(speeds);
  const mapped = (t) => speedMap(skipMap(t));
  const isZoom = (a) => a.type === "zoom" && !!(a.zoomRect || a.zoomTargets?.length);
  const ordered = [
    ...actions.filter(isZoom),
    ...actions.filter((a) => a.type === "pause"),
    ...actions.filter((a) => a.type === "narrate")
  ].map((a) => ({ a, at: mapped(a.timestamp) })).sort((x, y) => x.at - y.at);
  const inserts = [];
  const recordingEnd = recordingSec != null ? mapped(recordingSec) : void 0;
  let shift = 0;
  let cursor = 0;
  for (const { a, at: stamped } of ordered) {
    const at = stamped < cursor + 0.05 ? cursor : stamped;
    let length;
    let added;
    let delta;
    let holds;
    if (a.type === "zoom") {
      const half = frames(a.zoomDuration ?? 1);
      const targets = a.zoomTargets?.length ? a.zoomTargets : [{}];
      holds = [];
      let off = 0;
      for (const tg of targets) {
        const s = narrationSec(tg, audioSec);
        off += half;
        const hold = s ?? frames(a.zoomHold ?? 2);
        holds.push({ start: off, length: hold, narrated: s != null });
        off += hold + half;
      }
      length = added = delta = off;
    } else if (a.type === "pause") {
      length = added = delta = typeof a.resumeAfter === "number" ? a.resumeAfter : 3;
    } else {
      const clip = narrationSec(a, audioSec);
      let planned = clip != null ? clip + NARRATION_TAIL_SEC : 3;
      if (typeof a.resumeAfter === "number") planned = a.resumeAfter;
      if (a.freeze === true) {
        length = clip != null ? Math.min(planned, clip) : planned;
        added = delta = length;
      } else {
        length = planned;
        const consumed = recordingEnd != null ? Math.max(0, Math.min(planned, recordingEnd - at)) : planned;
        added = delta = length - consumed;
        cursor = at + consumed;
      }
    }
    if (a.type !== "narrate" || a.freeze === true) cursor = at;
    inserts.push({ action: a, at, length, added, delta, start: at + shift, ...holds ? { holds } : {} });
    shift += delta;
  }
  const heldTail = (end) => recordingEnd != null ? 0 : inserts.reduce((sum, sp) => sp.action.type === "narrate" && sp.action.freeze !== true ? sum + Math.max(0, sp.at + sp.length - Math.max(sp.at, end)) : sum, 0);
  const boundaries = [
    ...skips.map((r) => ({ at: mapped(r.start), action: r.action })),
    ...speeds.flatMap((r) => [
      { at: speedMap(r.start), action: r.action },
      { at: speedMap(r.end), action: r.action }
    ])
  ].sort((x, y) => x.at - y.at);
  const sumBefore = (m, key) => inserts.reduce((sum, sp) => sp.at < m ? sum + sp[key] : sum, 0);
  return {
    inserts,
    mapped,
    placed: (t) => mapped(t) + sumBefore(mapped(t), "added"),
    realAt: (m) => m + sumBefore(m, "delta"),
    boundaries,
    addedSec: shift,
    finalDuration: (sec2) => mapped(sec2) + shift + heldTail(mapped(sec2))
  };
}
const round3 = (x) => Math.round(x * 1e3) / 1e3;
const sec = (x) => `${x.toFixed(1)}s`;
function setOverlayDuration(a, dur) {
  if (a.type === "spotlight") a.spotlightDuration = dur;
  else if (a.type === "blur") a.blurDuration = dur;
  else if (a.type === "callout") a.calloutDuration = dur;
}
function overlayDurationOf(a) {
  return (a.type === "spotlight" ? a.spotlightDuration : a.type === "blur" ? a.blurDuration : a.calloutDuration) ?? AUTO_FALLBACK_SEC;
}
function resolveBlur(sl, slots, tl, spanOf) {
  if (sl.mode === "fixed") return;
  let dur;
  if (sl.mode === "end") {
    dur = sl.windowEnd - sl.t + BLUR_END_PAD_SEC;
  } else if (sl.mode !== "auto") {
    dur = sl.windowEnd - sl.t;
  } else {
    const j = slots.find((o) => o.s === sl.s && o.i > sl.i && (o.fx.fx === "narrate" || o.fx.fx === "zoom") && o.clips.length);
    if (!j) dur = AUTO_FALLBACK_SEC;
    else {
      const sp = spanOf.get(j.action);
      const waited = sp ? Math.max(0, sp.at - tl.mapped(j.t)) : 0;
      const from = j.t + waited;
      dur = (j.fx.fx === "narrate" && j.fx.freeze === false ? from + j.clips[0].durationSec : from) + NARRATION_TAIL_SEC - sl.t;
    }
  }
  setOverlayDuration(sl.action, Math.max(AUTO_MIN_SEC, round3(dur)));
}
function resolveOverlays(slots, actions, tl, warnings, vp) {
  const spanOf = new Map(tl.inserts.map((sp) => [sp.action, sp]));
  const slotOf = new Map(slots.map((sl) => [sl.action, sl]));
  const orderOf = new Map(actions.map((a, k) => [a, k]));
  const pathOf = (a) => slotOf.get(a)?.path ?? a.name ?? a.id;
  for (const sl of slots) {
    if (!isOverlay(sl.fx)) continue;
    if (sl.fx.fx === "blur") {
      resolveBlur(sl, slots, tl, spanOf);
      continue;
    }
    const m = tl.mapped(sl.t);
    const P = tl.placed(sl.t);
    const zoomAfter = () => tl.inserts.find((sp) => sp.action.type === "zoom" && sp.at >= m);
    if (sl.mode === "fixed") continue;
    let target = AUTO_FALLBACK_SEC;
    const auto = sl.mode === "auto";
    const j = auto ? slots.find((o) => o.s === sl.s && o.i > sl.i && (o.fx.fx === "narrate" || o.fx.fx === "zoom") && o.clips.length) : void 0;
    const span = j && spanOf.get(j.action);
    if (!auto) {
      target = tl.realAt(tl.mapped(sl.windowEnd)) - P + (sl.mode === "end" ? END_OPEN_SEC : 0);
    } else if (j && span) {
      let cover;
      if (j.fx.fx === "narrate") {
        cover = j.clips[0].durationSec + NARRATION_TAIL_SEC;
      } else {
        const last = [...span.holds ?? []].reverse().find((h) => h.narrated);
        cover = Math.min((last ? last.start + last.length : span.length) + NARRATION_TAIL_SEC, span.length);
      }
      target = span.start + cover - P;
    }
    const caps = [];
    const rectBound = !(sl.fx.fx === "callout" && (sl.fx.style ?? "label") === "lower-third");
    if (rectBound) {
      const z = zoomAfter();
      if (z) caps.push({ at: z.start - P - CAP_GAP_SEC, why: "zoom", action: z.action });
      const b = tl.boundaries.find((x) => x.at > m + 1e-6);
      if (b) caps.push({ at: tl.realAt(b.at) - P - CAP_GAP_SEC, why: "range", action: b.action });
    }
    const capSame = auto || sl.action.type === "spotlight";
    const nextSame = capSame ? actions.slice(orderOf.get(sl.action) + 1).find((a) => takesSlot(sl.action, a, vp)) : void 0;
    if (nextSame) caps.push({ at: tl.placed(nextSame.timestamp) - P - CAP_GAP_SEC, why: "same", action: nextSame });
    const binding = caps.filter((c) => c.at < target).sort((x, y) => x.at - y.at)[0];
    const dur = Math.max(AUTO_MIN_SEC, round3(binding ? binding.at : target));
    setOverlayDuration(sl.action, dur);
    if (binding?.why === "zoom") {
      warnings.push(
        `${sl.path} (${sl.fx.fx}): "${sl.mode}" duration stops at the zoom at ${pathOf(binding.action)} after ${sec(dur)}` + (j ? ` (the narration it was waiting for ends later)` : "") + ` — overlays can't continue through a zoom because zoomed frames are rescaled. Move the ${sl.fx.fx} after the zoom, or narrate before zooming.`
      );
    } else if (binding?.why === "range") {
      const kind = binding.action.type;
      warnings.push(
        `${sl.path} (${sl.fx.fx}): "${sl.mode}" duration stops after ${sec(dur)} where the ${kind} at ${pathOf(binding.action)} ${kind === "skip" ? "cuts the video" : "changes the playback speed"} — the ${sl.fx.fx} would no longer line up with its element there. Move the ${sl.fx.fx} (or its narration) so it doesn't span the ${kind}.`
      );
    }
  }
  for (const o of spotlightOverlaps(actions, tl)) {
    warnings.push(
      `${pathOf(o.first)} (spotlight): on screen until ${sec(o.firstEnd)} but the spotlight at ${pathOf(o.next)} starts at ${sec(o.nextStart)} — overlapping spotlights fail to render (SPOTLIGHT_OVERLAP). Shorten the first one's duration or use "auto".`
    );
  }
}
function spotlightOverlaps(actions, tl) {
  const spots = actions.filter((a) => a.type === "spotlight").map((a) => ({ a, m: tl.mapped(a.timestamp), start: tl.placed(a.timestamp), end: tl.placed(a.timestamp) + overlayDurationOf(a) })).sort((x, y) => x.start - y.start);
  const out = [];
  for (let q = 0; q + 1 < spots.length; q++) {
    const [cur, nxt] = [spots[q], spots[q + 1]];
    if (nxt.start < cur.end - 0.01) {
      const insertsBetween = tl.inserts.filter((sp) => sp.at >= cur.m && sp.at < nxt.m).length;
      out.push({ first: cur.a, next: nxt.a, firstEnd: cur.end, nextStart: nxt.start, insertsBetween });
    }
  }
  return out;
}
const DURATION_TOLERANCE_SEC = 2;
const SKIPPED_PASS = /produced no output, skipping|music file not found, skipping/i;
function buildProject(script, recordingPath, actions, lang, origin = {}) {
  const native = index.probeResolution(recordingPath);
  const languages = [.../* @__PURE__ */ new Set([...script.languages ?? ["en"], lang])];
  const resolution = origin.resolution ?? script.output?.resolution ?? "native";
  const quality = origin.quality ?? script.output?.quality ?? "high";
  return {
    projectVersion: 2,
    ...origin.scriptPath ? { origin: { kind: "job", scriptPath: origin.scriptPath, lang } } : {},
    title: script.scope,
    baseUrl: script.baseUrl ?? "",
    recordingPath,
    recordingDuration: index.probeDuration(recordingPath),
    viewport: script.viewport,
    output: { width: native.width, height: native.height, fps: 30, format: "mp4", resolution, quality },
    tts: {
      provider: "kokoro",
      kokoroEndpoint: script.tts?.kokoroEndpoint ?? index.DEFAULT_KOKORO_ENDPOINT,
      voiceEn: narration.scriptVoice(script, "en"),
      voiceHi: narration.scriptVoice(script, "hi"),
      speed: script.tts?.speed ?? 1,
      // The script's voice first (the producer and the editor treat [0] as the
      // default), then the rest of the catalog so the editor's picker is full.
      voices: Object.fromEntries(
        languages.map((l) => {
          const v = narration.scriptVoice(script, l);
          return [l, [v, ...(index.DEFAULT_VOICES[l] ?? []).filter((x) => x !== v)]];
        })
      ),
      languages
    },
    // Whole-video music, as in the script (the compiler also emits it as a music action).
    ...script.music ? { music: { path: script.music.path, volume: script.music.volume ?? 0.5, duckTo: script.music.duckTo ?? 0.2 } } : {},
    ...script.intro ? { intro: script.intro } : {},
    ...script.outro ? { outro: script.outro } : {},
    ...script.plan ? { plan: script.plan } : {},
    actions
  };
}
function jobScriptPath(jobDir) {
  try {
    return index.readJob(jobDir).scriptPath;
  } catch {
    return void 0;
  }
}
async function produceLanguage(jobDir, script, trace, lang, log, opts = {}) {
  const p = index.jobPaths(jobDir);
  if (!fs__namespace.existsSync(p.recording)) {
    throw new index.AgentError("JOB_NOT_RECORDED", `No recording at ${p.recording}`, {
      hint: "Record first: `narascreen record <script> --out <job>` (or `narascreen make <script>`)."
    });
  }
  const startedAt = Date.now();
  const secSince = (t) => Math.round((Date.now() - t) / 100) / 10;
  const recordingSec = index.probeDuration(p.recording);
  const quality = opts.quality ?? script.output?.quality ?? "high";
  const resolution = opts.resolution ?? script.output?.resolution ?? "native";
  compile(script, trace, lang, void 0, [], { durationSec: recordingSec });
  const ttsAt = Date.now();
  const clips = await narration.synthesizeNarrations(script, lang, p.audioDir, log);
  const narrationSec2 = secSince(ttsAt);
  index.stage("compile", `Compiling effects [${lang}]`, { lang });
  const warnings = [];
  const actions = compile(script, trace, lang, clips, warnings, { durationSec: recordingSec });
  for (const w of warnings) index.warn(w);
  log(`${actions.length} actions (${actions.map((a) => a.type).join(", ") || "none"})`);
  const clipSec = new Map([...clips.values()].map((c) => [c.audioPath, c.durationSec]));
  const timeline = modelTimeline(actions, (a) => clipSec.get(a));
  const overlap = spotlightOverlaps(actions, timeline).find(
    (o) => o.firstEnd - o.nextStart > 0.1 + 0.05 * o.insertsBetween
  );
  if (overlap) {
    const where = entryWhere(script, overlap.first);
    throw spotlightOverlap(
      `${where?.path ?? overlap.first.name} (spotlight) is on screen until ${overlap.firstEnd.toFixed(1)}s but the next spotlight (${entryWhere(script, overlap.next)?.path ?? overlap.next.name}) starts at ${overlap.nextStart.toFixed(1)}s [${lang}]`,
      { where, details: { overlaps: warnings.filter((w) => /SPOTLIGHT_OVERLAP/.test(w)) } }
    );
  }
  const project = buildProject(script, p.recording, actions, lang, { scriptPath: jobScriptPath(p.root), resolution, quality });
  const projectPath = path__namespace.join(p.root, `demo-project.${lang}.json`);
  const json = JSON.stringify(project, null, 2) + "\n";
  fs__namespace.writeFileSync(projectPath, json);
  if (opts.sessionProject !== false) fs__namespace.writeFileSync(path__namespace.join(p.root, "demo-project.json"), json);
  const native = index.probeResolution(p.recording);
  const outSize = resolution !== "native" ? index.RESOLUTIONS[resolution] : native;
  const cardsAt = Date.now();
  const cardSet = script.intro || script.outro ? await renderCards(script, lang, outSize, { audioDir: p.audioDir, tmpDir: path__namespace.join(p.root, "cards") }, crfFor(quality), log) : { results: [] };
  const cardsSec = cardSet.results.length ? secSince(cardsAt) : void 0;
  index.stage("render", `Rendering video/final_${lang}.mp4 (${actions.length} actions)`, { lang, actions: actions.length, quality, resolution });
  fs__namespace.mkdirSync(p.logsDir, { recursive: true });
  const logPath = path__namespace.join(p.logsDir, `produce-${lang}.log`);
  fs__namespace.writeFileSync(logPath, "");
  const videoPath = path__namespace.join(p.videoDir, `final_${lang}.mp4`);
  fs__namespace.rmSync(videoPath, { force: true });
  const rendererWarnings = [];
  const skippedPasses = [];
  const emit = (msg) => {
    fs__namespace.appendFileSync(logPath, msg + "\n");
    for (const line of msg.split("\n")) {
      const l = line.trim();
      if (!l) continue;
      if (SKIPPED_PASS.test(l)) skippedPasses.push(l);
      else if (/^warning\b/i.test(l)) rendererWarnings.push(`renderer [${lang}]: ${l.replace(/^warning:?\s*/i, "")}`);
      log(`[${lang}] ${l}`);
    }
  };
  const crf = crfFor(quality);
  const renderAt = Date.now();
  let passes = {};
  try {
    await produceTimelineVideo(p.root, emit, lang, void 0, void 0, crf, void 0, {
      projectFile: projectPath,
      letterbox: resolution !== "native" ? outSize : void 0,
      wrap: { before: cardSet.intro, after: cardSet.outro },
      onTimings: (t) => passes = t
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    emit(`ERROR: ${message}`);
    if (/overlapping spotlights/i.test(message)) {
      throw spotlightOverlap(`Two spotlights are on screen at the same time [${lang}]: ${message.split(". Use")[0]}`, {
        details: { logPath, overlaps: warnings.filter((w) => /SPOTLIGHT_OVERLAP/.test(w)), renderer: message }
      });
    }
    throw renderFailed(`The renderer failed [${lang}]: ${message}`, logPath);
  }
  if (skippedPasses.length) {
    throw renderFailed(`The renderer skipped part of the video [${lang}]: ${skippedPasses[0].replace(/^warning:\s*/i, "")}`, logPath, {
      pass: skippedPasses[0],
      ...skippedPasses.length > 1 ? { passes: skippedPasses } : {},
      rejectedVideo: reject(videoPath, lang)
    });
  }
  let durationSec = fs__namespace.existsSync(videoPath) ? index.probeDuration(videoPath) : 0;
  if (!(durationSec > 0)) throw renderFailed(`The renderer produced no playable video at ${videoPath}`, logPath);
  if (clips.size > 0 && !index.hasAudioStream(videoPath)) {
    throw renderFailed(`${videoPath} has no audio track although ${clips.size} narration clip(s) were generated`, logPath, {
      rejectedVideo: reject(videoPath, lang)
    });
  }
  const cardsTotal = cardSet.results.reduce((s, c) => s + c.durationSec, 0);
  const expected = timeline.finalDuration(recordingSec) + cardsTotal;
  if (Math.abs(durationSec - expected) > Math.max(DURATION_TOLERANCE_SEC, expected * 0.05)) {
    rendererWarnings.push(
      `final_${lang}.mp4 is ${durationSec.toFixed(1)}s but the timeline adds up to ~${expected.toFixed(1)}s — an effect may have been skipped. Check ${logPath} and the preview.`
    );
  }
  const renderSec = secSince(renderAt);
  if (resolution !== "native") {
    resizeTo(videoPath, index.RESOLUTIONS[resolution], crf, emit, logPath);
    durationSec = index.probeDuration(videoPath);
  }
  const cards = cardSet.results;
  const { width, height } = index.probeResolution(videoPath);
  const timings = {
    narrationSec: narrationSec2,
    ...cardsSec != null ? { cardsSec } : {},
    renderSec,
    passes,
    totalSec: secSince(startedAt)
  };
  emit(`
Timings: speech ${narrationSec2}s${cardsSec != null ? `, cards ${cardsSec}s` : ""}, render ${renderSec}s (${Object.entries(passes).map(([k, v]) => `${k} ${v}s`).join(", ") || "no passes"}), total ${timings.totalSec}s`);
  for (const w of rendererWarnings) index.warn(w);
  return {
    lang,
    videoPath,
    durationSec,
    width,
    height,
    projectPath,
    logPath,
    actions: actions.length,
    narrations: [...clips.values()].map((c) => ({
      step: c.step,
      entry: c.entry,
      text: c.text,
      voice: c.voice,
      durationSec: Math.round(c.durationSec * 100) / 100,
      cached: c.cached
    })),
    warnings: [...warnings, ...rendererWarnings],
    ...cards.length ? { cards } : {},
    timings
  };
}
function crfFor(quality) {
  return index.QUALITY_CRF[quality];
}
function reject(videoPath, lang) {
  if (!fs__namespace.existsSync(videoPath)) return void 0;
  const to = path__namespace.join(path__namespace.dirname(videoPath), `rejected_${lang}.mp4`);
  fs__namespace.renameSync(videoPath, to);
  return to;
}
function resizeTo(video, size, crf, emit, logPath) {
  const now = index.probeResolution(video);
  if (now.width === size.width && now.height === size.height) return;
  const { width: W, height: H } = size;
  emit(`
[Output] Letterboxing ${now.width}x${now.height} → ${W}x${H} (CRF ${crf})...`);
  const tmp = video.replace(/\.mp4$/, ".resized.mp4");
  const args = [
    "-y",
    "-i",
    video,
    "-vf",
    `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1`,
    "-c:v",
    "libx264",
    "-preset",
    "fast",
    "-crf",
    String(crf),
    "-pix_fmt",
    "yuv420p"
  ];
  if (index.hasAudioStream(video)) args.push("-c:a", "copy");
  args.push(tmp);
  const r = index.ffmpegSync(args);
  if (r.status !== 0 || !fs__namespace.existsSync(tmp) || !(index.probeDuration(tmp) > 0)) {
    fs__namespace.rmSync(tmp, { force: true });
    throw renderFailed(`Could not scale ${video} to ${W}x${H} (ffmpeg exit ${r.status})`, logPath);
  }
  fs__namespace.renameSync(tmp, video);
}
function entryWhere(script, a) {
  const m = /^(.+) #(\d+) \w+$/.exec(a.name ?? "");
  const s = m ? script.steps.findIndex((b) => b.id === m[1]) : -1;
  return m && s >= 0 ? { step: m[1], entry: Number(m[2]), path: `steps[${s}].beat[${m[2]}]` } : void 0;
}
function spotlightOverlap(message, init) {
  return new index.AgentError("SPOTLIGHT_OVERLAP", message, {
    hint: 'Give the first spotlight a shorter explicit duration (or drop `duration` so "auto" ends it before the next one), or remove one of them.',
    where: init.where,
    details: init.details
  });
}
function renderFailed(message, logPath, extra = {}) {
  let lastLines = [];
  try {
    lastLines = fs__namespace.readFileSync(logPath, "utf-8").split("\n").filter((l) => l.trim()).slice(-20);
  } catch {
  }
  return new index.AgentError("RENDER_FAILED", message, {
    hint: "Run `narascreen doctor` (ffmpeg and its drawtext/ass filters must be available), then produce again. details.logPath has the full renderer log.",
    details: { logPath, ...extra, lastLines }
  });
}
exports.buildProject = buildProject;
exports.produceLanguage = produceLanguage;
