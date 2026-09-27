/** Form constraints read from the API schema (api/schema.ts, zod v4): min/max/step, enum options,
 *  defaults and `.describe()` help for every field the desktop edits. Nothing in the app may
 *  hand-type a range: ask `fieldMeta(scope, field)` / `numberMeta(...)` instead.
 *
 *  Defaults: the schema states most defaults only in its descriptions, so `API_DEFAULTS` below
 *  lists them once (zoom timing comes from BUILTIN_DEFAULTS); a unit test checks every entry
 *  against the description text so the two cannot drift. */
import type { z } from "zod";
import {
  ARROW_FROM,
  BUILTIN_DEFAULTS,
  CARD_TEMPLATES,
  CardSchema,
  DEFAULT_KOKORO_ENDPOINT,
  DefaultsSchema,
  DemoScriptSchema,
  FxEntrySchema,
  PlanSchema,
  QUALITY_CRF,
  RESOLUTIONS,
  TTS_LANGUAGES,
  TtsSchema,
  ZoomTargetSchema,
  type FxVerb,
  type Quality,
  type ResolutionName,
} from "../../api/schema";
import { DEFAULT_VOICES, LANG_LABELS } from "./voices";

// ─── field types ─────────────────────────────────────────────────────

export interface NumberMeta {
  kind: "number";
  /** Bounds as the schema states them; see effectiveMin/Max for exclusive ones. */
  min: number;
  max: number;
  minExclusive: boolean;
  maxExclusive: boolean;
  step: number;
  int: boolean;
  default?: number;
  /** "E.g. 24" from the description: a good first value when a field is switched on. */
  example?: number;
  unit?: "s" | "px" | "×";
  description?: string;
}
export interface EnumMeta<T extends string = string> {
  kind: "enum";
  options: readonly T[];
  default?: T;
  description?: string;
}
export interface BooleanMeta {
  kind: "boolean";
  default?: boolean;
  description?: string;
}
export interface TextMeta {
  kind: "text";
  /** Accepts a per-language map { en, hi, … } as well as a string. */
  localized: boolean;
  pattern?: RegExp;
  default?: string;
  description?: string;
}
export type DurationKeyword = "auto" | "step-end" | "end";
export interface DurationMeta {
  kind: "duration";
  seconds: NumberMeta;
  keywords: readonly DurationKeyword[];
  default?: number | DurationKeyword;
  description?: string;
}
export interface ListMeta {
  kind: "list";
  min: number;
  max: number;
  description?: string;
}
export interface OtherMeta {
  kind: "rect" | "map" | "object" | "other";
  description?: string;
}
export type FieldMeta = NumberMeta | EnumMeta | BooleanMeta | TextMeta | DurationMeta | ListMeta | OtherMeta;

// ─── scopes and field names (typed from the schema) ──────────────────

type FxOption = (typeof FxEntrySchema)["options"][number];
type FxShape<V extends FxVerb> = Extract<FxOption, { shape: { fx: z.ZodLiteral<V> } }>["shape"];
type MusicShape = NonNullable<z.infer<(typeof DemoScriptSchema)["shape"]["music"]>>;
type OutputShape = NonNullable<z.infer<(typeof DemoScriptSchema)["shape"]["output"]>>;

export type ScopeFields = { [V in FxVerb]: Exclude<keyof FxShape<V>, "fx"> & string } & {
  zoomTarget: keyof (typeof ZoomTargetSchema)["shape"] & string;
  card: keyof (typeof CardSchema)["shape"] & string;
  tts: keyof (typeof TtsSchema)["shape"] & string;
  plan: keyof (typeof PlanSchema)["shape"] & string;
  defaults: keyof (typeof DefaultsSchema)["shape"] & string;
  music: keyof MusicShape & string;
  output: keyof OutputShape & string;
  script: keyof (typeof DemoScriptSchema)["shape"] & string;
};
export type MetaScope = keyof ScopeFields;

type AnySchema = z.ZodType;
interface Def {
  type: string;
  innerType?: AnySchema;
  options?: AnySchema[];
  checks?: { _zod: { def: CheckDef } }[];
  entries?: Record<string, string>;
  element?: AnySchema;
  shape?: Record<string, AnySchema>;
}
interface CheckDef {
  check: string;
  value?: number;
  inclusive?: boolean;
  format?: string;
  minimum?: number;
  maximum?: number;
  pattern?: RegExp;
}
const defOf = (s: AnySchema): Def => (s as unknown as { _zod: { def: Def } })._zod.def;
const descOf = (s: AnySchema): string | undefined => (s as unknown as { description?: string }).description;
const shapeOf = (s: AnySchema): Record<string, AnySchema> => (s as unknown as { shape: Record<string, AnySchema> }).shape;

function fxShape(verb: FxVerb): Record<string, AnySchema> {
  const opt = FxEntrySchema.options.find((o) => (o.shape.fx as unknown as { value: string }).value === verb);
  if (!opt) throw new Error(`schemaMeta: no fx "${verb}" in the schema`);
  return shapeOf(opt as unknown as AnySchema);
}
const unwrapOpt = (s: AnySchema): AnySchema => {
  const d = defOf(s);
  return (d.type === "optional" || d.type === "default" || d.type === "nullable") && d.innerType ? unwrapOpt(d.innerType) : s;
};
const topShape = shapeOf(DemoScriptSchema as unknown as AnySchema);
const nestedShape = (key: string) => shapeOf(unwrapOpt(topShape[key]));

function scopeShape(scope: MetaScope): Record<string, AnySchema> {
  switch (scope) {
    case "zoomTarget": return shapeOf(ZoomTargetSchema as unknown as AnySchema);
    case "card": return shapeOf(CardSchema as unknown as AnySchema);
    case "tts": return shapeOf(TtsSchema as unknown as AnySchema);
    case "plan": return shapeOf(PlanSchema as unknown as AnySchema);
    case "defaults": return shapeOf(DefaultsSchema as unknown as AnySchema);
    case "music": return nestedShape("music");
    case "output": return nestedShape("output");
    case "script": return topShape;
    default: return fxShape(scope);
  }
}

// ─── defaults, units, steps (the parts the schema only states in words) ──

type Defaults = { [S in MetaScope]?: Partial<Record<ScopeFields[S], unknown>> };
/** API defaults (checked against the descriptions by lib/__tests__/schemaMeta.test.ts). */
export const API_DEFAULTS = {
  zoom: { zoomDuration: BUILTIN_DEFAULTS.zoomDuration, zoomHold: BUILTIN_DEFAULTS.zoomHold },
  defaults: { zoomDuration: BUILTIN_DEFAULTS.zoomDuration, zoomHold: BUILTIN_DEFAULTS.zoomHold },
  spotlight: { dimOpacity: 0.7, padding: 0, feather: 0, duration: "auto" },
  arrow: { color: "#F97316", fontSize: 24, highlight: false, duration: "auto" },
  callout: { style: "label", fontSize: 28, placement: "above", duration: "auto" },
  blur: { radius: 20, duration: "step-end" },
  pause: { seconds: 3 },
  narrate: { freeze: true, subtitles: true, subtitleSize: 28 },
  // factor is required by the schema; 2 is what the compiler falls back to.
  speed: { factor: 2 },
  music: { volume: 0.5, duckTo: 0.2 },
  output: { resolution: "native", quality: "high" },
  tts: { speed: 1, kokoroEndpoint: DEFAULT_KOKORO_ENDPOINT },
  card: { template: "clean", accent: "#4F46E5", duration: "auto" },
  script: { languages: ["en"] },
} as const satisfies Defaults;

/** Lower-thirds default to a bigger font than labels (API callout.fontSize description). */
export const LOWER_THIRD_FONT_SIZE = 36;
/** Overlays with "auto" duration and no narration after them last this long (compiler AUTO_FALLBACK_SEC). */
export const AUTO_FALLBACK_SEC = 3;

const UNITS: Record<string, NumberMeta["unit"]> = {
  zoomDuration: "s", zoomHold: "s", converge: "s", seconds: "s", duration: "s", targetSec: "s",
  padding: "px", feather: "px", radius: "px", fontSize: "px", subtitleSize: "px",
  factor: "×", speed: "×",
};
const STEPS: Record<string, number> = { dimOpacity: 0.05, volume: 0.05, duckTo: 0.05, factor: 0.05, speed: 0.05, converge: 0.1 };

// ─── introspection ───────────────────────────────────────────────────

function numberMetaOf(s: AnySchema, field: string, dflt: unknown, desc?: string): NumberMeta {
  let min = -Infinity, max = Infinity, minExclusive = false, maxExclusive = false, int = false;
  for (const c of defOf(s).checks ?? []) {
    const d = c._zod.def;
    if (d.check === "greater_than" && d.value != null) [min, minExclusive] = [d.value, !d.inclusive];
    else if (d.check === "less_than" && d.value != null) [max, maxExclusive] = [d.value, !d.inclusive];
    else if (d.check === "number_format" && (d.format === "safeint" || d.format === "int32")) int = true;
  }
  const span = max - min;
  const step = int ? 1 : (STEPS[field] ?? (span <= 4 ? 0.05 : 0.1));
  const ex = desc ? /E\.g\. (\d+(?:\.\d+)?)/.exec(desc) : null;
  return {
    kind: "number", min, max, minExclusive, maxExclusive, step, int,
    ...(typeof dflt === "number" ? { default: dflt } : {}),
    ...(ex ? { example: Number(ex[1]) } : {}),
    ...(UNITS[field] ? { unit: UNITS[field] } : {}),
    ...(desc ? { description: desc } : {}),
  };
}

function metaOf(outer: AnySchema, field: string, dflt: unknown): FieldMeta {
  const s = unwrapOpt(outer);
  const desc = descOf(outer) ?? descOf(s);
  const d = defOf(s);
  const withDesc = <T extends object>(m: T): T => (desc ? { ...m, description: desc } : m);
  switch (d.type) {
    case "number":
      return numberMetaOf(s, field, dflt, desc);
    case "enum": {
      const options = Object.values(d.entries ?? {});
      return withDesc({ kind: "enum", options, ...(typeof dflt === "string" ? { default: dflt } : {}) });
    }
    case "boolean":
      return withDesc({ kind: "boolean", ...(typeof dflt === "boolean" ? { default: dflt } : {}) });
    case "string": {
      const re = (d.checks ?? []).map((c) => c._zod.def).find((c) => c.format === "regex" || c.pattern)?.pattern;
      return withDesc({ kind: "text", localized: false, ...(re ? { pattern: re } : {}), ...(typeof dflt === "string" ? { default: dflt } : {}) });
    }
    case "union": {
      const opts = (d.options ?? []).map(unwrapOpt);
      const num = opts.find((o) => defOf(o).type === "number");
      if (num) {
        const keywords = opts.flatMap((o) => {
          const od = defOf(o);
          if (od.type === "enum") return Object.values(od.entries ?? {});
          if (od.type === "literal") return (od as unknown as { values: string[] }).values;
          return [];
        }) as DurationKeyword[];
        const seconds = numberMetaOf(num, "duration", typeof dflt === "number" ? dflt : undefined, descOf(num));
        return withDesc({ kind: "duration", seconds, keywords, ...(dflt != null ? { default: dflt as number | DurationKeyword } : {}) });
      }
      const localized = opts.some((o) => defOf(o).type === "record");
      return withDesc({ kind: "text", localized, ...(typeof dflt === "string" ? { default: dflt } : {}) });
    }
    case "array": {
      let min = 0, max = Infinity;
      for (const c of d.checks ?? []) {
        const cd = c._zod.def;
        if (cd.check === "min_length" && cd.minimum != null) min = cd.minimum;
        if (cd.check === "max_length" && cd.maximum != null) max = cd.maximum;
      }
      return withDesc({ kind: "list", min, max });
    }
    case "tuple": return withDesc({ kind: "rect" });
    case "record": return withDesc({ kind: "map" });
    case "object": return withDesc({ kind: "object" });
    default: return withDesc({ kind: "other" });
  }
}

const cache = new Map<string, FieldMeta>();

/** Constraints, default and help text of one schema field. Throws on an unknown field. */
export function fieldMeta<S extends MetaScope>(scope: S, field: ScopeFields[S]): FieldMeta {
  const key = `${scope}.${field}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const s = scopeShape(scope)[field];
  if (!s) throw new Error(`schemaMeta: ${scope} has no field "${field}"`);
  const dflt = (API_DEFAULTS as Defaults)[scope]?.[field as never];
  const meta = metaOf(s, field, dflt);
  cache.set(key, meta);
  return meta;
}

function expect<K extends FieldMeta["kind"]>(m: FieldMeta, kind: K, where: string): Extract<FieldMeta, { kind: K }> {
  if (m.kind !== kind) throw new Error(`schemaMeta: ${where} is a ${m.kind}, not a ${kind}`);
  return m as Extract<FieldMeta, { kind: K }>;
}
export const numberMeta = <S extends MetaScope>(scope: S, field: ScopeFields[S]): NumberMeta =>
  expect(fieldMeta(scope, field), "number", `${scope}.${field}`);
export const enumMeta = <S extends MetaScope>(scope: S, field: ScopeFields[S]): EnumMeta =>
  expect(fieldMeta(scope, field), "enum", `${scope}.${field}`);
export const booleanMeta = <S extends MetaScope>(scope: S, field: ScopeFields[S]): BooleanMeta =>
  expect(fieldMeta(scope, field), "boolean", `${scope}.${field}`);
/** spotlight / arrow / callout / blur `duration`; card `duration` too. */
export const durationMeta = (scope: "spotlight" | "arrow" | "callout" | "blur" | "card"): DurationMeta =>
  expect(fieldMeta(scope, "duration"), "duration", `${scope}.duration`);
export const listMeta = <S extends MetaScope>(scope: S, field: ScopeFields[S]): ListMeta =>
  expect(fieldMeta(scope, field), "list", `${scope}.${field}`);

/** Smallest / largest value a number field accepts (exclusive bounds nudged inwards). */
export function effectiveMin(m: NumberMeta): number {
  return m.minExclusive ? m.min + (m.int ? 1 : Math.min(m.step, 0.01)) : m.min;
}
export function effectiveMax(m: NumberMeta): number {
  return m.maxExclusive ? m.max - (m.int ? 1 : Math.min(m.step, 0.01)) : m.max;
}
/** Clamp (and round for integer fields) a value into what the schema accepts. */
export function clampToMeta(m: NumberMeta, v: number): number {
  if (!Number.isFinite(v)) return m.default ?? effectiveMin(m);
  const x = Math.min(effectiveMax(m), Math.max(effectiveMin(m), v));
  return m.int ? Math.round(x) : Math.round(x * 1000) / 1000;
}

// ─── enum lists and limits ───────────────────────────────────────────

export const RESOLUTION_OPTIONS = enumMeta("output", "resolution").options as readonly ResolutionName[];
export const QUALITY_OPTIONS = enumMeta("output", "quality").options as readonly Quality[];
/** Output size of a preset; null for "native" (the recording's own size). */
export function resolutionSize(r: ResolutionName): { width: number; height: number } | null {
  return r === "native" ? null : RESOLUTIONS[r];
}
export const QUALITY_CRF_VALUES = QUALITY_CRF;
export const ARROW_FROM_OPTIONS = ARROW_FROM;
export const CALLOUT_STYLES = enumMeta("callout", "style").options as readonly ("label" | "lower-third" | "step-counter")[];
export const CALLOUT_PLACEMENTS = enumMeta("callout", "placement").options as readonly ("above" | "below" | "over")[];
export const CARD_TEMPLATE_OPTIONS = CARD_TEMPLATES;
export const DURATION_KEYWORDS = durationMeta("spotlight").keywords;

/** Languages NaraScreen can speak, with display labels. */
export const LANGUAGE_OPTIONS: readonly { code: string; label: string }[] = TTS_LANGUAGES.map((code) => ({ code, label: LANG_LABELS[code] ?? code }));
export const isLanguage = (code: string): boolean => (TTS_LANGUAGES as readonly string[]).includes(code);
/** Kokoro voices for a language (catalog order; [0] is the built-in default). */
export const voicesFor = (lang: string): readonly string[] => DEFAULT_VOICES[lang] ?? [];
export const defaultVoice = (lang: string): string => DEFAULT_VOICES[lang]?.[0] ?? "af_heart";
/** Colour fields (#RRGGBB) the schema validates with a regex. */
export const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

/** Frequently used limits, read from the schema. */
export const LIMITS = {
  /** spotlight/blur rects and zoom targets */
  regionsMax: listMeta("spotlight", "rects").max,
  zoomTargetsMax: listMeta("zoom", "targets").max,
  overlaySecondsMax: durationMeta("spotlight").seconds.max,
  pauseSecondsMax: numberMeta("pause", "seconds").max,
  rangeSecondsMax: numberMeta("skip", "seconds").max,
  zoomDurationMax: numberMeta("zoom", "zoomDuration").max,
  zoomHoldMax: numberMeta("zoom", "zoomHold").max,
  fontSize: { min: numberMeta("callout", "fontSize").min, max: numberMeta("callout", "fontSize").max },
} as const;
