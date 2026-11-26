# Stick-figure scenes: design

Date: 2026-11-26 · Status: draft for approval

## Intent

NaraScreen today records real websites. This adds a second kind of video: **animated stick-figure explainers** for workplace training, such as a shop assistant greeting and helping a customer, or a road-safety clip where a car stops at a red light while a pedestrian crosses. Simple flat characters in simple settings, in the style of Vyond or Powtoon explainers.

It is a **harness for an AI agent**, like the rest of NaraScreen's headless layer. The agent writes a JSON script, runs `validate` and `check`, looks at preview frames, fixes things, and renders again. The tool supplies the building blocks, clear errors and previews. It does not generate a video from a one-line prompt.

## Goals

1. A script can describe a scene (a set, a cast of stick figures, props) and a sequence of scripted actions: walk, talk (speech bubble), gesture, drive, change a traffic light, and so on.
2. Every existing NaraScreen effect works on scenes unchanged: zoom, spotlight, arrow, callout, highlight, blur, chapters, transitions, follow camera, title/end cards, speed/skip, music, output presets, subtitles (once narration exists).
3. The agent loop works the same: `validate` (instant, every problem with path + hint), `check` (dry run), `make`, `preview` contact sheet, and `inspect` (lists the figures and props with ready-to-paste selectors).
4. A ready-made **kit** for consistent results, plus **basic shapes** for one-off extras the kit lacks.
5. First release ships three sets: **shop**, **road junction**, **office**.

## Non-goals (this release)

- **Audio.** No narration, character voices or sound effects yet. Dialogue is speech bubbles only. The schema must leave room for adding a `voice` per character and narration later, without breaking scripts written now.
- Detailed or realistic characters (faces, clothing, lip sync). Stick figures only.
- Free-form drawing or illustration tools, physics, crowds, 3D.
- A desktop-app (Electron editor) UI for scenes. CLI and HTTP API only. A scene job may still open in the desktop app like any job, but no new editing UI is built.

## Anti-goals (a failure even if it technically works)

- **Any change in behaviour for existing scripts.** Website scripts, Flutter scripts and `source.video` scripts must produce the same results as before. The existing test suite (`npm run test:api`) must pass unchanged.
- Scenes that look messy or inconsistent depending on the agent (figures floating, overlapping props, text off-screen) without `validate` or `check` flagging it.
- An agent having to compute pixel coordinates for everyday actions. The kit uses named places ("counter", "stop-line", "door"), like website scripts use selectors.

## Constraints

- Lives as a plugin under `editor/api/plugins/scene/`, enabled per script by `"plugins": { "scene": { … } }`, following the Flutter plugin's pattern (`editor/api/plugins/index.ts`).
- Core changes are allowed only when they are **additive and gated on the plugin**, as the Flutter plugin already does (`swipe` is listed in `schema.ts` and checked in `checkPlugins`). Expected touch points:
  - `schema.ts`: the new acts in the act union, and `plugins.scene` options.
  - `validate.ts` / `checkPlugins`: scene acts require the scene plugin; `baseUrl` is not required when the scene plugin is on.
  - `runner.ts`: no `baseUrl` needed for scene scripts (the plugin supplies the page).
  - `plugins/index.ts`: register the plugin.
  - `MANUAL.md` and `docs.ts`: a new "Stick-figure scenes" section; `llms.txt` mention.
- The plugin uses only the existing hooks where possible (`preflight`, `attach`, `ready`, `runAct`, `inspectNotes`, `explainFailure`, `compileScript`). If a new hook is unavoidable, it is optional and unused by other plugins.
- Recording is real time (Chromium screencast), so animations play at their real speed in the browser and are recorded as they happen.
- Runs fully offline: the scene page and kit are bundled, with no network fetches.

## Approaches considered

| Approach | How | Trade-offs |
|---|---|---|
| **A. Scene page in the browser (chosen)** | The plugin generates an HTML/SVG page for the scene and serves it to the existing recorder. New acts (`walk`, `say`, …) call into the page's animation engine and wait for it to finish. Figures and props are real DOM elements with accessible names. | Reuses the whole pipeline: recording, element measurement, every fx, cursor/camera, chapters, previews, `inspect`. Smallest core impact. Animation quality is bounded by what SVG/CSS/JS can do in Chromium, which is plenty for flat stick figures. |
| B. Render frames offline, then edit as `source.video` | A separate renderer draws frames to an MP4, then the existing video-editing path adds effects. | Effects there need pixel `rect`s and `at` times, so the agent loses named anchors, and `check`/`inspect` don't apply. A second rendering engine to maintain. |
| C. Separate standalone tool | A new CLI just for animations. | Duplicates voices, cards, chapters, rendering and the agent loop. Two tools to learn. |

Picked **A**, because it gives scenes every existing feature for free and keeps the core almost untouched. The user chose the **kit + shapes** model over kit-only or shapes-only.

## Design

### Script shape (illustrative, not final)

```json
{
  "version": 1,
  "scope": "Stopping at a red light",
  "plugins": {
    "scene": {
      "set": "road-junction",
      "cast": [
        { "id": "driver", "name": "Driver", "kind": "car", "color": "#2563EB", "at": "near-lane-left" },
        { "id": "ravi", "name": "Ravi", "kind": "person", "color": "#16A34A", "at": "far-kerb" }
      ],
      "props": [
        { "id": "light", "kind": "traffic-light", "at": "light-post", "state": "green" },
        { "id": "sign", "shape": "rect", "box": [1180, 620, 120, 70], "fill": "#FDE047", "text": "SCHOOL" }
      ]
    }
  },
  "steps": [
    { "id": "approach", "chapter": "Approaching", "beat": [
      { "act": "drive", "who": "driver", "to": "stop-line", "speed": "slow" },
      { "act": "signal", "prop": "light", "state": "red" },
      { "fx": "arrow", "anchor": { "role": "img", "name": "Traffic light" }, "text": "Red means stop" }
    ]},
    { "id": "cross", "beat": [
      { "act": "walk", "who": "ravi", "to": "near-kerb", "via": "zebra-crossing" },
      { "act": "say", "who": "ravi", "text": "Thanks for stopping!" },
      { "act": "pose", "who": "ravi", "pose": "wave" }
    ]}
  ]
}
```

### The kit

- **Figures:** a stick person (head, body, arms, legs) with a colour and a name label option. Poses and moves: `stand`, `walk`, `run`, `wave`, `point` (at a figure, prop or place), `talk` (gesture while a bubble shows), `think`, `sit`, `nod`, `shake-head`, `pick-up`, `hand-over`, `fall` (for hazard scenes). Faces left or right automatically while moving; `face` turns explicitly.
- **Vehicles:** `car`, `bike`, `bus`: drive along lanes, stop, indicate.
- **Sets** (backgrounds plus named places):
  - `shop`: counter, shelves, door, till, aisle, customer spot, staff spot.
  - `road-junction` (side view at kerb level): near and far lane, stop line, zebra crossing, both kerbs, traffic-light posts.
  - `office`: desks, chairs, door, meeting table, whiteboard, exit sign.
- **Props:** traffic light (states), sign, cone, wet-floor sign, box, cart, fire extinguisher, phone, laptop.
- **Shapes** (the "extras" escape hatch): `rect`, `circle`, `line`, `arrow-line`, `path`, `text`, with fill/stroke/label, placed by `box` in video pixels or `at` a named place. Shapes are props, so they take accessible names and can be anchors.

### Acts (new, scene plugin only)

`walk`, `run`, `drive`, `say` (bubble; text per language like other text fields), `think` (thought bubble), `pose`, `face`, `point`, `signal` (prop state), `show` / `hide` (figures, props), `place` (add a prop or shape mid-scene), `move` (a prop). Existing `wait` keeps working. Every act that targets a figure or prop returns its box, so fx entries right after it can omit `anchor`, as they do after a click today.

Timing: each act lasts as long as its animation (walk duration from distance and speed; `say` from word count, overridable with `duration`). Acts can run in parallel with an option such as `"with": "previous"` (exact name left to the builder) so a car and a pedestrian can move at the same time.

### Selectors and anchors

Every figure, prop and shape is a DOM element with `role="img"` and an accessible name (its `name`, or its `id` humanised). So existing selectors work: `{ "role": "img", "name": "Ravi" }`, and `inspect` lists them like elements on a website. Named places are exposed too (as invisible elements) so an arrow can point at "the stop line".

### Agent loop

- `validate`: unknown set, place, figure id, pose or prop kind gives an error with a hint listing valid values; scene acts without the plugin; props placed off-screen or overlapping figures' paths are warnings.
- `check`: plays the scene quickly (no recording) and reports acts that can't complete (for example, walking to a place blocked by a prop).
- `inspect --script s.json --until <step>`: a screenshot of the scene at that point plus the list of figures, props and places with selectors.
- `make`, `preview`: unchanged.

### No audio now, audio later

`say` shows a speech bubble only. The cast schema reserves an optional `voice` per character (unused, or rejected with a clear "not yet supported" hint) so narration and per-character voices can be added later through the existing narration pipeline without changing scripts.

## Decisions from the review

- **Speech bubbles are drawn in the scene page, in one language per job** *(Claude's call)*. A job records the browser once, and each language only gets its own render pass, so in-page text can show only one language. Unlike a website, a scene has no side effects and replays identically, so recording it once per language is cheap. In this release a scene job draws its bubbles in `plugins.scene.language` (default: the script's first language). `validate` warns when `languages` lists more than one, and the agent makes one job per language. Overlay bubbles that change per language within one job can come later with audio.
- **Video shape: 16:9 only** *(Claude's call)*. Sets are drawn once in a 1920x1080 design space and scaled to the viewport. Shape `box` values and named places use those design coordinates, whatever the output size. A non-16:9 viewport is a `validate` error for scene scripts in this release.
- **Movement: straight lines through named waypoints, no pathfinding** *(Claude's call)*. `walk` / `drive` go straight to `to`, through the optional `via` places in order. Each set defines its places and lanes so the normal routes are clear. `check` reports a path that crosses a solid prop. **Depth:** each set has a foreground layer (counter front, desk fronts, car bodies over the road), and places marked as "behind" draw figures under it, so a shop assistant stands behind the counter.

## Effects on moving figures: static and tracking *(user's decision)*

Both are supported:

- **Static** (as today): an effect measures its target once and stays there. Right for figures that have stopped.
- **Tracking**: an effect (arrow, spotlight, callout, highlight, blur) or the follow camera can follow a figure or vehicle while it moves, e.g. `{ "fx": "arrow", "anchor": { "role": "img", "name": "Car" }, "track": true }`.

Because the character engine is a pure function of time (below), the plugin knows every figure's box at every moment without measuring the page. It hands the core a **box timeline** (box keyframes over time) instead of one box. This is the one real core change:
- the trace format gains an optional box timeline per effect;
- the compiler and renderer interpolate it for that effect and the camera;
- **when the field is absent, everything takes exactly today's code path**, so website, Flutter and video-source scripts are unaffected. Tests must prove this (existing suite unchanged, plus new tests for tracked effects).

`validate`/`check` warn when a static effect targets something that is moving at that moment, and suggest `"track": true`.

## Speech bubbles are optional *(user's decision)*

`say` shows a bubble by default. It can be turned off per line (`"bubble": false`) or for the whole scene (`plugins.scene.bubbles: false`), because once voices exist a spoken line may not need one. With bubbles off and no voice yet, `say` still makes the figure gesture as if talking, for the line's duration.

## Character engine: build on "figures" *(Claude's call)*

[cherifya/figures](https://github.com/cherifya/figures) (MIT, single file `figures.js`, about 39 KB) already animates stick figures from JSON: skeleton-based walking and running with planted feet, 40 poses (pointing, waving, handshake, sitting, thumbs-up, shrug…), 11 facial expressions, accessories, held items, speech and thought bubbles, simple furniture props, and `FIGURES.svg(spec, t)`, which draws the scene at any time `t`. That last property makes rendering deterministic and gives the box timelines for tracking for free.

- **Vendored, not a dependency:** a pinned copy goes in `editor/api/plugins/scene/vendor/` with its MIT licence and credits (it derives from stix, also MIT). It is a one-author project about a month old, so we own our copy.
- **What we still build:** the three sets (backgrounds, named places, foreground layers), vehicles and traffic lights, the workplace props, the NaraScreen act layer that compiles `walk`/`say`/`pose`/… into figures keyframes, timing, tracking, the agent loop, and docs.
- **Consequence: side view.** figures draws characters side-on, standing on a ground line. All three sets are side views: the road junction is a kerb-level view of a road with a zebra crossing and traffic light (how most road-safety explainers frame it), not a top-down map.
- **Look:** figures has a hand-drawn "line boil" wobble. Whether to keep it or switch it off for a cleaner corporate look is left to the builder; pick whichever reads better in training videos, and make it a scene option if cheap.

Also considered: [stickman-video-director](https://github.com/kaomei/stickman-video-director) (MIT, about 8.4k stars). It is an agent skill that generates each video's artwork with image or video-generation models, so results aren't deterministic and need paid model calls. Useful for style ideas, not as an engine.

## Left to the builder

- The exact act and field names, beyond those shown (keep them consistent with existing verbs).
- How the scene page is served to the runner (route interception on a synthetic origin, or a local static server), as long as it's offline and needs no `baseUrl`.
- How the act layer maps onto figures keyframes, and any small extensions to the vendored engine (keep them in a clearly marked patch section so the copy can be updated).
- Visual style of the kit: flat, clean, readable on light backgrounds, consistent line weight.
- Which overlap and off-screen checks are feasible in `validate` versus `check`.
- Tests: a scene fixture script per set, run through `validate`, `check` and a short `make` in the e2e suite, plus an assertion that the existing tests are unchanged.
