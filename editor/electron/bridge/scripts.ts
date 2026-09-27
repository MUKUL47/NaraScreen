// ─── bridge/scripts: demo-scripts and session folders ────────────────
//
// Reading/writing the script a job session edits, validating unsaved edits
// in-process (the same validateScript + scriptSummary the CLI runs, no spawn),
// and telling a desktop timeline session from a CLI job folder.

import * as fs from "fs";
import * as path from "path";
import { toAgentError } from "../../api/errors";
import { jobPaths, lockHolder, readJob, type JobState } from "../../api/job";
import { scriptSummary, validateScript } from "../../api/validate";
import type {
  InlineValidateRequest,
  InlineValidateResult,
  ScriptReadResult,
  ScriptWriteOptions,
  SessionProbe,
} from "../../src/types/narascreen-ipc";
import { runsTouching } from "./runs";
import { bridgeError } from "./util";

export async function readScript(file: string): Promise<ScriptReadResult> {
  let text: string;
  try {
    text = await fs.promises.readFile(file, "utf-8");
  } catch (e) {
    throw bridgeError("SCRIPT_NOT_FOUND", `Cannot read ${file}: ${(e as NodeJS.ErrnoException).code ?? String(e)}`);
  }
  try {
    return { text, json: JSON.parse(text) };
  } catch (e) {
    return { text, json: null, parseError: e instanceof Error ? e.message : String(e) };
  }
}

/** Atomic write (tmp + rename), refused while a CLI run holds the script's job. */
export async function writeScript(file: string, script: unknown, opts: ScriptWriteOptions = {}): Promise<{ ok: true }> {
  if (typeof file !== "string" || !path.isAbsolute(file)) throw bridgeError("USAGE", "script.write needs an absolute path");
  assertNotLocked(file, opts.jobDir);
  const text = typeof script === "string" ? script : JSON.stringify(script, null, 2) + "\n";
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now().toString(36)}`;
  try {
    await fs.promises.writeFile(tmp, text, "utf-8");
    await fs.promises.rename(tmp, file);
  } catch (e) {
    await fs.promises.rm(tmp, { force: true });
    throw e;
  }
  return { ok: true };
}

function assertNotLocked(file: string, jobDir?: string): void {
  const dirs = new Set<string>();
  if (jobDir) dirs.add(path.resolve(jobDir));
  const own = path.dirname(path.resolve(file));
  if (fs.existsSync(path.join(own, "job.json"))) dirs.add(own);
  const busy = runsTouching({ scriptPath: file });
  for (const dir of dirs) busy.push(...runsTouching({ jobDir: dir }));
  if (busy.length) {
    throw bridgeError(
      "JOB_LOCKED",
      `A "${busy[0].command}" run (pid ${busy[0].pid}) is using this script or its job`,
      "Wait for it to finish (or cancel it), then save again.",
    );
  }
  for (const dir of dirs) {
    const pid = lockHolder(dir);
    if (pid) {
      throw bridgeError("JOB_LOCKED", `Job ${dir} is in use by another NaraScreen process (pid ${pid})`, "Wait for it to finish, then save again.");
    }
  }
}

/** validateScript + scriptSummary on an unsaved script (never throws). */
export function validateInline(req: InlineValidateRequest): InlineValidateResult {
  try {
    const env = { ...process.env, ...(req.env ?? {}) };
    const { script, warnings } = validateScript(req.script, { dir: req.dir, env });
    return { ok: true, warnings, summary: scriptSummary(script) as unknown as Record<string, unknown> };
  } catch (e) {
    const err = toAgentError(e).toJSON();
    return { ok: false, error: err as Extract<InlineValidateResult, { ok: false }>["error"] };
  }
}

/** What kind of folder this is: a CLI job (job.json), a desktop timeline session, or neither. */
export async function probeSession(dir: string): Promise<SessionProbe> {
  const root = path.resolve(dir);
  const has = (name: string) => fs.existsSync(path.join(root, name));
  const hasProject = has("demo-project.json");
  if (!has("job.json")) return { kind: hasProject ? "timeline" : "none", dir: root, hasProject };

  let job: JobState | undefined;
  try {
    job = readJob(root);
  } catch {
    job = undefined; // damaged job.json: still a job folder, with what the files say
  }
  const p = jobPaths(root);
  const scriptPath = job?.scriptPath && fs.existsSync(job.scriptPath) ? job.scriptPath : p.script;
  const projectFiles: Record<string, string> = {};
  for (const name of await fs.promises.readdir(root)) {
    const m = /^demo-project\.([\w-]+)\.json$/.exec(name);
    if (m) projectFiles[m[1]] = path.join(root, name);
  }
  const producedLangs = Object.entries(job?.produce ?? {})
    .filter(([, s]) => s.status === "done")
    .map(([lang]) => lang);
  const busyPid = lockHolder(root);
  return {
    kind: "job",
    dir: root,
    hasProject,
    job: {
      scriptPath,
      producedLangs,
      projectFiles,
      recorded: job?.record?.status === "done" && fs.existsSync(p.recording),
      ...(busyPid ? { busyPid } : {}),
    },
  };
}
