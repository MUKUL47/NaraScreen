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
