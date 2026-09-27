/** window.electronAPI access for the project store, with fallbacks for a main process that does
 *  not have the namespaced bridge (session / video / tts / fsWatch) yet. */
import type { SessionProbe, VideoProbe } from "../../types/narascreen-ipc";

export const api = () => window.electronAPI;
export const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

type Partial2<T> = { [K in keyof T]?: T[K] };
/** The namespaced members may be missing at runtime (older dist-electron). */
const bridge = () => api() as unknown as Partial2<Pick<Window["electronAPI"], "session" | "video" | "tts" | "fsWatch" | "script" | "win">>;
export const hasBridge = (name: "session" | "video" | "tts" | "fsWatch" | "script" | "win") => !!bridge()[name];

/** Width, height and duration of a video (ffprobe in main, else a <video> element). */
export async function probeVideo(path: string): Promise<Pick<VideoProbe, "width" | "height" | "durationSec"> | null> {
  if (!path) return null;
  const b = bridge();
  if (b.video?.probe) {
    try {
      const r = await b.video.probe(path);
      if (r.width > 0 && r.height > 0) return r;
    } catch { /* fall back to the media element */ }
  }
  if (typeof document === "undefined") return null;
  return new Promise((resolve) => {
    const v = document.createElement("video");
    v.preload = "metadata";
    v.muted = true;
    const done = (r: { width: number; height: number; durationSec: number } | null) => {
      clearTimeout(timer);
      v.removeAttribute("src");
      v.load();
      resolve(r);
    };
    const timer = setTimeout(() => done(null), 8000);
    v.onloadedmetadata = () => done(v.videoWidth > 0 ? { width: v.videoWidth, height: v.videoHeight, durationSec: v.duration } : null);
    v.onerror = () => done(null);
    v.src = api().assetUrl(path);
  });
}

/** What a folder is (session:probe, else the same rules on the flat file API). */
export async function probeSession(dir: string): Promise<SessionProbe> {
  const b = bridge();
  if (b.session?.probe) {
    try {
      return await b.session.probe(dir);
    } catch { /* fall back below */ }
  }
  const a = api();
  const hasProject = await a.exists(`${dir}/demo-project.json`);
  if (!(await a.exists(`${dir}/job.json`))) return { kind: hasProject ? "timeline" : "none", dir, hasProject };
  let scriptPath = `${dir}/script.json`;
  let recorded = false;
  try {
    const job = JSON.parse(await a.readTextFile(`${dir}/job.json`)) as { scriptPath?: string; record?: { status?: string } };
    if (job.scriptPath) scriptPath = job.scriptPath;
    recorded = job.record?.status === "done";
  } catch { /* unreadable job.json: still a job */ }
  const projectFiles: Record<string, string> = {};
  for (const e of await a.readDir(dir)) {
    const m = /^demo-project\.([\w-]+)\.json$/.exec(e.name);
    if (m) projectFiles[m[1]] = `${dir}/${e.name}`;
  }
  return { kind: "job", dir, hasProject, job: { scriptPath, producedLangs: Object.keys(projectFiles), projectFiles, recorded } };
}

/** Watch files; returns an unsubscribe (a no-op when watching is unavailable). */
export function watchFiles(paths: string[], cb: (path: string) => void): () => void {
  const b = bridge();
  try {
    return b.fsWatch?.watch(paths, cb) ?? (() => {});
  } catch {
    return () => {};
  }
}

export async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await api().readTextFile(path));
}

export async function setWindowTitle(title: string): Promise<void> {
  try {
    await bridge().win?.setTitle(title);
  } catch { /* cosmetic */ }
}
