// Recording fingerprint (job.ts): what forces a re-record.
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it } from "node:test";
import { structureHash } from "../job";
import type { DemoScript } from "../schema";

describe("structureHash and upload files", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "narascreen-job-"));
  const file = path.join(dir, "comp-sheet.xlsx");
  const script = (): DemoScript => ({
    version: 1,
    scope: "upload",
    baseUrl: "http://127.0.0.1:9",
    viewport: { width: 1440, height: 900 },
    steps: [{ id: "s", beat: [{ act: "goto", path: "/" }, { act: "upload", css: "input[type=file]", files: [file] }] }],
  }) as DemoScript;

  it("same path with changed bytes → a different hash (re-record)", () => {
    fs.writeFileSync(file, "v1");
    const a = structureHash(script());
    assert.equal(structureHash(script()), a, "stable for the same bytes");
    fs.writeFileSync(file, "v2");
    assert.notEqual(structureHash(script()), a);
  });

  it("a single path and a one-item list fingerprint the same", () => {
    fs.writeFileSync(file, "v3");
    const single = script();
    (single.steps[0].beat[1] as { files: unknown }).files = file;
    assert.equal(structureHash(single), structureHash(script()));
  });
});

describe("serve start-up cache cleanup", () => {
  it("removes runs, inspect and job audio/preview; keeps scripts, uploads, recordings, videos and locked jobs", async () => {
    const { cleanWorkspaceCache } = await import("../server");
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "narascreen-ws-"));
    const put = (rel: string, body = "x") => {
      fs.mkdirSync(path.dirname(path.join(ws, rel)), { recursive: true });
      fs.writeFileSync(path.join(ws, rel), body);
    };
    put("runs/r_1.json");
    put("runs/r_1.events.ndjson");
    put("inspect/20260101/shot.png", "12345");
    put("scripts/demo.demo-script.json");
    put("uploads/sheet.xlsx");
    for (const j of ["a", "busy"]) {
      put(`jobs/${j}/audio/tts_1.wav`);
      put(`jobs/${j}/preview/en/contact.jpg`);
      put(`jobs/${j}/recordings/recording.mp4`);
      put(`jobs/${j}/video/final_en.mp4`);
      put(`jobs/${j}/job.json`);
    }
    put("jobs/busy/.lock", `${process.pid}:0`); // held by a live process
    const c = cleanWorkspaceCache(ws);
    assert.equal(c.runs, 2);
    assert.equal(c.inspect, 1);
    assert.equal(c.jobs, 1);
    assert.deepEqual(c.skippedLocked, [path.join(ws, "jobs", "busy")]);
    assert.ok(c.bytes >= 8);
    const exists = (rel: string) => fs.existsSync(path.join(ws, rel));
    assert.deepEqual(fs.readdirSync(path.join(ws, "runs")), []);
    assert.deepEqual(fs.readdirSync(path.join(ws, "inspect")), []);
    for (const gone of ["jobs/a/audio", "jobs/a/preview"]) assert.ok(!exists(gone), gone);
    for (const kept of ["scripts/demo.demo-script.json", "uploads/sheet.xlsx", "jobs/a/recordings/recording.mp4", "jobs/a/video/final_en.mp4", "jobs/a/job.json", "jobs/busy/audio/tts_1.wav"]) {
      assert.ok(exists(kept), kept);
    }
    // Empty / missing workspace: nothing to do, no throw.
    assert.deepEqual(cleanWorkspaceCache(path.join(ws, "nope")), { runs: 0, inspect: 0, jobs: 0, skippedLocked: [], bytes: 0 });
  });
});
