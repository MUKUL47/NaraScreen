import type { DemoProject } from "../types";
import { migrateProject, newProject } from "./migrateProject";

const api = window.electronAPI;

/** Ask user to pick a session directory */
export async function pickSessionDir(): Promise<string | null> {
  return api.openDirectory();
}

/** Load demo-project.json from a session directory (migrated to v2; the store's openSession
 *  also probes the recording's real size). */
export async function loadProject(dir: string): Promise<DemoProject> {
  const projectPath = `${dir}/demo-project.json`;
  const raw = await api.readTextFile(projectPath);
  return migrateProject(JSON.parse(raw));
}

/** Save demo-project.json back to the session directory (always as projectVersion 2). */
export async function saveProject(dir: string, project: DemoProject): Promise<void> {
  const projectPath = `${dir}/demo-project.json`;
  await api.writeTextFile(projectPath, JSON.stringify({ ...project, projectVersion: 2 }, null, 2));
}

/** Convert a local file path to a URL usable by <img>/<video> */
export function assetUrl(filePath: string): string {
  return api.assetUrl(filePath);
}

/** List thumbnail JPG files in the thumbnails directory (for filmstrip) */
export async function loadFilmstrip(sessionDir: string): Promise<string[]> {
  const thumbDir = `${sessionDir}/thumbnails`;
  const dirExists = await api.exists(thumbDir);
  if (!dirExists) return [];

  const entries = await api.readDir(thumbDir);
  return entries
    .filter((e) => e.name?.endsWith(".jpg"))
    .map((e) => `${thumbDir}/${e.name}`)
    .sort();
}

/** Default timestamp string used when the user hasn't named their recording */
export function defaultRecordingName(): string {
  const now = new Date();
  return now.toISOString().replace(/T/, "_").replace(/:/g, "-").slice(0, 19);
}

/** Default parent directory for new recordings (~/NaraScreen). Created if missing. */
export async function defaultRecordingParentDir(): Promise<string> {
  const home = (await api.homeDir()).replace(/\/?$/, "/");
  const defaultDir = `${home}NaraScreen`;
  await api.mkdir(defaultDir, { recursive: true });
  return defaultDir;
}

/** Characters no OS allows in a folder name (plus control characters). */
function sanitizeFolderName(name: string): string {
  const safe = Array.from(name, (ch) => (ch.charCodeAt(0) < 32 || '<>:"/\\|?*'.includes(ch) ? "_" : ch)).join("");
  return safe.trim() || defaultRecordingName();
}

/**
 * Create a new session directory.
 * If `parentDir` is omitted, prompts the user via the system save-directory dialog.
 * If `name` is omitted, falls back to a timestamp.
 */
export async function createSession(
  baseUrl: string,
  options?: { parentDir?: string; name?: string },
): Promise<string | null> {
  let parentDir = options?.parentDir;
  if (!parentDir) {
    const defaultDir = await defaultRecordingParentDir();
    const chosen = await api.pickSaveDirectory(defaultDir);
    if (!chosen) return null; // user cancelled
    parentDir = chosen;
  }

  const folderName = sanitizeFolderName(options?.name ?? defaultRecordingName());
  const sessionDir = `${parentDir}/${folderName}`;

  await api.mkdir(sessionDir, { recursive: true });
  await api.mkdir(`${sessionDir}/recordings`, { recursive: true });
  await api.mkdir(`${sessionDir}/thumbnails`, { recursive: true });

  // Initial demo-project.json (the real size is probed when the recording stops).
  const initialProject = newProject({ title: options?.name?.trim() || "Demo", baseUrl, recordingPath: `${sessionDir}/recordings/recording.mp4` });
  await api.writeTextFile(`${sessionDir}/demo-project.json`, JSON.stringify(initialProject, null, 2));

  return sessionDir;
}
