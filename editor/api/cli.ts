#!/usr/bin/env node
// ─── narascreen CLI: the command-line half of the agent contract ─────
//
//   narascreen <command> [<arg>] [--flags]        (see `narascreen help`)
//
// Contract (identical for every command, every path — including bad arguments
// and crashes):
//   stdout → exactly ONE JSON envelope { ok, command, result?, error?, warnings, next }
//            (only `manual` prints Markdown and `schema` prints raw JSON Schema).
//   stderr → progress events (text, or one JSON event per line with --events json).
//   exit   → exitCodeFor(error.code): 0 ok · 1 script/job · 2 environment · 3 usage · 4 internal.
//
// The command surface is data (commands.ts); this file routes it. Heavy engine
// modules (browser, renderer, server) are imported lazily inside their commands:
// startup stays fast for validate/help, and anything they print while loading is
// caught by the stdout guard below instead of corrupting the envelope.

import * as fs from "fs";
import * as path from "path";
import { parseArgs } from "util";
import { COMMANDS, GLOBAL_FLAGS, findCommand, type CommandDoc } from "./commands";
import { AgentError, toAgentError } from "./errors";
import { emit, emitEvent, failure, log, setEventMode, setQuiet, stage, success, warn, type Envelope } from "./output";
import {
  demoScriptJsonSchema,
  QUALITY_CRF,
  RESOLUTIONS,
  TTS_LANGUAGES,
  type DemoScript,
  type Quality,
  type ResolutionName,
} from "./schema";
import {
  assertSameStructure,
  createJob,
  jobExists,
  jobPaths,
  readJob,
  readTrace,
  structureHash,
  withJobLock,
  writeJob,
  writeTrace,
  type JobState,
  type RecordState,
} from "./job";
import { DEFAULT_VOICES, LANG_CODES, LANG_LABELS } from "../src/lib/voices";
import type { LoadedScript } from "./validate";
import type { TraceEntry } from "./types";
import type { ProduceResult } from "./produce-headless";
import type { PreviewResult } from "./preview";

const EDITOR_DIR = path.resolve(__dirname, "..");
const BIN_PATH = path.join(EDITOR_DIR, "bin", "narascreen");
const OUT_ROOT = "narascreen-out";

// ─── stdout guard ────────────────────────────────────────────────────
//
// Engine code we don't own writes to stdout (electron/bin-paths.ts logs the
// ffmpeg path when imported). Every stdout write that is not the envelope is
// rerouted into the event stream on stderr, so stdout stays machine-parseable.
// The static imports above are the protocol modules, which never print; the
// guard is installed before anything that can reach engine code is loaded.

const realStdoutWrite = process.stdout.write.bind(process.stdout);
let stdoutOpen = false;

function guardStdout(): void {
  process.stdout.write = function (chunk: unknown, encodingOrCb?: unknown, cb?: unknown): boolean {
    if (stdoutOpen) return realStdoutWrite(chunk as string, encodingOrCb as BufferEncoding, cb as () => void);
    const text = typeof chunk === "string" ? chunk : Buffer.from(chunk as Uint8Array).toString("utf-8");
    if (text.trim()) emitEvent({ type: "log", message: text.replace(/\s+$/, "") });
    const done = typeof encodingOrCb === "function" ? encodingOrCb : cb;
    if (typeof done === "function") process.nextTick(done as () => void);
    return true;
  } as typeof process.stdout.write;
}

guardStdout();
// --events/--quiet shape every event, including stray output caught while loading.
const earlyFlagError = applyGlobalFlagsEarly(process.argv.slice(2));

// Loaded only now, behind the guard: validate.ts imports electron/ffmpeg, which
// loads bin-paths (it prints on import). `require` runs in place — an `import`
// statement would be hoisted above the guard.
const { loadScript, scriptSummary, validateScript } = require("./validate") as typeof import("./validate");
const { initScript } = require("./init") as typeof import("./init");

// ─── finishing: exactly one output, then exit ────────────────────────

let finished = false;
let currentCommand = "narascreen";
let server: { close(): Promise<void> } | undefined;

type ExitMode = "natural" | "now" | "stay";

function finish(env: Envelope, exit: ExitMode = "natural"): void {
  if (finished) return;
  finished = true;
  env.warnings = [...new Set(env.warnings)];
  stdoutOpen = true;
  let code: number;
  try {
    code = emit(env);
  } finally {
    stdoutOpen = false;
  }
  scheduleExit(code, exit);
}

function finishRaw(text: string): void {
  if (finished) return;
  finished = true;
  stdoutOpen = true;
  try {
    process.stdout.write(text.endsWith("\n") ? text : text + "\n");
  } finally {
    stdoutOpen = false;
  }
  scheduleExit(0, "natural");
}

function scheduleExit(code: number, exit: ExitMode): void {
  process.exitCode = code;
  if (exit === "stay") return;
  // "natural": let Node exit once the loop drains; if a stray handle (a
  // keep-alive socket, a paused stdin, a leftover child) keeps it alive, force
  // it — the command is over and an agent must not hang waiting for us.
  const t = setTimeout(() => process.exit(code), exit === "now" ? 50 : 2000);
  if (exit === "natural") t.unref();
}

function crash(err: unknown): void {
  releaseLocks();
  if (!finished) {
    finish(failure(currentCommand, err), "now");
    return;
  }
  // The envelope is already out (e.g. `serve` is running): report on stderr only.
  const e = toAgentError(err);
  process.stderr.write(`[narascreen] fatal: ${e.code}: ${e.message}\n`);
  process.exit(4);
}

function onSignal(sig: NodeJS.Signals): void {
  if (server) {
    const s = server;
    server = undefined;
    emitEvent({ type: "log", message: `${sig} received — stopping the server` });
    setTimeout(() => process.exit(0), 5000).unref();
    s.close().then(
      () => process.exit(0),
      () => process.exit(0),
    );
    return;
  }
  if (finished) process.exit(process.exitCode ?? 1);
  releaseLocks();
  finish(
    failure(
      currentCommand,
      new AgentError("INTERNAL", `Interrupted by ${sig} before "${currentCommand}" finished`, {
        hint: "Re-run the command. Finished work (a successful recording, cached narration audio) is reused.",
        details: { signal: sig },
      }),
    ),
    "now",
  );
}

// ─── entry ───────────────────────────────────────────────────────────

async function main(argv: string[]): Promise<void> {
  // The reader went away (`narascreen manual | head`): nobody is left to read
  // the rest, so stop quietly instead of reporting a crash.
  process.stdout.on("error", (e: NodeJS.ErrnoException) => {
    if (e.code === "EPIPE") process.exit(process.exitCode ?? 0);
  });
  process.on("uncaughtException", crash);
  process.on("unhandledRejection", crash);
  for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => onSignal(sig));

  let inv: Invocation;
  try {
    if (earlyFlagError) throw earlyFlagError;
    inv = parseCommandLine(argv);
  } catch (e) {
    const cmd = guessCommandName(argv);
    finish(failure(cmd, e, { next: [helpFor(cmd)] }));
    return;
  }

  currentCommand = inv.name;
  const ctx: Ctx = { cmd: inv.cmd, arg: inv.arg, flags: inv.flags, cwd: process.cwd(), warnings: [], known: {} };
  try {
    const handler = HANDLERS[inv.cmd.name];
    if (!handler) throw new Error(`No handler for command "${inv.cmd.name}"`);
    const out = await handler(ctx);
    if (out.raw != null) {
      finishRaw(out.raw);
      return;
    }
    finish(success(inv.name, out.result, { warnings: ctx.warnings, next: out.next ?? [] }), out.stay ? "stay" : "natural");
  } catch (e) {
    const err = toAgentError(e);
    finish(failure(inv.name, err, { warnings: ctx.warnings, next: failureNext(ctx, err) }));
  }
}

// ─── argument parsing ────────────────────────────────────────────────

type Flags = Record<string, string | boolean | undefined>;

interface Invocation {
  /** Name reported in the envelope (a command, or "help"/"version"). */
  name: string;
  cmd: CommandDoc;
  arg?: string;
  flags: Flags;
}

const HELP_CMD = findCommand("help")!;
const VERSION_CMD: CommandDoc = { name: "version", usage: "narascreen --version", summary: "Print the version.", flags: [], output: "{ version }", heavy: false };

/** --events / --quiet decide how progress is printed — set them before anything can log. */
function applyGlobalFlagsEarly(argv: string[]): AgentError | undefined {
  if (argv.includes("--quiet")) setQuiet(true);
  const i = argv.findIndex((a) => a === "--events" || a.startsWith("--events="));
  if (i < 0) return undefined;
  const value = argv[i].includes("=") ? argv[i].slice("--events=".length) : argv[i + 1];
  if (value === "json" || value === "text") {
    setEventMode(value);
    return undefined;
  }
  return new AgentError("USAGE", `--events must be "text" or "json", got ${value == null ? "nothing" : `"${value}"`}`, {
    hint: "Use --events json for one JSON event per stderr line (for programs), or omit it for text.",
  });
}

/** The command is the first bare word; global flags may come before it. */
function splitCommand(argv: string[]): { name?: string; rest: string[] } {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--") break;
    if (a === "--events") {
      i++; // skip its value
      continue;
    }
    if (a.startsWith("-")) continue;
    return { name: a, rest: [...argv.slice(0, i), ...argv.slice(i + 1)] };
  }
  return { rest: argv };
}

function guessCommandName(argv: string[]): string {
  return splitCommand(argv).name ?? "narascreen";
}

function parseCommandLine(argv: string[]): Invocation {
  const { name, rest } = splitCommand(argv);

  if (!name) {
    const flags = parseFlags(HELP_CMD, rest, 0).flags;
    if (flags.version) return { name: "version", cmd: VERSION_CMD, flags };
    return { name: "help", cmd: HELP_CMD, flags };
  }

  const cmd = findCommand(name);
  if (!cmd) {
    const names = COMMANDS.map((c) => c.name);
    const guess = didYouMean(name, names);
    throw new AgentError("USAGE", `Unknown command "${name}"`, {
      hint: `${guess ? `Did you mean "${guess}"? ` : ""}Commands: ${names.join(", ")}. Run \`narascreen help\`.`,
      details: { command: name, commands: names },
    });
  }

  // `help` takes an optional command name to explain; the others follow COMMANDS.
  const maxPositionals = cmd.name === "help" ? 1 : cmd.arg ? 1 : 0;
  const { flags, positionals } = parseFlags(cmd, rest, maxPositionals);

  if (flags.version) return { name: "version", cmd: VERSION_CMD, flags };
  if (flags.help) return { name: "help", cmd: HELP_CMD, arg: cmd.name === "help" ? positionals[0] : cmd.name, flags };

  if (cmd.arg?.required && positionals.length === 0) {
    throw new AgentError("USAGE", `"${cmd.name}" needs <${cmd.arg.name}> — ${cmd.arg.desc}`, {
      hint: `Usage: ${cmd.usage}`,
      details: { usage: cmd.usage },
    });
  }
  return { name: cmd.name, cmd, arg: positionals[0], flags };
}

function parseFlags(cmd: CommandDoc, args: string[], maxPositionals: number): { flags: Flags; positionals: string[] } {
  const options: Record<string, { type: "string" | "boolean"; short?: string }> = {};
  for (const f of [...GLOBAL_FLAGS, ...cmd.flags]) options[f.name] = { type: f.type };
  options.help = { type: "boolean", short: "h" };

  let parsed: { values: Flags; positionals: string[] };
  try {
    parsed = parseArgs({ args, options, allowPositionals: true, strict: true }) as typeof parsed;
  } catch (e) {
    throw usageFromParseError(cmd, e);
  }
  if (parsed.positionals.length > maxPositionals) {
    const extra = parsed.positionals.slice(maxPositionals);
    throw new AgentError("USAGE", `Unexpected argument${extra.length > 1 ? "s" : ""} for "${cmd.name}": ${extra.join(" ")}`, {
      hint: `Usage: ${cmd.usage}`,
      details: { usage: cmd.usage, unexpected: extra },
    });
  }
  return { flags: parsed.values, positionals: parsed.positionals };
}

function usageFromParseError(cmd: CommandDoc, e: unknown): AgentError {
  const msg = e instanceof Error ? e.message : String(e);
  const known = [...cmd.flags, ...GLOBAL_FLAGS].map((f) => `--${f.name}`);
  const unknown = /Unknown option '([^']+)'/.exec(msg)?.[1];
  if (unknown) {
    const guess = didYouMean(unknown.replace(/=.*$/, ""), known);
    return new AgentError("USAGE", `Unknown flag ${unknown} for "${cmd.name}"`, {
      hint: `${guess ? `Did you mean ${guess}? ` : ""}Usage: ${cmd.usage}`,
      details: { usage: cmd.usage, flags: cmd.flags.map((f) => f.flag) },
    });
  }
  // Node's wording is written for humans typing; say what to change instead.
  const flag = /Option '(-[\w-]+|--[\w-]+)/.exec(msg)?.[1] ?? "";
  const message = /argument missing/.test(msg)
    ? `${flag} needs a value`
    : /does not take an argument/.test(msg)
      ? `${flag} is a switch and takes no value`
      : /ambiguous/.test(msg)
        ? `${flag} got a value that starts with "-"; write it as ${flag}=<value>`
        : msg.split(". ")[0];
  return new AgentError("USAGE", message, { hint: `Usage: ${cmd.usage}`, details: { usage: cmd.usage } });
}

/** `help <cmd>` for a real command, plain `help` otherwise. */
function helpFor(name: string): string {
  return name !== "help" && findCommand(name) ? cli("help", name) : cli("help");
}

// ─── command context + small helpers ─────────────────────────────────

interface Ctx {
  cmd: CommandDoc;
  arg?: string;
  flags: Flags;
  cwd: string;
  warnings: string[];
  /** Absolute paths learned while running — used to suggest `next` on failure too. */
  known: { script?: string; job?: string; stepIds?: string[]; baseUrl?: string };
}

interface Outcome {
  result?: unknown;
  next?: string[];
  /** Print this instead of an envelope (manual, schema). */
  raw?: string;
  /** Keep the process alive after printing (serve). */
  stay?: boolean;
}

type Handler = (ctx: Ctx) => Promise<Outcome>;

const str = (ctx: Ctx, name: string): string | undefined => {
  const v = ctx.flags[name];
  return typeof v === "string" ? v : undefined;
};
const bool = (ctx: Ctx, name: string): boolean => ctx.flags[name] === true;
const abs = (ctx: Ctx, p: string): string => path.resolve(ctx.cwd, p);

function requireFlag(ctx: Ctx, name: string): string {
  const v = str(ctx, name);
  if (v == null || v === "") {
    throw new AgentError("USAGE", `"${ctx.cmd.name}" needs --${name}`, {
      hint: `Usage: ${ctx.cmd.usage}`,
      details: { usage: ctx.cmd.usage },
    });
  }
  return v;
}

function usage(ctx: Ctx, message: string, hint?: string): AgentError {
  return new AgentError("USAGE", message, { hint: hint ?? `Usage: ${ctx.cmd.usage}`, details: { usage: ctx.cmd.usage } });
}

/** ./narascreen-out/<script name without .demo-script.json/.json>, against cwd. */
function defaultOut(ctx: Ctx, scriptPath: string): string {
  const base = path.basename(scriptPath).replace(/\.demo-script\.json$|\.json$/i, "") || "demo";
  return path.resolve(ctx.cwd, OUT_ROOT, base);
}

function outDir(ctx: Ctx, loaded: LoadedScript): string {
  const o = str(ctx, "out");
  return o ? abs(ctx, o) : defaultOut(ctx, loaded.path);
}

/** Load + validate the positional script, remembering what a failure hint may need. */
function loadForCommand(ctx: Ctx, file: string): LoadedScript {
  const p = abs(ctx, file);
  ctx.known.script = p;
  stage("validate", `Validating ${p}`);
  const loaded = loadScript(p);
  rememberScript(ctx, loaded.script);
  ctx.warnings.push(...loaded.warnings);
  return loaded;
}

function rememberScript(ctx: Ctx, script: DemoScript): void {
  ctx.known.stepIds = script.steps.map((s) => s.id);
  ctx.known.baseUrl = script.baseUrl;
}

/** Suggest a language code for a typo or a language name ("Hindi" → "hi"). */
function suggestLang(word: string, codes: readonly string[]): string | undefined {
  const byName = codes.find((c) => (LANG_LABELS[c] ?? "").toLowerCase() === word.toLowerCase());
  return byName ?? didYouMean(word, codes);
}

function parseLangs(ctx: Ctx, script: DemoScript): string[] {
  const flag = str(ctx, "lang");
  const list = flag != null ? flag.split(",").map((s) => s.trim()).filter(Boolean) : (script.languages ?? ["en"]);
  if (!list.length) throw usage(ctx, "--lang is empty", "Pass language codes like --lang en or --lang en,hi.");
  for (const l of list) {
    if (!TTS_LANGUAGES.includes(l)) {
      const guess = suggestLang(l, TTS_LANGUAGES);
      throw usage(ctx, `Unknown language "${l}" in --lang`, `${guess ? `Did you mean "${guess}"? ` : ""}Supported: ${TTS_LANGUAGES.join(", ")}.`);
    }
  }
  return [...new Set(list)];
}

type OutputFlags = { resolution?: ResolutionName; quality?: Quality };

/** --resolution / --quality (produce, make): override the script's `output`. */
function parseOutputFlags(ctx: Ctx): OutputFlags {
  const out: OutputFlags = {};
  const r = str(ctx, "resolution");
  if (r != null) {
    const names = ["native", ...Object.keys(RESOLUTIONS)];
    if (!names.includes(r)) {
      const guess = didYouMean(r, names);
      throw usage(ctx, `--resolution must be one of ${names.join(", ")}, got "${r}"`, guess ? `Did you mean "${guess}"?` : undefined);
    }
    out.resolution = r as ResolutionName;
  }
  const q = str(ctx, "quality");
  if (q != null) {
    const levels = Object.keys(QUALITY_CRF);
    if (!levels.includes(q)) {
      const guess = didYouMean(q, levels);
      throw usage(ctx, `--quality must be one of ${levels.join(", ")}, got "${q}"`, guess ? `Did you mean "${guess}"?` : undefined);
    }
    out.quality = q as Quality;
  }
  return out;
}

function parseIntFlag(ctx: Ctx, name: string, def: number, min: number, max: number): number {
  const v = str(ctx, name);
  if (v == null) return def;
  if (!/^\d+$/.test(v.trim()) || Number(v) < min || Number(v) > max) {
    throw usage(ctx, `--${name} must be a whole number from ${min} to ${max}, got "${v}"`);
  }
  return Number(v);
}

function parseViewport(ctx: Ctx, v: string | undefined): { width: number; height: number } | undefined {
  if (v == null) return undefined;
  const m = /^(\d+)\s*[x×]\s*(\d+)$/i.exec(v.trim());
  const w = Number(m?.[1]);
  const h = Number(m?.[2]);
  if (!m || w < 320 || w > 3840 || h < 240 || h > 2160) {
    throw usage(ctx, `--viewport must look like 1440x900 (width 320–3840, height 240–2160), got "${v}"`);
  }
  return { width: w, height: h };
}

/** Local time stamp for default inspect folders: YYYYMMDD-HHMMSS. */
function stamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

const nowIso = () => new Date().toISOString();

// ─── `next` suggestions: ready-to-run commands ───────────────────────

/** "narascreen" when that name on PATH is this launcher; otherwise the
 *  launcher's absolute path — so every suggested command runs as-is. */
const PROG = resolveProgName();

function resolveProgName(): string {
  const real = safeRealpath(BIN_PATH);
  if (real) {
    for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
      if (dir && safeRealpath(path.join(dir, "narascreen")) === real) return "narascreen";
    }
  }
  return process.platform === "win32" ? `node ${q(BIN_PATH)}` : q(BIN_PATH);
}

function safeRealpath(p: string): string | undefined {
  try {
    return fs.realpathSync(p);
  } catch {
    return undefined;
  }
}

/** Shell-quote one argument only when it needs it. */
function q(s: string): string {
  if (/^[\w@%+=:,./-]+$/.test(s)) return s;
  if (process.platform === "win32") return `"${s.replace(/"/g, '\\"')}"`;
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

function cli(...args: string[]): string {
  return [PROG, ...args.map(q)].join(" ");
}

function openCmd(file: string): string {
  const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? 'start ""' : "xdg-open";
  return `${opener} ${q(file)}`;
}

/** What to run after a failure, from the error code and whatever paths we learned. */
function failureNext(ctx: Ctx, e: AgentError): string[] {
  const { script: s, job: j } = ctx.known;
  const scriptCmd = ctx.cmd.arg?.name === "script" ? ctx.cmd.name : "make";
  switch (e.code) {
    case "USAGE":
      return [helpFor(ctx.cmd.name)];
    case "ENVIRONMENT_NOT_READY": {
      const checks = (e.details?.checks ?? []) as { ok: boolean; required: boolean; fix?: string }[];
      const fixes = checks.filter((c) => !c.ok && c.required && c.fix).map((c) => c.fix!);
      return [...new Set(fixes), cli("doctor", ...(s ? ["--script", s] : []))];
    }
    case "TTS_UNAVAILABLE":
    case "FFMPEG_MISSING":
    case "BROWSER_MISSING":
      return [cli("doctor", ...(s ? ["--script", s] : []))];
    case "SCRIPT_NOT_FOUND":
      return s ? [cli("init", "--url", "<site-url>", "--out", s)] : [];
    case "SCRIPT_INVALID":
    case "SCRIPT_INVALID_JSON":
    case "ENV_VAR_MISSING":
    case "STORAGE_STATE_NOT_FOUND":
      return s ? [cli("validate", s)] : [];
    case "SELECTOR_NOT_FOUND":
    case "TARGET_NOT_VISIBLE":
    case "WAIT_TIMEOUT":
    case "ACTION_FAILED":
    case "NAVIGATION_FAILED":
      return browserFailureNext(ctx, e);
    case "BEAT_NOT_FOUND":
      return s ? [cli("validate", s)] : [];
    case "JOB_NOT_FOUND":
    case "JOB_NOT_RECORDED":
    case "SCRIPT_STRUCTURE_CHANGED":
      // make re-records automatically when it has to.
      return s && j ? [cli("make", s, "--out", j)] : [];
    case "JOB_EXISTS":
      return s && j ? [cli(scriptCmd, s, "--out", j, "--force")] : [];
    case "JOB_LOCKED":
      return j ? [cli("status", j)] : [];
    case "VIDEO_NOT_FOUND":
      return j ? [cli("produce", j)] : [];
    case "TTS_FAILED":
      return [cli("voices")];
    case "SPOTLIGHT_OVERLAP":
    case "COMPILE_FAILED":
      return s && j ? [cli("produce", j, "--script", s)] : [];
    default:
      return [];
  }
}

/** A browser step failed: look at the page exactly as that step saw it. */
function browserFailureNext(ctx: Ctx, e: AgentError): string[] {
  const { script: s, stepIds = [] } = ctx.known;
  const pageUrl = typeof e.details?.url === "string" && /^https?:/.test(e.details.url) ? e.details.url : undefined;
  if (!s) return pageUrl ? [cli("inspect", "--url", pageUrl)] : [];
  const out: string[] = [];
  const idx = e.where?.step ? stepIds.indexOf(e.where.step) : -1;
  if (e.where?.path?.startsWith("setup")) {
    // setup itself failed, so replaying it would fail again — open the page directly.
    const u = pageUrl ?? ctx.known.baseUrl;
    if (u) out.push(cli("inspect", "--url", u));
  } else if (idx > 0) {
    out.push(cli("inspect", "--script", s, "--until", stepIds[idx - 1]));
  } else {
    out.push(cli("inspect", "--script", s, ...(pageUrl ? ["--url", pageUrl] : [])));
  }
  out.push(cli("check", s));
  return out;
}

// ─── job folder safety ───────────────────────────────────────────────

/** Names NaraScreen itself puts in a job folder (or a check run leaves behind). */
const JOB_ENTRY = /^(job\.json|script\.json|trace\.jsonl|recordings|recordings-check|thumbnails|audio|video|preview|failures|logs|\.lock|demo-project(\.[\w-]+)?\.json|job\.json\.tmp-\d+)$/;

/** record --force wipes known subfolders — never point that at a folder that isn't ours. */
function assertUsableJobDir(ctx: Ctx, dir: string): void {
  if (!fs.existsSync(dir)) return;
  if (!fs.statSync(dir).isDirectory()) throw usage(ctx, `--out ${dir} is a file, not a folder`, "Pass a folder path for the job (it will be created).");
  if (jobExists(dir)) return;
  const stray = fs.readdirSync(dir).filter((n) => !JOB_ENTRY.test(n));
  if (stray.length) {
    throw new AgentError("USAGE", `${dir} is not empty and is not a NaraScreen job`, {
      hint: "Pass a new or empty folder as --out: NaraScreen owns the job folder and replaces files in it.",
      details: { dir, entries: stray.slice(0, 10) },
    });
  }
}

// ─── record / produce building blocks (callers hold the job lock) ────

interface RecordOutcome {
  job: string;
  recording: string;
  durationSec: number;
  slots: number;
  thumbnails: { dir: string; count: number };
}

async function recordJob(ctx: Ctx, loaded: LoadedScript, dir: string, opts: { headed: boolean; force: boolean }): Promise<RecordOutcome> {
  const job = createJob(dir, loaded, { force: opts.force });
  const p = jobPaths(dir);
  try {
    const { recording, durationSec, trace } = loaded.script.source
      ? await importVideo(loaded.script, p.recording)
      : await recordBrowser(ctx, loaded.script, p, opts.headed);
    writeTrace(p.trace, trace);
    const thumbnails = { dir: p.thumbnailsDir, count: await makeThumbnails(ctx, p.root) };
    job.record = { status: "done", at: nowIso(), recordingPath: recording, tracePath: p.trace, durationSec, slots: trace.length };
    writeJob(dir, job);
    return { job: p.root, recording, durationSec, slots: trace.length, thumbnails };
  } catch (e) {
    const failed: RecordState = { status: "failed", at: nowIso(), error: toAgentError(e).toJSON(), recordingPath: p.recording, tracePath: p.trace, durationSec: 0, slots: 0 };
    job.record = failed;
    try {
      writeJob(dir, job);
    } catch {
      // Reporting the original failure matters more than persisting its status.
    }
    throw e;
  }
}

interface Recorded {
  recording: string;
  durationSec: number;
  trace: TraceEntry[];
}

async function recordBrowser(ctx: Ctx, script: DemoScript, p: ReturnType<typeof jobPaths>, headed: boolean): Promise<Recorded> {
  const { run } = await import("./runner");
  const res = await run(script, p.recordingsDir, { headed, failuresDir: p.failuresDir, log });
  ctx.warnings.push(...res.warnings);
  const recording = res.recordingPath ?? p.recording;
  if (!fs.existsSync(recording)) {
    throw new AgentError("RECORDING_FAILED", `The browser run finished but no recording was written at ${recording}`, {
      hint: "Retry once. If it repeats, run `narascreen check` to confirm the steps work, then record again.",
    });
  }
  return { recording, durationSec: res.durationSec, trace: res.trace };
}

/** Video-source scripts: "recording" = importing the file; the trace comes from each fx's `at`/`rect`. */
async function importVideo(script: DemoScript, dest: string): Promise<Recorded> {
  stage("record", `Importing ${script.source!.video}`);
  const { importSourceVideo, timelineTrace } = await import("./video-source");
  const imp = importSourceVideo(script.source!.video, dest, log);
  return { recording: imp.recordingPath, durationSec: imp.durationSec, trace: timelineTrace(script, imp.durationSec) };
}

/** The trace to produce from. Video-source jobs rebuild it from the script every
 *  time, because `at`/`rect` edits must not need a re-import. */
async function traceForProduce(dir: string, script: DemoScript): Promise<TraceEntry[]> {
  const p = jobPaths(dir);
  if (!script.source) return readTrace(p.trace);
  const { timelineTrace } = await import("./video-source");
  const job = loadJob(dir);
  const trace = timelineTrace(script, job.record?.durationSec ?? 0);
  writeTrace(p.trace, trace);
  if (job.record && job.record.slots !== trace.length) {
    job.record.slots = trace.length;
    writeJob(dir, job);
  }
  return trace;
}

/** Filmstrip for the desktop editor. Nice to have — never fails the recording. */
async function makeThumbnails(ctx: Ctx, root: string): Promise<number> {
  try {
    const { generateFilmstrip } = await import("../electron/ffmpeg");
    return generateFilmstrip(root);
  } catch (e) {
    const msg = `thumbnails: ${e instanceof Error ? e.message : String(e)} (only the desktop editor's filmstrip is affected)`;
    warn(msg);
    ctx.warnings.push(msg);
    return 0;
  }
}

interface VideoOutcome {
  lang: string;
  path: string;
  durationSec: number;
  width?: number;
  height?: number;
  narrations: ProduceResult["narrations"];
  preview: Pick<PreviewResult, "contactSheet" | "frames"> | null;
}

async function produceJob(ctx: Ctx, dir: string, script: DemoScript, langs: string[], output: OutputFlags): Promise<VideoOutcome[]> {
  const p = jobPaths(dir);
  const trace = await traceForProduce(dir, script);
  const { produceLanguage } = await import("./produce-headless");
  const { makePreview } = await import("./preview");
  const videos: VideoOutcome[] = [];
  for (const lang of langs) {
    try {
      const r = await produceLanguage(p.root, script, trace, lang, log, output);
      ctx.warnings.push(...r.warnings);
      const previewDir = path.join(p.previewDir, lang);
      let preview: VideoOutcome["preview"] = null;
      try {
        stage("preview", `Making preview frames [${lang}]`);
        const pv = makePreview(r.videoPath, previewDir);
        preview = { contactSheet: pv.contactSheet, frames: pv.frames };
      } catch (e) {
        // The video is the product; a missing contact sheet should not throw it away.
        const msg = `preview [${lang}]: ${toAgentError(e).message}`;
        warn(msg);
        ctx.warnings.push(msg);
      }
      const state = loadJob(dir);
      state.produce[lang] = { status: "done", at: nowIso(), videoPath: r.videoPath, durationSec: r.durationSec, previewDir };
      writeJob(dir, state);
      // Final size (after any --resolution scaling), when the producer reports it.
      const { width, height } = r as Partial<{ width: number; height: number }>;
      videos.push({ lang, path: r.videoPath, durationSec: r.durationSec, ...(width && height ? { width, height } : {}), narrations: r.narrations, preview });
    } catch (e) {
      try {
        const state = loadJob(dir);
        state.produce[lang] = { status: "failed", at: nowIso(), error: toAgentError(e).toJSON() };
        writeJob(dir, state);
      } catch {
        // keep the original error
      }
      throw e;
    }
  }
  return videos;
}

/** readJob, but a damaged job.json is the job's problem (exit 1), not a NaraScreen bug. */
function loadJob(dir: string): JobState {
  try {
    return readJob(dir);
  } catch (e) {
    if (e instanceof AgentError) throw e;
    const file = jobPaths(dir).jobJson;
    throw new AgentError("JOB_NOT_FOUND", `The job file ${file} is unreadable: ${e instanceof Error ? e.message : String(e)}`, {
      hint: "The job folder is damaged. Re-record into a new --out (or delete this folder and run make again).",
      details: { jobJson: file },
    });
  }
}

function assertRecorded(job: JobState, dir: string): void {
  const p = jobPaths(dir);
  if (job.record?.status !== "done") {
    throw new AgentError("JOB_NOT_RECORDED", `Job ${p.root} has no successful recording${job.record ? " (the last one failed)" : ""}`, {
      hint: "Record it first: `narascreen make <script> --out <job>` (records, then produces).",
      details: job.record?.error ? { lastError: job.record.error } : undefined,
    });
  }
  const recording = job.record.recordingPath || p.recording;
  if (!fs.existsSync(recording) || !fs.existsSync(p.trace)) {
    throw new AgentError("JOB_NOT_RECORDED", `Job ${p.root} is missing its recording or trace`, {
      hint: "Re-record: `narascreen make <script> --out <job> --force`.",
      details: { recording, trace: p.trace },
    });
  }
}

/** --script, else the file the job was recorded from (re-read fresh), else the
 *  copy saved in the job at record time. */
function scriptForJob(ctx: Ctx, job: JobState, dir: string): { script: DemoScript; scriptPath: string } {
  const flag = str(ctx, "script");
  const file = flag ? abs(ctx, flag) : job.scriptPath;
  ctx.known.script = file;
  if (flag || fs.existsSync(file)) {
    stage("validate", `Validating ${file}`);
    const loaded = loadScript(file);
    ctx.warnings.push(...loaded.warnings);
    rememberScript(ctx, loaded.script);
    return { script: loaded.script, scriptPath: loaded.path };
  }
  const saved = jobPaths(dir).script;
  if (!fs.existsSync(saved)) {
    throw new AgentError("SCRIPT_NOT_FOUND", `The job's script ${file} no longer exists (and the job has no saved copy)`, {
      hint: "Pass the script explicitly: --script <file>.",
    });
  }
  const raw: unknown = JSON.parse(fs.readFileSync(saved, "utf-8"));
  const { script, warnings } = validateScript(raw, { dir: path.dirname(job.scriptPath) });
  ctx.warnings.push(
    ...warnings,
    `The script file ${file} no longer exists; used the copy saved at record time (${saved}). Pass --script to use another file.`,
  );
  rememberScript(ctx, script);
  return { script, scriptPath: file };
}

function afterProduceNext(jobDir: string, scriptPath: string, videos: VideoOutcome[]): string[] {
  const next: string[] = [];
  const first = videos[0];
  if (first?.preview) next.push(openCmd(first.preview.contactSheet));
  if (first) next.push(openCmd(first.path));
  if (first) next.push(cli("preview", jobDir, "--lang", first.lang, "--tiles", "24"));
  // After editing narration/callout text: re-running make reuses the recording.
  next.push(cli("make", scriptPath, "--out", jobDir));
  return next;
}

// ─── commands ────────────────────────────────────────────────────────

const HANDLERS: Record<string, Handler> = {
  async help(ctx) {
    if (ctx.arg) {
      const topic = findCommand(ctx.arg);
      if (!topic) {
        const guess = didYouMean(ctx.arg, COMMANDS.map((c) => c.name));
        throw usage(ctx, `Unknown command "${ctx.arg}"`, `${guess ? `Did you mean "${guess}"? ` : ""}Run \`narascreen help\` for the list.`);
      }
      return { result: { usage: topic.usage, command: topic, globalFlags: GLOBAL_FLAGS } };
    }
    return {
      result: {
        usage: "narascreen <command> [<arg>] [--flags] — one JSON envelope on stdout; progress on stderr",
        commands: COMMANDS.map((c) => ({ name: c.name, usage: c.usage, summary: c.summary })),
        globalFlags: GLOBAL_FLAGS.map((f) => ({ flag: f.flag, desc: f.desc })),
        docs: "run `narascreen manual`, or open /docs on `narascreen serve`",
      },
      next: [cli("doctor"), cli("manual")],
    };
  },

  async version() {
    const pkg = JSON.parse(fs.readFileSync(path.join(EDITOR_DIR, "package.json"), "utf-8")) as { version?: string };
    return { result: { version: pkg.version ?? "0.0.0", node: process.versions.node } };
  },

  async manual() {
    const { buildManualMarkdown } = await import("./docs");
    return { raw: buildManualMarkdown() };
  },

  async docs(ctx) {
    const out = abs(ctx, requireFlag(ctx, "out"));
    const { buildManualMarkdown, renderDocsHtml } = await import("./docs");
    const html = renderDocsHtml(buildManualMarkdown());
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, html);
    return { result: { path: out }, next: [openCmd(out)] };
  },

  async schema(ctx) {
    const json = JSON.stringify(demoScriptJsonSchema(), null, 2) + "\n";
    const o = str(ctx, "out");
    if (!o) return { raw: json };
    const out = abs(ctx, o);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, json);
    return { result: { path: out } };
  },

  async doctor(ctx) {
    let script: DemoScript | undefined;
    const s = str(ctx, "script");
    if (s) {
      ctx.known.script = abs(ctx, s);
      script = loadScript(ctx.known.script).script;
    }
    const { runDoctor } = await import("./doctor");
    const report = await runDoctor({ script, outDir: path.resolve(ctx.cwd, OUT_ROOT) });
    for (const c of report.checks) {
      if (!c.ok && !c.required) ctx.warnings.push(`${c.id}: ${c.detail}${c.fix ? ` — fix: ${c.fix}` : ""}`);
    }
    if (!report.ready) {
      const failed = report.checks.filter((c) => !c.ok && c.required);
      throw new AgentError("ENVIRONMENT_NOT_READY", `Not ready: ${failed.map((c) => `${c.id} (${c.detail.split(" — ")[0]})`).join("; ")}`, {
        hint: "Run each failed check's `fix` (also listed in `next`), then run `narascreen doctor` again.",
        details: { checks: report.checks },
      });
    }
    return {
      result: report,
      next: ctx.known.script ? [cli("validate", ctx.known.script)] : [cli("init", "--url", "<site-url>")],
    };
  },

  async voices(ctx) {
    const only = str(ctx, "lang");
    const codes = Object.keys(LANG_CODES).filter((c) => DEFAULT_VOICES[c]?.length);
    if (only != null && !codes.includes(only)) {
      const guess = suggestLang(only, codes);
      throw usage(ctx, `Unknown language "${only}"`, `${guess ? `Did you mean "${guess}"? ` : ""}Supported: ${codes.join(", ")}.`);
    }
    const languages = (only ? [only] : codes).map((code) => ({
      code,
      label: LANG_LABELS[code] ?? code,
      defaultVoice: DEFAULT_VOICES[code][0],
      voices: DEFAULT_VOICES[code],
    }));
    return { result: { languages } };
  },

  async init(ctx) {
    const url = requireFlag(ctx, "url");
    const o = str(ctx, "out");
    const res = initScript({ url, out: o ? abs(ctx, o) : undefined, name: str(ctx, "name"), force: bool(ctx, "force"), cwd: ctx.cwd });
    ctx.known.script = res.scriptPath;
    ctx.warnings.push(...res.warnings);
    return {
      result: { scriptPath: res.scriptPath, script: res.script },
      next: [cli("inspect", "--url", new URL(url).href), cli("validate", res.scriptPath), cli("check", res.scriptPath)],
    };
  },

  async inspect(ctx) {
    const url = str(ctx, "url");
    const scriptFlag = str(ctx, "script");
    const until = str(ctx, "until");
    if (!url && !scriptFlag) throw usage(ctx, "inspect needs --url <page> or --script <file>");
    if (until && !scriptFlag) throw usage(ctx, "--until only works together with --script", "Add --script <file> so the steps before the page can run.");
    const viewport = parseViewport(ctx, str(ctx, "viewport"));

    let loaded: LoadedScript | undefined;
    if (scriptFlag) {
      ctx.known.script = abs(ctx, scriptFlag);
      loaded = loadScript(ctx.known.script);
      if (loaded.script.source) {
        throw usage(
          ctx,
          `${loaded.path} edits an existing video — there is no page to inspect`,
          "Use `narascreen preview <job> --raw` to look at a video (frames with timestamps) and pick `at` times and `rect`s.",
        );
      }
      ctx.warnings.push(...loaded.warnings);
      rememberScript(ctx, loaded.script);
      if (until && !loaded.script.steps.some((s) => s.id === until)) {
        const ids = loaded.script.steps.map((s) => s.id);
        const guess = didYouMean(until, ids);
        throw new AgentError("BEAT_NOT_FOUND", `No step with id "${until}" in ${loaded.path}`, {
          hint: `${guess ? `Did you mean "${guess}"? ` : ""}--until takes a step id from the script.`,
          details: { steps: ids },
        });
      }
    }
    if (url && !loaded && !/^https?:\/\//i.test(url)) {
      throw usage(ctx, `--url must be an absolute http(s) URL (got "${url}")`, "Pass the full address, or add --script so a path is resolved against its baseUrl.");
    }

    let storageState: string | undefined;
    const ss = str(ctx, "storage-state");
    if (ss) {
      storageState = abs(ctx, ss);
      if (!fs.existsSync(storageState)) {
        throw new AgentError("STORAGE_STATE_NOT_FOUND", `storageState file not found: ${storageState}`, {
          hint: "Pass a Playwright storageState JSON saved after logging in, or use --script with setup steps that log in.",
        });
      }
    }

    const o = str(ctx, "out");
    const out = o ? abs(ctx, o) : path.resolve(ctx.cwd, OUT_ROOT, "inspect", stamp());
    const { inspect } = await import("./inspect");
    const res = await inspect({
      url,
      script: loaded?.script,
      untilStep: until,
      outDir: out,
      viewport,
      storageState,
      headed: bool(ctx, "headed"),
      fullPage: bool(ctx, "full-page"),
      log,
    });
    if (res.truncated) {
      ctx.warnings.push(`Element list truncated to ${res.elements.length} entries; the full accessibility tree is in ${res.ariaSnapshotPath}.`);
    }
    const next = loaded
      ? [cli("validate", loaded.path), cli("check", loaded.path)]
      : [cli("init", "--url", res.url || url!, "--out", path.resolve(ctx.cwd, `${hostName(res.url || url!)}.demo-script.json`))];
    return { result: res, next };
  },

  async validate(ctx) {
    const loaded = loadForCommand(ctx, ctx.arg!);
    return {
      result: { valid: true, scriptPath: loaded.path, summary: scriptSummary(loaded.script) },
      next: [cli("check", loaded.path), cli("make", loaded.path, "--out", defaultOut(ctx, loaded.path))],
    };
  },

  async check(ctx) {
    const loaded = loadForCommand(ctx, ctx.arg!);
    const out = outDir(ctx, loaded);
    ctx.known.job = out;
    if (loaded.script.source) {
      // Nothing to drive: validation already proved every `at` and `rect` fits the video.
      const { probeDuration } = await import("../electron/ffmpeg");
      const { timelineTrace } = await import("./video-source");
      const durationSec = probeDuration(loaded.script.source.video);
      const slots = timelineTrace(loaded.script, durationSec).length;
      return {
        result: { mode: "video", scriptPath: loaded.path, steps: loaded.script.steps.length, slots, durationSec },
        next: [cli("make", loaded.path, "--out", out)],
      };
    }
    const hold = bool(ctx, "hold");
    const outExisted = fs.existsSync(out);
    const scratch = path.join(out, "recordings-check");
    const { run } = await import("./runner");
    let res;
    try {
      res = await run(loaded.script, scratch, {
        check: true,
        headed: bool(ctx, "headed") || hold,
        holdOpen: hold,
        failuresDir: jobPaths(out).failuresDir,
        log,
      });
    } finally {
      // A dry run keeps nothing but failure screenshots.
      fs.rmSync(scratch, { recursive: true, force: true });
      if (!outExisted) removeIfEmpty(out);
    }
    ctx.warnings.push(...res.warnings);
    return {
      result: { mode: "browser", scriptPath: loaded.path, steps: loaded.script.steps.length, slots: res.trace.length, durationSec: res.durationSec },
      next: [cli("make", loaded.path, "--out", out)],
    };
  },

  async record(ctx) {
    const loaded = loadForCommand(ctx, ctx.arg!);
    const out = outDir(ctx, loaded);
    ctx.known.job = out;
    assertUsableJobDir(ctx, out);
    const force = bool(ctx, "force");
    const res = await locked(out, () => recordJob(ctx, loaded, out, { headed: bool(ctx, "headed"), force }));
    return { result: res, next: [cli("produce", res.job)] };
  },

  async produce(ctx) {
    const output = parseOutputFlags(ctx);
    const dir = abs(ctx, ctx.arg!);
    ctx.known.job = dir;
    const job = loadJob(dir);
    ctx.known.script = job.scriptPath;
    assertRecorded(job, dir);
    const { script, scriptPath } = scriptForJob(ctx, job, dir);
    assertSameStructure(job, script);
    const langs = parseLangs(ctx, script);
    const videos = await locked(dir, () => produceJob(ctx, dir, script, langs, output));
    const root = jobPaths(dir).root;
    return { result: { job: root, videos }, next: afterProduceNext(root, scriptPath, videos) };
  },

  async make(ctx) {
    const loaded = loadForCommand(ctx, ctx.arg!);
    const out = outDir(ctx, loaded);
    ctx.known.job = out;
    // Bad flags must fail before a long recording.
    const langs = parseLangs(ctx, loaded.script);
    const output = parseOutputFlags(ctx);
    assertUsableJobDir(ctx, out);
    const force = bool(ctx, "force");

    return locked(out, async () => {
      const decision = decideRecording(out, loaded, force);
      if (decision.record) {
        if (decision.warning) {
          warn(decision.warning);
          ctx.warnings.push(decision.warning);
        } else if (decision.reason) {
          log(decision.reason);
        }
        await recordJob(ctx, loaded, out, { headed: bool(ctx, "headed"), force: jobExists(out) });
      } else {
        const job = loadJob(out);
        const rec = job.record!;
        const unchanged = loaded.script.source ? "source video unchanged" : "browser steps unchanged";
        log(`Reusing recording ${rec.recordingPath} — ${unchanged} since ${rec.at}`);
        // Later `produce <job>` (no --script) should pick up the file being edited now.
        job.scriptPath = loaded.path;
        job.scope = loaded.script.scope;
        writeJob(out, job);
      }
      const videos = await produceJob(ctx, out, loaded.script, langs, output);
      const rec = loadJob(out).record!;
      const recording = { path: rec.recordingPath, durationSec: rec.durationSec, slots: rec.slots };
      const root = jobPaths(out).root;
      return {
        result: { job: root, recorded: decision.record, recording, videos },
        next: afterProduceNext(root, loaded.path, videos),
      };
    });
  },

  async preview(ctx) {
    let tiles = parseIntFlag(ctx, "tiles", 12, 1, 10_000);
    if (tiles > 48) {
      ctx.warnings.push(`--tiles ${tiles} is above the maximum; using 48.`);
      tiles = 48;
    }
    const raw = bool(ctx, "raw");
    if (raw && str(ctx, "lang") != null) {
      throw usage(ctx, "--raw previews the recording itself, so --lang does not apply", "Drop --lang (or drop --raw to preview a produced video).");
    }
    const dir = abs(ctx, ctx.arg!);
    ctx.known.job = dir;
    const job = loadJob(dir);
    ctx.known.script = job.scriptPath;
    const p = jobPaths(dir);
    const { makePreview } = await import("./preview");

    if (raw) {
      // The raw recording (or imported source) with timestamps — how an agent
      // picks `at` times and `rect`s for a video-source script.
      assertRecorded(job, dir);
      const recording = job.record!.recordingPath || p.recording;
      stage("preview", "Making preview frames [raw recording]");
      const pv = await locked(dir, async () => makePreview(recording, path.join(p.previewDir, "raw"), { tiles }));
      return { result: { raw: true, ...pv }, next: [openCmd(pv.contactSheet), cli("validate", job.scriptPath)] };
    }

    const produced = Object.keys(job.produce);
    const lang = str(ctx, "lang") ?? produced.find((l) => job.produce[l].status === "done") ?? produced[0];
    const video = lang ? path.join(p.videoDir, `final_${lang}.mp4`) : undefined;
    if (!lang || !video || !fs.existsSync(video)) {
      throw new AgentError("VIDEO_NOT_FOUND", lang ? `No produced ${lang} video in ${p.root}` : `No video has been produced in ${p.root} yet`, {
        hint: "Produce it first: `narascreen produce <job>` (add --lang for other languages).",
        details: { lang: lang ?? null, produced, expected: video ?? null },
      });
    }
    stage("preview", `Making preview frames [${lang}]`);
    const pv = await locked(dir, async () => makePreview(video, path.join(p.previewDir, lang), { tiles }));
    return { result: { lang, ...pv }, next: [openCmd(pv.contactSheet), openCmd(pv.video)] };
  },

  async status(ctx) {
    const dir = abs(ctx, ctx.arg!);
    ctx.known.job = dir;
    const job = loadJob(dir);
    const p = jobPaths(dir);
    ctx.known.script = job.scriptPath;

    const lockPid = lockHolder(p.lock);
    let scriptStructureChanged: boolean | null = null;
    try {
      scriptStructureChanged = structureHash(loadScript(job.scriptPath).script) !== job.structureHash;
    } catch {
      // Script moved, invalid or needs env vars — status still reports the job.
    }

    const langs = new Set([...Object.keys(job.produce), ...listDir(p.videoDir).flatMap((f) => /^final_(.+)\.mp4$/.exec(f)?.[1] ?? [])]);
    const artifacts = {
      script: fileInfo(p.script),
      recording: fileInfo(job.record?.recordingPath || p.recording),
      trace: fileInfo(p.trace),
      thumbnails: { dir: p.thumbnailsDir, count: listDir(p.thumbnailsDir).filter((f) => f.endsWith(".jpg")).length },
      project: fileInfo(path.join(p.root, "demo-project.json")),
      videos: [...langs].map((lang) => ({ lang, ...fileInfo(path.join(p.videoDir, `final_${lang}.mp4`)) })),
      previews: [...langs].map((lang) => ({ lang, ...fileInfo(path.join(p.previewDir, lang, "contact.jpg")) })),
      failures: listDir(p.failuresDir).filter((f) => f.endsWith(".png")).map((f) => path.join(p.failuresDir, f)),
      logs: listDir(p.logsDir).map((f) => path.join(p.logsDir, f)),
    };

    const next: string[] = [];
    const recorded = job.record?.status === "done" && artifacts.recording.exists && artifacts.trace.exists;
    const video = artifacts.videos.find((v) => v.exists);
    if (lockPid) next.push(cli("status", p.root));
    else if (!recorded || scriptStructureChanged) next.push(cli("make", job.scriptPath, "--out", p.root));
    else if (!video) next.push(cli("produce", p.root));
    else next.push(openCmd(video.path), cli("preview", p.root, "--lang", video.lang), cli("make", job.scriptPath, "--out", p.root));

    return {
      result: {
        job: p.root,
        scope: job.scope,
        scriptPath: job.scriptPath,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
        busy: lockPid ? { pid: lockPid } : null,
        scriptStructureChanged,
        record: job.record ?? null,
        produce: job.produce,
        artifacts,
      },
      next,
    };
  },

  async serve(ctx) {
    const port = parseIntFlag(ctx, "port", 4790, 0, 65535);
    const concurrency = parseIntFlag(ctx, "concurrency", 1, 1, 64);
    const host = str(ctx, "host") ?? "127.0.0.1";
    const token = str(ctx, "token") ?? (process.env.NARASCREEN_TOKEN || undefined);
    const workspace = abs(ctx, str(ctx, "workspace") ?? OUT_ROOT);
    fs.mkdirSync(workspace, { recursive: true });
    const { startServer } = await import("./server");
    const srv = await startServer({ port, host, token, workspace, concurrency });
    server = srv;
    const auth = token ? ["-H", "Authorization: Bearer <token>"] : [];
    return {
      result: { url: srv.url, docs: `${srv.url}/docs`, workspace, auth: token ? "bearer" : "none" },
      next: [["curl", "-s", ...auth, `${srv.url}/v1/health`].map(q).join(" "), `curl -s ${q(`${srv.url}/docs.md`)}`],
      stay: true,
    };
  },
};

// ─── make: reuse the recording when possible ─────────────────────────

function decideRecording(dir: string, loaded: LoadedScript, force: boolean): { record: boolean; reason?: string; warning?: string } {
  if (!jobExists(dir)) return { record: true, reason: "New job — recording" };
  if (force) return { record: true, reason: "--force — re-recording" };
  const job = loadJob(dir);
  try {
    assertRecorded(job, dir);
  } catch {
    return { record: true, reason: job.record?.status === "failed" ? "The previous recording failed — recording again" : "No usable recording yet — recording" };
  }
  try {
    assertSameStructure(job, loaded.script);
  } catch (e) {
    const d = (e instanceof AgentError ? e.details : undefined) as
      | { changedSteps: string[]; addedSteps: string[]; removedSteps: string[] }
      | undefined;
    const parts = [
      d?.changedSteps.length ? `changed: ${d.changedSteps.join(", ")}` : "",
      d?.addedSteps.length ? `added: ${d.addedSteps.join(", ")}` : "",
      d?.removedSteps.length ? `removed: ${d.removedSteps.join(", ")}` : "",
    ].filter(Boolean);
    if (loaded.script.source) {
      return { record: true, warning: "The source video changed since it was imported — re-importing it." };
    }
    const what = parts.length ? `steps ${parts.join("; ")}` : "setup, defaults, baseUrl, viewport or session";
    return {
      record: true,
      warning: `Browser steps changed since the last recording (${what}) — re-recording. Text-only edits (narration, callout text, voices, durations) reuse the recording.`,
    };
  }
  return { record: false };
}

// ─── job locks ───────────────────────────────────────────────────────
//
// withJobLock releases its lock in a `finally`, which never runs when we exit
// on a signal or crash. A leftover lock is harmless (its pid is dead) but noisy,
// so locks this process holds are removed on the way out.

const heldLocks = new Set<string>();

async function locked<T>(dir: string, fn: () => Promise<T>): Promise<T> {
  const lock = jobPaths(dir).lock;
  heldLocks.add(lock);
  try {
    return await withJobLock(dir, fn);
  } finally {
    heldLocks.delete(lock);
  }
}

function releaseLocks(): void {
  for (const lock of heldLocks) {
    try {
      if (fs.readFileSync(lock, "utf-8").trim() === String(process.pid)) fs.rmSync(lock, { force: true });
    } catch {
      // already gone
    }
  }
}

// ─── small fs helpers ────────────────────────────────────────────────

function lockHolder(lockFile: string): number | null {
  try {
    const pid = Number(fs.readFileSync(lockFile, "utf-8").trim());
    if (!pid) return null;
    process.kill(pid, 0);
    return pid;
  } catch {
    return null;
  }
}

function fileInfo(p: string): { path: string; exists: boolean; bytes?: number } {
  try {
    return { path: p, exists: true, bytes: fs.statSync(p).size };
  } catch {
    return { path: p, exists: false };
  }
}

function listDir(dir: string): string[] {
  try {
    return fs.readdirSync(dir).sort();
  } catch {
    return [];
  }
}

function removeIfEmpty(dir: string): void {
  try {
    if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
  } catch {
    // not there / not empty — fine
  }
}

function hostName(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "") || "demo";
  } catch {
    return "demo";
  }
}

function didYouMean(word: string, options: readonly string[]): string | undefined {
  let best: string | undefined;
  let bestD = Infinity;
  for (const o of options) {
    const d = levenshtein(word.toLowerCase(), o.toLowerCase());
    if (d < bestD) {
      bestD = d;
      best = o;
    }
  }
  return best && bestD <= Math.max(2, Math.floor(word.length / 3)) ? best : undefined;
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

void main(process.argv.slice(2));
