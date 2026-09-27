// ─── cli-process: running the CLI as a child process ─────────────────
//
// Shared by `narascreen serve` (api/server.ts) and the desktop app's CLI bridge
// (electron/cli-bridge.ts), which both run commands as
//   <node or electron-as-node> <cli entry> <command> … --events json
// in their own process group, read ONE JSON envelope from stdout and one JSON
// event per stderr line, and cancel by signalling the whole group.
//
// No Electron imports and nothing that prints: this module is bundled into the
// Electron main process as well as into the CLI.

import { spawn, spawnSync, type ChildProcess } from "child_process";
import * as fs from "fs";
import * as path from "path";
import type { Envelope, NaraEvent } from "./protocol";

/** SIGTERM → wait this long → SIGKILL. */
export const CANCEL_GRACE_MS = 5000;
/** Longest stderr line kept as one event; longer output is split. */
export const MAX_LINE = 16 * 1024;
/** stdout kept per run (the envelope; `schema` prints ~100 KB). */
export const MAX_STDOUT = 8 * 1024 * 1024;

// eslint-disable-next-line no-control-regex -- ESC starts every ANSI colour sequence
export const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;

// ─── where the CLI is ────────────────────────────────────────────────

/**
 * The CLI entry a child process should run, seen from `baseDir` (the directory
 * of the calling module): the bundled `narascreen.cjs` next to it in a packaged
 * build (dist-cli/), else the checkout's `bin/narascreen` launcher.
 */
export function defaultCliEntry(baseDir: string = __dirname): string {
  const bundled = path.join(baseDir, "narascreen.cjs");
  if (fs.existsSync(bundled)) return bundled;
  return path.join(baseDir, "..", "bin", "narascreen");
}

/** True when this code runs from the bundled CLI (dist-cli/*.cjs), not from the .ts sources. */
export function isBundled(baseDir: string = __dirname): boolean {
  return fs.existsSync(path.join(baseDir, "narascreen.cjs"));
}

/** The version stamped into the bundle at build time, else editor/package.json. */
export function narascreenVersion(editorDir: string): string {
  const stamped = process.env.NARASCREEN_BUNDLE_VERSION;
  if (stamped) return stamped;
  try {
    return (JSON.parse(fs.readFileSync(path.join(editorDir, "package.json"), "utf-8")) as { version?: string }).version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

// ─── killing a run ───────────────────────────────────────────────────

/** Signal a child and everything it started (its process group on POSIX). */
export function killTree(child: ChildProcess, signal: NodeJS.Signals): void {
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

/**
 * Every live descendant of `pid` (POSIX; [] on Windows, where taskkill /T walks
 * the tree itself). Render children and browsers run in process groups of their
 * own, so a group signal alone can miss them once their parent is gone: callers
 * snapshot the tree before signalling and sweep what survives.
 */
export function descendantPids(pid: number): number[] {
  if (process.platform === "win32" || !pid) return [];
  const r = spawnSync("ps", ["-A", "-o", "pid=,ppid="], { encoding: "utf-8", timeout: 5000 });
  if (r.status !== 0 || !r.stdout) return [];
  const children = new Map<number, number[]>();
  for (const line of r.stdout.split("\n")) {
    const m = /^\s*(\d+)\s+(\d+)\s*$/.exec(line);
    if (!m) continue;
    const [c, p] = [Number(m[1]), Number(m[2])];
    const list = children.get(p);
    if (list) list.push(c);
    else children.set(p, [c]);
  }
  const out: number[] = [];
  const queue = [pid];
  while (queue.length) {
    for (const c of children.get(queue.shift()!) ?? []) {
      if (out.includes(c)) continue;
      out.push(c);
      queue.push(c);
    }
  }
  return out;
}

/** SIGKILL each pid (and its group, when it leads one) that is still alive. */
export function killPids(pids: number[], signal: NodeJS.Signals = "SIGKILL"): void {
  for (const pid of pids) {
    if (!isAlive(pid)) continue;
    for (const target of [-pid, pid]) {
      try {
        process.kill(target, signal);
      } catch {
        // not a group leader / already gone
      }
    }
  }
}

export function isAlive(pid: number | undefined): boolean {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// ─── stderr: one event per line ──────────────────────────────────────

/** Split a stream into lines; an endless line is cut at `maxLine` characters. */
export function createLineSplitter(onLine: (line: string) => void, maxLine = MAX_LINE): { push(chunk: string): void; flush(): void } {
  let partial = "";
  return {
    push(chunk: string) {
      const lines = (partial + chunk).split("\n");
      partial = lines.pop() ?? "";
      if (partial.length > maxLine) {
        lines.push(partial); // an endless line: emit what we have
        partial = "";
      }
      for (const line of lines) onLine(line);
    },
    flush() {
      if (partial) onLine(partial);
      partial = "";
    },
  };
}

export type StderrLine = { kind: "event"; event: NaraEvent } | { kind: "text"; line: string };

/**
 * One stderr line of a `--events json` child: a NaraEvent, or plain text (any
 * non-JSON output, e.g. `[bin-paths] ffmpeg: …`) that callers turn into a
 * `log` event. Blank lines give null. ANSI colour codes are stripped.
 */
export function parseStderrLine(raw: string): StderrLine | null {
  const line = raw.replace(ANSI_RE, "").trimEnd();
  if (!line.trim()) return null;
  if (line.startsWith("{")) {
    try {
      const ev = JSON.parse(line) as NaraEvent;
      if (isNaraEvent(ev)) return { kind: "event", event: ev };
    } catch {
      // not an event: keep it as a log line
    }
  }
  return { kind: "text", line };
}

export function isNaraEvent(v: unknown): v is NaraEvent {
  const e = v as NaraEvent;
  return isObject(v) && typeof e.message === "string" && ["stage", "step", "log", "warning"].includes(e.type);
}

// ─── stdout: the envelope ────────────────────────────────────────────

/** The envelope in a child's stdout (pretty-printed, so parse the whole buffer). */
export function parseEnvelope(stdout: string): Envelope | undefined {
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

// ─── child environment ───────────────────────────────────────────────

export const ENV_NAME_RE = /^[A-Z_][A-Z0-9_]*$/;
/** Variables a caller may not set for a run: they steer the process, the CLI or its tools, not the script. */
export const RESERVED_ENV_RE =
  /^(PATH|HOME|USER|LOGNAME|SHELL|PWD|OLDPWD|TMPDIR|TMP|TEMP|IFS|ENV|BASH_ENV|LANG|LANGUAGE|TZ|DISPLAY|WAYLAND_DISPLAY|NO_COLOR|FORCE_COLOR|(HTTPS?|ALL|NO|FTP)_PROXY|(LC|XDG|NODE|NPM|NARASCREEN|LD|DYLD|PLAYWRIGHT|ELECTRON|KOKORO|FFMPEG|FFPROBE|TSX|UV|SSL|OPENSSL|PYTHON|DBUS|CHROME|CHROMIUM|GTK|QT)(_.*)?)$/;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
