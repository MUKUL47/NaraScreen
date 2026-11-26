// Voice engine: Kokoro-FastAPI over HTTP (the narascreen-kokoro container), OpenAI-style API.
//
//   "voice": { "engine": "kokoro", "options": { "endpoint": "http://localhost:8880/v1/audio/speech" } }
//
// options.endpoint  default http://localhost:8880/v1/audio/speech
// options.model     default "kokoro"
//
// Kokoro picks its pronunciation from the voice's first letter, so a voice must match the line's
// language: English uses a* (American) or b* (British) voices, Hindi uses h* voices (hf_alpha, hf_beta,
// hm_omega, hm_psi). check() refuses a mismatch before anything is synthesised.
import { writeFileSync } from 'node:fs';
import { fixWav, postSpeech, getJson, voiceNames } from './openai-compatible.mjs';

const DEFAULT_ENDPOINT = 'http://localhost:8880/v1/audio/speech';
const PREFIX = { en: ['a', 'b'], hi: ['h'] };
const endpointOf = (options = {}) => options.endpoint || DEFAULT_ENDPOINT;
const voicesUrl = (options) => endpointOf(options).replace(/\/audio\/speech\/?$/, '/audio/voices');

let listed = null; // voice list per process
async function listVoices(options) {
  if (!listed) listed = getJson(voicesUrl(options)).then(voiceNames);
  try { return await listed; } catch (e) { listed = null; throw e; }
}

export default {
  name: 'kokoro',
  languages: Object.keys(PREFIX),

  voices: (lang) => {
    // static examples; check() reads the live list from the server
    const known = { en: ['af_heart', 'af_bella', 'am_michael', 'am_adam', 'bf_emma', 'bm_george'], hi: ['hf_alpha', 'hf_beta', 'hm_omega', 'hm_psi'] };
    return lang ? known[lang] || [] : Object.values(known).flat();
  },

  async synthesize({ text, voice, speed, options = {} }, outWavPath) {
    const raw = await postSpeech(endpointOf(options), {
      model: options.model || 'kokoro', input: text, voice, speed: speed ?? 1, response_format: 'wav',
    });
    const { buf, durationSec } = fixWav(raw);
    writeFileSync(outWavPath, buf);
    return { durationSec };
  },

  async check(options = {}, { voices = [] } = {}) {
    for (const { voice, lang } of voices) {
      const ok = PREFIX[lang];
      if (ok && !ok.includes(String(voice)[0])) {
        return { ok: false, detail: `voice ${voice} does not match language ${lang} (kokoro ${lang} voices start with ${ok.map((p) => `"${p}"`).join(' or ')}, e.g. ${this.voices(lang).slice(0, 2).join(', ')})` };
      }
    }
    let have;
    try { have = new Set(await listVoices(options)); }
    catch (e) { return { ok: false, detail: `${e.message}; is the narascreen-kokoro container running?` }; }
    const missing = [...new Set(voices.map((v) => v.voice))].filter((v) => !have.has(v));
    if (missing.length) return { ok: false, detail: `kokoro has no voice ${missing.join(', ')} (GET ${voicesUrl(options)} lists them)` };
    return { ok: true, detail: `${have.size} voices at ${voicesUrl(options)}` };
  },
};
