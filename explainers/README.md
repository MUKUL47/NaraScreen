# Stick-figure explainers

Short animated explainer videos (workplace training, road safety, how-tos) made from **one JSON file** of stick figures, props and voice lines, written by an AI agent and rendered locally. It is built on the [figures](https://github.com/cherifya/figures) engine, vendored in `vendor/figures/`. You can optionally finish the video in NaraScreen with title cards, chapters, music and callouts.

This file is the guide for agents (the "LLM readme"). Humans can read it too. A short orientation is in [`llms.txt`](llms.txt).

Commands run from the NaraScreen repo root. File paths are relative to this folder (`explainers/`), except those starting with `editor/` or `scripts/`, which are relative to the repo root.

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

Then run `ns validate script.json`, then `ns make script.json --out out/job`, and open the contact sheet (`preview.contactSheet` in the reply) to check that every callout and arrow lands where you meant. For music, add `"music": { "path": …, "volume": …, "duckTo": … }` (see MANUAL, "Narration & voices" → "Music and output"). Music ducks only under NaraScreen's own `narrate`, not under voices already baked into the video. So when `make.mjs` added voices, keep the music `volume` low, about 0.15. A `source.video` job keeps the source's audio (the voice track from `make.mjs`) and mixes the music under it.

- **Chapters for YouTube:** every chapter must be at least 10 s long in the final video, or YouTube ignores the list. Check `video/chapters_<lang>.txt` in the job folder; the intro card shifts the times.
- **Re-rendered `scene.mp4`:** running `ns make` again on the same job after `scene.mp4` changed re-imports the new video by itself, with a "source video changed" warning.

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
| `node explainers/tools/make.mjs <scene.json> <out.mp4> [--lang hi] [--engine maya2] [--no-voice] [--pad 0.4] [--cache <dir>] [--size …] [--fps …] [--bg …] [--workers …]` | Voices plus render plus mix, in one MP4. `--engine` overrides `voice.engine` for this run. `--no-voice` gives a video with no audio stream, but bubbles are still drawn. `--size`, `--fps`, `--bg` and `--workers` are passed to `render.mjs`. |
| `node explainers/tools/make.mjs <scene.json> <outdir/> --stills 4 9.5 [--lang hi] [--no-voice]` | PNG stills with the voice-line bubbles, no audio. |
| `python3 explainers/vendor/figures/check_spec.py <scene.json>` | Upstream's linter. It does not know about add-ons, so prefer `lint.mjs`. |
| `node --test explainers/tools/` | The tools' own tests. |

`tools/voice.mjs` is the library behind `make.mjs` (planning, synthesis, timing checks, bubbles, mixing). It has no command line of its own.

Errors are one line on stderr with a non-zero exit, for example a missing ffmpeg or Playwright, with the path that was searched.

## Add-ons

Figures' built-in vocabulary is fixed. Add-ons add poses, expressions, held items, looks, fx (props) and sets without editing the engine. The full contract is in [`addons/README.md`](addons/README.md).

**Using the base library.** List add-ons by name in `"addons"`:
- `road-safety` ([`addons/road-safety/README.md`](addons/road-safety/README.md)):
  - fx `car` (side view, driven by `k` keys on `x`), `traffic-light` (`state: red|amber|green|red-amber|off`), `ped-signal` (`walk|dont`), `road-sign`, `zebra`, `stop-line`, `crossing-view`, `street-view` and `town-backdrop`;
  - poses `driving`, `driving_wave` and `driving_thumbs`;
  - sets `road` (the crossing view) and `street` (the street view), with a `cuts` option to switch views;
  - places `near-kerb`, `far-kerb`, `crossing`, `stop-line`, `light-post`, `car-stop`, `driver-seat`, `off-left` and `off-right`.
- `workplace` ([`addons/workplace/README.md`](addons/workplace/README.md)):
  - fx `shelf`, `counter`, `till`, `wet-floor-sign`, `cone`, `extinguisher`, `exit-sign`, `desk`, `whiteboard` and `room`;
  - looks `vest`, `vest-orange`, `name-badge`, `apron`, `hard-hat` and `work-cap` (not `cap`, which is a built-in red dome);
  - items `product`, `shopping-bag` and `card`;
  - sets `shop` (places `door`, `shelf`, `counter-staff`, `counter-customer`, `till`) and `office` (places `door`, `whiteboard`, `desk`, `chair`).

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
- `chatterbox`: Chatterbox Multilingual V3 at `http://127.0.0.1:8890`, `en` and `hi`. The most natural voices of the three, about 1× real time.
- `maya2`: Maya-2-Native at `http://127.0.0.1:8891`, `en` plus `hi`, `mr`, `gu`, `ta`, `te`, `bn`, `kn`, `ml`, `pa`, `or`, `as`, all native. About 0.85× real time.
- `openai-compatible`: any `/v1/audio/speech` server. Set `options.endpoint` and `options.model`. Set `options.apiKeyEnv` to the **name** of an environment variable that holds the key, never the key itself.

**Choosing an engine.**

| Engine | Languages | Pick it for |
|---|---|---|
| `kokoro` | en, hi | fast drafts (~20× real time), and the same voices as NaraScreen |
| `chatterbox` | en, hi | the most natural English and Hindi |
| `maya2` | en, hi, mr, gu, ta, te, bn, kn, ml, pa, or, as | Marathi, Gujarati and the other Indian languages |

- Chatterbox and Maya run on the GPU next to Kokoro, and **only one of the two fits at a time**. From the repo root, `scripts/voice-engine.sh up chatterbox` or `scripts/voice-engine.sh up maya2` starts one and stops the other (Maya is ready after about 80 s); Kokoro keeps running. `scripts/voice-engine.sh status` shows all three. If the server is down, the run stops before any synthesis with that start command as the hint. The servers' setup (AMD GPU, data directory `$NARASCREEN_TTS_HOME`, first-run downloads, licences) is in [`voices/servers/README.md`](voices/servers/README.md).
- Both accept the voice aliases `"female"` and `"male"`, so `"voices": { "narrator": "female", "RAVI": "male" }` works on either. Real names work too: Chatterbox `hi_f1`, `en_f1`, `default`; Maya `Vaidehi`, `Siddhant` and 18 more (see `voices/README.md`).
- Neither honours `speed`. A line is as long as the engine speaks it, so check the timing errors after switching engine.
- `make.mjs … --engine maya2` overrides `voice.engine` for one run, so one scene can be made with each engine. Audio from a different engine is cached separately.

**Adding an engine.** Write a module with this shape (the full contract is in [`voices/README.md`](voices/README.md)):

```js
export default {
  name: 'my-tts',
  languages: ['en'],                                           // optional; absent = any language
  async synthesize({ text, voice, lang, speed, options }, outWavPath) { /* write a WAV */ return { durationSec } },
  async check(options, { voices }) { return { ok: true, detail: '…' } },   // optional
  voices(lang) { return ['…'] },                               // optional
};
```

Then set `"engine": "./my-tts.mjs"`, or drop it into `./voices/`. The core never knows engine specifics. The built-in engines are `voices/kokoro.mjs`, `voices/chatterbox.mjs`, `voices/maya2.mjs` and `voices/openai-compatible.mjs`.

**Lines.**
- `t` is the start time in seconds.
- `who` is `narrator` or an actor's `label`.
- `text` is a string, or a per-language map.
- Optional: `voice` (overrides the voice for that line), `speed`, and `bubble`.
- An actor line gets a bubble automatically (`bubble: true` is the default), placed beside and above the speaker's head. An object with any of `x`, `y`, `w`, `h`, `fs`, `tail` places it yourself. The bubble shows the line's text for as long as the audio lasts, plus `--pad` (default 0.4 s).
- `bubble: false`, or any `narrator` line, is voice only. Narrator lines never get a bubble.
- Hand-written `bubble` fx keep working alongside lines.

**Language.** `voice.lang` is the default, and `make.mjs … --lang hi` overrides it. Each line uses `text[lang]`, and a speaker uses `voices[who][lang]` when it is a map. A missing language falls back to `en`. If there is no `en` either, that is an error. To make one video per language, run `make.mjs` once per `--lang` into separate files. `--lang` switches the bubble text too.
- Accepted language codes: `en`, `hi`, `mr`, `gu`, `ta`, `te`, `bn`, `kn`, `ml`, `pa`, `or`, `as`.
- Kokoro speaks only `en` and `hi`. A language the engine can't speak fails before anything is synthesised. For the others, use `maya2`, `openai-compatible` against another TTS server, or a custom engine (see `voices/README.md`).
- `--no-voice` needs no engine: bubbles are still drawn, timed from the cached audio length or an estimate. So `--no-voice --lang gu` gives Gujarati bubbles today.
- Bubbles render Devanagari (Hindi, Marathi) and Gujarati through the Noto fonts installed here. Without them the text shows as boxes; check other scripts with `fc-list :lang=ta`.

**Checks and caching.** These are errors, with the measured length as a hint:
- a line that overlaps the speaker's next line;
- a line that runs past `duration`;
- an unknown `who`.

Synthesised audio is cached in `explainers/.voice-cache/` (git-ignored; override with `--cache <dir>` or `EXPLAINERS_VOICE_CACHE`) by a hash of engine, voice, lang, speed and text, so re-running only synthesises changed lines. The lines are mixed at their `t`, loudness-normalised, and muxed into the MP4. `make.mjs` does not run lint, so lint first.

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
- **Crossing a road in side view.** Figures only draws side-on. With the road-safety add-on, cut between two views of one road: the `road` (crossing) view, where the pedestrian walks left to right from `near-kerb` to `far-kerb`, and the `street` view, where the car drives in and stops at `stop-line`. `examples/road-crossing/scene.json` uses `"set": { "name": "road", "cuts": [[8, "street"], [17, "road"], [25, "street"]] }`. Both views share one layout, so places keep their x and signals at `light-post` can stay on screen. Without the add-on, show the car in its own beat (as `preview/road-rules.json` does from 20 s).
- **Cut recipe.** The set does not hide your props at a cut. For each fx, give `t0`/`t1` with `"fade": 0.001`, and start the incoming fx 0.002 s before the cut (`"t0": 7.998` for a cut at 8). `"fade": 0` gives NaN opacity, and an incoming `t0` equal to the outgoing `t1` gives a blank frame. For actors, use two `op` keys 0.02 s apart (`{ "t": 16.98, "op": 1 }, { "t": 17.0, "op": 0 }`).
- **Car and driver lock.** The `car` fx has no built-in driver; the driver is an ordinary actor. With road-safety, use the `driving` pose (or `driving_wave`, `driving_thumbs`) and give the driver keys at **the same `t`** as every car `k` key, with **x = car x + 14·s** (minus when the car faces left), `"y": "@driver-seat"`, and **no `move`**, so both ease the same way. Draw the car with `front: true` so it hides the driver's legs. The car eases at every key, so start it far enough off-screen that its speeding-up half is hidden (for example 4.5 s from x −1329 to `@car-stop` at 1920 wide). See `addons/road-safety/README.md`, "A car with a driver". Without the add-on, `preview/road-rules.json` (the car from 20 s, actor 1) does the same with a `sitting` pose and hand-made beams; there a seated driver may give a "standing pose floating" warning, which is expected.
- **One gesture per beat.** Let the other figure react 0.2–0.3 s later. Hold the final tableau for 0.8 s or more.
- **NaraScreen callouts** go on a still part of the frame. Place `at` after the figure has stopped (see Limits).

## Limits of v1

- **Side view only.** There is no top-down or 3/4 view and no depth. Figures stand on one ground line.
- **No tracking.** NaraScreen effects are fixed `rect`s at an `at` time. They don't follow moving figures, so place them after the figure stops and keep them short. There are no named anchors either: rects come from `--map` by hand.
- **Audio** is voice lines only (`make.mjs`). Music and sound effects come from the NaraScreen finishing step. There is no lip sync: mouths don't follow the audio.
- **Bubbles are one line,** with no wrapping or auto-sizing beyond what `bubble: true` does.
- **Places** resolve only in `x`, `y`, `x1`, `y1`, `x2` and `y2` fields, and are points on the floor.
- **The engine is pinned** (`vendor/figures/VENDORED.md`). Changes go in add-ons or `tools/`, never in the vendored files, except for the documented registry patch.

## Examples

- [`preview/road-rules.json`](preview/road-rules.json): 38 s, six road rules, built-in vocabulary only, with a hand-built car and driver. The render is `preview/road-rules.mp4`.
- [`examples/road-crossing/`](examples/road-crossing/): road-safety add-on. A pedestrian waits, a driver stops at the line, the sign turns to WALK, and they cross. It has `scene.json` plus a `narascreen.demo-script.json` finishing script.
- [`examples/shop-greeting/`](examples/shop-greeting/): workplace add-on. A customer is greeted, helped to an item, pays and leaves. It has `scene.json` plus a `narascreen.demo-script.json`.
- [`preview/road-rules-voiced.json`](preview/road-rules-voiced.json): road-rules with Kokoro voice lines in English and Hindi (47.6 s). The renders are `preview/road-rules-voiced-en.mp4` and `preview/road-rules-voiced-hi.mp4`.
- [`preview/road-rules-voiced-indic.json`](preview/road-rules-voiced-indic.json): the same story with Marathi and Gujarati lines added, retimed for the longer Indic lines (52 s), voiced with the `female`/`male` aliases. The renders are `preview/road-rules-chatterbox-hi.mp4` (`--engine chatterbox --lang hi`), `preview/road-rules-maya-mr.mp4` and `preview/road-rules-maya-gu.mp4` (`maya2`, `--lang mr` / `--lang gu`).
- `vendor/figures/examples/*.json`: upstream's small 900×400 scenes.

Render output goes in each example's `out/`, which git ignores (the repo `.gitignore` has `out/`).

## Credits and licences

- **figures** by [Cherif Yaya](https://github.com/cherifya/figures), MIT (`vendor/figures/LICENSE`). It is vendored at commit `f3c70cf` with one documented local patch (the add-on registry). See `vendor/figures/VENDORED.md`.
- Its pose library, props and effects derive from **stix** by Bassime Ledath, MIT.
- The renderer, linter, add-on loader, voice pipeline and base add-ons in this folder are part of NaraScreen, MIT.
