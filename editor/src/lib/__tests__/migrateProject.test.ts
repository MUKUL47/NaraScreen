import type { DemoProject } from "../../types";
import { migrateProject, migrateProjectWithReport, newProject } from "../migrateProject";
import { assert, fs, join, readFixture, REPO, test } from "./_node";

const vars = { __SESSION__: "/s/acme", __MUSIC__: "/s/music.mp3", __JOB__: "/s/job" };
const acme = () => readFixture("acme-tasks-tour.demo-project.json", vars);
const legacy = () => readFixture("legacy-desktop.demo-project.json", vars);
const job = () => readFixture("spotlight-job.demo-project.en.json", vars);
const byId = (p: DemoProject, id: string) => p.actions.find((a) => a.id === id)!;

test("desktop session fixture: music action → project.music, projectVersion 2, nothing else touched", () => {
  const raw = acme() as DemoProject;
  const { project, changes, warnings } = migrateProjectWithReport(raw);
  assert.deepEqual(project.music, { path: "/s/music.mp3", volume: 0.1, duckTo: 0.04 });
  assert.equal(project.actions.some((a) => a.type === "music"), false);
  assert.equal(project.actions.length, 14);
  assert.equal(project.projectVersion, 2);
  assert.deepEqual(warnings, []);
  assert.ok(changes.includes("music action → project music"));
  // explicit freezes stay as they were (action-7 talks over the video)
  assert.equal(byId(project, "action-7").freeze, false);
  assert.equal(byId(project, "action-3").freeze, true);
  // untouched fields
  assert.deepEqual(byId(project, "action-2").spotlightRects, [[1039, 162, 389, 181]]);
  assert.equal(byId(project, "action-5").calloutStyle, "arrow");
  assert.deepEqual(project.viewport, { width: 1600, height: 900 });
});

test("job fixture (compiled demo-project.en.json) loads unchanged apart from the version", () => {
  const raw = job() as DemoProject;
  const { project, changes } = migrateProjectWithReport(raw);
  assert.deepEqual(changes, ["projectVersion 2"]);
  assert.deepEqual(project.actions, raw.actions);
  assert.deepEqual(project.tts, raw.tts);
});

test("legacy desktop file: every deprecated shape is rewritten", () => {
  const { project: p, warnings } = migrateProjectWithReport(legacy());
  // music: first action wins, the extra one is reported
  assert.deepEqual(p.music, { path: "/s/music.mp3", volume: 0.5, duckTo: 0.12 });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /1 extra music track/);
  // narration / narration_hi → narrations; playFor dropped; old narrates keep freeze false
  const n = byId(p, "action-001");
  assert.deepEqual(n.narrations, { en: "Welcome to the demo.", hi: "डेमो में आपका स्वागत है।" });
  assert.equal("narration" in n || "narration_hi" in n || "playFor" in n, false);
  assert.equal(n.freeze, false);
  assert.equal(byId(p, "action-011").freeze, true, "an explicit freeze stays");
  // zoomRect + zoom-level narration → first target
  const z = byId(p, "action-002");
  assert.deepEqual(z.zoomTargets, [{ rect: [3, 48, 746, 114], narrations: { en: "Up top is the toolbar." }, audioPath: { en: "/s/acme/audio/action-002_en.wav" } }]);
  assert.equal("zoomRect" in z || "narrations" in z || "audioPath" in z, false);
  assert.deepEqual(byId(p, "action-014").zoomTargets, [{ rect: [616, 461, 753, 250] }, { rect: [1307, 820, 314, 150] }]);
  // pause "narration" → 3 s; spotlightRect → spotlightRects
  assert.equal(byId(p, "action-003").resumeAfter, 3);
  assert.deepEqual(byId(p, "action-004").spotlightRects, [[1281, 114, 268, 85]]);
  assert.equal("spotlightRect" in byId(p, "action-004"), false);
  // legacy callout position is still rendered: kept
  assert.deepEqual(byId(p, "action-005").calloutPosition, [534, 131]);
  // actions sorted by time, no music actions left
  assert.deepEqual(p.actions.map((a) => a.timestamp), [...p.actions.map((a) => a.timestamp)].sort((a, b) => a - b));
  assert.equal(p.actions.some((a) => a.type === "music"), false);
});

test("viewport and output size come from the real recording (D29)", () => {
  const p = migrateProject(legacy(), { recordingSize: { width: 1600, height: 900 } });
  assert.deepEqual(p.viewport, { width: 1600, height: 900 });
  assert.equal(p.output.width, 1600);
  assert.equal(p.output.height, 900);
  const q = migrateProject({ ...(legacy() as object), recordingDuration: 0 }, { recordingDuration: 12.5 });
  assert.equal(q.recordingDuration, 12.5);
});

test("migration is idempotent", () => {
  for (const raw of [acme(), legacy(), job()]) {
    const once = migrateProject(raw, { recordingSize: { width: 1600, height: 900 } });
    const twice = migrateProjectWithReport(structuredClone(once), { recordingSize: { width: 1600, height: 900 } });
    assert.deepEqual(twice.project, once);
    assert.deepEqual(twice.changes, []);
  }
});

test("v2 files keep an unset narrate freeze unset (the API default, true)", () => {
  const p = migrateProject({ ...newProject({ title: "t", baseUrl: "", recordingPath: "/r.mp4" }), actions: [{ id: "a", type: "narrate", timestamp: 1, narrations: { en: "hi" } }] });
  assert.equal(p.actions[0].freeze, undefined);
});

test("broken input: junk actions dropped, ids made unique, required fields filled", () => {
  const { project, warnings } = migrateProjectWithReport({
    actions: [
      { id: "x", type: "zoom", timestamp: -3 },
      { id: "x", type: "pause", timestamp: "nope" },
      { type: "teleport", timestamp: 1 },
      null,
      { type: "skip", timestamp: 2, skipEndTimestamp: 3 },
    ],
  });
  assert.equal(project.title, "Untitled");
  assert.deepEqual(project.viewport, { width: 1920, height: 1080 });
  assert.equal(project.actions.length, 3);
  assert.equal(new Set(project.actions.map((a) => a.id)).size, 3);
  assert.equal(project.actions[0].timestamp, 0);
  assert.equal(warnings.length, 2);
  assert.throws(() => migrateProject("[]"), /not a JSON object/);
  assert.throws(() => migrateProject([]), /not a JSON object/);
});

test("every real sample job's compiled project migrates (read-only scan)", () => {
  const root = join(REPO, "narascreen-out/samples");
  if (!fs.existsSync(root)) return;
  const files: string[] = [];
  const walk = (d: string, depth: number) => {
    for (const n of fs.readdirSync(d)) {
      const p = join(d, n);
      if (/^demo-project(\.[\w-]+)?\.json$/.test(n)) files.push(p);
      else if (depth < 3 && !n.includes(".")) walk(p, depth + 1);
    }
  };
  walk(root, 0);
  assert.ok(files.length > 0);
  for (const f of files) {
    const raw = JSON.parse(fs.readFileSync(f, "utf8")) as DemoProject;
    const p = migrateProject(raw);
    assert.equal(p.projectVersion, 2, f);
    assert.equal(p.actions.length, raw.actions.filter((a) => a.type !== "music").length, f);
  }
});
