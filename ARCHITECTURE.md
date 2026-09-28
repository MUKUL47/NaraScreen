# NaraScreen: architecture and codebase guide

This is the developer-facing map of the repo. For install and usage, see [README.md](README.md).

It describes the repo as of 2026-09-25: `main` at `cd44074`, plus uncommitted work on the headless agent layer (`editor/api/`) and renderer fixes in `editor/electron/`.

---

## What this repository is

NaraScreen is a local-only desktop app for making narrated product-demo videos:

1. **Record** the screen with ffmpeg, or import an existing video.
2. **Edit** by placing timed actions on a multi-lane timeline: zoom, narrate, spotlight, blur, callout, speed ramp, skip, mute, pause, background music.
3. **Produce** a final MP4 with a chain of ffmpeg passes that bake every effect in.

Narration comes from **Kokoro TTS**, either a local Python install or a local HTTP server, or from the microphone. Nothing is uploaded anywhere.

A second layer lives in [editor/api/](editor/api/): a **headless, agent-facing interface** (`narascreen` CLI + `narascreen serve` HTTP server). An external AI agent — or a person — writes a declarative *demo script* (JSON, no timestamps or pixels); NaraScreen drives a real browser with Playwright, records it, generates narration, and renders the video with the same producer the desktop app uses. It is app-agnostic and agent-agnostic. It can also narrate/edit an existing video file instead of recording a site.

---

## Repo map

```
ui-demo-pipeline/
├── README.md                  user-facing intro (partly stale, see "Doc drift")
├── ARCHITECTURE.md            this file
├── docker-compose.yml         Kokoro TTS server only (kokoro-fastapi-cpu on :8880)
├── package.json               metadata only: no scripts, no dependencies
├── scripts/kokoro-worker.py   persistent stdin/stdout Kokoro worker; nothing calls it
└── editor/                    the app itself; run everything from here
    ├── electron/              Electron main process and the Node-side media pipeline
    ├── src/                   React renderer (UI)
    ├── api/                   headless agent layer: schema, CLI, HTTP server, manual (see below)
    ├── bin/narascreen         portable launcher for the CLI (works from any folder)
    ├── indicf5-prototype/     TTS experiment for Indian languages (git-ignored, local only)
    ├── scripts/               build-dist.js and optional setup scripts (venvs, Piper)
    ├── public/                static assets for the renderer
    └── vite.config.ts         builds the renderer plus 3 Electron entries
```

Git ignores these folders, so they exist only on the local disk:

- **Build output:** `editor/node_modules`, `dist/`, `dist-electron/`, `dist-web/` (stale), `release/`.
- **Local runtimes:** `kokoro-venv/`, `translate-venv/`, `piper/`, all of `indicf5-prototype/`.
- **Headless output:** `narascreen-out/` (default job/inspect folder), `editor/api/_tests/.tmp/`.
- **App icon:** `build/`, including `icon.png`. A fresh clone has no icon, so `npm run dist` needs one to be added.
- **At the repo root:** `demo-output/` (old sessions from March) and `sessions/` (empty, owned by root).

---

## Stack

| Layer | Tech |
|---|---|
| Shell | Electron 33, bundled with `vite-plugin-electron` |
| UI | React 19, Zustand 5, Tailwind v4, lucide-react |
| Media | FFmpeg and ffprobe: system binary in dev, `ffmpeg-static`/`ffprobe-static` bundled in packaged builds |
| TTS | Kokoro 82M: `python -c` with the `kokoro` package, or the OpenAI-style HTTP API of `kokoro-fastapi` |
| Headless | Playwright (Chromium), `tsx` |
| Packaging | electron-builder: AppImage, DMG, portable EXE |

Node 20 (`editor/.nvmrc`).

---

## Process model

```
┌─ Renderer (src/) ─────────────┐   window.electronAPI   ┌─ Main (electron/main.ts) ─────────────────┐
│ Zustand store                 │ ──── preload.ts ─────► │ ipcMain.handle("fs:*", "dialog:*",        │
│ components + action editors   │   ipcRenderer.invoke   │   "screen:*", "video:*", "tts:*",         │
│                               │ ◄───────────────────── │   "versions:*", "cache:*")                │
└───────────────────────────────┘  "produce-progress",   │                                           │
                                   "recording-tick"      │  capture.ts ── spawn ffmpeg (screen grab)  │
                                                         │  ffmpeg.ts  ── ffprobe, filmstrip           │
                                                         │  tts.ts     ── Kokoro python / curl → HTTP  │
                                                         │  Worker ──► produce-worker.ts → produce.ts  │
                                                         └────────────────────────────────────────────┘
```

- **Renderer sandbox.** The renderer is isolated (`contextIsolation: true`, `nodeIntegration: false`). All disk and process access goes through the 29 methods in [preload.ts](editor/electron/preload.ts). Their types live in [src/types/electron.d.ts](editor/src/types/electron.d.ts) and currently match. `webSecurity: false` lets the renderer load `file://` videos, thumbnails and audio.
- **Produce in a worker.** Production runs in a `worker_threads` Worker ([produce-worker.ts](editor/electron/produce-worker.ts)) so the UI stays responsive. Progress lines stream back as `produce-progress` events. Cancel calls `worker.terminate()`.
- **ffmpeg binary lookup.** [bin-paths.ts](editor/electron/bin-paths.ts) tries these in order:
  1. `resources/bin` in a packaged app
  2. the system `PATH`, preferred in dev because `ffmpeg-static` lacks the `drawtext` filter that callouts need
  3. the `ffmpeg-static` npm package
- **ffmpeg calls are synchronous, and stderr is discarded** ([ffmpeg.ts](editor/electron/ffmpeg.ts)). A failure shows up only as a missing or empty output file, which each pass checks for before moving on.
- **No Electron in the pipeline.** Nothing in the produce chain (`produce.ts`, `effects.ts`, `ffmpeg.ts`, `tts.ts`, `bin-paths.ts`) imports `electron`. That is what lets `editor/api/` run it under plain Node.

---

## Session folder and data model

Every project is a folder. The default parent is `~/NaraScreen/`, and the default name is a timestamp (`YYYY-MM-DD_HH-MM-SS`). [src/lib/fileOps.ts](editor/src/lib/fileOps.ts) creates it:

```
<session>/
├── demo-project.json          the entire project (DemoProject in src/types.ts)
├── recordings/recording.mp4   source video (imports are copied byte-for-byte, even .mkv/.webm)
├── thumbnails/thumb_NNNN.jpg  filmstrip: 1 frame every 2 s, 160 px wide
├── audio/<actionId>_<lang>.wav   generated TTS (zoom targets get their own files)
├── audio/<actionId>_voice.webm   microphone recordings
└── video/final_vN.mp4         produced versions; video/temp/ is scratch, removed after produce
```

**`demo-project.json`** ([src/types.ts](editor/src/types.ts)) contains:

- `recordingPath` (absolute) and `recordingDuration`.
- `viewport` and `output`. These default to 1920×1080 even when the captured display is a different size.
- `tts`: `{ provider, kokoroEndpoint, voiceEn, voiceHi, speed, voices?, languages? }`. `tts.speed` is the one global narration speed.
- `actions: TimelineAction[]`.

**`TimelineAction`** is one flat interface, with optional fields for each action type.

- **Timestamps** are seconds into the *original* recording.
- **Rectangles** are `[x, y, w, h]` in video pixels.
- **Legacy fields** are still read: `zoomRect` and `zoomRects` (migrated to `zoomTargets` on edit), `spotlightRect`, and `narration` and `narration_hi` (now `narrations[lang]`).

> **Invariant:** the main process re-reads `demo-project.json` from disk for TTS and for produce. The renderer must save first, and both *Generate Audio* and *Produce* do so. Anything that changes voice, speed or actions has no effect until it is saved.

**App cache.** Some state survives across launches in `<userData>/narascreen-cache.json`, through `cacheGet`/`cacheSet`. The keys are:
- `lastSessionDir`: reopened automatically at launch, with a guard if the folder is gone.
- `timelineHeight`.
- `lastRecordingParentDir`.

---

## Action types and how each is rendered

| Type | Category | Key fields | What produce does |
|---|---|---|---|
| `skip` | cut | `skipEndTimestamp` | Removes the range |
| `speed` | retime | `speedEndTimestamp`, `speedFactor` (0.25–4) | `setpts` for video plus `atempo` for audio over the range |
| `mute` | audio | `muteEndTimestamp` | Sets volume to 0 over the range |
| `zoom` | insert (freeze) | `zoomTargets[]` (rect + optional narration each), `zoomDuration`, `zoomHold` | Zooms into a still frame, one target after another: ease in, hold, ease out. A narrated target holds for the audio length + 0.5 s |
| `pause` | insert (freeze) | `resumeAfter` | Holds a still frame for N s, or for the narration + 0.5 s; default 3 s |
| `narrate` | insert | `narrations{lang}`, `freeze`, `showSubtitles`, `subtitleSize`, `customAudioPath` | With `freeze`, behaves like pause. Otherwise the video keeps playing and the original audio is lowered to 20%. Word-by-word karaoke subtitles (ASS format) are burned in |
| `blur` | overlay | `blurRects[]`, `blurRadius`, `blurDuration` (3 s) | Crops each region, blurs it (`boxblur`) and overlays it back |
| `spotlight` | overlay | `spotlightRects[]`, `dimOpacity`, `spotlightDuration` (3 s) | Darkens the whole frame, then overlays the undimmed regions. **Overlapping spotlights are a hard error**; use several regions on one spotlight instead |
| `callout` | overlay | `calloutPanels[]` or `calloutText`, `calloutStyle` (label / step-counter / lower-third) | Draws the text with `drawtext` |
| `music` | audio | `musicPath`, `musicVolume`, `musicDuckTo` | Only the **first** music action is used. It loops under the whole video and is lowered (ducked) during narration |

**Editor vs. producer mismatches:**
- **Unrendered fields.** The Spotlight and Blur editors offer a narration field and a "freeze" toggle, but produce only treats `zoom`, `pause` and `narrate` as inserts, so neither setting appears in the output. Produce also never reads `playFor`, `musicEndTimestamp`, or the music action's own timestamp.
- **Hard-to-create types.** There is no way to create a `pause` from the UI: it isn't in the Add menu and has no number key. `skip` can only be added with key `9`.

---

## Production pipeline

`produceTimelineVideo(sessionDir, emit, version?, selectedActionIds?, resolution?, crf?, trim?, opts?)` in [electron/produce.ts](editor/electron/produce.ts). `opts` (headless only): the project file to read, a `letterbox` size, `wrap` clips (title/end cards) and an `onTimings` callback (seconds per pass).

Each pass reads the previous pass's output from `video/temp[-<version>]/pass_N.mp4` (one temp folder per version, so two languages can render at once). Passes 0–5b write **intermediates** with `INTERMEDIATE_VIDEO` ([ffmpeg.ts](editor/electron/ffmpeg.ts): x264 ultrafast, CRF 12 — fast and near-lossless); only the final pass encodes the delivered file:

| # | Pass | Notes |
|---|---|---|
| 0 | **Trim** | Optional pre-cut of the source. All action timestamps are shifted by `trim.start` |
| 1 | **Filter** | Keeps only `selectedActionIds`, which come from the checkboxes in the Produce dialog |
| 2 | **Skip** | Cuts out the kept pieces, normalizes their audio, and joins them |
| 3 | **Speed** | Ranges are first remapped through the skip pass, then cut, retimed and joined |
| 4 | **Mute** | Ranges are remapped through skip and speed |
| 4b | **Blur** | Before the inserts, on the post-skip/speed timeline (duration in recording seconds), so freeze frames and zoom frames are cut from already-blurred video |
| 5 | **Inserts** | Zoom, pause and narrate at remapped timestamps. TTS runs here if no audio file exists yet. Records how much time each insert adds (for remapping) and collects one subtitle cue per narration |
| 5b | **Music** | Mixed in with `amix` (video copied). The music is ducked during the narration ranges recorded by the insert pass. Before the final pass, so cards stay music-free |
| 6 | **Final** | ONE encode (`-preset fast`, `medium` when cards are joined; CRF from `crf`) of a single filter graph: **spotlights** (remapped through skip, speed *and* inserts; every pixel filter gated with `enable=` to its own window, so frames without a spotlight pass straight through; soft/converging ones share one mask chain) → **page-space ASS** (callouts, arrows, highlighter, the drawn cursor: [fx-cursor.ts](editor/electron/fx-cursor.ts)) → **follow camera** (one `perspective` filter, [fx-camera.ts](editor/electron/fx-camera.ts); only when the project has `camera`) → **screen-space ASS** (subtitles, lower-thirds, chapter badges; without a camera both ASS sets share one file) → **scale/pad** to `resolution`/`letterbox` → **cards** (`wrap`, joined by `concat`). Skipped (the recording is copied) only when there is nothing at all to do |

Output: `video/final_v{N+1}.mp4`, or `final_<version>.mp4` if a version label is passed.

Every segment is normalized to 44.1 kHz stereo AAC before joining, because streams without audio break ffmpeg's concat step. Joining tries a stream copy (`-c copy`) first and re-encodes only if that fails.

**Timestamp remapping** is the subtle part:
- Actions are authored against the original recording.
- Every pass that changes duration (skip, speed, inserts) exposes a function that maps a timestamp from the old timeline to the new one, and later passes compose these functions.
- Spotlight and callout run *after* the inserts, remapped through `insertExpansions` / `buildInsertRemap`, so they don't drift earlier with every freeze. Blur runs *before* the inserts (pass 4b) so freeze and zoom frames are cut from already-blurred video.
- Subtitles are collected during the insert pass and burned in one final pass, on top of spotlight dimming.

---

## TTS

The IPC handler `tts:generate` in [main.ts](editor/electron/main.ts) calls [tts.ts](editor/electron/tts.ts):

1. **Direct Python:** used only when `KOKORO_PYTHON` resolves to a file that **exists**. That means the `KOKORO_PYTHON` env var, or `resources/kokoro-venv` in a packaged build. The fallback value `"python3"` is a bare name, so it fails the existence check and direct mode is effectively off in dev unless the env var is set. The local `editor/kokoro-venv/` is not picked up automatically.
2. **HTTP fallback:** `curl` POSTs to `project.tts.kokoroEndpoint` (default `http://localhost:8880/v1/audio/speech`). `KOKORO_URL` only applies when a project has no endpoint set, and new projects always set one.

**Voice choice.**
- **Generate Audio:** uses the voice picked in `AudioControls`. That choice lives only in component state and is not saved to the project.
- **Produce, when it has to synthesize audio itself:** uses `tts.voices[lang][0]`, then falls back to `voiceEn`/`voiceHi`.
- **Kokoro language codes:** `en→a`, `en-gb→b`, `hi→h`, `es→e`, `fr→f`, `ja→j`, `zh→z`, `pt→p`, `it→i`.
- **UI lists:** the 9 languages and ~60 voices are defined in [AudioControls.tsx](editor/src/components/actions/AudioControls.tsx).

**Kokoro health check.** The Toolbar calls `GET /v1/models` on :8880 and shows a `docker run` banner if nothing answers. The banner can appear even when direct Python mode would work.

---

## Recording and import

- **Screen recording:** [capture.ts](editor/electron/capture.ts) `startScreenRecording`. It spawns ffmpeg with x11grab (Linux), avfoundation (macOS) or gdigrab (Windows) at 30 fps, `libx264 ultrafast`, full display or a region. **Video only; no audio is captured.** Stopping sends `q` on stdin, or kills the process on Windows. Then the store builds the filmstrip, probes the duration and saves.
- **Import:** `importVideo` in the store reads the file through `fetch(file://)` and writes it as `recordings/recording.mp4` without transcoding.
- **Discard:** "Discard" in the capture toolbar moves the session folder to the OS trash.
- **Unused code:** `createCaptureWindow` / `startRecording` / `stopRecording` in `capture.ts` are an older browser-window capture path. No IPC reaches them.

---

## Renderer (`editor/src/`)

| Area | File(s) | Notes |
|---|---|---|
| State | [stores/useProjectStore.ts](editor/src/stores/useProjectStore.ts) | Session, project, selection, playhead, capture and produce flags. Undo/redo keeps **50 snapshots of `actions` only**. Auto-save runs 3 s after the last change. Every async op (open, save, capture, import, produce) lives here |
| Shell | [App.tsx](editor/src/App.tsx) | Toolbar or CaptureToolbar on top. Below: VideoPlayer, a resizable Timeline (100–600 px) and ActionPanel (right sidebar), or a welcome screen. Loading overlay with the produce log and Cancel. Warns on close with unsaved changes |
| Timeline | [components/Timeline.tsx](editor/src/components/Timeline.tsx) | One lane per action type in use (`LANE_ORDER`), filmstrip, snapping, drag-select a range to add an action, drag to move or resize |
| Player | [components/VideoPlayer.tsx](editor/src/components/VideoPlayer.tsx) | Draw, move and resize regions in video-pixel coordinates. Shows region outlines and callout text; does **not** preview zoom, blur, dim or speed |
| Editors | [components/actions/](editor/src/components/actions/) | One editor per type. `AudioControls` and `LanguageAudioSection` (in NarrateEditor) handle TTS, per-language text and mic recording |
| Produce UI | [components/ProduceDialog.tsx](editor/src/components/ProduceDialog.tsx) | Resolution 480p–4K (default 1080p), CRF 18/23/28 (default 23), per-action checkboxes, trim in/out, time estimate |
| Helpers | [lib/actions.ts](editor/src/lib/actions.ts), [lib/constants.ts](editor/src/lib/constants.ts) | Rect and end-time accessors across legacy fields, colors, `LANE_ORDER`, `RANGE_ACTIONS` |
| Shortcuts | [hooks/useKeyboardShortcuts.ts](editor/src/hooks/useKeyboardShortcuts.ts) and VideoPlayer | See the table in README.md. Also: Alt+Arrow nudges the selected region 1 px (Alt+Shift: 10 px) |

**No browser fallback.** The renderer assumes `window.electronAPI` exists and reads it at module load, so it cannot run in a plain browser. `vite.web.config.ts` and `dist-web/` are leftovers from an earlier "web mode"; no npm script uses them.

---

## Headless agent layer (`editor/api/`)

**Purpose:** an external agent that knows nothing about this repo produces narrated demo videos of any website
by writing one JSON file and calling NaraScreen. The agent-facing documentation is [api/MANUAL.md](editor/api/MANUAL.md)
(served at `/docs` with generated reference tables); this section is the developer view.

```
agent ─► demo-script.json ─► validate ─► record (runner: Playwright + CDP screencast → recording.mp4 + trace.jsonl)
                                        or import (video-source.ts: source.video → recording.mp4 + trace from `at`/`rect`)
                             ─► produce (narration.ts: Kokoro clips, cached ─► compiler.ts: script+trace → NaraScreen actions
                                         ─► produce-headless.ts: demo-project.json ─► electron/produce.ts renderer)
                             ─► preview (contact sheet)          all state in a job folder (job.ts)
agent ◄─ one JSON envelope per command (CLI stdout / HTTP), progress events on stderr / SSE
```

| Module | Role |
|---|---|
| [schema.ts](editor/api/schema.ts) | **The contract.** zod schema + TS types for demo scripts; exported as JSON Schema (`narascreen schema`). Browser scripts (acts + fx) and video-source scripts (fx with `at`/`rect`). |
| [validate.ts](editor/api/validate.ts) | Load + `${env:NAME}` interpolation + structural (zod, per-entry) + semantic checks; every issue with a path and hint. |
| [errors.ts](editor/api/errors.ts), [output.ts](editor/api/output.ts) | Stable error codes → exit codes; the envelope `{ok, command, result|error, warnings, next}` and the event stream. |
| [job.ts](editor/api/job.ts) | Job folder, atomic lock, and the structure fingerprint that decides when a recording can be reused (text-only edits re-render without re-recording). |
| [runner.ts](editor/api/runner.ts), [page-elements.ts](editor/api/page-elements.ts), [screencast.ts](editor/api/screencast.ts), [inspect.ts](editor/api/inspect.ts) | Browser side: selector semantics (one definition), reveal/measure, trace, failure diagnostics (screenshot + candidate selectors), page inspection. |
| [cards.ts](editor/api/cards.ts) | Title/end cards (`intro`/`outro`): a built-in HTML template drawn by Chromium frame by frame with its CSS animations paused at each frame time (deterministic), narration through the normal TTS path. Rendered first at the final size; the renderer's final pass joins them (`wrap`) in the same encode. Called from `produce-headless.ts` only when the script has cards; not in the structure hash, so card edits never re-record. |
| [produce-parallel.ts](editor/api/produce-parallel.ts), [produce-child.ts](editor/api/produce-child.ts) | Languages render at the same time: the renderer's ffmpeg calls are synchronous, so each language runs `produceLanguage` in its own Node process (tsx loader, own process group so a cancel stops its ffmpeg), up to `NARASCREEN_PARALLEL_LANGS` (default 2). The child prints one JSON line (result or error); progress goes straight to stderr. |
| [plugins/](editor/api/plugins/index.ts) | Recording plugins, opted into per script under `plugins`. The core only calls hooks (context options, `ready` before each act, `afterFocus`, plugin acts, browser→video box scaling, compile-time restyling); scripts without `plugins` never reach them and keep their structure hash. [flutter/](editor/api/plugins/flutter/index.ts): a Flutter web build recorded as an Android phone (device emulation, auto-enabled accessibility tree via the centre-tap on Flutter's placeholder, taps, `swipe`, overlays scaled by the pixel ratio; `health.ts`: console/page-error/rejection/pending-request collection, `FLUTTER_APP_NOT_READY` / `FLUTTER_SEMANTICS_UNAVAILABLE` explanations of step failures, the `allowedHosts` request guard, and the `FLUTTER_NOT_WEB_BUILD` preflight); its fixture app (with `?stuck=1` / `?api=` test switches) lives in `plugins/flutter/fixture/` (built on demand by the e2e test when the Flutter SDK is installed). |
| [narration.ts](editor/api/narration.ts), [compiler.ts](editor/api/compiler.ts), [produce-headless.ts](editor/api/produce-headless.ts), [preview.ts](editor/api/preview.ts) | Produce side: TTS (fails loudly, retried, cached), timeline model (auto durations, ranges, stop rules), render + output presets, contact sheets. |
| [cli.ts](editor/api/cli.ts), [commands.ts](editor/api/commands.ts), [doctor.ts](editor/api/doctor.ts), [init.ts](editor/api/init.ts), [bin/narascreen](editor/bin/narascreen) | CLI. `commands.ts` is the single command catalog (help, parsing, server mapping, docs). |
| [server.ts](editor/api/server.ts), [docs.ts](editor/api/docs.ts) | `narascreen serve`: runs spawn the CLI with `--events json`; SSE/NDJSON events, long-poll, uploads, workspace confinement, token/Origin checks, limits; `/docs`, `/docs.md`, `/llms.txt`. |

**Design rules** (keep them when changing things):
- App-agnostic and agent-agnostic: nothing may reference a specific target app or AI vendor.
- stdout carries exactly one JSON envelope; everything else goes to stderr.
- Every failure is an `AgentError` with a code, a `hint` the agent can act on, and `where` in the script.
- New script fields go into `schema.ts` first (docs tables are generated from it), then validate/compiler, then MANUAL.md.

**Tests** (run from `editor/`): `npm run test:api` runs everything; individually
`tsx --test api/_tests/{compiler,narration,preview}.test.ts` (unit, fast), `server.test.ts` (~1 min),
`e2e.test.ts` (full CLI against the "Acme Tasks" fixture app in `_tests/fixture-site/`, ~10 min; needs
Kokoro on :8880, ffmpeg with drawtext/ass, Playwright Chromium).

**Renderer changes made for this layer** (also affect the desktop app): blur is applied before freeze/zoom
inserts (so frozen and zoomed frames stay blurred) with its duration in recording seconds; subtitles are burned
in one final pass above spotlights and lower-thirds; speed ramps now actually shorten the video; slow motion
< 0.5× works with audio; music works on silent recordings; narrated zooms get subtitles; small-region blur,
`%` in callouts, and special characters in paths are handled.

## Side experiments and unwired code

| Thing | Status |
|---|---|
| [electron/translate.ts](editor/electron/translate.ts) | Offline translation using Opus-MT models run with ctranslate2, with model download and pivoting through English. **Nothing imports it, and there is no IPC or UI for it.** Needs `scripts/setup-translate-venv.sh` |
| Piper TTS | `scripts/setup-piper.sh` and a local `editor/piper/` binary exist. No code on `main` uses them; the work is on the `piper` branch |
| [editor/indicf5-prototype/](editor/indicf5-prototype/) | Standalone quality test of TTS for Indian languages: IndicF5 voice cloning against a baseline of `facebook/mms-tts-*`. The MMS samples exist; IndicF5 has not produced any yet. No conclusions are recorded |
| `scripts/kokoro-worker.py` | Persistent Kokoro worker process (JSON lines over stdin/stdout). Unused: TTS spawns `python -c` for every request |
| Most of `electron/effects.ts` | An older per-action-group renderer. Only `cutSpeedClip`, `mixBackgroundMusic` and the `Action`/`NarrationResult` types are still used |
| `vite.web.config.ts`, `dist-web/`, `.dockerignore` | Remains of a removed browser/Docker mode |

---

## Development

Run everything from `editor/`:

```bash
npm install
npm run dev          # Vite dev server + Electron (no type-check)
npm run lint
npx tsc --noEmit -p tsconfig.app.json        # renderer
npx tsc --noEmit -p electron/tsconfig.json   # main process + pipeline
npm run build        # tsc -b && vite build
npm run dist         # build + electron-builder (bundles kokoro-venv/ if present)
```

Requirements:
- FFmpeg on `PATH` with `drawtext` (libfreetype) support, needed for callouts in dev.
- Kokoro reachable on :8880 (`docker compose up -d` from the repo root), or `KOKORO_PYTHON=/abs/path/to/python`.

**Current state (2026-09-25):**
- `electron/tsconfig.json` type-checks cleanly.
- `tsconfig.app.json` fails with 4 `noUnusedLocals` errors: `App.tsx:74`, `ActionPanel.tsx:3`, `Timeline.tsx:61`, `ZoomEditor.tsx:30`. As a result, **`npm run build` and `npm run dist` fail**. `npm run dev` is unaffected.
- The `api/` tsconfig has the one error noted above.

---

## Doc drift (README.md vs. code)

- **Missing files:** the README's architecture tree lists `Dockerfile` and `docker-compose.web.yml`, which don't exist.
- **Stale roadmap:** "Blur region" is still an unchecked roadmap item, but blur is implemented.
- **Conflicting install hints:** for running Kokoro without Docker, the root README says `pip install kokoro-fastapi`. `editor/README.md` gives a different recipe (`pip install kokoro soundfile numpy` + `KOKORO_PYTHON`), which is the one the code's direct mode uses.
- **Missing mentions:** neither README covers the headless `api/` pipeline, translation, or the `video/` output folder.
