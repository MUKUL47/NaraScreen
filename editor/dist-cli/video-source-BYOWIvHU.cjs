"use strict";
Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
const fs = require("fs");
const path = require("path");
const index = require("./job-W-Szny1w.cjs");
require("child_process");
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
function importSourceVideo(src, dest, log) {
  fs__namespace.mkdirSync(path__namespace.dirname(dest), { recursive: true });
  const hasAudio = index.hasAudioStream(src);
  log(`Importing ${path__namespace.basename(src)}${hasAudio ? " (with audio)" : ""}…`);
  const args = [
    "-y",
    "-i",
    src,
    "-vf",
    "scale=trunc(iw/2)*2:trunc(ih/2)*2",
    "-r",
    "30",
    "-c:v",
    "libx264",
    "-preset",
    "fast",
    "-crf",
    "18",
    "-pix_fmt",
    "yuv420p"
  ];
  if (hasAudio) args.push("-c:a", "aac", "-b:a", "192k", "-ar", "44100", "-ac", "2");
  else args.push("-an");
  args.push(dest);
  const res = index.ffmpegSync(args);
  const durationSec = fs__namespace.existsSync(dest) ? index.probeDuration(dest) : 0;
  if (res.status !== 0 || !(durationSec > 0)) {
    throw new index.AgentError("RECORDING_FAILED", `Could not import ${src} (ffmpeg exit ${res.status})`, {
      hint: "Check that the file plays in a normal video player; convert it to MP4 if it doesn't.",
      details: { source: src }
    });
  }
  const { width, height } = index.probeResolution(dest);
  return { recordingPath: dest, durationSec, width, height, hasAudio };
}
function rectsOf(fx) {
  if (fx.targets?.length) return fx.targets.map((t) => t.rect).filter(Boolean);
  if (fx.rects?.length) return fx.rects;
  return fx.rect ? [fx.rect] : [];
}
function timelineTrace(script, durationSec) {
  const trace = [];
  for (const beat of script.steps) {
    beat.beat.forEach((e, i) => {
      if (!index.isFx(e)) return;
      const rects = rectsOf(e);
      trace.push({
        beat: beat.id,
        i,
        kind: "fx",
        fx: e.fx,
        t: Math.max(0, Math.min(e.at ?? 0, durationSec - 0.05)),
        ...rects.length ? { rect: rects[0] } : {},
        ...rects.length > 1 ? { rects } : {}
      });
    });
  }
  return trace.sort((a, b) => a.t - b.t);
}
exports.importSourceVideo = importSourceVideo;
exports.timelineTrace = timelineTrace;
