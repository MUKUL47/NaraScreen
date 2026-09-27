/** Pure helpers behind the project store's edits: ids, new effects with API defaults, partial
 *  normalisation, moving and splitting. No window access (unit-tested in Node). */
import type { DemoProject, EffectKind, Rect, TimelineAction } from "../../types";
import { API_DEFAULTS, AUTO_FALLBACK_SEC } from "../../lib/schemaMeta";
import { getEffectSpan, projectLanguages, rangeEnd } from "../../lib/spans";

/** Selection id of the whole-video music clip (project.music is not an action). */
export const MUSIC_ID = "music";

const ID_RE = /^action-(\d+)$/;
/** Highest numeric suffix among `action-N` ids. */
export function maxActionNumber(actions: TimelineAction[]): number {
  return actions.reduce((m, a) => Math.max(m, Number(ID_RE.exec(a.id)?.[1] ?? 0)), 0);
}
export const formatActionId = (n: number) => `action-${String(n).padStart(3, "0")}`;

const r3 = (x: number) => Math.round(x * 1000) / 1000;
const RANGE_KEY = { speed: "speedEndTimestamp", skip: "skipEndTimestamp", mute: "muteEndTimestamp" } as const;
const DURATION_KEY = { spotlight: "spotlightDuration", blur: "blurDuration", callout: "calloutDuration" } as const;
type RangeType = keyof typeof RANGE_KEY;
type OverlayType = keyof typeof DURATION_KEY;
const isRangeType = (t: string): t is RangeType => t in RANGE_KEY;
const isOverlayType = (t: string): t is OverlayType => t in DURATION_KEY;

/** Latest start an effect may have (the validator wants `at` < the video's length). */
export const maxStart = (p: DemoProject) => (p.recordingDuration > 0 ? Math.max(0, p.recordingDuration - 0.05) : Infinity);
export const clampTime = (p: DemoProject, t: number) => r3(Math.min(maxStart(p), Math.max(0, Number.isFinite(t) ? t : 0)));

export interface AddEffectOptions {
  /** End of a dragged range (ranges and overlays). */
  end?: number;
  /** A region drawn on the canvas (zoom, spotlight, blur, arrow target, callout panel). */
  rect?: Rect;
}

/**
 * A new effect with the API's defaults (schemaMeta): zoom 0.8 s in / 2 s hold, narrate freezes
 * (projectVersion 2), spotlight / callout / arrow "auto" and blur "end" when no range is given,
 * pause 3 s, speed 2×. Returns null for "music" (a project setting, see musicDefaults).
 */
export function newEffect(kind: EffectKind, id: string, at: number, project: DemoProject, opts: AddEffectOptions = {}): TimelineAction | null {
  if (kind === "music") return null;
  const t = clampTime(project, at);
  const dur = project.recordingDuration || 0;
  const hasEnd = opts.end != null && opts.end > t + 0.05;
  const end = hasEnd ? r3(dur ? Math.min(opts.end!, dur) : opts.end!) : undefined;
  const span = end != null ? r3(end - t) : undefined;
  const rect = opts.rect;
  const overlay = (key: OverlayType, mode: "auto" | "end"): Partial<TimelineAction> =>
    span != null ? { [DURATION_KEY[key]]: span } : { durationMode: mode, [DURATION_KEY[key]]: mode === "end" && dur ? r3(Math.max(0.5, dur - t)) : AUTO_FALLBACK_SEC };
  const base = { id, timestamp: t };
  switch (kind) {
    case "zoom":
      return { ...base, type: "zoom", zoomDuration: API_DEFAULTS.zoom.zoomDuration, zoomHold: API_DEFAULTS.zoom.zoomHold, ...(rect ? { zoomTargets: [{ rect }] } : {}) };
    case "narrate":
      return { ...base, type: "narrate", narrations: {}, freeze: API_DEFAULTS.narrate.freeze, showSubtitles: API_DEFAULTS.narrate.subtitles };
    case "spotlight":
      return { ...base, type: "spotlight", dimOpacity: API_DEFAULTS.spotlight.dimOpacity, ...overlay("spotlight", "auto"), ...(rect ? { spotlightRects: [rect] } : {}) };
    case "blur":
      return { ...base, type: "blur", blurRadius: API_DEFAULTS.blur.radius, ...overlay("blur", "end"), ...(rect ? { blurRects: [rect] } : {}) };
    case "callout":
      return {
        ...base, type: "callout", calloutText: "", calloutStyle: API_DEFAULTS.callout.style, ...overlay("callout", "auto"),
        ...(rect ? { calloutPanels: [{ text: "", rect, fontSize: API_DEFAULTS.callout.fontSize }] } : {}),
      };
    case "arrow":
      return {
        ...base, type: "callout", calloutStyle: "arrow", ...overlay("callout", "auto"),
        ...(rect ? { calloutPanels: [{ text: "", rect, fontSize: API_DEFAULTS.arrow.fontSize }] } : {}),
      };
    case "pause":
      return { ...base, type: "pause", resumeAfter: API_DEFAULTS.pause.seconds };
    case "speed":
      return { ...base, type: "speed", speedFactor: API_DEFAULTS.speed.factor, speedEndTimestamp: end ?? rangeDefaultEnd(project, t, 5) };
    case "skip":
      return { ...base, type: "skip", skipEndTimestamp: end ?? rangeDefaultEnd(project, t, AUTO_FALLBACK_SEC) };
    case "mute":
      return { ...base, type: "mute", muteEndTimestamp: end ?? rangeDefaultEnd(project, t, AUTO_FALLBACK_SEC) };
  }
}
const rangeDefaultEnd = (p: DemoProject, t: number, len: number) => r3(p.recordingDuration > 0 ? Math.min(p.recordingDuration, t + len) : t + len);

/** Whole-video music with the API defaults (path chosen later in Project Settings). */
export const musicDefaults = (path = "") => ({ path, volume: API_DEFAULTS.music.volume, duckTo: API_DEFAULTS.music.duckTo });

/**
 * Merge a partial into an action and keep the data canonical:
 *  - an explicit overlay duration switches durationMode off (seconds win);
 *  - legacy narration / narration_hi writes go to narrations;
 *  - range ends never fall before the start; timestamps are clamped into the video.
 */
export function applyPartial(project: DemoProject, a: TimelineAction, partial: Partial<TimelineAction>): TimelineAction {
  const next: TimelineAction = { ...a, ...partial, id: a.id };
  if (isOverlayType(next.type) && DURATION_KEY[next.type] in partial && !("durationMode" in partial)) delete next.durationMode;
  for (const [key, lang] of [["narration", "en"], ["narration_hi", "hi"]] as const) {
    if (!(key in partial)) continue;
    const v = next[key];
    if (typeof v === "string" && v.trim()) next.narrations = { ...(next.narrations ?? {}), [lang]: v };
    delete next[key];
  }
  if ("timestamp" in partial) next.timestamp = clampTime(project, next.timestamp);
  if (isRangeType(next.type)) {
    const k = RANGE_KEY[next.type];
    const e = next[k];
    if (typeof e === "number" && e < next.timestamp) next[k] = next.timestamp;
  }
  for (const k of Object.keys(next) as (keyof TimelineAction)[]) if (next[k] === undefined) delete next[k];
  return next;
}

/** Shift actions by delta seconds (range ends too), clamped so none leaves the video.
 *  Returns the delta really applied. */
export function clampMoveDelta(project: DemoProject, moving: TimelineAction[], delta: number): number {
  if (!moving.length || !Number.isFinite(delta)) return 0;
  const minStart = Math.min(...moving.map((a) => a.timestamp));
  let d = Math.max(delta, -minStart);
  if (project.recordingDuration > 0) {
    const room = Math.min(...moving.map((a) => (isRangeType(a.type) ? project.recordingDuration - (rangeEnd(a) ?? a.timestamp) : maxStart(project) - a.timestamp)));
    d = Math.min(d, Math.max(0, room));
  }
  return r3(d);
}
export function moveAction(a: TimelineAction, d: number): TimelineAction {
  const next = { ...a, timestamp: r3(a.timestamp + d) };
  if (isRangeType(a.type)) {
    const k = RANGE_KEY[a.type];
    if (typeof a[k] === "number") next[k] = r3((a[k] as number) + d);
  }
  return next;
}

/** Split a range or overlay at t into two; null when it can't be split there. */
export function splitEffect(project: DemoProject, a: TimelineAction, t: number, newId: string): [TimelineAction, TimelineAction] | null {
  const lang = projectLanguages(project)[0];
  if (isRangeType(a.type)) {
    const k = RANGE_KEY[a.type];
    const end = rangeEnd(a) ?? a.timestamp + AUTO_FALLBACK_SEC;
    if (t <= a.timestamp + 0.05 || t >= end - 0.05) return null;
    return [{ ...a, [k]: r3(t) }, { ...structuredClone(a), id: newId, timestamp: r3(t), [k]: r3(end) }];
  }
  if (isOverlayType(a.type)) {
    const k = DURATION_KEY[a.type];
    const end = getEffectSpan(a, project, lang).end;
    if (t <= a.timestamp + 0.05 || t >= end - 0.05) return null;
    const first: TimelineAction = { ...a, [k]: r3(t - a.timestamp) };
    const second: TimelineAction = { ...structuredClone(a), id: newId, timestamp: r3(t), [k]: r3(end - t) };
    delete first.durationMode;
    delete second.durationMode;
    return [first, second];
  }
  return null;
}

export const sortActions = (actions: TimelineAction[]) => [...actions].sort((x, y) => x.timestamp - y.timestamp);
