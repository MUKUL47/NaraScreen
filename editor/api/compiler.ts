// ─── compiler: demo-script + trace (+ narration clips) → NaraScreen actions ──
//
// PURE: no video, no filesystem. Joins each `fx` entry in the script with its
// trace entry (by {beat, i}) and emits one NaraScreen action (the shape
// electron/produce.ts consumes). `act` entries emit nothing — they only drove
// the browser (but range fx may end at one). Disabled fx emit nothing either;
// the script-level `music` becomes one music action.
//
// The one non-trivial job is "auto" overlay durations (spotlight / callout
// that should stay up while the narration that follows is spoken). The
// producer first cuts skips and applies speed ramps (and burns blurs there, so
// blur durations are plain recording seconds — see resolveBlur), then inserts
// freeze frames (pause, zoom, narrate) at fx timestamps, and draws spotlights
// and callouts LAST, remapping
// only their START: an overlay whose source time is t_i is drawn from
// placed(t_i) to placed(t_i) + duration on the final timeline. So the duration
// has to include everything the overlay lives through. `modelTimeline`
// reproduces the producer's skip/speed remap and insert pass (order, lengths,
// bookkeeping) so these numbers match what produce.ts really renders.

import { pluginsFor } from "./plugins";
import { AgentError, type AgentErrorInit } from "./errors";
import {
  narrationLanguageNote,
  narrationSlots,
  resolveAudio,
  resolveNarration,
  type NarrationClip,
  type NarrationSource,
} from "./narration";
import { RANGE_DEFAULT_UNTIL } from "./schema";
import {
  BUILTIN_DEFAULTS,
  isAct,
  isFx,
  type DemoDefaults,
  type DemoScript,
  type FxEntry,
  type NaraAction,
  type Rect,
  type TraceEntry,
} from "./types";

/** The script and its recording can't be joined (code COMPILE_FAILED). */
export class CompileError extends AgentError {
  constructor(message: string, init: AgentErrorInit = {}) {
    super("COMPILE_FAILED", message, {
      ...init,
      hint:
        init.hint ??
        "The recording's trace does not match the script. Re-record (`narascreen record <script> --out <job> --force`, or `make --force`) and produce again.",
    });
    this.name = "CompileError";
  }
}

/**
 * Extra timing the runner records per trace slot (traces from older recordings
 * lack it; everything falls back to `t`).
 */
export type TimedTraceEntry = TraceEntry & {
  /** When the entry began running (a step begins at its first entry's `start`). */
  start?: number;
  /** When an act had finished, if that is later than `t` (a click is stamped at the click itself). */
  end?: number;
};

export interface CompileOptions {
  /** Recording length — where "step-end" of the last step (and every range) ends.
   *  Without it: the last trace timestamp + 0.5 s. */
  durationSec?: number;
}

/** Overlay fallback when no narration follows (and the schema's default). */
export const AUTO_FALLBACK_SEC = 3;
/** Spotlight/callout "end" windows run this far past the MODELLED end of the
 *  final video (its real length is only known after rendering; the renderer
 *  clamps every overlay to it), so model error can't cut them short. */
export const END_OPEN_SEC = 60;
/** Blur runs on the recording timeline, whose end is known exactly: "end"
 *  just adds a hair so the last frame is inside the window. */
export const BLUR_END_PAD_SEC = 0.1;
/** Shortest overlay "auto" ever produces. */
export const AUTO_MIN_SEC = 0.5;
/** Overlays stay up this long after their narration's last word. */
export const NARRATION_TAIL_SEC = 0.5;
/** Gap kept before a zoom / range boundary / the next overlay of the same kind. */
const CAP_GAP_SEC = 0.05;
/** Ranges shorter than this are dropped (the producer ignores them too). */
const MIN_RANGE_SEC = 0.05;
const FPS = 30; // produce.ts renders inserts at 30 fps
const CALLOUT_FONT = 28;
const EDGE = 8; // keep callout panels this far inside the frame
/** Height of libass's line box per px of callout fontSize (produce.ts ASS_FONT_SCALE). */
const LINE = 1.25;
/** Box padding of positioned callouts, x and y (produce.ts PANEL_PAD). */
const PANEL_PAD = { label: { x: 10, y: 6 }, step: { x: 12, y: 7 } } as const;
/** Gap between a label's box and its element. */
const PANEL_GAP = 6;

type Speaker = ReturnType<typeof narrationSlots>[number];

// ─── one fx entry, joined with its trace slot ────────────────────────

interface Slot {
  s: number; // step index
  i: number; // entry index in the step
  step: string;
  path: string; // steps[s].beat[i]
  fx: FxEntry;
  t: number;
  action: NaraAction;
  /** narration clips of this entry (one, or one per speaking zoom target) */
  clips: NarrationClip[];
  /** how the overlay's duration is decided (only meaningful for overlays) */
  mode: DurationMode;
  /** "step-end" / "end": the recording time the window ends at */
  windowEnd?: number;
}

interface EmitCtx {
  d: DemoDefaults;
  lang: string;
  viewport: { width: number; height: number };
  ctx: string;
  where: AgentErrorInit["where"];
  /** `${step}:${i}` — zoom targets append `:t${k}` */
  key: string;
  speakers: Map<string, Speaker>;
  clips?: Map<string, NarrationClip>;
}

function indexTrace(trace: TraceEntry[]): Map<string, TraceEntry> {
  const m = new Map<string, TraceEntry>();
  for (const e of trace) m.set(`${e.beat}:${e.i}`, e);
  return m;
}

function isOverlay(fx: FxEntry): boolean {
  return fx.fx === "spotlight" || fx.fx === "callout" || fx.fx === "blur" || fx.fx === "arrow";
}
function isRange(fx: FxEntry): fx is FxEntry & { fx: "speed" | "skip" | "mute" } {
  return fx.fx === "speed" || fx.fx === "skip" || fx.fx === "mute";
}

/** fixed seconds · "auto" (until the next narration in the step) · "step-end"
 *  (until the step ends) · "end" (until the video ends) */
type DurationMode = "fixed" | "auto" | "step-end" | "end";

function overlayDuration(fx: FxEntry): { value: number; mode: DurationMode } {
  if (typeof fx.duration === "number") return { value: fx.duration, mode: "fixed" };
  if (fx.duration === "step-end" || fx.duration === "end") return { value: AUTO_FALLBACK_SEC, mode: fx.duration };
  if (fx.duration === "auto") return { value: AUTO_FALLBACK_SEC, mode: "auto" };
  // Unset: a blur hides something, so it stays for the whole step instead of
  // lifting as soon as the next narration ends; other overlays follow "auto".
  return { value: AUTO_FALLBACK_SEC, mode: fx.fx === "blur" ? "step-end" : "auto" };
}

/** The next step's trace slots, in order (none for the last step). */
function nextStepSlots(script: DemoScript, byKey: Map<string, TraceEntry>, k: number): TimedTraceEntry[] {
  const next = script.steps[k + 1];
  if (!next) return [];
  return next.beat.map((_, j) => byKey.get(`${next.id}:${j}`)).filter((x): x is TimedTraceEntry => x != null);
}

/** Where step k ends in recording time: when the next step BEGINS (its first
 *  entry started running — before that entry scrolls or clicks anything), or
 *  the recording end for the last step (shared by ranges and overlays). Traces
 *  from older recordings have no start times: the next step's first slot time. */
function stepEndTime(script: DemoScript, byKey: Map<string, TraceEntry>, k: number, endOfRecording: number): number {
  const slots = nextStepSlots(script, byKey, k);
  if (!slots.length) return endOfRecording;
  const starts = slots.map((e) => e.start).filter((x): x is number => x != null);
  return Math.min(...(starts.length ? starts : slots.map((e) => e.t)));
}

/** "step-end" for a BLUR: the secret may still be on screen while the next
 *  step's first entry runs (the click that navigates away), so the blur holds
 *  until that entry has finished; never before the step boundary itself. */
function blurStepEndTime(script: DemoScript, byKey: Map<string, TraceEntry>, k: number, endOfRecording: number): number {
  const slots = nextStepSlots(script, byKey, k);
  const boundary = stepEndTime(script, byKey, k, endOfRecording);
  if (!slots.length) return boundary;
  const first = slots[0];
  return Math.min(endOfRecording, Math.max(boundary, first.end ?? first.t));
}

/** The fields that make one narration audible to the producer.
 *  Recorded audio WITH text goes in audioPath (+ narrations) because the
 *  producer drops the text of customAudioPath — and with it the subtitles. */
function narrationFields(
  src: NarrationSource,
  lang: string,
  clip: NarrationClip | undefined,
  fail: (msg: string, hint?: string) => CompileError,
  what: string,
): Pick<NaraAction, "narrations" | "audioPath" | "customAudioPath"> {
  const narr = resolveNarration(src, lang);
  const audio = resolveAudio(src, lang);
  if (audio) {
    return narr
      ? { narrations: { [narr.lang]: narr.text }, audioPath: { [narr.lang]: audio.path } }
      : { customAudioPath: audio.path };
  }
  if (!narr) throw fail(`${what} (for lang "${lang}")`, `Add "${lang}" (or "en") to this entry's narrate map, or give it \`audio\`.`);
  return { narrations: { [narr.lang]: narr.text }, ...(clip ? { audioPath: { [narr.lang]: clip.audioPath } } : {}) };
}

/** Grow a box by `p` px on every side, kept inside the frame. */
function padRect([x, y, w, h]: Rect, p: number, vp: { width: number; height: number }): Rect {
  const x0 = Math.max(0, x - p);
  const y0 = Math.max(0, y - p);
  const x1 = Math.min(vp.width, x + w + p);
  const y1 = Math.min(vp.height, y + h + p);
  return [Math.round(x0), Math.round(y0), Math.round(x1 - x0), Math.round(y1 - y0)];
}

/** A label callout as one positioned panel: above its element by default,
 *  below when there is no room, or over it; kept inside the frame (text width
 *  estimated at 0.6·fontSize per character). The panel's rect is where the TEXT
 *  starts; the box libass draws around it is LINE·fontSize + 2·pad.y tall
 *  (55 px at 28 px before, when "above" only left fontSize + 16 px for it, so the
 *  box overhung the element and reached far into what sits above it). Now its
 *  bottom sits PANEL_GAP px above the element (its top PANEL_GAP px below it for
 *  "below"), and its left edge lines up with the element's. Lower-thirds only
 *  get a panel when they set a fontSize (else the producer centers its own banner). */
function calloutPanel(
  fx: FxEntry,
  text: string,
  rect: Rect | undefined,
  vp: { width: number; height: number },
): NonNullable<NaraAction["calloutPanels"]>[number] | undefined {
  const shown = fx.style === "step-counter" && fx.step ? `Step ${fx.step}: ${text}` : text;
  if (fx.style === "lower-third") {
    if (fx.fontSize == null) return undefined;
    const f = fx.fontSize;
    const w = Math.round(0.6 * f * shown.length);
    // Same baseline rule as the producer's own lower-third (36 px → h − 80).
    return { text, rect: [Math.max(EDGE, Math.round((vp.width - w) / 2)), vp.height - 44 - f, w, f], fontSize: f };
  }
  if (!rect) return undefined;
  const f = fx.fontSize ?? CALLOUT_FONT;
  const pad = fx.style === "step-counter" ? PANEL_PAD.step : PANEL_PAD.label;
  const w = Math.round(0.6 * f * shown.length);
  const [rx, ry, , rh] = rect;
  // y = the text's top; the box spans y − pad.y … y + LINE·f + pad.y.
  const above = ry - PANEL_GAP - pad.y - LINE * f;
  const below = ry + rh + PANEL_GAP + pad.y;
  const placement = fx.placement ?? "above";
  let y = placement === "over" ? ry + pad.y : placement === "below" ? below : above - pad.y < EDGE ? below : above;
  const x = Math.max(EDGE + pad.x, Math.min(rx + pad.x, vp.width - w - EDGE - pad.x));
  y = Math.max(EDGE + pad.y, Math.min(y, vp.height - EDGE - pad.y - LINE * f));
  return { text, rect: [Math.round(x), Math.round(y), w, f], fontSize: f };
}

/** A text callout's box on screen as produce.ts draws it (text width estimated
 *  generously); undefined for arrows and non-callouts. */
function calloutBox(a: NaraAction, vp: { width: number; height: number }): Rect | undefined {
  if (a.type !== "callout" || a.calloutStyle === "arrow") return undefined;
  const style = a.calloutStyle ?? "label";
  const text = a.calloutText ?? a.calloutPanels?.[0]?.text ?? "";
  const shown = style === "step-counter" && a.calloutStep ? `Step ${a.calloutStep}: ${text}` : text;
  const width = (fs: number) => 0.6 * fs * shown.length;
  const p = a.calloutPanels?.[0];
  if (p) {
    const pad = style === "step-counter" ? PANEL_PAD.step : PANEL_PAD.label;
    return [p.rect[0] - pad.x, p.rect[1] - pad.y, width(p.fontSize) + 2 * pad.x, LINE * p.fontSize + 2 * pad.y];
  }
  if (style === "lower-third") {
    const w = width(36) + 30; // the producer's banner: 36 px, padding 15, text top at h − 80
    return [(vp.width - w) / 2, vp.height - 95, w, LINE * 36 + 30];
  }
  const [x, y] = (a.calloutPosition as [number, number] | undefined) ?? [100, 100];
  return [x - 10, y - 10, width(28) + 20, LINE * 28 + 20];
}

/**
 * Does a later overlay `b` take the screen slot of an earlier one `a` (so an
 * "auto" `a` ends when `b` appears)? Slots:
 *  - spotlight: one at a time (overlapping spotlights can't be rendered);
 *  - arrow: one at a time; arrows and text callouts never end each other;
 *  - lower-third: the one bottom banner — the next lower-third replaces it;
 *  - step-counter: a numbered sequence — "Step 2" replaces "Step 1";
 *  - any other pair of text callouts (label ↔ label, label ↔ step-counter,
 *    label or step-counter ↔ lower-third): only when their boxes overlap.
 * So a lower-third and a label next to an element, or labels on different
 * elements, stay up together.
 */
function takesSlot(a: NaraAction, b: NaraAction, vp: { width: number; height: number }): boolean {
  if (a.type === "spotlight" || b.type === "spotlight") return a.type === b.type;
  if (a.type !== "callout" || b.type !== "callout") return false;
  const kind = (x: NaraAction) => (x.calloutStyle === "arrow" ? "arrow" : x.calloutStyle ?? "label");
  const [ka, kb] = [kind(a), kind(b)];
  if (ka === "arrow" || kb === "arrow") return ka === kb;
  if (ka === kb && (ka === "lower-third" || ka === "step-counter")) return true;
  const [ba, bb] = [calloutBox(a, vp), calloutBox(b, vp)];
  return !!ba && !!bb && ba[0] < bb[0] + bb[2] && bb[0] < ba[0] + ba[2] && ba[1] < bb[1] + bb[3] && bb[1] < ba[1] + ba[3];
}

/** Build one NaraScreen action from an fx entry + its trace slot.
 *  Overlay durations set here are provisional when "auto" (resolved later);
 *  range end timestamps are filled in by the caller. */
function emitAction(fx: FxEntry, id: string, tr: TraceEntry, c: EmitCtx): { action: NaraAction; clips: NarrationClip[] } {
  const base: NaraAction = { id, type: fx.fx, timestamp: tr.t };
  const fail = (msg: string, hint?: string) => new CompileError(`${c.ctx}: ${msg}`, { where: c.where, hint });
  const rects: Rect[] = tr.rects?.length ? tr.rects : tr.rect ? [tr.rect] : [];
  const clips: NarrationClip[] = [];
  const clipOf = (key: string) => {
    const clip = c.clips?.get(key);
    if (clip) clips.push(clip);
    return clip;
  };
  const done = () => ({ action: base, clips });

  switch (fx.fx) {
    case "zoom": {
      base.zoomDuration = fx.zoomDuration ?? c.d.zoomDuration;
      base.zoomHold = fx.zoomHold ?? c.d.zoomHold;
      if (fx.targets?.length) {
        if (rects.length < fx.targets.length) {
          throw fail(`zoom has ${fx.targets.length} targets but the recording measured ${rects.length} rect(s)`);
        }
        // Each target holds for its own narration (the producer's zoomTargets).
        base.zoomTargets = fx.targets.map((_, k) => {
          const sp = c.speakers.get(`${c.key}:t${k}`);
          if (!sp) return { rect: rects[k] };
          return { rect: rects[k], ...narrationFields(sp.src, c.lang, clipOf(sp.key), fail, `zoom target ${k} has no narration`) };
        });
        return done();
      }
      if (!rects[0]) throw fail("zoom needs a rect (anchor an element)");
      const sp = c.speakers.get(c.key);
      if (sp) {
        // zoomTargets (not zoomRect) is how the producer attaches audio to a
        // zoom: the hold stretches to the clip.
        base.zoomTargets = [{ rect: rects[0], ...narrationFields(sp.src, c.lang, clipOf(sp.key), fail, "zoom narration has no text") }];
      } else {
        base.zoomRect = rects[0];
      }
      return done();
    }
    case "spotlight": {
      if (!rects.length) throw fail("spotlight needs a rect (anchor an element)");
      base.spotlightRects = fx.padding ? rects.map((r) => padRect(r, fx.padding!, c.viewport)) : rects;
      base.dimOpacity = fx.dimOpacity ?? 0.7;
      if (fx.feather) base.spotlightFeather = fx.feather;
      if (fx.converge) base.spotlightConverge = fx.converge;
      base.spotlightDuration = overlayDuration(fx).value;
      return done();
    }
    case "blur": {
      if (!rects.length) throw fail("blur needs a rect (anchor an element)");
      base.blurRects = rects;
      base.blurRadius = fx.radius ?? 20;
      base.blurDuration = overlayDuration(fx).value;
      return done();
    }
    case "callout": {
      // text may be per-language, like narration: {lang} → else "en"
      const text = resolveNarration({ narrate: fx.text }, c.lang)?.text;
      if (!text) throw fail("callout needs text", `Add a \`text\` to the callout entry (for "${c.lang}", or an "en" fallback).`);
      base.calloutText = text;
      base.calloutStyle = fx.style ?? "label";
      base.calloutDuration = overlayDuration(fx).value;
      if (fx.step != null) base.calloutStep = fx.step;
      const panel = calloutPanel(fx, text, rects[0], c.viewport);
      if (panel) base.calloutPanels = [panel];
      return done();
    }
    case "arrow": {
      // Rendered as a callout with style "arrow": calloutPanels[0].rect = the target,
      // its text = the optional label (so the desktop editor can open and edit it).
      if (!rects[0]) throw fail("arrow needs a rect (anchor an element)");
      const text = fx.text != null ? resolveNarration({ narrate: fx.text }, c.lang)?.text ?? "" : "";
      base.type = "callout";
      base.calloutStyle = "arrow";
      base.calloutText = text || undefined;
      base.calloutPanels = [{ text, rect: rects[0], fontSize: fx.fontSize ?? 24 }];
      base.calloutDuration = overlayDuration(fx).value;
      if (fx.from) base.arrowFrom = fx.from;
      if (fx.color) base.arrowColor = fx.color;
      if (fx.highlight) base.arrowHighlight = true;
      if (fx.highlight && fx.highlightColor) base.arrowHighlightColor = fx.highlightColor;
      return done();
    }
    case "pause": {
      if (fx.seconds != null) base.resumeAfter = fx.seconds;
      return done();
    }
    case "narrate": {
      const sp = c.speakers.get(c.key);
      if (!sp) throw fail(`narrate needs text (for lang "${c.lang}")`, "Give it `narrate` text or an `audio` file.");
      Object.assign(base, narrationFields(sp.src, c.lang, clipOf(sp.key), fail, "narrate needs text"));
      // Freeze the frame while speaking unless told otherwise; the producer
      // fits the freeze to the clip.
      base.freeze = fx.freeze ?? true;
      base.showSubtitles = fx.subtitles ?? true;
      if (fx.subtitleSize != null) base.subtitleSize = fx.subtitleSize;
      return done();
    }
    case "speed":
      base.speedFactor = fx.factor ?? 2;
      return done();
    case "skip":
    case "mute":
      return done();
    default:
      throw fail(`unknown fx "${(fx as FxEntry).fx}"`);
  }
}

/**
 * Compile a demo-script + its run trace into NaraScreen actions, ordered by
 * timestamp. `clips` (from synthesizeNarrations, keyed `${step}:${entry}` or
 * `${step}:${entry}:t${k}`) attaches pre-generated audio and drives "auto"
 * overlay durations; without clips every auto overlay gets the 3 s fallback.
 * Non-fatal problems are appended to `warnings`. Throws CompileError on any
 * unjoinable entry.
 */
export function compile(
  scriptIn: DemoScript,
  trace: TraceEntry[],
  lang = "en",
  clips?: Map<string, NarrationClip>,
  warnings: string[] = [],
  opts: CompileOptions = {},
): NaraAction[] {
  // Recording plugins may restyle overlays for their video (e.g. flutter: phone pixel density).
  const plugins = pluginsFor(scriptIn);
  const script = plugins.reduce((acc, p) => p.compileScript?.(acc) ?? acc, scriptIn);
  const d: DemoDefaults = { ...BUILTIN_DEFAULTS, ...script.defaults };
  const byKey = indexTrace(trace);
  const speakers = new Map(narrationSlots(script).map((sp) => [sp.key, sp]));
  for (const sp of speakers.values()) {
    const note = narrationLanguageNote(sp.src, lang);
    if (note) warnings.push(`${sp.path}: ${note}`);
  }
  script.steps.forEach((beat, s) =>
    beat.beat.forEach((e, i) => {
      if (isFx(e) && (e.fx === "callout" || e.fx === "arrow") && !e.disabled && e.text && typeof e.text === "object" && e.text[lang] == null && e.text.en != null) {
        warnings.push(`steps[${s}].beat[${i}]: no ${lang} callout text — used en. Add "${lang}": "…" to the text map.`);
      }
    }),
  );
  const endOfRecording = opts.durationSec ?? Math.max(0, ...trace.map((e) => e.t)) + 0.5;
  const slots: Slot[] = [];
  let n = 0;

  script.steps.forEach((beat, s) => {
    beat.beat.forEach((entry, i) => {
      if (!isFx(entry) || entry.disabled) return; // acts and disabled fx produce no action
      const path = `steps[${s}].beat[${i}]`;
      const where = { step: beat.id, entry: i, path };
      const ctx = `${path} (${entry.fx}, step "${beat.id}")`;
      const tr = byKey.get(`${beat.id}:${i}`);
      if (!tr) {
        throw new CompileError(`${ctx}: no trace entry — the recording never reached this entry (trace has ${trace.length} entries)`, { where });
      }
      if (tr.kind !== "fx" || tr.fx !== entry.fx) {
        throw new CompileError(`${ctx}: script/recording mismatch — the trace has ${tr.kind}:${tr.fx ?? tr.act} here`, { where });
      }
      if (clips) {
        for (const [key, sp] of speakers) {
          if (sp.step !== beat.id || sp.entry !== i || clips.has(key)) continue;
          if (resolveNarration(sp.src, lang) || resolveAudio(sp.src, lang)) {
            throw new CompileError(`${sp.path}: no narration audio was generated for this entry`, {
              where: { ...where, path: sp.path },
              hint: "Run produce again; if it repeats, report it (the TTS step skipped this entry).",
            });
          }
        }
      }
      const key = `${beat.id}:${i}`;
      const out = emitAction(entry, `action-${++n}`, tr, { d, lang, viewport: script.viewport, ctx, where, key, speakers, clips });
      out.action.name = `${beat.id} #${i} ${entry.fx}`;
      if (isRange(entry)) setRangeEnd(out.action, rangeEnd(script, byKey, s, i, entry, tr.t, endOfRecording, opts.durationSec));
      const mode = overlayDuration(entry).mode;
      const windowEnd =
        mode === "end"
          ? endOfRecording
          : mode === "step-end"
            ? (entry.fx === "blur" ? blurStepEndTime : stepEndTime)(script, byKey, s, endOfRecording)
            : undefined;
      slots.push({ s, i, step: beat.id, path, fx: entry, t: tr.t, action: out.action, clips: out.clips, mode, windowEnd });
    });
  });

  const kept = tidyRanges(slots, warnings);
  // NaraScreen expects actions ordered by timestamp (stable: script order on ties).
  const actions = kept.map((sl) => sl.action).sort((a, b) => a.timestamp - b.timestamp);
  if (script.music) {
    actions.unshift({
      id: `action-${++n}`,
      type: "music",
      timestamp: 0,
      name: "music",
      musicPath: script.music.path,
      musicVolume: script.music.volume ?? 0.5,
      musicDuckTo: script.music.duckTo ?? 0.2,
    });
  }
  const clipSec = new Map<string, number>();
  for (const c of clips?.values() ?? []) clipSec.set(c.audioPath, c.durationSec);
  const tl = modelTimeline(actions, (p) => clipSec.get(p), opts.durationSec);

  resolveOverlays(kept, actions, tl, warnings, script.viewport);
  for (const p of plugins) p.adjustActions?.(actions);
  return actions;
}

// ─── ranges (speed / skip / mute) ────────────────────────────────────

function setRangeEnd(a: NaraAction, end: number) {
  if (a.type === "speed") a.speedEndTimestamp = end;
  else if (a.type === "skip") a.skipEndTimestamp = end;
  else if (a.type === "mute") a.muteEndTimestamp = end;
}
function rangeEndOf(a: NaraAction): number {
  return (a.type === "speed" ? a.speedEndTimestamp : a.type === "skip" ? a.skipEndTimestamp : a.muteEndTimestamp) ?? a.timestamp;
}

/** Where a range ends, in recording seconds:
 *   seconds → t + seconds;  "next-act" → the next act of this step (stamped
 *   when it finished);  "step-end" → the first slot of the next step (or the
 *   recording end);  "<step-id>" → the end of that step, same rule. */
function rangeEnd(
  script: DemoScript,
  byKey: Map<string, TraceEntry>,
  s: number,
  i: number,
  fx: FxEntry & { fx: "speed" | "skip" | "mute" },
  t: number,
  endOfRecording: number,
  durationSec: number | undefined,
): number {
  const clamp = (x: number) => (durationSec != null ? Math.min(x, durationSec) : x);
  if (fx.seconds != null) return clamp(t + fx.seconds);
  const stepEnd = (k: number) => stepEndTime(script, byKey, k, endOfRecording);
  const until = fx.until ?? RANGE_DEFAULT_UNTIL[fx.fx];
  if (until === "next-act") {
    const beat = script.steps[s];
    for (let j = i + 1; j < beat.beat.length; j++) {
      const tr = isAct(beat.beat[j]) ? byKey.get(`${beat.id}:${j}`) : undefined;
      if (tr) return clamp(tr.t);
    }
    return clamp(stepEnd(s)); // validation requires an act; be lenient
  }
  if (until === "step-end") return clamp(stepEnd(s));
  const k = script.steps.findIndex((b) => b.id === until);
  return clamp(stepEnd(k >= 0 ? k : s));
}

/** The producer assumes speed ranges (and skip ranges) don't overlap: clip a
 *  later start to the earlier end, drop what becomes empty, and flag effects
 *  that sit inside a skipped stretch. Returns the slots to keep. */
function tidyRanges(slots: Slot[], warnings: string[]): Slot[] {
  const dropped = new Set<Slot>();
  for (const kind of ["speed", "skip", "mute"] as const) {
    const ranges = slots.filter((sl) => sl.fx.fx === kind).sort((a, b) => a.action.timestamp - b.action.timestamp);
    let prev: Slot | undefined;
    for (const sl of ranges) {
      const end = rangeEndOf(sl.action);
      if (end - sl.action.timestamp < MIN_RANGE_SEC) {
        const len = Math.max(0, end - sl.action.timestamp).toFixed(2);
        const what = kind === "skip" ? "nothing to cut" : kind === "speed" ? "nothing to speed up" : "nothing to mute";
        warnings.push(
          `${sl.path} (${kind}): has ${what} (${len}s) — it was ignored. ` +
            (sl.fx.until == null || sl.fx.until === "next-act"
              ? `It ends when the next action finishes, and that action was instant: put the slow action (the one to ${kind === "skip" ? "cut" : kind === "speed" ? "speed up" : "mute"}) right after it, or use \`seconds\`.`
              : "Check `until` / `seconds`."),
        );
        dropped.add(sl);
        continue;
      }
      if (kind !== "mute" && prev && sl.action.timestamp < rangeEndOf(prev.action)) {
        const start = rangeEndOf(prev.action);
        if (end - start < MIN_RANGE_SEC) {
          warnings.push(`${sl.path} (${kind}): lies entirely inside the ${kind} at ${prev.path}, so it is left out.`);
          dropped.add(sl);
          continue;
        }
        warnings.push(`${sl.path} (${kind}): starts inside the ${kind} at ${prev.path}; it now begins where that one ends (${start.toFixed(1)}s of the recording).`);
        sl.action.timestamp = start;
      }
      prev = sl;
    }
  }
  const kept = slots.filter((sl) => !dropped.has(sl));
  for (const skip of kept.filter((sl) => sl.fx.fx === "skip")) {
    const [a, b] = [skip.action.timestamp, rangeEndOf(skip.action)];
    for (const sl of kept) {
      if (sl === skip || sl.fx.fx === "skip" || !(sl.t > a + 0.01 && sl.t < b - 0.01)) continue;
      warnings.push(
        `${sl.path} (${sl.fx.fx}) sits inside the part that ${skip.path} cuts out (${a.toFixed(1)}s–${b.toFixed(1)}s of the recording), ` +
          `so it starts at the cut instead: on the first frame after the skipped part. Move it after the skip (or end the skip earlier) if that is not what you want.`,
      );
    }
  }
  return kept;
}

// ─── the producer's timeline, modelled ───────────────────────────────

export interface InsertSpan {
  action: NaraAction;
  /** where the insert happens, in post-skip/speed seconds (produce.ts's mappedTs;
   *  an insert inside a talk-over narration's stretch waits until it ends) */
  at: number;
  /** seconds of video the insert itself contributes */
  length: number;
  /** what produce.ts books as "added" for overlay remapping (buildInsertRemap) */
  added: number;
  /** what the insert really adds to the final timeline (= added) */
  delta: number;
  /** real start on the final timeline */
  start: number;
  /** zoom: each target's hold, relative to `start` */
  holds?: { start: number; length: number; narrated: boolean }[];
}

export interface Timeline {
  /** inserts in the producer's processing order */
  inserts: InsertSpan[];
  /** recording seconds → post-skip/speed seconds (produce.ts remapTs) */
  mapped(t: number): number;
  /** final-timeline time at which produce.ts starts drawing an overlay whose
   *  recording timestamp is `t` (insertRemap ∘ remapTs: inserts strictly before) */
  placed(t: number): number;
  /** real final-timeline time of post-skip/speed position `m` */
  realAt(m: number): number;
  /** post-skip/speed positions where the picture jumps (skip cut) or changes pace (speed edge) */
  boundaries: { at: number; action: NaraAction }[];
  /** Σ delta over the inserts */
  addedSec: number;
  /** length of the rendered video for a recording of `recordingSec` */
  finalDuration(recordingSec: number): number;
}

function frames(sec: number): number {
  return Math.max(Math.round(FPS * sec), 2) / FPS;
}

/** Like the producer's findNarration: customAudioPath first, then audioPath. */
function narrationSec(
  src: { customAudioPath?: string; audioPath?: Record<string, string> },
  audioSec: (p: string) => number | undefined,
): number | undefined {
  for (const p of [src.customAudioPath, ...Object.values(src.audioPath ?? {})]) {
    const s = p ? audioSec(p) : undefined;
    if (s != null && s > 0) return s;
  }
  return undefined;
}

type Range = { start: number; end: number };

// Ports of produce.ts buildSkipRemap / remapRanges / buildSpeedRemap.
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
function remapRanges<T extends Range>(ranges: T[], remap: (t: number) => number): T[] {
  return ranges.map((r) => ({ ...r, start: remap(r.start), end: remap(r.end) })).filter((r) => r.end > r.start + 0.05);
}
function speedRemap(ranges: (Range & { factor: number })[]): (t: number) => number {
  return (t) => {
    let out = 0;
    let cursor = 0;
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

/**
 * How produce.ts lays out `actions` (project order, i.e. timestamp-sorted):
 *  - skip ranges are cut, then speed ranges (remapped through the cuts) are
 *    re-timed; inserts and overlays use the remapped positions.
 *  - insert order: [...zooms, ...pauses, ...narrates] stable-sorted by position,
 *    so on equal positions zooms go first, then pauses, then narrations.
 *  - zoom: per target, zoom-in + hold + zoom-out; in/out = max(round(30·zoomDuration), 2)
 *    frames; hold = zoomHold, or — when that target is narrated — its clip (the
 *    hold is cut with `-shortest`, so its audio+0.5 s of video is trimmed to the audio).
 *  - pause: resumeAfter seconds, else 3.
 *  - narrate, freeze: a freeze of audio+0.5 s muxed with the audio under
 *    `-shortest` → really the clip length (3 s when there is no audio).
 *  - narrate, no freeze (talk-over): plays audio+0.5 s of source (resumeAfter,
 *    else 3 s without audio) and resumes right after it: adds nothing — except
 *    where the recording ends first, whose last frame is held for the rest
 *    (modelled when `recordingSec` is known).
 *  - an insert that falls inside the stretch a talk-over narration plays waits
 *    until that narration ends (its frames would otherwise play twice); one
 *    within 0.05 s after the previous insert's resume point starts right there.
 */
export function modelTimeline(
  actions: NaraAction[],
  audioSec: (audioPath: string) => number | undefined,
  recordingSec?: number,
): Timeline {
  const skips = actions
    .filter((a) => a.type === "skip" && a.skipEndTimestamp)
    .map((a) => ({ start: a.timestamp, end: a.skipEndTimestamp!, action: a }))
    .sort((a, b) => a.start - b.start);
  const skipMap = skipRemap(skips);
  const speeds = remapRanges(
    actions
      .filter((a) => a.type === "speed" && a.speedEndTimestamp && a.speedFactor)
      .map((a) => ({ start: a.timestamp, end: a.speedEndTimestamp!, factor: a.speedFactor!, action: a }))
      .sort((a, b) => a.start - b.start),
    skipMap,
  );
  const speedMap = speedRemap(speeds);
  const mapped = (t: number) => speedMap(skipMap(t));

  const isZoom = (a: NaraAction) => a.type === "zoom" && !!(a.zoomRect || a.zoomTargets?.length);
  const ordered = [
    ...actions.filter(isZoom),
    ...actions.filter((a) => a.type === "pause"),
    ...actions.filter((a) => a.type === "narrate"),
  ]
    .map((a) => ({ a, at: mapped(a.timestamp) }))
    .sort((x, y) => x.at - y.at);

  const inserts: InsertSpan[] = [];
  const recordingEnd = recordingSec != null ? mapped(recordingSec) : undefined;
  let shift = 0;
  let cursor = 0; // post-skip/speed source consumed so far (produce.ts's insert-pass cursor)
  for (const { a, at: stamped } of ordered) {
    const at = stamped < cursor + 0.05 ? cursor : stamped;
    let length: number;
    let added: number;
    let delta: number;
    let holds: InsertSpan["holds"];
    if (a.type === "zoom") {
      const half = frames(a.zoomDuration ?? 1);
      const targets: { customAudioPath?: string; audioPath?: Record<string, string> }[] = a.zoomTargets?.length ? a.zoomTargets : [{}];
      holds = [];
      let off = 0;
      for (const tg of targets) {
        const s = narrationSec(tg, audioSec);
        off += half;
        const hold = s ?? frames(a.zoomHold ?? 2);
        holds.push({ start: off, length: hold, narrated: s != null });
        off += hold + half;
      }
      length = added = delta = off;
    } else if (a.type === "pause") {
      length = added = delta = typeof a.resumeAfter === "number" ? a.resumeAfter : 3;
    } else {
      const clip = narrationSec(a, audioSec);
      let planned = clip != null ? clip + NARRATION_TAIL_SEC : 3;
      if (typeof a.resumeAfter === "number") planned = a.resumeAfter;
      if (a.freeze === true) {
        length = clip != null ? Math.min(planned, clip) : planned;
        added = delta = length;
      } else {
        // Talk-over: plays `planned` s of the recording; only past its end is a frame held.
        length = planned;
        const consumed = recordingEnd != null ? Math.max(0, Math.min(planned, recordingEnd - at)) : planned;
        added = delta = length - consumed;
        cursor = at + consumed;
      }
    }
    if (a.type !== "narrate" || a.freeze === true) cursor = at;
    inserts.push({ action: a, at, length, added, delta, start: at + shift, ...(holds ? { holds } : {}) });
    shift += delta;
  }
  // Without the recording's length a talk-over narration running past its end
  // isn't known until finalDuration(recordingSec) asks: its held tail counts there.
  const heldTail = (end: number) =>
    recordingEnd != null
      ? 0
      : inserts.reduce((sum, sp) => (sp.action.type === "narrate" && sp.action.freeze !== true ? sum + Math.max(0, sp.at + sp.length - Math.max(sp.at, end)) : sum), 0);

  const boundaries = [
    ...skips.map((r) => ({ at: mapped(r.start), action: r.action })),
    ...speeds.flatMap((r) => [
      { at: speedMap(r.start), action: r.action },
      { at: speedMap(r.end), action: r.action },
    ]),
  ].sort((x, y) => x.at - y.at);

  const sumBefore = (m: number, key: "added" | "delta") => inserts.reduce((sum, sp) => (sp.at < m ? sum + sp[key] : sum), 0);
  return {
    inserts,
    mapped,
    placed: (t) => mapped(t) + sumBefore(mapped(t), "added"),
    realAt: (m) => m + sumBefore(m, "delta"),
    boundaries,
    addedSec: shift,
    finalDuration: (sec) => mapped(sec) + shift + heldTail(mapped(sec)),
  };
}

// ─── overlay durations ───────────────────────────────────────────────

const round3 = (x: number) => Math.round(x * 1000) / 1000;
const sec = (x: number) => `${x.toFixed(1)}s`;

function setOverlayDuration(a: NaraAction, dur: number) {
  if (a.type === "spotlight") a.spotlightDuration = dur;
  else if (a.type === "blur") a.blurDuration = dur;
  else if (a.type === "callout") a.calloutDuration = dur;
}

function overlayDurationOf(a: NaraAction): number {
  return (a.type === "spotlight" ? a.spotlightDuration : a.type === "blur" ? a.blurDuration : a.calloutDuration) ?? AUTO_FALLBACK_SEC;
}

/**
 * AUTO duration of spotlight/callout i, drawn from P = placed(t_i):
 *   target = start(j) + cover(j) − P   for the first later entry j in the same
 *            step that narrates and has a clip; cover = clip + 0.5 for narrate;
 *            for a zoom, the end of its last narrated hold + 0.5 (capped at the
 *            zoom's length) — only reachable by lower-third callouts, see below;
 *   target = 3 when there is no such j.
 *   Caps (each keeps a 0.05 s gap):
 *    - never into a zoom: start(z) − P for the first zoom at/after t_i (warning);
 *    - never across a skip cut or a speed-range edge: realAt(b) − P (warning);
 *    - never past the next overlay that takes its screen slot (takesSlot: the
 *      next spotlight / arrow / lower-third / step-counter, or a text callout
 *      whose box overlaps it): placed(t_k) − P.
 *   Minimum 0.5 s.
 * "step-end" / "end": target = realAt(mapped(end of step / recording)) − P, with
 * the same caps, except that only spotlights yield to the next spotlight.
 * (Blur: see resolveBlur.)
 * start(j) − P = (t_j − t_i) + Σ real lengths of the inserts between them — the
 * spec's "(t_j − t_i) + inserts between + narration", with the lengths the
 * producer really renders. Lower-third callouts are not tied to an element, so
 * the zoom/range caps don't apply to them (drawn over zoomed or re-timed frames
 * they are still correct).
 */
/**
 * Blur is burned BEFORE the inserts (on the recording timeline, after skips
 * and speed ramps), so every freeze and zoom cut from a blurred moment is
 * blurred for its whole length. Its duration is therefore in RECORDING
 * seconds and ignores the inserts entirely:
 *   fixed → as given;  "step-end"/"end" (unset = "step-end") → until the next
 *   step's first slot / the recording end;  "auto" → until the first later
 *   narration in the step has spoken: its freeze (or zoom) point + 0.5 s, or,
 *   for freeze:false, its start + clip + 0.5 s; else 3 s.  Minimum 0.5 s.
 * No zoom, range or same-type caps: a blur never lifts early.
 */
function resolveBlur(sl: Slot, slots: Slot[], tl: Timeline, spanOf: Map<NaraAction, InsertSpan>) {
  if (sl.mode === "fixed") return;
  let dur: number;
  if (sl.mode === "end") {
    dur = sl.windowEnd! - sl.t + BLUR_END_PAD_SEC;
  } else if (sl.mode !== "auto") {
    dur = sl.windowEnd! - sl.t;
  } else {
    const j = slots.find((o) => o.s === sl.s && o.i > sl.i && (o.fx.fx === "narrate" || o.fx.fx === "zoom") && o.clips.length);
    if (!j) dur = AUTO_FALLBACK_SEC;
    else {
      // A narration that had to wait for an earlier talk-over one starts later than its slot.
      const sp = spanOf.get(j.action);
      const waited = sp ? Math.max(0, sp.at - tl.mapped(j.t)) : 0;
      const from = j.t + waited;
      dur = (j.fx.fx === "narrate" && j.fx.freeze === false ? from + j.clips[0].durationSec : from) + NARRATION_TAIL_SEC - sl.t;
    }
  }
  setOverlayDuration(sl.action, Math.max(AUTO_MIN_SEC, round3(dur)));
}

function resolveOverlays(slots: Slot[], actions: NaraAction[], tl: Timeline, warnings: string[], vp: { width: number; height: number }) {
  const spanOf = new Map<NaraAction, InsertSpan>(tl.inserts.map((sp) => [sp.action, sp]));
  const slotOf = new Map<NaraAction, Slot>(slots.map((sl) => [sl.action, sl]));
  const orderOf = new Map<NaraAction, number>(actions.map((a, k) => [a, k]));
  const pathOf = (a: NaraAction) => slotOf.get(a)?.path ?? a.name ?? a.id;

  for (const sl of slots) {
    if (!isOverlay(sl.fx)) continue;
    if (sl.fx.fx === "blur") {
      resolveBlur(sl, slots, tl, spanOf);
      continue;
    }
    const m = tl.mapped(sl.t);
    const P = tl.placed(sl.t);
    const zoomAfter = () => tl.inserts.find((sp) => sp.action.type === "zoom" && sp.at >= m);

    if (sl.mode === "fixed") continue; // explicit durations are the author's call

    // target: "auto" → until the first narration that follows in this step
    // ends; "step-end"/"end" → until that point on the final timeline (so the
    // inserts, cuts and speed changes in between are all counted).
    let target = AUTO_FALLBACK_SEC;
    const auto = sl.mode === "auto";
    const j = auto
      ? slots.find((o) => o.s === sl.s && o.i > sl.i && (o.fx.fx === "narrate" || o.fx.fx === "zoom") && o.clips.length)
      : undefined;
    const span = j && spanOf.get(j.action);
    if (!auto) {
      target = tl.realAt(tl.mapped(sl.windowEnd!)) - P + (sl.mode === "end" ? END_OPEN_SEC : 0);
    } else if (j && span) {
      let cover: number;
      if (j.fx.fx === "narrate") {
        cover = j.clips[0].durationSec + NARRATION_TAIL_SEC;
      } else {
        const last = [...(span.holds ?? [])].reverse().find((h) => h.narrated);
        cover = Math.min((last ? last.start + last.length : span.length) + NARRATION_TAIL_SEC, span.length);
      }
      target = span.start + cover - P;
    }

    // caps
    const caps: { at: number; why: "zoom" | "range" | "same"; action: NaraAction }[] = [];
    const rectBound = !(sl.fx.fx === "callout" && (sl.fx.style ?? "label") === "lower-third");
    if (rectBound) {
      const z = zoomAfter();
      if (z) caps.push({ at: z.start - P - CAP_GAP_SEC, why: "zoom", action: z.action });
      const b = tl.boundaries.find((x) => x.at > m + 1e-6);
      if (b) caps.push({ at: tl.realAt(b.at) - P - CAP_GAP_SEC, why: "range", action: b.action });
    }
    // "auto" never runs into the next overlay that takes its screen slot; the
    // explicit end modes only yield to the next spotlight (overlapping spotlights fail).
    const capSame = auto || sl.action.type === "spotlight";
    const nextSame = capSame ? actions.slice(orderOf.get(sl.action)! + 1).find((a) => takesSlot(sl.action, a, vp)) : undefined;
    if (nextSame) caps.push({ at: tl.placed(nextSame.timestamp) - P - CAP_GAP_SEC, why: "same", action: nextSame });
    const binding = caps.filter((c) => c.at < target).sort((x, y) => x.at - y.at)[0];
    const dur = Math.max(AUTO_MIN_SEC, round3(binding ? binding.at : target));
    setOverlayDuration(sl.action, dur);

    if (binding?.why === "zoom") {
      warnings.push(
        `${sl.path} (${sl.fx.fx}): "${sl.mode}" duration stops at the zoom at ${pathOf(binding.action)} after ${sec(dur)}` +
          (j ? ` (the narration it was waiting for ends later)` : "") +
          ` — overlays can't continue through a zoom because zoomed frames are rescaled. Move the ${sl.fx.fx} after the zoom, or narrate before zooming.`,
      );
    } else if (binding?.why === "range") {
      const kind = binding.action.type;
      warnings.push(
        `${sl.path} (${sl.fx.fx}): "${sl.mode}" duration stops after ${sec(dur)} where the ${kind} at ${pathOf(binding.action)} ` +
          `${kind === "skip" ? "cuts the video" : "changes the playback speed"} — the ${sl.fx.fx} would no longer line up with its element there. ` +
          `Move the ${sl.fx.fx} (or its narration) so it doesn't span the ${kind}.`,
      );
    }
  }

  // Overlapping spotlights make the producer fail (SPOTLIGHT_OVERLAP); only
  // explicit durations can cause it — say which ones before rendering.
  for (const o of spotlightOverlaps(actions, tl)) {
    warnings.push(
      `${pathOf(o.first)} (spotlight): on screen until ${sec(o.firstEnd)} but the spotlight at ` +
        `${pathOf(o.next)} starts at ${sec(o.nextStart)} — overlapping spotlights fail to render ` +
        `(SPOTLIGHT_OVERLAP). Shorten the first one's duration or use "auto".`,
    );
  }
}

export interface SpotlightOverlap {
  first: NaraAction;
  next: NaraAction;
  /** final-timeline end of `first` / start of `next` (modelled) */
  firstEnd: number;
  nextStart: number;
  /** inserts between the two starts — each adds a few ms of model error */
  insertsBetween: number;
}

/** Consecutive spotlights whose windows overlap on the final timeline — the
 *  producer refuses to render those ("Overlapping spotlights"). */
export function spotlightOverlaps(actions: NaraAction[], tl: Timeline): SpotlightOverlap[] {
  const spots = actions
    .filter((a) => a.type === "spotlight")
    .map((a) => ({ a, m: tl.mapped(a.timestamp), start: tl.placed(a.timestamp), end: tl.placed(a.timestamp) + overlayDurationOf(a) }))
    .sort((x, y) => x.start - y.start);
  const out: SpotlightOverlap[] = [];
  for (let q = 0; q + 1 < spots.length; q++) {
    const [cur, nxt] = [spots[q], spots[q + 1]];
    if (nxt.start < cur.end - 0.01) {
      const insertsBetween = tl.inserts.filter((sp) => sp.at >= cur.m && sp.at < nxt.m).length;
      out.push({ first: cur.a, next: nxt.a, firstEnd: cur.end, nextStart: nxt.start, insertsBetween });
    }
  }
  return out;
}
