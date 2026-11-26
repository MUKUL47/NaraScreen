# Stick-figure explainers

Short animated explainer videos (workplace training, road safety, how-tos) made from **one JSON file** of stick figures, props and voice lines, written by an AI agent and rendered locally. It is built on the [figures](https://github.com/cherifya/figures) engine, vendored in `vendor/figures/`. You can optionally finish the video in NaraScreen with title cards, chapters, music and callouts.

This file is the guide for agents (the "LLM readme"). Humans can read it too. A short orientation is in [`llms.txt`](llms.txt).

Commands run from the repo root (`/home/mukul/personalscrapper/ui-demo-pipeline`). File paths are relative to this folder (`explainers/`), except those starting with `editor/` or `scripts/`, which are relative to the repo root.

## When to use it

| Use stick-figure explainers when… | Record a website with NaraScreen instead when… |
|---|---|
| the subject is people and behaviour: greeting a customer, crossing a road, lifting safely | the subject is software: a product, a form, a dashboard |
| there is nothing real to record, or real footage would be costly or unsafe | the app runs at a URL you can open |
| you want a story with characters, speech bubbles and voices | you want real clicks, real data and selectors |

Both paths can end in the same NaraScreen finishing step (cards, chapters, music, callouts).

## The model: one JSON

A scene is one figures spec (see [`vendor/figures/spec.md`](vendor/figures/spec.md)) plus a few keys the tools add. Everything about the video lives in this file:

```json
{
  "title": "Crossing the road",
  "w": 1600, "h": 900, "ground": 760, "labelFs": 28, "duration": 30,
  "addons": ["road-safety"],
  "set": "road",
  "places": { "bench": { "x": 200, "y": 760 } },
  "actors": [ { "label": "RAVI", "s": 2.8, "keys": [
    { "t": 0, "x": -120, "y": "@near-kerb", "pose": "standing", "face": 1 },
    { "t": 2.6, "x": "@near-kerb", "move": "walk" } ] } ],
  "fx": [ { "type": "traffic-light", "x": "@light-post", "y": "@light-post", "k": [ { "t": 0, "state": "red" }, { "t": 12, "state": "green" } ] } ],
  "voice": { "engine": "kokoro", "lang": "en", "voices": { "narrator": "af_heart", "RAVI": "am_michael" } },
  "lines": [ { "t": 3.2, "who": "RAVI", "text": "I'll wait here.", "bubble": true } ]
}
```
<!-- VERIFY: the road-safety fx names (`traffic-light`, its `state` values) and the place names (`near-kerb`, `light-post`) match explainers/addons/road-safety/ once it exists. -->

| Key | What |
|---|---|
| `w`, `h`, `ground`, `duration`, `start`, `labelFs` | The canvas in scene units, the ground line's y, and the length. Standard figures keys. |
| `actors`, `fx` | Figures and effects with sparse time keys. See `vendor/figures/spec.md`. |
| `addons` | The vocabulary packs this scene uses. A bare name means `./addons/<name>/`, and a path is relative to the scene file. See [Add-ons](#add-ons). |
| `set` | A background, a foreground and named places from an add-on: `"road"`, or `{ "name": "road", ...options }`. |
| `places` | Your own named floor points, `{ "name": { "x", "y" } }`. They add to or override the set's places. Use them as `"@name"` or `"@name+40"` in any `x`, `y`, `x1`, `y1`, `x2` or `y2`. On an actor's `y`, `"@place"` means "feet on the place". |
| `voice` | The voice engine and the voice for each speaker. See [Voices](#voices). |
| `lines` | Timed voice lines, optionally shown as speech bubbles. See [Voices](#voices). |

Vocabulary (poses, expressions, looks, items, fx types) is in [`vendor/figures/spec.md`](vendor/figures/spec.md). Beat recipes (entrance, greeting, handshake, reveal, argument, triumph, defeat, comedy timing) are in [`vendor/figures/acting.md`](vendor/figures/acting.md). Read both before writing a scene. They are not repeated here.

## The loop

1. **Plan the beats.** Write a list with one clear action per beat and its rough time: "0–3 s RAVI walks to the kerb; 3–8 s waits, the light is red; …". Leave at least 0.8 s of hold at the end.
2. **Write the JSON.** Start from a working scene: [`preview/road-rules.json`](preview/road-rules.json) (38 s, no add-ons), or the examples below.
3. **Lint:** `node explainers/tools/lint.mjs scene.json`. Fix every `ERROR`, and read the `WARN`s (floating feet, actors too close, figure at the frame edge, bubble on a head or label, raw `&` or `<`). Repeat until it is clean.
4. **Stills:** `node explainers/tools/render.mjs scene.json out/stills/ --stills 2 5 9 14 20`, with one time per beat.
5. **Look** at every still (open the PNGs). Check for overlaps, cut-off bubbles, floating or off-screen figures, and unreadable text. Fix the JSON, then go back to step 3.
6. **Make the video:** `node explainers/tools/make.mjs scene.json out/scene.mp4`. This synthesises the voice lines, adds their bubbles, renders the frames and mixes in the audio. For a silent video use `--no-voice`, or `render.mjs scene.json out/scene.mp4`.
7. **Watch it,** or at least take stills around every line, to check that the bubbles and voices line up.
8. **Optional: finish it in NaraScreen** (below).

Render time: about 1 minute per 30 s of 1080p30 with the default 4 workers.

### Finishing in NaraScreen (optional)

NaraScreen can edit an existing video: a script with `"source": { "video": "out/scene.mp4" }` contains only effects, each placed with `at` (seconds into the video) and `rect: [x, y, width, height]` in **output video pixels**. Read `editor/api/MANUAL.md`, section "Editing an existing video", first, and check field names with `ns schema` (where `ns` = `editor/bin/narascreen`).

```json
{
  "version": 1,
  "scope": "road-crossing",
  "source": { "video": "out/scene.mp4" },
  "intro": { "template": "clean", "title": "Crossing the road safely" },
  "outro": { "template": "bold", "title": "Stop. Look. Cross.", "duration": 3 },
  "chapters": { "onScreen": true },
  "steps": [
    { "id": "wait", "chapter": "Wait", "beat": [
      { "fx": "callout", "at": 3.5, "style": "lower-third", "text": "Wait for the WALK sign", "duration": 4 } ] },
    { "id": "stop", "chapter": "Stop", "beat": [
      { "fx": "arrow", "at": 9.0, "rect": [763, 948, 634, 49], "text": "Stop line", "duration": 3 },
      { "fx": "chapter", "title": "Cross", "at": 14 } ] }
  ]
}
```
This sketch passes `ns validate` against a 38 s source. The "No narration" warning is expected when the voices are already in the video.

Then run `ns validate script.json`, then `ns make script.json --out out/job`, and open the contact sheet (`preview.contactSheet` in the reply) to check that every callout and arrow lands where you meant. For music, add `"music": { "path": …, "volume": …, "duckTo": … }` (see MANUAL, "Narration & voices" → "Music and output"). Music ducks only under NaraScreen's own `narrate`, not under voices already baked into the video. So when `make.mjs` added voices, keep the music `volume` low, about 0.15.
<!-- VERIFY: NaraScreen keeps the source video's audio (the voice track from make.mjs) in a source.video job and mixes music under it. The `mute` fx suggests the source audio is kept. -->

**Converting scene units to video pixels.** Don't guess. Ask the renderer:

```sh
node explainers/tools/render.mjs scene.json --map            # letterbox only
node explainers/tools/render.mjs scene.json --map --at 9.0   # plus figures' camera drift at t = 9.0
```

It prints `{ scale, offsetX, offsetY, videoW, videoH, duration }`, and with `--at` also `camera`. The conversion is **video px = scene unit × scale + offset**, for x and y separately. Widths and heights are multiplied by `scale` only.

- **Actors and ordinary scene fx** sit inside a slow camera drift (zoom up to 1.6%). Use `--map --at <the effect's at>`.
- **Overlay fx** (`tint`, `night`, `snow`, and add-on fx with `layer: 'overlay'`) are outside the camera. Use the plain `--map`.
- Times (`--at`, `--stills`, frame times) are video seconds. Video 0 is the scene's `start`.

**A worked number** from `preview/road-rules.json` (1600×900 scene, 1920×1080 video). The zebra band spans scene x 600 to 1120 and y 785 to 825:

- Plain `--map` gives `scale 1.2, offsetX 0, offsetY 0`, so the rect would be `[720, 942, 624, 48]`.
- `--map --at 9` gives `scale 1.2192, offsetX 31.46, offsetY -8.64`:
  - x = 600 × 1.2192 + 31.46 = **763**;
  - y = 785 × 1.2192 − 8.64 = **948**;
  - w = 520 × 1.2192 = **634**;
  - h = 40 × 1.2192 = **49**;
  - so `rect: [763, 948, 634, 49]`.

  The drift moves the band 43 px. That is enough to miss a small target, so use `--at`.
- A scene that isn't 16:9 is letterboxed, never stretched. For example, 900×400 in 1920×1080 gives `scale 2.1333, offsetX 0, offsetY 113.33`.

## Commands

All of these run locally and need nothing new installed: they use NaraScreen's own Playwright and Chromium (`editor/node_modules/playwright`, overridable with `FIGURES_PLAYWRIGHT`) and `ffmpeg` on the PATH.

| Command | What |
|---|---|
| `node explainers/tools/lint.mjs <scene.json> [more.json …] [--strict]` | Static checks with add-on vocabulary and typo suggestions. Prints one line per problem, `<JSON path>: ERROR\|WARN <message>`. Exits 0 when there are no errors, or with `--strict` no warnings either. |
| `node explainers/tools/render.mjs <scene.json> <out.mp4> [--size 1920x1080] [--fps 30] [--bg #FFFFFF] [--workers 4]` | Silent MP4. Frame `i` is drawn at `start + i/fps`, and there are `round(duration × fps)` frames. |
| `node explainers/tools/render.mjs <scene.json> <outdir/> --stills 1.5 4.0 [--size …] [--bg …]` | PNG stills `still-1.50.png`, … at video seconds. |
| `node explainers/tools/render.mjs <scene.json> --map [--size …] [--at <t>]` | The scene-to-video transform as JSON (see above). |
| `node explainers/tools/make.mjs <scene.json> <out.mp4> [--lang hi] [--no-voice]` | Voices plus render plus mix, in one MP4. `--no-voice` gives the silent video. |
| `node explainers/tools/voice.mjs …` | Voice helper. <!-- VERIFY: voice.mjs usage line (e.g. checking the engine or listing voices); copy it from the file once it exists. --> |
| `python3 explainers/vendor/figures/check_spec.py <scene.json>` | Upstream's linter. It does not know about add-ons, so prefer `lint.mjs`. |
| `node --test explainers/tools/` | The tools' own tests. |

<!-- VERIFY: whether make.mjs also accepts render.mjs options (--size, --fps, --bg, --workers). -->

Errors are one line on stderr with a non-zero exit, for example a missing ffmpeg or Playwright, with the path that was searched.

## Add-ons

Figures' built-in vocabulary is fixed. Add-ons add poses, expressions, held items, looks, fx (props) and sets without editing the engine. The full contract is in [`addons/README.md`](addons/README.md).

**Using the base library.** List add-ons by name in `"addons"`:
- `road-safety`: a side-view `car` driven by `k` keys on `x`, a `traffic-light` with `state: red|amber|green`, `zebra`, `stop-line`, `road-sign`, and the `road` set with places `near-kerb`, `far-kerb`, `stop-line`, `crossing` and `light-post`.
- `workplace`: `shelf`, `counter` (drawn in front of the actors), `wet-floor-sign`, `cone`, `extinguisher`, the looks `vest` and `cap`, and the `shop` set with places `door`, `counter-staff`, `counter-customer` and `shelf`.

<!-- VERIFY: the base-library names above against explainers/addons/road-safety/index.mjs and explainers/addons/workplace/index.mjs. Note that `cap` is also a built-in look, and the loader refuses add-ons that reuse built-in names, so the workplace cap may have a different name. -->

The add-on's names then work like built-in ones, and lint knows them.

**Writing your own.** Write an ES module whose default export is `{ name, poses?, exprs?, items?, looks?, fx?, sets?, vocab? }`. Put it next to the scene (`"addons": ["./my-props.mjs"]`), or in `./addons/<name>/index.mjs` to make it part of the base library. The rules that matter:
- browser-safe JS only (no `node:` imports, no npm);
- drawers are pure functions of `(f, t, h)` that return SVG strings (no `Math.random()` or `Date`; use `h.hsh`/`h.nz` for noise);
- escape scene text with `h.esc()`;
- no reusing built-in names.

A tested minimal add-on is `tools/fixtures/fixture-addon/`.

## Voices

The voices live in the same JSON as the scene. `make.mjs` reads `voice` and `lines`. `render.mjs` ignores them and stays silent.

```json
"voice": { "engine": "kokoro", "lang": "en", "speed": 1.0,
           "voices": { "narrator": "af_heart", "RAVI": { "en": "am_michael", "hi": "hm_omega" } },
           "options": { "endpoint": "http://localhost:8880/v1/audio/speech" } },
"lines": [
  { "t": 3.2, "who": "narrator", "text": { "en": "Rule one: stop at the kerb.", "hi": "पहला नियम: किनारे पर रुकें।" } },
  { "t": 4.0, "who": "RAVI", "text": "I'll wait here.", "bubble": { "x": 700, "y": 385, "tail": 1 } }
]
```

**Engines.** The `engine` key picks one and defaults to `kokoro`. A bare name loads `./voices/<name>.mjs`, and a path (relative to the scene) loads your own module.
- `kokoro`: the local Kokoro server at `http://localhost:8880`. Start it with `scripts/voice-engine.sh` from the repo root (GPU first, CPU fallback). It is the same engine NaraScreen uses, so voice names like `af_heart`, `am_michael` and `hm_omega` work here too (`ns voices [--lang hi]` lists them).
- `openai-compatible`: any `/v1/audio/speech` server. Set `options.endpoint` and `options.model`. Set `options.apiKeyEnv` to the **name** of an environment variable that holds the key, never the key itself.

**Adding an engine.** Write a module with this shape (the full contract is in [`voices/README.md`](voices/README.md)):

```js
export default {
  name: 'my-tts',
  async synthesize({ text, voice, lang, speed, options }, outWavPath) { /* write a WAV */ return { durationSec } },
  async check(options) { return { ok: true, detail: '…' } },   // optional
  voices(lang) { return ['…'] },                               // optional
};
```

Then set `"engine": "./my-tts.mjs"`, or drop it into `./voices/`. The core never knows engine specifics.
<!-- VERIFY: voices/README.md exists and states this contract; built-in engine files are voices/kokoro.mjs and voices/openai-compatible.mjs. -->

**Lines.**
- `t` is the start time in seconds.
- `who` is `narrator` or an actor's `label`.
- `text` is a string, or a per-language map.
- Optional: `voice` (overrides the voice for that line), `speed`, and `bubble`.
- `bubble: true` auto-places a bubble above the speaker. An object `{ x, y, tail }` places it yourself. The bubble shows the line's text for as long as the audio lasts, plus padding.
- `bubble: false`, or any `narrator` line, is voice only.
- Hand-written `bubble` fx keep working alongside lines.

**Language.** `voice.lang` is the default, and `make.mjs … --lang hi` overrides it. Each line uses `text[lang]`, and a speaker uses `voices[who][lang]` when it is a map. A missing language falls back to `en`. If there is no `en` either, that is an error. To make one video per language, run `make.mjs` once per `--lang` into separate files.
<!-- VERIFY: --lang also switches bubble text to that language; check the font renders Devanagari in bubbles. -->

**Checks and caching.** These are errors, with the measured length as a hint:
- a line that overlaps the speaker's next line;
- a line that runs past `duration`;
- an unknown `who`.

Synthesised audio is cached by a hash of engine, voice, lang, speed and text, so re-running only synthesises changed lines. The lines are mixed at their `t`, loudness-normalised, and muxed into the MP4.
<!-- VERIFY: cache folder location, and whether make.mjs runs lint first. -->

## Staging tips

These come from making the preview and example videos. Read `vendor/figures/spec.md` ("Staging tips") and `acting.md` too.

- **Canvas and scale.** Use a 16:9 scene so nothing is letterboxed. `1600×900` with `ground: 760` and `labelFs: 28` works well. Give main figures `s` **2.5–2.8**. The figures default of 1.3 is for 900×400 and looks tiny at 16:9. A standing hip goes at `y = ground − 53·s` (for example, 760 − 53 × 2.8 = 611.6), or use `"y": "@place"` and let the tools work it out.
- **Spacing.** Keep figures at least about 110 units apart at scale 1.3, and proportionally more at 2.8. Lint warns below about 95. Enter from off-canvas (`x: -120` or `w + 120`) with `move: "walk"`, at about 150 units per second, or 300 to run.
- **Bubble geometry.**
  - A bubble's `y` is the **bottom** of its box, not its centre. The tail hangs about 22 units below that.
  - Put the bubble beside and above the speaker's head, clear of the label. Lint reports overlaps with heads and labels.
  - The tail leans left with `tail: 1` and right with `tail: -1`, which is the default. So with the speaker on the **left** of the bubble use `tail: 1`, and with the speaker on the right use `tail: -1`. In road-rules, RAVI is at x 480 and the bubble at x 700 with `tail: 1`.
- **Bubble text.** Keep it to **6–8 words** on one line. Bubbles don't wrap, so long text overflows the box. Size `w` to the text: roughly `characters × fs × 0.55 + 30`, for example 260 for "I'll wait here." at `fs` 32.
- **Escaping.** Figures inserts text into the SVG unescaped. In any `text`, `title` or `big` field, write `&amp;` for `&` and `&lt;` for `<`. Lint flags raw ones.
- **Crossing a road in side view.** Figures only draws side-on, so lay the crossing out left to right: near kerb, then the road band with the zebra, then the far kerb. The pedestrian crosses by walking along x. Cars travel along the same axis, so never let a moving car and the walker share x at the same moment. Stop the car at the stop line *before* the zebra, then let the pedestrian cross. Alternatively, show the car in its own beat (as `preview/road-rules.json` does from 20 s). Put the signal on a tall post (a `screen` with `leg`, or the add-on's `traffic-light`) where it doesn't cover heads.
  <!-- VERIFY: compare this framing with explainers/examples/road-crossing/scene.json once it exists. -->
- **Car and driver lock.** A driver is an ordinary actor in a seated pose (`sitting`) placed in the car. Keep them together by giving the driver keys at **exactly the same times and x positions** as the car's `k` keys (driver x = car x + a constant offset), without `move: "walk"`, so both ease the same way. Draw the car body with `front: true` so it hides the driver's legs. Keep the driver at `op: 0` until the car enters. `preview/road-rules.json` (the car from 20 s, actor 1) does exactly this with hand-made beams. A seated driver may give a "standing pose floating" warning on keys where you switch to `thumbs_up` or `shrug`. That is expected inside a car.
  <!-- VERIFY: whether the road-safety `car` fx offers a built-in driver seat or offset field that makes this easier. -->
- **One gesture per beat.** Let the other figure react 0.2–0.3 s later. Hold the final tableau for 0.8 s or more.
- **NaraScreen callouts** go on a still part of the frame. Place `at` after the figure has stopped (see Limits).

## Limits of v1

- **Side view only.** There is no top-down or 3/4 view and no depth. Figures stand on one ground line.
- **No tracking.** NaraScreen effects are fixed `rect`s at an `at` time. They don't follow moving figures, so place them after the figure stops and keep them short. There are no named anchors either: rects come from `--map` by hand.
- **Audio** is voice lines only (`make.mjs`). Music and sound effects come from the NaraScreen finishing step. There is no lip sync: mouths don't follow the audio. <!-- VERIFY: no lip sync / mouth movement from voice lines in make.mjs. -->
- **Bubbles are one line,** with no wrapping or auto-sizing beyond what `bubble: true` does.
- **Places** resolve only in `x`, `y`, `x1`, `y1`, `x2` and `y2` fields, and are points on the floor.
- **The engine is pinned** (`vendor/figures/VENDORED.md`). Changes go in add-ons or `tools/`, never in the vendored files, except for the documented registry patch.

## Examples

- [`preview/road-rules.json`](preview/road-rules.json): 38 s, six road rules, built-in vocabulary only, with a hand-built car and driver. The render is `preview/road-rules.mp4`.
- [`examples/road-crossing/`](examples/road-crossing/): road-safety add-on. A pedestrian waits, a driver stops at the line, the sign turns to WALK, and they cross. It has `scene.json` plus a `narascreen.demo-script.json` finishing script. <!-- VERIFY: folder and files exist. -->
- [`examples/shop-greeting/`](examples/shop-greeting/): workplace add-on. A customer is greeted, helped to an item, pays and leaves. It has `scene.json` plus a `narascreen.demo-script.json`. <!-- VERIFY: folder and files exist. -->
- `vendor/figures/examples/*.json`: upstream's small 900×400 scenes.

Render output goes in each example's `out/`, which git ignores (the repo `.gitignore` has `out/`).

## Credits and licences

- **figures** by [Cherif Yaya](https://github.com/cherifya/figures), MIT (`vendor/figures/LICENSE`). It is vendored at commit `f3c70cf` with one documented local patch (the add-on registry). See `vendor/figures/VENDORED.md`.
- Its pose library, props and effects derive from **stix** by Bassime Ledath, MIT.
- The renderer, linter, add-on loader, voice pipeline and base add-ons in this folder are part of NaraScreen, MIT.
