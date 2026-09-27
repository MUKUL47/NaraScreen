/** Export a timeline session through the CLI: convert the project to a video-source script,
 *  write it next to the session, and describe the `narascreen make` run (SPEC §0.3).
 *
 *  Layout (the session folder itself is never `--out`: the import would overwrite its own source):
 *    <session>/project.demo-script.json   the script (see requests/bridge.md: it moves into render/
 *                                          once `make` accepts it there)
 *    <session>/render/                     the job `make` writes: video/final_<lang>.mp4,
 *                                          preview/<lang>/contact.jpg, audio/tts_<hash>.wav, logs/ …
 *  TTS previews are written to <session>/render/audio/ under the CLI's cache names, so `make`
 *  reuses them instead of synthesizing twice. */
import type { DemoScript, Quality, ResolutionName } from "../../api/schema";
import type { CliRunRequest } from "../types/narascreen-ipc";
import type { DemoProject } from "../types";
import { projectToScript, type ConvertResult } from "./projectToScript";

const trimSlash = (p: string) => p.replace(/[\\/]+$/, "");

/** Every path an export touches, from the session folder. */
export function renderPaths(sessionDir: string) {
  const s = trimSlash(sessionDir);
  const renderDir = `${s}/render`;
  return {
    renderDir,
    scriptPath: `${s}/project.demo-script.json`,
    audioDir: `${renderDir}/audio`,
    jobFile: `${renderDir}/job.json`,
    videoPath: (lang: string) => `${renderDir}/video/final_${lang}.mp4`,
    previewDir: (lang: string) => `${renderDir}/preview/${lang}`,
    contactSheet: (lang: string) => `${renderDir}/preview/${lang}/contact.jpg`,
    logPath: (lang: string) => `${renderDir}/logs/produce-${lang}.log`,
    /** Versions made by the old in-process renderer. */
    legacyVideoDir: `${s}/video`,
  };
}

export interface ExportOptions {
  langs: string[];
  resolution?: ResolutionName;
  quality?: Quality;
  /** Effects left out of this export. */
  disabledIds?: string[];
  /** Keep only this part of the recording. */
  trim?: { start: number; end: number } | null;
  /** Re-import the recording even if `make` thinks it is unchanged. */
  force?: boolean;
}

export interface ExportPlan extends ConvertResult {
  scriptPath: string;
  outDir: string;
  script: DemoScript;
  /** Hand to useRunsStore.start (or window.electronAPI.cli.run). */
  request: CliRunRequest;
}

/** Plan an export (pure): the script, where it goes, and the CLI run that renders it. */
export function planExport(project: DemoProject, sessionDir: string, opts: ExportOptions): ExportPlan {
  const paths = renderPaths(sessionDir);
  const conv = projectToScript(project, sessionDir, {
    langs: opts.langs,
    resolution: opts.resolution,
    quality: opts.quality,
    disabledIds: opts.disabledIds,
    trim: opts.trim,
  });
  const langs = conv.script.languages ?? ["en"];
  const flags: Record<string, string | boolean> = { out: paths.renderDir, lang: langs.join(",") };
  if (conv.script.output?.resolution) flags.resolution = conv.script.output.resolution;
  if (conv.script.output?.quality) flags.quality = conv.script.output.quality;
  if (opts.force) flags.force = true;
  return {
    ...conv,
    scriptPath: paths.scriptPath,
    outDir: paths.renderDir,
    request: { command: "make", arg: paths.scriptPath, flags, cwd: trimSlash(sessionDir), tag: "export" },
  };
}

/** Write the planned script (atomic via script:write when the bridge has it). */
export async function writeExportScript(plan: Pick<ExportPlan, "scriptPath" | "script">): Promise<void> {
  const api = window.electronAPI as typeof window.electronAPI & { script?: { write(p: string, s: unknown): Promise<unknown> } };
  if (api.script?.write) {
    await api.script.write(plan.scriptPath, plan.script);
    return;
  }
  await api.writeTextFile(plan.scriptPath, `${JSON.stringify(plan.script, null, 2)}\n`);
}
