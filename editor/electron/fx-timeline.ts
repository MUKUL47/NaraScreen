// ─── fx-timeline: which recording moment each frame of the final video shows ──
//
// PURE (no Node, no ffmpeg). The renderer changes time in three passes — skips
// cut, speed ramps retime, inserts (freeze / zoom / talk-over narration) stretch —
// and draws overlays on the FINISHED timeline. Things that follow the recording
// continuously (the cursor, the follow camera) need both directions:
//   toFinal(r):  recording seconds → final seconds (the overlays' remap), and
//   at(T):       final seconds → the recording moment on screen, whether it is
//                frozen, and the zoom a freeze-zoom insert applies to it.
// The insert pass reports its segments (`LayoutSeg`, post-skip/speed seconds);
// skip and speed ranges come from the same arrays the renderer cut with.

import type { Box, FrameSize } from "./fx-geometry";

/** How one freeze-zoom clip transforms its frame (zoompan, see produce.ts buildSingleZoom). */
export interface ZoomPhase {
  rect: Box;
  /** zoom at the hold */
  maxZ: number;
  /** frames of zoom-in / zoom-out (the ease is over frames - 1 steps) */
  frames: number;
  phase: "in" | "hold" | "out";
}

/** What one clip of the insert pass shows (times in post-skip/speed seconds). */
export interface SegMeta {
  /** play: source from `src` on (held at `until` if the clip is longer); freeze: the frame at `src`; zoom: that frame, zoomed */
  kind: "play" | "freeze" | "zoom";
  src: number;
  until?: number;
  zoom?: ZoomPhase;
}

/** A clip of the insert pass placed on the final timeline. */
export interface LayoutSeg extends SegMeta {
  start: number;
  dur: number;
}

/** A point p shows on screen at (p - [ox, oy]) * s. */
export interface ViewTransform {
  s: number;
  ox: number;
  oy: number;
}

export interface FrameSource {
  /** recording seconds on screen */
  r: number;
  /** a freeze (or freeze-zoom) insert: the picture stands still */
  frozen: boolean;
  /** set during a freeze-zoom insert */
  zoom?: ViewTransform;
}

export interface TimeMap {
  toFinal(r: number): number;
  at(T: number): FrameSource;
  /** final-time spans where the picture is frozen (zoom: a freeze-zoom insert) */
  frozen: { start: number; end: number; zoom: boolean }[];
}

type Range = { start: number; end: number };

/** post-skip seconds → recording seconds (a cut point shows the first frame after the cut). */
export function unskip(s: number, skips: Range[]): number {
  let r = s;
  let removed = 0;
  for (const k of [...skips].sort((a, b) => a.start - b.start)) {
    const at = k.start - removed; // where this cut sits in post-skip seconds
    if (s >= at - 1e-9) {
      r += k.end - k.start;
      removed += k.end - k.start;
    } else break;
  }
  return r;
}

/** post-speed seconds → post-skip seconds (ranges in post-skip seconds, like produce.ts). */
export function unspeed(m: number, ranges: (Range & { factor: number })[]): number {
  let out = 0; // post-speed position of `cur`
  let cur = 0;
  for (const r of [...ranges].sort((a, b) => a.start - b.start)) {
    const plain = r.start - cur;
    if (m <= out + plain) return cur + (m - out);
    out += plain;
    const sped = (r.end - r.start) / r.factor;
    if (m <= out + sped) return r.start + (m - out) * r.factor;
    out += sped;
    cur = r.end;
  }
  return cur + (m - out);
}

const smooth = (u: number) => u * u * (3 - 2 * u);

/** The zoompan transform of frame `n` of a freeze-zoom clip (mirrors buildSingleZoom). */
export function zoomTransform(z: ZoomPhase, n: number, frame: FrameSize): ViewTransform {
  const N = Math.max(1, z.frames - 1);
  const u = Math.min(1, Math.max(0, n / N));
  const zoom = z.phase === "hold" ? z.maxZ : z.phase === "in" ? 1 + (z.maxZ - 1) * smooth(u) : 1 + (z.maxZ - 1) * (1 - smooth(u));
  const [zx, zy, zw, zh] = z.rect;
  const w = frame.width / zoom;
  const h = frame.height / zoom;
  const ox = Math.floor(Math.min(Math.max(zx + zw / 2 - w / 2, 0), frame.width - w));
  const oy = Math.floor(Math.min(Math.max(zy + zh / 2 - h / 2, 0), frame.height - h));
  return { s: zoom, ox, oy };
}

/**
 * The final-timeline ↔ recording map. `layout` = the insert pass's clips (none:
 * the post-skip/speed video is the final one); `trimOffset` = the recording
 * seconds a trim cut off the front (action times were shifted by it).
 */
export function buildTimeMap(o: {
  toFinal: (r: number) => number;
  layout?: LayoutSeg[];
  skips: Range[];
  speeds: (Range & { factor: number })[];
  trimOffset?: number;
  frame: FrameSize;
  fps?: number;
}): TimeMap {
  const fps = o.fps ?? 30;
  const trim = o.trimOffset ?? 0;
  const toRecording = (m: number) => unskip(unspeed(m, o.speeds), o.skips) + trim;
  const layout = o.layout?.length ? [...o.layout].sort((a, b) => a.start - b.start) : undefined;
  const at = (T: number): FrameSource => {
    if (!layout) return { r: toRecording(Math.max(0, T)), frozen: false };
    let seg = layout[0];
    for (const s of layout) {
      if (s.start <= T + 1e-9) seg = s;
      else break;
    }
    const into = Math.max(0, T - seg.start);
    if (seg.kind === "play") {
      const m = Math.min(seg.src + into, seg.until ?? Infinity);
      return { r: toRecording(m), frozen: false };
    }
    const r = toRecording(seg.src);
    if (seg.kind === "zoom" && seg.zoom) {
      const n = Math.min(Math.round(into * fps), Math.max(0, Math.round(seg.dur * fps) - 1));
      return { r, frozen: true, zoom: zoomTransform(seg.zoom, n, o.frame) };
    }
    return { r, frozen: true };
  };
  const frozen = (layout ?? [])
    .filter((s) => s.kind !== "play")
    .map((s) => ({ start: s.start, end: s.start + s.dur, zoom: s.kind === "zoom" }));
  return { toFinal: (r) => o.toFinal(r - trim), at, frozen };
}

/** Seconds of [a, b] (final) during which the picture moves (frozen spans left out). */
export function activeSeconds(map: Pick<TimeMap, "frozen">, a: number, b: number): number {
  if (b <= a) return 0;
  let f = 0;
  for (const s of map.frozen) f += Math.max(0, Math.min(b, s.end) - Math.max(a, s.start));
  return b - a - f;
}

/** The final time `sec` seconds of moving picture after T (frozen spans don't count). */
export function afterActive(map: Pick<TimeMap, "frozen">, T: number, sec: number): number {
  let t = T;
  let left = sec;
  const spans = [...map.frozen].sort((a, b) => a.start - b.start);
  for (const s of spans) {
    if (s.end <= t) continue;
    if (s.start >= t + left) break;
    left -= Math.max(0, s.start - t);
    t = s.end;
  }
  return t + left;
}

/**
 * The zoom clips of one freeze-zoom insert, in the order buildZoomInsert makes
 * them: per target, zoom-in, hold, zoom-out.
 */
export function zoomClipMeta(
  action: { zoomTargets?: { rect: Box }[]; zoomRects?: Box[]; zoomRect?: Box; zoomDuration?: number },
  src: number,
  frame: FrameSize,
): SegMeta[] {
  const rects: Box[] = action.zoomTargets?.length
    ? action.zoomTargets.map((t) => t.rect)
    : action.zoomRects?.length
      ? action.zoomRects
      : action.zoomRect
        ? [action.zoomRect]
        : [];
  const frames = Math.max(Math.round(30 * (action.zoomDuration ?? 1)), 2);
  return rects.flatMap((rect) => {
    const maxZ = Math.min(frame.width / rect[2], frame.height / rect[3]);
    return (["in", "hold", "out"] as const).map((phase) => ({ kind: "zoom" as const, src, zoom: { rect, maxZ, frames, phase } }));
  });
}
