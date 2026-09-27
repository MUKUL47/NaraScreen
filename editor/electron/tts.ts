import { spawn, spawnSync } from "child_process";
import * as path from "path";
import * as fs from "fs";

const IS_PACKAGED = !process.defaultApp && !process.execPath.includes("node_modules");

/**
 * Resolve Kokoro Python path.
 * Priority: KOKORO_PYTHON env var → bundled venv in resources → system python3
 */
function resolveKokoroPython(): string {
  if (process.env.KOKORO_PYTHON) return process.env.KOKORO_PYTHON;

  // Check for bundled Python venv in resources (if user bundles one)
  if (IS_PACKAGED && process.resourcesPath) {
    const ext = process.platform === "win32" ? ".exe" : "";
    const venvPython = path.join(process.resourcesPath, "kokoro-venv", "bin", "python3" + ext);
    const venvPythonWin = path.join(process.resourcesPath, "kokoro-venv", "Scripts", "python" + ext);
    if (fs.existsSync(venvPython)) return venvPython;
    if (fs.existsSync(venvPythonWin)) return venvPythonWin;
  }

  return "python3";
}

export const KOKORO_PYTHON = resolveKokoroPython();

/** Kokoro in Python: argv = text voice speed lang_code output → a 24 kHz WAV. */
const KOKORO_PY = `
import sys, json
from kokoro import KPipeline
import soundfile as sf

text = sys.argv[1]
voice = sys.argv[2]
speed = float(sys.argv[3])
lang_code = sys.argv[4]
output = sys.argv[5]

pipe = KPipeline(lang_code=lang_code)
audio_parts = []
for _, _, audio in pipe(text, voice=voice, speed=speed):
    audio_parts.append(audio)

import numpy as np
full_audio = np.concatenate(audio_parts)
sf.write(output, full_audio, 24000)
print(json.dumps({"samples": len(full_audio), "duration": len(full_audio) / 24000}))
`;

const KOKORO_TIMEOUT_MS = 120_000;

export function generateTTSViaKokoro(
  text: string,
  voice: string,
  speed: number,
  langCode: string,
  outputPath: string,
): { status: number | null; stderr: string } {
  const result = spawnSync(KOKORO_PYTHON, [
    "-c", KOKORO_PY,
    text, voice, String(speed), langCode, outputPath,
  ], { timeout: KOKORO_TIMEOUT_MS, encoding: "utf-8" });

  return {
    status: result.status,
    stderr: (result.stderr || "").toString(),
  };
}

/** generateTTSViaKokoro without blocking the caller's event loop (Electron main). */
export function generateTTSViaKokoroAsync(
  text: string,
  voice: string,
  speed: number,
  langCode: string,
  outputPath: string,
  python: string = KOKORO_PYTHON,
): Promise<{ status: number | null; stderr: string }> {
  return new Promise((resolve) => {
    let stderr = "";
    let settled = false;
    const done = (status: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ status, stderr });
    };
    const child = spawn(python, ["-c", KOKORO_PY, text, voice, String(speed), langCode, outputPath], {
      stdio: ["ignore", "ignore", "pipe"],
      windowsHide: true,
    });
    child.stderr!.setEncoding("utf-8");
    child.stderr!.on("data", (d: string) => (stderr = (stderr + d).slice(-8000)));
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      done(null);
    }, KOKORO_TIMEOUT_MS);
    child.on("error", (e) => {
      stderr += e.message;
      done(null);
    });
    child.on("close", (code) => done(code));
  });
}

export function generateTTSViaCurl(
  text: string,
  voice: string,
  speed: number,
  endpoint: string,
  outputPath: string,
): { status: number | null; stderr: string } {
  const result = spawnSync("curl", [
    "-s", "--fail",
    "--connect-timeout", "5",
    "--max-time", "60",
    "-X", "POST", endpoint,
    "-H", "Content-Type: application/json",
    "-d", JSON.stringify({
      model: "kokoro",
      input: text,
      voice,
      speed,
      response_format: "wav",
    }),
    "-o", outputPath,
  ]);

  return {
    status: result.status,
    stderr: (result.stderr || "").toString(),
  };
}

/** Generate TTS audio, trying direct Kokoro Python first, then HTTP API fallback */
export function generateTTS(
  text: string,
  voice: string,
  speed: number,
  langCode: string,
  outputPath: string,
  httpEndpoint?: string,
): { status: number | null; stderr: string } {
  if (fs.existsSync(KOKORO_PYTHON)) {
    return generateTTSViaKokoro(text, voice, speed, langCode, outputPath);
  }
  const kokoroBase = process.env.KOKORO_URL || "http://localhost:8880";
  const endpoint = httpEndpoint || `${kokoroBase}/v1/audio/speech`;
  return generateTTSViaCurl(text, voice, speed, endpoint, outputPath);
}
