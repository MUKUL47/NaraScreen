// ─── screencast recorder: crisp capture via CDP, not Playwright's VP8 ────────
//
// Playwright's built-in recordVideo uses VP8 at a fixed, low bitrate — UI text
// gets mushy with artifacts. Instead we drive Chrome DevTools Protocol's
// Page.startScreencast to pull high-quality JPEG frames, then assemble them with
// ffmpeg at CRF 18 (no VP8 anywhere). Crisp text, real quality.
//
// Frames arrive only when the page CHANGES (not at a fixed FPS). Each frame is
// timed by the wall clock when it is received — the same clock `now()` gives the
// runner for the trace, so trace times and video times agree. On stop we build a
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
  } = {},
): Promise<Screencast> {
  fs.mkdirSync(framesDir, { recursive: true });
  const client: CDPSession = await page.context().newCDPSession(page);

  const frames: { t: number; file: string }[] = [];
  let idx = 0;
  let stopped = false;
  let writeError: unknown = null;
  const started = Date.now();
  const elapsed = () => (Date.now() - started) / 1000;

  client.on("Page.screencastFrame", (frame: { data: string; sessionId: number }) => {
    // Ack immediately so Chrome keeps sending frames.
    void client.send("Page.screencastFrameAck", { sessionId: frame.sessionId }).catch(() => {});
    if (stopped) return;
    // Never throw from here: an exception in an event handler would be an
    // uncaught error that kills the whole process mid-recording.
    try {
      const t = elapsed();
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
      // clock started — without this the whole video would run early by its delay.
      const lines: string[] = [];
      for (let i = 0; i < frames.length; i++) {
        const cur = frames[i];
        const from = i === 0 ? 0 : cur.t;
        const next = i + 1 < frames.length ? frames[i + 1].t : endT;
        const dur = Math.max(0.001, next - from);
        lines.push(`file '${cur.file.replace(/'/g, "'\\''")}'`);
        lines.push(`duration ${dur.toFixed(4)}`);
      }
      // concat demuxer needs the last file repeated (its duration line is ignored).
      lines.push(`file '${frames[frames.length - 1].file.replace(/'/g, "'\\''")}'`);

      const listPath = path.join(framesDir, "frames.txt");
      fs.writeFileSync(listPath, lines.join("\n") + "\n");
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });

      // The concat list's per-frame `duration` lines encode real timing; -r 30
      // resamples that to a clean constant 30fps. (Do NOT add -vsync/-fps_mode —
      // it contradicts -r and ffmpeg errors out.)
      const args = ["-y", "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", listPath, "-r", "30"];
      if (opts.outputSize) {
        // lanczos = high-quality downscale of the supersampled frames. yuv420p
        // needs even dimensions: an odd viewport gets 1px of padding on the
        // right/bottom (rects stay valid — the origin doesn't move).
        const { width, height } = opts.outputSize;
        let vf = `scale=${width}:${height}:flags=lanczos`;
        if (width % 2 || height % 2) vf += `,pad=${width + (width % 2)}:${height + (height % 2)}:0:0`;
        args.push("-vf", vf);
      } else {
        args.push("-vf", "pad=ceil(iw/2)*2:ceil(ih/2)*2:0:0");
      }
      args.push("-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", outputPath);

      const res = spawnSync(FFMPEG_PATH, args, { stdio: ["ignore", "ignore", "pipe"], maxBuffer: 16 * 1024 * 1024 });
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
