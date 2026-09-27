import { app, BrowserWindow, ipcMain, dialog, shell } from "electron";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { Worker } from "worker_threads";
import {
  getScreenSources,
  startScreenRecording,
  stopScreenRecording,
} from "./capture";
import { probeDuration, generateFilmstrip } from "./ffmpeg";
import { registerCliBridge } from "./cli-bridge";

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
    minWidth: 1280,
    minHeight: 720,
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

// The CLI bridge (cli:*, script:*, session:*, tts:*, audio:*, video:importFile, …).
registerCliBridge();

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

ipcMain.handle("fs:trashItem", async (_event, targetPath: string) => {
  await shell.trashItem(targetPath);
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

/** Run produceTimelineVideo in a worker thread to avoid blocking the main process */
let activeProduceWorker: Worker | null = null;

function runProduceWorker(
  sessionDir: string,
  version?: string,
  selectedActionIds?: string[],
  resolution?: { width: number; height: number },
  crf?: number,
  trim?: { start: number; end: number },
): Promise<string> {
  return new Promise((resolve, reject) => {
    const workerPath = path.join(__dirname, "produce-worker.js");
    const worker = new Worker(workerPath, {
      workerData: { sessionDir, version, selectedActionIds, resolution, crf, trim },
    });
    activeProduceWorker = worker;

    worker.on("message", (msg: { type: string; msg?: string; finalPath?: string; message?: string }) => {
      if (msg.type === "progress") {
        mainWindow?.webContents.send("produce-progress", msg.msg);
      } else if (msg.type === "done") {
        activeProduceWorker = null;
        resolve(msg.finalPath!);
      } else if (msg.type === "error") {
        activeProduceWorker = null;
        reject(new Error(msg.message || "Production failed"));
      }
    });

    worker.on("error", (err) => { activeProduceWorker = null; reject(err); });
    worker.on("exit", (code) => {
      activeProduceWorker = null;
      if (code !== 0) reject(new Error(`Worker exited with code ${code}`));
    });
  });
}

ipcMain.handle("video:produce", async (
  _event,
  sessionDir: string,
  version?: string,
  selectedActionIds?: string[],
  resolution?: { width: number; height: number },
  crf?: number,
  trim?: { start: number; end: number },
) => {
  return runProduceWorker(sessionDir, version, selectedActionIds, resolution, crf, trim);
});

ipcMain.handle("video:cancelProduce", async () => {
  if (activeProduceWorker) {
    await activeProduceWorker.terminate();
    activeProduceWorker = null;
  }
});

// ---- TTS IPC Handlers ----
// tts:generate (legacy, now async) and tts:preview live in cli-bridge.ts.

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
