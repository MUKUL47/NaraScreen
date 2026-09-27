// ─── narascreen-ipc: the desktop ↔ main-process contract for the CLI bridge ──
//
// The desktop runs every heavy operation (validate, check, make, produce, doctor…)
// through the same CLI that agents use, as a child process with `--events json`.
// These types are shared by electron/preload.ts, electron/cli-bridge.ts and the renderer.
//
// Errors: a rejected bridge call carries an Error whose message starts with a
// stable code, "CODE: message" (e.g. "JOB_LOCKED: …", "TTS_UNAVAILABLE: …"),
// followed by the hint on the next line when there is one. Custom Error
// properties do not survive Electron's context bridge, so the code lives in the
// message: read it with `bridgeErrorCode(err)`.

import type { Envelope, NaraEvent } from "../../api/protocol";

export type { Envelope, EnvelopeError, NaraEvent, Stage } from "../../api/protocol";

export type CliCommand =
  | "doctor"
  | "voices"
  | "init"
  | "inspect"
  | "validate"
  | "check"
  | "record"
  | "produce"
  | "make"
  | "preview"
  | "status"
  | "schema";

export interface CliRunRequest {
  command: CliCommand;
  /** Positional arg, absolute: the script (validate|check|record|make) or the job dir (produce|preview|status). */
  arg?: string;
  /** Flag names exactly as api/commands.ts FlagDoc.name, no dashes, e.g. { out, lang: "en,hi", resolution, quality, force: true }.
   *  `false` leaves a boolean flag out. `events` is set by the bridge. */
  flags?: Record<string, string | boolean>;
  /** ${env:NAME} values: put in the child's env only; never logged, persisted or echoed back.
   *  Names must be UPPER_CASE and not process settings (PATH, NODE_*, ELECTRON_*, NARASCREEN_*, …). */
  env?: Record<string, string>;
  /** Working directory (default: dirname(arg) ?? home). Always also pass --out where the command takes one. */
  cwd?: string;
  /** Caller tag for the UI (e.g. "export", "script", "doctor"). */
  tag?: string;
}

export interface CliRunHandle {
  runId: string;
  pid: number;
  argv: string[];
  command: CliCommand;
  startedAt: string;
  tag?: string;
}

/** One stderr line. Non-JSON lines arrive as { type: "log" }. */
export interface CliEventMsg {
  runId: string;
  event: NaraEvent;
}

export interface CliEndMsg {
  runId: string;
  /** The parsed stdout envelope; null when stdout was not an envelope (crash). */
  envelope: Envelope | null;
  /** Raw stdout when the command prints raw output (schema, manual) or crashed. */
  raw?: string;
  /** Last plain-text stderr lines, when there is no envelope (what the crash said). */
  stderrTail?: string[];
  exitCode: number | null;
  signal: string | null;
  /** Stopped by cli.cancel (or by a signal: the CLI's "Interrupted by SIGTERM" envelope). */
  cancelled: boolean;
  durationMs: number;
}

export interface InlineValidateRequest {
  script: unknown;
  /** Directory the script lives in (relative paths resolve against it). */
  dir: string;
  env?: Record<string, string>;
}

export interface InlineIssue {
  path: string;
  message: string;
  hint?: string;
}

export type InlineValidateResult =
  | { ok: true; warnings: string[]; summary: Record<string, unknown> }
  | {
      ok: false;
      error: {
        code: string;
        message: string;
        hint?: string;
        where?: { step?: string; entry?: number; path?: string };
        details?: { issues?: InlineIssue[] } & Record<string, unknown>;
      };
    };

export interface ScriptReadResult {
  text: string;
  /** The parsed JSON; null when the file is not valid JSON (see parseError). */
  json: unknown;
  parseError?: string;
}

export interface ScriptWriteOptions {
  /** The job this script belongs to: the write is refused (JOB_LOCKED) while a run holds it.
   *  Without it the bridge still checks the script's own folder and its own active runs. */
  jobDir?: string;
}

export interface SessionProbe {
  kind: "timeline" | "job" | "none";
  dir: string;
  /** demo-project.json exists */
  hasProject: boolean;
  job?: {
    /** job.json scriptPath when that file exists, else <job>/script.json */
    scriptPath: string;
    producedLangs: string[];
    /** lang → demo-project.<lang>.json path */
    projectFiles: Record<string, string>;
    recorded: boolean;
    /** pid of the CLI run holding the job lock right now (editing and produce must wait). */
    busyPid?: number;
  };
}

export interface TtsPreviewRequest {
  /** Where the clip goes; the file name is the CLI's cache name so `make` reuses it. */
  audioDir: string;
  lang: string;
  voice: string;
  speed: number;
  text: string;
  endpoint?: string;
}

export interface TtsPreviewResult {
  /** <audioDir>/tts_<sha256(lang|voice|speed|text)[:16]>.wav */
  audioPath: string;
  durationSec: number;
  cached: boolean;
}

export interface OpenFileOptions {
  title?: string;
  filters?: { name: string; extensions: string[] }[];
  defaultPath?: string;
}

export interface AudioPeaks {
  /** 0..1 per bucket, relative to the file's loudest bucket (1 = loudest). Empty when the file has no audio. */
  peaks: number[];
  bucketsPerSec: number;
  durationSec: number;
}

export interface ScreenSource {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** data: URL of a small thumbnail, when available */
  thumbnail?: string;
}

export interface VideoProbe {
  durationSec: number;
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
  /** first video stream's codec, e.g. "h264" */
  codec?: string;
}

export interface VideoImportRequest {
  /** The file the user picked (any format ffmpeg reads). */
  src: string;
  /** Session folder: the result is <sessionDir>/recordings/recording.mp4. */
  sessionDir: string;
  /** auto (default): copy an H.264/yuv420p MP4/MOV with even dimensions as-is, re-encode anything else
   *  like the CLI's import (H.264, 30 fps, even dimensions). */
  mode?: "auto" | "copy" | "normalize";
}

export interface VideoImportResult extends VideoProbe {
  recordingPath: string;
  /** true when it was re-encoded, false when copied as-is */
  normalized: boolean;
}

export interface VideoImportProgress {
  sessionDir: string;
  /** 0..1 */
  fraction: number;
}

/** The new preload surface (added next to the existing flat electronAPI methods). */
export interface NaraBridgeAPI {
  cli: {
    run(req: CliRunRequest): Promise<CliRunHandle>;
    call(req: CliRunRequest & { timeoutMs?: number }): Promise<CliEndMsg>;
    cancel(runId: string): Promise<{ ok: boolean }>;
    list(): Promise<CliRunHandle[]>;
    /** Returns an unsubscribe function. */
    onEvent(cb: (m: CliEventMsg) => void): () => void;
    onEnd(cb: (m: CliEndMsg) => void): () => void;
  };
  script: {
    read(path: string): Promise<ScriptReadResult>;
    /** Atomic write (tmp + rename). A string is written verbatim (the JSON editor's text), anything else as
     *  pretty JSON. Rejects with "JOB_LOCKED: …" while a CLI run holds the job. */
    write(path: string, script: unknown, opts?: ScriptWriteOptions): Promise<{ ok: true }>;
    validateInline(req: InlineValidateRequest): Promise<InlineValidateResult>;
  };
  session: {
    probe(dir: string): Promise<SessionProbe>;
  };
  tts: {
    preview(req: TtsPreviewRequest): Promise<TtsPreviewResult>;
  };
  dialog: {
    openFile(opts: OpenFileOptions): Promise<string | null>;
  };
  audio: {
    peaks(path: string, bucketsPerSec?: number): Promise<AudioPeaks>;
  };
  video: {
    /** ffprobe, off the main thread. */
    probe(path: string): Promise<VideoProbe>;
    /** Copy or normalise a picked video into the session in the main process (never through renderer memory). */
    importFile(req: VideoImportRequest): Promise<VideoImportResult>;
    onImportProgress(cb: (p: VideoImportProgress) => void): () => void;
  };
  fsWatch: {
    /** Watch files; cb fires with the changed path (debounced). Returns an unsubscribe function. */
    watch(paths: string[], cb: (path: string) => void): () => void;
  };
  win: {
    setTitle(title: string): Promise<void>;
  };
}

/** The code at the start of a bridge error's message ("JOB_LOCKED: …" → "JOB_LOCKED"). */
export function bridgeErrorCode(err: unknown): string | undefined {
  const msg = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  return /^([A-Z][A-Z0-9_]+):/.exec(msg)?.[1];
}
