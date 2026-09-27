import { spawnSync, type SpawnSyncReturns } from "child_process";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { FFMPEG_PATH, FFPROBE_PATH } from "./bin-paths";

/**
 * Video encoder settings for files that only feed a later pass (cut clips,
 * freezes, zooms, skip/speed segments). ultrafast at near-lossless quality is
 * several times faster to write than the delivered file's settings, and loses
 * nothing visible between passes — only the last pass encodes the file people
 * get. Every intermediate uses exactly these, so segments concat without re-encoding.
 */
export const INTERMEDIATE_VIDEO = ["-c:v", "libx264", "-preset", "ultrafast", "-crf", "12", "-pix_fmt", "yuv420p"];

/** Threads for ffmpeg filter graphs (they default to one). */
export const FILTER_THREADS = String(Math.max(1, os.cpus().length));

// Ignore stderr to prevent Node from buffering ffmpeg's progress output
// (which can be hundreds of MB for long videos and crash the process)
const SPAWN_OPTS = { stdio: ["pipe", "pipe", "ignore"] as ["pipe", "pipe", "ignore"] };

export function ffmpegSync(args: string[]): SpawnSyncReturns<Buffer> {
  return spawnSync(FFMPEG_PATH, args, SPAWN_OPTS);
}

export function ffprobeSync(args: string[]): SpawnSyncReturns<Buffer> {
  return spawnSync(FFPROBE_PATH, args, SPAWN_OPTS);
}

/** Get video resolution via ffprobe */
export function probeResolution(filePath: string): { width: number; height: number } {
  const result = ffprobeSync([
    "-v", "error",
    "-select_streams", "v:0",
    "-show_entries", "stream=width,height",
    "-of", "csv=s=x:p=0",
    filePath,
  ]);
  const parts = result.stdout.toString().trim().split("x");
  const w = parseInt(parts[0]);
  const h = parseInt(parts[1]);
  return { width: isNaN(w) ? 1920 : w, height: isNaN(h) ? 1080 : h };
}

/** Frame rate of the first video stream (frames per second), 30 when unknown. */
export function probeFrameRate(filePath: string): number {
  const result = ffprobeSync([
    "-v", "error",
    "-select_streams", "v:0",
    "-show_entries", "stream=r_frame_rate",
    "-of", "default=noprint_wrappers=1:nokey=1",
    filePath,
  ]);
  const [num, den] = result.stdout.toString().trim().split("/").map(Number);
  const fps = den ? num / den : num;
  return Number.isFinite(fps) && fps >= 1 && fps <= 240 ? fps : 30;
}

/** Get video/audio duration via ffprobe */
export function probeDuration(filePath: string): number {
  const result = ffprobeSync([
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1",
    filePath,
  ]);
  const d = parseFloat(result.stdout.toString().trim());
  return isNaN(d) ? 0 : d;
}

/** Check if a file has an audio stream */
export function hasAudioStream(filePath: string): boolean {
  const result = ffprobeSync([
    "-v", "error",
    "-select_streams", "a",
    "-show_entries", "stream=codec_type",
    "-of", "csv=p=0",
    filePath,
  ]);
  return result.stdout.toString().trim().length > 0;
}

/** Generate thumbnail filmstrip from a video (1 frame per 2 seconds, 160px wide) */
export function generateFilmstrip(sessionDir: string): number {
  const thumbnailsDir = path.join(sessionDir, "thumbnails");
  fs.mkdirSync(thumbnailsDir, { recursive: true });

  const videoPath = path.join(sessionDir, "recordings", "recording.mp4");
  if (!fs.existsSync(videoPath)) {
    throw new Error("Recording file not found");
  }

  const outputPattern = path.join(thumbnailsDir, "thumb_%04d.jpg");
  const result = ffmpegSync([
    "-y",
    "-i", videoPath,
    "-vf", "fps=1/2,scale=160:-1",
    "-q:v", "5",
    outputPattern,
  ]);

  if (result.status !== 0) {
    throw new Error(`ffmpeg filmstrip failed: ${result.stderr?.toString()}`);
  }

  return fs.readdirSync(thumbnailsDir).filter((f) => f.endsWith(".jpg")).length;
}

/**
 * A time for ffmpeg's -ss / -to / -t. `-ss t` starts at the first frame whose
 * time is >= t and `-to` stops before the first one >= the end, so a time that
 * sits exactly on a frame (k / fps — a cut snapped to the frame grid) must mean
 * THAT frame. Written with 3 decimals it could round up past it (3.06667 →
 * "3.067" skipped the frame, and a clip ending there kept it): a 0.2 ms bias
 * and 4 decimals make grid times exact and change nothing else.
 */
export function ffTime(t: number): string {
  return Math.max(0, t - 0.0002).toFixed(4);
}

/** Extract a single frame from a video at the given timestamp (the first frame at or after it) */
export function extractFrame(videoPath: string, timestamp: number, outputPath: string): void {
  ffmpegSync([
    "-y", "-ss", ffTime(timestamp),
    "-i", videoPath,
    "-frames:v", "1",
    outputPath,
  ]);
}

/** Cut a clip from a video, preserving audio if present */
export function cutClip(
  inputPath: string,
  startTime: number,
  endTime: number,
  outputPath: string,
): void {
  const hasAudio = hasAudioStream(inputPath);
  const args = [
    "-y",
    "-ss", ffTime(startTime),   // before -i for fast seek
    "-i", inputPath,
    "-to", (endTime - startTime).toFixed(4),  // relative to seek point
    ...INTERMEDIATE_VIDEO,
  ];
  if (hasAudio) {
    args.push("-c:a", "aac", "-b:a", "192k");
  } else {
    args.push("-an");
  }
  args.push(outputPath);
  ffmpegSync(args);
}

/** Cut a clip with audio stripped (muted) */
export function cutClipMuted(
  inputPath: string,
  startTime: number,
  endTime: number,
  outputPath: string,
): void {
  ffmpegSync([
    "-y",
    "-ss", ffTime(startTime),
    "-i", inputPath,
    "-to", (endTime - startTime).toFixed(4),
    ...INTERMEDIATE_VIDEO,
    "-an",
    outputPath,
  ]);
}

/**
 * Seconds of VIDEO in a clip (its format duration when there is no video
 * stream). The joined timeline follows the video: a segment's audio can run a
 * few ms longer (AAC frames), and the format duration would then count those.
 */
export function segmentDuration(filePath: string): number {
  const result = ffprobeSync([
    "-v", "error",
    "-select_streams", "v:0",
    "-show_entries", "stream=duration",
    "-of", "default=noprint_wrappers=1:nokey=1",
    filePath,
  ]);
  const d = parseFloat(result.stdout.toString().trim());
  return d > 0 ? d : probeDuration(filePath);
}

/**
 * Normalize a segment's audio to 44100Hz stereo AAC (or add silent audio if
 * none), exactly as long as its video. The concat demuxer starts each segment
 * where the previous one's LONGEST stream ended, and re-encoding AAC added
 * ~20 ms per segment: the joined video drifted a frame late every few segments,
 * away from the timestamps every later pass computes.
 */
export function normalizeSegmentAudio(inputPath: string, outputPath: string): string {
  const dur = segmentDuration(inputPath).toFixed(4);
  if (hasAudioStream(inputPath)) {
    const result = ffmpegSync([
      "-y",
      "-i", inputPath,
      "-map", "0:v:0", "-map", "0:a:0",
      "-c:v", "copy",
      "-af", "apad", "-t", dur,
      "-c:a", "aac", "-ar", "44100", "-ac", "2", "-b:a", "192k",
      outputPath,
    ]);
    if (result.status === 0 && fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) {
      return outputPath;
    }
    return inputPath;
  }

  // No audio — add silent track using explicit duration (avoid -shortest hang with anullsrc)
  const result = ffmpegSync([
    "-y",
    "-i", inputPath,
    "-f", "lavfi", "-t", dur, "-i", "anullsrc=r=44100:cl=stereo",
    "-c:v", "copy",
    "-c:a", "aac", "-ar", "44100", "-ac", "2", "-b:a", "192k",
    "-map", "0:v:0", "-map", "1:a:0",
    outputPath,
  ]);
  if (result.status === 0 && fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) {
    return outputPath;
  }
  return inputPath;
}

/** Concatenate segments using ffmpeg concat demuxer */
export function concatSegments(
  segments: string[],
  outputPath: string,
  concatListPath: string,
): boolean {
  fs.writeFileSync(
    concatListPath,
    // concat-list quoting: a ' inside '…' is written as '\''.
    // `inpoint 0`: each segment's AAC track starts with a priming packet at
    // −23 ms, so without it the demuxer shifted the whole joined VIDEO 23 ms
    // late (frame k sat at k/30 + 0.023). A freeze or cut placed right after a
    // skip then picked the frame from before the cut. With it, every frame keeps
    // its exact k/fps time and the passes' timestamp remaps hold to the frame.
    segments.map((s) => `file '${s.replace(/'/g, "'\\''")}'\ninpoint 0`).join("\n"),
    "utf-8",
  );

  // Try copy first (fast)
  const result = ffmpegSync([
    "-y", "-f", "concat", "-safe", "0",
    "-i", concatListPath,
    "-c", "copy",
    outputPath,
  ]);

  if (result.status === 0) return true;

  // Fallback: re-encode
  ffmpegSync([
    "-y", "-f", "concat", "-safe", "0",
    "-i", concatListPath,
    ...INTERMEDIATE_VIDEO,
    "-c:a", "aac", "-ar", "44100", "-ac", "2", "-b:a", "192k",
    outputPath,
  ]);

  return fs.existsSync(outputPath);
}
