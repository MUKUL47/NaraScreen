import { useSyncExternalStore } from "react";

/**
 * Small persistence helpers for UI state (section open/closed, splitter sizes).
 * Uses `window.electronAPI.cacheGet/cacheSet` (narascreen-cache.json) and falls back to
 * localStorage when the bridge is absent (plain browser, tests). Never throws.
 */
interface CacheBridge {
  cacheGet?: (key: string) => Promise<unknown>;
  cacheSet?: (key: string, value: unknown) => Promise<void>;
}

function bridge(): CacheBridge | undefined {
  try {
    return (window as unknown as { electronAPI?: CacheBridge }).electronAPI;
  } catch {
    return undefined;
  }
}

const LS_PREFIX = "narascreen:";

export async function uiCacheGet(key: string): Promise<unknown> {
  const api = bridge();
  if (api?.cacheGet) {
    try {
      return (await api.cacheGet(key)) ?? null;
    } catch {
      return null;
    }
  }
  try {
    const raw = localStorage.getItem(LS_PREFIX + key);
    return raw == null ? null : JSON.parse(raw);
  } catch {
    return null;
  }
}

export function uiCacheSet(key: string, value: unknown): void {
  const api = bridge();
  if (api?.cacheSet) {
    try {
      void api.cacheSet(key, value).catch(() => undefined);
    } catch {
      /* ignore */
    }
    return;
  }
  try {
    localStorage.setItem(LS_PREFIX + key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

// ── Section open/closed states: one cache key holding { [persistKey]: boolean } ──

const SECTIONS_KEY = "uiSections";
let sections: Record<string, boolean> = {};
let loadPromise: Promise<void> | null = null;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

/** Loads persisted UI state once. main.tsx calls it before the first render. */
export function preloadUiState(): Promise<void> {
  if (!loadPromise) {
    loadPromise = uiCacheGet(SECTIONS_KEY).then((v) => {
      if (v && typeof v === "object" && !Array.isArray(v)) {
        // Anything toggled before the load finished wins over the stored value.
        sections = { ...(v as Record<string, boolean>), ...sections };
        emit();
      }
    });
  }
  return loadPromise;
}

export function setSectionOpen(key: string, open: boolean): void {
  sections = { ...sections, [key]: open };
  emit();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => uiCacheSet(SECTIONS_KEY, sections), 250);
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

/** The persisted open state for a Section key, or undefined when never toggled. */
export function useSectionOpen(key: string | undefined): boolean | undefined {
  return useSyncExternalStore(
    subscribe,
    () => (key ? sections[key] : undefined),
    () => undefined,
  );
}
