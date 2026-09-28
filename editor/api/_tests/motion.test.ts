// Run: node_modules/.bin/tsx --test api/_tests/motion.test.ts
//
// Unit tests of the drawn cursor (electron/fx-cursor.ts), the final ↔ recording
// time map (fx-timeline.ts), the follow camera plan (fx-camera.ts) and the
// trace → project step (api/cursor-trace.ts). Pure functions only; the rendered
// result is checked in e2e.test.ts.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  ARRIVE_LEAD,
  MOVE_MAX,
  MOVE_MIN,
  cursorAt,
  cursorEvents,
  clickStateAt,
  minJerk,
  planCursorPath,
  targetPoint,
  type CursorTarget,
} from "../../electron/fx-cursor.ts";
import { activeSeconds, afterActive, buildTimeMap, unskip, unspeed, zoomTransform } from "../../electron/fx-timeline.ts";
import { cameraAt, cameraGraph, cropFor, planCamera, type CameraTarget } from "../../electron/fx-camera.ts";
import { motionProject } from "../cursor-trace.ts";
import type { DemoScript, TraceEntry } from "../types.ts";

const frame = { width: 1440, height: 900 };
const dist = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1]);

describe("cursor path", () => {
  const targets: CursorTarget[] = [
    { kind: "click", rect: [100, 100, 60, 30], t0: 5, t1: 5.1 },
    { kind: "type", rect: [400, 300, 300, 40], t0: 8, t1: 9.5 },
    { kind: "press", rect: [1200, 800, 40, 40], t0: 10, t1: 10.1 },
    { kind: "hover", rect: [1000, 200, 100, 100], t0: 12, t1: 12.2 },
  ];
  const track = planCursorPath(targets, frame)!;

  test("rests exactly on each target when the act happens, arriving just before it", () => {
    for (const tg of targets.filter((t) => t.kind !== "press")) {
      const p = targetPoint(tg);
      assert.ok(dist(cursorAt(track, tg.t0 - ARRIVE_LEAD), p) < 0.5, `${tg.kind} arrived by t0 - lead`);
      assert.ok(dist(cursorAt(track, tg.t0 + 0.01), p) < 0.5, `${tg.kind} on target at t0`);
    }
    // the click point is the element's centre (where Playwright clicks); a field is entered near its start
    assert.deepEqual(targetPoint(targets[0]), [130, 115]);
    const tp = targetPoint(targets[1]);
    assert.ok(tp[0] > 400 && tp[0] < 520 && tp[1] === 320, `text field point ${tp}`);
  });

  test("moves take 0.35–0.8 s, never overlap, and follow a bowed, eased path", () => {
    let prevEnd = -Infinity;
    for (const m of track.moves.filter((x) => dist(x.from, x.to) > 60)) {
      const d = m.t1 - m.t0;
      assert.ok(d >= MOVE_MIN - 1e-9 && d <= MOVE_MAX + 1e-9, `duration ${d}`);
      assert.ok(m.t0 >= prevEnd - 1e-9, "moves don't overlap");
      prevEnd = m.t1;
      const mid = cursorAt(track, (m.t0 + m.t1) / 2);
      const chordMid = [(m.from[0] + m.to[0]) / 2, (m.from[1] + m.to[1]) / 2];
      assert.ok(dist(mid, chordMid) > 2, "the path bows off the straight line");
      // eased: slow at both ends, fastest in the middle
      const step = (t: number) => dist(cursorAt(track, t), cursorAt(track, t + 1 / 30));
      assert.ok(step(m.t0) < step((m.t0 + m.t1) / 2 - 1 / 60) / 3, "starts slowly");
      assert.ok(step(m.t1 - 1 / 30) < step((m.t0 + m.t1) / 2 - 1 / 60) / 3, "stops slowly");
    }
  });

  test("clicks squeeze and ripple; hovers and key presses don't", () => {
    assert.equal(track.clicks.length, 2, "click + the field's focus click");
    assert.ok(Math.abs(track.clicks[0] - 5.02) < 1e-6);
    const s = clickStateAt(track, 5.12);
    assert.ok(s.press > 0.5 && s.ripples.length === 1 && dist(s.ripples[0].at, [130, 115]) < 0.5);
    assert.equal(clickStateAt(track, 12.1).ripples.length, 0);
  });

  test("while typing it rests just below the field, out of the text", () => {
    const p = cursorAt(track, 9);
    assert.ok(p[1] > 340 && p[1] < 360, `below the field: ${p}`);
  });

  test("press/scroll/waitFor don't move the pointer; it appears shortly before its first move", () => {
    assert.ok(dist(cursorAt(track, 11), cursorAt(track, 9.6)) < 0.5, "press leaves it where it was");
    assert.ok(track.appear < track.moves[0].t0 && track.moves[0].t0 - track.appear < 0.6);
    assert.equal(planCursorPath([{ kind: "wait", rect: [0, 0, 10, 10], t0: 1, t1: 1 }], frame), null);
  });

  test("minimum-jerk ease: 0 → 1, symmetric", () => {
    assert.equal(minJerk(0), 0);
    assert.equal(minJerk(1), 1);
    assert.ok(Math.abs(minJerk(0.3) + minJerk(0.7) - 1) < 1e-12);
  });

  test("ASS events: per frame while moving, merged while resting, frozen during a freeze, zoomed in a freeze-zoom", () => {
    const plain = cursorEvents(track, {}, frame, (T) => ({ r: T }), 15);
    assert.ok(plain.every((l) => /^Dialogue: 3[012],/.test(l) && l.includes("CArrow")));
    const at = (l: string) => Number(l.split(",")[1].split(":").reduce((s, x) => s * 60 + Number(x), 0));
    // resting after the hover (arrived ~11.9 s) to the end: the event that began on arrival covers it
    const resting = plain.filter((l) => l.startsWith("Dialogue: 32,") && at(l) > 12);
    assert.equal(resting.length, 0);
    const moving = plain.filter((l) => l.startsWith("Dialogue: 32,") && at(l) > 11.1 && at(l) < 11.9);
    assert.ok(moving.length >= 15, `one event per frame while moving (${moving.length})`);
    // a freeze of r=6 from T=6 on: nothing changes → merged
    const frozen = cursorEvents(track, {}, frame, (T) => ({ r: Math.min(T, 6) }), 15);
    assert.equal(frozen.filter((l) => l.startsWith("Dialogue: 32,") && at(l) > 6.1).length, 0);
    // a 2× zoom around the frame's corner doubles the pointer's position and size
    const z = cursorEvents(track, {}, frame, (T) => ({ r: T, zoom: { s: 2, ox: 0, oy: 0 } }), 7);
    const pos = (l: string) => /\\pos\(([\d.]+),([\d.]+)\)/.exec(l)!.slice(1).map(Number);
    const lastZ = z.filter((l) => l.startsWith("Dialogue: 32,")).pop()!;
    const lastP = cursorEvents(track, {}, frame, (T) => ({ r: T }), 7).filter((l) => l.startsWith("Dialogue: 32,")).pop()!;
    assert.ok(Math.abs(pos(lastZ)[0] - 2 * pos(lastP)[0]) < 2, `${pos(lastZ)} vs 2 × ${pos(lastP)}`);
    // style: colour, and no click effect
    const dark = cursorEvents(track, { color: "#111827", clickEffect: false }, frame, (T) => ({ r: T }), 7);
    assert.ok(dark.some((l) => l.includes("\\1c&H271811&")) && !dark.some((l) => l.startsWith("Dialogue: 30,")));
  });
});

describe("time map (final ↔ recording)", () => {
  test("unskip / unspeed invert the renderer's remaps", () => {
    const skips = [{ start: 2, end: 4 }];
    assert.equal(unskip(1, skips), 1);
    assert.equal(unskip(2, skips), 4, "the cut point shows the first frame after the cut");
    assert.equal(unskip(3, skips), 5);
    const speeds = [{ start: 2, end: 6, factor: 2 }];
    assert.equal(unspeed(1, speeds), 1);
    assert.equal(unspeed(3, speeds), 4);
    assert.equal(unspeed(4, speeds), 6);
    assert.equal(unspeed(5, speeds), 7);
  });

  test("layout: plays, freezes and freeze-zooms", () => {
    const map = buildTimeMap({
      toFinal: (r) => r,
      skips: [],
      speeds: [],
      frame,
      layout: [
        { kind: "play", src: 0, start: 0, dur: 2 },
        { kind: "freeze", src: 2, start: 2, dur: 3 },
        { kind: "zoom", src: 2, start: 5, dur: 1, zoom: { rect: [620, 400, 200, 100], maxZ: 4, frames: 30, phase: "hold" } },
        { kind: "play", src: 2, start: 6, dur: 10, until: 5 },
      ],
    });
    assert.equal(map.at(1).r, 1);
    assert.deepEqual([map.at(3).r, map.at(3).frozen], [2, true]);
    const z = map.at(5.5).zoom!;
    assert.equal(z.s, 4);
    assert.ok(Math.abs((720 - z.ox) * z.s - 720) < 4, "the zoom target's centre is the frame's centre");
    assert.equal(map.at(7).r, 3);
    assert.equal(map.at(12).r, 5, "a talk-over clip holds its last frame");
    assert.equal(activeSeconds(map, 0, 10), 6);
    assert.equal(afterActive(map, 1.5, 1), 6.5, "freezes don't count as time passing");
  });

  test("zoompan transform clamps to the frame", () => {
    const t = zoomTransform({ rect: [0, 0, 100, 60], maxZ: 3, frames: 24, phase: "hold" }, 0, frame);
    assert.deepEqual([t.ox, t.oy], [0, 0]);
  });
});

describe("follow camera", () => {
  const tg = (F0: number, F1: number, rect: [number, number, number, number], step = "s", stepEnd = 100): CameraTarget => ({ F0, F1, rect, scale: 1.8, step, stepEnd });
  const o = { frame, duration: 60 };

  test("eases in to arrive as the act begins, holds, eases out after the hold", () => {
    const segs = planCamera([tg(5, 6, [300, 200, 120, 40])], o);
    const at = (T: number) => cameraAt(segs, T, frame);
    assert.deepEqual(at(3), [0, 0, 1440, 900], "full frame before");
    const z = at(5);
    assert.ok(Math.abs(1440 / z[2] - 1.8) < 1e-6, "1.8× on arrival");
    assert.ok(z[0] <= 300 && z[0] + z[2] >= 420 && z[1] <= 200 && z[1] + z[3] >= 240, "the target is in view");
    assert.deepEqual(at(7), z, "holds after the act");
    assert.deepEqual(at(9), [0, 0, 1440, 900], "back out after hold + ease");
    const inMove = segs.find((s) => s.from !== s.to)!;
    assert.ok(Math.abs(inMove.T1 - inMove.T0 - 0.8) < 1e-6 && Math.abs(inMove.T1 - 5) < 1e-6);
  });

  test("never jitters: the crop changes smoothly frame to frame", () => {
    const segs = planCamera([tg(5, 6, [300, 200, 120, 40]), tg(7, 7.5, [1000, 600, 120, 40]), tg(20, 21, [200, 700, 100, 30])], o);
    let prev = cameraAt(segs, 0, frame);
    let maxStep = 0;
    for (let k = 1; k < 30 * 30; k++) {
      const c = cameraAt(segs, k / 30, frame);
      maxStep = Math.max(maxStep, ...c.map((v, i) => Math.abs(v - prev[i])));
      prev = c;
    }
    assert.ok(maxStep < 60, `largest per-frame change ${maxStep.toFixed(1)} px`);
  });

  test("nearby acts share one framing; a far one soon after is a straight pan; a long gap goes out and back in", () => {
    const merged = planCamera([tg(5, 6, [300, 200, 120, 40]), tg(7, 8, [420, 260, 120, 40])], o);
    assert.equal(merged.filter((s) => s.from !== s.to).length, 2, "one move in, one out");
    const pan = planCamera([tg(5, 6, [100, 100, 120, 40]), tg(8, 9, [1200, 750, 120, 40])], o);
    const moves = pan.filter((s) => s.from !== s.to);
    assert.equal(moves.length, 3, "in, pan, out");
    assert.ok(moves[1].from[2] < 1440 && moves[1].to[2] < 1440, "the pan stays zoomed");
    const apart = planCamera([tg(5, 6, [100, 100, 120, 40]), tg(20, 21, [1200, 750, 120, 40])], o);
    assert.equal(apart.filter((s) => s.from !== s.to).length, 4, "in, out, in, out");
  });

  test("too big to zoom → full frame; out at the step end and around freeze-zooms", () => {
    assert.equal(cropFor([0, 0, 1300, 800], 1.8, frame), null);
    assert.equal(planCamera([tg(5, 6, [0, 0, 1300, 800])], o).length, 0);
    const stepEnd = planCamera([tg(5, 6, [300, 200, 120, 40], "s", 6.3)], o);
    assert.deepEqual(cameraAt(stepEnd, 7.2, frame), [0, 0, 1440, 900], "out by step end + ease");
    const blocked = planCamera([tg(5, 12, [300, 200, 120, 40])], { ...o, blocked: [{ start: 8, end: 10 }] });
    for (const T of [8, 9, 9.9]) assert.deepEqual(cameraAt(blocked, T, frame), [0, 0, 1440, 900], `full frame during the freeze-zoom (${T})`);
    assert.ok(cameraAt(blocked, 7, frame)[2] < 1440 && cameraAt(blocked, 11.5, frame)[2] < 1440, "zoomed before and after it");
  });

  test("one perspective filter, enabled only while the frame isn't whole", () => {
    const segs = planCamera([tg(5, 6, [300, 200, 120, 40])], o);
    const g = cameraGraph(segs, 30, "in0", "cam", 1)!;
    assert.equal(g.graph.length, 1);
    assert.match(g.graph[0], /^\[in0\]perspective=x0='st\(3,in-1\);.*:interpolation=cubic:sense=source:eval=frame:enable='between\(t,4\.183,[\d.]+\)'\[cam\]$/);
    assert.equal(cameraGraph([], 30, "in0"), null);
  });
});

describe("trace → project fields", () => {
  const script = {
    version: 1,
    scope: "t",
    baseUrl: "http://x",
    viewport: frame,
    steps: [
      { id: "a", beat: [{ act: "click", role: "button", name: "A" }] },
      { id: "b", camera: { follow: true, scale: 2 }, beat: [{ act: "fill", label: "B", value: "x" }, { act: "waitFor", text: "done" }] },
    ],
  } as unknown as DemoScript;
  const trace: TraceEntry[] = [
    { beat: "a", i: 0, kind: "act", act: "click", t: 2.1, start: 1.2, pointer: { kind: "click", t0: 2, rect: [10, 10, 50, 20] } },
    { beat: "b", i: 0, kind: "act", act: "fill", t: 5, start: 3.5, pointer: { kind: "type", t0: 4, rect: [200, 200, 300, 40] } },
    { beat: "b", i: 1, kind: "act", act: "waitFor", t: 6, start: 5.5, pointer: { kind: "wait", t0: 6, rect: [900, 800, 100, 20] } },
  ];

  test("cursor on by default for browser scripts; off when show is false or with a touch plugin", () => {
    const m = motionProject(script, trace, 8);
    assert.equal(m.cursor?.track.moves.length, 3, "to the button, to the field, below it while typing");
    assert.equal(motionProject({ ...script, cursor: { show: false } }, trace, 8).cursor, undefined);
    assert.equal(motionProject({ ...script, plugins: { flutter: {} } } as DemoScript, trace, 8).cursor, undefined);
    assert.equal(motionProject({ ...script, cursor: { size: 1.5, color: "#000000" } }, trace, 8).cursor?.size, 1.5);
  });

  test("camera: per-step follow and scale, step windows, waitFor left out", () => {
    const m = motionProject(script, trace, 8);
    assert.deepEqual(m.camera?.steps, [
      { id: "a", start: 1.2, end: 3.5, follow: false },
      { id: "b", start: 3.5, end: 8, follow: true, scale: 2 },
    ]);
    assert.equal(m.camera?.targets.length, 2, "click + fill; the waitFor is a gate");
    assert.equal(motionProject({ ...script, steps: [script.steps[0]] }, trace, 8).camera, undefined, "no step follows → no camera");
  });

  test("an old trace without pointer data: no cursor, and a warning saying to re-record", () => {
    const warnings: string[] = [];
    const m = motionProject(script, trace.map(({ pointer: _p, ...e }) => e), 8, warnings);
    assert.equal(m.cursor, undefined);
    assert.equal(warnings.length, 1);
  });
});
