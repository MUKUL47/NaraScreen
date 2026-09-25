// Run: node_modules/.bin/tsx --test api/_tests/compiler.test.ts
//
// The compiler is pure, so these tests need NO video and NO Playwright — just a
// hand-written script + a hand-written trace (+ fake narration clips, whose
// only relevant property is their duration). This is the spine's safety net.

import { test } from "node:test";
import assert from "node:assert/strict";
import { compile, CompileError, modelTimeline } from "../compiler.ts";
import { AgentError } from "../errors.ts";
import type { NarrationClip } from "../narration.ts";
import type { DemoScript, NaraAction, TraceEntry } from "../types.ts";

function baseScript(steps: DemoScript["steps"]): DemoScript {
  return {
    version: 1,
    scope: "test",
    baseUrl: "http://localhost:4173",
    viewport: { width: 1440, height: 900 },
    defaults: {},
    steps,
  };
}

/** Fake clips: key `${step}:${entry}` → seconds. */
function clips(spec: Record<string, number>, lang = "en"): Map<string, NarrationClip> {
  const m = new Map<string, NarrationClip>();
  for (const [key, durationSec] of Object.entries(spec)) {
    const [step, entry] = key.split(":");
    m.set(key, {
      key, step, entry: Number(entry), lang, voice: "af_heart", speed: 1, text: "x",
      audioPath: `/audio/${step}_${entry}.wav`, durationSec, cached: false,
    });
  }
  return m;
}

const R: [number, number, number, number] = [100, 100, 200, 50];
const byName = (actions: NaraAction[], name: string) => {
  const a = actions.find((x) => x.name === name);
  assert.ok(a, `no action named ${name}: ${actions.map((x) => x.name).join(", ")}`);
  return a!;
};

test("zoom: emits zoomRect at the slot's timestamp with default duration/hold", () => {
  const script = baseScript([
    {
      id: "b1",
      beat: [
        { act: "fill", label: "Project name", value: "Acme HQ" },
        { fx: "zoom" },
      ],
    },
  ]);
  const trace: TraceEntry[] = [
    { beat: "b1", i: 0, kind: "act", act: "fill", t: 12.4, rect: [220, 140, 300, 40] },
    { beat: "b1", i: 1, kind: "fx", fx: "zoom", t: 14.1, rect: [220, 140, 300, 40] },
  ];

  const [a, ...rest] = compile(script, trace);
  assert.equal(rest.length, 0, "only the fx entry produces an action");
  assert.equal(a.type, "zoom");
  assert.equal(a.timestamp, 14.1);
  assert.deepEqual(a.zoomRect, [220, 140, 300, 40]);
  assert.equal(a.zoomTargets, undefined);
  assert.equal(a.zoomDuration, 0.8); // builtin default
  assert.equal(a.zoomHold, 2.0);
});

test("per-fx overrides beat the defaults", () => {
  const script = baseScript([
    { id: "b1", beat: [{ act: "click", text: "x" }, { fx: "zoom", zoomHold: 5 }] },
  ]);
  const trace: TraceEntry[] = [
    { beat: "b1", i: 0, kind: "act", act: "click", t: 1, rect: [0, 0, 10, 10] },
    { beat: "b1", i: 1, kind: "fx", fx: "zoom", t: 2, rect: [0, 0, 10, 10] },
  ];
  const [a] = compile(script, trace);
  assert.equal(a.zoomHold, 5);
  assert.equal(a.zoomDuration, 0.8); // untouched default
});

test("script.defaults override builtins", () => {
  const script = { ...baseScript([
    { id: "b1", beat: [{ act: "click", text: "x" }, { fx: "zoom" }] },
  ]), defaults: { zoomHold: 3.3 } };
  const trace: TraceEntry[] = [
    { beat: "b1", i: 0, kind: "act", act: "click", t: 1, rect: [0, 0, 10, 10] },
    { beat: "b1", i: 1, kind: "fx", fx: "zoom", t: 2, rect: [0, 0, 10, 10] },
  ];
  const [a] = compile(script, trace);
  assert.equal(a.zoomHold, 3.3);
});

test("spotlight: wraps rect in an array, defaults dim, explicit duration as-is", () => {
  const script = baseScript([
    { id: "b1", beat: [{ fx: "spotlight", anchor: { text: "Acme HQ" }, duration: 4 }] },
  ]);
  const trace: TraceEntry[] = [
    { beat: "b1", i: 0, kind: "fx", fx: "spotlight", t: 9, rect: [180, 260, 640, 44] },
  ];
  const [a] = compile(script, trace);
  assert.equal(a.type, "spotlight");
  assert.deepEqual(a.spotlightRects, [[180, 260, 640, 44]]);
  assert.equal(a.dimOpacity, 0.7);
  assert.equal(a.spotlightDuration, 4);
});

test("callout lower-third: no position (producer centers it)", () => {
  const script = baseScript([
    { id: "b1", beat: [{ fx: "callout", style: "lower-third", text: "Project settings" }] },
  ]);
  const trace: TraceEntry[] = [
    { beat: "b1", i: 0, kind: "fx", fx: "callout", t: 3 }, // no rect — fine for lower-third
  ];
  const [a] = compile(script, trace);
  assert.equal(a.calloutText, "Project settings");
  assert.equal(a.calloutStyle, "lower-third");
  assert.equal(a.calloutPosition, undefined);
});

test("callout label: anchored rect → calloutPosition top-left", () => {
  const script = baseScript([
    { id: "b1", beat: [{ fx: "callout", style: "label", text: "Toggle" }] },
  ]);
  const trace: TraceEntry[] = [
    { beat: "b1", i: 0, kind: "fx", fx: "callout", t: 3, rect: [500, 320, 60, 30] },
  ];
  const [a] = compile(script, trace);
  assert.deepEqual(a.calloutPosition, [500, 320]);
});

test("blur: array + defaults", () => {
  const script = baseScript([
    { id: "b1", beat: [{ fx: "blur", anchor: { label: "API key" } }] },
  ]);
  const trace: TraceEntry[] = [
    { beat: "b1", i: 0, kind: "fx", fx: "blur", t: 5, rect: [10, 20, 100, 40] },
  ];
  const [a] = compile(script, trace);
  assert.deepEqual(a.blurRects, [[10, 20, 100, 40]]);
  assert.equal(a.blurRadius, 20);
  assert.equal(a.blurDuration, 3);
});

test("narrate: emits narrations keyed by lang, freezes by default", () => {
  const script = baseScript([
    { id: "b1", beat: [{ fx: "narrate", narrate: "Here we create a project." }] },
  ]);
  const trace: TraceEntry[] = [
    { beat: "b1", i: 0, kind: "fx", fx: "narrate", t: 5 },
  ];
  const [a] = compile(script, trace);
  assert.equal(a.type, "narrate");
  assert.equal(a.timestamp, 5);
  assert.deepEqual(a.narrations, { en: "Here we create a project." });
  assert.equal(a.freeze, true);
  assert.equal(a.audioPath, undefined, "no clips given → no audio attached");
});

// playFor was dropped from the schema (freeze:false covers "keep playing").
test("narrate: respects forced lang + freeze:false", () => {
  const script = baseScript([
    { id: "b1", beat: [{ fx: "narrate", narrate: "नमस्ते", lang: "hi", freeze: false }] },
  ]);
  const trace: TraceEntry[] = [{ beat: "b1", i: 0, kind: "fx", fx: "narrate", t: 1 }];
  const [a] = compile(script, trace);
  assert.deepEqual(a.narrations, { hi: "नमस्ते" });
  assert.equal(a.freeze, false);
});

test("narrate: per-language map → compile lang picks the text", () => {
  const script = baseScript([
    { id: "b1", beat: [{ fx: "narrate", narrate: { en: "Hello", hi: "नमस्ते" } }] },
  ]);
  const trace: TraceEntry[] = [{ beat: "b1", i: 0, kind: "fx", fx: "narrate", t: 1 }];
  const [en] = compile(script, trace, "en");
  assert.deepEqual(en.narrations, { en: "Hello" });
  const [hi] = compile(script, trace, "hi");
  assert.deepEqual(hi.narrations, { hi: "नमस्ते" });
});

test("narrate: map missing the requested lang → falls back to en", () => {
  const script = baseScript([
    { id: "b1", beat: [{ fx: "narrate", narrate: { en: "Hello" } }] },
  ]);
  const trace: TraceEntry[] = [{ beat: "b1", i: 0, kind: "fx", fx: "narrate", t: 1 }];
  const [a] = compile(script, trace, "hi"); // no hi key
  assert.deepEqual(a.narrations, { en: "Hello" });
});

test("narrate: single string uses the compile lang", () => {
  const script = baseScript([
    { id: "b1", beat: [{ fx: "narrate", narrate: "Bonjour" }] },
  ]);
  const trace: TraceEntry[] = [{ beat: "b1", i: 0, kind: "fx", fx: "narrate", t: 1 }];
  const [a] = compile(script, trace, "fr");
  assert.deepEqual(a.narrations, { fr: "Bonjour" });
});

test("narrate without text → CompileError", () => {
  const script = baseScript([{ id: "b1", beat: [{ fx: "narrate" } as any] }]);
  const trace: TraceEntry[] = [{ beat: "b1", i: 0, kind: "fx", fx: "narrate", t: 1 }];
  assert.throws(() => compile(script, trace), /narrate needs text/);
});

// `resumeAfter` in scripts became `seconds` (the action field keeps its name).
test("pause: seconds → resumeAfter", () => {
  const script = baseScript([
    { id: "b1", beat: [{ fx: "pause", seconds: 2 }, { fx: "pause" }] },
  ]);
  const trace: TraceEntry[] = [
    { beat: "b1", i: 0, kind: "fx", fx: "pause", t: 7 },
    { beat: "b1", i: 1, kind: "fx", fx: "pause", t: 8 },
  ];
  const [a, b] = compile(script, trace);
  assert.equal(a.type, "pause");
  assert.equal(a.resumeAfter, 2);
  assert.equal(b.resumeAfter, undefined, "unset → producer default (3 s)");
});

test("output is sorted by timestamp across beats", () => {
  const script = baseScript([
    { id: "b1", beat: [{ fx: "callout", style: "lower-third", text: "first" }] },
    { id: "b2", beat: [{ fx: "callout", style: "lower-third", text: "second" }] },
  ]);
  // deliberately out of order in the trace
  const trace: TraceEntry[] = [
    { beat: "b2", i: 0, kind: "fx", fx: "callout", t: 2 },
    { beat: "b1", i: 0, kind: "fx", fx: "callout", t: 20 },
  ];
  const actions = compile(script, trace);
  assert.deepEqual(actions.map((a) => a.timestamp), [2, 20]);
  assert.equal(actions[0].calloutText, "second");
});

test("ids are unique and sequential", () => {
  const script = baseScript([
    { id: "b1", beat: [
      { act: "click", text: "x" },
      { fx: "zoom" },
      { fx: "spotlight", anchor: { text: "y" } },
    ] },
  ]);
  const trace: TraceEntry[] = [
    { beat: "b1", i: 0, kind: "act", act: "click", t: 1, rect: [0, 0, 1, 1] },
    { beat: "b1", i: 1, kind: "fx", fx: "zoom", t: 2, rect: [0, 0, 1, 1] },
    { beat: "b1", i: 2, kind: "fx", fx: "spotlight", t: 3, rect: [0, 0, 1, 1] },
  ];
  const ids = compile(script, trace).map((a) => a.id);
  assert.deepEqual(new Set(ids).size, ids.length);
});

test("names: every action is named `<step> #<entry> <fx>`", () => {
  const script = baseScript([
    { id: "intro", beat: [{ act: "click", text: "x" }, { fx: "zoom" }, { fx: "narrate", narrate: "Hi" }] },
    { id: "wrap-up", beat: [{ fx: "callout", style: "lower-third", text: "Done" }] },
  ]);
  const trace: TraceEntry[] = [
    { beat: "intro", i: 0, kind: "act", act: "click", t: 1, rect: R },
    { beat: "intro", i: 1, kind: "fx", fx: "zoom", t: 2, rect: R },
    { beat: "intro", i: 2, kind: "fx", fx: "narrate", t: 3 },
    { beat: "wrap-up", i: 0, kind: "fx", fx: "callout", t: 4 },
  ];
  assert.deepEqual(compile(script, trace).map((a) => a.name), ["intro #1 zoom", "intro #2 narrate", "wrap-up #0 callout"]);
});

// ── narration audio ──────────────────────────────────────────

test("narrate + clip: audioPath attached under the narration's language", () => {
  const script = baseScript([{ id: "s", beat: [{ fx: "narrate", narrate: { en: "Hello", hi: "नमस्ते" } }] }]);
  const trace: TraceEntry[] = [{ beat: "s", i: 0, kind: "fx", fx: "narrate", t: 1 }];
  const [a] = compile(script, trace, "hi", clips({ "s:0": 1.2 }, "hi"));
  assert.deepEqual(a.narrations, { hi: "नमस्ते" });
  assert.deepEqual(a.audioPath, { hi: "/audio/s_0.wav" });
  assert.equal(a.freeze, true);
});

test("narrated zoom: zoomTargets with rect/narrations/audio, no zoomRect", () => {
  const script = baseScript([{ id: "s", beat: [{ fx: "zoom", anchor: { text: "Revenue" }, narrate: "Revenue is up.", zoomDuration: 0.6 }] }]);
  const trace: TraceEntry[] = [{ beat: "s", i: 0, kind: "fx", fx: "zoom", t: 4, rect: R }];
  const [a] = compile(script, trace, "en", clips({ "s:0": 2 }));
  assert.equal(a.zoomRect, undefined);
  assert.deepEqual(a.zoomTargets, [{ rect: R, narrations: { en: "Revenue is up." }, audioPath: { en: "/audio/s_0.wav" } }]);
  assert.equal(a.zoomDuration, 0.6);
});

test("clips given but one narration has none → CompileError (never silently unvoiced)", () => {
  const script = baseScript([{ id: "s", beat: [{ fx: "narrate", narrate: "a" }, { fx: "narrate", narrate: "b" }] }]);
  const trace: TraceEntry[] = [
    { beat: "s", i: 0, kind: "fx", fx: "narrate", t: 1 },
    { beat: "s", i: 1, kind: "fx", fx: "narrate", t: 2 },
  ];
  assert.throws(() => compile(script, trace, "en", clips({ "s:0": 1 })), /no narration audio/);
});

// ── auto overlay durations ───────────────────────────────────

test("auto: overlay lasts until the next narration in its step ends (+0.5 s)", () => {
  const script = baseScript([{ id: "s", beat: [
    { fx: "spotlight", anchor: { text: "Tasks" } },
    { fx: "narrate", narrate: "These are your tasks." },
  ] }]);
  const trace: TraceEntry[] = [
    { beat: "s", i: 0, kind: "fx", fx: "spotlight", t: 10, rect: R },
    { beat: "s", i: 1, kind: "fx", fx: "narrate", t: 11.5 },
  ];
  const warnings: string[] = [];
  const [spot] = compile(script, trace, "en", clips({ "s:1": 2.4 }), warnings);
  // (11.5 − 10) + 2.4 + 0.5
  assert.equal(spot.spotlightDuration, 4.4);
  assert.deepEqual(warnings, []);
});

test("auto: \"auto\" literal behaves like unset; freeze:false narration covers the same", () => {
  const script = baseScript([{ id: "s", beat: [
    { fx: "blur", anchor: { label: "API key" }, duration: "auto" },
    { fx: "narrate", narrate: "Keep this secret.", freeze: false },
  ] }]);
  const trace: TraceEntry[] = [
    { beat: "s", i: 0, kind: "fx", fx: "blur", t: 3, rect: R },
    { beat: "s", i: 1, kind: "fx", fx: "narrate", t: 4 },
  ];
  const [blur] = compile(script, trace, "en", clips({ "s:1": 2 }));
  assert.equal(blur.blurDuration, 3.5); // 1 + 2 + 0.5
});

test("auto: freeze inserts between overlay and narration are added (pause = seconds, default 3)", () => {
  const script = baseScript([{ id: "s", beat: [
    { fx: "callout", text: "Look here", anchor: { text: "x" } },
    { fx: "pause", seconds: 2 },
    { fx: "pause" },
    { fx: "narrate", narrate: "Now we talk." },
  ] }]);
  const trace: TraceEntry[] = [
    { beat: "s", i: 0, kind: "fx", fx: "callout", t: 10, rect: R },
    { beat: "s", i: 1, kind: "fx", fx: "pause", t: 11 },
    { beat: "s", i: 2, kind: "fx", fx: "pause", t: 12 },
    { beat: "s", i: 3, kind: "fx", fx: "narrate", t: 12.5 },
  ];
  const [callout] = compile(script, trace, "en", clips({ "s:3": 3 }));
  // (12.5 − 10) + 2 + 3 + (3 + 0.5)
  assert.equal(callout.calloutDuration, 11);
});

test("auto: inserts BEFORE the overlay don't count (the producer shifts its start instead)", () => {
  const script = baseScript([
    { id: "a", beat: [{ fx: "narrate", narrate: "First." }, { fx: "pause", seconds: 4 }] },
    { id: "b", beat: [{ fx: "spotlight", anchor: { text: "x" } }, { fx: "narrate", narrate: "Second." }] },
  ]);
  const trace: TraceEntry[] = [
    { beat: "a", i: 0, kind: "fx", fx: "narrate", t: 2 },
    { beat: "a", i: 1, kind: "fx", fx: "pause", t: 3 },
    { beat: "b", i: 0, kind: "fx", fx: "spotlight", t: 5, rect: R },
    { beat: "b", i: 1, kind: "fx", fx: "narrate", t: 6 },
  ];
  const actions = compile(script, trace, "en", clips({ "a:0": 2, "b:1": 1 }));
  assert.equal(byName(actions, "b #0 spotlight").spotlightDuration, 2.5); // 1 + 1 + 0.5
});

test("auto: a narration in ANOTHER step is not waited for → 3 s", () => {
  const script = baseScript([
    { id: "a", beat: [{ fx: "spotlight", anchor: { text: "x" } }] },
    { id: "b", beat: [{ fx: "narrate", narrate: "Later." }] },
  ]);
  const trace: TraceEntry[] = [
    { beat: "a", i: 0, kind: "fx", fx: "spotlight", t: 5, rect: R },
    { beat: "b", i: 0, kind: "fx", fx: "narrate", t: 9 },
  ];
  const [spot] = compile(script, trace, "en", clips({ "b:0": 2 }));
  assert.equal(spot.spotlightDuration, 3);
});

test("auto: no narration → 3 s; without clips → 3 s", () => {
  const script = baseScript([{ id: "s", beat: [
    { fx: "spotlight", anchor: { text: "x" } },
    { fx: "narrate", narrate: "Hi." },
  ] }]);
  const trace: TraceEntry[] = [
    { beat: "s", i: 0, kind: "fx", fx: "spotlight", t: 1, rect: R },
    { beat: "s", i: 1, kind: "fx", fx: "narrate", t: 2 },
  ];
  assert.equal(compile(script, trace)[0].spotlightDuration, 3);
  const lone = baseScript([{ id: "s", beat: [{ fx: "callout", style: "lower-third", text: "Hi" }] }]);
  assert.equal(compile(lone, [{ beat: "s", i: 0, kind: "fx", fx: "callout", t: 1 }], "en", clips({}))[0].calloutDuration, 3);
});

test("auto: zoom stop rule — a zoom between overlay and narration ends the overlay at the zoom (+warning)", () => {
  const script = baseScript([{ id: "s", beat: [
    { fx: "spotlight", anchor: { text: "x" } },
    { fx: "pause", seconds: 1 },
    { fx: "zoom" },
    { fx: "narrate", narrate: "Zoomed." },
  ] }]);
  const trace: TraceEntry[] = [
    { beat: "s", i: 0, kind: "fx", fx: "spotlight", t: 10, rect: R },
    { beat: "s", i: 1, kind: "fx", fx: "pause", t: 10.5 },
    { beat: "s", i: 2, kind: "fx", fx: "zoom", t: 11.5, rect: R },
    { beat: "s", i: 3, kind: "fx", fx: "narrate", t: 13 },
  ];
  const warnings: string[] = [];
  const [spot] = compile(script, trace, "en", clips({ "s:3": 2 }), warnings);
  assert.equal(spot.spotlightDuration, 2.45); // (11.5 − 10) + 1 (pause) − 0.05
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /steps\[0\]\.beat\[0\].*stops at the zoom at steps\[0\]\.beat\[2\]/);
});

test("auto: zoom stop rule — the narrating entry itself is a zoom", () => {
  const script = baseScript([{ id: "s", beat: [
    { fx: "blur", anchor: { text: "secret" } },
    { fx: "zoom", narrate: "Look closer." },
  ] }]);
  const trace: TraceEntry[] = [
    { beat: "s", i: 0, kind: "fx", fx: "blur", t: 10, rect: R },
    { beat: "s", i: 1, kind: "fx", fx: "zoom", t: 11, rect: R },
  ];
  const warnings: string[] = [];
  const [blur] = compile(script, trace, "en", clips({ "s:1": 3 }), warnings);
  assert.equal(blur.blurDuration, 0.95);
  assert.match(warnings[0], /unblurred/);
});

test("auto: lower-third callouts are not rect-bound, so they run through a narrated zoom", () => {
  const script = baseScript([{ id: "s", beat: [
    { fx: "callout", style: "lower-third", text: "Revenue" },
    { fx: "zoom", narrate: "Revenue grew." },
  ] }]);
  const trace: TraceEntry[] = [
    { beat: "s", i: 0, kind: "fx", fx: "callout", t: 10 },
    { beat: "s", i: 1, kind: "fx", fx: "zoom", t: 11, rect: R },
  ];
  const warnings: string[] = [];
  const [c] = compile(script, trace, "en", clips({ "s:1": 2 }), warnings);
  // 1 + zoom-in 0.8 + clip 2 + 0.5 (within the 0.8 + 2 + 0.8 zoom)
  assert.equal(c.calloutDuration, 4.3);
  assert.deepEqual(warnings, []);
});

test("auto: capped at the next overlay of the same type", () => {
  const script = baseScript([{ id: "s", beat: [
    { fx: "spotlight", anchor: { text: "a" } },
    { fx: "spotlight", anchor: { text: "b" } },
    { fx: "narrate", narrate: "Two things." },
  ] }]);
  const trace: TraceEntry[] = [
    { beat: "s", i: 0, kind: "fx", fx: "spotlight", t: 10, rect: R },
    { beat: "s", i: 1, kind: "fx", fx: "spotlight", t: 11, rect: R },
    { beat: "s", i: 2, kind: "fx", fx: "narrate", t: 12 },
  ];
  const warnings: string[] = [];
  const [a, b] = compile(script, trace, "en", clips({ "s:2": 2 }), warnings);
  assert.equal(a.spotlightDuration, 0.95);
  assert.equal(b.spotlightDuration, 3.5); // 1 + 2 + 0.5
  assert.deepEqual(warnings, [], "auto never produces overlapping spotlights");
});

test("auto: never shorter than 0.5 s", () => {
  const script = baseScript([{ id: "s", beat: [
    { fx: "callout", text: "a", anchor: { text: "a" } },
    { fx: "callout", text: "b", anchor: { text: "b" } },
  ] }]);
  const trace: TraceEntry[] = [
    { beat: "s", i: 0, kind: "fx", fx: "callout", t: 10, rect: R },
    { beat: "s", i: 1, kind: "fx", fx: "callout", t: 10.2, rect: R },
  ];
  assert.equal(compile(script, trace)[0].calloutDuration, 0.5);
});

test("explicit blur running into a zoom in its step → warning; overlapping explicit spotlights → warning", () => {
  const script = baseScript([{ id: "s", beat: [
    { fx: "blur", anchor: { text: "secret" }, duration: 5 },
    { fx: "spotlight", anchor: { text: "a" }, duration: 4 },
    { fx: "spotlight", anchor: { text: "b" }, duration: 1 },
    { fx: "zoom" },
  ] }]);
  const trace: TraceEntry[] = [
    { beat: "s", i: 0, kind: "fx", fx: "blur", t: 10, rect: R },
    { beat: "s", i: 1, kind: "fx", fx: "spotlight", t: 10.5, rect: R },
    { beat: "s", i: 2, kind: "fx", fx: "spotlight", t: 12, rect: R },
    { beat: "s", i: 3, kind: "fx", fx: "zoom", t: 13, rect: R },
  ];
  const warnings: string[] = [];
  const actions = compile(script, trace, "en", undefined, warnings);
  assert.equal(byName(actions, "s #0 blur").blurDuration, 5, "explicit durations are kept");
  assert.equal(warnings.length, 2, warnings.join("\n"));
  assert.match(warnings.join("\n"), /beat\[0\] \(blur\).*runs into the zoom/);
  assert.match(warnings.join("\n"), /beat\[1\] \(spotlight\).*SPOTLIGHT_OVERLAP/);
});

// ── the producer's timeline model ────────────────────────────

test("modelTimeline: insert lengths/order match produce.ts", () => {
  const actions: NaraAction[] = [
    { id: "1", type: "narrate", timestamp: 5, narrations: { en: "x" }, audioPath: { en: "/n1.wav" }, freeze: true },
    { id: "2", type: "pause", timestamp: 5 },
    { id: "3", type: "zoom", timestamp: 5, zoomRect: R, zoomDuration: 0.8, zoomHold: 2 },
    { id: "4", type: "narrate", timestamp: 9, narrations: { en: "y" }, audioPath: { en: "/n2.wav" }, freeze: false },
    { id: "5", type: "pause", timestamp: 12, resumeAfter: 1.5 },
  ];
  const tl = modelTimeline(actions, (p) => ({ "/n1.wav": 2.4, "/n2.wav": 2 })[p]);
  // ties at t=5: zoom, then pause, then narrate (the producer's concat order)
  assert.deepEqual(tl.inserts.map((s) => s.action.id), ["3", "2", "1", "4", "5"]);
  assert.deepEqual(tl.inserts.map((s) => round(s.length)), [3.6, 3, 2.4, 2, 1.5]);
  // freeze:false narration: booked +0, really −0.5 (plays clip, skips clip + 0.5)
  assert.deepEqual([tl.inserts[3].added, tl.inserts[3].delta], [0, -0.5]);
  assert.deepEqual(tl.inserts.map((s) => round(s.start)), [5, 8.6, 11.6, 18, 20.5]);
  assert.equal(round(tl.addedSec), 10); // 3.6 + 3 + 2.4 − 0.5 + 1.5
  assert.equal(round(tl.placed(5)), 5, "an overlay AT an insert's timestamp starts before it");
  assert.equal(round(tl.placed(6)), 6 + 9);
});

const round = (x: number) => Math.round(x * 1000) / 1000;

// ── error paths ──────────────────────────────────────────────

test("missing trace entry → CompileError (COMPILE_FAILED) naming the entry", () => {
  const script = baseScript([
    { id: "b1", beat: [{ act: "click", text: "x" }, { fx: "zoom" }] },
  ]);
  const trace: TraceEntry[] = [
    { beat: "b1", i: 0, kind: "act", act: "click", t: 1, rect: [0, 0, 1, 1] },
    // i:1 (the zoom) never reached
  ];
  assert.throws(() => compile(script, trace), (e: Error) => {
    assert.ok(e instanceof CompileError);
    assert.ok(e instanceof AgentError);
    assert.equal((e as CompileError).code, "COMPILE_FAILED");
    assert.deepEqual((e as CompileError).where, { step: "b1", entry: 1, path: "steps[0].beat[1]" });
    assert.match(e.message, /steps\[0\]\.beat\[1\] \(zoom, step "b1"\)/);
    return true;
  });
});

test("trace/script verb mismatch → CompileError", () => {
  const script = baseScript([{ id: "b1", beat: [{ fx: "zoom" }] }]);
  const trace: TraceEntry[] = [
    { beat: "b1", i: 0, kind: "fx", fx: "spotlight", t: 1, rect: [0, 0, 1, 1] },
  ];
  assert.throws(() => compile(script, trace), CompileError);
});

test("zoom without a rect → CompileError (anchor required)", () => {
  const script = baseScript([{ id: "b1", beat: [{ fx: "zoom" }] }]);
  const trace: TraceEntry[] = [{ beat: "b1", i: 0, kind: "fx", fx: "zoom", t: 1 }]; // no rect
  assert.throws(() => compile(script, trace), /needs a rect/);
});

test("callout without text → CompileError", () => {
  const script = baseScript([{ id: "b1", beat: [{ fx: "callout", style: "label" } as any] }]);
  const trace: TraceEntry[] = [
    { beat: "b1", i: 0, kind: "fx", fx: "callout", t: 1, rect: [0, 0, 1, 1] },
  ];
  assert.throws(() => compile(script, trace), /needs text/);
});
