# Voice engines

A figures scene can carry its own voice-over: a `voice` block and a `lines` list in the same JSON.
`explainers/tools/make.mjs` turns the lines into speech, draws speech bubbles timed to the audio, and muxes one voice track into the MP4.
The engine that speaks is a plug-in: a small ES module chosen by `voice.engine`.

```bash
node explainers/tools/make.mjs scene.json out.mp4                 # voice.lang (default en)
node explainers/tools/make.mjs scene.json out-hi.mp4 --lang hi    # Hindi text and voices
node explainers/tools/make.mjs scene.json out.mp4 --no-voice      # silent, no audio stream; bubbles still drawn
node explainers/tools/make.mjs scene.json stills/ --stills 4 9.5  # PNG stills with the bubbles, no audio
```

Other options: `--pad 0.4` (bubble time after the audio), `--cache <dir>` (or `EXPLAINERS_VOICE_CACHE`), and `--size`, `--fps`, `--bg`, `--workers`, which are passed to `render.mjs`.

## The scene format

```json
"voice": { "engine": "kokoro", "lang": "en", "speed": 1.1,
           "voices": { "narrator": { "en": "af_heart", "hi": "hf_alpha" },
                       "RAVI":     { "en": "am_michael", "hi": "hm_omega" } },
           "options": { "endpoint": "http://localhost:8880/v1/audio/speech" } },
"lines": [
  { "t": 3.3, "who": "narrator", "text": { "en": "Rule one: stop at the kerb.", "hi": "पहला नियम: किनारे पर रुकें।" } },
  { "t": 5.8, "who": "RAVI", "text": { "en": "I'll wait here.", "hi": "मैं यहीं रुकूँगा।" } },
  { "t": 9.0, "who": "RAVI", "text": "Okay.", "bubble": { "x": 700, "y": 385, "tail": 1 } },
  { "t": 12.0, "who": "RAVI", "text": "(to himself)", "bubble": false, "speed": 0.9, "voice": "am_adam" }
]
```

- `voice.engine` defaults to `kokoro`. A bare name loads `explainers/voices/<name>.mjs`. Anything else is a path relative to the scene file.
- `voice.lang` is the default language (default `en`). `--lang` overrides it.
- `voice.voices` maps each `who` to a voice name, or to a `{ lang: voice }` map.
- `voice.speed` is the default speed (default 1). `voice.options` is passed to the engine unchanged.
- `t` is the start time in scene seconds.
- `who` is `narrator` or an actor `label`. When two actors share a label, the more visible one at `t` speaks: the road-rules demo has a walking RAVI and a driving RAVI.
- `text` is a string, which counts as `voice.lang`, or a per-language map. A missing language falls back to `en`, with a warning. If there is no `en` either, it is an error.
- `voice` overrides the voice for that line: a string, or a `{ lang: voice }` map. `speed` overrides the speed.
- `bubble`:
  - An actor line gets a bubble unless it sets `bubble: false`. Narrator lines are voice only.
  - `true` (the default) places the bubble automatically, beside and above the speaker's head at `t`, on the side the speaker faces, clear of the label and inside the frame. The speaker's position is read from its keys.
  - An object sets any of `x`, `y`, `w`, `h`, `fs`, `tail`. Whatever is left out is placed automatically.
  - The bubble lasts from `t` to `t + audio + pad`. Its width comes from the text, and the text is XML-escaped.
- Hand-written `bubble` fx keep working; lines only add to them.

### Checks

Each check stops the run with a one-line error and a hint, and exits 1:
- an unknown `who`, language or engine;
- a line outside the scene;
- a line that overlaps the next line from the same speaker (the hint gives the measured length and the earliest free start);
- a line that runs past the end of the scene;
- a missing language with no `en`;
- a language the engine cannot speak;
- a failed engine check, such as a voice that doesn't exist or doesn't match the language.

Different speakers overlapping is only a warning.

### Pipeline

1. Synthesise each line. The audio is cached in `explainers/.voice-cache/` (git-ignored), keyed by a hash of engine name, voice, lang, speed and text.
2. Measure each line, then check the timing.
3. Inject the bubble fx.
4. Render through `render.mjs` as a subprocess, unchanged. The voice keys are stripped from its copy of the scene.
5. Mix the lines at their `t` with ffmpeg `adelay` and `amix`. The mix is normalised with two-pass EBU R128 loudnorm (-16 LUFS, -1.5 dBTP) and padded or trimmed to the exact video length.
6. Mux: the video stream is copied, not re-encoded, and the voice goes in as AAC.

## Engine contract

```js
export default {
  name: 'my-engine',                         // used in the cache key and in messages
  languages: ['en', 'hi'],                   // or (options) => [...], or null/absent = any language
  async synthesize({ text, voice, lang, speed, options }, outWavPath) {
    // write a WAV file to outWavPath
    return { durationSec };                  // the real length of the audio
  },
  async check(options, { voices }) {         // optional; voices = [{ voice, lang }] about to be used
    return { ok: true, detail: '...' };      // ok: false stops the run, before any synthesis
  },
  voices(lang) { return ['v1', 'v2']; },     // optional; example voices for messages
};
```

The core never knows engine specifics. It checks `languages` first, then calls `check` once with every (voice, lang) pair that is not cached, then calls `synthesize` per line.

### A minimal custom engine

`my-tts.mjs` next to the scene, with `"voice": { "engine": "./my-tts.mjs" }`:

```js
import { execFileSync } from 'node:child_process';
import { statSync } from 'node:fs';

// espeak-ng as a stand-in: any command-line TTS works the same way
export default {
  name: 'espeak',
  languages: ['en', 'hi', 'mr', 'gu', 'ta', 'te', 'bn', 'kn', 'ml', 'pa', 'or'],
  async synthesize({ text, voice, lang, speed }, out) {
    execFileSync('espeak-ng', ['-v', voice || lang, '-s', String(Math.round(175 * speed)), '-w', out, text]);
    const bytes = statSync(out).size - 44;          // 16-bit mono 22050 Hz PCM after a 44-byte header
    return { durationSec: bytes / (22050 * 2) };
  },
};
```

## Built-in engines

### `kokoro`

This is the `narascreen-kokoro` container at `http://localhost:8880`, an OpenAI-style API.
- `options.endpoint` defaults to `http://localhost:8880/v1/audio/speech`, and `options.model` to `kokoro`.
- **Languages:** `en` and `hi`. Kokoro picks its pronunciation from the voice's first letter, so `check()` refuses a mismatch:
  - English voices start with `a` or `b` (`af_heart`, `am_michael`, `bf_emma`…);
  - Hindi voices start with `h` (`hf_alpha`, `hf_beta`, `hm_omega`, `hm_psi`).
- `GET /v1/audio/voices` lists all voices.
- The server writes a placeholder length in the WAV header, so the engine measures the duration from the data bytes and fixes the header.

### `openai-compatible`

This engine works with any `/v1/audio/speech` server.
- `options.endpoint` is required: the full URL.
- `options.model` defaults to `tts-1`.
- `options.apiKeyEnv` is the *name* of an environment variable that holds a bearer token. Never put the token in the scene.
- `options.languages` lists the languages the server speaks. When it is unset, any language is accepted.
- `options.voicesUrl` is optional: a list endpoint that `check()` uses to verify voice names.

## Indian languages

The language codes are `en`, `hi` (Hindi), `mr` (Marathi), `gu` (Gujarati), `ta` (Tamil), `te` (Telugu), `bn` (Bengali), `kn` (Kannada), `ml` (Malayalam), `pa` (Punjabi) and `or` (Odia). Text maps and `--lang` accept all of them.

**Speech.** Kokoro speaks only English and Hindi. A scene asking it for `mr`, `gu` or any other Indic language fails before anything is synthesised:

```
make.mjs: voice engine "kokoro" cannot speak Gujarati ("gu"); it speaks en, hi (hint: set voice.engine to an engine that supports "gu": ...)
```

For the other languages, use one of these:
- point `openai-compatible` at an Indic TTS server, and list its `options.languages`;
- write a small custom engine module, as in the example above.

**Bubbles only.** `--no-voice` needs no engine, so `--no-voice --lang gu` gives Gujarati bubbles today, timed by an estimate.

**Bubble fonts.** Bubbles ask for Georgia, and fontconfig falls back by script:
- Hindi and Marathi (Devanagari) use Noto Serif Devanagari or Noto Sans Devanagari;
- Gujarati uses Noto Serif Gujarati.

All three are installed on this machine (`fc-list :lang=hi`, `:lang=mr`, `:lang=gu`), and Devanagari and Gujarati bubbles render correctly. On a machine without the Noto Indic fonts, the text shows as boxes: install `fonts-noto-core`. For other scripts (Tamil, Bengali…), check with `fc-list :lang=ta` before rendering.
