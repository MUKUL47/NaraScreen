// ─── fx-motion: cursor + follow camera for produce.ts's final pass ───
//
// The one place produce.ts calls for both features (keeps the shared final-graph
// code to a call site). Reads the project's optional `cursor` and `camera`
// fields (written by the headless layer, api/cursor-trace.ts; the desktop app
// writes neither, so its renders are unchanged) and returns:
//   - cursorLines: page-space ASS events (drawn BEFORE the camera);
//   - camera(label): the camera filter, applied between the page-space and the
//     screen-space ASS passes (null when there is no camera).

import { spawnSync } from "child_process";
import { FFMPEG_PATH } from "./bin-paths";
import { CAMERA_DEFAULTS, cameraGraph, planCamera, type CameraSegment, type CameraTarget } from "./fx-camera";
import { cursorEvents, type CursorStyle, type CursorTrack } from "./fx-cursor";
import { arrowGeometry, type ArrowFrom, type Box, type FrameSize } from "./fx-geometry";
import { activeSeconds, afterActive, type TimeMap } from "./fx-timeline";

/** project.cursor (recording seconds). */
export interface ProjectCursor extends CursorStyle {
  track: CursorTrack;
}

/** project.camera (recording seconds). */
export interface ProjectCamera {
  scale?: number;
  ease?: number;
  hold?: number;
  /** each step's window and whether the camera follows in it */
  steps: { id: string; start: number; end: number; follow: boolean; scale?: number }[];
  /** where the acts happened */
  targets: { t0: number; t1: number; rect: Box; step: string }[];
}

/** The overlay fields the camera looks at (final-timeline timestamps). */
interface OverlayLike {
  type: string;
  timestamp: number;
  source?: { step: string };
  spotlightRects?: Box[];
  spotlightDuration?: number;
  calloutStyle?: string;
  calloutDuration?: number;
  calloutPanels?: { text: string; rect: Box; fontSize: number }[];
  arrowFrom?: string;
  arrowScale?: number;
}

export interface Motion {
  cursorLines: string[];
  camera: (inLabel: string) => { graph: string[]; out: string } | null;
  segments: CameraSegment[];
}

let inOffset: number | undefined;
/** The value ffmpeg's `perspective` gives `in` on the first frame (1 in ffmpeg 6). Probed once. */
export function perspectiveInAtFrame0(): number {
  if (inOffset != null) return inOffset;
  const r = spawnSync(
    FFMPEG_PATH,
    ["-v", "error", "-f", "lavfi", "-i", "nullsrc=s=256x2:r=30:d=0.04,format=gray,geq=lum='X'", "-vf",
      "perspective=x0='in*8+0.5':x2='in*8+0.5':x1='in*8+64':x3='in*8+64':eval=frame", "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "gray", "-"],
    { encoding: "buffer" },
  );
  // Column 0 shows source column 8·in (+ half a pixel against interpolation rounding).
  inOffset = r.status === 0 && r.stdout.length >= 1 ? Math.round(r.stdout[0] / 8) : 1;
  return inOffset;
}

function union(boxes: Box[]): Box {
  const x0 = Math.min(...boxes.map((b) => b[0]));
  const y0 = Math.min(...boxes.map((b) => b[1]));
  const x1 = Math.max(...boxes.map((b) => b[0] + b[2]));
  const y1 = Math.max(...boxes.map((b) => b[1] + b[3]));
  return [x0, y0, x1 - x0, y1 - y0];
}

/** Where an overlay draws on the page (null: none, or screen-space). */
export function overlayBox(a: OverlayLike, frame: FrameSize): Box | null {
  if (a.type === "spotlight" && a.spotlightRects?.length) return union(a.spotlightRects);
  const panel = a.calloutPanels?.[0];
  if (a.type !== "callout" || !panel) return null;
  if (a.calloutStyle === "arrow") {
    const g = arrowGeometry(panel.rect, frame, a.arrowFrom as ArrowFrom | undefined, a.arrowScale);
    const tail: Box = [g.tail[0] - 40 * g.scale, g.tail[1] - 20 * g.scale, 80 * g.scale, 40 * g.scale];
    return union([panel.rect, tail]);
  }
  if (a.calloutStyle === "lower-third") return null;
  // fx highlight (fx-highlight.ts): its panels are the marked elements.
  if (a.calloutStyle === "highlight") return union(a.calloutPanels!.map((p) => p.rect));
  // A label's box: text + padding, and a strip of the element it sits next to.
  const [x, y, w] = panel.rect;
  const hh = panel.fontSize * 1.25;
  return [x - 12, y - hh * 0.6, Math.max(w, 40) + 24, hh * 2.2];
}

export function planMotion(inp: {
  project: Record<string, unknown>;
  frame: FrameSize;
  fps: number;
  duration: number;
  map: TimeMap;
  /** spotlights and callouts, timestamps already on the final timeline */
  overlays: OverlayLike[];
  emit: (msg: string) => void;
}): Motion {
  const { frame, fps, duration, map, emit } = inp;
  const cur = inp.project.cursor as ProjectCursor | undefined;
  let cursorLines: string[] = [];
  if (cur?.track?.moves?.length) {
    cursorLines = cursorEvents(cur.track, cur, frame, (T) => map.at(T), duration, fps);
    emit(`\n[Overlay: cursor] ${cur.track.moves.length} move(s), ${cur.track.clicks.length} click(s)`);
  }

  const cam = inp.project.camera as ProjectCamera | undefined;
  let segments: CameraSegment[] = [];
  if (cam?.steps?.some((s) => s.follow)) {
    const stepOf = new Map(cam.steps.map((s) => [s.id, s]));
    const base = cam.scale ?? CAMERA_DEFAULTS.scale;
    const stepEnd = (id: string) => {
      const s = stepOf.get(id);
      return s ? map.toFinal(s.end) : duration;
    };
    const follows = (id: string) => stepOf.get(id)?.follow ?? cam.steps.every((s) => s.follow);
    const targets: CameraTarget[] = [];
    for (const t of cam.targets ?? []) {
      if (!follows(t.step)) continue;
      targets.push({ F0: map.toFinal(t.t0), F1: map.toFinal(t.t1), rect: t.rect, scale: stepOf.get(t.step)?.scale ?? base, step: t.step, stepEnd: stepEnd(t.step) });
    }
    for (const a of inp.overlays) {
      const step = a.source?.step ?? "";
      if (!follows(step)) continue;
      const box = overlayBox(a, frame);
      if (!box) continue;
      const len = a.type === "spotlight" ? a.spotlightDuration ?? 3 : a.calloutDuration ?? 3;
      // An overlay draws the camera within its own step; the next step's action takes over.
      const F1 = Math.max(a.timestamp, Math.min(duration, a.timestamp + len, stepEnd(step)));
      targets.push({ F0: a.timestamp, F1, rect: box, scale: stepOf.get(step)?.scale ?? base, step, stepEnd: stepEnd(step) });
    }
    // Freeze-zoom inserts: in/hold/out clips of one insert touch — one blocked span each.
    const blocked: { start: number; end: number }[] = [];
    for (const f of map.frozen.filter((x) => x.zoom).sort((a, b) => a.start - b.start)) {
      const last = blocked[blocked.length - 1];
      if (last && f.start <= last.end + 0.05) last.end = Math.max(last.end, f.end);
      else blocked.push({ start: f.start, end: f.end });
    }
    segments = planCamera(targets, {
      frame,
      duration,
      ease: cam.ease,
      hold: cam.hold,
      blocked,
      active: (a, b) => activeSeconds(map, a, b),
      after: (T, s) => afterActive(map, T, s),
    });
    const moves = segments.filter((s) => s.from !== s.to).length;
    emit(`\n[Camera] follow: ${targets.length} target(s) → ${moves} move(s)`);
    for (const s of segments) {
      if (s.from === s.to) continue;
      const z = frame.width / s.to[2];
      emit(`  ${s.T0.toFixed(2)}s–${s.T1.toFixed(2)}s → ${z < 1.01 ? "full frame" : `${z.toFixed(2)}× at [${s.to.map((v) => Math.round(v)).join(", ")}]`}`);
    }
  }
  return {
    cursorLines,
    segments,
    camera: (inLabel) => (segments.length ? cameraGraph(segments, fps, inLabel, "camera", perspectiveInAtFrame0()) : null),
  };
}
