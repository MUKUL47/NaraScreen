// ─── commands: the CLI surface, as data ──────────────────────────────
//
// Single source for `narascreen help`, argument parsing in cli.ts, the HTTP
// server's run mapping, and the generated docs. Add a command here first.

export interface FlagDoc {
  /** e.g. "--out <dir>" */
  flag: string;
  /** parseArgs name, e.g. "out" */
  name: string;
  type: "string" | "boolean";
  desc: string;
}

export interface CommandDoc {
  name: string;
  usage: string;
  summary: string;
  /** Positional argument, if any. */
  arg?: { name: string; desc: string; required: boolean };
  flags: FlagDoc[];
  /** What `result` holds on success. */
  output: string;
  /** Runs a browser or renders video (queued by the server). */
  heavy: boolean;
}

const out = (desc: string): FlagDoc => ({ flag: "--out <path>", name: "out", type: "string", desc });
const headed: FlagDoc = { flag: "--headed", name: "headed", type: "boolean", desc: "Show the browser window (default: headless)." };
const lang: FlagDoc = {
  flag: "--lang <codes>",
  name: "lang",
  type: "string",
  desc: "Comma-separated languages to produce, e.g. en,hi (default: script.languages or en).",
};
const force: FlagDoc = { flag: "--force", name: "force", type: "boolean", desc: "Replace an existing job's recording." };
const resolution: FlagDoc = {
  flag: "--resolution <preset>",
  name: "resolution",
  type: "string",
  desc: "native | 480p | 720p | 1080p | 1440p | 4k (overrides script output.resolution; default native).",
};
const quality: FlagDoc = {
  flag: "--quality <level>",
  name: "quality",
  type: "string",
  desc: "high | medium | low (overrides script output.quality; default high).",
};

export const COMMANDS: CommandDoc[] = [
  {
    name: "help",
    usage: "narascreen help",
    summary: "List commands.",
    flags: [],
    output: "{ commands, docs }",
    heavy: false,
  },
  {
    name: "manual",
    usage: "narascreen manual",
    summary: "Print the full manual as Markdown (same content as the /docs page).",
    flags: [],
    output: "Markdown on stdout (not a JSON envelope).",
    heavy: false,
  },
  {
    name: "docs",
    usage: "narascreen docs --out docs.html",
    summary: "Write the manual as a standalone HTML page.",
    flags: [out("HTML file to write (required).")],
    output: "{ path }",
    heavy: false,
  },
  {
    name: "schema",
    usage: "narascreen schema [--out demo-script.schema.json]",
    summary: "Print the demo-script JSON Schema.",
    flags: [out("Write the schema to this file instead of stdout.")],
    output: "Raw JSON Schema on stdout (not an envelope), or { path } with --out.",
    heavy: false,
  },
  {
    name: "doctor",
    usage: "narascreen doctor [--script my.demo-script.json]",
    summary: "Check that ffmpeg, the browser and the speech engine are ready. Run this first.",
    flags: [{ flag: "--script <file>", name: "script", type: "string", desc: "Also check this script's TTS endpoint." }],
    output: "{ ready, checks: [{ id, ok, required, detail, fix? }] }",
    heavy: false,
  },
  {
    name: "voices",
    usage: "narascreen voices [--lang hi]",
    summary: "List narration languages and voice ids.",
    flags: [{ flag: "--lang <code>", name: "lang", type: "string", desc: "Only this language." }],
    output: "{ languages: [{ code, label, defaultVoice, voices }] }",
    heavy: false,
  },
  {
    name: "init",
    usage: "narascreen init --url https://app.example.com [--out my.demo-script.json] [--name my-demo]",
    summary: "Write a small valid starter script to edit.",
    flags: [
      { flag: "--url <url>", name: "url", type: "string", desc: "Site to record (required)." },
      out("Script file to write (default ./<name>.demo-script.json)."),
      { flag: "--name <name>", name: "name", type: "string", desc: "Demo name / scope (default: from the URL host)." },
      { flag: "--force", name: "force", type: "boolean", desc: "Overwrite an existing file." },
    ],
    output: "{ scriptPath }",
    heavy: false,
  },
  {
    name: "inspect",
    usage: "narascreen inspect --url https://app.example.com/page | --script my.demo-script.json [--until <step-id>]",
    summary: "Open a page and list its elements with ready-to-paste selectors, plus a screenshot.",
    flags: [
      { flag: "--url <url>", name: "url", type: "string", desc: "Page to open (absolute, or a path when --script gives baseUrl)." },
      { flag: "--script <file>", name: "script", type: "string", desc: "Use this script's baseUrl/viewport/session and run its setup first." },
      { flag: "--until <step-id>", name: "until", type: "string", desc: "With --script: also run the steps up to and including this one, then inspect." },
      { flag: "--viewport <WxH>", name: "viewport", type: "string", desc: "Browser size, e.g. 1440x900." },
      { flag: "--storage-state <file>", name: "storage-state", type: "string", desc: "Start logged in with this Playwright storageState." },
      { flag: "--full-page", name: "full-page", type: "boolean", desc: "Also save a full-page screenshot." },
      { flag: "--plugin <name>", name: "plugin", type: "string", desc: "Recording plugin to inspect with, e.g. flutter (a Flutter web build as a phone, with its accessibility tree switched on). A --script's own plugins are used otherwise." },
      { flag: "--device <name>", name: "device", type: "string", desc: "With --plugin flutter: the phone to emulate (pixel-7 | pixel-9-pro | galaxy-s24 | small-phone; default pixel-7)." },
      out("Folder for screenshots and the accessibility tree (default ./narascreen-out/inspect/<time>)."),
      headed,
    ],
    output: "{ url, title, screenshot, headings, elements: [{ role, name, selector, matches, visible, rect, inputType? }], ariaSnapshotPath } — file inputs are listed even when hidden, with inputType \"file\"",
    heavy: true,
  },
  {
    name: "validate",
    usage: "narascreen validate my.demo-script.json",
    summary: "Check a script against the schema and rules without opening a browser.",
    arg: { name: "script", desc: "The demo-script file.", required: true },
    flags: [],
    output: "{ valid, scriptPath, summary: { steps, effects, narrations, estimatedVideoSec, … } }",
    heavy: false,
  },
  {
    name: "check",
    usage: "narascreen check my.demo-script.json [--headed]",
    summary: "Dry-run every browser step (no recording) to prove all selectors work.",
    arg: { name: "script", desc: "The demo-script file.", required: true },
    flags: [
      out("Folder for failure screenshots (default ./narascreen-out/<script-name>)."),
      headed,
      { flag: "--hold", name: "hold", type: "boolean", desc: "With --headed: keep the browser open at the end until Enter is pressed." },
    ],
    output: "{ slots, durationSec }",
    heavy: true,
  },
  {
    name: "record",
    usage: "narascreen record my.demo-script.json --out ./jobs/my-demo [--force]",
    summary: "Run the steps in a real browser and record the screen into a job folder (video-source scripts: import the video instead).",
    arg: { name: "script", desc: "The demo-script file.", required: true },
    flags: [out("Job folder (default ./narascreen-out/<script-name>)."), headed, force],
    output: "{ job, recording, durationSec, slots }",
    heavy: true,
  },
  {
    name: "produce",
    usage: "narascreen produce ./jobs/my-demo [--script my.demo-script.json] [--lang en,hi]",
    summary: "Generate narration and render the final video(s) from a recorded job. Re-run after text edits — no re-record needed.",
    arg: { name: "job", desc: "The job folder from record/make.", required: true },
    flags: [
      { flag: "--script <file>", name: "script", type: "string", desc: "Script to use (default: the file the job was recorded from, re-read fresh)." },
      lang,
      resolution,
      quality,
    ],
    output: "{ job, videos: [{ lang, path, durationSec, narrations, timings, preview }] }",
    heavy: true,
  },
  {
    name: "make",
    usage: "narascreen make my.demo-script.json --out ./jobs/my-demo [--lang en,hi]",
    summary: "validate → record → produce → preview in one go. Reuses the recording when only text changed.",
    arg: { name: "script", desc: "The demo-script file.", required: true },
    flags: [
      out("Job folder (default ./narascreen-out/<script-name>)."),
      lang,
      resolution,
      quality,
      headed,
      { ...force, desc: "Always re-record, even if the recording could be reused." },
    ],
    output: "{ job, recorded, videos: [{ lang, path, durationSec, narrations, timings, preview }] }",
    heavy: true,
  },
  {
    name: "preview",
    usage: "narascreen preview ./jobs/my-demo [--lang en] [--tiles 12]",
    summary: "Extract frames + a contact sheet from a produced video (or, with --raw, the recording/imported source) so you can check it visually.",
    arg: { name: "job", desc: "The job folder.", required: true },
    flags: [
      { flag: "--lang <code>", name: "lang", type: "string", desc: "Which video (default: first produced)." },
      { flag: "--tiles <n>", name: "tiles", type: "string", desc: "Number of frames (default 12, max 48)." },
      { flag: "--raw", name: "raw", type: "boolean", desc: "Preview the raw recording instead of a produced video — use it to pick `at` times and `rect`s for video-source scripts." },
    ],
    output: "{ video, durationSec, contactSheet, frames: [{ t, path }] }",
    heavy: true,
  },
  {
    name: "status",
    usage: "narascreen status ./jobs/my-demo",
    summary: "Show what a job has recorded/produced and the next command to run.",
    arg: { name: "job", desc: "The job folder.", required: true },
    flags: [],
    output: "{ job, scope, record, produce, artifacts }",
    heavy: false,
  },
  {
    name: "serve",
    usage: "narascreen serve [--port 4790] [--host 127.0.0.1] [--token <secret>] [--workspace ./narascreen-out] [--keep-cache]",
    summary: "Start the local HTTP server: docs at /docs, runs at /v1/runs, live events over SSE.",
    flags: [
      { flag: "--port <n>", name: "port", type: "string", desc: "Port (default 4790)." },
      { flag: "--host <addr>", name: "host", type: "string", desc: "Bind address (default 127.0.0.1 — local only)." },
      { flag: "--token <secret>", name: "token", type: "string", desc: "Require `Authorization: Bearer <secret>` on /v1 (or set NARASCREEN_TOKEN)." },
      { flag: "--workspace <dir>", name: "workspace", type: "string", desc: "Where scripts and jobs submitted over HTTP are stored (default ./narascreen-out)." },
      { flag: "--concurrency <n>", name: "concurrency", type: "string", desc: "Heavy runs executed at once (default 1)." },
      {
        flag: "--keep-cache",
        name: "keep-cache",
        type: "boolean",
        desc: "Don't clean the workspace cache on start. By default every start deletes run history (runs/), inspect screenshots (inspect/) and each job's narration audio and preview frames; scripts, uploads, recordings and final videos are kept.",
      },
    ],
    output: "Prints one envelope { url, docs, cleaned } when listening, then keeps running.",
    heavy: false,
  },
];

/** Flags accepted by every command. */
export const GLOBAL_FLAGS: FlagDoc[] = [
  { flag: "--events <text|json>", name: "events", type: "string", desc: "Progress on stderr as text lines (default) or one JSON event per line." },
  { flag: "--quiet", name: "quiet", type: "boolean", desc: "No progress output (text mode)." },
  { flag: "--help", name: "help", type: "boolean", desc: "Same as `narascreen help`." },
  { flag: "--version", name: "version", type: "boolean", desc: "Print the version." },
];

export function findCommand(name: string): CommandDoc | undefined {
  return COMMANDS.find((c) => c.name === name);
}
