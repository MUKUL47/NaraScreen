// Run: node_modules/.bin/tsx --test api/_tests/validate.test.ts
//
// `validate`'s length estimate (scriptSummary) and the plan.targetSec warning
// built on it: the estimate must follow what the renderer really adds to the
// recording. Pure: no browser, no video, no speech engine.

import { test } from "node:test";
import assert from "node:assert/strict";
import { scriptSummary, speechSec, validateScript } from "../validate.ts";
import type { DemoScript } from "../types.ts";

const LINE = "Adding work takes seconds: a title, a priority, and a few details."; // 66 chars ≈ 4.1 s

function script(beat: DemoScript["steps"][number]["beat"], extra: Partial<DemoScript> = {}): DemoScript {
  return {
    version: 1,
    scope: "t",
    baseUrl: "http://localhost:4173",
    defaults: { dwellMs: 1000 },
    steps: [{ id: "s", beat: [{ act: "goto", path: "/" }, ...beat] }],
    ...extra,
  } as DemoScript;
}

const added = (s: DemoScript) => scriptSummary(s).estimatedAddedSec;

test("speech estimate ≈ Kokoro: 0.2 s + 1 s per 16.8 characters, scaled by tts.speed", () => {
  assert.equal(Math.round(speechSec(LINE.length) * 10) / 10, 4.1);
  assert.equal(speechSec(LINE.length, 2), speechSec(LINE.length) / 2);
  assert.equal(speechSec(0), 0);
});

test("a talk-over narration (freeze: false) adds nothing; a freezing one adds its speech", () => {
  const talk = script([{ fx: "narrate", narrate: LINE, freeze: false }]);
  const freeze = script([{ fx: "narrate", narrate: LINE }]);
  assert.equal(added(talk), 0);
  assert.equal(added(freeze), Math.round(speechSec(LINE.length)));
  // the recording and the spoken total are the same for both
  assert.equal(scriptSummary(talk).estimatedRecordingSec, scriptSummary(freeze).estimatedRecordingSec);
  assert.equal(scriptSummary(talk).estimatedNarrationSec, scriptSummary(freeze).estimatedNarrationSec);
  assert.equal(scriptSummary(talk).estimatedVideoSec, scriptSummary(talk).estimatedRecordingSec);
});

test("pause, zoom and cards add what the renderer adds; known skip/speed seconds take time out", () => {
  const s = script(
    [
      { fx: "pause", seconds: 2 },
      { fx: "pause" }, // 3 s
      { fx: "zoom", anchor: { text: "x" }, zoomDuration: 1, zoomHold: 2 }, // 1 + 2 + 1
      { fx: "zoom", anchor: { text: "y" }, zoomDuration: 1, narrate: LINE }, // 1 + speech + 1
    ],
    { outro: { title: "Bye", duration: 4 } } as Partial<DemoScript>,
  );
  const sum = scriptSummary(s);
  assert.equal(sum.estimatedAddedSec, Math.round(2 + 3 + 4 + 2 + speechSec(LINE.length) + 4));
  assert.equal(sum.note, undefined);

  const cut = script([{ fx: "skip", seconds: 3 }, { fx: "speed", seconds: 6, factor: 3 }, { fx: "pause", seconds: 10 }]);
  assert.equal(added(cut), 10 - 3 - 4);
  const unknown = script([{ act: "click", text: "Export" }, { fx: "skip" }, { act: "waitFor", text: "Done" }]);
  assert.match(scriptSummary(unknown).note ?? "", /skip\/speed/);
});

test("plan.targetSec: a talk-over script as long as its recording no longer warns (it was estimated ~1.8× too long)", () => {
  // 6 talk-over narrations over typing: the video is just the recording; every
  // narration used to be counted on top of it (+~28 s here) and the plan warning fired.
  const beat = Array.from({ length: 6 }, (_, k) => [
    { fx: "narrate", narrate: LINE, freeze: false },
    { act: "fill", label: `Field ${k}`, value: "Something long enough to type for a while" },
  ]).flat() as DemoScript["steps"][number]["beat"];
  const recorded = scriptSummary(script(beat)).estimatedRecordingSec;
  const s = script(beat, { plan: { targetSec: recorded } } as Partial<DemoScript>);
  assert.equal(scriptSummary(s).estimatedVideoSec, recorded);
  const { warnings } = validateScript(JSON.parse(JSON.stringify(s)), { dir: process.cwd() });
  assert.ok(!warnings.some((w) => /targetSec/.test(w)), warnings.join("\n"));
  // …while a plan that really is too short still warns
  const long = script([...beat, { fx: "pause", seconds: recorded }], { plan: { targetSec: recorded } } as Partial<DemoScript>);
  assert.ok(validateScript(JSON.parse(JSON.stringify(long)), { dir: process.cwd() }).warnings.some((w) => /targetSec/.test(w)));
});
