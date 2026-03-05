#!/usr/bin/env node
/**
 * Build script that runs electron-builder with optional kokoro-venv bundling.
 * If kokoro-venv/ exists, it's included as an extraResource.
 * Usage: node scripts/build-dist.js [--linux|--mac|--win]
 */
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const rootDir = path.join(__dirname, "..");
const venvDir = path.join(rootDir, "kokoro-venv");
const hasKokoro = fs.existsSync(venvDir);

// Build platform flag from args
const platformFlag = process.argv.slice(2).join(" ");

// Construct electron-builder command
let cmd = "npx electron-builder";
if (platformFlag) cmd += ` ${platformFlag}`;

// If kokoro-venv exists, add it as extraResource via CLI config
if (hasKokoro) {
  console.log("[build] kokoro-venv found — bundling Kokoro TTS into the app");
  cmd += ` -c.extraResources.0.from=kokoro-venv -c.extraResources.0.to=kokoro-venv`;
} else {
  console.log("[build] No kokoro-venv found — building without Kokoro TTS");
  console.log("[build] Run 'bash scripts/setup-kokoro-venv.sh' to create one");
}

console.log(`[build] ${cmd}\n`);
execSync(cmd, { stdio: "inherit", cwd: rootDir });
