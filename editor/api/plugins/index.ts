// ─── recording plugins ───────────────────────────────────────────────
//
// A plugin changes HOW a script is recorded (the browser it runs in, extra acts)
// without touching the rest of the pipeline. The core calls these hooks only for
// scripts that turn a plugin on under `plugins` — every other script runs
// exactly as before.

import type { BrowserContextOptions, Locator, Page } from "playwright";
import type { AgentError, ErrorCode } from "../errors";
import type { ActEntry, DemoScript, Rect, Selector } from "../schema";
import type { NaraAction } from "../types";
import { flutterPlugin } from "./flutter";

/** What the runner lends a plugin to carry out an act. */
export interface PluginActApi {
  page: Page;
  /** Wait for a selector to be visible (the runner's usual errors if not). */
  resolve(sel: Selector, timeoutMs: number): Promise<Locator>;
  /** The selector's first match, without waiting. */
  locate(sel: Selector): Locator;
  /** Build an error with a failure screenshot, like the runner's own. */
  fail(code: ErrorCode, message: string, init: { hint: string; selector?: Selector; details?: Record<string, unknown> }): Promise<AgentError>;
  timeoutMs: number;
}

export interface NaraPlugin {
  name: string;
  /** Browser size in CSS px (script.viewport is then the VIDEO size). */
  browserViewport?: { width: number; height: number };
  /** Extra Playwright context options (device emulation). */
  contextOptions?: Partial<BrowserContextOptions>;
  /** Taps instead of mouse clicks (a mouse click on a phone UI triggers hover tooltips). */
  touch?: boolean;
  /** Before every act: get the page ready (e.g. switch on Flutter's accessibility tree). */
  ready?(page: Page, timeoutMs: number): Promise<void>;
  /** A text field was just focused/cleared, before typing. */
  afterFocus?(loc: Locator): Promise<void>;
  /** Acts the core doesn't know. Return undefined if not handled. */
  runAct?(e: ActEntry, api: PluginActApi): Promise<{ rect?: Rect; focus?: Rect | null } | undefined>;
  /** Browser (CSS) px → video px, for trace boxes. */
  toVideo?(r: Rect): Rect;
  /** Compile: a restyled copy of the script (e.g. text sizes for a denser video). */
  compileScript?(script: DemoScript): DemoScript;
  /** Compile: adjust the finished actions in place. */
  adjustActions?(actions: NaraAction[]): void;
}

/** Plugins a script turned on (empty for almost every script). */
export function pluginsFor(script: Pick<DemoScript, "plugins">): NaraPlugin[] {
  const out: NaraPlugin[] = [];
  if (script.plugins?.flutter) out.push(flutterPlugin(script.plugins.flutter));
  return out;
}

/**
 * Script checks for plugins (validate): plugin-only acts need their plugin, and
 * a plugin that records at another size sets script.viewport to the VIDEO size
 * (the browser runs at the plugin's CSS size).
 */
export function checkPlugins(script: DemoScript, raw: unknown, warnings: string[]): { path: string; message: string; hint?: string }[] {
  const issues: { path: string; message: string; hint?: string }[] = [];
  const flutter = !!script.plugins?.flutter;
  const entries: [unknown, string][] = [
    ...(script.setup ?? []).map((e, i) => [e, `setup[${i}]`] as [unknown, string]),
    ...script.steps.flatMap((st, si) => st.beat.map((e, i) => [e, `steps[${si}].beat[${i}]`] as [unknown, string])),
  ];
  for (const [e, at] of entries) {
    if ((e as ActEntry).act === "swipe" && !flutter) {
      issues.push({ path: at, message: "swipe needs the flutter plugin", hint: 'Add "plugins": {"flutter": {}} to the script (touch swipes need a phone-emulated browser).' });
    }
  }
  if (flutter && script.source) issues.push({ path: "plugins.flutter", message: "the flutter plugin records a website; it can't be used with source.video" });
  const video = pluginVideoSize(script);
  if (video) {
    const given = raw && typeof raw === "object" ? (raw as Record<string, unknown>).viewport : undefined;
    if (given) warnings.push(`viewport is ignored with plugins.flutter: the phone (plugins.flutter.device) sets the size; the video is ${video.width}x${video.height}.`);
    script.viewport = video;
  }
  return issues;
}

/** The video size a plugin records at, or undefined (= script.viewport as written). */
export function pluginVideoSize(script: Pick<DemoScript, "plugins">): { width: number; height: number } | undefined {
  for (const p of pluginsFor(script)) {
    if (p.browserViewport && p.toVideo) {
      const [, , width, height] = p.toVideo([0, 0, p.browserViewport.width, p.browserViewport.height]);
      return { width, height };
    }
  }
  return undefined;
}
