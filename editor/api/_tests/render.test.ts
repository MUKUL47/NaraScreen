// Run: node_modules/.bin/tsx --test api/_tests/render.test.ts
//
// Renderer regressions (electron/produce.ts) on small synthetic videos: no
// browser and no speech engine, only ffmpeg. The sources write each frame's own
// number as 9 black/white blocks along the top, so a test can read which source
// frame the finished video shows at any moment; narrations are generated tones
// given as recorded audio. Work dir: api/_tests/.tmp/render-<time>-<pid>/
// (removed at the end unless NARASCREEN_KEEP_TMP=1).

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { FFMPEG_PATH } from "../../electron/bin-paths.ts";
import { ffmpegSync, probeDuration, probeResolution } from "../../electron/ffmpeg.ts";
import { blurGeometry, produceTimelineVideo } from "../../electron/produce.ts";
import { compile } from "../compiler.ts";
import type { DemoScript, NaraAction, TraceEntry } from "../types.ts";

const TMP = path.join(__dirname, ".tmp", `render-${Date.now()}-${process.pid}`);
const FPS = 30;
const W = 640;
const H = 360;

type Rect = [number, number, number, number];

// ─── sources ─────────────────────────────────────────────────────────

/** W×H grey video whose frame N shows N in binary (9 blocks at the top). */
function numbered(name: string, seconds: number, withAudio = false): string {
  const file = path.join(TMP, name);
  if (fs.existsSync(file)) return file;
  const bit = (k: number) => `if(between(X,${k * 64 + 8},${k * 64 + 56})*between(Y,8,52),if(mod(floor(N/${2 ** k}),2),235,16),`;
  const lum = Array.from({ length: 9 }, (_, k) => bit(k)).join("") + "128" + ")".repeat(9);
  const args = ["-y", "-f", "lavfi", "-i", `color=c=gray:s=${W}x${H}:r=${FPS}:d=${seconds}`];
  if (withAudio) args.push("-f", "lavfi", "-i", `sine=frequency=330:sample_rate=44100:duration=${seconds}`);
  args.push("-vf", `geq=lum='${lum}':cb=128:cr=128`, "-c:v", "libx264", "-preset", "ultrafast", "-crf", "10", "-pix_fmt", "yuv420p");
  if (withAudio) args.push("-c:a", "aac", "-shortest");
  args.push(file);
  assert.equal(ffmpegSync(args).status, 0, `could not generate ${file}`);
  return file;
}

/** A tone (a stand-in for a narration clip), or silence when freq = 0. */
function tone(name: string, seconds: number, freq = 440): string {
  const file = path.join(TMP, name);
  if (fs.existsSync(file)) return file;
  const src = freq ? `sine=frequency=${freq}:sample_rate=24000:duration=${seconds}` : `anullsrc=r=24000:cl=mono`;
  const args = ["-y", "-f", "lavfi", "-i", src, ...(freq ? [] : ["-t", String(seconds)]), file];
  assert.equal(ffmpegSync(args).status, 0, `could not generate ${file}`);
  return file;
}

/** Render `actions` over `recording` with the real renderer; returns the video. */
async function render(name: string, recording: string, actions: unknown[], project: Record<string, unknown> = {}): Promise<string> {
  const dir = path.join(TMP, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "demo-project.json"), JSON.stringify({ recordingPath: recording, tts: {}, actions, ...project }));
  const log: string[] = [];
  const video = await produceTimelineVideo(dir, (m) => log.push(m), "t", undefined, undefined, 18);
  fs.writeFileSync(path.join(dir, "produce.log"), log.join("\n"));
  assert.ok(fs.existsSync(video) && fs.statSync(video).size > 0, `no video from ${name}:\n${log.join("\n")}`);
  const skipped = log.filter((l) => /produced no output/i.test(l));
  assert.deepEqual(skipped, [], `${name}: a renderer pass failed`);
  return video;
}

// ─── reading the result ──────────────────────────────────────────────

/** ffmpeg with room for raw frames/audio on stdout (spawnSync's default buffer is 1 MB). */
function ffRead(args: string[]): Buffer {
  const r = spawnSync(FFMPEG_PATH, ["-v", "error", ...args], { maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] });
  assert.equal(r.status, 0, `ffmpeg ${args.join(" ")} failed`);
  return r.stdout;
}

/** One frame as rgb24: the first frame at or after t (ffmpeg's -ss). */
function frame(video: string, t: number): { w: number; h: number; px: Buffer } {
  const r = { status: 0, stdout: ffRead(["-ss", t.toFixed(3), "-i", video, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]) };
  assert.equal(r.status, 0, `could not read a frame at ${t}s of ${video}`);
  const { width } = probeResolution(video);
  return { w: width, h: r.stdout.length / 3 / width, px: r.stdout };
}

/** The source frame number a video shows at t. */
function frameNo(video: string, t: number): number {
  const { w, px } = frame(video, t);
  let n = 0;
  for (let k = 0; k < 9; k++) {
    const i = (30 * w + k * 64 + 32) * 3;
    if (px[i + 1] > 128) n += 2 ** k;
  }
  return n;
}

/** Mean colour and the largest distance from it, inside a rect of one frame. */
function regionStats(f: { w: number; px: Buffer }, [x, y, w, h]: Rect) {
  let n = 0;
  const sum = [0, 0, 0];
  for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) {
    const i = (yy * f.w + xx) * 3;
    for (let c = 0; c < 3; c++) sum[c] += f.px[i + c];
    n++;
  }
  const mean = sum.map((s) => s / n);
  let spread = 0;
  let tint = 0;
  for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) {
    const i = (yy * f.w + xx) * 3;
    const [r, g, b] = [f.px[i], f.px[i + 1], f.px[i + 2]];
    spread = Math.max(spread, Math.abs(g - mean[1]));
    tint = Math.max(tint, Math.abs(r - g) + Math.abs(b - g));
  }
  return { mean, spread, tint };
}

/** Pixels darker than `below` (luma) in a rect of one frame. */
function darkPixels(f: { w: number; px: Buffer }, [x, y, w, h]: Rect, below = 80): number {
  let n = 0;
  for (let yy = Math.max(0, y); yy < y + h; yy++) for (let xx = Math.max(0, x); xx < x + w; xx++) {
    const i = (yy * f.w + xx) * 3;
    if (0.3 * f.px[i] + 0.59 * f.px[i + 1] + 0.11 * f.px[i + 2] < below) n++;
  }
  return n;
}
/** Anything drawn on a white frame (callout boxes of any colour). */
const inked = (f: { w: number; px: Buffer }, r: Rect) => darkPixels(f, r, 200);

/** RMS level (0..1) of a video's audio between two times. */
function rms(video: string, from: number, to: number): number {
  const buf = Buffer.from(ffRead(["-i", video, "-vn", "-ac", "1", "-ar", "8000", "-f", "f32le", "-"]));
  const a = new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 4));
  let s = 0;
  let n = 0;
  for (let i = Math.round(from * 8000); i < Math.min(a.length, Math.round(to * 8000)); i++) {
    s += a[i] * a[i];
    n++;
  }
  return n ? Math.sqrt(s / n) : 0;
}

const near = (actual: number, expected: number, tol: number, what: string) =>
  assert.ok(Math.abs(actual - expected) <= tol, `${what}: ${actual} (expected ${expected} ± ${tol})`);

// ─── the tests ───────────────────────────────────────────────────────

describe("renderer (electron/produce.ts) on synthetic videos", () => {
  before(() => fs.mkdirSync(TMP, { recursive: true }));
  after(() => {
    if (process.env.NARASCREEN_KEEP_TMP !== "1") fs.rmSync(TMP, { recursive: true, force: true });
  });

  test("blur geometry: every region size gets a legal radius on every plane and is fully covered", () => {
    const res = { width: 1280, height: 720 };
    for (const radius of [4, 20, 40]) {
      for (let a = 2; a <= 60; a++) {
        for (const [w, h] of [[a, 60], [60, a], [a, a]]) {
          for (const off of [0, 1]) {
            const rect: Rect = [101 + off, 201 + off, w, h];
            const g = blurGeometry(rect, radius, res)!;
            const ctx = `radius ${radius}, ${w}x${h} at +${off}`;
            assert.ok(g, ctx);
            const [cw, ch, cx, cy] = g.crop;
            // everything even (yuv420p: crop/overlay round odd values down, leaving a row uncovered)
            for (const v of [cw, ch, cx, cy, ...g.inner, ...g.at]) assert.equal(v % 2, 0, `${ctx}: ${v} is odd`);
            // boxblur reads past the plane unless 2r + 1 <= its side (luma = crop, chroma = half)
            assert.ok(2 * g.lumaR + 1 <= Math.min(cw, ch), `${ctx}: luma radius ${g.lumaR} for ${cw}x${ch}`);
            assert.ok(2 * g.chromaR + 1 <= Math.min(cw, ch) / 2, `${ctx}: chroma radius ${g.chromaR} for ${cw / 2}x${ch / 2}`);
            // the pasted patch covers the whole rect and sits inside the blurred crop
            const [iw, ih, ix, iy] = g.inner;
            assert.ok(g.at[0] <= rect[0] && g.at[1] <= rect[1] && g.at[0] + iw >= rect[0] + w && g.at[1] + ih >= rect[1] + h, `${ctx}: patch misses part of the rect`);
            assert.ok(ix >= 0 && iy >= 0 && ix + iw <= cw && iy + ih <= ch, `${ctx}: patch outside the crop`);
            // small regions still get the full radius from the surrounding context
            assert.equal(g.lumaR, radius, `${ctx}: luma radius`);
          }
        }
      }
    }
  });

  test("blur on short and narrow regions (2–60 px, odd and even, radius 4/20/40) renders blurred, never a solid magenta bar", { timeout: 180_000 }, async () => {
    // A fine black/white checkerboard: neutral grey when blurred, magenta/green when a chroma plane breaks.
    const src = path.join(TMP, "checker.mp4");
    ffmpegSync(["-y", "-f", "lavfi", "-i", `color=c=gray:s=1280x720:r=${FPS}:d=1`, "-vf", "geq=lum='if(mod(floor(X/3)+floor(Y/3),2),235,16)':cb=128:cr=128", "-c:v", "libx264", "-preset", "ultrafast", "-crf", "8", "-pix_fmt", "yuv420p", src]);
    const rects: Rect[] = [];
    for (let a = 2; a <= 60; a++) {
      for (const [w, h] of [[60, a], [a, 60]] as const) {
        const i = rects.length;
        rects.push([20 + (i % 17) * 74 + (i % 2), 20 + Math.floor(i / 17) * 96 + (i % 2), w, h]);
      }
    }
    for (const radius of [4, 20, 40]) {
      const video = await render(`blur-${radius}`, src, [{ id: "b", type: "blur", timestamp: 0, blurRects: rects, blurRadius: radius, blurDuration: 5 }]);
      const f = frame(video, 0.5);
      const raw = frame(src, 0.5);
      for (const r of rects) {
        const got = regionStats(f, r);
        const before = regionStats(raw, r);
        const ctx = `radius ${radius}, region ${JSON.stringify(r)}`;
        assert.ok(got.tint < 40, `${ctx}: coloured (max |R−G|+|B−G| = ${got.tint}; the old clamp painted such regions magenta)`);
        assert.ok(before.spread > 90, `${ctx}: test pattern missing`);
        assert.ok(got.spread < 45, `${ctx}: not blurred (largest deviation ${got.spread.toFixed(0)}, raw ${before.spread.toFixed(0)})`);
      }
    }
  });

  test("talk-over narration (freeze: false) keeps every source frame: the video stays as long as the source", { timeout: 120_000 }, async () => {
    for (const withAudio of [false, true]) {
      const src = numbered(withAudio ? "num6a.mp4" : "num6.mp4", 6, withAudio);
      const video = await render(`talkover-${withAudio}`, src, [
        { id: "n", type: "narrate", timestamp: 1, freeze: false, customAudioPath: tone("t1_5.wav", 1.5), showSubtitles: false },
      ]);
      near(probeDuration(video), 6, 0.05, `duration (${withAudio ? "source with sound" : "silent source"})`);
      // it used to cut the clip to the speech (1.5 s) but resume after speech + 0.5 s: 15 frames vanished
      for (const t of [0.5, 1.5, 2.45, 2.55, 3.1, 4.5, 5.8]) near(frameNo(video, t), Math.round(t * FPS), 1, `source frame at ${t}s`);
    }
  });

  test("talk-over + freezing narration: duration = source + the freeze; frames after both line up", { timeout: 120_000 }, async () => {
    const src = numbered("num6.mp4", 6);
    const video = await render("talkover-freeze", src, [
      { id: "a", type: "narrate", timestamp: 1, freeze: false, customAudioPath: tone("t1_5.wav", 1.5), showSubtitles: false },
      { id: "b", type: "narrate", timestamp: 4, freeze: true, customAudioPath: tone("t1.wav", 1), showSubtitles: false },
    ]);
    near(probeDuration(video), 7, 0.05, "duration");
    near(frameNo(video, 4.5), 120, 1, "frozen frame (source 4.0 s)");
    near(frameNo(video, 5.5), 135, 1, "source 4.5 s, after the 1 s freeze");
  });

  test("talk-over narration running past the end holds the last frame instead of cutting the voice", { timeout: 60_000 }, async () => {
    const src = numbered("num6.mp4", 6);
    const video = await render("talkover-end", src, [
      { id: "n", type: "narrate", timestamp: 5, freeze: false, customAudioPath: tone("t1_5.wav", 1.5), showSubtitles: false },
    ]);
    near(probeDuration(video), 7, 0.05, "duration (speech 1.5 s + 0.5 s from 5 s)");
    near(frameNo(video, 6.6), 179, 1, "last frame held");
    assert.ok(rms(video, 6.0, 6.4) > 0.05, "the narration still sounds after the source ended");
  });

  test("a callout after a talk-over narration appears on its own source frame (not 0.5 s late)", { timeout: 60_000 }, async () => {
    const src = numbered("num6.mp4", 6);
    const box: Rect = [200, 200, 120, 28];
    const video = await render("talkover-callout", src, [
      { id: "n", type: "narrate", timestamp: 1, freeze: false, customAudioPath: tone("t1_5.wav", 1.5), showSubtitles: false },
      { id: "c", type: "callout", timestamp: 4, calloutStyle: "label", calloutText: "Here", calloutDuration: 1, calloutPanels: [{ text: "Here", rect: [box[0], box[1], box[2], box[3]], fontSize: 28 }] },
    ]);
    const shows = (t: number) => darkPixels(frame(video, t), box) > 200;
    assert.ok(!shows(3.9), "not yet at 3.9 s");
    assert.ok(shows(4.05) && shows(4.9), "on screen from 4 s");
    near(frameNo(video, 4.05), 121, 1, "…and 4 s is source frame 120 — the frame the callout was placed on");
    assert.ok(!shows(5.1), "gone after its 1 s");
  });

  test("an insert inside a talk-over narration waits for it: no source frame plays twice", { timeout: 60_000 }, async () => {
    const src = numbered("num6.mp4", 6);
    const video = await render("talkover-overlap", src, [
      { id: "n", type: "narrate", timestamp: 1, freeze: false, customAudioPath: tone("t1_5.wav", 1.5), showSubtitles: false },
      { id: "p", type: "pause", timestamp: 2, resumeAfter: 1 },
    ]);
    near(probeDuration(video), 7, 0.05, "duration");
    let last = -1;
    for (let t = 0.05; t < 6.9; t += 0.1) {
      const n = frameNo(video, t);
      assert.ok(n >= last, `frame ${n} at ${t.toFixed(2)}s after frame ${last}: the video jumped back`);
      last = n;
    }
    near(frameNo(video, 3.5), 90, 1, "the pause holds source 3.0 s, where the narration ended");
  });

  test("a freeze at the end of a skip shows the first frame after the cut", { timeout: 120_000 }, async () => {
    const src = numbered("num6.mp4", 6);
    // [skip start, skip end, narration] — the second skip starts 0.3 ms after a frame (frame 60 at 2.0 s)
    for (const [a, b, at] of [[2.013, 4.021, 4.025], [2.0003, 4.021, 4.021], [2.013, 4.0, 4.0]]) {
      const video = await render(`skip-freeze-${a}-${b}-${at}`, src, [
        { id: "s", type: "skip", timestamp: a, skipEndTimestamp: b },
        { id: "n", type: "narrate", timestamp: at, freeze: true, customAudioPath: tone("t1.wav", 1), showSubtitles: false },
      ]);
      const kept = Math.ceil(a * FPS - 1e-6); // frames before the cut (the skip keeps those earlier than its start)
      const firstAfter = Math.ceil(b * FPS - 1e-6); // the first frame the skip resumes on
      const cut = kept / FPS; // where the freeze starts on the final timeline
      const ctx = `skip ${a}–${b}, freeze at ${at}`;
      // (frameNo reads the first frame at or after t)
      assert.equal(frameNo(video, cut - 0.04), kept - 1, `${ctx}: last frame before the cut`);
      for (const dt of [0, 0.5, 0.95]) assert.equal(frameNo(video, cut + dt), firstAfter, `${ctx}: frozen frame ${dt}s into the freeze (the old renderer froze on frame ${kept - 1})`);
      assert.equal(frameNo(video, cut + 1.01), firstAfter + 1, `${ctx}: plays on from there`);
      near(probeDuration(video), 6 - (firstAfter - kept) / FPS + 1, 0.05, `${ctx}: duration`);
    }
  });

  test("music: starts at its timestamp, stops (fades) at musicEndTimestamp, and ducks under narration on every loop", { timeout: 60_000 }, async () => {
    const src = numbered("num8.mp4", 8);
    const music = tone("music1.wav", 1, 220); // 1 s: the ducking below happens on its 3rd loop
    const video = await render("music-window", src, [
      { id: "m", type: "music", timestamp: 1, musicEndTimestamp: 5, musicPath: music, musicVolume: 0.5, musicDuckTo: 0.1 },
      { id: "n", type: "narrate", timestamp: 3, freeze: false, customAudioPath: tone("silence1.wav", 1, 0), showSubtitles: false },
    ]);
    near(probeDuration(video), 8, 0.05, "duration");
    const full = rms(video, 1.5, 2.8);
    assert.ok(rms(video, 0.1, 0.9) < 0.002, "silent before the music's timestamp");
    assert.ok(full > 0.02, `music plays from its timestamp (rms ${full.toFixed(3)})`);
    const ducked = rms(video, 3.1, 4.3);
    near(ducked / full, 0.2, 0.08, `ducked to duckTo/volume while the narration speaks (rms ${ducked.toFixed(3)} vs ${full.toFixed(3)})`);
    assert.ok(rms(video, 5.1, 7.9) < 0.002, "silent after musicEndTimestamp");
  });

  test("a label callout placed above its element: the rendered box ends above the element and never covers it", { timeout: 60_000 }, async () => {
    const src = path.join(TMP, "white.mp4");
    ffmpegSync(["-y", "-f", "lavfi", "-i", `color=c=white:s=1440x900:r=${FPS}:d=2`, "-c:v", "libx264", "-preset", "ultrafast", "-crf", "10", "-pix_fmt", "yuv420p", src]);
    const el: Rect = [500, 400, 300, 40];
    const script: DemoScript = {
      version: 1, scope: "t", baseUrl: "http://x", viewport: { width: 1440, height: 900 }, defaults: {},
      steps: [{ id: "s", beat: [
        { fx: "callout", style: "step-counter", step: 1, text: "Name the task", anchor: { text: "x" } },
        { fx: "callout", text: "Busiest: Friday", placement: "below", fontSize: 24, anchor: { text: "y" } },
      ] }],
    };
    const trace: TraceEntry[] = [
      { beat: "s", i: 0, kind: "fx", fx: "callout", t: 0.2, rect: el },
      { beat: "s", i: 1, kind: "fx", fx: "callout", t: 0.2, rect: el },
    ];
    const actions: NaraAction[] = compile(script, trace);
    const video = await render("label-box", src, actions);
    const f = frame(video, 1);
    assert.equal(inked(f, el), 0, "nothing drawn on the element itself");
    const [x, y, w, h] = el;
    assert.ok(inked(f, [x, y - 30, w, 24]) > 500, "the step-counter box sits right above it");
    assert.ok(inked(f, [x, y + h + 8, w, 24]) > 500, "the label below sits right below it");
    assert.equal(inked(f, [x, y - 5, w, 5]) + inked(f, [x, y + h, w, 5]), 0, "≥ 5 px clear of the element");
    // the box above is 1.25·28 + 2·7 = 49 px tall (it used to reserve 44 px and draw 59)
    assert.equal(inked(f, [0, 0, 1440, y - 6 - 49 - 1]), 0, "the box above is no taller than it has to be");
  });
});
