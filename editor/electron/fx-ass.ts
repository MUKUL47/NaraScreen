// ─── fx-ass: small ASS (libass) helpers for fx-highlight / fx-chapters ──
//
// The same conventions produce.ts uses for its callouts and arrows: events are
// drawn in the video's own pixels (PlayRes = the recording size), vector
// shapes use the CArrow style (fill set per event) and text the CLabel style,
// both defined in produce.ts CALLOUT_STYLES — present whenever the ASS file
// carries any callout-type line, which these events are.

import type { Pt } from "./fx-geometry";

/** Seconds → ASS time (h:mm:ss.cc). */
export function assTime(sec: number): string {
  const s = Math.max(0, sec);
  const cs = Math.round(s * 100);
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const ss = Math.floor((cs % 6000) / 100);
  return `${h}:${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}.${String(cs % 100).padStart(2, "0")}`;
}

/** Plain text → ASS dialogue text (braces escaped, backslashes kept, newlines → \N). */
export function assText(text: string): string {
  return text
    .replace(/\\/g, "\\⁠")
    .replace(/\{/g, "\\{")
    .replace(/\}/g, "\\}")
    .replace(/\r?\n/g, "\\N");
}

/** "#RRGGBB" → ASS colour "&HBBGGRR&" (fallback when the value is malformed). */
export function assBgr(hex: string | undefined, fallback: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex ?? "") ?? /^#?([0-9a-f]{6})$/i.exec(fallback)!;
  const v = m[1].toUpperCase();
  return `&H${v.slice(4, 6)}${v.slice(2, 4)}${v.slice(0, 2)}&`;
}

/** Opacity 0..1 → ASS alpha override value "&HAA&" (00 = opaque). */
export function assAlpha(opacity: number): string {
  const a = Math.round((1 - Math.max(0, Math.min(1, opacity))) * 255);
  return `&H${a.toString(16).toUpperCase().padStart(2, "0")}&`;
}

/** One filled polygon (absolute video px) as an ASS drawing event. */
export function assShape(layer: number, start: number, end: number, pts: Pt[], tags: string, style = "CArrow"): string {
  const minX = Math.min(...pts.map((p) => p[0]));
  const minY = Math.min(...pts.map((p) => p[1]));
  const rel = pts.map(([x, y]) => `${Math.round(x - minX)} ${Math.round(y - minY)}`);
  // \an7 + \pos at the bounding box's corner: libass aligns a drawing by its bbox.
  return (
    `Dialogue: ${layer},${assTime(start)},${assTime(end)},${style},,0,0,0,,` +
    `{\\an7\\pos(${Math.round(minX)},${Math.round(minY)})${tags}\\p1}m ${rel[0]} l ${rel.slice(1).join(" ")}{\\p0}`
  );
}
