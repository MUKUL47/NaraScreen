# NaraScreen — narrated demo videos of any website

NaraScreen turns a short JSON description of a product walkthrough into a finished, narrated MP4:
it drives a real browser, records the screen, generates the voiceover, and adds zooms, spotlights,
blurs and captions. Everything runs locally.

**You (the agent) only ever do two things:**

1. **Write one JSON file** — the *demo script* — describing what to do on the site and what to say.
2. **Call NaraScreen** — over HTTP (`narascreen serve`) or the command line (`narascreen <command>`).

You never write timestamps or pixel coordinates (NaraScreen measures them while recording), and you
never edit files inside a job folder. Everything you need is on this page.

---

## Overview

```
 you ──write──►  demo script (JSON)
 you ──call───►  validate ──► check ──► make ──► preview
                                         │
               NaraScreen:  record the browser ─► generate narration ─► render effects
                                         │
 you ◄─────────  final_<lang>.mp4  +  contact sheet to look at
```

| Word | Meaning |
|---|---|
| **demo script** | Your JSON file. Its format is the schema (`GET /v1/schema` or `narascreen schema`). |
| **step** | One scene of the demo, e.g. "create a task". Has an `id` and a `beat` list. |
| **beat entry** | One item in a step: an **act** (browser action: goto, click, fill…) or an **fx** (video effect: narrate, spotlight, zoom…). Entries run in order. |
| **job** | A folder NaraScreen owns for one demo: recording, audio, videos, previews. You pass its path around; you don't edit it. |
| **run** | (HTTP only) One execution of a command on the server, with a live event stream. |

### Golden rules

1. **Inspect, don't guess.** Get selectors from `inspect`. Guessed selectors are the #1 cause of failures.
2. **Cheap before expensive.** `validate` (instant) → `check` (seconds, no recording) → `make` (minutes).
3. **Read every response.** Branch on `ok` and `error.code`; do what `error.hint` says; `next` lists the obvious next commands.
4. **Text edits are cheap.** Changing narration, voices, captions or durations re-renders without re-recording.
5. **Look before you deliver.** Open the preview contact sheet (it's a JPEG) and check the frames match what you intended.

---

## Quick start (HTTP)

Someone has started the server (`narascreen serve`) and given you its URL — here `http://127.0.0.1:4790`.
If they gave you a token, add `-H "Authorization: Bearer <token>"` to every `/v1` call.

```bash
BASE=http://127.0.0.1:4790

# 1. Is the machine ready? (ffmpeg, browser, speech engine)
curl -s $BASE/v1/doctor

# 2. See what's on the page you want to demo → elements with ready-to-paste selectors + a screenshot
curl -s -X POST $BASE/v1/runs -H 'Content-Type: application/json' \
  -d '{"command":"inspect","options":{"url":"https://app.example.com/"}}'
#   → {"ok":true,"result":{"runId":"r_…","links":{"wait":"/v1/runs/r_…?wait=120", …}}}
curl -s "$BASE/v1/runs/<runId>?wait=120"          # blocks until done → result.output.elements
#   finished runs: result.ok, result.output (= the command's result, or its error), result.outcome (full envelope)

# 3. Save your script (it is validated first; problems come back as SCRIPT_INVALID with a list)
curl -s -X POST $BASE/v1/scripts -H 'Content-Type: application/json' \
  -d '{"name":"my-demo","script":{ …your demo script… }}'
#   → result.scriptPath

# 4. Dry-run the browser steps (no recording)
curl -s -X POST $BASE/v1/runs -H 'Content-Type: application/json' \
  -d '{"command":"check","scriptPath":"<scriptPath>"}'

# 5. Make the video, and watch progress live
curl -s -X POST $BASE/v1/runs -H 'Content-Type: application/json' \
  -d '{"command":"make","scriptPath":"<scriptPath>","job":"my-demo"}'
curl -N $BASE/v1/runs/<runId>/events              # Server-Sent Events; the last one is `end`

# Need your own files (a voiceover, music, a video to edit, a saved login, a file the demo uploads
# into the site)? Upload them first (any file type), then refer to them in the script by the returned
# relativePath, e.g. "audio": "uploads/intro.mp3" or {"act": "upload", …, "files": "uploads/sheet.xlsx"}.
curl -s -T intro.mp3 "$BASE/v1/files?path=uploads/intro.mp3"

# 6. Fetch the results (any path from a result works here)
curl -s "$BASE/v1/files?path=<video path>" -o demo.mp4
curl -s "$BASE/v1/files?path=<contactSheet path>" -o contact.jpg
```

## Quick start (CLI)

Same flow, same JSON. Every command prints **one JSON object on stdout**; progress goes to stderr.

```bash
narascreen doctor
narascreen inspect --url https://app.example.com/
narascreen init --url https://app.example.com --out my-demo.demo-script.json   # optional starter file
narascreen validate my-demo.demo-script.json
narascreen check    my-demo.demo-script.json
narascreen make     my-demo.demo-script.json --out ./jobs/my-demo
narascreen preview  ./jobs/my-demo
```

**Over HTTP everything lives in the server's workspace:** jobs, saved scripts and uploads. Paths you pass
(`job`, `scriptPath`, file references inside scripts) must resolve inside it — use job *names* (`"job": "my-demo"`)
and `uploads/…` paths from `PUT /v1/files`. In scripts sent inline, relative file paths resolve against the
workspace; in script files, against the file's own folder.

If `narascreen` is not on your PATH, the launcher lives at `editor/bin/narascreen` inside the
NaraScreen checkout (run it with any working directory).

---

## Workflow

Follow these steps in order. Each one tells you whether to move on or go back.

### 1. Plan the story

Before touching the site, turn the request into a storyboard:

- **Who watches and what should they learn?** One demo = one goal ("create your first task").
- **Steps:** 3–10 scenes, each one idea. Give each a short `id` (`open-tasks`) and a human `label`.
- **Narration:** 1–3 short sentences per scene, spoken language (it is read aloud).
- **Length:** narration drives length — about 15 characters per second of speech. `validate` estimates it.
- **Languages:** one video per language (`languages: ["en", "hi"]`).

Write the answers down as the script's optional `plan` — it is kept with the job, so whoever edits the
video later sees why it is the way it is, and `validate` warns when the script drifts from it:

```json
"plan": {
  "audience": "Team leads trying Acme Tasks for the first time",
  "takeaway": "Creating a task takes under a minute",
  "hook": "Open on the dashboard with overdue work highlighted",
  "leaveOut": ["billing", "integrations"],
  "tone": "calm, practical",
  "targetSec": 60
}
```

Checklist while planning:

- **The first seconds decide** whether someone keeps watching: open on the most telling screen (`hook`),
  not on a login form (log in inside `setup`).
- **One takeaway.** Every step should serve it; anything else goes in `leaveOut`
  (`validate` warns when a step's id, label, narration or target mentions a `leaveOut` topic).
- **Don't read the screen aloud.** Narration says what the viewer can't see: why, what happens next.
- **Be specific to this product** — its names, its numbers. No generic "streamline your workflow".
- **Text must stay up long enough to read** (callouts: the `auto` duration does this).
- **Length:** `targetSec` makes `validate` warn when the estimate is more than 25 % over it.

### 2. Check the machine

`doctor` must say `ready: true`. If not, run each failing check's `fix` command (or ask the human to), then re-run doctor.

### 3. Explore the site

Run `inspect` on every page the demo visits. The result lists elements like:

```json
{ "role": "button", "name": "New task", "selector": { "role": "button", "name": "New task" },
  "matches": 1, "visible": true, "inViewport": true, "rect": [1180, 96, 112, 36] }
```

Copy `selector` into your script as-is — it is already unique on the page when `matches` is 1.
`screenshot` is a PNG of the page; look at it.

File inputs are listed even when hidden (most sites hide them behind a styled button), flagged
`"inputType": "file"` with `accept` and `multiple`. They are what the `upload` act targets (see *Uploading files*).

Pages behind a login, or states that only exist after some clicks (an open dialog, a created item):
write those steps into your script first, then `inspect --script my.demo-script.json --until <step-id>`
(HTTP: `{"command":"inspect","scriptPath":…,"options":{"until":"<step-id>"}}`). NaraScreen runs the
script up to and including that step, then inspects the page as it is at that moment.

### 4. Write the script — a few steps at a time

Write the first one or two steps, `validate`, `check`, then add more. Small increments keep failures obvious.

### 5. Validate

`validate` checks everything that can be checked without a browser and reports **all** problems at once
in `error.details.issues` (`path` + `message` + often a `hint` like *did you mean "narrate"?*). Fix them
all, validate again, repeat until `ok: true`. Read `warnings` too — they flag things that work but look bad.

### 6. Check

`check` runs every browser step at full speed without recording. When a step fails you get:

- `error.code` — e.g. `SELECTOR_NOT_FOUND`, `WAIT_TIMEOUT`, `TARGET_NOT_VISIBLE`
- `error.where` — `{ "step": "create-task", "entry": 2, "path": "steps[3].beat[2]" }`
- `error.details.candidates` — the most similar elements actually on the page, with ready-to-paste selectors
- `error.details.screenshot` — what the page looked like at that moment (look at it!)

Fix the entry and check again until it passes.

> **`check` and `inspect --until` really do everything the script says** — they click Save, create
> records, send forms and upload files, exactly like `make`. Those changes stay in the site. If a demo
> creates data (a new task, an imported sheet), reset the site's data (or use a fresh test account)
> before `make`, or the recording will show duplicates and "already exists" errors.

### 7. Make

`make` records the browser, generates the narration, renders every effect and writes a preview.
It takes roughly 1–3× the video length. The result lists each video with its narrations and their spoken durations:

```json
{ "job": "/…/jobs/my-demo", "recorded": true,
  "videos": [{ "lang": "en", "path": "/…/video/final_en.mp4", "durationSec": 74.2,
               "narrations": [{ "step": "intro", "entry": 1, "text": "…", "voice": "af_heart", "durationSec": 4.1 }],
               "preview": { "contactSheet": "/…/preview/en/contact.jpg", "frames": [{ "t": 3.1, "path": "…" }] } }] }
```

### 8. Review

Open `preview.contactSheet` (a grid of frames labelled with their time) and, if you can, a few `frames`.
Check: the right screens appear in order; highlights sit on the right elements; nothing secret is visible;
nothing is cut off. If you cannot view images, at least compare `durationSec` with your plan.

### 9. Iterate

| You changed… | Do this | Re-records? |
|---|---|---|
| narration text, voice, language, speed | `produce <job>` (or `make` again) | no |
| callout text/style/size, durations, ranges (`until`/`seconds`/`factor`), dim, blur radius, zoom timing, `disabled`, `music`, `output`, `audio`, subtitles | `produce <job>` (or `make` again) | no |
| any act (goto/click/fill/…), fx order, an `anchor`, `setup`, `defaults` timing, `baseUrl`, `viewport` | `make` again (it re-records automatically) | yes |

`produce` re-reads the script file the job was recorded from, so edit that file (or pass `--script`).
If you changed something that needs a new recording, `produce` refuses with `SCRIPT_STRUCTURE_CHANGED`
and lists the changed steps.

### 10. Deliver

Hand over `videos[].path`. The job folder is also a NaraScreen desktop-editor session: a human can open
it in the NaraScreen app to fine-tune anything by hand.

---

## Writing scripts

A complete example (a task-manager web app):

```json
{
  "version": 1,
  "scope": "create-a-task",
  "baseUrl": "https://tasks.example.com",
  "viewport": { "width": 1440, "height": 900 },
  "setup": [
    { "act": "goto", "path": "/login" },
    { "act": "fill", "label": "Email", "value": "demo@example.com" },
    { "act": "fill", "label": "Password", "value": "${env:DEMO_PASSWORD}" },
    { "act": "click", "role": "button", "name": "Sign in" },
    { "act": "waitFor", "role": "heading", "name": "Dashboard" }
  ],
  "steps": [
    {
      "id": "intro",
      "label": "Dashboard at a glance",
      "beat": [
        { "act": "goto", "path": "/dashboard" },
        { "act": "waitFor", "role": "heading", "name": "Dashboard" },
        { "fx": "callout", "style": "lower-third", "text": "Your dashboard" },
        { "fx": "narrate", "narrate": "This is your dashboard. It shows what's due today and what's overdue." }
      ]
    },
    {
      "id": "open-form",
      "label": "Start a new task",
      "beat": [
        { "act": "click", "role": "link", "name": "Tasks" },
        { "act": "click", "role": "button", "name": "New task" },
        { "act": "waitFor", "role": "dialog", "name": "New task" },
        { "fx": "narrate", "narrate": "To add a task, click New task and fill in the details." }
      ]
    },
    {
      "id": "fill-form",
      "label": "Fill in the task",
      "beat": [
        { "act": "fill", "label": "Title", "value": "Prepare quarterly report" },
        { "act": "select", "label": "Priority", "option": "High" },
        { "fx": "spotlight" },
        { "fx": "narrate", "narrate": "Give it a clear title and set the priority." },
        { "act": "click", "role": "button", "name": "Create task" }
      ]
    },
    {
      "id": "result",
      "label": "The new task",
      "beat": [
        { "act": "waitFor", "role": "row", "name": "Prepare quarterly report" },
        { "fx": "zoom", "anchor": { "role": "row", "name": "Prepare quarterly report" },
          "narrate": "And there it is, at the top of your list." }
      ]
    }
  ]
}
```

### How time flows

- Entries in a step run **top to bottom**. After each entry NaraScreen waits `dwellMs` (default 1.5 s) so viewers can follow.
- Before acting on an element NaraScreen scrolls it to the middle of the screen and lets it settle.
- `fill` types key by key on camera (`typeDelayMs`).
- An **fx happens at the moment it appears in the list** — put it right after the act it belongs to.
- **Narration freezes the video** (default) for as long as the speech lasts, so the viewer hears the
  explanation while looking at the frame it describes. Use `"freeze": false` to talk over moving video.
- `spotlight` and `callout` stay on screen **until the next narration in the same step has finished**
  (`duration: "auto"`, the default), or 3 s if the step has no narration after them. `blur` defaults to the
  end of its step (`"step-end"`). Any of them accepts seconds, `"step-end"` or `"end"` (rest of the video).

### Patterns that make good demos

- **Say, do, show:** narrate what's about to happen → act → spotlight/zoom the result.
- **Point without dimming:** `arrow` is the light-touch spotlight — good for "click here" moments,
  small buttons, or when the rest of the screen should stay readable.
- **One idea per step**, 1–3 sentences of narration. Long monologues over a frozen frame feel slow.
- **Wait for the screen, not the clock:** after navigation or anything asynchronous, add a `waitFor`
  on something that only appears when the page is ready. Use `wait` only for pure animations.
- **Use `setup` for anything the viewer shouldn't see** (logging in, resetting data). It runs before recording starts.
- **Upload files on camera** with the `upload` act (see *Uploading files* below) — no OS file dialog appears.
- **Blur secrets** (API keys, emails, balances) with `{"fx": "blur", "anchor": …}` placed as soon as they appear. A blur lasts until its step ends by default; add `"duration": "end"` to keep it hidden for the rest of the video.

### Uploading files

`upload` chooses file(s) in the page, the way a user picking from the file dialog would — but the dialog
never opens, so nothing of your desktop is on camera.

```json
{ "act": "upload", "role": "button", "name": "Choose file", "files": "uploads/comp-sheet.xlsx" }
{ "act": "upload", "css": "input[type=file]", "files": ["uploads/a.pdf", "uploads/b.pdf"] }
```

- **Selector** (required): either the `<input type=file>` itself — it may be hidden, as it usually is —
  or whatever the user clicks to open the file picker (a button, a label, a dropzone that opens a picker).
  `inspect` lists file inputs even when hidden (`"inputType": "file"`).
- **`files`**: one path or a list. Any file type. Paths are relative to the script file; in a script sent
  inline over HTTP, relative to the workspace. Over HTTP, upload the file first:
  `curl -T comp-sheet.xlsx "$BASE/v1/files?path=uploads/comp-sheet.xlsx"` → use `result.relativePath`.
  A missing file is a `SCRIPT_INVALID` issue at `…files[k]` (found by `validate`, before any browser starts).
- **Several files** only work when the input accepts several (`multiple`); otherwise `ACTION_FAILED`.
- **Effects after it** (spotlight, zoom…) use the target's box; for a hidden input, its visible label or
  clickable ancestor. If there is none (e.g. you targeted a hidden input directly), give the fx an `anchor`
  — or target the visible button instead, which is usually the better shot anyway.
- Add a `waitFor` on something that proves the upload was accepted (the file name, "Upload complete").
- Replacing the file's content (same name) makes `make` re-record: the page would show different data.
- Not supported: drag-and-drop-only dropzones that never open a file picker; capturing downloads
  (clicking a download link works, the file is just not kept).

---

## Title and end cards

`intro` is a title card before the video, `outro` an end card after it. NaraScreen draws them from a
built-in template, animates them (the parts slide and fade in; the card fades out) and joins them to every
language's video. Same script, same card. Editing a card never re-records — only `produce` runs again.

```json
"intro": {
  "template": "clean",
  "title": { "en": "Create a task in Acme", "hi": "Acme में टास्क बनाएं" },
  "subtitle": { "en": "Under a minute, start to finish", "hi": "एक मिनट से भी कम में" },
  "logo": "acme-logo.svg",
  "accent": "#4F46E5",
  "narrate": { "en": "Here's how to create a task in Acme.", "hi": "देखिए Acme में टास्क कैसे बनाते हैं।" }
},
"outro": {
  "template": "bold",
  "title": { "en": "Try it on your team's work", "hi": "अपनी टीम के काम पर आज़माएं" },
  "cta": "tasks.example.com",
  "duration": 3
}
```

| Field | |
|---|---|
| `template` | `clean` (default: light, calm) · `bold` (accent-coloured background, big type; the logo sits on a white badge) · `minimal` (dark, left-aligned) |
| `title` | required. Text, or per language (falls back to `en`) |
| `subtitle`, `cta` | optional second line; `cta` is a pill (a URL, "Start free trial") — mostly for the outro |
| `logo` | png / jpg / svg / webp, relative to the script (over HTTP: upload it with `PUT /v1/files`, then `uploads/…`) |
| `accent` | `#RRGGBB` (default `#4F46E5`) |
| `narrate`, `voice` | optional voiceover, same voices and caching as step narration |
| `duration` | seconds, or `auto` (default): the narration + ~1.3 s, or 3 s without narration |

- The card matches the video's size (a phone-shaped video gets a phone-shaped card) and resolution preset.
- Background music plays under the video but not under the cards.
- The result lists them: `videos[].cards: [{ which, durationSec, narration? }]`.
- Cards live only in the rendered video: the desktop editor opens the job without them.

---

## Selectors

A selector finds **one element**. Use exactly one of these keys, best first:

| Key | Use for | Example |
|---|---|---|
| `role` (+ `name`) | Almost everything: buttons, links, inputs, tabs, rows, dialogs, headings | `{ "role": "button", "name": "Save" }` |
| `label` | Form fields with a visible label | `{ "label": "Email" }` |
| `placeholder` | Inputs with no label | `{ "placeholder": "Search…" }` |
| `text` | Plain text on the page (exact match by default) | `{ "text": "Prepare quarterly report" }` |
| `testId` | Elements with a `data-testid` | `{ "testId": "save-btn" }` |
| `css` | Last resort | `{ "css": ".toolbar > button:nth-child(2)" }` |

In an **act** entry the selector keys sit directly on the entry (`{"act": "click", "role": "button", "name": "Save"}`).
In an **fx** entry they go inside `anchor` (`{"fx": "spotlight", "anchor": {"role": "button", "name": "Save"}}`).

**When several elements match** (inspect shows `matches` > 1), narrow it — in this order:

1. `"exact": true` — `name`/`label` match the whole text instead of a substring (`"Save"` stops matching `"Save draft"`).
2. `"within"` — search inside one container:
   - `{ "within": { "role": "dialog", "name": "New task" } }` — inside a dialog
   - `{ "within": { "text": "Quarterly report" } }` — inside the row/card whose text is exactly that (e.g. that row's Edit button; "Quarterly report 2" is a different row)
   - `{ "within": { "css": "#billing" } }`
3. `"nth": 1` — the second match (0-based). Fragile; use when nothing else works.

`role` names are ARIA roles: `button`, `link`, `textbox`, `searchbox`, `combobox`, `checkbox`, `radio`,
`switch`, `tab`, `menuitem`, `option`, `heading`, `row`, `cell`, `dialog`, `img`, `listitem`, `navigation`.
An icon-only button is usually reachable by its accessible name: `{ "role": "button", "name": "Delete" }`.

**Common failures:** the element is inside a menu or tab that isn't open yet (click the trigger first);
the page hasn't loaded (add a `waitFor`); the text differs slightly (use what `inspect` shows); a toast
disappeared before you reached it (act on it sooner or don't target it).

---

## Effects & timing

| fx | What the viewer sees | Needs an element? | Duration |
|---|---|---|---|
| `narrate` | Voiceover; the frame freezes while it plays (`freeze: false` = video keeps moving) | no | length of the speech + 0.5 s |
| `zoom` | Smooth zoom into the element on a frozen frame, hold, zoom out. Add `narrate` to talk while zoomed in | yes | `zoomDuration` in + hold + out; hold = speech length when narrated, else `zoomHold` |
| `spotlight` | Everything except the element is dimmed; `padding` (px) leaves extra room around it | yes | `auto` (default: until the step's next narration ends), `step-end`, `end`, or seconds |
| `arrow` | An animated arrow points at the element: a dashed line drawn in dash by dash, then the head; optional `text` label at its tail. The page stays bright (a lighter touch than spotlight) | yes | `auto` (default), `step-end`, `end`, or seconds |
| `callout` | Text label: `label` (at the element), `lower-third` (bottom banner), `step-counter` ("Step N: …") | `label`/`step-counter`: yes | `auto` or seconds |
| `blur` | The element is blurred (hide secrets) | yes | `step-end` (default), `end` (rest of the video), `auto`, or seconds |
| `pause` | Frame freezes silently | no | `seconds` (default 3) |
| `speed` | A stretch plays faster (`factor: 3`) or in slow motion (`factor: 0.5`) | no | a range (below) |
| `skip` | A stretch is cut out — e.g. waiting for a slow page | no | a range (below) |
| `mute` | The source video's own sound is silenced (only for edited videos — browser recordings are silent anyway) | no | a range (below) |

**Spotlight padding:** by default the bright area is the element's exact box. `"padding": 12` adds 12 px on
every side (clamped to the frame) — use it when the box is tight, e.g. a button whose border or shadow
would otherwise be dimmed, or a text field with its label just outside. With `anchors`, every box gets it.

```json
{ "fx": "spotlight", "anchor": { "role": "button", "name": "Save" }, "padding": 12 }
```

**Several at once:** `spotlight` and `blur` take `anchors: [ … ]` to light or blur several elements
together (they must all be on screen at the same moment). `zoom` takes `targets: [{ "anchor": …, "narrate": "…" }, …]`
to zoom into several elements one after another on the same frozen frame, each with its own narration.

**Arrow:**

```json
{ "fx": "arrow", "anchor": { "role": "button", "name": "Export CSV" }, "text": "Click here" }
```

- It comes from the first side with room — bottom-left, bottom-right, top-left, top-right, left, right,
  below, above — or the one you set with `from` (same names).
- `color` is `#RRGGBB` (default `#FBBF24`, amber — readable on light and dark pages). `fontSize` sizes the label (default 24).
- `text` can be per language, like callouts: `{"en": "Click here", "hi": "यहाँ क्लिक करें"}`.
- Without `anchor` it points at the element of the act just before it, like spotlight. In video-source
  scripts give `rect` (and `at`).
- Point, then talk: put a `narrate` right after it — with the default `auto` duration the arrow stays
  until that narration ends. An arrow and a label/spotlight can be on screen together.

**Callout look:** `fontSize` (12–96) and `placement` (`above` — the default —, `below`, `over`) position the text next to its element.

**Turn an effect off** without deleting it: `"disabled": true`. Toggling it never needs a re-record.

### Ranges (speed, skip, mute)

A range starts where the entry sits and ends at:

| `until` | Ends when… | Default for |
|---|---|---|
| `"next-act"` | the next browser action in the same step has finished | `skip` |
| `"step-end"` | this step ends | `speed`, `mute` |
| `"<step-id>"` | that later step ends | — |

…or give `"seconds": N` instead. Typical uses:

```json
{ "act": "click", "role": "button", "name": "Export CSV" },
{ "fx": "skip" },
{ "act": "waitFor", "text": "Export ready" }
```
cuts the wait between the click and the result, and

```json
{ "fx": "speed", "factor": 3 },
{ "act": "fill", "label": "Title", "value": "A long title nobody wants to watch being typed" },
{ "act": "fill", "label": "Description", "value": "…" }
```
fast-forwards through the rest of the step.

"Needs an element" means: give an `anchor`, **or** place the fx right after an act that targeted an
element in the same step (click/fill/select/hover/scroll/waitFor, or press with a selector) — it then uses
that element, measured after the act (e.g. `waitFor` a dialog, then `spotlight` lights the dialog).

Rules the renderer enforces:

- Two **spotlights may not overlap** in time (`SPOTLIGHT_OVERLAP`). Use `auto` durations or shorter numbers.
- Overlays (spotlight/callout/blur) **stop before a zoom** — zoomed frames are rescaled, so a highlight
  would land in the wrong place. NaraScreen shortens `auto` overlays for you and warns about explicit ones.
  Don't rely on a blur to hide something that a later zoom in the same step will show.

---

## Narration & voices

- `narrate` is a string, or a map per language: `{"en": "Click Save.", "hi": "सेव पर क्लिक करें।"}`.
- Top-level `languages` lists the videos to produce (default `["en"]`). Every narration needs text for
  each language, or an `en` fallback. (`validate` checks this.)
- Voices: `GET /v1/voices` or `narascreen voices`. Set per language in `tts.voices`
  (`{"en": "af_heart", "hi": "hf_alpha"}`) or per entry with `"voice"`. Voice ids start with the
  language's letter (`a…`/`b…` English, `h…` Hindi, …); a mismatched voice mispronounces everything.
- `tts.speed` (0.5–2, default 1) changes the speaking rate for the whole video.
- **Your own recording instead of a generated voice:** `"audio": "voiceover/intro.mp3"` (or one file per
  language, `{"en": "…", "hi": "…"}`) on a `narrate` or `zoom` (or a zoom target). Keep `narrate` text as
  well if you want subtitles. Paths are relative to the script file.
- **Subtitles** are burned in with word highlighting by default; `"subtitles": false` turns them off,
  `"subtitleSize": 36` changes their size.

### Music and output

```json
"music":  { "path": "music/calm.mp3", "volume": 0.4, "duckTo": 0.15 },
"output": { "resolution": "1080p", "quality": "high" }
```

- `music` plays under the whole video (looped) and drops to `duckTo` while narration speaks.
- `output.resolution`: `native` (default — the viewport size), `480p`, `720p`, `1080p`, `1440p`, `4k`.
  A different shape than the viewport is letterboxed, so pick a viewport with the same shape
  (1920x1080 for 1080p). `output.quality`: `high` (default), `medium`, `low` (smaller files).
- The CLI flags `--resolution` / `--quality` (HTTP options `resolution` / `quality`) override both for one run.

**Writing for speech:** short sentences; no markdown, emoji, URLs or code; spell out symbols
("twenty percent", not "20%") and awkward acronyms; name UI elements the way they appear on screen.

---

## Logging in

Pick one:

1. **`setup` steps** (simplest). Script the login form in `setup`; it runs before recording starts.
   Keep secrets out of the file with `${env:NAME}` placeholders. A missing value fails fast with `ENV_VAR_MISSING`.
   - **CLI:** NaraScreen reads them from its environment: `DEMO_PASSWORD=… narascreen make …`.
   - **HTTP:** send them with the request — they are used for that run only, never stored, and masked as `***`
     in events and results. Pass the same `env` to `/v1/validate` / `/v1/scripts` when checking such a script.
     ```bash
     curl -s -X POST $BASE/v1/runs -H 'Content-Type: application/json' \
       -d '{"command":"make","scriptPath":"<scriptPath>","env":{"DEMO_PASSWORD":"s3cret"}}'
     ```
   Throwaway demo credentials (a public sandbox login) may be written into the script directly.
2. **`storageState`**: a Playwright storage-state JSON (cookies + localStorage) from a previous login.
   Relative paths are relative to the script file.
3. **Several users in one video**: `{"act": "useSession", "storageState": "other-user.json", "path": "/inbox"}`
   switches the browser to another saved session mid-demo.

Never put real passwords directly in a script.

---

## Flutter apps (recorded as an Android phone)

A Flutter app that builds for the web (`flutter build web`) can be recorded as a phone: portrait video
at the phone's real resolution, touch taps and swipes, Flutter's Android look. Turn on the plugin:

```json
{
  "version": 1,
  "scope": "Acme mobile",
  "baseUrl": "http://localhost:8080",
  "plugins": { "flutter": { "device": "pixel-7" } },
  "setup": [
    { "act": "goto", "path": "/" },
    { "act": "fill", "role": "textbox", "name": "Email", "value": "demo@example.com" },
    { "act": "fill", "role": "textbox", "name": "Password", "value": "${env:DEMO_PASSWORD}" },
    { "act": "click", "role": "button", "name": "Sign in" },
    { "act": "waitFor", "role": "heading", "name": "Tasks" }
  ],
  "steps": [
    { "id": "find", "beat": [
      { "act": "swipe", "direction": "up", "to": { "role": "button", "name": "Task 20" } },
      { "fx": "arrow", "text": "Your task" },
      { "fx": "narrate", "narrate": "Swipe down the list to find any task." }
    ] },
    { "id": "cards", "beat": [
      { "act": "click", "role": "tab", "name": "Highlights" },
      { "act": "swipe", "direction": "left" },
      { "fx": "narrate", "narrate": "Swipe sideways through your highlights." }
    ] }
  ]
}
```

- **Serve the web build** somewhere the recorder can open (e.g. `cd build/web && python3 -m http.server 8080`)
  and use that address as `baseUrl`. Only the screen is recorded — no camera, GPS, push notifications or
  native plugins; screens that need them won't work in the web build.
- **`device`**: `pixel-7` (default, 412×915 → video 1082×2402), `pixel-9-pro`, `galaxy-s24`, `small-phone`,
  or `{"width": 412, "height": 915, "pixelRatio": 2.625}`. The video is the phone's pixel size; don't set
  `viewport` (it is ignored). Use `output.resolution` only if you want a landscape frame (it letterboxes).
- **Selectors work like on a website.** Flutter draws on a canvas, but the plugin switches on Flutter's
  accessibility tree (invisible elements with roles and names laid over the widgets), so `inspect` lists
  buttons, textboxes, tabs, headings and list items with ready-to-paste selectors. Use
  `inspect --url <page> --plugin flutter [--device pixel-7]` (HTTP: `"options": {"url": …, "plugin": "flutter"}`),
  or `inspect --script <script> --until <step>` (the plugin comes from the script). Without the plugin,
  `inspect` sees only an "Enable accessibility" button.
  Names come from the widgets' text / `Semantics` labels / tooltips — a list tile is named by all its
  texts, e.g. `"20 Task 20 Normal"` (names match by substring, so `"Task 20"` finds it — watch out for
  `"Task 2"` also matching `"Task 20"`: use more of the name or `"exact": true`).
- **Taps**: `click` taps with a finger (no mouse hover, so no tooltips). `fill` types into Flutter text fields.
- **`swipe`** (this plugin only):
  - `{"act": "swipe", "direction": "up"}` — finger moves up = scroll to later content; `down` = back;
    `left` = next page/card; `right` = previous.
  - `"to": {selector}` — keep swiping until that element is on screen, then centre it. Its box becomes the
    target of the following fx (arrow, spotlight, zoom…). Items far down a list don't exist until scrolled
    to, so this is how you reach them. `maxSwipes` (default 10).
  - An optional selector (e.g. a carousel) makes the finger start inside that element.
  - `distance` (0.1–1, default 0.6 of the area) and `durationMs` (default 400; faster = longer fling).
- **Overlays are scaled to the phone**: callout/arrow text, subtitles, arrow size, spotlight `padding` and blur strength grow
  with the pixel ratio, so they look the same as on a desktop video.
- **Check the build first:** `doctor --script <script>` includes a `flutter` check (baseUrl is up and
  serves a Flutter web build); `check`/`make` refuse a non-Flutter baseUrl with `FLUTTER_NOT_WEB_BUILD`.
- **When the app never becomes usable** — e.g. the splash screen waits for a native-only plugin
  (path_provider, file cookie jars, secure storage, camera, GPS) that never answers on web — the first
  step that can't find its element fails with **`FLUTTER_APP_NOT_READY`** instead of a plain timeout.
  A canvas app has no DOM to debug, so `error.details` carries what there is: `visibleLabels`,
  `semanticsSnapshot`, `console` (every level), `pageErrors`, `unhandledRejections`, `pendingRequests`,
  a `screenshot`, and the original error as `cause`. The fix is in the app: a web branch (`kIsWeb`)
  for whatever it awaits at startup. `inspect` warns about such a screen too.
  If Flutter's accessibility tree can't be switched on at all: `FLUTTER_SEMANTICS_UNAVAILABLE`.
- **Don't record against production.** A release web build has its API address baked in (dotenv,
  `--dart-define`), so a demo can log in to — and change — real data. NaraScreen warns when the app
  calls a host other than baseUrl's. To enforce it, list the hosts the demo may use:
  `"plugins": {"flutter": {"allowedHosts": ["localhost:8090"]}}` — every other host is blocked and the
  run fails with `BLOCKED_REQUEST` (details list the blocked requests). baseUrl's own host and Flutter's
  font/engine CDNs (fonts.gstatic.com, fonts.googleapis.com, www.gstatic.com) are always allowed.
- **Keep effects on their screen:** an effect without narration after it stays 3 s (`auto`) — if the next
  tap opens another screen sooner, it would linger. Narrate right after it (the frame freezes while
  speaking), or give it a `duration`.

---

## Editing an existing video

NaraScreen can also narrate and edit a video that already exists (a screen recording someone made,
an exported clip) — no browser involved. Point `source.video` at it; the steps then contain only effects,
each placed with `at` (seconds into the source) and regions given as `rect: [x, y, width, height]` in the
video's pixels:

```json
{
  "version": 1,
  "scope": "release-walkthrough",
  "source": { "video": "raw/walkthrough.mp4" },
  "steps": [
    { "id": "intro", "beat": [
      { "fx": "narrate", "at": 1.0, "narrate": "Here's what's new this month." },
      { "fx": "mute", "at": 0, "seconds": 12 }
    ]},
    { "id": "search", "beat": [
      { "fx": "spotlight", "at": 14.5, "rect": [220, 90, 640, 56] },
      { "fx": "narrate", "at": 15.0, "narrate": "Search now finds tasks by assignee." },
      { "fx": "skip", "at": 21.0, "seconds": 6 },
      { "fx": "blur", "at": 30.0, "rects": [[1100, 40, 260, 40]], "duration": 8 }
    ]}
  ]
}
```

How to find `at` and `rect`: run `record` (it imports the video into a job), then `preview <job> --raw`
for a contact sheet of the source with timestamps; frame images are full-size, so pixel positions you read
from them are video pixels. `validate` rejects times past the end and rects outside the frame.
Ranges in these scripts always use `seconds`. Editing `at`/`rect`/text never needs a re-import;
replacing the source file does (`make` notices).

## Iterating and reusing recordings

A job remembers a fingerprint of everything that affects the recording. `make` on an existing job:

- fingerprint unchanged → **reuses the recording** (`"recorded": false`) and only re-renders — seconds to minutes;
- fingerprint changed → re-records automatically (with a warning), then renders;
- `--force` (HTTP: `"options": {"force": true}`) → always re-records.

Narration audio is cached by content, so unchanged sentences are not regenerated.

Run several demos in parallel by giving each its own job folder. Two commands on the same job at
once are refused with `JOB_LOCKED`.

---

## Events and long runs

Every command reports progress as events. Over HTTP:

```bash
curl -N $BASE/v1/runs/<runId>/events
```

```
event: stage
data: {"ts":"…","type":"stage","stage":"record","message":"Recording 6 steps"}

event: step
data: {"ts":"…","type":"step","stage":"record","message":"step 2/6 · open-form — Start a new task","data":{"index":2,"total":6,"id":"open-form"}}

event: end
data: {"ok":true,"command":"make","result":{…},"warnings":[],"next":[…]}
```

The stream replays everything that already happened, so connecting late is fine. It always ends with
`end`, whose data is the same envelope the CLI prints. Prefer plain HTTP? `GET /v1/runs/<runId>?wait=120`
blocks until the run finishes (or 120 s pass) and returns its status plus `outcome` (the envelope).
Add `?format=ndjson` to the events URL for newline-delimited JSON instead of SSE.

Stages, in order: `validate` → `setup` → `record` → `tts` → `compile` → `render` → `preview`.
From the CLI, `--events json` prints the same events as JSON lines on stderr.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `SELECTOR_NOT_FOUND` | Use a selector from `error.details.candidates`, or `inspect --script … --until <previous step>` to see the page at that point. |
| `WAIT_TIMEOUT` | The step before didn't lead where you expected. Look at `error.details.screenshot`. |
| `TARGET_NOT_VISIBLE` | Open the menu/tab/dialog that contains it first, or it's covered by something (close the popup). |
| `swipe … to` → `SELECTOR_NOT_FOUND` "never came on screen" | Wrong direction (`up` = towards later items), wrong name (look at `inspect` after swiping there), or raise `maxSwipes`. |
| Flutter app: `inspect` shows only "Enable accessibility" / nothing | Add `--plugin flutter` (or use `inspect --script` with `plugins.flutter`), and check the page really is the Flutter web build. |
| `FLUTTER_APP_NOT_READY` | The app is stuck on its first screen. Read `details.console` / `pendingRequests` / `unhandledRejections`; give the startup code a web fallback. |
| `BLOCKED_REQUEST` | The build calls a backend outside `allowedHosts` — rebuild it against the demo backend, or allow the host if it is safe. |
| `ACTION_FAILED` on an `upload`: "neither a file input nor something that opens a file picker" | Point at the `<input type=file>` (listed by `inspect` with `"inputType": "file"`, even when hidden), or at the button that opens the picker. Drag-and-drop-only zones are not supported. |
| `ACTION_FAILED` on an `upload`: "accepts only one" | The input has no `multiple`: pass one file, or use the site's multi-file input. |
| Duplicates / "already exists" in the video | `check` and `inspect --until` really performed the steps. Reset the site's data before `make`. |
| `TTS_UNAVAILABLE` | The speech engine is down: run `doctor` and apply its fix. |
| `SCRIPT_STRUCTURE_CHANGED` | You changed browser steps; run `make` (re-records) instead of `produce`. |
| Highlight ends too early / too late | Leave `duration` unset (`auto`), or put the narration right after the effect in the same step. |
| Video feels slow | Shorter narration; lower `defaults.dwellMs` (e.g. 1000); fewer frozen pauses. |
| Typing looks too fast/slow | `defaults.typeDelayMs` (default 60 ms per key). |
| Wrong element highlighted | The anchor/inherited element isn't what you think — add an explicit `anchor` from `inspect`. |
| Secret visible | Add a `blur` anchored on it right after it appears; avoid zooming onto it. |

### Limits

- Recording works for websites only (Chromium); anything else can be edited as an existing video (`source.video`).
  One `baseUrl` per script; absolute URLs in `goto` can leave it.
- Browser recordings are silent apart from narration and music (page audio is not recorded), and the mouse pointer is not drawn.
- Output size = `viewport`, 30 fps MP4.
- Narration languages are those listed in the voice catalog.
