// ─── validate: load a demo-script and prove it is runnable ───────────
//
// Three layers, all reported together so an agent can fix everything in one go:
//   1. JSON + `${env:NAME}` interpolation (secrets stay out of script files)
//   2. structure (zod) — every entry validated on its own for precise paths
//   3. semantics — selector rules, element inheritance, languages, voices, files
// Throws AgentError (SCRIPT_* / ENV_VAR_MISSING). Returns warnings otherwise.

import { checkPlugins } from "./plugins";
import * as fs from "fs";
import * as path from "path";
import { z } from "zod";
import { AgentError } from "./errors";
import { DEFAULT_VOICES, LANG_CODES } from "../src/lib/voices";
import { probeDuration, probeResolution } from "../electron/ffmpeg";
import { ARIA_ROLES } from "./page-elements";
import {
  ActEntrySchema,
  BeatSchema,
  BUILTIN_DEFAULTS,
  DemoScriptSchema,
  FxEntrySchema,
  OVERLAY_FX,
  RANGE_DEFAULT_UNTIL,
  RANGE_FX,
  RECT_ACTS,
  RESOLUTIONS,
  RECT_FX,
  SELECTOR_KEYS,
  TARGETED_ACTS,
  TTS_LANGUAGES,
  isAct,
  isFx,
  type ActEntry,
  type AudioSource,
  type BeatEntry,
  type DemoScript,
  type FxEntry,
  type NarrationText,
  type Rect,
  type Selector,
} from "./schema";

export interface ScriptIssue {
  path: string;
  message: string;
  hint?: string;
}

export interface LoadedScript {
  /** Validated script: defaults applied, env resolved, paths absolute. */
  script: DemoScript;
  /** The file's JSON exactly as written (env placeholders intact). */
  raw: unknown;
  /** Absolute path of the script file. */
  path: string;
  dir: string;
  warnings: string[];
}

// ─── entry point ─────────────────────────────────────────────────────

export function loadScript(filePath: string, opts: { env?: NodeJS.ProcessEnv } = {}): LoadedScript {
  const abs = path.resolve(filePath);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
    throw new AgentError("SCRIPT_NOT_FOUND", `Script file not found: ${abs}`, {
      hint: "Pass the path to your *.demo-script.json. Create one with `narascreen init --url <site>`.",
    });
  }
  const text = fs.readFileSync(abs, "utf-8");
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const pos = /position (\d+)/.exec(msg);
    let where = "";
    if (pos) {
      const before = text.slice(0, Number(pos[1]));
      const line = before.split("\n").length;
      const col = before.length - before.lastIndexOf("\n");
      where = ` (line ${line}, column ${col})`;
    }
    throw new AgentError("SCRIPT_INVALID_JSON", `Script is not valid JSON${where}: ${msg}`, {
      hint: "Fix the JSON syntax (trailing commas and comments are not allowed).",
    });
  }
  const dir = path.dirname(abs);
  const { script, warnings } = validateScript(raw, { dir, env: opts.env });
  return { script, raw, path: abs, dir, warnings };
}

export function validateScript(
  raw: unknown,
  ctx: { dir: string; env?: NodeJS.ProcessEnv },
): { script: DemoScript; warnings: string[] } {
  const resolved = interpolateEnv(raw, ctx.env ?? process.env);
  const issues = checkStructure(resolved);
  if (issues.length) throw invalid(issues);

  const script = DemoScriptSchema.parse(resolved) as unknown as DemoScript;
  const warnings: string[] = [];
  const semantic = checkSemantics(script, ctx.dir, warnings);
  semantic.push(...checkPlugins(script, resolved, warnings));
  semantic.push(...checkCards(script, ctx.dir, warnings));
  checkPlan(script, warnings);
  if (semantic.length) throw invalid(semantic);
  return { script, warnings };
}

function invalid(issues: ScriptIssue[]): AgentError {
  const first = issues[0];
  return new AgentError(
    "SCRIPT_INVALID",
    `${issues.length} problem${issues.length > 1 ? "s" : ""} in the script. First: ${first.path}: ${first.message}`,
    {
      hint: "Fix every issue listed in details.issues, then run `narascreen validate` again.",
      where: { path: first.path },
      details: { issues },
    },
  );
}

// ─── 1. env interpolation ────────────────────────────────────────────

const ENV_RE = /\$\{env:([A-Za-z_][A-Za-z0-9_]*)\}/g;

function interpolateEnv(value: unknown, env: NodeJS.ProcessEnv): unknown {
  const missing: { name: string; path: string }[] = [];
  const walk = (v: unknown, p: string): unknown => {
    if (typeof v === "string") {
      return v.replace(ENV_RE, (_m, name: string) => {
        const val = env[name];
        if (val == null) {
          missing.push({ name, path: p });
          return "";
        }
        return val;
      });
    }
    if (Array.isArray(v)) return v.map((x, i) => walk(x, `${p}[${i}]`));
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v)) out[k] = walk(x, p ? `${p}.${k}` : k);
      return out;
    }
    return v;
  };
  const out = walk(value, "");
  if (missing.length) {
    const names = [...new Set(missing.map((m) => m.name))];
    throw new AgentError(
      "ENV_VAR_MISSING",
      `Environment variable${names.length > 1 ? "s" : ""} not set: ${names.join(", ")}`,
      {
        hint: `The script references \${env:NAME} placeholders. CLI: export them before running (e.g. ${names[0]}=... narascreen <command> …). HTTP: they come from the environment \`narascreen serve\` was started with — restart it with the variable set.`,
        where: { path: missing[0].path },
        details: { variables: names, usedAt: missing.map((m) => m.path) },
      },
    );
  }
  return out;
}

// ─── 2. structure ────────────────────────────────────────────────────

/** Top level + beats with entries left opaque; entries are checked one by one
 *  below so an error points at exactly one entry instead of a union blob. */
const ShellSchema = DemoScriptSchema.extend({
  setup: z.array(z.unknown()).optional(),
  steps: z.array(BeatSchema.extend({ beat: z.array(z.unknown()).min(1) })).min(1),
});

const ACT_VERBS = ActEntrySchema.options.map((o) => o.shape.act.value as string);
const FX_VERBS = FxEntrySchema.options.map((o) => o.shape.fx.value as string);
const KNOWN_KEYS = collectKeys();

function checkStructure(resolved: unknown): ScriptIssue[] {
  const issues: ScriptIssue[] = [];
  const top = ShellSchema.safeParse(resolved);
  if (!top.success) issues.push(...zodIssues(top.error, [], resolved));

  const obj = (resolved ?? {}) as { setup?: unknown; steps?: unknown };
  if (Array.isArray(obj.setup)) {
    obj.setup.forEach((e, i) => issues.push(...checkEntry(e, ["setup", i], true)));
  }
  if (Array.isArray(obj.steps)) {
    obj.steps.forEach((b, si) => {
      const beat = (b as { beat?: unknown })?.beat;
      if (Array.isArray(beat)) {
        beat.forEach((e, i) => issues.push(...checkEntry(e, ["steps", si, "beat", i], false)));
      }
    });
  }
  return issues;
}

function checkEntry(e: unknown, at: (string | number)[], actsOnly: boolean): ScriptIssue[] {
  const p = fmtPath(at);
  if (!e || typeof e !== "object" || Array.isArray(e)) {
    return [{ path: p, message: "entry must be an object like {\"act\": \"click\", …} or {\"fx\": \"narrate\", …}" }];
  }
  const o = e as Record<string, unknown>;
  const hasAct = "act" in o;
  const hasFx = "fx" in o;
  if (hasAct && hasFx) return [{ path: p, message: "entry has both `act` and `fx` — split it into two entries" }];
  if (!hasAct && !hasFx) {
    return [{ path: p, message: "entry needs an `act` (browser action) or `fx` (video effect) field" }];
  }
  if (hasFx && actsOnly) {
    return [{ path: p, message: "setup may only contain browser actions (act), not effects (fx) — setup is not recorded" }];
  }
  if (hasAct && !ACT_VERBS.includes(String(o.act))) {
    return [{
      path: `${p}.act`,
      message: `unknown act "${String(o.act)}"`,
      hint: didYouMean(String(o.act), ACT_VERBS) ?? `valid acts: ${ACT_VERBS.join(", ")}`,
    }];
  }
  if (hasFx && !FX_VERBS.includes(String(o.fx))) {
    return [{
      path: `${p}.fx`,
      message: `unknown fx "${String(o.fx)}"`,
      hint: didYouMean(String(o.fx), FX_VERBS) ?? `valid fx: ${FX_VERBS.join(", ")}`,
    }];
  }
  const res = (hasAct ? ActEntrySchema : FxEntrySchema).safeParse(e);
  return res.success ? [] : zodIssues(res.error, at, e);
}

function zodIssues(err: z.ZodError, prefix: (string | number)[], input: unknown): ScriptIssue[] {
  const out: ScriptIssue[] = [];
  for (const iss of err.issues) {
    const rel = iss.path as (string | number)[];
    const p = fmtPath([...prefix, ...rel]);
    if (rel.length && valueAt(input, rel) === undefined && iss.code !== "unrecognized_keys") {
      out.push({ path: p, message: `missing required field "${rel[rel.length - 1]}"` });
      continue;
    }
    if (iss.code === "unrecognized_keys") {
      for (const key of iss.keys) {
        out.push({
          path: p ? `${p}.${key}` : key,
          message: `unknown field "${key}"`,
          hint: didYouMean(key, KNOWN_KEYS) ?? "remove it (see `narascreen schema` for allowed fields)",
        });
      }
      continue;
    }
    out.push({ path: p || "(root)", message: iss.message });
  }
  return out;
}

function valueAt(root: unknown, parts: (string | number)[]): unknown {
  let v: unknown = root;
  for (const k of parts) {
    if (v == null || typeof v !== "object") return undefined;
    v = (v as Record<string | number, unknown>)[k];
  }
  return v;
}

function fmtPath(parts: (string | number)[]): string {
  return parts.reduce<string>(
    (acc, part) => (typeof part === "number" ? `${acc}[${part}]` : acc ? `${acc}.${part}` : part),
    "",
  );
}

function collectKeys(): string[] {
  const keys = new Set<string>(Object.keys(DemoScriptSchema.shape));
  for (const s of [...ActEntrySchema.options, ...FxEntrySchema.options]) Object.keys(s.shape).forEach((k) => keys.add(k));
  Object.keys(BeatSchema.shape).forEach((k) => keys.add(k));
  Object.keys(BUILTIN_DEFAULTS).forEach((k) => keys.add(k));
  ["kokoroEndpoint", "voices", "speed", "width", "height"].forEach((k) => keys.add(k));
  return [...keys];
}

// ─── 3. semantics ────────────────────────────────────────────────────

function checkSemantics(script: DemoScript, dir: string, warnings: string[]): ScriptIssue[] {
  const issues: ScriptIssue[] = [];
  const langs = script.languages ?? ["en"];
  const video = script.source ? probeSource(script, dir, issues) : null;
  const videoMode = !!script.source;

  if (!videoMode && !script.baseUrl) {
    issues.push({ path: "baseUrl", message: "missing required field \"baseUrl\"", hint: "Set the site's origin, or set source.video to edit an existing video instead." });
  }
  if (videoMode) {
    if (script.baseUrl) warnings.push("baseUrl is ignored for video-source scripts.");
    if (script.setup?.length) issues.push({ path: "setup", message: "setup is only for browser scripts (a video-source script records nothing)" });
    if (script.storageState) issues.push({ path: "storageState", message: "storageState is only for browser scripts" });
  }

  // storageState (legacy "__NONE__" = none) → absolute, must exist
  if (script.storageState === "__NONE__") {
    delete script.storageState;
    warnings.push(`storageState: "__NONE__" is legacy — just omit storageState.`);
  } else if (script.storageState) {
    const p = resolveFile(script.storageState, dir);
    if (!fs.existsSync(p)) {
      issues.push({
        path: "storageState",
        message: `file not found: ${p}`,
        hint: "Create it by logging in with Playwright and saving context.storageState(), or log in with `setup` steps instead.",
      });
    }
    script.storageState = p;
  }

  if (script.music) {
    script.music.path = resolveExisting(script.music.path, dir, "music.path", issues);
  }

  (script.setup ?? []).forEach((e, i) => checkAct(e, `setup[${i}]`, dir, issues, warnings));

  const ids = script.steps.map((b) => b.id);
  const seen = new Map<string, number>();
  let narrationCount = 0;
  script.steps.forEach((beat, si) => {
    const bp = `steps[${si}]`;
    if (seen.has(beat.id)) {
      issues.push({ path: `${bp}.id`, message: `duplicate step id "${beat.id}" (also steps[${seen.get(beat.id)}])` });
    } else seen.set(beat.id, si);

    if (beat.dwellMs != null && beat.dwellMs > 8000) {
      warnings.push(`${bp}.dwellMs: ${beat.dwellMs}ms after every entry makes the video drag.`);
    }

    // Can an fx without an anchor inherit an element box from earlier in the beat?
    let hasRect = false;
    beat.beat.forEach((entry, i) => {
      const ep = `${bp}.beat[${i}]`;
      if (isAct(entry)) {
        if (videoMode) {
          issues.push({ path: ep, message: "video-source scripts contain only effects (fx) — there is no browser to act on" });
          return;
        }
        checkAct(entry, ep, dir, issues, warnings);
        if (RECT_ACTS.includes(entry.act) && (countSelectorKeys(entry) > 0 || (entry.act === "swipe" && entry.to))) hasRect = true;
        return;
      }
      if (!isFx(entry)) return;
      const fx = entry as FxEntry;
      const ctx: FxCtx = { ep, dir, langs, videoMode, video, issues, warnings };

      if (videoMode) checkVideoFx(fx, ctx);
      else checkBrowserFx(fx, ctx);
      if (fx.anchor && fx.anchors) issues.push({ path: ep, message: "use either anchor or anchors, not both" });
      if (fx.rect && fx.rects) issues.push({ path: ep, message: "use either rect or rects, not both" });

      const ownsRect = !!(fx.anchor || fx.anchors || fx.rect || fx.rects || fx.targets);
      if (ownsRect) hasRect = true;

      if (fx.fx === "zoom" && fx.targets) {
        if (fx.anchor || fx.rect || fx.narrate != null || fx.audio != null) {
          issues.push({ path: ep, message: "with `targets`, put anchor/rect/narrate/audio inside each target instead of on the zoom" });
        }
        fx.targets.forEach((t, ti) => {
          const tp = `${ep}.targets[${ti}]`;
          if (videoMode ? !t.rect : !t.anchor) {
            issues.push({ path: tp, message: videoMode ? "each target needs a rect" : "each target needs an anchor" });
          }
          if (t.anchor) checkSelector(t.anchor, `${tp}.anchor`, issues, true);
          if (t.narrate != null || t.audio != null) {
            narrationCount++;
            checkNarration(t, tp, langs, dir, issues, warnings);
          }
        });
      }

      if (RECT_FX.includes(fx.fx) && !ownsRect && (videoMode || !hasRect)) {
        issues.push({
          path: ep,
          message: `${fx.fx} needs ${videoMode ? "a rect (or rects)" : "an element to target"}`,
          hint: videoMode
            ? "Give rect: [x, y, width, height] in source-video pixels (look at `preview --raw` frames)."
            : "Add an `anchor` selector, or place it right after a click/fill/select/hover/scroll/waitFor in the same step (it then targets that element).",
        });
      }
      if (fx.fx === "callout") {
        const positioned = (fx.style ?? "label") !== "lower-third";
        if (positioned && !ownsRect && (videoMode || !hasRect)) {
          warnings.push(`${ep}: callout has no element to sit next to, so it will be drawn at the top-left. Add an ${videoMode ? "rect" : "anchor"} or use style "lower-third".`);
        }
        if (fx.text && typeof fx.text === "object") checkLangMap(fx.text, `${ep}.text`, langs, true, issues);
        else if (typeof fx.text === "string" && langs.some((l) => l !== "en")) {
          warnings.push(`${ep}: callout text is the same in every language (${langs.join(", ")}). Use a map like {"en": "…", "hi": "…"}.`);
        }
        if (fx.style === "step-counter" && fx.step == null) {
          warnings.push(`${ep}: step-counter callout has no \`step\` number.`);
        }
      }
      if (fx.fx === "arrow" && fx.text && typeof fx.text === "object") checkLangMap(fx.text, `${ep}.text`, langs, true, issues);
      if (fx.duration != null && fx.duration !== "auto" && !OVERLAY_FX.includes(fx.fx)) {
        warnings.push(`${ep}: duration has no effect on ${fx.fx}.`);
      }
      if (RANGE_FX.includes(fx.fx)) checkRange(fx, ctx, si, ids, beat.beat.slice(i + 1));
      if (fx.fx === "narrate" && fx.narrate == null && fx.audio == null) {
        issues.push({ path: ep, message: "narrate needs `narrate` (text to speak) or `audio` (a recorded file)" });
      }
      if ((fx.fx === "narrate" || fx.fx === "zoom") && (fx.narrate != null || fx.audio != null)) {
        narrationCount++;
        checkNarration(fx, ep, langs, dir, issues, warnings);
      }
    });
  });

  // tts voices
  for (const [lang, voice] of Object.entries(script.tts?.voices ?? {})) {
    checkVoice(voice, lang, `tts.voices.${lang}`, warnings);
  }
  if (narrationCount === 0) {
    warnings.push("No narration in any step — the video will have no voiceover. Add {\"fx\": \"narrate\", \"narrate\": \"…\"} entries.");
  }
  if (script.output?.resolution && script.output.resolution !== "native") {
    const r = RESOLUTIONS[script.output.resolution];
    const src = video ?? script.viewport;
    if (Math.abs(r.width / r.height - src.width / src.height) > 0.02) {
      warnings.push(`output.resolution ${script.output.resolution} has a different shape than the ${video ? "source video" : "viewport"} (${src.width}x${src.height}); the video will be letterboxed.`);
    }
  }
  return issues;
}

interface FxCtx {
  ep: string;
  dir: string;
  langs: string[];
  videoMode: boolean;
  video: { width: number; height: number; duration: number } | null;
  issues: ScriptIssue[];
  warnings: string[];
}

/** Probe source.video; make its path absolute; set the viewport to its size. */
function probeSource(script: DemoScript, dir: string, issues: ScriptIssue[]) {
  const p = resolveExisting(script.source!.video, dir, "source.video", issues);
  script.source!.video = p;
  if (!fs.existsSync(p)) return null;
  const duration = probeDuration(p);
  if (!(duration > 0)) {
    issues.push({ path: "source.video", message: `not a readable video: ${p}` });
    return null;
  }
  const { width, height } = probeResolution(p);
  script.viewport = { width, height };
  return { width, height, duration };
}

function checkBrowserFx(fx: FxEntry, c: FxCtx) {
  if (fx.at != null) c.issues.push({ path: `${c.ep}.at`, message: "`at` is only for video-source scripts — in browser scripts an effect happens where it sits in the step" });
  if (fx.rect || fx.rects || fx.targets?.some((t) => t.rect)) {
    c.issues.push({ path: c.ep, message: "`rect`/`rects` are only for video-source scripts — use `anchor`/`anchors` (selectors)" });
  }
  if (fx.anchor) checkSelector(fx.anchor, `${c.ep}.anchor`, c.issues, true);
  fx.anchors?.forEach((a, ai) => checkSelector(a, `${c.ep}.anchors[${ai}]`, c.issues, true));
  if (fx.fx === "mute") c.warnings.push(`${c.ep}: browser recordings have no audio, so mute has no effect.`);
}

function checkVideoFx(fx: FxEntry, c: FxCtx) {
  if (fx.anchor || fx.anchors || fx.targets?.some((t) => t.anchor)) {
    c.issues.push({ path: c.ep, message: "anchors are only for browser scripts — use `rect` / `rects` in video-source scripts" });
  }
  if (fx.at == null) {
    c.issues.push({ path: c.ep, message: "missing required field \"at\" (seconds into the source video)" });
  } else if (c.video && fx.at >= c.video.duration) {
    c.issues.push({ path: `${c.ep}.at`, message: `at ${fx.at}s is past the end of the source video (${c.video.duration.toFixed(1)}s)` });
  }
  const rects = [fx.rect, ...(fx.rects ?? []), ...(fx.targets ?? []).map((t) => t.rect)].filter(Boolean) as Rect[];
  if (c.video) {
    for (const [x, y, w, h] of rects) {
      if (x + w > c.video.width || y + h > c.video.height) {
        c.issues.push({ path: c.ep, message: `rect [${x}, ${y}, ${w}, ${h}] goes outside the ${c.video.width}x${c.video.height} video` });
      }
    }
  }
}

function checkRange(fx: FxEntry, c: FxCtx, stepIndex: number, ids: string[], rest: BeatEntry[]) {
  if (fx.until != null && fx.seconds != null) {
    c.issues.push({ path: c.ep, message: "use either `until` or `seconds`, not both" });
    return;
  }
  if (c.videoMode) {
    if (fx.until != null) c.issues.push({ path: `${c.ep}.until`, message: "video-source scripts use `seconds` for ranges (there are no browser actions to end at)" });
    else if (fx.seconds == null) c.issues.push({ path: c.ep, message: `${fx.fx} needs \`seconds\` (length of the range) in video-source scripts` });
    return;
  }
  if (fx.seconds != null) return;
  const until = fx.until ?? RANGE_DEFAULT_UNTIL[fx.fx as keyof typeof RANGE_DEFAULT_UNTIL];
  if (until === "next-act") {
    if (!rest.some((e) => isAct(e))) {
      c.issues.push({
        path: c.ep,
        message: `${fx.fx} ends at the next browser action (until "next-act"), but none follows it in this step`,
        hint: "Put the action to skip over after it in the same step, or set until: \"step-end\" / a step id / seconds.",
      });
    }
  } else if (until !== "step-end") {
    const target = ids.indexOf(until);
    if (target < 0) {
      c.issues.push({ path: `${c.ep}.until`, message: `unknown step id "${until}"`, hint: `use "next-act", "step-end" or one of: ${ids.join(", ")}` });
    } else if (target < stepIndex) {
      c.issues.push({ path: `${c.ep}.until`, message: `step "${until}" comes before this one — a range can only end at this or a later step` });
    }
  }
}

function checkAct(e: ActEntry, ep: string, dir: string, issues: ScriptIssue[], warnings: string[]) {
  const n = countSelectorKeys(e);

  if (e.act === "fill") {
    // Legacy form: {act:"fill", label:"Name", text:"typed value"} — `text` was the value.
    if (e.value == null && e.text != null && n > 1) {
      e.value = e.text;
      delete e.text;
      warnings.push(`${ep}: fill uses \`text\` as the typed value (legacy). Rename it to \`value\`.`);
    } else if (e.value == null) {
      issues.push({ path: ep, message: "fill needs `value` (the text to type)" });
    }
  }

  if (e.act === "goto") {
    if (!!e.path === !!e.url) issues.push({ path: ep, message: "goto needs exactly one of `path` or `url`" });
  }

  if (TARGETED_ACTS.includes(e.act)) {
    checkSelector(e, ep, issues, true);
  } else if (e.act === "press" || e.act === "scroll" || e.act === "swipe") {
    if (countSelectorKeys(e) > 0) checkSelector(e, ep, issues, true);
    else checkSelector(e, ep, issues, false);
    if (e.act === "scroll" && countSelectorKeys(e) === 0 && e.y == null) {
      issues.push({ path: ep, message: "scroll needs a selector (element to bring into view) or `y`" });
    }
  }

  if (e.act === "useSession" && e.storageState) {
    const p = resolveFile(e.storageState, dir);
    if (!fs.existsSync(p)) issues.push({ path: `${ep}.storageState`, message: `file not found: ${p}` });
    e.storageState = p;
  }

  if (e.act === "swipe" && e.to) checkSelector(e.to, `${ep}.to`, issues, true);

  if (e.act === "upload" && e.files != null) {
    const list = Array.isArray(e.files) ? e.files : [e.files];
    e.files = list.map((f, k) => {
      const abs = resolveFile(f, dir);
      if (!fs.existsSync(abs)) {
        issues.push({ path: `${ep}.files[${k}]`, message: `file not found: ${abs}`, hint: "Paths are relative to the script file (inline HTTP scripts: to the workspace — upload it with PUT /v1/files first)." });
      } else if (!fs.statSync(abs).isFile()) {
        issues.push({ path: `${ep}.files[${k}]`, message: `not a file: ${abs}` });
      }
      return abs;
    });
  }

  if (e.act === "wait" && e.ms != null && e.ms > 10_000) {
    warnings.push(`${ep}: waits ${e.ms}ms on camera — consider a shorter wait.`);
  }
}

function countSelectorKeys(s: Selector): number {
  return SELECTOR_KEYS.filter((k) => s[k] != null).length;
}

function checkSelector(s: Selector, p: string, issues: ScriptIssue[], required: boolean) {
  const keys = SELECTOR_KEYS.filter((k) => s[k] != null);
  if (keys.length === 0) {
    if (required) {
      issues.push({
        path: p,
        message: `needs a selector: one of ${SELECTOR_KEYS.join(" | ")}`,
        hint: "Run `narascreen inspect --url <page>` to get ready-made selectors.",
      });
    }
    if (s.name != null) issues.push({ path: `${p}.name`, message: "`name` only works together with `role`" });
    if (s.within || s.exact != null || s.nth != null) {
      issues.push({ path: p, message: "`within`, `exact` and `nth` only work together with a selector" });
    }
    return;
  }
  if (keys.length > 1) {
    issues.push({
      path: p,
      message: `uses ${keys.length} selector keys (${keys.join(", ")}) — use exactly one`,
      hint: "Keep the most specific one; narrow it with `within` or `nth` instead of combining keys.",
    });
  }
  if (s.name != null && s.role == null) {
    issues.push({ path: `${p}.name`, message: "`name` only works together with `role`" });
  }
  checkRole(s.role, `${p}.role`, issues);
  checkRole(s.within?.role, `${p}.within.role`, issues);
  const w = s.within;
  if (w) {
    const ways = [w.css, w.text, w.role].filter((x) => x != null).length;
    if (ways !== 1) issues.push({ path: `${p}.within`, message: "within needs exactly one of css | text | role" });
    if (w.name != null && w.role == null) issues.push({ path: `${p}.within.name`, message: "within.name needs within.role" });
  }
}

function checkRole(role: string | undefined, p: string, issues: ScriptIssue[]) {
  if (role == null || (ARIA_ROLES as readonly string[]).includes(role)) return;
  issues.push({
    path: p,
    message: `unknown ARIA role "${role}"`,
    hint: didYouMean(role, [...ARIA_ROLES]) ?? "use a role from `narascreen inspect` output (button, link, textbox, heading, row, dialog, …)",
  });
}

function checkNarration(
  fx: { narrate?: NarrationText; audio?: AudioSource; lang?: string; voice?: string },
  ep: string,
  langs: string[],
  dir: string,
  issues: ScriptIssue[],
  warnings: string[],
) {
  const wanted = fx.lang ? [fx.lang] : langs;
  const n = fx.narrate;
  if (typeof n === "string") {
    if (langs.length > 1 && !fx.lang && fx.audio == null) {
      warnings.push(`${ep}: the same narration text will be spoken for every language (${langs.join(", ")}). Use a map like {"en": "…", "hi": "…"}.`);
    }
  } else if (n) {
    checkLangMap(n, `${ep}.narrate`, wanted, fx.audio == null, issues);
  }

  // Pre-recorded audio: paths → absolute, files must exist.
  if (typeof fx.audio === "string") {
    fx.audio = resolveExisting(fx.audio, dir, `${ep}.audio`, issues);
    if (langs.length > 1 && !fx.lang) warnings.push(`${ep}: the same audio file is used for every language (${langs.join(", ")}).`);
  } else if (fx.audio) {
    const audio = fx.audio;
    checkLangMap(audio, `${ep}.audio`, wanted, n == null, issues);
    for (const k of Object.keys(audio)) audio[k] = resolveExisting(audio[k], dir, `${ep}.audio.${k}`, issues);
  }

  if (fx.voice) {
    if (fx.audio != null) warnings.push(`${ep}: voice is ignored when audio is given.`);
    else for (const lang of wanted) checkVoice(fx.voice, lang, `${ep}.voice`, warnings);
  }
}

/** A per-language map must use known languages and cover every wanted one
 *  (or have an "en" fallback) — unless another source covers it. */
function checkLangMap(map: Record<string, string>, p: string, wanted: string[], mustCover: boolean, issues: ScriptIssue[]) {
  for (const k of Object.keys(map)) {
    if (!TTS_LANGUAGES.includes(k)) {
      issues.push({ path: `${p}.${k}`, message: `unknown language "${k}"`, hint: `supported: ${TTS_LANGUAGES.join(", ")}` });
    }
  }
  if (!mustCover) return;
  for (const lang of wanted) {
    if (map[lang] == null && map.en == null) {
      issues.push({ path: p, message: `nothing for language "${lang}" (and no "en" fallback)`, hint: `Add "${lang}": "…" to the map.` });
    }
  }
}

function checkVoice(voice: string, lang: string, p: string, warnings: string[]) {
  const known = Object.values(DEFAULT_VOICES).some((vs) => vs.includes(voice));
  if (!known) {
    warnings.push(`${p}: "${voice}" is not in the voice catalog — run \`narascreen voices\`. It may still work if your Kokoro has it.`);
    return;
  }
  const code = LANG_CODES[lang];
  if (code && voice[0] !== code) {
    warnings.push(`${p}: voice "${voice}" is not a ${lang} voice (${lang} voices start with "${code}"); pronunciation will be off.`);
  }
}

function resolveFile(p: string, dir: string): string {
  return path.isAbsolute(p) ? p : path.resolve(dir, p);
}

/** Resolve a file path against the script dir; record an issue if it's missing. */
function resolveExisting(p: string, dir: string, at: string, issues: ScriptIssue[]): string {
  const abs = resolveFile(p, dir);
  if (!fs.existsSync(abs)) issues.push({ path: at, message: `file not found: ${abs}` });
  return abs;
}

// ─── helpers ─────────────────────────────────────────────────────────

function didYouMean(word: string, options: string[]): string | undefined {
  let best: string | undefined;
  let bestD = Infinity;
  for (const o of options) {
    const d = levenshtein(word.toLowerCase(), o.toLowerCase());
    if (d < bestD) {
      bestD = d;
      best = o;
    }
  }
  return best && bestD <= Math.max(2, Math.floor(word.length / 3)) ? `did you mean "${best}"?` : undefined;
}

function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}

// ─── summary (for `narascreen validate`) ─────────────────────────────

/** Rough size of the demo so an agent can sanity-check length before recording. */
// ─── cards & plan ────────────────────────────────────────────────────

function checkCards(script: DemoScript, dir: string, warnings: string[]): ScriptIssue[] {
  const issues: ScriptIssue[] = [];
  const langs = script.languages ?? ["en"];
  for (const which of ["intro", "outro"] as const) {
    const card = script[which];
    if (!card) continue;
    if (card.logo) {
      card.logo = resolveExisting(card.logo, dir, `${which}.logo`, issues);
      if (!/\.(png|jpe?g|svg|webp)$/i.test(card.logo)) issues.push({ path: `${which}.logo`, message: "logo must be a png, jpg, svg or webp image" });
    }
    for (const k of ["title", "subtitle", "cta", "narrate"] as const) {
      const v = card[k];
      if (v && typeof v === "object") checkLangMap(v, `${which}.${k}`, langs, true, issues);
      else if (k === "narrate" && typeof v === "string" && langs.some((l) => l !== "en")) {
        warnings.push(`${which}.narrate is the same text in every language (${langs.join(", ")}). Use a map like {"en": "…", "hi": "…"}.`);
      }
    }
  }
  return issues;
}

/** The plan never blocks a video: it only produces warnings. */
function checkPlan(script: DemoScript, warnings: string[]) {
  const plan = script.plan;
  if (!plan) return;
  const said = (v: unknown) => (typeof v === "string" ? v : v && typeof v === "object" ? Object.values(v as Record<string, string>).join(" ") : "");
  for (const term of plan.leaveOut ?? []) {
    const t = term.toLowerCase();
    script.steps.forEach((st, si) => {
      const texts = [st.id, st.label ?? ""];
      for (const e of st.beat) {
        const x = e as FxEntry & ActEntry;
        texts.push(said(x.narrate), said(x.text), x.name ?? "", x.label ?? "", x.path ?? "");
      }
      if (texts.some((s) => s.toLowerCase().includes(t))) {
        warnings.push(`plan.leaveOut says "${term}", but step "${st.id}" (steps[${si}]) mentions it. Drop that part, or update the plan.`);
      }
    });
  }
  if (plan.targetSec) {
    const est = scriptSummary(script).estimatedVideoSec;
    if (est > plan.targetSec * 1.25) {
      warnings.push(`The video is estimated at ~${est}s but plan.targetSec is ${plan.targetSec}s. Cut steps or shorten narration (or raise the target).`);
    }
  }
}

/** Seconds of speech for `chars` characters at speed 1 — fitted to Kokoro's clips
 *  (≈ 0.2 s + 1 s per 16.8 characters). */
export function speechSec(chars: number, speed = 1): number {
  return chars > 0 ? (0.2 + chars / 16.8) / speed : 0;
}
/** A recorded `audio` file's length is unknown until produce. */
const RECORDED_AUDIO_GUESS_SEC = 4;

/**
 * What the script will roughly produce. The video is the recording plus what
 * the renderer ADDS — the same rules produce.ts follows:
 *  - narrate (freezes by default): the frame holds for the speech;
 *    `freeze: false` talks over the recording and adds nothing (it used to be
 *    counted too: a 27 s video with talk-over narration was estimated at 42 s);
 *  - pause: its seconds (3 by default);
 *  - zoom: zoomDuration in and out per target, holding for the target's
 *    speech (or zoomHold);
 *  - title/end cards: their duration (narration + ~1.3 s, or 3 s);
 *  - skip / speed with `seconds` take out what they cut or speed up; browser
 *    ranges (until a later act/step) are unknown until recording (see `note`).
 */
export function scriptSummary(script: DemoScript) {
  const d = { ...BUILTIN_DEFAULTS, ...script.defaults };
  const speed = script.tts?.speed ?? 1;
  const fxCounts: Record<string, number> = {};
  let acts = 0;
  // The runner's lead-in, and its hold after the last entry (dwell + 0.5 s).
  let recordMs = 500 + d.dwellMs + 500;
  let narrations = 0;
  let spokenSec = 0;
  let addedSec = 0;
  let unknownRanges = 0;
  /** Speech seconds of one narration (0 when it has none), counted in the totals. */
  const speak = (n?: NarrationText, audio?: AudioSource): number => {
    if (n == null && audio == null) return 0;
    narrations++;
    const sec =
      audio != null
        ? RECORDED_AUDIO_GUESS_SEC
        : speechSec(typeof n === "string" ? n.length : n ? (n.en ?? Object.values(n)[0] ?? "").length : 0, speed);
    spokenSec += sec;
    return sec;
  };
  for (const beat of script.steps) {
    const dwell = beat.dwellMs ?? d.dwellMs;
    for (const e of beat.beat) {
      recordMs += dwell;
      if (isAct(e)) {
        acts++;
        if (e.act === "wait") recordMs += e.ms ?? 0;
        if (e.act === "fill") recordMs += (e.value?.length ?? 0) * d.typeDelayMs + d.revealMs;
        if (RECT_ACTS.includes(e.act) && e.act !== "waitFor" && e.act !== "press") recordMs += d.revealMs;
        continue;
      }
      const fx = e as FxEntry;
      if (fx.disabled) continue;
      fxCounts[fx.fx] = (fxCounts[fx.fx] ?? 0) + 1;
      if (fx.anchor || fx.anchors?.length || fx.targets?.length) recordMs += d.revealMs;
      if (fx.fx === "narrate") {
        const sec = speak(fx.narrate, fx.audio);
        if (fx.freeze !== false) addedSec += sec;
      } else if (fx.fx === "pause") {
        addedSec += fx.seconds ?? 3;
      } else if (fx.fx === "zoom") {
        const zoomIn = fx.zoomDuration ?? d.zoomDuration;
        const hold = fx.zoomHold ?? d.zoomHold;
        const targets = fx.targets?.length ? fx.targets : [fx];
        targets.forEach((t, k) => {
          const sec = speak(t.narrate, t.audio) || (k === 0 && fx.targets?.length ? speak(fx.narrate, fx.audio) : 0);
          addedSec += 2 * zoomIn + (sec || hold);
        });
      } else if (fx.fx === "skip" || fx.fx === "speed") {
        if (fx.seconds != null) addedSec -= fx.fx === "skip" ? fx.seconds : fx.seconds * (1 - 1 / (fx.factor ?? 2));
        else unknownRanges++;
      }
    }
  }
  const recordingSec = script.source ? probeDuration(script.source.video) : recordMs / 1000;
  // Title/end cards: their duration, or narration + a pause, or 3 s.
  for (const card of [script.intro, script.outro]) {
    if (!card) continue;
    const text = typeof card.narrate === "string" ? card.narrate : card.narrate ? (card.narrate.en ?? Object.values(card.narrate)[0] ?? "") : "";
    const voice = speechSec(text.length, speed);
    spokenSec += voice;
    addedSec += typeof card.duration === "number" ? card.duration : text ? voice + 1.3 : 3;
  }
  return {
    mode: script.source ? "video" : "browser",
    steps: script.steps.length,
    acts,
    effects: fxCounts,
    narrations,
    languages: script.languages ?? ["en"],
    estimatedRecordingSec: Math.round(recordingSec),
    /** Seconds of speech, talk-over narration included. */
    estimatedNarrationSec: Math.round(spokenSec),
    /** Seconds the renderer adds to the recording (freezes, zooms, pauses, cards; minus known cuts). */
    estimatedAddedSec: Math.round(addedSec),
    estimatedVideoSec: Math.round(Math.max(0, recordingSec + addedSec)),
    note: unknownRanges ? "skip/speed ranges that end at a later act or step shorten the video; not included in the estimate" : undefined,
  };
}
