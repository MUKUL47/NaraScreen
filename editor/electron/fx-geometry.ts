// ─── fx-geometry: the arrow, its label and its highlight loop, as shapes ──
//
// PURE and dependency-free (no Node, no DOM): produce.ts draws these shapes
// into the video (as ASS vector drawings), and the desktop editor's canvas
// preview draws the very same ones, so the preview can never drift from the
// render. Everything is in video pixels, time in seconds on the final
// timeline. The canvas only needs arrowAt(); the rest is exported for
// produce.ts and the tests.
//
// Type-clean under electron/tsconfig.json, api/tsconfig.json and the
// renderer's tsconfig.app.json (strict, noUnusedLocals, erasableSyntaxOnly).

/** A point [x, y] in video pixels. */
export type Pt = [number, number];
/** A box [x, y, width, height] in video pixels. */
export type Box = [number, number, number, number];
/** A video frame size. */
export interface FrameSize {
  width: number;
  height: number;
}

/** ASS font size that matches drawtext's pixel size (ASS sizes the whole line
 *  box, drawtext the em) — keeps callouts the size they always were. */
export const ASS_FONT_SCALE = 1.25;

/** Frames per second of the arrow's draw-in and the loop's draw/erase (one step per frame). */
export const ARROW_DRAW_FPS = 30;

// ─── the arrow ───────────────────────────────────────────────────────

export type ArrowFrom = "left" | "right" | "above" | "below" | "top-left" | "top-right" | "bottom-left" | "bottom-right";
export const ARROW_DIRS: Record<ArrowFrom, [number, number]> = {
  left: [-1, 0], right: [1, 0], above: [0, -1], below: [0, 1],
  "top-left": [-1, -1], "top-right": [1, -1], "bottom-left": [-1, 1], "bottom-right": [1, 1],
};
/** Tried in order when `arrowFrom` is not set: the first whose tail fits in the frame wins. */
export const ARROW_AUTO: ArrowFrom[] = ["bottom-left", "bottom-right", "top-left", "top-right", "left", "right", "below", "above"];
export const ARROW_DEFAULT_COLOR = "#F97316";

/** Where the arrow's tail and tip go for a target box (video pixels). */
export function arrowGeometry(
  rect: Box,
  res: FrameSize,
  from?: ArrowFrom,
  scaleOverride?: number,
): { tail: [number, number]; tip: [number, number]; scale: number; from: ArrowFrom } {
  const scale = scaleOverride ?? Math.max(0.6, Math.min(res.height, res.width * 0.625) / 900);
  const len = 150 * scale;
  const gap = 10 * scale;
  const margin = 16 * scale;
  const [x, y, w, h] = rect;
  // Wide targets (a full-width list row, a banner): an arrow at the edge would read
  // as pointing at the neighbour, so the tip lands INSIDE, on the right-hand part
  // (usually empty in rows), coming from the lower right.
  if (w > res.width * 0.6 && h < res.height * 0.6) {
    const d = Math.SQRT1_2;
    const tip: [number, number] = [x + w * 0.66, y + h * 0.55];
    const pick = (f: ArrowFrom): [number, number] => {
      const [dx, dy] = ARROW_DIRS[f];
      return [tip[0] + dx * d * len, tip[1] + dy * d * len];
    };
    const inFrame = (p: [number, number]) => p[0] >= margin && p[0] <= res.width - margin && p[1] >= margin && p[1] <= res.height - margin;
    const order: ArrowFrom[] = from ? [from] : ["bottom-right", "top-right", "bottom-left", "top-left"];
    const f = order.find((o) => inFrame(pick(o))) ?? order[0];
    const tail = pick(f);
    return { tip, tail: [Math.max(margin, Math.min(res.width - margin, tail[0])), Math.max(margin, Math.min(res.height - margin, tail[1]))], scale, from: f };
  }
  const cx = x + w / 2;
  const cy = y + h / 2;
  const place = (f: ArrowFrom) => {
    const [dx0, dy0] = ARROW_DIRS[f];
    const n = Math.hypot(dx0, dy0);
    const dx = dx0 / n;
    const dy = dy0 / n;
    // distance from the centre to the box edge along d
    const t = Math.min(dx ? w / 2 / Math.abs(dx) : Infinity, dy ? h / 2 / Math.abs(dy) : Infinity);
    const tip: [number, number] = [cx + dx * (t + gap), cy + dy * (t + gap)];
    const tail: [number, number] = [cx + dx * (t + gap + len), cy + dy * (t + gap + len)];
    const inside = (p: [number, number]) => p[0] >= margin && p[0] <= res.width - margin && p[1] >= margin && p[1] <= res.height - margin;
    return { tip, tail, fits: inside(tip) && inside(tail), d: [dx, dy] as const };
  };
  for (const f of from ? [from] : ARROW_AUTO) {
    const g = place(f);
    if (g.fits || from) {
      const clamp = (p: [number, number]): [number, number] => [
        Math.max(margin, Math.min(res.width - margin, p[0])),
        Math.max(margin, Math.min(res.height - margin, p[1])),
      ];
      return { tail: clamp(g.tail), tip: clamp(g.tip), scale, from: f };
    }
  }
  // Nothing fits (the element fills the frame): point at its centre from the lower left, inside it.
  const tip: [number, number] = [cx, cy];
  const d = Math.SQRT1_2;
  return { tip, tail: [cx - d * len, cy + d * len].map((v, i) => Math.max(margin, Math.min((i ? res.height : res.width) - margin, v))) as [number, number], scale, from: "bottom-left" };
}

/** The arrow as shapes (video px): the curve it follows and, for any drawn length
 *  along it, the stroke so far and the chevron at its end. Exported for tests. */
export function arrowShape(g: { tail: Pt; tip: Pt; scale: number }, frameCenter?: Pt): {
  point(t: number): Pt;
  length: number;
  at(s: number): Pt;
  stroke(s: number): Pt[];
  head(s: number): { arms: [Pt, Pt]; tip: Pt };
  thickness: number;
} {
  const [tx, ty] = g.tail;
  const [px, py] = g.tip;
  const len = Math.hypot(px - tx, py - ty);
  const ux = (px - tx) / len;
  const uy = (py - ty) / len;
  // A gentle bow: the control point sits off the straight line by 16% of the length.
  // Its side follows the direction: a diagonal bows toward the corner (tip x, tail y),
  // so it leaves the tail sideways and arrives at the target vertically — bottom-left →
  // top-right is a ")", bottom-right → top-left a "(", and the top ones mirror them.
  // Straight across/up/down arrows bow toward the frame's centre, away from the edge.
  const bow = 0.16 * len;
  const mx = (tx + px) / 2;
  const my = (ty + py) / 2;
  const nx = uy;
  const ny = -ux;
  let side = (px - mx) * nx + (ty - my) * ny;
  if (Math.abs(side) < 0.2 * len) side = frameCenter ? (frameCenter[0] - mx) * nx + (frameCenter[1] - my) * ny : 1;
  const sgn = side < 0 ? -1 : 1;
  const c: Pt = [mx + nx * bow * sgn, my + ny * bow * sgn];
  const point = (t: number): Pt => {
    const a = (1 - t) * (1 - t);
    const b = 2 * (1 - t) * t;
    const d = t * t;
    return [a * tx + b * c[0] + d * px, a * ty + b * c[1] + d * py];
  };
  // Arc length → t (the bow makes t uneven along the curve).
  const N = 96;
  const cum = [0];
  let prev = point(0);
  for (let i = 1; i <= N; i++) {
    const p = point(i / N);
    cum.push(cum[i - 1] + Math.hypot(p[0] - prev[0], p[1] - prev[1]));
    prev = p;
  }
  const total = cum[N];
  const tAt = (s: number) => {
    const target = Math.max(0, Math.min(total, s));
    let i = 1;
    while (i < N && cum[i] < target) i++;
    const f = (target - cum[i - 1]) / Math.max(1e-6, cum[i] - cum[i - 1]);
    return (i - 1 + f) / N;
  };
  const at = (s: number) => point(tAt(s));
  const thickness = 6 * g.scale;
  const fullHead = Math.min(24 * g.scale, total * 0.35);
  const stroke = (s: number): Pt[] => Array.from({ length: 25 }, (_, i) => at((Math.max(1, s) * i) / 24));
  // Open chevron at the stroke's end, along the curve's direction there; it grows in with the line.
  const head = (s: number) => {
    const end = at(s);
    const back = at(s - 2);
    const dx = end[0] - back[0];
    const dy = end[1] - back[1];
    const dl = Math.hypot(dx, dy) || 1;
    const hx = dx / dl;
    const hy = dy / dl;
    const hl = fullHead * Math.min(1, s / (total * 0.35));
    const arm = (sign: number): Pt => {
      const a = (sign * 34 * Math.PI) / 180;
      const rx = hx * Math.cos(a) - hy * Math.sin(a);
      const ry = hx * Math.sin(a) + hy * Math.cos(a);
      return [end[0] - rx * hl, end[1] - ry * hl];
    };
    return { arms: [arm(1), arm(-1)] as [Pt, Pt], tip: end };
  };
  return { point, length: total, at, stroke, head, thickness };
}

/** A thick stroke along `pts` with round caps, as one polygon. */
export function capsule(pts: Pt[], th: number): Pt[] {
  const r = th / 2;
  const n = pts.length;
  // left normal at each point (the stroke's direction turned 90°)
  const norm = (i: number): Pt => {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(n - 1, i + 1)];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [-(b[1] - a[1]) / l, (b[0] - a[0]) / l];
  };
  const left: Pt[] = pts.map((p, i) => [p[0] + norm(i)[0] * r, p[1] + norm(i)[1] * r]);
  const right: Pt[] = pts.map((p, i): Pt => [p[0] - norm(i)[0] * r, p[1] - norm(i)[1] * r]).reverse();
  // Half circle from `fromAngle`, sweeping 180° through the stroke's outward end.
  const cap = (c: Pt, fromAngle: number): Pt[] =>
    Array.from({ length: 7 }, (_, k) => {
      const a = fromAngle - (Math.PI * (k + 1)) / 8;
      return [c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r] as Pt;
    });
  const nEnd = norm(n - 1);
  const nStart = norm(0);
  return [...left, ...cap(pts[n - 1], Math.atan2(nEnd[1], nEnd[0])), ...right, ...cap(pts[0], Math.atan2(-nStart[1], -nStart[0]))];
}

/** Where the label pill goes: just beyond the tail, on the side away from the arrow, inside the frame. Exported for tests. */
export function arrowLabelBox(
  g: { tail: Pt; scale: number },
  shape: { point(t: number): Pt },
  text: string,
  fontSize: number,
  res: FrameSize,
): { cx: number; cy: number; pw: number; ph: number; fs: number } {
  const [tx, ty] = g.tail;
  const vx = tx - shape.point(0.08)[0];
  const vy = ty - shape.point(0.08)[1];
  const vl = Math.hypot(vx, vy) || 1;
  const dx = vx / vl;
  const dy = vy / vl;
  const fs = fontSize * ASS_FONT_SCALE;
  const graphemes = [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text)].length;
  const ph = fs * 1.25;
  const pw = graphemes * fs * 0.55 + ph * 0.9;
  const gap = 14 * g.scale;
  let cx = tx + dx * gap + (dx < -0.3 ? -pw / 2 : dx > 0.3 ? pw / 2 : 0);
  let cy = ty + dy * gap + (dy < -0.3 ? -ph / 2 : dy > 0.3 ? ph / 2 : 0);
  const edge = 10;
  cx = Math.max(edge + pw / 2, Math.min(res.width - edge - pw / 2, cx));
  cy = Math.max(edge + ph / 2, Math.min(res.height - edge - ph / 2, cy));
  return { cx, cy, pw, ph, fs };
}

/** A rounded rectangle as one polygon. */
export function roundedRect(x: number, y: number, w: number, h: number, r: number): Pt[] {
  const out: Pt[] = [];
  const corner = (cx: number, cy: number, a0: number) => {
    for (let k = 0; k <= 6; k++) {
      const a = a0 + (Math.PI / 2) * (k / 6);
      out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
  };
  corner(x + w - r, y + r, -Math.PI / 2);
  corner(x + w - r, y + h - r, 0);
  corner(x + r, y + h - r, Math.PI / 2);
  corner(x + r, y + r, Math.PI);
  return out;
}

/**
 * A hand-drawn loop around a box (video px), like a pencil circle: it hugs the
 * element's shape (a circle for square things, flatter and boxier for wide rows),
 * spirals out a little and overshoots its start, with a slight wobble and tilt.
 * Kept inside the frame. Exported for tests.
 */
export function pencilLoop(rect: Box, res: FrameSize, scale: number): Pt[] {
  const [x, y, w, h] = rect;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const pad = 6 * scale;
  const grow = 7 * scale; // how far the overshoot spirals out
  const wob = 2.5 * scale;
  const margin = 6 * scale + grow + wob;
  // Superellipse |x/rx|^n + |y/ry|^n = 1: n = 2 is an ellipse, higher is boxier.
  const aspect = Math.max(w, h) / Math.max(1, Math.min(w, h));
  const n = 2 + Math.min(4, (aspect - 1) * 0.6);
  const k = Math.pow(2, 1 / n); // equal stretch that puts the box's corners on the curve
  const maxRx = Math.max(12 * scale, Math.min(cx - margin, res.width - cx - margin));
  const maxRy = Math.max(10 * scale, Math.min(cy - margin, res.height - cy - margin));
  let rx = Math.min((w / 2) * k + pad, maxRx);
  let ry = Math.min((h / 2) * k + pad, maxRy);
  // Squeezed by the frame on one axis: open the other to clear the corners, but only a
  // little (a full-width row's loop may clip the row's far ends; it must not cover the next row).
  const fit = (half: number, r: number) => Math.pow(Math.min(0.95, half / r), n);
  if (rx < (w / 2) * k + pad) ry = Math.min(maxRy, h / 2 + 1.5 * pad, (h / 2 + pad) / Math.pow(1 - fit(w / 2, rx), 1 / n));
  else if (ry < (h / 2) * k + pad) rx = Math.min(maxRx, w / 2 + 1.5 * pad, (w / 2 + pad) / Math.pow(1 - fit(h / 2, ry), 1 / n));
  // Tilt a few degrees, but never enough to lift a wide loop into the next row.
  const tilt = -Math.min((3 * Math.PI) / 180, Math.atan((0.12 * ry) / rx));
  const a0 = (-160 * Math.PI) / 180; // starts upper left, goes clockwise
  const sweep = 2 * Math.PI + 0.45; // a little past a full turn
  const e = 2 / n;
  const N = 120;
  return Array.from({ length: N + 1 }, (_, i): Pt => {
    const u = i / N;
    const a = a0 + sweep * u;
    const c = Math.cos(a);
    const sn = Math.sin(a);
    const off = grow * u + wob * Math.sin(3 * a + 1);
    // On a flat (or tall) loop the spiral and wobble shrink across the thin side, so it stays snug.
    const ex = Math.sign(c) * Math.pow(Math.abs(c), e) * rx + c * off * Math.max(0.3, Math.min(1, rx / ry));
    const ey = Math.sign(sn) * Math.pow(Math.abs(sn), e) * ry + sn * off * Math.max(0.3, Math.min(1, ry / rx));
    return [cx + ex * Math.cos(tilt) - ey * Math.sin(tilt), cy + ex * Math.sin(tilt) + ey * Math.cos(tilt)];
  });
}

/** The part of a polyline between arc lengths s0 and s1. */
export function polySlice(pts: Pt[], cum: number[], s0: number, s1: number): Pt[] {
  const at = (s: number): Pt => {
    let i = 1;
    while (i < cum.length - 1 && cum[i] < s) i++;
    const f = (s - cum[i - 1]) / Math.max(1e-6, cum[i] - cum[i - 1]);
    return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * f, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * f];
  };
  const out: Pt[] = [at(s0)];
  for (let i = 1; i < pts.length - 1; i++) if (cum[i] > s0 && cum[i] < s1) out.push(pts[i]);
  out.push(at(s1));
  return out;
}


// ─── easing and timing (shared with produce.ts) ──────────────────────

export const easeOut = (u: number): number => 1 - Math.pow(1 - u, 3);
export const easeIn = (u: number): number => u * u;
export const easeInOut = (u: number): number => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);

/**
 * One step of an animation: from `t0` to `t1` (seconds) the visible part of a
 * path runs from `s0` to `s1` (fractions 0..1 of its length). produce.ts writes
 * one ASS event per step; a preview shows the step whose [t0, t1) holds `t`.
 */
export interface DrawStep {
  t0: number;
  t1: number;
  s0: number;
  s1: number;
}

/** The step showing at time t (null: nothing of the path is visible). */
export function stepAt(steps: DrawStep[], t: number): DrawStep | null {
  return steps.find((st) => t >= st.t0 && t < st.t1) ?? null;
}

/**
 * The arrow's timing between `start` and `end`: it draws itself in over ≤ 0.5 s
 * (never more than a third of its time on screen), one step per frame, easing
 * out; the last step holds the whole arrow until `end`. `drawnAt` = when the
 * label appears; `highlightFrom` = when the highlight loop may start.
 */
export function arrowTiming(start: number, end: number): { steps: DrawStep[]; drawnAt: number; highlightFrom: number } {
  const drawSec = Math.min(0.5, (end - start) / 3);
  const n = Math.max(1, Math.round(drawSec * ARROW_DRAW_FPS));
  const at = (k: number) => start + (drawSec * k) / n;
  const steps: DrawStep[] = [];
  for (let k = 0; k < n - 1; k++) steps.push({ t0: at(k), t1: at(k + 1), s0: 0, s1: easeOut((k + 1) / n) });
  steps.push({ t0: at(n - 1), t1: end, s0: 0, s1: 1 });
  return { steps, drawnAt: at(n - 1), highlightFrom: start + drawSec + 0.1 };
}

/**
 * The highlight loop's timing from `from` (the arrow has landed) to `end`: drawn
 * (ease in-out), held for a moment, then wiped away from its start (ease in),
 * each squeezed to fit; no steps when there is less than 0.6 s.
 */
export function highlightTiming(from: number, end: number): DrawStep[] {
  const avail = end - from - 0.05;
  if (avail < 0.6) return [];
  const drawSec = Math.min(0.55, avail * 0.3);
  const eraseSec = Math.min(0.45, avail * 0.25);
  const holdSec = Math.max(0, Math.min(0.9, avail - drawSec - eraseSec));
  const nDraw = Math.max(1, Math.round(drawSec * ARROW_DRAW_FPS));
  const nErase = Math.max(1, Math.round(eraseSec * ARROW_DRAW_FPS));
  const drawAt = (k: number) => from + (drawSec * k) / nDraw;
  const steps: DrawStep[] = [];
  for (let k = 0; k < nDraw; k++) steps.push({ t0: drawAt(k), t1: drawAt(k + 1), s0: 0, s1: easeInOut((k + 1) / nDraw) });
  const eraseFrom = from + drawSec + holdSec;
  steps.push({ t0: drawAt(nDraw), t1: eraseFrom, s0: 0, s1: 1 });
  const eraseAt = (k: number) => eraseFrom + (eraseSec * k) / nErase;
  for (let k = 0; k < nErase - 1; k++) steps.push({ t0: eraseAt(k), t1: eraseAt(k + 1), s0: easeIn((k + 1) / nErase), s1: 1 });
  return steps;
}

/** Stroke widths and offsets of the arrow's look, for a given scale (produce.ts uses the same). */
export function arrowStyle(scale: number): {
  /** the loop's line width */
  loopThickness: number;
  /** white halo around the arrow's line / the loop / the label pill */
  halo: number;
  loopHalo: number;
  labelHalo: number;
  /** soft shadow under the arrow and label: offset down, blur radius */
  shadowOffset: number;
  shadowBlur: number;
  /** how far the label rises into place as it fades in (over 0.18 s) */
  labelRise: number;
} {
  return {
    loopThickness: 4 * scale,
    halo: 2.2 * scale,
    loopHalo: 1.6 * scale,
    labelHalo: 1.6 * scale,
    shadowOffset: 3 * scale,
    shadowBlur: 4 * scale,
    labelRise: Math.round(8 * scale),
  };
}

/** Cumulative arc length along a polyline (cum[0] = 0, cum[n-1] = its length). */
export function arcLengths(pts: Pt[]): number[] {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  return cum;
}

/**
 * The visible part of the loop between arc lengths s0 and s1 (px), as the
 * polygons produce.ts fills: short capsules (≤ a quarter of the loop each), so
 * no fill rule can punch a hole where the overshooting loop crosses itself.
 */
export function loopPieces(pts: Pt[], cum: number[], s0: number, s1: number, thickness: number): Pt[][] {
  const total = cum[cum.length - 1];
  if (s1 - s0 < 1) return [];
  const pieces = Math.max(1, Math.ceil((s1 - s0) / (total / 4)));
  const step = (s1 - s0) / pieces;
  return Array.from({ length: pieces }, (_, k) => capsule(polySlice(pts, cum, s0 + k * step, s0 + (k + 1) * step), thickness));
}

// ─── what a preview draws at one moment ──────────────────────────────

/** Everything of one arrow that is on screen at a given time (video px). */
export interface ArrowDrawing {
  /** direction it comes from (the one chosen when `from` was not given) */
  from: ArrowFrom;
  /** size factor (line widths etc. scale with it) */
  scale: number;
  /** centre line drawn so far, tail → current tip */
  line: Pt[];
  /** the chevron at the current tip */
  head: { arms: [Pt, Pt]; tip: Pt };
  /** line width */
  thickness: number;
  /** filled shapes, exactly as rendered: the line, then the two arms of the head */
  polygons: Pt[][];
  /** fraction of the arrow drawn (0..1) */
  progress: number;
  /** 0..1: the arrow (and label) fade out over their last 0.2 s */
  opacity: number;
  /**
   * The label pill, once the arrow is drawn (null: none yet / no text): centred
   * at (cx, cy + rise) — it slides up into place over 0.18 s — in white bold
   * text of `fontSize` px on the arrow's colour; fades in over 0.14 s.
   */
  label: { cx: number; cy: number; width: number; height: number; fontSize: number; rise: number; opacity: number; polygon: Pt[] } | null;
  /** the highlight loop's visible part (polygons, as rendered), or null */
  highlight: { line: Pt[]; polygons: Pt[][] } | null;
  /** widths and offsets of the halo/shadow */
  style: ReturnType<typeof arrowStyle>;
}

/**
 * The arrow (and label, and highlight loop) the renderer draws at time `t`,
 * for an arrow callout shown from `start` to `end`. null outside that window.
 * `rise` is the label's remaining upward slide (px) at `t`.
 */
export function arrowAt(
  opts: {
    /** the element it points at */
    target: Box;
    frame: FrameSize;
    from?: ArrowFrom;
    /** size override (default: from the frame size) */
    scale?: number;
    /** label text (optional) and its font size (default 24) */
    text?: string;
    fontSize?: number;
    /** draw the pencil loop once it lands */
    highlight?: boolean;
    start: number;
    end: number;
  },
  t: number,
): ArrowDrawing | null {
  if (!(t >= opts.start && t < opts.end)) return null;
  const g = arrowGeometry(opts.target, opts.frame, opts.from, opts.scale);
  if (Math.hypot(g.tip[0] - g.tail[0], g.tip[1] - g.tail[1]) < 4) return null;
  const shape = arrowShape(g, [opts.frame.width / 2, opts.frame.height / 2]);
  const timing = arrowTiming(opts.start, opts.end);
  const step = stepAt(timing.steps, t);
  const progress = step ? step.s1 : 1;
  const s = shape.length * progress;
  const line = shape.stroke(s);
  const head = shape.head(s);
  const polygons = [capsule(line, shape.thickness), capsule([head.arms[0], head.tip], shape.thickness), capsule([head.arms[1], head.tip], shape.thickness)];
  const style = arrowStyle(g.scale);
  let label: ArrowDrawing["label"] = null;
  if (opts.text && t >= timing.drawnAt) {
    const b = arrowLabelBox(g, shape, opts.text, opts.fontSize || 24, opts.frame);
    const k = Math.min(1, (t - timing.drawnAt) / 0.18);
    const opacity = Math.max(0, Math.min(1, (t - timing.drawnAt) / 0.14, (opts.end - t) / 0.2));
    label = { cx: b.cx, cy: b.cy, width: b.pw, height: b.ph, fontSize: b.fs, rise: Math.round(style.labelRise * (1 - k)), opacity, polygon: roundedRect(b.cx - b.pw / 2, b.cy - b.ph / 2, b.pw, b.ph, b.ph / 2) };
  }
  let highlight: ArrowDrawing["highlight"] = null;
  if (opts.highlight) {
    const hs = stepAt(highlightTiming(timing.highlightFrom, opts.end), t);
    if (hs) {
      const pts = pencilLoop(opts.target, opts.frame, g.scale);
      const cum = arcLengths(pts);
      const total = cum[cum.length - 1];
      const polys = loopPieces(pts, cum, total * hs.s0, total * hs.s1, style.loopThickness);
      if (polys.length) highlight = { line: polySlice(pts, cum, total * hs.s0, total * hs.s1), polygons: polys };
    }
  }
  const last = timing.steps[timing.steps.length - 1];
  const opacity = t >= last.t0 ? Math.max(0, Math.min(1, (opts.end - t) / 0.2)) : 1;
  return { from: g.from, scale: g.scale, line, head, thickness: shape.thickness, polygons, progress, opacity, label, highlight, style };
}
