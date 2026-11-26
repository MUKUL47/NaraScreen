# Stick-figure explainers, version 1 (approved 2026-11-26)

Supersedes the first release of `2026-11-26-stick-figure-scenes-design.md`. That fuller design (scene plugin, kit, tracking) is kept as the possible next step, once a real v1 video shows what is missing.

## Intent

Workplace training videos (shop customer service, road safety) made of animated stick figures, written as scripts by an AI agent. No changes to NaraScreen's code: existing website, Flutter and video-source scripts must behave exactly as before.

## Approaches

- **A. figures renders the animation, NaraScreen finishes it via `source.video` (chosen by the user).** Zero core code. Effects in NaraScreen are placed by time (`at`) and pixel box (`rect`); the agent derives them from the figures JSON, which states every figure's position and timing.
- B. A small NaraScreen plugin playing figures scenes directly (anchors by name). Deferred.
- C. The full scene plugin with kit, sets and tracking. Deferred.

## What v1 delivers

1. **The figures engine, vendored** at `explainers/vendor/figures/` (pinned copy of [cherifya/figures](https://github.com/cherifya/figures), MIT, with its LICENSE and credits).
2. **A renderer that needs nothing new installed**: `explainers/tools/render.mjs`, using the Node Playwright + Chromium that NaraScreen's editor already has, and ffmpeg. It renders a figures JSON to MP4 (1920x1080, 30 fps by default) and can export stills at given times.
3. **A linter** for figures scenes: figures' own `check_spec.py` (Python standard library only, if that holds; otherwise a small Node port).
4. **Two worked examples**, each a figures scene plus a NaraScreen `source.video` script that adds a title card, chapters, callouts or arrows, and an end card, rendered end to end:
   - `explainers/examples/road-crossing/`: a pedestrian waits at the kerb, the light turns red for cars, a car stops, the pedestrian crosses; on-screen rules ("Stop at the line", "Wait for the green man").
   - `explainers/examples/shop-greeting/`: a customer walks in, the assistant greets them, helps find an item, thanks them; on-screen tips.
5. **A guide for agents**: `explainers/README.md` (the loop: write scene JSON, lint, check stills, render, write the NaraScreen script, `validate`, `make`, check the contact sheet), plus a section in the global `narascreen` skill pointing to it.

## Add-ons (user requirement, added 2026-11-26)

Stick-figure variety is open-ended, so v1 must grow without touching the engine:

- **Registry:** a small, clearly marked patch to the vendored `figures.js` adds `FIGURES.extend({ poses, items, looks, exprs, fx, sets })`. Unknown pose, item, look, expression or fx type names are looked up in the registry instead of falling back or failing. Built-in names keep working exactly as before. The patch is documented in `VENDORED.md` so it can be reapplied when the engine is updated.
- **Add-on = a JS module** exporting `{ name, poses?, items?, looks?, exprs?, fx?, sets?, vocab? }`. A scene lists the ones it uses: `"addons": ["road-safety", "./my-props.js"]`. A bare name means the base library `explainers/addons/<name>/`; a path (relative to the scene file) means an external add-on.
- **Sets:** a set is a background (fx drawn behind actors), optional foreground fx, and named places `{ name: { x, y } }`. Scenes can refer to places instead of raw coordinates where the tooling supports it (`"x": "@kerb"` resolved by the renderer before drawing).
- **Checker:** the linter loads the scene's add-ons and accepts their vocabulary, with the same typo checks as built-in names.
- **Base library v1:** `road-safety` (side-view car driven along `k` keyframes, traffic light with states, zebra crossing, stop line, road signs, a `road` set) and `workplace` (shelf, counter, wet-floor sign, cone, fire extinguisher, hi-vis vest and cap looks, a `shop` set). The two examples use them.

## Voices (user requirement, added 2026-11-26)

One JSON holds everything: the scene and its voices. The voice engine is a plug-in hook, chosen by a JSON key.

```json
"voice": { "engine": "kokoro", "lang": "en", "speed": 1.0,
           "voices": { "narrator": "af_heart", "RAVI": { "en": "am_michael", "hi": "hm_omega" } },
           "options": { "endpoint": "http://localhost:8880/v1/audio/speech" } },
"lines": [
  { "t": 3.2, "who": "narrator", "text": { "en": "Rule one: stop at the kerb.", "hi": "पहला नियम: किनारे पर रुकें।" } },
  { "t": 4.0, "who": "RAVI", "text": "I'll wait here.", "bubble": { "x": 700, "y": 385, "tail": 1 } }
]
```

- **`engine`:** defaults to `kokoro`. A bare name resolves to `explainers/voices/<name>.mjs`, and a path (relative to the scene) to an external engine module. Built-in engines:
  - `kokoro`: HTTP at localhost:8880;
  - `openai-compatible`: any `/v1/audio/speech` server, via `options.endpoint`, `options.model` and `options.apiKeyEnv`.
- **Engine contract:**

  ```
  export default {
    name,
    async synthesize({ text, voice, lang, speed, options }, outWavPath) → { durationSec },
    async check?(options) → { ok, detail },
    voices?(lang) → string[]
  }
  ```

  The core never knows engine specifics.
- **Lines:**
  - `t` is the start time in seconds.
  - `who` is `narrator` or an actor label.
  - `text` is a string or a per-language map.
  - Optional fields: `voice` (overrides the voice for that line), `speed`, and `bubble`.
  - `bubble` takes `true` for an auto-placed bubble above the actor, or an object to place it. Its text is the line's text and it lasts as long as the audio, plus padding.
  - A line with `bubble: false`, or a `narrator` line, is voice only.
- **Pipeline:** `tools/make.mjs <scene.json> <out.mp4> [--lang hi] [--no-voice]`:
  1. synthesise every line (cached by a hash of engine, voice, lang, speed and text);
  2. measure each one;
  3. inject bubble fx with real durations;
  4. render frames through render.mjs, unchanged;
  5. mix the lines at their `t` into one track (ffmpeg adelay + amix, loudness-normalised);
  6. mux it into the MP4.

  `--no-voice` gives today's silent video.
- **Checks:** a line that overlaps the next line from the same speaker, or runs past `duration`, is an error with a hint (the measured length). An unknown `who` is an error. A missing language with no `en` fallback is an error.
- **Bubbles:** existing hand-written bubble fx keep working. Lines are additive.

## Non-goals (v1)

Audio beyond voice lines (music and sound effects come from NaraScreen's finishing step); tracking; new NaraScreen acts or plugins; any edit under `editor/`.

## Calls made by Claude

- Folder `explainers/` at the repo root (not `docs/`, which is the published website).
- Node renderer instead of figures' Python one, so no Python Playwright install or second Chromium download.
- Bubbles: figures' own `bubble` effect; optional by simply leaving it out.
- Nothing is committed; the user commits from VS Code.
