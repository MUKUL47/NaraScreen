// Run: node_modules/.bin/tsx --test api/_tests/structure.test.ts
//
// Chapters, step transitions and the highlighter — the pure parts: schema /
// validation, what the compiler emits, chapter timing through the renderer's
// skip → speed → insert remap (modelled by compiler.modelTimeline, the same
// rules produce.ts applies), the chapter list / YouTube text / ffmetadata,
// the page-change detector, the transition filters and the marker geometry.

import { test } from "node:test";
import assert from "node:assert/strict";
import * as os from "os";
import { compile, modelTimeline } from "../compiler.ts";
import { validateScript } from "../validate.ts";
import { AgentError } from "../errors.ts";
import type { NarrationClip } from "../narration.ts";
import type { DemoScript, NaraAction, TraceEntry } from "../types.ts";
import { buildChapters, chapterBadgeEvents, chapterPoints, ffmetadata, timecode, youtubeChapters, youtubeIssues } from "../../electron/fx-chapters.ts";
import { findChange, transitionGraph } from "../../electron/fx-transitions.ts";
import { highlightSwipeEvents, lineBoxes, markerPolygon, markerStroke, swipeTiming } from "../../electron/fx-highlight.ts";

const R: [number, number, number, number] = [300, 200, 240, 30];

function clips(spec: Record<string, number>): Map<string, NarrationClip> {
  const m = new Map<string, NarrationClip>();
  for (const [key, durationSec] of Object.entries(spec)) {
    const [step, entry] = key.split(":");
    m.set(key, { key, step, entry: Number(entry), lang: "en", voice: "af_heart", speed: 1, text: "x", audioPath: `/a/${key}.wav`, durationSec, cached: false });
  }
  return m;
}

/** A 3-step script with a skip, two freezing narrations and a mid-step chapter. */
function chapterScript(): { script: DemoScript; trace: TraceEntry[]; clips: Map<string, NarrationClip> } {
  const script: DemoScript = {
    version: 1,
    scope: "t",
    baseUrl: "http://localhost:4173",
    viewport: { width: 1440, height: 900 },
    transition: "fade",
    chapters: { onScreen: true },
    steps: [
      { id: "s0", chapter: "Start", beat: [{ act: "goto", path: "/" }, { fx: "narrate", narrate: "hello" }] },
      {
        id: "s1",
        label: "Export it",
        chapter: true,
        transition: { type: "slide", duration: 0.6 },
        beat: [{ act: "click", text: "Export" }, { fx: "skip" }, { act: "waitFor", text: "Done" }, { fx: "narrate", narrate: "done" }],
      },
      { id: "s2", chapter: { en: "Settings", hi: "सेटिंग्स" }, beat: [{ act: "goto", path: "/s" }, { fx: "highlight", anchor: { text: "Pro" } }, { fx: "chapter", title: "Advanced" }] },
    ],
  };
  const trace: TraceEntry[] = [
    { beat: "s0", i: 0, kind: "act", act: "goto", t: 0.5, start: 0.5 },
    { beat: "s0", i: 1, kind: "fx", fx: "narrate", t: 2 },
    { beat: "s1", i: 0, kind: "act", act: "click", t: 5.2, start: 5, end: 5.4 },
    { beat: "s1", i: 1, kind: "fx", fx: "skip", t: 6.9 },
    { beat: "s1", i: 2, kind: "act", act: "waitFor", t: 9, start: 8.4 },
    { beat: "s1", i: 3, kind: "fx", fx: "narrate", t: 10 },
    { beat: "s2", i: 0, kind: "act", act: "goto", t: 12.6, start: 12.5, end: 13 },
    { beat: "s2", i: 1, kind: "fx", fx: "highlight", t: 13.2, rect: R },
    { beat: "s2", i: 2, kind: "fx", fx: "chapter", t: 14 },
  ];
  return { script, trace, clips: clips({ "s0:1": 3, "s1:3": 2 }) };
}

test("schema/validate: chapter, transition, highlight and chapters fields are accepted", () => {
  const { script } = chapterScript();
  const { warnings } = validateScript(JSON.parse(JSON.stringify(script)), { dir: os.tmpdir() });
  assert.ok(!warnings.some((w) => /chapter/.test(w)), warnings.join("\n"));
});

test("validate: bad values fail with paths; a chapter map must cover every language", () => {
  const bad = (patch: (s: DemoScript) => void) => {
    const { script } = chapterScript();
    patch(script);
    try {
      validateScript(JSON.parse(JSON.stringify(script)), { dir: os.tmpdir() });
    } catch (e) {
      assert.ok(e instanceof AgentError);
      return JSON.stringify(e.details);
    }
    assert.fail("expected SCRIPT_INVALID");
  };
  assert.match(bad((s) => ((s.steps[1] as { transition: unknown }).transition = "wipe")), /steps\[1\]\.transition/);
  assert.match(bad((s) => ((s.steps[2].beat[1] as { style: string }).style = "label")), /steps\[2\]\.beat\[1\]/);
  assert.match(bad((s) => ((s.steps[2].beat[1] as { color: string }).color = "yellow")), /color/);
  assert.match(bad((s) => (s.steps[2].beat[2] = { fx: "chapter" } as never)), /title/);
  assert.match(
    bad((s) => {
      s.languages = ["en", "hi"];
      s.steps[0].chapter = { hi: "शुरू" };
    }),
    /steps\[0\]\.chapter.*nothing for language \\"en\\"/,
  );
  // highlight needs an element like spotlight does
  assert.match(bad((s) => (s.steps[0].beat = [{ fx: "highlight" }])), /highlight needs an element/);
});

test("validate: fewer than 3 chapters warns (YouTube)", () => {
  const { script } = chapterScript();
  script.steps[1].chapter = undefined;
  script.steps[2].chapter = undefined;
  (script.steps[2].beat as unknown[]).pop();
  const { warnings } = validateScript(JSON.parse(JSON.stringify(script)), { dir: os.tmpdir() });
  assert.ok(warnings.some((w) => /1 chapter in the video — YouTube/.test(w)), warnings.join("\n"));
});

test("compile: chapter actions at step starts (first step at 0) and mid-step; titles per language; badges", () => {
  const { script, trace, clips: c } = chapterScript();
  const en = compile(script, trace, "en", c, [], { durationSec: 16 });
  const ch = en.filter((a) => a.type === "chapter");
  assert.deepEqual(ch.map((a) => [a.chapterTitle, a.timestamp]), [["Start", 0], ["Export it", 5], ["Settings", 12.5], ["Advanced", 14]]);
  assert.ok(ch.every((a) => a.chapterBadge === true));
  const hi = compile({ ...script, languages: ["en", "hi"] }, trace, "hi", c, [], { durationSec: 16 });
  assert.equal(hi.find((a) => a.type === "chapter" && a.timestamp === 12.5)?.chapterTitle, "सेटिंग्स");
});

test("compile: transitions — step override, script default (not on the first step), window ends 1.5 s after the first act", () => {
  const { script, trace, clips: c } = chapterScript();
  const tr = compile(script, trace, "en", c, [], { durationSec: 16 }).filter((a) => a.type === "transition");
  assert.deepEqual(
    tr.map((a) => [a.timestamp, a.transitionEnd, a.transitionStyle, a.transitionDuration]),
    [[5, 5.4 + 1.5, "slide", 0.6], [12.5, 13 + 1.5, "fade", 0.4]],
  );
  script.steps[2].transition = "none";
  assert.equal(compile(script, trace, "en", c, [], { durationSec: 16 }).filter((a) => a.type === "transition").length, 1);
});

test("compile: highlight → a callout with style highlight, one panel per element, auto duration", () => {
  const { script, trace, clips: c } = chapterScript();
  (script.steps[2].beat[1] as unknown as Record<string, unknown>).color = "#22C55E";
  (script.steps[2].beat[1] as unknown as Record<string, unknown>).style = "underline";
  const h = compile(script, trace, "en", c, [], { durationSec: 16 }).find((a) => a.calloutStyle === "highlight")!;
  assert.equal(h.type, "callout");
  assert.deepEqual(h.calloutPanels?.map((p) => p.rect), [R]);
  assert.equal(h.highlightColor, "#22C55E");
  assert.equal(h.highlightStyle, "underline");
  assert.equal(h.calloutDuration, 3); // no narration after it in the step
});

test("chapter timing: placed through skip and freeze inserts like every overlay (per-language narration lengths)", () => {
  const { script, trace, clips: c } = chapterScript();
  const actions = compile(script, trace, "en", c, [], { durationSec: 16 });
  const clipSec = new Map([...c.values()].map((x) => [x.audioPath, x.durationSec]));
  const tl = modelTimeline(actions, (p) => clipSec.get(p), 16);
  const pts = chapterPoints(actions as never, tl.placed);
  // skip 6.9 → 9 (until the next act) cuts 2.1 s; freezes: 3 s at 2, 2 s at mapped 7.9.
  // Start 0; Export 5 (+3 freeze before it) = 8; Settings 12.5 − 2.1 + 5 = 15.4; Advanced 14 − 2.1 + 5 = 16.9
  assert.deepEqual(pts.map((p) => [p.title, Math.round(p.at * 1000) / 1000]), [["Start", 0], ["Export it", 8], ["Settings", 15.4], ["Advanced", 16.9]]);
  // A longer narration in another language moves every later chapter by the difference.
  const longer = clips({ "s0:1": 4.5, "s1:3": 2 });
  const a2 = compile(script, trace, "en", longer, [], { durationSec: 16 });
  const sec2 = new Map([...longer.values()].map((x) => [x.audioPath, x.durationSec]));
  const pts2 = chapterPoints(a2 as never, modelTimeline(a2, (p) => sec2.get(p), 16).placed);
  assert.deepEqual(pts2.map((p) => p.at - pts.find((q) => q.title === p.title)!.at).map((d) => Math.round(d * 10) / 10), [0, 1.5, 1.5, 1.5]);
  // An insert AT the chapter's own position comes after the chapter's start.
  const at = chapterPoints([{ type: "chapter", timestamp: 2, chapterTitle: "x" }], tl.placed);
  assert.equal(at[0].at, 2);
});

test("chapter list: title card → lead 'Intro' chapter, merge, snap to 0:00, last runs to the end", () => {
  const pts = [
    { title: "Start", at: 0, badge: false },
    { title: "Export", at: 8, badge: false },
    { title: "Export (better)", at: 8.3, badge: false },
    { title: "Settings", at: 30, badge: false },
  ];
  const withIntro = buildChapters(pts, { introSec: 4, totalSec: 60 });
  assert.deepEqual(withIntro.map((c) => [c.title, c.start, c.end, c.timecode]), [
    ["Intro", 0, 4, "0:00"],
    ["Start", 4, 12, "0:04"],
    ["Export (better)", 12, 34, "0:12"],
    ["Settings", 34, 60, "0:34"],
  ]);
  // no card, first chapter at 0.6 s → snapped to 0:00, no lead chapter
  const snapped = buildChapters([{ title: "A", at: 0.6, badge: false }, { title: "B", at: 20, badge: false }], { totalSec: 40 });
  assert.deepEqual(snapped.map((c) => [c.title, c.start]), [["A", 0], ["B", 20]]);
  // no chapter on the first step → implicit lead chapter with the configured title
  const lead = buildChapters([{ title: "B", at: 20, badge: false }], { totalSec: 40, leadTitle: "Overview" });
  assert.deepEqual(lead.map((c) => [c.title, c.start]), [["Overview", 0], ["B", 20]]);
  assert.deepEqual(buildChapters([], { totalSec: 10, introSec: 3 }), []);
});

test("YouTube text: one 'm:ss Title' line per chapter from 0:00; rule violations are reported", () => {
  const ch = buildChapters(
    [{ title: "Start", at: 0, badge: false }, { title: "Tasks", at: 65.4, badge: false }, { title: "Settings", at: 3725, badge: false }],
    { totalSec: 3800 },
  );
  assert.equal(youtubeChapters(ch), "0:00 Start\n1:05 Tasks\n1:02:05 Settings\n");
  assert.deepEqual(youtubeIssues(ch), []);
  assert.equal(timecode(59.99), "0:59");
  // A title card's short implicit lead chapter is folded into the next one for YouTube (the MP4 keeps it).
  const carded = buildChapters([{ title: "Start", at: 0, badge: false }, { title: "B", at: 20, badge: false }, { title: "C", at: 40, badge: false }], { introSec: 3, totalSec: 70 });
  assert.equal(carded[0].implicit, true);
  assert.equal(youtubeChapters(carded), "0:00 Start\n0:23 B\n0:43 C\n");
  assert.deepEqual(youtubeIssues(carded), []);
  const two = buildChapters([{ title: "A", at: 0, badge: false }, { title: "B", at: 5, badge: false }], { totalSec: 30 });
  const issues = youtubeIssues(two);
  assert.equal(issues.length, 2);
  assert.match(issues[0], /at least 3/);
  assert.match(issues[1], /"A" \(0:00, 5\.0s\) is shorter than 10s/);
});

test("ffmetadata: one [CHAPTER] per chapter in ms, special characters escaped", () => {
  const meta = ffmetadata([{ title: "Tasks; = #1 \\ new", start: 0, end: 12.345, timecode: "0:00" }]);
  assert.equal(meta, ";FFMETADATA1\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=0\nEND=12345\ntitle=Tasks\\; \\= \\#1 \\\\ new\n");
});

test("chapter badges: screen-space events at each chapter start, cut before the next one", () => {
  const ev = chapterBadgeEvents([{ title: "Export", at: 3, badge: true }, { title: "Next", at: 4.5, badge: true }, { title: "No", at: 9, badge: false }], { width: 1440, height: 900 }, 20);
  assert.equal(ev.length, 6); // pill + accent + text, twice
  assert.match(ev[2], /^Dialogue: 9,0:00:03\.15,0:00:04\.45,CLabel.*Export$/);
});

test("page-change detector: the cluster around the biggest jump; nothing for small changes", () => {
  const quiet = Array.from({ length: 60 }, () => 0.3);
  assert.equal(findChange(quiet), null);
  const typing = quiet.map((d, i) => (i % 5 === 0 ? 1.2 : d));
  assert.equal(findChange(typing), null);
  const nav = [...quiet];
  nav[20] = 40; // the new page paints…
  nav[23] = 12; // …then its content arrives
  nav[40] = 2; // a later small change (a cursor, typing) is not part of it
  assert.deepEqual(findChange(nav), { first: 20, last: 23, peak: 40 });
});

test("transition filters: a movie= still shifted to its time, faded or slid out, overlaid with eof_action=pass", () => {
  const g = transitionGraph(
    [
      { style: "fade", duration: 0.4, cover: 5, settle: 5.2, image: "tr_0.png" },
      { style: "slide", duration: 0.5, cover: 9, settle: 9.1, image: "tr_1.png" },
    ],
    "0:v",
  );
  assert.equal(g.out, "trv1");
  assert.match(g.graph[0], /^movie=tr_0\.png,format=yuva420p,loop=loop=\d+:size=1:start=0,setpts=N\/\(30\*TB\)\+5\.000\/TB,fade=t=out:st=5\.200:d=0\.400:alpha=1\[trs0\]$/);
  assert.match(g.graph[1], /^\[0:v\]\[trs0\]overlay=x=0:y=0:eof_action=pass:eval=frame\[trv0\]$/);
  assert.ok(!/fade=/.test(g.graph[2]));
  assert.match(g.graph[3], /^\[trv0\]\[trs1\]overlay=x='if\(lt\(t,9\.100\),0,-W\*/);
});

test("highlight geometry: the stroke covers the text box's width, stays in frame, sweeps left → right", () => {
  const res = { width: 1440, height: 900 };
  const s = markerStroke(R, "marker", 1, res, 3);
  const xs = [...s.top, ...s.bottom].map((p) => p[0]);
  const ys = [...s.top, ...s.bottom].map((p) => p[1]);
  assert.ok(Math.min(...xs) <= R[0] && Math.max(...xs) >= R[0] + R[2], "covers the whole width");
  assert.ok(Math.min(...ys) >= R[1] - 2 && Math.max(...ys) <= R[1] + R[3] + 2, "stays on the line box");
  assert.ok(s.thickness > R[3] * 0.7);
  const width = (p: number) => Math.max(...markerPolygon(s, p).map((q) => q[0])) - Math.min(...markerPolygon(s, p).map((q) => q[0]));
  assert.ok(width(0.25) < width(0.5) && width(0.5) < width(1));
  const u = markerStroke(R, "underline", 1, res);
  assert.ok(u.thickness < 8 && Math.min(...u.top.map((p) => p[1])) > R[1] + R[3] * 0.7, "underline sits under the text");
  // edge of the frame: clamped
  const edge = markerStroke([1400, 880, 100, 30], "marker", 1, res);
  assert.ok([...edge.top, ...edge.bottom].every(([x, y]) => x <= 1439 && y <= 899));
  assert.deepEqual(lineBoxes([0, 0, 100, 60], 3).map((b) => b[1]), [0, 20, 40]);
});

test("highlight events: per-frame sweep then a hold that fades; strokes one after another; disabled/short skipped", () => {
  const t = swipeTiming(1, 4, [240, 240], 1);
  assert.ok(t.strokes[0].drawnAt <= t.strokes[1].steps[0].t0 + 1e-9);
  assert.ok(t.strokes[1].drawnAt - 1 <= 3 * 0.45 + 1e-9);
  const base = { type: "callout", calloutStyle: "highlight", timestamp: 1, calloutDuration: 3, calloutPanels: [{ rect: R }] };
  const ev = highlightSwipeEvents([base], { width: 1440, height: 900 }, 60);
  assert.ok(ev.length > 10 && ev.every((e) => e.startsWith("Dialogue: 0,")));
  assert.match(ev[ev.length - 1], /\\fad\(0,300\)/);
  assert.equal(highlightSwipeEvents([{ ...base, disabled: true }], { width: 1440, height: 900 }, 60).length, 0);
  assert.equal(highlightSwipeEvents([{ ...base, calloutStyle: "label" }], { width: 1440, height: 900 }, 60).length, 0);
  const two = highlightSwipeEvents([{ ...base, highlightLines: 2 }], { width: 1440, height: 900 }, 60);
  assert.ok(two.length > ev.length);
});

test("compile keeps actions sorted with chapters and transitions mixed in", () => {
  const { script, trace, clips: c } = chapterScript();
  const a: NaraAction[] = compile(script, trace, "en", c, [], { durationSec: 16 });
  for (let i = 1; i < a.length; i++) assert.ok(a[i].timestamp >= a[i - 1].timestamp);
});
