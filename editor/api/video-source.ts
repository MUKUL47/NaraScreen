// ─── video-source: edit an existing video instead of recording a site ──
//
// A script with `source.video` skips the browser entirely. "Recording" becomes
// importing: the file is normalized into the job as recordings/recording.mp4
// (H.264, 30 fps, even dimensions — the producer's cut/concat passes assume
// this), and the trace is built from each fx's `at` + `rect`/`rects` instead of
// being measured. Everything after that (narration, compile, render, preview)
// is the same pipeline browser scripts use.

import * as fs from "fs";
import * as path from "path";
import { AgentError } from "./errors";
import { ffmpegSync, hasAudioStream, probeDuration, probeResolution } from "../electron/ffmpeg";
import { isFx, type DemoScript, type FxEntry, type Rect } from "./schema";
import type { Log } from "./output";
import type { TraceEntry } from "./types";

export interface ImportResult {
  recordingPath: string;
  durationSec: number;
  width: number;
  height: number;
  hasAudio: boolean;
}

/** Copy `src` into the job as a producer-friendly MP4. */
export function importSourceVideo(src: string, dest: string, log: Log): ImportResult {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const hasAudio = hasAudioStream(src);
  log(`Importing ${path.basename(src)}${hasAudio ? " (with audio)" : ""}…`);
  const args = [
    "-y", "-i", src,
    "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",
    "-r", "30",
    "-c:v", "libx264", "-preset", "fast", "-crf", "18", "-pix_fmt", "yuv420p",
  ];
  if (hasAudio) args.push("-c:a", "aac", "-b:a", "192k", "-ar", "44100", "-ac", "2");
  else args.push("-an");
  args.push(dest);
  const res = ffmpegSync(args);
  const durationSec = fs.existsSync(dest) ? probeDuration(dest) : 0;
  if (res.status !== 0 || !(durationSec > 0)) {
    throw new AgentError("RECORDING_FAILED", `Could not import ${src} (ffmpeg exit ${res.status})`, {
      hint: "Check that the file plays in a normal video player; convert it to MP4 if it doesn't.",
      details: { source: src },
    });
  }
  const { width, height } = probeResolution(dest);
  return { recordingPath: dest, durationSec, width, height, hasAudio };
}

/** Every rect an fx names, in order (targets first, then rect/rects). */
function rectsOf(fx: FxEntry): Rect[] {
  if (fx.targets?.length) return fx.targets.map((t) => t.rect).filter(Boolean) as Rect[];
  if (fx.rects?.length) return fx.rects;
  return fx.rect ? [fx.rect] : [];
}

/** The trace a recording would have produced: one fx slot per entry at `at`. */
export function timelineTrace(script: DemoScript, durationSec: number): TraceEntry[] {
  const trace: TraceEntry[] = [];
  for (const beat of script.steps) {
    beat.beat.forEach((e, i) => {
      if (!isFx(e)) return;
      const rects = rectsOf(e);
      trace.push({
        beat: beat.id,
        i,
        kind: "fx",
        fx: e.fx,
        t: Math.max(0, Math.min(e.at ?? 0, durationSec - 0.05)),
        ...(rects.length ? { rect: rects[0] } : {}),
        ...(rects.length > 1 ? { rects } : {}),
      });
    });
  }
  return trace.sort((a, b) => a.t - b.t);
}
