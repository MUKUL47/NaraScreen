// Voice lines for figures scenes: plan the lines, synthesise them through a pluggable engine (cached),
// check their timing, inject speech bubbles with the measured durations, mix one audio track and mux it.
// make.mjs drives it; the engine contract is in explainers/voices/README.md.
//
// The core never knows engine specifics: it only calls engine.synthesize / check / voices / languages.
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, statSync } from 'node:fs';
import { dirname, join, resolve, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const VOICES_DIR = resolve(HERE, '../voices');
export const DEFAULT_CACHE = resolve(HERE, '../.voice-cache');

// English plus the Indian languages the user cares about. Codes are ISO 639-1.
export const LANGS = Object.freeze({
  en: 'English', hi: 'Hindi', mr: 'Marathi', gu: 'Gujarati', ta: 'Tamil', te: 'Telugu',
  bn: 'Bengali', kn: 'Kannada', ml: 'Malayalam', pa: 'Punjabi', or: 'Odia', as: 'Assamese',
});

export class VoiceError extends Error {
  constructor(message, hint) { super(message); this.hint = hint; }
  get line() { return this.hint ? `${this.message} (hint: ${this.hint})` : this.message; }
}
const fail = (msg, hint) => { throw new VoiceError(msg, hint); };
const num = (v) => typeof v === 'number' && Number.isFinite(v);
const r2 = (v) => Math.round(v * 100) / 100;
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const BARE = /^[a-z0-9][a-z0-9_-]*$/i;

// ---------- engines ----------
// A bare name is explainers/voices/<name>.mjs; anything else is a path relative to the scene file.
export function engineFile(ref, scenePath) {
  if (BARE.test(ref)) return join(VOICES_DIR, `${ref}.mjs`);
  return isAbsolute(ref) ? ref : resolve(dirname(scenePath || '.'), ref);
}

export async function resolveEngine(ref = 'kokoro', scenePath) {
  if (typeof ref !== 'string' || !ref) fail('"voice.engine" must be an engine name or a path to an engine module');
  const file = engineFile(ref, scenePath);
  if (!existsSync(file)) {
    fail(`voice engine "${ref}" not found (looked for ${file})`,
      BARE.test(ref) ? 'built-in engines are kokoro, chatterbox, maya2 and openai-compatible; a custom engine is a path like "./my-engine.mjs"' : 'paths are relative to the scene file');
  }
  let mod;
  try { mod = await import(pathToFileURL(file).href); }
  catch (e) { fail(`voice engine "${ref}" failed to load: ${String(e?.message || e).split('\n')[0]}`); }
  const e = mod.default ?? mod;
  if (!isObj(e) || typeof e.synthesize !== 'function') {
    fail(`voice engine "${ref}" must export default { name, synthesize(req, outWavPath) }`, 'see explainers/voices/README.md');
  }
  return { ...e, name: String(e.name || ref), file };
}

// null = the engine speaks any language
export function engineLanguages(engine, options) {
  const l = typeof engine.languages === 'function' ? engine.languages(options || {}) : engine.languages;
  return Array.isArray(l) ? l : null;
}

// ---------- planning ----------
function labelList(spec) {
  const ls = [...new Set((spec.actors || []).map((a) => a.label).filter(Boolean))];
  return ls.length ? ls.join(', ') : '(no labelled actors)';
}

// text: a string (in the scene's voice.lang) or { lang: text }. Falls back to en.
export function pickText(text, lang, sceneLang = 'en') {
  const map = typeof text === 'string' ? { [sceneLang]: text } : text;
  if (!isObj(map)) return { error: 'text must be a string or a { "en": ..., "hi": ... } map' };
  for (const k of Object.keys(map)) if (!LANGS[k]) return { error: `unknown language "${k}" in text (known: ${Object.keys(LANGS).join(', ')})` };
  if (typeof map[lang] === 'string' && map[lang].trim()) return { text: map[lang], lang };
  if (typeof map.en === 'string' && map.en.trim()) return { text: map.en, lang: 'en', fellBack: true };
  return { error: `has no "${lang}" text and no "en" fallback (has: ${Object.keys(map).join(', ') || 'nothing'})` };
}

function pickVoice(v, lang) {
  if (typeof v === 'string') return v;
  if (isObj(v)) return v[lang];
  return undefined;
}

// Validate and resolve every line for one language. With noVoice, voices are not needed.
export function planLines(spec, { lang, noVoice = false } = {}) {
  const cfg = isObj(spec.voice) ? spec.voice : {};
  if (spec.voice != null && !isObj(spec.voice)) fail('"voice" must be an object { engine, lang, voices, ... }');
  const sceneLang = cfg.lang || 'en';
  lang = lang || sceneLang;
  if (!LANGS[lang]) fail(`unknown language "${lang}"`, `use one of ${Object.keys(LANGS).join(', ')}`);
  if (!LANGS[sceneLang]) fail(`unknown voice.lang "${sceneLang}"`, `use one of ${Object.keys(LANGS).join(', ')}`);
  const raw = spec.lines ?? [];
  if (!Array.isArray(raw)) fail('"lines" must be an array of { t, who, text }');
  const start = spec.start || 0, end = start + (spec.duration ?? 0);
  const labels = new Set((spec.actors || []).map((a) => a.label).filter(Boolean));
  const warnings = [];
  const lines = raw.map((L, i) => {
    const P = `lines[${i}]`;
    if (!isObj(L)) fail(`${P} must be an object { t, who, text }`);
    if (!num(L.t)) fail(`${P}: "t" must be a number of seconds`, `got ${JSON.stringify(L.t)}`);
    if (L.t < start || L.t >= end) fail(`${P} starts at t=${L.t}, outside the scene (${start}..${end} s)`, 'move it inside the scene or raise "duration"');
    if (typeof L.who !== 'string' || !L.who) fail(`${P}: "who" must be "narrator" or an actor label`);
    if (L.who !== 'narrator' && !labels.has(L.who)) fail(`${P}: unknown who "${L.who}"`, `use "narrator" or an actor label: ${labelList(spec)}`);
    const picked = pickText(L.text, lang, sceneLang);
    if (picked.error) fail(`${P} (${L.who}) ${picked.error}`, `add a "${lang}" or "en" entry to its text`);
    if (picked.fellBack) warnings.push(`${P} has no "${lang}" text; using "en"`);
    const speed = L.speed ?? cfg.speed ?? 1;
    if (!(num(speed) && speed > 0)) fail(`${P}: "speed" must be a positive number`);
    let voice = pickVoice(L.voice, picked.lang) ?? pickVoice(cfg.voices?.[L.who], picked.lang);
    if (!noVoice && !voice) {
      fail(`${P}: no ${picked.lang} voice for "${L.who}"`, `set voice.voices.${L.who} to a voice name or { "${picked.lang}": "<voice>" }`);
    }
    if (voice != null && typeof voice !== 'string') fail(`${P}: voice must be a string`);
    let bubble = L.bubble;
    if (L.who === 'narrator') {
      if (bubble && bubble !== false) warnings.push(`${P}: narrator lines are voice only; its "bubble" is ignored`);
      bubble = false;
    } else if (bubble === undefined) bubble = true;
    if (!(bubble === true || bubble === false || isObj(bubble))) fail(`${P}: "bubble" must be true, false or { x, y, tail, w, h, fs }`);
    return { index: i, t: L.t, who: L.who, text: picked.text, lang: picked.lang, voice, speed, bubble };
  });
  return { cfg, lang, sceneLang, engineRef: cfg.engine || 'kokoro', options: cfg.options || {}, lines, warnings, start, end };
}

// Every line's language must be one the engine speaks. Fails before anything is synthesised.
export function checkLanguages(plan, engine) {
  const langs = engineLanguages(engine, plan.options);
  if (!langs) return;
  for (const l of new Set(plan.lines.map((x) => x.lang))) {
    if (!langs.includes(l)) {
      fail(`voice engine "${engine.name}" cannot speak ${LANGS[l] || l} ("${l}"); it speaks ${langs.join(', ')}`,
        `set voice.engine to an engine that supports "${l}": "maya2" speaks en and 11 Indian languages; or "openai-compatible" pointed at another TTS server, or a custom engine module path; or render with --no-voice for bubbles only`);
    }
  }
}

// ---------- synthesis + cache ----------
export function cacheKey(engineName, { voice, lang, speed, text }) {
  return createHash('sha256').update(JSON.stringify([engineName, voice, lang, speed, text])).digest('hex').slice(0, 32);
}

function cached(cacheDir, key) {
  const wav = join(cacheDir, `${key}.wav`), meta = join(cacheDir, `${key}.json`);
  if (!existsSync(wav) || !existsSync(meta)) return null;
  try {
    const m = JSON.parse(readFileSync(meta, 'utf8'));
    if (num(m.durationSec) && statSync(wav).size > 44) return { wav, durationSec: m.durationSec };
  } catch {}
  return null;
}

export async function synthesizeLines(plan, engine, { cacheDir = DEFAULT_CACHE, log = () => {} } = {}) {
  mkdirSync(cacheDir, { recursive: true });
  checkLanguages(plan, engine);
  const todo = [];
  const out = plan.lines.map((L) => {
    const key = cacheKey(engine.name, L), hit = cached(cacheDir, key);
    if (hit) return { ...L, ...hit, key, cached: true };
    const r = { ...L, key, cached: false };
    todo.push(r);
    return r;
  });
  if (todo.length && typeof engine.check === 'function') {
    let c;
    try { c = await engine.check(plan.options, { voices: todo.map((l) => ({ voice: l.voice, lang: l.lang })) }); }
    catch (e) { c = { ok: false, detail: String(e?.message || e) }; }
    if (!c?.ok) fail(`voice engine "${engine.name}" check failed: ${c?.detail || 'no detail'}`, 'fix voice.voices / voice.options, or use --no-voice');
  }
  for (const L of todo) {
    const wav = join(cacheDir, `${L.key}.wav`), tmp = join(cacheDir, `${L.key}.${process.pid}.tmp.wav`);
    let res;
    try { res = await engine.synthesize({ text: L.text, voice: L.voice, lang: L.lang, speed: L.speed, options: plan.options }, tmp); }
    catch (e) { fail(`lines[${L.index}] (${L.who}): ${engine.name} failed: ${String(e?.message || e).split('\n')[0]}`, 'check the engine is running and the voice exists'); }
    if (!num(res?.durationSec) || res.durationSec <= 0 || !existsSync(tmp)) fail(`lines[${L.index}]: engine ${engine.name} returned no audio or no durationSec`);
    renameSync(tmp, wav);
    writeFileSync(join(cacheDir, `${L.key}.json`), JSON.stringify({ engine: engine.name, voice: L.voice, lang: L.lang, speed: L.speed, text: L.text, durationSec: res.durationSec }) + '\n');
    L.wav = wav; L.durationSec = res.durationSec;
    log(`  synthesised lines[${L.index}] ${L.who} ${r2(res.durationSec)} s`);
  }
  return out;
}

// --no-voice: no engine call. A measured duration from the cache when there is one, else an estimate.
export function estimateLines(plan, { cacheDir = DEFAULT_CACHE, engineName = plan.engineRef } = {}) {
  return plan.lines.map((L) => {
    const hit = L.voice ? cached(cacheDir, cacheKey(engineName, L)) : null;
    if (hit) return { ...L, durationSec: hit.durationSec, estimated: false };
    return { ...L, durationSec: r2(0.5 + graphemes(L.text).length * 0.07 / L.speed), estimated: true };
  });
}

// ---------- timing ----------
export function checkTiming(lines, { end }) {
  for (const L of lines) {
    if (L.t + L.durationSec > end + 1e-6) {
      fail(`lines[${L.index}] (${L.who}, t=${L.t}) runs to ${r2(L.t + L.durationSec)} s, past the scene end ${end} s`,
        `measured ${r2(L.durationSec)} s; start it by t=${r2(end - L.durationSec)}, shorten the text, or raise "duration"`);
    }
  }
  const warnings = [];
  const byT = [...lines].sort((a, b) => a.t - b.t || a.index - b.index);
  byT.forEach((L, k) => {
    const next = byT.slice(k + 1).find((n) => n.who === L.who);
    if (next && L.t + L.durationSec > next.t + 1e-6) {
      fail(`lines[${L.index}] (${L.who}, t=${L.t}) overlaps lines[${next.index}] (t=${next.t})`,
        `measured ${r2(L.durationSec)} s, so it ends at ${r2(L.t + L.durationSec)}; move lines[${next.index}] to t ≥ ${r2(L.t + L.durationSec + 0.2)} or shorten the text`);
    }
    const other = byT.slice(k + 1).find((n) => n.who !== L.who && n.t < L.t + L.durationSec);
    if (other) warnings.push(`lines[${L.index}] (${L.who}) is still speaking when lines[${other.index}] (${other.who}) starts at ${other.t}`);
  });
  return warnings;
}

// ---------- geometry (scene units) ----------
const eio = (x) => { x = Math.max(0, Math.min(1, x)); return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; };
// figures' norm() + baseAt(): fields carry forward; walk/run moves are linear, other moves ease.
export function actorAt(actor, t) {
  let prev = { s: 1, op: 1, face: 1, x: 0, y: 0 };
  const K = (actor.keys || []).map((k) => (prev = { ...prev, ...Object.fromEntries(Object.entries(k).filter(([, v]) => v !== null)) }));
  if (!K.length) return { ...prev };
  if (t <= K[0].t) return { ...K[0] };
  const last = K[K.length - 1];
  if (t >= last.t) return { ...last };
  let i = 0; while (i < K.length - 1 && K[i + 1].t <= t) i++;
  const a = K[i], b = K[i + 1], u = (t - a.t) / (b.t - a.t), ue = b.move ? u : eio(u), s = { ...a };
  for (const k of ['x', 'y', 's', 'op']) if (num(a[k]) && num(b[k])) s[k] = a[k] + (b[k] - a[k]) * ue;
  return s;
}

function speakerAt(spec, who, t) {
  const cands = (spec.actors || []).filter((a) => a.label === who).map((a) => ({ a, st: actorAt(a, t) }));
  return cands.sort((p, q) => (q.st.op ?? 1) - (p.st.op ?? 1))[0];
}

const SEG = new Intl.Segmenter('und', { granularity: 'grapheme' });
export const graphemes = (s) => [...SEG.segment(String(s))].map((g) => g.segment);
// Rough advance widths (em) for Georgia bold and the Noto Indic fallbacks it gets on Linux.
function textWidth(s, fs) {
  let w = 0;
  for (const g of graphemes(s)) {
    const c = g.codePointAt(0);
    if (g === ' ') w += 0.3;
    else if (c >= 0x0900 && c <= 0x0dff) w += 0.62 + 0.08 * (g.length - 1); // Indic cluster
    else if (/[A-Z0-9]/.test(g)) w += 0.68;
    else if (/[a-z]/.test(g)) w += 0.54;
    else w += 0.36; // punctuation
  }
  return w * fs;
}

export const xmlEscape = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Bubble fx for one line: above and beside the speaker's head, on the side it faces, clear of its
// label, kept inside the frame. Any of x, y, w, h, fs, tail given in "bubble": {...} wins.
export function bubbleFor(spec, L, { pad = 0.4 } = {}) {
  const W = spec.w || 900, H = spec.h || 400, o = isObj(L.bubble) ? L.bubble : {};
  let fs = o.fs ?? Math.max(16, Math.min(40, Math.round(W / 50)));
  let tw = textWidth(L.text, fs);
  if (o.w == null && tw + fs * 1.4 > W - 40) { fs = Math.max(12, Math.floor(fs * (W - 40) / (tw + fs * 1.4))); tw = textWidth(L.text, fs); }
  const w = o.w ?? Math.round(tw + fs * 1.4), h = o.h ?? Math.round(fs * 2.15);
  let x = o.x, y = o.y, tail = o.tail;
  if (x == null || y == null || tail == null) {
    const sp = speakerAt(spec, L.who, L.t);
    if (!sp || !num(sp.st.x) || !num(sp.st.y)) {
      fail(`lines[${L.index}] (${L.who}): cannot auto-place the bubble (the actor's x/y at t=${L.t} is not a number)`, 'give "bubble": { "x": .., "y": .. }');
    }
    const { a, st } = sp, sc = (a.s || 1) * (st.s ?? 1);
    const headX = st.x, headY = st.y - 60 * sc, headR = 18 * sc;
    const lfs = spec.labelFs || 15, labelHalf = a.label ? (a.label.length * lfs * 0.78 + 14) / 2 : 0;
    const gap = Math.max(labelHalf, headR) + 16;
    let side = (st.face ?? 1) >= 0 ? 1 : -1;
    const fits = (sd) => { const cx = headX + sd * (gap + w / 2); return cx - w / 2 >= 20 && cx + w / 2 <= W - 20; };
    if (!fits(side) && fits(-side)) side = -side;
    x ??= Math.round(Math.max(w / 2 + 20, Math.min(W - w / 2 - 20, headX + side * (gap + w / 2))));
    y ??= Math.round(Math.max(h + 16, Math.min(H - 30, headY - headR - 8)));
    tail ??= x >= headX ? 1 : -1; // tail leans toward the head
  }
  return { type: 'bubble', x, y, t0: L.t, t1: r2(L.t + L.durationSec + pad), text: xmlEscape(L.text), w, h, fs, tail, voiceLine: L.index };
}

// geo: the spec to read actor positions from (defaults to spec; make.mjs passes one with @places resolved)
export function injectBubbles(spec, lines, opts = {}, geo = spec) {
  const out = structuredClone(spec);
  out.fx = [...(out.fx || []), ...lines.filter((L) => L.bubble).map((L) => bubbleFor(geo, L, opts))];
  return out;
}

// ---------- ffmpeg ----------
export function run(cmd, args) {
  return new Promise((res, rej) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', (e) => rej(new VoiceError(`${cmd} could not start: ${e.message}`, `install ${cmd} or put it on PATH`)));
    p.on('close', (code) => (code === 0 ? res({ out, err }) : rej(new VoiceError(`${cmd} failed (exit ${code}): ${err.trim().split('\n').pop() || 'no message'}`))));
  });
}

export async function probe(file) {
  const { out } = await run('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name,duration,sample_rate,channels:format=duration', '-of', 'json', file]);
  return JSON.parse(out);
}

// One mono 48 kHz track exactly `duration` long: every line delayed to its t, mixed, loudness
// normalised (two-pass EBU R128 loudnorm, linear, -16 LUFS / -1.5 dBTP), padded and trimmed.
export async function mixTrack(lines, { start = 0, duration }, outWav, { tmpDir = dirname(outWav) } = {}) {
  const D = duration.toFixed(6);
  const mix = join(tmpDir, 'voice-mix.raw.wav');
  if (!lines.length) {
    await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=mono', '-t', D, '-c:a', 'pcm_s16le', outWav]);
    return outWav;
  }
  const args = ['-hide_banner', '-loglevel', 'error', '-y'];
  lines.forEach((L) => args.push('-i', L.wav));
  const chains = lines.map((L, i) => `[${i}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=mono,adelay=delays=${Math.round((L.t - start) * 1000)}:all=1[a${i}]`);
  const mixIn = lines.map((_, i) => `[a${i}]`).join('');
  const graph = `${chains.join(';')};${mixIn}amix=inputs=${lines.length}:normalize=0:duration=longest,apad=whole_dur=${D},atrim=0:${D}[m]`;
  await run('ffmpeg', [...args, '-filter_complex', graph, '-map', '[m]', '-c:a', 'pcm_f32le', mix]);

  const target = 'I=-16:TP=-1.5:LRA=11';
  const { err } = await run('ffmpeg', ['-hide_banner', '-nostats', '-i', mix, '-af', `loudnorm=${target}:print_format=json`, '-f', 'null', '-']);
  const j = /\{[\s\S]*\}\s*$/.exec(err);
  let af = 'anull';
  if (j) {
    const m = JSON.parse(j[0]);
    if (Number.isFinite(Number(m.input_i)) && Number(m.input_i) > -70) {
      af = `loudnorm=${target}:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true`;
    }
  }
  await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', mix, '-af', `${af},aresample=48000,apad=whole_dur=${D},atrim=0:${D}`, '-ac', '1', '-c:a', 'pcm_s16le', outWav]);
  return outWav;
}

// Video stream copied, never re-encoded; the voice track becomes AAC.
export async function mux(video, audioWav, out) {
  mkdirSync(dirname(resolve(out)), { recursive: true });
  await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', video, '-i', audioWav,
    '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', out]);
  return out;
}

// ---------- scene for render.mjs ----------
// render.mjs reads the scene from a temp file, so relative add-on paths are made absolute and the
// voice keys are dropped (render.mjs stays unchanged and never sees them).
export function sceneForRender(spec, scenePath) {
  const out = structuredClone(spec);
  delete out.voice; delete out.lines;
  if (Array.isArray(out.addons)) out.addons = out.addons.map((a) => (typeof a === 'string' && !BARE.test(a) && !isAbsolute(a) ? resolve(dirname(scenePath), a) : a));
  for (const f of out.fx || []) delete f.voiceLine;
  return out;
}

// Actor x/y may be "@place" references; resolve them with the add-on tooling when it is available.
export async function geometrySpec(spec, scenePath) {
  if (!spec.addons && !spec.set && !JSON.stringify(spec.actors || []).includes('"@')) return spec;
  try {
    const { prepareAddons } = await import('./addons.mjs');
    return (await prepareAddons(structuredClone(spec), scenePath)).spec;
  } catch { return spec; }
}
