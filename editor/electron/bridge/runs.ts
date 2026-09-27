// ─── bridge/runs: CLI commands as child processes ────────────────────
//
// Every command the desktop runs (doctor, validate, make, produce…) is the CLI
// itself, started as `<electron as node> <cli> <command> … --events json` in its
// own process group — exactly how `narascreen serve` runs it:
//   stdout → ONE JSON envelope (pretty-printed: the whole buffer is parsed at exit)
//   stderr → one NaraEvent per line (plain text lines become `log` events)
// Cancel = SIGTERM to the group (the CLI prints an "Interrupted" envelope and
// stops its render children), SIGKILL after CANCEL_GRACE_MS, then a sweep of
// every descendant seen, because render children and browsers live in process
// groups of their own.

import { app } from "electron";
import { spawn, type ChildProcess } from "child_process";
import * as crypto from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  CANCEL_GRACE_MS,
  ENV_NAME_RE,
  MAX_STDOUT,
  RESERVED_ENV_RE,
  createLineSplitter,
  descendantPids,
  killPids,
  killTree,
  parseEnvelope,
  parseStderrLine,
} from "../../api/cli-process";
import type { CliCommand, CliEndMsg, CliRunHandle, CliRunRequest, Envelope, NaraEvent } from "../../src/types/narascreen-ipc";
import { bridgeError, broadcast } from "./util";

const COMMANDS: readonly CliCommand[] = ["doctor", "voices", "init", "inspect", "validate", "check", "record", "produce", "make", "preview", "status", "schema"];
/** Commands whose positional argument is a script / a job folder. */
const SCRIPT_ARG = new Set<CliCommand>(["validate", "check", "record", "make"]);
const JOB_ARG = new Set<CliCommand>(["produce", "preview", "status"]);
const FLAG_RE = /^[a-z][a-z0-9-]*$/;
const MAX_ENV = 50;
const DEFAULT_CALL_TIMEOUT_MS = 5 * 60_000;
const POSIX = process.platform !== "win32";

interface Run {
  handle: CliRunHandle;
  child: ChildProcess;
  /** cli:run streams events and cli:end; cli:call only resolves its promise. */
  streamed: boolean;
  stdout: string;
  stderrTail: string[];
  startedMs: number;
  cancelRequested: boolean;
  timedOutMs?: number;
  /** Descendants seen while cancelling (swept with SIGKILL at the end). */
  seen: Set<number>;
  timers: NodeJS.Timeout[];
  finished: boolean;
  /** For script:write's lock check. */
  scriptPath?: string;
  jobDir?: string;
  done: Promise<CliEndMsg>;
}

const runs = new Map<string, Run>();

/** The CLI to run: NARASCREEN_CLI (tests), the bundled one in a packaged app, else the checkout's launcher. */
export function cliEntry(): string {
  const override = process.env.NARASCREEN_CLI;
  if (override && fs.existsSync(override)) return path.resolve(override);
  if (app.isPackaged) return path.join(process.resourcesPath, "dist-cli", "narascreen.cjs");
  return path.join(__dirname, "..", "bin", "narascreen"); // __dirname = dist-electron
}

export function startRun(req: CliRunRequest): CliRunHandle {
  return spawnRun(req, true).handle;
}

export async function callRun(req: CliRunRequest & { timeoutMs?: number }): Promise<CliEndMsg> {
  const run = spawnRun(req, false);
  const ms = req.timeoutMs && req.timeoutMs > 0 ? req.timeoutMs : DEFAULT_CALL_TIMEOUT_MS;
  const t = setTimeout(() => {
    if (run.finished) return;
    run.timedOutMs = ms;
    stop(run);
  }, ms);
  run.timers.push(t);
  return run.done;
}

export function cancelRun(runId: string): { ok: boolean } {
  const run = runs.get(runId);
  if (!run || run.finished) return { ok: false };
  run.cancelRequested = true;
  stop(run);
  return { ok: true };
}

export function listRuns(): CliRunHandle[] {
  return [...runs.values()].filter((r) => r.streamed && !r.finished).map((r) => r.handle);
}

/** Active runs that use this script or job folder (script:write refuses to write under them). */
export function runsTouching(p: { scriptPath?: string; jobDir?: string }): CliRunHandle[] {
  const script = p.scriptPath && path.resolve(p.scriptPath);
  const job = p.jobDir && path.resolve(p.jobDir);
  return [...runs.values()]
    .filter((r) => !r.finished && ((script && r.scriptPath === script) || (job && r.jobDir === job)))
    .map((r) => r.handle);
}

export function hasActiveRuns(): boolean {
  return [...runs.values()].some((r) => !r.finished);
}

/** App quit: stop every run and wait (bounded) until their process trees are gone. */
export async function stopAllRuns(timeoutMs = 3000): Promise<void> {
  const active = [...runs.values()].filter((r) => !r.finished);
  if (!active.length) return;
  for (const r of active) {
    r.cancelRequested = true;
    stop(r, Math.min(CANCEL_GRACE_MS, timeoutMs - 500));
  }
  await Promise.race([Promise.all(active.map((r) => r.done)), new Promise((res) => setTimeout(res, timeoutMs))]);
  for (const r of active) {
    killTree(r.child, "SIGKILL");
    killPids([...r.seen, ...(r.child.pid ? descendantPids(r.child.pid) : [])]);
  }
}

// ─── spawning ────────────────────────────────────────────────────────

function spawnRun(req: CliRunRequest, streamed: boolean): Run {
  if (!COMMANDS.includes(req.command)) throw bridgeError("USAGE", `The desktop cannot run "${String(req.command)}"`);
  const args: string[] = [req.command];
  if (req.arg != null) {
    if (typeof req.arg !== "string" || !req.arg || req.arg.startsWith("-")) throw bridgeError("USAGE", "arg must be an absolute path");
    args.push(req.arg);
  }
  for (const [name, v] of Object.entries(req.flags ?? {})) {
    if (!FLAG_RE.test(name) || name === "events") throw bridgeError("USAGE", `Unknown flag name "${name}"`);
    if (v === false || v == null) continue;
    args.push(v === true ? `--${name}` : `--${name}=${String(v)}`);
  }
  args.push("--events", "json");

  const entry = cliEntry();
  if (!fs.existsSync(entry)) throw bridgeError("INTERNAL", `NaraScreen CLI not found at ${entry}`, "The installation is incomplete; reinstall NaraScreen.");
  const argv = [entry, ...args];
  const child = spawn(process.execPath, argv, {
    cwd: workingDir(req),
    env: childEnv(req.env),
    stdio: ["ignore", "pipe", "pipe"],
    // Own process group (POSIX) so cancel reaches the CLI, its ffmpeg and its browser together.
    detached: POSIX,
    windowsHide: true,
  });
  const runId = `c_${Date.now().toString(36)}_${crypto.randomBytes(3).toString("hex")}`;
  const handle: CliRunHandle = {
    runId,
    pid: child.pid ?? 0,
    argv: [process.execPath, ...argv],
    command: req.command,
    startedAt: new Date().toISOString(),
    ...(req.tag ? { tag: req.tag } : {}),
  };
  const flagOut = typeof req.flags?.out === "string" ? path.resolve(req.flags.out) : undefined;
  let resolveDone!: (m: CliEndMsg) => void;
  const run: Run = {
    handle,
    child,
    streamed,
    stdout: "",
    stderrTail: [],
    startedMs: Date.now(),
    cancelRequested: false,
    seen: new Set(),
    timers: [],
    finished: false,
    scriptPath: req.arg && SCRIPT_ARG.has(req.command) ? path.resolve(req.arg) : undefined,
    jobDir: req.arg && JOB_ARG.has(req.command) ? path.resolve(req.arg) : flagOut,
    done: new Promise<CliEndMsg>((r) => (resolveDone = r)),
  };
  runs.set(runId, run);

  child.stdout!.setEncoding("utf8");
  child.stdout!.on("data", (chunk: string) => {
    if (run.stdout.length < MAX_STDOUT) run.stdout += chunk;
  });
  const lines = createLineSplitter((line) => onStderrLine(run, line));
  child.stderr!.setEncoding("utf8");
  child.stderr!.on("data", (chunk: string) => lines.push(chunk));

  let exitTimer: NodeJS.Timeout | undefined;
  const done = (code: number | null, signal: NodeJS.Signals | null, spawnError?: Error) => {
    clearTimeout(exitTimer);
    if (run.finished) return;
    lines.flush();
    const msg = finish(run, code, signal, spawnError);
    if (run.streamed) broadcast("cli:end", msg);
    resolveDone(msg);
  };
  child.once("close", (code, signal) => done(code, signal));
  // A stray grandchild holding our pipes would delay 'close' forever; don't wait on it.
  child.once("exit", (code, signal) => {
    exitTimer = setTimeout(() => {
      child.stdout?.destroy();
      child.stderr?.destroy();
      done(code, signal);
    }, 2000);
  });
  child.once("error", (err) => done(null, null, err));
  return run;
}

function onStderrLine(run: Run, line: string) {
  const parsed = parseStderrLine(line);
  if (!parsed) return;
  let event: NaraEvent;
  if (parsed.kind === "event") {
    event = parsed.event;
  } else {
    event = { ts: new Date().toISOString(), type: "log", message: parsed.line };
    run.stderrTail.push(parsed.line);
    if (run.stderrTail.length > 40) run.stderrTail.shift();
  }
  if (run.streamed) broadcast("cli:event", { runId: run.handle.runId, event });
}

/** SIGTERM the group now; SIGKILL it and every descendant seen after `graceMs`. */
function stop(run: Run, graceMs = CANCEL_GRACE_MS) {
  if (run.finished) return;
  const pid = run.child.pid;
  if (pid) for (const d of descendantPids(pid)) run.seen.add(d);
  killTree(run.child, "SIGTERM");
  run.timers.push(
    setTimeout(() => {
      if (run.finished) return;
      if (pid) for (const d of descendantPids(pid)) run.seen.add(d);
      killTree(run.child, "SIGKILL");
      killPids([...run.seen]);
    }, graceMs),
  );
}

function finish(run: Run, code: number | null, signal: NodeJS.Signals | null, spawnError?: Error): CliEndMsg {
  run.finished = true;
  for (const t of run.timers) clearTimeout(t);
  runs.delete(run.handle.runId);
  // Whatever a cancelled run left behind in other process groups goes too.
  if (run.cancelRequested || run.timedOutMs) killPids([...run.seen]);

  const command = run.handle.command;
  let envelope: Envelope | null = parseEnvelope(run.stdout) ?? null;
  const interrupted = !!(envelope && !envelope.ok && envelope.error?.details && "signal" in envelope.error.details);
  const cancelled = !run.timedOutMs && ((run.cancelRequested && !(envelope?.ok && code === 0)) || interrupted);
  if (run.timedOutMs && !envelope?.ok) {
    envelope = failEnvelope(command, `"${command}" did not finish within ${Math.round(run.timedOutMs / 1000)}s and was stopped`, "Run it again; if it keeps timing out, check `doctor`.");
  } else if (spawnError) {
    envelope = failEnvelope(command, `Could not start the NaraScreen CLI: ${spawnError.message}`, "Reinstall NaraScreen if this repeats.");
  }
  const raw = run.stdout.trim();
  return {
    runId: run.handle.runId,
    envelope,
    ...(raw && (!envelope || command === "schema") ? { raw: raw.slice(0, MAX_STDOUT) } : {}),
    ...(!envelope && run.stderrTail.length ? { stderrTail: run.stderrTail.slice(-20) } : {}),
    exitCode: code,
    signal,
    cancelled,
    durationMs: Date.now() - run.startedMs,
  };
}

function failEnvelope(command: string, message: string, hint: string): Envelope {
  return { ok: false, command, error: { code: "INTERNAL", message, hint }, warnings: [], next: [] };
}

// ─── environment ─────────────────────────────────────────────────────

/** Electron's own env, the caller's ${env:NAME} values (vetted), and Node mode for the child. */
function childEnv(extra: Record<string, string> | undefined): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  // Markers that would make the CLI shape its output for `serve`.
  delete env.NARASCREEN_CALLER;
  delete env.NARASCREEN_WORKSPACE;
  const entries = Object.entries(extra ?? {});
  if (entries.length > MAX_ENV) throw bridgeError("USAGE", `At most ${MAX_ENV} env values per run`);
  for (const [name, value] of entries) {
    // The message names the variable, never its value.
    if (!ENV_NAME_RE.test(name)) throw bridgeError("USAGE", `env name "${name}" must be UPPER_CASE (letters, digits, _)`);
    if (RESERVED_ENV_RE.test(name)) throw bridgeError("USAGE", `env name "${name}" is reserved for the process; pick an application-specific name`);
    if (typeof value !== "string") throw bridgeError("USAGE", `env ${name} must be a string`);
    env[name] = value;
  }
  env.ELECTRON_RUN_AS_NODE = "1";
  env.NO_COLOR = "1";
  // Render in a child process so the CLI answers a cancel at once (api/cli.ts produceJob).
  env.NARASCREEN_RENDER_CHILD = "1";
  return env;
}

function workingDir(req: CliRunRequest): string {
  const isDir = (p: string) => {
    try {
      return fs.statSync(p).isDirectory();
    } catch {
      return false;
    }
  };
  if (req.cwd && isDir(req.cwd)) return req.cwd;
  if (req.arg) {
    if (isDir(req.arg)) return req.arg;
    if (isDir(path.dirname(req.arg))) return path.dirname(req.arg);
  }
  return os.homedir();
}
