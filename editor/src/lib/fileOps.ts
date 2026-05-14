import type { DemoProject } from "../types";

const api = window.electronAPI;

/** Ask user to pick a session directory */
export async function pickSessionDir(): Promise<string | null> {
  return api.openDirectory();
}

/** Load demo-project.json from a session directory */
export async function loadProject(dir: string): Promise<DemoProject> {
  const projectPath = `${dir}/demo-project.json`;
  const raw = await api.readTextFile(projectPath);
  return JSON.parse(raw) as DemoProject;
}

/** Save demo-project.json back to the session directory */
export async function saveProject(dir: string, project: DemoProject): Promise<void> {
  const projectPath = `${dir}/demo-project.json`;
  await api.writeTextFile(projectPath, JSON.stringify(project, null, 2));
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

function sanitizeFolderName(name: string): string {
  return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").trim() || defaultRecordingName();
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

  // Write initial demo-project.json
  const initialProject: DemoProject = {
    title: "Demo",
    baseUrl,
    recordingPath: `${sessionDir}/recordings/recording.mp4`,
    recordingDuration: 0,
    viewport: { width: 1920, height: 1080 },
    output: { width: 1920, height: 1080, fps: 30, format: "mp4" },
    tts: {
      provider: "kokoro-direct",
      kokoroEndpoint: "http://localhost:8880/v1/audio/speech",
      voiceEn: "af_heart",
      voiceHi: "hf_alpha",
      speed: 1,
    },
    actions: [],
  };
  await api.writeTextFile(
    `${sessionDir}/demo-project.json`,
    JSON.stringify(initialProject, null, 2),
  );

  return sessionDir;
}
