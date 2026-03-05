import { BrowserWindow, screen } from "electron";
import * as path from "path";
import * as fs from "fs";
import { spawn, spawnSync, type ChildProcess } from "child_process";

let captureWindow: BrowserWindow | null = null;
let ffmpegProcess: ChildProcess | null = null;
let screenRecordProcess: ChildProcess | null = null;
let frameInterval: ReturnType<typeof setInterval> | null = null;
let screenTickInterval: ReturnType<typeof setInterval> | null = null;
let recordingStartTime: number = 0;
let recordingSessionDir: string = "";
let isScreenRecording: boolean = false;

export function createCaptureWindow(
  url: string,
  _parentWindow: BrowserWindow | null,
) {
  if (captureWindow && !captureWindow.isDestroyed()) {
    captureWindow.close();
    captureWindow = null;
  }

  captureWindow = new BrowserWindow({
    width: 1920,
    height: 1080,
    title: "NaraScreen Capture",
    resizable: true,
    webPreferences: {
      contextIsolation: false,
      nodeIntegration: false,
    },
  });

  captureWindow.loadURL(url);

  captureWindow.on("closed", () => {
    captureWindow = null;
  });
}

export function closeCaptureWindow() {
  if (captureWindow && !captureWindow.isDestroyed()) {
    captureWindow.close();
    captureWindow = null;
  }
}

export function startRecording(
  sessionDir: string,
  mainWindow: BrowserWindow | null,
) {
  if (!captureWindow || captureWindow.isDestroyed()) {
    throw new Error("Capture window not found");
  }

  const recordingsDir = path.join(sessionDir, "recordings");
  fs.mkdirSync(recordingsDir, { recursive: true });

  recordingSessionDir = sessionDir;
  recordingStartTime = Date.now();

  const videoPath = path.join(recordingsDir, "recording.mp4");

  const bounds = captureWindow.getContentBounds();
  // Ensure even dimensions for libx264
  const w = (bounds.width & ~1) || 1920;
  const h = (bounds.height & ~1) || 1080;

  console.log(`[recorder] Starting capturePage recording at ${w}x${h}`);

  // Spawn ffmpeg reading raw BGRA frames from stdin
  ffmpegProcess = spawn(
    "ffmpeg",
    [
      "-y",
      "-f", "rawvideo",
      "-pixel_format", "bgra",
      "-video_size", `${w}x${h}`,
      "-framerate", "30",
      "-i", "pipe:0",
      "-c:v", "libx264",
      "-preset", "ultrafast",
      "-pix_fmt", "yuv420p",
      videoPath,
    ],
    { stdio: ["pipe", "ignore", "pipe"] },
  );

  ffmpegProcess.stderr?.on("data", (data: Buffer) => {
    console.log("[recorder]", data.toString().trim());
  });

  ffmpegProcess.on("error", (err) => {
    console.error("[recorder] spawn error:", err.message);
  });

  ffmpegProcess.on("exit", (code, signal) => {
    console.log(`[recorder] exited code=${code} signal=${signal}`);
  });

  // Capture frames at ~30fps using capturePage
  let capturing = false;
  let frameCount = 0;
  frameInterval = setInterval(async () => {
    if (capturing || !captureWindow || captureWindow.isDestroyed()) return;
    if (!ffmpegProcess || !ffmpegProcess.stdin?.writable) return;

    capturing = true;
    try {
      const image = await captureWindow.webContents.capturePage();
      const size = image.getSize();

      // Resize to match ffmpeg expected dimensions if needed
      let finalImage = image;
      if (size.width !== w || size.height !== h) {
        finalImage = image.resize({ width: w, height: h });
      }

      const bitmap = finalImage.toBitmap();
      ffmpegProcess.stdin?.write(Buffer.from(bitmap));
      frameCount++;
      if (frameCount === 1) {
        console.log(`[recorder] First frame captured: ${size.width}x${size.height} -> ${w}x${h}`);
      }
    } catch {
      // Frame capture failed, skip
    }
    capturing = false;
  }, 33); // ~30fps

}

export async function stopRecording(): Promise<{
  videoPath: string;
  duration: number;
}> {
  const elapsed = (Date.now() - recordingStartTime) / 1000;

  // Stop frame capture
  if (frameInterval) {
    clearInterval(frameInterval);
    frameInterval = null;
  }

  // Close ffmpeg stdin to signal end of input, then wait for it to finish
  if (ffmpegProcess) {
    ffmpegProcess.stdin?.end();

    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        ffmpegProcess?.kill("SIGKILL");
        resolve();
      }, 10000);

      ffmpegProcess?.on("exit", () => {
        clearTimeout(timeout);
        resolve();
      });
    });

    ffmpegProcess = null;
  }

  const videoPath = path.join(
    recordingSessionDir,
    "recordings",
    "recording.mp4",
  );

  // Log file info for debugging
  if (fs.existsSync(videoPath)) {
    const stat = fs.statSync(videoPath);
    console.log(`[recorder] Video saved: ${videoPath} (${(stat.size / 1024 / 1024).toFixed(2)} MB)`);
  } else {
    console.error(`[recorder] Video file NOT found: ${videoPath}`);
  }

  return { videoPath, duration: elapsed };
}

// ---- Screen Recording (records actual screen, not a BrowserWindow) ----

/** Get available screens/monitors */
export function getScreenSources(): { id: string; name: string; x: number; y: number; width: number; height: number }[] {
  const displays = screen.getAllDisplays();
  return displays.map((d, i) => ({
    id: String(d.id),
    name: `Display ${i + 1} (${d.size.width}x${d.size.height})`,
    x: d.bounds.x,
    y: d.bounds.y,
    width: d.size.width,
    height: d.size.height,
  }));
}

/** Build platform-specific ffmpeg input args for screen capture */
function buildScreenGrabArgs(
  x: number,
  y: number,
  w: number,
  h: number,
): string[] {
  const platform = process.platform;

  if (platform === "linux") {
    const display = process.env.DISPLAY || ":0";
    return [
      "-f", "x11grab",
      "-framerate", "30",
      "-video_size", `${w}x${h}`,
      "-i", `${display}+${x},${y}`,
    ];
  }

  if (platform === "darwin") {
    // avfoundation: device index "1" is typically the screen
    // Use -capture_cursor 1 to include cursor, -framerate for fps
    // crop_region is offset_x:offset_y:width:height (avfoundation >= ffmpeg 4.4)
    return [
      "-f", "avfoundation",
      "-framerate", "30",
      "-capture_cursor", "1",
      "-i", "1:none",
      "-vf", `crop=${w}:${h}:${x}:${y}`,
    ];
  }

  if (platform === "win32") {
    // gdigrab: capture desktop with offset
    return [
      "-f", "gdigrab",
      "-framerate", "30",
      "-offset_x", String(x),
      "-offset_y", String(y),
      "-video_size", `${w}x${h}`,
      "-i", "desktop",
    ];
  }

  // Fallback: try x11grab
  console.warn(`[screen-rec] Unknown platform "${platform}", falling back to x11grab`);
  const display = process.env.DISPLAY || ":0";
  return [
    "-f", "x11grab",
    "-framerate", "30",
    "-video_size", `${w}x${h}`,
    "-i", `${display}+${x},${y}`,
  ];
}

/** Start recording the screen using ffmpeg (cross-platform) */
export function startScreenRecording(
  sessionDir: string,
  mainWindow: BrowserWindow | null,
  opts: { displayId?: string; x?: number; y?: number; width?: number; height?: number } = {},
) {
  const recordingsDir = path.join(sessionDir, "recordings");
  fs.mkdirSync(recordingsDir, { recursive: true });

  recordingSessionDir = sessionDir;
  recordingStartTime = Date.now();
  isScreenRecording = true;

  const videoPath = path.join(recordingsDir, "recording.mp4");

  // Determine capture region
  let captureX = opts.x ?? 0;
  let captureY = opts.y ?? 0;
  let captureW = opts.width ?? 1920;
  let captureH = opts.height ?? 1080;

  if (opts.displayId) {
    const displays = screen.getAllDisplays();
    const target = displays.find((d) => String(d.id) === opts.displayId);
    if (target) {
      captureX = target.bounds.x;
      captureY = target.bounds.y;
      captureW = target.size.width;
      captureH = target.size.height;
    }
  }

  // Ensure even dimensions for libx264
  captureW = captureW & ~1;
  captureH = captureH & ~1;

  // Build platform-specific ffmpeg input args
  const inputArgs = buildScreenGrabArgs(captureX, captureY, captureW, captureH);

  console.log(`[screen-rec] Starting screen recording on ${process.platform}: ${captureW}x${captureH} at (${captureX},${captureY})`);

  screenRecordProcess = spawn("ffmpeg", [
    "-y",
    ...inputArgs,
    "-c:v", "libx264",
    "-preset", "ultrafast",
    "-pix_fmt", "yuv420p",
    videoPath,
  ], { stdio: ["pipe", "ignore", "pipe"] });

  screenRecordProcess.stderr?.on("data", (data: Buffer) => {
    console.log("[screen-rec]", data.toString().trim());
  });

  screenRecordProcess.on("error", (err) => {
    console.error("[screen-rec] spawn error:", err.message);
  });

  screenRecordProcess.on("exit", (code, signal) => {
    console.log(`[screen-rec] exited code=${code} signal=${signal}`);
  });

  // Tick every second to update timer
  let tickCount = 0;
  screenTickInterval = setInterval(() => {
    tickCount++;
    mainWindow?.webContents.send("recording-tick", { elapsed: tickCount });
  }, 1000);
}

/** Stop screen recording */
export async function stopScreenRecording(): Promise<{ videoPath: string; duration: number }> {
  const elapsed = (Date.now() - recordingStartTime) / 1000;
  isScreenRecording = false;

  // Stop tick timer
  if (screenTickInterval) {
    clearInterval(screenTickInterval);
    screenTickInterval = null;
  }

  // Send 'q' to ffmpeg for graceful stop, then force-kill as backup
  if (screenRecordProcess) {
    screenRecordProcess.stdin?.write("q");

    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        // SIGINT not available on Windows, use kill() which sends SIGTERM
        if (process.platform === "win32") {
          screenRecordProcess?.kill();
        } else {
          screenRecordProcess?.kill("SIGINT");
        }
        setTimeout(() => {
          screenRecordProcess?.kill("SIGKILL");
          resolve();
        }, 3000);
      }, 5000);

      screenRecordProcess?.on("exit", () => {
        clearTimeout(timeout);
        resolve();
      });
    });

    screenRecordProcess = null;
  }

  const videoPath = path.join(recordingSessionDir, "recordings", "recording.mp4");

  if (fs.existsSync(videoPath)) {
    const stat = fs.statSync(videoPath);
    console.log(`[screen-rec] Video saved: ${videoPath} (${(stat.size / 1024 / 1024).toFixed(2)} MB)`);
  } else {
    console.error(`[screen-rec] Video file NOT found: ${videoPath}`);
  }

  // Get actual duration via ffprobe
  let duration = elapsed;
  try {
    const result = spawnSync("ffprobe", [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      videoPath,
    ]);
    const d = parseFloat(result.stdout.toString().trim());
    if (!isNaN(d)) duration = d;
  } catch { /* use elapsed */ }

  return { videoPath, duration };
}
