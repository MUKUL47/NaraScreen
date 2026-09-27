// Run: node_modules/.bin/tsx --test api/_tests/fx-geometry.test.ts
//
// electron/fx-geometry.ts: the arrow / label / highlight-loop shapes and timing
// that both the renderer (produce.ts, as ASS drawings) and the desktop canvas
// preview use. Pure: no video.

import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as path from "path";
import {
  arcLengths,
  arrowAt,
  arrowGeometry,
  arrowShape,
  arrowTiming,
  capsule,
  highlightTiming,
  loopPieces,
  pencilLoop,
  stepAt,
  type Box,
} from "../../electron/fx-geometry.ts";
import * as viaProduce from "../../electron/produce.ts";

const FRAME = { width: 1280, height: 720 };
const TARGET: Box = [600, 200, 200, 80];

test("fx-geometry has no imports at all (the browser canvas imports it too)", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "..", "electron", "fx-geometry.ts"), "utf-8");
  assert.doesNotMatch(src, /^\s*import\b|\brequire\(/m);
});

test("produce.ts draws with the same functions it re-exports (one source of truth)", () => {
  assert.equal(viaProduce.arrowGeometry, arrowGeometry);
  assert.equal(viaProduce.arrowShape, arrowShape);
  assert.equal(viaProduce.pencilLoop, pencilLoop);
});

test("arrowTiming: draws in over ≤ 0.5 s and ≤ a third of its time, one step per frame, then holds to the end", () => {
  for (const [start, end] of [[1, 4], [2, 2.6], [0, 30]]) {
    const { steps, drawnAt, highlightFrom } = arrowTiming(start, end);
    const drawSec = Math.min(0.5, (end - start) / 3);
    assert.equal(steps.length, Math.max(1, Math.round(drawSec * 30)));
    assert.equal(steps[0].t0, start);
    assert.equal(steps[steps.length - 1].t1, end);
    for (let k = 1; k < steps.length; k++) {
      assert.equal(steps[k].t0, steps[k - 1].t1, "steps are back to back");
      assert.ok(steps[k].s1 >= steps[k - 1].s1, "the line only grows");
    }
    assert.equal(steps[steps.length - 1].s1, 1);
    assert.equal(drawnAt, steps[steps.length - 1].t0);
    assert.ok(Math.abs(highlightFrom - (start + drawSec + 0.1)) < 1e-9);
  }
});

test("highlightTiming: draw → hold → wipe from the start; nothing when under 0.6 s is left", () => {
  assert.deepEqual(highlightTiming(1, 1.6), []);
  const steps = highlightTiming(1, 4);
  const full = steps.filter((s) => s.s0 === 0 && s.s1 === 1);
  assert.ok(full.length >= 1 && full.some((s) => s.t1 - s.t0 > 0.5), "a hold with the whole loop");
  const hold = full[full.length - 1];
  const drawing = steps.filter((s) => s.t1 <= hold.t0);
  const erasing = steps.filter((s) => s.t0 >= hold.t1);
  assert.ok(drawing.every((s, k) => s.s0 === 0 && (k === 0 || s.s1 >= drawing[k - 1].s1)), "drawn from its start");
  assert.ok(erasing.length > 0 && erasing.every((s, k) => s.s1 === 1 && (k === 0 || s.s0 >= erasing[k - 1].s0)), "wiped from its start");
  assert.ok(steps[steps.length - 1].t1 <= 4, "gone before the arrow is");
  assert.equal(stepAt(steps, 3.99), null);
});

test("arrowAt: exactly the renderer's shapes at any moment — null outside, growing line, label once drawn, loop, fade", () => {
  const opts = { target: TARGET, frame: FRAME, text: "Click here", highlight: true, start: 1, end: 4 };
  assert.equal(arrowAt(opts, 0.99), null);
  assert.equal(arrowAt(opts, 4), null);
  const g = arrowGeometry(TARGET, FRAME);
  const shape = arrowShape(g, [FRAME.width / 2, FRAME.height / 2]);
  const timing = arrowTiming(1, 4);
  for (const st of timing.steps) {
    const t = (st.t0 + st.t1) / 2;
    const d = arrowAt(opts, t)!;
    const s = shape.length * st.s1;
    const h = shape.head(s);
    // the same three polygons produce.ts fills for this step
    assert.deepEqual(d.polygons, [capsule(shape.stroke(s), shape.thickness), capsule([h.arms[0], h.tip], shape.thickness), capsule([h.arms[1], h.tip], shape.thickness)]);
    assert.equal(d.progress, st.s1);
    assert.equal(d.from, g.from);
  }
  assert.equal(arrowAt(opts, 1.05)!.label, null, "no label while drawing");
  const drawn = arrowAt(opts, timing.drawnAt + 0.05)!;
  assert.ok(drawn.label && drawn.label.rise > 0 && drawn.label.opacity < 1, "the label slides and fades in");
  assert.ok(arrowAt(opts, 2.5)!.label!.rise === 0 && arrowAt(opts, 2.5)!.label!.opacity === 1);
  // the loop: its visible pieces are the renderer's
  const hs = highlightTiming(timing.highlightFrom, 4);
  const mid = hs.find((s) => s.s0 === 0 && s.s1 === 1)!;
  const pts = pencilLoop(TARGET, FRAME, g.scale);
  const cum = arcLengths(pts);
  const total = cum[cum.length - 1];
  assert.deepEqual(arrowAt(opts, (mid.t0 + mid.t1) / 2)!.highlight!.polygons, loopPieces(pts, cum, 0, total, 4 * g.scale));
  assert.equal(arrowAt(opts, 3.97)!.highlight, null, "wiped away before the end");
  assert.equal(arrowAt({ ...opts, highlight: false }, (mid.t0 + mid.t1) / 2)!.highlight, null);
  // fade out over the last 0.2 s
  assert.equal(arrowAt(opts, 3.5)!.opacity, 1);
  assert.ok(Math.abs(arrowAt(opts, 3.9)!.opacity - 0.5) < 1e-6);
});
