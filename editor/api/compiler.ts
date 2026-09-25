// ─── compiler: demo-script + trace (+ narration clips) → NaraScreen actions ──
//
// PURE: no video, no filesystem. Joins each `fx` entry in the script with its
// trace entry (by {beat, i}) and emits one NaraScreen action (the shape
// electron/produce.ts consumes). `act` entries emit nothing — they only drove
// the browser.
//
// The one non-trivial job is "auto" overlay durations (spotlight / callout /
// blur that should stay up while the narration that follows is spoken). The
// producer inserts freeze frames (pause, zoom, narrate) at fx timestamps and
// draws overlays AFTER that, remapping only their START through the inserts:
// an overlay starting at source time t_i is drawn from placed(t_i) to
// placed(t_i) + duration on the final timeline. So the duration has to include
// every insert the overlay lives through. `modelTimeline` reproduces the
// producer's insert pass (order, lengths, bookkeeping) so those numbers match
// what produce.ts really renders — see the notes on each insert kind below.

import { AgentError, type AgentErrorInit } from "./errors";
import { resolveNarration, type NarrationClip } from "./narration";
import {
  BUILTIN_DEFAULTS,
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

/** Overlay fallback when no narration follows (and the schema's default). */
export const AUTO_FALLBACK_SEC = 3;
/** Shortest overlay "auto" ever produces. */
export const AUTO_MIN_SEC = 0.5;
/** Overlays stay up this long after their narration's last word. */
export const NARRATION_TAIL_SEC = 0.5;
/** Gap kept before a zoom / the next overlay of the same kind. */
const CAP_GAP_SEC = 0.05;
const FPS = 30; // produce.ts renders inserts at 30 fps

// ─── one fx entry, joined with its trace slot ────────────────────────

interface Slot {
  s: number; // step index
  i: number; // entry index in the step
  step: string;
  path: string; // steps[s].beat[i]
  fx: FxEntry;
  t: number;
  action: NaraAction;
  clip?: NarrationClip;
  /** overlay whose duration is unset / "auto" */
  auto: boolean;
}

function indexTrace(trace: TraceEntry[]): Map<string, TraceEntry> {
  const m = new Map<string, TraceEntry>();
  for (const e of trace) m.set(`${e.beat}:${e.i}`, e);
  return m;
}

function overlayDuration(fx: FxEntry): { value: number; auto: boolean } {
  return typeof fx.duration === "number" ? { value: fx.duration, auto: false } : { value: AUTO_FALLBACK_SEC, auto: true };
}

function narrates(fx: FxEntry): boolean {
  return fx.fx === "narrate" || (fx.fx === "zoom" && fx.narrate != null);
}

/** Build one NaraScreen action from an fx entry + its resolved time/rect.
 *  Overlay durations set here are provisional when "auto" (resolved later). */
function emitAction(
  fx: FxEntry,
  id: string,
  timestamp: number,
  rect: Rect | undefined,
  d: DemoDefaults,
  ctx: string,
  where: AgentErrorInit["where"],
  lang: string,
  clip: NarrationClip | undefined,
): NaraAction {
  const base: NaraAction = { id, type: fx.fx, timestamp };
  const fail = (msg: string, hint?: string) => new CompileError(`${ctx}: ${msg}`, { where, hint });

  switch (fx.fx) {
    case "zoom": {
      if (!rect) throw fail("zoom needs a rect (anchor an element)");
      base.zoomDuration = fx.zoomDuration ?? d.zoomDuration;
      base.zoomHold = fx.zoomHold ?? d.zoomHold;
      if (fx.narrate != null) {
        const narr = resolveNarration(fx, lang);
        if (!narr) throw fail(`zoom narration has no text for language "${lang}"`, `Add "${lang}" (or "en") to this entry's narrate map.`);
        // zoomTargets (not zoomRect) is how the producer attaches audio to a
        // zoom: the hold stretches to the clip.
        const target: NonNullable<NaraAction["zoomTargets"]>[number] = { rect, narrations: { [narr.lang]: narr.text } };
        if (clip) target.audioPath = { [narr.lang]: clip.audioPath };
        base.zoomTargets = [target];
      } else {
        base.zoomRect = rect;
      }
      return base;
    }
    case "spotlight": {
      if (!rect) throw fail("spotlight needs a rect (anchor an element)");
      base.spotlightRects = [rect];
      base.dimOpacity = fx.dimOpacity ?? 0.7;
      base.spotlightDuration = overlayDuration(fx).value;
      return base;
    }
    case "blur": {
      if (!rect) throw fail("blur needs a rect (anchor an element)");
      base.blurRects = [rect];
      base.blurRadius = fx.radius ?? 20;
      base.blurDuration = overlayDuration(fx).value;
      return base;
    }
    case "callout": {
      if (!fx.text) throw fail("callout needs text", "Add a `text` to the callout entry.");
      base.calloutText = fx.text;
      base.calloutStyle = fx.style ?? "label";
      base.calloutDuration = overlayDuration(fx).value;
      if (fx.step != null) base.calloutStep = fx.step;
      // lower-third is auto-centered by the producer; positioned styles use the
      // anchor's top-left as the label origin.
      if (base.calloutStyle !== "lower-third" && rect) {
        base.calloutPosition = [rect[0], rect[1]];
      }
      return base;
    }
    case "pause": {
      if (fx.seconds != null) base.resumeAfter = fx.seconds;
      return base;
    }
    case "narrate": {
      const narr = resolveNarration(fx, lang);
      if (!narr) throw fail(`narrate needs text (for lang "${lang}")`, `Add "${lang}" (or "en") to this entry's narrate map.`);
      base.narrations = { [narr.lang]: narr.text };
      if (clip) base.audioPath = { [narr.lang]: clip.audioPath };
      // Freeze the frame while speaking unless told otherwise; the producer
      // fits the freeze to the clip.
      base.freeze = fx.freeze ?? true;
      return base;
    }
    default:
      throw fail(`unknown fx "${(fx as FxEntry).fx}"`);
  }
}

/**
 * Compile a demo-script + its run trace into NaraScreen actions, ordered by
 * timestamp. `clips` (from synthesizeNarrations, keyed `${step}:${entry}`)
 * attaches pre-generated audio and drives "auto" overlay durations; without
 * clips every auto overlay gets the 3 s fallback. Non-fatal problems are
 * appended to `warnings`. Throws CompileError on any unjoinable entry.
 */
export function compile(
  script: DemoScript,
  trace: TraceEntry[],
  lang = "en",
  clips?: Map<string, NarrationClip>,
  warnings: string[] = [],
): NaraAction[] {
  const d: DemoDefaults = { ...BUILTIN_DEFAULTS, ...script.defaults };
  const byKey = indexTrace(trace);
  const slots: Slot[] = [];
  let n = 0;

  script.steps.forEach((beat, s) => {
    beat.beat.forEach((entry, i) => {
      if (!isFx(entry)) return; // act entries produce no action
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
      const clip = narrates(entry) ? clips?.get(`${beat.id}:${i}`) : undefined;
      if (clips && narrates(entry) && !clip && resolveNarration(entry, lang)) {
        throw new CompileError(`${ctx}: no narration audio was generated for this entry`, {
          where,
          hint: "Run produce again; if it repeats, report it (the TTS step skipped this entry).",
        });
      }
      const action = emitAction(entry, `action-${++n}`, tr.t, tr.rect, d, ctx, where, lang, clip);
      action.name = `${beat.id} #${i} ${entry.fx}`;
      const auto = (entry.fx === "spotlight" || entry.fx === "callout" || entry.fx === "blur") && overlayDuration(entry).auto;
      slots.push({ s, i, step: beat.id, path, fx: entry, t: tr.t, action, clip, auto });
    });
  });

  // NaraScreen expects actions ordered by timestamp (stable: script order on ties).
  const actions = slots.map((sl) => sl.action).sort((a, b) => a.timestamp - b.timestamp);
  const clipSec = new Map<string, number>();
  for (const c of clips?.values() ?? []) clipSec.set(c.audioPath, c.durationSec);
  const tl = modelTimeline(actions, (p) => clipSec.get(p));

  resolveOverlays(slots, actions, tl, warnings);
  return actions;
}

// ─── the producer's timeline, modelled ───────────────────────────────

export interface InsertSpan {
  action: NaraAction;
  /** source time the insert happens at */
  at: number;
  /** seconds of video the insert itself contributes */
  length: number;
  /** what produce.ts books as "added" for overlay remapping (buildInsertRemap) */
  added: number;
  /** what the insert really adds to the final timeline */
  delta: number;
  /** real start on the final timeline */
  start: number;
}

export interface Timeline {
  /** inserts in the producer's processing order */
  inserts: InsertSpan[];
  /** final-timeline time at which produce.ts starts drawing an overlay whose
   *  source timestamp is `t` (buildInsertRemap: inserts strictly before t) */
  placed(t: number): number;
  /** Σ delta — the final video ≈ recording duration + this */
  addedSec: number;
}

function frames(sec: number): number {
  return Math.max(Math.round(FPS * sec), 2) / FPS;
}

function firstAudioSec(paths: Record<string, string> | undefined, audioSec: (p: string) => number | undefined): number | undefined {
  for (const p of Object.values(paths ?? {})) {
    const s = audioSec(p);
    if (s != null && s > 0) return s;
  }
  return undefined;
}

/**
 * How produce.ts's insert pass (executeInsertPass) lays out `actions`, which must
 * be in project order (timestamp-sorted). Mirrors, per insert kind:
 *  - order: [...zooms, ...pauses, ...narrates] stable-sorted by timestamp, so on
 *    equal timestamps zooms go first, then pauses, then narrations.
 *  - zoom: per target, zoom-in + hold + zoom-out; in/out = max(round(30·zoomDuration), 2)
 *    frames; hold = zoomHold, or — when narrated — the clip (the hold is cut with
 *    `-shortest`, so its audio+0.5 s video is trimmed to the audio).
 *  - pause: resumeAfter seconds, else 3.
 *  - narrate, freeze: a freeze of audio+0.5 s muxed with the audio under
 *    `-shortest` → really the clip length (3 s when there is no audio).
 *  - narrate, no freeze: plays audio+0.5 s of source, also `-shortest`-trimmed
 *    to the clip, then resumes after audio+0.5 s: books +0 (max(0, …)) but
 *    really shortens the timeline by 0.5 s.
 */
export function modelTimeline(actions: NaraAction[], audioSec: (audioPath: string) => number | undefined): Timeline {
  const isZoom = (a: NaraAction) => a.type === "zoom" && !!(a.zoomRect || a.zoomTargets?.length);
  const ordered = [
    ...actions.filter(isZoom),
    ...actions.filter((a) => a.type === "pause"),
    ...actions.filter((a) => a.type === "narrate"),
  ].sort((a, b) => a.timestamp - b.timestamp);

  const inserts: InsertSpan[] = [];
  let shift = 0;
  for (const a of ordered) {
    let length: number;
    let added: number;
    let delta: number;
    if (a.type === "zoom") {
      const inOut = 2 * frames(a.zoomDuration ?? 1);
      const targets: { audioPath?: Record<string, string> }[] = a.zoomTargets?.length ? a.zoomTargets : [{}];
      length = targets.reduce((sum, tg) => sum + inOut + (firstAudioSec(tg.audioPath, audioSec) ?? frames(a.zoomHold ?? 2)), 0);
      added = delta = length;
    } else if (a.type === "pause") {
      length = typeof a.resumeAfter === "number" ? a.resumeAfter : 3;
      added = delta = length;
    } else {
      const clip = firstAudioSec(a.audioPath, audioSec);
      let planned = clip != null ? clip + NARRATION_TAIL_SEC : 3;
      if (typeof a.resumeAfter === "number") planned = a.resumeAfter;
      length = clip != null ? Math.min(planned, clip) : planned;
      if (a.freeze === true) {
        added = delta = length;
      } else {
        added = Math.max(0, length - planned);
        delta = length - planned;
      }
    }
    inserts.push({ action: a, at: a.timestamp, length, added, delta, start: a.timestamp + shift });
    shift += delta;
  }

  return {
    inserts,
    placed: (t: number) => t + inserts.reduce((sum, sp) => (sp.at < t ? sum + sp.added : sum), 0),
    addedSec: shift,
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
 * AUTO duration of overlay i (drawn from P = placed(t_i)):
 *   target = start(j) + cover(j) − P   for the first later entry j in the same
 *            step that narrates and has a clip; cover = clip + 0.5 for narrate,
 *            min(zoomIn + clip + 0.5, zoom length) for a narrated zoom
 *            (only reachable by lower-third callouts, see below);
 *   target = 3 when no such j.
 *   Caps: never into a zoom — start(z) − P − 0.05 for the first zoom at/after
 *   t_i (warning); never past the next overlay of the same fx type —
 *   placed(t_k) − P − 0.05. Minimum 0.5 s.
 * start(j) − P = (t_j − t_i) + Σ real lengths of the inserts between them, so this
 * is the spec's "(t_j − t_i) + inserts between + narration" with the producer's
 * real insert lengths. Lower-third callouts are exempt from the zoom stop: they
 * are not tied to an element, so drawing them over zoomed frames is correct.
 */
function resolveOverlays(slots: Slot[], actions: NaraAction[], tl: Timeline, warnings: string[]) {
  const spanOf = new Map<NaraAction, InsertSpan>(tl.inserts.map((sp) => [sp.action, sp]));
  const slotOf = new Map<NaraAction, Slot>(slots.map((sl) => [sl.action, sl]));
  const orderOf = new Map<NaraAction, number>(actions.map((a, k) => [a, k]));

  for (const sl of slots) {
    if (sl.fx.fx !== "spotlight" && sl.fx.fx !== "callout" && sl.fx.fx !== "blur") continue;
    const P = tl.placed(sl.t);
    const firstZoom = tl.inserts.find((sp) => sp.action.type === "zoom" && sp.at >= sl.t);

    if (!sl.auto) {
      // Explicit durations are the author's call — only flag a blur whose window
      // reaches a zoom in its step: zoomed frames come from the unblurred video.
      const dur = overlayDurationOf(sl.action);
      const z = tl.inserts.find((sp) => sp.action.type === "zoom" && sp.at >= sl.t && slotOf.get(sp.action)?.step === sl.step);
      if (sl.fx.fx === "blur" && z && P + dur > z.start) {
        warnings.push(
          `${sl.path} (blur): its ${sec(dur)} window runs into the zoom at ${slotOf.get(z.action)?.path}. ` +
            `Zoomed frames are made from the unblurred recording, so what the blur hides can show — end the blur before the zoom or drop the zoom.`,
        );
      }
      continue;
    }

    // target: until the first narration that follows in this step ends
    let target = AUTO_FALLBACK_SEC;
    const j = slots.find((o) => o.s === sl.s && o.i > sl.i && narrates(o.fx) && o.clip);
    const span = j && spanOf.get(j.action);
    if (j?.clip && span) {
      const cover =
        j.fx.fx === "narrate"
          ? j.clip.durationSec + NARRATION_TAIL_SEC
          : Math.min(frames(j.action.zoomDuration ?? 1) + j.clip.durationSec + NARRATION_TAIL_SEC, span.length);
      target = span.start + cover - P;
    }

    let dur = target;
    let stoppedBy: InsertSpan | undefined;
    const rectBound = !(sl.fx.fx === "callout" && (sl.fx.style ?? "label") === "lower-third");
    if (rectBound && firstZoom) {
      const cap = firstZoom.start - P - CAP_GAP_SEC;
      if (cap < dur) {
        dur = cap;
        stoppedBy = firstZoom;
      }
    }
    const k = orderOf.get(sl.action)!;
    const nextSame = actions.slice(k + 1).find((a) => a.type === sl.action.type);
    if (nextSame) dur = Math.min(dur, tl.placed(nextSame.timestamp) - P - CAP_GAP_SEC);
    dur = Math.max(AUTO_MIN_SEC, round3(dur));
    setOverlayDuration(sl.action, dur);

    if (stoppedBy) {
      const zPath = slotOf.get(stoppedBy.action)?.path ?? `the zoom at ${sec(stoppedBy.at)}`;
      warnings.push(
        `${sl.path} (${sl.fx.fx}): "auto" duration stops at the zoom at ${zPath} after ${sec(dur)}` +
          (j ? ` (the narration it was waiting for ends later)` : "") +
          ` — overlays can't continue through a zoom because zoomed frames are rescaled` +
          (sl.fx.fx === "blur" ? ", and the zoom shows the unblurred frame" : "") +
          `. Move the ${sl.fx.fx} after the zoom, or narrate before zooming.`,
      );
    }
  }

  // Overlapping spotlights make the producer fail (SPOTLIGHT_OVERLAP); only
  // explicit durations can cause it — say which ones before rendering.
  for (const o of spotlightOverlaps(actions, tl)) {
    warnings.push(
      `${slotOf.get(o.first)?.path} (spotlight): on screen until ${sec(o.firstEnd)} but the spotlight at ` +
        `${slotOf.get(o.next)?.path} starts at ${sec(o.nextStart)} — overlapping spotlights fail to render ` +
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
    .map((a) => ({ a, start: tl.placed(a.timestamp), end: tl.placed(a.timestamp) + overlayDurationOf(a) }));
  const out: SpotlightOverlap[] = [];
  for (let q = 0; q + 1 < spots.length; q++) {
    const [cur, nxt] = [spots[q], spots[q + 1]];
    if (nxt.start < cur.end - 0.01) {
      const insertsBetween = tl.inserts.filter((sp) => sp.at >= cur.a.timestamp && sp.at < nxt.a.timestamp).length;
      out.push({ first: cur.a, next: nxt.a, firstEnd: cur.end, nextStart: nxt.start, insertsBetween });
    }
  }
  return out;
}
