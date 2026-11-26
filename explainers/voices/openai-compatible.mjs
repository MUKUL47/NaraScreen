// Voice engine: any server speaking the OpenAI text-to-speech API (POST /v1/audio/speech).
//
//   "voice": { "engine": "openai-compatible",
//              "options": { "endpoint": "http://localhost:9000/v1/audio/speech", "model": "tts-1",
//                           "apiKeyEnv": "MY_TTS_KEY", "languages": ["hi", "ta"] } }
//
// options.endpoint   required: the full /v1/audio/speech URL
// options.model      default "tts-1"
// options.apiKeyEnv  name of an environment variable holding a bearer token (never the token itself)
// options.languages  the languages the server can speak; unset means "any language"
// options.voicesUrl  optional: a GET URL returning { voices: [...] } (or a list), used by check()
// options.sendLang   true: each request also carries "language": <line lang> (Chatterbox, Maya, ...)
// options.sendSpeed  false: leave "speed" out of the request (for servers that reject it); default true
// options.extra      optional object merged into every request body (e.g. { "seed": 7 }); not in the cache key
//
// Also exports the small HTTP and WAV helpers that kokoro.mjs reuses.
import { writeFileSync } from 'node:fs';

// Many servers stream WAV and write 0xFFFFFFFF as the RIFF and data sizes. Fix both from the real
// byte count and return the duration measured from the data bytes.
export function fixWav(buf) {
  if (buf.length < 12 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error(`the server did not return a WAV file (first bytes: ${JSON.stringify(buf.toString('latin1', 0, 16))})`);
  }
  let off = 12, fmt = null;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4), size = buf.readUInt32LE(off + 4);
    if (id === 'fmt ') {
      fmt = { channels: buf.readUInt16LE(off + 10), rate: buf.readUInt32LE(off + 12), bits: buf.readUInt16LE(off + 22) };
    } else if (id === 'data') {
      if (!fmt) throw new Error('WAV has a data chunk before its fmt chunk');
      const bytes = buf.length - (off + 8); // trust the real length, not the placeholder
      buf.writeUInt32LE(bytes, off + 4);
      buf.writeUInt32LE(buf.length - 8, 4);
      return { buf, durationSec: bytes / (fmt.rate * fmt.channels * (fmt.bits / 8)) };
    }
    off += 8 + size + (size & 1);
  }
  throw new Error('WAV has no data chunk');
}

const isPlain = (v) => v && typeof v === 'object' && !Array.isArray(v);
const brief = (s) => String(s).replace(/\s+/g, ' ').trim().slice(0, 160);

// One retry on a network error: servers often close an idle keep-alive socket under us.
async function fetchRetry(url, init) {
  try { return await fetch(url, init()); }
  catch (e) {
    if (e?.name === 'TimeoutError') throw new Error(`no answer from ${url} (timed out)`);
    try { return await fetch(url, init()); }
    catch (e2) { throw new Error(`cannot reach ${url} (${e2?.cause?.code || e2?.name || e2?.message})`); }
  }
}

export async function postSpeech(endpoint, body, headers = {}, timeoutMs = 120_000) {
  const res = await fetchRetry(endpoint, () => ({
    method: 'POST', headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs),
  }));
  if (!res.ok) throw new Error(`${endpoint} answered HTTP ${res.status}: ${brief(await res.text().catch(() => ''))}`);
  return Buffer.from(await res.arrayBuffer());
}

export async function getJson(url, headers = {}, timeoutMs = 5000) {
  const res = await fetchRetry(url, () => ({ headers, signal: AbortSignal.timeout(timeoutMs) }));
  if (!res.ok) throw new Error(`${url} answered HTTP ${res.status}`);
  return res.json();
}

// { voices: [{id}|"name"] } or a bare list -> ["name", ...]
export const voiceNames = (j) => (Array.isArray(j) ? j : j?.voices || []).map((v) => (typeof v === 'string' ? v : v.id || v.name)).filter(Boolean);

function authHeaders(options) {
  if (!options.apiKeyEnv) return {};
  const key = process.env[options.apiKeyEnv];
  if (!key) throw new Error(`environment variable ${options.apiKeyEnv} (options.apiKeyEnv) is not set`);
  return { authorization: `Bearer ${key}` };
}

const engine = {
  name: 'openai-compatible',
  // a list, or a function of the options; null means any language
  languages: (options = {}) => (Array.isArray(options.languages) ? options.languages : null),

  async synthesize({ text, voice, lang, speed, options = {} }, outWavPath) {
    if (!options.endpoint) throw new Error('openai-compatible needs voice.options.endpoint (the full /v1/audio/speech URL)');
    const raw = await postSpeech(options.endpoint, {
      ...(isPlain(options.extra) ? options.extra : {}),
      model: options.model || 'tts-1', input: text, voice, response_format: 'wav',
      ...(options.sendSpeed === false ? {} : { speed: speed ?? 1 }),
      ...(options.sendLang ? { language: lang } : {}),
    }, authHeaders(options));
    const { buf, durationSec } = fixWav(raw);
    writeFileSync(outWavPath, buf);
    return { durationSec };
  },

  async check(options = {}, { voices = [] } = {}) {
    if (!options.endpoint) return { ok: false, detail: 'voice.options.endpoint is not set' };
    if (!options.voicesUrl) return { ok: true, detail: `${options.endpoint} (voices not checked: no options.voicesUrl)` };
    try {
      const have = new Set(voiceNames(await getJson(options.voicesUrl, authHeaders(options))));
      const missing = [...new Set(voices.map((v) => v.voice))].filter((v) => !have.has(v));
      if (missing.length) return { ok: false, detail: `voice(s) ${missing.join(', ')} not offered by ${options.voicesUrl}` };
      return { ok: true, detail: `${have.size} voices at ${options.voicesUrl}` };
    } catch (e) { return { ok: false, detail: e.message }; }
  },
};
export default engine;

// ---------- named engines on top of this one (chatterbox.mjs, maya2.mjs) ----------
// namedEngine({ name, defaults, aliases, voiceList, startHint, caseInsensitive }) returns an engine whose
// options are `defaults` overridden by the scene's voice.options. Voice aliases ("female", "male") map to a
// per-language voice (options.aliases adds or replaces some), so a scene can say { "RAVI": "male" } and work on either engine.
// check(): GET <server>/health (unreachable -> the start hint), then the server's voice list.
const OAI = engine;
export function namedEngine({ name, defaults, aliases = {}, voiceList = () => [], startHint, caseInsensitive = false }) {
  const opts = (o = {}) => ({ ...defaults, ...o });
  const pick = (voice, lang, o = {}) => {
    const a = { ...aliases, ...(o.aliases || {}) }[String(voice).toLowerCase()];
    return a ? a[lang] ?? a.default ?? Object.values(a)[0] : voice;
  };
  const root = (o) => o.endpoint.replace(/\/v1\/audio\/speech\/?$/, '').replace(/\/audio\/speech\/?$/, '');
  const hostOf = (u) => { try { return new URL(u).host; } catch { return u; } };
  return {
    name,
    aliases,
    languages: (o) => opts(o).languages ?? null,
    voices: (lang) => voiceList(lang),
    resolveVoice: pick,

    async synthesize(req, outWavPath) {
      return OAI.synthesize({ ...req, voice: pick(req.voice, req.lang, req.options), options: opts(req.options) }, outWavPath);
    },

    async check(options = {}, { voices = [] } = {}) {
      const o = opts(options);
      const hint = o.startHint ?? startHint;
      const healthUrl = o.healthUrl ?? `${root(o)}/health`;
      try { await getJson(healthUrl); }
      catch (e) {
        if (/answered HTTP 503/.test(e.message)) return { ok: false, detail: `${name} server at ${hostOf(o.endpoint)} is still loading its model (GET ${healthUrl} answers 503); wait and retry` };
        if (/answered HTTP/.test(e.message)) return { ok: false, detail: `${name} server at ${hostOf(o.endpoint)}: ${e.message}` };
        return { ok: false, detail: `${name} server not reachable at ${hostOf(o.endpoint)}${hint ? ` (hint: ${hint})` : ''}` };
      }
      const voicesUrl = o.voicesUrl ?? `${root(o)}/v1/voices`;
      let have;
      try { have = voiceNames(await getJson(voicesUrl, authHeaders(o))); }
      catch (e) { return { ok: false, detail: `${name}: cannot list voices: ${e.message}` }; }
      const norm = (v) => (caseInsensitive ? String(v).toLowerCase() : String(v));
      const set = new Set(have.map(norm));
      const missing = [...new Set(voices.map((v) => pick(v.voice, v.lang, o)))].filter((v) => !set.has(norm(v)));
      if (missing.length) return { ok: false, detail: `${name} has no voice ${missing.join(', ')} (it has ${have.slice(0, 24).join(', ')}${have.length > 24 ? ', ...' : ''}; aliases: ${Object.keys({ ...aliases, ...(o.aliases || {}) }).join(', ') || 'none'})` };
      return { ok: true, detail: `${have.length} voices at ${voicesUrl}` };
    },
  };
}
