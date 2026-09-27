/** Edits: selection, undo/redo, effect CRUD, project settings, narration previews.
 *  Every data mutation goes through `commitProject` (undo step + dirty) and is a no-op in
 *  read-only (job) sessions. */
import type { StateCreator } from "zustand";
import type { DemoProject, TimelineAction } from "../../types";
import { renderPaths } from "../../lib/exportProject";
import { narrationHash, narrationTextFor, narrationVoice, ttsSpeed } from "../../lib/spans";
import { LANG_CODES } from "../../lib/voices";
import { api, errMsg, hasBridge } from "./bridge";
import {
  MUSIC_ID, applyPartial, clampMoveDelta, clampTime, formatActionId, maxActionNumber, moveAction, musicDefaults, newEffect,
  sortActions, splitEffect,
} from "./effects";
import { applySelect, pruneSelection, type Selection } from "./selection";
import type { EditOptions, ProjectPatch, ProjectState } from "./types";

type EditSlice = Pick<
  ProjectState,
  | "select" | "setPlayhead" | "togglePlay" | "setIsPlaying" | "setPlaybackRate" | "cyclePlaybackRate"
  | "addEffect" | "updateAction" | "updateActions" | "deleteActions" | "duplicateActions" | "splitAction" | "moveActions"
  | "setProject" | "undo" | "redo" | "applyIssueFix" | "generatePreview"
  | "setSelectedAction" | "setDrawingZoom" | "addAction" | "deleteAction" | "duplicateAction"
>;

const MAX_HISTORY = 50;
const COALESCE_MS = 1000;
const RATES = [0.5, 1, 1.5, 2];

export const selectionState = (sel: Selection) => ({ selectedIds: sel.selectedIds, primaryId: sel.primaryId, selectedActionId: sel.primaryId });
export const historyState = (history: DemoProject[], future: DemoProject[]) => ({ _history: history, _future: future, _actionsHistory: history, _actionsFuture: future });

/** New project + undo step (merged into the last one for the same `coalesce` key within 1 s). */
export function commitProject(s: ProjectState, next: DemoProject, opts?: EditOptions): Partial<ProjectState> {
  const now = Date.now();
  const merge = !!opts?.coalesce && s._coalesce?.key === opts.coalesce && now - s._coalesce.at < COALESCE_MS && s._history.length > 0;
  const history = merge ? s._history : [...s._history, structuredClone(s.project!)].slice(-MAX_HISTORY);
  return { project: next, isDirty: true, ...historyState(history, []), _coalesce: opts?.coalesce ? { key: opts.coalesce, at: now } : null };
}

const editable = (s: ProjectState): s is ProjectState & { project: DemoProject } => !!s.project && !s.session?.readOnly;
const current = (s: ProjectState): Selection => ({ selectedIds: s.selectedIds, primaryId: s.primaryId });
const existsIn = (p: DemoProject) => (id: string) => id === MUSIC_ID ? !!p.music : p.actions.some((a) => a.id === id);
const genKey = (id: string, lang: string, target?: number) => `${id}:${lang}${target != null ? `:t${target}` : ""}`;

export const createEditSlice: StateCreator<ProjectState, [], [], EditSlice> = (set, get) => {
  /** Apply per-action partials in one undo step. */
  const updateMany = (changes: Map<string, (a: TimelineAction) => Partial<TimelineAction>>, opts?: EditOptions) => {
    const s = get();
    if (!editable(s) || !changes.size) return;
    let moved = false;
    let touched = false;
    const actions = s.project.actions.map((a) => {
      const fn = changes.get(a.id);
      if (!fn) return a;
      const partial = fn(a);
      if (!Object.keys(partial).length) return a;
      touched = true;
      if ("timestamp" in partial) moved = true;
      return applyPartial(s.project, a, partial);
    });
    if (!touched) return;
    set(commitProject(s, { ...s.project, actions: moved ? sortActions(actions) : actions }, opts));
  };

  return {
    select: (ids, opts = {}) => {
      const s = get();
      const all = s.project?.actions.map((a) => a.id) ?? [];
      set({ ...selectionState(applySelect(current(s), ids, opts, all)), drawingZoom: false });
    },
    setPlayhead: (t) => set({ playheadTime: Math.max(0, t) }),
    togglePlay: () => set((s) => ({ isPlaying: !s.isPlaying })),
    setIsPlaying: (v) => set({ isPlaying: v }),
    setPlaybackRate: (r) => set({ playbackRate: r > 0 ? r : 1 }),
    cyclePlaybackRate: () => {
      const i = RATES.indexOf(get().playbackRate);
      set({ playbackRate: RATES[(i + 1) % RATES.length] });
    },

    addEffect: (kind, at, opts = {}) => {
      const s = get();
      if (!editable(s)) return "";
      const sel = opts.select !== false;
      if (kind === "music") {
        if (!s.project.music) set(commitProject(s, { ...s.project, music: musicDefaults() }));
        if (sel) set(selectionState({ selectedIds: [MUSIC_ID], primaryId: MUSIC_ID }));
        return MUSIC_ID;
      }
      const n = Math.max(s._idCounter, maxActionNumber(s.project.actions)) + 1;
      const id = formatActionId(n);
      const a = newEffect(kind, id, at, s.project, opts);
      if (!a) return "";
      set({
        ...commitProject(s, { ...s.project, actions: sortActions([...s.project.actions, a]) }),
        _idCounter: n,
        drawingZoom: false,
        ...(sel ? selectionState({ selectedIds: [id], primaryId: id }) : {}),
      });
      return id;
    },

    updateAction: (id, partial, opts) => updateMany(new Map([[id, () => partial]]), opts),
    updateActions: (ids, partialOrFn, opts) =>
      updateMany(new Map(ids.map((id) => [id, typeof partialOrFn === "function" ? partialOrFn : () => partialOrFn])), opts),

    deleteActions: (ids) => {
      const s = get();
      if (!editable(s) || !ids.length) return;
      const drop = new Set(ids);
      const next: DemoProject = { ...s.project, actions: s.project.actions.filter((a) => !drop.has(a.id)) };
      if (drop.has(MUSIC_ID)) delete next.music;
      if (next.actions.length === s.project.actions.length && next.music === s.project.music) return;
      set({ ...commitProject(s, next), ...selectionState(pruneSelection(current(s), existsIn(next))) });
    },

    duplicateActions: (ids) => {
      const s = get();
      if (!editable(s)) return [];
      let n = Math.max(s._idCounter, maxActionNumber(s.project.actions));
      const clones = s.project.actions
        .filter((a) => ids.includes(a.id))
        .map((a) => ({ ...moveAction(structuredClone(a), clampMoveDelta(s.project, [a], 1)), id: formatActionId(++n) }));
      if (!clones.length) return [];
      const newIds = clones.map((c) => c.id);
      set({
        ...commitProject(s, { ...s.project, actions: sortActions([...s.project.actions, ...clones]) }),
        _idCounter: n,
        ...selectionState({ selectedIds: newIds, primaryId: newIds[newIds.length - 1] }),
      });
      return newIds;
    },

    splitAction: (id, t) => {
      const s = get();
      if (!editable(s)) return;
      const a = s.project.actions.find((x) => x.id === id);
      const n = Math.max(s._idCounter, maxActionNumber(s.project.actions)) + 1;
      const parts = a ? splitEffect(s.project, a, clampTime(s.project, t), formatActionId(n)) : null;
      if (!parts) return;
      const actions = sortActions([...s.project.actions.map((x) => (x.id === id ? parts[0] : x)), parts[1]]);
      set({ ...commitProject(s, { ...s.project, actions }), _idCounter: n, ...selectionState({ selectedIds: [parts[1].id], primaryId: parts[1].id }) });
    },

    moveActions: (ids, deltaSec) => {
      const s = get();
      if (!editable(s)) return 0;
      const moving = s.project.actions.filter((a) => ids.includes(a.id));
      const d = clampMoveDelta(s.project, moving, deltaSec);
      if (!d) return 0;
      const actions = sortActions(s.project.actions.map((a) => (ids.includes(a.id) ? moveAction(a, d) : a)));
      set(commitProject(s, { ...s.project, actions }));
      return d;
    },

    setProject: (patch: ProjectPatch, opts) => {
      const s = get();
      if (!editable(s)) return;
      const next: Record<string, unknown> = { ...s.project };
      for (const [k, v] of Object.entries(patch)) {
        if (k === "actions") continue;
        if (v === undefined) delete next[k];
        else if ((k === "tts" || k === "output") && v && typeof v === "object") next[k] = { ...(s.project[k] as object), ...v };
        else next[k] = v;
      }
      set(commitProject(s, next as unknown as DemoProject, opts));
    },

    undo: () => {
      const s = get();
      if (!s.project || !s._history.length) return;
      const history = s._history.slice(0, -1);
      const prev = s._history[s._history.length - 1];
      set({ project: prev, isDirty: true, _coalesce: null, ...historyState(history, [...s._future, structuredClone(s.project)]), ...selectionState(pruneSelection(current(s), existsIn(prev))) });
    },
    redo: () => {
      const s = get();
      if (!s.project || !s._future.length) return;
      const future = s._future.slice(0, -1);
      const next = s._future[s._future.length - 1];
      set({ project: next, isDirty: true, _coalesce: null, ...historyState([...s._history, structuredClone(s.project)], future), ...selectionState(pruneSelection(current(s), existsIn(next))) });
    },

    applyIssueFix: async (fix) => {
      if (fix.kind === "update") updateMany(new Map(fix.changes.map((c) => [c.id, () => c.partial])));
      else if (fix.kind === "project") get().setProject(fix.partial as ProjectPatch);
      else await get().generatePreview(fix.actionId, fix.lang, fix.target);
    },

    generatePreview: async (actionId, lang, target) => {
      const s = get();
      if (!editable(s) || !s.sessionDir) return;
      const a = s.project.actions.find((x) => x.id === actionId);
      if (!a) throw new Error(`No effect ${actionId}`);
      const n = narrationTextFor(a, lang, target);
      if (!n) throw new Error(`Nothing to say in ${lang}: add the ${lang} text first.`);
      const voice = narrationVoice(s.project, a, lang, target);
      const speed = ttsSpeed(s.project);
      const key = genKey(actionId, n.lang, target);
      set((st) => ({ generating: { ...st.generating, [key]: true } }));
      try {
        let audioPath: string;
        let durationSec: number;
        if (hasBridge("tts")) {
          const r = await api().tts.preview({ audioDir: renderPaths(s.sessionDir).audioDir, lang: n.lang, voice, speed, text: n.text, endpoint: s.project.tts.kokoroEndpoint });
          ({ audioPath, durationSec } = r);
        } else {
          const r = await api().generateTTS(s.sessionDir, target != null ? `${actionId}_t${target}` : actionId, n.text, n.lang, voice, LANG_CODES[n.lang] ?? "a");
          ({ audioPath, duration: durationSec } = r);
        }
        const hash = narrationHash(n.lang, voice, speed, n.text);
        const put = <V>(o: Record<string, V> | undefined, v: V): Record<string, V> => ({ ...(o ?? {}), [n.lang]: v });
        const st = get();
        if (!editable(st)) return;
        updateMany(new Map([[actionId, (cur: TimelineAction): Partial<TimelineAction> => {
          if (target == null) return { audioPath: put(cur.audioPath, audioPath), audioDuration: put(cur.audioDuration, durationSec), audioTextHash: put(cur.audioTextHash, hash) };
          const targets = (cur.zoomTargets ?? []).map((t, k) =>
            k === target ? { ...t, audioPath: put(t.audioPath, audioPath), audioDuration: put(t.audioDuration, durationSec), audioTextHash: put(t.audioTextHash, hash) } : t);
          return { zoomTargets: targets };
        }]]));
      } catch (err) {
        throw new Error(`Generating the ${n.lang} narration failed: ${errMsg(err)}`);
      } finally {
        set((st) => {
          const g = { ...st.generating };
          delete g[key];
          return { generating: g };
        });
      }
    },

    // ─── deprecated shims ───
    setSelectedAction: (id) => get().select(id),
    setDrawingZoom: (v) => set({ drawingZoom: v }),
    addAction: (type, timestamp, endTimestamp) => void get().addEffect(type, timestamp, { end: endTimestamp }),
    deleteAction: (id) => get().deleteActions([id]),
    duplicateAction: (id) => void get().duplicateActions([id]),
  };
};
