// ─── job: the on-disk folder one demo lives in ──────────────────────
//
// A job folder is owned by NaraScreen. Agents pass its path to commands but
// never edit files inside it. It is also a valid NaraScreen desktop session
// (demo-project.json + recordings/ + thumbnails/), so a human can open it in the
// editor for final touch-ups.
//
//   <job>/
//     job.json                state: what has been recorded/produced, and when
//     script.json             the script exactly as it was when recorded
//     recordings/recording.mp4, trace.jsonl, thumbnails/
//     audio/                  generated narration (cached by content hash)
//     video/final_<lang>.mp4  produced videos
//     preview/<lang>/         contact sheet + frames for checking the result
//     failures/               screenshots of the page when a step failed
//     logs/                   full renderer logs

import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { AgentError, type AgentErrorInit } from "./errors";
import { BUILTIN_DEFAULTS, isAct, type BeatEntry, type DemoScript } from "./schema";
import type { LoadedScript } from "./validate";
import type { TraceEntry } from "./types";

export const JOB_VERSION = 1 as const;

export interface StageRecord {
  status: "done" | "failed";
  at: string;
  error?: ReturnType<AgentError["toJSON"]>;
}

export interface RecordState extends StageRecord {
  recordingPath: string;
  tracePath: string;
  durationSec: number;
  slots: number;
}

export interface ProduceState extends StageRecord {
  videoPath?: string;
  durationSec?: number;
  previewDir?: string;
}

export interface JobState {
  jobVersion: typeof JOB_VERSION;
  createdAt: string;
  updatedAt: string;
  /** Absolute path of the script file the job was recorded from. */
  scriptPath: string;
  scope: string;
  /** Fingerprint of everything that affects the recording (see structureHash). */
  structureHash: string;
  /** Per-step fingerprints — used to say WHICH steps changed. */
  stepHashes: Record<string, string>;
  record?: RecordState;
  produce: Record<string, ProduceState>;
}

export function jobPaths(jobDir: string) {
  const root = path.resolve(jobDir);
  return {
    root,
    jobJson: path.join(root, "job.json"),
    script: path.join(root, "script.json"),
    recordingsDir: path.join(root, "recordings"),
    recording: path.join(root, "recordings", "recording.mp4"),
    trace: path.join(root, "trace.jsonl"),
    thumbnailsDir: path.join(root, "thumbnails"),
    audioDir: path.join(root, "audio"),
    videoDir: path.join(root, "video"),
    previewDir: path.join(root, "preview"),
    failuresDir: path.join(root, "failures"),
    logsDir: path.join(root, "logs"),
    lock: path.join(root, ".lock"),
  };
}

export function jobExists(jobDir: string): boolean {
  return fs.existsSync(jobPaths(jobDir).jobJson);
}

export function readJob(jobDir: string): JobState {
  const p = jobPaths(jobDir);
  if (!fs.existsSync(p.jobJson)) {
    throw new AgentError("JOB_NOT_FOUND", `No NaraScreen job at ${p.root}`, {
      hint: "Record first: `narascreen record <script> --out <dir>` (or `narascreen make`), then pass that --out dir.",
    });
  }
  return JSON.parse(fs.readFileSync(p.jobJson, "utf-8")) as JobState;
}

export function writeJob(jobDir: string, state: JobState): void {
  const p = jobPaths(jobDir);
  state.updatedAt = new Date().toISOString();
  const tmp = `${p.jobJson}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + "\n");
  fs.renameSync(tmp, p.jobJson);
}

/**
 * Start a fresh job for recording. Refuses to clobber an existing job unless
 * `force`, in which case previous recording/video/preview output is removed
 * (the narration audio cache is kept — it is content-addressed).
 */
export function createJob(jobDir: string, loaded: LoadedScript, opts: { force?: boolean } = {}): JobState {
  const p = jobPaths(jobDir);
  if (fs.existsSync(p.jobJson) && !opts.force) {
    throw new AgentError("JOB_EXISTS", `A job already exists at ${p.root}`, {
      hint: "Pass --force to re-record into it (replaces the recording and videos), or choose another --out.",
    });
  }
  if (opts.force) {
    for (const d of [p.recordingsDir, p.thumbnailsDir, p.videoDir, p.previewDir, p.failuresDir, p.logsDir]) {
      fs.rmSync(d, { recursive: true, force: true });
    }
    fs.rmSync(p.trace, { force: true });
  }
  fs.mkdirSync(p.root, { recursive: true });
  fs.writeFileSync(p.script, JSON.stringify(loaded.raw, null, 2) + "\n");
  const now = new Date().toISOString();
  const state: JobState = {
    jobVersion: JOB_VERSION,
    createdAt: now,
    updatedAt: now,
    scriptPath: loaded.path,
    scope: loaded.script.scope,
    structureHash: structureHash(loaded.script),
    stepHashes: stepHashes(loaded.script),
    produce: {},
  };
  writeJob(jobDir, state);
  return state;
}

// ─── locking (one writer per job) ────────────────────────────────────

export async function withJobLock<T>(jobDir: string, fn: () => Promise<T>): Promise<T> {
  const p = jobPaths(jobDir);
  fs.mkdirSync(p.root, { recursive: true });
  acquireLock(p.lock, p.root);
  try {
    return await fn();
  } finally {
    // Only remove the lock if it is still ours.
    try {
      if (fs.readFileSync(p.lock, "utf-8").trim() === lockToken()) fs.rmSync(p.lock, { force: true });
    } catch {
      /* already gone */
    }
  }
}

/** "<pid>:<process start time>" — a reused pid does not look like the old owner. */
function lockToken(pid = process.pid): string {
  return `${pid}:${pid === process.pid ? Math.round(Date.now() / 1000 - process.uptime()) : "?"}`;
}

/** Create the lock file atomically (O_EXCL); take over only provably stale locks. */
function acquireLock(lockPath: string, root: string): void {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = fs.openSync(lockPath, "wx");
      fs.writeSync(fd, lockToken());
      fs.closeSync(fd);
      return;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    }
    const owner = fs.existsSync(lockPath) ? fs.readFileSync(lockPath, "utf-8").trim() : "";
    const pid = Number(owner.split(":")[0]);
    if (pid && isAlive(pid)) {
      throw new AgentError("JOB_LOCKED", `Job ${root} is in use by another NaraScreen process (pid ${pid})`, {
        hint: "Wait for it to finish (`narascreen status <job>`), or use a different --out for parallel work.",
        details: { pid },
      });
    }
    // Stale (owner exited). Remove and retry once; a racing process that wins
    // the retry makes us fail with JOB_LOCKED on the next loop.
    fs.rmSync(lockPath, { force: true });
  }
  throw new AgentError("JOB_LOCKED", `Job ${root} is in use by another NaraScreen process`, {
    hint: "Wait for it to finish, or use a different --out for parallel work.",
  });
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// ─── structure fingerprint ───────────────────────────────────────────
//
// Browser scripts: covers everything that changes what the browser does or when:
// acts (fully), fx verbs + anchors (their position and target were captured
// while recording), timing defaults, setup, site, viewport, session. NOT covered
// — so they can be edited after recording and re-produced without re-recording:
// narration text/audio, voices, languages, callout text/style, durations, ranges,
// zoom timing, dim, blur radius, music, output, disabled.
//
// Video-source scripts: only the source file itself (path, size, mtime). Their
// timeline comes from `at`/`rect` in the script and is rebuilt on every produce.

const RECORD_DEFAULT_KEYS = ["dwellMs", "revealMs", "center", "typeDelayMs"] as const;

function entryShape(e: BeatEntry): unknown {
  if (isAct(e)) {
    const { note: _note, ...rest } = e;
    return rest;
  }
  return {
    fx: e.fx,
    anchor: e.anchor ?? null,
    anchors: e.anchors ?? null,
    targets: e.targets?.map((t) => t.anchor ?? null) ?? null,
  };
}

function stepShape(beat: DemoScript["steps"][number]): unknown {
  return { id: beat.id, dwellMs: beat.dwellMs ?? null, beat: beat.beat.map(entryShape) };
}

export function structureHash(script: DemoScript): string {
  if (script.source) {
    const st = fs.statSync(script.source.video);
    return sha256(stableStringify({ source: script.source.video, size: st.size, mtimeMs: Math.round(st.mtimeMs) }));
  }
  const d = { ...BUILTIN_DEFAULTS, ...script.defaults };
  return sha256(
    stableStringify({
      baseUrl: script.baseUrl,
      viewport: script.viewport,
      storageState: script.storageState ?? null,
      setup: (script.setup ?? []).map(entryShape),
      defaults: Object.fromEntries(RECORD_DEFAULT_KEYS.map((k) => [k, d[k]])),
      steps: script.steps.map(stepShape),
    }),
  );
}

export function stepHashes(script: DemoScript): Record<string, string> {
  if (script.source) return {};
  return Object.fromEntries(script.steps.map((b) => [b.id, sha256(stableStringify(stepShape(b))).slice(0, 12)]));
}

/** Throw SCRIPT_STRUCTURE_CHANGED if `script` can't reuse this job's recording. */
export function assertSameStructure(job: JobState, script: DemoScript): void {
  if (structureHash(script) === job.structureHash) return;
  if (script.source) {
    throw new AgentError("SCRIPT_STRUCTURE_CHANGED", "The source video changed (or is a different file) since it was imported", {
      hint: "Re-import it: `narascreen record <script> --out <job> --force` (or `make`, which does this automatically).",
      details: { source: script.source.video },
    });
  }
  const now = stepHashes(script);
  const changedSteps = Object.keys(now).filter((id) => job.stepHashes[id] && job.stepHashes[id] !== now[id]);
  const addedSteps = Object.keys(now).filter((id) => !job.stepHashes[id]);
  const removedSteps = Object.keys(job.stepHashes).filter((id) => !now[id]);
  const init: AgentErrorInit = {
    hint:
      "Browser actions, effect order/anchors, timing defaults, setup, baseUrl or viewport changed since recording. " +
      "Re-record with `narascreen record <script> --out <job> --force` (or `make … --force`). " +
      "Text-only edits (narration, voices, callout text, durations) do NOT need a re-record.",
    details: { changedSteps, addedSteps, removedSteps, otherChanges: !changedSteps.length && !addedSteps.length && !removedSteps.length },
  };
  throw new AgentError("SCRIPT_STRUCTURE_CHANGED", "The script no longer matches this job's recording", init);
}

// ─── trace I/O ───────────────────────────────────────────────────────

export function writeTrace(tracePath: string, trace: TraceEntry[]): void {
  fs.writeFileSync(tracePath, trace.map((e) => JSON.stringify(e)).join("\n") + "\n");
}

export function readTrace(tracePath: string): TraceEntry[] {
  return fs
    .readFileSync(tracePath, "utf-8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as TraceEntry);
}

// ─── utils ───────────────────────────────────────────────────────────

export function sha256(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex");
}

export function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  if (v && typeof v === "object") {
    const entries = Object.entries(v as Record<string, unknown>)
      .filter(([, x]) => x !== undefined)
      .sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([k, x]) => `${JSON.stringify(k)}:${stableStringify(x)}`).join(",")}}`;
  }
  return JSON.stringify(v);
}
