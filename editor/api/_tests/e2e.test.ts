// Run: node_modules/.bin/tsx --test api/_tests/e2e.test.ts
//
// End-to-end test of the `narascreen` CLI exactly as an outside agent uses it:
// spawn bin/narascreen, read ONE JSON envelope from stdout, check the exit code,
// and look at the files it claims to have written. It asserts the CONTRACT
// (envelope fields, error codes, exit codes, files on disk, event types) and
// never the wording of messages or logs, so copy edits don't break it.
//
// Target site: the "Acme Tasks" fixture app (fixture-site/), served on an
// ephemeral port; the fixture scripts are copied with that port as baseUrl (and
// the acme copy gets background music: a tone generated with ffmpeg, because
// audio files are gitignored). The browser job is then re-used as the source of
// a VIDEO-SOURCE script (edit an existing video, no browser).
// Needs the real toolchain: Chromium (Playwright), ffmpeg, and Kokoro TTS
// (default http://localhost:8880). The `doctor` case fails first, and says
// what is missing, when the machine isn't ready.
//
// Work dir: api/_tests/.tmp/e2e-<time>-<pid>/ (gitignored; kept so a failure can be
// inspected; runs older than 3 hours are pruned at start). `make` renders a
// ~100 s video several times, so the whole file takes 10+ minutes.

import { after, before, describe, test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { startFixtureServer, type FixtureServer } from "./fixture-site/serve.ts";
import { COMMANDS } from "../commands.ts";
import { exitCodeFor, type ErrorCode } from "../errors.ts";
import type { Envelope, NaraEvent } from "../output.ts";
import { DEFAULT_VOICES } from "../../src/lib/voices.ts";
import { ffmpegSync, hasAudioStream, probeDuration, probeResolution } from "../../electron/ffmpeg.ts";
import { arrowGeometry, arrowLabelBox, arrowShape, pencilLoop, ARROW_DEFAULT_COLOR } from "../../electron/produce.ts";
import { ensureFlutterBuild, startFlutterFixture } from "../plugins/flutter/fixture/serve.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Rec = Record<string, any>;

const EDITOR = path.resolve(__dirname, "..", "..");
const BIN = path.join(EDITOR, "bin", "narascreen");
const FIXTURES = path.join(__dirname, "fixtures");
const TMP = path.join(__dirname, ".tmp");
const RUN = path.join(TMP, `e2e-${new Date().toISOString().replace(/[-:]/g, "").replace(/\..*/, "").replace("T", "-")}-${process.pid}`);

const MIN = 60_000;
const STALE_RUN_MS = 3 * 60 * MIN;
const ACME_PASSWORD = "correct-horse-battery";

/** Paths of the per-run copies of the fixture scripts (baseUrl → ephemeral port). */
const SCRIPT = {
  acme: path.join(RUN, "acme.demo-script.json"),
  broken: path.join(RUN, "broken-selector.demo-script.json"),
  invalid: path.join(RUN, "invalid.demo-script.json"),
  starter: path.join(RUN, "starter.demo-script.json"),
  imported: path.join(RUN, "imported.demo-script.json"),
  badRect: path.join(RUN, "bad-rect.demo-script.json"),
  upload: path.join(RUN, "upload.demo-script.json"),
  arrow: path.join(RUN, "arrow.demo-script.json"),
  converge: path.join(RUN, "converge.demo-script.json"),
  highlight: path.join(RUN, "highlight.demo-script.json"),
  flutter: path.join(RUN, "flutter.demo-script.json"),
  cards: path.join(RUN, "cards.demo-script.json"),
};
const JOB = path.join(RUN, "job");
const VIDEO_JOB = path.join(RUN, "job-video");
const MUSIC = path.join(RUN, "music.wav");
const VOICE = path.join(RUN, "voice.wav");

let server: FixtureServer;
let acmeRaw: Rec; // the acme script as written to SCRIPT.acme (tests edit + rewrite it)

/** Shared between the ordered job tests: later ones need an earlier `make`. */
const state: {
  made?: boolean;
  recordAt?: string;
  recordingMtime?: number;
  recordingSec?: number;
  videoSec?: number;
} = {};

// ─── running the CLI ─────────────────────────────────────────────────

interface CliRun {
  argv: string[];
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  seconds: number;
  stdout: string;
  stderr: string;
  /** stdout parsed as JSON (undefined if it wasn't exactly one JSON value). */
  json?: unknown;
  parseError?: string;
  /** stderr lines that parsed as JSON (with --events json). */
  events: NaraEvent[];
}

/**
 * Spawn bin/narascreen asynchronously. (Never spawnSync: the fixture server
 * runs in THIS process and must keep answering the browser.)
 */
function cli(
  args: string[],
  opts: { timeoutMs?: number; eventsJson?: boolean; env?: NodeJS.ProcessEnv } = {},
): Promise<CliRun> {
  const argv = [...args, ...(opts.eventsJson === false ? [] : ["--events", "json"])];
  // POSIX: exec the launcher itself (proves the shebang + executable bit).
  const [cmd, cmdArgs] = process.platform === "win32" ? [process.execPath, [BIN, ...argv]] : [BIN, argv];
  const env = opts.env ?? { ...process.env, ACME_PASSWORD };
  const started = Date.now();
  return new Promise((resolve) => {
    const child = spawn(cmd, cmdArgs, { cwd: RUN, env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 5000).unref();
    }, opts.timeoutMs ?? 2 * MIN);
    const finish = (exitCode: number | null, signal: NodeJS.Signals | null) => {
      clearTimeout(timer);
      const run: CliRun = {
        argv,
        exitCode,
        signal,
        timedOut,
        seconds: (Date.now() - started) / 1000,
        stdout,
        stderr,
        events: [],
      };
      try {
        run.json = JSON.parse(stdout);
      } catch (e) {
        run.parseError = e instanceof Error ? e.message : String(e);
      }
      for (const line of stderr.split("\n")) {
        if (!line.trim().startsWith("{")) continue;
        try {
          run.events.push(JSON.parse(line) as NaraEvent);
        } catch {
          /* not an event line */
        }
      }
      resolve(run);
    };
    child.on("error", (err) => {
      stderr += `\n[e2e] could not spawn ${cmd}: ${err.message}`;
      finish(null, null);
    });
    child.on("close", finish);
  });
}

/** Everything a human needs to see when an assertion about a run fails. */
function describeRun(r: CliRun): string {
  const lines = [
    `$ narascreen ${r.argv.join(" ")}`,
    `  → exit ${r.exitCode}${r.signal ? ` (signal ${r.signal})` : ""}${r.timedOut ? " (TIMED OUT, killed)" : ""} after ${r.seconds.toFixed(1)}s`,
  ];
  if (r.parseError) {
    lines.push(`  stdout is not exactly one JSON value (${r.parseError}). First 800 chars:`, indent(r.stdout.slice(0, 800) || "(empty)"));
  } else {
    const env = r.json as Rec;
    if (env?.error) lines.push("  error:", indent(clip(JSON.stringify(env.error, null, 2), 2500)));
    else if (env && "result" in env) lines.push("  result:", indent(clip(JSON.stringify(env.result, null, 2), 1500)));
    if (env?.warnings?.length) lines.push(`  warnings: ${clip(JSON.stringify(env.warnings), 600)}`);
  }
  const tail = r.stderr.trim().split("\n").slice(-25).join("\n");
  if (tail) lines.push("  stderr (last 25 lines):", indent(tail));
  return lines.join("\n");
}

const indent = (s: string) => s.replace(/^/gm, "    ");
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}… (${s.length - n} more chars)` : s);

// ─── envelope assertions ─────────────────────────────────────────────

/** stdout is one envelope of the documented shape, and the exit code matches it. */
function assertEnvelope(r: CliRun, command: string | null): Envelope {
  const ctx = () => `\n${describeRun(r)}`;
  assert.ok(!r.timedOut, `command timed out${ctx()}`);
  assert.ok(r.json !== undefined, `stdout must be exactly one JSON envelope${ctx()}`);
  const env = r.json as Rec;
  assert.ok(env && typeof env === "object" && !Array.isArray(env), `envelope must be a JSON object${ctx()}`);
  assert.equal(typeof env.ok, "boolean", `envelope.ok must be a boolean${ctx()}`);
  if (command !== null) assert.equal(env.command, command, `envelope.command${ctx()}`);
  else assert.equal(typeof env.command, "string", `envelope.command must be a string${ctx()}`);
  assert.ok(Array.isArray(env.warnings) && env.warnings.every((w: unknown) => typeof w === "string"), `envelope.warnings must be string[]${ctx()}`);
  assert.ok(Array.isArray(env.next) && env.next.every((n: unknown) => typeof n === "string"), `envelope.next must be string[]${ctx()}`);
  if (env.ok) {
    assert.ok("result" in env, `a successful envelope carries \`result\`${ctx()}`);
    assert.equal(env.error, undefined, `a successful envelope has no \`error\`${ctx()}`);
    assert.equal(r.exitCode, 0, `ok envelope → exit code 0${ctx()}`);
  } else {
    const e = env.error as Rec | undefined;
    assert.ok(e && typeof e.code === "string" && typeof e.message === "string", `a failed envelope carries error { code, message }${ctx()}`);
    if (e.hint !== undefined) assert.equal(typeof e.hint, "string", `error.hint must be a string${ctx()}`);
    if (e.where !== undefined) assert.equal(typeof e.where, "object", `error.where must be an object${ctx()}`);
    assert.equal(r.exitCode, exitCodeFor(e.code as ErrorCode), `exit code must be exitCodeFor(${e.code})${ctx()}`);
  }
  return env as Envelope;
}

/** Assert success and return `result`. */
function expectOk(r: CliRun, command: string): Rec {
  const env = assertEnvelope(r, command);
  assert.ok(env.ok, `expected \`${command}\` to succeed\n${describeRun(r)}`);
  return env.result as Rec;
}

/** Assert failure with exactly `code` (and its exit code) and return `error`. */
function expectError(r: CliRun, command: string | null, code: ErrorCode): Rec {
  const env = assertEnvelope(r, command);
  assert.ok(!env.ok, `expected ${code}, but the command succeeded\n${describeRun(r)}`);
  assert.equal(env.error?.code, code, `expected error code ${code}\n${describeRun(r)}`);
  assert.equal(r.exitCode, exitCodeFor(code), `expected exit code ${exitCodeFor(code)} for ${code}\n${describeRun(r)}`);
  return env.error as Rec;
}

function assertFile(p: unknown, what: string, r?: CliRun) {
  const extra = r ? `\n${describeRun(r)}` : "";
  assert.equal(typeof p, "string", `${what}: expected a path string, got ${JSON.stringify(p)}${extra}`);
  assert.ok(path.isAbsolute(p as string), `${what}: paths in results must be absolute, got ${p}${extra}`);
  assert.ok(fs.existsSync(p as string), `${what}: file does not exist: ${p}${extra}`);
  assert.ok(fs.statSync(p as string).size > 0, `${what}: file is empty: ${p}${extra}`);
}

function stagesOf(r: CliRun): string[] {
  return [...new Set(r.events.filter((e) => e.type === "stage").map((e) => String(e.stage)))];
}

/** Every JSON line on stderr must be a well-formed NaraEvent. */
function assertEventsWellFormed(r: CliRun) {
  const types = new Set(["stage", "step", "log", "warning"]);
  for (const ev of r.events) {
    const ok = typeof ev.ts === "string" && !Number.isNaN(Date.parse(ev.ts)) && types.has(ev.type) && typeof ev.message === "string";
    assert.ok(ok, `malformed event on stderr: ${JSON.stringify(ev)}\n${describeRun(r)}`);
  }
}

function needsMake(t: TestContext): boolean {
  if (state.made) return true;
  t.skip("needs a successful `make` earlier in this file (see that test's failure)");
  return false;
}

// ─── script helpers ──────────────────────────────────────────────────

function writeJson(file: string, value: unknown) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
}

function copyFixture(name: string, dest: string): Rec {
  const raw = JSON.parse(fs.readFileSync(path.join(FIXTURES, name), "utf-8")) as Rec;
  raw.baseUrl = server.url;
  writeJson(dest, raw);
  return raw;
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const stepOf = (script: Rec, id: string): Rec => script.steps.find((s: Rec) => s.id === id);
const entryCount = (script: Rec) => script.steps.reduce((n: number, s: Rec) => n + s.beat.length, 0);
/** Narration clips a script produces: narrate/zoom entries with text or audio, one per zoom target. */
const narrationCount = (script: Rec) =>
  script.steps
    .flatMap((s: Rec) => s.beat)
    .filter((e: Rec) => e.fx && !e.disabled)
    .reduce((n: number, e: Rec) => {
      if (e.targets) return n + e.targets.filter((t: Rec) => t.narrate != null || t.audio != null).length;
      return n + (e.narrate != null || e.audio != null ? 1 : 0);
    }, 0);

/** Generate a short audio file with ffmpeg (music bed / "recorded" voice line). */
function makeTone(file: string, freqs: number[], seconds: number) {
  const inputs = freqs.flatMap((f) => ["-f", "lavfi", "-i", `sine=frequency=${f}:sample_rate=44100:duration=${seconds}`]);
  const mix = `amix=inputs=${freqs.length},volume=0.6,afade=t=in:d=0.5,afade=t=out:st=${seconds - 0.5}:d=0.5`;
  const res = ffmpegSync(["-y", ...inputs, "-filter_complex", mix, "-ac", "2", file]);
  assert.ok(res.status === 0 && fs.existsSync(file), `ffmpeg could not generate ${file} (status ${res.status})`);
}
const readJobJson = () => JSON.parse(fs.readFileSync(path.join(JOB, "job.json"), "utf-8")) as Rec;
const readTrace = (job: string): Rec[] =>
  fs.readFileSync(path.join(job, "trace.jsonl"), "utf-8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as Rec);

/** RGB of one pixel of a video frame at time t. */
function pixelAt(video: string, t: number, x: number, y: number): [number, number, number] {
  const res = ffmpegSync(["-v", "error", "-i", video, "-ss", String(t), "-frames:v", "1", "-vf", `format=rgb24,crop=1:1:${Math.round(x)}:${Math.round(y)}`, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]);
  assert.ok(res.status === 0 && res.stdout.length >= 3, `could not read pixel (${x}, ${y}) at ${t}s of ${video}`);
  return [res.stdout[0], res.stdout[1], res.stdout[2]];
}
/** The default arrow colour (#F97316, orange) after H.264, on a grey background. */
const isArrow = ([r, g, b]: number[]) => r > 200 && g > 70 && g < 170 && b < 100;

/** Mean absolute luma difference between the same box in two video frames (0–255). */
function regionDiff(videoA: string, tA: number, videoB: string, tB: number, rect: number[]): number {
  const [x, y, w, h] = rect.map((n) => Math.round(n));
  const crop = `crop=${w}:${h}:${x}:${y}`;
  const res = ffmpegSync([
    "-v", "error",
    "-ss", String(Math.max(0, tA)), "-i", videoA,
    "-ss", String(Math.max(0, tB)), "-i", videoB,
    "-filter_complex", `[0:v]${crop}[a];[1:v]${crop}[b];[a][b]blend=all_mode=difference,signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-`,
    "-frames:v", "1", "-f", "null", "-",
  ]);
  const m = /YAVG=([\d.]+)/.exec(res.stdout.toString());
  assert.ok(m, `could not compare frames with ffmpeg (status ${res.status})`);
  return Number(m[1]);
}

// ─── the tests ───────────────────────────────────────────────────────

describe("narascreen CLI, end to end", () => {
  before(async () => {
    // Videos add up: drop e2e runs older than a few hours. (Not every older run:
    // another e2e process may be running right now, e.g. `npm run test:api`.)
    if (fs.existsSync(TMP)) {
      for (const d of fs.readdirSync(TMP)) {
        const dir = path.join(TMP, d);
        if (d.startsWith("e2e-") && Date.now() - fs.statSync(dir).mtimeMs > STALE_RUN_MS) fs.rmSync(dir, { recursive: true, force: true });
      }
    }
    fs.mkdirSync(RUN, { recursive: true });
    server = await startFixtureServer(0);
    makeTone(MUSIC, [261.63, 329.63, 392], 12); // a soft C-major chord, looped under the video
    makeTone(VOICE, [440], 2);
    acmeRaw = copyFixture("acme.demo-script.json", SCRIPT.acme);
    acmeRaw.music = { path: MUSIC, volume: 0.3, duckTo: 0.1 };
    writeJson(SCRIPT.acme, acmeRaw);
    copyFixture("broken-selector.demo-script.json", SCRIPT.broken);
    assert.ok(fs.existsSync(BIN), `launcher missing: ${BIN}`);
  });

  after(async () => {
    await server?.close();
  });

  // ── light commands ──

  test("help: lists every command, also with no arguments", async () => {
    const r = await cli(["help"]);
    const res = expectOk(r, "help");
    assert.ok(Array.isArray(res.commands), `result.commands must be an array\n${describeRun(r)}`);
    const names = res.commands.map((c: Rec) => c.name);
    for (const c of COMMANDS) assert.ok(names.includes(c.name), `help is missing command "${c.name}"; got ${names.join(", ")}`);
    for (const c of res.commands) {
      assert.ok(typeof c.usage === "string" && typeof c.summary === "string", `each command needs usage + summary: ${JSON.stringify(c)}`);
    }
    assert.equal(typeof res.docs, "string", `result.docs must say where the manual is\n${describeRun(r)}`);

    const bare = await cli([], { eventsJson: false });
    expectOk(bare, "help");
  });

  test("usage errors: unknown command, unknown flag, missing argument → USAGE (exit 3)", async () => {
    const unknownCmd = await cli(["frobnicate"]);
    const e1 = expectError(unknownCmd, null, "USAGE");
    assert.equal(typeof e1.hint, "string", `USAGE errors should hint at the fix\n${describeRun(unknownCmd)}`);

    expectError(await cli(["validate", SCRIPT.acme, "--no-such-flag"]), "validate", "USAGE");
    expectError(await cli(["validate"]), "validate", "USAGE");
  });

  test("schema: prints the demo-script JSON Schema (raw, not an envelope)", async () => {
    const r = await cli(["schema"]);
    assert.equal(r.exitCode, 0, `schema must exit 0\n${describeRun(r)}`);
    const s = r.json as Rec;
    assert.ok(s && typeof s === "object", `stdout must be one JSON document\n${describeRun(r)}`);
    assert.equal(s.ok, undefined, "schema prints the raw JSON Schema, not an envelope");
    assert.match(String(s.$schema), /json-schema\.org/, "$schema must name a JSON Schema draft");
    assert.equal(s.type, "object");
    for (const k of ["version", "scope", "steps"]) {
      assert.ok(s.required?.includes(k), `schema.required must include "${k}"; got ${JSON.stringify(s.required)}`);
    }
    for (const k of ["version", "scope", "baseUrl", "viewport", "setup", "defaults", "tts", "languages", "steps"]) {
      assert.ok(s.properties?.[k], `schema.properties.${k} missing`);
    }

    const out = path.join(RUN, "demo-script.schema.json");
    const w = await cli(["schema", "--out", out]);
    const res = expectOk(w, "schema");
    assert.equal(res.path, out, `schema --out returns { path }\n${describeRun(w)}`);
    assert.deepEqual(JSON.parse(fs.readFileSync(out, "utf-8")), s, "schema --out writes the same schema as stdout");
  });

  test("voices: every catalog language with its voices; --lang filters", async () => {
    const r = await cli(["voices"]);
    const res = expectOk(r, "voices");
    const langs = res.languages as Rec[];
    assert.ok(Array.isArray(langs), `result.languages must be an array\n${describeRun(r)}`);
    for (const [code, voices] of Object.entries(DEFAULT_VOICES)) {
      const l = langs.find((x) => x.code === code);
      assert.ok(l, `voices is missing language "${code}"`);
      assert.deepEqual(l.voices, voices, `voices for ${code}`);
      assert.equal(l.defaultVoice, voices[0], `defaultVoice for ${code} is the first catalog voice`);
      assert.equal(typeof l.label, "string", `label for ${code}`);
    }

    const hi = expectOk(await cli(["voices", "--lang", "hi"]), "voices");
    assert.deepEqual(hi.languages.map((l: Rec) => l.code), ["hi"], "--lang hi returns only Hindi");
  });

  test("doctor: this machine is ready (ffmpeg, Chromium, TTS)", async () => {
    const r = await cli(["doctor"], { timeoutMs: MIN });
    const env = assertEnvelope(r, "doctor");
    const checks = ((env.ok ? (env.result as Rec)?.checks : env.error?.details?.checks) ?? []) as Rec[];
    for (const c of checks) {
      assert.ok(typeof c.id === "string" && typeof c.ok === "boolean" && typeof c.required === "boolean" && typeof c.detail === "string", `malformed doctor check: ${JSON.stringify(c)}`);
    }
    const failing = checks.filter((c) => !c.ok).map((c) => `  - ${c.id}${c.required ? " (required)" : ""}: ${c.detail}${c.fix ? `\n      fix: ${c.fix}` : ""}`);
    assert.ok(
      env.ok && (env.result as Rec).ready === true,
      `ENVIRONMENT NOT READY. The rest of this file needs a working toolchain. Failing checks:\n${failing.join("\n") || "  (none listed)"}\n${describeRun(r)}`,
    );
    assert.ok(checks.length > 0, "doctor must list its checks");
  });

  test("init: writes a starter script that passes validate", async () => {
    const r = await cli(["init", "--url", server.url, "--out", SCRIPT.starter]);
    const res = expectOk(r, "init");
    assert.equal(res.scriptPath, SCRIPT.starter, `init returns the absolute scriptPath\n${describeRun(r)}`);
    assertFile(res.scriptPath, "init scriptPath", r);

    const v = await cli(["validate", SCRIPT.starter]);
    const vr = expectOk(v, "validate");
    assert.equal(vr.valid, true, `validate result.valid\n${describeRun(v)}`);
  });

  test("validate: the acme fixture is valid, warning-free, and suggests a next command", async () => {
    const r = await cli(["validate", SCRIPT.acme]);
    const res = expectOk(r, "validate");
    const env = r.json as Envelope;
    assert.equal(res.valid, true);
    assert.equal(res.scriptPath, SCRIPT.acme, "result.scriptPath is the absolute script path");
    assert.equal(res.summary?.steps, acmeRaw.steps.length, `summary.steps\n${describeRun(r)}`);
    assert.deepEqual(env.warnings, [], `the showcase script should validate without warnings\n${describeRun(r)}`);
    assert.ok(env.next.length > 0, `validate should suggest the next command (e.g. check)\n${describeRun(r)}`);
  });

  test("validate: a schema-breaking script → SCRIPT_INVALID listing every issue with its path", async () => {
    writeJson(SCRIPT.invalid, {
      version: 1,
      scope: "Invalid on purpose",
      baseUrl: "not a url",
      steps: [{ id: "first", beat: [{ act: "clik", role: "button", name: "Save" }] }],
    });
    const r = await cli(["validate", SCRIPT.invalid]);
    const err = expectError(r, "validate", "SCRIPT_INVALID");
    const issues = err.details?.issues as Rec[] | undefined;
    assert.ok(Array.isArray(issues) && issues.length >= 2, `details.issues must list every problem\n${describeRun(r)}`);
    for (const i of issues) assert.ok(typeof i.path === "string" && typeof i.message === "string", `issue needs { path, message }: ${JSON.stringify(i)}`);
    const paths = issues.map((i) => i.path);
    assert.ok(paths.includes("baseUrl"), `expected an issue at "baseUrl"; got ${JSON.stringify(paths)}`);
    assert.ok(paths.includes("steps[0].beat[0].act"), `expected an issue at "steps[0].beat[0].act"; got ${JSON.stringify(paths)}`);
    assert.equal(err.where?.path, issues[0].path, "error.where.path points at the first issue");
  });

  test("validate: an unset ${env:NAME} → ENV_VAR_MISSING naming the variable", async () => {
    const env = { ...process.env };
    delete env.ACME_PASSWORD;
    const r = await cli(["validate", SCRIPT.acme], { env });
    const err = expectError(r, "validate", "ENV_VAR_MISSING");
    assert.deepEqual(err.details?.variables, ["ACME_PASSWORD"], `details.variables\n${describeRun(r)}`);
  });

  // ── browser commands ──

  test("inspect --url: lists the sign-in form with ready-to-paste selectors", { timeout: 4 * MIN }, async () => {
    const out = path.join(RUN, "inspect-login");
    const r = await cli(["inspect", "--url", `${server.url}/#/login`, "--out", out], { timeoutMs: 3 * MIN });
    const res = expectOk(r, "inspect");
    assert.equal(res.viewport?.width, 1440, "default viewport width");
    assert.equal(res.viewport?.height, 900, "default viewport height");
    assertFile(res.screenshot, "inspect screenshot", r);
    assertFile(res.ariaSnapshotPath, "inspect ariaSnapshotPath", r);
    const els = res.elements as Rec[];
    assert.ok(Array.isArray(els) && els.length > 0, `result.elements must be a non-empty array\n${describeRun(r)}`);
    for (const el of els) {
      assert.ok(typeof el.role === "string" && typeof el.name === "string" && el.selector && typeof el.matches === "number", `element needs { role, name, selector, matches }: ${JSON.stringify(el)}`);
    }
    const find = (role: string, name: string) => els.find((e) => e.role === role && e.name === name);
    assert.ok(find("textbox", "Email"), `expected textbox "Email" among ${els.length} elements:\n${summarizeElements(els)}`);
    const signIn = find("button", "Sign in");
    assert.ok(signIn, `expected button "Sign in" among:\n${summarizeElements(els)}`);
    assert.equal(signIn.matches, 1, `the selector offered for "Sign in" should be unique: ${JSON.stringify(signIn.selector)}`);
  });

  test("inspect --script --until: logs in, walks to the task list, and finds the New task button", { timeout: 5 * MIN }, async () => {
    const out = path.join(RUN, "inspect-tasks");
    const r = await cli(["inspect", "--script", SCRIPT.acme, "--until", "open-tasks", "--out", out], { timeoutMs: 4 * MIN });
    const res = expectOk(r, "inspect");
    assert.match(String(res.url), /#\/tasks/, `inspect should end on the tasks page\n${describeRun(r)}`);
    const els = res.elements as Rec[];
    const btn = els.find((e) => e.role === "button" && e.name === "New task");
    assert.ok(btn, `expected { role: "button", name: "New task" } among:\n${summarizeElements(els)}`);
    assert.equal(btn.selector?.role, "button", `selector for "New task": ${JSON.stringify(btn.selector)}`);
    assert.equal(btn.selector?.name, "New task", `selector for "New task": ${JSON.stringify(btn.selector)}`);
    assert.equal(btn.matches, 1, `the "New task" selector should be unique: ${JSON.stringify(btn)}`);
    assertFile(res.screenshot, "inspect screenshot", r);
  });

  test("check: every step of the acme script runs; progress arrives as JSON events", { timeout: 6 * MIN }, async () => {
    const r = await cli(["check", SCRIPT.acme, "--out", path.join(RUN, "check")], { timeoutMs: 5 * MIN });
    const res = expectOk(r, "check");
    assert.equal(res.slots, entryCount(acmeRaw), `check visits every step entry once (slots)\n${describeRun(r)}`);
    assert.ok(typeof res.durationSec === "number" && res.durationSec > 0, `result.durationSec\n${describeRun(r)}`);
    assert.ok((r.json as Envelope).next.length > 0, `check should suggest the next command (make)\n${describeRun(r)}`);

    assertEventsWellFormed(r);
    const stepIds = new Set(r.events.filter((e) => e.type === "step").map((e) => e.data?.id));
    for (const s of acmeRaw.steps) assert.ok(stepIds.has(s.id), `expected a "step" event with data.id "${s.id}"; got ${JSON.stringify([...stepIds])}`);
  });

  test("check: a wrong selector → SELECTOR_NOT_FOUND with where, candidates and a screenshot", { timeout: 4 * MIN }, async () => {
    const r = await cli(["check", SCRIPT.broken, "--out", path.join(RUN, "check-broken")], { timeoutMs: 3 * MIN });
    const err = expectError(r, "check", "SELECTOR_NOT_FOUND");
    assert.deepEqual(
      { step: err.where?.step, entry: err.where?.entry, path: err.where?.path },
      { step: "add-task", entry: 0, path: "steps[1].beat[0]" },
      `error.where must point at the failing entry\n${describeRun(r)}`,
    );
    const d = err.details as Rec;
    assert.equal(d?.selector?.role, "button", `details.selector is the selector object\n${describeRun(r)}`);
    assert.equal(d?.selector?.name, "Add task", `details.selector is the selector object\n${describeRun(r)}`);
    assert.match(String(d?.url), /#\/tasks/, "details.url is the page the browser was on");
    assertFile(d?.screenshot, "details.screenshot", r);
    const cands = d?.candidates as Rec[] | undefined;
    assert.ok(Array.isArray(cands) && cands.length > 0, `details.candidates must suggest similar elements\n${describeRun(r)}`);
    assert.ok(
      cands.some((c) => c.name === "New task"),
      `candidates for "Add task" should include the real "New task" button; got ${JSON.stringify(cands.map((c) => `${c.role} "${c.name}"`))}`,
    );
  });

  // ── upload act (fixture page #/import) ──

  /** The acme login + a goto to #/import, then `beat` as step "choose". */
  const uploadScript = (beat: Rec[], extra: Rec = {}): Rec => ({
    version: 1,
    scope: "Upload act",
    baseUrl: server.url,
    setup: clone(acmeRaw.setup),
    ...extra,
    steps: [
      { id: "open", beat: [{ act: "goto", path: "/#/import" }, { act: "waitFor", role: "heading", name: "Import", exact: true }] },
      { id: "choose", beat },
    ],
  });
  const uploadFiles = () => {
    fs.mkdirSync(path.join(RUN, "uploads"), { recursive: true });
    for (const f of ["comp-sheet.xlsx", "a.pdf", "b.pdf"]) fs.writeFileSync(path.join(RUN, "uploads", f), `fixture ${f}`);
  };

  test("upload: a visible input, a hidden input behind a button, a multi-file input — names render, effects frame the label; inspect lists hidden inputs", { timeout: 10 * MIN }, async () => {
    uploadFiles();
    writeJson(
      SCRIPT.upload,
      uploadScript([
        { act: "upload", label: "Task sheet file", files: "uploads/comp-sheet.xlsx" },
        { act: "waitFor", text: "Chosen: comp-sheet.xlsx" },
        { act: "upload", role: "button", name: "Choose file", files: ["uploads/a.pdf"] },
        { act: "waitFor", testId: "imp-hidden-out", note: "hidden input → its button opened the picker" },
        { act: "waitFor", text: "Chosen: a.pdf" },
        { act: "upload", css: "#imp-multi", files: ["uploads/a.pdf", "uploads/b.pdf"] },
        { fx: "spotlight", note: "inherits the hidden input's visible label" },
        { act: "waitFor", text: "Chosen: a.pdf, b.pdf" },
      ]),
    );
    expectOk(await cli(["validate", SCRIPT.upload]), "validate");
    const r = await cli(["check", SCRIPT.upload, "--out", path.join(RUN, "check-upload")], { timeoutMs: 5 * MIN });
    const res = expectOk(r, "check");
    assert.equal(res.slots, 10, `every entry ran\n${describeRun(r)}`);
    assert.ok(
      r.events.some((e) => e.type === "log" && /upload .*comp-sheet\.xlsx/.test(e.message)),
      `the progress log names the uploaded files\n${describeRun(r)}`,
    );

    // Recorded, effects after an upload get a real box: the hidden multi input's visible label, not its 1px self.
    const rec = await cli(["record", SCRIPT.upload, "--out", path.join(RUN, "job-upload")], { timeoutMs: 4 * MIN });
    expectOk(rec, "record");
    const spot = readTrace(path.join(RUN, "job-upload")).find((e) => e.fx === "spotlight");
    assert.ok(spot?.rect && spot.rect[2] >= 40 && spot.rect[3] >= 20, `spotlight after the hidden multi-file input should frame its label: ${JSON.stringify(spot)}\n${describeRun(rec)}`);

    const ins = await cli(["inspect", "--script", SCRIPT.upload, "--until", "open", "--out", path.join(RUN, "inspect-upload")], { timeoutMs: 4 * MIN });
    const els = expectOk(ins, "inspect").elements as Rec[];
    const files = els.filter((e) => e.inputType === "file");
    assert.equal(files.length, 3, `all three file inputs are listed (hidden too):\n${summarizeElements(els)}`);
    const hidden = files.find((e) => e.visible === false && e.multiple === false);
    assert.ok(hidden?.selector, `the hidden input comes with a selector: ${JSON.stringify(files)}`);
    assert.ok(files.some((e) => e.multiple === true), `the multi-file input is flagged multiple: ${JSON.stringify(files)}`);
  });

  test("upload: a target that opens no file picker → ACTION_FAILED with the hint", { timeout: 4 * MIN }, async () => {
    uploadFiles();
    writeJson(SCRIPT.upload, uploadScript([{ act: "upload", text: "Drop files here", files: "uploads/a.pdf" }], { defaults: { timeoutMs: 3000 } }));
    const r = await cli(["check", SCRIPT.upload, "--out", path.join(RUN, "check-upload-bad")], { timeoutMs: 3 * MIN });
    const err = expectError(r, "check", "ACTION_FAILED");
    assert.equal(err.where?.path, "steps[1].beat[0]", `error.where\n${describeRun(r)}`);
    assert.match(String(err.hint), /neither a file input nor something that opens a file picker/, describeRun(r));
  });

  test("upload: two files into a single-file input → ACTION_FAILED; a missing file → SCRIPT_INVALID at files[k]", { timeout: 4 * MIN }, async () => {
    uploadFiles();
    writeJson(SCRIPT.upload, uploadScript([{ act: "upload", label: "Task sheet file", files: ["uploads/a.pdf", "uploads/b.pdf"] }]));
    const many = await cli(["check", SCRIPT.upload, "--out", path.join(RUN, "check-upload-many")], { timeoutMs: 3 * MIN });
    expectError(many, "check", "ACTION_FAILED");

    writeJson(SCRIPT.upload, uploadScript([{ act: "upload", label: "Task sheet file", files: ["uploads/nope.xlsx"] }]));
    const r = await cli(["validate", SCRIPT.upload]);
    const err = expectError(r, "validate", "SCRIPT_INVALID");
    const paths = (err.details?.issues as Rec[]).map((i) => i.path);
    assert.ok(paths.includes("steps[1].beat[0].files[0]"), `expected an issue at files[0]; got ${JSON.stringify(paths)}`);
  });

  // ── the job lifecycle (ordered; later tests reuse this job) ──

  test("make: records, narrates and renders the acme demo into a job folder", { timeout: 25 * MIN }, async (t) => {
    const r = await cli(["make", SCRIPT.acme, "--out", JOB], { timeoutMs: 20 * MIN });
    const res = expectOk(r, "make");
    t.diagnostic(`make took ${r.seconds.toFixed(0)}s`);
    assert.equal(res.job, JOB, `result.job is the absolute job folder\n${describeRun(r)}`);
    assert.equal(res.recorded, true, `a fresh job must be recorded\n${describeRun(r)}`);
    assert.equal(res.videos?.length, 1, `one video per language (script.languages = ["en"])\n${describeRun(r)}`);

    const job = readJobJson();
    assert.equal(job.record?.status, "done", `job.json record.status\n${JSON.stringify(job.record)}`);
    assert.equal(job.produce?.en?.status, "done", `job.json produce.en.status\n${JSON.stringify(job.produce)}`);
    assert.equal(job.record.slots, entryCount(acmeRaw), "job.json record.slots = one per step entry");

    const recording = path.join(JOB, "recordings", "recording.mp4");
    assertFile(recording, "recordings/recording.mp4");
    assert.equal(readTrace(JOB).length, entryCount(acmeRaw), "trace.jsonl has one line per step entry");
    for (const f of ["job.json", "script.json", "demo-project.json", "demo-project.en.json"]) assertFile(path.join(JOB, f), f);

    const v = res.videos[0] as Rec;
    assert.equal(v.lang, "en");
    assert.equal(v.path, path.join(JOB, "video", "final_en.mp4"), `video path\n${describeRun(r)}`);
    assertFile(v.path, "final video", r);
    const recSec = probeDuration(recording);
    const videoSec = probeDuration(v.path);
    t.diagnostic(`recording ${recSec.toFixed(1)}s → final video ${videoSec.toFixed(1)}s`);
    assert.ok(Math.abs(v.durationSec - videoSec) < 1, `reported durationSec ${v.durationSec} vs ffprobe ${videoSec.toFixed(2)}`);
    assert.ok(videoSec > recSec + 5, `narration freezes should make the video longer than the recording: video ${videoSec.toFixed(1)}s, recording ${recSec.toFixed(1)}s`);
    assert.ok(hasAudioStream(v.path), "the final video must have an audio track (narration)");
    assert.deepEqual(probeResolution(v.path), { width: 1440, height: 900 }, "video size = script viewport");

    const narr = v.narrations as Rec[];
    assert.equal(narr?.length, narrationCount(acmeRaw), `one narration per narrate/zoom-with-narrate entry\n${JSON.stringify(narr, null, 2)}`);
    for (const n of narr) {
      assert.ok(typeof n.step === "string" && typeof n.entry === "number" && typeof n.text === "string" && typeof n.voice === "string" && typeof n.cached === "boolean" && n.durationSec > 0, `malformed narration: ${JSON.stringify(n)}`);
    }

    // The arrow fx becomes a callout with style "arrow" whose first panel is the Overdue card.
    const project = JSON.parse(fs.readFileSync(path.join(JOB, "demo-project.en.json"), "utf-8")) as Rec;
    const arrow = (project.actions as Rec[]).find((a) => a.type === "callout" && a.calloutStyle === "arrow");
    const overdue = readTrace(JOB).find((e) => e.fx === "arrow");
    assert.ok(arrow && overdue?.rect, `the arrow reaches the project with a target\n${JSON.stringify(arrow)}`);
    assert.deepEqual(arrow.calloutPanels?.[0]?.rect, overdue.rect, "the arrow points at the recorded element box");
    assert.equal(arrow.calloutPanels[0].text, "Needs attention");
    assert.ok(arrow.calloutDuration > 1, `"auto" keeps it up until the next narration ends: ${arrow.calloutDuration}`);

    assertFile(v.preview?.contactSheet, "preview.contactSheet", r);
    assert.ok(Array.isArray(v.preview?.frames) && v.preview.frames.length > 0, "preview.frames");
    for (const f of v.preview.frames) assertFile(f.path, `preview frame t=${f.t}`);

    assertEventsWellFormed(r);
    const stages = stagesOf(r);
    for (const s of ["record", "tts", "compile", "render"]) assert.ok(stages.includes(s), `expected a "${s}" stage event; got ${JSON.stringify(stages)}`);

    state.made = true;
    state.recordAt = job.record.at;
    state.recordingMtime = fs.statSync(recording).mtimeMs;
    state.recordingSec = recSec;
    state.videoSec = videoSec;
  });

  test("make: the blur really hides the API key in the final video", async (t) => {
    if (!needsMake(t)) return;
    // The acme video ends on Settings with the key still on screen and the blur
    // (duration 60) still active, so the last second of the final video must
    // differ from the raw recording inside the key's box. Unblurred ≈ 0.5
    // (compression noise); blurred text ≈ 10.
    const slot = readTrace(JOB).find((e) => e.beat === "settings" && e.fx === "blur");
    assert.ok(slot?.rect, `trace.jsonl has no rect for the settings blur: ${JSON.stringify(slot)}`);
    const final = path.join(JOB, "video", "final_en.mp4");
    const recording = path.join(JOB, "recordings", "recording.mp4");
    const diff = regionDiff(final, (state.videoSec ?? 0) - 1, recording, (state.recordingSec ?? 0) - 0.5, slot.rect);
    t.diagnostic(`mean pixel difference in the blurred box: ${diff.toFixed(2)}`);
    assert.ok(
      diff > 3,
      `the API key is NOT blurred at the end of ${final} (mean |final - raw| in ${JSON.stringify(slot.rect)} = ${diff.toFixed(2)}, expected > 3). ` +
        `See ${path.join(JOB, "logs")} for a skipped blur pass.`,
    );
  });

  test("make again: unchanged script reuses the recording (recorded: false)", { timeout: 20 * MIN }, async (t) => {
    if (!needsMake(t)) return;
    const r = await cli(["make", SCRIPT.acme, "--out", JOB], { timeoutMs: 15 * MIN });
    const res = expectOk(r, "make");
    assert.equal(res.recorded, false, `an unchanged script must reuse the recording\n${describeRun(r)}`);
    assert.equal(readJobJson().record.at, state.recordAt, "job.json record.at must not change");
    assert.equal(fs.statSync(path.join(JOB, "recordings", "recording.mp4")).mtimeMs, state.recordingMtime, "recording.mp4 must not be rewritten");
    assertFile(res.videos?.[0]?.path, "final video", r);
  });

  test("produce after a narration-only edit: no re-record, audio re-generated, new duration", { timeout: 20 * MIN }, async (t) => {
    if (!needsMake(t)) return;
    const edited = clone(acmeRaw);
    const wrap = stepOf(edited, "wrap-up").beat[0];
    wrap.narrate =
      "That's Acme Tasks: plan the work, track progress, and keep everyone in the loop. " +
      "Thanks for watching. Next time, we'll look at reports, recurring tasks, and team permissions in much more detail.";
    writeJson(SCRIPT.acme, edited);
    let passed = false;
    try {
      const r = await cli(["produce", JOB], { timeoutMs: 15 * MIN });
      const res = expectOk(r, "produce");
      assert.equal(res.job, JOB);
      assert.equal(readJobJson().record.at, state.recordAt, "a text-only edit must not re-record (job.json record.at changed)");
      assert.equal(fs.statSync(path.join(JOB, "recordings", "recording.mp4")).mtimeMs, state.recordingMtime, "recording.mp4 must not be rewritten");

      const v = res.videos?.[0] as Rec;
      assertFile(v?.path, "final video", r);
      const sec = probeDuration(v.path);
      t.diagnostic(`video ${state.videoSec?.toFixed(1)}s → ${sec.toFixed(1)}s after lengthening one narration`);
      assert.ok(sec > (state.videoSec ?? 0) + 3, `a much longer narration must lengthen the video: before ${state.videoSec?.toFixed(1)}s, after ${sec.toFixed(1)}s`);

      const narr = v.narrations as Rec[];
      const changed = narr.find((n) => n.step === "wrap-up");
      assert.ok(changed, `no narration reported for step wrap-up: ${JSON.stringify(narr)}`);
      assert.equal(changed.text, wrap.narrate, "the edited narration text is what was spoken");
      assert.equal(changed.cached, false, "edited text → new audio (cached: false)");
      assert.ok(narr.filter((n) => n.cached).length >= narr.length - 1, `unchanged narrations should reuse cached audio: ${JSON.stringify(narr.map((n) => [n.step, n.cached]))}`);
      // Later tests compare against this script + duration.
      acmeRaw = edited;
      state.videoSec = sec;
      passed = true;
    } finally {
      if (!passed) writeJson(SCRIPT.acme, acmeRaw);
    }
  });

  test("produce after toggling `disabled` on an effect: no re-record, the narration is left out", { timeout: 20 * MIN }, async (t) => {
    if (!needsMake(t)) return;
    const toggled = clone(acmeRaw);
    const narrs = stepOf(toggled, "open-and-overdue").beat.filter((e: Rec) => e.fx === "narrate");
    assert.ok(narrs.length, "fixture changed: open-and-overdue should contain a narrate entry");
    for (const n of narrs) n.disabled = true;
    writeJson(SCRIPT.acme, toggled);
    try {
      const r = await cli(["produce", JOB], { timeoutMs: 15 * MIN });
      const res = expectOk(r, "produce");
      assert.equal(readJobJson().record.at, state.recordAt, "toggling `disabled` must not re-record (job.json record.at changed)");
      const v = res.videos?.[0] as Rec;
      assertFile(v?.path, "final video", r);
      const spoken = (v.narrations as Rec[]).map((n) => n.step);
      assert.ok(!spoken.includes("open-and-overdue"), `a disabled narrate must not be spoken; narrations came from ${JSON.stringify(spoken)}`);
      assert.equal(spoken.length, narrationCount(toggled), `narrations = the enabled narrating entries\n${describeRun(r)}`);
      const sec = probeDuration(v.path);
      t.diagnostic(`video ${state.videoSec?.toFixed(1)}s → ${sec.toFixed(1)}s with one narration disabled`);
      assert.ok(sec < (state.videoSec ?? Infinity) - 2, `dropping a narration must shorten the video: before ${state.videoSec?.toFixed(1)}s, after ${sec.toFixed(1)}s`);
    } finally {
      writeJson(SCRIPT.acme, acmeRaw);
    }
  });

  test("produce after a browser-step edit → SCRIPT_STRUCTURE_CHANGED naming the step (exit 1)", { timeout: 3 * MIN }, async (t) => {
    if (!needsMake(t)) return;
    const changed = clone(acmeRaw);
    stepOf(changed, "wrap-up").beat.unshift({ act: "wait", ms: 500 });
    writeJson(SCRIPT.acme, changed);
    try {
      const r = await cli(["produce", JOB], { timeoutMs: 2 * MIN });
      const err = expectError(r, "produce", "SCRIPT_STRUCTURE_CHANGED");
      assert.ok(err.details?.changedSteps?.includes("wrap-up"), `details.changedSteps should name "wrap-up"\n${describeRun(r)}`);
      assert.equal(typeof err.hint, "string", "the hint tells the agent how to re-record");
    } finally {
      writeJson(SCRIPT.acme, acmeRaw); // back to the recorded structure for the tests below
    }
  });

  test("produce --resolution 720p: a letterboxed 1280x720 video; a bad preset → USAGE", { timeout: 20 * MIN }, async (t) => {
    if (!needsMake(t)) return;
    expectError(await cli(["produce", JOB, "--resolution", "999p"]), "produce", "USAGE");
    const r = await cli(["produce", JOB, "--resolution", "720p"], { timeoutMs: 15 * MIN });
    const res = expectOk(r, "produce");
    const v = res.videos?.[0] as Rec;
    assertFile(v?.path, "final video", r);
    assert.deepEqual(probeResolution(v.path), { width: 1280, height: 720 }, `--resolution 720p must give 1280x720 (ffprobe)\n${describeRun(r)}`);
    assert.equal(readJobJson().record.at, state.recordAt, "changing the output size must not re-record");
  });

  test("preview: frames and a contact sheet from the produced video", { timeout: 5 * MIN }, async (t) => {
    if (!needsMake(t)) return;
    const r = await cli(["preview", JOB, "--lang", "en", "--tiles", "4"], { timeoutMs: 4 * MIN });
    const res = expectOk(r, "preview");
    assert.equal(res.video, path.join(JOB, "video", "final_en.mp4"), `result.video\n${describeRun(r)}`);
    assertFile(res.contactSheet, "contactSheet", r);
    assert.equal(res.frames?.length, 4, `--tiles 4 → 4 frames\n${describeRun(r)}`);
    for (const f of res.frames) {
      assertFile(f.path, `frame t=${f.t}`, r);
      assert.ok(f.t >= 0 && f.t <= res.durationSec, `frame time ${f.t} inside the video (${res.durationSec}s)`);
    }
  });

  test("status: shows what the job has recorded and produced", async (t) => {
    if (!needsMake(t)) return;
    const r = await cli(["status", JOB]);
    const res = expectOk(r, "status");
    assert.equal(res.job, JOB, `result.job\n${describeRun(r)}`);
    assert.equal(res.scope, acmeRaw.scope, "result.scope");
    assert.equal(res.record?.status, "done", `result.record\n${describeRun(r)}`);
    assert.equal(res.produce?.en?.status, "done", `result.produce.en\n${describeRun(r)}`);
    assert.ok(res.artifacts, `result.artifacts\n${describeRun(r)}`);
    assert.ok((r.json as Envelope).next.length > 0, `status should suggest the next command\n${describeRun(r)}`);
  });

  // ── video-source scripts: edit an existing video (the recording made above) ──

  test("video-source script: check/make without a browser, recorded voice, preview --raw; inspect → USAGE", { timeout: 25 * MIN }, async (t) => {
    if (!needsMake(t)) return;
    writeJson(SCRIPT.imported, {
      version: 1,
      scope: "Imported recording",
      // Relative paths resolve against the script file (this run folder).
      source: { video: path.relative(RUN, path.join(JOB, "recordings", "recording.mp4")) },
      steps: [
        {
          id: "highlights",
          label: "Narrate over an existing video",
          beat: [
            { fx: "narrate", at: 1, audio: path.basename(VOICE), narrate: "A line recorded earlier, shown as subtitles." },
            { fx: "spotlight", at: 2, rects: [[280, 174, 363, 157], [1045, 174, 363, 157]], duration: 2 },
            { fx: "mute", at: 4, seconds: 2 },
            { fx: "speed", at: 6, factor: 2, seconds: 4 },
          ],
        },
      ],
    });

    const v = await cli(["validate", SCRIPT.imported]);
    expectOk(v, "validate");

    const c = await cli(["check", SCRIPT.imported], { timeoutMs: 2 * MIN });
    const cr = expectOk(c, "check");
    assert.equal(cr.mode, "video", `check on a video-source script reports mode "video"\n${describeRun(c)}`);
    assert.equal(cr.slots, 4, `one slot per fx\n${describeRun(c)}`);

    expectError(await cli(["inspect", "--script", SCRIPT.imported]), "inspect", "USAGE");

    const r = await cli(["make", SCRIPT.imported, "--out", VIDEO_JOB], { timeoutMs: 20 * MIN });
    const res = expectOk(r, "make");
    t.diagnostic(`video-source make took ${r.seconds.toFixed(0)}s`);
    assert.equal(res.job, VIDEO_JOB);
    assert.equal(res.recorded, true, `the first make imports the source video (recorded: true)\n${describeRun(r)}`);
    const out = res.videos?.[0] as Rec;
    assertFile(out?.path, "final video", r);
    assert.ok(probeDuration(out.path) > 1, "the produced video has a real duration");
    assert.ok(hasAudioStream(out.path), "the recorded voice line is in the audio track");
    assert.deepEqual(probeResolution(out.path), probeResolution(path.join(JOB, "recordings", "recording.mp4")), "native output = source video size");
    const narr = out.narrations as Rec[];
    assert.equal(narr?.length, 1, `one narration (the recorded audio)\n${describeRun(r)}`);
    assert.equal(narr[0].voice, "recorded", `a narration with \`audio\` reports voice "recorded": ${JSON.stringify(narr[0])}`);

    const p = await cli(["preview", VIDEO_JOB, "--raw", "--tiles", "4"], { timeoutMs: 4 * MIN });
    const pr = expectOk(p, "preview");
    assert.equal(pr.video, path.join(VIDEO_JOB, "recordings", "recording.mp4"), `preview --raw looks at the imported recording\n${describeRun(p)}`);
    assertFile(pr.contactSheet, "raw contactSheet", p);
    assert.equal(pr.frames?.length, 4, `--tiles 4 → 4 frames\n${describeRun(p)}`);
  });

  test("arrow: one smooth line draws itself to the target, head riding its tip — at the computed spot; a label at its tail", { timeout: 10 * MIN }, async () => {
    // A plain grey 1280x720 video: every amber pixel is the arrow.
    const grey = path.join(RUN, "grey.mp4");
    const gen = ffmpegSync(["-y", "-f", "lavfi", "-i", "color=c=0x808080:s=1280x720:r=30:d=5", "-pix_fmt", "yuv420p", grey]);
    assert.equal(gen.status, 0, "ffmpeg could not generate the grey video");
    const target: [number, number, number, number] = [600, 200, 200, 80];
    const at = 1;
    writeJson(SCRIPT.arrow, {
      version: 1,
      scope: "Arrow",
      source: { video: grey },
      steps: [{ id: "point", beat: [{ fx: "arrow", at, rect: target, text: "Click here", duration: 3 }] }],
    });
    expectOk(await cli(["validate", SCRIPT.arrow]), "validate");
    const r = await cli(["make", SCRIPT.arrow, "--out", path.join(RUN, "job-arrow")], { timeoutMs: 8 * MIN });
    const video = (expectOk(r, "make").videos as Rec[])[0].path as string;
    assertFile(video, "arrow video", r);

    // Same geometry as the renderer: default direction, one curved line, chevron head.
    const g = arrowGeometry(target, { width: 1280, height: 720 });
    assert.equal(g.from, "bottom-left", "default direction when there is room");
    const shape = arrowShape(g);
    const along = (f: number) => shape.at(shape.length * f);
    const head = g.tip; // the chevron's arms meet at the tip
    assert.equal(ARROW_DEFAULT_COLOR, "#F97316");

    // 0.1 s in: the line has started from the tail but not reached the target.
    const early = at + 0.1;
    assert.ok(isArrow(pixelAt(video, early, ...along(0.15))), `line started at ${early}s: ${pixelAt(video, early, ...along(0.15))}`);
    assert.ok(!isArrow(pixelAt(video, early, ...along(0.95))), `line not at the target yet at ${early}s`);
    assert.ok(!isArrow(pixelAt(video, early, head[0] - 2, head[1] + 2)), `tip not reached yet at ${early}s`);
    // 2 s in: one unbroken line from tail to tip (no gaps, unlike dashes), and the head.
    for (let k = 1; k <= 19; k++) {
      const p = along(k / 20);
      assert.ok(isArrow(pixelAt(video, at + 2, p[0], p[1])), `line unbroken at ${k * 5}% at ${at + 2}s: ${pixelAt(video, at + 2, p[0], p[1])}`);
    }
    const arm = shape.head(shape.length).arms[0];
    const armMid: [number, number] = [(arm[0] + head[0]) / 2, (arm[1] + head[1]) / 2];
    assert.ok(isArrow(pixelAt(video, at + 2, ...armMid)), `chevron drawn at ${at + 2}s: ${pixelAt(video, at + 2, ...armMid)}`);
    // The path bows: its midpoint is off the straight tail→tip line.
    const [tx, ty] = g.tail;
    const [px, py] = g.tip;
    const [mx, my] = along(0.5);
    const off = Math.abs((px - tx) * (ty - my) - (tx - mx) * (py - ty)) / Math.hypot(px - tx, py - ty);
    assert.ok(off > 5, `curved path (${off.toFixed(1)} px off the straight line)`);
    // Gone after its duration; nothing before it starts.
    assert.ok(!isArrow(pixelAt(video, at + 3.6, ...along(0.5))), "arrow gone after its duration");
    assert.ok(!isArrow(pixelAt(video, at - 0.3, ...along(0.1))), "no arrow before it starts");
    // The label is a pill in the arrow's colour at the tail (sampled inside its right end, clear of the text).
    const box = arrowLabelBox(g, shape, "Click here", 24, { width: 1280, height: 720 });
    const pill = pixelAt(video, at + 2, box.cx + box.pw / 2 - box.ph * 0.3, box.cy);
    assert.ok(isArrow(pill), `label pill in the arrow colour: ${pill}`);
  });

  test("arrow curve: its bend follows the direction — ) from the lower left, ( from the lower right, mirrored from the top", () => {
    const res = { width: 1280, height: 720 };
    const target: [number, number, number, number] = [560, 300, 160, 60];
    // Where the curve's middle sits relative to the straight tail→tip line's middle.
    const bend = (from: string) => {
      const g = arrowGeometry(target, res, from as never);
      const s = arrowShape(g, [res.width / 2, res.height / 2]);
      const [mx, my] = s.point(0.5);
      return [mx - (g.tail[0] + g.tip[0]) / 2, my - (g.tail[1] + g.tip[1]) / 2];
    };
    const expect: Record<string, [number, number]> = {
      "bottom-left": [1, 1], // ")": bulges to the lower right, arrives going up
      "bottom-right": [-1, 1], // "("
      "top-left": [1, -1],
      "top-right": [-1, -1],
    };
    for (const [from, [sx, sy]] of Object.entries(expect)) {
      const [dx, dy] = bend(from);
      assert.ok(Math.sign(dx) === sx && Math.sign(dy) === sy, `${from}: bend (${dx.toFixed(1)}, ${dy.toFixed(1)}) should point (${sx}, ${sy})`);
    }
    // Straight arrows arc toward the middle of the screen: this target sits just above it, so
    // arrows coming across bow down; an upward one near the left edge bows right.
    assert.ok(bend("left")[1] > 0 && bend("right")[1] > 0, `across arrows bow toward the centre: ${bend("left")}, ${bend("right")}`);
    const g = arrowGeometry([40, 330, 60, 60], res, "below");
    const s = arrowShape(g, [res.width / 2, res.height / 2]);
    assert.ok(s.point(0.5)[0] > (g.tail[0] + g.tip[0]) / 2, "an upward arrow near the left edge bows right, into the frame");
  });

  test("arrow highlight: a pencil loop around the element once the arrow lands, then wiped away from its start", { timeout: 10 * MIN }, async () => {
    const grey = path.join(RUN, "grey-hl.mp4");
    const gen = ffmpegSync(["-y", "-f", "lavfi", "-i", "color=c=0x808080:s=1280x720:r=30:d=6", "-pix_fmt", "yuv420p", grey]);
    assert.equal(gen.status, 0, "ffmpeg could not generate the grey video");
    const target: [number, number, number, number] = [560, 300, 160, 60];
    writeJson(SCRIPT.highlight, {
      version: 1,
      scope: "Highlight",
      source: { video: grey },
      steps: [{ id: "point", beat: [{ fx: "arrow", at: 1, rect: target, duration: 3, highlight: true, highlightColor: "#2563EB" }] }],
    });
    expectOk(await cli(["validate", SCRIPT.highlight]), "validate");
    const r = await cli(["make", SCRIPT.highlight, "--out", path.join(RUN, "job-highlight")], { timeoutMs: 8 * MIN });
    const video = (expectOk(r, "make").videos as Rec[])[0].path as string;
    assertFile(video, "highlight video", r);
    // Timing, as the renderer computes it for a 3 s arrow at 1 s: the arrow is drawn by 1.5 s,
    // the loop draws from 1.6 s to 2.15 s, holds to 3.05 s, and is wiped by 3.5 s.
    const loop = pencilLoop(target, { width: 1280, height: 720 }, arrowGeometry(target, { width: 1280, height: 720 }).scale);
    const cum = [0];
    for (let i = 1; i < loop.length; i++) cum.push(cum[i - 1] + Math.hypot(loop[i][0] - loop[i - 1][0], loop[i][1] - loop[i - 1][1]));
    const along = (f: number) => loop[cum.findIndex((c) => c >= f * cum[cum.length - 1])];
    const isBlue = ([r2, g2, b2]: number[]) => b2 > 170 && r2 < 90 && g2 < 130;
    const early = along(0.1);
    const late = along(0.8);
    // Before the arrow lands: no loop.
    assert.ok(!isBlue(pixelAt(video, 1.4, ...early)), `no loop before the arrow lands: ${pixelAt(video, 1.4, ...early)}`);
    // Holding: the whole loop, in highlightColor.
    for (const f of [0.1, 0.35, 0.6, 0.8]) {
      const p = along(f);
      assert.ok(isBlue(pixelAt(video, 2.6, ...p)), `loop at ${f * 100}% drawn at 2.6s: ${pixelAt(video, 2.6, ...p)}`);
    }
    // Being wiped: its start is gone, its end still there.
    assert.ok(!isBlue(pixelAt(video, 3.3, ...early)) && isBlue(pixelAt(video, 3.3, ...late)), `wiped from its start at 3.3s: ${pixelAt(video, 3.3, ...early)} / ${pixelAt(video, 3.3, ...late)}`);
    // Gone, while the arrow itself stays to the end of its duration.
    assert.ok(!isBlue(pixelAt(video, 3.7, ...late)), `loop gone at 3.7s: ${pixelAt(video, 3.7, ...late)}`);
    const shape = arrowShape(arrowGeometry(target, { width: 1280, height: 720 }), [640, 360]);
    const mid = shape.at(shape.length * 0.5);
    assert.ok(isArrow(pixelAt(video, 3.7, ...mid)), `arrow still there at 3.7s: ${pixelAt(video, 3.7, ...mid)}`);
  });

  test("spotlight converge: the lit box closes in from the whole frame only when converge is set", { timeout: 10 * MIN }, async () => {
    // A white 1280x720 video: lit pixels stay white, dimmed ones go dark.
    const white = path.join(RUN, "white.mp4");
    const gen = ffmpegSync(["-y", "-f", "lavfi", "-i", "color=c=white:s=1280x720:r=30:d=6", "-pix_fmt", "yuv420p", white]);
    assert.equal(gen.status, 0, "ffmpeg could not generate the white video");
    const target: [number, number, number, number] = [500, 250, 200, 100];
    writeJson(SCRIPT.converge, {
      version: 1,
      scope: "Converge",
      source: { video: white },
      steps: [{
        id: "spot",
        beat: [
          { fx: "spotlight", at: 1, rect: target, duration: 3, converge: 1, feather: 16 },
          { fx: "spotlight", at: 4.5, rect: target, duration: 1 },
        ],
      }],
    });
    expectOk(await cli(["validate", SCRIPT.converge]), "validate");
    const r = await cli(["make", SCRIPT.converge, "--out", path.join(RUN, "job-converge")], { timeoutMs: 8 * MIN });
    const video = (expectOk(r, "make").videos as Rec[])[0].path as string;
    assertFile(video, "converge video", r);
    const lit = (p: number[]) => p[0] > 200;
    const dim = (p: number[]) => p[0] < 120;
    const far: [number, number] = [100, 100]; // well outside the target
    const near: [number, number] = [440, 300]; // 60 px left of the target, beyond the 16 px feather
    const inside: [number, number] = [600, 300];
    // Start: the lit box is still the whole frame.
    assert.ok(lit(pixelAt(video, 1.0, ...far)), `whole frame lit as it starts: ${pixelAt(video, 1.0, ...far)}`);
    // 0.3 s in: the edges have closed in (the corner is dim) but the box is still bigger than the target.
    assert.ok(dim(pixelAt(video, 1.3, ...far)), `closing in at 1.3s: ${pixelAt(video, 1.3, ...far)}`);
    assert.ok(lit(pixelAt(video, 1.3, ...near)), `not yet on the target at 1.3s: ${pixelAt(video, 1.3, ...near)}`);
    // Converged: only the target is lit.
    assert.ok(dim(pixelAt(video, 2.5, ...near)), `converged at 2.5s: ${pixelAt(video, 2.5, ...near)}`);
    assert.ok(lit(pixelAt(video, 2.5, ...inside)), `target lit at 2.5s: ${pixelAt(video, 2.5, ...inside)}`);
    // No converge: the plain spotlight is on the target from its first frame.
    assert.ok(dim(pixelAt(video, 4.54, ...near)) && dim(pixelAt(video, 4.54, ...far)), "no converge → no animation");
    assert.ok(lit(pixelAt(video, 4.54, ...inside)), "no converge → target lit at once");
  });

  test("video-source script: a rect outside the frame → SCRIPT_INVALID pointing at the entry", async (t) => {
    if (!needsMake(t)) return;
    writeJson(SCRIPT.badRect, {
      version: 1,
      scope: "Bad rect",
      source: { video: path.join(JOB, "recordings", "recording.mp4") },
      steps: [{ id: "oops", beat: [{ fx: "blur", at: 1, rect: [1400, 850, 200, 200], duration: 2 }] }],
    });
    const r = await cli(["validate", SCRIPT.badRect]);
    const err = expectError(r, "validate", "SCRIPT_INVALID");
    const paths = ((err.details?.issues ?? []) as Rec[]).map((i) => i.path);
    assert.ok(paths.some((p) => String(p).startsWith("steps[0].beat[0]")), `expected an issue at steps[0].beat[0]; got ${JSON.stringify(paths)}`);
  });

  test("job errors: JOB_EXISTS, JOB_NOT_FOUND, VIDEO_NOT_FOUND", { timeout: 3 * MIN }, async (t) => {
    if (!needsMake(t)) return;
    expectError(await cli(["record", SCRIPT.acme, "--out", JOB], { timeoutMs: 2 * MIN }), "record", "JOB_EXISTS");
    const notAJob = path.join(RUN, "not-a-job");
    fs.mkdirSync(notAJob, { recursive: true });
    expectError(await cli(["produce", notAJob]), "produce", "JOB_NOT_FOUND");
    expectError(await cli(["preview", JOB, "--lang", "fr"]), "preview", "VIDEO_NOT_FOUND");
  });
});

function summarizeElements(els: Rec[]): string {
  return els
    .slice(0, 60)
    .map((e) => `    ${e.role} "${e.name}" → ${JSON.stringify(e.selector)} (matches ${e.matches})`)
    .join("\n");
}
