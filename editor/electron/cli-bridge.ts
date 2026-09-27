// ─── cli-bridge: the desktop's IPC surface for the NaraScreen CLI ────
//
// Implements NaraBridgeAPI (src/types/narascreen-ipc.ts) in the main process:
//   cli:*        CLI commands as child processes (bridge/runs.ts)
//   script:*     read / atomic write / in-process validate (bridge/scripts.ts)
//   session:*    timeline session vs CLI job folder
//   tts:preview  one narration clip into the CLI's cache (bridge/media.ts)
//   audio:peaks, video:probe, video:importFile
//   dialog:openFile, fs:watch / fs:unwatch, win:setTitle
// Every handler is async and never blocks the main process on a child process.

import { app, BrowserWindow, dialog, ipcMain } from "electron";
import type {
  CliRunRequest,
  InlineValidateRequest,
  OpenFileOptions,
  ScriptWriteOptions,
  TtsPreviewRequest,
  VideoImportRequest,
} from "../src/types/narascreen-ipc";
import { audioPeaks, importVideo, legacyGenerateTts, probeVideo, publicProbe, ttsPreview } from "./bridge/media";
import { callRun, cancelRun, hasActiveRuns, listRuns, startRun, stopAllRuns } from "./bridge/runs";
import { probeSession, readScript, validateInline, writeScript } from "./bridge/scripts";
import { startWatch, stopWatch } from "./bridge/watch";

let registered = false;

export function registerCliBridge(): void {
  if (registered) return;
  registered = true;

  // ── CLI runs ──
  ipcMain.handle("cli:run", (_e, req: CliRunRequest) => startRun(req));
  ipcMain.handle("cli:call", (_e, req: CliRunRequest & { timeoutMs?: number }) => callRun(req));
  ipcMain.handle("cli:cancel", (_e, runId: string) => cancelRun(runId));
  ipcMain.handle("cli:list", () => listRuns());

  // ── scripts + sessions ──
  ipcMain.handle("script:read", (_e, p: string) => readScript(p));
  ipcMain.handle("script:write", (_e, p: string, script: unknown, opts?: ScriptWriteOptions) => writeScript(p, script, opts));
  ipcMain.handle("script:validateInline", (_e, req: InlineValidateRequest) => validateInline(req));
  ipcMain.handle("session:probe", (_e, dir: string) => probeSession(dir));

  // ── media ──
  ipcMain.handle("tts:preview", (_e, req: TtsPreviewRequest) => ttsPreview(req));
  ipcMain.handle(
    "tts:generate",
    (_e, sessionDir: string, actionId: string, text: string, lang: string, voice?: string, langCode?: string) =>
      legacyGenerateTts(sessionDir, actionId, text, lang, voice, langCode),
  );
  ipcMain.handle("audio:peaks", (_e, p: string, bucketsPerSec?: number) => audioPeaks(p, bucketsPerSec));
  ipcMain.handle("video:probe", async (_e, p: string) => publicProbe(await probeVideo(p)));
  ipcMain.handle("video:importFile", (_e, req: VideoImportRequest) => importVideo(req));

  // ── window + dialogs + watching ──
  ipcMain.handle("dialog:openFile", async (e, opts: OpenFileOptions = {}) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const options: Electron.OpenDialogOptions = {
      properties: ["openFile"],
      title: opts.title,
      filters: opts.filters,
      defaultPath: opts.defaultPath,
    };
    const r = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    return r.canceled ? null : (r.filePaths[0] ?? null);
  });
  ipcMain.handle("fs:watch", (e, req: { watchId: string; paths: string[] }) => startWatch(e.sender, req.watchId, req.paths));
  ipcMain.handle("fs:unwatch", (_e, req: { watchId: string }) => stopWatch(req.watchId));
  ipcMain.handle("win:setTitle", (e, title: string) => {
    BrowserWindow.fromWebContents(e.sender)?.setTitle(String(title));
  });

  // Quitting must not leave a render (and its ffmpeg/Chromium) running.
  let quitting = false;
  app.on("before-quit", (e) => {
    if (quitting || !hasActiveRuns()) return;
    e.preventDefault();
    quitting = true;
    void stopAllRuns().finally(() => app.quit());
  });
}
