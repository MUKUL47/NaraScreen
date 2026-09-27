// ─── bridge/watch: tell the renderer when a session file changes ─────
//
// Used for D31: a CLI run rewrites demo-project*.json / job.json / the script
// while the desktop has the session open. Parent directories are watched (not
// the files), because atomic tmp+rename writes replace the file's inode and a
// file watch would go deaf after the first save. Events are debounced per path.

import * as fs from "fs";
import * as path from "path";
import type { WebContents } from "electron";

const DEBOUNCE_MS = 200;

interface Watch {
  owner: WebContents;
  watchers: fs.FSWatcher[];
  timers: Map<string, NodeJS.Timeout>;
}

const watches = new Map<string, Watch>();
const hooked = new WeakSet<WebContents>();

export function startWatch(owner: WebContents, watchId: string, paths: string[]): void {
  stopWatch(watchId);
  const byDir = new Map<string, Set<string>>();
  for (const p of paths ?? []) {
    if (typeof p !== "string" || !path.isAbsolute(p)) continue;
    const abs = path.resolve(p);
    const dir = path.dirname(abs);
    if (!byDir.has(dir)) byDir.set(dir, new Set());
    byDir.get(dir)!.add(path.basename(abs));
  }
  const w: Watch = { owner, watchers: [], timers: new Map() };
  for (const [dir, names] of byDir) {
    try {
      const watcher = fs.watch(dir, { persistent: false }, (_ev, filename) => {
        const name = filename?.toString();
        if (!name || !names.has(name)) return;
        const full = path.join(dir, name);
        clearTimeout(w.timers.get(full));
        w.timers.set(
          full,
          setTimeout(() => {
            w.timers.delete(full);
            if (!owner.isDestroyed()) owner.send("fs:changed", { watchId, path: full });
          }, DEBOUNCE_MS),
        );
      });
      watcher.on("error", () => watcher.close());
      w.watchers.push(watcher);
    } catch {
      // folder gone / unreadable: nothing to watch there
    }
  }
  watches.set(watchId, w);
  if (!hooked.has(owner) && !owner.isDestroyed()) {
    hooked.add(owner);
    owner.once("destroyed", () => stopWatchesOf(owner));
    // A reload starts a new page: the old page's watches have no listener any more.
    owner.on("did-navigate", () => stopWatchesOf(owner));
  }
}

export function stopWatch(watchId: string): void {
  const w = watches.get(watchId);
  if (!w) return;
  for (const watcher of w.watchers) watcher.close();
  for (const t of w.timers.values()) clearTimeout(t);
  watches.delete(watchId);
}

/** A page reload leaves its old watch ids behind: drop them. */
export function stopWatchesOf(owner: WebContents): void {
  for (const [id, w] of watches) if (w.owner === owner) stopWatch(id);
}
