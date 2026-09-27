"use strict";
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const child_process = require("child_process");
const index = require("./job-W-Szny1w.cjs");
function _interopNamespaceDefault(e) {
  const n = Object.create(null, { [Symbol.toStringTag]: { value: "Module" } });
  if (e) {
    for (const k in e) {
      if (k !== "default") {
        const d = Object.getOwnPropertyDescriptor(e, k);
        Object.defineProperty(n, k, d.get ? d : {
          enumerable: true,
          get: () => e[k]
        });
      }
    }
  }
  n.default = e;
  return Object.freeze(n);
}
const crypto__namespace = /* @__PURE__ */ _interopNamespaceDefault(crypto);
const fs__namespace = /* @__PURE__ */ _interopNamespaceDefault(fs);
const path__namespace = /* @__PURE__ */ _interopNamespaceDefault(path);
const IS_PACKAGED = !process.defaultApp && !process.execPath.includes("node_modules");
function resolveKokoroPython() {
  if (process.env.KOKORO_PYTHON) return process.env.KOKORO_PYTHON;
  if (IS_PACKAGED && process.resourcesPath) {
    const ext = process.platform === "win32" ? ".exe" : "";
    const venvPython = path__namespace.join(process.resourcesPath, "kokoro-venv", "bin", "python3" + ext);
    const venvPythonWin = path__namespace.join(process.resourcesPath, "kokoro-venv", "Scripts", "python" + ext);
    if (fs__namespace.existsSync(venvPython)) return venvPython;
    if (fs__namespace.existsSync(venvPythonWin)) return venvPythonWin;
  }
  return "python3";
}
const KOKORO_PYTHON = resolveKokoroPython();
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
const KOKORO_TIMEOUT_MS = 12e4;
function generateTTSViaKokoro(text, voice, speed, langCode, outputPath) {
  const result = child_process.spawnSync(KOKORO_PYTHON, [
    "-c",
    KOKORO_PY,
    text,
    voice,
    String(speed),
    langCode,
    outputPath
  ], { timeout: KOKORO_TIMEOUT_MS, encoding: "utf-8" });
  return {
    status: result.status,
    stderr: (result.stderr || "").toString()
  };
}
function generateTTSViaKokoroAsync(text, voice, speed, langCode, outputPath, python = KOKORO_PYTHON) {
  return new Promise((resolve) => {
    let stderr = "";
    let settled = false;
    const done = (status) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ status, stderr });
    };
    const child = child_process.spawn(python, ["-c", KOKORO_PY, text, voice, String(speed), langCode, outputPath], {
      stdio: ["ignore", "ignore", "pipe"],
      windowsHide: true
    });
    child.stderr.setEncoding("utf-8");
    child.stderr.on("data", (d) => stderr = (stderr + d).slice(-8e3));
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
function generateTTSViaCurl(text, voice, speed, endpoint, outputPath) {
  const result = child_process.spawnSync("curl", [
    "-s",
    "--fail",
    "--connect-timeout",
    "5",
    "--max-time",
    "60",
    "-X",
    "POST",
    endpoint,
    "-H",
    "Content-Type: application/json",
    "-d",
    JSON.stringify({
      model: "kokoro",
      input: text,
      voice,
      speed,
      response_format: "wav"
    }),
    "-o",
    outputPath
  ]);
  return {
    status: result.status,
    stderr: (result.stderr || "").toString()
  };
}
function generateTTS(text, voice, speed, langCode, outputPath, httpEndpoint) {
  if (fs__namespace.existsSync(KOKORO_PYTHON)) {
    return generateTTSViaKokoro(text, voice, speed, langCode, outputPath);
  }
  const kokoroBase = process.env.KOKORO_URL || "http://localhost:8880";
  const endpoint = httpEndpoint || `${kokoroBase}/v1/audio/speech`;
  return generateTTSViaCurl(text, voice, speed, endpoint, outputPath);
}
const HTTP_TIMEOUT_MS = 12e4;
const CHECK_TIMEOUT_MS = 5e3;
const MIN_WAV_BYTES = 1024;
const DOCKER_FIX = "docker run -d --name narascreen-kokoro -p 8880:8880 ghcr.io/remsky/kokoro-fastapi-cpu:latest";
const UNAVAILABLE_HINT = `Start the Kokoro speech engine, then retry. Run \`narascreen doctor\` to check it. Typical fix: \`${DOCKER_FIX}\` (the first start downloads the model — give it a minute). If Kokoro runs elsewhere, set tts.kokoroEndpoint in the script.`;
function resolveTtsTarget(script) {
  const py = process.env.KOKORO_PYTHON;
  if (py && path__namespace.isAbsolute(py) && fs__namespace.existsSync(py)) return { mode: "python", python: py };
  return { mode: "http", endpoint: script?.tts?.kokoroEndpoint ?? index.DEFAULT_KOKORO_ENDPOINT };
}
function modelsUrl(endpoint) {
  const u = new URL(endpoint);
  if (/\/audio\/speech\/?$/.test(u.pathname)) {
    u.pathname = u.pathname.replace(/\/audio\/speech\/?$/, "/models");
    u.search = "";
    return u.toString();
  }
  return `${u.origin}/v1/models`;
}
async function checkTts(target) {
  if (target.mode === "python") {
    const py = target.python ?? process.env.KOKORO_PYTHON ?? "python3";
    const r = child_process.spawnSync(py, ["-c", "import kokoro, soundfile"], { timeout: 6e4, encoding: "utf-8" });
    if (r.status === 0) return { ok: true, detail: `Kokoro Python package importable via ${py}` };
    const why = r.error ? r.error.message : lastLines(r.stderr ?? "", 2) || `exit ${r.status}`;
    return { ok: false, detail: `KOKORO_PYTHON=${py} cannot import kokoro/soundfile: ${why}` };
  }
  const endpoint = target.endpoint ?? index.DEFAULT_KOKORO_ENDPOINT;
  let url;
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
      const body = await res.json();
      models = (body.data ?? []).map((m) => m.id).filter(Boolean).slice(0, 6).join(", ");
    } catch {
    }
    return { ok: true, detail: `Kokoro reachable at ${endpoint}${models ? ` (models: ${models})` : ""}` };
  } catch (err) {
    return { ok: false, detail: `Kokoro not reachable at ${endpoint}: ${fetchErrorText(err)}` };
  }
}
function resolveNarration(src, lang) {
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
function narrationLanguageNote(src, lang) {
  if (src.audio != null) return null;
  const want = src.lang ?? lang;
  if (src.narrate && typeof src.narrate === "object" && src.narrate[want] == null && src.narrate.en != null) {
    return `no ${want} narration — used en (spoken with an English voice). Add "${want}": "…" to the narrate map.`;
  }
  if (typeof src.narrate === "string" && !src.lang && lang !== "en") {
    return `a plain-string narration is spoken as ${lang}. If the text isn't ${lang}, use a map like {"en": "…", "${lang}": "…"} or set "lang".`;
  }
  return null;
}
function resolveAudio(src, lang) {
  const want = src.lang ?? lang;
  if (typeof src.audio === "string") return { lang: want, path: src.audio };
  if (src.audio && typeof src.audio === "object") {
    if (src.audio[want]) return { lang: want, path: src.audio[want] };
    if (src.audio.en) return { lang: "en", path: src.audio.en };
  }
  return null;
}
function scriptVoice(script, lang) {
  const tts = script.tts;
  return tts?.voices?.[lang] ?? (lang === "en" ? tts?.voiceEn : void 0) ?? (lang === "hi" ? tts?.voiceHi : void 0) ?? index.DEFAULT_VOICES[lang]?.[0] ?? "af_heart";
}
function resolveVoice(script, fx, lang) {
  return fx.voice ?? scriptVoice(script, lang);
}
function narrationSlots(script) {
  const out = [];
  const speaks = (x) => x.narrate != null || x.audio != null;
  script.steps.forEach((beat, s) => {
    beat.beat.forEach((e, i) => {
      if (!index.isFx(e) || e.disabled) return;
      const base = { step: beat.id, entry: i };
      if (e.fx === "zoom" && e.targets?.length) {
        e.targets.forEach((t, k) => {
          if (!speaks(t)) return;
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
function collectJobs(script, lang) {
  const jobs = [];
  for (const slot of narrationSlots(script)) {
    const base = { key: slot.key, step: slot.step, entry: slot.entry, path: slot.path };
    const narr = resolveNarration(slot.src, lang);
    const audio = resolveAudio(slot.src, lang);
    if (audio) {
      jobs.push({ ...base, lang: narr?.lang ?? audio.lang, voice: "recorded", text: narr?.text ?? "", recorded: audio.path });
    } else if (narr) {
      const fellBack = narr.lang !== (slot.src.lang ?? lang);
      const voice = fellBack ? scriptVoice(script, narr.lang) : resolveVoice(script, slot.src, narr.lang);
      jobs.push({ ...base, lang: narr.lang, voice, text: narr.text });
    }
  }
  return jobs;
}
function clipFileName(lang, voice, speed, text) {
  const h = crypto__namespace.createHash("sha256").update(`${lang}|${voice}|${speed}|${text}`).digest("hex");
  return `tts_${h.slice(0, 16)}.wav`;
}
async function synthesizeNarrations(script, lang, audioDir, log) {
  const dir = path__namespace.resolve(audioDir);
  fs__namespace.mkdirSync(dir, { recursive: true });
  const speed = script.tts?.speed ?? 1;
  const target = resolveTtsTarget(script);
  const jobs = collectJobs(script, lang);
  const clips = /* @__PURE__ */ new Map();
  const recorded = jobs.filter((j) => j.recorded).length;
  index.stage(
    "tts",
    `Generating ${jobs.length} narration${jobs.length === 1 ? "" : "s"} [${lang}]${recorded ? ` (${recorded} recorded)` : ""}`,
    { lang, count: jobs.length, recorded, engine: target.mode === "http" ? target.endpoint : `python ${target.python}` }
  );
  for (const job of jobs) {
    const where = { step: job.step, entry: job.entry, path: job.path };
    let audioPath;
    let cached = false;
    if (job.recorded) {
      audioPath = job.recorded;
      const ok = fs__namespace.existsSync(audioPath) && index.probeDuration(audioPath) > 0;
      if (!ok) {
        throw new index.AgentError("TTS_FAILED", `The recorded audio for ${job.path} could not be read: ${audioPath}`, {
          hint: "The audio file could not be read. Check that the file exists and plays (wav/mp3/m4a/ogg/webm), then produce again.",
          where,
          details: { audio: audioPath, lang: job.lang }
        });
      }
    } else {
      audioPath = path__namespace.join(dir, clipFileName(job.lang, job.voice, speed, job.text));
      cached = wavProblem(audioPath) === null;
      if (!cached) {
        if (target.mode === "http") await synthesizeHttp(target.endpoint, job, speed, audioPath);
        else await synthesizePython(target.python, job, speed, audioPath);
        const problem = wavProblem(audioPath);
        if (problem) {
          fs__namespace.rmSync(audioPath, { force: true });
          throw new index.AgentError("TTS_FAILED", `The speech engine returned unusable audio for ${job.path}: ${problem}`, {
            hint: "Retry once. If it repeats, try another voice (`narascreen voices`) or simplify the text (unusual symbols).",
            where,
            details: { voice: job.voice, lang: job.lang, text: job.text.slice(0, 120) }
          });
        }
      }
    }
    const durationSec = index.probeDuration(audioPath);
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
      cached
    });
    const what = job.recorded ? `recorded ${path__namespace.basename(job.recorded)}` : job.voice;
    const preview = job.text.length > 48 ? `${job.text.slice(0, 47)}…` : job.text;
    log(`${job.key} [${job.lang}] ${what} ${durationSec.toFixed(1)}s${cached ? " (cached)" : ""}${preview ? ` "${preview}"` : ""}`);
  }
  return clips;
}
async function synthesizeClip(req) {
  const text = req.text;
  const job = { key: "preview", step: "preview", entry: 0, path: "the preview", lang: req.lang, voice: req.voice, text };
  if (!text.trim()) {
    throw new index.AgentError("TTS_FAILED", "There is no text to speak", { hint: "Type the narration first, then generate it." });
  }
  const dir = path__namespace.resolve(req.audioDir);
  await fs__namespace.promises.mkdir(dir, { recursive: true });
  const audioPath = path__namespace.join(dir, clipFileName(req.lang, req.voice, req.speed, text));
  if (await wavProblemAsync(audioPath) === null) {
    return { audioPath, durationSec: await probeDurationAsync(audioPath), cached: true };
  }
  const py = process.env.KOKORO_PYTHON;
  if (py && path__namespace.isAbsolute(py) && fs__namespace.existsSync(py)) await synthesizePython(py, job, req.speed, audioPath);
  else await synthesizeHttp(req.endpoint || index.DEFAULT_KOKORO_ENDPOINT, job, req.speed, audioPath);
  const problem = await wavProblemAsync(audioPath);
  if (problem) {
    await fs__namespace.promises.rm(audioPath, { force: true });
    throw new index.AgentError("TTS_FAILED", `The speech engine returned unusable audio: ${problem}`, {
      hint: "Retry once. If it repeats, try another voice or simplify the text (unusual symbols).",
      details: { voice: req.voice, lang: req.lang, text: text.slice(0, 120) }
    });
  }
  return { audioPath, durationSec: await probeDurationAsync(audioPath), cached: false };
}
function probeDurationAsync(file) {
  return new Promise((resolve) => {
    let out = "";
    const child = child_process.spawn(index.FFPROBE_PATH, ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", file], {
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true
    });
    child.stdout.on("data", (d) => out += d);
    child.on("error", () => resolve(0));
    child.on("close", () => {
      const d = parseFloat(out.trim());
      resolve(Number.isFinite(d) ? d : 0);
    });
  });
}
async function wavProblemAsync(file) {
  let size;
  try {
    size = (await fs__namespace.promises.stat(file)).size;
  } catch {
    return "no file";
  }
  if (size <= MIN_WAV_BYTES) return `only ${size} bytes`;
  const fh = await fs__namespace.promises.open(file, "r");
  const head = Buffer.alloc(12);
  try {
    await fh.read(head, 0, 12, 0);
  } finally {
    await fh.close();
  }
  if (head.toString("ascii", 0, 4) !== "RIFF" || head.toString("ascii", 8, 12) !== "WAVE") {
    return `not a WAV file (starts with ${JSON.stringify(head.toString("latin1", 0, 12))})`;
  }
  if (!(await probeDurationAsync(file) > 0)) return "ffprobe reads no duration";
  return null;
}
const TTS_ATTEMPTS = 3;
const TTS_BACKOFF_MS = [500, 1500];
async function synthesizeHttp(endpoint, job, speed, outPath) {
  const where = { step: job.step, entry: job.entry, path: job.path };
  let res;
  let buf = Buffer.alloc(0);
  let lastErr;
  for (let attempt = 1; attempt <= TTS_ATTEMPTS; attempt++) {
    lastErr = void 0;
    try {
      res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "kokoro", input: job.text, voice: job.voice, speed, response_format: "wav" }),
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS)
      });
      buf = Buffer.from(await res.arrayBuffer());
      if (res.status < 500) break;
    } catch (err) {
      lastErr = err;
      res = void 0;
      if (isTimeout(err)) break;
    }
    if (attempt < TTS_ATTEMPTS) await new Promise((r) => setTimeout(r, TTS_BACKOFF_MS[attempt - 1]));
  }
  if (!res) {
    const timedOut = isTimeout(lastErr);
    const health = await checkTts({ mode: "http", endpoint });
    if (!health.ok || timedOut) {
      throw new index.AgentError(
        "TTS_UNAVAILABLE",
        timedOut ? `Kokoro at ${endpoint} did not answer within ${HTTP_TIMEOUT_MS / 1e3}s (${job.path})` : `Kokoro is not reachable at ${endpoint}: ${fetchErrorText(lastErr)}`,
        {
          hint: timedOut ? "The engine is overloaded or still loading its model. Wait a minute and retry; check it with `narascreen doctor`." : UNAVAILABLE_HINT,
          where,
          details: { endpoint, voice: job.voice, lang: job.lang, health: health.detail }
        }
      );
    }
    throw new index.AgentError(
      "TTS_FAILED",
      `Kokoro is up but the request for ${job.path} failed ${TTS_ATTEMPTS} times: ${fetchErrorText(lastErr)}`,
      {
        hint: "Retry produce (finished clips are cached). If it keeps failing on this entry, shorten or simplify its text.",
        where,
        details: { endpoint, voice: job.voice, lang: job.lang, cause: fetchErrorText(lastErr), health: health.detail }
      }
    );
  }
  if (res.status >= 400) {
    const body = errorBodyText(buf);
    throw new index.AgentError("TTS_FAILED", `Kokoro rejected the narration at ${job.path} (HTTP ${res.status})`, {
      hint: res.status === 404 || res.status === 405 ? `${endpoint} is not a speech endpoint — tts.kokoroEndpoint should end in /v1/audio/speech.` : /voice/i.test(body) ? `Voice "${job.voice}" is not available. Pick one from \`narascreen voices --lang ${job.lang}\` (set tts.voices.${job.lang} or the entry's voice).` : res.status >= 500 ? "The speech engine crashed on this text. Retry; if it repeats, simplify the text or try another voice." : "See details.body for the engine's reason, fix the narration/voice, and produce again.",
      where,
      details: { status: res.status, body, voice: job.voice, lang: job.lang }
    });
  }
  const tmp = `${outPath}.part-${process.pid}`;
  fs__namespace.writeFileSync(tmp, buf);
  fs__namespace.renameSync(tmp, outPath);
}
async function synthesizePython(python, job, speed, outPath) {
  const where = { step: job.step, entry: job.entry, path: job.path };
  const tmp = `${outPath}.part-${process.pid}.wav`;
  const r = await generateTTSViaKokoroAsync(job.text, job.voice, speed, index.LANG_CODES[job.lang] ?? "a", tmp, python);
  if (r.status !== 0) {
    fs__namespace.rmSync(tmp, { force: true });
    const stderr = lastLines(r.stderr, 6).slice(-600);
    const missing = r.status === null || /No module named|ModuleNotFoundError|not found/i.test(stderr);
    throw new index.AgentError(
      missing ? "TTS_UNAVAILABLE" : "TTS_FAILED",
      r.status === null ? `Kokoro (Python) timed out or could not start for ${job.path}` : `Kokoro (Python) failed for ${job.path} (exit ${r.status})`,
      {
        hint: missing ? `KOKORO_PYTHON (${process.env.KOKORO_PYTHON}) cannot run Kokoro. Install it there (pip install kokoro soundfile), or unset KOKORO_PYTHON to use the HTTP engine: ${DOCKER_FIX}` : `Check the voice (\`narascreen voices --lang ${job.lang}\`) and details.stderr.`,
        where,
        details: { voice: job.voice, lang: job.lang, stderr }
      }
    );
  }
  fs__namespace.renameSync(tmp, outPath);
}
function wavProblem(file) {
  if (!fs__namespace.existsSync(file)) return "no file";
  const size = fs__namespace.statSync(file).size;
  if (size <= MIN_WAV_BYTES) return `only ${size} bytes`;
  const fd = fs__namespace.openSync(file, "r");
  const head = Buffer.alloc(12);
  fs__namespace.readSync(fd, head, 0, 12, 0);
  fs__namespace.closeSync(fd);
  if (head.toString("ascii", 0, 4) !== "RIFF" || head.toString("ascii", 8, 12) !== "WAVE") {
    return `not a WAV file (starts with ${JSON.stringify(head.toString("latin1", 0, 12))})`;
  }
  if (!(index.probeDuration(file) > 0)) return "ffprobe reads no duration";
  return null;
}
function errorBodyText(buf) {
  const raw = buf.toString("utf-8");
  let text = raw;
  try {
    const j = JSON.parse(raw);
    const d = j.detail;
    text = typeof d === "object" && d?.message || typeof d === "string" && d || String(j.message ?? j.error ?? raw);
  } catch {
  }
  return text.length > 300 ? `${text.slice(0, 299)}…` : text;
}
function isTimeout(err) {
  const name = err?.name;
  return name === "TimeoutError" || name === "AbortError";
}
function fetchErrorText(err) {
  if (isTimeout(err)) return "timed out";
  const e = err;
  const cause = e?.cause?.code ?? e?.cause?.message;
  return cause ? `${e.message ?? "fetch failed"} (${cause})` : e?.message ?? String(err);
}
function lastLines(s, n) {
  return s.trim().split("\n").filter((l) => l.trim()).slice(-n).join("\n");
}
const narration = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  checkTts,
  clipFileName,
  narrationLanguageNote,
  narrationSlots,
  probeDurationAsync,
  resolveAudio,
  resolveNarration,
  resolveTtsTarget,
  resolveVoice,
  scriptVoice,
  synthesizeClip,
  synthesizeNarrations
}, Symbol.toStringTag, { value: "Module" }));
exports.generateTTS = generateTTS;
exports.narration = narration;
exports.narrationLanguageNote = narrationLanguageNote;
exports.narrationSlots = narrationSlots;
exports.resolveAudio = resolveAudio;
exports.resolveNarration = resolveNarration;
exports.scriptVoice = scriptVoice;
exports.synthesizeNarrations = synthesizeNarrations;
