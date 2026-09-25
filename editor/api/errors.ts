// ─── errors: the failure half of the CLI contract ────────────────────
//
// Every failure the CLI reports is an AgentError with a stable `code`. External
// agents branch on the code (never on the message text), and the code decides
// the process exit status. Add new codes here AND to the manual's error table.

export type ErrorCode =
  // 1 — the script or job needs fixing (the agent can fix this itself)
  | "SCRIPT_NOT_FOUND"
  | "SCRIPT_INVALID_JSON"
  | "SCRIPT_INVALID"
  | "ENV_VAR_MISSING"
  | "STORAGE_STATE_NOT_FOUND"
  | "NAVIGATION_FAILED"
  | "SELECTOR_NOT_FOUND"
  | "TARGET_NOT_VISIBLE"
  | "WAIT_TIMEOUT"
  | "ACTION_FAILED"
  | "BEAT_NOT_FOUND"
  | "JOB_NOT_FOUND"
  | "JOB_NOT_RECORDED"
  | "JOB_EXISTS"
  | "JOB_LOCKED"
  | "SCRIPT_STRUCTURE_CHANGED"
  | "COMPILE_FAILED"
  | "TTS_FAILED"
  | "SPOTLIGHT_OVERLAP"
  | "VIDEO_NOT_FOUND"
  // 2 — the machine is missing something (run `narascreen doctor`)
  | "TTS_UNAVAILABLE"
  | "FFMPEG_MISSING"
  | "BROWSER_MISSING"
  | "ENVIRONMENT_NOT_READY"
  // 3 — the command line itself was wrong
  | "USAGE"
  // 4 — a bug or an unexpected tool failure
  | "RENDER_FAILED"
  | "RECORDING_FAILED"
  | "INTERNAL";

const EXIT_BY_CODE: Record<ErrorCode, number> = {
  SCRIPT_NOT_FOUND: 1,
  SCRIPT_INVALID_JSON: 1,
  SCRIPT_INVALID: 1,
  ENV_VAR_MISSING: 1,
  STORAGE_STATE_NOT_FOUND: 1,
  NAVIGATION_FAILED: 1,
  SELECTOR_NOT_FOUND: 1,
  TARGET_NOT_VISIBLE: 1,
  WAIT_TIMEOUT: 1,
  ACTION_FAILED: 1,
  BEAT_NOT_FOUND: 1,
  JOB_NOT_FOUND: 1,
  JOB_NOT_RECORDED: 1,
  JOB_EXISTS: 1,
  JOB_LOCKED: 1,
  SCRIPT_STRUCTURE_CHANGED: 1,
  COMPILE_FAILED: 1,
  TTS_FAILED: 1,
  SPOTLIGHT_OVERLAP: 1,
  VIDEO_NOT_FOUND: 1,
  TTS_UNAVAILABLE: 2,
  FFMPEG_MISSING: 2,
  BROWSER_MISSING: 2,
  ENVIRONMENT_NOT_READY: 2,
  USAGE: 3,
  RENDER_FAILED: 4,
  RECORDING_FAILED: 4,
  INTERNAL: 4,
};

export function exitCodeFor(code: ErrorCode): number {
  return EXIT_BY_CODE[code] ?? 4;
}

/** Where in the script a failure happened. `path` is a JSON-path-like string
 *  into the script file, e.g. `steps[2].beat[1]` or `setup[0]`. */
export interface ErrorWhere {
  step?: string;
  entry?: number;
  path?: string;
}

export interface AgentErrorInit {
  hint?: string;
  where?: ErrorWhere;
  details?: Record<string, unknown>;
}

export class AgentError extends Error {
  readonly code: ErrorCode;
  readonly hint?: string;
  readonly where?: ErrorWhere;
  readonly details?: Record<string, unknown>;

  constructor(code: ErrorCode, message: string, init: AgentErrorInit = {}) {
    super(message);
    this.name = "AgentError";
    this.code = code;
    this.hint = init.hint;
    this.where = init.where;
    this.details = init.details;
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      ...(this.hint ? { hint: this.hint } : {}),
      ...(this.where ? { where: this.where } : {}),
      ...(this.details ? { details: this.details } : {}),
    };
  }
}

/** Normalize anything thrown into an AgentError (unknown errors → INTERNAL). */
export function toAgentError(err: unknown): AgentError {
  if (err instanceof AgentError) return err;
  const message = err instanceof Error ? err.message : String(err);
  return new AgentError("INTERNAL", message, {
    hint: "This looks like a NaraScreen bug. Re-run with the same inputs; if it repeats, report the message.",
    details: err instanceof Error && err.stack ? { stack: err.stack.split("\n").slice(0, 8) } : undefined,
  });
}

/** One-line "what it means / what to do" per code — rendered into the docs. */
export const ERROR_HELP: Record<ErrorCode, string> = {
  SCRIPT_NOT_FOUND: "The script path does not exist. Check the path, or create one with `init`.",
  SCRIPT_INVALID_JSON: "The script file is not valid JSON. Fix the syntax at the reported line/column.",
  SCRIPT_INVALID: "The script breaks the schema or a rule. Fix every entry in details.issues, then validate again.",
  ENV_VAR_MISSING: "The script uses ${env:NAME} but NAME is not set. Export it in the environment running NaraScreen.",
  STORAGE_STATE_NOT_FOUND: "A storageState/useSession file is missing. Create it, or log in with `setup` steps instead.",
  NAVIGATION_FAILED: "A page did not load (bad URL, server down, HTTP error). Check baseUrl/path and that the site is running.",
  SELECTOR_NOT_FOUND: "No element matched a selector. Pick one from details.candidates or run `inspect` on that page.",
  TARGET_NOT_VISIBLE: "The element exists but is hidden or zero-size. Open whatever reveals it first (menu, tab, dialog).",
  WAIT_TIMEOUT: "A waitFor element never became visible. The previous step probably did not do what you expected — look at details.screenshot.",
  ACTION_FAILED: "The browser could not perform the action (e.g. option not in a <select>, element disabled). See details.",
  BEAT_NOT_FOUND: "The step id given to --until does not exist in the script.",
  JOB_NOT_FOUND: "The folder is not a NaraScreen job. Record first (record/make), then pass that --out folder.",
  JOB_NOT_RECORDED: "The job has no successful recording yet. Run `record` (or `make`).",
  JOB_EXISTS: "A job already exists in that folder. Use --force to replace it, or another --out.",
  JOB_LOCKED: "Another NaraScreen process is working on this job. Wait for it, or use another --out.",
  SCRIPT_STRUCTURE_CHANGED: "Browser steps changed since the recording. Re-record (record --force / make). Text-only edits don't need this.",
  COMPILE_FAILED: "The script and its recording could not be joined into video edits. Usually fixed by re-recording.",
  TTS_FAILED: "The speech engine rejected a narration (often an unknown voice id). See details, check `voices`.",
  SPOTLIGHT_OVERLAP: "Two spotlights overlap in time. Give the first a shorter duration, or use one spotlight.",
  VIDEO_NOT_FOUND: "There is no produced video for that language yet. Run `produce` first.",
  TTS_UNAVAILABLE: "The speech engine (Kokoro) is not reachable. Start it (see `doctor`), then retry.",
  FFMPEG_MISSING: "ffmpeg/ffprobe not found or missing required filters. Install ffmpeg (see `doctor`).",
  BROWSER_MISSING: "Playwright's Chromium is not installed. Run the fix command from `doctor`.",
  ENVIRONMENT_NOT_READY: "`doctor` found missing requirements. Apply each check's `fix`, then run doctor again.",
  USAGE: "The command line was wrong (unknown command/flag, missing argument). See `help`.",
  RENDER_FAILED: "ffmpeg failed while building the video. details.logPath has the full renderer log.",
  RECORDING_FAILED: "The screen recording could not be assembled. Retry; if it repeats, see details.",
  INTERNAL: "Unexpected NaraScreen bug. Retry once; if it repeats, report the message and details.",
};
