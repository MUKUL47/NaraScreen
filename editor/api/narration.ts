// ─── narration: script narration text → cached WAV clips (Kokoro) ────
//
// Generates the voiceover for one language BEFORE compiling, so the compiler
// knows every clip's real length (auto overlay durations depend on it) and the
// producer only has to copy files. The desktop producer's own TTS fallback
// (curl, errors ignored) is never relied on: every problem here becomes an
// AgentError the agent can act on — TTS_UNAVAILABLE (engine not reachable) or
// TTS_FAILED (engine rejected a clip / returned junk).
//
// Clips are content-addressed: audio/tts_<sha256(lang|voice|speed|text)>.wav,
// so re-producing after a text-only edit regenerates only the changed lines.
// Pre-recorded `audio` files skip TTS: they become clips as they are (voice
// "recorded"), so the compiler still knows their length.

import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { spawnSync } from "child_process";
import { probeDuration } from "../electron/ffmpeg";
import { generateTTSViaKokoro } from "../electron/tts";
import { DEFAULT_VOICES, LANG_CODES } from "../src/lib/voices";
import { AgentError } from "./errors";
import { stage, type Log } from "./output";
import { DEFAULT_KOKORO_ENDPOINT, isFx, type AudioSource, type DemoScript, type NarrationText } from "./schema";

export interface NarrationClip {
  /** `${stepId}:${entryIndex}`, or `${stepId}:${entryIndex}:t${k}` for target k of a multi-target zoom */
  key: string;
  step: string;
  entry: number;
  lang: string;
  /** Kokoro voice, or "recorded" for a pre-recorded `audio` file */
  voice: string;
  speed: number;
  /** spoken text ("" for recorded audio without text) */
  text: string;
  /** absolute: a .wav in audioDir, or the recorded file itself */
  audioPath: string;
  durationSec: number;
  cached: boolean;
}

export interface TtsTarget {
  mode: "http" | "python";
  endpoint?: string;
  python?: string;
}

const HTTP_TIMEOUT_MS = 120_000;
const CHECK_TIMEOUT_MS = 5_000;
const MIN_WAV_BYTES = 1024;

const DOCKER_FIX = "docker run -d --name narascreen-kokoro -p 8880:8880 ghcr.io/remsky/kokoro-fastapi-cpu:latest";
const UNAVAILABLE_HINT =
  `Start the Kokoro speech engine, then retry. Run \`narascreen doctor\` to check it. ` +
  `Typical fix: \`${DOCKER_FIX}\` (the first start downloads the model — give it a minute). ` +
  `If Kokoro runs elsewhere, set tts.kokoroEndpoint in the script.`;

// ─── target selection ────────────────────────────────────────────────

/** KOKORO_PYTHON (an existing absolute path) → run Kokoro in-process via
 *  Python; otherwise talk to the OpenAI-compatible HTTP endpoint. */
export function resolveTtsTarget(script?: DemoScript): TtsTarget {
  const py = process.env.KOKORO_PYTHON;
  if (py && path.isAbsolute(py) && fs.existsSync(py)) return { mode: "python", python: py };
  return { mode: "http", endpoint: script?.tts?.kokoroEndpoint ?? DEFAULT_KOKORO_ENDPOINT };
}

/** The models listing next to a speech endpoint: …/v1/audio/speech → …/v1/models
 *  (keeps any path prefix a reverse proxy adds); otherwise <origin>/v1/models. */
function modelsUrl(endpoint: string): string {
  const u = new URL(endpoint);
  if (/\/audio\/speech\/?$/.test(u.pathname)) {
    u.pathname = u.pathname.replace(/\/audio\/speech\/?$/, "/models");
    u.search = "";
    return u.toString();
  }
  return `${u.origin}/v1/models`;
}

/** Cheap reachability probe for `doctor` (does not synthesize anything). */
export async function checkTts(target: TtsTarget): Promise<{ ok: boolean; detail: string }> {
  if (target.mode === "python") {
    const py = target.python ?? process.env.KOKORO_PYTHON ?? "python3";
    // Importing kokoro pulls in torch — slow, hence the generous timeout.
    const r = spawnSync(py, ["-c", "import kokoro, soundfile"], { timeout: 60_000, encoding: "utf-8" });
    if (r.status === 0) return { ok: true, detail: `Kokoro Python package importable via ${py}` };
    const why = r.error ? r.error.message : lastLines(r.stderr ?? "", 2) || `exit ${r.status}`;
    return { ok: false, detail: `KOKORO_PYTHON=${py} cannot import kokoro/soundfile: ${why}` };
  }
  const endpoint = target.endpoint ?? DEFAULT_KOKORO_ENDPOINT;
  let url: string;
  try {
    url = modelsUrl(endpoint);
  } catch {
    return { ok: false, detail: `tts.kokoroEndpoint is not a valid URL: ${endpoint}` };
  }
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(CHECK_TIMEOUT_MS) });
    if (!res.ok) return { ok: false, detail: `GET ${url} → HTTP ${res.status} (is ${endpoint} a Kokoro endpoint?)` };
    let models = "";
    try {
      const body = (await res.json()) as { data?: { id?: string }[] };
      models = (body.data ?? []).map((m) => m.id).filter(Boolean).slice(0, 6).join(", ");
    } catch {
      /* a non-JSON 200 still means something is listening */
    }
    return { ok: true, detail: `Kokoro reachable at ${endpoint}${models ? ` (models: ${models})` : ""}` };
  } catch (err) {
    return { ok: false, detail: `Kokoro not reachable at ${endpoint}: ${fetchErrorText(err)}` };
  }
}

// ─── text + voice resolution (shared with the compiler) ──────────────

/** What can speak: a narrate/zoom fx or one zoom target. */
export interface NarrationSource {
  narrate?: NarrationText;
  audio?: AudioSource;
  lang?: string;
  voice?: string;
}

/** Resolve a narrate value (string | per-language map) for the produce
 *  language. `src.lang` forces a language. A plain string is spoken in the
 *  wanted language; a map uses its entry for that language, else "en". */
export function resolveNarration(src: NarrationSource, lang: string): { lang: string; text: string } | null {
  const want = src.lang ?? lang;
  if (typeof src.narrate === "string") {
    return src.narrate.trim() ? { lang: want, text: src.narrate } : null;
  }
  if (src.narrate && typeof src.narrate === "object") {
    const has = src.narrate[want] != null;
    const text = has ? src.narrate[want] : src.narrate["en"];
    return text?.trim() ? { lang: has ? want : "en", text } : null;
  }
  return null;
}

/** Pre-recorded audio for the produce language: a single file is used for
 *  every language; a per-language map picks audio[lang] ?? audio.en. Paths are
 *  absolute after validation. */
export function resolveAudio(src: NarrationSource, lang: string): { lang: string; path: string } | null {
  const want = src.lang ?? lang;
  if (typeof src.audio === "string") return { lang: want, path: src.audio };
  if (src.audio && typeof src.audio === "object") {
    if (src.audio[want]) return { lang: want, path: src.audio[want] };
    if (src.audio.en) return { lang: "en", path: src.audio.en };
  }
  return null;
}

/** Script-level voice for a language: tts.voices[lang] → legacy voiceEn/voiceHi
 *  → first catalog voice for the language → "af_heart". */
export function scriptVoice(script: DemoScript, lang: string): string {
  const tts = script.tts;
  return (
    tts?.voices?.[lang] ??
    (lang === "en" ? tts?.voiceEn : undefined) ??
    (lang === "hi" ? tts?.voiceHi : undefined) ??
    DEFAULT_VOICES[lang]?.[0] ??
    "af_heart"
  );
}

/** fx.voice wins over everything the script sets. `lang` is the language the
 *  text is actually spoken in (resolveNarration's result). */
export function resolveVoice(script: DemoScript, fx: { voice?: string }, lang: string): string {
  return fx.voice ?? scriptVoice(script, lang);
}

/** Every entry that speaks, with its clip key:
 *    `${step}:${i}`        narrate fx, or a zoom's own narrate/audio
 *    `${step}:${i}:t${k}`  target k of a multi-target zoom
 *  Disabled fx are left out (they are not in the video). */
export function narrationSlots(script: DemoScript): {
  key: string; step: string; entry: number; path: string; src: NarrationSource;
}[] {
  const out: ReturnType<typeof narrationSlots> = [];
  const speaks = (x: NarrationSource) => x.narrate != null || x.audio != null;
  script.steps.forEach((beat, s) => {
    beat.beat.forEach((e, i) => {
      if (!isFx(e) || e.disabled) return;
      const base = { step: beat.id, entry: i };
      if (e.fx === "zoom" && e.targets?.length) {
        e.targets.forEach((t, k) => {
          if (!speaks(t)) return;
          // A target inherits the zoom's voice/lang unless it sets its own.
          const src = { ...t, lang: t.lang ?? e.lang, voice: t.voice ?? e.voice };
          out.push({ ...base, key: `${beat.id}:${i}:t${k}`, path: `steps[${s}].beat[${i}].targets[${k}]`, src });
        });
      } else if ((e.fx === "narrate" || e.fx === "zoom") && speaks(e)) {
        out.push({ ...base, key: `${beat.id}:${i}`, path: `steps[${s}].beat[${i}]`, src: e });
      }
    });
  });
  return out;
}

// ─── synthesis ───────────────────────────────────────────────────────

interface Job {
  key: string;
  step: string;
  entry: number;
  path: string; // steps[s].beat[i] (…targets[k])
  lang: string;
  voice: string;
  text: string;
  /** pre-recorded file: used as-is, no TTS */
  recorded?: string;
}

function collectJobs(script: DemoScript, lang: string): Job[] {
  const jobs: Job[] = [];
  for (const slot of narrationSlots(script)) {
    const base = { key: slot.key, step: slot.step, entry: slot.entry, path: slot.path };
    const narr = resolveNarration(slot.src, lang);
    const audio = resolveAudio(slot.src, lang);
    if (audio) {
      // The text (if any) only feeds subtitles.
      jobs.push({ ...base, lang: narr?.lang ?? audio.lang, voice: "recorded", text: narr?.text ?? "", recorded: audio.path });
    } else if (narr) {
      jobs.push({ ...base, lang: narr.lang, voice: resolveVoice(script, slot.src, narr.lang), text: narr.text });
    }
    // Neither: unresolvable for this language — the compiler reports it with
    // context (produceLanguage compiles once before TTS so it surfaces first).
  }
  return jobs;
}

export function clipFileName(lang: string, voice: string, speed: number, text: string): string {
  const h = crypto.createHash("sha256").update(`${lang}|${voice}|${speed}|${text}`).digest("hex");
  return `tts_${h.slice(0, 16)}.wav`;
}

/**
 * Generate (or reuse) one clip per speaking entry — every `narrate` fx, every
 * `zoom` with `narrate`/`audio`, every speaking zoom target — for `lang`.
 * Recorded `audio` files are used in place (voice "recorded", never copied).
 * Sequential on purpose: Kokoro on CPU gains nothing from parallel requests
 * and the log stays readable.
 */
export async function synthesizeNarrations(
  script: DemoScript,
  lang: string,
  audioDir: string,
  log: Log,
): Promise<Map<string, NarrationClip>> {
  const dir = path.resolve(audioDir);
  fs.mkdirSync(dir, { recursive: true });
  const speed = script.tts?.speed ?? 1;
  const target = resolveTtsTarget(script);
  const jobs = collectJobs(script, lang);
  const clips = new Map<string, NarrationClip>();
  const recorded = jobs.filter((j) => j.recorded).length;

  stage(
    "tts",
    `Generating ${jobs.length} narration${jobs.length === 1 ? "" : "s"} [${lang}]${recorded ? ` (${recorded} recorded)` : ""}`,
    { lang, count: jobs.length, recorded, engine: target.mode === "http" ? target.endpoint : `python ${target.python}` },
  );

  for (const job of jobs) {
    const where = { step: job.step, entry: job.entry, path: job.path };
    let audioPath: string;
    let cached = false;
    if (job.recorded) {
      audioPath = job.recorded;
      const ok = fs.existsSync(audioPath) && probeDuration(audioPath) > 0;
      if (!ok) {
        throw new AgentError("TTS_FAILED", `The recorded audio for ${job.path} could not be read: ${audioPath}`, {
          hint: "The audio file could not be read. Check that the file exists and plays (wav/mp3/m4a/ogg/webm), then produce again.",
          where,
          details: { audio: audioPath, lang: job.lang },
        });
      }
    } else {
      audioPath = path.join(dir, clipFileName(job.lang, job.voice, speed, job.text));
      cached = wavProblem(audioPath) === null;
      if (!cached) {
        if (target.mode === "http") await synthesizeHttp(target.endpoint!, job, speed, audioPath);
        else synthesizePython(job, speed, audioPath);
        const problem = wavProblem(audioPath);
        if (problem) {
          fs.rmSync(audioPath, { force: true });
          throw new AgentError("TTS_FAILED", `The speech engine returned unusable audio for ${job.path}: ${problem}`, {
            hint: "Retry once. If it repeats, try another voice (`narascreen voices`) or simplify the text (unusual symbols).",
            where,
            details: { voice: job.voice, lang: job.lang, text: job.text.slice(0, 120) },
          });
        }
      }
    }
    const durationSec = probeDuration(audioPath);
    clips.set(job.key, {
      key: job.key,
      step: job.step,
      entry: job.entry,
      lang: job.lang,
      voice: job.voice,
      speed: job.recorded ? 1 : speed,
      text: job.text,
      audioPath,
      durationSec,
      cached,
    });
    const what = job.recorded ? `recorded ${path.basename(job.recorded)}` : job.voice;
    const preview = job.text.length > 48 ? `${job.text.slice(0, 47)}…` : job.text;
    log(`${job.key} [${job.lang}] ${what} ${durationSec.toFixed(1)}s${cached ? " (cached)" : ""}${preview ? ` "${preview}"` : ""}`);
  }
  return clips;
}

async function synthesizeHttp(endpoint: string, job: Job, speed: number, outPath: string): Promise<void> {
  const where = { step: job.step, entry: job.entry, path: job.path };
  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "kokoro", input: job.text, voice: job.voice, speed, response_format: "wav" }),
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
  } catch (err) {
    const timedOut = isTimeout(err);
    throw new AgentError(
      "TTS_UNAVAILABLE",
      timedOut
        ? `Kokoro at ${endpoint} did not answer within ${HTTP_TIMEOUT_MS / 1000}s (${job.path})`
        : `Kokoro is not reachable at ${endpoint}: ${fetchErrorText(err)}`,
      {
        hint: timedOut
          ? "The engine is overloaded or still loading its model. Wait a minute and retry; check it with `narascreen doctor`."
          : UNAVAILABLE_HINT,
        where,
        details: { endpoint, voice: job.voice, lang: job.lang },
      },
    );
  }

  const buf = Buffer.from(await res.arrayBuffer());
  if (res.status >= 400) {
    const body = errorBodyText(buf);
    throw new AgentError("TTS_FAILED", `Kokoro rejected the narration at ${job.path} (HTTP ${res.status})`, {
      hint:
        res.status === 404 || res.status === 405
          ? `${endpoint} is not a speech endpoint — tts.kokoroEndpoint should end in /v1/audio/speech.`
          : /voice/i.test(body)
            ? `Voice "${job.voice}" is not available. Pick one from \`narascreen voices --lang ${job.lang}\` (set tts.voices.${job.lang} or the entry's voice).`
            : res.status >= 500
              ? "The speech engine crashed on this text. Retry; if it repeats, simplify the text or try another voice."
              : "See details.body for the engine's reason, fix the narration/voice, and produce again.",
      where,
      details: { status: res.status, body, voice: job.voice, lang: job.lang },
    });
  }
  // Write-then-rename so an interrupted run never leaves a half file that a
  // later run would mistake for a cached clip.
  const tmp = `${outPath}.part-${process.pid}`;
  fs.writeFileSync(tmp, buf);
  fs.renameSync(tmp, outPath);
}

function synthesizePython(job: Job, speed: number, outPath: string): void {
  const where = { step: job.step, entry: job.entry, path: job.path };
  const tmp = `${outPath}.part-${process.pid}.wav`;
  const r = generateTTSViaKokoro(job.text, job.voice, speed, LANG_CODES[job.lang] ?? "a", tmp);
  if (r.status !== 0) {
    fs.rmSync(tmp, { force: true });
    const stderr = lastLines(r.stderr, 6).slice(-600);
    const missing = r.status === null || /No module named|ModuleNotFoundError|not found/i.test(stderr);
    throw new AgentError(
      missing ? "TTS_UNAVAILABLE" : "TTS_FAILED",
      r.status === null
        ? `Kokoro (Python) timed out or could not start for ${job.path}`
        : `Kokoro (Python) failed for ${job.path} (exit ${r.status})`,
      {
        hint: missing
          ? `KOKORO_PYTHON (${process.env.KOKORO_PYTHON}) cannot run Kokoro. Install it there (pip install kokoro soundfile), or unset KOKORO_PYTHON to use the HTTP engine: ${DOCKER_FIX}`
          : `Check the voice (\`narascreen voices --lang ${job.lang}\`) and details.stderr.`,
        where,
        details: { voice: job.voice, lang: job.lang, stderr },
      },
    );
  }
  fs.renameSync(tmp, outPath);
}

// ─── helpers ─────────────────────────────────────────────────────────

/** null when `file` is a plausible WAV clip, else why not. */
function wavProblem(file: string): string | null {
  if (!fs.existsSync(file)) return "no file";
  const size = fs.statSync(file).size;
  if (size <= MIN_WAV_BYTES) return `only ${size} bytes`;
  const fd = fs.openSync(file, "r");
  const head = Buffer.alloc(12);
  fs.readSync(fd, head, 0, 12, 0);
  fs.closeSync(fd);
  if (head.toString("ascii", 0, 4) !== "RIFF" || head.toString("ascii", 8, 12) !== "WAVE") {
    return `not a WAV file (starts with ${JSON.stringify(head.toString("latin1", 0, 12))})`;
  }
  if (!(probeDuration(file) > 0)) return "ffprobe reads no duration";
  return null;
}

/** Kokoro-FastAPI errors look like {"detail":{"message":"…"}}; keep ≤300 chars. */
function errorBodyText(buf: Buffer): string {
  const raw = buf.toString("utf-8");
  let text = raw;
  try {
    const j = JSON.parse(raw) as { detail?: unknown; error?: unknown; message?: unknown };
    const d = j.detail as { message?: string } | string | undefined;
    text = (typeof d === "object" && d?.message) || (typeof d === "string" && d) || String(j.message ?? j.error ?? raw);
  } catch {
    /* not JSON — keep raw */
  }
  return text.length > 300 ? `${text.slice(0, 299)}…` : text;
}

function isTimeout(err: unknown): boolean {
  const name = (err as { name?: string })?.name;
  return name === "TimeoutError" || name === "AbortError";
}

/** Node's fetch hides the useful part (ECONNREFUSED …) in err.cause. */
function fetchErrorText(err: unknown): string {
  if (isTimeout(err)) return "timed out";
  const e = err as { message?: string; cause?: { code?: string; message?: string } };
  const cause = e?.cause?.code ?? e?.cause?.message;
  return cause ? `${e.message ?? "fetch failed"} (${cause})` : (e?.message ?? String(err));
}

function lastLines(s: string, n: number): string {
  return s.trim().split("\n").filter((l) => l.trim()).slice(-n).join("\n");
}
