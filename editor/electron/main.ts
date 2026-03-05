import { app, BrowserWindow, ipcMain, dialog, shell } from "electron";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import {
  getScreenSources,
  startScreenRecording,
  stopScreenRecording,
} from "./capture";
import { generateTTSViaKokoro, generateTTSViaCurl, KOKORO_PYTHON } from "./tts";
import { probeDuration, generateFilmstrip } from "./ffmpeg";
import { produceTimelineVideo } from "./produce";

let mainWindow: BrowserWindow | null = null;

// ---- App Cache (persists across sessions) ----
const cachePath = path.join(app.getPath("userData"), "narascreen-cache.json");

function readCache(): Record<string, unknown> {
  try {
    return JSON.parse(fs.readFileSync(cachePath, "utf-8"));
  } catch {
    return {};
  }
}

function writeCache(data: Record<string, unknown>) {
  fs.writeFileSync(cachePath, JSON.stringify(data, null, 2), "utf-8");
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    title: "NaraScreen",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,
    },
  });

  mainWindow.setMenuBarVisibility(false);

  if (process.env.VITE_DEV_SERVER_URL || process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL((process.env.VITE_DEV_SERVER_URL || process.env.ELECTRON_RENDERER_URL)!);
  } else {
    mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// Disable overlay scrollbars so ::-webkit-scrollbar CSS works
app.commandLine.appendSwitch("disable-features", "OverlayScrollbar");

app.whenReady().then(createMainWindow);

app.on("window-all-closed", () => {
  app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow();
  }
});

// ---- File System IPC Handlers ----

ipcMain.handle("fs:readTextFile", async (_event, filePath: string) => {
  return fs.readFileSync(filePath, "utf-8");
});

ipcMain.handle(
  "fs:writeTextFile",
  async (_event, filePath: string, data: string) => {
    fs.writeFileSync(filePath, data, "utf-8");
  },
);

ipcMain.handle("fs:readDir", async (_event, dirPath: string) => {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  return entries.map((e) => ({ name: e.name, isDirectory: e.isDirectory() }));
});

ipcMain.handle("fs:exists", async (_event, filePath: string) => {
  return fs.existsSync(filePath);
});

ipcMain.handle(
  "fs:mkdir",
  async (_event, dirPath: string, options?: { recursive?: boolean }) => {
    fs.mkdirSync(dirPath, { recursive: options?.recursive ?? true });
  },
);

ipcMain.handle(
  "fs:writeBinaryFile",
  async (_event, filePath: string, data: Buffer) => {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, data);
  },
);

ipcMain.handle("fs:homeDir", async () => {
  return os.homedir();
});

// ---- Dialog IPC Handlers ----

ipcMain.handle("dialog:openDirectory", async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openDirectory"],
    title: "Open Demo Session",
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle("dialog:openVideoFile", async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openFile"],
    title: "Import Video",
    filters: [{ name: "Video", extensions: ["mp4", "mkv", "webm", "avi", "mov"] }],
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle("dialog:pickSaveDirectory", async (_event, defaultPath?: string) => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openDirectory", "createDirectory"],
    title: "Choose where to save your recording",
    defaultPath: defaultPath || os.homedir(),
    buttonLabel: "Save Here",
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle(
  "dialog:saveFile",
  async (
    _event,
    opts: { title?: string; defaultPath?: string; filters?: Electron.FileFilter[] },
  ) => {
    if (!mainWindow) return null;
    const result = await dialog.showSaveDialog(mainWindow, {
      title: opts.title,
      defaultPath: opts.defaultPath,
      filters: opts.filters,
    });
    return result.canceled ? null : result.filePath;
  },
);

// ---- Screen Recording IPC Handlers ----

ipcMain.handle("screen:getSources", async () => {
  return getScreenSources();
});

ipcMain.handle("screen:startRecording", async (_event, sessionDir: string, opts?: { displayId?: string; x?: number; y?: number; width?: number; height?: number }) => {
  startScreenRecording(sessionDir, mainWindow, opts);
});

ipcMain.handle("screen:stopRecording", async () => {
  return stopScreenRecording();
});

// ---- Video IPC Handlers ----

ipcMain.handle("video:generateFilmstrip", async (_event, sessionDir: string) => {
  return generateFilmstrip(sessionDir);
});

ipcMain.handle("video:getDuration", async (_event, videoPath: string) => {
  const d = probeDuration(videoPath);
  if (d === 0) throw new Error("ffprobe failed");
  return d;
});

ipcMain.handle("video:produce", async (_event, sessionDir: string, version?: string) => {
  return produceTimelineVideo(sessionDir, mainWindow, version);
});

ipcMain.handle("video:preview", async (_event, sessionDir: string) => {
  // Produce to a fixed "preview" name, then open with system player
  const finalPath = await produceTimelineVideo(sessionDir, mainWindow, "preview");
  shell.openPath(finalPath);
  return finalPath;
});

// ---- TTS IPC Handlers ----

ipcMain.handle(
  "tts:generate",
  async (
    _event,
    sessionDir: string,
    actionId: string,
    text: string,
    lang: string,
    voiceOverride?: string,
    langCodeOverride?: string,
  ) => {
    const projectPath = path.join(sessionDir, "demo-project.json");
    const project = JSON.parse(fs.readFileSync(projectPath, "utf-8"));

    const voice =
      voiceOverride ||
      (lang === "hi" ? project.tts?.voiceHi || "hf_alpha" : project.tts?.voiceEn || "af_heart");
    const speed = project.tts?.speed || 1;
    const langCode = langCodeOverride || (lang === "hi" ? "h" : "a");

    const audioDir = path.join(sessionDir, "audio");
    fs.mkdirSync(audioDir, { recursive: true });

    const audioPath = path.join(audioDir, `${actionId}_${lang}.wav`);

    console.log(`[tts] Generating ${lang} audio for ${actionId}: "${text.slice(0, 50)}..." voice=${voice} speed=${speed}`);

    const useDirect = fs.existsSync(KOKORO_PYTHON);

    if (useDirect) {
      console.log("[tts] Using direct Kokoro Python");
      const result = generateTTSViaKokoro(text, voice, speed, langCode, audioPath);
      console.log(`[tts] Python exit: ${result.status}, stderr: ${result.stderr.slice(0, 300)}`);
      if (result.status !== 0) {
        throw new Error(`Kokoro TTS failed: ${result.stderr.slice(0, 500)}`);
      }
    } else {
      const kokoroBase = process.env.KOKORO_URL || "http://localhost:8880";
      const ttsEndpoint =
        project.tts?.kokoroEndpoint || `${kokoroBase}/v1/audio/speech`;
      console.log(`[tts] Using HTTP API: ${ttsEndpoint}`);
      const result = generateTTSViaCurl(text, voice, speed, ttsEndpoint, audioPath);
      console.log(`[tts] curl exit: ${result.status}`);
      if (result.status !== null && result.status !== 0) {
        throw new Error(`TTS HTTP failed (code ${result.status}). Is Kokoro running at ${ttsEndpoint}?`);
      }
    }

    if (!fs.existsSync(audioPath) || fs.statSync(audioPath).size < 100) {
      throw new Error("TTS returned empty or invalid audio");
    }

    const duration = probeDuration(audioPath);
    console.log(`[tts] Audio saved: ${audioPath} (${(fs.statSync(audioPath).size / 1024).toFixed(1)} KB, ${duration.toFixed(1)}s)`);

    return { audioPath, duration };
  },
);

// ---- Version IPC Handlers ----

ipcMain.handle("versions:list", async (_event, sessionDir: string) => {
  const videoDir = path.join(sessionDir, "video");
  if (!fs.existsSync(videoDir)) return [];

  const files = fs.readdirSync(videoDir).filter((f) => f.match(/^final.*\.mp4$/));
  return files
    .map((f) => {
      const stat = fs.statSync(path.join(videoDir, f));
      return {
        name: f,
        path: path.join(videoDir, f),
        size: stat.size,
        created: stat.mtime.toISOString(),
      };
    })
    .sort((a, b) => b.created.localeCompare(a.created));
});

ipcMain.handle("versions:open", async (_event, filePath: string) => {
  shell.openPath(filePath);
});

ipcMain.handle("versions:showInFolder", async (_event, filePath: string) => {
  shell.showItemInFolder(filePath);
});

// ---- Cache IPC Handlers ----

ipcMain.handle("cache:get", async (_event, key: string) => {
  const cache = readCache();
  return cache[key] ?? null;
});

ipcMain.handle("cache:set", async (_event, key: string, value: unknown) => {
  const cache = readCache();
  cache[key] = value;
  writeCache(cache);
});
