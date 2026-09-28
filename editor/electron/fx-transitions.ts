// ─── fx-transitions: fade / slide between steps (pages) ──────────────
//
// A step with `transition` compiles to { type: "transition", timestamp,
// transitionEnd, transitionStyle, transitionDuration }: a window of the
// RECORDING (the step's start → shortly after its first act) in which its page
// change happens. The renderer maps that window onto the main video's final
// timeline (the overlays' remap), finds the page change in the pixels, and
// covers it with the last frame BEFORE the change:
//
//   c0 … c1   the frames that change (navigation, a loading flash, the new page
//             painting in — up to 1.5 s): the old frame stays fully on top;
//   c1 … c1+d the old frame fades out (fade) or slides away to the left
//             (slide), uncovering the live new page underneath.
//
// Nothing is cut or inserted: every later timestamp, the audio and every
// overlay/subtitle stay exactly where they were. The old frame is drawn at the
// START of the final graph (before spotlights and the ASS passes), so effects
// and subtitles on the new page draw over it and stay in sync. It is a
// `movie=` source inside the graph (no extra -i input), so the final pass's
// input numbering is untouched.
//
// No page change found in the window (the step starts on the same page) → no
// transition, and the log says so.

import { spawnSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { FFMPEG_PATH } from "./bin-paths";

export type TransitionStyle = "fade" | "slide";
export const TRANSITION_DEFAULT_SEC = 0.4;

/** What the renderer reads from a transition action. */
export interface TransitionAction {
  type: string;
  timestamp: number;
  transitionEnd?: number;
  transitionStyle?: string;
  transitionDuration?: number;
}

/** Analysis frames: small grey frames at a fixed rate. */
const FPS = 30;
const AW = 160;
const AH = 90;
/** Mean abs difference (0–255) between consecutive analysis frames that counts as a page change. */
export const CHANGE_MIN = 3;
/** Longest window analysed (final seconds) and longest change covered. */
const MAX_WINDOW_SEC = 8;
const MAX_CHANGE_SEC = 1.5;
/** Frames of quiet that end a change. */
const QUIET_FRAMES = 9;

/**
 * The page change in a run of frame differences (diffs[i] = frame i vs i−1):
 * around the biggest jump, every frame that changes by ≥ max(1.5, 25 % of it)
 * with gaps shorter than QUIET_FRAMES, at most MAX_CHANGE_SEC long.
 * Returns the first and last CHANGED frame indexes, or null when the biggest
 * jump is below CHANGE_MIN (no page change). PURE; exported for tests.
 */
export function findChange(diffs: number[], fps = FPS): { first: number; last: number; peak: number } | null {
  let m = -1;
  for (let i = 1; i < diffs.length; i++) if (m < 0 || diffs[i] > diffs[m]) m = i;
  if (m < 0 || diffs[m] < CHANGE_MIN) return null;
  const thr = Math.max(1.5, diffs[m] * 0.25);
  let first = m;
  for (let j = m - 1; j >= 1 && first - j <= QUIET_FRAMES; j--) if (diffs[j] >= thr) first = j;
  let last = m;
  for (let j = m + 1; j < diffs.length && j - last <= QUIET_FRAMES; j++) if (diffs[j] >= thr) last = j;
  const maxLen = Math.round(MAX_CHANGE_SEC * fps);
  if (last - first > maxLen) {
    // keep the part around the peak
    first = Math.max(first, Math.min(m, last - maxLen));
    last = first + maxLen;
  }
  return { first, last, peak: diffs[m] };
}

function decodeArgs(video: string, from: number, len: number): string[] {
  return ["-ss", Math.max(0, from).toFixed(3), "-t", len.toFixed(3), "-i", video];
}

/** Mean abs difference between consecutive small grey frames of [from, from+len). */
export function frameDiffs(video: string, from: number, len: number): number[] {
  const r = spawnSync(
    FFMPEG_PATH,
    ["-v", "error", ...decodeArgs(video, from, len), "-vf", `fps=${FPS},scale=${AW}:${AH}:flags=area,format=gray`, "-f", "rawvideo", "-"],
    { maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "ignore"] },
  );
  const buf = r.stdout;
  if (r.status !== 0 || !buf?.length) return [];
  const size = AW * AH;
  const n = Math.floor(buf.length / size);
  const diffs = [0];
  for (let i = 1; i < n; i++) {
    let sum = 0;
    const a = (i - 1) * size;
    const b = i * size;
    for (let k = 0; k < size; k++) sum += Math.abs(buf[b + k] - buf[a + k]);
    diffs.push(sum / size);
  }
  return diffs;
}

/** Frame `k` of the same decode as frameDiffs, full size, as a PNG. */
function extractAnalysisFrame(video: string, from: number, len: number, k: number, out: string): boolean {
  spawnSync(FFMPEG_PATH, ["-y", "-v", "error", ...decodeArgs(video, from, len), "-vf", `fps=${FPS},select=eq(n\\,${k})`, "-frames:v", "1", out], {
    stdio: ["ignore", "ignore", "ignore"],
  });
  return fs.existsSync(out) && fs.statSync(out).size > 0;
}

/** A planned transition on the main video's final timeline. */
export interface TransitionCut {
  style: TransitionStyle;
  duration: number;
  /** the old frame covers the video from `cover` … */
  cover: number;
  /** … fully until `settle`, then fades/slides away over `duration` */
  settle: number;
  /** PNG of the old frame (file name inside the ffmpeg working dir) */
  image: string;
}

/**
 * Filters drawing the transitions over [inLabel] (PURE; exported for tests).
 * Each old frame is a looped `movie=` still shifted to its time, faded (alpha)
 * or slid out, and overlaid with eof_action=pass — frames outside its window
 * pass through untouched.
 */
export function transitionGraph(cuts: TransitionCut[], inLabel: string): { graph: string[]; out: string } {
  const graph: string[] = [];
  let last = inLabel;
  cuts.forEach((c, i) => {
    const frames = Math.max(2, Math.ceil((c.settle + c.duration - c.cover) * FPS) + 1);
    const d = c.duration.toFixed(3);
    const s = c.settle.toFixed(3);
    const still = [
      `movie=${c.image}`,
      "format=yuva420p",
      `loop=loop=${frames - 1}:size=1:start=0`,
      `setpts=N/(${FPS}*TB)+${c.cover.toFixed(3)}/TB`,
      ...(c.style === "fade" ? [`fade=t=out:st=${s}:d=${d}:alpha=1`] : []),
    ].join(",");
    graph.push(`${still}[trs${i}]`);
    // slide: eased (smoothstep) from x = 0 to x = −W once the new page has settled
    const x = c.style === "slide" ? `'if(lt(t,${s}),0,-W*(min(1,(t-${s})/${d})*min(1,(t-${s})/${d})*(3-2*min(1,(t-${s})/${d}))))'` : "0";
    const o = `trv${i}`;
    graph.push(`[${last}][trs${i}]overlay=x=${x}:y=0:eof_action=pass:eval=frame[${o}]`);
    last = o;
  });
  return { graph, out: last };
}

/**
 * Plan every transition (detect the change, grab the old frame into `tempDir`)
 * and return the filters for the final graph. `finalAt` maps recording seconds
 * to the main video's final timeline; `video` is the main video as it enters
 * the final pass; `inLabel` the graph label to draw on.
 */
export function prepareTransitions(opts: {
  actions: TransitionAction[];
  finalAt: (ts: number) => number;
  video: string;
  videoSec: number;
  tempDir: string;
  inLabel: string;
  emit: (msg: string) => void;
}): { graph: string[]; out: string; cuts: TransitionCut[] } {
  const list = opts.actions.filter((a) => a.type === "transition" && (a.transitionStyle === "fade" || a.transitionStyle === "slide"));
  if (!list.length) return { graph: [], out: opts.inLabel, cuts: [] };
  opts.emit(`\n[Transitions] ${list.length} step transition(s)`);
  const cuts: TransitionCut[] = [];
  let busyUntil = -1;
  list
    .map((a) => ({ a, from: opts.finalAt(a.timestamp), to: opts.finalAt(a.transitionEnd ?? a.timestamp + 3) }))
    .sort((x, y) => x.from - y.from)
    .forEach(({ a, from, to }, i) => {
      const start = Math.max(0, from, busyUntil);
      const len = Math.min(MAX_WINDOW_SEC, Math.max(0, Math.min(to, opts.videoSec) - start));
      if (len < 0.2) return;
      const diffs = frameDiffs(opts.video, start, len);
      const ch = findChange(diffs);
      if (!ch) {
        opts.emit(`  ${a.transitionStyle} at ${from.toFixed(1)}s: no page change in ${start.toFixed(1)}s-${(start + len).toFixed(1)}s, left out`);
        return;
      }
      const image = `tr_${i}.png`;
      if (!extractAnalysisFrame(opts.video, start, len, ch.first - 1, path.join(opts.tempDir, image))) {
        opts.emit(`  Warning: transition at ${from.toFixed(1)}s: could not grab the frame before the change, left out`);
        return;
      }
      const duration = Math.max(0.1, Math.min(2, a.transitionDuration ?? TRANSITION_DEFAULT_SEC));
      // One frame of margin on each side: the analysis decode can be a frame off the final one.
      const cover = start + Math.max(0, ch.first - 2) / FPS;
      const settle = Math.min(opts.videoSec, start + (ch.last + 1) / FPS);
      const style = a.transitionStyle as TransitionStyle;
      cuts.push({ style, duration, cover, settle, image });
      busyUntil = settle + duration;
      opts.emit(`  ${style} ${duration.toFixed(2)}s: page changes ${(start + ch.first / FPS).toFixed(2)}s-${(start + ch.last / FPS).toFixed(2)}s (peak ${ch.peak.toFixed(1)})`);
    });
  const g = transitionGraph(cuts, opts.inLabel);
  return { ...g, cuts };
}
