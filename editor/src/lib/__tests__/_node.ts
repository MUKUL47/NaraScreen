/* eslint-disable @typescript-eslint/no-require-imports */
// Node-only helpers for the model tests. Run: npx tsx --test src/lib/__tests__/*.test.ts
//
// Everything Node-specific is loaded with `require` on purpose: tsconfig.app.json type-checks all
// of src/, and a static `import "node:test"` or `import "../../../api/validate"` would pull
// @types/node (and the fs-using api/ tree) into the renderer's program. tsx runs these files as
// CommonJS, so `require` and `__dirname` exist at runtime; the types below cover what we use.
import type { DemoScript, Rect } from "../../../api/schema";
import type { NaraAction, TraceEntry } from "../../../api/types";

declare const require: (id: string) => unknown;
declare const __dirname: string;
declare const process: { env: Record<string, string | undefined> };

type TestFn = (name: string, fn: () => void | Promise<void>) => void;
export const { test } = require("node:test") as { test: TestFn & { skip: TestFn } };

export interface Assert {
  ok(value: unknown, message?: string): asserts value;
  equal(actual: unknown, expected: unknown, message?: string): void;
  notEqual(actual: unknown, expected: unknown, message?: string): void;
  deepEqual(actual: unknown, expected: unknown, message?: string): void;
  match(actual: string, re: RegExp, message?: string): void;
  throws(fn: () => unknown, expected?: RegExp | object, message?: string): void;
}
export const assert: Assert = require("node:assert/strict") as Assert;

interface Fs {
  readFileSync(p: string, enc: "utf8"): string;
  writeFileSync(p: string, data: string): void;
  existsSync(p: string): boolean;
  mkdirSync(p: string, o?: { recursive?: boolean }): void;
  mkdtempSync(prefix: string): string;
  readdirSync(p: string): string[];
  rmSync(p: string, o?: { recursive?: boolean; force?: boolean }): void;
}
export const fs = require("node:fs") as Fs;
const path = require("node:path") as { join(...p: string[]): string; resolve(...p: string[]): string };
const os = require("node:os") as { tmpdir(): string };
const cp = require("node:child_process") as { spawnSync(cmd: string, args: string[], o?: object): { status: number | null; stderr?: { toString(): string } } };

export const EDITOR = path.resolve(__dirname, "../../..");
export const REPO = path.resolve(EDITOR, "..");
export const FIXTURES = path.join(__dirname, "fixtures");
export const join = path.join;

export function readFixture<T = unknown>(name: string, vars: Record<string, string> = {}): T {
  let text = fs.readFileSync(path.join(FIXTURES, name), "utf8");
  for (const [k, v] of Object.entries(vars)) text = text.split(k).join(v);
  return JSON.parse(text) as T;
}

export function tmpDir(tag: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `narascreen-model-${tag}-`));
}

let ffmpegOk: boolean | undefined;
/** Is an ffmpeg binary on PATH? (The round-trip tests need it for synthetic videos.) */
export function hasFfmpeg(): boolean {
  if (ffmpegOk == null) ffmpegOk = cp.spawnSync("ffmpeg", ["-version"]).status === 0;
  return ffmpegOk;
}

/** A plain grey H.264 video of this size and length (what validate probes). */
export function makeVideo(file: string, width: number, height: number, seconds: number): string {
  const r = cp.spawnSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", `color=c=gray:s=${width}x${height}:r=30`, "-t", String(seconds), "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", file]);
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${r.stderr?.toString()}`);
  return file;
}

/** A short silent audio file (music / recorded narration stand-in). */
export function makeAudio(file: string, seconds = 2): string {
  const r = cp.spawnSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo", "-t", String(seconds), file]);
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${r.stderr?.toString()}`);
  return file;
}

// ─── the real API modules (typed by hand: see the note at the top) ───

export interface Validate {
  validateScript(raw: unknown, ctx: { dir: string; env?: Record<string, string | undefined> }): { script: DemoScript; warnings: string[] };
}
export interface FakeClip { key: string; step: string; entry: number; lang: string; voice: string; speed: number; text: string; audioPath: string; durationSec: number; cached: boolean }
export interface Compiler {
  compile(script: DemoScript, trace: TraceEntry[], lang?: string, clips?: Map<string, FakeClip>, warnings?: string[], opts?: { durationSec?: number }): NaraAction[];
}
export interface VideoSource {
  timelineTrace(script: DemoScript, durationSec: number): TraceEntry[];
}
export const api = {
  validate: () => require(path.join(EDITOR, "api/validate.ts")) as Validate,
  compiler: () => require(path.join(EDITOR, "api/compiler.ts")) as Compiler,
  videoSource: () => require(path.join(EDITOR, "api/video-source.ts")) as VideoSource,
};

/** validate → trace from `at`/`rect` → compile: the actions `narascreen make` would render. */
export function compileScript(
  raw: DemoScript,
  dir: string,
  durationSec: number,
  lang = "en",
  /** clip seconds per `${step}:${entry}` key (fake narration clips; only their length matters) */
  clipSec?: Record<string, number>,
): { actions: NaraAction[]; warnings: string[]; validateWarnings: string[] } {
  const { script, warnings: validateWarnings } = api.validate().validateScript(structuredClone(raw), { dir, env: process.env });
  const warnings: string[] = [];
  const trace = api.videoSource().timelineTrace(script, durationSec);
  const clips = clipSec
    ? new Map(Object.entries(clipSec).map(([key, durationSec]) => {
        const [step, entry] = key.split(":");
        return [key, { key, step, entry: Number(entry), lang, voice: "af_heart", speed: 1, text: "x", audioPath: `/clip/${key}.wav`, durationSec, cached: true }];
      }))
    : undefined;
  const actions = api.compiler().compile(script, trace, lang, clips, warnings, { durationSec });
  return { actions, warnings, validateWarnings };
}

export type { NaraAction, Rect };
