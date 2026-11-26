// Voice engine: Maya-2-Native (Maya Research, Apache-2.0) behind its OpenAI-style server.
// Native English and 11 Indian languages: Marathi, Gujarati and the rest. About 0.85x real time, ~8.3 GB of VRAM.
//
//   "voice": { "engine": "maya2", "voices": { "narrator": "Vaidehi", "RAVI": { "mr": "Siddhant", "gu": "Siddhant" } } }
//
// Defaults (every one can be overridden in voice.options):
//   endpoint   http://127.0.0.1:8891/v1/audio/speech      model "maya3"
//   languages  en hi mr gu ta te bn kn ml pa or as
//   sendLang   true (each request carries "language")
//   sendSpeed  false (the server only accepts speed 1.0, so voice.speed has no effect)
//   extra      {}   e.g. { "seed": 7, "normalize": true }
// Voices: 20 named voices (case-insensitive). Aliases: "female" -> Vaidehi (Kayal for ta),
//   "male" -> Siddhant (Sreekar for te). Assamese is cross-lingual for every voice.
// Start (stops chatterbox first, since they don't both fit on the GPU; Kokoro keeps running):
//   scripts/voice-engine.sh up maya2   ready after ~80 s, when GET /health answers 200.
//   Stop: scripts/voice-engine.sh down maya2. The server setup is in servers/maya2/.
import { namedEngine } from './openai-compatible.mjs';

const ALL = ['bn', 'en', 'gu', 'hi', 'kn', 'ml', 'mr', 'or', 'pa', 'ta', 'te'];
const NO_PA = ALL.filter((l) => l !== 'pa');
// name, gender, trained languages (from the model's voices/voices.json)
export const VOICES = [
  ['Ahana', 'f', ALL], ['Vaidehi', 'f', ALL], ['Malini', 'f', ALL], ['Charvi', 'f', ALL], ['Jahnavi', 'f', NO_PA],
  ['Anirban', 'm', ALL], ['Nakul', 'm', ALL], ['Vasant', 'm', NO_PA], ['Siddhant', 'm', ALL], ['Satvik', 'm', ALL],
  ['Abhay', 'm', ['en', 'hi']], ['Nivedita', 'f', ['en', 'hi']], ['Ishwari', 'f', ['hi']], ['Ritvik', 'm', ['hi']],
  ['Vrinda', 'f', ['hi']], ['Sreekar', 'm', ['en', 'hi', 'te']], ['Kayal', 'f', ['en', 'ta']], ['Shaunak', 'm', ['en', 'hi']],
  ['Akshat', 'm', ['en', 'hi']], ['Tanushree', 'f', ['en', 'hi']],
].map(([name, gender, langs]) => ({ name, gender: gender === 'f' ? 'female' : 'male', langs }));

export default namedEngine({
  name: 'maya2',
  defaults: {
    endpoint: 'http://127.0.0.1:8891/v1/audio/speech', model: 'maya3',
    languages: ['en', 'hi', 'mr', 'gu', 'ta', 'te', 'bn', 'kn', 'ml', 'pa', 'or', 'as'], sendLang: true, sendSpeed: false,
  },
  aliases: {
    female: { default: 'Vaidehi', ta: 'Kayal' },
    male: { default: 'Siddhant', te: 'Sreekar' },
  },
  // voices trained on the language first; for "as" (cross-lingual for all) every voice
  voiceList: (lang) => VOICES.filter((v) => !lang || lang === 'as' || v.langs.includes(lang)).map((v) => v.name),
  caseInsensitive: true,
  startHint: 'run scripts/voice-engine.sh up maya2 from the NaraScreen repo root, ready after ~80 s; it stops chatterbox first, since only one of chatterbox/maya2 fits on the GPU at a time',
});
