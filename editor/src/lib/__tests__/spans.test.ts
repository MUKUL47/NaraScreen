import type { DemoProject, TimelineAction } from "../../types";
import { newProject } from "../migrateProject";
import {
  currentNarrationHash, getEffectSpan, modelOutput, narrationHash, narrationSeconds, narrationVoice, projectVoice, speechSec,
} from "../spans";
import { assert, test } from "./_node";

const project = (actions: TimelineAction[], extra: Partial<DemoProject> = {}): DemoProject => ({
  ...newProject({ title: "t", baseUrl: "", recordingPath: "/r.mp4", recordingDuration: 30, size: { width: 1600, height: 900 } }),
  actions,
  ...extra,
});
const close = (a: number, b: number, msg?: string) => assert.ok(Math.abs(a - b) < 1e-6, `${msg ?? ""} ${a} ≠ ${b}`);

test("narration: the current clip's length, else an estimate; a stale clip is ignored", () => {
  const n: TimelineAction = { id: "n", type: "narrate", timestamp: 2, narrations: { en: "Hello there, friend." } };
  const p = project([n]);
  const est = speechSec("Hello there, friend.".length, 1);
  assert.deepEqual(narrationSeconds(p, n, "en"), { sec: est, estimated: true });
  const hash = currentNarrationHash(p, n, "en")!;
  const withClip = { ...n, audioPath: { en: "/c.wav" }, audioDuration: { en: 1.7 }, audioTextHash: { en: hash } };
  assert.deepEqual(narrationSeconds(p, withClip, "en"), { sec: 1.7, estimated: false });
  const span = getEffectSpan(withClip, project([withClip]), "en");
  close(span.end, 2 + 1.7 + 0.5);
  assert.equal(span.inserts, 1.7, "freezes by default (API)");
  const stale = { ...withClip, narrations: { en: "Changed text" } };
  assert.equal(narrationSeconds(p, stale, "en")!.estimated, true);
  assert.equal(getEffectSpan({ ...withClip, freeze: false }, p, "en").inserts, 0, "talk-over adds nothing");
});

test("voices follow the CLI: line → project default; en fallback text uses the en voice", () => {
  const p = project([], { tts: { ...newProject({ title: "", baseUrl: "", recordingPath: "" }).tts, voices: { hi: ["hm_omega"] }, voiceEn: "af_bella" } });
  assert.equal(projectVoice(p, "en"), "af_bella");
  assert.equal(projectVoice(p, "hi"), "hm_omega");
  assert.equal(projectVoice(p, "ja"), "jf_alpha");
  const a: TimelineAction = { id: "a", type: "narrate", timestamp: 0, narrations: { en: "x", hi: "y" }, voice: "hf_beta" };
  assert.equal(narrationVoice(p, a, "hi"), "hf_beta");
  assert.equal(narrationVoice(p, { ...a, narrations: { en: "x" } }, "hi"), "af_bella", "fallback text is read in English");
  const z: TimelineAction = { id: "z", type: "zoom", timestamp: 0, voice: "am_adam", zoomTargets: [{ rect: [0, 0, 1, 1], narrations: { en: "t" } }, { rect: [0, 0, 1, 1], narrations: { en: "u" }, voice: "am_eric" }] };
  assert.equal(narrationVoice(p, z, "en", 0), "am_adam");
  assert.equal(narrationVoice(p, z, "en", 1), "am_eric");
  assert.equal(narrationHash("en", "af_heart", 1, "x"), narrationHash("en", "af_heart", 1, "x"));
  assert.notEqual(narrationHash("en", "af_heart", 1, "x"), narrationHash("en", "af_heart", 1.25, "x"));
});

test("zoom: in + hold + out per target; narrated targets hold for their speech", () => {
  const z: TimelineAction = {
    id: "z", type: "zoom", timestamp: 1, zoomDuration: 0.8, zoomHold: 2,
    zoomTargets: [{ rect: [0, 0, 10, 10], narrations: { en: "x" }, audioDuration: { en: 1.5 } }, { rect: [0, 0, 10, 10] }],
  };
  const s = getEffectSpan(z, project([z]), "en");
  close(s.end - s.start, 0.8 * 2 + 1.5 + 0.8 * 2 + 2);
  assert.equal(s.estimated, false);
});

test("overlays: seconds, auto (until the next narration ends, else 3 s), end", () => {
  const n: TimelineAction = { id: "n", type: "narrate", timestamp: 5, narrations: { en: "x" }, audioDuration: { en: 2 } };
  const spot: TimelineAction = { id: "s", type: "spotlight", timestamp: 4, spotlightDuration: 1.5 };
  const p = project([spot, n]);
  close(getEffectSpan(spot, p, "en").end, 5.5);
  const auto = { ...spot, durationMode: "auto" as const };
  close(getEffectSpan(auto, project([auto, n]), "en").end, 5 + 2 + 0.5);
  close(getEffectSpan(auto, project([auto]), "en").end, 7, "no narration after → 3 s");
  close(getEffectSpan({ ...spot, type: "blur", durationMode: "end" }, p, "en").end, 30);
  const pause: TimelineAction = { id: "p", type: "pause", timestamp: 3 };
  assert.deepEqual(getEffectSpan(pause, p, "en"), { start: 3, end: 6, estimated: false, inserts: 3 });
  close(getEffectSpan({ id: "sp", type: "speed", timestamp: 1, speedEndTimestamp: 4 }, p, "en").end, 4);
  assert.deepEqual(getEffectSpan({ id: "m", type: "music", timestamp: 3 }, p, "en"), { start: 0, end: 30, estimated: false, inserts: 0 });
});

test("output model: cuts, speed and freezes (port of the compiler's modelTimeline)", () => {
  const p = project([
    { id: "sk", type: "skip", timestamp: 2, skipEndTimestamp: 4 },
    { id: "sp", type: "speed", timestamp: 10, speedFactor: 2, speedEndTimestamp: 14 },
    { id: "n", type: "narrate", timestamp: 6, narrations: { en: "x" }, audioDuration: { en: 3 } },
    { id: "pa", type: "pause", timestamp: 20, resumeAfter: 1.5 },
    { id: "off", type: "pause", timestamp: 21, disabled: true },
  ]);
  const m = modelOutput(p, "en");
  close(m.cutSec, 2);
  close(m.speedSec, 2);
  close(m.addedSec, 4.5);
  close(m.outputSec, 30 - 2 - 2 + 4.5);
  close(m.placed(6), 4, "after the 2 s cut");
  close(m.placed(8), 4 + 2 + 3, "after the freeze");
  assert.equal(m.inserts.length, 2);
});
