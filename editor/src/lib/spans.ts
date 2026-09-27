/** Honest effect spans for display (D26) and the narration rules they rest on.
 *
 *  Pure (no window, no fs). The narration helpers mirror the CLI (api/narration.ts
 *  resolveNarration / scriptVoice / clipFileName inputs) so what the desktop previews is what
 *  `narascreen make` renders; `modelOutput` ports the compiler's modelTimeline (api/compiler.ts)
 *  for output-length estimates and the spotlight-overlap pre-check in lib/issues.ts. */
import type { DemoProject, TimelineAction, ZoomTarget } from "../types";
import { AUTO_FALLBACK_SEC, API_DEFAULTS, clampToMeta, defaultVoice, numberMeta } from "./schemaMeta";

// ─── languages, voices, speed ────────────────────────────────────────

/** The languages this project produces (tts.languages, default ["en"]). */
export function projectLanguages(p: Pick<DemoProject, "tts">): string[] {
  const l = p.tts?.languages?.filter(Boolean);
  return l?.length ? [...new Set(l)] : ["en"];
}

/** Speech speed as the CLI sees it (clamped to the schema; part of the TTS cache key). */
export function ttsSpeed(p: Pick<DemoProject, "tts">): number {
  return clampToMeta(numberMeta("tts", "speed"), p.tts?.speed ?? API_DEFAULTS.tts.speed);
}

/** Project default voice for a language: voices[lang][0] → legacy voiceEn/voiceHi → catalog. */
export function projectVoice(p: Pick<DemoProject, "tts">, lang: string): string {
  return (
    p.tts?.voices?.[lang]?.[0] ??
    (lang === "en" ? p.tts?.voiceEn || undefined : undefined) ??
    (lang === "hi" ? p.tts?.voiceHi || undefined : undefined) ??
    defaultVoice(lang)
  );
}

// ─── who speaks, what, in which voice ────────────────────────────────

/** The object that carries narration: the action itself, or one of its zoom targets. */
export function speakerOf(action: TimelineAction, target?: number): TimelineAction | ZoomTarget | undefined {
  return target == null ? action : action.zoomTargets?.[target];
}

/** Language a line is spoken in when `lang` is produced (a forced `lang` wins). */
export function spokenLang(action: TimelineAction, lang: string, target?: number): string {
  const t = target != null ? action.zoomTargets?.[target] : undefined;
  return t?.lang ?? action.lang ?? lang;
}

function textMap(s: TimelineAction | ZoomTarget): Record<string, string> {
  const m: Record<string, string> = { ...(s.narrations ?? {}) };
  const legacy = s as TimelineAction;
  if (legacy.narration?.trim() && !m.en?.trim()) m.en = legacy.narration;
  if (legacy.narration_hi?.trim() && !m.hi?.trim()) m.hi = legacy.narration_hi;
  return m;
}

/** Text spoken for `lang` (API resolveNarration: the language's text, else the "en" fallback). */
export function narrationTextFor(
  action: TimelineAction,
  lang: string,
  target?: number,
): { lang: string; text: string; fallback: boolean } | null {
  const s = speakerOf(action, target);
  if (!s) return null;
  const want = spokenLang(action, lang, target);
  const m = textMap(s);
  if (m[want]?.trim()) return { lang: want, text: m[want], fallback: false };
  if (m.en?.trim()) return { lang: "en", text: m.en, fallback: want !== "en" };
  return null;
}

/** Recorded audio for `lang`: customAudioPaths[lang] → customAudioPath (all languages) → customAudioPaths.en. */
export function recordedAudioFor(action: TimelineAction, lang: string, target?: number): string | undefined {
  const s = speakerOf(action, target);
  if (!s) return undefined;
  const want = spokenLang(action, lang, target);
  return s.customAudioPaths?.[want] || s.customAudioPath || s.customAudioPaths?.en || undefined;
}

/** Voice the CLI uses for this line (resolveVoice): target → zoom/narrate → project default.
 *  A line that fell back to "en" text is read by the English default voice. */
export function narrationVoice(project: Pick<DemoProject, "tts">, action: TimelineAction, lang: string, target?: number): string {
  const n = narrationTextFor(action, lang, target);
  const spoken = n?.lang ?? spokenLang(action, lang, target);
  if (n?.fallback) return projectVoice(project, spoken);
  const t = target != null ? action.zoomTargets?.[target] : undefined;
  return t?.voice ?? action.voice ?? projectVoice(project, spoken);
}

/** Does this action (or target) say anything in `lang`? */
export function speaks(action: TimelineAction, lang: string, target?: number): boolean {
  return !!narrationTextFor(action, lang, target) || !!recordedAudioFor(action, lang, target);
}

/** Stable, sync 53-bit hash (cyrb53) as 14 hex chars. */
function cyrb53(str: string): string {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, "0");
}

/** What a narration clip was generated from (stored in audioTextHash[lang]). */
export function narrationHash(lang: string, voice: string, speed: number, text: string): string {
  return cyrb53(`${lang}|${voice}|${speed}|${text}`);
}

/** The hash the current text/voice/speed would give (null when nothing is spoken). */
export function currentNarrationHash(project: Pick<DemoProject, "tts">, action: TimelineAction, lang: string, target?: number): string | null {
  const n = narrationTextFor(action, lang, target);
  if (!n) return null;
  return narrationHash(n.lang, narrationVoice(project, action, lang, target), ttsSpeed(project), n.text);
}

/** Seconds of speech for `chars` characters (api/validate.ts speechSec: ≈ 0.2 s + 1 s per 16.8 chars). */
export function speechSec(chars: number, speed = 1): number {
  return chars > 0 ? (0.2 + chars / 16.8) / speed : 0;
}
/** A recorded file's length is unknown until probed (api/validate.ts uses the same guess). */
export const RECORDED_AUDIO_GUESS_SEC = 4;
/** Overlays and narrations run this long past the last word (compiler NARRATION_TAIL_SEC). */
export const NARRATION_TAIL_SEC = 0.5;

/** How long a line lasts in `lang`: the generated clip when it is current, else an estimate. */
export function narrationSeconds(
  project: Pick<DemoProject, "tts">,
  action: TimelineAction,
  lang: string,
  target?: number,
): { sec: number; estimated: boolean } | null {
  const s = speakerOf(action, target);
  if (!s) return null;
  const n = narrationTextFor(action, lang, target);
  const recorded = recordedAudioFor(action, lang, target);
  const key = n?.lang ?? spokenLang(action, lang, target);
  const clip = s.audioDuration?.[key];
  if (clip != null && clip > 0) {
    const stored = s.audioTextHash?.[key];
    if (recorded || !stored || stored === currentNarrationHash(project, action, lang, target)) return { sec: clip, estimated: false };
  }
  if (recorded) return { sec: RECORDED_AUDIO_GUESS_SEC, estimated: true };
  if (!n) return null;
  return { sec: speechSec(n.text.length, ttsSpeed(project)), estimated: true };
}

// ─── the output timeline (port of api/compiler.ts modelTimeline) ─────

const FPS = 30;
const frames = (sec: number) => Math.max(Math.round(FPS * sec), 2) / FPS;
type Range = { start: number; end: number };

export interface OutputInsert {
  action: TimelineAction;
  /** post-skip/speed seconds where it happens */
  at: number;
  /** seconds of video it contributes / really adds */
  length: number;
  added: number;
  /** start on the final timeline */
  start: number;
  holds?: { start: number; length: number; narrated: boolean }[];
}
export interface OutputModel {
  inserts: OutputInsert[];
  /** recording seconds → post-skip/speed seconds */
  mapped(t: number): number;
  /** where an overlay stamped at recording time t starts on the final timeline */
  placed(t: number): number;
  /** final-timeline time of post-skip/speed position m */
  realAt(m: number): number;
  /** post-skip/speed positions of skip cuts and speed edges */
  boundaries: number[];
  sourceSec: number;
  /** estimated length of the rendered video (cards excluded) */
  outputSec: number;
  addedSec: number;
  cutSec: number;
  /** seconds saved (> 0) or added (< 0) by speed ranges */
  speedSec: number;
  estimated: boolean;
}

export const isEnabled = (a: TimelineAction) => !a.disabled;
export const rangeEnd = (a: TimelineAction): number | undefined =>
  a.type === "speed" ? a.speedEndTimestamp : a.type === "skip" ? a.skipEndTimestamp : a.type === "mute" ? a.muteEndTimestamp : undefined;

function skipRemap(ranges: Range[]): (t: number) => number {
  return (t) => {
    let offset = 0;
    for (const r of ranges) {
      if (r.end <= t) offset += r.end - r.start;
      else if (r.start < t) return r.start - offset;
    }
    return t - offset;
  };
}
function speedRemap(ranges: (Range & { factor: number })[]): (t: number) => number {
  return (t) => {
    let out = 0, cursor = 0;
    for (const r of ranges) {
      if (t <= r.start) return out + (t - cursor);
      out += r.start - cursor;
      cursor = r.start;
      if (t <= r.end) return out + (t - r.start) / r.factor;
      out += (r.end - r.start) / r.factor;
      cursor = r.end;
    }
    return out + (t - cursor);
  };
}

/** How the renderer lays out the enabled effects of `project` when `lang` is produced. */
export function modelOutput(project: DemoProject, lang: string): OutputModel {
  const acts = project.actions.filter(isEnabled);
  const dur = project.recordingDuration || 0;
  let estimated = false;
  const sec = (a: TimelineAction, target?: number) => {
    const s = narrationSeconds(project, a, lang, target);
    if (s?.estimated) estimated = true;
    return s?.sec;
  };
  const skips = acts
    .filter((a) => a.type === "skip" && a.skipEndTimestamp != null && a.skipEndTimestamp > a.timestamp)
    .map((a) => ({ start: a.timestamp, end: Math.min(a.skipEndTimestamp!, dur || Infinity) }))
    .sort((x, y) => x.start - y.start);
  const skipMap = skipRemap(skips);
  const speeds = acts
    .filter((a) => a.type === "speed" && a.speedEndTimestamp != null && a.speedFactor)
    .map((a) => ({ start: skipMap(a.timestamp), end: skipMap(a.speedEndTimestamp!), factor: a.speedFactor! }))
    .filter((r) => r.end > r.start + 0.05)
    .sort((x, y) => x.start - y.start);
  const speedMap = speedRemap(speeds);
  const mapped = (t: number) => speedMap(skipMap(t));

  const hasZoomRect = (a: TimelineAction) => !!(a.zoomTargets?.length || a.zoomRect || a.zoomRects?.length);
  const ordered = [
    ...acts.filter((a) => a.type === "zoom" && hasZoomRect(a)),
    ...acts.filter((a) => a.type === "pause"),
    ...acts.filter((a) => a.type === "narrate" && speaks(a, lang)),
  ]
    .map((a) => ({ a, at: mapped(a.timestamp) }))
    .sort((x, y) => x.at - y.at);

  const recordingEnd = dur ? mapped(dur) : undefined;
  const inserts: OutputInsert[] = [];
  let shift = 0, cursor = 0;
  for (const { a, at: stamped } of ordered) {
    const at = stamped < cursor + 0.05 ? cursor : stamped;
    let length: number, added: number;
    let holds: OutputInsert["holds"];
    if (a.type === "zoom") {
      const half = frames(a.zoomDuration ?? API_DEFAULTS.zoom.zoomDuration);
      const n = a.zoomTargets?.length || a.zoomRects?.length || 1;
      holds = [];
      let off = 0;
      for (let k = 0; k < n; k++) {
        const s = a.zoomTargets?.length && speaks(a, lang, k) ? sec(a, k) : undefined;
        off += half;
        const hold = s ?? frames(a.zoomHold ?? API_DEFAULTS.zoom.zoomHold);
        holds.push({ start: off, length: hold, narrated: s != null });
        off += hold + half;
      }
      length = added = off;
    } else if (a.type === "pause") {
      length = added = typeof a.resumeAfter === "number" ? a.resumeAfter : API_DEFAULTS.pause.seconds;
    } else {
      const clip = sec(a) ?? AUTO_FALLBACK_SEC;
      if (a.freeze !== false) {
        length = added = clip;
      } else {
        length = clip + NARRATION_TAIL_SEC;
        const consumed = recordingEnd != null ? Math.max(0, Math.min(length, recordingEnd - at)) : length;
        added = length - consumed;
        cursor = at + consumed;
      }
    }
    if (a.type !== "narrate" || a.freeze !== false) cursor = at;
    inserts.push({ action: a, at, length, added, start: at + shift, ...(holds ? { holds } : {}) });
    shift += added;
  }
  const sumBefore = (m: number) => inserts.reduce((s, sp) => (sp.at < m ? s + sp.added : s), 0);
  const boundaries = [...skips.map((r) => mapped(r.start)), ...speeds.flatMap((r) => [speedMap(r.start), speedMap(r.end)])].sort((x, y) => x - y);
  const cutSec = skips.reduce((s, r) => s + (r.end - r.start), 0);
  const afterCuts = Math.max(0, dur - cutSec);
  const afterSpeed = dur ? mapped(dur) : 0;
  return {
    inserts,
    mapped,
    placed: (t) => mapped(t) + sumBefore(mapped(t)),
    realAt: (m) => m + sumBefore(m),
    boundaries,
    sourceSec: dur,
    outputSec: afterSpeed + shift,
    addedSec: shift,
    cutSec,
    speedSec: afterCuts - afterSpeed,
    estimated,
  };
}

// ─── spans ───────────────────────────────────────────────────────────

export interface EffectSpan {
  /** recording seconds */
  start: number;
  end: number;
  /** true when a narration length is an estimate (no current clip) */
  estimated: boolean;
  /** seconds of frozen/zoomed video this effect inserts into the output */
  inserts: number;
}

/** Numeric duration of an overlay (seconds, when durationMode is unset). */
export function overlaySeconds(a: TimelineAction): number {
  const d = a.type === "spotlight" ? a.spotlightDuration : a.type === "blur" ? a.blurDuration : a.type === "callout" ? a.calloutDuration : undefined;
  return d ?? AUTO_FALLBACK_SEC;
}

const isOverlay = (a: TimelineAction) => a.type === "spotlight" || a.type === "blur" || a.type === "callout";

/**
 * Where an effect sits on the (source-time) timeline, following the renderer's rules:
 *  - narrate: the clip (or an estimate from the text) + 0.5 s;
 *  - zoom: Σ targets (in + hold + out), hold = the target's speech when narrated, else zoomHold;
 *  - pause: its seconds; speed/skip/mute: start → end;
 *  - spotlight/callout/arrow/blur: seconds, or durationMode "auto" = until the next narration
 *    ends (else 3 s), "step-end"/"end" = the end of the video;
 *  - music: the whole video.
 */
export function getEffectSpan(action: TimelineAction, project: DemoProject, lang: string): EffectSpan {
  const start = action.timestamp;
  const dur = project.recordingDuration || 0;
  const done = (end: number, estimated = false, inserts = 0): EffectSpan => ({ start, end: Math.max(end, start), estimated, inserts });
  switch (action.type) {
    case "narrate": {
      const s = narrationSeconds(project, action, lang);
      const len = (s?.sec ?? AUTO_FALLBACK_SEC) + NARRATION_TAIL_SEC;
      return done(start + len, s?.estimated ?? true, action.freeze === false ? 0 : s?.sec ?? AUTO_FALLBACK_SEC);
    }
    case "zoom": {
      const half = frames(action.zoomDuration ?? API_DEFAULTS.zoom.zoomDuration);
      const n = action.zoomTargets?.length || action.zoomRects?.length || 1;
      let total = 0;
      let estimated = false;
      for (let k = 0; k < n; k++) {
        const s = action.zoomTargets?.length && speaks(action, lang, k) ? narrationSeconds(project, action, lang, k) : null;
        if (s?.estimated) estimated = true;
        total += 2 * half + (s?.sec ?? frames(action.zoomHold ?? API_DEFAULTS.zoom.zoomHold));
      }
      return done(start + total, estimated, total);
    }
    case "pause": {
      const s = typeof action.resumeAfter === "number" ? action.resumeAfter : API_DEFAULTS.pause.seconds;
      return done(start + s, false, s);
    }
    case "speed":
    case "skip":
    case "mute":
      return done(rangeEnd(action) ?? start + AUTO_FALLBACK_SEC);
    case "music":
      return { start: 0, end: dur, estimated: false, inserts: 0 };
    default: {
      if (!isOverlay(action)) return done(start + 1);
      const mode = action.durationMode;
      if (mode === "end" || mode === "step-end") return done(Math.max(dur, start + 0.5));
      if (mode !== "auto") return done(start + overlaySeconds(action));
      const acts = project.actions;
      const i = acts.indexOf(action);
      const next = acts.find(
        (o, k) => k > i && o.timestamp >= start && isEnabled(o) && (o.type === "narrate" ? speaks(o, lang) : o.type === "zoom" && (o.zoomTargets ?? []).some((_, t) => speaks(o, lang, t))),
      );
      if (!next) return done(start + AUTO_FALLBACK_SEC);
      const ns = getEffectSpan(next, project, lang);
      return done(Math.max(start + 0.5, ns.end), ns.estimated);
    }
  }
}

/** Spans of every action, keyed by id (one pass; for timelines and overlap checks). */
export function effectSpans(project: DemoProject, lang: string): Map<string, EffectSpan> {
  return new Map(project.actions.map((a) => [a.id, getEffectSpan(a, project, lang)]));
}
