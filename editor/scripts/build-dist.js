#!/usr/bin/env node
/**
 * Build script that runs electron-builder with optional kokoro-venv bundling.
 * If kokoro-venv/ exists, it's included as an extraResource.
 * Usage: node scripts/build-dist.js [--linux|--mac|--win]
 *
 * Expects dist/, dist-electron/ and dist-cli/ to be built already
 * (`npm run build && npm run build:cli`, which `npm run dist` does).
 */
const { execSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const rootDir = path.join(__dirname, "..");
const venvDir = path.join(rootDir, "kokoro-venv");
const hasKokoro = fs.existsSync(venvDir);

// The packaged app runs its CLI from resources/dist-cli (see vite.cli.config.ts).
if (!fs.existsSync(path.join(rootDir, "dist-cli", "narascreen.cjs"))) {
  console.error("[build] dist-cli/narascreen.cjs is missing — run `npm run build:cli` first");
  process.exit(1);
}

// package.json's "build" config, plus kokoro-venv when present. Written to a
// config file of its own: a `-c.extraResources.N` override on the command line
// would replace the extraResources list package.json already has (dist-cli,
// playwright-core) instead of adding to it.
const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, "package.json"), "utf-8"));
const config = { ...pkg.build, extraResources: [...((pkg.build && pkg.build.extraResources) || [])] };
if (hasKokoro) {
  console.log("[build] kokoro-venv found — bundling Kokoro TTS into the app");
  config.extraResources.push({ from: "kokoro-venv", to: "kokoro-venv" });
} else {
  console.log("[build] No kokoro-venv found — building without Kokoro TTS");
  console.log("[build] Run 'bash scripts/setup-kokoro-venv.sh' to create one");
}
const configPath = path.join(os.tmpdir(), `narascreen-electron-builder-${process.pid}.json`);
fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

// Build platform flag from args
const platformFlag = process.argv.slice(2).join(" ");

// Construct electron-builder command
let cmd = `npx electron-builder --projectDir "${rootDir}" --config "${configPath}"`;
if (platformFlag) cmd += ` ${platformFlag}`;

console.log(`[build] ${cmd}\n`);
try {
  execSync(cmd, { stdio: "inherit", cwd: rootDir });
} finally {
  fs.rmSync(configPath, { force: true });
}
