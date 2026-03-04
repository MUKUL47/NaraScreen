import { spawnSync } from "child_process";
import * as fs from "fs";

export const KOKORO_PYTHON = process.env.KOKORO_PYTHON || "python3";

export function generateTTSViaKokoro(
  text: string,
  voice: string,
  speed: number,
  langCode: string,
  outputPath: string,
): { status: number | null; stderr: string } {
  const pyScript = `
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

  const result = spawnSync(KOKORO_PYTHON, [
    "-c", pyScript,
    text, voice, String(speed), langCode, outputPath,
  ], { timeout: 120000, encoding: "utf-8" });

  return {
    status: result.status,
    stderr: (result.stderr || "").toString(),
  };
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
