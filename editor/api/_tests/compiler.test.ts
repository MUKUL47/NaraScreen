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
      audioPath: `/audio/${key.replace(/:/g, "_")}.wav`, durationSec, cached: false,
    });
  }
  return m;
}

/** A pre-recorded `audio` clip, as synthesizeNarrations returns it. */
function recordedClip(key: string, file: string, durationSec: number, lang = "en", text = ""): NarrationClip {
  const [step, entry] = key.split(":");
  return { key, step, entry: Number(entry), lang, voice: "recorded", speed: 1, text, audioPath: file, durationSec, cached: false };
}

const R: [number, number, number, number] = [100, 100, 200, 50];
const R2: [number, number, number, number] = [400, 300, 120, 40];
const R3: [number, number, number, number] = [700, 500, 90, 30];
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

test("spotlight feather: passed to the renderer only when set", () => {
  const trace: TraceEntry[] = [{ beat: "b1", i: 0, kind: "fx", fx: "spotlight", t: 1, rect: [10, 10, 100, 40] }];
  const soft = compile(baseScript([{ id: "b1", beat: [{ fx: "spotlight", anchor: { text: "A" }, feather: 24, duration: 2 }] }]), trace)[0];
  assert.equal(soft.spotlightFeather, 24);
  const hard = compile(baseScript([{ id: "b1", beat: [{ fx: "spotlight", anchor: { text: "A" }, duration: 2 }] }]), trace)[0];
  assert.equal("spotlightFeather" in hard, false, "no field → the renderer's hard-edge path, as before");
});

test("spotlight padding: grows every lit box, kept inside the frame; no padding = exact box", () => {
  const script = baseScript([
    { id: "b1", beat: [{ fx: "spotlight", anchors: [{ text: "A" }, { text: "B" }], padding: 12, duration: 3 }] },
  ]);
  const trace: TraceEntry[] = [
    { beat: "b1", i: 0, kind: "fx", fx: "spotlight", t: 1, rect: [180, 260, 640, 44], rects: [[180, 260, 640, 44], [1400, 5, 30, 20]] },
  ];
  const [a] = compile(script, trace);
  // second box: 12 px would cross the right (1440) and top (0) edges → clamped
  assert.deepEqual(a.spotlightRects, [[168, 248, 664, 68], [1388, 0, 52, 37]]);
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

// Addendum 1: anchored label callouts became a positioned panel ("above" by
// default) instead of calloutPosition = the element's top-left.
test("callout label: anchored rect → one panel above the element", () => {
  const script = baseScript([
    { id: "b1", beat: [{ fx: "callout", style: "label", text: "Toggle" }] },
  ]);
  const trace: TraceEntry[] = [
    { beat: "b1", i: 0, kind: "fx", fx: "callout", t: 3, rect: [500, 320, 60, 30] },
  ];
  const [a] = compile(script, trace);
  assert.equal(a.calloutPosition, undefined);
  // y = 320 − 28 − 16; width ≈ 0.6 · 28 · 6 chars
  assert.deepEqual(a.calloutPanels, [{ text: "Toggle", rect: [500, 276, 101, 28], fontSize: 28 }]);
});

// Review fix: an unset blur duration means "step-end" (a secret must not be
// unblurred right after the next narration); it used to be "auto" (→ 3 s here).
test("blur: array + defaults (duration unset = until the step ends)", () => {
  const script = baseScript([
    { id: "b1", beat: [{ fx: "blur", anchor: { label: "API key" } }] },
    { id: "b2", beat: [{ fx: "callout", style: "lower-third", text: "Next" }] },
  ]);
  const trace: TraceEntry[] = [
    { beat: "b1", i: 0, kind: "fx", fx: "blur", t: 5, rect: [10, 20, 100, 40] },
    { beat: "b2", i: 0, kind: "fx", fx: "callout", t: 12 },
  ];
  const [a] = compile(script, trace);
  assert.deepEqual(a.blurRects, [[10, 20, 100, 40]]);
  assert.equal(a.blurRadius, 20);
  assert.equal(a.blurDuration, 7);
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
    { fx: "spotlight", anchor: { text: "x" } },
    { fx: "zoom", narrate: "Look closer." },
  ] }]);
  const trace: TraceEntry[] = [
    { beat: "s", i: 0, kind: "fx", fx: "spotlight", t: 10, rect: R },
    { beat: "s", i: 1, kind: "fx", fx: "zoom", t: 11, rect: R },
  ];
  const warnings: string[] = [];
  const [spot] = compile(script, trace, "en", clips({ "s:1": 3 }), warnings);
  assert.equal(spot.spotlightDuration, 0.95);
  assert.match(warnings[0], /stops at the zoom/);
});

// Blur is burned BEFORE the inserts, so its duration is in recording seconds
// and a zoom/freeze cut from a blurred moment is blurred: no stop, no warning.
test("auto blur: in recording seconds, until the narrating zoom's frame + 0.5 s — no zoom stop", () => {
  const script = baseScript([{ id: "s", beat: [
    { fx: "blur", anchor: { text: "secret" }, duration: "auto" },
    { fx: "zoom", narrate: "Look closer." },
  ] }]);
  const trace: TraceEntry[] = [
    { beat: "s", i: 0, kind: "fx", fx: "blur", t: 10, rect: R },
    { beat: "s", i: 1, kind: "fx", fx: "zoom", t: 11, rect: R },
  ];
  const warnings: string[] = [];
  const [blur] = compile(script, trace, "en", clips({ "s:1": 3 }), warnings);
  assert.equal(blur.blurDuration, 1.5);
  assert.deepEqual(warnings, []);
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

test("explicit blur over a zoom: kept, no warning; overlapping explicit spotlights → warning", () => {
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
  // the zoom is cut from the already-blurred video: no blur warning any more
  assert.equal(warnings.length, 1, warnings.join("\n"));
  assert.match(warnings[0], /beat\[1\] \(spotlight\).*SPOTLIGHT_OVERLAP/);
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

// ── Addendum 1: desktop-feature parity ───────────────────────

test("disabled fx are left out — and need no clip or trace entry", () => {
  const script = baseScript([{ id: "s", beat: [
    { fx: "spotlight", anchor: { text: "x" }, disabled: true },
    { fx: "narrate", narrate: "Hidden.", disabled: true },
    { fx: "callout", style: "lower-third", text: "Shown" },
  ] }]);
  const trace: TraceEntry[] = [{ beat: "s", i: 2, kind: "fx", fx: "callout", t: 1 }];
  const actions = compile(script, trace, "en", clips({}));
  assert.deepEqual(actions.map((a) => a.name), ["s #2 callout"]);
});

test("narrate subtitles → showSubtitles / subtitleSize (default on)", () => {
  const script = baseScript([{ id: "s", beat: [
    { fx: "narrate", narrate: "a" },
    { fx: "narrate", narrate: "b", subtitles: false, subtitleSize: 40 },
  ] }]);
  const trace: TraceEntry[] = [
    { beat: "s", i: 0, kind: "fx", fx: "narrate", t: 1 },
    { beat: "s", i: 1, kind: "fx", fx: "narrate", t: 2 },
  ];
  const [a, b] = compile(script, trace);
  assert.equal(a.showSubtitles, true);
  assert.equal(a.subtitleSize, undefined);
  assert.equal(b.showSubtitles, false);
  assert.equal(b.subtitleSize, 40);
});

test("recorded audio: alone → customAudioPath; with text → audioPath + narrations (keeps subtitles)", () => {
  const script = baseScript([{ id: "s", beat: [
    { fx: "spotlight", anchor: { text: "x" } },
    { fx: "narrate", audio: "/rec/intro.mp3" },
    { fx: "narrate", audio: { en: "/rec/en.wav", hi: "/rec/hi.wav" }, narrate: { en: "Hello", hi: "नमस्ते" } },
  ] }]);
  const trace: TraceEntry[] = [
    { beat: "s", i: 0, kind: "fx", fx: "spotlight", t: 1, rect: R },
    { beat: "s", i: 1, kind: "fx", fx: "narrate", t: 2 },
    { beat: "s", i: 2, kind: "fx", fx: "narrate", t: 3 },
  ];
  const cl = new Map([
    ["s:1", recordedClip("s:1", "/rec/intro.mp3", 4, "hi")],
    ["s:2", recordedClip("s:2", "/rec/hi.wav", 2, "hi", "नमस्ते")],
  ]);
  const [spot, a, b] = compile(script, trace, "hi", cl);
  assert.equal(a.customAudioPath, "/rec/intro.mp3");
  assert.equal(a.narrations, undefined);
  assert.equal(a.audioPath, undefined);
  assert.deepEqual(b.audioPath, { hi: "/rec/hi.wav" });
  assert.deepEqual(b.narrations, { hi: "नमस्ते" });
  assert.equal(b.customAudioPath, undefined);
  // the recorded clip's length drives "auto": (2 − 1) + 4 + 0.5
  assert.equal(spot.spotlightDuration, 5.5);
});

test("multi-region spotlight/blur: every measured rect", () => {
  const script = baseScript([{ id: "s", beat: [
    { fx: "spotlight", anchors: [{ text: "a" }, { text: "b" }], duration: 2 },
    { fx: "blur", anchors: [{ text: "c" }, { text: "d" }], duration: 2 },
  ] }]);
  const trace: TraceEntry[] = [
    { beat: "s", i: 0, kind: "fx", fx: "spotlight", t: 1, rect: R, rects: [R, R2] },
    { beat: "s", i: 1, kind: "fx", fx: "blur", t: 4, rect: R2, rects: [R2, R3] },
  ];
  const [spot, blur] = compile(script, trace);
  assert.deepEqual(spot.spotlightRects, [R, R2]);
  assert.deepEqual(blur.blurRects, [R2, R3]);
});

test("multi-target zoom: one zoomTarget per target, each with its own clip; length = Σ(in + hold_k + out)", () => {
  const script = baseScript([{ id: "s", beat: [
    { fx: "callout", style: "lower-third", text: "Numbers" },
    { fx: "zoom", targets: [
      { anchor: { text: "A" }, narrate: "First." },
      { anchor: { text: "B" } },
      { anchor: { text: "C" }, audio: "/rec/c.wav" },
    ] },
  ] }]);
  const trace: TraceEntry[] = [
    { beat: "s", i: 0, kind: "fx", fx: "callout", t: 10 },
    { beat: "s", i: 1, kind: "fx", fx: "zoom", t: 11, rect: R, rects: [R, R2, R3] },
  ];
  const cl = clips({ "s:1:t0": 2 });
  cl.set("s:1:t2", recordedClip("s:1:t2", "/rec/c.wav", 1.5));
  const warnings: string[] = [];
  const actions = compile(script, trace, "en", cl, warnings);
  const zoom = byName(actions, "s #1 zoom");
  assert.equal(zoom.zoomRect, undefined);
  assert.deepEqual(zoom.zoomTargets, [
    { rect: R, narrations: { en: "First." }, audioPath: { en: "/audio/s_1_t0.wav" } },
    { rect: R2 },
    { rect: R3, customAudioPath: "/rec/c.wav" },
  ]);
  const tl = modelTimeline(actions, (p) => ({ "/audio/s_1_t0.wav": 2, "/rec/c.wav": 1.5 })[p]);
  assert.equal(round(tl.inserts[0].length), 3.6 + 3.6 + 3.1); // hold: clip, zoomHold 2, clip
  // the lower-third stays up to the last narrated hold + 0.5: 1 + (8.0 + 1.5 + 0.5)
  assert.equal(byName(actions, "s #0 callout").calloutDuration, 11);
  assert.deepEqual(warnings, []);
});

test("multi-target zoom with fewer measured rects than targets → CompileError", () => {
  const script = baseScript([{ id: "s", beat: [{ fx: "zoom", targets: [{ anchor: { text: "A" } }, { anchor: { text: "B" } }] }] }]);
  const trace: TraceEntry[] = [{ beat: "s", i: 0, kind: "fx", fx: "zoom", t: 1, rect: R }];
  assert.throws(() => compile(script, trace), /2 targets but the recording measured 1/);
});

test("callout panels: placement above/below/over, room fallback, clamping, sizes, step-counter", () => {
  const vp = { width: 1440, height: 900 };
  const one = (fx: Record<string, unknown>, rect?: [number, number, number, number]) => {
    const script = baseScript([{ id: "s", beat: [{ fx: "callout", text: "Label", ...fx } as any] }]);
    script.viewport = vp;
    return compile(script, [{ beat: "s", i: 0, kind: "fx", fx: "callout", t: 1, ...(rect ? { rect } : {}) }])[0];
  };
  const el: [number, number, number, number] = [300, 400, 200, 40];
  assert.deepEqual(one({}, el).calloutPanels, [{ text: "Label", rect: [300, 356, 84, 28], fontSize: 28 }]);
  assert.deepEqual(one({ placement: "below" }, el).calloutPanels![0].rect, [300, 452, 84, 28]);
  assert.deepEqual(one({ placement: "over", fontSize: 48 }, el).calloutPanels, [{ text: "Label", rect: [300, 400, 144, 48], fontSize: 48 }]);
  // no room above → below
  assert.deepEqual(one({}, [100, 20, 50, 20]).calloutPanels![0].rect, [100, 52, 84, 28]);
  // kept inside the frame: x ≤ 1440 − width − 8
  assert.deepEqual(one({ text: "A much longer label" }, [1400, 400, 30, 30]).calloutPanels![0].rect, [1113, 356, 319, 28]);
  // the producer prefixes "Step N: " — the width estimate includes it
  const sc = one({ style: "step-counter", step: 3, text: "Save" }, el);
  assert.deepEqual(sc.calloutPanels, [{ text: "Save", rect: [300, 356, 202, 28], fontSize: 28 }]);
  assert.equal(sc.calloutStep, 3);
  // lower-third: the producer's banner, unless a fontSize asks for a panel
  assert.equal(one({ style: "lower-third" }).calloutPanels, undefined);
  assert.deepEqual(one({ style: "lower-third", fontSize: 48 }).calloutPanels, [{ text: "Label", rect: [648, 808, 144, 48], fontSize: 48 }]);
  // label without any element: producer default position, no panel
  assert.equal(one({}).calloutPanels, undefined);
});

test("music → one music action at 0 with volume / duck defaults", () => {
  const script = { ...baseScript([{ id: "s", beat: [{ fx: "narrate", narrate: "Hi" }] }]), music: { path: "/m/tone.mp3", volume: 0.3 } };
  const actions = compile(script, [{ beat: "s", i: 0, kind: "fx", fx: "narrate", t: 2 }]);
  assert.deepEqual(actions[0], { id: "action-2", type: "music", timestamp: 0, name: "music", musicPath: "/m/tone.mp3", musicVolume: 0.3, musicDuckTo: 0.2 });
  assert.equal(actions[1].type, "narrate");
});

test("ranges: seconds / next-act / step-end / step id / last step → recording end", () => {
  const script = baseScript([
    { id: "a", beat: [
      { act: "click", text: "Export" },
      { fx: "skip" },                 // default next-act
      { act: "waitFor", text: "Done" },
      { fx: "speed", factor: 4 },     // default step-end
      { act: "fill", label: "Name", value: "x" },
    ] },
    { id: "b", beat: [
      { act: "click", text: "Save" },
      { fx: "mute", seconds: 2 },
      { fx: "speed", factor: 2, until: "c" },
    ] },
    { id: "c", beat: [{ fx: "callout", style: "lower-third", text: "Bye" }] },
  ]);
  const trace: TraceEntry[] = [
    { beat: "a", i: 0, kind: "act", act: "click", t: 1, rect: R },
    { beat: "a", i: 1, kind: "fx", fx: "skip", t: 1.5 },
    { beat: "a", i: 2, kind: "act", act: "waitFor", t: 6 },
    { beat: "a", i: 3, kind: "fx", fx: "speed", t: 6.5 },
    { beat: "a", i: 4, kind: "act", act: "fill", t: 8, rect: R },
    { beat: "b", i: 0, kind: "act", act: "click", t: 9, rect: R },
    { beat: "b", i: 1, kind: "fx", fx: "mute", t: 9.5 },
    { beat: "b", i: 2, kind: "fx", fx: "speed", t: 10 },
    { beat: "c", i: 0, kind: "fx", fx: "callout", t: 12 },
  ];
  const actions = compile(script, trace, "en", undefined, [], { durationSec: 20 });
  assert.equal(byName(actions, "a #1 skip").skipEndTimestamp, 6);
  const sp = byName(actions, "a #3 speed");
  assert.deepEqual([sp.timestamp, sp.speedEndTimestamp, sp.speedFactor], [6.5, 9, 4]);
  assert.equal(byName(actions, "b #1 mute").muteEndTimestamp, 11.5);
  assert.equal(byName(actions, "b #2 speed").speedEndTimestamp, 20);

  // until "next-act" when the act was stamped at the same moment → empty → dropped
  const empty = baseScript([{ id: "s", beat: [{ fx: "skip" }, { act: "click", text: "Go" }] }]);
  const warnings: string[] = [];
  const none = compile(empty, [
    { beat: "s", i: 0, kind: "fx", fx: "skip", t: 3 },
    { beat: "s", i: 1, kind: "act", act: "click", t: 3, rect: R },
  ], "en", undefined, warnings);
  assert.deepEqual(none, []);
  assert.match(warnings[0], /steps\[0\]\.beat\[0\] \(skip\): has nothing to cut \(0\.00s\) — it was ignored\. .*put the slow action/);
});

test("ranges: overlapping speed ranges are clipped, empty ones dropped, fx inside a skip warned", () => {
  const script = baseScript([{ id: "s", beat: [
    { fx: "speed", factor: 2, seconds: 4 },
    { fx: "speed", factor: 3, seconds: 3 },
    { fx: "speed", factor: 3, seconds: 1 },
    { fx: "skip", seconds: 3 },
    { fx: "narrate", narrate: "Lost." },
  ] }]);
  const trace: TraceEntry[] = [
    { beat: "s", i: 0, kind: "fx", fx: "speed", t: 2 },
    { beat: "s", i: 1, kind: "fx", fx: "speed", t: 5 },
    { beat: "s", i: 2, kind: "fx", fx: "speed", t: 6.5 },
    { beat: "s", i: 3, kind: "fx", fx: "skip", t: 10 },
    { beat: "s", i: 4, kind: "fx", fx: "narrate", t: 11 },
  ];
  const warnings: string[] = [];
  const actions = compile(script, trace, "en", undefined, warnings, { durationSec: 30 });
  const second = byName(actions, "s #1 speed");
  assert.deepEqual([second.timestamp, second.speedEndTimestamp], [6, 8]);
  assert.ok(!actions.some((a) => a.name === "s #2 speed"), "fully covered range dropped");
  assert.equal(warnings.length, 3, warnings.join("\n"));
  assert.match(warnings[0], /beat\[1\] \(speed\): starts inside the speed at steps\[0\]\.beat\[0\]/);
  assert.match(warnings[1], /beat\[2\] \(speed\): lies entirely inside the speed at steps\[0\]\.beat\[1\]/);
  assert.match(warnings[2], /beat\[4\] \(narrate\) sits inside the part that steps\[0\]\.beat\[3\] cuts out .* starts at the cut instead: on the first frame after the skipped part/);
});

test("auto: never across a skip cut (warning); lower-thirds may", () => {
  const script = baseScript([{ id: "s", beat: [
    { fx: "spotlight", anchor: { text: "x" } },
    { fx: "callout", style: "lower-third", text: "Title" },
    { fx: "skip", seconds: 3 },
    { fx: "narrate", narrate: "After the cut." },
  ] }]);
  const trace: TraceEntry[] = [
    { beat: "s", i: 0, kind: "fx", fx: "spotlight", t: 1, rect: R },
    { beat: "s", i: 1, kind: "fx", fx: "callout", t: 1 },
    { beat: "s", i: 2, kind: "fx", fx: "skip", t: 2 },
    { beat: "s", i: 3, kind: "fx", fx: "narrate", t: 6 },
  ];
  const warnings: string[] = [];
  const actions = compile(script, trace, "en", clips({ "s:3": 2 }), warnings, { durationSec: 20 });
  assert.equal(byName(actions, "s #0 spotlight").spotlightDuration, 0.95); // cut at 2 → 2 − 1 − 0.05
  // skipped 2..5 → the narration starts at 3 (post-cut) → 3 − 1 + 2 + 0.5
  assert.equal(byName(actions, "s #1 callout").calloutDuration, 4.5);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /beat\[0\] \(spotlight\).*where the skip at steps\[0\]\.beat\[2\] cuts the video/);
});

test("auto: an overlay inside a speed range stops at its end", () => {
  const script = baseScript([
    { id: "a", beat: [{ fx: "speed", factor: 2, seconds: 4 }, { fx: "spotlight", anchor: { text: "x" } }, { fx: "narrate", narrate: "Hi." }] },
  ]);
  const trace: TraceEntry[] = [
    { beat: "a", i: 0, kind: "fx", fx: "speed", t: 2 },
    { beat: "a", i: 1, kind: "fx", fx: "spotlight", t: 3, rect: R },
    { beat: "a", i: 2, kind: "fx", fx: "narrate", t: 7 },
  ];
  const warnings: string[] = [];
  const actions = compile(script, trace, "en", clips({ "a:2": 1 }), warnings, { durationSec: 20 });
  // 2x from 2..6 → spotlight at 2.5 (post-speed), range ends at 4 → 4 − 2.5 − 0.05
  assert.equal(byName(actions, "a #1 spotlight").spotlightDuration, 1.45);
  assert.match(warnings[0], /changes the playback speed/);
});

test("modelTimeline: skip + speed remap inserts, overlay starts and the final length", () => {
  const actions: NaraAction[] = [
    { id: "1", type: "skip", timestamp: 2, skipEndTimestamp: 5 },
    { id: "2", type: "speed", timestamp: 6, speedEndTimestamp: 10, speedFactor: 2 },
    { id: "3", type: "pause", timestamp: 12, resumeAfter: 3 },
  ];
  const tl = modelTimeline(actions, () => undefined);
  assert.equal(tl.mapped(12), 7); // −3 (skip) −2 (4 s at 2x)
  assert.equal(tl.inserts[0].at, 7);
  assert.equal(tl.placed(13), 8 + 3);
  assert.equal(tl.finalDuration(20), 20 - 3 - 2 + 3);
  assert.deepEqual(tl.boundaries.map((b) => b.at), [2, 3, 5]);
});

// ── "step-end" / "end" overlay durations ─────────────────────

test("step-end: until the next step starts, on the final timeline (inserts in between counted)", () => {
  const script = baseScript([
    { id: "a", beat: [{ fx: "spotlight", anchor: { text: "x" }, duration: "step-end" }, { fx: "pause", seconds: 1 }, { fx: "narrate", narrate: "Hi." }] },
    { id: "b", beat: [{ act: "click", text: "Next" }, { fx: "callout", style: "lower-third", text: "Last", duration: "step-end" }] },
  ]);
  const trace: TraceEntry[] = [
    { beat: "a", i: 0, kind: "fx", fx: "spotlight", t: 2, rect: R },
    { beat: "a", i: 1, kind: "fx", fx: "pause", t: 3 },
    { beat: "a", i: 2, kind: "fx", fx: "narrate", t: 4 },
    { beat: "b", i: 0, kind: "act", act: "click", t: 7, rect: R },
    { beat: "b", i: 1, kind: "fx", fx: "callout", t: 8 },
  ];
  const warnings: string[] = [];
  const actions = compile(script, trace, "en", clips({ "a:2": 2 }), warnings, { durationSec: 12 });
  assert.equal(byName(actions, "a #0 spotlight").spotlightDuration, 8); // (7 − 2) + pause 1 + clip 2
  assert.equal(byName(actions, "b #1 callout").calloutDuration, 4); // last step → recording end: 12 − 8
  assert.deepEqual(warnings, []);
});

test("end: a blur covers to the end of the recording (freezes and zooms after it are cut from blurred video)", () => {
  const script = baseScript([
    { id: "a", beat: [{ fx: "blur", anchor: { label: "API key" }, duration: "end" }] },
    { id: "b", beat: [{ fx: "narrate", narrate: "Still hidden." }, { fx: "zoom" }] },
  ]);
  const trace: TraceEntry[] = [
    { beat: "a", i: 0, kind: "fx", fx: "blur", t: 2, rect: R },
    { beat: "b", i: 0, kind: "fx", fx: "narrate", t: 5 },
    { beat: "b", i: 1, kind: "fx", fx: "zoom", t: 8, rect: R2 },
  ];
  const warnings: string[] = [];
  const actions = compile(script, trace, "en", clips({ "b:0": 2 }), warnings, { durationSec: 12 });
  // recording seconds to the exact recording end (12 − 2) + 0.1 s so the last
  // frame is inside (blur runs on the recording timeline — nothing to estimate)
  assert.equal(byName(actions, "a #0 blur").blurDuration, 10.1);
  assert.deepEqual(warnings, []);
});

test("end: spotlight/callout still stop at a zoom (warning) and spotlights yield to the next spotlight; callouts don't", () => {
  const script = baseScript([
    { id: "a", beat: [
      { fx: "spotlight", anchor: { text: "a" }, duration: "end" },
      { fx: "callout", style: "lower-third", text: "Title", duration: "end" },
      { fx: "callout", text: "Label", anchor: { text: "b" }, duration: 1 },
      { fx: "spotlight", anchor: { text: "b" }, duration: "end" },
      { fx: "zoom" },
    ] },
  ]);
  const trace: TraceEntry[] = [
    { beat: "a", i: 0, kind: "fx", fx: "spotlight", t: 1, rect: R },
    { beat: "a", i: 1, kind: "fx", fx: "callout", t: 1 },
    { beat: "a", i: 2, kind: "fx", fx: "callout", t: 2, rect: R2 },
    { beat: "a", i: 3, kind: "fx", fx: "spotlight", t: 3, rect: R2 },
    { beat: "a", i: 4, kind: "fx", fx: "zoom", t: 6, rect: R2 },
  ];
  const warnings: string[] = [];
  const actions = compile(script, trace, "en", undefined, warnings, { durationSec: 10 });
  assert.equal(byName(actions, "a #0 spotlight").spotlightDuration, 1.95, "yields to the next spotlight");
  assert.equal(byName(actions, "a #3 spotlight").spotlightDuration, 2.95, "stops before the zoom");
  // lower-third: not rect-bound, not capped by the label → 10 + 3.6 − 1 (+ open end)
  assert.equal(byName(actions, "a #1 callout").calloutDuration, 12.6 + 60);
  assert.equal(warnings.length, 1, warnings.join("\n"));
  assert.match(warnings[0], /beat\[3\] \(spotlight\): "end" duration stops at the zoom/);
});

test("language fallback: a map without the produce language, or a plain string in a non-en video → warning", () => {
  const script = baseScript([{ id: "s", beat: [
    { fx: "narrate", narrate: { en: "Hello" } },
    { fx: "narrate", narrate: "Plain text" },
    { fx: "narrate", narrate: "नमस्ते", lang: "hi" },
    { fx: "narrate", narrate: { en: "Hi", hi: "नमस्ते" } },
  ] }]);
  const trace: TraceEntry[] = [0, 1, 2, 3].map((i) => ({ beat: "s", i, kind: "fx" as const, fx: "narrate" as const, t: i + 1 }));
  const hi: string[] = [];
  compile(script, trace, "hi", undefined, hi);
  assert.equal(hi.length, 2, hi.join("\n"));
  assert.match(hi[0], /^steps\[0\]\.beat\[0\]: no hi narration — used en/);
  assert.match(hi[1], /^steps\[0\]\.beat\[1\]: a plain-string narration is spoken as hi/);
  const en: string[] = [];
  compile(script, trace, "en", undefined, en);
  assert.deepEqual(en, []);
});

test("callout text per language: picks the produce language, falls back to en with a warning", () => {
  const script = baseScript([{ id: "s", beat: [
    { fx: "callout", style: "lower-third", text: { en: "Tasks", hi: "कार्य" } },
    { fx: "callout", style: "lower-third", text: { en: "Settings" } },
    { fx: "callout", text: "Brand", anchor: { text: "x" } },
  ] }]);
  const trace: TraceEntry[] = [
    { beat: "s", i: 0, kind: "fx", fx: "callout", t: 1 },
    { beat: "s", i: 1, kind: "fx", fx: "callout", t: 5 },
    { beat: "s", i: 2, kind: "fx", fx: "callout", t: 9, rect: R },
  ];
  const warnings: string[] = [];
  const [a, b, c] = compile(script, trace, "hi", undefined, warnings);
  assert.deepEqual([a.calloutText, b.calloutText, c.calloutText], ["कार्य", "Settings", "Brand"]);
  assert.equal(c.calloutPanels![0].text, "Brand");
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /^steps\[0\]\.beat\[1\]: no hi callout text — used en/);
  assert.equal(compile(script, trace, "en")[0].calloutText, "Tasks");
});

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
