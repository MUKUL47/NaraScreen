// ─── fx-camera: a virtual camera that follows the action while the video plays ──
//
// PURE planning + one ffmpeg filter. Targets are the boxes where something
// happens (an act's element, a spotlight / arrow / label) with their windows on
// the FINAL timeline. The plan is a list of "holds" (the camera framing a box
// while the action is there) joined by eased moves:
//
//   - targets close in time (idle gap ≤ 3 s of moving picture; freezes don't
//     count) and in space (their union still fits at ≥ 80 % of the zoom) share
//     one static framing — restrained, no jitter;
//   - the camera arrives as the action begins (ease-in-out, `ease` s), holds
//     `hold` s of moving picture after it, then eases back to the full frame —
//     or moves straight on to the next framing when that starts soon after;
//   - it is back at the full frame by the end of the step, before every
//     freeze-zoom insert (those zoom on their own) and at the end of the video;
//   - a target too big to zoom on (e.g. a spotlight over half the page) asks for
//     the full frame while it is up.
//
// The camera is drawn with ONE `perspective` filter (sub-pixel, cubic): crop
// rects are interpolated per output frame by an expression over the frame index,
// and the filter is switched off (`enable`) wherever the frame is whole.

import type { Box, FrameSize } from "./fx-geometry";

export interface CameraTarget {
  /** final seconds: the camera should frame `rect` from F0 until F1 */
  F0: number;
  F1: number;
  rect: Box;
  /** wanted zoom (e.g. 1.8) */
  scale: number;
  /** targets of different steps never share a framing */
  step: string;
  /** final seconds the step ends at (the camera is back out by then) */
  stepEnd: number;
}

/** A piece of the camera path on the final timeline: `from` → `to` (crop rects, video px), eased; equal = hold. */
export interface CameraSegment {
  T0: number;
  T1: number;
  from: Box;
  to: Box;
}

export interface CameraOptions {
  frame: FrameSize;
  /** seconds per move (default 0.8) */
  ease?: number;
  /** seconds of moving picture the camera stays after the last action (default 1.2) */
  hold?: number;
  /** final video length */
  duration: number;
  /** final-time spans where the camera must be out (freeze-zoom inserts) */
  blocked?: { start: number; end: number }[];
  /** seconds of moving picture in [a, b] (default b − a) */
  active?: (a: number, b: number) => number;
  /** the final time `sec` s of moving picture after T (default T + sec) */
  after?: (T: number, sec: number) => number;
}

export const CAMERA_DEFAULTS = { scale: 1.8, ease: 0.8, hold: 1.2 } as const;
/** Zooms below this are not worth a camera move. */
export const MIN_SCALE = 1.2;
const IDLE_GAP = 3;
const MIN_EASE = 0.35;
/** Easing out and back in needs at least this long at the full frame; otherwise the camera pans straight on. */
const MIN_FULL = 1.5;

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/** Room left around a target inside the framing. */
export function framePad(frame: FrameSize): number {
  return Math.max(24, 0.05 * Math.min(frame.width, frame.height));
}

function padBox([x, y, w, h]: Box, p: number): Box {
  return [x - p, y - p, w + 2 * p, h + 2 * p];
}
function union(a: Box, b: Box): Box {
  const x0 = Math.min(a[0], b[0]);
  const y0 = Math.min(a[1], b[1]);
  return [x0, y0, Math.max(a[0] + a[2], b[0] + b[2]) - x0, Math.max(a[1] + a[3], b[1] + b[3]) - y0];
}

/** The crop that shows `box` (padded already) at up to `scale`, inside the frame; null when the zoom would be < MIN_SCALE. */
export function cropFor(box: Box, scale: number, frame: FrameSize): { rect: Box; scale: number } | null {
  const { width: W, height: H } = frame;
  const fit = Math.min(W / Math.max(1, box[2]), H / Math.max(1, box[3]));
  const s = Math.min(scale, fit);
  if (s < MIN_SCALE) return null;
  const w = W / s;
  const h = H / s;
  const cx = box[0] + box[2] / 2;
  const cy = box[1] + box[3] / 2;
  return { rect: [clamp(cx - w / 2, 0, W - w), clamp(cy - h / 2, 0, H - h), w, h], scale: s };
}

interface Hold {
  a: number; // arrive by
  b: number; // may leave from
  f1: number; // must not leave before (the action is still going on)
  rect: Box | null; // null = the full frame
}

/** Group targets into framings (see the header). */
export function planHolds(targets: CameraTarget[], o: CameraOptions): Hold[] {
  const frame = o.frame;
  const full: Box = [0, 0, frame.width, frame.height];
  const pad = framePad(frame);
  const active = o.active ?? ((a: number, b: number) => b - a);
  const after = o.after ?? ((T: number, s: number) => T + s);
  const hold = o.hold ?? CAMERA_DEFAULTS.hold;
  type Cluster = { F0: number; F1: number; box: Box; want: number; step: string; stepEnd: number; crop: { rect: Box; scale: number } | null };
  const clusters: Cluster[] = [];
  for (const t of [...targets].sort((x, y) => x.F0 - y.F0)) {
    const F1 = Math.max(t.F0, t.F1);
    const box = padBox(t.rect, pad);
    const crop = cropFor(box, t.scale, frame);
    const cur = clusters[clusters.length - 1];
    if (cur && cur.crop && crop && cur.step === t.step && active(cur.F1, t.F0) <= IDLE_GAP) {
      const box2 = union(cur.box, box);
      const want = Math.min(cur.want, t.scale);
      const merged = cropFor(box2, want, frame);
      if (merged && merged.scale >= 0.8 * cur.crop.scale) {
        Object.assign(cur, { F1: Math.max(cur.F1, F1), box: box2, want, crop: merged, stepEnd: Math.max(cur.stepEnd, t.stepEnd) });
        continue;
      }
    }
    if (cur && !cur.crop && !crop && t.F0 <= cur.F1 + 0.5) {
      cur.F1 = Math.max(cur.F1, F1);
      continue;
    }
    clusters.push({ F0: t.F0, F1, box, want: t.scale, step: t.step, stepEnd: t.stepEnd, crop });
  }
  let holds: Hold[] = clusters.map((c) => ({
    a: c.F0,
    f1: c.F1,
    b: c.crop ? Math.max(c.F1, Math.min(after(c.F1, hold), c.stepEnd)) : c.F1,
    rect: c.crop ? c.crop.rect : null,
  }));
  // Freeze-zoom inserts zoom on their own: the camera is out during them.
  for (const blk of o.blocked ?? []) {
    const next: Hold[] = [];
    for (const h of holds) {
      if (!h.rect || h.b <= blk.start || h.a >= blk.end) {
        next.push(h);
        continue;
      }
      if (h.a < blk.start) next.push({ ...h, b: Math.min(h.b, blk.start), f1: Math.min(h.f1, blk.start) });
      if (h.b > blk.end) next.push({ ...h, a: Math.max(h.a, blk.end + (o.ease ?? CAMERA_DEFAULTS.ease)), f1: Math.max(h.f1, blk.end) });
    }
    next.push({ a: blk.start, b: blk.end, f1: blk.end, rect: null });
    holds = next.filter((h) => h.b > h.a - 1e-6 || !h.rect).sort((x, y) => x.a - y.a);
  }
  // Framings nearly the same as the previous one, soon after it: keep the camera still.
  const out: Hold[] = [];
  for (const h of holds) {
    const p = out[out.length - 1];
    if (p && p.rect && h.rect && h.a - p.b < 2 * (o.ease ?? CAMERA_DEFAULTS.ease) && sameFrame(p.rect, h.rect, full)) {
      p.b = Math.max(p.b, h.b);
      p.f1 = Math.max(p.f1, h.f1);
      continue;
    }
    out.push({ ...h });
  }
  return out;
}

function sameFrame(a: Box, b: Box, full: Box): boolean {
  const tol = 0.03 * full[2];
  return a.every((v, i) => Math.abs(v - b[i]) <= tol);
}

/** The camera path: eased moves and holds on the final timeline (identity stretches left out). */
export function planCamera(targets: CameraTarget[], o: CameraOptions): CameraSegment[] {
  const full: Box = [0, 0, o.frame.width, o.frame.height];
  const ease = o.ease ?? CAMERA_DEFAULTS.ease;
  const end = o.duration;
  const holds = planHolds(targets, o);
  const keys: { T: number; rect: Box }[] = [{ T: 0, rect: full }];
  let cur: Box = full;
  let lastT = 0;
  let prev: Hold | null = null;
  const isFull = (r: Box) => r === full;
  /** Move to `to` arriving by `by`; leave no earlier than `from` unless needed to arrive in time
   *  (the next action wins over the previous hold), and not before `floor` when there is room. */
  const move = (to: Box, by: number, from: number, floor: number) => {
    let t0 = Math.max(Math.min(from, by - ease), Math.min(floor, by - ease), lastT);
    let dur = ease;
    if (t0 + dur > by) dur = Math.max(MIN_EASE, by - t0);
    if (t0 + dur > end) {
      t0 = Math.max(lastT, end - dur);
      dur = Math.max(0, end - t0);
    }
    if (dur < 1 / 60) return false;
    keys.push({ T: t0, rect: cur }, { T: t0 + dur, rect: to });
    cur = to;
    lastT = t0 + dur;
    return true;
  };
  for (const h of holds) {
    if (h.a >= end) break;
    const to = h.rect ?? full;
    if (isFull(to)) {
      if (!isFull(cur)) move(full, h.a, prev ? prev.b : lastT, prev ? prev.f1 : lastT);
      lastT = Math.max(lastT, h.b);
      prev = h;
      continue;
    }
    if (!isFull(cur) && prev) {
      // Moving on from another framing: straight there when it starts soon, else out and back in.
      if (h.a - prev.b < 2 * ease + MIN_FULL) {
        move(to, h.a, prev.b, prev.f1);
      } else {
        move(full, prev.b + ease, prev.b, prev.f1);
        move(to, h.a, h.a - ease, lastT);
      }
    } else {
      move(to, h.a, h.a - ease, lastT);
    }
    prev = h;
  }
  if (!isFull(cur) && prev) move(full, Math.min(end, prev.b + ease), prev.b, prev.f1);
  keys.push({ T: Math.max(lastT, end), rect: cur });
  const segs: CameraSegment[] = [];
  for (let i = 0; i + 1 < keys.length; i++) {
    const [k0, k1] = [keys[i], keys[i + 1]];
    if (k1.T - k0.T < 1e-6 || (isFull(k0.rect) && isFull(k1.rect))) continue;
    segs.push({ T0: k0.T, T1: Math.min(k1.T, end), from: k0.rect, to: k1.rect });
  }
  return segs.filter((s) => s.T1 > s.T0 + 1e-6);
}

/** The crop rect at final time T (for tests and previews). */
export function cameraAt(segs: CameraSegment[], T: number, frame: FrameSize): Box {
  const s = segs.find((x) => T >= x.T0 && T < x.T1);
  if (!s) return [0, 0, frame.width, frame.height];
  const u = clamp((T - s.T0) / (s.T1 - s.T0), 0, 1);
  const e = u * u * u * (u * (u * 6 - 15) + 10);
  return s.from.map((v, i) => v + (s.to[i] - v) * e) as Box;
}

const n3 = (v: number) => (Math.round(v * 1000) / 1000).toString();

/**
 * The camera as one `perspective` filter from [inLabel] (null when the path is
 * empty). Its expressions see the frame counter `in`; `inAtFrame0` is the value
 * this ffmpeg gives it on the first frame (1 in ffmpeg 6 — probed by the caller,
 * see fx-motion.ts). Segment edges are whole frames; `enable` windows sit
 * between frames.
 */
export function cameraGraph(segs: CameraSegment[], fps: number, inLabel: string, outLabel = "camera", inAtFrame0 = 1): { graph: string[]; out: string } | null {
  const pieces = segs
    .map((s) => ({ k0: Math.round(s.T0 * fps), k1: Math.round(s.T1 * fps), s }))
    .filter((p) => p.k1 > p.k0)
    .sort((a, b) => a.k0 - b.k0);
  if (!pieces.length) return null;
  // Windows: runs of touching pieces.
  const wins: [number, number][] = [];
  for (const p of pieces) {
    const w = wins[wins.length - 1];
    if (w && p.k0 <= w[1]) w[1] = Math.max(w[1], p.k1);
    else wins.push([p.k0, p.k1]);
  }
  const enable = wins.map(([a, b]) => `between(t,${n3((a - 0.5) / fps)},${n3((b - 0.5) / fps)})`).join("+");
  const corner = (r: Box, c: number): number => {
    const [x, y, w, h] = r;
    return [x, y, x + w, y, x, y + h, x + w, y + h][c];
  };
  const leaf = (p: (typeof pieces)[number], c: number) => {
    const a = corner(p.s.from, c);
    const b = corner(p.s.to, c) - a;
    if (Math.abs(b) < 1e-3) return n3(a);
    // `;` sequences (operand order of * is unspecified): u → smootherstep(u).
    return `(st(2,clip((ld(3)-${p.k0})/${p.k1 - p.k0},0,1));${n3(a)}+${n3(b)}*ld(2)*ld(2)*ld(2)*(ld(2)*(ld(2)*6-15)+10))`;
  };
  const tree = (lo: number, hi: number, c: number): string => {
    if (lo === hi) return leaf(pieces[lo], c);
    const mid = (lo + hi + 1) >> 1;
    return `if(lt(ld(3),${pieces[mid].k0}),${tree(lo, mid - 1, c)},${tree(mid, hi, c)})`;
  };
  // The output frame index, in register 3.
  const head = `st(3,in-${inAtFrame0});`;
  const names = ["x0", "y0", "x1", "y1", "x2", "y2", "x3", "y3"];
  const opts = names.map((nm, c) => `${nm}='${head}${tree(0, pieces.length - 1, c)}'`).join(":");
  return {
    graph: [`[${inLabel}]perspective=${opts}:interpolation=cubic:sense=source:eval=frame:enable='${enable}'[${outLabel}]`],
    out: outLabel,
  };
}
