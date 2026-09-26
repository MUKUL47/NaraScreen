// ─── produce-child: one language of a job, in its own process ────────
//
// Languages render in parallel (produce-parallel.ts), but the renderer's ffmpeg
// calls are synchronous: two languages in one process would still take turns.
// So each runs here, in its own Node process. Not a command: the input is a
// JSON file (argv[2]) written by the parent; progress goes to stderr exactly
// like the parent's own (same event mode), and the one line on stdout is
// {"ok":true,"result":ProduceResult} or {"ok":false,"error":<AgentError JSON>}.

import * as fs from "fs";
import { produceLanguage, type ProduceOptions } from "./produce-headless";
import { toAgentError } from "./errors";
import { log, setEventMode, setQuiet } from "./output";
import type { DemoScript } from "./schema";
import type { TraceEntry } from "./types";

export interface ChildInput {
  jobDir: string;
  script: DemoScript;
  trace: TraceEntry[];
  lang: string;
  opts: ProduceOptions;
  events: { mode: "text" | "json"; quiet: boolean };
}

async function main(): Promise<void> {
  const input = JSON.parse(fs.readFileSync(process.argv[2], "utf-8")) as ChildInput;
  setEventMode(input.events.mode);
  setQuiet(input.events.quiet);
  // Asked to stop (the parent was cancelled): leave once the current ffmpeg call returns.
  for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => process.exit(130));
  try {
    const result = await produceLanguage(input.jobDir, input.script, input.trace, input.lang, log, input.opts);
    process.stdout.write(JSON.stringify({ ok: true, result }) + "\n");
  } catch (e) {
    process.stdout.write(JSON.stringify({ ok: false, error: toAgentError(e).toJSON() }) + "\n");
  }
}

main().catch((e) => {
  process.stdout.write(JSON.stringify({ ok: false, error: toAgentError(e).toJSON() }) + "\n");
});
