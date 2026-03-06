interface ElectronAPI {
  // File operations
  readTextFile: (filePath: string) => Promise<string>;
  writeTextFile: (filePath: string, data: string) => Promise<void>;
  readDir: (dirPath: string) => Promise<{ name: string; isDirectory: boolean }[]>;
  exists: (filePath: string) => Promise<boolean>;
  mkdir: (dirPath: string, options?: { recursive?: boolean }) => Promise<void>;
  homeDir: () => Promise<string>;

  writeBinaryFile: (filePath: string, data: ArrayBuffer) => Promise<void>;

  // Dialog
  openDirectory: () => Promise<string | null>;
  openVideoFile: () => Promise<string | null>;
  pickSaveDirectory: (defaultPath?: string) => Promise<string | null>;
  saveFile: (opts: {
    title?: string;
    defaultPath?: string;
    filters?: { name: string; extensions: string[] }[];
  }) => Promise<string | null>;

  // Screen recording
  getScreenSources: () => Promise<{ id: string; name: string; x: number; y: number; width: number; height: number }[]>;
  startScreenRecording: (sessionDir: string, opts?: { displayId?: string; x?: number; y?: number; width?: number; height?: number }) => Promise<void>;
  stopScreenRecording: () => Promise<{ videoPath: string; duration: number }>;

  // Video
  generateFilmstrip: (sessionDir: string) => Promise<number>;
  getVideoDuration: (videoPath: string) => Promise<number>;
  produceTimelineVideo: (sessionDir: string, version?: string, selectedActionIds?: string[], resolution?: { width: number; height: number }, crf?: number) => Promise<string>;
  cancelProduce: () => Promise<void>;

  // TTS
  generateTTS: (sessionDir: string, actionId: string, text: string, lang: string, voice?: string, langCode?: string) => Promise<{ audioPath: string; duration: number }>;

  // Versions
  listVersions: (sessionDir: string) => Promise<{ name: string; path: string; size: number; created: string }[]>;
  openVersion: (filePath: string) => Promise<void>;
  showInFolder: (filePath: string) => Promise<void>;

  // Events
  onProduceProgress: (callback: (msg: string) => void) => void;
  onRecordingTick: (callback: (data: { elapsed: number }) => void) => void;
  removeAllListeners: (channel: string) => void;

  // Cache (persists across sessions)
  cacheGet: (key: string) => Promise<unknown>;
  cacheSet: (key: string, value: unknown) => Promise<void>;

  // File URL
  assetUrl: (filePath: string) => string;
}

interface Window {
  electronAPI: ElectronAPI;
}
