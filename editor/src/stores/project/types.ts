/** The project store's shape (SPEC §3.2). Slices: session.ts, edit.ts, capture.ts. */
import type { DemoProject, EffectKind, LaneId, Rect, SessionInfo, TimelineAction } from "../../types";
import type { IssueFix } from "../../lib/issues";
import type { SelectOptions } from "./selection";

export type ProjectPatch = Partial<Omit<DemoProject, "actions" | "tts" | "output">> & {
  tts?: Partial<DemoProject["tts"]>;
  output?: Partial<DemoProject["output"]>;
};

export interface EditOptions {
  /** Merge into the previous undo step when it had the same key less than 1 s ago (slider drags, typing). */
  coalesce?: string;
}

export interface ProjectState {
  // ─── session ───
  sessionDir: string | null;
  project: DemoProject | null;
  isDirty: boolean;
  session: SessionInfo | null;
  filmstripPaths: string[];

  // ─── selection ───
  selectedIds: string[];
  primaryId: string | null;
  /** = primaryId (legacy alias; kept in sync by select()). */
  selectedActionId: string | null;

  // ─── playback ───
  playheadTime: number;
  isPlaying: boolean;
  playbackRate: number;

  // ─── capture / import / loading ───
  captureMode: boolean;
  isRecording: boolean;
  isLoading: boolean;
  loadingMessage: string;
  /** 0..1 while a video import is running, else null. */
  importProgress: number | null;
  /** Narration previews being generated: `${actionId}:${lang}` or `${actionId}:${lang}:t${k}`. */
  generating: Record<string, true>;

  // ─── undo/redo (whole-project snapshots) ───
  _history: DemoProject[];
  _future: DemoProject[];
  /** @deprecated same arrays as _history/_future (the old Toolbar reads their length). */
  _actionsHistory: DemoProject[];
  /** @deprecated see _actionsHistory */
  _actionsFuture: DemoProject[];
  _idCounter: number;
  _coalesce: { key: string; at: number } | null;

  // ─── session actions ───
  openSession(dir: string): Promise<void>;
  /** Save, stop watching, back to no project. */
  closeSession(): Promise<void>;
  save(): Promise<void>;
  /** Job sessions: show another language's compiled project. */
  setViewLang(lang: string): Promise<void>;
  /** Job sessions: copy the recording + the compiled actions (all languages) into a new timeline
   *  session next to the job (`<job>-edit`) and open it. Resolves to the new session dir. */
  detachJob(): Promise<string>;

  // ─── selection ───
  select(ids: string[] | string | null, opts?: SelectOptions): void;

  // ─── playback ───
  setPlayhead(t: number): void;
  togglePlay(): void;
  setIsPlaying(v: boolean): void;
  setPlaybackRate(r: number): void;
  cyclePlaybackRate(): void;

  // ─── edits (undoable, mark dirty; no-ops in read-only sessions) ───
  /** Add an effect at `at` with the API defaults; selects it and returns its id ("music" → the
   *  project's music setting, id MUSIC_ID; "" when nothing was added). */
  addEffect(kind: EffectKind, at: number, opts?: { end?: number; rect?: Rect; lane?: LaneId; select?: boolean }): string;
  updateAction(id: string, partial: Partial<TimelineAction>, opts?: EditOptions): void;
  updateActions(ids: string[], partialOrFn: Partial<TimelineAction> | ((a: TimelineAction) => Partial<TimelineAction>), opts?: EditOptions): void;
  deleteActions(ids: string[]): void;
  /** Clones 1 s later (clamped); selects the clones and returns their ids. */
  duplicateActions(ids: string[]): string[];
  splitAction(id: string, t: number): void;
  /** Shift by delta seconds (clamped to the video); returns the delta applied. */
  moveActions(ids: string[], deltaSec: number): number;
  /** Project settings (title, music, cards, output, tts…); nested tts/output are merged. */
  setProject(patch: ProjectPatch, opts?: EditOptions): void;
  undo(): void;
  redo(): void;
  applyIssueFix(fix: IssueFix): Promise<void>;
  /** Generate (or reuse) the TTS clip of one line: sets audioPath/audioDuration/audioTextHash[lang]. */
  generatePreview(actionId: string, lang: string, target?: number): Promise<void>;

  // ─── capture / import ───
  setIsRecording(v: boolean): void;
  startScreenCapture(displayId?: string, options?: { parentDir?: string; name?: string }): Promise<void>;
  stopScreenCapture(): Promise<void>;
  discardScreenCapture(): Promise<void>;
  importVideo(): Promise<void>;

  // ─── deprecated shims (old UI, removed in phase 3) ───
  /** @deprecated canvas store (startDrawing) */
  drawingZoom: boolean;
  /** @deprecated useRunsStore */
  isProducing: boolean;
  /** @deprecated useRunsStore */
  produceLog: string;
  /** @deprecated select(id) */
  setSelectedAction(id: string | null): void;
  /** @deprecated canvas store */
  setDrawingZoom(v: boolean): void;
  /** @deprecated addEffect(kind, at, { end }) */
  addAction(type: TimelineAction["type"], timestamp: number, endTimestamp?: number): void;
  /** @deprecated deleteActions([id]) */
  deleteAction(id: string): void;
  /** @deprecated duplicateActions([id]) */
  duplicateAction(id: string): void;
  /** @deprecated export through the CLI (lib/exportProject.ts + useRunsStore) */
  produce(selectedActionIds?: string[], resolution?: { width: number; height: number }, crf?: number, trim?: { start: number; end: number } | null): Promise<void>;
  /** @deprecated useRunsStore.cancel */
  cancelProduce(): Promise<void>;
  /** @deprecated useRunsStore */
  appendProduceLog(line: string): void;
  /** @deprecated useRunsStore */
  setIsProducing(v: boolean): void;
}
