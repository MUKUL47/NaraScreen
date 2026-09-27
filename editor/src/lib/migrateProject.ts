/** Load-time migration of demo-project.json to the v2 model (pure; runs on every load).
 *
 *  Every rule keeps what the old renderer actually produced:
 *  - pause `resumeAfter` "narration"/"zoom" → 3 (the renderer used 3 s); on other types the
 *    string is dropped (their default behaviour);
 *  - `playFor`, `musicEndTimestamp` → dropped (never rendered);
 *  - music actions → `project.music` (only the first one was ever used);
 *  - `zoomRect`/`zoomRects` → `zoomTargets`; a zoom's own narration → its first target;
 *  - `spotlightRect` → `spotlightRects`; `narration`/`narration_hi` → `narrations`;
 *  - files without `projectVersion` keep `freeze ?? false` on their narrates (the old renderer
 *    froze only on `freeze === true`); new narrates then default to the API's `true`;
 *  - `viewport`/`output` size from the real recording size when it is known.
 *  The result has `projectVersion: 2`; migrating it again changes nothing. */
import type { DemoProject, ProjectMusic, Rect, TimelineAction, ZoomTarget } from "../types";
import { API_DEFAULTS, DURATION_KEYWORDS } from "./schemaMeta";
import { DEFAULT_VOICES } from "./voices";

export interface MigrateOptions {
  /** The recording's real size (probed), when known. */
  recordingSize?: { width: number; height: number };
  /** The recording's real duration (probed), when known and the file says 0. */
  recordingDuration?: number;
}

export interface MigrateReport {
  project: DemoProject;
  /** Human-readable list of what was rewritten (empty = already v2). */
  changes: string[];
  /** Things the user should hear about (e.g. extra music tracks removed). */
  warnings: string[];
}

const ACTION_TYPES = new Set(["pause", "zoom", "narrate", "spotlight", "speed", "skip", "callout", "music", "blur", "mute"]);
const DEFAULT_ENDPOINT = API_DEFAULTS.tts.kokoroEndpoint;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const isRect = (v: unknown): v is Rect => Array.isArray(v) && v.length === 4 && v.every((x) => typeof x === "number" && Number.isFinite(x));
const nonEmpty = (m: Record<string, string> | undefined) => !!m && Object.values(m).some((t) => typeof t === "string" && t.trim());

/** A fresh project for a new recording or import. */
export function newProject(init: { title: string; baseUrl: string; recordingPath: string; recordingDuration?: number; size?: { width: number; height: number } }): DemoProject {
  const size = init.size ?? { width: 1920, height: 1080 };
  return {
    title: init.title,
    baseUrl: init.baseUrl,
    recordingPath: init.recordingPath,
    recordingDuration: init.recordingDuration ?? 0,
    viewport: { ...size },
    output: { ...size, fps: 30, format: "mp4", resolution: API_DEFAULTS.output.resolution, quality: API_DEFAULTS.output.quality },
    tts: {
      provider: "kokoro",
      kokoroEndpoint: DEFAULT_ENDPOINT,
      voiceEn: DEFAULT_VOICES.en[0],
      voiceHi: DEFAULT_VOICES.hi[0],
      speed: API_DEFAULTS.tts.speed,
      voices: { en: [...DEFAULT_VOICES.en] },
      languages: [...API_DEFAULTS.script.languages],
    },
    actions: [],
    projectVersion: 2,
  };
}

/** Migrate and report what changed. Throws only when `raw` is not a project object at all. */
export function migrateProjectWithReport(raw: unknown, opts: MigrateOptions = {}): MigrateReport {
  if (!isObj(raw)) throw new Error("demo-project.json is not a JSON object");
  const changes: string[] = [];
  const warnings: string[] = [];
  const src = structuredClone(raw) as Obj;
  const wasV2 = src.projectVersion === 2;

  const base = newProject({
    title: typeof src.title === "string" && src.title.trim() ? src.title : "Untitled",
    baseUrl: typeof src.baseUrl === "string" ? src.baseUrl : "",
    recordingPath: typeof src.recordingPath === "string" ? src.recordingPath : "",
    recordingDuration: num(src.recordingDuration) ?? 0,
  });
  const p: DemoProject = { ...(src as unknown as DemoProject) };
  p.title = base.title;
  p.baseUrl = base.baseUrl;
  p.recordingPath = base.recordingPath;
  p.recordingDuration = base.recordingDuration;
  if (!(p.recordingDuration > 0) && opts.recordingDuration && opts.recordingDuration > 0) {
    p.recordingDuration = opts.recordingDuration;
    changes.push("recordingDuration from the recording");
  }
  const vp = isObj(src.viewport) ? src.viewport : {};
  p.viewport = { width: num(vp.width) ?? base.viewport.width, height: num(vp.height) ?? base.viewport.height };
  const out = isObj(src.output) ? src.output : {};
  p.output = { ...base.output, ...(out as Partial<DemoProject["output"]>) };
  if (out.resolution == null) delete p.output.resolution;
  if (out.quality == null) delete p.output.quality;
  const size = opts.recordingSize;
  if (size && size.width > 0 && size.height > 0 && (p.viewport.width !== size.width || p.viewport.height !== size.height)) {
    changes.push(`viewport ${p.viewport.width}x${p.viewport.height} → ${size.width}x${size.height} (the recording's size)`);
    p.viewport = { width: size.width, height: size.height };
    p.output = { ...p.output, width: size.width, height: size.height };
  }
  const tts = isObj(src.tts) ? src.tts : {};
  p.tts = { ...base.tts, ...(tts as Partial<DemoProject["tts"]>) };
  if (!isObj(tts.voices)) delete p.tts.voices;
  if (!Array.isArray(tts.languages)) delete p.tts.languages;
  if (typeof p.tts.kokoroEndpoint !== "string" || !p.tts.kokoroEndpoint) p.tts.kokoroEndpoint = DEFAULT_ENDPOINT;

  // actions
  const seen = new Set<string>();
  const actions: TimelineAction[] = [];
  const music: TimelineAction[] = [];
  let counter = 0;
  for (const r of Array.isArray(src.actions) ? src.actions : []) {
    if (!isObj(r) || typeof r.type !== "string" || !ACTION_TYPES.has(r.type)) {
      warnings.push(`Dropped an unreadable action (${isObj(r) ? String(r.type) : typeof r}).`);
      continue;
    }
    const a = r as unknown as TimelineAction;
    a.timestamp = Math.max(0, num(a.timestamp) ?? 0);
    if (typeof a.id !== "string" || !a.id || seen.has(a.id)) {
      do a.id = `action-m${++counter}`;
      while (seen.has(a.id));
      changes.push("gave an action a unique id");
    }
    seen.add(a.id);
    if (a.type === "music") music.push(a);
    else actions.push(migrateAction(a, wasV2, changes));
  }
  if (music.length) {
    const first = music[0];
    if (!p.music && first.musicPath) {
      p.music = {
        path: first.musicPath,
        volume: num(first.musicVolume) ?? API_DEFAULTS.music.volume,
        duckTo: num(first.musicDuckTo) ?? API_DEFAULTS.music.duckTo,
      } satisfies ProjectMusic;
    }
    changes.push("music action → project music");
    if (music.length > 1) warnings.push(`Removed ${music.length - 1} extra music track${music.length > 2 ? "s" : ""}: only the first one was ever used.`);
  }
  p.actions = actions.sort((x, y) => x.timestamp - y.timestamp);
  if (p.music && !isObj(p.music)) delete p.music;
  if (!wasV2) changes.push("projectVersion 2");
  p.projectVersion = 2;
  return { project: p, changes, warnings };
}

/** Migrate a raw demo-project.json (see migrateProjectWithReport). */
export function migrateProject(raw: unknown, opts: MigrateOptions = {}): DemoProject {
  return migrateProjectWithReport(raw, opts).project;
}

function migrateAction(a: TimelineAction, wasV2: boolean, changes: string[]): TimelineAction {
  const note = (what: string) => changes.push(`${a.id}: ${what}`);
  if (typeof a.resumeAfter === "string") {
    if (a.type === "pause") a.resumeAfter = API_DEFAULTS.pause.seconds;
    else delete a.resumeAfter;
    note("resumeAfter → seconds");
  }
  if ("playFor" in a) (delete a.playFor, note("dropped playFor"));
  if ("musicEndTimestamp" in a) (delete a.musicEndTimestamp, note("dropped musicEndTimestamp"));
  if (a.durationMode != null && !(DURATION_KEYWORDS as readonly string[]).includes(a.durationMode)) delete a.durationMode;

  // legacy narration fields → narrations (the renderer preferred narrations[lang] already)
  if (typeof a.narration === "string" || typeof a.narration_hi === "string") {
    const m = { ...(a.narrations ?? {}) };
    if (a.narration?.trim() && !m.en?.trim()) m.en = a.narration;
    if (a.narration_hi?.trim() && !m.hi?.trim()) m.hi = a.narration_hi;
    if (Object.keys(m).length) a.narrations = m;
    delete a.narration;
    delete a.narration_hi;
    note("narration → narrations");
  }

  if (a.type === "zoom") {
    if (!a.zoomTargets?.length) {
      const rects = a.zoomRects?.length ? a.zoomRects : a.zoomRect ? [a.zoomRect] : [];
      if (rects.length) {
        a.zoomTargets = rects.filter(isRect).map((rect) => ({ rect }));
        note("zoomRect(s) → zoomTargets");
      }
    }
    if (a.zoomRect || a.zoomRects) (delete a.zoomRect, delete a.zoomRects);
    // The renderer spoke a zoom's own narration during its first target (when that had none).
    const own = nonEmpty(a.narrations) || nonEmpty(a.audioPath) || !!a.customAudioPath;
    if (own && a.zoomTargets?.length) {
      const t0: ZoomTarget = a.zoomTargets[0];
      if (!nonEmpty(t0.narrations) && !nonEmpty(t0.audioPath) && !t0.customAudioPath) {
        a.zoomTargets = [
          {
            ...t0,
            ...(nonEmpty(a.narrations) ? { narrations: a.narrations } : {}),
            ...(nonEmpty(a.audioPath) ? { audioPath: a.audioPath } : {}),
            ...(a.customAudioPath ? { customAudioPath: a.customAudioPath } : {}),
            ...(a.customAudioPaths ? { customAudioPaths: a.customAudioPaths } : {}),
            ...(a.audioDuration ? { audioDuration: a.audioDuration } : {}),
            ...(a.audioTextHash ? { audioTextHash: a.audioTextHash } : {}),
          },
          ...a.zoomTargets.slice(1),
        ];
        note("zoom narration → first target");
      }
      for (const k of ["narrations", "audioPath", "customAudioPath", "customAudioPaths", "audioDuration", "audioTextHash"] as const) delete a[k];
    }
  }

  if (a.type === "spotlight" && a.spotlightRect) {
    if (!a.spotlightRects?.length && isRect(a.spotlightRect)) a.spotlightRects = [a.spotlightRect];
    delete a.spotlightRect;
    note("spotlightRect → spotlightRects");
  }

  if (a.type === "narrate" && !wasV2 && a.freeze === undefined) {
    a.freeze = false; // the old renderer froze only on freeze === true
    note("freeze → false (as rendered before)");
  }
  return a;
}
