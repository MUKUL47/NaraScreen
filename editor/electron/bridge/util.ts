// ─── bridge/util: small helpers shared by the CLI bridge's IPC handlers ──

import { BrowserWindow } from "electron";
import { toAgentError } from "../../api/errors";

/** Send to every open window (the app has one; a reload keeps its webContents). */
export function broadcast(channel: string, payload: unknown): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed() && !w.webContents.isDestroyed()) w.webContents.send(channel, payload);
  }
}

/**
 * An Error for ipcMain.handle to throw. Only the message crosses Electron's IPC
 * and context bridge, so it carries the stable code first ("CODE: message")
 * and the hint on the next line; the renderer reads the code with
 * bridgeErrorCode() (src/types/narascreen-ipc.ts).
 */
export function bridgeError(code: string, message: string, hint?: string): Error {
  return new Error(`${code}: ${message}${hint ? `\n${hint}` : ""}`);
}

/** Anything thrown (AgentError or not) → bridgeError. */
export function toBridgeError(err: unknown): Error {
  const e = toAgentError(err);
  return bridgeError(e.code, e.message, e.code === "INTERNAL" ? undefined : e.hint);
}
