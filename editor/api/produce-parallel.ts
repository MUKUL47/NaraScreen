// ─── produce-parallel: several languages at once ─────────────────────
//
// The renderer's ffmpeg calls are synchronous, so each language renders in its
// own process (produce-child.ts). Up to NARASCREEN_PARALLEL_LANGS (default 2)
// run at a time; 1 renders one after another, in this process. Each child runs
// in its own process group so a cancel stops its ffmpeg too, not only Node.

import { spawn, type ChildProcess } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { pathToFileURL } from "url";
import { AgentError } from "./errors";
import { eventSettings } from "./output";
import type { ChildInput } from "./produce-child";
import type { ProduceOptions, ProduceResult } from "./produce-headless";
import type { DemoScript } from "./schema";
import type { TraceEntry } from "./types";

const children = new Set<ChildProcess>();
const POSIX = process.platform !== "win32";

/** How many languages render at the same time. */
export function parallelLanguages(): number {
  const n = Number(process.env.NARASCREEN_PARALLEL_LANGS ?? 2);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 2;
}

/** Stop every language still rendering (and its ffmpeg). */
export function stopRenderChildren(sig: NodeJS.Signals = "SIGTERM"): void {
  for (const c of children) {
    try {
      if (POSIX && c.pid) process.kill(-c.pid, sig);
      else c.kill(sig);
    } catch {
      // already gone
    }
  }
}
// If this process ends while a language is still rendering, end that too.
process.on("exit", () => stopRenderChildren("SIGKILL"));

/** produceLanguage, run in a child process. Rejects with the child's AgentError. */
export function produceLanguageInChild(
  jobDir: string,
  script: DemoScript,
  trace: TraceEntry[],
  lang: string,
  opts: ProduceOptions,
): Promise<ProduceResult> {
  const entry = childEntry();
  const inputFile = path.join(jobDir, `.produce-${lang}-${process.pid}.json`);
  const input: ChildInput = { jobDir, script, trace, lang, opts, events: eventSettings() };
  fs.writeFileSync(inputFile, JSON.stringify(input));
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [...entry.args, inputFile], {
      env: { ...process.env, ...entry.env },
      stdio: ["ignore", "pipe", "inherit"],
      detached: POSIX,
      windowsHide: true,
    });
    children.add(child);
    let out = "";
    child.stdout!.on("data", (d) => (out += d));
    child.on("error", (e) => {
      children.delete(child);
      fs.rmSync(inputFile, { force: true });
      reject(new AgentError("INTERNAL", `Could not start the renderer for [${lang}]: ${e.message}`));
    });
    child.on("close", (code, signal) => {
      children.delete(child);
      fs.rmSync(inputFile, { force: true });
      const line = out.trim().split("\n").pop() ?? "";
      let msg: { ok: boolean; result?: ProduceResult; error?: { code: AgentError["code"]; message: string; hint?: string; where?: AgentError["where"]; details?: Record<string, unknown> } } | undefined;
      try {
        msg = JSON.parse(line);
      } catch {
        msg = undefined;
      }
      if (msg?.ok && msg.result) return resolve(msg.result);
      if (msg?.error) {
        const e = msg.error;
        return reject(new AgentError(e.code, e.message, { hint: e.hint, where: e.where, details: e.details }));
      }
      reject(new AgentError("INTERNAL", `The renderer for [${lang}] stopped without a result (${signal ?? `exit ${code}`})`, {
        hint: "Re-run the command. Set NARASCREEN_PARALLEL_LANGS=1 to render languages one after another.",
      }));
    });
  });
}

/** How to start produce-child: the bundled produce-child.cjs next to this code
 *  (dist-cli/, in the desktop app), else the .ts source through tsx's loader. */
function childEntry(): { args: string[]; env: NodeJS.ProcessEnv } {
  const bundled = path.join(__dirname, "produce-child.cjs");
  if (fs.existsSync(bundled)) return { args: [bundled], env: {} };
  const editorDir = path.resolve(__dirname, "..");
  const loader = pathToFileURL(path.join(editorDir, "node_modules", "tsx", "dist", "loader.mjs")).href;
  return {
    args: ["--import", loader, path.join(__dirname, "produce-child.ts")],
    env: { TSX_TSCONFIG_PATH: path.join(editorDir, "api", "tsconfig.json") },
  };
}

/** Run `fn` over `items`, at most `limit` at a time; results in input order. */
export async function runLimited<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      try {
        results[i] = { status: "fulfilled", value: await fn(items[i]) };
      } catch (e) {
        results[i] = { status: "rejected", reason: e };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
