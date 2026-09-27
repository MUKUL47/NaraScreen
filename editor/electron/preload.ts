import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type {
  CliEndMsg,
  CliEventMsg,
  CliRunRequest,
  InlineValidateRequest,
  NaraBridgeAPI,
  OpenFileOptions,
  ScriptWriteOptions,
  TtsPreviewRequest,
  VideoImportProgress,
  VideoImportRequest,
} from "../src/types/narascreen-ipc";

/**
 * ipcRenderer.invoke, with Electron's "Error invoking remote method '<ch>': Error: "
 * prefix removed so the renderer sees the bridge's own "CODE: message".
 */
function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  return ipcRenderer.invoke(channel, ...args).catch((e: unknown) => {
    const raw = e instanceof Error ? e.message : String(e);
    throw new Error(raw.replace(/^Error invoking remote method '[^']*': /, "").replace(/^(?:Error: )+/, ""));
  }) as Promise<T>;
}

/** Listen to a main → renderer channel; returns the unsubscribe function. */
function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const handler = (_e: IpcRendererEvent, payload: T) => cb(payload);
  ipcRenderer.on(channel, handler);
  return () => {
    ipcRenderer.removeListener(channel, handler);
  };
}

let watchSeq = 0;

const bridge: NaraBridgeAPI = {
  cli: {
    run: (req: CliRunRequest) => invoke("cli:run", req),
    call: (req: CliRunRequest & { timeoutMs?: number }) => invoke("cli:call", req),
    cancel: (runId: string) => invoke("cli:cancel", runId),
    list: () => invoke("cli:list"),
    onEvent: (cb: (m: CliEventMsg) => void) => subscribe("cli:event", cb),
    onEnd: (cb: (m: CliEndMsg) => void) => subscribe("cli:end", cb),
  },
  script: {
    read: (p: string) => invoke("script:read", p),
    write: (p: string, script: unknown, opts?: ScriptWriteOptions) => invoke("script:write", p, script, opts),
    validateInline: (req: InlineValidateRequest) => invoke("script:validateInline", req),
  },
  session: {
    probe: (dir: string) => invoke("session:probe", dir),
  },
  tts: {
    preview: (req: TtsPreviewRequest) => invoke("tts:preview", req),
  },
  dialog: {
    openFile: (opts: OpenFileOptions) => invoke("dialog:openFile", opts),
  },
  audio: {
    peaks: (p: string, bucketsPerSec?: number) => invoke("audio:peaks", p, bucketsPerSec),
  },
  video: {
    probe: (p: string) => invoke("video:probe", p),
    importFile: (req: VideoImportRequest) => invoke("video:importFile", req),
    onImportProgress: (cb: (p: VideoImportProgress) => void) => subscribe("video:importProgress", cb),
  },
  fsWatch: {
    watch: (paths: string[], cb: (path: string) => void) => {
      const watchId = `w${++watchSeq}_${Date.now().toString(36)}`;
      const off = subscribe<{ watchId: string; path: string }>("fs:changed", (m) => {
        if (m.watchId === watchId) cb(m.path);
      });
      void ipcRenderer.invoke("fs:watch", { watchId, paths }).catch(() => {});
      return () => {
        off();
        void ipcRenderer.invoke("fs:unwatch", { watchId }).catch(() => {});
      };
    },
  },
  win: {
    setTitle: (title: string) => invoke("win:setTitle", title),
  },
};

contextBridge.exposeInMainWorld("electronAPI", {
  // File operations
  readTextFile: (filePath: string) =>
    ipcRenderer.invoke("fs:readTextFile", filePath),
  writeTextFile: (filePath: string, data: string) =>
    ipcRenderer.invoke("fs:writeTextFile", filePath, data),
  readDir: (dirPath: string) =>
    ipcRenderer.invoke("fs:readDir", dirPath),
  exists: (filePath: string) =>
    ipcRenderer.invoke("fs:exists", filePath),
  mkdir: (dirPath: string, options?: { recursive?: boolean }) =>
    ipcRenderer.invoke("fs:mkdir", dirPath, options),
  homeDir: () => ipcRenderer.invoke("fs:homeDir"),
  trashItem: (targetPath: string) =>
    ipcRenderer.invoke("fs:trashItem", targetPath),

  // Dialog
  openDirectory: () => ipcRenderer.invoke("dialog:openDirectory"),
  openVideoFile: () => ipcRenderer.invoke("dialog:openVideoFile"),
  pickSaveDirectory: (defaultPath?: string) => ipcRenderer.invoke("dialog:pickSaveDirectory", defaultPath),
  saveFile: (opts: {
    title?: string;
    defaultPath?: string;
    filters?: { name: string; extensions: string[] }[];
  }) => ipcRenderer.invoke("dialog:saveFile", opts),

  // Screen recording
  getScreenSources: () => ipcRenderer.invoke("screen:getSources"),
  startScreenRecording: (sessionDir: string, opts?: { displayId?: string; x?: number; y?: number; width?: number; height?: number }) =>
    ipcRenderer.invoke("screen:startRecording", sessionDir, opts),
  stopScreenRecording: () => ipcRenderer.invoke("screen:stopRecording"),

  // Video
  generateFilmstrip: (sessionDir: string) =>
    ipcRenderer.invoke("video:generateFilmstrip", sessionDir),
  getVideoDuration: (videoPath: string) =>
    ipcRenderer.invoke("video:getDuration", videoPath),
  produceTimelineVideo: (sessionDir: string, version?: string, selectedActionIds?: string[], resolution?: { width: number; height: number }, crf?: number, trim?: { start: number; end: number }) =>
    ipcRenderer.invoke("video:produce", sessionDir, version, selectedActionIds, resolution, crf, trim),
  cancelProduce: () => ipcRenderer.invoke("video:cancelProduce"),

  // TTS (legacy; new code uses tts.preview)
  generateTTS: (sessionDir: string, actionId: string, text: string, lang: string, voice?: string, langCode?: string) =>
    ipcRenderer.invoke("tts:generate", sessionDir, actionId, text, lang, voice, langCode),

  // Versions
  listVersions: (sessionDir: string) =>
    ipcRenderer.invoke("versions:list", sessionDir),
  openVersion: (filePath: string) =>
    ipcRenderer.invoke("versions:open", filePath),
  showInFolder: (filePath: string) =>
    ipcRenderer.invoke("versions:showInFolder", filePath),

  // Binary file write (for recorded audio)
  writeBinaryFile: (filePath: string, data: ArrayBuffer) =>
    ipcRenderer.invoke("fs:writeBinaryFile", filePath, Buffer.from(data)),

  // Events (main → renderer)
  onProduceProgress: (callback: (msg: string) => void) => {
    ipcRenderer.on("produce-progress", (_event, msg) => callback(msg));
  },
  onRecordingTick: (callback: (data: { elapsed: number }) => void) => {
    ipcRenderer.on("recording-tick", (_event, data) => callback(data));
  },
  removeAllListeners: (channel: string) => {
    ipcRenderer.removeAllListeners(channel);
  },

  // Cache (persists across sessions)
  cacheGet: (key: string) => ipcRenderer.invoke("cache:get", key),
  cacheSet: (key: string, value: unknown) => ipcRenderer.invoke("cache:set", key, value),

  // File URL for video/images
  assetUrl: (filePath: string) => `file://${filePath}`,

  // The CLI bridge (src/types/narascreen-ipc.ts NaraBridgeAPI)
  ...bridge,
});
