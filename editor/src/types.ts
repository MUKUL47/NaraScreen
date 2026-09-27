/** NaraScreen desktop data model (demo-project.json), v2.
 *
 *  Every v2 addition is optional, so any older demo-project.json still loads; `migrateProject`
 *  (lib/migrateProject.ts) runs on every load and rewrites deprecated shapes. Fields that mirror
 *  the demo-script API (api/schema.ts) say so; the converter in lib/projectToScript.ts maps them. */
import type { Card, DemoPlan, Quality, ResolutionName } from "../api/schema";

/** All supported action types */
export type ActionType =
  | "pause"
  | "zoom"
  | "narrate"
  | "spotlight"
  | "speed"
  | "skip"
  | "callout"
  | "music" // deprecated as an action: music is `DemoProject.music` (migrated on load)
  | "blur"
  | "mute";

/** What the UI treats as one effect: "arrow" is a callout with `calloutStyle: "arrow"`. */
export type EffectKind = ActionType | "arrow";

/** Timeline lanes (design brief §8.1). */
export type LaneId = "time" | "voice" | "camera" | "overlay" | "music";

/** [x, y, width, height] in recording pixels. */
export type Rect = [number, number, number, number];

/** API duration keywords for spotlight / callout / arrow / blur. In a timeline session there is
 *  one step, so "step-end" and "end" both mean the end of the video; "auto" = until the next
 *  narration ends, else 3 s. */
export type DurationMode = "auto" | "step-end" | "end";

/** Per-language values keyed by language code ("en", "hi", …). */
export type LangMap<T = string> = Record<string, T>;

/** Job sessions: the script entry an action was compiled from (emitted by the compiler). */
export interface ActionSource {
  step: string;
  entry: number;
  target?: number;
}

/** A zoom target with its own rect and optional narration (API zoom `targets[k]`). */
export interface ZoomTarget {
  rect: Rect;
  narrations?: LangMap; // per-language narration text
  audioPath?: LangMap; // generated audio (TTS preview clips) keyed by lang
  customAudioPath?: string; // legacy: one recorded file for every language
  /** API targets[k].audio as a per-language map (wins over customAudioPath for that lang). */
  customAudioPaths?: LangMap;
  /** API targets[k].voice (Kokoro id); undefined = the zoom's voice, else the project default. */
  voice?: string;
  /** API targets[k].lang: speak this target in this language whatever video is produced. */
  lang?: string;
  /** Seconds of the generated clip per language (set with audioPath). */
  audioDuration?: LangMap<number>;
  /** narrationHash(lang, voice, speed, text) the clip was generated from (stale detection). */
  audioTextHash?: LangMap;
}

/** A text panel with position, text, and styling */
export interface CalloutPanel {
  /** The text the renderer draws; also the fallback ("en") text. */
  text: string;
  rect: Rect; // [x, y, w, h]; the text starts at (x, y)
  fontSize: number; // px (API: 12–96)
  /** Per-language text (API callout/arrow `text` map). */
  texts?: LangMap;
}

/** A keyframe action placed on the recording timeline */
export interface TimelineAction {
  id: string;
  timestamp: number; // seconds into the recording where this action triggers (API `at`)
  type: ActionType;
  /** Optional display name for this action */
  name?: string;

  // ─── Common (v2) ───
  /** API fx.disabled: kept in the project, left out of the video. */
  disabled?: boolean;
  /** API fx.note (free text; `name` stays the display label). */
  note?: string;
  /** Job sessions: the script entry this action was compiled from. */
  source?: ActionSource;

  // Pause: freeze the video frame at this timestamp. API pause.seconds (number).
  /** Seconds to freeze (pause) or to play (narrate). The strings are deprecated (migrated to 3). */
  resumeAfter?: "narration" | "zoom" | number;

  // Zoom: smooth animated zoom to a region (single or multi-zoom sequence)
  /** @deprecated legacy single rect (migrated to zoomTargets) */
  zoomRect?: Rect;
  /** @deprecated legacy multi-rect (migrated to zoomTargets) */
  zoomRects?: Rect[];
  zoomTargets?: ZoomTarget[]; // per-target rect + narration (API max 10)
  zoomDuration?: number; // seconds to zoom in (and out); API default 0.8
  zoomHold?: number; // seconds to hold when not narrated; API default 2

  // Narrate (also zoom-level voice/lang)
  /** @deprecated English text (migrated to narrations.en) */
  narration?: string;
  /** @deprecated Hindi text (migrated to narrations.hi) */
  narration_hi?: string;
  audioPath?: LangMap; // generated audio files keyed by lang code
  /** Multi-language narrations keyed by lang code (API narrate map) */
  narrations?: LangMap;
  /** @deprecated never rendered (dropped on load) */
  playFor?: number;
  /** Legacy: one recorded file for every language (API `audio` string) */
  customAudioPath?: string;
  /** API `audio` map: recorded file per language (wins over customAudioPath for that lang). */
  customAudioPaths?: LangMap;
  /** API narrate/zoom `voice` (Kokoro id); undefined = the project default for the language. */
  voice?: string;
  /** API narrate/zoom `lang`: speak this line in this language whatever video is produced. */
  lang?: string;
  /** Seconds of the generated clip per language (clip width on the timeline). */
  audioDuration?: LangMap<number>;
  /** narrationHash(lang, voice, speed, text) the clip was generated from (stale detection). */
  audioTextHash?: LangMap;
  /** Show subtitles with word highlighting during narration (default: true) */
  showSubtitles?: boolean;
  /** Subtitle font size (API 16–64, default 28) */
  subtitleSize?: number;
  /** Narrate: freeze the frame while speaking. API default true (projectVersion 2); older files
   *  are migrated to an explicit value. Ignored on every other type (deprecated there). */
  freeze?: boolean;

  // Spotlight/Dim: highlight region(s) while dimming the rest
  /** @deprecated legacy single rect (migrated to spotlightRects) */
  spotlightRect?: Rect;
  spotlightRects?: Rect[]; // API max 10
  dimOpacity?: number; // 0.0-1.0, default 0.7
  spotlightDuration?: number; // seconds (used when durationMode is unset)
  spotlightFeather?: number; // soft edge width in px (default 0 = hard edge)
  spotlightConverge?: number; // seconds the lit box takes to close in (default: none)
  /** API spotlight.padding (px) around each rect, applied at render time. */
  spotlightPadding?: number;

  /** API duration keyword (spotlight / callout incl. arrow / blur); unset = the numeric duration. */
  durationMode?: DurationMode;

  // Speed Ramp: change playback speed for a range
  speedFactor?: number; // API 0.25–4
  speedEndTimestamp?: number; // when to return to 1x

  // Skip/Cut: remove a section of the recording
  skipEndTimestamp?: number; // cut from timestamp to this time

  // Text Callout (and Arrow, stored as a callout with calloutStyle "arrow")
  /** Fallback ("en") text of a panel-less callout, or the arrow label. */
  calloutText?: string;
  /** Per-language text for panel-less callouts and the arrow label (API `text` map). */
  calloutTexts?: LangMap;
  /** @deprecated legacy position of a panel-less label (still rendered) */
  calloutPosition?: [number, number];
  calloutStyle?: "label" | "arrow" | "step-counter" | "lower-third";
  calloutStep?: number; // for step-counter
  calloutDuration?: number; // seconds (used when durationMode is unset)
  /** Text panels with position, text, and font size (arrow: panels[0].rect = the target) */
  calloutPanels?: CalloutPanel[];
  /** calloutStyle "arrow": the side it comes from (default: the first that fits) */
  arrowFrom?: "left" | "right" | "above" | "below" | "top-left" | "top-right" | "bottom-left" | "bottom-right";
  arrowColor?: string; // "#RRGGBB" (default orange #F97316)
  arrowHighlight?: boolean; // after the arrow lands: pencil loop around the target
  arrowHighlightColor?: string; // "#RRGGBB" loop colour (default: arrowColor)
  /** Arrow size multiplier (flutter jobs; read-only in the UI). */
  arrowScale?: number;

  // Blur: apply blur to one or more regions
  blurRects?: Rect[]; // API max 10
  blurRadius?: number; // API 1–100, default 20
  blurDuration?: number; // seconds (used when durationMode is unset)

  // Mute: strip audio from a time range
  muteEndTimestamp?: number; // when mute ends

  /** @deprecated music actions are migrated to DemoProject.music */
  musicPath?: string;
  /** @deprecated see DemoProject.music */
  musicVolume?: number;
  /** @deprecated see DemoProject.music */
  musicDuckTo?: number;
  /** @deprecated never rendered (dropped on load) */
  musicEndTimestamp?: number;
}

/** A labeled overlay rect for showing reference points on the video player */
export interface LabeledOverlay {
  rect: Rect; // [x, y, w, h] in video coords
  label: string; // display label (name or type@timestamp)
  color: string; // CSS border/bg color (e.g. "blue", "purple")
  selected: boolean; // whether this belongs to the currently selected action
  actionId: string; // ID of the owning action
  rectIndex: number; // index into the owning action's rect array
}

/** Whole-video background music (API top-level `music`). */
export interface ProjectMusic {
  /** Absolute path of the audio file (empty = not chosen yet). */
  path: string;
  /** 0 < volume ≤ 1 (default 0.5). */
  volume: number;
  /** Volume under narration, 0–1 (default 0.2). */
  duckTo: number;
}

/** Project file saved as demo-project.json */
export interface DemoProject {
  title: string;
  baseUrl: string;
  recordingPath: string; // path to recording.mp4
  recordingDuration: number; // total duration in seconds
  /** The recording's real size (probed on record/import/open). */
  viewport: { width: number; height: number };
  output: {
    width: number;
    height: number;
    fps: number;
    format: string;
    /** API output.resolution (default "native"). */
    resolution?: ResolutionName;
    /** API output.quality (default "high"). */
    quality?: Quality;
  };
  tts: {
    provider: string;
    kokoroEndpoint: string;
    /** @deprecated legacy default voices; prefer voices[lang][0] */
    voiceEn: string;
    /** @deprecated legacy default voices; prefer voices[lang][0] */
    voiceHi: string;
    speed: number;
    /** voices[lang][0] is the default voice for lang (= API tts.voices[lang]); the rest is the catalog. */
    voices?: Record<string, string[]>;
    /** The languages this project produces (= API `languages`), default ["en"]. */
    languages?: string[];
  };
  actions: TimelineAction[]; // ordered by timestamp

  /** 2 once saved by a version that understands the v2 fields (drives the narrate freeze default). */
  projectVersion?: 2;
  /** Whole-video background music (replaces music actions). */
  music?: ProjectMusic;
  /** API intro / outro title cards (logo path absolute). */
  intro?: Card;
  outro?: Card;
  /** API plan (kept with the project; validate warns when the video drifts from it). */
  plan?: DemoPlan;
  /** Written by the CLI's buildProject when the folder is a job. */
  origin?: { kind: "job"; scriptPath: string; lang: string };
}

/** Computed at open time, not persisted. */
export type SessionKind = "timeline" | "job";

/** The open session (store state; not persisted). */
export interface SessionInfo {
  kind: SessionKind;
  /** Job sessions: the script that is the truth (job.scriptPath, else <job>/script.json). */
  scriptPath?: string;
  /** Job sessions: the language whose compiled demo-project.<lang>.json is shown. */
  viewLang?: string;
  /** Job sessions: the produced languages. */
  langs?: string[];
  /** Data mutations are rejected (job sessions show a compiled, read-only view). */
  readOnly: boolean;
}
