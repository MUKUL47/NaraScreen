/** Timeline-based video editor types */

/** All supported action types */
export type ActionType =
  | "pause"
  | "zoom"
  | "narrate"
  | "spotlight"
  | "speed"
  | "skip"
  | "callout"
  | "music"
  | "blur"
  | "mute";

/** A zoom target with its own rect and optional narration */
export interface ZoomTarget {
  rect: [number, number, number, number]; // [x, y, w, h] in video coords
  narrations?: Record<string, string>; // per-language narration text
  audioPath?: Record<string, string>; // pre-generated audio paths keyed by lang
  customAudioPath?: string; // custom recorded audio
}

/** A text panel with position, text, and styling */
export interface CalloutPanel {
  text: string;
  rect: [number, number, number, number]; // [x, y, w, h] in video coords
  fontSize: number; // font size in pixels (default 24)
}

/** A keyframe action placed on the recording timeline */
export interface TimelineAction {
  id: string;
  timestamp: number; // seconds into recording where this action triggers
  type: ActionType;
  /** Optional display name for this action */
  name?: string;

  // Pause: freeze the video frame at this timestamp
  resumeAfter?: "narration" | "zoom" | number;

  // Zoom: smooth animated zoom to a region (single or multi-zoom sequence)
  zoomRect?: [number, number, number, number]; // [x, y, w, h] legacy single rect
  zoomRects?: [number, number, number, number][]; // legacy multi-rect (no per-target narration)
  zoomTargets?: ZoomTarget[]; // modern: per-target rect + narration
  zoomDuration?: number; // animation duration in seconds (default 1)
  zoomHold?: number; // hold zoomed view for N seconds

  // Narrate: generate TTS and overlay (also used by zoom for narration-during-zoom)
  narration?: string; // English text (legacy compat)
  narration_hi?: string; // Hindi text (legacy compat)
  audioPath?: Record<string, string>; // generated audio files keyed by lang code
  /** Multi-language narrations keyed by lang code (e.g. { en: "...", hi: "...", es: "..." }) */
  narrations?: Record<string, string>;
  /** Seconds of video to keep playing during narration (0 = freeze immediately) */
  playFor?: number;
  /** Path to custom recorded audio (takes priority over TTS) */
  customAudioPath?: string;
  /** Show subtitles with word highlighting during narration (default: true) */
  showSubtitles?: boolean;
  /** Subtitle font size (default: 28) */
  subtitleSize?: number;
  /** Freeze video during this action instead of keeping it playing (default: false) */
  freeze?: boolean;

  // Spotlight/Dim: highlight region(s) while dimming the rest
  spotlightRect?: [number, number, number, number]; // [x, y, w, h] legacy single rect
  spotlightRects?: [number, number, number, number][]; // array of [x, y, w, h] for multi-spotlight
  dimOpacity?: number; // 0.0-1.0, default 0.7
  spotlightDuration?: number; // how long to show (seconds)

  // Speed Ramp: change playback speed for a range
  speedFactor?: number; // 0.5x, 2x, 3x, etc.
  speedEndTimestamp?: number; // when to return to 1x

  // Skip/Cut: remove a section of the recording
  skipEndTimestamp?: number; // cut from timestamp to this time

  // Text Callout: floating text label on the video
  calloutText?: string;
  calloutPosition?: [number, number]; // [x, y] in video coords
  calloutStyle?: "label" | "arrow" | "step-counter" | "lower-third";
  calloutStep?: number; // for step-counter auto-increment
  calloutDuration?: number; // how long to display (seconds)
  /** Multiple text panels with position, text, and font size */
  calloutPanels?: CalloutPanel[];

  // Blur: apply blur to one or more regions
  blurRects?: [number, number, number, number][]; // array of [x, y, w, h] in video coords
  blurRadius?: number; // blur strength (default 20)
  blurDuration?: number; // how long to show (seconds)

  // Mute: strip audio from a time range
  muteEndTimestamp?: number; // when mute ends

  // Background Music: ambient track with auto-ducking
  musicPath?: string; // path to audio file
  musicVolume?: number; // 0.0-1.0, default 0.5
  musicDuckTo?: number; // volume during narration (default 0.2)
  musicEndTimestamp?: number; // when music stops
}

/** A labeled overlay rect for showing reference points on the video player */
export interface LabeledOverlay {
  rect: [number, number, number, number]; // [x, y, w, h] in video coords
  label: string; // display label (name or type@timestamp)
  color: string; // CSS border/bg color (e.g. "blue", "purple")
  selected: boolean; // whether this belongs to the currently selected action
  actionId: string; // ID of the owning action
}

/** Project file saved as demo-project.json */
export interface DemoProject {
  title: string;
  baseUrl: string;
  recordingPath: string; // path to recording.mp4
  recordingDuration: number; // total duration in seconds
  viewport: { width: number; height: number };
  output: { width: number; height: number; fps: number; format: string };
  tts: {
    provider: string;
    kokoroEndpoint: string;
    voiceEn: string;
    voiceHi: string;
    speed: number;
    /** Available voices for each language */
    voices?: Record<string, string[]>;
    /** Available languages (e.g. ["en", "hi", "es", "fr"]) */
    languages?: string[];
  };
  actions: TimelineAction[]; // ordered by timestamp
}
