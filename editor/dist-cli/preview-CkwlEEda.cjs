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
const DEFAULT_TILES = 12;
const MAX_TILES = 48;
const COLUMNS = 4;
const FRAME_WIDTH = 960;
const TILE_WIDTH = 480;
function makePreview(videoPath, outDir, opts = {}) {
  const video = path__namespace.resolve(videoPath);
  if (!fs__namespace.existsSync(video)) {
    throw new index.AgentError("VIDEO_NOT_FOUND", `No video at ${video}`, {
      hint: "Produce it first: `narascreen produce <job>` (or `narascreen make <script>`).",
      details: { video }
    });
  }
  const durationSec = index.probeDuration(video);
  if (!(durationSec > 0)) {
    throw new index.AgentError("VIDEO_NOT_FOUND", `${video} is not a playable video (no duration)`, {
      hint: "The file is empty or corrupt. Produce it again.",
      details: { video }
    });
  }
  const n = Math.min(MAX_TILES, Math.max(1, Math.round(opts.tiles ?? DEFAULT_TILES)));
  const dir = path__namespace.resolve(outDir);
  fs__namespace.mkdirSync(dir, { recursive: true });
  for (const f of fs__namespace.readdirSync(dir)) {
    if (/^(frame|tile)_\d+\.jpg$/.test(f) || f === "contact.jpg") fs__namespace.rmSync(path__namespace.join(dir, f), { force: true });
  }
  let labels = true;
  const frames = [];
  const tiles = [];
  for (let k = 0; k < n; k++) {
    const t = Math.round((k + 0.5) * durationSec * 1e3 / n) / 1e3;
    const id = String(k).padStart(2, "0");
    const framePath = path__namespace.join(dir, `frame_${id}.jpg`);
    const tilePath = path__namespace.join(dir, `tile_${id}.jpg`);
    let ok = extract(video, t, framePath, tilePath, labels ? clock(t) : void 0);
    if (!ok && labels) {
      labels = false;
      ok = extract(video, t, framePath, tilePath, void 0);
    }
    if (!ok) continue;
    frames.push({ t, path: framePath });
    tiles.push(tilePath);
  }
  if (frames.length === 0) {
    throw new index.AgentError("VIDEO_NOT_FOUND", `Could not read any frame from ${video}`, {
      hint: "The video is corrupt or ffmpeg is missing (`narascreen doctor`). Produce it again.",
      details: { video, durationSec }
    });
  }
  const contactSheet = path__namespace.join(dir, "contact.jpg");
  tiles.forEach((tp, q) => {
    const want = path__namespace.join(dir, `tile_${String(q).padStart(2, "0")}.jpg`);
    if (tp !== want) fs__namespace.renameSync(tp, want);
  });
  const rows = Math.ceil(tiles.length / COLUMNS);
  const cols = Math.min(COLUMNS, tiles.length);
  index.ffmpegSync([
    "-y",
    "-framerate",
    "1",
    "-i",
    path__namespace.join(dir, "tile_%02d.jpg"),
    "-vf",
    `tile=${cols}x${rows}:padding=6:margin=6:color=0x202020`,
    "-frames:v",
    "1",
    "-update",
    "1",
    "-q:v",
    "3",
    contactSheet
  ]);
  for (let q = 0; q < tiles.length; q++) fs__namespace.rmSync(path__namespace.join(dir, `tile_${String(q).padStart(2, "0")}.jpg`), { force: true });
  if (!fs__namespace.existsSync(contactSheet)) {
    throw new index.AgentError("INTERNAL", `ffmpeg could not build the contact sheet for ${video}`, {
      hint: "The individual frames are still in the preview folder. Check ffmpeg with `narascreen doctor`.",
      details: { frames: frames.map((f) => f.path) }
    });
  }
  return { video, durationSec, contactSheet, frames };
}
function extract(video, t, framePath, tilePath, label) {
  const tileChain = label ? `scale=${TILE_WIDTH}:-2,drawtext=text='${label.replace(/:/g, "\\:")}':fontsize=22:fontcolor=white:box=1:boxcolor=black@0.65:boxborderw=6:x=8:y=h-th-10` : `scale=${TILE_WIDTH}:-2`;
  const r = index.ffmpegSync([
    "-y",
    "-ss",
    t.toFixed(3),
    "-i",
    video,
    "-filter_complex",
    `[0:v]split=2[a][b];[a]scale=${FRAME_WIDTH}:-2[big];[b]${tileChain}[tile]`,
    "-map",
    "[big]",
    "-frames:v",
    "1",
    "-update",
    "1",
    "-q:v",
    "3",
    framePath,
    "-map",
    "[tile]",
    "-frames:v",
    "1",
    "-update",
    "1",
    "-q:v",
    "3",
    tilePath
  ]);
  return r.status === 0 && fs__namespace.existsSync(framePath) && fs__namespace.existsSync(tilePath);
}
function clock(t) {
  const s = Math.floor(t);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}
exports.makePreview = makePreview;
