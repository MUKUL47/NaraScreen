// Voice engine: Chatterbox Multilingual V3 (Resemble AI, MIT) behind an OpenAI-style server.
// The most natural English and Hindi of the three engines; about 1x real time, ~4 GB of VRAM.
//
//   "voice": { "engine": "chatterbox", "voices": { "narrator": "female", "RAVI": "male" } }
//
// Defaults (every one can be overridden in voice.options):
//   endpoint   http://127.0.0.1:8890/v1/audio/speech      model "chatterbox"
//   languages  ["en", "hi"]   Marathi only goes through the Hindi model with a Hindi accent, and the
//              Gujarati, Tamil and Bengali scripts are not read at all, so neither is listed
//   sendLang   true (each request carries "language")
//   sendSpeed  false (the server ignores speed)
//   extra      {}   e.g. { "seed": 7, "exaggeration": 0.5, "cfg_weight": 0.5, "temperature": 0.8 }
// Voices: file stems in the server's voices folder ($NARASCREEN_TTS_HOME/voices: en_f1, hi_f1) or "default" (the built-in voice).
//   Aliases: "female" -> en_f1 / hi_f1, "male" -> default (the built-in voice, lower pitched).
//   The server silently swaps an unknown voice for a default one, so check() refuses unknown names.
// Start (stops maya2 first; Kokoro keeps running): scripts/voice-engine.sh up chatterbox
//   Stop: scripts/voice-engine.sh down chatterbox. The server itself is in servers/chatterbox/.
import { namedEngine } from './openai-compatible.mjs';

const KNOWN = { en: ['en_f1', 'default'], hi: ['hi_f1', 'default'] };

export default namedEngine({
  name: 'chatterbox',
  defaults: {
    endpoint: 'http://127.0.0.1:8890/v1/audio/speech', model: 'chatterbox',
    languages: ['en', 'hi'], sendLang: true, sendSpeed: false,
  },
  aliases: {
    female: { en: 'en_f1', hi: 'hi_f1' },
    male: { en: 'default', hi: 'default' },
  },
  voiceList: (lang) => (lang ? KNOWN[lang] || [] : [...new Set(Object.values(KNOWN).flat())]),
  startHint: 'run scripts/voice-engine.sh up chatterbox from the NaraScreen repo root; it stops maya2 first, since only one of chatterbox/maya2 fits on the GPU at a time',
});
