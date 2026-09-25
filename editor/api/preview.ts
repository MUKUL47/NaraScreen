// ─── preview: a produced video → still frames + one contact sheet ────
//
// Agents can't watch a video, but they can look at images. makePreview samples
// N evenly spaced frames (the middle of N equal slices, so the first and last
// frames are never black lead-in/out) and tiles them into one labelled contact
// sheet, so a single image read answers "did the spotlight land, is the
// callout readable, is the blur in place?".
//
//   <outDir>/frame_00.jpg … frame_NN.jpg   960 px wide
//   <outDir>/contact.jpg                    4 columns of 480 px tiles, mm:ss labels

import * as fs from "fs";
import * as path from "path";
import { ffmpegSync, probeDuration } from "../electron/ffmpeg";
import { AgentError } from "./errors";

export interface PreviewResult {
  video: string;
  durationSec: number;
  contactSheet: string;
  frames: { t: number; path: string }[];
}

const DEFAULT_TILES = 12;
const MAX_TILES = 48;
const COLUMNS = 4;
const FRAME_WIDTH = 960;
const TILE_WIDTH = 480;

export function makePreview(videoPath: string, outDir: string, opts: { tiles?: number } = {}): PreviewResult {
  const video = path.resolve(videoPath);
  if (!fs.existsSync(video)) {
    throw new AgentError("VIDEO_NOT_FOUND", `No video at ${video}`, {
      hint: "Produce it first: `narascreen produce <job>` (or `narascreen make <script>`).",
      details: { video },
    });
  }
  const durationSec = probeDuration(video);
  if (!(durationSec > 0)) {
    throw new AgentError("VIDEO_NOT_FOUND", `${video} is not a playable video (no duration)`, {
      hint: "The file is empty or corrupt. Produce it again.",
      details: { video },
    });
  }

  const n = Math.min(MAX_TILES, Math.max(1, Math.round(opts.tiles ?? DEFAULT_TILES)));
  const dir = path.resolve(outDir);
  fs.mkdirSync(dir, { recursive: true });
  // Drop a previous run's frames so a smaller --tiles never leaves stale ones.
  for (const f of fs.readdirSync(dir)) {
    if (/^(frame|tile)_\d+\.jpg$/.test(f) || f === "contact.jpg") fs.rmSync(path.join(dir, f), { force: true });
  }

  let labels = true; // drops to false if this ffmpeg has no drawtext
  const frames: PreviewResult["frames"] = [];
  const tiles: string[] = [];
  for (let k = 0; k < n; k++) {
    const t = Math.round(((k + 0.5) * durationSec * 1000) / n) / 1000;
    const id = String(k).padStart(2, "0");
    const framePath = path.join(dir, `frame_${id}.jpg`);
    const tilePath = path.join(dir, `tile_${id}.jpg`);
    let ok = extract(video, t, framePath, tilePath, labels ? clock(t) : undefined);
    if (!ok && labels) {
      labels = false;
      ok = extract(video, t, framePath, tilePath, undefined);
    }
    if (!ok) continue; // a single unreadable timestamp shouldn't sink the preview
    frames.push({ t, path: framePath });
    tiles.push(tilePath);
  }
  if (frames.length === 0) {
    throw new AgentError("VIDEO_NOT_FOUND", `Could not read any frame from ${video}`, {
      hint: "The video is corrupt or ffmpeg is missing (`narascreen doctor`). Produce it again.",
      details: { video, durationSec },
    });
  }

  const contactSheet = path.join(dir, "contact.jpg");
  // Renumber consecutively (a skipped frame would break the image2 pattern).
  tiles.forEach((tp, q) => {
    const want = path.join(dir, `tile_${String(q).padStart(2, "0")}.jpg`);
    if (tp !== want) fs.renameSync(tp, want);
  });
  const rows = Math.ceil(tiles.length / COLUMNS);
  const cols = Math.min(COLUMNS, tiles.length);
  ffmpegSync([
    "-y", "-framerate", "1", "-i", path.join(dir, "tile_%02d.jpg"),
    "-vf", `tile=${cols}x${rows}:padding=6:margin=6:color=0x202020`,
    "-frames:v", "1", "-update", "1", "-q:v", "3", contactSheet,
  ]);
  for (let q = 0; q < tiles.length; q++) fs.rmSync(path.join(dir, `tile_${String(q).padStart(2, "0")}.jpg`), { force: true });
  if (!fs.existsSync(contactSheet)) {
    throw new AgentError("INTERNAL", `ffmpeg could not build the contact sheet for ${video}`, {
      hint: "The individual frames are still in the preview folder. Check ffmpeg with `narascreen doctor`.",
      details: { frames: frames.map((f) => f.path) },
    });
  }
  return { video, durationSec, contactSheet, frames };
}

/** One seek, two outputs: the 960 px frame and the (labelled) 480 px tile. */
function extract(video: string, t: number, framePath: string, tilePath: string, label?: string): boolean {
  const tileChain = label
    ? `scale=${TILE_WIDTH}:-2,drawtext=text='${label.replace(/:/g, "\\:")}':fontsize=22:fontcolor=white:` +
      `box=1:boxcolor=black@0.65:boxborderw=6:x=8:y=h-th-10`
    : `scale=${TILE_WIDTH}:-2`;
  const r = ffmpegSync([
    "-y", "-ss", t.toFixed(3), "-i", video,
    "-filter_complex", `[0:v]split=2[a][b];[a]scale=${FRAME_WIDTH}:-2[big];[b]${tileChain}[tile]`,
    "-map", "[big]", "-frames:v", "1", "-update", "1", "-q:v", "3", framePath,
    "-map", "[tile]", "-frames:v", "1", "-update", "1", "-q:v", "3", tilePath,
  ]);
  return r.status === 0 && fs.existsSync(framePath) && fs.existsSync(tilePath);
}

function clock(t: number): string {
  const s = Math.floor(t);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}
