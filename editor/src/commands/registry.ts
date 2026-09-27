import { useSyncExternalStore } from "react";
import type { LucideIcon } from "lucide-react";
import { formatShortcut, matchKey, parseKey, repeatsByDefault, type ParsedKey } from "./keys";

/**
 * The single command registry (SPEC §3.3): drives keyboard shortcuts (useKeymap), the command
 * palette (useCommands), menus and tooltips (shortcutLabel). Each feature registers its own
 * commands from its own module and unregisters on unmount:
 *
 *   useEffect(() => registerCommands([{ id: "file.save", title: "Save", section: "File",
 *     keys: ["Mod+S"], run: () => useProjectStore.getState().save() }]), []);
 */
export interface Command {
  id: string;
  title: string;
  section: "File" | "Edit" | "Add" | "View" | "Playback" | "Export" | "Help" | (string & {});
  /** Key specs, e.g. ["Mod+S"], ["1"], ["Shift+Z"], ["D", "Mod+D"]. The first one is shown in labels. */
  keys?: string[];
  icon?: LucideIcon;
  /** Guard: the command is inactive (no key dispatch, disabled in the palette) when it returns false. */
  when?: () => boolean;
  run: () => void;
  /** Extra palette search terms. */
  aliases?: string[];
  /** One line for the palette / tooltips. */
  description?: string;
  /** Allow key auto-repeat. Default: only arrow keys and , . = - + repeat. */
  repeat?: boolean;
}

interface Entry {
  cmd: Command;
  keys: ParsedKey[];
}

let entries: Entry[] = [];
let snapshot: Command[] = [];
const listeners = new Set<() => void>();
const runListeners = new Set<(cmd: Command) => void>();

function rebuild() {
  // One entry per id in the list; a later registration of the same id replaces the earlier one.
  const byId = new Map<string, Command>();
  for (const e of entries) {
    byId.delete(e.cmd.id);
    byId.set(e.cmd.id, e.cmd);
  }
  snapshot = [...byId.values()];
  for (const l of listeners) l();
}

/** Registers commands; returns a function that unregisters exactly these registrations. */
export function registerCommands(cmds: Command[]): () => void {
  const added = cmds.map((cmd) => ({ cmd, keys: (cmd.keys ?? []).map(parseKey) }));
  entries = [...entries, ...added];
  rebuild();
  return () => {
    const before = entries.length;
    entries = entries.filter((e) => !added.includes(e));
    if (entries.length !== before) rebuild();
  };
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
const getSnapshot = () => snapshot;

/** Reactive list of every registered command (for the palette and the shortcuts sheet). */
export function useCommands(): Command[] {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Non-reactive list (latest registration per id). */
export function getCommands(): Command[] {
  return snapshot;
}

/** The latest registration of a command id. */
export function getCommand(id: string): Command | undefined {
  for (let i = entries.length - 1; i >= 0; i--) if (entries[i].cmd.id === id) return entries[i].cmd;
  return undefined;
}

export function isCommandEnabled(cmd: Command): boolean {
  try {
    return cmd.when ? cmd.when() : true;
  } catch {
    return false;
  }
}

function execute(cmd: Command): void {
  cmd.run();
  for (const l of runListeners) l(cmd);
}

/** Runs a command by id if it is registered and its `when()` allows it. Returns whether it ran. */
export function runCommand(id: string): boolean {
  const cmd = getCommand(id);
  if (!cmd || !isCommandEnabled(cmd)) return false;
  execute(cmd);
  return true;
}

/** Called after any command runs (palette "Recent" list). Returns an unsubscribe function. */
export function onCommandRun(listener: (cmd: Command) => void): () => void {
  runListeners.add(listener);
  return () => {
    runListeners.delete(listener);
  };
}

/** The first key spec of a command, e.g. "Mod+S" (for <Kbd keys=…> and Tooltip `shortcut`). */
export function commandKeys(id: string): string | undefined {
  return getCommand(id)?.keys?.[0];
}

/** Display label of a command's first shortcut: "Ctrl+S" / "⌘S". */
export function shortcutLabel(id: string): string | undefined {
  const k = commandKeys(id);
  return k ? formatShortcut(k) : undefined;
}

/**
 * The command a key event triggers: the last registered, active command with a matching key.
 * `repeat` is false for auto-repeated events that the command does not accept.
 */
export function findCommandForEvent(e: KeyboardEvent): { cmd: Command; repeatOk: boolean } | undefined {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    const hit = entry.keys.find((k) => matchKey(k, e));
    if (!hit || !isCommandEnabled(entry.cmd)) continue;
    const repeatOk = !e.repeat || (entry.cmd.repeat ?? repeatsByDefault(hit));
    return { cmd: entry.cmd, repeatOk };
  }
  return undefined;
}

/** Internal: used by useKeymap so run listeners fire for key-triggered commands too. */
export function executeCommand(cmd: Command): void {
  execute(cmd);
}
