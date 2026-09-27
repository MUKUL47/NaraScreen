import type { DemoProject, TimelineAction } from "../../types";
import { hasBlockingIssues, issuesFor, projectIssues } from "../issues";
import { newProject } from "../migrateProject";
import { projectToScript } from "../projectToScript";
import { currentNarrationHash } from "../spans";
import { assert, compileScript, fs, hasFfmpeg, join, makeVideo, test, tmpDir } from "./_node";

const project = (actions: TimelineAction[], extra: Partial<DemoProject> = {}): DemoProject => ({
  ...newProject({ title: "t", baseUrl: "", recordingPath: "/r.mp4", recordingDuration: 20, size: { width: 1600, height: 900 } }),
  actions,
  ...extra,
});
const rules = (p: DemoProject, langs?: string[]) => projectIssues(p, { langs }).map((i) => i.rule);

/** Two spotlights around a frozen narration: the second starts at 4 s + the freeze. */
const overlapCase = (firstDuration: number) =>
  project([
    { id: "s1", type: "spotlight", timestamp: 1, spotlightRects: [[10, 10, 100, 100]], spotlightDuration: firstDuration },
    { id: "n", type: "narrate", timestamp: 2, narrations: { en: "Speak" }, freeze: true, audioDuration: { en: 2 } },
    { id: "s2", type: "spotlight", timestamp: 4, spotlightRects: [[300, 300, 100, 100]], spotlightDuration: 1 },
  ]);

test("spotlight overlap (D32): same verdict as the compiler's spotlightOverlaps", () => {
  // s2 is placed at 4 + 2 (the freeze) = 6 s; s1 runs from 1 s for its duration.
  const bad = projectIssues(overlapCase(5.5));
  const o = bad.find((i) => i.rule === "spotlight-overlap");
  assert.ok(o);
  assert.deepEqual(o.actionIds, ["s1", "s2"]);
  assert.equal(o.severity, "error");
  assert.ok(o.fix && o.fix.kind === "update");
  assert.equal(o.fix.changes[0].partial.spotlightDuration, 4.95);
  assert.equal(rules(overlapCase(4.9)).includes("spotlight-overlap"), false);
  assert.equal(rules({ ...overlapCase(5.5), actions: overlapCase(5.5).actions.map((a) => (a.id === "s1" ? { ...a, durationMode: "auto" as const } : a)) }).includes("spotlight-overlap"), false, "auto yields");
  if (!hasFfmpeg()) return;
  const dir = tmpDir("overlap");
  makeVideo(join(dir, "r.mp4"), 1600, 900, 20);
  for (const [d, expect] of [[5.5, true], [4.9, false]] as const) {
    const p = { ...overlapCase(d), recordingPath: join(dir, "r.mp4") };
    const { warnings } = compileScript(projectToScript(p, dir).script, dir, 20, "en", { "main:1": 2 });
    assert.equal(warnings.some((w) => /SPOTLIGHT_OVERLAP/.test(w)), expect, `compiler, first spotlight ${d} s`);
    assert.equal(rules(p).includes("spotlight-overlap"), expect, `issues, first spotlight ${d} s`);
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

test("regions: outside the frame (with a fix) and missing", () => {
  const p = project([
    { id: "b", type: "blur", timestamp: 1, blurRects: [[1550, 10, 100, 50], [0, 0, 10, 10]] },
    { id: "z", type: "zoom", timestamp: 2 },
  ]);
  const is = projectIssues(p);
  const out = is.find((i) => i.rule === "outside-frame")!;
  assert.ok(out.fix && out.fix.kind === "update");
  assert.deepEqual(out.fix.changes[0].partial.blurRects, [[1500, 10, 100, 50], [0, 0, 10, 10]]);
  assert.ok(is.some((i) => i.rule === "no-region" && i.actionIds[0] === "z"));
  assert.equal(hasBlockingIssues(is), true);
});

test("narration per language: missing, English fallback, stale preview", () => {
  const tts = { ...newProject({ title: "", baseUrl: "", recordingPath: "" }).tts, languages: ["en", "hi"] };
  const n: TimelineAction = { id: "n", type: "narrate", timestamp: 1, narrations: { en: "Hello" } };
  const onlyHi: TimelineAction = { id: "h", type: "narrate", timestamp: 3, narrations: { hi: "नमस्ते" } };
  const p = project([n, onlyHi], { tts });
  const is = projectIssues(p);
  assert.ok(is.some((i) => i.rule === "narration-fallback" && i.actionIds[0] === "n" && i.lang === "hi"));
  assert.ok(is.some((i) => i.rule === "narration-missing" && i.actionIds[0] === "h" && i.lang === "en"));
  assert.equal(rules(project([{ ...onlyHi, lang: "hi" }], { tts })).includes("narration-missing"), false, "a forced language needs only its text");
  const hash = currentNarrationHash(p, n, "en")!;
  const fresh = { ...n, audioPath: { en: "/c.wav" }, audioTextHash: { en: hash } };
  assert.equal(rules(project([fresh])).includes("audio-stale"), false);
  const stale = projectIssues(project([{ ...fresh, narrations: { en: "Hello again" } }])).find((i) => i.rule === "audio-stale")!;
  assert.deepEqual(stale.fix, { label: "Regenerate", kind: "generate", actionId: "n", lang: "en" });
});

test("music, cuts, ranges, limits", () => {
  const p = project(
    [
      { id: "sk", type: "skip", timestamp: 2, skipEndTimestamp: 6 },
      { id: "in", type: "callout", timestamp: 3, calloutStyle: "lower-third", calloutText: "x" },
      { id: "sp1", type: "speed", timestamp: 8, speedFactor: 2, speedEndTimestamp: 12 },
      { id: "sp2", type: "speed", timestamp: 10, speedFactor: 2, speedEndTimestamp: 13 },
      { id: "long", type: "spotlight", timestamp: 1, spotlightRects: [[0, 0, 5, 5]], spotlightDuration: 150 },
      { id: "p", type: "pause", timestamp: 14, resumeAfter: 90 },
      { id: "e", type: "mute", timestamp: 15, muteEndTimestamp: 15 },
      { id: "late", type: "pause", timestamp: 19.99 },
    ],
    { music: { path: "", volume: 0.5, duckTo: 0.2 }, recordingDuration: 200 },
  );
  const r = rules(p);
  for (const rule of ["music-file", "inside-cut", "range-overlap", "duration-max", "range-empty"]) assert.ok(r.includes(rule), rule);
  assert.equal(issuesFor(projectIssues(p), "p").some((i) => i.rule === "duration-max"), true);
  assert.equal(rules({ ...p, recordingDuration: 20 }).includes("after-end"), true);
  const missing = projectIssues({ ...p, music: { path: "/m.mp3", volume: 1, duckTo: 0.2 } }, { missingFiles: new Set(["/m.mp3"]) });
  assert.ok(missing.some((i) => i.rule === "music-file" && /missing/.test(i.message)));
  assert.deepEqual(projectIssues(project([])), []);
});
