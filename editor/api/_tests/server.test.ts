// ─── server.test.ts: the HTTP server, end to end over real sockets ───
//
//   node_modules/.bin/tsx --test api/_tests/server.test.ts
//
// Most run tests use a tiny FAKE CLI (written into the temp workspace below)
// that speaks the same protocol as bin/narascreen — JSON events on stderr, one
// envelope on stdout — so queueing, SSE replay, cancel and process-tree cleanup
// are tested quickly and deterministically. One test drives the REAL CLI
// (`inspect` against the fixture app) to prove the wiring works for real.

import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as http from "http";
import * as path from "path";
import { COMMANDS } from "../commands";
import { ERROR_HELP } from "../errors";
import { setQuiet } from "../output";
import { ActEntrySchema, FxEntrySchema } from "../schema";
import { ROUTES, startServer } from "../server";
import { DEFAULT_VOICES, LANG_CODES } from "../../src/lib/voices";
import { startFixtureServer } from "./fixture-site/serve";

setQuiet(true);

const TMP = path.join(__dirname, ".tmp", `server-${process.pid}-${Date.now()}`);
const WS = path.join(TMP, "ws");
const OUTSIDE = path.join(TMP, "outside");
const FAKE_CLI = path.join(TMP, "fake-cli.js");
const ARGS_LOG = path.join(TMP, "fake-cli-args.ndjson");
const PIDS_LOG = path.join(TMP, "fake-cli-pids.txt");
const REAL_CLI = path.join(__dirname, "..", "..", "bin", "narascreen");

const VALID = {
  version: 1,
  scope: "quick-demo",
  baseUrl: "http://127.0.0.1:9",
  steps: [{ id: "intro", beat: [{ act: "goto", path: "/" }, { fx: "narrate", narrate: "Hello there." }] }],
};
const withScope = (scope: string) => ({ ...VALID, scope });

// ─── fake CLI ────────────────────────────────────────────────────────

const FAKE_CLI_SOURCE = String.raw`
// Fake narascreen CLI for server.test.ts — same protocol as the real one.
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const argv = process.argv.slice(2);
const cmd = argv[0];
const flag = (n) => { const a = argv.find((x) => x.startsWith("--" + n + "=")); return a ? a.slice(n.length + 3) : undefined; };
const positional = argv[1] && !argv[1].startsWith("--") ? argv[1] : undefined;
if (process.env.FAKE_CLI_LOG) fs.appendFileSync(process.env.FAKE_CLI_LOG, JSON.stringify(argv) + "\n");
const ev = (type, message, extra) => process.stderr.write(JSON.stringify(Object.assign({ ts: new Date().toISOString(), type, message }, extra || {})) + "\n");
const done = (ok, body, code) => { process.stdout.write(JSON.stringify(Object.assign({ ok, command: cmd }, body, { warnings: [], next: [] }), null, 2) + "\n"); process.exitCode = code; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const scope = () => { try { return JSON.parse(fs.readFileSync(positional, "utf-8")).scope || ""; } catch { return ""; } };

(async () => {
  if (cmd === "make") {
    const job = flag("out");
    ev("stage", "Validating", { stage: "validate" });
    for (let i = 1; i <= 3; i++) { await sleep(40); ev("step", "step " + i + "/3", { stage: "record", data: { index: i, total: 3 } }); }
    process.stderr.write("a plain stderr line\n");
    ev("warning", "something to fix", { stage: "render" });
    const video = path.join(job, "video", "final_en.mp4");
    fs.mkdirSync(path.dirname(video), { recursive: true });
    fs.writeFileSync(video, Buffer.alloc(4096, 7));
    process.stdout.write("[stray] console output before the envelope\n");
    return done(true, { result: { job, recorded: true, videos: [{ lang: "en", path: video, durationSec: 1.5 }] } }, 0);
  }
  if (cmd === "record") {
    // Runs until killed. Its own child must die with it (process-group kill).
    const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
    fs.appendFileSync(process.env.FAKE_CLI_PIDS, child.pid + "\n");
    if (/stubborn/.test(scope())) process.on("SIGTERM", () => ev("log", "ignoring SIGTERM"));
    ev("stage", "Recording", { stage: "record" });
    setInterval(() => ev("log", "still recording"), 100);
    return;
  }
  if (cmd === "check") {
    if (/fail/.test(scope())) return done(false, { error: { code: "SELECTOR_NOT_FOUND", message: "No element matched", hint: "Use inspect" } }, 1);
    ev("stage", "Checking", { stage: "record" });
    return done(true, { result: { slots: 2, durationSec: 0.5 } }, 0);
  }
  if (cmd === "status") { process.stdout.write("this is not json\n"); process.stderr.write("TypeError: boom\n"); process.exitCode = 4; return; }
  if (cmd === "doctor") return done(true, { result: { ready: true, checks: [{ id: "node", ok: true, required: true, detail: "fake" }] } }, 0);
  if (cmd === "produce") return done(false, { error: { code: "TTS_UNAVAILABLE", message: "Kokoro down", hint: "run doctor" } }, 2);
  return done(true, { result: { argv } }, 0); // inspect, preview, validate: echo the arguments
})();
`;

// ─── HTTP helpers ────────────────────────────────────────────────────

interface Res {
  status: number;
  headers: http.IncomingHttpHeaders;
  text: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  json: any;
}

function request(url: string, opts: { method?: string; headers?: Record<string, string>; body?: unknown } = {}): Promise<Res> {
  return new Promise((resolve, reject) => {
    const body = opts.body === undefined ? undefined : typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body);
    const req = http.request(url, { method: opts.method ?? (body ? "POST" : "GET"), headers: opts.headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf-8");
        let json: unknown;
        try {
          json = JSON.parse(text);
        } catch {
          json = undefined;
        }
        resolve({ status: res.statusCode ?? 0, headers: res.headers, text, json });
      });
    });
    req.on("error", reject);
    if (body) req.setHeader("Content-Type", "application/json");
    req.end(body);
  });
}

interface SseEvent {
  id?: string;
  event: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any;
}

/** Read an SSE stream to its end. `onEvent` sees events as they arrive. */
function readSse(url: string, headers: Record<string, string> = {}, onEvent?: (e: SseEvent) => void): Promise<{ status: number; events: SseEvent[]; raw: string }> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { headers }, (res) => {
      let raw = "";
      let buf = "";
      const events: SseEvent[] = [];
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => {
        raw += chunk;
        buf += chunk;
        let i: number;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const block = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const e: Partial<SseEvent> & { lines: string[] } = { lines: [] };
          for (const line of block.split("\n")) {
            if (line.startsWith(":")) continue;
            const [k, ...rest] = line.split(": ");
            const v = rest.join(": ");
            if (k === "id") e.id = v;
            else if (k === "event") e.event = v;
            else if (k === "data") e.lines.push(v);
          }
          if (!e.lines.length) continue;
          const ev: SseEvent = { id: e.id, event: e.event ?? "message", data: JSON.parse(e.lines.join("\n")) };
          events.push(ev);
          onEvent?.(ev);
        }
      });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, events, raw }));
    });
    req.on("error", reject);
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until(what: string, fn: () => boolean | Promise<boolean>, ms = 5000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return;
    await sleep(50);
  }
  assert.fail(`timed out waiting for ${what}`);
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

const readArgs = (): string[][] =>
  fs.existsSync(ARGS_LOG) ? fs.readFileSync(ARGS_LOG, "utf-8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];

// ─── setup ───────────────────────────────────────────────────────────

let base = "";
let closeMain: () => Promise<void> = async () => {};

before(async () => {
  fs.mkdirSync(WS, { recursive: true });
  fs.mkdirSync(OUTSIDE, { recursive: true });
  fs.writeFileSync(path.join(OUTSIDE, "secret.txt"), "top secret\n");
  fs.writeFileSync(FAKE_CLI, FAKE_CLI_SOURCE);
  process.env.FAKE_CLI_LOG = ARGS_LOG;
  process.env.FAKE_CLI_PIDS = PIDS_LOG;
  delete process.env.NARASCREEN_TOKEN;
  const srv = await startServer({ port: 0, host: "127.0.0.1", workspace: WS, concurrency: 1, cliPath: FAKE_CLI });
  base = srv.url;
  closeMain = srv.close;
});

after(async () => {
  await closeMain();
  if (!process.env.KEEP_TMP) fs.rmSync(TMP, { recursive: true, force: true });
});

// ─── docs ────────────────────────────────────────────────────────────

describe("docs routes", () => {
  it("GET / redirects to /docs", async () => {
    const r = await request(`${base}/`);
    assert.equal(r.status, 302);
    assert.equal(r.headers.location, "/docs");
  });

  it("GET /docs is a standalone HTML page", async () => {
    const r = await request(`${base}/docs`);
    assert.equal(r.status, 200);
    assert.match(String(r.headers["content-type"]), /^text\/html/);
    assert.match(r.text, /<title>NaraScreen docs<\/title>/);
    assert.match(r.text, new RegExp(`href="${base}/docs.md"`), "points agents at the Markdown");
    assert.match(r.text, /<nav class="toc"/);
    // No external requests: no external scripts, stylesheets, images or fonts.
    assert.doesNotMatch(r.text, /<script[^>]+src=/);
    assert.doesNotMatch(r.text, /<link[^>]+rel="stylesheet"/);
    assert.doesNotMatch(r.text, /<img[^>]+src="https?:/);
    assert.doesNotMatch(r.text, /@import|url\(\s*["']?https?:/);
    // Raw tags from schema descriptions are text, not live elements.
    assert.doesNotMatch(r.text, /<select>/);
  });

  it("GET /docs.md contains the generated reference, in sync with the code", async () => {
    const r = await request(`${base}/docs.md`);
    assert.equal(r.status, 200);
    assert.match(String(r.headers["content-type"]), /^text\/markdown/);
    const md = r.text;
    for (const route of ROUTES) assert.ok(md.includes(`${route.method} ${route.path}`), `route ${route.method} ${route.path}`);
    for (const c of COMMANDS) assert.ok(md.includes(`narascreen ${c.name}`), `command ${c.name}`);
    for (const code of Object.keys(ERROR_HELP)) assert.ok(md.includes("`" + code + "`"), `error ${code}`);
    for (const o of ActEntrySchema.options) assert.ok(md.includes(`#### act: ${o.shape.act.value}`), `act ${o.shape.act.value}`);
    for (const o of FxEntrySchema.options) assert.ok(md.includes(`#### fx: ${o.shape.fx.value}`), `fx ${o.shape.fx.value}`);
    for (const lang of Object.keys(LANG_CODES)) {
      for (const v of DEFAULT_VOICES[lang] ?? []) assert.ok(md.includes("`" + v + "`"), `voice ${v}`);
    }
    // Example URLs in the manual point at THIS server.
    assert.ok(md.includes(base), "manual rewritten to the live base URL");
  });

  it("GET /llms.txt orients an agent that only knows the URL", async () => {
    const r = await request(`${base}/llms.txt`);
    assert.equal(r.status, 200);
    assert.match(String(r.headers["content-type"]), /^text\/plain/);
    assert.ok(r.text.includes(`${base}/docs.md`));
    assert.ok(r.text.includes("/v1/runs"));
  });
});

// ─── simple /v1 endpoints ────────────────────────────────────────────

describe("v1 basics", () => {
  it("health", async () => {
    const r = await request(`${base}/v1/health`);
    assert.equal(r.status, 200);
    assert.equal(r.json.ok, true);
    assert.equal(r.json.command, "health");
    const res = r.json.result;
    assert.equal(typeof res.version, "string");
    assert.equal(typeof res.uptimeSec, "number");
    assert.equal(res.workspace, WS);
    assert.deepEqual(Object.keys(res.runs).sort(), ["queued", "running"]);
    assert.deepEqual(r.json.warnings, []);
    assert.deepEqual(r.json.next, []);
  });

  it("schema is the raw JSON Schema", async () => {
    const r = await request(`${base}/v1/schema`);
    assert.equal(r.status, 200);
    assert.ok(r.json.$schema);
    assert.equal(r.json.type, "object");
    assert.ok(r.json.properties.steps);
  });

  it("voices: all, one language, unknown language", async () => {
    const all = await request(`${base}/v1/voices`);
    assert.equal(all.json.result.languages.length, Object.keys(LANG_CODES).length);
    const hi = await request(`${base}/v1/voices?lang=hi`);
    assert.deepEqual(hi.json.result.languages, [{ code: "hi", label: "Hindi", defaultVoice: "hf_alpha", voices: DEFAULT_VOICES.hi }]);
    const bad = await request(`${base}/v1/voices?lang=xx`);
    assert.equal(bad.status, 400);
    assert.equal(bad.json.error.code, "USAGE");
  });

  it("doctor runs the CLI and returns its envelope", async () => {
    const r = await request(`${base}/v1/doctor`);
    assert.equal(r.status, 200);
    assert.equal(r.json.command, "doctor");
    assert.equal(r.json.result.ready, true);
  });

  it("unknown route → 404 envelope; wrong method → 405", async () => {
    const r = await request(`${base}/v1/nope`);
    assert.equal(r.status, 404);
    assert.equal(r.json.ok, false);
    assert.equal(r.json.error.code, "USAGE");
    const m = await request(`${base}/v1/runs`, { method: "DELETE" });
    assert.equal(m.status, 405);
    assert.match(String(m.headers.allow), /GET/);
    const run = await request(`${base}/v1/runs/r_does-not-exist`);
    assert.equal(run.status, 404);
  });
});

describe("validate + scripts", () => {
  it("validates an inline script", async () => {
    const r = await request(`${base}/v1/validate`, { body: { script: VALID } });
    assert.equal(r.status, 200);
    assert.equal(r.json.ok, true);
    assert.equal(r.json.result.valid, true);
    assert.equal(r.json.result.summary.steps, 1);
  });

  it("reports every problem of a bad script (400 SCRIPT_INVALID)", async () => {
    const bad = { ...VALID, steps: [{ id: "a", beat: [{ act: "clik", role: "button" }, { fx: "narate", narrate: "x" }] }] };
    const r = await request(`${base}/v1/validate`, { body: { script: bad } });
    assert.equal(r.status, 400);
    assert.equal(r.json.error.code, "SCRIPT_INVALID");
    assert.equal(r.json.error.details.issues.length, 2);
    assert.match(r.json.error.details.issues[0].hint, /click/);
  });

  it("validates by path (relative to the workspace) and 404s a missing one", async () => {
    fs.mkdirSync(path.join(WS, "mine"), { recursive: true });
    fs.writeFileSync(path.join(WS, "mine", "a.demo-script.json"), JSON.stringify(VALID));
    const r = await request(`${base}/v1/validate`, { body: { scriptPath: "mine/a.demo-script.json" } });
    assert.equal(r.status, 200);
    assert.equal(r.json.result.scriptPath, path.join(WS, "mine", "a.demo-script.json"));
    const missing = await request(`${base}/v1/validate`, { body: { scriptPath: "nope.json" } });
    assert.equal(missing.status, 404);
    assert.equal(missing.json.error.code, "SCRIPT_NOT_FOUND");
  });

  it("rejects bad bodies: invalid JSON, unknown fields, too large", async () => {
    const r = await request(`${base}/v1/validate`, { body: "{not json" });
    assert.equal(r.status, 400);
    assert.match(r.json.error.message, /not valid JSON/);
    const typo = await request(`${base}/v1/validate`, { body: { scirpt: VALID } });
    assert.equal(typo.status, 400);
    assert.match(typo.json.error.hint, /Did you mean "script"/);
    const big = await new Promise<number>((resolve, reject) => {
      const req = http.request(`${base}/v1/validate`, { method: "POST", headers: { "Content-Type": "application/json", "Content-Length": String(6 * 1024 * 1024) } }, (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
        req.destroy();
      });
      req.on("error", reject);
      req.write("{");
    });
    assert.equal(big, 413);
  });

  it("saves a script under a sanitized name, and never saves an invalid one", async () => {
    const r = await request(`${base}/v1/scripts`, { body: { name: "../My Demo!", script: VALID } });
    assert.equal(r.status, 200);
    const p = r.json.result.scriptPath as string;
    assert.equal(path.dirname(p), path.join(WS, "scripts"));
    assert.equal(path.basename(p), "My-Demo.demo-script.json");
    assert.deepEqual(JSON.parse(fs.readFileSync(p, "utf-8")), VALID);
    const bad = await request(`${base}/v1/scripts`, { body: { name: "broken", script: { version: 1 } } });
    assert.equal(bad.status, 400);
    assert.equal(bad.json.error.code, "SCRIPT_INVALID");
    assert.equal(fs.existsSync(path.join(WS, "scripts", "broken.demo-script.json")), false);
  });

  it("makes relative storageState paths absolute (relative to the workspace)", async () => {
    fs.writeFileSync(path.join(WS, "state.json"), JSON.stringify({ cookies: [], origins: [] }));
    const r = await request(`${base}/v1/scripts`, { body: { name: "with-state", script: { ...VALID, storageState: "state.json" } } });
    assert.equal(r.status, 200, r.text);
    const saved = JSON.parse(fs.readFileSync(r.json.result.scriptPath, "utf-8"));
    assert.equal(saved.storageState, path.join(WS, "state.json"));
  });
});

// ─── security ────────────────────────────────────────────────────────

describe("files: only the workspace and run folders", () => {
  it("serves a workspace file with a content type, and Range requests", async () => {
    const f = path.join(WS, "mine", "clip.mp4");
    fs.writeFileSync(f, Buffer.from("0123456789abcdefghij"));
    const r = await request(`${base}/v1/files?path=${encodeURIComponent(f)}`);
    assert.equal(r.status, 200);
    assert.equal(r.headers["content-type"], "video/mp4");
    assert.equal(r.text, "0123456789abcdefghij");
    const part = await request(`${base}/v1/files?path=${encodeURIComponent(f)}`, { headers: { Range: "bytes=5-9" } });
    assert.equal(part.status, 206);
    assert.equal(part.headers["content-range"], "bytes 5-9/20");
    assert.equal(part.text, "56789");
    const tail = await request(`${base}/v1/files?path=${encodeURIComponent(f)}`, { headers: { Range: "bytes=-3" } });
    assert.equal(tail.text, "hij");
    const bad = await request(`${base}/v1/files?path=${encodeURIComponent(f)}`, { headers: { Range: "bytes=500-" } });
    assert.equal(bad.status, 416);
  });

  it("lists a folder, 404s a missing file inside, 400s a missing path", async () => {
    const dir = await request(`${base}/v1/files?path=${encodeURIComponent(path.join(WS, "mine"))}`);
    assert.equal(dir.status, 200);
    assert.ok(dir.json.result.entries.some((e: { name: string }) => e.name === "clip.mp4"));
    const missing = await request(`${base}/v1/files?path=${encodeURIComponent(path.join(WS, "nope.mp4"))}`);
    assert.equal(missing.status, 404);
    const none = await request(`${base}/v1/files`);
    assert.equal(none.status, 400);
  });

  it("refuses everything outside (403), including traversal and symlink escapes", async () => {
    const secret = path.join(OUTSIDE, "secret.txt");
    fs.symlinkSync(OUTSIDE, path.join(WS, "escape"));
    const attempts = [
      "/etc/passwd",
      secret,
      `${WS}/../outside/secret.txt`,
      "../outside/secret.txt",
      `${WS}/scripts/../../outside/secret.txt`,
      path.join(WS, "escape", "secret.txt"),
      path.join(WS, "escape"),
    ];
    for (const p of attempts) {
      const r = await request(`${base}/v1/files?path=${encodeURIComponent(p)}`);
      assert.equal(r.status, 403, `expected 403 for ${p}, got ${r.status}`);
      assert.equal(r.json.error.code, "USAGE");
      assert.ok(!r.text.includes("top secret"));
    }
    // encoded traversal straight in the query string
    const raw = await request(`${base}/v1/files?path=${WS}/%2e%2e/outside/secret.txt`);
    assert.equal(raw.status, 403);
    const nul = await request(`${base}/v1/files?path=${encodeURIComponent(path.join(WS, "a\0b"))}`);
    assert.equal(nul.status, 400);
  });

  it("refuses browser cross-origin requests and foreign Host names", async () => {
    const origin = await request(`${base}/v1/health`, { headers: { Origin: "http://evil.example" } });
    assert.equal(origin.status, 403);
    const host = await request(`${base}/v1/health`, { headers: { Host: "evil.example:80" } });
    assert.equal(host.status, 403);
    const same = await request(`${base}/v1/health`, { headers: { Origin: base } });
    assert.equal(same.status, 200);
  });
});

describe("token auth", () => {
  let tbase = "";
  let close: () => Promise<void> = async () => {};
  before(async () => {
    const s = await startServer({ port: 0, host: "127.0.0.1", workspace: path.join(TMP, "ws-token"), concurrency: 1, token: "s3cret", cliPath: FAKE_CLI });
    tbase = s.url;
    close = s.close;
  });
  after(() => close());

  it("needs the bearer token on /v1, docs stay public", async () => {
    const none = await request(`${tbase}/v1/health`);
    assert.equal(none.status, 401);
    assert.match(String(none.headers["www-authenticate"]), /Bearer/);
    assert.equal(none.json.error.code, "USAGE");
    const wrong = await request(`${tbase}/v1/health`, { headers: { Authorization: "Bearer nope" } });
    assert.equal(wrong.status, 401);
    const right = await request(`${tbase}/v1/health`, { headers: { Authorization: "Bearer s3cret" } });
    assert.equal(right.status, 200);
    assert.equal(right.json.result.auth, true);
    for (const p of ["/docs", "/docs.md", "/llms.txt"]) assert.equal((await request(`${tbase}${p}`)).status, 200, p);
  });
});

// ─── runs ────────────────────────────────────────────────────────────

describe("runs", () => {
  it("rejects bad run requests with USAGE", async () => {
    const cases: [unknown, RegExp][] = [
      [{ command: "serve" }, /cannot be run over HTTP/],
      [{ command: "mkae", script: VALID }, /Did you mean "make"/],
      [{ command: "make" }, /needs a script/],
      [{ command: "make", script: VALID, options: { lnag: "en" } }, /Unknown option/],
      [{ command: "check", script: VALID, options: { hold: true } }, /not available over HTTP/],
      [{ command: "make", script: VALID, options: { force: "yes" } }, /true or false/],
      [{ command: "make", script: VALID, job: "../escape" }, /Job name/],
      [{ command: "make", script: VALID, job: "x", options: { out: "y" } }, /either "job" or options.out/],
      [{ command: "status" }, /needs a job/],
      [{ command: "inspect" }, /needs options.url/],
    ];
    for (const [body, msg] of cases) {
      const r = await request(`${base}/v1/runs`, { body });
      assert.equal(r.status, 400, JSON.stringify(body));
      assert.equal(r.json.error.code, "USAGE");
      assert.match(`${r.json.error.message} ${r.json.error.hint ?? ""}`, msg, JSON.stringify(body));
    }
    const invalid = await request(`${base}/v1/runs`, { body: { command: "make", script: { version: 1 } } });
    assert.equal(invalid.status, 400);
    assert.equal(invalid.json.error.code, "SCRIPT_INVALID", "invalid scripts fail before queueing");
  });

  it("make: 202 + links, live SSE ending with the CLI envelope, then full replay", async () => {
    const r = await request(`${base}/v1/runs`, { body: { command: "make", script: VALID, options: { lang: "en", quality: "medium", resolution: "720p" } } });
    assert.equal(r.status, 202, r.text);
    const res = r.json.result;
    assert.match(res.runId, /^r_/);
    assert.deepEqual(Object.keys(res.links).sort(), ["cancel", "events", "self", "wait"]);
    assert.equal(res.job, path.join(WS, "jobs", "quick-demo"));
    assert.ok(fs.existsSync(res.scriptPath), "inline script saved to the workspace");
    assert.ok(r.json.next.some((n: string) => n.includes(`/v1/runs/${res.runId}/events`)));

    const live = await readSse(`${base}${res.links.events}`);
    assert.equal(live.status, 200);
    const types = live.events.map((e) => e.event);
    assert.equal(types[types.length - 1], "end");
    for (const t of ["stage", "step", "log", "warning"]) assert.ok(types.includes(t), `saw ${t}`);
    const end = live.events[live.events.length - 1].data;
    assert.equal(end.ok, true, "end data is the CLI envelope (stray stdout before it is tolerated)");
    assert.equal(end.command, "make");
    assert.ok(live.events.some((e) => e.data.message === "a plain stderr line"), "non-JSON stderr becomes a log event");
    const seqs = live.events.slice(0, -1).map((e) => Number(e.id));
    assert.deepEqual(seqs, seqs.map((_, i) => i + 1), "ids are 1..n without gaps");

    // New options reach the CLI as flags (they come from COMMANDS, no server change needed).
    const argv = readArgs().find((a) => a[0] === "make")!;
    assert.ok(argv.includes("--lang=en") && argv.includes("--quality=medium") && argv.includes("--resolution=720p"), argv.join(" "));
    assert.ok(argv.includes(`--out=${res.job}`));

    // A late subscriber gets exactly the same stream.
    const late = await readSse(`${base}${res.links.events}`);
    assert.deepEqual(late.events.map((e) => [e.id, e.event]), live.events.map((e) => [e.id, e.event]));
    // Resume after an id: nothing before it again.
    const resumed = await readSse(`${base}${res.links.events}`, { "Last-Event-ID": "2" });
    assert.equal(resumed.events[0].id, "3");
    // Everything delivered: 204 so EventSource stops reconnecting.
    const endId = live.events[live.events.length - 1].id!;
    const doneRes = await readSse(`${base}${res.links.events}`, { "Last-Event-ID": endId });
    assert.equal(doneRes.status, 204);

    // NDJSON flavor
    const nd = await request(`${base}${res.links.events}?format=ndjson`);
    const lines = nd.text.trim().split("\n").map((l) => JSON.parse(l));
    assert.equal(lines.length, live.events.length);
    assert.equal(lines[lines.length - 1].type, "end");
    assert.equal(lines[lines.length - 1].status, "succeeded");
    assert.equal(lines[lines.length - 1].outcome.ok, true);

    // Run state + persistence
    const got = await request(`${base}/v1/runs/${res.runId}`);
    assert.equal(got.json.result.status, "succeeded");
    assert.equal(got.json.result.exitCode, 0);
    assert.equal(got.json.result.eventCount, live.events.length - 1);
    assert.ok(got.json.next.some((n: string) => n.includes("/v1/files?path=")), "next offers the video download");
    const saved = JSON.parse(fs.readFileSync(path.join(WS, "runs", `${res.runId}.json`), "utf-8"));
    assert.equal(saved.status, "succeeded");
    const savedEvents = fs.readFileSync(path.join(WS, "runs", `${res.runId}.events.ndjson`), "utf-8").trim().split("\n");
    assert.equal(savedEvents.length, live.events.length - 1);

    // The produced file is downloadable.
    const video = end.result.videos[0].path;
    const file = await request(`${base}/v1/files?path=${encodeURIComponent(video)}`);
    assert.equal(file.status, 200);
    assert.equal(file.headers["content-type"], "video/mp4");
  });

  it("long-poll returns when the run ends; failures keep the CLI error", async () => {
    const r = await request(`${base}/v1/runs`, { body: { command: "check", script: withScope("fail-demo") } });
    const id = r.json.result.runId;
    const w = await request(`${base}/v1/runs/${id}?wait=20`);
    assert.equal(w.status, 200);
    assert.equal(w.json.result.status, "failed");
    assert.equal(w.json.result.exitCode, 1);
    assert.equal(w.json.result.outcome.error.code, "SELECTOR_NOT_FOUND");
  });

  it("a CLI that dies without an envelope → failed with INTERNAL + stderr tail", async () => {
    const job = path.join(WS, "jobs", "some-job");
    const r = await request(`${base}/v1/runs`, { body: { command: "status", job: "some-job" } });
    assert.equal(r.status, 202);
    const w = await request(`${base}/v1/runs/${r.json.result.runId}?wait=20`);
    assert.equal(w.json.result.status, "failed");
    assert.equal(w.json.result.exitCode, 4);
    assert.equal(w.json.result.outcome.error.code, "INTERNAL");
    assert.ok(w.json.result.outcome.error.details.stderrTail.includes("TypeError: boom"));
    assert.equal(w.json.result.job, job);
  });

  it("maps options to flags: inspect out folder, preview --raw, absolute job outside the workspace", async () => {
    const ins = await request(`${base}/v1/runs`, { body: { command: "inspect", options: { url: "http://127.0.0.1:9/", fullPage: true } } });
    const insDone = await request(`${base}/v1/runs/${ins.json.result.runId}?wait=20`);
    const argv: string[] = insDone.json.result.outcome.result.argv;
    assert.ok(argv.includes(`--out=${path.join(WS, "inspect", ins.json.result.runId)}`), argv.join(" "));
    assert.ok(argv.includes("--full-page") && argv.includes("--url=http://127.0.0.1:9/"));

    const outsideJob = path.join(OUTSIDE, "job-a");
    const pv = await request(`${base}/v1/runs`, { body: { command: "preview", job: outsideJob, options: { raw: true, tiles: 6 } } });
    const pvDone = await request(`${base}/v1/runs/${pv.json.result.runId}?wait=20`);
    assert.deepEqual(pvDone.json.result.outcome.result.argv.slice(0, 4), ["preview", outsideJob, "--raw", "--tiles=6"]);
    // That job folder is now downloadable; its sibling is not.
    fs.mkdirSync(outsideJob, { recursive: true });
    fs.writeFileSync(path.join(outsideJob, "contact.jpg"), "jpg");
    assert.equal((await request(`${base}/v1/files?path=${encodeURIComponent(path.join(outsideJob, "contact.jpg"))}`)).status, 200);
    assert.equal((await request(`${base}/v1/files?path=${encodeURIComponent(path.join(OUTSIDE, "secret.txt"))}`)).status, 403);
  });

  it("queues heavy runs (concurrency 1), cancel kills the whole process tree, the queue moves on", async () => {
    const rec = await request(`${base}/v1/runs`, { body: { command: "record", script: withScope("long-recording") } });
    const recId = rec.json.result.runId;
    await until("record running", async () => (await request(`${base}/v1/runs/${recId}`)).json.result.status === "running");
    await until("grandchild pid", () => fs.existsSync(PIDS_LOG) && fs.readFileSync(PIDS_LOG, "utf-8").trim() !== "");
    const grandchild = Number(fs.readFileSync(PIDS_LOG, "utf-8").trim().split("\n").pop());
    assert.ok(isAlive(grandchild));

    const mk = await request(`${base}/v1/runs`, { body: { command: "make", script: withScope("queued-demo") } });
    const mkId = mk.json.result.runId;
    const queued = await request(`${base}/v1/runs/${mkId}`);
    assert.equal(queued.json.result.status, "queued");
    assert.equal(queued.json.result.queuePosition, 1);
    const health = await request(`${base}/v1/health`);
    assert.deepEqual(health.json.result.runs, { queued: 1, running: 1 });

    // A live SSE subscriber on the long run sees it end as cancelled.
    const liveTypes: string[] = [];
    const stream = readSse(`${base}/v1/runs/${recId}/events`, {}, (e) => liveTypes.push(e.event));
    await until("live events", () => liveTypes.length >= 3);

    const c = await request(`${base}/v1/runs/${recId}/cancel`, { method: "POST" });
    assert.equal(c.status, 200);
    assert.equal(c.json.result.status, "cancelled");
    const sse = await stream;
    const end = sse.events[sse.events.length - 1];
    assert.equal(end.event, "end");
    assert.equal(end.data.ok, false);
    assert.equal(end.data.error.details.cancelled, true);
    await until("grandchild killed", () => !isAlive(grandchild));

    const mkDone = await request(`${base}/v1/runs/${mkId}?wait=20`);
    assert.equal(mkDone.json.result.status, "succeeded");
    const mkEvents = await request(`${base}/v1/runs/${mkId}/events?format=ndjson`);
    assert.match(mkEvents.text, /queued: waiting for 1 run\(s\) ahead/);

    const again = await request(`${base}/v1/runs/${recId}/cancel`, { method: "POST" });
    assert.equal(again.json.result.status, "cancelled");
    assert.match(again.json.warnings[0], /already cancelled/);
  });

  it("escalates to SIGKILL when a run ignores SIGTERM", async () => {
    const rec = await request(`${base}/v1/runs`, { body: { command: "record", script: withScope("stubborn-recording") } });
    const id = rec.json.result.runId;
    await until("running", async () => (await request(`${base}/v1/runs/${id}`)).json.result.status === "running");
    await sleep(300); // let it install its SIGTERM handler
    const t0 = Date.now();
    const c = await request(`${base}/v1/runs/${id}/cancel`, { method: "POST" });
    assert.equal(c.json.result.status, "cancelled");
    assert.ok(Date.now() - t0 >= 4000, "waited for the grace period before SIGKILL");
  });

  it("lists runs newest first", async () => {
    const r = await request(`${base}/v1/runs`);
    const runs = r.json.result.runs as { createdAt: string; runId: string }[];
    assert.ok(runs.length >= 5);
    const sorted = [...runs].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.runId.localeCompare(a.runId));
    assert.deepEqual(runs.map((x) => x.runId), sorted.map((x) => x.runId));
    const failed = await request(`${base}/v1/runs?status=failed`);
    assert.ok(failed.json.result.runs.every((x: { status: string }) => x.status === "failed"));
  });
});

describe("server close + restart", () => {
  it("close() kills running children; a new server on the workspace keeps the history", async () => {
    const ws = path.join(TMP, "ws-restart");
    const s1 = await startServer({ port: 0, host: "127.0.0.1", workspace: ws, concurrency: 2, cliPath: FAKE_CLI });
    fs.rmSync(PIDS_LOG, { force: true });
    const rec = await request(`${s1.url}/v1/runs`, { body: { command: "record", script: withScope("close-me") } });
    const id = rec.json.result.runId;
    await until("grandchild pid", () => fs.existsSync(PIDS_LOG) && fs.readFileSync(PIDS_LOG, "utf-8").trim() !== "");
    const grandchild = Number(fs.readFileSync(PIDS_LOG, "utf-8").trim());
    const stream = readSse(`${s1.url}/v1/runs/${id}/events`);
    await sleep(200);
    await s1.close();
    const sse = await stream;
    assert.equal(sse.events[sse.events.length - 1].event, "end", "subscribers get the end event on shutdown");
    await until("grandchild killed", () => !isAlive(grandchild));

    // An orphaned "running" record from a dead server gets marked failed on load.
    const ghost = { runId: "r_ghost", command: "make", status: "running", createdAt: "2020-01-01T00:00:00.000Z", args: [], cli: "narascreen make", eventCount: 0, serverPid: 999999999 };
    fs.writeFileSync(path.join(ws, "runs", "r_ghost.json"), JSON.stringify(ghost));

    const s2 = await startServer({ port: 0, host: "127.0.0.1", workspace: ws, concurrency: 1, cliPath: FAKE_CLI });
    try {
      const got = await request(`${s2.url}/v1/runs/${id}`);
      assert.equal(got.json.result.status, "cancelled");
      const replay = await readSse(`${s2.url}/v1/runs/${id}/events`);
      assert.ok(replay.events.length > 2, "events replayed from disk");
      assert.equal(replay.events[replay.events.length - 1].event, "end");
      const g = await request(`${s2.url}/v1/runs/r_ghost`);
      assert.equal(g.json.result.status, "failed");
      assert.match(g.json.result.outcome.error.message, /server stopped/);
    } finally {
      await s2.close();
    }
  });
});

// ─── the real CLI ────────────────────────────────────────────────────

describe("real CLI", () => {
  it("inspect against the fixture app, followed over SSE", { timeout: 180_000 }, async (t) => {
    if (!fs.existsSync(REAL_CLI)) {
      t.skip("bin/narascreen not built yet");
      return;
    }
    const site = await startFixtureServer(0);
    const s = await startServer({ port: 0, host: "127.0.0.1", workspace: path.join(TMP, "ws-real"), concurrency: 1 });
    try {
      const r = await request(`${s.url}/v1/runs`, { body: { command: "inspect", options: { url: `${site.url}/#/login` } } });
      assert.equal(r.status, 202, r.text);
      const sse = await readSse(`${s.url}${r.json.result.links.events}`);
      const end = sse.events[sse.events.length - 1];
      assert.equal(end.event, "end");
      assert.equal(end.data.ok, true, JSON.stringify(end.data.error));
      assert.ok(sse.events.some((e) => e.event === "stage"), "real stage events streamed");
      const res = end.data.result;
      assert.ok(
        res.elements.some((e: { role: string; name: string }) => e.role === "button" && /sign in/i.test(e.name)),
        "finds the Sign in button",
      );
      const shot = await request(`${s.url}/v1/files?path=${encodeURIComponent(res.screenshot)}`);
      assert.equal(shot.status, 200);
      assert.equal(shot.headers["content-type"], "image/png");
    } finally {
      await s.close();
      await site.close();
    }
  });
});
