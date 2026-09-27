/** DemoProject (timeline session) → video-source demo-script, so the desktop renders through the
 *  same `narascreen make` as agents do (audit §4.2). Pure: no window, no fs.
 *
 *  One step "main"; every action becomes fx entries with `at` (its timestamp) and `rect(s)`;
 *  ranges become `seconds`; the trim becomes two skips and disables what lies outside it;
 *  unticked effects become `disabled`. What the schema cannot express is clamped (with a
 *  warning) or left out (listed in `skipped`), never silently changed. */
import type { Card, DemoScript, FxEntry, Quality, ResolutionName } from "../../api/schema";
import type { CalloutPanel, DemoProject, Rect, TimelineAction, ZoomTarget } from "../types";
import { getActionRects } from "./actions";
import {
  API_DEFAULTS, ARROW_FROM_OPTIONS, AUTO_FALLBACK_SEC, HEX_COLOR, LIMITS, clampToMeta, durationMeta, isLanguage, numberMeta,
  type DurationKeyword,
} from "./schemaMeta";
import { getEffectSpan, projectLanguages, projectVoice, rangeEnd, ttsSpeed } from "./spans";

export interface ConvertOptions {
  /** Languages to produce (default: the project's). */
  langs?: string[];
  resolution?: ResolutionName;
  quality?: Quality;
  /** Effects left out of this export (the Produce dialog's unticked ones). */
  disabledIds?: Iterable<string>;
  /** Keep only [start, end] of the recording. */
  trim?: { start: number; end: number } | null;
}

export interface ConvertResult {
  script: DemoScript;
  warnings: string[];
  /** Actions that cannot be rendered as they are (left out of the script). */
  skipped: { id: string; reason: string }[];
  /** steps[0].beat[i] came from this action id ("trim" / "placeholder" for generated entries). */
  entryIds: string[];
}

/** The one step of a converted project. */
export const MAIN_STEP = "main";

/** Box padding the compiler adds around a positioned callout's text (api/compiler.ts PANEL_PAD):
 *  a panel's text starts at (x, y), so its `rect` is emitted this much up/left with placement "over". */
export const PANEL_PAD = { label: { x: 10, y: 6 }, step: { x: 12, y: 7 } } as const;
/** A panel-less label is drawn at calloutPosition in 28 px (produce.ts). */
const PANELLESS_FONT = 28;

const r3 = (x: number) => Math.round(x * 1000) / 1000;
const isAbs = (p: string) => p.startsWith("/") || /^[A-Za-z]:[\\/]/.test(p) || p.startsWith("\\\\");
const strip = <T extends object>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;

/** Convert a timeline project into a video-source demo-script. */
export function projectToScript(project: DemoProject, sessionDir: string, opts: ConvertOptions = {}): ConvertResult {
  const warnings: string[] = [];
  const skipped: ConvertResult["skipped"] = [];
  const entries: FxEntry[] = [];
  const entryIds: string[] = [];
  const abs = (p: string) => (isAbs(p) ? p : `${sessionDir.replace(/[\\/]+$/, "")}/${p.replace(/^\.[\\/]/, "")}`);
  const dur = project.recordingDuration || 0;
  const maxAt = dur > 0 ? Math.max(0, Math.floor((dur - 0.05) * 1000) / 1000) : Infinity;
  const W = project.viewport?.width || 0;
  const H = project.viewport?.height || 0;
  const unticked = new Set(opts.disabledIds ?? []);
  const langs = (opts.langs?.length ? opts.langs : projectLanguages(project)).filter((l) => {
    if (isLanguage(l)) return true;
    warnings.push(`Language "${l}" is not supported by the voice engine; left out.`);
    return false;
  });
  const trim = opts.trim && opts.trim.end > opts.trim.start ? { start: Math.max(0, opts.trim.start), end: dur ? Math.min(dur, opts.trim.end) : opts.trim.end } : null;
  const lang0 = langs[0] ?? "en";

  const push = (id: string, e: FxEntry) => {
    entries.push(strip(e));
    entryIds.push(id);
  };
  const clampRect = (r: Rect, id: string): Rect | null => {
    let [x, y, w, h] = r;
    if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) return null;
    if (W > 0 && H > 0 && (x < 0 || y < 0 || x + w > W || y + h > H)) {
      const x0 = Math.min(Math.max(0, x), W - 1), y0 = Math.min(Math.max(0, y), H - 1);
      const x1 = Math.min(Math.max(x + w, x0 + 1), W), y1 = Math.min(Math.max(y + h, y0 + 1), H);
      [x, y, w, h] = [r3(x0), r3(y0), r3(x1 - x0), r3(y1 - y0)];
      warnings.push(`${id}: a region went outside the ${W}x${H} frame; it was cut to fit.`);
    } else if (x < 0 || y < 0) {
      [x, y] = [Math.max(0, x), Math.max(0, y)];
    }
    return [x, y, w, h];
  };
  const rectsOf = (a: TimelineAction): Rect[] => getActionRects(a).map((r) => clampRect(r, a.id)).filter((r): r is Rect => !!r);
  const langMap = (m: Record<string, string> | undefined, id: string): Record<string, string> | undefined => {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(m ?? {})) {
      if (typeof v !== "string" || !v.trim()) continue;
      if (isLanguage(k)) out[k] = v;
      else warnings.push(`${id}: text for unknown language "${k}" left out.`);
    }
    return Object.keys(out).length ? out : undefined;
  };
  const narration = (s: { narrations?: Record<string, string>; narration?: string; narration_hi?: string }, id: string) => {
    const m = { ...(s.narrations ?? {}) };
    if (s.narration?.trim() && !m.en?.trim()) m.en = s.narration;
    if (s.narration_hi?.trim() && !m.hi?.trim()) m.hi = s.narration_hi;
    return langMap(m, id);
  };
  const audio = (s: { customAudioPath?: string; customAudioPaths?: Record<string, string> }, id: string): FxEntry["audio"] => {
    const per = langMap(s.customAudioPaths, id);
    if (per) {
      const all = s.customAudioPath ? Object.fromEntries(langs.map((l) => [l, abs(s.customAudioPath!)])) : {};
      return { ...all, ...Object.fromEntries(Object.entries(per).map(([k, v]) => [k, abs(v)])) };
    }
    return s.customAudioPath ? abs(s.customAudioPath) : undefined;
  };
  const text = (fallback: string | undefined, texts: Record<string, string> | undefined, id: string): FxEntry["text"] => {
    const m = langMap(texts, id);
    if (m) return { ...(fallback?.trim() ? { en: fallback } : {}), ...m };
    return fallback?.trim() ? fallback : undefined;
  };
  const voiceLang = (v: string | undefined, l: string | undefined, id: string) => {
    if (l && !isLanguage(l)) warnings.push(`${id}: "Speak in" language "${l}" is not supported; ignored.`);
    return { voice: v || undefined, lang: l && isLanguage(l) ? l : undefined };
  };
  const overlayDuration = (a: TimelineAction, secs: number | undefined, at: number): number | DurationKeyword => {
    if (a.durationMode) return a.durationMode;
    const d = secs ?? AUTO_FALLBACK_SEC;
    const max = durationMeta("spotlight").seconds.max;
    if (d > max) {
      if (at + d >= dur - 0.05) return "end";
      warnings.push(`${a.id}: ${r3(d)} s on screen is over the ${max} s limit; shortened to ${max} s.`);
      return max;
    }
    return r3(Math.max(0.05, d));
  };

  const sorted = [...project.actions].sort((x, y) => x.timestamp - y.timestamp);
  for (const a of sorted) {
    if (a.type === "music") continue; // whole-video setting (migrated); see `music` below
    let at = r3(Math.max(0, a.timestamp));
    if (at > maxAt) {
      warnings.push(`${a.id}: starts at ${at} s, at or past the end of the video; moved to ${maxAt} s.`);
      at = maxAt;
    }
    let disabled = !!a.disabled || unticked.has(a.id);
    let secsShift = 0; // overlays cut by the trim start
    const isRange = a.type === "speed" || a.type === "skip" || a.type === "mute";
    let end = isRange ? Math.min(rangeEnd(a) ?? at + AUTO_FALLBACK_SEC, dur || Infinity) : 0;
    if (trim && !disabled) {
      if (isRange) {
        if (end <= trim.start || at >= trim.end) disabled = true;
        else [at, end] = [r3(Math.max(at, trim.start)), Math.min(end, trim.end)];
      } else {
        const span = getEffectSpan(a, project, lang0);
        const overlay = a.type === "spotlight" || a.type === "blur" || a.type === "callout";
        if (span.end <= trim.start || at >= trim.end || (!overlay && at < trim.start)) disabled = true;
        else if (overlay && at < trim.start) [secsShift, at] = [trim.start - at, r3(trim.start)];
      }
    }
    const common = { at, ...(disabled ? { disabled: true } : {}), note: a.note?.trim() || undefined };
    const skip = (reason: string) => {
      skipped.push({ id: a.id, reason });
      warnings.push(`${a.id}: ${reason}; left out.`);
    };

    switch (a.type) {
      case "narrate": {
        const narrate = narration(a, a.id);
        const aud = audio(a, a.id);
        if (!narrate && !aud) { skip("narration has no text or recording"); break; }
        if (typeof a.resumeAfter === "number") warnings.push(`${a.id}: a fixed narration length (${a.resumeAfter} s) is not supported; the speech sets it.`);
        push(a.id, {
          fx: "narrate", ...common, narrate, audio: aud,
          freeze: typeof a.freeze === "boolean" ? a.freeze : undefined,
          subtitles: typeof a.showSubtitles === "boolean" ? a.showSubtitles : undefined,
          subtitleSize: a.subtitleSize != null ? clampToMeta(numberMeta("narrate", "subtitleSize"), a.subtitleSize) : undefined,
          ...voiceLang(a.voice, a.lang, a.id),
        });
        break;
      }
      case "zoom": {
        const rects = rectsOf(a);
        if (!rects.length) { skip("zoom has no region"); break; }
        if (rects.length > LIMITS.zoomTargetsMax) warnings.push(`${a.id}: only the first ${LIMITS.zoomTargetsMax} zoom targets are kept.`);
        const src: ZoomTarget[] = a.zoomTargets?.length ? a.zoomTargets : rects.map((rect) => ({ rect }));
        const targets = rects.slice(0, LIMITS.zoomTargetsMax).map((rect, k) => {
          const t = src[k] ?? { rect };
          return strip({ rect, narrate: narration(t, a.id), audio: audio(t, a.id), ...voiceLang(t.voice ?? a.voice, t.lang ?? a.lang, a.id) });
        });
        const timing = {
          zoomDuration: a.zoomDuration != null ? clampToMeta(numberMeta("zoom", "zoomDuration"), a.zoomDuration) : undefined,
          zoomHold: a.zoomHold != null ? clampToMeta(numberMeta("zoom", "zoomHold"), a.zoomHold) : undefined,
        };
        const speaks = targets.some((t) => t.narrate || t.audio || t.voice || t.lang);
        push(a.id, targets.length > 1 || speaks ? { fx: "zoom", ...common, targets, ...timing } : { fx: "zoom", ...common, rect: targets[0].rect, ...timing });
        break;
      }
      case "spotlight": {
        const rects = rectsOf(a);
        if (!rects.length) { skip("spotlight has no region"); break; }
        if (rects.length > LIMITS.regionsMax) warnings.push(`${a.id}: only the first ${LIMITS.regionsMax} regions are kept.`);
        const r = rects.slice(0, LIMITS.regionsMax);
        const secs = a.spotlightDuration != null ? a.spotlightDuration - secsShift : undefined;
        push(a.id, {
          fx: "spotlight", ...common, ...(r.length === 1 ? { rect: r[0] } : { rects: r }),
          duration: overlayDuration(a, secs, at),
          dimOpacity: a.dimOpacity != null ? clampToMeta(numberMeta("spotlight", "dimOpacity"), a.dimOpacity) : undefined,
          padding: a.spotlightPadding ? clampToMeta(numberMeta("spotlight", "padding"), a.spotlightPadding) : undefined,
          feather: a.spotlightFeather ? clampToMeta(numberMeta("spotlight", "feather"), a.spotlightFeather) : undefined,
          converge: a.spotlightConverge ? clampToMeta(numberMeta("spotlight", "converge"), a.spotlightConverge) : undefined,
        });
        break;
      }
      case "blur": {
        const rects = rectsOf(a);
        if (!rects.length) { skip("blur has no region"); break; }
        const r = rects.slice(0, LIMITS.regionsMax);
        const secs = a.blurDuration != null ? a.blurDuration - secsShift : undefined;
        push(a.id, {
          fx: "blur", ...common, ...(r.length === 1 ? { rect: r[0] } : { rects: r }),
          duration: overlayDuration(a, secs, at),
          radius: a.blurRadius != null ? clampToMeta(numberMeta("blur", "radius"), a.blurRadius) : undefined,
        });
        break;
      }
      case "callout": {
        const secs = a.calloutDuration != null ? a.calloutDuration - secsShift : undefined;
        const duration = overlayDuration(a, secs, at);
        if (a.calloutStyle === "arrow") {
          const p = a.calloutPanels?.[0];
          const rect = p ? clampRect(p.rect, a.id) : null;
          if (!p || !rect) { skip("arrow has no target region"); break; }
          push(a.id, {
            fx: "arrow", ...common, rect, duration,
            text: text(p.text || a.calloutText, p.texts ?? a.calloutTexts, a.id),
            fontSize: p.fontSize != null && p.fontSize !== API_DEFAULTS.arrow.fontSize ? clampToMeta(numberMeta("arrow", "fontSize"), p.fontSize) : undefined,
            from: a.arrowFrom && (ARROW_FROM_OPTIONS as readonly string[]).includes(a.arrowFrom) ? a.arrowFrom : undefined,
            color: a.arrowColor && HEX_COLOR.test(a.arrowColor) ? a.arrowColor : undefined,
            highlight: a.arrowHighlight ? true : undefined,
            highlightColor: a.arrowHighlight && a.arrowHighlightColor && HEX_COLOR.test(a.arrowHighlightColor) ? a.arrowHighlightColor : undefined,
          });
          break;
        }
        const style = a.calloutStyle ?? "label";
        const step = style === "step-counter" && a.calloutStep != null ? Math.max(1, Math.round(a.calloutStep)) : undefined;
        const panels = a.calloutPanels ?? [];
        if (!panels.length) {
          const t = text(a.calloutText, a.calloutTexts, a.id);
          if (!t) { skip("callout has no text"); break; }
          const pos = style !== "lower-third" && a.calloutPosition ? panelRect({ text: "", rect: [a.calloutPosition[0], a.calloutPosition[1], 1, 1], fontSize: PANELLESS_FONT }, style, { W, H }) : null;
          push(a.id, { fx: "callout", ...common, text: t, style, step, duration, ...(pos ? { rect: pos, placement: "over" as const, fontSize: PANELLESS_FONT } : {}) });
          break;
        }
        panels.forEach((p, k) => {
          const t = text(p.text, p.texts, a.id);
          const rect = panelRect(p, style, { W, H });
          if (!t || !rect) { if (!t) warnings.push(`${a.id}: text panel ${k + 1} is empty; left out.`); return; }
          // A lower-third with a panel is drawn at that panel, like a label (audit §4.2).
          push(a.id, {
            fx: "callout", ...common, text: t, style: style === "lower-third" ? "label" : style, step, duration,
            rect, placement: "over", fontSize: clampToMeta(numberMeta("callout", "fontSize"), p.fontSize ?? API_DEFAULTS.callout.fontSize),
          });
        });
        if (!entryIds.includes(a.id)) skipped.push({ id: a.id, reason: "callout has no text" });
        break;
      }
      case "pause": {
        const s = typeof a.resumeAfter === "number" ? a.resumeAfter : undefined;
        push(a.id, { fx: "pause", ...common, seconds: s != null ? clampToMeta(numberMeta("pause", "seconds"), s) : undefined });
        break;
      }
      case "speed":
      case "skip":
      case "mute": {
        const seconds = r3(end - at);
        if (!(seconds > 0)) { skip(`${a.type} range is empty`); break; }
        const s = Math.min(seconds, LIMITS.rangeSecondsMax);
        const factor = a.type === "speed" ? clampToMeta(numberMeta("speed", "factor"), a.speedFactor ?? API_DEFAULTS.speed.factor) : undefined;
        push(a.id, { fx: a.type, ...common, seconds: s, factor });
        break;
      }
    }
  }

  // The trim: cut what lies before its start and after its end.
  if (trim) {
    if (trim.start > 0.05) { entries.unshift({ fx: "skip", at: 0, seconds: r3(trim.start), note: "trim start" }); entryIds.unshift("trim"); }
    if (dur && dur - trim.end > 0.05) {
      const at = r3(Math.min(trim.end, maxAt));
      const i = entries.findIndex((e) => (e.at ?? 0) > at);
      const e: FxEntry = { fx: "skip", at, seconds: r3(dur - at), note: "trim end" };
      if (i < 0) { entries.push(e); entryIds.push("trim"); } else { entries.splice(i, 0, e); entryIds.splice(i, 0, "trim"); }
    }
  }
  if (!entries.length) {
    entries.push({ fx: "pause", at: 0, disabled: true, note: "placeholder: this video has no effects yet" });
    entryIds.push("placeholder");
  }

  const voices = Object.fromEntries(langs.map((l) => [l, projectVoice(project, l)]));
  let endpoint: string | undefined = project.tts?.kokoroEndpoint || undefined;
  try { if (endpoint) new URL(endpoint); } catch { endpoint = undefined; warnings.push(`The voice engine URL "${project.tts.kokoroEndpoint}" is not a URL; the default is used.`); }
  const music = project.music?.path?.trim()
    ? project.music.volume > 0
      ? strip({ path: abs(project.music.path), volume: clampToMeta(numberMeta("music", "volume"), project.music.volume), duckTo: clampToMeta(numberMeta("music", "duckTo"), project.music.duckTo ?? API_DEFAULTS.music.duckTo) })
      : (warnings.push("Music volume is 0, so the video has no music."), undefined)
    : undefined;
  const card = (c: Card | undefined, which: string): Card | undefined => {
    if (!c) return undefined;
    const title = typeof c.title === "string" ? c.title.trim() : c.title && Object.values(c.title).some((v) => v?.trim()) ? c.title : "";
    if (!title) { warnings.push(`The ${which} card has no title; left out.`); return undefined; }
    return strip({ ...c, logo: c.logo ? abs(c.logo) : undefined, accent: c.accent && HEX_COLOR.test(c.accent) ? c.accent : undefined });
  };

  const script: DemoScript = strip({
    version: 1 as const,
    scope: project.title?.trim() || "Untitled",
    source: { video: abs(project.recordingPath) },
    viewport: { width: clampInt(W || 1440, 320, 3840), height: clampInt(H || 900, 240, 2160) },
    languages: langs.length ? langs : ["en"],
    tts: strip({ kokoroEndpoint: endpoint, speed: ttsSpeed(project), voices }),
    music,
    output: {
      resolution: opts.resolution ?? project.output?.resolution ?? API_DEFAULTS.output.resolution,
      quality: opts.quality ?? project.output?.quality ?? API_DEFAULTS.output.quality,
    },
    intro: card(project.intro, "title"),
    outro: card(project.outro, "end"),
    plan: project.plan && Object.keys(project.plan).length ? project.plan : undefined,
    steps: [{ id: MAIN_STEP, label: project.title?.trim() || undefined, beat: entries }].map((s) => strip(s)),
  });
  return { script, warnings, skipped, entryIds };
}

const clampInt = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(v)));

/** The `rect` (placement "over") that makes the compiler put a panel's text where the desktop
 *  draws it. The compiler only reads its x/y for "over", so the size is fitted to the frame. */
function panelRect(p: CalloutPanel, style: string, frame: { W: number; H: number }): Rect | null {
  const pad = style === "step-counter" ? PANEL_PAD.step : PANEL_PAD.label;
  const [x, y, w, h] = p.rect;
  if (![x, y, w, h].every(Number.isFinite)) return null;
  const { W, H } = frame;
  const x0 = r3(Math.max(0, W > 0 ? Math.min(x - pad.x, W - 1) : x - pad.x));
  const y0 = r3(Math.max(0, H > 0 ? Math.min(y - pad.y, H - 1) : y - pad.y));
  const fit = (v: number, room: number) => r3(Math.max(1, room > 0 ? Math.min(v, room) : v));
  return [x0, y0, fit(w, W - x0), fit(h, H - y0)];
}

/** Map a validation path (steps[0].beat[i]…) back to the action it came from. */
export function actionIdForPath(result: Pick<ConvertResult, "entryIds">, path: string | undefined): string | undefined {
  const m = path ? /^steps\[0\]\.beat\[(\d+)\]/.exec(path) : null;
  const id = m ? result.entryIds[Number(m[1])] : undefined;
  return id && id !== "trim" && id !== "placeholder" ? id : undefined;
}
