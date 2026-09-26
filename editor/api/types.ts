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

/** One line of the runner's trace.jsonl — every beat slot, in order. */
export interface TraceEntry {
  beat: string; // beat id
  i: number; // index into the beat's flat list
  kind: "act" | "fx";
  act?: ActVerb;
  fx?: FxVerb;
  t: number; // seconds into the recording when this slot ran
  rect?: Rect; // post-reveal boundingBox (absent for non-element entries)
  /** fx with `anchors` (spotlight/blur) or zoom `targets`: one rect per
   *  anchor/target, index-aligned; rect === rects[0]. */
  rects?: Rect[];
}

/** NaraScreen action (subset we emit) — matches electron/effects.ts Action. */
export interface NaraAction {
  id: string;
  type: string;
  timestamp: number;
  name?: string;
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
