// ─── bridge/media: narration clips, waveforms, video import ──────────
//
// Everything here runs ffmpeg/ffprobe/Kokoro as async child processes or HTTP
// requests, never spawnSync: the main process must keep answering IPC while
// a clip is generated or a video is imported (D24, D30).

import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { probeDurationAsync, synthesizeClip } from "../../api/narration";
import type {
  AudioPeaks,
  TtsPreviewRequest,
  TtsPreviewResult,
  VideoImportRequest,
  VideoImportResult,
  VideoProbe,
} from "../../src/types/narascreen-ipc";
import { FFMPEG_PATH, FFPROBE_PATH } from "../bin-paths";
import { generateTTSViaKokoroAsync, KOKORO_PYTHON } from "../tts";
import { bridgeError, broadcast, toBridgeError } from "./util";

// ─── narration preview (the CLI's cache, so `make` reuses the clip) ──

const inFlight = new Map<string, Promise<TtsPreviewResult>>();

export function ttsPreview(req: TtsPreviewRequest): Promise<TtsPreviewResult> {
  if (!req || typeof req.audioDir !== "string" || !path.isAbsolute(req.audioDir)) {
    return Promise.reject(bridgeError("USAGE", "tts.preview needs an absolute audioDir"));
  }
  // The same clip asked twice at once (double click) is synthesized once.
  const key = JSON.stringify([path.resolve(req.audioDir), req.lang, req.voice, req.speed, req.text, req.endpoint ?? ""]);
  let p = inFlight.get(key);
  if (!p) {
    p = synthesizeClip(req)
      .catch((e: unknown) => {
        throw toBridgeError(e);
      })
      .finally(() => inFlight.delete(key));
    inFlight.set(key, p);
  }
  return p;
}

/** Legacy `tts:generate` (per-action files in <session>/audio), now async. Kept until the
 *  renderer has moved to tts.preview. */
export async function legacyGenerateTts(
  sessionDir: string,
  actionId: string,
  text: string,
  lang: string,
  voiceOverride?: string,
  langCodeOverride?: string,
): Promise<{ audioPath: string; duration: number }> {
  const project = JSON.parse(await fs.promises.readFile(path.join(sessionDir, "demo-project.json"), "utf-8"));
  const voice = voiceOverride || (lang === "hi" ? project.tts?.voiceHi || "hf_alpha" : project.tts?.voiceEn || "af_heart");
  const speed = project.tts?.speed || 1;
  const langCode = langCodeOverride || (lang === "hi" ? "h" : "a");
  const audioDir = path.join(sessionDir, "audio");
  await fs.promises.mkdir(audioDir, { recursive: true });
  const audioPath = path.join(audioDir, `${actionId}_${lang}.wav`);

  if (fs.existsSync(KOKORO_PYTHON)) {
    const r = await generateTTSViaKokoroAsync(text, voice, speed, langCode, audioPath);
    if (r.status !== 0) throw new Error(`Kokoro TTS failed: ${r.stderr.slice(0, 500)}`);
  } else {
    const base = process.env.KOKORO_URL || "http://localhost:8880";
    const endpoint = project.tts?.kokoroEndpoint || `${base}/v1/audio/speech`;
    let res: Response;
    try {
      res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "kokoro", input: text, voice, speed, response_format: "wav" }),
        signal: AbortSignal.timeout(60_000),
      });
    } catch (e) {
      throw new Error(`TTS HTTP failed (${e instanceof Error ? e.message : String(e)}). Is Kokoro running at ${endpoint}?`);
    }
    if (!res.ok) throw new Error(`TTS HTTP failed (HTTP ${res.status}). Is Kokoro running at ${endpoint}?`);
    await fs.promises.writeFile(audioPath, Buffer.from(await res.arrayBuffer()));
  }
  const st = await fs.promises.stat(audioPath).catch(() => null);
  if (!st || st.size < 100) throw new Error("TTS returned empty or invalid audio");
  return { audioPath, duration: await probeDurationAsync(audioPath) };
}

// ─── waveform peaks ──────────────────────────────────────────────────

const PEAK_RATE = 8000;
const peakCache = new Map<string, AudioPeaks>();

/** Max |sample| per bucket from a mono 8 kHz decode, 1 = the loudest bucket. */
export async function audioPeaks(file: string, bucketsPerSec = 50): Promise<AudioPeaks> {
  let st: fs.Stats;
  try {
    st = await fs.promises.stat(file);
  } catch {
    throw bridgeError("VIDEO_NOT_FOUND", `No such file: ${file}`);
  }
  const perBucket = Math.max(1, Math.round(PEAK_RATE / Math.min(1000, Math.max(1, bucketsPerSec || 50))));
  const bps = PEAK_RATE / perBucket;
  const key = `${path.resolve(file)}|${st.size}|${st.mtimeMs}|${perBucket}`;
  const hit = peakCache.get(key);
  if (hit) return hit;

  const peaks: number[] = [];
  let bucketMax = 0;
  let inBucket = 0;
  let samples = 0;
  let carry: Buffer | null = null;
  let stderr = "";
  const code = await new Promise<number | null>((resolve, reject) => {
    const ff = spawn(FFMPEG_PATH, ["-v", "error", "-i", file, "-map", "0:a:0", "-ac", "1", "-ar", String(PEAK_RATE), "-f", "s16le", "-acodec", "pcm_s16le", "pipe:1"], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    ff.stderr!.on("data", (d) => (stderr = (stderr + d).slice(-2000)));
    ff.stdout!.on("data", (chunk: Buffer) => {
      const buf: Buffer = carry ? Buffer.concat([carry, chunk]) : chunk;
      const even = buf.length & ~1;
      for (let i = 0; i < even; i += 2) {
        const v = Math.abs(buf.readInt16LE(i));
        if (v > bucketMax) bucketMax = v;
        samples++;
        if (++inBucket === perBucket) {
          peaks.push(bucketMax);
          bucketMax = 0;
          inBucket = 0;
        }
      }
      carry = even < buf.length ? buf.subarray(even) : null;
    });
    ff.on("error", reject);
    ff.on("close", resolve);
  });
  if (inBucket > 0) peaks.push(bucketMax);
  if (code !== 0 && samples === 0) {
    // No audio stream is an answer (an empty waveform), anything else an error.
    if (/matches no streams|does not contain any stream|Output file .* does not contain/i.test(stderr)) {
      return { peaks: [], bucketsPerSec: bps, durationSec: 0 };
    }
    throw bridgeError("RENDER_FAILED", `Could not read the audio of ${path.basename(file)}: ${stderr.trim().split("\n").pop() ?? `ffmpeg exit ${code}`}`);
  }
  const max = peaks.reduce((m, v) => (v > m ? v : m), 0);
  const result: AudioPeaks = {
    peaks: max > 0 ? peaks.map((v) => Math.round((v / max) * 1000) / 1000) : peaks.map(() => 0),
    bucketsPerSec: bps,
    durationSec: samples / PEAK_RATE,
  };
  if (peakCache.size >= 32) peakCache.delete(peakCache.keys().next().value!);
  peakCache.set(key, result);
  return result;
}

// ─── video probe + import ────────────────────────────────────────────

interface FfprobeJson {
  streams?: { codec_type?: string; codec_name?: string; pix_fmt?: string; width?: number; height?: number; avg_frame_rate?: string; r_frame_rate?: string }[];
  format?: { duration?: string; format_name?: string };
}

function ffprobeJson(file: string): Promise<FfprobeJson> {
  return new Promise((resolve, reject) => {
    let out = "";
    let err = "";
    const p = spawn(FFPROBE_PATH, ["-v", "error", "-show_entries", "stream=codec_type,codec_name,pix_fmt,width,height,avg_frame_rate,r_frame_rate:format=duration,format_name", "-of", "json", file], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    p.stdout!.on("data", (d) => (out += d));
    p.stderr!.on("data", (d) => (err = (err + d).slice(-2000)));
    p.on("error", reject);
    p.on("close", (code) => {
      if (code !== 0) return reject(bridgeError("VIDEO_NOT_FOUND", `Not a readable video: ${path.basename(file)} (${err.trim().split("\n").pop() ?? `ffprobe exit ${code}`})`));
      try {
        resolve(JSON.parse(out) as FfprobeJson);
      } catch {
        reject(bridgeError("VIDEO_NOT_FOUND", `ffprobe gave no information about ${path.basename(file)}`));
      }
    });
  });
}

const fraction = (s?: string) => {
  const [n, d] = (s ?? "").split("/").map(Number);
  const v = d ? n / d : n;
  return Number.isFinite(v) && v > 0 && v <= 240 ? v : 0;
};

export async function probeVideo(file: string): Promise<VideoProbe & { formatName: string; pixFmt?: string }> {
  if (!fs.existsSync(file)) throw bridgeError("VIDEO_NOT_FOUND", `No such file: ${file}`);
  const j = await ffprobeJson(file);
  const v = j.streams?.find((s) => s.codec_type === "video");
  if (!v) throw bridgeError("VIDEO_NOT_FOUND", `${path.basename(file)} has no video stream`);
  return {
    durationSec: Number(j.format?.duration) || 0,
    width: v.width ?? 0,
    height: v.height ?? 0,
    fps: fraction(v.avg_frame_rate) || fraction(v.r_frame_rate) || 30,
    hasAudio: !!j.streams?.some((s) => s.codec_type === "audio"),
    ...(v.codec_name ? { codec: v.codec_name } : {}),
    formatName: j.format?.format_name ?? "",
    pixFmt: v.pix_fmt,
  };
}

/** Copy or re-encode a picked video to <session>/recordings/recording.mp4 (streamed from disk). */
export async function importVideo(req: VideoImportRequest): Promise<VideoImportResult> {
  const src = path.resolve(req.src);
  const dest = path.join(path.resolve(req.sessionDir), "recordings", "recording.mp4");
  const info = await probeVideo(src);
  const strip = ({ formatName: _f, pixFmt: _p, ...rest }: typeof info): VideoProbe => rest;
  if (src === dest) return { ...strip(info), recordingPath: dest, normalized: false };

  const copyable =
    /mp4|mov/.test(info.formatName) && info.codec === "h264" && info.pixFmt === "yuv420p" && info.width % 2 === 0 && info.height % 2 === 0;
  const normalize = req.mode === "normalize" || (req.mode !== "copy" && !copyable);
  await fs.promises.mkdir(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.importing-${process.pid}.mp4`;
  const progress = (f: number) => broadcast("video:importProgress", { sessionDir: req.sessionDir, fraction: Math.max(0, Math.min(1, f)) });
  try {
    if (!normalize) {
      progress(0);
      await fs.promises.copyFile(src, tmp);
    } else {
      await transcode(src, tmp, info.hasAudio, info.durationSec, progress);
    }
    await fs.promises.rename(tmp, dest);
  } catch (e) {
    await fs.promises.rm(tmp, { force: true });
    throw e;
  }
  progress(1);
  const out = await probeVideo(dest);
  return { ...strip(out), recordingPath: dest, normalized: normalize };
}

/** The CLI's import encode (api/video-source.ts): H.264, 30 fps, even dimensions, AAC stereo. */
function transcode(src: string, out: string, hasAudio: boolean, durationSec: number, progress: (f: number) => void): Promise<void> {
  const args = ["-y", "-nostats", "-progress", "pipe:1", "-i", src, "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2", "-r", "30", "-c:v", "libx264", "-preset", "fast", "-crf", "18", "-pix_fmt", "yuv420p"];
  if (hasAudio) args.push("-c:a", "aac", "-b:a", "192k", "-ar", "44100", "-ac", "2");
  else args.push("-an");
  args.push(out);
  return new Promise((resolve, reject) => {
    let err = "";
    let last = 0;
    const ff = spawn(FFMPEG_PATH, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    ff.stdout!.setEncoding("utf8");
    ff.stdout!.on("data", (chunk: string) => {
      const m = /out_time_us=(\d+)/.exec(chunk) ?? /out_time_ms=(\d+)/.exec(chunk);
      const now = Date.now();
      if (m && durationSec > 0 && now - last > 250) {
        last = now;
        progress(Number(m[1]) / 1e6 / durationSec);
      }
    });
    ff.stderr!.on("data", (d) => (err = (err + d).slice(-4000)));
    ff.on("error", reject);
    ff.on("close", (code) => {
      if (code === 0) return resolve();
      reject(bridgeError("RECORDING_FAILED", `Could not import ${path.basename(src)} (ffmpeg exit ${code}): ${err.trim().split("\n").pop() ?? ""}`, "Check that the file plays in a normal video player; convert it to MP4 if it doesn't."));
    });
  });
}
