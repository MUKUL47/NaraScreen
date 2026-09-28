// Run: node_modules/.bin/tsx --test api/_tests/structure-e2e.test.ts
//
// Chapters, step transitions and the highlighter, end to end through the CLI
// on the "Acme Tasks" fixture app: one script with a title card, a skip, frozen
// narrations, a mid-step chapter, fade + slide transitions and marker strokes,
// made in two languages. Checks:
//   - ffprobe -show_chapters matches the envelope, and every chapter starts where
//     the compiler's independent timeline model (+ the title card) puts it;
//   - chapters_<lang>.txt is YouTube's format; the languages' chapters differ by
//     their narration lengths;
//   - transitions never move anything: re-produced with transitions off, the video
//     has the same length and identical frames away from the page changes;
//   - the marker stroke is visible over the anchored text (pixel check).
// Needs Chromium (Playwright), ffmpeg with libass, and Kokoro on :8880. ~4 min.

import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { startFixtureServer, type FixtureServer } from "./fixture-site/serve.ts";
import { modelTimeline } from "../compiler.ts";
import { chapterPoints } from "../../electron/fx-chapters.ts";
import { ffmpegSync, ffprobeSync, probeDuration } from "../../electron/ffmpeg.ts";
import type { NaraAction, TraceEntry } from "../types.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Rec = Record<string, any>;

const EDITOR = path.resolve(__dirname, "..", "..");
const RUN = path.join(__dirname, ".tmp", `structure-${Date.now()}-${process.pid}`);
const SCRIPT = path.join(RUN, "structure.demo-script.json");
const JOB = path.join(RUN, "job");
const MIN = 60_000;
let server: FixtureServer;

function cli(args: string[], timeoutMs = 10 * MIN): Promise<{ code: number | null; env: Rec; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--import", "tsx", path.join(EDITOR, "api", "cli.ts"), ...args], { cwd: EDITOR, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    const timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
    child.on("close", (code) => {
      clearTimeout(timer);
      let env: Rec = {};
      try {
        env = JSON.parse(out);
      } catch {
        env = { ok: false, error: { message: `stdout is not JSON: ${out.slice(0, 400)}` } };
      }
      resolve({ code, env, stderr: err });
    });
  });
}

function ok(r: { env: Rec; stderr: string }, what: string): Rec {
  assert.ok(r.env.ok, `${what} failed: ${JSON.stringify(r.env.error ?? r.env).slice(0, 1500)}\n${r.stderr.split("\n").slice(-20).join("\n")}`);
  return r.env.result;
}

/** RGB of one pixel of the frame at `t`. */
function pixelAt(video: string, t: number, x: number, y: number): number[] {
  const r = ffmpegSync(["-v", "error", "-ss", t.toFixed(3), "-i", video, "-frames:v", "1", "-vf", `format=rgb24,crop=1:1:${Math.round(x)}:${Math.round(y)}`, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]);
  assert.ok(r.status === 0 && r.stdout.length >= 3, `could not read pixel (${x}, ${y}) at ${t}s of ${video}`);
  return [...r.stdout.subarray(0, 3)];
}

/** PSNR (dB) between the frames of two videos at `t` (inf when identical). */
function psnrAt(a: string, b: string, t: number): number {
  // ffmpegSync discards stderr: psnr writes to a stats file instead.
  const stats = path.join(RUN, "psnr.log");
  ffmpegSync(["-v", "error", "-ss", t.toFixed(3), "-i", a, "-ss", t.toFixed(3), "-i", b, "-frames:v", "1", "-lavfi", `psnr=stats_file=${stats}`, "-f", "null", "-"]);
  const m = /psnr_avg:(\S+)/.exec(fs.readFileSync(stats, "utf-8"));
  return m ? (m[1] === "inf" ? Infinity : Number(m[1])) : 0;
}

function probeChapters(video: string): { start: number; end: number; title: string }[] {
  const r = ffprobeSync(["-v", "error", "-show_chapters", "-of", "json", video]);
  return (JSON.parse(r.stdout.toString()).chapters as Rec[]).map((c) => ({ start: Number(c.start_time), end: Number(c.end_time), title: c.tags?.title }));
}

before(async () => {
  fs.mkdirSync(RUN, { recursive: true });
  server = await startFixtureServer();
  const script = {
    version: 1,
    scope: "Structure",
    baseUrl: server.url,
    viewport: { width: 1440, height: 900 },
    setup: [
      { act: "goto", path: "/#/login" },
      { act: "fill", label: "Email", value: "alex.morgan@example.com" },
      { act: "fill", label: "Password", value: "correct-horse-battery" },
      { act: "click", role: "button", name: "Sign in" },
      { act: "waitFor", role: "heading", name: "Dashboard" },
    ],
    defaults: { dwellMs: 1000, typeDelayMs: 45 },
    languages: ["en", "hi"],
    output: { quality: "medium" },
    intro: { title: { en: "Acme Tasks in three chapters", hi: "तीन अध्यायों में Acme Tasks" }, duration: 3 },
    chapters: { onScreen: true },
    transition: "fade",
    steps: [
      {
        id: "dashboard",
        chapter: { en: "Dashboard", hi: "डैशबोर्ड" },
        beat: [
          { act: "waitFor", role: "heading", name: "Dashboard" },
          { fx: "highlight", anchor: { text: "Team plan" } },
          { fx: "narrate", narrate: { en: "This is the dashboard. Your whole team is on the Team plan.", hi: "यह डैशबोर्ड है। आपकी पूरी टीम टीम प्लान पर है।" } },
        ],
      },
      {
        id: "tasks",
        chapter: { en: "Tasks", hi: "टास्क" },
        transition: { type: "slide", duration: 0.5 },
        beat: [
          { act: "click", role: "link", name: "Tasks", within: { role: "navigation", name: "Main" } },
          { act: "waitFor", role: "heading", name: "Tasks", exact: true },
          { fx: "narrate", narrate: { en: "Every task shows its priority.", hi: "हर टास्क की प्राथमिकता दिखती है।" } },
          { fx: "chapter", title: { en: "Export CSV", hi: "CSV एक्सपोर्ट" } },
          { act: "click", role: "button", name: "Export CSV" },
          { fx: "skip", until: "next-act" },
          { act: "waitFor", text: "Export ready" },
          { fx: "narrate", narrate: { en: "One click exports the list as a CSV file.", hi: "एक क्लिक में सूची CSV फ़ाइल बन जाती है।" } },
        ],
      },
      {
        id: "settings",
        chapter: { en: "Settings", hi: "सेटिंग्स" },
        beat: [
          { act: "click", role: "link", name: "Settings", within: { role: "navigation", name: "Main" } },
          { act: "waitFor", role: "heading", name: "Settings", exact: true },
          { fx: "narrate", narrate: { en: "Settings is where notifications live.", hi: "सेटिंग्स में नोटिफ़िकेशन रहते हैं।" } },
        ],
      },
    ],
  };
  fs.writeFileSync(SCRIPT, JSON.stringify(script, null, 2));
});

after(async () => {
  await server?.close();
});

const made: { result?: Rec } = {};

test("make: real MP4 chapters at the modelled final times (skip, freezes, title card), in both languages", { timeout: 15 * MIN }, async () => {
  const result = ok(await cli(["make", SCRIPT, "--out", JOB]), "make");
  made.result = result;
  const trace: TraceEntry[] = fs.readFileSync(path.join(JOB, "trace.jsonl"), "utf-8").trim().split("\n").map((l) => JSON.parse(l));
  assert.ok(trace.some((e) => e.fx === "skip"));
  const byLang: Record<string, Rec> = {};
  for (const v of result.videos as Rec[]) {
    byLang[v.lang] = v;
    const probed = probeChapters(v.path);
    assert.equal(probed.length, 5, `${v.lang}: 5 chapters (implicit Intro + 4): ${JSON.stringify(probed)}`);
    assert.deepEqual(probed.map((c) => c.title), (v.chapters as Rec[]).map((c) => c.title));
    probed.forEach((c, i) => assert.ok(Math.abs(c.start - v.chapters[i].start) < 0.002, `${v.lang} chapter ${i}: ffprobe ${c.start} vs envelope ${v.chapters[i].start}`));
    assert.equal(probed[0].start, 0);
    assert.ok(Math.abs(probed[4].end - v.durationSec) < 0.1, "the last chapter runs to the end");
    // Independent check: the compiler's model of the renderer's timeline + the title card.
    const project = JSON.parse(fs.readFileSync(path.join(JOB, `demo-project.${v.lang}.json`), "utf-8"));
    const actions: NaraAction[] = project.actions;
    const sec = (p: string) => (fs.existsSync(p) ? probeDuration(p) : undefined);
    const tl = modelTimeline(actions, sec, probeDuration(path.join(JOB, "recordings", "recording.mp4")));
    const intro = (v.cards as Rec[]).find((c) => c.which === "intro")!.durationSec as number;
    const expected = chapterPoints(actions as never, tl.placed).map((p) => p.at + intro);
    assert.ok(Math.abs(probed[1].start - intro) < 0.05, `${v.lang}: the first step's chapter starts right after the title card (${probed[1].start} vs ${intro})`);
    for (let i = 1; i < 5; i++) {
      assert.ok(Math.abs(probed[i].start - expected[i - 1]) < 0.15, `${v.lang} "${probed[i].title}": ${probed[i].start} vs modelled ${expected[i - 1].toFixed(3)}`);
    }
    // YouTube text: 0:00 first (the 3 s card's lead chapter folded into the next), m:ss lines.
    const txt = fs.readFileSync(v.chapterFiles.youtube, "utf-8").trim().split("\n");
    assert.equal(txt.length, 4);
    assert.match(txt[0], /^0:00 \S/);
    txt.forEach((l) => assert.match(l, /^\d+:\d\d \S/));
    assert.deepEqual(JSON.parse(fs.readFileSync(v.chapterFiles.json, "utf-8")), v.chapters);
  }
  // Different narration lengths → different chapter times; titles per language.
  assert.equal(byLang.hi.chapters[2].title, "टास्क");
  assert.notEqual(byLang.hi.chapters[3].start, byLang.en.chapters[3].start);
});

test("highlight: the marker stroke is visible over the anchored text while it holds", { timeout: MIN }, () => {
  const v = (made.result?.videos as Rec[])?.find((x) => x.lang === "en");
  assert.ok(v, "needs the make above");
  const trace: TraceEntry[] = fs.readFileSync(path.join(JOB, "trace.jsonl"), "utf-8").trim().split("\n").map((l) => JSON.parse(l));
  const hl = trace.find((e) => e.fx === "highlight")!;
  const [x, y, w, h] = hl.rect!;
  const project = JSON.parse(fs.readFileSync(path.join(JOB, "demo-project.en.json"), "utf-8"));
  const action = (project.actions as NaraAction[]).find((a) => a.calloutStyle === "highlight")!;
  const tl = modelTimeline(project.actions, (p) => (fs.existsSync(p) ? probeDuration(p) : undefined));
  const intro = (v.cards as Rec[])[0].durationSec as number;
  const start = tl.placed(action.timestamp) + intro;
  // Sample the stroke's middle row, left and right of centre (between letters is fine: it's the pill's background).
  const pts: [number, number][] = [[x + w * 0.1, y + h * 0.55], [x + w * 0.9, y + h * 0.55]];
  const yellow = ([r, g, b]: number[]) => r > 200 && g > 190 && b < r - 40;
  for (const p of pts) {
    assert.ok(!yellow(pixelAt(v.path, start - 0.3, ...p)), `no stroke before it starts: ${pixelAt(v.path, start - 0.3, ...p)}`);
    assert.ok(yellow(pixelAt(v.path, start + 1.5, ...p)), `stroke at ${p} while holding: ${pixelAt(v.path, start + 1.5, ...p)}`);
  }
  // Mid-sweep: the left end is drawn before the right one.
  const mid = start + 0.1;
  assert.ok(yellow(pixelAt(v.path, mid, ...pts[0])) && !yellow(pixelAt(v.path, mid, ...pts[1])), `sweeps left → right at ${mid}`);
});

test("transitions keep every timing: same length and identical frames away from the page changes as without them", { timeout: 10 * MIN }, async () => {
  const v = (made.result?.videos as Rec[])?.find((x) => x.lang === "en");
  assert.ok(v, "needs the make above");
  const withT = path.join(RUN, "with-transitions.mp4");
  fs.copyFileSync(v.path, withT);
  const log = fs.readFileSync(path.join(JOB, "logs", "produce-en.log"), "utf-8");
  const changes = [...log.matchAll(/(fade|slide) [\d.]+s: page changes ([\d.]+)s-([\d.]+)s/g)].map((m) => Number(m[2]) + (v.cards[0].durationSec as number));
  assert.equal(changes.length, 2, `both transitions found a page change:\n${log}`);
  const raw = JSON.parse(fs.readFileSync(SCRIPT, "utf-8"));
  raw.transition = "none";
  raw.steps[1].transition = "none";
  raw.languages = ["en"];
  fs.writeFileSync(SCRIPT, JSON.stringify(raw, null, 2));
  const r = ok(await cli(["produce", JOB]), "produce without transitions");
  const without = (r.videos as Rec[])[0].path as string;
  assert.ok(Math.abs(probeDuration(without) - probeDuration(withT)) < 0.05, "same length");
  // Mid-transition the frames differ (old page on top)…
  assert.ok(psnrAt(withT, without, changes[0] + 0.15) < 30, "the slide is visible");
  // …and a second later they are identical again: nothing shifted.
  for (const t of [changes[0] + 1.5, changes[1] + 1.5, changes[0] - 1.5]) {
    const p = psnrAt(withT, without, t);
    assert.ok(p > 40, `identical frames at ${t.toFixed(2)}s (PSNR ${p.toFixed(1)} dB)`);
  }
  // The audio is untouched: chapters (and so the narrations) sit at the same times.
  assert.deepEqual(probeChapters(without).map((c) => c.start), probeChapters(withT).map((c) => c.start));
});
