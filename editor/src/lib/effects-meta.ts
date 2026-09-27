// The one effect registry (design §14.5, SPEC §3.6). Replaces the per-type maps in lib/constants.ts.
import {
  Mic, ZoomIn, Lightbulb, MoveUpRight, Type, EyeOff, Gauge, Scissors, Pause, VolumeOff, Music,
  Film, Timer, AudioLines, Scan, Layers, type LucideIcon,
} from "lucide-react";
import type { ActionType, TimelineAction } from "../types";

/** Every effect the UI knows. "arrow" is stored as a callout with `calloutStyle: "arrow"`. */
export type EffectKind = ActionType | "arrow";
/** Effect lanes of the timeline (the Video/filmstrip lane carries no effects; see VIDEO_LANE). */
export type LaneId = "time" | "voice" | "camera" | "overlay" | "music";

export interface EffectMeta {
  kind: EffectKind;
  /** "Spotlight" */
  label: string;
  /** One line for tooltips, the Add bar and the palette. */
  description: string;
  icon: LucideIcon;
  lane: LaneId;
  /** pause = point, everything else spans a range. */
  shape: "range" | "point";
  /** Edited on the canvas with rects (regions, zoom targets, callout panels, arrow target). */
  hasRegions: boolean;
  /** Can carry narration (narrate itself; zoom targets). */
  speaks: boolean;
  /** Existing 1–9 kept, 0 = arrow, pause has none. */
  shortcut?: string;
  /** Palette search terms: "cut" finds Skip, "redact" Blur, "voiceover" Narration… */
  aliases: string[];
  /** Effect colour as hex, for <canvas>/SVG drawing where classes don't apply. */
  hex: string;
  /** Effect colour as a CSS variable reference: "var(--color-fx-zoom)". */
  cssVar: string;
  /** Literal Tailwind classes (spelled out so Tailwind generates them). */
  cls: {
    /** Icon / text in the effect colour. */
    text: string;
    /** Clip fill 18 %. */
    fill: string;
    /** Clip fill on hover 24 %. */
    fillHover: string;
    /** Selected clip fill 28 %. */
    fillSel: string;
    /** Border in the full colour. */
    border: string;
    /** Border at 60 % (clip active at the playhead). */
    borderSoft: string;
    /** Solid chip: full colour background with dark text (inspector type chip). */
    solid: string;
    /** Background in the full colour (2 px clip stripe, dots). */
    bg: string;
    /** Icon turns the effect colour when its `group` is hovered (Add bar). */
    groupHoverText: string;
    /** Outline colour (canvas region focus). */
    outline: string;
  };
}

/** Maps an action to its UI kind (arrow callouts are their own kind). */
export const effectKind = (a: Pick<TimelineAction, "type" | "calloutStyle">): EffectKind =>
  a.type === "callout" && a.calloutStyle === "arrow" ? "arrow" : a.type;

export const EFFECT_META: Record<EffectKind, EffectMeta> = {
  zoom: {
    kind: "zoom", label: "Zoom", description: "Magnify part of the frame", icon: ZoomIn, lane: "camera", shape: "range",
    hasRegions: true, speaks: true, shortcut: "1", aliases: ["magnify", "focus", "enlarge", "camera", "pan"],
    hex: "#5B9CFF", cssVar: "var(--color-fx-zoom)",
    cls: {
      text: "text-fx-zoom", fill: "bg-fx-zoom/18", fillHover: "bg-fx-zoom/24", fillSel: "bg-fx-zoom/28",
      border: "border-fx-zoom", borderSoft: "border-fx-zoom/60", solid: "bg-fx-zoom text-fg-inverse", bg: "bg-fx-zoom",
      groupHoverText: "group-hover:text-fx-zoom", outline: "outline-fx-zoom",
    },
  },
  narrate: {
    kind: "narrate", label: "Narration", description: "Speak a line of text-to-speech narration", icon: Mic, lane: "voice",
    shape: "range", hasRegions: false, speaks: true, shortcut: "2",
    aliases: ["narrate", "voiceover", "voice", "speech", "tts", "say", "talk", "subtitle"],
    hex: "#3DD68C", cssVar: "var(--color-fx-narrate)",
    cls: {
      text: "text-fx-narrate", fill: "bg-fx-narrate/18", fillHover: "bg-fx-narrate/24", fillSel: "bg-fx-narrate/28",
      border: "border-fx-narrate", borderSoft: "border-fx-narrate/60", solid: "bg-fx-narrate text-fg-inverse", bg: "bg-fx-narrate",
      groupHoverText: "group-hover:text-fx-narrate", outline: "outline-fx-narrate",
    },
  },
  spotlight: {
    kind: "spotlight", label: "Spotlight", description: "Dim everything except the regions you draw", icon: Lightbulb,
    lane: "overlay", shape: "range", hasRegions: true, speaks: false, shortcut: "3",
    aliases: ["highlight", "dim", "focus", "emphasis"],
    hex: "#F6C445", cssVar: "var(--color-fx-spotlight)",
    cls: {
      text: "text-fx-spotlight", fill: "bg-fx-spotlight/18", fillHover: "bg-fx-spotlight/24", fillSel: "bg-fx-spotlight/28",
      border: "border-fx-spotlight", borderSoft: "border-fx-spotlight/60", solid: "bg-fx-spotlight text-fg-inverse",
      bg: "bg-fx-spotlight", groupHoverText: "group-hover:text-fx-spotlight", outline: "outline-fx-spotlight",
    },
  },
  arrow: {
    kind: "arrow", label: "Arrow", description: "Point at a target with an animated arrow", icon: MoveUpRight, lane: "overlay",
    shape: "range", hasRegions: true, speaks: false, shortcut: "0", aliases: ["pointer", "point", "indicate", "circle", "loop"],
    hex: "#FF8A3D", cssVar: "var(--color-fx-arrow)",
    cls: {
      text: "text-fx-arrow", fill: "bg-fx-arrow/18", fillHover: "bg-fx-arrow/24", fillSel: "bg-fx-arrow/28",
      border: "border-fx-arrow", borderSoft: "border-fx-arrow/60", solid: "bg-fx-arrow text-fg-inverse", bg: "bg-fx-arrow",
      groupHoverText: "group-hover:text-fx-arrow", outline: "outline-fx-arrow",
    },
  },
  callout: {
    kind: "callout", label: "Callout", description: "Show a text label, step number or lower third", icon: Type,
    lane: "overlay", shape: "range", hasRegions: true, speaks: false, shortcut: "7",
    aliases: ["text", "label", "caption", "title", "step", "lower third", "annotation"],
    hex: "#2CC9E8", cssVar: "var(--color-fx-callout)",
    cls: {
      text: "text-fx-callout", fill: "bg-fx-callout/18", fillHover: "bg-fx-callout/24", fillSel: "bg-fx-callout/28",
      border: "border-fx-callout", borderSoft: "border-fx-callout/60", solid: "bg-fx-callout text-fg-inverse",
      bg: "bg-fx-callout", groupHoverText: "group-hover:text-fx-callout", outline: "outline-fx-callout",
    },
  },
  blur: {
    kind: "blur", label: "Blur", description: "Hide sensitive parts of the frame", icon: EyeOff, lane: "overlay", shape: "range",
    hasRegions: true, speaks: false, shortcut: "4", aliases: ["redact", "hide", "pixelate", "mask", "censor", "privacy"],
    hex: "#8F9BFF", cssVar: "var(--color-fx-blur)",
    cls: {
      text: "text-fx-blur", fill: "bg-fx-blur/18", fillHover: "bg-fx-blur/24", fillSel: "bg-fx-blur/28",
      border: "border-fx-blur", borderSoft: "border-fx-blur/60", solid: "bg-fx-blur text-fg-inverse", bg: "bg-fx-blur",
      groupHoverText: "group-hover:text-fx-blur", outline: "outline-fx-blur",
    },
  },
  speed: {
    kind: "speed", label: "Speed", description: "Speed up or slow down part of the video", icon: Gauge, lane: "time",
    shape: "range", hasRegions: false, speaks: false, shortcut: "6",
    aliases: ["speed ramp", "fast forward", "slow motion", "timelapse", "ramp"],
    hex: "#C586FF", cssVar: "var(--color-fx-speed)",
    cls: {
      text: "text-fx-speed", fill: "bg-fx-speed/18", fillHover: "bg-fx-speed/24", fillSel: "bg-fx-speed/28",
      border: "border-fx-speed", borderSoft: "border-fx-speed/60", solid: "bg-fx-speed text-fg-inverse", bg: "bg-fx-speed",
      groupHoverText: "group-hover:text-fx-speed", outline: "outline-fx-speed",
    },
  },
  skip: {
    kind: "skip", label: "Skip", description: "Cut a range out of the video", icon: Scissors, lane: "time", shape: "range",
    hasRegions: false, speaks: false, shortcut: "9", aliases: ["cut", "trim", "remove", "delete range"],
    hex: "#FF6369", cssVar: "var(--color-fx-skip)",
    cls: {
      text: "text-fx-skip", fill: "bg-fx-skip/18", fillHover: "bg-fx-skip/24", fillSel: "bg-fx-skip/28",
      border: "border-fx-skip", borderSoft: "border-fx-skip/60", solid: "bg-fx-skip text-fg-inverse", bg: "bg-fx-skip",
      groupHoverText: "group-hover:text-fx-skip", outline: "outline-fx-skip",
    },
  },
  pause: {
    kind: "pause", label: "Pause", description: "Freeze the frame for a few seconds", icon: Pause, lane: "time", shape: "point",
    hasRegions: false, speaks: false, aliases: ["freeze", "hold", "wait", "still"],
    hex: "#7DD3FC", cssVar: "var(--color-fx-pause)",
    cls: {
      text: "text-fx-pause", fill: "bg-fx-pause/18", fillHover: "bg-fx-pause/24", fillSel: "bg-fx-pause/28",
      border: "border-fx-pause", borderSoft: "border-fx-pause/60", solid: "bg-fx-pause text-fg-inverse", bg: "bg-fx-pause",
      groupHoverText: "group-hover:text-fx-pause", outline: "outline-fx-pause",
    },
  },
  mute: {
    kind: "mute", label: "Mute", description: "Silence the recording's own sound in a range", icon: VolumeOff, lane: "time",
    shape: "range", hasRegions: false, speaks: false, shortcut: "5", aliases: ["silence", "audio off", "quiet"],
    hex: "#98A2B3", cssVar: "var(--color-fx-mute)",
    cls: {
      text: "text-fx-mute", fill: "bg-fx-mute/18", fillHover: "bg-fx-mute/24", fillSel: "bg-fx-mute/28",
      border: "border-fx-mute", borderSoft: "border-fx-mute/60", solid: "bg-fx-mute text-fg-inverse", bg: "bg-fx-mute",
      groupHoverText: "group-hover:text-fx-mute", outline: "outline-fx-mute",
    },
  },
  music: {
    kind: "music", label: "Music", description: "Background music under the whole video", icon: Music, lane: "music",
    shape: "range", hasRegions: false, speaks: false, shortcut: "8", aliases: ["soundtrack", "background music", "bgm", "song"],
    hex: "#FF6FB5", cssVar: "var(--color-fx-music)",
    cls: {
      text: "text-fx-music", fill: "bg-fx-music/18", fillHover: "bg-fx-music/24", fillSel: "bg-fx-music/28",
      border: "border-fx-music", borderSoft: "border-fx-music/60", solid: "bg-fx-music text-fg-inverse", bg: "bg-fx-music",
      groupHoverText: "group-hover:text-fx-music", outline: "outline-fx-music",
    },
  },
};

/** The meta of an action (arrow callouts resolve to the Arrow entry). */
export const metaOf = (a: Pick<TimelineAction, "type" | "calloutStyle">): EffectMeta => EFFECT_META[effectKind(a)];

export interface LaneMeta {
  id: LaneId;
  label: string;
  icon: LucideIcon;
  kinds: EffectKind[];
  /** Double-click on an empty lane adds this kind; undefined = show a type picker. */
  defaultKind?: EffectKind;
}

/** Effect lanes, top to bottom, below the Video lane (§8.1). */
export const LANES: LaneMeta[] = [
  { id: "time", label: "Time", icon: Timer, kinds: ["speed", "skip", "pause", "mute"] },
  { id: "voice", label: "Voice", icon: AudioLines, kinds: ["narrate"], defaultKind: "narrate" },
  { id: "camera", label: "Camera", icon: Scan, kinds: ["zoom"], defaultKind: "zoom" },
  { id: "overlay", label: "Overlays", icon: Layers, kinds: ["spotlight", "arrow", "callout", "blur"] },
  { id: "music", label: "Music", icon: Music, kinds: ["music"], defaultKind: "music" },
];

/** The filmstrip lane at the top of the timeline (no effects of its own). */
export const VIDEO_LANE = { id: "video" as const, label: "Video", icon: Film };

/** Add bar / palette order, grouped by lane: Narration Zoom Spotlight Arrow Callout Blur | Speed Skip Pause Mute | Music. */
export const ADD_GROUPS: EffectKind[][] = [
  ["narrate", "zoom", "spotlight", "arrow", "callout", "blur"],
  ["speed", "skip", "pause", "mute"],
  ["music"],
];

export const EFFECT_KINDS: EffectKind[] = ADD_GROUPS.flat();

/** The kind a number key adds (1–9, 0), or undefined. */
export function kindForShortcut(key: string): EffectKind | undefined {
  return EFFECT_KINDS.find((k) => EFFECT_META[k].shortcut === key);
}
