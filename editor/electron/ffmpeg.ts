import { spawnSync } from "child_process";
import * as path from "path";
import * as fs from "fs";

/** Get video resolution via ffprobe */
export function probeResolution(filePath: string): { width: number; height: number } {
  const result = spawnSync("ffprobe", [
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

/** Get video/audio duration via ffprobe */
export function probeDuration(filePath: string): number {
  const result = spawnSync("ffprobe", [
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
  const result = spawnSync("ffprobe", [
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
  const result = spawnSync("ffmpeg", [
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

/** Extract a single frame from a video at the given timestamp */
export function extractFrame(videoPath: string, timestamp: number, outputPath: string): void {
  spawnSync("ffmpeg", [
    "-y", "-ss", timestamp.toFixed(3),
    "-i", videoPath,
    "-frames:v", "1",
    outputPath,
  ]);
}

/** Cut a clip from a video (video only, no audio) */
export function cutClip(
  inputPath: string,
  startTime: number,
  endTime: number,
  outputPath: string,
): void {
  spawnSync("ffmpeg", [
    "-y", "-i", inputPath,
    "-ss", startTime.toFixed(3),
    "-to", endTime.toFixed(3),
    "-c:v", "libx264", "-preset", "fast", "-crf", "18",
    "-pix_fmt", "yuv420p", "-an",
    outputPath,
  ]);
}

/** Normalize a segment's audio to 44100Hz stereo AAC (or add silent audio if none) */
export function normalizeSegmentAudio(inputPath: string, outputPath: string): string {
  if (hasAudioStream(inputPath)) {
    const result = spawnSync("ffmpeg", [
      "-y",
      "-i", inputPath,
      "-c:v", "copy",
      "-c:a", "aac", "-ar", "44100", "-ac", "2", "-b:a", "192k",
      outputPath,
    ]);
    if (result.status === 0 && fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) {
      return outputPath;
    }
    return inputPath;
  }

  // No audio — add silent track using explicit duration (avoid -shortest hang with anullsrc)
  const dur = probeDuration(inputPath);
  const result = spawnSync("ffmpeg", [
    "-y",
    "-i", inputPath,
    "-f", "lavfi", "-t", dur.toFixed(3), "-i", "anullsrc=r=44100:cl=stereo",
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
    segments.map((s) => `file '${s}'`).join("\n"),
    "utf-8",
  );

  // Try copy first (fast)
  const result = spawnSync("ffmpeg", [
    "-y", "-f", "concat", "-safe", "0",
    "-i", concatListPath,
    "-c", "copy",
    outputPath,
  ]);

  if (result.status === 0) return true;

  // Fallback: re-encode
  spawnSync("ffmpeg", [
    "-y", "-f", "concat", "-safe", "0",
    "-i", concatListPath,
    "-c:v", "libx264", "-preset", "fast", "-crf", "18",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-ar", "44100", "-ac", "2", "-b:a", "192k",
    outputPath,
  ]);

  return fs.existsSync(outputPath);
}
