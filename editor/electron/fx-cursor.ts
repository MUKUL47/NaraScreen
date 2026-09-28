// ─── fx-cursor: the mouse pointer drawn into scripted recordings ─────
//
// Headless Chromium draws no pointer, so the viewer can't see what is clicked.
// The runner records each interaction (element box + when it began/ended); this
// module turns that into a pointer path and draws it as per-frame ASS vector
// drawings in the final pass (page space: it zooms with freeze-zooms and the
// follow camera, and stands still during freezes).
//
// PURE and dependency-free, like fx-geometry.ts. Times in the track are
// RECORDING seconds; cursorEvents() maps every output frame back to the
// recording moment it shows (fx-timeline.ts), so skips, speed ramps and inserts
// are handled in one place.
//
// The path: the pointer rests between acts. Before each act it travels from
// where it rests to the element — the centre (where Playwright clicks), or a
// natural click point near the start of a text field — on a gently bowed
// quadratic curve with a minimum-jerk ease (smooth start and stop, no
// overshoot), 0.35–0.8 s depending on distance, arriving just before the act.
// A click squeezes the pointer for a moment and sends out a ripple. While a
// field is being typed into, the pointer slides just below it, out of the text.

import type { Box, FrameSize, Pt } from "./fx-geometry";

/** What the runner saw the user do (the kinds the pointer reacts to). */
export type CursorKind = "click" | "type" | "select" | "hover" | "upload" | "press" | "scroll" | "wait";

/** One recorded interaction: element box (video px) and when it began / had finished (recording s). */
export interface CursorTarget {
  kind: CursorKind;
  rect: Box;
  t0: number;
  t1: number;
}

export interface CursorMove {
  t0: number;
  t1: number;
  from: Pt;
  to: Pt;
  /** quadratic Bézier control point (the bow) */
  ctrl: Pt;
}

/** The planned pointer, in recording seconds and video pixels. */
export interface CursorTrack {
  /** when the pointer fades in (it is not shown before) */
  appear: number;
  /** where it waits before the first move */
  start: Pt;
  moves: CursorMove[];
  /** click moments (pointer squeeze + ripple) */
  clicks: number[];
}

export interface CursorStyle {
  /** size multiplier (1 = default: ~30 px tall at 900 px) */
  size?: number;
  /** squeeze + ripple on clicks (default true) */
  clickEffect?: boolean;
  /** fill colour #RRGGBB (default white; the outline flips to white on dark fills) */
  color?: string;
}

/** Kinds the pointer travels to (the others — press, scroll, waitFor — are keyboard / page / waiting). */
export const POINTER_KINDS: CursorKind[] = ["click", "type", "select", "hover", "upload"];
const CLICK_KINDS: CursorKind[] = ["click", "type", "select", "upload"];

/** Arrive this long before the act (the pointer is at rest on the target when it happens). */
export const ARRIVE_LEAD = 0.08;
export const MOVE_MIN = 0.35;
export const MOVE_MAX = 0.8;
/** After a click the pointer stays put at least this long before it moves on. */
const CLICK_SETTLE = 0.15;
const FADE_IN = 0.25;
const SQUEEZE_SEC = 0.2;
export const RIPPLE_SEC = 0.4;

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
/** Minimum-jerk profile: zero speed and acceleration at both ends. */
export const minJerk = (u: number) => {
  const x = clamp(u, 0, 1);
  return x * x * x * (10 + x * (6 * x - 15));
};

/** Where the pointer's tip goes for an interaction. */
export function targetPoint(t: CursorTarget): Pt {
  const [x, y, w, h] = t.rect;
  if (t.kind === "type") return [x + clamp(w * 0.22, Math.min(14, w / 2), Math.min(110, w - 6)), y + h / 2];
  return [x + w / 2, y + h / 2];
}

/** Travel time for a distance (px) on a frame. */
export function moveSeconds(dist: number, frame: FrameSize): number {
  const diag = Math.hypot(frame.width, frame.height);
  return MOVE_MIN + (MOVE_MAX - MOVE_MIN) * Math.min(1, Math.pow(dist / (0.6 * diag), 0.75));
}

/** A gently bowed path from a to b: the control point sits off the chord, bulging upward. */
export function bowControl(a: Pt, b: Pt): Pt {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const d = Math.hypot(dx, dy);
  const mid: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  if (d < 1) return mid;
  let n: Pt = [-dy / d, dx / d];
  if (n[1] > 0 || (n[1] === 0 && n[0] < 0)) n = [-n[0], -n[1]];
  const bow = Math.min(0.1 * d, 60);
  return [mid[0] + n[0] * bow, mid[1] + n[1] * bow];
}

/**
 * Plan the pointer for a recording's interactions (sorted by time). Null when
 * none of them moves the pointer.
 */
export function planCursorPath(all: CursorTarget[], frame: FrameSize): CursorTrack | null {
  const targets = all.filter((t) => POINTER_KINDS.includes(t.kind) && t.rect[2] > 0 && t.rect[3] > 0).sort((a, b) => a.t0 - b.t0);
  if (!targets.length) return null;
  const inFrame = (p: Pt): Pt => [clamp(p[0], 2, frame.width - 2), clamp(p[1], 2, frame.height - 2)];
  const first = targetPoint(targets[0]);
  // Wait off to the lower right of the first target (the way a hand rests), inside the frame.
  const off: Pt = [frame.width * 0.14, frame.height * 0.16];
  const start = inFrame([first[0] + (first[0] + off[0] < frame.width - 20 ? off[0] : -off[0]), first[1] + (first[1] + off[1] < frame.height - 20 ? off[1] : -off[1])]);
  const moves: CursorMove[] = [];
  const clicks: number[] = [];
  let at = start;
  let free = -Infinity; // the pointer may leave its resting place from here on
  let appear = 0;

  targets.forEach((tg, k) => {
    const to = inFrame(targetPoint(tg));
    const arrive = tg.t0 - ARRIVE_LEAD;
    const dist = Math.hypot(to[0] - at[0], to[1] - at[1]);
    if (dist >= 2) {
      let dur = moveSeconds(dist, frame);
      if (k === 0) appear = Math.max(0, arrive - dur - FADE_IN - 0.1);
      const room = arrive - Math.max(free, appear + FADE_IN);
      if (room < dur) dur = Math.max(1 / 30, room);
      const t0 = Math.max(arrive - dur, k === 0 ? appear : free);
      const t1 = Math.max(t0 + 1 / 30, Math.min(arrive, t0 + dur));
      moves.push({ t0, t1, from: at, to, ctrl: bowControl(at, to) });
      at = to;
      free = t1;
    } else if (k === 0) {
      appear = Math.max(0, arrive - FADE_IN - 0.3);
    }
    if (CLICK_KINDS.includes(tg.kind)) {
      const c = Math.max(tg.t0 + 0.02, free);
      clicks.push(c);
      free = Math.max(free, c + CLICK_SETTLE);
    }
    if (tg.kind === "type") {
      // Out of the way while typing: slide just below the field.
      const [, y, , h] = tg.rect;
      const rest = inFrame([to[0] + 3, y + h + 6]);
      const t0 = free;
      const t1 = t0 + 0.3;
      if (Math.hypot(rest[0] - at[0], rest[1] - at[1]) >= 2) {
        moves.push({ t0, t1, from: at, to: rest, ctrl: bowControl(at, rest) });
        at = rest;
        free = t1;
      }
    }
    free = Math.max(free, Math.min(tg.t1, tg.t0 + 0.05));
  });
  return { appear, start, moves, clicks };
}

/** Pointer tip at recording time r. */
export function cursorAt(track: CursorTrack, r: number): Pt {
  let p = track.start;
  for (const m of track.moves) {
    if (r < m.t0) break;
    if (r < m.t1) {
      const e = minJerk((r - m.t0) / (m.t1 - m.t0));
      const a = 1 - e;
      return [
        a * a * m.from[0] + 2 * a * e * m.ctrl[0] + e * e * m.to[0],
        a * a * m.from[1] + 2 * a * e * m.ctrl[1] + e * e * m.to[1],
      ];
    }
    p = m.to;
  }
  return p;
}

/** How pressed the pointer is (0..1) and the ripples running at r (progress 0..1, where). */
export function clickStateAt(track: CursorTrack, r: number): { press: number; ripples: { u: number; at: Pt }[] } {
  let press = 0;
  const ripples: { u: number; at: Pt }[] = [];
  for (const c of track.clicks) {
    const d = r - c;
    if (d < 0 || d >= RIPPLE_SEC) continue;
    if (d < SQUEEZE_SEC) press = Math.max(press, Math.sin((Math.PI * d) / SQUEEZE_SEC));
    ripples.push({ u: d / RIPPLE_SEC, at: cursorAt(track, c) });
  }
  return { press, ripples };
}

// ─── drawing ─────────────────────────────────────────────────────────

/** The classic arrow pointer, tip at (0, 0), in units where it is 16.6 tall. */
const ARROW: Pt[] = [[0, 0], [0, 14.2], [3.5, 11.1], [6, 16.6], [8.5, 15.5], [6, 10.1], [10.6, 10.1]];
const ARROW_UNITS = 16.6;

/** Pointer height in px for a frame (before `size`). */
export function pointerHeight(frame: FrameSize, size = 1): number {
  return 30 * (Math.min(frame.width, frame.height) / 900) * size;
}

/** The pointer outline for a tip position, height and press (0..1, squeezes it toward the tip). */
export function pointerPolygon(tip: Pt, height: number, press = 0): Pt[] {
  const k = (height / ARROW_UNITS) * (1 - 0.14 * press);
  return ARROW.map(([x, y]) => [tip[0] + x * k, tip[1] + y * k]);
}

const r1 = (v: number) => Math.round(v * 10) / 10;

function assTs(sec: number): string {
  const cs = Math.max(0, Math.round(sec * 100));
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs % 100).padStart(2, "0")}`;
}

function bgr(hex: string): string {
  const v = (/^#?([0-9a-f]{6})$/i.exec(hex)?.[1] ?? "FFFFFF").toUpperCase();
  return `&H${v.slice(4, 6)}${v.slice(2, 4)}${v.slice(0, 2)}&`;
}
const alphaHex = (opacity: number) => Math.round((1 - clamp(opacity, 0, 1)) * 255).toString(16).toUpperCase().padStart(2, "0");
function luminance(hex: string): number {
  const v = /^#?([0-9a-f]{6})$/i.exec(hex)?.[1] ?? "FFFFFF";
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** A polygon as an ASS drawing: \pos at its bbox corner, points relative to it. */
function drawing(pts: Pt[]): { pos: Pt; body: string } {
  const minX = Math.min(...pts.map((p) => p[0]));
  const minY = Math.min(...pts.map((p) => p[1]));
  const rel = pts.map(([x, y]) => `${r1(x - minX)} ${r1(y - minY)}`);
  return { pos: [r1(minX), r1(minY)], body: `m ${rel[0]} l ${rel.slice(1).join(" ")}` };
}

/** A circle of radius r around c, as four cubic Béziers (ASS drawing). */
function circle(c: Pt, r: number): { pos: Pt; body: string } {
  const k = 0.5523 * r;
  const o = (x: number, y: number) => `${r1(x + r)} ${r1(y + r)}`;
  const body = `m ${o(r, 0)} b ${o(r, k)} ${o(k, r)} ${o(0, r)} b ${o(-k, r)} ${o(-r, k)} ${o(-r, 0)} b ${o(-r, -k)} ${o(-k, -r)} ${o(0, -r)} b ${o(k, -r)} ${o(r, -k)} ${o(r, 0)}`;
  return { pos: [r1(c[0] - r), r1(c[1] - r)], body };
}

/** One frame of the pointer (and its ripples) as ASS override+drawing texts, keyed for merging. */
function frameTexts(
  tip: Pt,
  scale: number,
  opacity: number,
  press: number,
  ripples: { u: number; at: Pt }[],
  look: { height: number; fill: string; outline: string; ripple: string; clickEffect: boolean },
): { layer: number; text: string }[] {
  const out: { layer: number; text: string }[] = [];
  const h = look.height * scale;
  if (look.clickEffect) {
    for (const rp of ripples) {
      const e = 1 - Math.pow(1 - rp.u, 2.2);
      const rad = h * (0.22 + 0.72 * e);
      const fade = Math.pow(1 - rp.u, 1.4) * opacity;
      const c = circle(rp.at, rad);
      const w = Math.max(1, h * 0.085 * (1 - 0.45 * rp.u));
      out.push({
        layer: 30,
        text: `{\\an7\\pos(${c.pos[0]},${c.pos[1]})\\1c${look.ripple}\\1a&H${alphaHex(0.16 * fade)}&\\3c${look.ripple}\\3a&H${alphaHex(0.55 * fade)}&\\bord${r1(w)}\\shad0\\blur0.6\\p1}${c.body}{\\p0}`,
      });
    }
  }
  const pts = pointerPolygon(tip, h, look.clickEffect ? press : 0);
  const d = drawing(pts);
  const sh = drawing(pts.map(([x, y]) => [x + h * 0.035, y + h * 0.085]));
  const a = alphaHex(opacity);
  out.push({
    layer: 31,
    text: `{\\an7\\pos(${sh.pos[0]},${sh.pos[1]})\\1c&H000000&\\1a&H${alphaHex(0.42 * opacity)}&\\bord0\\shad0\\blur${r1(h * 0.09)}\\p1}${sh.body}{\\p0}`,
  });
  out.push({
    layer: 32,
    text: `{\\an7\\pos(${d.pos[0]},${d.pos[1]})\\1c${look.fill}\\3c${look.outline}\\alpha&H${a}&\\bord${r1(Math.max(1, h * 0.055))}\\shad0\\blur0.4\\p1}${d.body}{\\p0}`,
  });
  return out;
}

/**
 * ASS dialogue lines (style CArrow, fully overridden) for the pointer over the
 * final timeline: one event per output frame while anything changes, merged
 * while it rests. `source(T)` says what recording moment frame T shows and how a
 * freeze-zoom transforms it. Event edges sit between frames, so rounding to
 * centiseconds never shows a frame the wrong state.
 */
export function cursorEvents(
  track: CursorTrack,
  style: CursorStyle,
  frame: FrameSize,
  source: (T: number) => { r: number; zoom?: { s: number; ox: number; oy: number } },
  duration: number,
  fps = 30,
): string[] {
  const fill = style.color && /^#?[0-9a-f]{6}$/i.test(style.color) ? (style.color.startsWith("#") ? style.color : `#${style.color}`) : "#FFFFFF";
  const dark = luminance(fill) < 0.45;
  const look = {
    height: pointerHeight(frame, style.size ?? 1),
    fill: bgr(fill),
    outline: dark ? bgr("#FFFFFF") : bgr("#141414"),
    ripple: dark ? bgr("#FFFFFF") : bgr("#1E293B"),
    clickEffect: style.clickEffect !== false,
  };
  const lines: string[] = [];
  let run: { key: string; texts: { layer: number; text: string }[]; from: number } | null = null;
  const flush = (to: number) => {
    if (!run) return;
    for (const t of run.texts) lines.push(`Dialogue: ${t.layer},${assTs(run.from)},${assTs(to)},CArrow,,0,0,0,,${t.text}`);
    run = null;
  };
  const frames = Math.floor(duration * fps + 1e-6);
  for (let k = 0; k <= frames; k++) {
    const T = k / fps;
    const edge = k === 0 ? 0 : (k - 0.5) / fps;
    const src = source(T);
    const opacity = clamp((src.r - track.appear) / FADE_IN, 0, 1);
    if (opacity <= 0) {
      flush(edge);
      continue;
    }
    const z = src.zoom ?? { s: 1, ox: 0, oy: 0 };
    const view = (p: Pt): Pt => [(p[0] - z.ox) * z.s, (p[1] - z.oy) * z.s];
    const { press, ripples } = clickStateAt(track, src.r);
    const texts = frameTexts(view(cursorAt(track, src.r)), z.s, opacity, press, ripples.map((rp) => ({ u: rp.u, at: view(rp.at) })), look);
    const key = texts.map((t) => t.text).join("|");
    if (run && run.key === key) continue;
    flush(edge);
    run = { key, texts, from: edge };
  }
  flush(Math.max((frames + 0.5) / fps, duration));
  return lines;
}
