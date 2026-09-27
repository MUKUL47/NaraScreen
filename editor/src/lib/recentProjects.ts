/** Recent projects for the Home screen (cache key `recentProjects`). The list logic is pure;
 *  the load/save helpers go through window.electronAPI.cacheGet/cacheSet. */
import type { DemoProject, SessionKind } from "../types";

export const RECENT_KEY = "recentProjects";
export const RECENT_MAX = 30;

export interface RecentProject {
  dir: string;
  title: string;
  /** Recording length in seconds. */
  duration: number;
  languages: string[];
  /** First filmstrip frame, or null. */
  thumb: string | null;
  /** ISO timestamps. */
  lastOpened: string;
  lastExport: string | null;
  kind?: SessionKind;
}

const isRecent = (x: unknown): x is RecentProject =>
  !!x && typeof x === "object" && typeof (x as RecentProject).dir === "string" && !!(x as RecentProject).dir;

/** Normalise whatever the cache holds into a list (drops junk, dedupes by dir). */
export function parseRecent(raw: unknown): RecentProject[] {
  const seen = new Set<string>();
  const out: RecentProject[] = [];
  for (const x of Array.isArray(raw) ? raw : []) {
    if (!isRecent(x) || seen.has(x.dir)) continue;
    seen.add(x.dir);
    out.push({
      dir: x.dir,
      title: typeof x.title === "string" ? x.title : x.dir.split(/[\\/]/).pop() ?? x.dir,
      duration: typeof x.duration === "number" ? x.duration : 0,
      languages: Array.isArray(x.languages) ? x.languages.filter((l) => typeof l === "string") : [],
      thumb: typeof x.thumb === "string" ? x.thumb : null,
      lastOpened: typeof x.lastOpened === "string" ? x.lastOpened : new Date(0).toISOString(),
      lastExport: typeof x.lastExport === "string" ? x.lastExport : null,
      ...(x.kind === "job" || x.kind === "timeline" ? { kind: x.kind } : {}),
    });
  }
  return out;
}

/** Insert or refresh an entry; `touch` moves it to the front (opened now). */
export function upsertRecent(list: RecentProject[], entry: Partial<RecentProject> & { dir: string }, opts: { touch?: boolean; now?: string } = {}): RecentProject[] {
  const now = opts.now ?? new Date().toISOString();
  const prev = list.find((r) => r.dir === entry.dir);
  const merged: RecentProject = {
    title: entry.dir.split(/[\\/]/).pop() ?? entry.dir,
    duration: 0,
    languages: [],
    thumb: null,
    lastOpened: now,
    lastExport: null,
    ...prev,
    ...Object.fromEntries(Object.entries(entry).filter(([, v]) => v !== undefined)),
    ...(opts.touch ? { lastOpened: now } : {}),
    dir: entry.dir,
  };
  const rest = list.filter((r) => r.dir !== entry.dir);
  return (opts.touch || !prev ? [merged, ...rest] : list.map((r) => (r.dir === entry.dir ? merged : r))).slice(0, RECENT_MAX);
}

/** The entry fields a project provides. */
export function recentFromProject(dir: string, project: DemoProject, extra: { thumb?: string | null; kind?: SessionKind } = {}): Partial<RecentProject> & { dir: string } {
  return {
    dir,
    title: project.title,
    duration: project.recordingDuration || 0,
    languages: project.tts?.languages?.length ? [...project.tts.languages] : ["en"],
    ...(extra.thumb !== undefined ? { thumb: extra.thumb } : {}),
    ...(extra.kind ? { kind: extra.kind } : {}),
  };
}

// ─── persistence ─────────────────────────────────────────────────────

export async function loadRecent(): Promise<RecentProject[]> {
  try {
    return parseRecent(await window.electronAPI.cacheGet(RECENT_KEY));
  } catch {
    return [];
  }
}

async function update(fn: (list: RecentProject[]) => RecentProject[]): Promise<RecentProject[]> {
  const next = fn(await loadRecent());
  try {
    await window.electronAPI.cacheSet(RECENT_KEY, next);
  } catch {
    /* best effort: the list is a convenience */
  }
  return next;
}

/** A project was opened (moves it to the front). */
export const noteOpened = (entry: Partial<RecentProject> & { dir: string }) => update((l) => upsertRecent(l, entry, { touch: true }));
/** A project was saved (refreshes title, duration, languages; keeps its place). */
export const noteSaved = (entry: Partial<RecentProject> & { dir: string }) => update((l) => upsertRecent(l, entry));
/** A project was exported. */
export const noteExported = (dir: string, at = new Date().toISOString()) => update((l) => upsertRecent(l, { dir, lastExport: at }));
/** Remove from the list (never deletes files). */
export const removeRecent = (dir: string) => update((l) => l.filter((r) => r.dir !== dir));
