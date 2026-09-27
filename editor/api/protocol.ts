// ─── protocol: the CLI's wire types, importable from anywhere ─────────
//
// Pure types (no Node APIs), so the desktop renderer can share them with the
// CLI and the HTTP server. `output.ts` re-exports these.

import type { ErrorCode, ErrorWhere } from "./errors";

/** The error half of an envelope (AgentError.toJSON()). */
export interface EnvelopeError {
  code: ErrorCode;
  message: string;
  hint?: string;
  where?: ErrorWhere;
  details?: Record<string, unknown>;
}

export interface Envelope {
  ok: boolean;
  command: string;
  result?: unknown;
  error?: EnvelopeError;
  /** Non-fatal problems worth fixing (the command still succeeded). */
  warnings: string[];
  /** Suggested next commands, ready to run. */
  next: string[];
}

/** Pipeline phases, in the order a `make` run goes through them. */
export type Stage =
  | "doctor"
  | "validate"
  | "inspect"
  | "setup"
  | "record"
  | "tts"
  | "compile"
  | "render"
  | "preview";

export interface NaraEvent {
  /** ISO timestamp. */
  ts: string;
  /** stage = a phase started · step = a script step started · log = detail line · warning */
  type: "stage" | "step" | "log" | "warning";
  stage?: Stage;
  message: string;
  data?: Record<string, unknown>;
}
