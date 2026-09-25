// ─── screencast recorder: crisp capture via CDP, not Playwright's VP8 ────────
//
// Playwright's built-in recordVideo uses VP8 at a fixed, low bitrate — UI text
// gets mushy with artifacts. Instead we drive Chrome DevTools Protocol's
// Page.startScreencast to pull high-quality JPEG frames, then assemble them with
// ffmpeg at CRF 18 (no VP8 anywhere). Crisp text, real quality.
//
// Frames arrive only when the page CHANGES (not at a fixed FPS). The clock
// (`now()`, which the runner stamps the trace with) starts when the first frame
// arrives; each frame is placed at the moment Chrome captured it (its metadata
// timestamp, same machine clock), so trace times and video times agree. On stop we build a
// variable-duration concat list (each frame shows until the next one arrives), so
// a static page costs ~1 frame while motion stays smooth, and ffmpeg resamples
// that to a constant 30 fps.

import { spawnSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import type { CDPSession, Page } from "@playwright/test";
import { FFMPEG_PATH } from "../electron/bin-paths";
import { probeDuration } from "../electron/ffmpeg";

export interface Screencast {
  /** Wall-clock seconds since capture started (use for the trace clock). */
  now(): number;
  /** Stop capture, assemble frames → mp4 at outputPath, return its duration. */
  stop(outputPath: string): Promise<number>;
  /** Stop capture without assembling anything (the run failed). */
  abort(): Promise<void>;
  /** Frames captured so far (for diagnostics). */
  frameCount(): number;
}

export async function startScreencast(
  page: Page,
  framesDir: string,
  opts: {
    quality?: number;
    everyNthFrame?: number;
    /** Downscale assembled video to this size (CSS px). With deviceScaleFactor>1
     *  the captured frames are larger; downscaling to the viewport keeps the
     *  supersampled crispness AND keeps rects (CSS px) matching the video. */
    outputSize?: { width: number; height: number };
    /** Give up (throw) when Chrome sends no first frame within this time. */
    firstFrameTimeoutMs?: number;
  } = {},
): Promise<Screencast> {
  fs.mkdirSync(framesDir, { recursive: true });
  const client: CDPSession = await page.context().newCDPSession(page);

  const frames: { t: number; file: string }[] = [];
  let idx = 0;
  let stopped = false;
  let writeError: unknown = null;
  // The clock starts when the FIRST frame arrives, not when capture is requested:
  // Chrome takes ~0.1–1.5 s to deliver it, and anything the runner did before
  // that would be missing from (or early in) the video.
  let started = 0;
  let firstFrame: () => void = () => {};
  const gotFirst = new Promise<void>((resolve) => (firstFrame = resolve));
  const elapsed = () => (started ? (Date.now() - started) / 1000 : 0);

  client.on("Page.screencastFrame", (frame: { data: string; sessionId: number; metadata?: { timestamp?: number } }) => {
    // Ack immediately so Chrome keeps sending frames.
    void client.send("Page.screencastFrameAck", { sessionId: frame.sessionId }).catch(() => {});
    if (stopped) return;
    // Never throw from here: an exception in an event handler would be an
    // uncaught error that kills the whole process mid-recording.
    try {
      if (!started) {
        started = Date.now();
        firstFrame();
      }
      // Time the frame by when Chrome CAPTURED it (metadata.timestamp, epoch
      // seconds on this machine's clock) — big frames arrive noticeably later
      // than they were taken. Fall back to arrival time if it looks wrong.
      const arrived = elapsed();
      const captured = frame.metadata?.timestamp != null ? (frame.metadata.timestamp * 1000 - started) / 1000 : NaN;
      let t = Number.isFinite(captured) && captured <= arrived + 0.05 && captured >= arrived - 2 ? captured : arrived;
      if (frames.length) t = Math.max(t, frames[frames.length - 1].t);
      const file = path.join(framesDir, `frame_${String(idx++).padStart(5, "0")}.jpg`);
      fs.writeFileSync(file, Buffer.from(frame.data, "base64"));
      frames.push({ t, file });
    } catch (err) {
      writeError ??= err;
    }
  });

  await client.send("Page.startScreencast", {
    format: "jpeg",
    quality: opts.quality ?? 92,
    everyNthFrame: opts.everyNthFrame ?? 1,
  });

  const timeout = new Promise<"timeout">((r) => setTimeout(() => r("timeout"), opts.firstFrameTimeoutMs ?? 10_000).unref());
  if ((await Promise.race([gotFirst, timeout])) === "timeout") {
    stopped = true;
    await client.send("Page.stopScreencast").catch(() => {});
    await client.detach().catch(() => {});
    throw new Error(`Chrome sent no screencast frame within ${opts.firstFrameTimeoutMs ?? 10_000}ms`);
  }

  const halt = async () => {
    stopped = true;
    await client.send("Page.stopScreencast").catch(() => {});
    await client.detach().catch(() => {});
  };

  return {
    now: elapsed,
    frameCount: () => frames.length,
    abort: halt,
    async stop(outputPath: string): Promise<number> {
      const endT = elapsed();
      await halt();

      if (writeError) {
        throw new Error(`could not save screencast frames: ${writeError instanceof Error ? writeError.message : writeError}`);
      }
      if (frames.length === 0) {
        throw new Error("screencast captured 0 frames");
      }

      // Concat list: each frame shows until the next one's arrival (the last one
      // until endT). The first frame is shown from t=0: Chrome sends the current
      // page right after startScreencast, so it is what was on screen since the
      // clock started (the clock starts at its arrival, so this is exact).
      const lines: string[] = [];
      for (let i = 0; i < frames.length; i++) {
        const cur = frames[i];
        const from = i === 0 ? 0 : cur.t;
        const next = i + 1 < frames.length ? frames[i + 1].t : endT;
        const dur = Math.max(0.001, next - from);
        lines.push(`file '${cur.file.replace(/'/g, "'\\''")}'`);
        lines.push(`duration ${dur.toFixed(4)}`);
      }
      // concat demuxer needs the last file repeated (its duration line is ignored);
      // that extra entry would add one more frame gap at the end, so the output is
      // capped at endT with -t below and the video ends when the clock stopped.
      lines.push(`file '${frames[frames.length - 1].file.replace(/'/g, "'\\''")}'`);

      const listPath = path.join(framesDir, "frames.txt");
      fs.writeFileSync(listPath, lines.join("\n") + "\n");
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });

      // The concat list's per-frame `duration` lines encode real timing; the fps
      // filter resamples that to a clean constant 30fps and -t ends the video
      // exactly when the clock stopped. (Output -r 30 is NOT used: combined with
      // -t it truncates a static, single-frame capture to one frame.)
      const args = ["-y", "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", listPath, "-t", endT.toFixed(3)];
      const filters = ["fps=30"];
      if (opts.outputSize) {
        // lanczos = high-quality downscale of the supersampled frames. yuv420p
        // needs even dimensions: an odd viewport gets 1px of padding on the
        // right/bottom (rects stay valid — the origin doesn't move).
        const { width, height } = opts.outputSize;
        filters.push(`scale=${width}:${height}:flags=lanczos`);
        if (width % 2 || height % 2) filters.push(`pad=${width + (width % 2)}:${height + (height % 2)}:0:0`);
      } else {
        filters.push("pad=ceil(iw/2)*2:ceil(ih/2)*2:0:0");
      }
      args.push("-vf", filters.join(","));
      args.push("-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", outputPath);

      // Generous but finite: a wedged ffmpeg must not hang the run forever.
      const timeoutMs = Math.max(10 * 60_000, endT * 20_000);
      const res = spawnSync(FFMPEG_PATH, args, { stdio: ["ignore", "ignore", "pipe"], maxBuffer: 16 * 1024 * 1024, timeout: timeoutMs });
      if (res.error || res.status !== 0) {
        const tail = (res.stderr?.toString() ?? "").trim().split("\n").slice(-8).join("\n");
        throw new Error(
          `ffmpeg could not assemble ${frames.length} frames (exit ${res.status ?? res.error?.message}): ${tail || "no output"}`,
        );
      }
      return probeDuration(outputPath);
    },
  };
}
