// Run: node_modules/.bin/tsx --test api/_tests/preview.test.ts
//
// makePreview on a tiny synthetic video (ffmpeg lavfi) — needs ffmpeg only.

import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { ffmpegSync, probeResolution } from "../../electron/ffmpeg";
import { AgentError } from "../errors.ts";
import { makePreview } from "../preview.ts";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "narascreen-preview-"));
const video = path.join(tmp, "final_en.mp4");

before(() => {
  ffmpegSync([
    "-y", "-f", "lavfi", "-i", "testsrc2=size=640x400:rate=30", "-t", "4",
    "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", video,
  ]);
  assert.ok(fs.existsSync(video), "ffmpeg could not make the test video");
});

after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test("frames at the middle of N equal slices + a contact sheet", () => {
  const out = path.join(tmp, "p1");
  const r = makePreview(video, out, { tiles: 6 });
  assert.equal(r.video, video);
  assert.ok(Math.abs(r.durationSec - 4) < 0.1);
  assert.deepEqual(r.frames.map((f) => f.t), [0.333, 1, 1.667, 2.333, 3, 3.667]);
  assert.deepEqual(r.frames.map((f) => path.basename(f.path)), ["frame_00.jpg", "frame_01.jpg", "frame_02.jpg", "frame_03.jpg", "frame_04.jpg", "frame_05.jpg"]);
  for (const f of r.frames) assert.equal(probeResolution(f.path).width, 960);
  assert.equal(r.contactSheet, path.join(out, "contact.jpg"));
  const sheet = probeResolution(r.contactSheet);
  assert.ok(sheet.width > 4 * 480 && sheet.height > 2 * 300, `contact sheet ${sheet.width}x${sheet.height}`);
  assert.deepEqual(fs.readdirSync(out).filter((f) => f.startsWith("tile_")), [], "tiles are cleaned up");
});

test("tiles default to 12, clamp to 1..48, and a rerun replaces old frames", () => {
  const out = path.join(tmp, "p2");
  assert.equal(makePreview(video, out).frames.length, 12);
  const one = makePreview(video, out, { tiles: 0 });
  assert.equal(one.frames.length, 1);
  assert.equal(one.frames[0].t, 2);
  assert.deepEqual(fs.readdirSync(out).sort(), ["contact.jpg", "frame_00.jpg"]);
});

test("missing video → VIDEO_NOT_FOUND", () => {
  assert.throws(() => makePreview(path.join(tmp, "nope.mp4"), path.join(tmp, "p3")), (e: unknown) => {
    assert.ok(e instanceof AgentError);
    assert.equal(e.code, "VIDEO_NOT_FOUND");
    return true;
  });
});
