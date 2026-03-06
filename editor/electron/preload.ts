import { contextBridge, ipcRenderer } from "electron";

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

  // TTS
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
});
