// ─── fx-structure: chapters and step transitions → NaraScreen actions ──
//
// PURE (no video, no filesystem). Called by compiler.ts once per language:
//   - chapters: a step's `chapter` (text, per-language map, or true = the step's
//     label) starts a chapter where the step begins (the first step: at 0); an
//     fx { "fx": "chapter", "title" } starts one where it sits (video-source
//     scripts: at its `at`). → { type: "chapter", timestamp, chapterTitle, chapterBadge? }
//   - transitions: a step's `transition` (or the script's top-level default,
//     which skips the first step) → { type: "transition", timestamp: the step's
//     start, transitionEnd: its first act's end + 1.5 s (capped at the next step),
//     transitionStyle, transitionDuration }. The renderer finds the page change
//     inside that window (electron/fx-transitions.ts).
// Timestamps are recording seconds, like every action; the renderer places them
// on the final timeline (electron/fx-chapters.ts, fx-transitions.ts).

import { resolveNarration } from "./narration";
import { isAct, isFx, type DemoScript, type NaraAction, type TraceEntry } from "./types";
import type { StepTransition } from "./schema";

/** How far past its first act a step's page change is looked for. */
export const TRANSITION_SEARCH_SEC = 1.5;
export const TRANSITION_DEFAULT_SEC = 0.4;

/** Text of a title for `lang` (a string, or a per-language map falling back to en). */
export function titleFor(t: string | Record<string, string> | undefined, lang: string): string | undefined {
  if (t == null) return undefined;
  return resolveNarration({ narrate: t }, lang)?.text?.trim() || undefined;
}

/** A step's chapter title for `lang` (undefined: the step starts no chapter). */
export function stepChapterTitle(step: DemoScript["steps"][number], lang: string): string | undefined {
  if (step.chapter == null || step.chapter === false) return undefined;
  if (step.chapter === true) return step.label?.trim() || step.id;
  return titleFor(step.chapter, lang);
}

/** The transition that applies when step `k` begins (explicit, else the script default for k > 0). */
export function stepTransition(script: DemoScript, k: number): { style: "fade" | "slide"; duration: number } | undefined {
  const norm = (t: StepTransition | undefined) =>
    t == null ? undefined : typeof t === "string" ? { type: t, duration: undefined } : { type: t.type, duration: t.duration };
  const own = norm(script.steps[k]?.transition);
  const t = own ?? (k > 0 ? norm(script.transition) : undefined);
  if (!t || t.type === "none") return undefined;
  return { style: t.type, duration: t.duration ?? TRANSITION_DEFAULT_SEC };
}

/** Chapter and transition actions for one language, sorted by timestamp. */
export function structureActions(script: DemoScript, trace: TraceEntry[], lang: string, endOfRecording: number): NaraAction[] {
  const bySlot = new Map(trace.map((e) => [`${e.beat}:${e.i}`, e]));
  const slotsOf = (k: number) => {
    const step = script.steps[k];
    return step ? step.beat.map((_, i) => bySlot.get(`${step.id}:${i}`)).filter((x): x is TraceEntry => x != null) : [];
  };
  // A step begins when its first entry starts running (the first step: at 0, so
  // its chapter covers the lead-in). Video-source traces: the earliest `at`.
  const stepStart = (k: number): number | undefined => {
    if (k === 0) return 0;
    const slots = slotsOf(k);
    if (!slots.length) return undefined;
    return Math.min(...slots.map((e) => e.start ?? e.t));
  };
  const badge = script.chapters?.onScreen === true;
  const out: NaraAction[] = [];
  let n = 0;
  script.steps.forEach((step, k) => {
    const start = stepStart(k);
    const title = stepChapterTitle(step, lang);
    if (title && start != null) {
      out.push({ id: `chapter-${++n}`, type: "chapter", timestamp: start, name: `${step.id} chapter`, chapterTitle: title, ...(badge ? { chapterBadge: true } : {}), source: { step: step.id, entry: 0 } });
    }
    step.beat.forEach((e, i) => {
      if (!isFx(e) || e.fx !== "chapter" || e.disabled) return;
      const tr = bySlot.get(`${step.id}:${i}`);
      const t = titleFor(e.title, lang);
      if (!tr || !t) return;
      out.push({ id: `chapter-${++n}`, type: "chapter", timestamp: tr.t, name: `${step.id} #${i} chapter`, chapterTitle: t, ...(badge ? { chapterBadge: true } : {}), source: { step: step.id, entry: i } });
    });
    const tr = stepTransition(script, k);
    if (tr && start != null && !script.source) {
      const next = stepStart(k + 1) ?? endOfRecording;
      const firstAct = step.beat.findIndex((e) => isAct(e));
      const act = firstAct >= 0 ? bySlot.get(`${step.id}:${firstAct}`) : undefined;
      const end = Math.min(next, act ? (act.end ?? act.t) + TRANSITION_SEARCH_SEC : next);
      if (end > start) {
        out.push({ id: `transition-${k}`, type: "transition", timestamp: start, name: `${step.id} transition`, transitionEnd: end, transitionStyle: tr.style, transitionDuration: tr.duration, source: { step: step.id, entry: 0 } });
      }
    }
  });
  return out.sort((a, b) => a.timestamp - b.timestamp);
}

// ─── validation (called by validate.ts) ──────────────────────────────

/**
 * Semantic checks for chapters, transitions and highlights: title maps cover
 * every language, chapter-count / placement warnings, transitions where they
 * can't work.
 */
export function checkChaptersAndTransitions(
  script: DemoScript,
  langs: string[],
  issues: { path: string; message: string; hint?: string }[],
  warnings: string[],
): void {
  const cover = (map: unknown, p: string) => {
    if (!map || typeof map !== "object") return;
    for (const lang of langs) {
      const m = map as Record<string, string>;
      if (m[lang] == null && m.en == null) issues.push({ path: p, message: `nothing for language "${lang}" (and no "en" fallback)`, hint: `Add "${lang}": "…" to the map.` });
    }
  };
  let chapters = 0;
  script.steps.forEach((step, s) => {
    if (step.chapter != null && step.chapter !== false) {
      chapters++;
      cover(step.chapter, `steps[${s}].chapter`);
    }
    if (script.source && step.transition != null && step.transition !== "none") {
      warnings.push(`steps[${s}].transition: transitions work on browser recordings only (they look for the page change) — ignored for source.video.`);
    }
    step.beat.forEach((e, i) => {
      if (!isFx(e) || e.disabled) return;
      if (e.fx === "chapter") {
        chapters++;
        cover(e.title, `steps[${s}].beat[${i}].title`);
        if (i === 0 && !script.source) {
          warnings.push(`steps[${s}].beat[${i}]: a chapter as the first entry of a step — use the step's "chapter" field instead (no extra pause in the recording).`);
        }
      }
    });
  });
  if (script.source && script.transition != null && script.transition !== "none") {
    warnings.push(`transition: transitions work on browser recordings only — ignored for source.video.`);
  }
  cover(script.chapters?.introTitle, "chapters.introTitle");
  if (chapters === 0 && script.chapters) warnings.push(`chapters: set, but no step has a "chapter" (and there is no fx "chapter") — the video gets no chapters.`);
  if (chapters > 0) {
    // The list always starts at 0:00; a lead "Intro" chapter is added before a later first chapter or a title card.
    const lead = !!script.intro || !(script.steps[0]?.chapter != null && script.steps[0]?.chapter !== false);
    const total = chapters + (lead ? 1 : 0);
    if (total < 3) warnings.push(`chapters: ${total} chapter${total > 1 ? "s" : ""} in the video — YouTube shows chapters only when there are at least 3 (each at least 10 s long).`);
  }
}
