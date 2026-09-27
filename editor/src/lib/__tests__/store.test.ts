import type { DemoScript } from "../../../api/schema";
import type { DemoProject, TimelineAction } from "../../types";
import { applyScriptEntries, mergeCompiledLanguages } from "../../stores/project/detach";
import { applyPartial, clampMoveDelta, formatActionId, maxActionNumber, moveAction, newEffect, splitEffect } from "../../stores/project/effects";
import { applySelect, EMPTY_SELECTION, pruneSelection } from "../../stores/project/selection";
import { planExport, renderPaths } from "../exportProject";
import { migrateProject, newProject } from "../migrateProject";
import { parseRecent, upsertRecent, RECENT_MAX } from "../recentProjects";
import { assert, readFixture, test } from "./_node";

const project = (actions: TimelineAction[] = []): DemoProject => ({
  ...newProject({ title: "t", baseUrl: "", recordingPath: "/s/r.mp4", recordingDuration: 20, size: { width: 1600, height: 900 } }),
  actions,
});

test("selection: replace, toggle, range (in a lane's order), clear, prune", () => {
  const all = ["a", "b", "c", "d"];
  let s = applySelect(EMPTY_SELECTION, "b", {}, all);
  assert.deepEqual(s, { selectedIds: ["b"], primaryId: "b" });
  s = applySelect(s, "d", { additive: true }, all);
  assert.deepEqual(s, { selectedIds: ["b", "d"], primaryId: "d" });
  s = applySelect(s, "d", { additive: true }, all);
  assert.deepEqual(s, { selectedIds: ["b"], primaryId: "b" });
  assert.deepEqual(applySelect(s, "d", { range: true }, all), { selectedIds: ["b", "c", "d"], primaryId: "b" });
  assert.deepEqual(applySelect(s, "a", { range: true, order: ["d", "b", "a"] }, all), { selectedIds: ["b", "a"], primaryId: "b" });
  assert.deepEqual(applySelect({ selectedIds: ["a"], primaryId: "a" }, "c", { range: true, additive: true }, all).selectedIds, ["a", "b", "c"]);
  assert.deepEqual(applySelect(s, null, {}, all), EMPTY_SELECTION);
  assert.deepEqual(applySelect(s, ["a", "c"], {}, all), { selectedIds: ["a", "c"], primaryId: "c" });
  assert.deepEqual(pruneSelection({ selectedIds: ["a", "x"], primaryId: "x" }, (id) => id !== "x"), { selectedIds: ["a"], primaryId: "a" });
});

test("new effects carry the API defaults", () => {
  const p = project();
  const e = (k: Parameters<typeof newEffect>[0], at = 2, o = {}) => newEffect(k, "id", at, p, o)!;
  assert.deepEqual(e("zoom", 2, { rect: [1, 2, 3, 4] }), { id: "id", timestamp: 2, type: "zoom", zoomDuration: 0.8, zoomHold: 2, zoomTargets: [{ rect: [1, 2, 3, 4] }] });
  assert.equal(e("narrate").freeze, true, "D13: new narrations freeze, as the API");
  assert.deepEqual([e("spotlight").durationMode, e("spotlight").dimOpacity], ["auto", 0.7]);
  assert.deepEqual([e("spotlight", 2, { end: 5 }).durationMode, e("spotlight", 2, { end: 5 }).spotlightDuration], [undefined, 3]);
  assert.deepEqual([e("blur").durationMode, e("blur").blurRadius, e("blur").blurDuration], ["end", 20, 18]);
  const arrow = e("arrow", 2, { rect: [5, 5, 50, 50] });
  assert.deepEqual([arrow.type, arrow.calloutStyle, arrow.calloutPanels?.[0].fontSize], ["callout", "arrow", 24]);
  assert.equal(e("callout", 2, { rect: [5, 5, 50, 50] }).calloutPanels?.[0].fontSize, 28);
  assert.equal(e("pause").resumeAfter, 3, "D7: pause gets seconds");
  assert.deepEqual([e("speed", 18).speedFactor, e("speed", 18).speedEndTimestamp], [2, 20]);
  assert.equal(e("skip", 50).timestamp, 19.95, "clamped into the video");
  assert.equal(newEffect("music", "m", 0, p), null);
  assert.equal(formatActionId(maxActionNumber([{ id: "action-041", type: "pause", timestamp: 0 }, { id: "x", type: "pause", timestamp: 0 }]) + 1), "action-042");
});

test("partials stay canonical; moves clamp; splits", () => {
  const p = project();
  const spot: TimelineAction = { id: "s", type: "spotlight", timestamp: 2, durationMode: "auto", spotlightDuration: 3 };
  assert.equal(applyPartial(p, spot, { spotlightDuration: 4 }).durationMode, undefined, "explicit seconds win");
  assert.equal(applyPartial(p, spot, { spotlightDuration: 4, durationMode: "end" }).durationMode, "end");
  const n = applyPartial(p, { id: "n", type: "narrate", timestamp: 1, narrations: { hi: "x" } }, { narration: "Hello" });
  assert.deepEqual([n.narrations, "narration" in n], [{ hi: "x", en: "Hello" }, false]);
  assert.equal(applyPartial(p, spot, { timestamp: 99 }).timestamp, 19.95);
  const sk: TimelineAction = { id: "k", type: "skip", timestamp: 5, skipEndTimestamp: 8 };
  assert.equal(applyPartial(p, sk, { skipEndTimestamp: 3 }).skipEndTimestamp, 5);
  assert.equal(clampMoveDelta(p, [sk, spot], -10), -2);
  assert.equal(clampMoveDelta(p, [sk], 30), 12);
  assert.deepEqual(moveAction(sk, 1.5), { ...sk, timestamp: 6.5, skipEndTimestamp: 9.5 });
  const [a, b] = splitEffect(p, sk, 6, "k2")!;
  assert.deepEqual([a.skipEndTimestamp, b.timestamp, b.skipEndTimestamp, b.id], [6, 6, 8, "k2"]);
  const [c, d] = splitEffect(project([spot]), spot, 3, "s2")!;
  assert.deepEqual([c.spotlightDuration, c.durationMode, d.timestamp, d.spotlightDuration], [1, undefined, 3, 2]);
  assert.equal(splitEffect(p, sk, 9, "x"), null);
  assert.equal(splitEffect(p, { id: "z", type: "zoom", timestamp: 1 }, 2, "x"), null);
});

test("detach: languages merged, script entries restore auto durations, voices and langs", () => {
  const en = migrateProject(readFixture("spotlight-job.demo-project.en.json", { __JOB__: "/j" }));
  const hi = structuredClone(en);
  hi.actions = hi.actions.map((a) =>
    a.type === "narrate" ? { ...a, narrations: { hi: `hi:${a.narrations?.en}` }, audioPath: { hi: "/j/audio/x.wav" } }
      : a.type === "callout" ? { ...a, calloutText: `hi:${a.calloutText}` } : a);
  const merged = mergeCompiledLanguages({ en, hi }, "en");
  const n = merged.actions.find((a) => a.type === "narrate")!;
  assert.deepEqual(Object.keys(n.narrations!), ["en", "hi"]);
  assert.equal(n.audioPath?.hi, "/j/audio/x.wav");
  const c = merged.actions.find((a) => a.type === "callout")!;
  assert.deepEqual(c.calloutTexts, { en: c.calloutText, hi: `hi:${c.calloutText}` });
  assert.deepEqual(merged.tts.languages, ["en", "hi"]);

  // the compiler numbers actions in script order: give them their `source`
  const script = readFixture<DemoScript>("spotlight-job.script.json");
  const sources = script.steps.flatMap((st) => st.beat.map((e, i) => ("fx" in e ? { step: st.id, entry: i } : null)).filter((x) => x != null));
  const withSource = { ...en, actions: en.actions.map((a, k) => ({ ...a, source: sources[k]! })) };
  (script.steps[0].beat[3] as { voice?: string }).voice = "af_bella";
  const restored = applyScriptEntries(withSource, script);
  assert.ok(restored.actions.filter((a) => a.type === "spotlight").every((a) => a.durationMode === "auto"));
  assert.ok(restored.actions.filter((a) => a.type === "callout").every((a) => a.durationMode === "auto"));
  assert.equal(restored.actions.find((a) => a.source?.step === "plain" && a.type === "narrate")?.voice, "af_bella");
});

test("recent projects: most recent first, deduped, capped, junk ignored", () => {
  let list = parseRecent([{ dir: "/a", title: "A" }, { dir: "/a" }, null, { title: "no dir" }, { dir: "/b", languages: ["en", 3] }]);
  assert.deepEqual(list.map((r) => r.dir), ["/a", "/b"]);
  assert.deepEqual(list[1].languages, ["en"]);
  list = upsertRecent(list, { dir: "/b", title: "B" }, { touch: true, now: "2026-01-01T00:00:00.000Z" });
  assert.deepEqual(list.map((r) => [r.dir, r.title]), [["/b", "B"], ["/a", "A"]]);
  assert.equal(list[0].lastOpened, "2026-01-01T00:00:00.000Z");
  list = upsertRecent(list, { dir: "/a", lastExport: "2026-02-02T00:00:00.000Z" });
  assert.deepEqual(list.map((r) => r.dir), ["/b", "/a"], "saving/exporting keeps the order");
  assert.equal(list[1].lastExport, "2026-02-02T00:00:00.000Z");
  for (let i = 0; i < 40; i++) list = upsertRecent(list, { dir: `/p${i}` }, { touch: true });
  assert.equal(list.length, RECENT_MAX);
});

test("export plan: script next to the session, make --out <session>/render, never the session itself", () => {
  const p = project([{ id: "n", type: "narrate", timestamp: 1, narrations: { en: "x" } }]);
  const plan = planExport(p, "/home/u/NaraScreen/demo/", { langs: ["en", "hi"], resolution: "1080p", quality: "medium", force: true });
  const paths = renderPaths("/home/u/NaraScreen/demo");
  assert.equal(plan.scriptPath, paths.scriptPath);
  assert.equal(plan.outDir, "/home/u/NaraScreen/demo/render");
  assert.deepEqual(plan.request, {
    command: "make",
    arg: "/home/u/NaraScreen/demo/project.demo-script.json",
    flags: { out: "/home/u/NaraScreen/demo/render", lang: "en,hi", resolution: "1080p", quality: "medium", force: true },
    cwd: "/home/u/NaraScreen/demo",
    tag: "export",
  });
  assert.notEqual(plan.request.flags?.out, "/home/u/NaraScreen/demo");
  assert.equal(paths.audioDir, "/home/u/NaraScreen/demo/render/audio");
  assert.equal(paths.videoPath("hi"), "/home/u/NaraScreen/demo/render/video/final_hi.mp4");
  assert.equal(paths.contactSheet("en"), "/home/u/NaraScreen/demo/render/preview/en/contact.jpg");
});
