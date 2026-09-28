// ─── fx-highlight: a marker-pen swipe over text ──────────────────────
//
// fx "highlight" compiles to a callout with calloutStyle "highlight"
// (calloutPanels[k].rect = each anchored element, like an arrow's target), so
// the desktop editor can still open it. The renderer draws it as page-space ASS
// vector drawings, one event per frame while the stroke sweeps (the arrow's
// per-frame approach): a chisel-tip marker stroke sweeps left → right across
// each line box, holds, then fades out.
//
// Look: semi-transparent yellow with slightly irregular top/bottom edges, a
// small upward tilt and slanted (chisel) ends, plus two faint ink streaks
// along it. libass has no multiply blend, so the stroke is drawn OVER the
// text at ~42 % opacity: dark text stays dark (olive), white paper turns pale
// yellow — the look of a highlighter. "underline" is a thinner, nearly opaque
// hand-drawn stroke under the text instead.
//
// Geometry is PURE (exported for tests); highlightSwipeEvents is what
// produce.ts calls.

import { ARROW_DRAW_FPS, easeInOut, type Box, type FrameSize, type Pt } from "./fx-geometry";
import { assAlpha, assBgr, assShape } from "./fx-ass";

export const HIGHLIGHT_DEFAULT_COLOR = "#FDE047";
export type HighlightStyle = "marker" | "underline";

/** What the renderer reads from a highlight action (a callout with calloutStyle "highlight"). */
export interface HighlightAction {
  type: string;
  timestamp: number;
  calloutStyle?: string;
  calloutDuration?: number;
  calloutPanels?: { rect: [number, number, number, number] }[];
  highlightColor?: string;
  highlightStyle?: string;
  highlightLines?: number;
  arrowScale?: number;
  disabled?: boolean;
}

export function isHighlight(a: { type: string; calloutStyle?: string }): boolean {
  return a.type === "callout" && a.calloutStyle === "highlight";
}

/** Size factor of strokes for a frame (same rule as the arrow's). */
export function highlightScale(res: FrameSize, override?: number): number {
  return override ?? Math.max(0.6, Math.min(res.height, res.width * 0.625) / 900);
}

/** An element's box split into `lines` equal line boxes, top to bottom. */
export function lineBoxes(rect: Box, lines = 1): Box[] {
  const n = Math.max(1, Math.min(20, Math.round(lines)));
  const [x, y, w, h] = rect;
  return Array.from({ length: n }, (_, k): Box => [x, y + (h * k) / n, w, h / n]);
}

/** Smooth deterministic wobble in [-1, 1] along u ∈ [0, 1] (seeded per stroke). */
function wobble(seed: number, u: number): number {
  const a = Math.sin(u * 7.3 + seed * 1.7) * 0.55;
  const b = Math.sin(u * 17.9 + seed * 3.1 + 1.3) * 0.3;
  const c = Math.sin(u * 41.3 + seed * 5.3 + 2.1) * 0.15;
  return a + b + c;
}

/**
 * The stroke's two long edges, sampled left → right at the same u (0..1): a
 * parallelogram (chisel tip: the top edge starts `slant` px further right and
 * ends `slant` px further right than the bottom edge) with wobbly edges and a
 * slight rise to the right. Kept inside the frame.
 */
export interface MarkerStroke {
  top: Pt[];
  bottom: Pt[];
  /** stroke thickness (px) */
  thickness: number;
}

export function markerStroke(box: Box, style: HighlightStyle, scale: number, res: FrameSize, seed = 0): MarkerStroke {
  const [x, y, w, h] = box;
  const underline = style === "underline";
  const pad = (underline ? 3 : 5) * scale;
  const t = underline ? Math.max(3.5 * scale, Math.min(0.14 * h, 7 * scale)) : Math.max(4, h * 0.8);
  const mid = underline ? y + h * 0.94 : y + h * 0.53;
  const slant = Math.min(underline ? 0.8 * t : 0.32 * t, w * 0.15);
  const amp = underline ? Math.min(0.12 * t, 1.2 * scale) : Math.min(0.07 * t, 2.2 * scale);
  const rise = underline ? Math.min(0.02 * w, 3 * scale) : Math.min(0.1 * t, 3 * scale);
  const x0 = Math.max(1, x - pad);
  const x1 = Math.min(res.width - 1, x + w + pad);
  const span = Math.max(1, x1 - x0 - slant);
  const N = Math.max(8, Math.min(48, Math.round((x1 - x0) / (10 * scale))));
  const clampY = (v: number) => Math.max(1, Math.min(res.height - 1, v));
  const top: Pt[] = [];
  const bottom: Pt[] = [];
  for (let i = 0; i <= N; i++) {
    const u = i / N;
    const lift = -rise * u; // rises slightly to the right
    // The ends are a little thinner (the pen lands and lifts).
    const taper = 1 - 0.12 * Math.pow(Math.abs(2 * u - 1), 6);
    const half = (t / 2) * taper;
    top.push([x0 + slant + u * span, clampY(mid + lift - half + amp * wobble(seed, u))]);
    bottom.push([x0 + u * span, clampY(mid + lift + half + amp * wobble(seed + 11, u))]);
  }
  return { top, bottom, thickness: t };
}

/** The part of a stroke swept so far (p = 0..1 of its length), as one polygon. */
export function markerPolygon(s: MarkerStroke, p: number): Pt[] {
  const n = s.top.length - 1;
  const q = Math.max(0, Math.min(1, p)) * n;
  const k = Math.floor(q);
  const f = q - k;
  const lerp = (pts: Pt[]): Pt => (k >= n ? pts[n] : [pts[k][0] + (pts[k + 1][0] - pts[k][0]) * f, pts[k][1] + (pts[k + 1][1] - pts[k][1]) * f]);
  const top = [...s.top.slice(0, k + 1), lerp(s.top)];
  const bottom = [...s.bottom.slice(0, k + 1), lerp(s.bottom)];
  return [...top, ...bottom.reverse()];
}

/** Two faint ink streaks along a marker stroke (a real marker lays ink unevenly). */
function streaks(s: MarkerStroke): MarkerStroke[] {
  const band = (a: number, b: number): MarkerStroke => ({
    top: s.top.map((p, i) => [p[0] + (s.bottom[i][0] - p[0]) * a, p[1] + (s.bottom[i][1] - p[1]) * a] as Pt),
    bottom: s.top.map((p, i) => [p[0] + (s.bottom[i][0] - p[0]) * b, p[1] + (s.bottom[i][1] - p[1]) * b] as Pt),
    thickness: s.thickness * (b - a),
  });
  return [band(0.16, 0.24), band(0.7, 0.8)];
}

/** One stroke's timing: swept from t0 to t1 (one step per frame, easing), then held. */
export interface SwipeTiming {
  strokes: { steps: { t0: number; t1: number; p: number }[]; drawnAt: number }[];
  /** when everything starts fading, and the end */
  fadeMs: number;
  end: number;
}

/**
 * Timing for `n` strokes shown from `start` to `end`: they sweep one after
 * another (≈ 0.25–0.5 s each by length, together ≤ 45 % of the time on screen),
 * hold, and all fade out over the last ≤ 0.3 s.
 */
export function swipeTiming(start: number, end: number, lengths: number[], scale: number): SwipeTiming {
  const avail = Math.max(0, end - start);
  const fadeMs = Math.round(Math.min(0.3, avail * 0.2) * 1000);
  const want = lengths.map((len) => Math.max(0.25, Math.min(0.5, 0.18 + len / (1400 * scale))));
  const total = want.reduce((a, b) => a + b, 0);
  const k = total > 0 ? Math.min(1, (avail * 0.45) / total) : 1;
  let at = start;
  const strokes = want.map((sec) => {
    const d = sec * k;
    const nSteps = Math.max(1, Math.round(d * ARROW_DRAW_FPS));
    const steps = Array.from({ length: nSteps }, (_, i) => ({
      t0: at + (d * i) / nSteps,
      t1: at + (d * (i + 1)) / nSteps,
      p: easeInOut((i + 1) / nSteps),
    }));
    at += d;
    return { steps, drawnAt: at };
  });
  return { strokes, fadeMs, end };
}

/**
 * ASS events for every highlight action (PAGE-SPACE: they belong on the page,
 * under any camera crop, with spotlight/callouts/arrows). Times are on the
 * final timeline; each window is clamped to the video's length.
 */
export function highlightSwipeEvents(
  actions: HighlightAction[],
  res: FrameSize,
  totalDuration: number,
  emit: (msg: string) => void = () => {},
): string[] {
  const out: string[] = [];
  let seed = 0;
  for (const a of actions) {
    if (!isHighlight(a) || a.disabled) continue;
    const start = a.timestamp;
    const end = Math.min(start + (a.calloutDuration ?? 3), totalDuration);
    if (!(end - start > 0.1)) continue;
    const style: HighlightStyle = a.highlightStyle === "underline" ? "underline" : "marker";
    const scale = highlightScale(res, a.arrowScale);
    const boxes = (a.calloutPanels ?? []).flatMap((p) => lineBoxes(p.rect, a.highlightLines ?? 1));
    if (!boxes.length) continue;
    const strokes = boxes.map((b) => markerStroke(b, style, scale, res, seed++));
    const timing = swipeTiming(start, end, boxes.map((b) => b[2]), scale);
    const color = assBgr(a.highlightColor, HIGHLIGHT_DEFAULT_COLOR);
    const base = style === "underline" ? 0.85 : 0.42;
    const fill = `\\1c${color}\\1a${assAlpha(base)}\\bord0\\shad0\\blur0.6`;
    const ink = `\\1c${color}\\1a${assAlpha(0.14)}\\bord0\\shad0\\blur0.8`;
    emit(`    Highlight at ${start.toFixed(1)}s-${end.toFixed(1)}s (${boxes.length} stroke${boxes.length > 1 ? "s" : ""}, ${style})`);
    strokes.forEach((s, i) => {
      const tm = timing.strokes[i];
      const extra = style === "marker" ? streaks(s) : [];
      // Layer 0, before callouts in the file: arrows, labels and subtitles draw over it.
      for (const st of tm.steps) {
        out.push(assShape(0, st.t0, st.t1, markerPolygon(s, st.p), fill));
        for (const e of extra) out.push(assShape(0, st.t0, st.t1, markerPolygon(e, st.p), ink));
      }
      const fade = `\\fad(0,${timing.fadeMs})`;
      out.push(assShape(0, tm.drawnAt, end, markerPolygon(s, 1), fill + fade));
      for (const e of extra) out.push(assShape(0, tm.drawnAt, end, markerPolygon(e, 1), ink + fade));
    });
  }
  return out;
}
