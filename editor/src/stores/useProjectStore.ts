/** The project store (SPEC §3.2): session, project data, selection, undo/redo, playback,
 *  capture/import. Slices live in ./project/: session.ts (open/save/close/jobs/watch),
 *  edit.ts (selection, CRUD, settings, previews), capture.ts (record/import + legacy shims). */
import { create } from "zustand";
import type { DemoProject } from "../types";
import { projectIssues, type Issue } from "../lib/issues";
import { createCaptureSlice } from "./project/capture";
import { createEditSlice } from "./project/edit";
import { createSessionSlice } from "./project/session";
import type { ProjectState } from "./project/types";

export type { ProjectState, ProjectPatch, EditOptions } from "./project/types";
export type { SelectOptions } from "./project/selection";
export { MUSIC_ID } from "./project/effects";

export const useProjectStore = create<ProjectState>()((...a) => ({
  sessionDir: null,
  project: null,
  isDirty: false,
  session: null,
  filmstripPaths: [],
  selectedIds: [],
  primaryId: null,
  selectedActionId: null,
  playheadTime: 0,
  isPlaying: false,
  playbackRate: 1,
  captureMode: false,
  isRecording: false,
  isLoading: false,
  loadingMessage: "",
  importProgress: null,
  generating: {},
  _history: [],
  _future: [],
  _actionsHistory: [],
  _actionsFuture: [],
  _idCounter: 0,
  _coalesce: null,
  drawingZoom: false,
  isProducing: false,
  produceLog: "",
  ...createSessionSlice(...a),
  ...createEditSlice(...a),
  ...createCaptureSlice(...a),
}));

// Autosave: 3 s after the last edit (never for read-only job views).
let autoSaveTimer: ReturnType<typeof setTimeout> | null = null;
useProjectStore.subscribe((state, prev) => {
  if (!state.isDirty || state.session?.readOnly || !state.sessionDir) return;
  if (state.project === prev.project && prev.isDirty) return;
  if (autoSaveTimer) clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(() => {
    useProjectStore.getState().save().catch((err: unknown) => {
      console.error("Autosave failed:", err);
    });
  }, 3000);
});

// ─── selectors ───────────────────────────────────────────────────────

const issueCache = new WeakMap<DemoProject, { key: string; issues: Issue[] }>();
/** Pre-flight issues of the open project (memoised per project object and language list). */
export function selectIssues(s: Pick<ProjectState, "project" | "session">, langs?: string[]): Issue[] {
  const p = s.project;
  if (!p || s.session?.kind === "job") return [];
  const key = (langs ?? []).join(",");
  const hit = issueCache.get(p);
  if (hit && hit.key === key) return hit.issues;
  const issues = projectIssues(p, { langs });
  issueCache.set(p, { key, issues });
  return issues;
}

/** The primary selected action (null for none or the music clip). */
export const selectPrimaryAction = (s: Pick<ProjectState, "project" | "primaryId">) =>
  s.project?.actions.find((a) => a.id === s.primaryId) ?? null;
