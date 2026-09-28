// ─── engine types ───────────────────────────────────────────────────
//
// Script types live in schema.ts (the agent-facing contract) and are re-exported
// here so engine modules can keep importing from "./types". This file adds the
// engine-internal shapes: the runner's trace and the NaraScreen actions the
// compiler emits. Agents never see these.

export {
  BUILTIN_DEFAULTS,
  isAct,
  isFx,
  type ActEntry,
  type ActVerb,
  type Beat,
  type BeatEntry,
  type DemoDefaults,
  type DemoScript,
  type FxEntry,
  type FxVerb,
  type NarrationText,
  type Scope,
  type Selector,
  type TtsConfig,
  type Rect,
  type ZoomTarget,
  type AudioSource,
  type MusicConfig,
  type OutputConfig,
} from "./schema";
import type { ActVerb, FxVerb, Rect } from "./schema";
import type { CursorKind } from "../electron/fx-cursor";

/** One line of the runner's trace.jsonl — every beat slot, in order. */
export interface TraceEntry {
  beat: string; // beat id
  i: number; // index into the beat's flat list
  kind: "act" | "fx";
  act?: ActVerb;
  fx?: FxVerb;
  t: number; // seconds into the recording when this slot ran
  /** When the entry began running (a step begins at its first entry's start).
   *  Absent in traces recorded before 2026-09 (everything falls back to `t`). */
  start?: number;
  /** When an act had finished, if later than `t` (a click is stamped at the click itself). */
  end?: number;
  rect?: Rect; // post-reveal boundingBox (absent for non-element entries)
  /** fx with `anchors` (spotlight/blur) or zoom `targets`: one rect per
   *  anchor/target, index-aligned; rect === rects[0]. */
  rects?: Rect[];
  /** An act on an element: what the pointer/camera saw — the kind of interaction,
   *  when it began (the act ends at `end` ?? `t`) and the element's box (video px).
   *  Absent in traces recorded before 2026-09-28 (no cursor then). */
  pointer?: { kind: CursorKind; t0: number; rect: Rect };
}

/** Where a compiled action came from in the demo script. */
export interface ActionSource {
  /** step id */
  step: string;
  /** index of the entry in that step's `beat` */
  entry: number;
  /** zoom target index, for an action that stands for one target (not emitted today) */
  target?: number;
}

/** NaraScreen action (subset we emit) — matches electron/effects.ts Action. */
export interface NaraAction {
  id: string;
  type: string;
  timestamp: number;
  name?: string;
  /** The script entry this action was compiled from: steps[id=step].beat[entry].
   *  (A zoom's `targets` stay in one action: zoomTargets[k] is targets[k]; `target`
   *  is reserved for a per-target action.) Absent on the script-level music action. */
  source?: ActionSource;
  // zoom (zoomTargets is used when the zoom is narrated)
  zoomRect?: Rect;
  zoomTargets?: {
    rect: Rect;
    narrations?: Record<string, string>;
    audioPath?: Record<string, string>;
    customAudioPath?: string;
  }[];
  zoomDuration?: number;
  zoomHold?: number;
  // spotlight
  spotlightRects?: Rect[];
  dimOpacity?: number;
  spotlightDuration?: number;
  // callout
  calloutText?: string;
  calloutPosition?: [number, number];
  calloutStyle?: string;
  calloutStep?: number;
  calloutDuration?: number;
  /** Positioned text with a font size (used when fontSize/placement is set). */
  calloutPanels?: { text: string; rect: Rect; fontSize: number }[];
  /** calloutStyle "arrow": direction the arrow comes from (default: first that fits) and its colour */
  arrowFrom?: string;
  arrowColor?: string;
  /** calloutStyle "arrow": after it lands, circle the element with a pencil loop that then wipes away */
  arrowHighlight?: boolean;
  /** The highlight loop's colour (default: arrowColor). */
  arrowHighlightColor?: string;
  /** spotlight: soft edge width in px (default 0 = hard edge) */
  spotlightFeather?: number;
  /** spotlight: seconds the lit box takes to close in from the whole frame (default 0 = no animation) */
  spotlightConverge?: number;
  /** Arrow size multiplier (default: from the video size). */
  arrowScale?: number;
  /** calloutStyle "highlight" (fx highlight; calloutPanels[k].rect = each element): marker colour, look, lines per element */
  highlightColor?: string;
  highlightStyle?: "marker" | "underline";
  highlightLines?: number;
  // chapter (a chapter starts at `timestamp`; see api/fx-structure.ts)
  chapterTitle?: string;
  /** show the on-screen chapter badge (chapters.onScreen) */
  chapterBadge?: boolean;
  // transition (the page change is looked for in timestamp … transitionEnd)
  transitionEnd?: number;
  transitionStyle?: "fade" | "slide";
  transitionDuration?: number;
  // blur
  blurRects?: Rect[];
  blurRadius?: number;
  blurDuration?: number;
  // pause
  resumeAfter?: string | number;
  // narrate — audioPath points at audio the CLI pre-generated, keyed by lang;
  // the producer copies it and auto-fits the freeze to its length.
  narrations?: Record<string, string>;
  audioPath?: Record<string, string>;
  /** Pre-recorded audio file; the producer prefers it over audioPath. */
  customAudioPath?: string;
  freeze?: boolean;
  showSubtitles?: boolean;
  subtitleSize?: number;
  // speed / skip / mute ranges (end timestamps are in recording seconds)
  speedFactor?: number;
  speedEndTimestamp?: number;
  skipEndTimestamp?: number;
  muteEndTimestamp?: number;
  // background music (one per video; plays under everything)
  musicPath?: string;
  musicVolume?: number;
  musicDuckTo?: number;
}
