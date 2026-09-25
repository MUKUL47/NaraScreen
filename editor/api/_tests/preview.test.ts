// Run: node_modules/.bin/tsx --test api/_tests/preview.test.ts
//
// makePreview on a tiny synthetic video (ffmpeg lavfi), and the produce →
// preview path it serves: produceLanguage on a synthetic job whose only
// narration is a recorded file, so no speech engine is needed. ffmpeg only.

import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { ffmpegSync, hasAudioStream, probeDuration, probeResolution } from "../../electron/ffmpeg";
import { AgentError } from "../errors.ts";
import { jobPaths } from "../job.ts";
import { setQuiet } from "../output.ts";
import { makePreview } from "../preview.ts";
import { produceLanguage } from "../produce-headless.ts";
import type { DemoScript, TraceEntry } from "../types.ts";

setQuiet(true);

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

// ── produceLanguage (no TTS: recorded audio only) ────────────

function syntheticJob(name: string): { job: string; tone: string } {
  const job = path.join(tmp, name);
  const p = jobPaths(job);
  fs.mkdirSync(p.recordingsDir, { recursive: true });
  ffmpegSync(["-y", "-f", "lavfi", "-i", "testsrc2=size=640x400:rate=30", "-t", "4", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", p.recording]);
  const tone = path.join(tmp, "tone.wav");
  if (!fs.existsSync(tone)) ffmpegSync(["-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=1.5", tone]);
  return { job, tone };
}

const script = (steps: DemoScript["steps"], extra: Partial<DemoScript> = {}): DemoScript =>
  ({ version: 1, scope: "produce-test", baseUrl: "http://localhost:1", viewport: { width: 640, height: 400 }, steps, ...extra });

test("produceLanguage: recorded narration, auto spotlight, quality + resolution preset, desktop project", async () => {
  const { job, tone } = syntheticJob("job-ok");
  const sc = script(
    [{ id: "s", beat: [{ fx: "spotlight", anchor: { text: "x" } }, { fx: "narrate", audio: tone, narrate: "A tone." }] }],
    { output: { quality: "low" } },
  );
  const trace: TraceEntry[] = [
    { beat: "s", i: 0, kind: "fx", fx: "spotlight", t: 0.5, rect: [50, 50, 100, 80] },
    { beat: "s", i: 1, kind: "fx", fx: "narrate", t: 1 },
  ];
  const r = await produceLanguage(job, sc, trace, "en", () => {}, { resolution: "480p" });
  assert.equal(r.videoPath, path.join(job, "video", "final_en.mp4"));
  assert.deepEqual([r.width, r.height], [854, 480]);
  assert.deepEqual(probeResolution(r.videoPath), { width: 854, height: 480 });
  assert.ok(Math.abs(r.durationSec - 5.5) < 0.4, `duration ${r.durationSec} ≈ 4 s recording + 1.5 s freeze`);
  assert.ok(hasAudioStream(r.videoPath));
  assert.deepEqual(r.narrations.map((n) => [n.step, n.entry, n.voice, n.text]), [["s", 1, "recorded", "A tone."]]);
  assert.deepEqual(r.warnings, []);
  // the job opens in the desktop app: DemoProject shape
  const project = JSON.parse(fs.readFileSync(path.join(job, "demo-project.json"), "utf-8"));
  assert.deepEqual(Object.keys(project).sort(), ["actions", "baseUrl", "output", "recordingDuration", "recordingPath", "title", "tts", "viewport"]);
  assert.equal(project.recordingPath, jobPaths(job).recording);
  assert.deepEqual(project.output, { width: 640, height: 400, fps: 30, format: "mp4" });
  assert.equal(project.tts.voices.en[0], "af_heart");
  const spot = project.actions.find((a: { type: string }) => a.type === "spotlight");
  assert.equal(spot.spotlightDuration, 2.5); // (1 − 0.5) + 1.5 + 0.5
  assert.deepEqual(JSON.parse(fs.readFileSync(r.projectPath, "utf-8")), project);
  const pv = makePreview(r.videoPath, path.join(job, "preview", "en"), { tiles: 4 });
  assert.equal(pv.frames.length, 4);
});

test("produceLanguage: a renderer pass that fails is never shipped → RENDER_FAILED, video moved aside", async () => {
  const { job } = syntheticJob("job-bad");
  const sc = script([{ id: "s", beat: [{ fx: "spotlight", anchor: { text: "x" }, duration: 1 }] }]);
  // A zero-size box makes the spotlight's ffmpeg pass fail; the renderer only logs it.
  const trace: TraceEntry[] = [{ beat: "s", i: 0, kind: "fx", fx: "spotlight", t: 1, rect: [10, 10, 0, 0] }];
  await assert.rejects(produceLanguage(job, sc, trace, "en", () => {}), (e: unknown) => {
    assert.ok(e instanceof AgentError);
    assert.equal(e.code, "RENDER_FAILED");
    assert.match(String(e.details?.pass), /produced no output/);
    assert.ok(fs.existsSync(String(e.details?.logPath)));
    assert.equal(e.details?.rejectedVideo, path.join(job, "video", "rejected_en.mp4"));
    return true;
  });
  assert.ok(!fs.existsSync(path.join(job, "video", "final_en.mp4")));
  assert.ok(probeDuration(path.join(job, "video", "rejected_en.mp4")) > 0);
});
