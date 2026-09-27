// ─── output: envelope + events, shared by the CLI and the HTTP server ─
//
// Contract with external agents:
//   stdout → exactly ONE JSON object (the envelope) when the command finishes.
//   stderr → progress events. Text lines prefixed "[narascreen]" by default, or
//            one JSON object per line with `--events json` (what `serve` uses).
// Exceptions: `manual` prints Markdown and `schema` prints the raw JSON Schema.

import { AgentError, exitCodeFor, toAgentError } from "./errors";

import type { Envelope, NaraEvent, Stage } from "./protocol";
export type { Envelope, EnvelopeError, NaraEvent, Stage } from "./protocol";

export type Log = (msg: string) => void;

let quiet = false;
let mode: "text" | "json" = "text";
let currentStage: Stage | undefined;

export function setQuiet(q: boolean) {
  quiet = q;
}
/** The current progress settings, for a child process that should report the same way. */
export function eventSettings(): { mode: "text" | "json"; quiet: boolean } {
  return { mode, quiet };
}
export function setEventMode(m: "text" | "json") {
  mode = m;
}

export function emitEvent(ev: Omit<NaraEvent, "ts" | "stage"> & { stage?: Stage }) {
  const full: NaraEvent = { ts: new Date().toISOString(), stage: ev.stage ?? currentStage, ...ev };
  if (mode === "json") {
    process.stderr.write(JSON.stringify(full) + "\n");
    return;
  }
  if (quiet) return;
  const prefix = full.type === "stage" ? "▶ " : full.type === "warning" ? "⚠ " : full.type === "step" ? "• " : "  ";
  for (const line of full.message.split("\n")) {
    if (line.trim()) process.stderr.write(`[narascreen] ${prefix}${line}\n`);
  }
}

/** Detail line (engine modules take this as their `log` callback). */
export const log: Log = (msg: string) => emitEvent({ type: "log", message: msg });

/** A pipeline phase begins; later log lines are tagged with it. */
export function stage(s: Stage, message: string, data?: Record<string, unknown>) {
  currentStage = s;
  emitEvent({ type: "stage", stage: s, message, data });
}

/** A script step (beat) begins — lets watchers show "step 3/12: open-settings". */
export function step(message: string, data?: Record<string, unknown>) {
  emitEvent({ type: "step", message, data });
}

export function warn(message: string, data?: Record<string, unknown>) {
  emitEvent({ type: "warning", message, data });
}

export function success(
  command: string,
  result: unknown,
  opts: { warnings?: string[]; next?: string[] } = {},
): Envelope {
  return { ok: true, command, result, warnings: opts.warnings ?? [], next: opts.next ?? [] };
}

export function failure(
  command: string,
  err: unknown,
  opts: { warnings?: string[]; next?: string[] } = {},
): Envelope {
  const e = toAgentError(err);
  return { ok: false, command, error: e.toJSON(), warnings: opts.warnings ?? [], next: opts.next ?? [] };
}

/** Print the envelope to stdout and return the process exit code. */
export function emit(env: Envelope): number {
  process.stdout.write(JSON.stringify(env, null, 2) + "\n");
  if (env.ok) return 0;
  return exitCodeFor((env.error?.code ?? "INTERNAL") as AgentError["code"]);
}
