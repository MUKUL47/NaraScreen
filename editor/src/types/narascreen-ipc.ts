// ─── narascreen-ipc: the desktop ↔ main-process contract for the CLI bridge ──
//
// The desktop runs every heavy operation (validate, check, make, produce, doctor…)
// through the same CLI that agents use, as a child process with `--events json`.
// These types are shared by electron/preload.ts, electron/main.ts and the renderer.

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
  /** Flag names exactly as api/commands.ts FlagDoc.name, no dashes, e.g. { out, lang: "en,hi", resolution, quality, force: true }. */
  flags?: Record<string, string | boolean>;
  /** ${env:NAME} values: put in the child's env only; never logged, persisted or echoed back. */
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
  exitCode: number | null;
  signal: string | null;
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

export interface SessionProbe {
  kind: "timeline" | "job" | "none";
  dir: string;
  /** demo-project.json exists */
  hasProject: boolean;
  job?: {
    scriptPath: string;
    producedLangs: string[];
    /** lang → demo-project.<lang>.json path */
    projectFiles: Record<string, string>;
    recorded: boolean;
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
  /** Normalised 0..1 peak per bucket. */
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
    read(path: string): Promise<{ text: string; json: unknown }>;
    /** Atomic write (tmp + rename). Rejects with code JOB_LOCKED while a CLI run holds the job. */
    write(path: string, script: unknown): Promise<{ ok: true }>;
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
  fsWatch: {
    /** Watch files; cb fires with the changed path. Returns an unsubscribe function. */
    watch(paths: string[], cb: (path: string) => void): () => void;
  };
  win: {
    setTitle(title: string): Promise<void>;
  };
}
