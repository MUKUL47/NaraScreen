# Stick-figure explainers v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agents can make silent stick-figure training videos: a figures scene rendered to MP4, then finished by NaraScreen's `source.video` mode with cards, chapters and callouts.

**Architecture:** A vendored copy of the figures engine draws a scene at any time `t` as SVG. A Node script drives the Chromium that NaraScreen already uses to screenshot each frame and pipes them to ffmpeg. NaraScreen edits the result through its existing, unchanged `source.video` path.

**Tech Stack:** Node 20 (ESM), Playwright from `editor/node_modules`, ffmpeg 6, figures.js (MIT), NaraScreen CLI.

**Spec:** `design/2026-11-26-stick-figure-explainers-v1.md`

## Global Constraints

- No file under `editor/` is created or changed. NaraScreen's code is untouched.
- Nothing new installed system-wide: no pip installs, no new Chromium download. Use `editor/node_modules/playwright` (Chromium is already in `~/.cache/ms-playwright`) and `/usr/bin/ffmpeg`.
- No audio of any kind (no `narrate`, no music).
- Never run `git commit` or `git push`. The user commits from VS Code.
- Everything lives under `explainers/` at the repo root, except one added section in `~/.claude/skills/narascreen/SKILL.md`.
- The NaraScreen CLI is `/home/mukul/personalscrapper/ui-demo-pipeline/editor/bin/narascreen`. Read `editor/api/MANUAL.md`, section "Editing an existing video", before writing a `source.video` script.

## Review Focus

1. **A scene whose `w`×`h` isn't 16:9** (figures examples are 900×400): the renderer must letterbox it centred on a background colour inside the output size, never stretch it.
2. **Frame timing:** frame `i` is drawn at `t = start + i / fps`, frame count is `round(duration * fps)`, and the MP4's duration matches within one frame, because NaraScreen effects use `at` seconds against this video.
3. **Missing ffmpeg or Playwright:** the renderer exits non-zero with a one-line message saying what's missing and where it looked. No stack trace.
4. **Callout and arrow positions:** `rect` values in the NaraScreen script are in **output video pixels**, so the scene-to-video scale (and letterbox offset) must be applied. `render.mjs --map` prints that transform so agents don't guess.
5. **Bubble text overflow:** long `say` lines overflow figures' bubble box. The examples keep lines short, and the guide says to (6–8 words per bubble).

---

### Task 1: Vendored engine, renderer and linter

**Files:**
- Create: `explainers/vendor/figures/figures.js`, `LICENSE`, `spec.md`, `acting.md`, `check_spec.py`, `VENDORED.md` (the source commit SHA, the date, and "do not edit; patches go in explainers/tools")
- Create: `explainers/tools/render.mjs`
- Create: `explainers/tools/render.test.mjs`

**Interfaces:**
- Produces:
  - `node explainers/tools/render.mjs <scene.json> <out.mp4> [--size 1920x1080] [--fps 30] [--bg #FFFFFF]` renders the video.
  - `node explainers/tools/render.mjs <scene.json> <outdir/> --stills 1.5 4.0` writes `still-1.50.png` and so on.
  - `node explainers/tools/render.mjs <scene.json> --map [--size …]` prints the JSON `{ "scale": number, "offsetX": number, "offsetY": number, "videoW": number, "videoH": number, "duration": number }`, where video pixel = scene unit × scale + offset.
  - Lint: `python3 explainers/vendor/figures/check_spec.py <scene.json>`. Confirm it uses only the standard library; if not, port its checks to `explainers/tools/lint.mjs` with the same CLI.

- [ ] **Step 1:** Fetch figures at its latest commit from https://github.com/cherifya/figures (files listed above, from `skills/figures/` and the repo root). Record the SHA in `VENDORED.md`. Read `figures.js` fully before using it.
- [ ] **Step 2: Write failing tests** in `render.test.mjs` (`node --test`), using `vendor/figures` example `hello.json` copied to `explainers/tools/fixtures/hello.json`:
  - `renders mp4 with exact duration`: ffprobe gives width 1920, height 1080, and `|duration − spec.duration| ≤ 1/30`.
  - `map letterboxes non-16:9`: for 900×400 at 1920×1080, `scale = 2.1333` (±0.001), `offsetX = 0`, `offsetY = 113.33` (±0.5).
  - `stills land at requested times`: `--stills 1.5` writes `still-1.50.png`, 1920×1080.
  - `missing ffmpeg fails cleanly`: with `PATH` lacking ffmpeg, the exit code is non-zero and stderr has one line containing `ffmpeg`.
- [ ] **Step 3:** Run `node --test explainers/tools/` and expect failures.
- [ ] **Step 4:** Implement `render.mjs`. Import Playwright via an absolute path to `editor/node_modules/playwright`. Use one page with the viewport at the output size; inject `figures.js`; for each frame, set an `<svg>` wrapper's innerHTML from `FIGURES.svg(spec, t)` and take a screenshot (PNG buffer); pipe the frames to `ffmpeg -f image2pipe -framerate <fps> -i - -c:v libx264 -pix_fmt yuv420p -crf 18`. Letterbox with CSS (the SVG is `object-fit`-style centred via its viewBox and `preserveAspectRatio="xMidYMid meet"`), with the background `--bg`.
- [ ] **Step 5:** Run `node --test explainers/tools/` and expect a pass. Also lint `fixtures/hello.json` and expect no errors.

### Task 1b: Add-on system (after Task 1, before 2a/2b/3)

**Files:**
- Modify: `explainers/vendor/figures/figures.js`, with one marked block `/* NARASCREEN ADDON PATCH START … END */` plus one-line lookups in the pose, item, look, expression and fx fallbacks.
- Modify: `VENDORED.md`, describing the patch.
- Create: `explainers/tools/addons.mjs`, `explainers/tools/lint.mjs`, `explainers/tools/addons.test.mjs`, `explainers/addons/README.md` (the add-on contract).
- Modify: `render.mjs` to load add-ons and resolve `@place` references.

**Interfaces:**
- Produces:
  - `FIGURES.extend(addon)` in the page or Node. It merges `poses` (same joint format as the built-ins; the polar cache is recomputed for added poses), and `items`/`looks`/`exprs`/`fx` as `name → (f, t, h) => svgString`, where `h` exposes the engine's drawing helpers and colours (document which).
  - `loadAddons(scenePath, names): Promise<Addon[]>` in `addons.mjs`: a bare name resolves to `explainers/addons/<name>/index.mjs`, anything else is a path relative to the scene.
  - `resolvePlaces(spec, addons): spec` replaces `"@name"` x/y strings with set coordinates and errors with the list of valid places on a miss.
  - `node explainers/tools/lint.mjs <scene.json>` runs `check_spec.py`'s checks plus the add-on vocabulary. Exit 0 on clean; otherwise one line per problem with its JSON path.
- **Tests** (`addons.test.mjs`):
  - a fixture add-on with one pose, one item and one fx renders, and its SVG contains the add-on's marker element;
  - an unknown name still behaves as before (the built-in fallback);
  - `@missing` gives an error listing the valid places;
  - lint accepts the add-on's names and rejects a typo with a suggestion;
  - **`hello.json` renders byte-identical SVG at t = 0, 2.5 and 5 before and after the patch**, which proves built-ins are unchanged.

### Task 2a: road-safety add-on + road-crossing example (parallel with 2b and 3)

First build `explainers/addons/road-safety/`:
- `car` fx: side view, colour, wheels that turn as it moves, driven by `k` keys on x;
- `traffic-light` fx with `state: red|amber|green` (animatable via `k`);
- `zebra`, `stop-line` and `road-sign` (text);
- the `road` set: road band, kerbs and places `near-kerb`, `far-kerb`, `stop-line`, `crossing`, `light-post`.

Then use it in the example below.

### Task 2a (example): Road-crossing example

**Files:** create `explainers/examples/road-crossing/scene.json`, `narascreen.demo-script.json`, `out/` (render output; add `explainers/**/out/` to the repo `.gitignore`).

**Interfaces:** consumes Task 1's CLI.

- [ ] **Step 1:** Write `scene.json`, 1920×1080, about 25–35 s, side view, using the road-safety add-on (`"addons": ["road-safety"]`, the `road` set, `car` and `traffic-light`). **Beats:**
  1. A pedestrian waits at the kerb.
  2. A sign shows "DON'T WALK".
  3. A driver figure (labelled DRIVER) slows to a stop at a marked stop line.
  4. The sign changes to "WALK".
  5. The pedestrian looks both ways and crosses.
  6. The driver waves.
  7. The pedestrian gives a thumbs-up.
  Keep bubbles to 6–8 words.
- [ ] **Step 2:** Lint until clean. Render stills at each beat, look at every still, and fix overlaps, floating or off-screen elements.
- [ ] **Step 3:** Render `out/scene.mp4`. Get the transform with `--map`.
- [ ] **Step 4:** Write `narascreen.demo-script.json` with `source.video` = `out/scene.mp4` (relative to the script):
  - an intro card "Crossing the road safely" and an outro card;
  - chapters for wait, stop and cross;
  - lower-third callouts "Stop at the line" and "Wait for the WALK sign";
  - one arrow at the stop line, with `rect` converted through the map.
- [ ] **Step 5:** Run `narascreen validate` (expect `ok: true`), then `narascreen make narascreen.demo-script.json --out out/job`. Open the contact sheet and check that the callouts and arrow land where intended; fix and re-make until they do.

### Task 2b: workplace add-on + shop-greeting example (parallel with 2a and 3)

First build `explainers/addons/workplace/`:
- `shelf`, `counter` (front layer via `front: true`), `wet-floor-sign`, `cone` and `extinguisher` fx;
- `vest` and `cap` looks;
- the `shop` set with places `door`, `counter-staff`, `counter-customer`, `shelf`.

Then do the example.

The same steps and files as 2a, under `explainers/examples/shop-greeting/`. Use the workplace add-on (`shop` set, `counter`, `shelf`, `vest` on the assistant).

**Beats:**
1. A customer enters through the door.
2. The assistant (behind the counter) smiles and says "Hi! How can I help?".
3. The customer asks for an item.
4. The assistant points to the shelf, walks there and hands it over.
5. The customer pays (`coinbag` or `wallet` item).
6. The assistant thanks them, and the customer waves and leaves.

**NaraScreen layer:**
- an intro card "Greeting customers" and an outro card;
- chapters for welcome, help and thank;
- lower-third tips "Greet within 10 seconds" and "Walk them to the item";
- a step-counter callout per tip.

### Task 3: Agent guide (parallel with 2a and 2b)

**Files:** create `explainers/README.md`; modify `~/.claude/skills/narascreen/SKILL.md` by adding a `## Stick-figure explainers` section of 15 lines or fewer.

- [ ] **Step 1:** Write `README.md`:
  - **What it's for**, and the loop: plan beats, write scene JSON, lint, stills, look, render, `--map`, write the NaraScreen `source.video` script, `validate`, `make`, look at the contact sheet.
  - **Pointers:** `vendor/figures/spec.md` and `acting.md` for vocabulary, instead of restating them.
  - **Commands:** the renderer CLI from Task 1.
  - **Converting scene units to video pixels for `rect`**, with one worked number.
  - **Add-ons:** how to use the base library and write your own (link `addons/README.md`).
  - **Limits of v1:** silent; side view only; effects don't follow moving figures, so place them after the figure stops.
  - **Credits and licence** of figures and stix.
  - **Examples:** link both example folders (they may still be in progress; link by path).
- [ ] **Step 2:** Add the skill section pointing to `explainers/README.md`, with absolute paths.

### Task 4: Final check (after 2a, 2b, 3)

- [ ] Run `node --test explainers/tools/`: all pass.
- [ ] Run `npm run test:api` in `editor/`: the same pass count as before any change (expected unchanged, since `editor/` is untouched).
- [ ] Run `git status --short`: only `explainers/`, `design/`, `.gitignore` and the earlier voice-engine files appear; nothing under `editor/`.
- [ ] Both examples' final MP4s exist, and their contact sheets have been looked at.
