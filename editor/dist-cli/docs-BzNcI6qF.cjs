"use strict";
const child_process = require("child_process");
const crypto = require("crypto");
const events = require("events");
const fs = require("fs");
const http = require("http");
const path = require("path");
const narascreen = require("./narascreen.cjs");
const index = require("./job-W-Szny1w.cjs");
function _interopNamespaceDefault(e) {
  const n = Object.create(null, { [Symbol.toStringTag]: { value: "Module" } });
  if (e) {
    for (const k2 in e) {
      if (k2 !== "default") {
        const d2 = Object.getOwnPropertyDescriptor(e, k2);
        Object.defineProperty(n, k2, d2.get ? d2 : {
          enumerable: true,
          get: () => e[k2]
        });
      }
    }
  }
  n.default = e;
  return Object.freeze(n);
}
const crypto__namespace = /* @__PURE__ */ _interopNamespaceDefault(crypto);
const fs__namespace = /* @__PURE__ */ _interopNamespaceDefault(fs);
const http__namespace = /* @__PURE__ */ _interopNamespaceDefault(http);
const path__namespace = /* @__PURE__ */ _interopNamespaceDefault(path);
const DEFAULT_PORT = 4790;
const DEFAULT_HOST = "127.0.0.1";
const MAX_BODY_BYTES = 5 * 1024 * 1024;
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024;
const INLINE_UPLOAD_EXTENSIONS = [".mp3", ".wav", ".m4a", ".ogg", ".aac", ".flac", ".mp4", ".mov", ".mkv", ".webm", ".png", ".jpg", ".jpeg", ".gif", ".webp"];
const MAX_WAIT_SEC = 300;
const HEARTBEAT_SEC = 15;
const RUN_COMMANDS = ["inspect", "check", "record", "produce", "make", "preview", "status", "doctor", "validate"];
const BLOCKED_RUN_OPTIONS = ["hold"];
const LIGHT_CONCURRENCY = 4;
const MAX_QUEUED_RUNS = 50;
const MAX_MEMORY_EVENTS = 2e3;
const MAX_RUN_EVENTS = 5e4;
const MAX_MEMORY_RUNS = 500;
const ROUTES = [
  {
    method: "GET",
    path: "/",
    summary: "Browsers (`Accept: text/html`) are redirected to `/docs`; everything else gets the `/llms.txt` orientation.",
    response: "`302` → `/docs`, or `text/plain`"
  },
  { method: "GET", path: "/docs", summary: "The manual as a web page (for humans).", response: "`text/html`" },
  {
    method: "GET",
    path: "/docs.md",
    summary: "The complete manual as Markdown — the best starting point for an agent.",
    response: "`text/markdown`"
  },
  {
    method: "GET",
    path: "/llms.txt",
    summary: "Short plain-text orientation: what this service is, where the manual is, a 5-step quick start.",
    response: "`text/plain`"
  },
  {
    method: "GET",
    path: "/v1/health",
    summary: "Is the server up, and how busy is it?",
    response: "`{ version, uptimeSec, workspace, auth, concurrency, runs: { queued, running } }`"
  },
  {
    method: "GET",
    path: "/v1/schema",
    summary: "The demo-script JSON Schema (same as `narascreen schema`).",
    response: "Raw JSON Schema (not an envelope)."
  },
  {
    method: "GET",
    path: "/v1/voices?lang=<code>",
    summary: "Narration languages and voice ids; `lang` narrows the list to one language.",
    response: "`{ languages: [{ code, label, defaultVoice, voices }] }`"
  },
  {
    method: "GET",
    path: "/v1/doctor?scriptPath=<file>",
    summary: "Checks ffmpeg, the browser and the speech engine (runs `narascreen doctor`; `scriptPath` also checks that script's speech endpoint). Call this first.",
    response: "`{ ready, checks: [{ id, ok, required, detail, fix? }] }`; `503 ENVIRONMENT_NOT_READY` (same details) when something required is missing."
  },
  {
    method: "POST",
    path: "/v1/validate",
    summary: "Validates a script without opening a browser and reports every problem at once.",
    body: '`{ "script": { …demo script… } }` or `{ "scriptPath": "<.json file inside the workspace>" }`, plus optional `"env": { "NAME": "value" }` for `${env:NAME}` placeholders',
    response: "`{ valid: true, scriptPath?, summary }` + `warnings`; `400 SCRIPT_INVALID` with `error.details.issues: [{ path, message, hint? }]`."
  },
  {
    method: "POST",
    path: "/v1/scripts",
    summary: "Validates a script and saves it as `<workspace>/scripts/<name>.demo-script.json` (replacing any previous version). Pass the returned `scriptPath` to runs.",
    body: '`{ "name": "my-demo", "script": { …demo script… } }`, plus optional `"env"` (only to check `${env:NAME}` placeholders — the saved file keeps the placeholders)',
    response: "`{ scriptPath, name, summary }` + `warnings`; `400 SCRIPT_INVALID` (nothing saved) when invalid."
  },
  {
    method: "POST",
    path: "/v1/runs",
    summary: "Starts a CLI command as a background run — see [Running commands](#running-commands-post-v1runs).",
    body: '`{ "command": "make", "script": {…} or "scriptPath": "…", "job": "my-demo", "options": { "lang": "en" }, "env": { "DEMO_PASSWORD": "…" } }`',
    response: "`202` `{ runId, status, command, cli, job?, scriptPath?, links: { self, events, wait, cancel } }` (links are paths on this server); `429` when too many runs are waiting."
  },
  {
    method: "GET",
    path: "/v1/runs",
    summary: "Lists runs, newest first. Optional `?status=<status>` and `?limit=<n>` (default 100).",
    response: "`{ runs: [{ runId, command, status, createdAt, startedAt?, finishedAt?, job?, scriptPath? }] }`"
  },
  {
    method: "GET",
    path: "/v1/runs/:id?wait=<sec>",
    summary: `One run. With \`wait\` (seconds, max ${MAX_WAIT_SEC}) the request blocks until the run ends or the time is up.`,
    response: "`{ runId, command, status, exitCode?, createdAt, startedAt?, finishedAt?, eventCount, lastEvent?, queuePosition?, cli, job?, scriptPath?, links, ok?, output?, outcome? }` — once the run has ended, `output` is the command's result (or its error when `ok` is false) and `outcome` the full CLI envelope."
  },
  {
    method: "GET",
    path: "/v1/runs/:id/events",
    summary: "Live progress as Server-Sent Events (`?format=ndjson` for JSON lines). Replays history first and always ends with `end`.",
    response: "`text/event-stream` — see [Following a run](#following-a-run)."
  },
  {
    method: "POST",
    path: "/v1/runs/:id/cancel",
    summary: "Stops a queued or running run, including its browser and ffmpeg processes.",
    response: 'The run with `status: "cancelled"` (unchanged if it had already ended).'
  },
  {
    method: "PUT",
    path: "/v1/files?path=<relative path>",
    summary: "Uploads a file of any type into `<workspace>/uploads/` (raw request body, e.g. `curl -T clip.mp3`). Use the returned `relativePath` in scripts (`audio`, `music.path`, `source.video`, `storageState`, and the files an `upload` act chooses on the page). Replaces an existing file.",
    body: "The raw file bytes (not JSON), up to 2 GB. Any file type.",
    response: "`{ path, relativePath, bytes }` — `path` absolute, `relativePath` relative to the workspace (e.g. `uploads/clip.mp3`); `400` for absolute paths, `..`, hidden names or symlinks; `413` over the size limit. Downloaded back with GET /v1/files; anything that is not audio/video/image comes back as an attachment (`application/octet-stream`)."
  },
  {
    method: "GET",
    path: "/v1/files?path=<path>",
    summary: "Downloads a file from the workspace — e.g. a video, contact sheet or screenshot a run produced — or lists a folder. Supports `Range` for video seeking.",
    response: "The file (`Content-Type` from the extension), or `{ path, entries: [{ name, type, size, url }] }` for a folder; `403` for anything outside the workspace (symlinks are followed before checking)."
  }
];
function httpStatusFor(code2) {
  if (NOT_FOUND_CODES.includes(code2)) return 404;
  switch (index.exitCodeFor(code2)) {
    case 1:
    case 3:
      return 400;
    case 2:
      return 503;
    default:
      return 500;
  }
}
const NOT_FOUND_CODES = ["SCRIPT_NOT_FOUND", "JOB_NOT_FOUND", "VIDEO_NOT_FOUND", "STORAGE_STATE_NOT_FOUND"];
async function startServer(opts) {
  const app = new NaraServer(opts);
  const url = await app.listen();
  return { url, cleaned: app.cleaned, close: () => app.close() };
}
function cleanWorkspaceCache(ws) {
  const out = { runs: 0, inspect: 0, jobs: 0, skippedLocked: [], bytes: 0 };
  const emptyDir = (dir) => {
    let n = 0;
    for (const name of safeReaddir(dir)) {
      const full = path__namespace.join(dir, name);
      out.bytes += duBytes(full);
      fs__namespace.rmSync(full, { recursive: true, force: true });
      n++;
    }
    return n;
  };
  out.runs = emptyDir(path__namespace.join(ws, "runs"));
  out.inspect = emptyDir(path__namespace.join(ws, "inspect"));
  const jobs = path__namespace.join(ws, "jobs");
  for (const name of safeReaddir(jobs)) {
    const job = path__namespace.join(jobs, name);
    const lockPid = Number((readText(path__namespace.join(job, ".lock")) ?? "").split(":")[0]);
    if (lockPid && pidAlive(lockPid)) {
      out.skippedLocked.push(job);
      continue;
    }
    let touched = false;
    for (const sub of ["audio", "preview"]) {
      const dir = path__namespace.join(job, sub);
      if (!fs__namespace.existsSync(dir)) continue;
      out.bytes += duBytes(dir);
      fs__namespace.rmSync(dir, { recursive: true, force: true });
      touched = true;
    }
    if (touched) out.jobs++;
  }
  return out;
}
function safeReaddir(dir) {
  try {
    return fs__namespace.readdirSync(dir);
  } catch {
    return [];
  }
}
function readText(file) {
  try {
    return fs__namespace.readFileSync(file, "utf-8");
  } catch {
    return void 0;
  }
}
function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
function duBytes(p) {
  let st;
  try {
    st = fs__namespace.lstatSync(p);
  } catch {
    return 0;
  }
  if (!st.isDirectory()) return st.size;
  return safeReaddir(p).reduce((n, c) => n + duBytes(path__namespace.join(p, c)), 0);
}
const FINAL_STATUSES = ["succeeded", "failed", "cancelled"];
class Run {
  constructor(rec) {
    this.rec = rec;
    this.bus.setMaxListeners(0);
  }
  /** Client `env` for ${env:} substitution: handed to the child, never persisted. */
  env;
  /** Values of `env`, masked out of every event and envelope this run produces. */
  secrets = [];
  /** Recent events of an active run (bounded); the full history is always on disk. */
  events = [];
  /** True once `events` no longer holds the whole history (trimmed, or run from disk). */
  partial = false;
  bus = new events.EventEmitter();
  child;
  exited;
  eventLogPath;
  /** Which queue slot the running child occupies. */
  slot;
  cancelReason;
  killTimer;
  stdout = "";
  stderrTail = [];
  get final() {
    return FINAL_STATUSES.includes(this.rec.status);
  }
}
class HttpError extends index.AgentError {
  constructor(status, code2, message, init = {}) {
    super(code2, message, init);
    this.status = status;
  }
}
const usage = (message, hint, status = 400, details) => new HttpError(status, "USAGE", message, { hint, details });
const VERSION = readVersion();
const RUN_ID_RE = /^r_[A-Za-z0-9_-]{1,64}$/;
const MAX_CLIENT_ENV = 50;
function secretValues(env) {
  return [...new Set(Object.values(env).filter((v2) => v2.length >= 4))].sort((a, b2) => b2.length - a.length);
}
function redact(text, secrets) {
  let out = text;
  for (const v2 of secrets) if (out.includes(v2)) out = out.split(v2).join("***");
  return out;
}
function redactJson(v2, secrets) {
  let text = JSON.stringify(v2);
  for (const s of secrets) {
    const esc = JSON.stringify(s).slice(1, -1);
    if (text.includes(esc)) text = text.split(esc).join("***");
  }
  return JSON.parse(text);
}
class NaraServer {
  constructor(opts) {
    this.opts = opts;
    this.ws = path__namespace.resolve(opts.workspace || "narascreen-out");
    this.dirs = {
      scripts: path__namespace.join(this.ws, "scripts"),
      jobs: path__namespace.join(this.ws, "jobs"),
      runs: path__namespace.join(this.ws, "runs"),
      inspect: path__namespace.join(this.ws, "inspect")
    };
    this.token = opts.token || process.env.NARASCREEN_TOKEN || void 0;
    this.concurrency = Math.max(1, Math.floor(Number(opts.concurrency) || 1));
    this.cliPath = path__namespace.resolve(opts.cliPath ?? narascreen.defaultCliEntry(__dirname));
    this.loopback = isLoopbackHost(opts.host || DEFAULT_HOST);
    this.routes = this.compileRoutes();
    this.http = http__namespace.createServer((req, res) => void this.handle(req, res));
  }
  ws;
  dirs;
  token;
  concurrency;
  cliPath;
  startedAt = Date.now();
  http;
  runs = /* @__PURE__ */ new Map();
  queue = [];
  lightQueue = [];
  /** realpath of the workspace: every path reachable over HTTP must resolve inside it. */
  wsReal = "";
  routes;
  heavyRunning = 0;
  lightRunning = 0;
  lightWaiters = [];
  /** One `doctor` process at a time; concurrent GET /v1/doctor share its result. */
  doctorInFlight;
  /** Set synchronously by close(): no new runs start from here on. */
  stopping = false;
  closing;
  url = "";
  /** Set by listen(): what the start-up cache cleanup removed (undefined with keepCache). */
  cleaned;
  loopback;
  onProcessExit = () => this.killAllNow();
  // ── lifecycle ──
  async listen() {
    const host = this.opts.host || DEFAULT_HOST;
    if (!this.loopback && !this.token) {
      throw new index.AgentError("USAGE", `Refusing to listen on ${host} without a token`, {
        hint: "Anyone who can reach that address could run commands. Pass --token <secret> (or set NARASCREEN_TOKEN), or bind 127.0.0.1."
      });
    }
    if (!this.opts.keepCache) this.cleaned = cleanWorkspaceCache(this.ws);
    for (const d2 of Object.values(this.dirs)) fs__namespace.mkdirSync(d2, { recursive: true });
    this.wsReal = fs__namespace.realpathSync(this.ws);
    this.loadRuns();
    const port = Number.isFinite(Number(this.opts.port)) ? Number(this.opts.port) : DEFAULT_PORT;
    await new Promise((resolve, reject) => {
      const onError = (err) => {
        reject(
          err.code === "EADDRINUSE" ? new index.AgentError("USAGE", `Port ${port} on ${host} is already in use`, {
            hint: "Another server is running there (try its /v1/health), or pass --port <other>."
          }) : index.toAgentError(err)
        );
      };
      this.http.once("error", onError);
      this.http.listen(port, host, () => {
        this.http.off("error", onError);
        resolve();
      });
    });
    const addr = this.http.address();
    this.url = `http://${urlHost(host)}:${addr.port}`;
    process.on("exit", this.onProcessExit);
    return this.url;
  }
  close() {
    this.stopping = true;
    this.closing ??= (async () => {
      for (const run of [...this.queue, ...this.lightQueue]) await this.cancel(run, "The server was stopped before this run started.");
      await Promise.all(
        [...this.runs.values()].filter((r) => !r.final).map((r) => this.cancel(r, "The server was stopped while this run was in progress."))
      );
      process.off("exit", this.onProcessExit);
      await new Promise((resolve) => {
        this.http.close(() => resolve());
        this.http.closeAllConnections();
      });
    })();
    return this.closing;
  }
  /** Last resort when the process exits without close(): don't leave browsers behind. */
  killAllNow() {
    for (const run of this.runs.values()) if (run.child && !run.final) narascreen.killTree(run.child, "SIGKILL");
  }
  // ── routing ──
  handlers() {
    return {
      "GET /": {
        command: "docs",
        // Browsers get the HTML manual; agents and curl (no text/html in Accept) get the short orientation.
        handler: async ({ req, res, base }) => {
          res.setHeader("Vary", "Accept");
          if (/text\/html/i.test(String(req.headers.accept ?? ""))) res.writeHead(302, { Location: "/docs" }).end();
          else sendText(res, 200, "text/plain", buildLlmsTxt(base));
        }
      },
      "GET /docs": {
        command: "docs",
        handler: async ({ res, base }) => sendText(res, 200, "text/html", renderDocsHtml(buildManualMarkdown({ baseUrl: base }), { baseUrl: base }))
      },
      "GET /docs.md": {
        command: "docs",
        handler: async ({ res, base }) => sendText(res, 200, "text/markdown", buildManualMarkdown({ baseUrl: base }))
      },
      "GET /llms.txt": { command: "docs", handler: async ({ res, base }) => sendText(res, 200, "text/plain", buildLlmsTxt(base)) },
      "GET /v1/health": { command: "health", handler: (c) => this.health(c) },
      "GET /v1/schema": {
        command: "schema",
        handler: async ({ res }) => sendText(res, 200, "application/json", JSON.stringify(index.demoScriptJsonSchema(), null, 2) + "\n")
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
      "PUT /v1/files": { command: "files.upload", handler: (c) => this.upload(c) }
    };
  }
  /** Build the router from ROUTES so the documented table IS the routing table. */
  compileRoutes() {
    const handlers = this.handlers();
    const compiled = ROUTES.map((r) => {
      const pattern = r.path.split("?")[0];
      const key = `${r.method} ${pattern}`;
      const h = handlers[key];
      if (!h) throw new Error(`server.ts: ROUTES entry ${key} has no handler`);
      const keys = [];
      const re2 = new RegExp(
        "^" + pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/:(\w+)/g, (_m, k2) => (keys.push(k2), "([^/]+)")) + "$"
      );
      return { method: r.method, re: re2, keys, key, handler: h.handler, command: h.command };
    });
    for (const key of Object.keys(handlers)) {
      if (!compiled.some((c) => c.key === key)) throw new Error(`server.ts: handler ${key} is missing from ROUTES`);
    }
    return compiled;
  }
  async handle(req, res) {
    let command = "http";
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const method = req.method === "HEAD" ? "GET" : req.method ?? "GET";
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
      const m2 = route.re.exec(url.pathname);
      const params = Object.fromEntries(route.keys.map((k2, i) => [k2, safeDecode(m2[i + 1])]));
      await route.handler({ req, res, url, params, base: this.baseFor(req), command });
    } catch (err) {
      this.sendError(res, command, err);
    }
  }
  /** Auth + browser-attack checks for /v1. Docs stay public. */
  guard(req) {
    const host = req.headers.host ?? "";
    const name = hostnameOf(host);
    if (!isLoopbackHost(name) && (this.loopback || !isIpLiteral(name))) {
      throw usage(`Unexpected Host header "${host}"`, "Address this server by 127.0.0.1 / localhost (or its IP address).", 403);
    }
    const origin = req.headers.origin;
    const site = String(req.headers["sec-fetch-site"] ?? "");
    const sameOrigin = origin ? origin === `http://${host}` : site === "same-origin" || site === "none" || site === "";
    if (!sameOrigin || site === "cross-site" || site === "same-site" && !origin) {
      throw usage(
        `Cross-origin request refused (${origin ? `Origin ${origin}` : `Sec-Fetch-Site ${site}`})`,
        "Call the API from a program (curl, an HTTP client), not from a web page on another origin.",
        403
      );
    }
    if (this.token) {
      const m2 = /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? "");
      if (!m2 || !safeEqual(m2[1].trim(), this.token)) {
        throw usage(
          m2 ? "Wrong bearer token" : "Missing bearer token",
          "Send the header `Authorization: Bearer <token>` (the token the server was started with).",
          401
        );
      }
    }
  }
  baseFor(req) {
    const host = req.headers.host;
    return host && /^[A-Za-z0-9.\-:[\]]+$/.test(host) ? `http://${host}` : this.url;
  }
  // ── simple endpoints ──
  async health({ res, base }) {
    const running = [...this.runs.values()].filter((r) => r.rec.status === "running").length;
    sendEnvelope(
      res,
      200,
      index.success("health", {
        version: VERSION,
        uptimeSec: Math.round((Date.now() - this.startedAt) / 1e3),
        workspace: this.ws,
        auth: !!this.token,
        concurrency: this.concurrency,
        runs: { queued: this.queue.length + this.lightQueue.length, running },
        docs: `${base}/docs.md`
      })
    );
  }
  async voices({ res, url }) {
    const lang = url.searchParams.get("lang");
    const all = Object.keys(index.LANG_CODES);
    if (lang && !all.includes(lang)) {
      throw usage(`Unknown language "${lang}"`, `Supported: ${all.join(", ")}.`);
    }
    const languages = (lang ? [lang] : all).map((code2) => ({
      code: code2,
      label: index.LANG_LABELS[code2] ?? code2,
      defaultVoice: index.DEFAULT_VOICES[code2]?.[0],
      voices: index.DEFAULT_VOICES[code2] ?? []
    }));
    sendEnvelope(res, 200, index.success("voices", { languages }));
  }
  async doctor({ res, url }) {
    const args = ["doctor"];
    const scriptPath = url.searchParams.get("scriptPath");
    if (scriptPath) args.push(`--script=${this.loadScriptFile(scriptPath).path}`);
    let pending = !scriptPath ? this.doctorInFlight : void 0;
    if (!pending) {
      if (this.lightWaiters.length >= MAX_QUEUED_RUNS) throw tooBusy();
      pending = (async () => {
        const release = await this.acquireLight();
        try {
          return await this.runCliOnce(args, 12e4, "doctor");
        } finally {
          release();
        }
      })();
      if (!scriptPath) {
        this.doctorInFlight = pending;
        void pending.finally(() => this.doctorInFlight = void 0);
      }
    }
    const env = await pending;
    sendEnvelope(res, env.ok ? 200 : httpStatusFor(env.error?.code ?? "INTERNAL"), env);
  }
  async validate({ req, res }) {
    const body = await readJson(req, ["script", "scriptPath", "env"]);
    const env = this.clientEnv(body.env, res);
    if (body.script !== void 0) {
      const raw = this.inlineScript(body.script);
      const { script, warnings } = this.admitScript(raw, this.ws, env);
      this.sendRedacted(
        res,
        200,
        index.success("validate", { valid: true, summary: narascreen.scriptSummary(script) }, {
          warnings,
          next: [`POST /v1/scripts {"name":"${nameFrom(script.scope.toLowerCase())}","script":{…}}  (save it, then run check)`]
        })
      );
      return;
    }
    if (typeof body.scriptPath === "string" && body.scriptPath) {
      const loaded = this.loadScriptFile(body.scriptPath, env);
      this.sendRedacted(
        res,
        200,
        index.success("validate", { valid: true, scriptPath: loaded.path, summary: narascreen.scriptSummary(loaded.script) }, {
          warnings: loaded.warnings,
          next: [`POST /v1/runs {"command":"check","scriptPath":${JSON.stringify(loaded.path)}}`]
        })
      );
      return;
    }
    throw usage('Send {"script": {…}} (the demo script as JSON) or {"scriptPath": "<file>"}', "GET /v1/schema describes the script format.");
  }
  async saveScript({ req, res }) {
    const body = await readJson(req, ["name", "script", "env"]);
    const env = this.clientEnv(body.env, res);
    const name = sanitizeName(body.name);
    if (body.script === void 0) throw usage('Missing "script" (the demo script as a JSON object)');
    const raw = this.inlineScript(body.script);
    const { script, warnings } = this.admitScript(raw, this.ws, env);
    const scriptPath = path__namespace.join(this.dirs.scripts, `${name}.demo-script.json`);
    writeFileAtomic(scriptPath, JSON.stringify(raw, null, 2) + "\n");
    sendEnvelope(
      res,
      200,
      index.success("scripts.save", { scriptPath, name, summary: narascreen.scriptSummary(script) }, {
        warnings,
        next: [`POST /v1/runs {"command":"check","scriptPath":${JSON.stringify(scriptPath)}}`]
      })
    );
  }
  /** An inline script, with relative file paths made absolute against the workspace
   *  (so it means the same thing once saved under <workspace>/scripts/). */
  inlineScript(v2) {
    if (!isObject(v2)) throw usage('"script" must be a JSON object (the demo script)', "GET /v1/schema describes the format.");
    const copy = JSON.parse(JSON.stringify(v2));
    mapScriptFiles(copy, (p) => p.includes("${") || path__namespace.isAbsolute(p) ? p : path__namespace.resolve(this.ws, p));
    return copy;
  }
  // ── client-supplied environment (for ${env:NAME} in scripts) ──
  /** Values to mask from responses on this connection (set when the request carried `env`). */
  secretsByRes = /* @__PURE__ */ new WeakMap();
  /** Vet a request's `env`: names like DEMO_PASSWORD only, no overriding the process basics. */
  clientEnv(v2, res) {
    if (v2 === void 0 || v2 === null) return void 0;
    if (!isObject(v2)) throw usage('"env" must be an object of NAME → string, e.g. {"DEMO_PASSWORD": "…"}');
    const out = {};
    const entries = Object.entries(v2);
    if (entries.length > MAX_CLIENT_ENV) throw usage(`"env" may hold at most ${MAX_CLIENT_ENV} variables`);
    for (const [name, value] of entries) {
      if (!narascreen.ENV_NAME_RE.test(name)) throw usage(`env name "${name}" must match ${narascreen.ENV_NAME_RE.source}`, "Use UPPER_CASE names such as DEMO_PASSWORD.");
      if (narascreen.RESERVED_ENV_RE.test(name)) throw usage(`env name "${name}" is reserved`, "Pick an application-specific name such as DEMO_PASSWORD; process settings (PATH, NODE_*, NARASCREEN_*, LD_*, …) cannot be overridden.");
      if (typeof value !== "string" || value.length > 8192 || value.includes("\0")) throw usage(`env value of "${name}" must be a string (≤ 8 KB)`);
      out[name] = value;
    }
    this.secretsByRes.set(res, secretValues(out));
    return out;
  }
  sendRedacted(res, status, env) {
    const secrets = this.secretsByRes.get(res) ?? [];
    sendEnvelope(res, status, secrets.length ? redactJson(env, secrets) : env);
  }
  // ── workspace containment: everything reachable over HTTP lives in the workspace ──
  /** Resolve a client-supplied path against the workspace; refuse it unless it stays
   *  inside, after following symlinks of every existing part of it. */
  inWorkspace(p, what) {
    if (p.includes("\0")) throw usage(`Invalid ${what}`);
    const abs = path__namespace.resolve(this.ws, p);
    if (!isInside(realpathDeepest(abs), this.wsReal)) {
      throw usage(
        `${what} must be inside the workspace (${this.ws}): ${abs}`,
        `Over HTTP every script, job and file lives in the workspace. Use a name or a path under ${this.ws} (relative paths resolve against it), or restart the server with --workspace <dir>.`
      );
    }
    return abs;
  }
  /** A script file named by a client (scriptPath / options.script / ?scriptPath=). */
  loadScriptFile(p, env) {
    if (typeof p !== "string" || !p.trim()) throw usage('"scriptPath" must be a file path');
    const abs = this.inWorkspace(p, "scriptPath");
    if (!/\.json$/i.test(abs)) throw usage(`scriptPath must be a .json file: ${abs}`);
    try {
      const raw = JSON.parse(fs__namespace.readFileSync(abs, "utf-8"));
      if (isObject(raw)) this.checkScriptFiles(raw, path__namespace.dirname(abs));
    } catch (e) {
      if (e instanceof index.AgentError) throw e;
    }
    const loaded = quietJsonErrors(() => narascreen.loadScript(abs, { env: { ...process.env, ...env } }));
    this.checkScriptFiles(loaded.script, loaded.dir);
    checkScriptUrls(loaded.script);
    return loaded;
  }
  /** Validate an inline script (relative paths against `dir`) with the HTTP-only rules. */
  admitScript(raw, dir, env) {
    this.checkScriptFiles(raw, dir);
    const res = quietJsonErrors(() => narascreen.validateScript(raw, { dir, env: { ...process.env, ...env } }));
    this.checkScriptFiles(res.script, dir);
    checkScriptUrls(res.script);
    return res;
  }
  /** Every file a script points at (storageState, audio, music, source video) must be in the workspace. */
  checkScriptFiles(script, dir) {
    const issues = [];
    mapScriptFiles(script, (p, at) => {
      if (p.includes("${")) return p;
      const abs = path__namespace.resolve(dir, p);
      if (!isInside(realpathDeepest(abs), this.wsReal)) {
        issues.push({ path: at, message: `file must be inside the workspace (${this.ws}): ${abs}`, hint: "Copy the file into the workspace and reference it from there." });
      }
      return p;
    });
    if (issues.length) {
      throw new index.AgentError("SCRIPT_INVALID", `${issues.length} file reference(s) outside the workspace. First: ${issues[0].path}`, {
        hint: "Over HTTP a script may only use files inside the server's workspace.",
        where: { path: issues[0].path },
        details: { issues }
      });
    }
  }
  fileAllowed(p) {
    return isInside(realpathDeepest(path__namespace.resolve(this.ws, p)), this.wsReal);
  }
  // ── runs ──
  async createRun({ req, res, base }) {
    if (this.stopping) throw new HttpError(503, "INTERNAL", "The server is shutting down", { hint: "Retry once it is back." });
    const body = await readJson(req, ["command", "script", "scriptPath", "job", "options", "env"]);
    const env = this.clientEnv(body.env, res);
    if (this.queue.length + this.lightQueue.length >= MAX_QUEUED_RUNS) throw tooBusy();
    const runId = this.newRunId();
    const plan = this.planRun(body, runId, env);
    const rec = {
      runId,
      command: plan.command,
      status: "queued",
      createdAt: (/* @__PURE__ */ new Date()).toISOString(),
      args: plan.args,
      cli: printable(plan.args),
      ...plan.scriptPath ? { scriptPath: plan.scriptPath } : {},
      ...plan.job ? { job: plan.job } : {},
      ...plan.outDir ? { outDir: plan.outDir } : {},
      eventCount: 0,
      ...env ? { envNames: Object.keys(env) } : {},
      serverPid: process.pid
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
    index.log(`run ${runId}: ${rec.cli}`);
    const heavy = !!narascreen.findCommand(plan.command)?.heavy;
    const queue = heavy ? this.queue : this.lightQueue;
    const ahead = queue.length + (heavy ? this.heavyRunning : this.lightRunning) - (heavy ? this.concurrency - 1 : LIGHT_CONCURRENCY - 1);
    queue.push(run);
    this.addEvent(run, {
      type: "log",
      message: ahead > 0 ? `queued: waiting for ${ahead} run(s) ahead` : "queued",
      data: { runStatus: "queued", ahead: Math.max(0, ahead) }
    });
    this.pump();
    sendEnvelope(
      res,
      202,
      index.success(
        "runs.create",
        { runId, status: rec.status, command: rec.command, cli: rec.cli, job: rec.job, scriptPath: rec.scriptPath, links: links(runId) },
        { next: this.followCommands(base, runId) }
      )
    );
  }
  async listRuns({ res, url }) {
    const status = url.searchParams.get("status");
    const limit = Math.max(1, Math.min(1e3, Number(url.searchParams.get("limit")) || 100));
    const runs = [...this.runs.values()].map((r) => r.rec).filter((r) => !status || r.status === status).sort((a, b2) => b2.createdAt.localeCompare(a.createdAt) || b2.runId.localeCompare(a.runId)).slice(0, limit).map((r) => ({
      runId: r.runId,
      command: r.command,
      status: r.status,
      createdAt: r.createdAt,
      ...r.startedAt ? { startedAt: r.startedAt } : {},
      ...r.finishedAt ? { finishedAt: r.finishedAt } : {},
      ...r.job ? { job: r.job } : {},
      ...r.scriptPath ? { scriptPath: r.scriptPath } : {}
    }));
    sendEnvelope(res, 200, index.success("runs.list", { runs }));
  }
  async getRun({ res, url, params, base }) {
    const run = this.findRun(params.id);
    const waitRaw = url.searchParams.get("wait");
    if (waitRaw !== null) {
      const sec = Number(waitRaw);
      if (!Number.isFinite(sec) || sec < 0) throw usage(`wait must be a number of seconds (0–${MAX_WAIT_SEC})`);
      if (!run.final && sec > 0) await this.waitForEnd(run, res, Math.min(sec, MAX_WAIT_SEC) * 1e3);
      if (res.writableEnded || res.destroyed) return;
    }
    sendEnvelope(res, 200, this.runEnvelope(run, base));
  }
  async cancelRun({ res, params, base }) {
    const run = this.findRun(params.id);
    const warnings = run.final ? [`Run already ${run.rec.status}; nothing to cancel.`] : [];
    if (!run.final) await this.cancel(run, "Cancelled by POST /v1/runs/:id/cancel.");
    const env = this.runEnvelope(run, base);
    env.command = "runs.cancel";
    env.warnings.push(...warnings);
    sendEnvelope(res, 200, env);
  }
  async runEvents({ req, res, url, params }) {
    const run = this.findRun(params.id);
    const format = url.searchParams.get("format") ?? "sse";
    if (format !== "sse" && format !== "ndjson") throw usage(`format must be "sse" or "ndjson"`);
    const ndjson = format === "ndjson";
    const afterRaw = req.headers["last-event-id"] ?? url.searchParams.get("after") ?? "0";
    const after = Math.max(0, Number.parseInt(String(afterRaw), 10) || 0);
    if (!ndjson && run.final && after > run.rec.eventCount) {
      res.writeHead(204).end();
      return;
    }
    res.writeHead(200, {
      "Content-Type": ndjson ? "application/x-ndjson; charset=utf-8" : "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    });
    if (!ndjson) res.write("retry: 3000\n\n");
    const write = (ev) => res.write(ndjson ? JSON.stringify(ev) + "\n" : `id: ${ev.seq}
event: ${ev.type}
data: ${JSON.stringify(ev)}

`);
    const writeEnd = () => {
      const r = run.rec;
      const seq = r.eventCount + 1;
      if (ndjson) {
        const line = { type: "end", seq, ts: r.finishedAt, runId: r.runId, status: r.status, exitCode: r.exitCode, outcome: r.outcome };
        res.end(JSON.stringify(line) + "\n");
      } else {
        res.end(`id: ${seq}
event: end
data: ${JSON.stringify(r.outcome)}

`);
      }
    };
    for (const ev of this.pastEvents(run)) if (ev.seq > after) write(ev);
    if (run.final) {
      writeEnd();
      return;
    }
    const onEvent = (ev) => {
      if (ev.seq > after) write(ev);
    };
    const onEnd = () => {
      cleanup();
      writeEnd();
    };
    const heartbeat = setInterval(() => res.write(ndjson ? "\n" : ": ping\n\n"), HEARTBEAT_SEC * 1e3);
    const cleanup = () => {
      clearInterval(heartbeat);
      run.bus.off("event", onEvent);
      run.bus.off("end", onEnd);
    };
    run.bus.on("event", onEvent);
    run.bus.once("end", onEnd);
    res.on("close", cleanup);
  }
  findRun(id) {
    let run = this.runs.get(id);
    if (!run && RUN_ID_RE.test(id)) {
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
  pruneRuns() {
    if (this.runs.size <= MAX_MEMORY_RUNS) return;
    const finished = [...this.runs.values()].filter((r) => r.final).sort((a, b2) => a.rec.createdAt.localeCompare(b2.rec.createdAt));
    for (const r of finished) {
      if (this.runs.size <= MAX_MEMORY_RUNS) break;
      if (r.bus.listenerCount("event") || r.bus.listenerCount("end")) continue;
      this.runs.delete(r.rec.runId);
    }
  }
  waitForEnd(run, res, ms) {
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
  runEnvelope(run, base) {
    const r = run.rec;
    const queuePosition = r.status === "queued" ? this.queue.indexOf(run) + 1 : void 0;
    const result = {
      runId: r.runId,
      command: r.command,
      status: r.status,
      ...r.exitCode !== void 0 ? { exitCode: r.exitCode } : {},
      ...r.signal ? { signal: r.signal } : {},
      createdAt: r.createdAt,
      ...r.startedAt ? { startedAt: r.startedAt } : {},
      ...r.finishedAt ? { finishedAt: r.finishedAt } : {},
      eventCount: r.eventCount,
      ...r.lastEvent ? { lastEvent: r.lastEvent } : {},
      ...queuePosition ? { queuePosition } : {},
      cli: r.cli,
      ...r.job ? { job: r.job } : {},
      ...r.scriptPath ? { scriptPath: r.scriptPath } : {},
      ...r.outDir ? { outDir: r.outDir } : {},
      links: links(r.runId),
      // Once ended: `ok` + `output` = the command's result (or its error) without digging into `outcome`.
      ...r.outcome ? { ok: r.outcome.ok, output: r.outcome.ok ? r.outcome.result : r.outcome.error, outcome: r.outcome } : {}
    };
    const next = run.final ? this.fileCommands(base, r.outcome) : this.followCommands(base, r.runId);
    return index.success("runs.get", result, { next });
  }
  /** curl commands to follow a run. */
  followCommands(base, runId) {
    const auth = this.token ? ' -H "Authorization: Bearer $NARASCREEN_TOKEN"' : "";
    return [`curl -N${auth} ${base}/v1/runs/${runId}/events`, `curl -s${auth} "${base}/v1/runs/${runId}?wait=${MAX_WAIT_SEC}"`];
  }
  /** curl commands to download the media a finished run points at (videos, contact sheets, screenshots). */
  fileCommands(base, outcome) {
    if (!outcome) return [];
    const auth = this.token ? ' -H "Authorization: Bearer $NARASCREEN_TOKEN"' : "";
    return mediaPaths(outcome).filter((p) => this.fileAllowed(p)).slice(0, 6).map((p) => `curl -s${auth} "${base}/v1/files?path=${encodeURIComponent(p)}" -o ${path__namespace.basename(p)}`);
  }
  // ── run planning: HTTP body → CLI argv ──
  planRun(body, runId, env) {
    const command = body.command;
    if (typeof command !== "string" || !RUN_COMMANDS.includes(command)) {
      const hint = typeof command === "string" ? didYouMean(command, RUN_COMMANDS) : void 0;
      throw usage(
        typeof command === "string" ? `"${command}" cannot be run over HTTP` : 'Missing "command"',
        `${hint ? hint + " " : ""}Commands: ${RUN_COMMANDS.join(", ")}.`
      );
    }
    const doc = narascreen.findCommand(command);
    const options = parseRunOptions(doc, body.options);
    const hasScriptFlag = doc.flags.some((f) => f.name === "script");
    const usesJob = doc.arg?.name === "job" || doc.arg?.name === "script" && doc.flags.some((f) => f.name === "out");
    const given = ["script", "scriptPath"].filter((k2) => body[k2] !== void 0);
    if (options.has("script")) given.push("options.script");
    if (given.length > 1) throw usage(`Give only one of ${given.join(", ")}`);
    if (given.length && doc.arg?.name !== "script" && !hasScriptFlag && doc.arg?.name !== "job") {
      throw usage(`"${command}" does not take a script`);
    }
    let scriptPath;
    let scope;
    if (body.script !== void 0) {
      const raw = this.inlineScript(body.script);
      scope = this.admitScript(raw, this.ws, env).script.scope;
      scriptPath = path__namespace.join(this.dirs.scripts, `run-${runId}.demo-script.json`);
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
    let job;
    if (body.job !== void 0) {
      if (!usesJob) throw usage(`"${command}" does not use a job`);
      job = this.resolveJob(body.job);
    }
    const out = options.get("out");
    if (usesJob && typeof out === "string") {
      if (job) throw usage('Give either "job" or options.out, not both');
      job = this.inWorkspace(out, "options.out");
    }
    if (usesJob && !job && scope) job = path__namespace.join(this.dirs.jobs, nameFrom(scope.toLowerCase()));
    if (doc.arg?.name === "job" && !job) {
      throw usage(`"${command}" needs a job`, 'Send "job": "<name>" (a folder in <workspace>/jobs) or an absolute path, or a script whose scope names the job.');
    }
    let outDir;
    if (command === "inspect") {
      if (!scriptPath && !options.has("url")) throw usage('"inspect" needs options.url, or a script (with options.until)');
      outDir = typeof out === "string" ? this.inWorkspace(out, "options.out") : path__namespace.join(this.dirs.inspect, runId);
    }
    const args = [command];
    if (doc.arg?.name === "script") args.push(scriptPath);
    if (doc.arg?.name === "job") args.push(job);
    if (scriptPath && hasScriptFlag) args.push(`--script=${scriptPath}`);
    if (usesJob && doc.arg?.name === "script" && job) args.push(`--out=${job}`);
    if (outDir) args.push(`--out=${outDir}`);
    for (const [name, v2] of options) {
      if (name === "script" || name === "out") continue;
      args.push(v2 === true ? `--${name}` : `--${name}=${v2}`);
    }
    return { command, args, scriptPath, job, outDir };
  }
  resolveJob(v2) {
    if (typeof v2 !== "string" || !v2.trim()) throw usage('"job" must be a job name or an absolute folder path');
    if (path__namespace.isAbsolute(v2)) return this.inWorkspace(v2, "job");
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(v2)) {
      throw usage(`Job name "${v2}" may only use letters, digits, ".", "_" and "-"`, "Or pass an absolute folder path inside the workspace.");
    }
    return this.inWorkspace(path__namespace.join(this.dirs.jobs, v2), "job");
  }
  // ── run execution ──
  pump() {
    while (!this.stopping && this.heavyRunning < this.concurrency && this.queue.length) {
      const run = this.queue.shift();
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
        this.lightWaiters.shift()();
      }
    }
  }
  /** A light slot for work outside runs (GET /v1/doctor). Resolves to its release function. */
  acquireLight() {
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
  start(run) {
    const rec = run.rec;
    rec.status = "running";
    rec.startedAt = (/* @__PURE__ */ new Date()).toISOString();
    if (!fs__namespace.existsSync(this.cliPath)) {
      this.finish(run, null, null, index.failure(rec.command, new index.AgentError("INTERNAL", `NaraScreen CLI not found at ${this.cliPath}`, {
        hint: "The server install is incomplete: bin/narascreen is missing next to api/."
      })));
      return;
    }
    const child = child_process.spawn(process.execPath, [this.cliPath, ...rec.args, "--events", "json"], {
      cwd: this.ws,
      env: this.childEnv(run.env),
      stdio: ["ignore", "pipe", "pipe"],
      // Own process group (POSIX) so cancel can signal the CLI, its browser and ffmpeg together.
      detached: process.platform !== "win32",
      windowsHide: true
    });
    run.child = child;
    run.env = void 0;
    rec.pid = child.pid;
    this.persist(run);
    this.addEvent(run, { type: "log", message: `started: ${rec.cli}`, data: { runStatus: "running", pid: child.pid } });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      if (run.stdout.length < narascreen.MAX_STDOUT) run.stdout += chunk;
    });
    const stderrLines = narascreen.createLineSplitter((line) => this.onStderrLine(run, line));
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => stderrLines.push(chunk));
    run.exited = new Promise((resolve) => {
      let exitTimer;
      const done = (code2, signal) => {
        clearTimeout(exitTimer);
        stderrLines.flush();
        this.finish(run, code2, signal);
        resolve();
      };
      child.once("close", done);
      child.once("exit", (code2, signal) => {
        exitTimer = setTimeout(() => {
          child.stdout?.destroy();
          child.stderr?.destroy();
          done(code2, signal);
        }, 2e3);
      });
      child.once("error", (err) => {
        this.finish(run, null, null, index.failure(rec.command, index.toAgentError(err)));
        resolve();
      });
    });
  }
  onStderrLine(run, raw) {
    const parsed = narascreen.parseStderrLine(raw);
    if (!parsed) return;
    if (parsed.kind === "event") {
      this.addEvent(run, parsed.event);
      return;
    }
    const line = parsed.line;
    run.stderrTail.push(redact(line, run.secrets));
    if (run.stderrTail.length > 40) run.stderrTail.shift();
    this.addEvent(run, { type: "log", message: line });
  }
  addEvent(run, input) {
    const ev = run.secrets.length ? redactJson(input, run.secrets) : input;
    if (run.rec.eventCount >= MAX_RUN_EVENTS && ev.type === "log") return;
    const data = ev.data && JSON.stringify(ev.data).length > narascreen.MAX_LINE * 4 ? { truncated: true } : ev.data;
    const full = {
      seq: ++run.rec.eventCount,
      ts: ev.ts ?? (/* @__PURE__ */ new Date()).toISOString(),
      type: ev.type,
      ...ev.stage ? { stage: ev.stage } : {},
      message: ev.message.length > narascreen.MAX_LINE ? `${ev.message.slice(0, narascreen.MAX_LINE)}… [truncated]` : ev.message,
      ...data ? { data } : {}
    };
    if (run.rec.eventCount === MAX_RUN_EVENTS) full.message += ` (event limit ${MAX_RUN_EVENTS} reached: further log lines are dropped)`;
    if (run.eventLogPath) {
      try {
        fs__namespace.appendFileSync(run.eventLogPath, JSON.stringify(full) + "\n");
      } catch {
        run.eventLogPath = void 0;
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
  finish(run, code2, signal, forced) {
    if (run.final) return;
    const rec = run.rec;
    clearTimeout(run.killTimer);
    const env = forced ?? narascreen.parseEnvelope(run.stdout);
    if (run.cancelReason && !(env?.ok && code2 === 0)) {
      rec.status = "cancelled";
      rec.outcome = index.failure(rec.command, new index.AgentError("CANCELLED", `Run cancelled. ${run.cancelReason}`, {
        hint: "Start it again with POST /v1/runs when you want the result.",
        details: { cancelled: true }
      }));
    } else if (env) {
      rec.status = env.ok ? "succeeded" : "failed";
      rec.outcome = env;
    } else {
      rec.status = "failed";
      rec.outcome = index.failure(rec.command, new index.AgentError("INTERNAL", `The command exited (${signal ? `signal ${signal}` : `code ${code2}`}) without printing a result`, {
        hint: "This is a NaraScreen bug or the process was killed. The last output lines are in details.",
        details: { exitCode: code2, signal, stderrTail: run.stderrTail.slice(-20), stdoutTail: run.stdout.slice(-2e3) }
      }));
    }
    if (run.secrets.length && rec.outcome) rec.outcome = redactJson(rec.outcome, run.secrets);
    run.secrets = [];
    if (code2 !== null) rec.exitCode = code2;
    if (signal) rec.signal = signal;
    rec.finishedAt = (/* @__PURE__ */ new Date()).toISOString();
    run.child = void 0;
    run.stdout = "";
    run.stderrTail = [];
    this.persist(run);
    run.eventLogPath = void 0;
    run.events = [];
    run.partial = true;
    const secs = rec.startedAt ? ((Date.parse(rec.finishedAt) - Date.parse(rec.startedAt)) / 1e3).toFixed(1) : "0";
    index.log(`run ${rec.runId}: ${rec.status} (${secs}s)`);
    run.bus.emit("end");
    if (run.slot === "heavy") this.heavyRunning--;
    if (run.slot === "light") this.lightRunning--;
    run.slot = void 0;
    this.pump();
    this.pruneRuns();
  }
  async cancel(run, reason) {
    if (run.final) return;
    run.cancelReason = reason;
    for (const q2 of [this.queue, this.lightQueue]) {
      const i = q2.indexOf(run);
      if (i >= 0) q2.splice(i, 1);
    }
    {
      if (!run.child) {
        this.finish(run, null, null);
        return;
      }
    }
    const child = run.child;
    narascreen.killTree(child, "SIGTERM");
    run.killTimer = setTimeout(() => narascreen.killTree(child, "SIGKILL"), narascreen.CANCEL_GRACE_MS);
    await Promise.race([run.exited, sleep(narascreen.CANCEL_GRACE_MS + 3e3)]);
    narascreen.killTree(child, "SIGKILL");
    if (!run.final) this.finish(run, null, "SIGKILL");
  }
  /** Environment of a CLI child: the server's, the client's `env` (already vetted),
   *  and markers so the CLI shapes `next` hints for HTTP callers. */
  childEnv(clientEnv) {
    return { ...process.env, ...clientEnv, NO_COLOR: "1", NARASCREEN_WORKSPACE: this.ws, NARASCREEN_CALLER: "http" };
  }
  /** One-shot CLI call (GET /v1/doctor): returns its envelope. */
  runCliOnce(args, timeoutMs, command) {
    return new Promise((resolve) => {
      if (!fs__namespace.existsSync(this.cliPath)) {
        resolve(index.failure(command, new index.AgentError("INTERNAL", `NaraScreen CLI not found at ${this.cliPath}`)));
        return;
      }
      const child = child_process.spawn(process.execPath, [this.cliPath, ...args, "--events", "json"], {
        cwd: this.ws,
        env: this.childEnv(),
        stdio: ["ignore", "pipe", "pipe"],
        detached: process.platform !== "win32",
        windowsHide: true
      });
      let stdout = "";
      let stderr = "";
      child.stdout.setEncoding("utf8").on("data", (c) => {
        if (stdout.length < narascreen.MAX_STDOUT) stdout += c;
      });
      child.stderr.setEncoding("utf8").on("data", (c) => stderr = (stderr + c).slice(-4e3));
      const timer = setTimeout(() => narascreen.killTree(child, "SIGKILL"), timeoutMs);
      child.once("error", (err) => {
        clearTimeout(timer);
        resolve(index.failure(command, index.toAgentError(err)));
      });
      child.once("close", (code2, signal) => {
        clearTimeout(timer);
        resolve(
          narascreen.parseEnvelope(stdout) ?? index.failure(command, new index.AgentError("INTERNAL", `${command} exited (${signal ? `signal ${signal}` : `code ${code2}`}) without a result`, {
            details: { stderrTail: stderr.split("\n").slice(-20) }
          }))
        );
      });
    });
  }
  // ── persistence ──
  newRunId() {
    const stamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
    let id;
    do
      id = `r_${stamp}-${crypto__namespace.randomBytes(2).toString("hex")}`;
    while (this.runs.has(id) || fs__namespace.existsSync(this.runPath(id)));
    return id;
  }
  runPath(id) {
    return path__namespace.join(this.dirs.runs, `${id}.json`);
  }
  eventsPath(id) {
    return path__namespace.join(this.dirs.runs, `${id}.events.ndjson`);
  }
  readRunRecord(file) {
    try {
      const rec = JSON.parse(fs__namespace.readFileSync(path__namespace.join(this.dirs.runs, file), "utf-8"));
      return rec.runId && RUN_ID_RE.test(rec.runId) && rec.command ? rec : void 0;
    } catch {
      return void 0;
    }
  }
  persist(run) {
    try {
      writeFileAtomic(this.runPath(run.rec.runId), JSON.stringify(run.rec, null, 2) + "\n");
    } catch (err) {
      index.warn(`Could not save run ${run.rec.runId}: ${index.toAgentError(err).message}`);
    }
  }
  pastEvents(run) {
    if (!run.partial) return run.events;
    try {
      return fs__namespace.readFileSync(this.eventsPath(run.rec.runId), "utf-8").split("\n").filter((l3) => l3.trim()).map((l3) => JSON.parse(l3));
    } catch {
      return [];
    }
  }
  /** Runs from earlier servers on this workspace: listable, replayable, and their folders stay downloadable. */
  loadRuns() {
    let files = [];
    try {
      files = fs__namespace.readdirSync(this.dirs.runs).filter((f) => f.endsWith(".json"));
    } catch {
      return;
    }
    files.sort().reverse();
    for (const f of files.slice(0, MAX_MEMORY_RUNS)) {
      const rec = this.readRunRecord(f);
      if (!rec) continue;
      const run = new Run(rec);
      run.partial = true;
      if (!run.final && (rec.serverPid === process.pid || !narascreen.isAlive(rec.serverPid))) {
        rec.status = "failed";
        rec.finishedAt = rec.finishedAt ?? (/* @__PURE__ */ new Date()).toISOString();
        rec.outcome = index.failure(rec.command, new index.AgentError("INTERNAL", "The server stopped before this run finished", {
          hint: "Start it again with POST /v1/runs."
        }));
        this.persist(run);
      }
      this.runs.set(rec.runId, run);
    }
  }
  // ── files ──
  async files({ req, res, url, base }) {
    const p = url.searchParams.get("path");
    if (!p) throw usage("Missing ?path=<file>", "Pass an absolute path from a run result, e.g. outcome.result.videos[0].path.");
    if (p.includes("\0")) throw usage("Invalid path");
    const abs = path__namespace.resolve(this.ws, p);
    if (!this.fileAllowed(abs)) {
      throw usage(`Not allowed: ${abs}`, `Only files inside the workspace (${this.ws}) can be downloaded.`, 403);
    }
    let real;
    try {
      real = fs__namespace.realpathSync(abs);
    } catch {
      throw usage(`No such file: ${abs}`, void 0, 404);
    }
    const st = fs__namespace.statSync(real);
    if (st.isDirectory()) {
      const entries = fs__namespace.readdirSync(real, { withFileTypes: true }).filter((d2) => d2.isFile() || d2.isDirectory()).map((d2) => {
        const full = path__namespace.join(abs, d2.name);
        const size = d2.isFile() ? safeSize(path__namespace.join(real, d2.name)) : void 0;
        return { name: d2.name, type: d2.isDirectory() ? "dir" : "file", ...size !== void 0 ? { size } : {}, url: `${base}/v1/files?path=${encodeURIComponent(full)}` };
      }).sort((a, b2) => a.type === b2.type ? a.name.localeCompare(b2.name) : a.type === "dir" ? -1 : 1);
      sendEnvelope(res, 200, index.success("files", { path: abs, entries }));
      return;
    }
    const uploadsDir = path__namespace.join(this.ws, "uploads");
    const inUploads = fs__namespace.existsSync(uploadsDir) && isInside(real, fs__namespace.realpathSync(uploadsDir));
    sendFile(req, res, real, st, inUploads && !INLINE_UPLOAD_EXTENSIONS.includes(path__namespace.extname(real).toLowerCase()));
  }
  /** PUT /v1/files: stream the raw body into <workspace>/uploads/<path>. */
  async upload({ req, res }) {
    const raw = (new URL(req.url ?? "/", "http://x").searchParams.get("path") ?? "").replace(/\\/g, "/");
    const hint = "Pass a relative name such as ?path=uploads/clip.mp3 (or clip.mp3); files always land in <workspace>/uploads/.";
    if (!raw) throw usage("Missing ?path=<relative path>", hint);
    if (path__namespace.isAbsolute(raw) || /^[A-Za-z]:/.test(raw)) throw usage(`Upload path must be relative: ${raw}`, hint);
    const parts = raw.split("/").filter(Boolean);
    if (parts[0] === "uploads") parts.shift();
    if (!parts.length || parts.some((p) => p === ".." || p.startsWith(".") || !/^[A-Za-z0-9._-]+$/.test(p))) {
      throw usage(`Invalid upload path: ${raw}`, `${hint} Use letters, digits, ".", "_" and "-" in names; no "..".`);
    }
    const tooBig = () => usage(`Upload larger than ${MAX_UPLOAD_BYTES / 1024 ** 3} GB`, void 0, 413);
    if (Number(req.headers["content-length"] ?? 0) > MAX_UPLOAD_BYTES) {
      req.resume();
      throw tooBig();
    }
    const uploads = path__namespace.join(this.ws, "uploads");
    fs__namespace.mkdirSync(uploads, { recursive: true });
    const dest = path__namespace.join(uploads, ...parts);
    const uploadsReal = fs__namespace.realpathSync(uploads);
    if (!isInside(realpathDeepest(dest), uploadsReal) || !isInside(realpathDeepest(path__namespace.dirname(dest)), uploadsReal)) {
      throw usage(`Upload path escapes ${uploads}: ${raw}`, hint);
    }
    fs__namespace.mkdirSync(path__namespace.dirname(dest), { recursive: true });
    const tmp = `${dest}.upload-${crypto__namespace.randomBytes(4).toString("hex")}`;
    const bytes = await new Promise((resolve, reject) => {
      const out = fs__namespace.createWriteStream(tmp, { flags: "wx" });
      let n = 0;
      const fail = (e) => {
        req.unpipe(out);
        out.destroy();
        fs__namespace.rmSync(tmp, { force: true });
        reject(e);
      };
      req.on("data", (c) => {
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
    fs__namespace.renameSync(tmp, dest);
    const relativePath = path__namespace.relative(this.ws, dest).split(path__namespace.sep).join("/");
    sendEnvelope(res, 200, index.success("files.upload", { path: dest, relativePath, bytes }, {
      next: [`Reference it in a script as "${relativePath}" (e.g. "music": {"path": "${relativePath}"}, or {"act": "upload", …, "files": "${relativePath}"}), then POST /v1/scripts`]
    }));
  }
  sendError(res, command, err) {
    if (res.headersSent) {
      res.destroy();
      return;
    }
    const e = index.toAgentError(err);
    const status = err instanceof HttpError ? err.status : httpStatusFor(e.code);
    if (status === 401) res.setHeader("WWW-Authenticate", 'Bearer realm="narascreen"');
    if (status === 413) res.setHeader("Connection", "close");
    this.sendRedacted(res, status, index.failure(command, e));
  }
}
function sendEnvelope(res, status, env) {
  sendText(res, status, "application/json", JSON.stringify(env, null, 2) + "\n");
}
function sendText(res, status, type, body) {
  res.writeHead(status, {
    "Content-Type": `${type}; charset=utf-8`,
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  res.end(body);
}
function readJson(req, allowed) {
  const tooBig = () => usage(`Request body is larger than ${MAX_BODY_BYTES / 1024 / 1024} MB`, "Send smaller scripts, or save large ones to disk and pass scriptPath.", 413);
  if (Number(req.headers["content-length"] ?? 0) > MAX_BODY_BYTES) {
    req.resume();
    return Promise.reject(tooBig());
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let failed = false;
    req.on("data", (c) => {
      if (failed) return;
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        failed = true;
        reject(tooBig());
        return;
      }
      chunks.push(c);
    });
    req.on("error", (err) => reject(index.toAgentError(err)));
    req.on("end", () => {
      if (failed) return;
      const text = Buffer.concat(chunks).toString("utf-8").trim();
      let body = {};
      if (text) {
        try {
          body = JSON.parse(text);
        } catch (e) {
          reject(usage(`Request body is not valid JSON: ${e.message}`, "Send a JSON object with Content-Type: application/json."));
          return;
        }
      }
      if (!isObject(body)) {
        reject(usage("Request body must be a JSON object"));
        return;
      }
      const unknown = Object.keys(body).filter((k2) => !allowed.includes(k2));
      if (unknown.length) {
        const hint = didYouMean(unknown[0], allowed);
        reject(usage(`Unknown field${unknown.length > 1 ? "s" : ""} ${unknown.map((k2) => `"${k2}"`).join(", ")}`, `${hint ? hint + " " : ""}Allowed: ${allowed.join(", ")}.`));
        return;
      }
      resolve(body);
    });
  });
}
const CONTENT_TYPES = {
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
  ".vtt": "text/vtt; charset=utf-8"
};
function sendFile(req, res, file, st, attachment = false) {
  const size = st.size;
  const headers = {
    "Content-Type": !attachment && CONTENT_TYPES[path__namespace.extname(file).toLowerCase()] || "application/octet-stream",
    "Accept-Ranges": "bytes",
    "Last-Modified": st.mtime.toUTCString(),
    "Cache-Control": "no-cache",
    "X-Content-Type-Options": "nosniff",
    // Job files are data, never an app: neutralize scripts in served HTML/SVG.
    "Content-Security-Policy": "sandbox",
    "Content-Disposition": `${attachment ? "attachment" : "inline"}; filename="${path__namespace.basename(file).replace(/[^\w.-]/g, "_")}"`
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
  const stream = fs__namespace.createReadStream(file, { start, end });
  stream.on("error", () => res.destroy());
  res.on("close", () => stream.destroy());
  stream.pipe(res);
}
function parseRange(header, size) {
  if (!header) return null;
  const m2 = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m2 || !m2[1] && !m2[2]) return null;
  let start;
  let end;
  if (!m2[1]) {
    const suffix = Number(m2[2]);
    if (suffix === 0) return "unsatisfiable";
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(m2[1]);
    end = m2[2] ? Math.min(Number(m2[2]), size - 1) : size - 1;
  }
  if (start >= size || start > end) return "unsatisfiable";
  return { start, end };
}
function links(runId) {
  return {
    self: `/v1/runs/${runId}`,
    events: `/v1/runs/${runId}/events`,
    wait: `/v1/runs/${runId}?wait=120`,
    cancel: `/v1/runs/${runId}/cancel`
  };
}
function parseRunOptions(doc, raw) {
  const out = /* @__PURE__ */ new Map();
  if (raw === void 0 || raw === null) return out;
  if (!isObject(raw)) throw usage('"options" must be an object of flag names to values, e.g. {"lang": "en,hi", "force": true}');
  const names = doc.flags.map((f) => f.name).filter((n) => !BLOCKED_RUN_OPTIONS.includes(n));
  for (const [key, value] of Object.entries(raw)) {
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
      const v2 = typeof value === "number" && Number.isFinite(value) ? String(value) : value;
      if (typeof v2 !== "string" || !v2.trim()) throw usage(`Option "${name}" must be a non-empty string`);
      out.set(name, v2);
    }
  }
  return out;
}
const MEDIA_EXT = /\.(mp4|webm|jpe?g|png)$/i;
const MEDIA_KEYS = ["path", "video", "contactSheet", "screenshot", "fullPageScreenshot", "recording"];
function mediaPaths(env) {
  const found = [];
  const rankOf = (p, key) => /(^|[\\/])final_[^\\/]*\.mp4$/.test(p) ? 0 : key === "contactSheet" ? 1 : /screenshot/i.test(key) ? 2 : 3;
  const walk = (v2, key) => {
    if (typeof v2 === "string") {
      if (MEDIA_KEYS.includes(key) && path__namespace.isAbsolute(v2) && MEDIA_EXT.test(v2) && !found.some((f) => f.p === v2)) {
        found.push({ p: v2, rank: rankOf(v2, key) });
      }
    } else if (Array.isArray(v2)) {
      if (key !== "frames") v2.forEach((x2) => walk(x2, key));
    } else if (isObject(v2)) {
      for (const [k2, x2] of Object.entries(v2)) walk(x2, k2);
    }
  };
  walk(env.result, "");
  walk(env.error?.details, "");
  return found.sort((a, b2) => a.rank - b2.rank).map((f) => f.p);
}
function mapScriptFiles(script, fn) {
  const one = (o, key, at) => {
    if (typeof o[key] === "string" && o[key]) o[key] = fn(o[key], at);
  };
  const audio = (o, at) => {
    if (isObject(o.audio)) for (const k2 of Object.keys(o.audio)) one(o.audio, k2, `${at}.audio.${k2}`);
    else one(o, "audio", `${at}.audio`);
  };
  if (script.storageState !== "__NONE__") one(script, "storageState", "storageState");
  if (isObject(script.source)) one(script.source, "video", "source.video");
  if (isObject(script.music)) one(script.music, "path", "music.path");
  if (isObject(script.intro)) one(script.intro, "logo", "intro.logo");
  if (isObject(script.outro)) one(script.outro, "logo", "outro.logo");
  const entries = [];
  if (Array.isArray(script.setup)) script.setup.forEach((e, i) => isObject(e) && entries.push([e, `setup[${i}]`]));
  if (Array.isArray(script.steps)) {
    script.steps.forEach((st, si) => {
      if (isObject(st) && Array.isArray(st.beat)) st.beat.forEach((e, i) => isObject(e) && entries.push([e, `steps[${si}].beat[${i}]`]));
    });
  }
  for (const [e, at] of entries) {
    if (e.act === "useSession") one(e, "storageState", `${at}.storageState`);
    if (e.act === "upload") {
      if (Array.isArray(e.files)) e.files.forEach((_2, k2) => one(e.files, String(k2), `${at}.files[${k2}]`));
      else one(e, "files", `${at}.files[0]`);
    }
    audio(e, at);
    if (Array.isArray(e.targets)) e.targets.forEach((t, k2) => isObject(t) && audio(t, `${at}.targets[${k2}]`));
  }
}
function checkScriptUrls(script) {
  const issues = [];
  const check = (u, at) => {
    if (typeof u === "string" && !/^https?:\/\//i.test(u)) issues.push({ path: at, message: `must be an http(s) URL over HTTP: ${u}` });
  };
  const s = script;
  check(s.baseUrl ?? "http://", "baseUrl");
  if (isObject(s.tts)) check(s.tts.kokoroEndpoint ?? "http://", "tts.kokoroEndpoint");
  const acts = [
    ...Array.isArray(s.setup) ? s.setup.map((e, i) => [e, `setup[${i}]`]) : [],
    ...Array.isArray(s.steps) ? s.steps.flatMap((st, si) => isObject(st) && Array.isArray(st.beat) ? st.beat.map((e, i) => [e, `steps[${si}].beat[${i}]`]) : []) : []
  ];
  for (const [e, at] of acts) if (isObject(e) && e.act === "goto" && e.url !== void 0) check(e.url, `${at}.url`);
  if (issues.length) {
    throw new index.AgentError("SCRIPT_INVALID", `${issues.length} URL(s) not allowed. First: ${issues[0].path}: ${issues[0].message}`, {
      hint: "Use http:// or https:// URLs.",
      where: { path: issues[0].path },
      details: { issues }
    });
  }
}
function quietJsonErrors(fn) {
  try {
    return fn();
  } catch (e) {
    if (e instanceof index.AgentError && e.code === "SCRIPT_INVALID_JSON") {
      throw new index.AgentError(e.code, e.message.split(": ")[0], { hint: e.hint, where: e.where });
    }
    if (e instanceof index.AgentError && e.code === "ENV_VAR_MISSING") {
      const names = (e.details?.variables ?? ["NAME"]).map((n) => `"${n}": "…"`).join(", ");
      throw new index.AgentError(e.code, e.message, {
        hint: `Over HTTP, send the values with the request: "env": {${names}} (they are used for this request only and never stored).`,
        where: e.where,
        details: e.details
      });
    }
    throw e;
  }
}
const tooBusy = () => usage("Too many runs are waiting", "Wait for some to finish (GET /v1/runs?status=queued) or cancel them, then retry.", 429);
function sanitizeName(v2) {
  if (typeof v2 !== "string" || !v2.trim()) throw usage('"name" is required, e.g. "my-demo"');
  const name = nameFrom(v2.trim().replace(/\.demo-script\.json$|\.json$/i, ""), "");
  if (!name) throw usage(`"name" must contain letters or digits`);
  return name;
}
function nameFrom(text, fallback = "demo") {
  const n = text.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[.-]+/, "").replace(/-{2,}/g, "-").slice(0, 80).replace(/[.-]+$/, "");
  return n || fallback;
}
function printable(args) {
  const q2 = (s) => /^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`;
  return ["narascreen", ...args].map(q2).join(" ");
}
function didYouMean(word, options) {
  const w2 = word.toLowerCase();
  const best = options.map((o) => ({ o, d: levenshtein(w2, o.toLowerCase()) })).sort((a, b2) => a.d - b2.d)[0];
  return best && best.d <= Math.max(2, Math.floor(word.length / 3)) ? `Did you mean "${best.o}"?` : void 0;
}
function levenshtein(a, b2) {
  const dp = Array.from({ length: b2.length + 1 }, (_2, j2) => j2);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j2 = 1; j2 <= b2.length; j2++) {
      const tmp = dp[j2];
      dp[j2] = Math.min(dp[j2] + 1, dp[j2 - 1] + 1, prev + (a[i - 1] === b2[j2 - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b2.length];
}
function safeDecode(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    throw usage(`Malformed URL escape in "${s}"`);
  }
}
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms).unref());
}
function isInside(p, root) {
  const rel = path__namespace.relative(root, p);
  return rel === "" || !rel.startsWith(`..${path__namespace.sep}`) && rel !== ".." && !path__namespace.isAbsolute(rel);
}
function realpathDeepest(p) {
  const rest = [];
  let cur = path__namespace.resolve(p);
  for (; ; ) {
    try {
      return path__namespace.join(fs__namespace.realpathSync(cur), ...rest);
    } catch {
      const parent = path__namespace.dirname(cur);
      if (parent === cur) return path__namespace.resolve(p);
      rest.unshift(path__namespace.basename(cur));
      cur = parent;
    }
  }
}
function safeSize(p) {
  try {
    return fs__namespace.statSync(p).size;
  } catch {
    return void 0;
  }
}
function writeFileAtomic(file, text) {
  fs__namespace.mkdirSync(path__namespace.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${crypto__namespace.randomBytes(3).toString("hex")}`;
  fs__namespace.writeFileSync(tmp, text);
  fs__namespace.renameSync(tmp, file);
}
function safeEqual(a, b2) {
  const ha = crypto__namespace.createHash("sha256").update(a).digest();
  const hb = crypto__namespace.createHash("sha256").update(b2).digest();
  return crypto__namespace.timingSafeEqual(ha, hb);
}
function isObject(v2) {
  return !!v2 && typeof v2 === "object" && !Array.isArray(v2);
}
function isIpLiteral(host) {
  const h = host.replace(/^\[|\]$/g, "");
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(h) || h.includes(":") && /^[0-9a-f:.]+$/i.test(h);
}
function isLoopbackHost(host) {
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  return h === "localhost" || h.endsWith(".localhost") || h === "::1" || /^127\.\d+\.\d+\.\d+$/.test(h);
}
function hostnameOf(hostHeader) {
  const m2 = /^\[([^\]]+)\](?::\d+)?$/.exec(hostHeader);
  if (m2) return m2[1];
  return hostHeader.replace(/:\d+$/, "");
}
function urlHost(host) {
  if (host === "0.0.0.0" || host === "") return "127.0.0.1";
  if (host === "::") return "[::1]";
  return host.includes(":") ? `[${host}]` : host;
}
function readVersion() {
  return narascreen.narascreenVersion(path__namespace.join(__dirname, ".."));
}
const __narascreen_req0 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  BLOCKED_RUN_OPTIONS,
  CANCEL_GRACE_MS: narascreen.CANCEL_GRACE_MS,
  DEFAULT_HOST,
  DEFAULT_PORT,
  HEARTBEAT_SEC,
  INLINE_UPLOAD_EXTENSIONS,
  LIGHT_CONCURRENCY,
  MAX_BODY_BYTES,
  MAX_MEMORY_EVENTS,
  MAX_MEMORY_RUNS,
  MAX_QUEUED_RUNS,
  MAX_RUN_EVENTS,
  MAX_UPLOAD_BYTES,
  MAX_WAIT_SEC,
  ROUTES,
  RUN_COMMANDS,
  cleanWorkspaceCache,
  httpStatusFor,
  startServer
}, Symbol.toStringTag, { value: "Module" }));
function L() {
  return { async: false, breaks: false, extensions: null, gfm: true, hooks: null, pedantic: false, renderer: null, silent: false, tokenizer: null, walkTokens: null };
}
var T = L();
function G(l3) {
  T = l3;
}
var E = { exec: () => null };
function d(l3, e = "") {
  let t = typeof l3 == "string" ? l3 : l3.source, n = { replace: (r, i) => {
    let s = typeof i == "string" ? i : i.source;
    return s = s.replace(m.caret, "$1"), t = t.replace(r, s), n;
  }, getRegex: () => new RegExp(t, e) };
  return n;
}
var be = (() => {
  try {
    return !!new RegExp("(?<=1)(?<!1)");
  } catch {
    return false;
  }
})(), m = { codeRemoveIndent: /^(?: {1,4}| {0,3}\t)/gm, outputLinkReplace: /\\([\[\]])/g, indentCodeCompensation: /^(\s+)(?:```)/, beginningSpace: /^\s+/, endingHash: /#$/, startingSpaceChar: /^ /, endingSpaceChar: / $/, nonSpaceChar: /[^ ]/, newLineCharGlobal: /\n/g, tabCharGlobal: /\t/g, multipleSpaceGlobal: /\s+/g, blankLine: /^[ \t]*$/, doubleBlankLine: /\n[ \t]*\n[ \t]*$/, blockquoteStart: /^ {0,3}>/, blockquoteSetextReplace: /\n {0,3}((?:=+|-+) *)(?=\n|$)/g, blockquoteSetextReplace2: /^ {0,3}>[ \t]?/gm, listReplaceTabs: /^\t+/, listReplaceNesting: /^ {1,4}(?=( {4})*[^ ])/g, listIsTask: /^\[[ xX]\] /, listReplaceTask: /^\[[ xX]\] +/, anyLine: /\n.*\n/, hrefBrackets: /^<(.*)>$/, tableDelimiter: /[:|]/, tableAlignChars: /^\||\| *$/g, tableRowBlankLine: /\n[ \t]*$/, tableAlignRight: /^ *-+: *$/, tableAlignCenter: /^ *:-+: *$/, tableAlignLeft: /^ *:-+ *$/, startATag: /^<a /i, endATag: /^<\/a>/i, startPreScriptTag: /^<(pre|code|kbd|script)(\s|>)/i, endPreScriptTag: /^<\/(pre|code|kbd|script)(\s|>)/i, startAngleBracket: /^</, endAngleBracket: />$/, pedanticHrefTitle: /^([^'"]*[^\s])\s+(['"])(.*)\2/, unicodeAlphaNumeric: /[\p{L}\p{N}]/u, escapeTest: /[&<>"']/, escapeReplace: /[&<>"']/g, escapeTestNoEncode: /[<>"']|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/, escapeReplaceNoEncode: /[<>"']|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/g, unescapeTest: /&(#(?:\d+)|(?:#x[0-9A-Fa-f]+)|(?:\w+));?/ig, caret: /(^|[^\[])\^/g, percentDecode: /%25/g, findPipe: /\|/g, splitPipe: / \|/, slashPipe: /\\\|/g, carriageReturn: /\r\n|\r/g, spaceLine: /^ +$/gm, notSpaceStart: /^\S*/, endingNewline: /\n$/, listItemRegex: (l3) => new RegExp(`^( {0,3}${l3})((?:[	 ][^\\n]*)?(?:\\n|$))`), nextBulletRegex: (l3) => new RegExp(`^ {0,${Math.min(3, l3 - 1)}}(?:[*+-]|\\d{1,9}[.)])((?:[ 	][^\\n]*)?(?:\\n|$))`), hrRegex: (l3) => new RegExp(`^ {0,${Math.min(3, l3 - 1)}}((?:- *){3,}|(?:_ *){3,}|(?:\\* *){3,})(?:\\n+|$)`), fencesBeginRegex: (l3) => new RegExp(`^ {0,${Math.min(3, l3 - 1)}}(?:\`\`\`|~~~)`), headingBeginRegex: (l3) => new RegExp(`^ {0,${Math.min(3, l3 - 1)}}#`), htmlBeginRegex: (l3) => new RegExp(`^ {0,${Math.min(3, l3 - 1)}}<(?:[a-z].*>|!--)`, "i") }, Re = /^(?:[ \t]*(?:\n|$))+/, Te = /^((?: {4}| {0,3}\t)[^\n]+(?:\n(?:[ \t]*(?:\n|$))*)?)+/, Oe = /^ {0,3}(`{3,}(?=[^`\n]*(?:\n|$))|~{3,})([^\n]*)(?:\n|$)(?:|([\s\S]*?)(?:\n|$))(?: {0,3}\1[~`]* *(?=\n|$)|$)/, I = /^ {0,3}((?:-[\t ]*){3,}|(?:_[ \t]*){3,}|(?:\*[ \t]*){3,})(?:\n+|$)/, we = /^ {0,3}(#{1,6})(?=\s|$)(.*)(?:\n+|$)/, F = /(?:[*+-]|\d{1,9}[.)])/, ie = /^(?!bull |blockCode|fences|blockquote|heading|html|table)((?:.|\n(?!\s*?\n|bull |blockCode|fences|blockquote|heading|html|table))+?)\n {0,3}(=+|-+) *(?:\n+|$)/, oe = d(ie).replace(/bull/g, F).replace(/blockCode/g, /(?: {4}| {0,3}\t)/).replace(/fences/g, / {0,3}(?:`{3,}|~{3,})/).replace(/blockquote/g, / {0,3}>/).replace(/heading/g, / {0,3}#{1,6}/).replace(/html/g, / {0,3}<[^\n>]+>\n/).replace(/\|table/g, "").getRegex(), ye = d(ie).replace(/bull/g, F).replace(/blockCode/g, /(?: {4}| {0,3}\t)/).replace(/fences/g, / {0,3}(?:`{3,}|~{3,})/).replace(/blockquote/g, / {0,3}>/).replace(/heading/g, / {0,3}#{1,6}/).replace(/html/g, / {0,3}<[^\n>]+>\n/).replace(/table/g, / {0,3}\|?(?:[:\- ]*\|)+[\:\- ]*\n/).getRegex(), j = /^([^\n]+(?:\n(?!hr|heading|lheading|blockquote|fences|list|html|table| +\n)[^\n]+)*)/, Pe = /^[^\n]+/, Q = /(?!\s*\])(?:\\[\s\S]|[^\[\]\\])+/, Se = d(/^ {0,3}\[(label)\]: *(?:\n[ \t]*)?([^<\s][^\s]*|<.*?>)(?:(?: +(?:\n[ \t]*)?| *\n[ \t]*)(title))? *(?:\n+|$)/).replace("label", Q).replace("title", /(?:"(?:\\"?|[^"\\])*"|'[^'\n]*(?:\n[^'\n]+)*\n?'|\([^()]*\))/).getRegex(), $e = d(/^( {0,3}bull)([ \t][^\n]+?)?(?:\n|$)/).replace(/bull/g, F).getRegex(), v = "address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|meta|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul", U = /<!--(?:-?>|[\s\S]*?(?:-->|$))/, _e = d("^ {0,3}(?:<(script|pre|style|textarea)[\\s>][\\s\\S]*?(?:</\\1>[^\\n]*\\n+|$)|comment[^\\n]*(\\n+|$)|<\\?[\\s\\S]*?(?:\\?>\\n*|$)|<![A-Z][\\s\\S]*?(?:>\\n*|$)|<!\\[CDATA\\[[\\s\\S]*?(?:\\]\\]>\\n*|$)|</?(tag)(?: +|\\n|/?>)[\\s\\S]*?(?:(?:\\n[ 	]*)+\\n|$)|<(?!script|pre|style|textarea)([a-z][\\w-]*)(?:attribute)*? */?>(?=[ \\t]*(?:\\n|$))[\\s\\S]*?(?:(?:\\n[ 	]*)+\\n|$)|</(?!script|pre|style|textarea)[a-z][\\w-]*\\s*>(?=[ \\t]*(?:\\n|$))[\\s\\S]*?(?:(?:\\n[ 	]*)+\\n|$))", "i").replace("comment", U).replace("tag", v).replace("attribute", / +[a-zA-Z:_][\w.:-]*(?: *= *"[^"\n]*"| *= *'[^'\n]*'| *= *[^\s"'=<>`]+)?/).getRegex(), ae = d(j).replace("hr", I).replace("heading", " {0,3}#{1,6}(?:\\s|$)").replace("|lheading", "").replace("|table", "").replace("blockquote", " {0,3}>").replace("fences", " {0,3}(?:`{3,}(?=[^`\\n]*\\n)|~{3,})[^\\n]*\\n").replace("list", " {0,3}(?:[*+-]|1[.)]) ").replace("html", "</?(?:tag)(?: +|\\n|/?>)|<(?:script|pre|style|textarea|!--)").replace("tag", v).getRegex(), Le = d(/^( {0,3}> ?(paragraph|[^\n]*)(?:\n|$))+/).replace("paragraph", ae).getRegex(), K = { blockquote: Le, code: Te, def: Se, fences: Oe, heading: we, hr: I, html: _e, lheading: oe, list: $e, newline: Re, paragraph: ae, table: E, text: Pe }, re = d("^ *([^\\n ].*)\\n {0,3}((?:\\| *)?:?-+:? *(?:\\| *:?-+:? *)*(?:\\| *)?)(?:\\n((?:(?! *\\n|hr|heading|blockquote|code|fences|list|html).*(?:\\n|$))*)\\n*|$)").replace("hr", I).replace("heading", " {0,3}#{1,6}(?:\\s|$)").replace("blockquote", " {0,3}>").replace("code", "(?: {4}| {0,3}	)[^\\n]").replace("fences", " {0,3}(?:`{3,}(?=[^`\\n]*\\n)|~{3,})[^\\n]*\\n").replace("list", " {0,3}(?:[*+-]|1[.)]) ").replace("html", "</?(?:tag)(?: +|\\n|/?>)|<(?:script|pre|style|textarea|!--)").replace("tag", v).getRegex(), Me = { ...K, lheading: ye, table: re, paragraph: d(j).replace("hr", I).replace("heading", " {0,3}#{1,6}(?:\\s|$)").replace("|lheading", "").replace("table", re).replace("blockquote", " {0,3}>").replace("fences", " {0,3}(?:`{3,}(?=[^`\\n]*\\n)|~{3,})[^\\n]*\\n").replace("list", " {0,3}(?:[*+-]|1[.)]) ").replace("html", "</?(?:tag)(?: +|\\n|/?>)|<(?:script|pre|style|textarea|!--)").replace("tag", v).getRegex() }, ze = { ...K, html: d(`^ *(?:comment *(?:\\n|\\s*$)|<(tag)[\\s\\S]+?</\\1> *(?:\\n{2,}|\\s*$)|<tag(?:"[^"]*"|'[^']*'|\\s[^'"/>\\s]*)*?/?> *(?:\\n{2,}|\\s*$))`).replace("comment", U).replace(/tag/g, "(?!(?:a|em|strong|small|s|cite|q|dfn|abbr|data|time|code|var|samp|kbd|sub|sup|i|b|u|mark|ruby|rt|rp|bdi|bdo|span|br|wbr|ins|del|img)\\b)\\w+(?!:|[^\\w\\s@]*@)\\b").getRegex(), def: /^ *\[([^\]]+)\]: *<?([^\s>]+)>?(?: +(["(][^\n]+[")]))? *(?:\n+|$)/, heading: /^(#{1,6})(.*)(?:\n+|$)/, fences: E, lheading: /^(.+?)\n {0,3}(=+|-+) *(?:\n+|$)/, paragraph: d(j).replace("hr", I).replace("heading", ` *#{1,6} *[^
]`).replace("lheading", oe).replace("|table", "").replace("blockquote", " {0,3}>").replace("|fences", "").replace("|list", "").replace("|html", "").replace("|tag", "").getRegex() }, Ae = /^\\([!"#$%&'()*+,\-./:;<=>?@\[\]\\^_`{|}~])/, Ee = /^(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/, le = /^( {2,}|\\)\n(?!\s*$)/, Ie = /^(`+|[^`])(?:(?= {2,}\n)|[\s\S]*?(?:(?=[\\<!\[`*_]|\b_|$)|[^ ](?= {2,}\n)))/, D = /[\p{P}\p{S}]/u, W = /[\s\p{P}\p{S}]/u, ue = /[^\s\p{P}\p{S}]/u, Ce = d(/^((?![*_])punctSpace)/, "u").replace(/punctSpace/g, W).getRegex(), pe = /(?!~)[\p{P}\p{S}]/u, Be = /(?!~)[\s\p{P}\p{S}]/u, qe = /(?:[^\s\p{P}\p{S}]|~)/u, ve = d(/link|precode-code|html/, "g").replace("link", /\[(?:[^\[\]`]|(?<a>`+)[^`]+\k<a>(?!`))*?\]\((?:\\[\s\S]|[^\\\(\)]|\((?:\\[\s\S]|[^\\\(\)])*\))*\)/).replace("precode-", be ? "(?<!`)()" : "(^^|[^`])").replace("code", /(?<b>`+)[^`]+\k<b>(?!`)/).replace("html", /<(?! )[^<>]*?>/).getRegex(), ce = /^(?:\*+(?:((?!\*)punct)|[^\s*]))|^_+(?:((?!_)punct)|([^\s_]))/, De = d(ce, "u").replace(/punct/g, D).getRegex(), He = d(ce, "u").replace(/punct/g, pe).getRegex(), he = "^[^_*]*?__[^_*]*?\\*[^_*]*?(?=__)|[^*]+(?=[^*])|(?!\\*)punct(\\*+)(?=[\\s]|$)|notPunctSpace(\\*+)(?!\\*)(?=punctSpace|$)|(?!\\*)punctSpace(\\*+)(?=notPunctSpace)|[\\s](\\*+)(?!\\*)(?=punct)|(?!\\*)punct(\\*+)(?!\\*)(?=punct)|notPunctSpace(\\*+)(?=notPunctSpace)", Ze = d(he, "gu").replace(/notPunctSpace/g, ue).replace(/punctSpace/g, W).replace(/punct/g, D).getRegex(), Ge = d(he, "gu").replace(/notPunctSpace/g, qe).replace(/punctSpace/g, Be).replace(/punct/g, pe).getRegex(), Ne = d("^[^_*]*?\\*\\*[^_*]*?_[^_*]*?(?=\\*\\*)|[^_]+(?=[^_])|(?!_)punct(_+)(?=[\\s]|$)|notPunctSpace(_+)(?!_)(?=punctSpace|$)|(?!_)punctSpace(_+)(?=notPunctSpace)|[\\s](_+)(?!_)(?=punct)|(?!_)punct(_+)(?!_)(?=punct)", "gu").replace(/notPunctSpace/g, ue).replace(/punctSpace/g, W).replace(/punct/g, D).getRegex(), Fe = d(/\\(punct)/, "gu").replace(/punct/g, D).getRegex(), je = d(/^<(scheme:[^\s\x00-\x1f<>]*|email)>/).replace("scheme", /[a-zA-Z][a-zA-Z0-9+.-]{1,31}/).replace("email", /[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+(@)[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+(?![-_])/).getRegex(), Qe = d(U).replace("(?:-->|$)", "-->").getRegex(), Ue = d("^comment|^</[a-zA-Z][\\w:-]*\\s*>|^<[a-zA-Z][\\w-]*(?:attribute)*?\\s*/?>|^<\\?[\\s\\S]*?\\?>|^<![a-zA-Z]+\\s[\\s\\S]*?>|^<!\\[CDATA\\[[\\s\\S]*?\\]\\]>").replace("comment", Qe).replace("attribute", /\s+[a-zA-Z:_][\w.:-]*(?:\s*=\s*"[^"]*"|\s*=\s*'[^']*'|\s*=\s*[^\s"'=<>`]+)?/).getRegex(), q = /(?:\[(?:\\[\s\S]|[^\[\]\\])*\]|\\[\s\S]|`+[^`]*?`+(?!`)|[^\[\]\\`])*?/, Ke = d(/^!?\[(label)\]\(\s*(href)(?:(?:[ \t]*(?:\n[ \t]*)?)(title))?\s*\)/).replace("label", q).replace("href", /<(?:\\.|[^\n<>\\])+>|[^ \t\n\x00-\x1f]*/).replace("title", /"(?:\\"?|[^"\\])*"|'(?:\\'?|[^'\\])*'|\((?:\\\)?|[^)\\])*\)/).getRegex(), de = d(/^!?\[(label)\]\[(ref)\]/).replace("label", q).replace("ref", Q).getRegex(), ke = d(/^!?\[(ref)\](?:\[\])?/).replace("ref", Q).getRegex(), We = d("reflink|nolink(?!\\()", "g").replace("reflink", de).replace("nolink", ke).getRegex(), se = /[hH][tT][tT][pP][sS]?|[fF][tT][pP]/, X = { _backpedal: E, anyPunctuation: Fe, autolink: je, blockSkip: ve, br: le, code: Ee, del: E, emStrongLDelim: De, emStrongRDelimAst: Ze, emStrongRDelimUnd: Ne, escape: Ae, link: Ke, nolink: ke, punctuation: Ce, reflink: de, reflinkSearch: We, tag: Ue, text: Ie, url: E }, Xe = { ...X, link: d(/^!?\[(label)\]\((.*?)\)/).replace("label", q).getRegex(), reflink: d(/^!?\[(label)\]\s*\[([^\]]*)\]/).replace("label", q).getRegex() }, N = { ...X, emStrongRDelimAst: Ge, emStrongLDelim: He, url: d(/^((?:protocol):\/\/|www\.)(?:[a-zA-Z0-9\-]+\.?)+[^\s<]*|^email/).replace("protocol", se).replace("email", /[A-Za-z0-9._+-]+(@)[a-zA-Z0-9-_]+(?:\.[a-zA-Z0-9-_]*[a-zA-Z0-9])+(?![-_])/).getRegex(), _backpedal: /(?:[^?!.,:;*_'"~()&]+|\([^)]*\)|&(?![a-zA-Z0-9]+;$)|[?!.,:;*_'"~)]+(?!$))+/, del: /^(~~?)(?=[^\s~])((?:\\[\s\S]|[^\\])*?(?:\\[\s\S]|[^\s~\\]))\1(?=[^~]|$)/, text: d(/^([`~]+|[^`~])(?:(?= {2,}\n)|(?=[a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-]+@)|[\s\S]*?(?:(?=[\\<!\[`*~_]|\b_|protocol:\/\/|www\.|$)|[^ ](?= {2,}\n)|[^a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-](?=[a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-]+@)))/).replace("protocol", se).getRegex() }, Je = { ...N, br: d(le).replace("{2,}", "*").getRegex(), text: d(N.text).replace("\\b_", "\\b_| {2,}\\n").replace(/\{2,\}/g, "*").getRegex() }, C = { normal: K, gfm: Me, pedantic: ze }, M = { normal: X, gfm: N, breaks: Je, pedantic: Xe };
var Ve = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }, ge = (l3) => Ve[l3];
function w(l3, e) {
  if (e) {
    if (m.escapeTest.test(l3)) return l3.replace(m.escapeReplace, ge);
  } else if (m.escapeTestNoEncode.test(l3)) return l3.replace(m.escapeReplaceNoEncode, ge);
  return l3;
}
function J(l3) {
  try {
    l3 = encodeURI(l3).replace(m.percentDecode, "%");
  } catch {
    return null;
  }
  return l3;
}
function V(l3, e) {
  let t = l3.replace(m.findPipe, (i, s, a) => {
    let o = false, p = s;
    for (; --p >= 0 && a[p] === "\\"; ) o = !o;
    return o ? "|" : " |";
  }), n = t.split(m.splitPipe), r = 0;
  if (n[0].trim() || n.shift(), n.length > 0 && !n.at(-1)?.trim() && n.pop(), e) if (n.length > e) n.splice(e);
  else for (; n.length < e; ) n.push("");
  for (; r < n.length; r++) n[r] = n[r].trim().replace(m.slashPipe, "|");
  return n;
}
function z(l3, e, t) {
  let n = l3.length;
  if (n === 0) return "";
  let r = 0;
  for (; r < n; ) {
    let i = l3.charAt(n - r - 1);
    if (i === e && true) r++;
    else break;
  }
  return l3.slice(0, n - r);
}
function fe(l3, e) {
  if (l3.indexOf(e[1]) === -1) return -1;
  let t = 0;
  for (let n = 0; n < l3.length; n++) if (l3[n] === "\\") n++;
  else if (l3[n] === e[0]) t++;
  else if (l3[n] === e[1] && (t--, t < 0)) return n;
  return t > 0 ? -2 : -1;
}
function me(l3, e, t, n, r) {
  let i = e.href, s = e.title || null, a = l3[1].replace(r.other.outputLinkReplace, "$1");
  n.state.inLink = true;
  let o = { type: l3[0].charAt(0) === "!" ? "image" : "link", raw: t, href: i, title: s, text: a, tokens: n.inlineTokens(a) };
  return n.state.inLink = false, o;
}
function Ye(l3, e, t) {
  let n = l3.match(t.other.indentCodeCompensation);
  if (n === null) return e;
  let r = n[1];
  return e.split(`
`).map((i) => {
    let s = i.match(t.other.beginningSpace);
    if (s === null) return i;
    let [a] = s;
    return a.length >= r.length ? i.slice(r.length) : i;
  }).join(`
`);
}
var y = class {
  options;
  rules;
  lexer;
  constructor(e) {
    this.options = e || T;
  }
  space(e) {
    let t = this.rules.block.newline.exec(e);
    if (t && t[0].length > 0) return { type: "space", raw: t[0] };
  }
  code(e) {
    let t = this.rules.block.code.exec(e);
    if (t) {
      let n = t[0].replace(this.rules.other.codeRemoveIndent, "");
      return { type: "code", raw: t[0], codeBlockStyle: "indented", text: this.options.pedantic ? n : z(n, `
`) };
    }
  }
  fences(e) {
    let t = this.rules.block.fences.exec(e);
    if (t) {
      let n = t[0], r = Ye(n, t[3] || "", this.rules);
      return { type: "code", raw: n, lang: t[2] ? t[2].trim().replace(this.rules.inline.anyPunctuation, "$1") : t[2], text: r };
    }
  }
  heading(e) {
    let t = this.rules.block.heading.exec(e);
    if (t) {
      let n = t[2].trim();
      if (this.rules.other.endingHash.test(n)) {
        let r = z(n, "#");
        (this.options.pedantic || !r || this.rules.other.endingSpaceChar.test(r)) && (n = r.trim());
      }
      return { type: "heading", raw: t[0], depth: t[1].length, text: n, tokens: this.lexer.inline(n) };
    }
  }
  hr(e) {
    let t = this.rules.block.hr.exec(e);
    if (t) return { type: "hr", raw: z(t[0], `
`) };
  }
  blockquote(e) {
    let t = this.rules.block.blockquote.exec(e);
    if (t) {
      let n = z(t[0], `
`).split(`
`), r = "", i = "", s = [];
      for (; n.length > 0; ) {
        let a = false, o = [], p;
        for (p = 0; p < n.length; p++) if (this.rules.other.blockquoteStart.test(n[p])) o.push(n[p]), a = true;
        else if (!a) o.push(n[p]);
        else break;
        n = n.slice(p);
        let u = o.join(`
`), c = u.replace(this.rules.other.blockquoteSetextReplace, `
    $1`).replace(this.rules.other.blockquoteSetextReplace2, "");
        r = r ? `${r}
${u}` : u, i = i ? `${i}
${c}` : c;
        let g = this.lexer.state.top;
        if (this.lexer.state.top = true, this.lexer.blockTokens(c, s, true), this.lexer.state.top = g, n.length === 0) break;
        let h = s.at(-1);
        if (h?.type === "code") break;
        if (h?.type === "blockquote") {
          let R = h, f = R.raw + `
` + n.join(`
`), O = this.blockquote(f);
          s[s.length - 1] = O, r = r.substring(0, r.length - R.raw.length) + O.raw, i = i.substring(0, i.length - R.text.length) + O.text;
          break;
        } else if (h?.type === "list") {
          let R = h, f = R.raw + `
` + n.join(`
`), O = this.list(f);
          s[s.length - 1] = O, r = r.substring(0, r.length - h.raw.length) + O.raw, i = i.substring(0, i.length - R.raw.length) + O.raw, n = f.substring(s.at(-1).raw.length).split(`
`);
          continue;
        }
      }
      return { type: "blockquote", raw: r, tokens: s, text: i };
    }
  }
  list(e) {
    let t = this.rules.block.list.exec(e);
    if (t) {
      let n = t[1].trim(), r = n.length > 1, i = { type: "list", raw: "", ordered: r, start: r ? +n.slice(0, -1) : "", loose: false, items: [] };
      n = r ? `\\d{1,9}\\${n.slice(-1)}` : `\\${n}`, this.options.pedantic && (n = r ? n : "[*+-]");
      let s = this.rules.other.listItemRegex(n), a = false;
      for (; e; ) {
        let p = false, u = "", c = "";
        if (!(t = s.exec(e)) || this.rules.block.hr.test(e)) break;
        u = t[0], e = e.substring(u.length);
        let g = t[2].split(`
`, 1)[0].replace(this.rules.other.listReplaceTabs, (H) => " ".repeat(3 * H.length)), h = e.split(`
`, 1)[0], R = !g.trim(), f = 0;
        if (this.options.pedantic ? (f = 2, c = g.trimStart()) : R ? f = t[1].length + 1 : (f = t[2].search(this.rules.other.nonSpaceChar), f = f > 4 ? 1 : f, c = g.slice(f), f += t[1].length), R && this.rules.other.blankLine.test(h) && (u += h + `
`, e = e.substring(h.length + 1), p = true), !p) {
          let H = this.rules.other.nextBulletRegex(f), ee = this.rules.other.hrRegex(f), te = this.rules.other.fencesBeginRegex(f), ne = this.rules.other.headingBeginRegex(f), xe = this.rules.other.htmlBeginRegex(f);
          for (; e; ) {
            let Z = e.split(`
`, 1)[0], A;
            if (h = Z, this.options.pedantic ? (h = h.replace(this.rules.other.listReplaceNesting, "  "), A = h) : A = h.replace(this.rules.other.tabCharGlobal, "    "), te.test(h) || ne.test(h) || xe.test(h) || H.test(h) || ee.test(h)) break;
            if (A.search(this.rules.other.nonSpaceChar) >= f || !h.trim()) c += `
` + A.slice(f);
            else {
              if (R || g.replace(this.rules.other.tabCharGlobal, "    ").search(this.rules.other.nonSpaceChar) >= 4 || te.test(g) || ne.test(g) || ee.test(g)) break;
              c += `
` + h;
            }
            !R && !h.trim() && (R = true), u += Z + `
`, e = e.substring(Z.length + 1), g = A.slice(f);
          }
        }
        i.loose || (a ? i.loose = true : this.rules.other.doubleBlankLine.test(u) && (a = true));
        let O = null, Y;
        this.options.gfm && (O = this.rules.other.listIsTask.exec(c), O && (Y = O[0] !== "[ ] ", c = c.replace(this.rules.other.listReplaceTask, ""))), i.items.push({ type: "list_item", raw: u, task: !!O, checked: Y, loose: false, text: c, tokens: [] }), i.raw += u;
      }
      let o = i.items.at(-1);
      if (o) o.raw = o.raw.trimEnd(), o.text = o.text.trimEnd();
      else return;
      i.raw = i.raw.trimEnd();
      for (let p = 0; p < i.items.length; p++) if (this.lexer.state.top = false, i.items[p].tokens = this.lexer.blockTokens(i.items[p].text, []), !i.loose) {
        let u = i.items[p].tokens.filter((g) => g.type === "space"), c = u.length > 0 && u.some((g) => this.rules.other.anyLine.test(g.raw));
        i.loose = c;
      }
      if (i.loose) for (let p = 0; p < i.items.length; p++) i.items[p].loose = true;
      return i;
    }
  }
  html(e) {
    let t = this.rules.block.html.exec(e);
    if (t) return { type: "html", block: true, raw: t[0], pre: t[1] === "pre" || t[1] === "script" || t[1] === "style", text: t[0] };
  }
  def(e) {
    let t = this.rules.block.def.exec(e);
    if (t) {
      let n = t[1].toLowerCase().replace(this.rules.other.multipleSpaceGlobal, " "), r = t[2] ? t[2].replace(this.rules.other.hrefBrackets, "$1").replace(this.rules.inline.anyPunctuation, "$1") : "", i = t[3] ? t[3].substring(1, t[3].length - 1).replace(this.rules.inline.anyPunctuation, "$1") : t[3];
      return { type: "def", tag: n, raw: t[0], href: r, title: i };
    }
  }
  table(e) {
    let t = this.rules.block.table.exec(e);
    if (!t || !this.rules.other.tableDelimiter.test(t[2])) return;
    let n = V(t[1]), r = t[2].replace(this.rules.other.tableAlignChars, "").split("|"), i = t[3]?.trim() ? t[3].replace(this.rules.other.tableRowBlankLine, "").split(`
`) : [], s = { type: "table", raw: t[0], header: [], align: [], rows: [] };
    if (n.length === r.length) {
      for (let a of r) this.rules.other.tableAlignRight.test(a) ? s.align.push("right") : this.rules.other.tableAlignCenter.test(a) ? s.align.push("center") : this.rules.other.tableAlignLeft.test(a) ? s.align.push("left") : s.align.push(null);
      for (let a = 0; a < n.length; a++) s.header.push({ text: n[a], tokens: this.lexer.inline(n[a]), header: true, align: s.align[a] });
      for (let a of i) s.rows.push(V(a, s.header.length).map((o, p) => ({ text: o, tokens: this.lexer.inline(o), header: false, align: s.align[p] })));
      return s;
    }
  }
  lheading(e) {
    let t = this.rules.block.lheading.exec(e);
    if (t) return { type: "heading", raw: t[0], depth: t[2].charAt(0) === "=" ? 1 : 2, text: t[1], tokens: this.lexer.inline(t[1]) };
  }
  paragraph(e) {
    let t = this.rules.block.paragraph.exec(e);
    if (t) {
      let n = t[1].charAt(t[1].length - 1) === `
` ? t[1].slice(0, -1) : t[1];
      return { type: "paragraph", raw: t[0], text: n, tokens: this.lexer.inline(n) };
    }
  }
  text(e) {
    let t = this.rules.block.text.exec(e);
    if (t) return { type: "text", raw: t[0], text: t[0], tokens: this.lexer.inline(t[0]) };
  }
  escape(e) {
    let t = this.rules.inline.escape.exec(e);
    if (t) return { type: "escape", raw: t[0], text: t[1] };
  }
  tag(e) {
    let t = this.rules.inline.tag.exec(e);
    if (t) return !this.lexer.state.inLink && this.rules.other.startATag.test(t[0]) ? this.lexer.state.inLink = true : this.lexer.state.inLink && this.rules.other.endATag.test(t[0]) && (this.lexer.state.inLink = false), !this.lexer.state.inRawBlock && this.rules.other.startPreScriptTag.test(t[0]) ? this.lexer.state.inRawBlock = true : this.lexer.state.inRawBlock && this.rules.other.endPreScriptTag.test(t[0]) && (this.lexer.state.inRawBlock = false), { type: "html", raw: t[0], inLink: this.lexer.state.inLink, inRawBlock: this.lexer.state.inRawBlock, block: false, text: t[0] };
  }
  link(e) {
    let t = this.rules.inline.link.exec(e);
    if (t) {
      let n = t[2].trim();
      if (!this.options.pedantic && this.rules.other.startAngleBracket.test(n)) {
        if (!this.rules.other.endAngleBracket.test(n)) return;
        let s = z(n.slice(0, -1), "\\");
        if ((n.length - s.length) % 2 === 0) return;
      } else {
        let s = fe(t[2], "()");
        if (s === -2) return;
        if (s > -1) {
          let o = (t[0].indexOf("!") === 0 ? 5 : 4) + t[1].length + s;
          t[2] = t[2].substring(0, s), t[0] = t[0].substring(0, o).trim(), t[3] = "";
        }
      }
      let r = t[2], i = "";
      if (this.options.pedantic) {
        let s = this.rules.other.pedanticHrefTitle.exec(r);
        s && (r = s[1], i = s[3]);
      } else i = t[3] ? t[3].slice(1, -1) : "";
      return r = r.trim(), this.rules.other.startAngleBracket.test(r) && (this.options.pedantic && !this.rules.other.endAngleBracket.test(n) ? r = r.slice(1) : r = r.slice(1, -1)), me(t, { href: r && r.replace(this.rules.inline.anyPunctuation, "$1"), title: i && i.replace(this.rules.inline.anyPunctuation, "$1") }, t[0], this.lexer, this.rules);
    }
  }
  reflink(e, t) {
    let n;
    if ((n = this.rules.inline.reflink.exec(e)) || (n = this.rules.inline.nolink.exec(e))) {
      let r = (n[2] || n[1]).replace(this.rules.other.multipleSpaceGlobal, " "), i = t[r.toLowerCase()];
      if (!i) {
        let s = n[0].charAt(0);
        return { type: "text", raw: s, text: s };
      }
      return me(n, i, n[0], this.lexer, this.rules);
    }
  }
  emStrong(e, t, n = "") {
    let r = this.rules.inline.emStrongLDelim.exec(e);
    if (!r || r[3] && n.match(this.rules.other.unicodeAlphaNumeric)) return;
    if (!(r[1] || r[2] || "") || !n || this.rules.inline.punctuation.exec(n)) {
      let s = [...r[0]].length - 1, a, o, p = s, u = 0, c = r[0][0] === "*" ? this.rules.inline.emStrongRDelimAst : this.rules.inline.emStrongRDelimUnd;
      for (c.lastIndex = 0, t = t.slice(-1 * e.length + s); (r = c.exec(t)) != null; ) {
        if (a = r[1] || r[2] || r[3] || r[4] || r[5] || r[6], !a) continue;
        if (o = [...a].length, r[3] || r[4]) {
          p += o;
          continue;
        } else if ((r[5] || r[6]) && s % 3 && !((s + o) % 3)) {
          u += o;
          continue;
        }
        if (p -= o, p > 0) continue;
        o = Math.min(o, o + p + u);
        let g = [...r[0]][0].length, h = e.slice(0, s + r.index + g + o);
        if (Math.min(s, o) % 2) {
          let f = h.slice(1, -1);
          return { type: "em", raw: h, text: f, tokens: this.lexer.inlineTokens(f) };
        }
        let R = h.slice(2, -2);
        return { type: "strong", raw: h, text: R, tokens: this.lexer.inlineTokens(R) };
      }
    }
  }
  codespan(e) {
    let t = this.rules.inline.code.exec(e);
    if (t) {
      let n = t[2].replace(this.rules.other.newLineCharGlobal, " "), r = this.rules.other.nonSpaceChar.test(n), i = this.rules.other.startingSpaceChar.test(n) && this.rules.other.endingSpaceChar.test(n);
      return r && i && (n = n.substring(1, n.length - 1)), { type: "codespan", raw: t[0], text: n };
    }
  }
  br(e) {
    let t = this.rules.inline.br.exec(e);
    if (t) return { type: "br", raw: t[0] };
  }
  del(e) {
    let t = this.rules.inline.del.exec(e);
    if (t) return { type: "del", raw: t[0], text: t[2], tokens: this.lexer.inlineTokens(t[2]) };
  }
  autolink(e) {
    let t = this.rules.inline.autolink.exec(e);
    if (t) {
      let n, r;
      return t[2] === "@" ? (n = t[1], r = "mailto:" + n) : (n = t[1], r = n), { type: "link", raw: t[0], text: n, href: r, tokens: [{ type: "text", raw: n, text: n }] };
    }
  }
  url(e) {
    let t;
    if (t = this.rules.inline.url.exec(e)) {
      let n, r;
      if (t[2] === "@") n = t[0], r = "mailto:" + n;
      else {
        let i;
        do
          i = t[0], t[0] = this.rules.inline._backpedal.exec(t[0])?.[0] ?? "";
        while (i !== t[0]);
        n = t[0], t[1] === "www." ? r = "http://" + t[0] : r = t[0];
      }
      return { type: "link", raw: t[0], text: n, href: r, tokens: [{ type: "text", raw: n, text: n }] };
    }
  }
  inlineText(e) {
    let t = this.rules.inline.text.exec(e);
    if (t) {
      let n = this.lexer.state.inRawBlock;
      return { type: "text", raw: t[0], text: t[0], escaped: n };
    }
  }
};
var x = class l {
  tokens;
  options;
  state;
  tokenizer;
  inlineQueue;
  constructor(e) {
    this.tokens = [], this.tokens.links = /* @__PURE__ */ Object.create(null), this.options = e || T, this.options.tokenizer = this.options.tokenizer || new y(), this.tokenizer = this.options.tokenizer, this.tokenizer.options = this.options, this.tokenizer.lexer = this, this.inlineQueue = [], this.state = { inLink: false, inRawBlock: false, top: true };
    let t = { other: m, block: C.normal, inline: M.normal };
    this.options.pedantic ? (t.block = C.pedantic, t.inline = M.pedantic) : this.options.gfm && (t.block = C.gfm, this.options.breaks ? t.inline = M.breaks : t.inline = M.gfm), this.tokenizer.rules = t;
  }
  static get rules() {
    return { block: C, inline: M };
  }
  static lex(e, t) {
    return new l(t).lex(e);
  }
  static lexInline(e, t) {
    return new l(t).inlineTokens(e);
  }
  lex(e) {
    e = e.replace(m.carriageReturn, `
`), this.blockTokens(e, this.tokens);
    for (let t = 0; t < this.inlineQueue.length; t++) {
      let n = this.inlineQueue[t];
      this.inlineTokens(n.src, n.tokens);
    }
    return this.inlineQueue = [], this.tokens;
  }
  blockTokens(e, t = [], n = false) {
    for (this.options.pedantic && (e = e.replace(m.tabCharGlobal, "    ").replace(m.spaceLine, "")); e; ) {
      let r;
      if (this.options.extensions?.block?.some((s) => (r = s.call({ lexer: this }, e, t)) ? (e = e.substring(r.raw.length), t.push(r), true) : false)) continue;
      if (r = this.tokenizer.space(e)) {
        e = e.substring(r.raw.length);
        let s = t.at(-1);
        r.raw.length === 1 && s !== void 0 ? s.raw += `
` : t.push(r);
        continue;
      }
      if (r = this.tokenizer.code(e)) {
        e = e.substring(r.raw.length);
        let s = t.at(-1);
        s?.type === "paragraph" || s?.type === "text" ? (s.raw += (s.raw.endsWith(`
`) ? "" : `
`) + r.raw, s.text += `
` + r.text, this.inlineQueue.at(-1).src = s.text) : t.push(r);
        continue;
      }
      if (r = this.tokenizer.fences(e)) {
        e = e.substring(r.raw.length), t.push(r);
        continue;
      }
      if (r = this.tokenizer.heading(e)) {
        e = e.substring(r.raw.length), t.push(r);
        continue;
      }
      if (r = this.tokenizer.hr(e)) {
        e = e.substring(r.raw.length), t.push(r);
        continue;
      }
      if (r = this.tokenizer.blockquote(e)) {
        e = e.substring(r.raw.length), t.push(r);
        continue;
      }
      if (r = this.tokenizer.list(e)) {
        e = e.substring(r.raw.length), t.push(r);
        continue;
      }
      if (r = this.tokenizer.html(e)) {
        e = e.substring(r.raw.length), t.push(r);
        continue;
      }
      if (r = this.tokenizer.def(e)) {
        e = e.substring(r.raw.length);
        let s = t.at(-1);
        s?.type === "paragraph" || s?.type === "text" ? (s.raw += (s.raw.endsWith(`
`) ? "" : `
`) + r.raw, s.text += `
` + r.raw, this.inlineQueue.at(-1).src = s.text) : this.tokens.links[r.tag] || (this.tokens.links[r.tag] = { href: r.href, title: r.title }, t.push(r));
        continue;
      }
      if (r = this.tokenizer.table(e)) {
        e = e.substring(r.raw.length), t.push(r);
        continue;
      }
      if (r = this.tokenizer.lheading(e)) {
        e = e.substring(r.raw.length), t.push(r);
        continue;
      }
      let i = e;
      if (this.options.extensions?.startBlock) {
        let s = 1 / 0, a = e.slice(1), o;
        this.options.extensions.startBlock.forEach((p) => {
          o = p.call({ lexer: this }, a), typeof o == "number" && o >= 0 && (s = Math.min(s, o));
        }), s < 1 / 0 && s >= 0 && (i = e.substring(0, s + 1));
      }
      if (this.state.top && (r = this.tokenizer.paragraph(i))) {
        let s = t.at(-1);
        n && s?.type === "paragraph" ? (s.raw += (s.raw.endsWith(`
`) ? "" : `
`) + r.raw, s.text += `
` + r.text, this.inlineQueue.pop(), this.inlineQueue.at(-1).src = s.text) : t.push(r), n = i.length !== e.length, e = e.substring(r.raw.length);
        continue;
      }
      if (r = this.tokenizer.text(e)) {
        e = e.substring(r.raw.length);
        let s = t.at(-1);
        s?.type === "text" ? (s.raw += (s.raw.endsWith(`
`) ? "" : `
`) + r.raw, s.text += `
` + r.text, this.inlineQueue.pop(), this.inlineQueue.at(-1).src = s.text) : t.push(r);
        continue;
      }
      if (e) {
        let s = "Infinite loop on byte: " + e.charCodeAt(0);
        if (this.options.silent) {
          console.error(s);
          break;
        } else throw new Error(s);
      }
    }
    return this.state.top = true, t;
  }
  inline(e, t = []) {
    return this.inlineQueue.push({ src: e, tokens: t }), t;
  }
  inlineTokens(e, t = []) {
    let n = e, r = null;
    if (this.tokens.links) {
      let o = Object.keys(this.tokens.links);
      if (o.length > 0) for (; (r = this.tokenizer.rules.inline.reflinkSearch.exec(n)) != null; ) o.includes(r[0].slice(r[0].lastIndexOf("[") + 1, -1)) && (n = n.slice(0, r.index) + "[" + "a".repeat(r[0].length - 2) + "]" + n.slice(this.tokenizer.rules.inline.reflinkSearch.lastIndex));
    }
    for (; (r = this.tokenizer.rules.inline.anyPunctuation.exec(n)) != null; ) n = n.slice(0, r.index) + "++" + n.slice(this.tokenizer.rules.inline.anyPunctuation.lastIndex);
    let i;
    for (; (r = this.tokenizer.rules.inline.blockSkip.exec(n)) != null; ) i = r[2] ? r[2].length : 0, n = n.slice(0, r.index + i) + "[" + "a".repeat(r[0].length - i - 2) + "]" + n.slice(this.tokenizer.rules.inline.blockSkip.lastIndex);
    n = this.options.hooks?.emStrongMask?.call({ lexer: this }, n) ?? n;
    let s = false, a = "";
    for (; e; ) {
      s || (a = ""), s = false;
      let o;
      if (this.options.extensions?.inline?.some((u) => (o = u.call({ lexer: this }, e, t)) ? (e = e.substring(o.raw.length), t.push(o), true) : false)) continue;
      if (o = this.tokenizer.escape(e)) {
        e = e.substring(o.raw.length), t.push(o);
        continue;
      }
      if (o = this.tokenizer.tag(e)) {
        e = e.substring(o.raw.length), t.push(o);
        continue;
      }
      if (o = this.tokenizer.link(e)) {
        e = e.substring(o.raw.length), t.push(o);
        continue;
      }
      if (o = this.tokenizer.reflink(e, this.tokens.links)) {
        e = e.substring(o.raw.length);
        let u = t.at(-1);
        o.type === "text" && u?.type === "text" ? (u.raw += o.raw, u.text += o.text) : t.push(o);
        continue;
      }
      if (o = this.tokenizer.emStrong(e, n, a)) {
        e = e.substring(o.raw.length), t.push(o);
        continue;
      }
      if (o = this.tokenizer.codespan(e)) {
        e = e.substring(o.raw.length), t.push(o);
        continue;
      }
      if (o = this.tokenizer.br(e)) {
        e = e.substring(o.raw.length), t.push(o);
        continue;
      }
      if (o = this.tokenizer.del(e)) {
        e = e.substring(o.raw.length), t.push(o);
        continue;
      }
      if (o = this.tokenizer.autolink(e)) {
        e = e.substring(o.raw.length), t.push(o);
        continue;
      }
      if (!this.state.inLink && (o = this.tokenizer.url(e))) {
        e = e.substring(o.raw.length), t.push(o);
        continue;
      }
      let p = e;
      if (this.options.extensions?.startInline) {
        let u = 1 / 0, c = e.slice(1), g;
        this.options.extensions.startInline.forEach((h) => {
          g = h.call({ lexer: this }, c), typeof g == "number" && g >= 0 && (u = Math.min(u, g));
        }), u < 1 / 0 && u >= 0 && (p = e.substring(0, u + 1));
      }
      if (o = this.tokenizer.inlineText(p)) {
        e = e.substring(o.raw.length), o.raw.slice(-1) !== "_" && (a = o.raw.slice(-1)), s = true;
        let u = t.at(-1);
        u?.type === "text" ? (u.raw += o.raw, u.text += o.text) : t.push(o);
        continue;
      }
      if (e) {
        let u = "Infinite loop on byte: " + e.charCodeAt(0);
        if (this.options.silent) {
          console.error(u);
          break;
        } else throw new Error(u);
      }
    }
    return t;
  }
};
var P = class {
  options;
  parser;
  constructor(e) {
    this.options = e || T;
  }
  space(e) {
    return "";
  }
  code({ text: e, lang: t, escaped: n }) {
    let r = (t || "").match(m.notSpaceStart)?.[0], i = e.replace(m.endingNewline, "") + `
`;
    return r ? '<pre><code class="language-' + w(r) + '">' + (n ? i : w(i, true)) + `</code></pre>
` : "<pre><code>" + (n ? i : w(i, true)) + `</code></pre>
`;
  }
  blockquote({ tokens: e }) {
    return `<blockquote>
${this.parser.parse(e)}</blockquote>
`;
  }
  html({ text: e }) {
    return e;
  }
  def(e) {
    return "";
  }
  heading({ tokens: e, depth: t }) {
    return `<h${t}>${this.parser.parseInline(e)}</h${t}>
`;
  }
  hr(e) {
    return `<hr>
`;
  }
  list(e) {
    let t = e.ordered, n = e.start, r = "";
    for (let a = 0; a < e.items.length; a++) {
      let o = e.items[a];
      r += this.listitem(o);
    }
    let i = t ? "ol" : "ul", s = t && n !== 1 ? ' start="' + n + '"' : "";
    return "<" + i + s + `>
` + r + "</" + i + `>
`;
  }
  listitem(e) {
    let t = "";
    if (e.task) {
      let n = this.checkbox({ checked: !!e.checked });
      e.loose ? e.tokens[0]?.type === "paragraph" ? (e.tokens[0].text = n + " " + e.tokens[0].text, e.tokens[0].tokens && e.tokens[0].tokens.length > 0 && e.tokens[0].tokens[0].type === "text" && (e.tokens[0].tokens[0].text = n + " " + w(e.tokens[0].tokens[0].text), e.tokens[0].tokens[0].escaped = true)) : e.tokens.unshift({ type: "text", raw: n + " ", text: n + " ", escaped: true }) : t += n + " ";
    }
    return t += this.parser.parse(e.tokens, !!e.loose), `<li>${t}</li>
`;
  }
  checkbox({ checked: e }) {
    return "<input " + (e ? 'checked="" ' : "") + 'disabled="" type="checkbox">';
  }
  paragraph({ tokens: e }) {
    return `<p>${this.parser.parseInline(e)}</p>
`;
  }
  table(e) {
    let t = "", n = "";
    for (let i = 0; i < e.header.length; i++) n += this.tablecell(e.header[i]);
    t += this.tablerow({ text: n });
    let r = "";
    for (let i = 0; i < e.rows.length; i++) {
      let s = e.rows[i];
      n = "";
      for (let a = 0; a < s.length; a++) n += this.tablecell(s[a]);
      r += this.tablerow({ text: n });
    }
    return r && (r = `<tbody>${r}</tbody>`), `<table>
<thead>
` + t + `</thead>
` + r + `</table>
`;
  }
  tablerow({ text: e }) {
    return `<tr>
${e}</tr>
`;
  }
  tablecell(e) {
    let t = this.parser.parseInline(e.tokens), n = e.header ? "th" : "td";
    return (e.align ? `<${n} align="${e.align}">` : `<${n}>`) + t + `</${n}>
`;
  }
  strong({ tokens: e }) {
    return `<strong>${this.parser.parseInline(e)}</strong>`;
  }
  em({ tokens: e }) {
    return `<em>${this.parser.parseInline(e)}</em>`;
  }
  codespan({ text: e }) {
    return `<code>${w(e, true)}</code>`;
  }
  br(e) {
    return "<br>";
  }
  del({ tokens: e }) {
    return `<del>${this.parser.parseInline(e)}</del>`;
  }
  link({ href: e, title: t, tokens: n }) {
    let r = this.parser.parseInline(n), i = J(e);
    if (i === null) return r;
    e = i;
    let s = '<a href="' + e + '"';
    return t && (s += ' title="' + w(t) + '"'), s += ">" + r + "</a>", s;
  }
  image({ href: e, title: t, text: n, tokens: r }) {
    r && (n = this.parser.parseInline(r, this.parser.textRenderer));
    let i = J(e);
    if (i === null) return w(n);
    e = i;
    let s = `<img src="${e}" alt="${n}"`;
    return t && (s += ` title="${w(t)}"`), s += ">", s;
  }
  text(e) {
    return "tokens" in e && e.tokens ? this.parser.parseInline(e.tokens) : "escaped" in e && e.escaped ? e.text : w(e.text);
  }
};
var $ = class {
  strong({ text: e }) {
    return e;
  }
  em({ text: e }) {
    return e;
  }
  codespan({ text: e }) {
    return e;
  }
  del({ text: e }) {
    return e;
  }
  html({ text: e }) {
    return e;
  }
  text({ text: e }) {
    return e;
  }
  link({ text: e }) {
    return "" + e;
  }
  image({ text: e }) {
    return "" + e;
  }
  br() {
    return "";
  }
};
var b = class l2 {
  options;
  renderer;
  textRenderer;
  constructor(e) {
    this.options = e || T, this.options.renderer = this.options.renderer || new P(), this.renderer = this.options.renderer, this.renderer.options = this.options, this.renderer.parser = this, this.textRenderer = new $();
  }
  static parse(e, t) {
    return new l2(t).parse(e);
  }
  static parseInline(e, t) {
    return new l2(t).parseInline(e);
  }
  parse(e, t = true) {
    let n = "";
    for (let r = 0; r < e.length; r++) {
      let i = e[r];
      if (this.options.extensions?.renderers?.[i.type]) {
        let a = i, o = this.options.extensions.renderers[a.type].call({ parser: this }, a);
        if (o !== false || !["space", "hr", "heading", "code", "table", "blockquote", "list", "html", "def", "paragraph", "text"].includes(a.type)) {
          n += o || "";
          continue;
        }
      }
      let s = i;
      switch (s.type) {
        case "space": {
          n += this.renderer.space(s);
          continue;
        }
        case "hr": {
          n += this.renderer.hr(s);
          continue;
        }
        case "heading": {
          n += this.renderer.heading(s);
          continue;
        }
        case "code": {
          n += this.renderer.code(s);
          continue;
        }
        case "table": {
          n += this.renderer.table(s);
          continue;
        }
        case "blockquote": {
          n += this.renderer.blockquote(s);
          continue;
        }
        case "list": {
          n += this.renderer.list(s);
          continue;
        }
        case "html": {
          n += this.renderer.html(s);
          continue;
        }
        case "def": {
          n += this.renderer.def(s);
          continue;
        }
        case "paragraph": {
          n += this.renderer.paragraph(s);
          continue;
        }
        case "text": {
          let a = s, o = this.renderer.text(a);
          for (; r + 1 < e.length && e[r + 1].type === "text"; ) a = e[++r], o += `
` + this.renderer.text(a);
          t ? n += this.renderer.paragraph({ type: "paragraph", raw: o, text: o, tokens: [{ type: "text", raw: o, text: o, escaped: true }] }) : n += o;
          continue;
        }
        default: {
          let a = 'Token with "' + s.type + '" type was not found.';
          if (this.options.silent) return console.error(a), "";
          throw new Error(a);
        }
      }
    }
    return n;
  }
  parseInline(e, t = this.renderer) {
    let n = "";
    for (let r = 0; r < e.length; r++) {
      let i = e[r];
      if (this.options.extensions?.renderers?.[i.type]) {
        let a = this.options.extensions.renderers[i.type].call({ parser: this }, i);
        if (a !== false || !["escape", "html", "link", "image", "strong", "em", "codespan", "br", "del", "text"].includes(i.type)) {
          n += a || "";
          continue;
        }
      }
      let s = i;
      switch (s.type) {
        case "escape": {
          n += t.text(s);
          break;
        }
        case "html": {
          n += t.html(s);
          break;
        }
        case "link": {
          n += t.link(s);
          break;
        }
        case "image": {
          n += t.image(s);
          break;
        }
        case "strong": {
          n += t.strong(s);
          break;
        }
        case "em": {
          n += t.em(s);
          break;
        }
        case "codespan": {
          n += t.codespan(s);
          break;
        }
        case "br": {
          n += t.br(s);
          break;
        }
        case "del": {
          n += t.del(s);
          break;
        }
        case "text": {
          n += t.text(s);
          break;
        }
        default: {
          let a = 'Token with "' + s.type + '" type was not found.';
          if (this.options.silent) return console.error(a), "";
          throw new Error(a);
        }
      }
    }
    return n;
  }
};
var S = class {
  options;
  block;
  constructor(e) {
    this.options = e || T;
  }
  static passThroughHooks = /* @__PURE__ */ new Set(["preprocess", "postprocess", "processAllTokens", "emStrongMask"]);
  static passThroughHooksRespectAsync = /* @__PURE__ */ new Set(["preprocess", "postprocess", "processAllTokens"]);
  preprocess(e) {
    return e;
  }
  postprocess(e) {
    return e;
  }
  processAllTokens(e) {
    return e;
  }
  emStrongMask(e) {
    return e;
  }
  provideLexer() {
    return this.block ? x.lex : x.lexInline;
  }
  provideParser() {
    return this.block ? b.parse : b.parseInline;
  }
};
var B = class {
  defaults = L();
  options = this.setOptions;
  parse = this.parseMarkdown(true);
  parseInline = this.parseMarkdown(false);
  Parser = b;
  Renderer = P;
  TextRenderer = $;
  Lexer = x;
  Tokenizer = y;
  Hooks = S;
  constructor(...e) {
    this.use(...e);
  }
  walkTokens(e, t) {
    let n = [];
    for (let r of e) switch (n = n.concat(t.call(this, r)), r.type) {
      case "table": {
        let i = r;
        for (let s of i.header) n = n.concat(this.walkTokens(s.tokens, t));
        for (let s of i.rows) for (let a of s) n = n.concat(this.walkTokens(a.tokens, t));
        break;
      }
      case "list": {
        let i = r;
        n = n.concat(this.walkTokens(i.items, t));
        break;
      }
      default: {
        let i = r;
        this.defaults.extensions?.childTokens?.[i.type] ? this.defaults.extensions.childTokens[i.type].forEach((s) => {
          let a = i[s].flat(1 / 0);
          n = n.concat(this.walkTokens(a, t));
        }) : i.tokens && (n = n.concat(this.walkTokens(i.tokens, t)));
      }
    }
    return n;
  }
  use(...e) {
    let t = this.defaults.extensions || { renderers: {}, childTokens: {} };
    return e.forEach((n) => {
      let r = { ...n };
      if (r.async = this.defaults.async || r.async || false, n.extensions && (n.extensions.forEach((i) => {
        if (!i.name) throw new Error("extension name required");
        if ("renderer" in i) {
          let s = t.renderers[i.name];
          s ? t.renderers[i.name] = function(...a) {
            let o = i.renderer.apply(this, a);
            return o === false && (o = s.apply(this, a)), o;
          } : t.renderers[i.name] = i.renderer;
        }
        if ("tokenizer" in i) {
          if (!i.level || i.level !== "block" && i.level !== "inline") throw new Error("extension level must be 'block' or 'inline'");
          let s = t[i.level];
          s ? s.unshift(i.tokenizer) : t[i.level] = [i.tokenizer], i.start && (i.level === "block" ? t.startBlock ? t.startBlock.push(i.start) : t.startBlock = [i.start] : i.level === "inline" && (t.startInline ? t.startInline.push(i.start) : t.startInline = [i.start]));
        }
        "childTokens" in i && i.childTokens && (t.childTokens[i.name] = i.childTokens);
      }), r.extensions = t), n.renderer) {
        let i = this.defaults.renderer || new P(this.defaults);
        for (let s in n.renderer) {
          if (!(s in i)) throw new Error(`renderer '${s}' does not exist`);
          if (["options", "parser"].includes(s)) continue;
          let a = s, o = n.renderer[a], p = i[a];
          i[a] = (...u) => {
            let c = o.apply(i, u);
            return c === false && (c = p.apply(i, u)), c || "";
          };
        }
        r.renderer = i;
      }
      if (n.tokenizer) {
        let i = this.defaults.tokenizer || new y(this.defaults);
        for (let s in n.tokenizer) {
          if (!(s in i)) throw new Error(`tokenizer '${s}' does not exist`);
          if (["options", "rules", "lexer"].includes(s)) continue;
          let a = s, o = n.tokenizer[a], p = i[a];
          i[a] = (...u) => {
            let c = o.apply(i, u);
            return c === false && (c = p.apply(i, u)), c;
          };
        }
        r.tokenizer = i;
      }
      if (n.hooks) {
        let i = this.defaults.hooks || new S();
        for (let s in n.hooks) {
          if (!(s in i)) throw new Error(`hook '${s}' does not exist`);
          if (["options", "block"].includes(s)) continue;
          let a = s, o = n.hooks[a], p = i[a];
          S.passThroughHooks.has(s) ? i[a] = (u) => {
            if (this.defaults.async && S.passThroughHooksRespectAsync.has(s)) return (async () => {
              let g = await o.call(i, u);
              return p.call(i, g);
            })();
            let c = o.call(i, u);
            return p.call(i, c);
          } : i[a] = (...u) => {
            if (this.defaults.async) return (async () => {
              let g = await o.apply(i, u);
              return g === false && (g = await p.apply(i, u)), g;
            })();
            let c = o.apply(i, u);
            return c === false && (c = p.apply(i, u)), c;
          };
        }
        r.hooks = i;
      }
      if (n.walkTokens) {
        let i = this.defaults.walkTokens, s = n.walkTokens;
        r.walkTokens = function(a) {
          let o = [];
          return o.push(s.call(this, a)), i && (o = o.concat(i.call(this, a))), o;
        };
      }
      this.defaults = { ...this.defaults, ...r };
    }), this;
  }
  setOptions(e) {
    return this.defaults = { ...this.defaults, ...e }, this;
  }
  lexer(e, t) {
    return x.lex(e, t ?? this.defaults);
  }
  parser(e, t) {
    return b.parse(e, t ?? this.defaults);
  }
  parseMarkdown(e) {
    return (n, r) => {
      let i = { ...r }, s = { ...this.defaults, ...i }, a = this.onError(!!s.silent, !!s.async);
      if (this.defaults.async === true && i.async === false) return a(new Error("marked(): The async option was set to true by an extension. Remove async: false from the parse options object to return a Promise."));
      if (typeof n > "u" || n === null) return a(new Error("marked(): input parameter is undefined or null"));
      if (typeof n != "string") return a(new Error("marked(): input parameter is of type " + Object.prototype.toString.call(n) + ", string expected"));
      if (s.hooks && (s.hooks.options = s, s.hooks.block = e), s.async) return (async () => {
        let o = s.hooks ? await s.hooks.preprocess(n) : n, u = await (s.hooks ? await s.hooks.provideLexer() : e ? x.lex : x.lexInline)(o, s), c = s.hooks ? await s.hooks.processAllTokens(u) : u;
        s.walkTokens && await Promise.all(this.walkTokens(c, s.walkTokens));
        let h = await (s.hooks ? await s.hooks.provideParser() : e ? b.parse : b.parseInline)(c, s);
        return s.hooks ? await s.hooks.postprocess(h) : h;
      })().catch(a);
      try {
        s.hooks && (n = s.hooks.preprocess(n));
        let p = (s.hooks ? s.hooks.provideLexer() : e ? x.lex : x.lexInline)(n, s);
        s.hooks && (p = s.hooks.processAllTokens(p)), s.walkTokens && this.walkTokens(p, s.walkTokens);
        let c = (s.hooks ? s.hooks.provideParser() : e ? b.parse : b.parseInline)(p, s);
        return s.hooks && (c = s.hooks.postprocess(c)), c;
      } catch (o) {
        return a(o);
      }
    };
  }
  onError(e, t) {
    return (n) => {
      if (n.message += `
Please report this to https://github.com/markedjs/marked.`, e) {
        let r = "<p>An error occurred:</p><pre>" + w(n.message + "", true) + "</pre>";
        return t ? Promise.resolve(r) : r;
      }
      if (t) return Promise.reject(n);
      throw n;
    };
  }
};
var _ = new B();
function k(l3, e) {
  return _.parse(l3, e);
}
k.options = k.setOptions = function(l3) {
  return _.setOptions(l3), k.defaults = _.defaults, G(k.defaults), k;
};
k.getDefaults = L;
k.defaults = T;
k.use = function(...l3) {
  return _.use(...l3), k.defaults = _.defaults, G(k.defaults), k;
};
k.walkTokens = function(l3, e) {
  return _.walkTokens(l3, e);
};
k.parseInline = _.parseInline;
k.Parser = b;
k.parser = b.parse;
k.Renderer = P;
k.TextRenderer = $;
k.Lexer = x;
k.lexer = x.lex;
k.Tokenizer = y;
k.Hooks = S;
k.parse = k;
k.options;
k.setOptions;
k.use;
k.walkTokens;
k.parseInline;
b.parse;
x.lex;
const server = () => __narascreen_req0;
const MANUAL_PATH = path__namespace.join(__dirname, "MANUAL.md");
const ASSETS_DIR = path__namespace.join(__dirname, "docs-assets");
function defaultBaseUrl() {
  const s = server();
  return `http://${s.DEFAULT_HOST}:${s.DEFAULT_PORT}`;
}
function buildManualMarkdown(opts = {}) {
  const fallback = defaultBaseUrl();
  const base = (opts.baseUrl ?? fallback).replace(/\/+$/, "");
  let manual = readManual();
  if (base !== fallback) manual = manual.split(fallback).join(base);
  return `${manual.trimEnd()}

${referenceMarkdown(base)}`;
}
function readManual() {
  try {
    return fs__namespace.readFileSync(MANUAL_PATH, "utf-8");
  } catch {
    return "# NaraScreen manual\n\n_api/MANUAL.md is missing — only the generated reference is available._\n";
  }
}
function buildLlmsTxt(baseUrl) {
  const b2 = baseUrl.replace(/\/+$/, "");
  return [
    "# NaraScreen",
    "",
    "> Local service that turns a JSON demo script (browser steps + video effects + narration) into a",
    "> narrated MP4 walkthrough of any website. You write the script; NaraScreen records, narrates and renders.",
    "",
    `Full manual (Markdown, everything you need): ${b2}/docs.md`,
    `Same manual as HTML: ${b2}/docs`,
    `Demo-script JSON Schema: ${b2}/v1/schema`,
    "",
    "## Quick start",
    "",
    `1. GET  ${b2}/v1/doctor — machine ready? (ffmpeg, browser, speech engine)`,
    `2. POST ${b2}/v1/runs {"command":"inspect","options":{"url":"<page>"}} — elements with ready-to-paste selectors`,
    `3. POST ${b2}/v1/scripts {"name":"my-demo","script":{…}} — validates + saves; fix error.details.issues`,
    `4. POST ${b2}/v1/runs {"command":"make","scriptPath":"<scriptPath>"} — then GET ${b2}/v1/runs/<runId>?wait=300`,
    `   or stream GET ${b2}/v1/runs/<runId>/events (SSE, ends with "end")`,
    `5. GET  ${b2}/v1/files?path=<outcome.result.videos[0].path> — the video (preview.contactSheet = frames to check)`,
    "",
    `Own files (voiceover, music, a video to edit, a file the demo uploads into the site — any type): PUT ${b2}/v1/files?path=uploads/<name>`,
    `with the raw bytes, then use result.relativePath in the script, e.g. {"act":"upload","role":"button","name":"Choose file","files":"uploads/<name>"}.`,
    "Note: check and inspect --until perform the script's actions for real (saves, uploads persist) — reset the site's data before make.",
    "",
    "Effects you can put in a script: narrate (voiceover), zoom, spotlight (optional padding, soft-edge feather, and converge: animated close-in from the whole screen), arrow (animated pointer, page stays bright; optional color, and highlight: a pencil loop around the element once it lands, optional highlightColor), callout (text label),",
    "blur (hide secrets), pause, speed, skip, mute. Field-by-field reference: /docs.md (generated from the schema).",
    'Title / end cards: "intro" and "outro" (template clean|bold|minimal, title, subtitle, cta, logo, narrate) are drawn and joined around the video. Plan first: an optional "plan" (audience, takeaway, hook, leaveOut, targetSec) makes validate warn when the script drifts.',
    'Flutter apps: add "plugins": {"flutter": {}} to record the app\'s web build as an Android phone (portrait video, taps, `swipe` act) — see "Flutter apps" in /docs.md.',
    "",
    "Every /v1 response is a JSON envelope { ok, command, result | error: { code, message, hint }, warnings, next }.",
    "If the server was started with a token, send `Authorization: Bearer <token>` on every /v1 request.",
    ""
  ].join("\n");
}
function referenceMarkdown(base) {
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
    ...formatsReference()
  ].join("\n");
}
const GENERATED = "_Generated from the source code — always matches this version._";
function cell(s) {
  return s.replace(/\|/g, "\\|").replace(/\n+/g, " ");
}
const code = (s) => "`" + s + "`";
const cellCode = (s) => code(s.replace(/\|/g, "\\|"));
function table(head, rows) {
  return [
    `| ${head.join(" | ")} |`,
    `|${head.map(() => "---").join("|")}|`,
    ...rows.map((r) => `| ${r.join(" | ")} |`),
    ""
  ];
}
function httpReference(base) {
  const s = server();
  const routeRows = s.ROUTES.map((r) => [cellCode(`${r.method} ${r.path}`), cell(r.summary)]);
  const out = [
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
    ""
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
    '- **Uploading files:** `curl -T clip.mp3 "$BASE/v1/files?path=uploads/clip.mp3"` stores it as `<workspace>/uploads/clip.mp3`; use the returned `relativePath` (`uploads/clip.mp3`) in scripts. Any file type is accepted (voiceovers, music, a video to edit, a saved login, or a spreadsheet/PDF/… for an `upload` act). Downloading an upload back returns audio/video/images inline and everything else as an attachment (`application/octet-stream`), so an uploaded HTML/SVG file is never rendered by the server.',
    "- **How relative file paths in scripts resolve:** in a script sent inline (`script` in `/v1/validate`, `/v1/scripts`, `/v1/runs`) they resolve against the **workspace** (so `uploads/clip.mp3` works) and are saved as absolute paths; in a script *file* (`scriptPath`) they resolve against that file's folder, as on the CLI.",
    '- **Secrets for `${env:NAME}`:** add `"env": {"DEMO_PASSWORD": "…"}` to `POST /v1/runs` (or `/v1/validate`, `/v1/scripts` to check). The values are used only to fill `${env:NAME}` placeholders for that request/run: they are never written to `runs/*.json`, scripts or logs, and values of 4+ characters are replaced by `***` wherever they would appear in events or envelopes. Names must match `^[A-Z_][A-Z0-9_]*$`; process settings (PATH, HOME, NODE_*, NARASCREEN_*, LD_*, proxies, …) are refused. Keep placeholders in the script (`"value": "${env:DEMO_PASSWORD}"`), not the secret itself.',
    "- **Everything lives in the workspace.** Over HTTP, `scriptPath`, `job`, `options.out`, `options.storage-state` and every file a script references (`storageState`, `audio`, `music.path`, `source.video`, `upload` act `files`) must resolve inside the workspace (symlinks followed) — otherwise `400`. Scripts may only use `http(s)` URLs.",
    `- Limits: JSON bodies ≤ ${Math.round(s.MAX_BODY_BYTES / 1024 / 1024)} MB (\`413\`); at most ${s.LIGHT_CONCURRENCY} light runs / doctor checks at once (the rest wait); at most ${s.MAX_QUEUED_RUNS} waiting runs (\`429\` beyond); ${s.MAX_RUN_EVENTS.toLocaleString("en")} events per run.`,
    "- **Every server start cleans the workspace cache:** run history (`runs/` — earlier runIds are gone), `inspect/` screenshots, and each job's narration audio and preview frames. Scripts, uploads, recordings and final videos stay, so `produce`/`make` on an existing job still skips the re-record (narration is generated again). Start with `--keep-cache` to keep everything.",
    "- `/v1/files` only serves files whose real location (symlinks followed) is inside the workspace; anything else is `403`, even through `..` or symlinks.",
    "- Runs execute the `narascreen` CLI as child processes. Cancelling a run, or stopping the server, stops its whole process tree (browser and ffmpeg included).",
    "- A run's languages render at the same time (two at once; the server's `NARASCREEN_PARALLEL_LANGS` environment variable changes that, `1` = one after another). Each video in the result has `timings` (seconds: `narrationSec`, `cardsSec`, `renderSec` with its `passes`, `totalSec`) — where the time went.",
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
        ["`503`", "The machine is not ready (`doctor` failed: exit class 2 codes)."]
      ]
    ),
    "Runs report their own outcome inside the run (`status` + `outcome`); the HTTP status of `GET /v1/runs/:id` is `200` whether the run succeeded or failed.",
    "",
    ...runCommandsReference(),
    ...followingRunsReference()
  );
  return out;
}
function runCommandsReference() {
  const s = server();
  const rows = s.RUN_COMMANDS.map((name) => {
    const c = narascreen.COMMANDS.find((x2) => x2.name === name);
    const input = [];
    if (c.arg?.name === "script") input.push("`script` or `scriptPath` (required)");
    if (c.flags.some((f) => f.name === "script")) input.push("`script` or `scriptPath` (optional, = `--script`)");
    if (c.arg?.name === "job") input.push("`job` (default: from the script's `scope`)");
    if (["record", "make", "check"].includes(name)) input.push("`job` (optional, = `--out`)");
    const opts = c.flags.filter((f) => f.name !== "script" && !s.BLOCKED_RUN_OPTIONS.includes(f.name)).map((f) => `${code(f.name)}${f.type === "boolean" ? " (bool)" : ""}`);
    return [code(name), cell(input.join("; ") || "—"), opts.join(", ") || "—", c.heavy ? "heavy queue" : "light (≤ " + s.LIGHT_CONCURRENCY + " at once)"];
  });
  return [
    "### Running commands (`POST /v1/runs`)",
    "",
    "`command` is one of the CLI commands below. `options` uses the command's CLI flag names without",
    'dashes (`{"lang": "en,hi", "force": true, "until": "open-tasks"}`); boolean flags take `true`/`false`,',
    "the others strings (numbers are accepted). An inline `script` is saved as",
    "`<workspace>/scripts/run-<runId>.demo-script.json`; relative file paths inside it (e.g. `storageState`) and",
    "relative `scriptPath`/`out` values resolve against the workspace, and all of them must stay inside it. `job` is a",
    "name (→ `<workspace>/jobs/<name>`) or a path inside the workspace; it defaults to `<workspace>/jobs/<script scope>`.",
    "Scripts are validated before the run is accepted, so an invalid script fails fast with `400 SCRIPT_INVALID`.",
    `Heavy commands wait in a first-in-first-out queue (\`--concurrency\`, default 1); light ones run up to ${s.LIGHT_CONCURRENCY} at once.`,
    `Not available over HTTP: ${s.BLOCKED_RUN_OPTIONS.map((o) => code(o)).join(", ")} (needs a keyboard).`,
    "",
    ...table(["command", "Input fields", "`options` keys", "Starts"], rows)
  ];
}
function followingRunsReference() {
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
    '  line is `{"type":"end","seq":…,"status":…,"outcome":{…}}`. Empty lines are keep-alives; skip them.',
    '- **Cancel:** `POST /v1/runs/<runId>/cancel` stops the run (SIGTERM, then SIGKILL after 5 s) and returns it with `status: "cancelled"`.',
    "- Runs are kept in `<workspace>/runs/<runId>.json` and `<runId>.events.ndjson` (the complete event history), and survive a server restart.",
    "",
    "```bash",
    "curl -N $BASE/v1/runs/<runId>/events            # live progress (SSE)",
    'curl -s "$BASE/v1/runs/<runId>?wait=300"        # or block until it finishes',
    "```",
    ""
  ];
}
function cliReference() {
  const out = [
    "## CLI reference",
    "",
    GENERATED,
    "",
    "Every command prints exactly one JSON [envelope](#envelope) on stdout (except `manual` and `schema`),",
    "progress [events](#events) on stderr, and exits with the code of its error class ([exit codes](#exit-codes)).",
    "",
    "### Global flags",
    "",
    ...table(["Flag", "Description"], narascreen.GLOBAL_FLAGS.map((f) => [cellCode(f.flag), cell(f.desc)])),
    "### Commands",
    "",
    ...table(["Command", "Summary"], narascreen.COMMANDS.map((c) => [code(c.name), cell(c.summary)]))
  ];
  for (const c of narascreen.COMMANDS) {
    out.push(`#### ${code(`narascreen ${c.name}`)}`, "", c.summary, "", "```bash", c.usage, "```", "");
    if (c.arg) out.push(`- **Argument** \`<${c.arg.name}>\`${c.arg.required ? " (required)" : ""}: ${c.arg.desc}`);
    out.push(`- **Result:** ${/^\{.*\}$/.test(c.output) ? code(c.output) : c.output}`);
    if (c.heavy) out.push("- Opens a browser or renders video (queued by the HTTP server).");
    out.push("");
    if (c.flags.length) out.push(...table(["Flag", "Description"], c.flags.map((f) => [cellCode(f.flag), cell(f.desc)])));
  }
  return out;
}
const jsonSchemaOf = (s) => index.toJSONSchema(s, { io: "input" });
const LINK = {
  selector: "[Selector](#selector-fields)",
  scope: "[Scope](#within-scope-fields)",
  act: "[act](#browser-actions-act)",
  fx: "[fx](#video-effects-fx)",
  step: "[step](#steps)",
  langs: "[language](#voices)"
};
const itemsOf = (s) => typeof s.items === "object" ? s.items : {};
const isSelector = (s) => index.SELECTOR_KEYS.every((k2) => k2 in (s.properties ?? {}));
const isScope = (s) => !isSelector(s) && ["css", "text", "role", "name"].every((k2) => k2 in (s.properties ?? {}));
function ownTable(s) {
  if (!s) return void 0;
  if (s.type === "array") return ownTable(itemsOf(s));
  if (s.type !== "object" || !s.properties || isSelector(s) || isScope(s)) return void 0;
  return Object.values(s.properties).some((p) => p.description) ? s : void 0;
}
function typeOf(s, field = "", links2 = {}) {
  if (s.const !== void 0) return cellCode(JSON.stringify(s.const));
  if (s.enum) {
    if (isLanguageEnum(s.enum)) return LINK.langs;
    return s.enum.map((v2) => cellCode(JSON.stringify(v2))).join(" \\| ");
  }
  const alts = s.oneOf ?? s.anyOf;
  if (alts) return alts.map((a) => typeOf(a, field, links2)).join(" \\| ");
  switch (s.type) {
    case "string":
      return s.format === "uri" ? "URL" : "string";
    case "integer":
    case "number":
      return numberType(s);
    case "boolean":
      return "boolean";
    case "array":
      return arrayType(s, field, links2);
    case "object":
      return objectType(s, field, links2);
    default:
      return "any";
  }
}
function numberType(s) {
  const base = s.type === "integer" ? "integer" : "number";
  const hi = s.maximum !== void 0 && s.maximum < 1e12 ? s.maximum : void 0;
  const nb = " ";
  if (s.minimum !== void 0 && hi !== void 0) return `${base}${nb}${s.minimum}–${hi}`;
  const parts = [];
  if (s.minimum !== void 0) parts.push(`≥${nb}${s.minimum}`);
  if (s.exclusiveMinimum !== void 0) parts.push(`>${nb}${s.exclusiveMinimum}`);
  if (hi !== void 0) parts.push(`≤${nb}${hi}`);
  return parts.length ? `${base}${nb}${parts.join(", ")}` : base;
}
function arrayType(s, field, links2) {
  if (s.prefixItems) {
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
  const inner = typeOf(items, field, links2);
  return /\s/.test(inner) && !inner.startsWith("[") ? `(${inner})[]` : `${inner}[]`;
}
function objectType(s, field, links2) {
  if (isSelector(s)) return LINK.selector;
  if (isScope(s)) return LINK.scope;
  if (links2[field]) return links2[field];
  if (s.propertyNames || typeof s.additionalProperties === "object") {
    const key = s.propertyNames?.enum && isLanguageEnum(s.propertyNames.enum) ? LINK.langs : "string";
    const val = typeof s.additionalProperties === "object" ? typeOf(s.additionalProperties) : "any";
    return `map ${key} → ${val}`;
  }
  if (ownTable(s)) return "object";
  const keys = Object.keys(s.properties ?? {});
  return keys.length ? cellCode(`{ ${keys.join(", ")} }`) : "object";
}
function isLanguageEnum(values) {
  const langs = Object.keys(index.LANG_CODES);
  return values.length === langs.length && values.every((v2) => langs.includes(String(v2)));
}
function fieldRows(s, opts = {}) {
  const required = new Set(s.required ?? []);
  const links2 = opts.links ?? {};
  return Object.entries(s.properties ?? {}).filter(([k2]) => !(opts.skip ?? []).includes(k2)).map(([k2, p]) => {
    const req = opts.required?.[k2] ?? (required.has(k2) ? "yes" : "");
    const row = [code(k2), typeOf(p, k2, links2), cell(req)];
    if (opts.defaults) row.push(k2 in opts.defaults ? cellCode(JSON.stringify(opts.defaults[k2])) : "");
    const desc = opts.desc?.[k2] ?? p.description ?? itemsOf(p).description ?? (links2[k2] ? `See ${links2[k2]}.` : "");
    row.push(cell(desc));
    return row;
  });
}
function nestedTables(s, skip) {
  const out = [];
  for (const [k2, p] of Object.entries(s.properties ?? {})) {
    const obj = skip.includes(k2) ? void 0 : ownTable(p);
    if (!obj) continue;
    out.push(`Each ${code(k2)}${p.type === "array" ? " item" : ""}:`, "", ...table(FIELD_HEAD, fieldRows(obj)));
  }
  return out;
}
const EXTRA_REQUIRED = {
  goto: { path: "one of path / url", url: "one of path / url" },
  fill: { value: "yes" },
  scroll: { selector: "selector or y", y: "selector or y" }
};
const FIELD_HEAD = ["Field", "Type", "Required", "Description"];
const SECTION_DEFAULTS = { defaults: { ...index.BUILTIN_DEFAULTS } };
function scriptReference() {
  const top = index.demoScriptJsonSchema();
  const selector = jsonSchemaOf(index.SelectorSchema);
  const scope = selector.properties?.within ?? {};
  const sections = Object.entries(top.properties ?? {}).filter(([, p]) => p.type === "object" && ownTable(p));
  const links2 = Object.fromEntries(sections.map(([k2]) => [k2, `[object](#${slugify(`${k2} fields`)})`]));
  const out = [
    "## Script reference",
    "",
    `${GENERATED} The machine-readable version is the JSON Schema (\`GET /v1/schema\`, \`narascreen schema\`).`,
    "",
    "### Top-level fields",
    "",
    ...table(FIELD_HEAD, fieldRows(top, { links: links2, desc: { $schema: "Optional. Lets JSON editors fetch the schema; ignored by NaraScreen." } })),
    "### Steps",
    "",
    "Each entry of `steps`:",
    "",
    ...table(FIELD_HEAD, fieldRows(jsonSchemaOf(index.BeatSchema))),
    "### Selector fields",
    "",
    "Targeted acts carry these keys directly on the entry; effects put them inside `anchor`.",
    `Use exactly one of ${index.SELECTOR_KEYS.map(code).join(", ")}.`,
    "",
    ...table(FIELD_HEAD, fieldRows(selector)),
    "### within (scope) fields",
    "",
    ...scope.description ? [scope.description, ""] : [],
    ...table(FIELD_HEAD, fieldRows(scope)),
    "### Browser actions (act)",
    "",
    "Every entry may also have `note` (a comment NaraScreen ignores). Selector keys are described in",
    "[Selector fields](#selector-fields).",
    ""
  ];
  for (const option of index.ActEntrySchema.options) out.push(...actSection(jsonSchemaOf(option)));
  out.push(
    "### Video effects (fx)",
    "",
    "An effect happens at the point in the step where it is listed. Every entry may also have `note`.",
    ""
  );
  for (const option of index.FxEntrySchema.options) out.push(...fxSection(jsonSchemaOf(option)));
  for (const [k2, p] of sections) {
    const obj = ownTable(p);
    const defaults = SECTION_DEFAULTS[k2];
    out.push(
      `### ${code(k2)} fields`,
      "",
      `${p.description ? `${p.description} ` : ""}Set as \`${k2}\` at the top level of the script.`,
      "",
      ...defaults ? table(["Field", "Type", "Required", "Default", "Description"], fieldRows(obj, { defaults })) : table(FIELD_HEAD, fieldRows(obj))
    );
  }
  return out;
}
function actSection(s) {
  const verb = String(s.properties?.act?.const);
  const hasSelector = isSelector(s);
  const extra = EXTRA_REQUIRED[verb] ?? {};
  const rows = [];
  if (hasSelector) {
    const req = index.TARGETED_ACTS.some((v2) => v2 === verb) ? "yes" : extra.selector ?? "optional";
    rows.push([
      "_selector_",
      LINK.selector,
      cell(req),
      cell(`One of ${index.SELECTOR_KEYS.join(" / ")} (+ name, within, exact, nth) on the entry itself.`)
    ]);
  }
  const skip = ["act", "note", ...hasSelector ? Object.keys(index.SelectorSchema.shape) : []];
  rows.push(...fieldRows(s, { skip, required: extra }));
  return [`#### act: ${verb}`, "", s.description ?? "", "", ...table(FIELD_HEAD, rows), ...nestedTables(s, skip)];
}
function fxSection(s) {
  const verb = String(s.properties?.fx?.const);
  const needsElement = index.RECT_FX.some((v2) => v2 === verb);
  const skip = ["fx", "note"];
  const rows = fieldRows(s, {
    skip,
    desc: { anchor: "Element to target. Leave it out to reuse the element of the previous act/fx in this step." }
  });
  const intro = needsElement ? " Needs an element: `anchor` (or another target field below), or the element of the previous act/fx in this step." : "";
  return [`#### fx: ${verb}`, "", `${s.description ?? ""}${intro}`, "", ...table(FIELD_HEAD, rows), ...nestedTables(s, skip)];
}
const EXIT_CLASSES = [
  [0, "Success."],
  [1, "The script or job needs fixing — the agent can fix this itself."],
  [2, "The machine is missing something — run `doctor` and apply its fixes."],
  [3, "The command line / request itself was wrong (`USAGE`)."],
  [4, "NaraScreen bug or unexpected tool failure."]
];
function errorReference() {
  const s = server();
  const codes = Object.keys(index.ERROR_HELP);
  const rows = codes.map((c) => [code(c), String(index.exitCodeFor(c)), String(s.httpStatusFor(c)), cell(index.ERROR_HELP[c])]);
  const classRows = EXIT_CLASSES.map(([n, what]) => {
    const members = codes.filter((c) => index.exitCodeFor(c) === n).map(code).join(", ");
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
    ...table(["Exit", "Meaning", "Codes"], classRows)
  ];
}
function voicesReference() {
  const rows = Object.keys(index.LANG_CODES).map((lang) => {
    const voices = index.DEFAULT_VOICES[lang] ?? [];
    return [code(lang), cell(index.LANG_LABELS[lang] ?? lang), voices[0] ? code(voices[0]) : "—", voices.slice(1).map(code).join(" ")];
  });
  return [
    "## Voices",
    "",
    `${GENERATED} Use the code in \`languages\`, narration maps and \`tts.voices\`; the voice id in \`tts.voices\` or an entry's \`voice\`.`,
    "",
    ...table(["Code", "Language", "Default voice", "Other voices"], rows)
  ];
}
const STAGES = ["doctor", "validate", "inspect", "setup", "record", "tts", "compile", "render", "preview"];
const EVENT_TYPES = {
  stage: "A pipeline phase started (`stage` names it).",
  step: "A script step started; `data` has `{ index, total, id, label }`.",
  log: "A detail line.",
  warning: "Something worth fixing; the command continues."
};
const ENVELOPE_FIELDS = {
  ok: "`true` on success, `false` on failure.",
  command: "The command (or HTTP operation) that produced it.",
  result: "On success: the command's result (see each command's **Result**).",
  error: "On failure: `{ code, message, hint?, where?: { step, entry, path }, details? }`.",
  warnings: "Non-fatal problems worth fixing; the command still succeeded.",
  next: "Suggested next commands, ready to run."
};
const EVENT_FIELDS = {
  ts: "ISO timestamp.",
  type: "One of the event types below.",
  stage: "Pipeline stage the event belongs to.",
  message: "Human-readable text.",
  data: "Structured details (optional)."
};
function formatsReference() {
  return [
    "## Output formats",
    "",
    GENERATED,
    "",
    "### Envelope",
    "",
    "What every CLI command prints on stdout and every `/v1` endpoint returns.",
    "",
    ...table(["Field", "Description"], Object.entries(ENVELOPE_FIELDS).map(([k2, v2]) => [code(k2), cell(v2)])),
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
    ...table(["Field", "Description"], Object.entries(EVENT_FIELDS).map(([k2, v2]) => [code(k2), cell(v2)])),
    ...table(["type", "Meaning"], Object.entries(EVENT_TYPES).map(([k2, v2]) => [code(k2), cell(v2)])),
    `Stages: ${STAGES.map(code).join(", ")}.`,
    ""
  ];
}
function renderDocsHtml(markdown, opts = {}) {
  const toc = [];
  const slugs = /* @__PURE__ */ new Map();
  const md = new B({
    gfm: true,
    renderer: {
      heading({ tokens, depth }) {
        const inner = this.parser.parseInline(tokens);
        const id = uniqueSlug(decodeEntities(stripTags(inner)), slugs);
        if (depth === 2 || depth === 3) toc.push({ depth, id, html: stripLinks(inner) });
        return `<h${depth} id="${id}">${inner}<a class="anchor" href="#${id}" aria-label="Link to this section">#</a></h${depth}>
`;
      },
      // Raw HTML in the Markdown is shown as text, never interpreted: schema descriptions
      // mention tags like <select>, and one stray tag must not swallow the page.
      html({ text }) {
        return /^\s*<!--[\s\S]*-->\s*$/.test(text) ? "" : escapeHtml(text);
      },
      code({ text, lang }) {
        const cls = lang ? ` class="language-${escapeHtml(lang.split(/\s/)[0])}"` : "";
        return `<div class="code"><button type="button" class="copy" hidden>Copy</button><pre><code${cls}>${escapeHtml(text)}</code></pre></div>
`;
      }
    }
  });
  const body = md.parse(markdown, { async: false }).replace(/<table>/g, '<div class="table-wrap"><table>').replace(/<\/table>/g, "</table></div>");
  const base = opts.baseUrl?.replace(/\/+$/, "");
  const note = base ? `Agents: the same content as Markdown is at <a href="${escapeHtml(base)}/docs.md"><code>/docs.md</code></a> — fetch that instead of this page.` : "Agents: the same content as Markdown is at <code>/docs.md</code> on <code>narascreen serve</code>, or run <code>narascreen manual</code>.";
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
<\/script>
</body>
</html>
`;
}
function renderToc(entries) {
  let html = "<ol>";
  let open = false;
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
const assetCache = /* @__PURE__ */ new Map();
function asset(name) {
  let text = assetCache.get(name);
  if (text === void 0) {
    try {
      text = fs__namespace.readFileSync(path__namespace.join(ASSETS_DIR, name), "utf-8");
    } catch {
      text = "";
    }
    text = text.replace(/<\/(style|script)/gi, "<\\/$1");
    assetCache.set(name, text);
  }
  return text;
}
function slugify(text) {
  return text.toLowerCase().trim().replace(/[^\p{L}\p{N}\s_-]/gu, "").replace(/\s+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "section";
}
function uniqueSlug(text, seen) {
  const base = slugify(text);
  const n = seen.get(base) ?? 0;
  seen.set(base, n + 1);
  return n === 0 ? base : `${base}-${n}`;
}
function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function stripTags(html) {
  return html.replace(/<[^>]*>/g, "");
}
function stripLinks(html) {
  return html.replace(/<\/?a\b[^>]*>/g, "");
}
function decodeEntities(s) {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
}
const docs = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  buildLlmsTxt,
  buildManualMarkdown,
  renderDocsHtml,
  slugify
}, Symbol.toStringTag, { value: "Module" }));
exports.__narascreen_req0 = __narascreen_req0;
exports.docs = docs;
