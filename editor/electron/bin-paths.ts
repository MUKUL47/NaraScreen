import * as path from "path";
import * as fs from "fs";

/**
 * Resolve paths to bundled ffmpeg/ffprobe binaries.
 *
 * In packaged Electron app: process.resourcesPath points to the resources folder.
 * In dev: uses ffmpeg-static / ffprobe-static npm packages.
 * Fallback: system PATH (just "ffmpeg" / "ffprobe").
 *
 * This module avoids importing "electron" so it works in Worker Threads too.
 */

const IS_PACKAGED = !process.defaultApp && !process.execPath.includes("node_modules");

function systemBinaryExists(name: string): boolean {
  try {
    const { execSync } = require("child_process");
    execSync(`which ${name}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function findBinary(name: "ffmpeg" | "ffprobe"): string {
  // 1. Packaged app — binaries in resources/bin/
  if (IS_PACKAGED && process.resourcesPath) {
    const ext = process.platform === "win32" ? ".exe" : "";
    const p = path.join(process.resourcesPath, "bin", name + ext);
    if (fs.existsSync(p)) return p;
  }

  // 2. System PATH — preferred in dev mode because ffmpeg-static lacks
  //    drawtext/libfreetype and other filters needed for callout effects
  if (systemBinaryExists(name)) {
    return name;
  }

  // 3. Dev mode fallback — npm static packages (limited filter support)
  try {
    if (name === "ffmpeg") {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const ffmpegPath = require("ffmpeg-static");
      if (ffmpegPath && fs.existsSync(ffmpegPath)) return ffmpegPath;
    }
    if (name === "ffprobe") {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const ffprobePath = require("ffprobe-static").path;
      if (ffprobePath && fs.existsSync(ffprobePath)) return ffprobePath;
    }
  } catch {
    // npm packages not available
  }

  // 4. Last resort
  return name;
}

export const FFMPEG_PATH = findBinary("ffmpeg");
export const FFPROBE_PATH = findBinary("ffprobe");

console.log(`[bin-paths] ffmpeg: ${FFMPEG_PATH}`);
console.log(`[bin-paths] ffprobe: ${FFPROBE_PATH}`);
