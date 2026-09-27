/** Pre-flight problems of a timeline project, as data (Issues panel, clip notches, Export dialog).
 *  Pure. The rules mirror what `narascreen validate` / the compiler would report for the exported
 *  script (api/validate.ts, api/compiler.ts), so the user sees them before a render starts.
 *  `fix` describes a one-click repair the store applies with `applyIssueFix`. */
import type { DemoProject, Rect, TimelineAction } from "../types";
import { getActionRects, updateActionRect } from "./actions";
import { LIMITS, clampToMeta, durationMeta, numberMeta } from "./schemaMeta";
import {
  currentNarrationHash, isEnabled, modelOutput, narrationTextFor, overlaySeconds, projectLanguages, rangeEnd,
  recordedAudioFor, speaks, type OutputModel,
} from "./spans";

export type IssueSeverity = "error" | "warning" | "info";

export type IssueFix =
  | { label: string; kind: "update"; changes: { id: string; partial: Partial<TimelineAction> }[] }
  | { label: string; kind: "project"; partial: Partial<DemoProject> }
  | { label: string; kind: "generate"; actionId: string; lang: string; target?: number };

export interface Issue {
  /** Stable key: `${rule}:${actionIds}:${lang?}` */
  id: string;
  rule: string;
  severity: IssueSeverity;
  actionIds: string[];
  message: string;
  lang?: string;
  fix?: IssueFix;
}

export interface IssueContext {
  /** Languages to check (default: the project's). */
  langs?: string[];
  /** Files known to be missing (the store probes paths asynchronously). */
  missingFiles?: ReadonlySet<string>;
}

const TYPE_LABEL: Record<string, string> = {
  zoom: "Zoom", narrate: "Narration", spotlight: "Spotlight", blur: "Blur", callout: "Callout", pause: "Pause",
  speed: "Speed", skip: "Cut", mute: "Mute", music: "Music",
};
const t2 = (s: number) => `${(Math.round(s * 10) / 10).toFixed(1)} s`;
export const effectLabel = (a: TimelineAction) =>
  `${a.type === "callout" && a.calloutStyle === "arrow" ? "Arrow" : TYPE_LABEL[a.type] ?? a.type}${a.name ? ` “${a.name}”` : ""} at ${t2(a.timestamp)}`;

/** Every problem of the project, errors first. */
export function projectIssues(project: DemoProject, ctx: IssueContext = {}): Issue[] {
  const out: Issue[] = [];
  const add = (rule: string, severity: IssueSeverity, actionIds: string[], message: string, extra: Partial<Issue> = {}) =>
    out.push({ id: `${rule}:${actionIds.join(",")}${extra.lang ? `:${extra.lang}` : ""}`, rule, severity, actionIds, message, ...extra });
  const langs = ctx.langs?.length ? ctx.langs : projectLanguages(project);
  const dur = project.recordingDuration || 0;
  const W = project.viewport?.width || 0, H = project.viewport?.height || 0;
  const acts = project.actions.filter(isEnabled);
  const missing = ctx.missingFiles ?? new Set<string>();

  if (project.music) {
    if (!project.music.path?.trim()) add("music-file", "error", [], "Background music has no file. Choose one or remove the music.");
    else if (missing.has(project.music.path)) add("music-file", "error", [], `The music file is missing: ${project.music.path}`);
  }
  if (!project.recordingPath || missing.has(project.recordingPath)) add("recording-missing", "error", [], `The recording is missing: ${project.recordingPath || "(none)"}`);

  for (const a of acts) {
    const label = effectLabel(a);
    if (dur && a.timestamp >= dur - 0.05) add("after-end", "error", [a.id], `${label} starts at the very end of the video.`, { fix: { label: "Move it inside the video", kind: "update", changes: [{ id: a.id, partial: { timestamp: Math.max(0, dur - 0.1) } }] } });

    // regions
    const needsRect = a.type === "zoom" || a.type === "spotlight" || a.type === "blur" || (a.type === "callout" && a.calloutStyle === "arrow");
    const rects = getActionRects(a);
    if (needsRect && !rects.length) add("no-region", "warning", [a.id], `${label} has no region yet, so it is left out of the video. Draw one on the canvas.`);
    if (W && H && a.type !== "callout") {
      let fixed: Partial<TimelineAction> = {};
      let cur = a;
      rects.forEach((r, i) => {
        if (inside(r, W, H)) return;
        fixed = { ...fixed, ...updateActionRect(cur, i, fitRect(r, W, H)) };
        cur = { ...cur, ...fixed };
      });
      if (Object.keys(fixed).length) {
        add("outside-frame", "error", [a.id], `${label} has a region outside the ${W}×${H} video.`, { fix: { label: "Fit it into the frame", kind: "update", changes: [{ id: a.id, partial: fixed }] } });
      }
    }
    if ((a.type === "spotlight" || a.type === "blur") && rects.length > LIMITS.regionsMax) add("too-many-regions", "warning", [a.id], `${label} has ${rects.length} regions; only ${LIMITS.regionsMax} are used.`);
    if (a.type === "zoom" && rects.length > LIMITS.zoomTargetsMax) add("too-many-regions", "warning", [a.id], `${label} has ${rects.length} targets; only ${LIMITS.zoomTargetsMax} are used.`);

    // durations over the schema's limits
    const overMax = durationMeta("spotlight").seconds.max;
    if ((a.type === "spotlight" || a.type === "blur" || a.type === "callout") && !a.durationMode && overlaySeconds(a) > overMax && a.timestamp + overlaySeconds(a) < dur - 0.05) {
      add("duration-max", "warning", [a.id], `${label} stays ${t2(overlaySeconds(a))}; the most is ${overMax} s.`, { fix: { label: "Keep it to the end of the video", kind: "update", changes: [{ id: a.id, partial: { durationMode: "end" } }] } });
    }
    if (a.type === "pause" && typeof a.resumeAfter === "number" && a.resumeAfter > LIMITS.pauseSecondsMax) {
      add("duration-max", "warning", [a.id], `${label} freezes ${t2(a.resumeAfter)}; the most is ${LIMITS.pauseSecondsMax} s.`, { fix: { label: `Use ${LIMITS.pauseSecondsMax} s`, kind: "update", changes: [{ id: a.id, partial: { resumeAfter: LIMITS.pauseSecondsMax } }] } });
    }
    if (a.type === "zoom") {
      const zh = numberMeta("zoom", "zoomHold"), zd = numberMeta("zoom", "zoomDuration");
      if ((a.zoomHold ?? 0) > zh.max || (a.zoomDuration ?? 0) > zd.max) {
        add("duration-max", "warning", [a.id], `${label}: zoom timing is over the limits (${zd.max} s in/out, ${zh.max} s hold).`, {
          fix: { label: "Clamp the timing", kind: "update", changes: [{ id: a.id, partial: { zoomHold: a.zoomHold != null ? clampToMeta(zh, a.zoomHold) : undefined, zoomDuration: a.zoomDuration != null ? clampToMeta(zd, a.zoomDuration) : undefined } }] },
        });
      }
    }
    if (a.type === "spotlight" && a.spotlightConverge && !a.durationMode && a.spotlightConverge > overlaySeconds(a) / 2) {
      add("converge-long", "info", [a.id], `${label}: the animate-in (${t2(a.spotlightConverge)}) is over half its time on screen, so it is shortened.`);
    }

    // ranges
    const end = rangeEnd(a);
    if ((a.type === "speed" || a.type === "skip" || a.type === "mute") && (end == null || end - a.timestamp < 0.05)) add("range-empty", "warning", [a.id], `${label} covers no time, so it does nothing.`);

    // narration: text per language, freshness of the preview clip
    const speakers: (number | undefined)[] = a.type === "narrate" ? [undefined] : a.type === "zoom" ? (a.zoomTargets ?? []).map((_, k) => k) : [];
    for (const k of speakers) {
      const t = k != null ? a.zoomTargets![k] : a;
      const anyText = Object.values(t.narrations ?? {}).some((x) => x?.trim()) || !!(t as TimelineAction).narration?.trim();
      const anyAudio = !!t.customAudioPath || Object.values(t.customAudioPaths ?? {}).some(Boolean);
      if (k == null && !anyText && !anyAudio) {
        add("narration-empty", "warning", [a.id], `${label} has no text or recording, so it is left out.`);
        continue;
      }
      if (k != null && !anyText && !anyAudio) continue; // a silent zoom target
      const where = k != null ? `${label} (target ${k + 1})` : label;
      for (const lang of langs) {
        const n = narrationTextFor(a, lang, k);
        const rec = recordedAudioFor(a, lang, k);
        if (!n && !rec) add("narration-missing", "error", [a.id], `${where} has no ${lang} text (and no en to fall back on).`, { lang });
        else if (n?.fallback && !rec) add("narration-fallback", "warning", [a.id], `${where} has no ${n.lang === "en" ? lang : n.lang} text; the en text is read by an English voice.`, { lang });
        if (!n || rec) continue;
        const key = n.lang;
        const clip = t.audioPath?.[key];
        const hash = t.audioTextHash?.[key];
        if (clip && hash && hash !== currentNarrationHash(project, a, lang, k)) {
          add("audio-stale", "warning", [a.id], `${where}: the ${key} audio preview is out of date (text, voice or speed changed).`, { lang: key, fix: { label: "Regenerate", kind: "generate", actionId: a.id, lang: key, ...(k != null ? { target: k } : {}) } });
        }
      }
    }

    // overlay text
    if (a.type === "callout" && a.calloutStyle !== "arrow") {
      const texts = [a.calloutText, ...Object.values(a.calloutTexts ?? {}), ...(a.calloutPanels ?? []).flatMap((p) => [p.text, ...Object.values(p.texts ?? {})])];
      if (!texts.some((x) => x?.trim())) add("callout-empty", "warning", [a.id], `${label} has no text, so it is left out.`);
      else if (langs.length > 1) {
        const hasMap = !!a.calloutTexts || (a.calloutPanels ?? []).some((p) => p.texts);
        if (!hasMap) add("callout-one-language", "info", [a.id], `${label} shows the same text in every language (${langs.join(", ")}).`);
      }
      if (a.calloutStyle === "step-counter" && a.calloutStep == null) add("step-number", "warning", [a.id], `${label} is a step counter without a step number.`);
      if ((a.calloutStyle ?? "label") !== "lower-third" && !a.calloutPanels?.length && !a.calloutPosition) add("callout-unplaced", "info", [a.id], `${label} has no position, so it is drawn at the top-left.`);
    }
    if ((a.type === "spotlight" || a.type === "blur") && (a.narrations && Object.values(a.narrations).some((x) => x?.trim()))) {
      add("dead-narration", "info", [a.id], `${label} has narration text that is never spoken. Add a Narration at the same time instead.`);
    }
  }

  const model = modelOutput(project, langs[0] ?? "en");
  checkRanges(acts, add);
  checkSpotlightOverlaps(acts, model, add);
  return out.sort((x, y) => rank(x.severity) - rank(y.severity));
}

const rank = (s: IssueSeverity) => (s === "error" ? 0 : s === "warning" ? 1 : 2);
const inside = ([x, y, w, h]: Rect, W: number, H: number) => x >= 0 && y >= 0 && w > 0 && h > 0 && x + w <= W && y + h <= H;
function fitRect([x, y, w, h]: Rect, W: number, H: number): Rect {
  const nw = Math.max(1, Math.min(Math.abs(w) || 1, W)), nh = Math.max(1, Math.min(Math.abs(h) || 1, H));
  return [Math.round(Math.min(Math.max(0, x), W - nw)), Math.round(Math.min(Math.max(0, y), H - nh)), Math.round(nw), Math.round(nh)];
}

type Add = (rule: string, severity: IssueSeverity, ids: string[], message: string, extra?: Partial<Issue>) => void;

/** Overlapping ranges of one kind and effects inside a cut (compiler tidyRanges warnings). */
function checkRanges(acts: TimelineAction[], add: Add) {
  for (const kind of ["speed", "skip"] as const) {
    const rs = acts.filter((a) => a.type === kind && (rangeEnd(a) ?? 0) > a.timestamp).sort((x, y) => x.timestamp - y.timestamp);
    for (let i = 1; i < rs.length; i++) {
      const prev = rs[i - 1];
      if (rs[i].timestamp < rangeEnd(prev)! - 0.01) add("range-overlap", "warning", [prev.id, rs[i].id], `${effectLabel(rs[i])} starts inside ${effectLabel(prev)}; it begins where that one ends.`);
    }
  }
  for (const skip of acts.filter((a) => a.type === "skip" && (rangeEnd(a) ?? 0) > a.timestamp)) {
    const [s, e] = [skip.timestamp, rangeEnd(skip)!];
    for (const a of acts) {
      if (a === skip || a.type === "skip" || !(a.timestamp > s + 0.01 && a.timestamp < e - 0.01)) continue;
      add("inside-cut", "warning", [a.id, skip.id], `${effectLabel(a)} is inside a cut (${t2(s)}–${t2(e)}), so it starts right after the cut instead.`);
    }
  }
}

/** Mirror of the compiler's spotlightOverlaps: two spotlights on screen at once fail to render
 *  (SPOTLIGHT_OVERLAP). Only explicit durations can overlap: "auto" and end modes yield. */
function checkSpotlightOverlaps(acts: TimelineAction[], tl: OutputModel, add: Add) {
  const spots = acts
    .filter((a) => a.type === "spotlight" && getActionRects(a).length)
    .map((a) => ({ a, start: tl.placed(a.timestamp) }))
    .sort((x, y) => x.start - y.start);
  for (let q = 0; q + 1 < spots.length; q++) {
    const [cur, nxt] = [spots[q], spots[q + 1]];
    if (cur.a.durationMode) continue;
    const end = cur.start + overlaySeconds(cur.a);
    if (nxt.start < end - 0.01) {
      const fit = Math.max(0.5, Math.round((nxt.start - cur.start - 0.05) * 1000) / 1000);
      add("spotlight-overlap", "error", [cur.a.id, nxt.a.id],
        `${effectLabel(cur.a)} is still on screen when ${effectLabel(nxt.a)} starts. Two spotlights can't show at once, so the render would fail.`,
        { fix: { label: `Shorten the first to ${t2(fit)}`, kind: "update", changes: [{ id: cur.a.id, partial: { spotlightDuration: fit } }] } });
    }
  }
}

/** Issues that concern one action (for clip notches and the inspector). */
export function issuesFor(issues: Issue[], actionId: string): Issue[] {
  return issues.filter((i) => i.actionIds.includes(actionId));
}

/** Does anything block an export? */
export const hasBlockingIssues = (issues: Issue[]) => issues.some((i) => i.severity === "error");

export { speaks as effectSpeaks };
