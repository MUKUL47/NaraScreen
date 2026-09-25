// ─── demo-script schema: the ONLY contract between an agent and NaraScreen ──
//
// An external agent describes a demo as intent — what to do in the browser and
// how to dress up the recording — in a *.demo-script.json file. It never writes
// timestamps or pixel positions (the runner discovers those while recording) and
// never touches NaraScreen's internals (demo-project.json, trace.jsonl, ...).
//
// This file is the single source of truth:
//   - `DemoScriptSchema` (zod) validates scripts and is exported as JSON Schema
//     by `narascreen schema`.
//   - The flat TypeScript interfaces below are what the engine code works with.
//     Keep both in sync when adding a field, and document it in api/MANUAL.md.
//
// Nothing here may mention a specific target app: the engine is app-agnostic.

import { z } from "zod";
import { LANG_CODES } from "../src/lib/voices";

export const SCRIPT_VERSION = 1 as const;
export const TTS_LANGUAGES = Object.keys(LANG_CODES) as [string, ...string[]];

// ─── Flat TypeScript types (what the engine uses) ────────────────────

/** Narrows where a selector searches. Pick ONE way to name the container. */
export interface Scope {
  /** CSS selector of the container, e.g. "form#signup" or "[data-section=billing]". */
  css?: string;
  /** The nearest element that contains this text, e.g. a table row / card. */
  text?: string;
  /** Container by ARIA role (+ optional accessible name), e.g. dialog / row. */
  role?: string;
  name?: string;
}

/** Finds ONE element on the page. Use exactly one base key:
 *  role(+name) | label | text | placeholder | testId | css. */
export interface Selector {
  role?: string;
  name?: string;
  label?: string;
  text?: string;
  placeholder?: string;
  testId?: string;
  css?: string;
  within?: Scope;
  exact?: boolean;
  nth?: number;
}

export type ActVerb =
  | "goto"
  | "waitFor"
  | "wait"
  | "click"
  | "fill"
  | "select"
  | "hover"
  | "press"
  | "scroll"
  | "useSession";

export type FxVerb =
  | "zoom"
  | "spotlight"
  | "callout"
  | "blur"
  | "pause"
  | "narrate"
  | "speed"
  | "skip"
  | "mute";

/** [x, y, width, height] in video pixels. */
export type Rect = [number, number, number, number];

/** Base selector keys (exactly one per targeted entry). */
export const SELECTOR_KEYS = ["role", "label", "text", "placeholder", "testId", "css"] as const;

/** Verbs that act on an element (need a selector). */
export const TARGETED_ACTS: ActVerb[] = ["waitFor", "click", "fill", "select", "hover"];
/** Verbs whose element's box becomes the default target of following fx. */
export const RECT_ACTS: ActVerb[] = ["click", "fill", "select", "hover", "scroll"];
/** fx that need an element box (anchor or inherited from the previous act). */
export const RECT_FX: FxVerb[] = ["zoom", "spotlight", "blur"];
/** fx that draw over the video for a time window (duration may be "auto"). */
export const OVERLAY_FX: FxVerb[] = ["spotlight", "callout", "blur"];
/** fx that change a stretch of the recording (range = until | seconds). */
export const RANGE_FX: FxVerb[] = ["speed", "skip", "mute"];

/** Where a range fx ends: after the next act finishes, at the end of this step,
 *  or (any other value) at the end of the step with that id. */
export type RangeUntil = "next-act" | "step-end" | (string & {});
/** Default `until` per range fx when neither `until` nor `seconds` is given. */
export const RANGE_DEFAULT_UNTIL: Record<"speed" | "skip" | "mute", RangeUntil> = {
  skip: "next-act",
  speed: "step-end",
  mute: "step-end",
};

/** Output presets — same choices as the desktop Produce dialog. */
export const RESOLUTIONS = {
  "4k": { width: 3840, height: 2160 },
  "1440p": { width: 2560, height: 1440 },
  "1080p": { width: 1920, height: 1080 },
  "720p": { width: 1280, height: 720 },
  "480p": { width: 854, height: 480 },
} as const;
export type ResolutionName = keyof typeof RESOLUTIONS | "native";
export const QUALITY_CRF = { high: 18, medium: 23, low: 28 } as const;
export type Quality = keyof typeof QUALITY_CRF;

export interface ActEntry extends Selector {
  act: ActVerb;
  /** goto: path relative to baseUrl (e.g. "/settings") … */
  path?: string;
  /** … or an absolute URL. */
  url?: string;
  /** wait: milliseconds to pause (recorded as-is). */
  ms?: number;
  /** fill: the text to type. (Legacy: `text` when another selector key is set.) */
  value?: string;
  /** select: the option label (or value) to choose. */
  option?: string;
  /** press: a key, e.g. "Enter", "Tab", "Control+A". */
  key?: string;
  /** scroll: absolute page Y to scroll to (when no selector is given). */
  y?: number;
  /** useSession: Playwright storageState file to switch to mid-run. */
  storageState?: string;
  /** waitFor: override defaults.timeoutMs. */
  timeoutMs?: number;
  note?: string;
}

export type NarrationText = string | Record<string, string>;
/** Pre-recorded audio: one file, or one per language. Absolute after validation. */
export type AudioSource = string | Record<string, string>;

/** One stop of a multi-target zoom (all targets share the same frozen frame). */
export interface ZoomTarget {
  anchor?: Selector;
  rect?: Rect;
  narrate?: NarrationText;
  audio?: AudioSource;
  voice?: string;
  lang?: string;
}

export interface FxEntry {
  fx: FxVerb;
  /** Element to show off. Omitted → the element of the previous act/fx in the beat. */
  anchor?: Selector;
  /** spotlight/blur: several elements at once (must be on screen together). */
  anchors?: Selector[];
  /** zoom: several elements in sequence, each with optional narration. */
  targets?: ZoomTarget[];
  /** Video-source scripts: when the effect starts (seconds into the source video). */
  at?: number;
  /** Video-source scripts: the region instead of an anchor. */
  rect?: Rect;
  rects?: Rect[];
  /** Keep the entry but leave it out of the video. */
  disabled?: boolean;
  /** callout: the label text. */
  text?: string;
  style?: "label" | "lower-third" | "step-counter";
  step?: number;
  /** callout: font size in px (default 28) and position relative to its element. */
  fontSize?: number;
  placement?: "above" | "below" | "over";
  /** spotlight/callout/blur: seconds on screen, or "auto" (default) =
   *  until the next narration in the same beat finishes, else 3s. */
  duration?: number | "auto" | "step-end" | "end";
  zoomDuration?: number;
  zoomHold?: number;
  dimOpacity?: number;
  radius?: number;
  /** pause: seconds to freeze. speed/skip/mute: length of the range. */
  seconds?: number;
  /** speed/skip/mute: where the range ends (see RangeUntil). */
  until?: RangeUntil;
  /** speed: playback rate for the range (0.25–4). */
  factor?: number;
  /** narrate / zoom: voiceover text, or a per-language map { en, hi, … }. */
  narrate?: NarrationText;
  /** narrate / zoom: pre-recorded audio instead of generated speech. */
  audio?: AudioSource;
  /** Force the language of this narration (overrides the produce language). */
  lang?: string;
  /** Kokoro voice ID for this narration (overrides tts.voices). */
  voice?: string;
  /** narrate: freeze the frame while speaking (default true). */
  freeze?: boolean;
  /** narrate: burn in word-highlighted subtitles (default true) and their size. */
  subtitles?: boolean;
  subtitleSize?: number;
  note?: string;
}

export type BeatEntry = ActEntry | FxEntry;

export interface Beat {
  id: string;
  label?: string;
  note?: string;
  /** Pause after every entry in this beat (overrides defaults.dwellMs). */
  dwellMs?: number;
  beat: BeatEntry[];
}

export interface DemoDefaults {
  dwellMs: number;
  revealMs: number;
  center: boolean;
  typeDelayMs: number;
  zoomDuration: number;
  zoomHold: number;
  timeoutMs: number;
}

export interface TtsConfig {
  kokoroEndpoint?: string;
  /** Voice per language, e.g. { en: "af_heart", hi: "hf_alpha" }. */
  voices?: Record<string, string>;
  speed?: number;
  /** Legacy single-language voices. Prefer `voices`. */
  voiceEn?: string;
  voiceHi?: string;
}

export interface MusicConfig {
  /** Absolute after validation. */
  path: string;
  volume?: number;
  duckTo?: number;
}

export interface OutputConfig {
  resolution?: ResolutionName;
  quality?: Quality;
}

export interface DemoScript {
  $schema?: string;
  version: 1;
  scope: string;
  /** Required for browser scripts; absent for video-source scripts. */
  baseUrl?: string;
  /** Edit an existing video instead of recording a website (path absolute after validation). */
  source?: { video: string };
  music?: MusicConfig;
  output?: OutputConfig;
  viewport: { width: number; height: number };
  /** Absolute path (validation resolves relative paths against the script file). */
  storageState?: string;
  setup?: ActEntry[];
  defaults?: Partial<DemoDefaults>;
  tts?: TtsConfig;
  languages?: string[];
  steps: Beat[];
}

export function isFx(e: BeatEntry): e is FxEntry {
  return (e as FxEntry).fx !== undefined;
}
export function isAct(e: BeatEntry): e is ActEntry {
  return (e as ActEntry).act !== undefined;
}

/** Built-in defaults — merged under the script's `defaults`. */
export const BUILTIN_DEFAULTS: DemoDefaults = {
  dwellMs: 1500,
  revealMs: 600,
  center: true,
  typeDelayMs: 60,
  zoomDuration: 0.8,
  zoomHold: 2.0,
  timeoutMs: 10_000,
};

export const DEFAULT_VIEWPORT = { width: 1440, height: 900 };
export const DEFAULT_KOKORO_ENDPOINT = "http://localhost:8880/v1/audio/speech";

// ─── zod schema (validation + published JSON Schema) ─────────────────

const str = () => z.string().min(1);

const ScopeSchema = z
  .object({
    css: str().optional().describe("CSS selector of the container to search inside."),
    text: str().optional().describe("Search inside the nearest element containing this text (e.g. a table row)."),
    role: str().optional().describe("Container ARIA role, e.g. dialog, row, form, navigation."),
    name: str().optional().describe("Accessible name of the `role` container."),
  })
  .strict()
  .describe("Restrict the search to one region of the page. Use css, text, or role(+name).");

const selectorShape = {
  role: str().optional().describe("ARIA role, e.g. button, link, textbox, checkbox, combobox, tab, heading, row, dialog."),
  name: str().optional().describe("Accessible name for `role` (its visible text/label). Substring match unless exact:true."),
  label: str().optional().describe("Form control by its <label>/aria-label text."),
  text: str().optional().describe("Element by its visible text. Exact match unless exact:false."),
  placeholder: str().optional().describe("Input by its placeholder text."),
  testId: str().optional().describe("Element by its data-testid attribute."),
  css: str().optional().describe("Raw CSS selector. Last resort — prefer role/label/text."),
  within: ScopeSchema.optional(),
  exact: z.boolean().optional().describe("Force exact (true) or substring (false) name/text matching."),
  nth: z.number().int().min(0).optional().describe("0-based index when several elements match (default 0)."),
};

const note = str().optional().describe("Free-form comment for humans/agents. Ignored by NaraScreen.");

export const SelectorSchema = z.object(selectorShape).strict().describe("Finds one element. Use exactly one of role|label|text|placeholder|testId|css.");

const act = <V extends ActVerb, S extends z.ZodRawShape>(verb: V, shape: S, desc: string) =>
  z.object({ act: z.literal(verb), ...shape, note }).strict().describe(desc);

export const ActEntrySchema = z.discriminatedUnion("act", [
  act("goto", {
    path: str().optional().describe("Path relative to baseUrl, e.g. \"/settings\" or \"/#/tasks\"."),
    url: str().optional().describe("Absolute URL. Use either path or url."),
  }, "Navigate the browser."),
  act("waitFor", {
    ...selectorShape,
    timeoutMs: z.number().int().positive().optional().describe("Max wait in ms (default defaults.timeoutMs)."),
  }, "Wait until an element is visible. Nothing is shown to the viewer."),
  act("wait", {
    ms: z.number().int().min(0).max(60_000).describe("Milliseconds to wait (appears in the video)."),
  }, "Plain pause, e.g. to let an animation finish."),
  act("click", selectorShape, "Click an element."),
  act("fill", {
    ...selectorShape,
    value: z.string().optional().describe("Text to type into the field (typed key-by-key on camera)."),
  }, "Clear a text field and type into it."),
  act("select", {
    ...selectorShape,
    option: str().describe("Option label (or value) to choose in a <select>."),
  }, "Choose an option in a native <select>."),
  act("hover", selectorShape, "Move the mouse over an element."),
  act("press", {
    ...selectorShape,
    key: str().describe("Key to press, e.g. Enter, Tab, Escape, Control+A. Optional selector focuses first."),
  }, "Press a keyboard key."),
  act("scroll", {
    ...selectorShape,
    y: z.number().min(0).optional().describe("Absolute page Y to scroll to, when no selector is given."),
  }, "Scroll an element into view (or to page Y)."),
  act("useSession", {
    storageState: str().describe("Path to a Playwright storageState JSON (cookies + localStorage)."),
    path: str().optional().describe("Where to navigate after switching (default: reload current page)."),
  }, "Switch to another logged-in session mid-demo (e.g. a second user)."),
]);

const NarrationSchema = z
  .union([str(), z.record(z.string(), str())])
  .describe("Voiceover text, or a per-language map like {\"en\": \"…\", \"hi\": \"…\"}.");
const AudioSchema = z
  .union([str(), z.record(z.string(), str())])
  .describe("Pre-recorded audio file (wav/mp3/m4a/ogg/webm) used instead of generated speech, or one per language. Paths are relative to the script. Add `narrate` text too if you want subtitles.");
const DurationSchema = z
  .union([z.number().positive().max(120), z.enum(["auto", "step-end", "end"])])
  .describe("Seconds on screen, or \"auto\" (default: until the next narration in this step ends, else 3s), \"step-end\" (until this step ends), or \"end\" (until the end of the video — e.g. to keep a secret blurred).");
const RectSchema = z
  .tuple([z.number().min(0), z.number().min(0), z.number().positive(), z.number().positive()])
  .describe("[x, y, width, height] in source-video pixels. Video-source scripts only (browser scripts use anchors).");
const voiceFields = {
  lang: z.enum(TTS_LANGUAGES).optional().describe("Force this narration's language."),
  voice: str().optional().describe("Kokoro voice ID for this narration (see `narascreen voices`)."),
};
/** Present on every fx. */
const commonFx = {
  at: z.number().min(0).optional().describe("Video-source scripts only (required there): when the effect starts, in seconds of the source video."),
  disabled: z.boolean().optional().describe("Leave this effect out of the video without deleting it."),
  note,
};
const rangeFields = {
  until: str().optional().describe("Where the range ends: \"next-act\" (when the next browser action in this step has finished), \"step-end\" (end of this step), or a step id (end of that later step). Defaults: skip → next-act; speed and mute → step-end. Browser scripts only."),
  seconds: z.number().positive().max(3600).optional().describe("Length of the range in seconds of recording (instead of `until`; required for video-source scripts)."),
};

export const ZoomTargetSchema = z
  .object({
    anchor: SelectorSchema.optional().describe("Element to zoom into (browser scripts)."),
    rect: RectSchema.optional(),
    narrate: NarrationSchema.optional().describe("Spoken while zoomed into this target."),
    audio: AudioSchema.optional(),
    ...voiceFields,
  })
  .strict();

const fx = <V extends FxVerb, S extends z.ZodRawShape>(verb: V, shape: S, desc: string) =>
  z.object({ fx: z.literal(verb), ...shape, ...commonFx }).strict().describe(desc);

export const FxEntrySchema = z.discriminatedUnion("fx", [
  fx("zoom", {
    anchor: SelectorSchema.optional(),
    rect: RectSchema.optional(),
    targets: z.array(ZoomTargetSchema).min(1).max(10).optional().describe("Zoom into several elements one after another on the same frozen frame, each with its own narration. Use instead of anchor/narrate."),
    zoomDuration: z.number().positive().max(10).optional().describe("Seconds to zoom in (and out). Default 0.8."),
    zoomHold: z.number().positive().max(60).optional().describe("Seconds to hold when not narrated. Default 2."),
    narrate: NarrationSchema.optional().describe("Speak while zoomed in; the hold stretches to fit the audio."),
    audio: AudioSchema.optional(),
    ...voiceFields,
  }, "Freeze the frame and zoom into an element (or several, via targets)."),
  fx("spotlight", {
    anchor: SelectorSchema.optional(),
    anchors: z.array(SelectorSchema).min(1).max(10).optional().describe("Several elements lit at once (they must be on screen together). Use instead of anchor."),
    rect: RectSchema.optional(),
    rects: z.array(RectSchema).min(1).max(10).optional(),
    duration: DurationSchema.optional(),
    dimOpacity: z.number().min(0).max(1).optional().describe("How dark the rest of the screen gets (default 0.7)."),
  }, "Dim everything except one or more elements."),
  fx("blur", {
    anchor: SelectorSchema.optional(),
    anchors: z.array(SelectorSchema).min(1).max(10).optional().describe("Several elements blurred at once. Use instead of anchor."),
    rect: RectSchema.optional(),
    rects: z.array(RectSchema).min(1).max(10).optional(),
    duration: DurationSchema.optional().describe("How long the blur stays. Default \"step-end\" (until this step ends) so a secret is never unblurred mid-step; use \"end\" to keep it hidden for the rest of the video."),
    radius: z.number().int().min(1).max(100).optional().describe("Blur strength (default 20)."),
  }, "Blur elements (hide secrets)."),
  fx("callout", {
    text: str().describe("Text to show."),
    style: z.enum(["label", "lower-third", "step-counter"]).optional().describe("label (default, next to the element) | lower-third (bottom banner) | step-counter (\"Step N: …\" next to the element)."),
    step: z.number().int().min(1).optional().describe("Step number for style step-counter."),
    anchor: SelectorSchema.optional(),
    rect: RectSchema.optional(),
    placement: z.enum(["above", "below", "over"]).optional().describe("Where the label sits relative to its element (default above; falls back to below when there is no room)."),
    fontSize: z.number().int().min(12).max(96).optional().describe("Text size in px (default 28; lower-third 36)."),
    duration: DurationSchema.optional(),
  }, "Show a text label on the video."),
  fx("pause", {
    seconds: z.number().positive().max(60).optional().describe("Seconds to freeze (default 3)."),
  }, "Freeze the frame silently."),
  fx("narrate", {
    narrate: NarrationSchema.optional().describe("Voiceover text, or a per-language map. Required unless `audio` is given."),
    audio: AudioSchema.optional(),
    freeze: z.boolean().optional().describe("Freeze the frame while speaking (default true). false = video keeps playing."),
    subtitles: z.boolean().optional().describe("Burn in word-highlighted subtitles (default true)."),
    subtitleSize: z.number().int().min(16).max(64).optional().describe("Subtitle font size in px (default 28)."),
    ...voiceFields,
  }, "Voiceover. The video freezes (default) for as long as the speech lasts."),
  fx("speed", {
    factor: z.number().min(0.25).max(4).describe("Playback speed for the range: 2 = twice as fast, 0.5 = slow motion."),
    ...rangeFields,
  }, "Speed up (or slow down) a stretch of the recording, e.g. fast-forward through form filling."),
  fx("skip", rangeFields, "Cut a stretch out of the video, e.g. waiting for a slow page."),
  fx("mute", rangeFields, "Silence the source video's own audio for a stretch (video-source scripts; browser recordings have no audio)."),
]);

export const BeatSchema = z
  .object({
    id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/).describe("Unique step id (letters, digits, - and _)."),
    label: str().optional().describe("Human title of the step."),
    note,
    dwellMs: z.number().int().min(0).max(30_000).optional().describe("Pause after each entry in this step (overrides defaults.dwellMs)."),
    beat: z.array(z.union([ActEntrySchema, FxEntrySchema])).min(1).describe("Ordered list of browser actions (act) and effects (fx)."),
  })
  .strict();

export const DefaultsSchema = z
  .object({
    dwellMs: z.number().int().min(0).max(30_000).optional().describe("Pause after each entry so viewers can follow (default 1500)."),
    revealMs: z.number().int().min(0).max(10_000).optional().describe("Settle time after scrolling a target into view (default 600)."),
    center: z.boolean().optional().describe("Scroll targets to the middle of the screen (default true)."),
    typeDelayMs: z.number().int().min(0).max(1000).optional().describe("Delay between typed keys in fill (default 60)."),
    zoomDuration: z.number().positive().max(10).optional().describe("Default zoom in/out seconds (default 0.8)."),
    zoomHold: z.number().positive().max(60).optional().describe("Default zoom hold seconds (default 2)."),
    timeoutMs: z.number().int().positive().max(120_000).optional().describe("How long to wait for an element (default 10000)."),
  })
  .strict();

export const TtsSchema = z
  .object({
    kokoroEndpoint: z.url().optional().describe(`Kokoro OpenAI-compatible speech endpoint (default ${DEFAULT_KOKORO_ENDPOINT}).`),
    voices: z.partialRecord(z.enum(TTS_LANGUAGES), str()).optional().describe("Voice per language, e.g. {\"en\": \"af_heart\"}."),
    speed: z.number().min(0.5).max(2).optional().describe("Speech speed (default 1)."),
    voiceEn: str().optional().describe("Legacy: English voice. Prefer voices.en."),
    voiceHi: str().optional().describe("Legacy: Hindi voice. Prefer voices.hi."),
  })
  .strict();

export const DemoScriptSchema = z
  .object({
    $schema: z.string().optional(),
    version: z.literal(SCRIPT_VERSION).describe("Always 1."),
    scope: str().describe("Short name of the demo (used as the title)."),
    baseUrl: z.url().optional().describe("Origin of the site to record, e.g. https://app.example.com. Required unless `source.video` is set."),
    source: z
      .object({ video: str().describe("Path to the video file (mp4/mov/mkv/webm), relative to this script.") })
      .strict()
      .optional()
      .describe("Edit an EXISTING video instead of recording a website. Steps then contain only fx entries, each with `at` (seconds) and `rect`/`rects` instead of anchors."),
    viewport: z
      .object({
        width: z.number().int().min(320).max(3840),
        height: z.number().int().min(240).max(2160),
      })
      .strict()
      .default(DEFAULT_VIEWPORT)
      .describe("Browser size = output video size (default 1440x900)."),
    storageState: str().optional().describe("Playwright storageState JSON to start logged in (path relative to this file)."),
    setup: z.array(ActEntrySchema).optional().describe("Browser actions run BEFORE recording starts (e.g. log in). Not in the video."),
    defaults: DefaultsSchema.optional(),
    tts: TtsSchema.optional(),
    languages: z.array(z.enum(TTS_LANGUAGES)).min(1).optional().describe("Languages to produce (one video each). Default [\"en\"]."),
    music: z
      .object({
        path: str().describe("Audio file (mp3/wav/m4a/ogg), relative to this script. Loops to fill the video."),
        volume: z.number().gt(0).max(1).optional().describe("Music volume, above 0 up to 1 (default 0.5). To drop the music, remove `music`."),
        duckTo: z.number().min(0).max(1).optional().describe("Volume while narration plays (default 0.2)."),
      })
      .strict()
      .optional()
      .describe("Background music under the whole video, automatically lowered during narration."),
    output: z
      .object({
        resolution: z.enum(["native", ...(Object.keys(RESOLUTIONS) as (keyof typeof RESOLUTIONS)[])]).optional().describe("native (default: the viewport / source size) | 480p | 720p | 1080p | 1440p | 4k. Letterboxed if the aspect ratio differs."),
        quality: z.enum(["high", "medium", "low"]).optional().describe("high (default) | medium | low — smaller files at lower quality."),
      })
      .strict()
      .optional()
      .describe("Final video size and quality (same presets as the desktop Produce dialog)."),
    steps: z.array(BeatSchema).min(1).describe("The demo, as ordered steps."),
  })
  .strict();

/** JSON Schema for `narascreen schema` (input shape: defaults are optional). */
export function demoScriptJsonSchema(): Record<string, unknown> {
  const schema = z.toJSONSchema(DemoScriptSchema, { io: "input" }) as Record<string, unknown>;
  return {
    ...schema,
    $id: "https://narascreen.local/demo-script.v1.schema.json",
    title: "NaraScreen demo-script v1",
    description:
      "Describes a product demo as intent: browser actions (act) and video effects (fx). " +
      "No timestamps or pixel coordinates — NaraScreen discovers them while recording.",
  };
}
