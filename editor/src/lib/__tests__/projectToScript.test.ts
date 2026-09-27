import type { FxEntry } from "../../../api/schema";
import type { DemoProject, TimelineAction } from "../../types";
import { migrateProject, newProject } from "../migrateProject";
import { actionIdForPath, projectToScript, MAIN_STEP } from "../projectToScript";
import { mergeCompiledLanguages } from "../../stores/project/detach";
import { assert, compileScript, fs, hasFfmpeg, join, makeAudio, makeVideo, readFixture, REPO, test, tmpDir, type NaraAction } from "./_node";

const beat = (r: ReturnType<typeof projectToScript>) => r.script.steps[0].beat as FxEntry[];
const base = (actions: TimelineAction[], extra: Partial<DemoProject> = {}): DemoProject => ({
  ...newProject({ title: "Test", baseUrl: "", recordingPath: "/s/recordings/recording.mp4", recordingDuration: 20, size: { width: 1600, height: 900 } }),
  actions,
  ...extra,
});

test("every effect kind maps to its fx", () => {
  const p = base([
    { id: "n", type: "narrate", timestamp: 1, narrations: { en: "Hello", hi: "नमस्ते" }, freeze: false, showSubtitles: false, subtitleSize: 40, voice: "af_bella" },
    { id: "z", type: "zoom", timestamp: 2, zoomDuration: 0.5, zoomHold: 1.5, zoomTargets: [{ rect: [10, 10, 100, 50] }] },
    { id: "zt", type: "zoom", timestamp: 2.5, zoomTargets: [{ rect: [10, 10, 100, 50], narrations: { en: "One" }, voice: "am_adam" }, { rect: [200, 10, 100, 50] }], lang: "en" },
    { id: "s", type: "spotlight", timestamp: 3, spotlightRects: [[1, 2, 30, 40]], dimOpacity: 0.5, spotlightFeather: 24, spotlightConverge: 0.6, spotlightPadding: 12, spotlightDuration: 2 },
    { id: "s2", type: "spotlight", timestamp: 6, spotlightRects: [[1, 2, 30, 40], [50, 60, 70, 80]], durationMode: "auto" },
    { id: "b", type: "blur", timestamp: 4, blurRects: [[5, 5, 10, 10]], blurRadius: 30, durationMode: "end" },
    { id: "c", type: "callout", timestamp: 5, calloutStyle: "step-counter", calloutStep: 2, calloutDuration: 2, calloutPanels: [{ text: "Save", texts: { hi: "सहेजें" }, rect: [300, 300, 100, 30], fontSize: 30 }] },
    { id: "lt", type: "callout", timestamp: 5.5, calloutStyle: "lower-third", calloutText: "Banner", calloutDuration: 3 },
    { id: "a", type: "callout", timestamp: 7, calloutStyle: "arrow", calloutText: "Here", calloutPanels: [{ text: "Here", rect: [400, 400, 50, 50], fontSize: 24 }], arrowFrom: "left", arrowColor: "#123456", arrowHighlight: true, arrowHighlightColor: "#abcdef", calloutDuration: 2 },
    { id: "p", type: "pause", timestamp: 8, resumeAfter: 2 },
    { id: "sp", type: "speed", timestamp: 9, speedFactor: 3, speedEndTimestamp: 12 },
    { id: "sk", type: "skip", timestamp: 12.5, skipEndTimestamp: 13.5 },
    { id: "m", type: "mute", timestamp: 14, muteEndTimestamp: 15, disabled: true, note: "later" },
  ], { tts: { ...newProject({ title: "", baseUrl: "", recordingPath: "" }).tts, languages: ["en", "hi"] } });
  const r = projectToScript(p, "/s");
  const e = Object.fromEntries(beat(r).map((x, i) => [r.entryIds[i], x]));
  assert.deepEqual(r.skipped, []);
  assert.deepEqual(e.n, { fx: "narrate", at: 1, narrate: { en: "Hello", hi: "नमस्ते" }, freeze: false, subtitles: false, subtitleSize: 40, voice: "af_bella" });
  assert.deepEqual(e.z, { fx: "zoom", at: 2, rect: [10, 10, 100, 50], zoomDuration: 0.5, zoomHold: 1.5 });
  assert.deepEqual(e.zt, { fx: "zoom", at: 2.5, targets: [{ rect: [10, 10, 100, 50], narrate: { en: "One" }, voice: "am_adam", lang: "en" }, { rect: [200, 10, 100, 50], lang: "en" }] });
  assert.deepEqual(e.s, { fx: "spotlight", at: 3, rect: [1, 2, 30, 40], duration: 2, dimOpacity: 0.5, padding: 12, feather: 24, converge: 0.6 });
  assert.deepEqual(e.s2, { fx: "spotlight", at: 6, rects: [[1, 2, 30, 40], [50, 60, 70, 80]], duration: "auto" });
  assert.deepEqual(e.b, { fx: "blur", at: 4, rect: [5, 5, 10, 10], duration: "end", radius: 30 });
  // a panel's text starts at (x, y): the rect is shifted by the step-counter padding, placement "over"
  assert.deepEqual(e.c, { fx: "callout", at: 5, text: { en: "Save", hi: "सहेजें" }, style: "step-counter", step: 2, duration: 2, rect: [288, 293, 100, 30], placement: "over", fontSize: 30 });
  assert.deepEqual(e.lt, { fx: "callout", at: 5.5, text: "Banner", style: "lower-third", duration: 3 });
  assert.deepEqual(e.a, { fx: "arrow", at: 7, rect: [400, 400, 50, 50], duration: 2, text: "Here", from: "left", color: "#123456", highlight: true, highlightColor: "#abcdef" });
  assert.deepEqual(e.p, { fx: "pause", at: 8, seconds: 2 });
  assert.deepEqual(e.sp, { fx: "speed", at: 9, seconds: 3, factor: 3 });
  assert.deepEqual(e.sk, { fx: "skip", at: 12.5, seconds: 1 });
  assert.deepEqual(e.m, { fx: "mute", at: 14, disabled: true, note: "later", seconds: 1 });
  assert.equal(r.script.steps[0].id, MAIN_STEP);
  assert.deepEqual(r.script.languages, ["en", "hi"]);
  assert.deepEqual(r.script.tts?.voices, { en: "af_heart", hi: "hf_alpha" });
  assert.deepEqual(r.script.source, { video: "/s/recordings/recording.mp4" });
  assert.deepEqual(r.script.output, { resolution: "native", quality: "high" });
  assert.equal(actionIdForPath(r, "steps[0].beat[3].rect"), r.entryIds[3]);
});

test("trim → two skips; outside effects disabled; ranges and overlays clipped", () => {
  const p = base([
    { id: "before", type: "narrate", timestamp: 1, narrations: { en: "x" } },
    { id: "span", type: "spotlight", timestamp: 3, spotlightRects: [[1, 1, 5, 5]], spotlightDuration: 4 },
    { id: "range", type: "speed", timestamp: 2, speedFactor: 2, speedEndTimestamp: 8 },
    { id: "in", type: "pause", timestamp: 6 },
    { id: "after", type: "pause", timestamp: 16 },
  ]);
  const r = projectToScript(p, "/s", { trim: { start: 5, end: 15 }, disabledIds: ["in"] });
  const e = beat(r);
  assert.deepEqual(r.entryIds, ["trim", "before", "range", "span", "in", "trim", "after"]);
  assert.deepEqual(e[0], { fx: "skip", at: 0, seconds: 5, note: "trim start" });
  assert.equal(e[1].disabled, true);
  assert.deepEqual(e[2], { fx: "speed", at: 5, seconds: 3, factor: 2 });
  assert.deepEqual(e[3], { fx: "spotlight", at: 5, rect: [1, 1, 5, 5], duration: 2 });
  assert.equal(e[4].disabled, true, "unticked in the Produce dialog");
  assert.deepEqual(e[5], { fx: "skip", at: 15, seconds: 5, note: "trim end" });
  assert.equal(e[6].disabled, true);
});

test("edge cases: long overlays, music volume 0, frame clamp, late start, empty project, relative paths", () => {
  const p = base([
    { id: "long", type: "blur", timestamp: 1, blurRects: [[0, 0, 10, 10]], blurDuration: 500 },
    { id: "long2", type: "callout", timestamp: 1, calloutStyle: "lower-third", calloutText: "t", calloutDuration: 130 },
    { id: "out", type: "spotlight", timestamp: 2, spotlightRects: [[1550, 850, 100, 100]], spotlightDuration: 1 },
    { id: "late", type: "pause", timestamp: 20 },
    { id: "norect", type: "zoom", timestamp: 3 },
    { id: "silent", type: "narrate", timestamp: 3, narrations: { en: "  " } },
  ], { recordingDuration: 200, music: { path: "music.mp3", volume: 0, duckTo: 0.2 }, recordingPath: "recordings/r.mp4" });
  const r = projectToScript(p, "/sess/");
  const e = Object.fromEntries(beat(r).map((x, i) => [r.entryIds[i], x]));
  assert.equal(e.long.duration, "end", "reaches the end → end");
  assert.equal(e.long2.duration, 120, "clamped to the schema max");
  assert.deepEqual(e.out.rect, [1550, 850, 50, 50]);
  assert.equal(e.late.at, 20);
  assert.equal(r.script.music, undefined);
  assert.deepEqual(r.skipped.map((s) => s.id).sort(), ["norect", "silent"]);
  assert.equal(r.script.source?.video, "/sess/recordings/r.mp4");
  const empty = projectToScript(base([]), "/s");
  assert.deepEqual(beat(empty), [{ fx: "pause", at: 0, disabled: true, note: "placeholder: this video has no effects yet" }]);
  const late = projectToScript(base([{ id: "l", type: "pause", timestamp: 25 }]), "/s");
  assert.equal(beat(late)[0].at, 19.95);
});

test("multi-language text, recorded audio per language, cards and plan", () => {
  const p = base([
    { id: "n", type: "narrate", timestamp: 1, narrations: { en: "Hi" }, customAudioPath: "/a/all.wav", customAudioPaths: { hi: "/a/hi.wav" } },
    { id: "c", type: "callout", timestamp: 2, calloutStyle: "label", calloutText: "Hello", calloutTexts: { hi: "नमस्ते", xx: "?" } },
  ], {
    tts: { ...newProject({ title: "", baseUrl: "", recordingPath: "" }).tts, languages: ["en", "hi"], voices: { hi: ["hm_omega"] } },
    intro: { title: { en: "Welcome", hi: "स्वागत" }, template: "bold", logo: "logo.png", accent: "#4F46E5" },
    outro: { title: "  " },
    plan: { audience: "devs", targetSec: 60 },
  });
  const r = projectToScript(p, "/s");
  const e = beat(r);
  assert.deepEqual(e[0].audio, { en: "/a/all.wav", hi: "/a/hi.wav" });
  assert.deepEqual(e[1].text, { en: "Hello", hi: "नमस्ते" });
  assert.ok(r.warnings.some((w) => /unknown language "xx"/.test(w)));
  assert.deepEqual(r.script.tts?.voices, { en: "af_heart", hi: "hm_omega" });
  assert.deepEqual(r.script.intro, { title: { en: "Welcome", hi: "स्वागत" }, template: "bold", logo: "/s/logo.png", accent: "#4F46E5" });
  assert.equal(r.script.outro, undefined);
  assert.deepEqual(r.script.plan, { audience: "devs", targetSec: 60 });
  const one = projectToScript(p, "/s", { langs: ["hi"], resolution: "720p", quality: "low" });
  assert.deepEqual(one.script.languages, ["hi"]);
  assert.deepEqual(one.script.output, { resolution: "720p", quality: "low" });
});

// ─── round trips through the real validator and compiler ─────────────

/** What must survive script → compile, per action. */
function essence(a: NaraAction | TimelineAction) {
  const x = a as TimelineAction;
  const o: Record<string, unknown> = { type: x.type, t: x.timestamp };
  const rects = x.spotlightRects ?? x.blurRects ?? x.zoomTargets?.map((t) => t.rect) ?? (x.zoomRect ? [x.zoomRect] : undefined);
  if (rects) o.rects = rects;
  for (const k of ["spotlightDuration", "blurDuration", "calloutDuration", "speedEndTimestamp", "skipEndTimestamp", "muteEndTimestamp", "speedFactor", "freeze", "dimOpacity", "spotlightFeather", "spotlightConverge", "blurRadius", "zoomDuration", "zoomHold", "calloutStyle", "calloutStep", "arrowFrom", "arrowColor", "arrowHighlight", "resumeAfter"] as const) {
    if (x[k] != null) o[k] = x[k];
  }
  if (x.calloutPanels) o.panels = x.calloutPanels.map((p) => [p.rect[0], p.rect[1], p.fontSize, p.text]);
  else if (x.calloutText) o.text = x.calloutText;
  if (x.narrations) o.narrations = x.narrations;
  return o;
}

test("acme desktop session: script validates, and compiles back to the same actions", () => {
  if (!hasFfmpeg()) return;
  const dir = tmpDir("acme");
  fs.mkdirSync(join(dir, "recordings"), { recursive: true });
  makeVideo(join(dir, "recordings/recording.mp4"), 1600, 900, 25.77);
  const music = makeAudio(join(dir, "music.wav"));
  const project = migrateProject(readFixture("acme-tasks-tour.demo-project.json", { __SESSION__: dir, __MUSIC__: music }));
  const r = projectToScript(project, dir);
  assert.deepEqual(r.warnings, []);
  const { actions, warnings, validateWarnings } = compileScript(r.script, dir, 25.77);
  assert.deepEqual(validateWarnings, []);
  assert.deepEqual(warnings, []);
  const music0 = actions.find((a) => a.type === "music")!;
  assert.deepEqual([music0.musicPath, music0.musicVolume, music0.musicDuckTo], [music, 0.1, 0.04]);
  assert.deepEqual(actions.filter((a) => a.type !== "music").map(essence), project.actions.map(essence));
  fs.rmSync(dir, { recursive: true, force: true });
});

test("spotlight job's compiled project (detach case): validates and compiles back unchanged", () => {
  if (!hasFfmpeg()) return;
  const dir = tmpDir("job");
  fs.mkdirSync(join(dir, "recordings"), { recursive: true });
  makeVideo(join(dir, "recordings/recording.mp4"), 1600, 900, 10.9);
  const project = migrateProject(readFixture("spotlight-job.demo-project.en.json", { __JOB__: dir }));
  const r = projectToScript(project, dir);
  assert.deepEqual(r.skipped, []);
  const { actions } = compileScript(r.script, dir, 10.9);
  assert.deepEqual(actions.map(essence), project.actions.map(essence));
  fs.rmSync(dir, { recursive: true, force: true });
});

test("legacy desktop file: trims, languages and all — the validator accepts it", () => {
  if (!hasFfmpeg()) return;
  const dir = tmpDir("legacy");
  fs.mkdirSync(join(dir, "recordings"), { recursive: true });
  makeVideo(join(dir, "recordings/recording.mp4"), 1600, 900, 30);
  const music = makeAudio(join(dir, "music.wav"));
  const project = migrateProject(readFixture("legacy-desktop.demo-project.json", { __SESSION__: dir, __MUSIC__: music }), { recordingSize: { width: 1600, height: 900 } });
  const r = projectToScript(project, dir, { trim: { start: 1, end: 28 } });
  const { actions } = compileScript(r.script, dir, 30, "hi");
  assert.ok(actions.some((a) => a.type === "narrate" && a.narrations?.hi === "डेमो में आपका स्वागत है।"));
  // the trim start became a cut
  assert.ok(actions.some((a) => a.type === "skip" && a.timestamp === 0 && a.skipEndTimestamp === 1));
  assert.deepEqual(r.skipped, []);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("every real sample job (all its languages merged, as Detach does) converts to a valid script", () => {
  const root = join(REPO, "narascreen-out/samples");
  if (!fs.existsSync(root) || !hasFfmpeg()) return;
  const jobs: string[] = [];
  for (const n of fs.readdirSync(root)) {
    if (fs.existsSync(join(root, n, "job/job.json"))) jobs.push(join(root, n, "job"));
    const sub = join(root, n);
    if (!n.includes(".")) for (const m of fs.readdirSync(sub)) if (fs.existsSync(join(sub, m, "job/job.json"))) jobs.push(join(sub, m, "job"));
  }
  assert.ok(jobs.length > 3);
  for (const job of jobs) {
    const byLang: Record<string, DemoProject> = {};
    for (const f of fs.readdirSync(job)) {
      const m = /^demo-project\.([\w-]+)\.json$/.exec(f);
      if (m) byLang[m[1]] = migrateProject(JSON.parse(fs.readFileSync(join(job, f), "utf8")));
    }
    const langs = Object.keys(byLang);
    if (!langs.length || !fs.existsSync(byLang[langs[0]].recordingPath)) continue;
    const primary = langs.includes("en") ? "en" : langs[0];
    const merged = mergeCompiledLanguages(byLang, primary);
    const r = projectToScript(merged, job);
    for (const lang of langs) {
      const { actions } = compileScript(r.script, job, merged.recordingDuration, lang);
      // Other languages' "auto" overlay durations were baked into their own seconds; without the
      // script (applyScriptEntries) the detached project carries the primary language's.
      const strip = (o: Record<string, unknown>) => (lang === primary ? o : { ...o, spotlightDuration: 0, calloutDuration: 0, blurDuration: 0 });
      const want = byLang[lang].actions.map(essence).map(strip);
      assert.deepEqual(actions.filter((a) => a.type !== "music").map(essence).map(strip), want, `${job} [${lang}]`);
    }
  }
});
