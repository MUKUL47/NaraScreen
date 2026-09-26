// ─── docs: the manual, as Markdown and as one standalone HTML page ────
//
// buildManualMarkdown() = api/MANUAL.md (the hand-written guide) + a reference
// appendix GENERATED at call time from the code that defines the behavior:
//   HTTP routes (server.ts ROUTES) · CLI commands (commands.ts) · the script
//   schema (schema.ts zod → JSON Schema descriptions) · error codes (errors.ts)
//   · voices (src/lib/voices.ts) · envelope + event formats (output.ts).
// Nothing in the appendix is copied by hand, so the docs cannot drift from the
// code. renderDocsHtml() turns that Markdown into a single self-contained page:
// no external requests, fully readable without JS, light + dark.
//
// server.ts imports this module and this module needs server.ts's route table,
// so server.ts is required lazily (inside functions) to keep module loading
// order-independent.

import * as fs from "fs";
import * as path from "path";
import { Marked } from "marked";
import { z } from "zod";
import { COMMANDS, GLOBAL_FLAGS, type CommandDoc } from "./commands";
import { ERROR_HELP, exitCodeFor, type ErrorCode } from "./errors";
import type { Envelope, NaraEvent, Stage } from "./output";
import {
  ActEntrySchema,
  BeatSchema,
  BUILTIN_DEFAULTS,
  FxEntrySchema,
  RECT_FX,
  SELECTOR_KEYS,
  SelectorSchema,
  TARGETED_ACTS,
  demoScriptJsonSchema,
} from "./schema";
import { DEFAULT_VOICES, LANG_CODES, LANG_LABELS } from "../src/lib/voices";

type ServerModule = typeof import("./server");
const server = (): ServerModule => require("./server") as ServerModule;

const MANUAL_PATH = path.join(__dirname, "MANUAL.md");
const ASSETS_DIR = path.join(__dirname, "docs-assets");

/** The origin MANUAL.md uses in its examples; rewritten to the live server URL. */
function defaultBaseUrl(): string {
  const s = server();
  return `http://${s.DEFAULT_HOST}:${s.DEFAULT_PORT}`;
}

// ─── Markdown ─────────────────────────────────────────────────────────

export interface ManualOptions {
  /** URL of the running server. Example URLs in the manual are rewritten to it. */
  baseUrl?: string;
}

export function buildManualMarkdown(opts: ManualOptions = {}): string {
  const fallback = defaultBaseUrl();
  const base = (opts.baseUrl ?? fallback).replace(/\/+$/, "");
  let manual = readManual();
  if (base !== fallback) manual = manual.split(fallback).join(base);
  return `${manual.trimEnd()}\n\n${referenceMarkdown(base)}`;
}

function readManual(): string {
  try {
    return fs.readFileSync(MANUAL_PATH, "utf-8");
  } catch {
    return "# NaraScreen manual\n\n_api/MANUAL.md is missing — only the generated reference is available._\n";
  }
}

/** Short orientation for agents that only know the server URL (GET /llms.txt). */
export function buildLlmsTxt(baseUrl: string): string {
  const b = baseUrl.replace(/\/+$/, "");
  return [
    "# NaraScreen",
    "",
    "> Local service that turns a JSON demo script (browser steps + video effects + narration) into a",
    "> narrated MP4 walkthrough of any website. You write the script; NaraScreen records, narrates and renders.",
    "",
    `Full manual (Markdown, everything you need): ${b}/docs.md`,
    `Same manual as HTML: ${b}/docs`,
    `Demo-script JSON Schema: ${b}/v1/schema`,
    "",
    "## Quick start",
    "",
    `1. GET  ${b}/v1/doctor — machine ready? (ffmpeg, browser, speech engine)`,
    `2. POST ${b}/v1/runs {"command":"inspect","options":{"url":"<page>"}} — elements with ready-to-paste selectors`,
    `3. POST ${b}/v1/scripts {"name":"my-demo","script":{…}} — validates + saves; fix error.details.issues`,
    `4. POST ${b}/v1/runs {"command":"make","scriptPath":"<scriptPath>"} — then GET ${b}/v1/runs/<runId>?wait=300`,
    `   or stream GET ${b}/v1/runs/<runId>/events (SSE, ends with "end")`,
    `5. GET  ${b}/v1/files?path=<outcome.result.videos[0].path> — the video (preview.contactSheet = frames to check)`,
    "",
    `Own files (voiceover, music, a video to edit, a file the demo uploads into the site — any type): PUT ${b}/v1/files?path=uploads/<name>`,
    `with the raw bytes, then use result.relativePath in the script, e.g. {"act":"upload","role":"button","name":"Choose file","files":"uploads/<name>"}.`,
    "Note: check and inspect --until perform the script's actions for real (saves, uploads persist) — reset the site's data before make.",
    "",
    "Effects you can put in a script: narrate (voiceover), zoom, spotlight (optional padding, soft-edge feather, and converge: animated close-in from the whole screen), arrow (animated pointer, page stays bright; optional color, and highlight: a pencil loop around the element once it lands, optional highlightColor), callout (text label),",
    "blur (hide secrets), pause, speed, skip, mute. Field-by-field reference: /docs.md (generated from the schema).",
    "Title / end cards: \"intro\" and \"outro\" (template clean|bold|minimal, title, subtitle, cta, logo, narrate) are drawn and joined around the video. Plan first: an optional \"plan\" (audience, takeaway, hook, leaveOut, targetSec) makes validate warn when the script drifts.",
    "Flutter apps: add \"plugins\": {\"flutter\": {}} to record the app's web build as an Android phone (portrait video, taps, `swipe` act) — see \"Flutter apps\" in /docs.md.",
    "",
    "Every /v1 response is a JSON envelope { ok, command, result | error: { code, message, hint }, warnings, next }.",
    "If the server was started with a token, send `Authorization: Bearer <token>` on every /v1 request.",
    "",
  ].join("\n");
}

// ─── generated reference ─────────────────────────────────────────────

function referenceMarkdown(base: string): string {
  return [
    "---",
    "",
    "<!-- Everything below is generated from the NaraScreen source code on every request. -->",
    "",
    ...httpReference(base),
    ...cliReference(),
    ...scriptReference(),
    ...errorReference(),
    ...voicesReference(),
    ...formatsReference(),
  ].join("\n");
}

const GENERATED = "_Generated from the source code — always matches this version._";

/** Escape a value for a Markdown table cell. */
function cell(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\n+/g, " ");
}
const code = (s: string) => "`" + s + "`";
/** Code span that is safe inside a table cell (pipes escaped, backticks avoided). */
const cellCode = (s: string) => code(s.replace(/\|/g, "\\|"));

function table(head: string[], rows: string[][]): string[] {
  return [
    `| ${head.join(" | ")} |`,
    `|${head.map(() => "---").join("|")}|`,
    ...rows.map((r) => `| ${r.join(" | ")} |`),
    "",
  ];
}

// ── HTTP ──

function httpReference(base: string): string[] {
  const s = server();
  const routeRows = s.ROUTES.map((r) => [cellCode(`${r.method} ${r.path}`), cell(r.summary)]);
  const out: string[] = [
    "## HTTP API reference",
    "",
    GENERATED,
    "",
    `Start the server with \`narascreen serve\` (default address \`${defaultBaseUrl()}\`).${base !== defaultBaseUrl() ? ` This server: \`${base}\`.` : ""}`,
    "Request bodies are JSON. Every `/v1` response except `/v1/schema` and `/v1/files` is an envelope",
    "(see [Envelope](#envelope)); read the body even when the HTTP status is not 2xx.",
    "",
    ...table(["Route", "What it does"], routeRows),
    "### Endpoints",
    "",
  ];
  for (const r of s.ROUTES) {
    out.push(`#### ${code(`${r.method} ${r.path}`)}`, "", r.summary, "");
    if (r.body) out.push(`- **Body:** ${r.body}`);
    out.push(`- **Response:** ${r.response}`, "");
  }

  out.push(
    "### Authentication and safety",
    "",
    `- Binds to \`${s.DEFAULT_HOST}\` by default: only programs on this machine can connect. Binding any other address requires a token (the server refuses to start without one).`,
    "- Token: when the server is started with `--token <secret>` (or the `NARASCREEN_TOKEN` environment variable), every `/v1/*` request needs `Authorization: Bearer <secret>`; otherwise `401`. `/`, `/docs`, `/docs.md` and `/llms.txt` stay public.",
    "- Requests made by web pages of other sites (an `Origin` header that is not this server, or `Sec-Fetch-Site: cross-site` / `same-site`) are refused with `403`, as are `Host` names other than localhost / an IP address (DNS-rebinding protection). Command-line HTTP clients send neither and are unaffected.",
    "- **Uploading files:** `curl -T clip.mp3 \"$BASE/v1/files?path=uploads/clip.mp3\"` stores it as `<workspace>/uploads/clip.mp3`; use the returned `relativePath` (`uploads/clip.mp3`) in scripts. Any file type is accepted (voiceovers, music, a video to edit, a saved login, or a spreadsheet/PDF/… for an `upload` act). Downloading an upload back returns audio/video/images inline and everything else as an attachment (`application/octet-stream`), so an uploaded HTML/SVG file is never rendered by the server.",
    "- **How relative file paths in scripts resolve:** in a script sent inline (`script` in `/v1/validate`, `/v1/scripts`, `/v1/runs`) they resolve against the **workspace** (so `uploads/clip.mp3` works) and are saved as absolute paths; in a script *file* (`scriptPath`) they resolve against that file's folder, as on the CLI.",
    "- **Secrets for `${env:NAME}`:** add `\"env\": {\"DEMO_PASSWORD\": \"…\"}` to `POST /v1/runs` (or `/v1/validate`, `/v1/scripts` to check). The values are used only to fill `${env:NAME}` placeholders for that request/run: they are never written to `runs/*.json`, scripts or logs, and values of 4+ characters are replaced by `***` wherever they would appear in events or envelopes. Names must match `^[A-Z_][A-Z0-9_]*$`; process settings (PATH, HOME, NODE_*, NARASCREEN_*, LD_*, proxies, …) are refused. Keep placeholders in the script (`\"value\": \"${env:DEMO_PASSWORD}\"`), not the secret itself.",
    "- **Everything lives in the workspace.** Over HTTP, `scriptPath`, `job`, `options.out`, `options.storage-state` and every file a script references (`storageState`, `audio`, `music.path`, `source.video`, `upload` act `files`) must resolve inside the workspace (symlinks followed) — otherwise `400`. Scripts may only use `http(s)` URLs.",
    `- Limits: JSON bodies ≤ ${Math.round(s.MAX_BODY_BYTES / 1024 / 1024)} MB (\`413\`); at most ${s.LIGHT_CONCURRENCY} light runs / doctor checks at once (the rest wait); at most ${s.MAX_QUEUED_RUNS} waiting runs (\`429\` beyond); ${s.MAX_RUN_EVENTS.toLocaleString("en")} events per run.`,
    "- **Every server start cleans the workspace cache:** run history (`runs/` — earlier runIds are gone), `inspect/` screenshots, and each job's narration audio and preview frames. Scripts, uploads, recordings and final videos stay, so `produce`/`make` on an existing job still skips the re-record (narration is generated again). Start with `--keep-cache` to keep everything.",
    "- `/v1/files` only serves files whose real location (symlinks followed) is inside the workspace; anything else is `403`, even through `..` or symlinks.",
    "- Runs execute the `narascreen` CLI as child processes. Cancelling a run, or stopping the server, stops its whole process tree (browser and ffmpeg included).",
    "",
    "### HTTP status codes",
    "",
    ...table(
      ["Status", "Meaning"],
      [
        ["`200`", "OK — the envelope has `ok: true` (or, for `/v1/doctor`, a readiness report)."],
        ["`202`", "Run accepted (`POST /v1/runs`). Follow it with the links in the result."],
        ["`204`", "Event stream already fully delivered (reconnect with `Last-Event-ID` after `end`)."],
        ["`206`", "Partial file content (HTTP `Range` request on `/v1/files`)."],
        ["`302`", "`/` redirects to `/docs`."],
        ["`400`", "The request needs fixing: `USAGE` (bad JSON, unknown command/option) or a script problem such as `SCRIPT_INVALID`."],
        ["`401`", "Missing or wrong bearer token."],
        ["`403`", "File outside the workspace (`/v1/files`), or a request from another web site / unexpected `Host`."],
        ["`404`", "Unknown route or run id, or a file/script/job that does not exist."],
        ["`405`", "Known path, wrong method."],
        ["`413`", "Body larger than the limit."],
        ["`416`", "`Range` outside the file."],
        ["`429`", "Too many runs waiting — let some finish or cancel them, then retry."],
        ["`500`", "NaraScreen bug or unexpected tool failure (`INTERNAL`, exit class 4)."],
        ["`503`", "The machine is not ready (`doctor` failed: exit class 2 codes)."],
      ],
    ),
    "Runs report their own outcome inside the run (`status` + `outcome`); the HTTP status of `GET /v1/runs/:id` is `200` whether the run succeeded or failed.",
    "",
    ...runCommandsReference(),
    ...followingRunsReference(),
  );
  return out;
}

function runCommandsReference(): string[] {
  const s = server();
  const rows = s.RUN_COMMANDS.map((name) => {
    const c = COMMANDS.find((x) => x.name === name) as CommandDoc;
    const input: string[] = [];
    if (c.arg?.name === "script") input.push("`script` or `scriptPath` (required)");
    if (c.flags.some((f) => f.name === "script")) input.push("`script` or `scriptPath` (optional, = `--script`)");
    if (c.arg?.name === "job") input.push("`job` (default: from the script's `scope`)");
    if (["record", "make", "check"].includes(name)) input.push("`job` (optional, = `--out`)");
    const opts = c.flags
      .filter((f) => f.name !== "script" && !s.BLOCKED_RUN_OPTIONS.includes(f.name))
      .map((f) => `${code(f.name)}${f.type === "boolean" ? " (bool)" : ""}`);
    return [code(name), cell(input.join("; ") || "—"), opts.join(", ") || "—", c.heavy ? "heavy queue" : "light (≤ " + s.LIGHT_CONCURRENCY + " at once)"];
  });
  return [
    "### Running commands (`POST /v1/runs`)",
    "",
    "`command` is one of the CLI commands below. `options` uses the command's CLI flag names without",
    "dashes (`{\"lang\": \"en,hi\", \"force\": true, \"until\": \"open-tasks\"}`); boolean flags take `true`/`false`,",
    "the others strings (numbers are accepted). An inline `script` is saved as",
    "`<workspace>/scripts/run-<runId>.demo-script.json`; relative file paths inside it (e.g. `storageState`) and",
    "relative `scriptPath`/`out` values resolve against the workspace, and all of them must stay inside it. `job` is a",
    "name (→ `<workspace>/jobs/<name>`) or a path inside the workspace; it defaults to `<workspace>/jobs/<script scope>`.",
    "Scripts are validated before the run is accepted, so an invalid script fails fast with `400 SCRIPT_INVALID`.",
    `Heavy commands wait in a first-in-first-out queue (\`--concurrency\`, default 1); light ones run up to ${s.LIGHT_CONCURRENCY} at once.`,
    `Not available over HTTP: ${s.BLOCKED_RUN_OPTIONS.map((o) => code(o)).join(", ")} (needs a keyboard).`,
    "",
    ...table(["command", "Input fields", "`options` keys", "Starts"], rows),
  ];
}

function followingRunsReference(): string[] {
  const s = server();
  return [
    "### Following a run",
    "",
    "Status: `queued` → `running` → `succeeded` | `failed` | `cancelled`. When a run ends, `GET /v1/runs/<runId>`",
    "adds `ok` and `output` — the command's result (e.g. `output.videos[0].path`) or, when `ok` is false, its error",
    "(`output.code`, `output.hint`) — plus `outcome`, the complete envelope the CLI printed (with its `warnings`/`next`).",
    "",
    `- **Long-poll:** \`GET /v1/runs/<runId>?wait=<seconds>\` (max ${s.MAX_WAIT_SEC}) answers as soon as the run ends, or after the wait with the current status. Repeat until \`status\` is final.`,
    "- **Server-Sent Events:** `GET /v1/runs/<runId>/events`. Replays every past event, then streams live ones, then sends",
    "  `event: end` whose `data` is the final envelope, and closes. Each event has `id: <seq>`; reconnect with",
    "  `Last-Event-ID: <seq>` (or `?after=<seq>`) to resume without duplicates. The SSE `event:` name is the event",
    `  \`type\` (\`stage\`, \`step\`, \`log\`, \`warning\`, \`end\`) — listen for each by name. A \`: ping\` comment is sent every ${s.HEARTBEAT_SEC} s.`,
    "- **NDJSON:** `GET /v1/runs/<runId>/events?format=ndjson` — the same stream as one JSON object per line; the last",
    "  line is `{\"type\":\"end\",\"seq\":…,\"status\":…,\"outcome\":{…}}`. Empty lines are keep-alives; skip them.",
    "- **Cancel:** `POST /v1/runs/<runId>/cancel` stops the run (SIGTERM, then SIGKILL after 5 s) and returns it with `status: \"cancelled\"`.",
    "- Runs are kept in `<workspace>/runs/<runId>.json` and `<runId>.events.ndjson` (the complete event history), and survive a server restart.",
    "",
    "```bash",
    "curl -N $BASE/v1/runs/<runId>/events            # live progress (SSE)",
    "curl -s \"$BASE/v1/runs/<runId>?wait=300\"        # or block until it finishes",
    "```",
    "",
  ];
}

// ── CLI ──

function cliReference(): string[] {
  const out: string[] = [
    "## CLI reference",
    "",
    GENERATED,
    "",
    "Every command prints exactly one JSON [envelope](#envelope) on stdout (except `manual` and `schema`),",
    "progress [events](#events) on stderr, and exits with the code of its error class ([exit codes](#exit-codes)).",
    "",
    "### Global flags",
    "",
    ...table(["Flag", "Description"], GLOBAL_FLAGS.map((f) => [cellCode(f.flag), cell(f.desc)])),
    "### Commands",
    "",
    ...table(["Command", "Summary"], COMMANDS.map((c) => [code(c.name), cell(c.summary)])),
  ];
  for (const c of COMMANDS) {
    out.push(`#### ${code(`narascreen ${c.name}`)}`, "", c.summary, "", "```bash", c.usage, "```", "");
    if (c.arg) out.push(`- **Argument** \`<${c.arg.name}>\`${c.arg.required ? " (required)" : ""}: ${c.arg.desc}`);
    out.push(`- **Result:** ${/^\{.*\}$/.test(c.output) ? code(c.output) : c.output}`);
    if (c.heavy) out.push("- Opens a browser or renders video (queued by the HTTP server).");
    out.push("");
    if (c.flags.length) out.push(...table(["Flag", "Description"], c.flags.map((f) => [cellCode(f.flag), cell(f.desc)])));
  }
  return out;
}

// ── script ──

interface JsonSchema {
  type?: string;
  const?: unknown;
  enum?: unknown[];
  oneOf?: JsonSchema[];
  anyOf?: JsonSchema[];
  items?: JsonSchema | boolean;
  prefixItems?: JsonSchema[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean | JsonSchema;
  propertyNames?: JsonSchema;
  description?: string;
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  format?: string;
  default?: unknown;
}

const jsonSchemaOf = (s: z.ZodType): JsonSchema => z.toJSONSchema(s, { io: "input" }) as JsonSchema;

const LINK = {
  selector: "[Selector](#selector-fields)",
  scope: "[Scope](#within-scope-fields)",
  act: "[act](#browser-actions-act)",
  fx: "[fx](#video-effects-fx)",
  step: "[step](#steps)",
  langs: "[language](#voices)",
};

/** field name → Markdown link to that field's own table (top-level objects like `defaults`). */
type Links = Record<string, string>;

const itemsOf = (s: JsonSchema): JsonSchema => (typeof s.items === "object" ? s.items : {});
const isSelector = (s: JsonSchema) => SELECTOR_KEYS.every((k) => k in (s.properties ?? {}));
const isScope = (s: JsonSchema) => !isSelector(s) && ["css", "text", "role", "name"].every((k) => k in (s.properties ?? {}));

/** The object schema behind a field (or its array items) when it deserves its own field table. */
function ownTable(s: JsonSchema | undefined): JsonSchema | undefined {
  if (!s) return undefined;
  if (s.type === "array") return ownTable(itemsOf(s));
  if (s.type !== "object" || !s.properties || isSelector(s) || isScope(s)) return undefined;
  return Object.values(s.properties).some((p) => p.description) ? s : undefined;
}

/** Human type of a JSON Schema node, as Markdown safe for a table cell. */
function typeOf(s: JsonSchema, field = "", links: Links = {}): string {
  if (s.const !== undefined) return cellCode(JSON.stringify(s.const));
  if (s.enum) {
    if (isLanguageEnum(s.enum)) return LINK.langs;
    return s.enum.map((v) => cellCode(JSON.stringify(v))).join(" \\| ");
  }
  const alts = s.oneOf ?? s.anyOf;
  if (alts) return alts.map((a) => typeOf(a, field, links)).join(" \\| ");
  switch (s.type) {
    case "string":
      return s.format === "uri" ? "URL" : "string";
    case "integer":
    case "number":
      return numberType(s);
    case "boolean":
      return "boolean";
    case "array":
      return arrayType(s, field, links);
    case "object":
      return objectType(s, field, links);
    default:
      return "any";
  }
}

function numberType(s: JsonSchema): string {
  const base = s.type === "integer" ? "integer" : "number";
  const hi = s.maximum !== undefined && s.maximum < 1e12 ? s.maximum : undefined;
  // Non-breaking spaces keep "integer > 0" on one line in narrow table columns.
  const nb = "\u00a0";
  if (s.minimum !== undefined && hi !== undefined) return `${base}${nb}${s.minimum}–${hi}`;
  const parts: string[] = [];
  if (s.minimum !== undefined) parts.push(`≥${nb}${s.minimum}`);
  if (s.exclusiveMinimum !== undefined) parts.push(`>${nb}${s.exclusiveMinimum}`);
  if (hi !== undefined) parts.push(`≤${nb}${hi}`);
  return parts.length ? `${base}${nb}${parts.join(", ")}` : base;
}

function arrayType(s: JsonSchema, field: string, links: Links): string {
  if (s.prefixItems) {
    // Tuples such as rect [x, y, width, height]: "number[4]".
    const kinds = [...new Set(s.prefixItems.map((p) => p.type ?? "any"))];
    return kinds.length === 1 ? `${kinds[0]}[${s.prefixItems.length}]` : `[${s.prefixItems.map((p) => typeOf(p)).join(", ")}]`;
  }
  const items = itemsOf(s);
  const alts = items.oneOf ?? items.anyOf;
  if (alts) {
    const flat = alts.flatMap((a) => a.oneOf ?? a.anyOf ?? [a]);
    const hasAct = flat.some((a) => a.properties?.act);
    const hasFx = flat.some((a) => a.properties?.fx);
    if (hasAct && hasFx) return `(${LINK.act} \\| ${LINK.fx})[]`;
    if (hasAct) return `${LINK.act}[]`;
  }
  if (items.properties?.beat) return `${LINK.step}[]`;
  const inner = typeOf(items, field, links);
  return /\s/.test(inner) && !inner.startsWith("[") ? `(${inner})[]` : `${inner}[]`;
}

function objectType(s: JsonSchema, field: string, links: Links): string {
  if (isSelector(s)) return LINK.selector;
  if (isScope(s)) return LINK.scope;
  if (links[field]) return links[field];
  if (s.propertyNames || typeof s.additionalProperties === "object") {
    const key = s.propertyNames?.enum && isLanguageEnum(s.propertyNames.enum) ? LINK.langs : "string";
    const val = typeof s.additionalProperties === "object" ? typeOf(s.additionalProperties) : "any";
    return `map\u00a0${key}\u00a0→\u00a0${val}`;
  }
  if (ownTable(s)) return "object";
  const keys = Object.keys(s.properties ?? {});
  return keys.length ? cellCode(`{ ${keys.join(", ")} }`) : "object";
}

function isLanguageEnum(values: unknown[]): boolean {
  const langs = Object.keys(LANG_CODES);
  return values.length === langs.length && values.every((v) => langs.includes(String(v)));
}

interface RowOptions {
  skip?: string[];
  /** Override the Required column (rules validate.ts enforces beyond the schema). */
  required?: Record<string, string>;
  /** Adds a Default column. */
  defaults?: Record<string, unknown>;
  desc?: Record<string, string>;
  links?: Links;
}

/** One table row per property of an object schema. */
function fieldRows(s: JsonSchema, opts: RowOptions = {}): string[][] {
  const required = new Set(s.required ?? []);
  const links = opts.links ?? {};
  return Object.entries(s.properties ?? {})
    .filter(([k]) => !(opts.skip ?? []).includes(k))
    .map(([k, p]) => {
      const req = opts.required?.[k] ?? (required.has(k) ? "yes" : "");
      const row = [code(k), typeOf(p, k, links), cell(req)];
      if (opts.defaults) row.push(k in opts.defaults ? cellCode(JSON.stringify(opts.defaults[k])) : "");
      const desc = opts.desc?.[k] ?? p.description ?? itemsOf(p).description ?? (links[k] ? `See ${links[k]}.` : "");
      row.push(cell(desc));
      return row;
    });
}

/** Field tables for object-valued properties (e.g. zoom `targets`), right under a verb's table. */
function nestedTables(s: JsonSchema, skip: string[]): string[] {
  const out: string[] = [];
  for (const [k, p] of Object.entries(s.properties ?? {})) {
    const obj = skip.includes(k) ? undefined : ownTable(p);
    if (!obj) continue;
    out.push(`Each ${code(k)}${p.type === "array" ? " item" : ""}:`, "", ...table(FIELD_HEAD, fieldRows(obj)));
  }
  return out;
}

// Requirements validate.ts enforces beyond the zod shape (see checkAct / checkSelector
// there). Shown in the Required column so each verb table tells the whole truth.
const EXTRA_REQUIRED: Record<string, Record<string, string>> = {
  goto: { path: "one of path / url", url: "one of path / url" },
  fill: { value: "yes" },
  scroll: { selector: "selector or y", y: "selector or y" },
};

const FIELD_HEAD = ["Field", "Type", "Required", "Description"];
/** Built-in values shown in a Default column for these top-level objects. */
const SECTION_DEFAULTS: Record<string, Record<string, unknown>> = { defaults: { ...BUILTIN_DEFAULTS } };

function scriptReference(): string[] {
  const top = demoScriptJsonSchema() as JsonSchema;
  const selector = jsonSchemaOf(SelectorSchema);
  const scope = selector.properties?.within ?? {};
  // Top-level objects with documented fields (defaults, tts, …) get their own table.
  const sections = Object.entries(top.properties ?? {}).filter(([, p]) => p.type === "object" && ownTable(p));
  const links: Links = Object.fromEntries(sections.map(([k]) => [k, `[object](#${slugify(`${k} fields`)})`]));

  const out: string[] = [
    "## Script reference",
    "",
    `${GENERATED} The machine-readable version is the JSON Schema (\`GET /v1/schema\`, \`narascreen schema\`).`,
    "",
    "### Top-level fields",
    "",
    ...table(FIELD_HEAD, fieldRows(top, { links, desc: { $schema: "Optional. Lets JSON editors fetch the schema; ignored by NaraScreen." } })),
    "### Steps",
    "",
    "Each entry of `steps`:",
    "",
    ...table(FIELD_HEAD, fieldRows(jsonSchemaOf(BeatSchema))),
    "### Selector fields",
    "",
    "Targeted acts carry these keys directly on the entry; effects put them inside `anchor`.",
    `Use exactly one of ${SELECTOR_KEYS.map(code).join(", ")}.`,
    "",
    ...table(FIELD_HEAD, fieldRows(selector)),
    "### within (scope) fields",
    "",
    ...(scope.description ? [scope.description, ""] : []),
    ...table(FIELD_HEAD, fieldRows(scope)),
    "### Browser actions (act)",
    "",
    "Every entry may also have `note` (a comment NaraScreen ignores). Selector keys are described in",
    "[Selector fields](#selector-fields).",
    "",
  ];
  for (const option of ActEntrySchema.options) out.push(...actSection(jsonSchemaOf(option)));
  out.push(
    "### Video effects (fx)",
    "",
    "An effect happens at the point in the step where it is listed. Every entry may also have `note`.",
    "",
  );
  for (const option of FxEntrySchema.options) out.push(...fxSection(jsonSchemaOf(option)));
  for (const [k, p] of sections) {
    const obj = ownTable(p)!;
    const defaults = SECTION_DEFAULTS[k];
    out.push(
      `### ${code(k)} fields`,
      "",
      `${p.description ? `${p.description} ` : ""}Set as \`${k}\` at the top level of the script.`,
      "",
      ...(defaults
        ? table(["Field", "Type", "Required", "Default", "Description"], fieldRows(obj, { defaults }))
        : table(FIELD_HEAD, fieldRows(obj))),
    );
  }
  return out;
}

function actSection(s: JsonSchema): string[] {
  const verb = String(s.properties?.act?.const);
  const hasSelector = isSelector(s);
  const extra = EXTRA_REQUIRED[verb] ?? {};
  const rows: string[][] = [];
  if (hasSelector) {
    const req = TARGETED_ACTS.some((v) => v === verb) ? "yes" : (extra.selector ?? "optional");
    rows.push([
      "_selector_",
      LINK.selector,
      cell(req),
      cell(`One of ${SELECTOR_KEYS.join(" / ")} (+ name, within, exact, nth) on the entry itself.`),
    ]);
  }
  const skip = ["act", "note", ...(hasSelector ? Object.keys(SelectorSchema.shape) : [])];
  rows.push(...fieldRows(s, { skip, required: extra }));
  return [`#### act: ${verb}`, "", s.description ?? "", "", ...table(FIELD_HEAD, rows), ...nestedTables(s, skip)];
}

function fxSection(s: JsonSchema): string[] {
  const verb = String(s.properties?.fx?.const);
  const needsElement = RECT_FX.some((v) => v === verb);
  const skip = ["fx", "note"];
  const rows = fieldRows(s, {
    skip,
    desc: { anchor: "Element to target. Leave it out to reuse the element of the previous act/fx in this step." },
  });
  const intro = needsElement
    ? " Needs an element: `anchor` (or another target field below), or the element of the previous act/fx in this step."
    : "";
  return [`#### fx: ${verb}`, "", `${s.description ?? ""}${intro}`, "", ...table(FIELD_HEAD, rows), ...nestedTables(s, skip)];
}

// ── errors ──

const EXIT_CLASSES: [number, string][] = [
  [0, "Success."],
  [1, "The script or job needs fixing — the agent can fix this itself."],
  [2, "The machine is missing something — run `doctor` and apply its fixes."],
  [3, "The command line / request itself was wrong (`USAGE`)."],
  [4, "NaraScreen bug or unexpected tool failure."],
];

function errorReference(): string[] {
  const s = server();
  const codes = Object.keys(ERROR_HELP) as ErrorCode[];
  const rows = codes.map((c) => [code(c), String(exitCodeFor(c)), String(s.httpStatusFor(c)), cell(ERROR_HELP[c])]);
  const classRows = EXIT_CLASSES.map(([n, what]) => {
    const members = codes.filter((c) => exitCodeFor(c) === n).map(code).join(", ");
    return [String(n), cell(what), members || "—"];
  });
  return [
    "## Error codes",
    "",
    GENERATED,
    "",
    "Branch on `error.code`, never on the message. `error.hint` says what to do; `error.where` points into the",
    "script (`{ step, entry, path }`); `error.details` has specifics (issues, candidates, screenshot…).",
    "",
    "### Codes",
    "",
    ...table(["Code", "Exit", "HTTP", "Meaning / what to do"], rows),
    "### Exit codes",
    "",
    ...table(["Exit", "Meaning", "Codes"], classRows),
  ];
}

// ── voices ──

function voicesReference(): string[] {
  const rows = Object.keys(LANG_CODES).map((lang) => {
    const voices = DEFAULT_VOICES[lang] ?? [];
    return [code(lang), cell(LANG_LABELS[lang] ?? lang), voices[0] ? code(voices[0]) : "—", voices.slice(1).map(code).join(" ")];
  });
  return [
    "## Voices",
    "",
    `${GENERATED} Use the code in \`languages\`, narration maps and \`tts.voices\`; the voice id in \`tts.voices\` or an entry's \`voice\`.`,
    "",
    ...table(["Code", "Language", "Default voice", "Other voices"], rows),
  ];
}

// ── output formats ──

// Compile-time guards: adding a Stage / event type / envelope field in output.ts
// without documenting it here fails `tsc`, so this section cannot silently drift.
const STAGES = ["doctor", "validate", "inspect", "setup", "record", "tts", "compile", "render", "preview"] as const satisfies readonly Stage[];
const EVENT_TYPES = {
  stage: "A pipeline phase started (`stage` names it).",
  step: "A script step started; `data` has `{ index, total, id, label }`.",
  log: "A detail line.",
  warning: "Something worth fixing; the command continues.",
} satisfies Record<NaraEvent["type"], string>;
type MissingStage = Exclude<Stage, (typeof STAGES)[number]>;
const stagesComplete: [MissingStage] extends [never] ? true : false = true;

const ENVELOPE_FIELDS: Record<keyof Envelope, string> = {
  ok: "`true` on success, `false` on failure.",
  command: "The command (or HTTP operation) that produced it.",
  result: "On success: the command's result (see each command's **Result**).",
  error: "On failure: `{ code, message, hint?, where?: { step, entry, path }, details? }`.",
  warnings: "Non-fatal problems worth fixing; the command still succeeded.",
  next: "Suggested next commands, ready to run.",
};
const EVENT_FIELDS: Record<keyof NaraEvent, string> = {
  ts: "ISO timestamp.",
  type: "One of the event types below.",
  stage: "Pipeline stage the event belongs to.",
  message: "Human-readable text.",
  data: "Structured details (optional).",
};

function formatsReference(): string[] {
  void stagesComplete;
  return [
    "## Output formats",
    "",
    GENERATED,
    "",
    "### Envelope",
    "",
    "What every CLI command prints on stdout and every `/v1` endpoint returns.",
    "",
    ...table(["Field", "Description"], Object.entries(ENVELOPE_FIELDS).map(([k, v]) => [code(k), cell(v)])),
    "```json",
    '{ "ok": false, "command": "check",',
    '  "error": { "code": "SELECTOR_NOT_FOUND", "message": "…", "hint": "…",',
    '             "where": { "step": "open-form", "entry": 1, "path": "steps[1].beat[1]" },',
    '             "details": { "candidates": [ … ], "screenshot": "/…/failures/open-form-1.png" } },',
    '  "warnings": [], "next": [] }',
    "```",
    "",
    "### Events",
    "",
    "Progress events: JSON lines on stderr with `--events json`, and the run event stream over HTTP (where each",
    "event also carries `seq`, its position in the stream).",
    "",
    ...table(["Field", "Description"], Object.entries(EVENT_FIELDS).map(([k, v]) => [code(k), cell(v)])),
    ...table(["type", "Meaning"], Object.entries(EVENT_TYPES).map(([k, v]) => [code(k), cell(v)])),
    `Stages: ${STAGES.map(code).join(", ")}.`,
    "",
  ];
}

// ─── HTML ─────────────────────────────────────────────────────────────

interface TocEntry {
  depth: number;
  id: string;
  html: string;
}

export function renderDocsHtml(markdown: string, opts: { baseUrl?: string } = {}): string {
  const toc: TocEntry[] = [];
  const slugs = new Map<string, number>();
  const md = new Marked({
    gfm: true,
    renderer: {
      heading({ tokens, depth }) {
        const inner = this.parser.parseInline(tokens);
        const id = uniqueSlug(decodeEntities(stripTags(inner)), slugs);
        if (depth === 2 || depth === 3) toc.push({ depth, id, html: stripLinks(inner) });
        return `<h${depth} id="${id}">${inner}<a class="anchor" href="#${id}" aria-label="Link to this section">#</a></h${depth}>\n`;
      },
      // Raw HTML in the Markdown is shown as text, never interpreted: schema descriptions
      // mention tags like <select>, and one stray tag must not swallow the page.
      html({ text }) {
        return /^\s*<!--[\s\S]*-->\s*$/.test(text) ? "" : escapeHtml(text);
      },
      code({ text, lang }) {
        const cls = lang ? ` class="language-${escapeHtml(lang.split(/\s/)[0])}"` : "";
        return `<div class="code"><button type="button" class="copy" hidden>Copy</button><pre><code${cls}>${escapeHtml(text)}</code></pre></div>\n`;
      },
    },
  });
  const body = (md.parse(markdown, { async: false }) as string)
    .replace(/<table>/g, '<div class="table-wrap"><table>')
    .replace(/<\/table>/g, "</table></div>");

  const base = opts.baseUrl?.replace(/\/+$/, "");
  const note = base
    ? `Agents: the same content as Markdown is at <a href="${escapeHtml(base)}/docs.md"><code>/docs.md</code></a> — fetch that instead of this page.`
    : "Agents: the same content as Markdown is at <code>/docs.md</code> on <code>narascreen serve</code>, or run <code>narascreen manual</code>.";
  const tocHtml = renderToc(toc);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>NaraScreen docs</title>
<link rel="alternate" type="text/markdown" href="${base ?? ""}/docs.md">
<style>
${asset("docs.css")}
</style>
</head>
<body>
<a class="skip" href="#content">Skip to content</a>
<div class="layout">
<aside class="sidebar">
<a class="brand" href="#top">NaraScreen <span>docs</span></a>
<nav class="toc" aria-label="Contents">${tocHtml}</nav>
</aside>
<main id="content">
<div class="content" id="top">
<p class="agent-note">${note}</p>
<details class="toc-mobile"><summary>Contents</summary><nav class="toc" aria-label="Contents">${tocHtml}</nav></details>
${body}
</div>
</main>
</div>
<script>
${asset("docs.js")}
</script>
</body>
</html>
`;
}

function renderToc(entries: TocEntry[]): string {
  let html = "<ol>";
  let open = false; // an h3 sub-list is open
  entries.forEach((e, i) => {
    const link = `<a href="#${e.id}">${e.html}</a>`;
    if (e.depth === 2) {
      if (open) html += "</ol></li>";
      else if (i > 0) html += "</li>";
      open = false;
      html += `<li>${link}`;
    } else {
      if (!open) html += i === 0 ? "<li><ol>" : "<ol>";
      open = true;
      html += `<li>${link}</li>`;
    }
  });
  if (open) html += "</ol>";
  if (entries.length) html += "</li>";
  return html + "</ol>";
}

const assetCache = new Map<string, string>();
function asset(name: string): string {
  let text = assetCache.get(name);
  if (text === undefined) {
    try {
      text = fs.readFileSync(path.join(ASSETS_DIR, name), "utf-8");
    } catch {
      text = "";
    }
    // Inline <style>/<script> must not contain their own closing tag.
    text = text.replace(/<\/(style|script)/gi, "<\\/$1");
    assetCache.set(name, text);
  }
  return text;
}

// ─── small HTML helpers ──────────────────────────────────────────────

export function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .trim()
      .replace(/[^\p{L}\p{N}\s_-]/gu, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || "section"
  );
}

function uniqueSlug(text: string, seen: Map<string, number>): string {
  const base = slugify(text);
  const n = seen.get(base) ?? 0;
  seen.set(base, n + 1);
  return n === 0 ? base : `${base}-${n}`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, "");
}

/** Keep inline formatting in TOC labels but drop nested links (a link in a link is invalid). */
function stripLinks(html: string): string {
  return html.replace(/<\/?a\b[^>]*>/g, "");
}

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}
