// ─── server: the HTTP face of the CLI (`narascreen serve`) ───────────
//
// Lets an agent that only knows a URL do everything the CLI can:
//   /llms.txt → /docs.md (the manual) → /v1/schema, /v1/validate, /v1/scripts
//   → POST /v1/runs (one CLI command as a background run) → follow it over SSE
//   (/v1/runs/:id/events) or long-poll (?wait=) → download results (/v1/files).
//
// Runs execute the real CLI as a child process with `--events json`, so HTTP
// behaves exactly like the command line (same envelopes, errors and events),
// and a crashing browser or ffmpeg can never take the server down. Every event
// is kept (memory + <workspace>/runs/<id>.events.ndjson) so a late subscriber
// replays the full history before going live. node:http only, no framework.
//
// Safe by default: bound to 127.0.0.1; optional bearer token on /v1; browser
// cross-origin and DNS-rebinding requests refused; /v1/files limited to the
// workspace and folders runs used; JSON bodies ≤ 5 MB; each child runs in its
// own process group so cancel/close stops browser + ffmpeg too.

import { spawn, type ChildProcess } from "child_process";
import * as crypto from "crypto";
import { EventEmitter } from "events";
import * as fs from "fs";
import * as http from "http";
import type { AddressInfo } from "net";
import * as path from "path";
import { findCommand, type CommandDoc } from "./commands";
import { buildLlmsTxt, buildManualMarkdown, renderDocsHtml } from "./docs";
import { AgentError, exitCodeFor, toAgentError, type AgentErrorInit, type ErrorCode } from "./errors";
import { failure, log, success, warn, type Envelope, type NaraEvent } from "./output";
import { demoScriptJsonSchema, type DemoScript } from "./schema";
import { loadScript, scriptSummary, validateScript, type LoadedScript } from "./validate";
import { DEFAULT_VOICES, LANG_CODES, LANG_LABELS } from "../src/lib/voices";

// ─── public constants (also rendered into the docs) ──────────────────

export const DEFAULT_PORT = 4790;
export const DEFAULT_HOST = "127.0.0.1";
export const MAX_BODY_BYTES = 5 * 1024 * 1024;
/** PUT /v1/files: largest upload, streamed to disk. */
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024;
/** File types an agent may upload (media for audio/music/source.video, JSON storage states). */
export const UPLOAD_EXTENSIONS = [".mp3", ".wav", ".m4a", ".ogg", ".aac", ".flac", ".mp4", ".mov", ".mkv", ".webm", ".png", ".jpg", ".jpeg", ".json"];
export const MAX_WAIT_SEC = 300;
export const HEARTBEAT_SEC = 15;
/** SIGTERM → wait this long → SIGKILL. */
export const CANCEL_GRACE_MS = 5000;
/** Commands an HTTP client may run through POST /v1/runs. */
export const RUN_COMMANDS = ["inspect", "check", "record", "produce", "make", "preview", "status", "doctor", "validate"];
/** CLI flags that make no sense without a terminal (`--hold` waits for Enter). */
export const BLOCKED_RUN_OPTIONS = ["hold"];
/** Light runs (validate/status/doctor) executed at once; more wait in their own queue. */
export const LIGHT_CONCURRENCY = 4;
/** Runs waiting in queues; beyond this POST /v1/runs answers 429. */
export const MAX_QUEUED_RUNS = 50;
/** Events kept in memory per active run (all of them stay in the .events.ndjson file). */
export const MAX_MEMORY_EVENTS = 2000;
/** Events persisted per run; after that only stage/step/warning events are kept. */
export const MAX_RUN_EVENTS = 50_000;
/** Run records kept in memory; older finished runs are read back from disk on demand. */
export const MAX_MEMORY_RUNS = 500;

export interface ServerOptions {
  port: number;
  host: string;
  /** Bearer token for /v1 (falls back to NARASCREEN_TOKEN). */
  token?: string;
  /** Where HTTP-submitted scripts, jobs and run logs live. */
  workspace: string;
  /** Heavy runs executed at once. */
  concurrency: number;
  /** Node script executed for each run (default: bin/narascreen). Lets tests inject a fake CLI. */
  cliPath?: string;
}

export interface RouteDoc {
  method: string;
  /** Path pattern (`:id` = parameter); a `?…` suffix only documents query parameters. */
  path: string;
  summary: string;
  body?: string;
  response: string;
}

export const ROUTES: RouteDoc[] = [
  {
    method: "GET",
    path: "/",
    summary: "Browsers (`Accept: text/html`) are redirected to `/docs`; everything else gets the `/llms.txt` orientation.",
    response: "`302` → `/docs`, or `text/plain`",
  },
  { method: "GET", path: "/docs", summary: "The manual as a web page (for humans).", response: "`text/html`" },
  {
    method: "GET",
    path: "/docs.md",
    summary: "The complete manual as Markdown — the best starting point for an agent.",
    response: "`text/markdown`",
  },
  {
    method: "GET",
    path: "/llms.txt",
    summary: "Short plain-text orientation: what this service is, where the manual is, a 5-step quick start.",
    response: "`text/plain`",
  },
  {
    method: "GET",
    path: "/v1/health",
    summary: "Is the server up, and how busy is it?",
    response: "`{ version, uptimeSec, workspace, auth, concurrency, runs: { queued, running } }`",
  },
  {
    method: "GET",
    path: "/v1/schema",
    summary: "The demo-script JSON Schema (same as `narascreen schema`).",
    response: "Raw JSON Schema (not an envelope).",
  },
  {
    method: "GET",
    path: "/v1/voices?lang=<code>",
    summary: "Narration languages and voice ids; `lang` narrows the list to one language.",
    response: "`{ languages: [{ code, label, defaultVoice, voices }] }`",
  },
  {
    method: "GET",
    path: "/v1/doctor?scriptPath=<file>",
    summary: "Checks ffmpeg, the browser and the speech engine (runs `narascreen doctor`; `scriptPath` also checks that script's speech endpoint). Call this first.",
    response: "`{ ready, checks: [{ id, ok, required, detail, fix? }] }`; `503 ENVIRONMENT_NOT_READY` (same details) when something required is missing.",
  },
  {
    method: "POST",
    path: "/v1/validate",
    summary: "Validates a script without opening a browser and reports every problem at once.",
    body: "`{ \"script\": { …demo script… } }` or `{ \"scriptPath\": \"<.json file inside the workspace>\" }`, plus optional `\"env\": { \"NAME\": \"value\" }` for `${env:NAME}` placeholders",
    response: "`{ valid: true, scriptPath?, summary }` + `warnings`; `400 SCRIPT_INVALID` with `error.details.issues: [{ path, message, hint? }]`.",
  },
  {
    method: "POST",
    path: "/v1/scripts",
    summary: "Validates a script and saves it as `<workspace>/scripts/<name>.demo-script.json` (replacing any previous version). Pass the returned `scriptPath` to runs.",
    body: "`{ \"name\": \"my-demo\", \"script\": { …demo script… } }`, plus optional `\"env\"` (only to check `${env:NAME}` placeholders — the saved file keeps the placeholders)",
    response: "`{ scriptPath, name, summary }` + `warnings`; `400 SCRIPT_INVALID` (nothing saved) when invalid.",
  },
  {
    method: "POST",
    path: "/v1/runs",
    summary: "Starts a CLI command as a background run — see [Running commands](#running-commands-post-v1runs).",
    body: "`{ \"command\": \"make\", \"script\": {…} or \"scriptPath\": \"…\", \"job\": \"my-demo\", \"options\": { \"lang\": \"en\" }, \"env\": { \"DEMO_PASSWORD\": \"…\" } }`",
    response: "`202` `{ runId, status, command, cli, job?, scriptPath?, links: { self, events, wait, cancel } }` (links are paths on this server); `429` when too many runs are waiting.",
  },
  {
    method: "GET",
    path: "/v1/runs",
    summary: "Lists runs, newest first. Optional `?status=<status>` and `?limit=<n>` (default 100).",
    response: "`{ runs: [{ runId, command, status, createdAt, startedAt?, finishedAt?, job?, scriptPath? }] }`",
  },
  {
    method: "GET",
    path: "/v1/runs/:id?wait=<sec>",
    summary: `One run. With \`wait\` (seconds, max ${MAX_WAIT_SEC}) the request blocks until the run ends or the time is up.`,
    response: "`{ runId, command, status, exitCode?, createdAt, startedAt?, finishedAt?, eventCount, lastEvent?, queuePosition?, cli, job?, scriptPath?, links, ok?, output?, outcome? }` — once the run has ended, `output` is the command's result (or its error when `ok` is false) and `outcome` the full CLI envelope.",
  },
  {
    method: "GET",
    path: "/v1/runs/:id/events",
    summary: "Live progress as Server-Sent Events (`?format=ndjson` for JSON lines). Replays history first and always ends with `end`.",
    response: "`text/event-stream` — see [Following a run](#following-a-run).",
  },
  {
    method: "POST",
    path: "/v1/runs/:id/cancel",
    summary: "Stops a queued or running run, including its browser and ffmpeg processes.",
    response: "The run with `status: \"cancelled\"` (unchanged if it had already ended).",
  },
  {
    method: "PUT",
    path: "/v1/files?path=<relative path>",
    summary: "Uploads a file into `<workspace>/uploads/` (raw request body, e.g. `curl -T clip.mp3`). Use the returned `relativePath` in scripts (`audio`, `music.path`, `source.video`, `storageState`). Replaces an existing file.",
    body: "The raw file bytes (not JSON), up to 2 GB. Allowed extensions: " + UPLOAD_EXTENSIONS.join(" ") + ".",
    response: "`{ path, relativePath, bytes }` — `path` absolute, `relativePath` relative to the workspace (e.g. `uploads/clip.mp3`); `400` for absolute paths, `..`, symlinks or other extensions; `413` over the size limit.",
  },
  {
    method: "GET",
    path: "/v1/files?path=<path>",
    summary: "Downloads a file from the workspace — e.g. a video, contact sheet or screenshot a run produced — or lists a folder. Supports `Range` for video seeking.",
    response: "The file (`Content-Type` from the extension), or `{ path, entries: [{ name, type, size, url }] }` for a folder; `403` for anything outside the workspace (symlinks are followed before checking).",
  },
];

/** HTTP status for an error code: fixable request → 400, missing thing → 404, machine not ready → 503, bug → 500. */
export function httpStatusFor(code: ErrorCode): number {
  if (NOT_FOUND_CODES.includes(code)) return 404;
  switch (exitCodeFor(code)) {
    case 1:
    case 3:
      return 400;
    case 2:
      return 503;
    default:
      return 500;
  }
}
const NOT_FOUND_CODES: ErrorCode[] = ["SCRIPT_NOT_FOUND", "JOB_NOT_FOUND", "VIDEO_NOT_FOUND", "STORAGE_STATE_NOT_FOUND"];

// ─── entry point ─────────────────────────────────────────────────────

export async function startServer(opts: ServerOptions): Promise<{ url: string; close(): Promise<void> }> {
  const app = new NaraServer(opts);
  const url = await app.listen();
  return { url, close: () => app.close() };
}

// ─── internals ───────────────────────────────────────────────────────

type RunStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";
const FINAL_STATUSES: RunStatus[] = ["succeeded", "failed", "cancelled"];

interface RunEvent extends NaraEvent {
  seq: number;
}

/** What is persisted to <workspace>/runs/<id>.json. */
interface RunRecord {
  runId: string;
  command: string;
  status: RunStatus;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  exitCode?: number;
  signal?: string;
  /** CLI arguments after `narascreen`. */
  args: string[];
  /** The same command, printable (copy-paste into a terminal). */
  cli: string;
  scriptPath?: string;
  job?: string;
  outDir?: string;
  eventCount: number;
  /** Names (never values) of variables the client passed in `env`. */
  envNames?: string[];
  lastEvent?: RunEvent;
  outcome?: Envelope;
  serverPid: number;
  pid?: number;
}

class Run {
  /** Client `env` for ${env:} substitution: handed to the child, never persisted. */
  env?: Record<string, string>;
  /** Values of `env`, masked out of every event and envelope this run produces. */
  secrets: string[] = [];
  /** Recent events of an active run (bounded); the full history is always on disk. */
  events: RunEvent[] = [];
  /** True once `events` no longer holds the whole history (trimmed, or run from disk). */
  partial = false;
  readonly bus = new EventEmitter();
  child?: ChildProcess;
  exited?: Promise<void>;
  eventLogPath?: string;
  /** Which queue slot the running child occupies. */
  slot?: "heavy" | "light";
  cancelReason?: string;
  killTimer?: NodeJS.Timeout;
  stdout = "";
  stderrTail: string[] = [];
  constructor(public rec: RunRecord) {
    this.bus.setMaxListeners(0);
  }
  get final(): boolean {
    return FINAL_STATUSES.includes(this.rec.status);
  }
}

interface Ctx {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  url: URL;
  params: Record<string, string>;
  /** Origin the client used to reach us, e.g. http://127.0.0.1:4790. */
  base: string;
  command: string;
}

type Handler = (ctx: Ctx) => Promise<void>;

/** Status override for errors that are about HTTP itself (auth, method, size). */
class HttpError extends AgentError {
  constructor(
    readonly status: number,
    code: ErrorCode,
    message: string,
    init: AgentErrorInit = {},
  ) {
    super(code, message, init);
  }
}

const usage = (message: string, hint?: string, status = 400, details?: Record<string, unknown>) =>
  new HttpError(status, "USAGE", message, { hint, details });

const VERSION = readVersion();
const MAX_STDOUT = 8 * 1024 * 1024;
/** Longest stderr line kept as one event; longer output is split. */
const MAX_LINE = 16 * 1024;
const RUN_ID_RE = /^r_[A-Za-z0-9_-]{1,64}$/;
const ENV_NAME_RE = /^[A-Z_][A-Z0-9_]*$/;
/** Variables a client may not set: they steer the process, the CLI or its tools, not the script. */
const RESERVED_ENV_RE =
  /^(PATH|HOME|USER|LOGNAME|SHELL|PWD|OLDPWD|TMPDIR|TMP|TEMP|IFS|ENV|BASH_ENV|LANG|LANGUAGE|TZ|DISPLAY|WAYLAND_DISPLAY|NO_COLOR|FORCE_COLOR|(HTTPS?|ALL|NO|FTP)_PROXY|(LC|XDG|NODE|NPM|NARASCREEN|LD|DYLD|PLAYWRIGHT|ELECTRON|KOKORO|FFMPEG|FFPROBE|TSX|UV|SSL|OPENSSL|PYTHON|DBUS|CHROME|CHROMIUM|GTK|QT)(_.*)?)$/;
const MAX_CLIENT_ENV = 50;

/** Values worth masking: very short ones ("1", "on") would mangle unrelated text. */
function secretValues(env: Record<string, string>): string[] {
  return [...new Set(Object.values(env).filter((v) => v.length >= 4))].sort((a, b) => b.length - a.length);
}

function redact(text: string, secrets: string[]): string {
  let out = text;
  for (const v of secrets) if (out.includes(v)) out = out.split(v).join("***");
  return out;
}

/** Mask secrets anywhere in a JSON value (JSON-escaped forms included). */
function redactJson(v: unknown, secrets: string[]): unknown {
  let text = JSON.stringify(v);
  for (const s of secrets) {
    const esc = JSON.stringify(s).slice(1, -1);
    if (text.includes(esc)) text = text.split(esc).join("***");
  }
  return JSON.parse(text);
}
const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;

class NaraServer {
  private readonly ws: string;
  private readonly dirs: { scripts: string; jobs: string; runs: string; inspect: string };
  private readonly token?: string;
  private readonly concurrency: number;
  private readonly cliPath: string;
  private readonly startedAt = Date.now();
  private readonly http: http.Server;
  private readonly runs = new Map<string, Run>();
  private readonly queue: Run[] = [];
  private readonly lightQueue: Run[] = [];
  /** realpath of the workspace: every path reachable over HTTP must resolve inside it. */
  private wsReal = "";
  private readonly routes: { method: string; re: RegExp; keys: string[]; key: string; handler: Handler; command: string }[];
  private heavyRunning = 0;
  private lightRunning = 0;
  private readonly lightWaiters: (() => void)[] = [];
  /** One `doctor` process at a time; concurrent GET /v1/doctor share its result. */
  private doctorInFlight?: Promise<Envelope>;
  /** Set synchronously by close(): no new runs start from here on. */
  private stopping = false;
  private closing?: Promise<void>;
  private url = "";
  private readonly loopback: boolean;
  private readonly onProcessExit = () => this.killAllNow();

  constructor(private readonly opts: ServerOptions) {
    this.ws = path.resolve(opts.workspace || "narascreen-out");
    this.dirs = {
      scripts: path.join(this.ws, "scripts"),
      jobs: path.join(this.ws, "jobs"),
      runs: path.join(this.ws, "runs"),
      inspect: path.join(this.ws, "inspect"),
    };
    this.token = opts.token || process.env.NARASCREEN_TOKEN || undefined;
    this.concurrency = Math.max(1, Math.floor(Number(opts.concurrency) || 1));
    this.cliPath = path.resolve(opts.cliPath ?? path.join(__dirname, "..", "bin", "narascreen"));
    this.loopback = isLoopbackHost(opts.host || DEFAULT_HOST);
    this.routes = this.compileRoutes();
    this.http = http.createServer((req, res) => void this.handle(req, res));
  }

  // ── lifecycle ──

  async listen(): Promise<string> {
    const host = this.opts.host || DEFAULT_HOST;
    if (!this.loopback && !this.token) {
      throw new AgentError("USAGE", `Refusing to listen on ${host} without a token`, {
        hint: "Anyone who can reach that address could run commands. Pass --token <secret> (or set NARASCREEN_TOKEN), or bind 127.0.0.1.",
      });
    }
    for (const d of Object.values(this.dirs)) fs.mkdirSync(d, { recursive: true });
    this.wsReal = fs.realpathSync(this.ws);
    this.loadRuns();
    const port = Number.isFinite(Number(this.opts.port)) ? Number(this.opts.port) : DEFAULT_PORT;
    await new Promise<void>((resolve, reject) => {
      const onError = (err: NodeJS.ErrnoException) => {
        reject(
          err.code === "EADDRINUSE"
            ? new AgentError("USAGE", `Port ${port} on ${host} is already in use`, {
                hint: "Another server is running there (try its /v1/health), or pass --port <other>.",
              })
            : toAgentError(err),
        );
      };
      this.http.once("error", onError);
      this.http.listen(port, host, () => {
        this.http.off("error", onError);
        resolve();
      });
    });
    const addr = this.http.address() as AddressInfo;
    this.url = `http://${urlHost(host)}:${addr.port}`;
    process.on("exit", this.onProcessExit);
    return this.url;
  }

  close(): Promise<void> {
    this.stopping = true;
    this.closing ??= (async () => {
      for (const run of [...this.queue, ...this.lightQueue]) await this.cancel(run, "The server was stopped before this run started.");
      await Promise.all(
        [...this.runs.values()].filter((r) => !r.final).map((r) => this.cancel(r, "The server was stopped while this run was in progress.")),
      );
      process.off("exit", this.onProcessExit);
      await new Promise<void>((resolve) => {
        this.http.close(() => resolve());
        this.http.closeAllConnections();
      });
    })();
    return this.closing;
  }

  /** Last resort when the process exits without close(): don't leave browsers behind. */
  private killAllNow() {
    for (const run of this.runs.values()) if (run.child && !run.final) killTree(run.child, "SIGKILL");
  }

  // ── routing ──

  private handlers(): Record<string, { command: string; handler: Handler }> {
    return {
      "GET /": {
        command: "docs",
        // Browsers get the HTML manual; agents and curl (no text/html in Accept) get the short orientation.
        handler: async ({ req, res, base }) => {
          res.setHeader("Vary", "Accept");
          if (/text\/html/i.test(String(req.headers.accept ?? ""))) res.writeHead(302, { Location: "/docs" }).end();
          else sendText(res, 200, "text/plain", buildLlmsTxt(base));
        },
      },
      "GET /docs": {
        command: "docs",
        handler: async ({ res, base }) =>
          sendText(res, 200, "text/html", renderDocsHtml(buildManualMarkdown({ baseUrl: base }), { baseUrl: base })),
      },
      "GET /docs.md": {
        command: "docs",
        handler: async ({ res, base }) => sendText(res, 200, "text/markdown", buildManualMarkdown({ baseUrl: base })),
      },
      "GET /llms.txt": { command: "docs", handler: async ({ res, base }) => sendText(res, 200, "text/plain", buildLlmsTxt(base)) },
      "GET /v1/health": { command: "health", handler: (c) => this.health(c) },
      "GET /v1/schema": {
        command: "schema",
        handler: async ({ res }) => sendText(res, 200, "application/json", JSON.stringify(demoScriptJsonSchema(), null, 2) + "\n"),
      },
      "GET /v1/voices": { command: "voices", handler: (c) => this.voices(c) },
      "GET /v1/doctor": { command: "doctor", handler: (c) => this.doctor(c) },
      "POST /v1/validate": { command: "validate", handler: (c) => this.validate(c) },
      "POST /v1/scripts": { command: "scripts.save", handler: (c) => this.saveScript(c) },
      "POST /v1/runs": { command: "runs.create", handler: (c) => this.createRun(c) },
      "GET /v1/runs": { command: "runs.list", handler: (c) => this.listRuns(c) },
      "GET /v1/runs/:id": { command: "runs.get", handler: (c) => this.getRun(c) },
      "GET /v1/runs/:id/events": { command: "runs.events", handler: (c) => this.runEvents(c) },
      "POST /v1/runs/:id/cancel": { command: "runs.cancel", handler: (c) => this.cancelRun(c) },
      "GET /v1/files": { command: "files", handler: (c) => this.files(c) },
      "PUT /v1/files": { command: "files.upload", handler: (c) => this.upload(c) },
    };
  }

  /** Build the router from ROUTES so the documented table IS the routing table. */
  private compileRoutes() {
    const handlers = this.handlers();
    const compiled = ROUTES.map((r) => {
      const pattern = r.path.split("?")[0];
      const key = `${r.method} ${pattern}`;
      const h = handlers[key];
      if (!h) throw new Error(`server.ts: ROUTES entry ${key} has no handler`);
      const keys: string[] = [];
      const re = new RegExp(
        "^" + pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/:(\w+)/g, (_m, k: string) => (keys.push(k), "([^/]+)")) + "$",
      );
      return { method: r.method, re, keys, key, handler: h.handler, command: h.command };
    });
    for (const key of Object.keys(handlers)) {
      if (!compiled.some((c) => c.key === key)) throw new Error(`server.ts: handler ${key} is missing from ROUTES`);
    }
    return compiled;
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse) {
    let command = "http";
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const method = req.method === "HEAD" ? "GET" : (req.method ?? "GET");
      const isApi = url.pathname === "/v1" || url.pathname.startsWith("/v1/");
      if (isApi) this.guard(req);

      const candidates = this.routes.filter((r) => r.re.test(url.pathname));
      const route = candidates.find((r) => r.method === method);
      if (!route) {
        if (candidates.length) {
          res.setHeader("Allow", [...new Set(candidates.map((c) => c.method))].join(", "));
          throw usage(`${req.method} is not supported on ${url.pathname}`, `Use ${candidates.map((c) => c.method).join(" or ")}.`, 405);
        }
        throw usage(`No route ${req.method} ${url.pathname}`, "See GET /docs.md for every route.", 404);
      }
      command = route.command;
      const m = route.re.exec(url.pathname)!;
      const params = Object.fromEntries(route.keys.map((k, i) => [k, safeDecode(m[i + 1])]));
      await route.handler({ req, res, url, params, base: this.baseFor(req), command });
    } catch (err) {
      this.sendError(res, command, err);
    }
  }

  /** Auth + browser-attack checks for /v1. Docs stay public. */
  private guard(req: http.IncomingMessage) {
    // DNS rebinding: a hostile page's domain re-pointed at us still carries its own
    // name in Host. Loopback binds accept loopback names; other binds accept IP
    // literals too (never an arbitrary domain name).
    const host = req.headers.host ?? "";
    const name = hostnameOf(host);
    if (!isLoopbackHost(name) && (this.loopback || !isIpLiteral(name))) {
      throw usage(`Unexpected Host header "${host}"`, "Address this server by 127.0.0.1 / localhost (or its IP address).", 403);
    }
    // Browsers: another site's page (even a no-cors <img>/<video> GET, or a page on
    // another localhost port) must not drive the API. Programs send neither header.
    const origin = req.headers.origin;
    const site = String(req.headers["sec-fetch-site"] ?? "");
    const sameOrigin = origin ? origin === `http://${host}` : site === "same-origin" || site === "none" || site === "";
    if (!sameOrigin || site === "cross-site" || (site === "same-site" && !origin)) {
      throw usage(
        `Cross-origin request refused (${origin ? `Origin ${origin}` : `Sec-Fetch-Site ${site}`})`,
        "Call the API from a program (curl, an HTTP client), not from a web page on another origin.",
        403,
      );
    }
    if (this.token) {
      const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? "");
      if (!m || !safeEqual(m[1].trim(), this.token)) {
        throw usage(
          m ? "Wrong bearer token" : "Missing bearer token",
          "Send the header `Authorization: Bearer <token>` (the token the server was started with).",
          401,
        );
      }
    }
  }

  private baseFor(req: http.IncomingMessage): string {
    const host = req.headers.host;
    return host && /^[A-Za-z0-9.\-:[\]]+$/.test(host) ? `http://${host}` : this.url;
  }

  // ── simple endpoints ──

  private async health({ res, base }: Ctx) {
    const running = [...this.runs.values()].filter((r) => r.rec.status === "running").length;
    sendEnvelope(
      res,
      200,
      success("health", {
        version: VERSION,
        uptimeSec: Math.round((Date.now() - this.startedAt) / 1000),
        workspace: this.ws,
        auth: !!this.token,
        concurrency: this.concurrency,
        runs: { queued: this.queue.length + this.lightQueue.length, running },
        docs: `${base}/docs.md`,
      }),
    );
  }

  private async voices({ res, url }: Ctx) {
    const lang = url.searchParams.get("lang");
    const all = Object.keys(LANG_CODES);
    if (lang && !all.includes(lang)) {
      throw usage(`Unknown language "${lang}"`, `Supported: ${all.join(", ")}.`);
    }
    const languages = (lang ? [lang] : all).map((code) => ({
      code,
      label: LANG_LABELS[code] ?? code,
      defaultVoice: DEFAULT_VOICES[code]?.[0],
      voices: DEFAULT_VOICES[code] ?? [],
    }));
    sendEnvelope(res, 200, success("voices", { languages }));
  }

  private async doctor({ res, url }: Ctx) {
    const args = ["doctor"];
    const scriptPath = url.searchParams.get("scriptPath");
    if (scriptPath) args.push(`--script=${this.loadScriptFile(scriptPath).path}`);
    // Concurrent plain doctor calls share one process; every call also needs a light slot.
    let pending = !scriptPath ? this.doctorInFlight : undefined;
    if (!pending) {
      if (this.lightWaiters.length >= MAX_QUEUED_RUNS) throw tooBusy();
      pending = (async () => {
        const release = await this.acquireLight();
        try {
          return await this.runCliOnce(args, 120_000, "doctor");
        } finally {
          release();
        }
      })();
      if (!scriptPath) {
        this.doctorInFlight = pending;
        void pending.finally(() => (this.doctorInFlight = undefined));
      }
    }
    const env = await pending;
    sendEnvelope(res, env.ok ? 200 : httpStatusFor((env.error?.code ?? "INTERNAL") as ErrorCode), env);
  }

  private async validate({ req, res }: Ctx) {
    const body = await readJson(req, ["script", "scriptPath", "env"]);
    const env = this.clientEnv(body.env, res);
    if (body.script !== undefined) {
      const raw = this.inlineScript(body.script);
      const { script, warnings } = this.admitScript(raw, this.ws, env);
      this.sendRedacted(
        res,
        200,
        success("validate", { valid: true, summary: scriptSummary(script) }, {
          warnings,
          next: [`POST /v1/scripts {"name":"${nameFrom(script.scope.toLowerCase())}","script":{…}}  (save it, then run check)`],
        }),
      );
      return;
    }
    if (typeof body.scriptPath === "string" && body.scriptPath) {
      const loaded = this.loadScriptFile(body.scriptPath, env);
      this.sendRedacted(
        res,
        200,
        success("validate", { valid: true, scriptPath: loaded.path, summary: scriptSummary(loaded.script) }, {
          warnings: loaded.warnings,
          next: [`POST /v1/runs {"command":"check","scriptPath":${JSON.stringify(loaded.path)}}`],
        }),
      );
      return;
    }
    throw usage('Send {"script": {…}} (the demo script as JSON) or {"scriptPath": "<file>"}', "GET /v1/schema describes the script format.");
  }

  private async saveScript({ req, res }: Ctx) {
    const body = await readJson(req, ["name", "script", "env"]);
    const env = this.clientEnv(body.env, res);
    const name = sanitizeName(body.name);
    if (body.script === undefined) throw usage('Missing "script" (the demo script as a JSON object)');
    const raw = this.inlineScript(body.script);
    const { script, warnings } = this.admitScript(raw, this.ws, env); // throws SCRIPT_INVALID → 400, nothing saved
    const scriptPath = path.join(this.dirs.scripts, `${name}.demo-script.json`);
    writeFileAtomic(scriptPath, JSON.stringify(raw, null, 2) + "\n");
    sendEnvelope(
      res,
      200,
      success("scripts.save", { scriptPath, name, summary: scriptSummary(script) }, {
        warnings,
        next: [`POST /v1/runs {"command":"check","scriptPath":${JSON.stringify(scriptPath)}}`],
      }),
    );
  }

  /** An inline script, with relative file paths made absolute against the workspace
   *  (so it means the same thing once saved under <workspace>/scripts/). */
  private inlineScript(v: unknown): Record<string, unknown> {
    if (!isObject(v)) throw usage('"script" must be a JSON object (the demo script)', "GET /v1/schema describes the format.");
    const copy = JSON.parse(JSON.stringify(v)) as Record<string, unknown>;
    mapScriptFiles(copy, (p) => (p.includes("${") || path.isAbsolute(p) ? p : path.resolve(this.ws, p)));
    return copy;
  }

  // ── client-supplied environment (for ${env:NAME} in scripts) ──

  /** Values to mask from responses on this connection (set when the request carried `env`). */
  private readonly secretsByRes = new WeakMap<http.ServerResponse, string[]>();

  /** Vet a request's `env`: names like DEMO_PASSWORD only, no overriding the process basics. */
  private clientEnv(v: unknown, res: http.ServerResponse): Record<string, string> | undefined {
    if (v === undefined || v === null) return undefined;
    if (!isObject(v)) throw usage('"env" must be an object of NAME → string, e.g. {"DEMO_PASSWORD": "…"}');
    const out: Record<string, string> = {};
    const entries = Object.entries(v);
    if (entries.length > MAX_CLIENT_ENV) throw usage(`"env" may hold at most ${MAX_CLIENT_ENV} variables`);
    for (const [name, value] of entries) {
      if (!ENV_NAME_RE.test(name)) throw usage(`env name "${name}" must match ${ENV_NAME_RE.source}`, "Use UPPER_CASE names such as DEMO_PASSWORD.");
      if (RESERVED_ENV_RE.test(name)) throw usage(`env name "${name}" is reserved`, "Pick an application-specific name such as DEMO_PASSWORD; process settings (PATH, NODE_*, NARASCREEN_*, LD_*, …) cannot be overridden.");
      if (typeof value !== "string" || value.length > 8192 || value.includes("\0")) throw usage(`env value of "${name}" must be a string (≤ 8 KB)`);
      out[name] = value;
    }
    this.secretsByRes.set(res, secretValues(out));
    return out;
  }

  private sendRedacted(res: http.ServerResponse, status: number, env: Envelope) {
    const secrets = this.secretsByRes.get(res) ?? [];
    sendEnvelope(res, status, secrets.length ? (redactJson(env, secrets) as Envelope) : env);
  }

  // ── workspace containment: everything reachable over HTTP lives in the workspace ──

  /** Resolve a client-supplied path against the workspace; refuse it unless it stays
   *  inside, after following symlinks of every existing part of it. */
  private inWorkspace(p: string, what: string): string {
    if (p.includes("\0")) throw usage(`Invalid ${what}`);
    const abs = path.resolve(this.ws, p);
    if (!isInside(realpathDeepest(abs), this.wsReal)) {
      throw usage(
        `${what} must be inside the workspace (${this.ws}): ${abs}`,
        `Over HTTP every script, job and file lives in the workspace. Use a name or a path under ${this.ws} (relative paths resolve against it), or restart the server with --workspace <dir>.`,
      );
    }
    return abs;
  }

  /** A script file named by a client (scriptPath / options.script / ?scriptPath=). */
  private loadScriptFile(p: unknown, env?: Record<string, string>): LoadedScript {
    if (typeof p !== "string" || !p.trim()) throw usage('"scriptPath" must be a file path');
    const abs = this.inWorkspace(p, "scriptPath");
    if (!/\.json$/i.test(abs)) throw usage(`scriptPath must be a .json file: ${abs}`);
    // Check file references before validation opens (or probes) any of them.
    try {
      const raw: unknown = JSON.parse(fs.readFileSync(abs, "utf-8"));
      if (isObject(raw)) this.checkScriptFiles(raw, path.dirname(abs));
    } catch (e) {
      if (e instanceof AgentError) throw e; // unreadable / not JSON: loadScript reports it below
    }
    const loaded = quietJsonErrors(() => loadScript(abs, { env: { ...process.env, ...env } }));
    this.checkScriptFiles(loaded.script as unknown as Record<string, unknown>, loaded.dir);
    checkScriptUrls(loaded.script);
    return loaded;
  }

  /** Validate an inline script (relative paths against `dir`) with the HTTP-only rules. */
  private admitScript(raw: Record<string, unknown>, dir: string, env?: Record<string, string>): { script: DemoScript; warnings: string[] } {
    this.checkScriptFiles(raw, dir); // before validation opens (or probes) any file
    const res = quietJsonErrors(() => validateScript(raw, { dir, env: { ...process.env, ...env } }));
    this.checkScriptFiles(res.script as unknown as Record<string, unknown>, dir); // after ${env:} substitution
    checkScriptUrls(res.script);
    return res;
  }

  /** Every file a script points at (storageState, audio, music, source video) must be in the workspace. */
  private checkScriptFiles(script: Record<string, unknown>, dir: string) {
    const issues: { path: string; message: string; hint: string }[] = [];
    mapScriptFiles(script, (p, at) => {
      if (p.includes("${")) return p; // checked again after substitution
      const abs = path.resolve(dir, p);
      if (!isInside(realpathDeepest(abs), this.wsReal)) {
        issues.push({ path: at, message: `file must be inside the workspace (${this.ws}): ${abs}`, hint: "Copy the file into the workspace and reference it from there." });
      }
      return p;
    });
    if (issues.length) {
      throw new AgentError("SCRIPT_INVALID", `${issues.length} file reference(s) outside the workspace. First: ${issues[0].path}`, {
        hint: "Over HTTP a script may only use files inside the server's workspace.",
        where: { path: issues[0].path },
        details: { issues },
      });
    }
  }

  private fileAllowed(p: string): boolean {
    return isInside(realpathDeepest(path.resolve(this.ws, p)), this.wsReal);
  }

  // ── runs ──

  private async createRun({ req, res, base }: Ctx) {
    if (this.stopping) throw new HttpError(503, "INTERNAL", "The server is shutting down", { hint: "Retry once it is back." });
    const body = await readJson(req, ["command", "script", "scriptPath", "job", "options", "env"]);
    const env = this.clientEnv(body.env, res);
    if (this.queue.length + this.lightQueue.length >= MAX_QUEUED_RUNS) throw tooBusy();
    const runId = this.newRunId();
    const plan = this.planRun(body, runId, env);
    const rec: RunRecord = {
      runId,
      command: plan.command,
      status: "queued",
      createdAt: new Date().toISOString(),
      args: plan.args,
      cli: printable(plan.args),
      ...(plan.scriptPath ? { scriptPath: plan.scriptPath } : {}),
      ...(plan.job ? { job: plan.job } : {}),
      ...(plan.outDir ? { outDir: plan.outDir } : {}),
      eventCount: 0,
      ...(env ? { envNames: Object.keys(env) } : {}),
      serverPid: process.pid,
    };
    const run = new Run(rec);
    if (env) {
      run.env = env;
      run.secrets = secretValues(env);
    }
    this.runs.set(runId, run);
    this.pruneRuns();
    run.eventLogPath = this.eventsPath(runId);
    this.persist(run);
    log(`run ${runId}: ${rec.cli}`);

    const heavy = !!findCommand(plan.command)?.heavy;
    const queue = heavy ? this.queue : this.lightQueue;
    const ahead = queue.length + (heavy ? this.heavyRunning : this.lightRunning) - (heavy ? this.concurrency - 1 : LIGHT_CONCURRENCY - 1);
    queue.push(run);
    this.addEvent(run, {
      type: "log",
      message: ahead > 0 ? `queued: waiting for ${ahead} run(s) ahead` : "queued",
      data: { runStatus: "queued", ahead: Math.max(0, ahead) },
    });
    this.pump();
    sendEnvelope(
      res,
      202,
      success(
        "runs.create",
        { runId, status: rec.status, command: rec.command, cli: rec.cli, job: rec.job, scriptPath: rec.scriptPath, links: links(runId) },
        { next: this.followCommands(base, runId) },
      ),
    );
  }

  private async listRuns({ res, url }: Ctx) {
    const status = url.searchParams.get("status");
    const limit = Math.max(1, Math.min(1000, Number(url.searchParams.get("limit")) || 100));
    const runs = [...this.runs.values()]
      .map((r) => r.rec)
      .filter((r) => !status || r.status === status)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.runId.localeCompare(a.runId))
      .slice(0, limit)
      .map((r) => ({
        runId: r.runId,
        command: r.command,
        status: r.status,
        createdAt: r.createdAt,
        ...(r.startedAt ? { startedAt: r.startedAt } : {}),
        ...(r.finishedAt ? { finishedAt: r.finishedAt } : {}),
        ...(r.job ? { job: r.job } : {}),
        ...(r.scriptPath ? { scriptPath: r.scriptPath } : {}),
      }));
    sendEnvelope(res, 200, success("runs.list", { runs }));
  }

  private async getRun({ res, url, params, base }: Ctx) {
    const run = this.findRun(params.id);
    const waitRaw = url.searchParams.get("wait");
    if (waitRaw !== null) {
      const sec = Number(waitRaw);
      if (!Number.isFinite(sec) || sec < 0) throw usage(`wait must be a number of seconds (0–${MAX_WAIT_SEC})`);
      if (!run.final && sec > 0) await this.waitForEnd(run, res, Math.min(sec, MAX_WAIT_SEC) * 1000);
      if (res.writableEnded || res.destroyed) return;
    }
    sendEnvelope(res, 200, this.runEnvelope(run, base));
  }

  private async cancelRun({ res, params, base }: Ctx) {
    const run = this.findRun(params.id);
    const warnings = run.final ? [`Run already ${run.rec.status}; nothing to cancel.`] : [];
    if (!run.final) await this.cancel(run, "Cancelled by POST /v1/runs/:id/cancel.");
    const env = this.runEnvelope(run, base);
    env.command = "runs.cancel";
    env.warnings.push(...warnings);
    sendEnvelope(res, 200, env);
  }

  private async runEvents({ req, res, url, params }: Ctx) {
    const run = this.findRun(params.id);
    const format = url.searchParams.get("format") ?? "sse";
    if (format !== "sse" && format !== "ndjson") throw usage(`format must be "sse" or "ndjson"`);
    const ndjson = format === "ndjson";
    const afterRaw = req.headers["last-event-id"] ?? url.searchParams.get("after") ?? "0";
    const after = Math.max(0, Number.parseInt(String(afterRaw), 10) || 0);

    // Everything, including `end`, was already delivered: 204 tells EventSource to stop reconnecting.
    if (!ndjson && run.final && after > run.rec.eventCount) {
      res.writeHead(204).end();
      return;
    }
    res.writeHead(200, {
      "Content-Type": ndjson ? "application/x-ndjson; charset=utf-8" : "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    if (!ndjson) res.write("retry: 3000\n\n");

    const write = (ev: RunEvent) =>
      res.write(ndjson ? JSON.stringify(ev) + "\n" : `id: ${ev.seq}\nevent: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`);
    const writeEnd = () => {
      const r = run.rec;
      const seq = r.eventCount + 1;
      if (ndjson) {
        const line = { type: "end", seq, ts: r.finishedAt, runId: r.runId, status: r.status, exitCode: r.exitCode, outcome: r.outcome };
        res.end(JSON.stringify(line) + "\n");
      } else {
        res.end(`id: ${seq}\nevent: end\ndata: ${JSON.stringify(r.outcome)}\n\n`);
      }
    };

    // Replay then subscribe in the same tick, so no event can fall in between.
    for (const ev of this.pastEvents(run)) if (ev.seq > after) write(ev);
    if (run.final) {
      writeEnd();
      return;
    }
    const onEvent = (ev: RunEvent) => {
      if (ev.seq > after) write(ev);
    };
    const onEnd = () => {
      cleanup();
      writeEnd();
    };
    const heartbeat = setInterval(() => res.write(ndjson ? "\n" : ": ping\n\n"), HEARTBEAT_SEC * 1000);
    const cleanup = () => {
      clearInterval(heartbeat);
      run.bus.off("event", onEvent);
      run.bus.off("end", onEnd);
    };
    run.bus.on("event", onEvent);
    run.bus.once("end", onEnd);
    res.on("close", cleanup);
  }

  private findRun(id: string): Run {
    let run = this.runs.get(id);
    if (!run && RUN_ID_RE.test(id)) {
      // Pruned from memory (or from an earlier server): read it back from disk.
      const rec = this.readRunRecord(`${id}.json`);
      if (rec) {
        run = new Run(rec);
        run.partial = true;
        this.runs.set(id, run);
        this.pruneRuns();
      }
    }
    if (!run) throw usage(`No run with id "${id}"`, "GET /v1/runs lists the runs this server knows.", 404);
    return run;
  }

  /** Keep at most MAX_MEMORY_RUNS records in memory, dropping the oldest finished ones. */
  private pruneRuns() {
    if (this.runs.size <= MAX_MEMORY_RUNS) return;
    const finished = [...this.runs.values()].filter((r) => r.final).sort((a, b) => a.rec.createdAt.localeCompare(b.rec.createdAt));
    for (const r of finished) {
      if (this.runs.size <= MAX_MEMORY_RUNS) break;
      if (r.bus.listenerCount("event") || r.bus.listenerCount("end")) continue;
      this.runs.delete(r.rec.runId);
    }
  }

  private waitForEnd(run: Run, res: http.ServerResponse, ms: number): Promise<void> {
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        run.bus.off("end", done);
        res.off("close", done);
        resolve();
      };
      const timer = setTimeout(done, ms);
      run.bus.once("end", done);
      res.once("close", done);
    });
  }

  private runEnvelope(run: Run, base: string): Envelope {
    const r = run.rec;
    const queuePosition = r.status === "queued" ? this.queue.indexOf(run) + 1 : undefined;
    const result = {
      runId: r.runId,
      command: r.command,
      status: r.status,
      ...(r.exitCode !== undefined ? { exitCode: r.exitCode } : {}),
      ...(r.signal ? { signal: r.signal } : {}),
      createdAt: r.createdAt,
      ...(r.startedAt ? { startedAt: r.startedAt } : {}),
      ...(r.finishedAt ? { finishedAt: r.finishedAt } : {}),
      eventCount: r.eventCount,
      ...(r.lastEvent ? { lastEvent: r.lastEvent } : {}),
      ...(queuePosition ? { queuePosition } : {}),
      cli: r.cli,
      ...(r.job ? { job: r.job } : {}),
      ...(r.scriptPath ? { scriptPath: r.scriptPath } : {}),
      ...(r.outDir ? { outDir: r.outDir } : {}),
      links: links(r.runId),
      // Once ended: `ok` + `output` = the command's result (or its error) without digging into `outcome`.
      ...(r.outcome ? { ok: r.outcome.ok, output: r.outcome.ok ? r.outcome.result : r.outcome.error, outcome: r.outcome } : {}),
    };
    const next = run.final ? this.fileCommands(base, r.outcome) : this.followCommands(base, r.runId);
    return success("runs.get", result, { next });
  }

  /** curl commands to follow a run. */
  private followCommands(base: string, runId: string): string[] {
    const auth = this.token ? ' -H "Authorization: Bearer $NARASCREEN_TOKEN"' : "";
    return [`curl -N${auth} ${base}/v1/runs/${runId}/events`, `curl -s${auth} "${base}/v1/runs/${runId}?wait=${MAX_WAIT_SEC}"`];
  }

  /** curl commands to download the media a finished run points at (videos, contact sheets, screenshots). */
  private fileCommands(base: string, outcome?: Envelope): string[] {
    if (!outcome) return [];
    const auth = this.token ? ' -H "Authorization: Bearer $NARASCREEN_TOKEN"' : "";
    return mediaPaths(outcome)
      .filter((p) => this.fileAllowed(p))
      .slice(0, 6)
      .map((p) => `curl -s${auth} "${base}/v1/files?path=${encodeURIComponent(p)}" -o ${path.basename(p)}`);
  }

  // ── run planning: HTTP body → CLI argv ──

  private planRun(body: Record<string, unknown>, runId: string, env?: Record<string, string>) {
    const command = body.command;
    if (typeof command !== "string" || !RUN_COMMANDS.includes(command)) {
      const hint = typeof command === "string" ? didYouMean(command, RUN_COMMANDS) : undefined;
      throw usage(
        typeof command === "string" ? `"${command}" cannot be run over HTTP` : 'Missing "command"',
        `${hint ? hint + " " : ""}Commands: ${RUN_COMMANDS.join(", ")}.`,
      );
    }
    const doc = findCommand(command) as CommandDoc;
    const options = parseRunOptions(doc, body.options);
    const hasScriptFlag = doc.flags.some((f) => f.name === "script");
    const usesJob = doc.arg?.name === "job" || (doc.arg?.name === "script" && doc.flags.some((f) => f.name === "out"));

    // Script: inline JSON, a path, or options.script (the CLI flag name).
    const given = ["script", "scriptPath"].filter((k) => body[k] !== undefined);
    if (options.has("script")) given.push("options.script");
    if (given.length > 1) throw usage(`Give only one of ${given.join(", ")}`);
    if (given.length && doc.arg?.name !== "script" && !hasScriptFlag && doc.arg?.name !== "job") {
      throw usage(`"${command}" does not take a script`);
    }
    // Scripts are validated (with the workspace rules) before the run is accepted.
    let scriptPath: string | undefined;
    let scope: string | undefined;
    if (body.script !== undefined) {
      const raw = this.inlineScript(body.script);
      scope = this.admitScript(raw, this.ws, env).script.scope;
      scriptPath = path.join(this.dirs.scripts, `run-${runId}.demo-script.json`);
      writeFileAtomic(scriptPath, JSON.stringify(raw, null, 2) + "\n");
    } else if (given.length) {
      const loaded = this.loadScriptFile(body.scriptPath ?? options.get("script"), env);
      scriptPath = loaded.path;
      scope = loaded.script.scope;
    }
    const storage = options.get("storage-state");
    if (typeof storage === "string") options.set("storage-state", this.inWorkspace(storage, "storage-state"));
    const pageUrl = options.get("url");
    if (typeof pageUrl === "string" && /^[a-z][a-z0-9+.-]*:/i.test(pageUrl) && !/^https?:\/\//i.test(pageUrl)) {
      throw usage(`options.url must be an http(s) URL or a path: ${pageUrl}`);
    }
    if (doc.arg?.name === "script" && !scriptPath) {
      throw usage(`"${command}" needs a script`, 'Send "script" (the demo script as JSON) or "scriptPath" (a saved script, e.g. from POST /v1/scripts).');
    }

    // Job folder: `job` (name or absolute path), options.out, or jobs/<scope>.
    let job: string | undefined;
    if (body.job !== undefined) {
      if (!usesJob) throw usage(`"${command}" does not use a job`);
      job = this.resolveJob(body.job);
    }
    const out = options.get("out");
    if (usesJob && typeof out === "string") {
      if (job) throw usage('Give either "job" or options.out, not both');
      job = this.inWorkspace(out, "options.out");
    }
    if (usesJob && !job && scope) job = path.join(this.dirs.jobs, nameFrom(scope.toLowerCase()));
    if (doc.arg?.name === "job" && !job) {
      throw usage(`"${command}" needs a job`, 'Send "job": "<name>" (a folder in <workspace>/jobs) or an absolute path, or a script whose scope names the job.');
    }

    let outDir: string | undefined;
    if (command === "inspect") {
      if (!scriptPath && !options.has("url")) throw usage('"inspect" needs options.url, or a script (with options.until)');
      outDir = typeof out === "string" ? this.inWorkspace(out, "options.out") : path.join(this.dirs.inspect, runId);
    }

    const args: string[] = [command];
    if (doc.arg?.name === "script") args.push(scriptPath!);
    if (doc.arg?.name === "job") args.push(job!);
    if (scriptPath && hasScriptFlag) args.push(`--script=${scriptPath}`);
    if (usesJob && doc.arg?.name === "script" && job) args.push(`--out=${job}`);
    if (outDir) args.push(`--out=${outDir}`);
    for (const [name, v] of options) {
      if (name === "script" || name === "out") continue;
      args.push(v === true ? `--${name}` : `--${name}=${v}`);
    }
    return { command, args, scriptPath, job, outDir };
  }

  private resolveJob(v: unknown): string {
    if (typeof v !== "string" || !v.trim()) throw usage('"job" must be a job name or an absolute folder path');
    if (path.isAbsolute(v)) return this.inWorkspace(v, "job");
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(v)) {
      throw usage(`Job name "${v}" may only use letters, digits, ".", "_" and "-"`, "Or pass an absolute folder path inside the workspace.");
    }
    return this.inWorkspace(path.join(this.dirs.jobs, v), "job");
  }

  // ── run execution ──

  private pump() {
    while (!this.stopping && this.heavyRunning < this.concurrency && this.queue.length) {
      const run = this.queue.shift()!;
      run.slot = "heavy";
      this.heavyRunning++;
      this.start(run);
    }
    while (!this.stopping && this.lightRunning < LIGHT_CONCURRENCY && (this.lightQueue.length || this.lightWaiters.length)) {
      const run = this.lightQueue.shift();
      if (run) {
        run.slot = "light";
        this.lightRunning++;
        this.start(run);
      } else {
        this.lightWaiters.shift()!();
      }
    }
  }

  /** A light slot for work outside runs (GET /v1/doctor). Resolves to its release function. */
  private acquireLight(): Promise<() => void> {
    return new Promise((resolve) => {
      this.lightWaiters.push(() => {
        this.lightRunning++;
        let released = false;
        resolve(() => {
          if (released) return;
          released = true;
          this.lightRunning--;
          this.pump();
        });
      });
      this.pump();
    });
  }

  private start(run: Run) {
    const rec = run.rec;
    rec.status = "running";
    rec.startedAt = new Date().toISOString();
    if (!fs.existsSync(this.cliPath)) {
      this.finish(run, null, null, failure(rec.command, new AgentError("INTERNAL", `NaraScreen CLI not found at ${this.cliPath}`, {
        hint: "The server install is incomplete: bin/narascreen is missing next to api/.",
      })));
      return;
    }
    const child = spawn(process.execPath, [this.cliPath, ...rec.args, "--events", "json"], {
      cwd: this.ws,
      env: this.childEnv(run.env),
      stdio: ["ignore", "pipe", "pipe"],
      // Own process group (POSIX) so cancel can signal the CLI, its browser and ffmpeg together.
      detached: process.platform !== "win32",
      windowsHide: true,
    });
    run.child = child;
    run.env = undefined; // the child has it; nothing else needs the values
    rec.pid = child.pid;
    this.persist(run);
    this.addEvent(run, { type: "log", message: `started: ${rec.cli}`, data: { runStatus: "running", pid: child.pid } });

    child.stdout!.setEncoding("utf8");
    child.stdout!.on("data", (chunk: string) => {
      if (run.stdout.length < MAX_STDOUT) run.stdout += chunk;
    });
    let partial = "";
    child.stderr!.setEncoding("utf8");
    child.stderr!.on("data", (chunk: string) => {
      const lines = (partial + chunk).split("\n");
      partial = lines.pop() ?? "";
      if (partial.length > MAX_LINE) {
        lines.push(partial); // an endless line: emit what we have (addEvent truncates it)
        partial = "";
      }
      for (const line of lines) this.onStderrLine(run, line);
    });

    run.exited = new Promise<void>((resolve) => {
      let exitTimer: NodeJS.Timeout | undefined;
      const done = (code: number | null, signal: NodeJS.Signals | null) => {
        clearTimeout(exitTimer);
        if (partial) this.onStderrLine(run, partial);
        partial = "";
        this.finish(run, code, signal);
        resolve();
      };
      child.once("close", done);
      // A stray grandchild holding our pipes would delay 'close' forever; don't wait on it.
      child.once("exit", (code, signal) => {
        exitTimer = setTimeout(() => {
          child.stdout?.destroy();
          child.stderr?.destroy();
          done(code, signal);
        }, 2000);
      });
      child.once("error", (err) => {
        this.finish(run, null, null, failure(rec.command, toAgentError(err)));
        resolve();
      });
    });
  }

  private onStderrLine(run: Run, raw: string) {
    const line = raw.replace(ANSI_RE, "").trimEnd();
    if (!line.trim()) return;
    if (line.startsWith("{")) {
      try {
        const ev = JSON.parse(line) as NaraEvent;
        if (isNaraEvent(ev)) {
          this.addEvent(run, ev);
          return;
        }
      } catch {
        // not an event: fall through and keep it as a log line
      }
    }
    run.stderrTail.push(redact(line, run.secrets));
    if (run.stderrTail.length > 40) run.stderrTail.shift();
    this.addEvent(run, { type: "log", message: line });
  }

  private addEvent(run: Run, input: Omit<NaraEvent, "ts"> & { ts?: string }) {
    const ev = run.secrets.length ? (redactJson(input, run.secrets) as typeof input) : input;
    // A runaway child must not fill the disk: past the cap only milestones are kept.
    if (run.rec.eventCount >= MAX_RUN_EVENTS && ev.type === "log") return;
    const data = ev.data && JSON.stringify(ev.data).length > MAX_LINE * 4 ? { truncated: true } : ev.data;
    const full: RunEvent = {
      seq: ++run.rec.eventCount,
      ts: ev.ts ?? new Date().toISOString(),
      type: ev.type,
      ...(ev.stage ? { stage: ev.stage } : {}),
      message: ev.message.length > MAX_LINE ? `${ev.message.slice(0, MAX_LINE)}… [truncated]` : ev.message,
      ...(data ? { data } : {}),
    };
    if (run.rec.eventCount === MAX_RUN_EVENTS) full.message += ` (event limit ${MAX_RUN_EVENTS} reached: further log lines are dropped)`;
    // Written synchronously so the file is always the complete history replays read from.
    if (run.eventLogPath) {
      try {
        fs.appendFileSync(run.eventLogPath, JSON.stringify(full) + "\n");
      } catch {
        run.eventLogPath = undefined;
      }
    }
    run.events.push(full);
    if (run.events.length > MAX_MEMORY_EVENTS) {
      run.events.splice(0, run.events.length - MAX_MEMORY_EVENTS);
      run.partial = true;
    }
    run.rec.lastEvent = full;
    run.bus.emit("event", full);
  }

  /** Settle a run exactly once: decide status + outcome, persist, wake subscribers, free the slot. */
  private finish(run: Run, code: number | null, signal: NodeJS.Signals | null, forced?: Envelope) {
    if (run.final) return;
    const rec = run.rec;
    clearTimeout(run.killTimer);
    const env = forced ?? parseEnvelope(run.stdout);
    if (run.cancelReason && !(env?.ok && code === 0)) {
      rec.status = "cancelled";
      rec.outcome = failure(rec.command, new AgentError("CANCELLED", `Run cancelled. ${run.cancelReason}`, {
        hint: "Start it again with POST /v1/runs when you want the result.",
        details: { cancelled: true },
      }));
    } else if (env) {
      rec.status = env.ok ? "succeeded" : "failed";
      rec.outcome = env;
    } else {
      rec.status = "failed";
      rec.outcome = failure(rec.command, new AgentError("INTERNAL", `The command exited (${signal ? `signal ${signal}` : `code ${code}`}) without printing a result`, {
        hint: "This is a NaraScreen bug or the process was killed. The last output lines are in details.",
        details: { exitCode: code, signal, stderrTail: run.stderrTail.slice(-20), stdoutTail: run.stdout.slice(-2000) },
      }));
    }
    if (run.secrets.length && rec.outcome) rec.outcome = redactJson(rec.outcome, run.secrets) as Envelope;
    run.secrets = [];
    if (code !== null) rec.exitCode = code;
    if (signal) rec.signal = signal;
    rec.finishedAt = new Date().toISOString();
    run.child = undefined;
    run.stdout = "";
    run.stderrTail = [];
    this.persist(run);
    // History now lives on disk only; memory holds just the record.
    run.eventLogPath = undefined;
    run.events = [];
    run.partial = true;
    const secs = rec.startedAt ? ((Date.parse(rec.finishedAt) - Date.parse(rec.startedAt)) / 1000).toFixed(1) : "0";
    log(`run ${rec.runId}: ${rec.status} (${secs}s)`);
    run.bus.emit("end");
    if (run.slot === "heavy") this.heavyRunning--;
    if (run.slot === "light") this.lightRunning--;
    run.slot = undefined;
    this.pump();
    this.pruneRuns();
  }

  private async cancel(run: Run, reason: string): Promise<void> {
    if (run.final) return;
    run.cancelReason = reason;
    for (const q of [this.queue, this.lightQueue]) {
      const i = q.indexOf(run);
      if (i >= 0) q.splice(i, 1);
    }
    {
      if (!run.child) {
        this.finish(run, null, null);
        return;
      }
    }
    const child = run.child;
    killTree(child, "SIGTERM");
    run.killTimer = setTimeout(() => killTree(child, "SIGKILL"), CANCEL_GRACE_MS);
    await Promise.race([run.exited, sleep(CANCEL_GRACE_MS + 3000)]);
    // Leftovers of the group (a browser that ignored SIGTERM) go too.
    killTree(child, "SIGKILL");
    if (!run.final) this.finish(run, null, "SIGKILL");
  }

  /** Environment of a CLI child: the server's, the client's `env` (already vetted),
   *  and markers so the CLI shapes `next` hints for HTTP callers. */
  private childEnv(clientEnv?: Record<string, string>): NodeJS.ProcessEnv {
    return { ...process.env, ...clientEnv, NO_COLOR: "1", NARASCREEN_WORKSPACE: this.ws, NARASCREEN_CALLER: "http" };
  }

  /** One-shot CLI call (GET /v1/doctor): returns its envelope. */
  private runCliOnce(args: string[], timeoutMs: number, command: string): Promise<Envelope> {
    return new Promise((resolve) => {
      if (!fs.existsSync(this.cliPath)) {
        resolve(failure(command, new AgentError("INTERNAL", `NaraScreen CLI not found at ${this.cliPath}`)));
        return;
      }
      const child = spawn(process.execPath, [this.cliPath, ...args, "--events", "json"], {
        cwd: this.ws,
        env: this.childEnv(),
        stdio: ["ignore", "pipe", "pipe"],
        detached: process.platform !== "win32",
        windowsHide: true,
      });
      let stdout = "";
      let stderr = "";
      child.stdout!.setEncoding("utf8").on("data", (c: string) => {
        if (stdout.length < MAX_STDOUT) stdout += c;
      });
      child.stderr!.setEncoding("utf8").on("data", (c: string) => (stderr = (stderr + c).slice(-4000)));
      const timer = setTimeout(() => killTree(child, "SIGKILL"), timeoutMs);
      child.once("error", (err) => {
        clearTimeout(timer);
        resolve(failure(command, toAgentError(err)));
      });
      child.once("close", (code, signal) => {
        clearTimeout(timer);
        resolve(
          parseEnvelope(stdout) ??
            failure(command, new AgentError("INTERNAL", `${command} exited (${signal ? `signal ${signal}` : `code ${code}`}) without a result`, {
              details: { stderrTail: stderr.split("\n").slice(-20) },
            })),
        );
      });
    });
  }

  // ── persistence ──

  private newRunId(): string {
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
    let id: string;
    do id = `r_${stamp}-${crypto.randomBytes(2).toString("hex")}`;
    while (this.runs.has(id) || fs.existsSync(this.runPath(id)));
    return id;
  }

  private runPath(id: string) {
    return path.join(this.dirs.runs, `${id}.json`);
  }
  private eventsPath(id: string) {
    return path.join(this.dirs.runs, `${id}.events.ndjson`);
  }

  private readRunRecord(file: string): RunRecord | undefined {
    try {
      const rec = JSON.parse(fs.readFileSync(path.join(this.dirs.runs, file), "utf-8")) as RunRecord;
      return rec.runId && RUN_ID_RE.test(rec.runId) && rec.command ? rec : undefined;
    } catch {
      return undefined;
    }
  }

  private persist(run: Run) {
    try {
      writeFileAtomic(this.runPath(run.rec.runId), JSON.stringify(run.rec, null, 2) + "\n");
    } catch (err) {
      warn(`Could not save run ${run.rec.runId}: ${toAgentError(err).message}`);
    }
  }

  private pastEvents(run: Run): RunEvent[] {
    if (!run.partial) return run.events;
    try {
      return fs
        .readFileSync(this.eventsPath(run.rec.runId), "utf-8")
        .split("\n")
        .filter((l) => l.trim())
        .map((l) => JSON.parse(l) as RunEvent);
    } catch {
      return [];
    }
  }

  /** Runs from earlier servers on this workspace: listable, replayable, and their folders stay downloadable. */
  private loadRuns() {
    let files: string[] = [];
    try {
      files = fs.readdirSync(this.dirs.runs).filter((f) => f.endsWith(".json"));
    } catch {
      return;
    }
    // Newest first, and only as many as memory allows; older ones load on demand.
    files.sort().reverse();
    for (const f of files.slice(0, MAX_MEMORY_RUNS)) {
      const rec = this.readRunRecord(f);
      if (!rec) continue;
      const run = new Run(rec);
      run.partial = true;
      if (!run.final && (rec.serverPid === process.pid || !isAlive(rec.serverPid))) {
        rec.status = "failed";
        rec.finishedAt = rec.finishedAt ?? new Date().toISOString();
        rec.outcome = failure(rec.command, new AgentError("INTERNAL", "The server stopped before this run finished", {
          hint: "Start it again with POST /v1/runs.",
        }));
        this.persist(run);
      }
      this.runs.set(rec.runId, run);
    }
  }

  // ── files ──

  private async files({ req, res, url, base }: Ctx) {
    const p = url.searchParams.get("path");
    if (!p) throw usage('Missing ?path=<file>', "Pass an absolute path from a run result, e.g. outcome.result.videos[0].path.");
    if (p.includes("\0")) throw usage("Invalid path");
    const abs = path.resolve(this.ws, p);
    // The real location (symlinks followed) must be inside the real workspace. Checked
    // before existence, so nothing outside can even be probed.
    if (!this.fileAllowed(abs)) {
      throw usage(`Not allowed: ${abs}`, `Only files inside the workspace (${this.ws}) can be downloaded.`, 403);
    }
    let real: string;
    try {
      real = fs.realpathSync(abs);
    } catch {
      throw usage(`No such file: ${abs}`, undefined, 404);
    }
    const st = fs.statSync(real);
    if (st.isDirectory()) {
      const entries = fs
        .readdirSync(real, { withFileTypes: true })
        .filter((d) => d.isFile() || d.isDirectory())
        .map((d) => {
          const full = path.join(abs, d.name);
          const size = d.isFile() ? safeSize(path.join(real, d.name)) : undefined;
          return { name: d.name, type: d.isDirectory() ? "dir" : "file", ...(size !== undefined ? { size } : {}), url: `${base}/v1/files?path=${encodeURIComponent(full)}` };
        })
        .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "dir" ? -1 : 1));
      sendEnvelope(res, 200, success("files", { path: abs, entries }));
      return;
    }
    sendFile(req, res, real, st);
  }

  /** PUT /v1/files: stream the raw body into <workspace>/uploads/<path>. */
  private async upload({ req, res }: Ctx) {
    const raw = (new URL(req.url ?? "/", "http://x").searchParams.get("path") ?? "").replace(/\\/g, "/");
    const hint = 'Pass a relative name such as ?path=uploads/clip.mp3 (or clip.mp3); files always land in <workspace>/uploads/.';
    if (!raw) throw usage("Missing ?path=<relative path>", hint);
    if (path.isAbsolute(raw) || /^[A-Za-z]:/.test(raw)) throw usage(`Upload path must be relative: ${raw}`, hint);
    const parts = raw.split("/").filter(Boolean);
    if (parts[0] === "uploads") parts.shift();
    if (!parts.length || parts.some((p) => p === ".." || p.startsWith(".") || !/^[A-Za-z0-9._-]+$/.test(p))) {
      throw usage(`Invalid upload path: ${raw}`, `${hint} Use letters, digits, ".", "_" and "-" in names; no "..".`);
    }
    const ext = path.extname(parts[parts.length - 1]).toLowerCase();
    if (!UPLOAD_EXTENSIONS.includes(ext)) throw usage(`Cannot upload "${ext || "(no extension)"}" files`, `Allowed: ${UPLOAD_EXTENSIONS.join(" ")}.`);
    const tooBig = () => usage(`Upload larger than ${MAX_UPLOAD_BYTES / 1024 ** 3} GB`, undefined, 413);
    if (Number(req.headers["content-length"] ?? 0) > MAX_UPLOAD_BYTES) {
      req.resume();
      throw tooBig();
    }
    const uploads = path.join(this.ws, "uploads");
    fs.mkdirSync(uploads, { recursive: true });
    const dest = path.join(uploads, ...parts);
    // Every existing part of the destination, symlinks followed, must stay inside uploads/.
    const uploadsReal = fs.realpathSync(uploads);
    if (!isInside(realpathDeepest(dest), uploadsReal) || !isInside(realpathDeepest(path.dirname(dest)), uploadsReal)) {
      throw usage(`Upload path escapes ${uploads}: ${raw}`, hint);
    }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const tmp = `${dest}.upload-${crypto.randomBytes(4).toString("hex")}`;
    const bytes = await new Promise<number>((resolve, reject) => {
      const out = fs.createWriteStream(tmp, { flags: "wx" });
      let n = 0;
      const fail = (e: unknown) => {
        req.unpipe(out);
        out.destroy();
        fs.rmSync(tmp, { force: true });
        reject(e);
      };
      req.on("data", (c: Buffer) => {
        n += c.length;
        if (n > MAX_UPLOAD_BYTES) {
          req.resume();
          fail(tooBig());
        }
      });
      req.on("error", fail);
      out.on("error", fail);
      out.on("finish", () => resolve(n));
      req.pipe(out);
    });
    fs.renameSync(tmp, dest); // replaces a previous upload (a symlink at dest is replaced, never followed)
    const relativePath = path.relative(this.ws, dest).split(path.sep).join("/");
    sendEnvelope(res, 200, success("files.upload", { path: dest, relativePath, bytes }, {
      next: [`Reference it in a script as "${relativePath}" (e.g. "music": {"path": "${relativePath}"}), then POST /v1/scripts`],
    }));
  }

  private sendError(res: http.ServerResponse, command: string, err: unknown) {
    if (res.headersSent) {
      res.destroy();
      return;
    }
    const e = toAgentError(err);
    const status = err instanceof HttpError ? err.status : httpStatusFor(e.code);
    if (status === 401) res.setHeader("WWW-Authenticate", 'Bearer realm="narascreen"');
    if (status === 413) res.setHeader("Connection", "close");
    this.sendRedacted(res, status, failure(command, e));
  }
}

// ─── HTTP helpers ────────────────────────────────────────────────────

function sendEnvelope(res: http.ServerResponse, status: number, env: Envelope) {
  sendText(res, status, "application/json", JSON.stringify(env, null, 2) + "\n");
}

function sendText(res: http.ServerResponse, status: number, type: string, body: string) {
  res.writeHead(status, {
    "Content-Type": `${type}; charset=utf-8`,
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(body);
}

/** Read a JSON object body (≤ MAX_BODY_BYTES) and reject unknown top-level keys. */
function readJson(req: http.IncomingMessage, allowed: string[]): Promise<Record<string, unknown>> {
  const tooBig = () => usage(`Request body is larger than ${MAX_BODY_BYTES / 1024 / 1024} MB`, "Send smaller scripts, or save large ones to disk and pass scriptPath.", 413);
  if (Number(req.headers["content-length"] ?? 0) > MAX_BODY_BYTES) {
    req.resume();
    return Promise.reject(tooBig());
  }
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let failed = false;
    req.on("data", (c: Buffer) => {
      if (failed) return;
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        failed = true;
        reject(tooBig());
        return;
      }
      chunks.push(c);
    });
    req.on("error", (err) => reject(toAgentError(err)));
    req.on("end", () => {
      if (failed) return;
      const text = Buffer.concat(chunks).toString("utf-8").trim();
      let body: unknown = {};
      if (text) {
        try {
          body = JSON.parse(text);
        } catch (e) {
          reject(usage(`Request body is not valid JSON: ${(e as Error).message}`, "Send a JSON object with Content-Type: application/json."));
          return;
        }
      }
      if (!isObject(body)) {
        reject(usage("Request body must be a JSON object"));
        return;
      }
      const unknown = Object.keys(body).filter((k) => !allowed.includes(k));
      if (unknown.length) {
        const hint = didYouMean(unknown[0], allowed);
        reject(usage(`Unknown field${unknown.length > 1 ? "s" : ""} ${unknown.map((k) => `"${k}"`).join(", ")}`, `${hint ? hint + " " : ""}Allowed: ${allowed.join(", ")}.`));
        return;
      }
      resolve(body);
    });
  });
}

const CONTENT_TYPES: Record<string, string> = {
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".jsonl": "application/x-ndjson; charset=utf-8",
  ".ndjson": "application/x-ndjson; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".log": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".ass": "text/plain; charset=utf-8",
  ".srt": "text/plain; charset=utf-8",
  ".vtt": "text/vtt; charset=utf-8",
};

function sendFile(req: http.IncomingMessage, res: http.ServerResponse, file: string, st: fs.Stats) {
  const size = st.size;
  const headers: http.OutgoingHttpHeaders = {
    "Content-Type": CONTENT_TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream",
    "Accept-Ranges": "bytes",
    "Last-Modified": st.mtime.toUTCString(),
    "Cache-Control": "no-cache",
    "X-Content-Type-Options": "nosniff",
    // Job files are data, never an app: neutralize scripts in served HTML/SVG.
    "Content-Security-Policy": "sandbox",
    "Content-Disposition": `inline; filename="${path.basename(file).replace(/[^\w.-]/g, "_")}"`,
  };
  let start = 0;
  let end = size - 1;
  let status = 200;
  const range = parseRange(req.headers.range, size);
  if (range === "unsatisfiable") {
    res.writeHead(416, { "Content-Range": `bytes */${size}`, "Content-Type": "text/plain; charset=utf-8" });
    res.end("Requested range not satisfiable\n");
    return;
  }
  if (range) {
    ({ start, end } = range);
    status = 206;
    headers["Content-Range"] = `bytes ${start}-${end}/${size}`;
  }
  headers["Content-Length"] = size === 0 ? 0 : end - start + 1;
  res.writeHead(status, headers);
  if (req.method === "HEAD" || size === 0) {
    res.end();
    return;
  }
  const stream = fs.createReadStream(file, { start, end });
  stream.on("error", () => res.destroy());
  res.on("close", () => stream.destroy());
  stream.pipe(res);
}

/** Single `bytes=` range; multi-range requests get the whole file (allowed by RFC 9110). */
function parseRange(header: string | undefined, size: number): { start: number; end: number } | "unsatisfiable" | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (!m[1] && !m[2])) return null;
  let start: number;
  let end: number;
  if (!m[1]) {
    const suffix = Number(m[2]);
    if (suffix === 0) return "unsatisfiable";
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  }
  if (start >= size || start > end) return "unsatisfiable";
  return { start, end };
}

// ─── run helpers ─────────────────────────────────────────────────────

function links(runId: string) {
  return {
    self: `/v1/runs/${runId}`,
    events: `/v1/runs/${runId}/events`,
    wait: `/v1/runs/${runId}?wait=120`,
    cancel: `/v1/runs/${runId}/cancel`,
  };
}

/** HTTP `options` → CLI flags, checked against the command's flag list in COMMANDS. */
function parseRunOptions(doc: CommandDoc, raw: unknown): Map<string, string | true> {
  const out = new Map<string, string | true>();
  if (raw === undefined || raw === null) return out;
  if (!isObject(raw)) throw usage('"options" must be an object of flag names to values, e.g. {"lang": "en,hi", "force": true}');
  const names = doc.flags.map((f) => f.name).filter((n) => !BLOCKED_RUN_OPTIONS.includes(n));
  for (const [key, value] of Object.entries(raw)) {
    // Accept "--lang" and camelCase ("fullPage") spellings of the CLI flag name.
    const name = key.replace(/^--/, "").replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
    const flag = doc.flags.find((f) => f.name === name);
    if (BLOCKED_RUN_OPTIONS.includes(name)) throw usage(`Option "${key}" is not available over HTTP (it waits for a keyboard)`);
    if (!flag) {
      const hint = didYouMean(name, names);
      throw usage(`Unknown option "${key}" for ${doc.name}`, `${hint ? hint + " " : ""}${names.length ? `Options: ${names.join(", ")}.` : `${doc.name} takes no options.`}`);
    }
    if (flag.type === "boolean") {
      if (typeof value !== "boolean") throw usage(`Option "${name}" must be true or false`);
      if (value) out.set(name, true);
    } else {
      const v = typeof value === "number" && Number.isFinite(value) ? String(value) : value;
      if (typeof v !== "string" || !v.trim()) throw usage(`Option "${name}" must be a non-empty string`);
      out.set(name, v);
    }
  }
  return out;
}

function parseEnvelope(stdout: string): Envelope | undefined {
  const text = stdout.trim();
  if (!text) return undefined;
  const attempt = (s: string) => {
    try {
      const v = JSON.parse(s) as Envelope;
      return isObject(v) && typeof v.ok === "boolean" && typeof v.command === "string" ? v : undefined;
    } catch {
      return undefined;
    }
  };
  const whole = attempt(text);
  if (whole) return whole;
  // Something printed before the envelope: try from each line that opens an object, last first.
  const lines = text.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].startsWith("{")) continue;
    const env = attempt(lines.slice(i).join("\n"));
    if (env) return env;
  }
  return undefined;
}

function isNaraEvent(v: unknown): v is NaraEvent {
  const e = v as NaraEvent;
  return isObject(v) && typeof e.message === "string" && ["stage", "step", "log", "warning"].includes(e.type);
}

const MEDIA_EXT = /\.(mp4|webm|jpe?g|png)$/i;
const MEDIA_KEYS = ["path", "video", "contactSheet", "screenshot", "fullPageScreenshot", "recording"];

/** Absolute media paths in an envelope, most useful first: final videos, contact sheets,
 *  screenshots, then the rest (the raw recording). Individual preview frames are skipped. */
function mediaPaths(env: Envelope): string[] {
  const found: { p: string; rank: number }[] = [];
  const rankOf = (p: string, key: string) =>
    /(^|[\\/])final_[^\\/]*\.mp4$/.test(p) ? 0 : key === "contactSheet" ? 1 : /screenshot/i.test(key) ? 2 : 3;
  const walk = (v: unknown, key: string) => {
    if (typeof v === "string") {
      if (MEDIA_KEYS.includes(key) && path.isAbsolute(v) && MEDIA_EXT.test(v) && !found.some((f) => f.p === v)) {
        found.push({ p: v, rank: rankOf(v, key) });
      }
    } else if (Array.isArray(v)) {
      if (key !== "frames") v.forEach((x) => walk(x, key));
    } else if (isObject(v)) {
      for (const [k, x] of Object.entries(v)) walk(x, k);
    }
  };
  walk(env.result, "");
  walk(env.error?.details, "");
  return found.sort((a, b) => a.rank - b.rank).map((f) => f.p);
}

/** Call `fn` on every file path a script references (storageState, useSession,
 *  source.video, music.path, narration audio incl. zoom targets); `fn` returns the
 *  (possibly rewritten) path. Non-string values are left for validation to report. */
function mapScriptFiles(script: Record<string, unknown>, fn: (p: string, at: string) => string) {
  const one = (o: Record<string, unknown>, key: string, at: string) => {
    if (typeof o[key] === "string" && o[key]) o[key] = fn(o[key] as string, at);
  };
  const audio = (o: Record<string, unknown>, at: string) => {
    if (isObject(o.audio)) for (const k of Object.keys(o.audio)) one(o.audio, k, `${at}.audio.${k}`);
    else one(o, "audio", `${at}.audio`);
  };
  if (script.storageState !== "__NONE__") one(script, "storageState", "storageState");
  if (isObject(script.source)) one(script.source, "video", "source.video");
  if (isObject(script.music)) one(script.music, "path", "music.path");
  const entries: [Record<string, unknown>, string][] = [];
  if (Array.isArray(script.setup)) script.setup.forEach((e, i) => isObject(e) && entries.push([e, `setup[${i}]`]));
  if (Array.isArray(script.steps)) {
    script.steps.forEach((st, si) => {
      if (isObject(st) && Array.isArray(st.beat)) st.beat.forEach((e, i) => isObject(e) && entries.push([e, `steps[${si}].beat[${i}]`]));
    });
  }
  for (const [e, at] of entries) {
    if (e.act === "useSession") one(e, "storageState", `${at}.storageState`);
    audio(e, at);
    if (Array.isArray(e.targets)) e.targets.forEach((t, k) => isObject(t) && audio(t, `${at}.targets[${k}]`));
  }
}

/** Over HTTP a script may only make the browser/TTS talk HTTP(S) — no file:// pages to screenshot. */
function checkScriptUrls(script: DemoScript) {
  const issues: { path: string; message: string }[] = [];
  const check = (u: unknown, at: string) => {
    if (typeof u === "string" && !/^https?:\/\//i.test(u)) issues.push({ path: at, message: `must be an http(s) URL over HTTP: ${u}` });
  };
  const s = script as unknown as Record<string, unknown>;
  check(s.baseUrl ?? "http://", "baseUrl");
  if (isObject(s.tts)) check(s.tts.kokoroEndpoint ?? "http://", "tts.kokoroEndpoint");
  const acts = [
    ...(Array.isArray(s.setup) ? s.setup.map((e, i) => [e, `setup[${i}]`] as const) : []),
    ...(Array.isArray(s.steps)
      ? s.steps.flatMap((st, si) => (isObject(st) && Array.isArray(st.beat) ? st.beat.map((e, i) => [e, `steps[${si}].beat[${i}]`] as const) : []))
      : []),
  ];
  for (const [e, at] of acts) if (isObject(e) && e.act === "goto" && e.url !== undefined) check(e.url, `${at}.url`);
  if (issues.length) {
    throw new AgentError("SCRIPT_INVALID", `${issues.length} URL(s) not allowed. First: ${issues[0].path}: ${issues[0].message}`, {
      hint: "Use http:// or https:// URLs.",
      where: { path: issues[0].path },
      details: { issues },
    });
  }
}

/** JSON parse errors quote the start of the file; never echo a file's contents over HTTP. */
function quietJsonErrors<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof AgentError && e.code === "SCRIPT_INVALID_JSON") {
      throw new AgentError(e.code, e.message.split(": ")[0], { hint: e.hint, where: e.where });
    }
    if (e instanceof AgentError && e.code === "ENV_VAR_MISSING") {
      const names = ((e.details?.variables as string[] | undefined) ?? ["NAME"]).map((n) => `"${n}": "…"`).join(", ");
      throw new AgentError(e.code, e.message, {
        hint: `Over HTTP, send the values with the request: "env": {${names}} (they are used for this request only and never stored).`,
        where: e.where,
        details: e.details,
      });
    }
    throw e;
  }
}

const tooBusy = () =>
  usage("Too many runs are waiting", "Wait for some to finish (GET /v1/runs?status=queued) or cancel them, then retry.", 429);

/** A safe file/folder name from user text ("../My Demo!" → "My-Demo"). */
function sanitizeName(v: unknown): string {
  if (typeof v !== "string" || !v.trim()) throw usage('"name" is required, e.g. "my-demo"');
  const name = nameFrom(v.trim().replace(/\.demo-script\.json$|\.json$/i, ""), "");
  if (!name) throw usage(`"name" must contain letters or digits`);
  return name;
}

function nameFrom(text: string, fallback = "demo"): string {
  const n = text
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^[.-]+/, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 80)
    .replace(/[.-]+$/, "");
  return n || fallback;
}

/** argv → a copy-pasteable `narascreen …` command line. */
function printable(args: string[]): string {
  const q = (s: string) => (/^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`);
  return ["narascreen", ...args].map(q).join(" ");
}

function didYouMean(word: string, options: string[]): string | undefined {
  const w = word.toLowerCase();
  const best = options
    .map((o) => ({ o, d: levenshtein(w, o.toLowerCase()) }))
    .sort((a, b) => a.d - b.d)[0];
  return best && best.d <= Math.max(2, Math.floor(word.length / 3)) ? `Did you mean "${best.o}"?` : undefined;
}

function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}

// ─── process + fs helpers ────────────────────────────────────────────

/** Signal a child and everything it started (its process group on POSIX). */
function killTree(child: ChildProcess, signal: NodeJS.Signals) {
  if (!child.pid) return;
  if (process.platform === "win32") {
    try {
      spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    } catch {
      child.kill(signal);
    }
    return;
  }
  try {
    process.kill(-child.pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      // already gone
    }
  }
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    throw usage(`Malformed URL escape in "${s}"`);
  }
}

function isAlive(pid: number | undefined): boolean {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms).unref());
}

function isInside(p: string, root: string): boolean {
  const rel = path.relative(root, p);
  return rel === "" || (!rel.startsWith(`..${path.sep}`) && rel !== ".." && !path.isAbsolute(rel));
}

/** realpath of the longest existing prefix of `p`, plus the rest: where `p` really
 *  points (or would, once created), with every symlink in it followed. */
function realpathDeepest(p: string): string {
  const rest: string[] = [];
  let cur = path.resolve(p);
  for (;;) {
    try {
      return path.join(fs.realpathSync(cur), ...rest);
    } catch {
      const parent = path.dirname(cur);
      if (parent === cur) return path.resolve(p);
      rest.unshift(path.basename(cur));
      cur = parent;
    }
  }
}

function safeSize(p: string): number | undefined {
  try {
    return fs.statSync(p).size;
  } catch {
    return undefined;
  }
}

function writeFileAtomic(file: string, text: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${crypto.randomBytes(3).toString("hex")}`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

function safeEqual(a: string, b: string): boolean {
  const ha = crypto.createHash("sha256").update(a).digest();
  const hb = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function isIpLiteral(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, "");
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(h) || (h.includes(":") && /^[0-9a-f:.]+$/i.test(h));
}

function isLoopbackHost(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  return h === "localhost" || h.endsWith(".localhost") || h === "::1" || /^127\.\d+\.\d+\.\d+$/.test(h);
}

/** "127.0.0.1:4790" → "127.0.0.1", "[::1]:4790" → "::1". */
function hostnameOf(hostHeader: string): string {
  const m = /^\[([^\]]+)\](?::\d+)?$/.exec(hostHeader);
  if (m) return m[1];
  return hostHeader.replace(/:\d+$/, "");
}

/** Host for URLs we print: wildcard binds are reached via loopback; IPv6 needs brackets. */
function urlHost(host: string): string {
  if (host === "0.0.0.0" || host === "") return "127.0.0.1";
  if (host === "::") return "[::1]";
  return host.includes(":") ? `[${host}]` : host;
}

function readVersion(): string {
  try {
    return (JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf-8")) as { version?: string }).version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}
