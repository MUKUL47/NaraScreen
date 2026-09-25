// ─── runner: execute a demo-script in Chromium, record video + trace ─
//
// Playwright is the ACTOR (drives the browser), the CLOCK (stamps every slot
// with its time in the recording) and the RULER (measures each target's box after
// it is revealed). That is why an agent never writes a timestamp or a pixel: the
// compiler places effects from this trace.
//
// Rhythm per entry — the proven one, it produces watchable videos:
//   act:  reveal target (scroll it to the middle, let it settle ON CAMERA)
//         → act → stamp trace (t = the on-screen result) → dwell
//   fx:   reveal its anchor (if any, else reuse the last box in the step)
//         → stamp trace → dwell
// `setup` runs BEFORE the screencast starts (logins etc. never show up).
// Check mode does the same work without recording; headless it is also fast.
//
// Every failure is an AgentError an agent that has never seen the page can act
// on: code, where (step/entry/path), a screenshot, the URL, the headings, and
// the closest elements with ready-to-paste selectors. Selectors are resolved by
// page-elements.ts — the same code `inspect` uses to suggest them.

import * as fs from "fs";
import * as path from "path";
import { chromium, type Browser, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { AgentError, type ErrorCode, type ErrorWhere } from "./errors";
import { log as defaultLog, stage, step, warn, type Log } from "./output";
import {
  collectElements,
  describeSelector,
  locate,
  locateAll,
  measureVisible,
  pageHeadings,
  pickSelector,
  scopeLocator,
  similarElements,
  suggestRole,
  ARIA_ROLES,
} from "./page-elements";
import { startScreencast, type Screencast } from "./screencast";
import { RANGE_FX } from "./schema";
import {
  BUILTIN_DEFAULTS,
  isAct,
  type ActEntry,
  type Beat,
  type DemoDefaults,
  type DemoScript,
  type FxEntry,
  type Rect,
  type Selector,
  type TraceEntry,
} from "./types";

export interface RunOptions {
  headed?: boolean;
  /** Dry run: no screencast. Headless check also uses dwellMs 0 / revealMs 120. */
  check?: boolean;
  /** Headed only: keep the browser open at the end (or on failure) until Enter on stdin. */
  holdOpen?: boolean;
  /** Stop after this step id (BEAT_NOT_FOUND if absent). Used by inspect. */
  untilStep?: string;
  /** Screenshots of failed steps go here as <step>-<entry>.png. */
  failuresDir: string;
  log?: Log;
  /** Called after the last executed step, before the browser closes (inspect uses it). */
  onPage?: (page: Page) => Promise<void>;
}

export interface RunResult {
  /** <recordingsDir>/recording.mp4 (absent in check mode). */
  recordingPath?: string;
  /** One entry per executed slot; `t` is clamped inside the video. */
  trace: TraceEntry[];
  /** Video duration (check mode: wall time of the steps). */
  durationSec: number;
  warnings: string[];
}

/** Let the recorder roll before the first action so t≈0 is a real frame. */
const LEAD_IN_MS = 500;
/** Extra hold after the last slot so the final effect window is fully captured. */
const TAIL_PAD_MS = 500;
/** page.goto gets at least this long, whatever defaults.timeoutMs says (slow first loads). */
const MIN_NAV_TIMEOUT_MS = 30_000;
/** Budget for listing candidate elements when a step fails. */
const DIAGNOSE_BUDGET_MS = 15_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** Everything the step executors need. */
interface Env {
  page: Page;
  script: DemoScript;
  failuresDir: string;
  warnings: string[];
  log: Log;
  /** Id of the last completed step — lets hints say `inspect --until <id>`. */
  prevStep?: string;
  /** Path of the entry being executed (for warnings raised by page events). */
  currentPath: string;
  /** Pages NaraScreen opened itself (not "the site opened a new tab"). */
  internalPages: Set<Page>;
  /** NaraScreen is opening a helper tab right now (its "page" event fires before newPage() resolves). */
  openingInternal?: boolean;
  /** Headless check: scroll instantly instead of gliding (nothing is filmed). */
  fast?: boolean;
}

// ─── entry point ─────────────────────────────────────────────────────

export async function run(script: DemoScript, recordingsDir: string, opts: RunOptions): Promise<RunResult> {
  const log = opts.log ?? defaultLog;
  const check = !!opts.check;
  // Shrink timing only for a HEADLESS check (fastest failure). Headed keeps real
  // dwells so a human can watch each step land.
  const fastCheck = check && !opts.headed;
  const base: DemoDefaults = { ...BUILTIN_DEFAULTS, ...script.defaults };
  const d: DemoDefaults = fastCheck ? { ...base, dwellMs: 0, revealMs: 120 } : base;

  if (script.source) {
    throw new AgentError("USAGE", "Video-source scripts are imported, not run: there is no browser step to execute", {
      hint: "`record`/`make` import source.video directly; look at the video with `narascreen preview <job> --raw`.",
      where: { path: "source" },
    });
  }
  const baseUrl = script.baseUrl;
  if (!baseUrl) {
    throw new AgentError("SCRIPT_INVALID", "The script has no baseUrl, so there is no website to open", {
      hint: "Add \"baseUrl\": \"https://…\" (the site to record), then run `narascreen validate`.",
      where: { path: "baseUrl" },
    });
  }
  const steps = stepsToRun(script, opts.untilStep);
  if (script.storageState && !fs.existsSync(script.storageState)) {
    throw new AgentError("STORAGE_STATE_NOT_FOUND", `storageState file not found: ${script.storageState}`, {
      hint: "Create it (log in with Playwright and save context.storageState()), or remove storageState and log in with `setup` entries.",
      where: { path: "storageState" },
      details: { path: script.storageState },
    });
  }

  const browser = await launchBrowser(!!opts.headed);
  const framesDir = path.join(recordingsDir, "frames");
  let screencast: Screencast | null = null;
  let env: Env | undefined;
  try {
    const context = await newContext(browser, script);
    const page = await context.newPage();
    env = {
      page,
      script,
      failuresDir: path.resolve(opts.failuresDir),
      warnings: [],
      log,
      currentPath: "",
      internalPages: new Set(),
      fast: fastCheck,
    };
    watchPageEvents(env, context);

    // ── setup: before the recording, fast, no trace
    if (script.setup?.length) {
      stage("setup", `Running ${script.setup.length} setup action(s) — not recorded`);
      const sd: DemoDefaults = { ...d, dwellMs: 0, revealMs: 0, typeDelayMs: 0, center: false };
      for (let i = 0; i < script.setup.length; i++) {
        const e = script.setup[i];
        const where: ErrorWhere = { entry: i, path: `setup[${i}]` };
        env.currentPath = where.path!;
        await runAct(env, e, where, sd);
        log(`${where.path} ${describeEntry(e)}`);
      }
      await page.waitForLoadState("load", { timeout: 5000 }).catch(() => {});
    }

    // A script must start on a page; a first step that doesn't navigate would
    // otherwise record about:blank and fail on its first selector.
    if (steps.length && page.url() === "about:blank" && !startsWithNavigation(steps[0])) {
      env.currentPath = "steps[0]";
      await gotoChecked(env, baseUrl, { path: "baseUrl" }, navTimeout(d));
      addWarning(env, `steps[0] does not start with a goto, so NaraScreen opened baseUrl (${baseUrl}) first. Add {"act": "goto", "path": "/…"} to make the start explicit.`);
    }

    // ── record (or check)
    if (steps.length) {
      stage(
        "record",
        check
          ? `Checking ${steps.length} step(s) — dry run, nothing is recorded`
          : `Recording ${steps.length} step(s)`,
        { steps: steps.length, check },
      );
    }
    if (!check) {
      fs.mkdirSync(recordingsDir, { recursive: true });
      try {
        screencast = await startScreencast(page, framesDir, { outputSize: script.viewport });
      } catch (err) {
        throw new AgentError("RECORDING_FAILED", `Could not start the screen recording: ${firstLine(err)}`, {
          hint: "Retry. If it repeats, run `narascreen doctor` and check that Chromium starts.",
          details: { error: errText(err) },
        });
      }
      await sleep(LEAD_IN_MS);
    }
    const t0 = Date.now();
    const now = () => (screencast ? screencast.now() : (Date.now() - t0) / 1000);
    const trace: TraceEntry[] = [];

    for (let si = 0; si < steps.length; si++) {
      const beat = steps[si];
      await runStep(env, beat, si, steps.length, d, fastCheck, now, trace);
      env.prevStep = beat.id;
    }

    let durationSec = round3(now());
    let recordingPath: string | undefined;
    if (screencast) {
      await sleep(d.dwellMs + TAIL_PAD_MS);
      const sc = screencast;
      screencast = null;
      recordingPath = path.join(recordingsDir, "recording.mp4");
      try {
        durationSec = round3(await sc.stop(recordingPath));
      } catch (err) {
        throw new AgentError("RECORDING_FAILED", `The screen recording could not be assembled: ${firstLine(err)}`, {
          hint: "Retry the recording. If it repeats, run `narascreen doctor` (ffmpeg) and report details.",
          details: { error: errText(err), frames: sc.frameCount(), recordingPath },
        });
      }
      if (!(durationSec > 0)) {
        throw new AgentError("RECORDING_FAILED", "The assembled recording has no duration", {
          hint: "Retry the recording. If it repeats, run `narascreen doctor` (ffmpeg).",
          details: { recordingPath, frames: sc.frameCount() },
        });
      }
      // Keep every effect inside the real video so none lands after the last frame.
      for (const e of trace) e.t = round3(Math.max(0, Math.min(e.t, durationSec - 0.05)));
    }

    if (opts.onPage) await opts.onPage(page);
    if (opts.holdOpen && opts.headed) await holdOpen(log, "Run finished");
    return { recordingPath, trace, durationSec, warnings: env.warnings };
  } catch (err) {
    if (opts.holdOpen && opts.headed && env) {
      await holdOpen(log, `Run failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    throw err;
  } finally {
    if (screencast) await screencast.abort().catch(() => {});
    if (!check) fs.rmSync(framesDir, { recursive: true, force: true });
    await browser.close().catch(() => {});
  }
}

function stepsToRun(script: DemoScript, untilStep: string | undefined): Beat[] {
  if (untilStep == null) return script.steps;
  const idx = script.steps.findIndex((s) => s.id === untilStep);
  if (idx < 0) {
    const ids = script.steps.map((s) => s.id);
    throw new AgentError("BEAT_NOT_FOUND", `No step with id "${untilStep}" in the script`, {
      hint: `Pass one of the step ids: ${ids.join(", ")}.`,
      details: { untilStep, stepIds: ids },
    });
  }
  return script.steps.slice(0, idx + 1);
}

function startsWithNavigation(beat: Beat): boolean {
  const first = beat.beat[0];
  return !!first && isAct(first) && (first.act === "goto" || first.act === "useSession");
}

async function runStep(
  env: Env,
  beat: Beat,
  si: number,
  total: number,
  d: DemoDefaults,
  fastCheck: boolean,
  now: () => number,
  trace: TraceEntry[],
): Promise<void> {
  step(`step ${si + 1}/${total} · ${beat.id}${beat.label ? ` — ${beat.label}` : ""}`, {
    index: si + 1,
    total,
    id: beat.id,
    ...(beat.label ? { label: beat.label } : {}),
  });
  const dwell = fastCheck ? 0 : beat.dwellMs ?? d.dwellMs;
  let lastRect: Rect | undefined; // fx without an anchor reuse the latest box in the step
  let prevT: number | undefined; // trace t of the previous slot in this step

  for (let i = 0; i < beat.beat.length; i++) {
    const entry = beat.beat[i];
    const where: ErrorWhere = { step: beat.id, entry: i, path: `steps[${si}].beat[${i}]` };
    env.currentPath = where.path!;
    let rect: Rect | undefined;
    let rects: Rect[] | undefined;
    let blurStart: number | undefined;
    if (isAct(entry)) {
      const res = await runAct(env, entry, where, d);
      rect = res.rect;
      if (res.focus !== undefined) lastRect = res.focus ?? undefined;
    } else {
      // A `disabled` fx is still revealed and dwelled on: toggling it must not
      // change the recording (it is not part of the job's structure hash).
      // Range fx (speed/skip/mute) only mark a time, so they carry no box.
      rect = RANGE_FX.includes(entry.fx) ? undefined : lastRect;
      // A blur hides a secret: where was it BEFORE the reveal? (see below)
      const blurSels = entry.fx === "blur" ? (entry.anchors?.length ? entry.anchors : entry.anchor ? [entry.anchor] : []) : [];
      const blurT = blurSels.length ? now() : undefined;
      const blurBefore = blurSels.length
        ? await Promise.all(blurSels.map((a) => measureVisible(locate(env.page, a), 500).catch(() => null)))
        : [];
      if (entry.targets?.length) {
        rects = await targetRects(env, entry.targets, where, d);
        rect = rects[0];
      } else if (entry.anchors?.length) {
        const items = entry.anchors.map((sel, k) => ({ sel, where: { ...where, path: `${where.path}.anchors[${k}]` } }));
        rects = await revealGroup(env, items, d);
        rect = rects[0];
      } else if (entry.anchor) {
        const at: ErrorWhere = { ...where, path: `${where.path}.anchor` };
        const loc = await resolveTarget(env, entry.anchor, at, d.timeoutMs);
        rect = await reveal(env, loc, entry.anchor, at, d, d.timeoutMs);
      }
      if (rect) lastRect = rect;
      if (blurSels.length) {
        const after = rects ?? (rect ? [rect] : []);
        const unmoved =
          after.length === blurBefore.length &&
          blurBefore.every((b, k) => !!b?.whole && !!b.visible && b.visible.every((v, n) => Math.abs(v - after[k][n]) <= 2));
        if (unmoved) {
          // Already on screen where it gets blurred: start the blur as early as
          // it was known to be there (end of the previous slot, else just now),
          // not after the reveal/settle — otherwise the secret is readable meanwhile.
          blurStart = prevT ?? blurT;
        } else if (blurBefore.some((b) => b?.visible)) {
          addWarning(
            env,
            `${where.path}: the element to blur moved while being revealed (scrolled into place), so it was visible unblurred for a moment. ` +
              `Put the blur where the element is already on screen (e.g. after a scroll to it), or accept the brief exposure.`,
          );
        }
      }
    }
    // Stamp AFTER the act/reveal: t marks the on-screen result, which the dwell
    // then holds and any following fx aligns to. (Exception: an unmoved blur.)
    const t = round3(blurStart ?? now());
    prevT = t;
    trace.push({
      beat: beat.id,
      i,
      kind: isAct(entry) ? "act" : "fx",
      ...(isAct(entry) ? { act: entry.act } : { fx: entry.fx }),
      t,
      ...(rect ? { rect } : {}),
      ...(rects ? { rects } : {}),
    });
    env.log(`${where.path} ${describeEntry(entry)} · t=${t.toFixed(2)}s`);
    await sleep(dwell);
  }
}

function describeEntry(e: Beat["beat"][number]): string {
  if (isAct(e)) {
    const sel = pickSelector(e);
    const extra =
      e.act === "goto" ? ` ${e.url ?? e.path}` :
      e.act === "wait" ? ` ${e.ms}ms` :
      e.act === "press" ? ` ${e.key}` :
      e.act === "select" ? ` "${e.option}"` :
      e.act === "useSession" ? ` ${e.storageState}` :
      e.act === "scroll" && !sel ? ` y=${e.y}` : "";
    return `${e.act}${sel ? ` ${describeSelector(sel)}` : ""}${extra}`;
  }
  const target = e.targets?.length
    ? ` ${e.targets.length} targets`
    : e.anchors?.length
      ? ` ${e.anchors.map(describeSelector).join(" + ")}`
      : e.anchor
        ? ` ${describeSelector(e.anchor)}`
        : "";
  return `fx ${e.fx}${target}${e.disabled ? " (disabled)" : ""}`;
}

// ─── browser setup ───────────────────────────────────────────────────

async function launchBrowser(headed: boolean): Promise<Browser> {
  try {
    return await chromium.launch({ headless: !headed });
  } catch (err) {
    const msg = errText(err);
    if (/Executable doesn't exist|download new browsers|playwright install/i.test(msg)) {
      throw new AgentError("BROWSER_MISSING", "Playwright's Chromium is not installed", {
        hint: "Run `npx playwright install chromium` in the NaraScreen editor folder, then retry (`narascreen doctor` checks it).",
        details: { error: firstLines(msg, 4) },
      });
    }
    if (/missing dependencies/i.test(msg)) {
      throw new AgentError("BROWSER_MISSING", "Chromium is installed but the system is missing libraries it needs", {
        hint: "Run `npx playwright install-deps chromium` (needs admin rights), then retry.",
        details: { error: firstLines(msg, 8) },
      });
    }
    if (headed && /display|X server|XServer/i.test(msg)) {
      throw new AgentError("BROWSER_MISSING", "Cannot open a browser window: no display available", {
        hint: "Run without --headed on machines without a screen.",
        details: { error: firstLines(msg, 4) },
      });
    }
    throw new AgentError("BROWSER_MISSING", `Chromium failed to start: ${firstLine(err)}`, {
      hint: "Run `narascreen doctor`; reinstall the browser with `npx playwright install chromium`.",
      details: { error: firstLines(msg, 8) },
    });
  }
}

async function newContext(browser: Browser, script: DemoScript): Promise<BrowserContext> {
  try {
    return await browser.newContext({
      // baseURL makes goto("/settings") resolve against the site.
      baseURL: script.baseUrl,
      viewport: script.viewport,
      // Supersampled capture; screencast.ts downscales to the viewport, so video
      // pixels == CSS pixels == trace rects, with crisper text.
      deviceScaleFactor: 2,
      ...(script.storageState ? { storageState: script.storageState } : {}),
    });
  } catch (err) {
    if (script.storageState) {
      throw new AgentError("STORAGE_STATE_NOT_FOUND", `Could not load storageState ${script.storageState}: ${firstLine(err)}`, {
        hint: "The file must be a Playwright storageState JSON ({ cookies, origins }). Re-create it, or log in with `setup` entries.",
        where: { path: "storageState" },
        details: { path: script.storageState, error: firstLines(errText(err), 4) },
      });
    }
    throw err;
  }
}

/** Native dialogs and new tabs are invisible in the recording — handle + report them. */
function watchPageEvents(env: Env, context: BrowserContext): void {
  env.page.on("dialog", (dlg) => {
    addWarning(
      env,
      `${env.currentPath}: a native ${dlg.type()} dialog ("${dlg.message().slice(0, 80)}") was accepted automatically; it does not appear in the video.`,
    );
    void dlg.accept().catch(() => {});
  });
  context.on("page", (p) => {
    if (env.openingInternal || env.internalPages.has(p)) return;
    addWarning(
      env,
      `${env.currentPath}: the site opened a new tab/window. Only the original tab is recorded and the script keeps acting there. Prefer a goto to that URL instead.`,
    );
  });
}

function addWarning(env: Env, msg: string): void {
  env.warnings.push(msg);
  warn(msg);
}

function navTimeout(d: DemoDefaults): number {
  return Math.max(MIN_NAV_TIMEOUT_MS, d.timeoutMs);
}

// ─── acts ────────────────────────────────────────────────────────────

/**
 * What an act leaves behind: `rect` = the target's box when it was acted on
 * (goes into the trace), `focus` = the box following anchorless fx should use
 * (undefined = unchanged, null = no element to inherit).
 */
interface ActResult {
  rect?: Rect;
  focus?: Rect | null;
}

/** Visible box of an element right now, without scrolling (null if not visible). */
async function currentRect(loc: Locator): Promise<Rect | null> {
  return (await measureVisible(loc, 500))?.visible ?? null;
}

/** Execute one act. */
async function runAct(env: Env, e: ActEntry, where: ErrorWhere, d: DemoDefaults): Promise<ActResult> {
  const { page } = env;
  const timeout = e.timeoutMs ?? d.timeoutMs;
  const sel = pickSelector(e);

  switch (e.act) {
    case "goto":
      await gotoChecked(env, (e.url ?? e.path)!, where, navTimeout(d));
      return {};

    case "wait":
      await sleep(e.ms ?? 0);
      return {};

    case "useSession":
      await useSession(env, e, where, navTimeout(d));
      return {};

    case "waitFor": {
      // A gate: nothing is revealed, but the element it waited for is what an
      // anchorless fx right after it means ("wait for the dialog, spotlight it").
      const loc = await resolveTarget(env, sel!, where, timeout, { waitFor: true });
      await settledBox(loc);
      return { focus: await currentRect(loc) };
    }

    case "press": {
      const key = e.key!;
      if (sel) {
        const loc = await resolveTarget(env, sel, where, timeout);
        await attempt(env, where, sel, `press "${key}" on`, () => loc.press(key, { timeout }));
        return { focus: await currentRect(loc) };
      }
      await attempt(env, where, undefined, `press "${key}"`, () => page.keyboard.press(key));
      return {};
    }

    case "scroll":
      if (!sel) {
        await scrollToY(env, e.y ?? 0, d, where);
        return {};
      }
      break; // element scroll: the reveal below IS the action
  }

  if (!sel) {
    throw await failure(env, "ACTION_FAILED", `${label(where)}: "${e.act}" needs a selector`, {
      where,
      hint: "Add one of role(+name) | label | text | placeholder | testId | css. Run `narascreen validate` first.",
    });
  }
  const loc = await resolveTarget(env, sel, where, timeout);
  const rect = await reveal(env, loc, sel, where, d, timeout);

  switch (e.act) {
    case "click":
      await attempt(env, where, sel, "click", () => loc.click({ timeout }));
      break;
    case "hover":
      await attempt(env, where, sel, "hover", () => loc.hover({ timeout }));
      break;
    case "fill": {
      const value = e.value ?? "";
      // Typing time scales with the text; don't let a long value hit the timeout.
      const typing = timeout + value.length * (d.typeDelayMs + 30);
      await attempt(env, where, sel, "type into", async () => {
        await loc.fill("", { timeout });
        if (value) await loc.pressSequentially(value, { delay: d.typeDelayMs, timeout: typing });
      });
      break;
    }
    case "select":
      await selectOption(env, loc, sel, e.option!, where, timeout);
      break;
    case "scroll":
      return { rect, focus: rect };
  }
  // The act may have moved the element (layout change, textarea growing, an
  // auto-scroll): fx that inherit it use where it is NOW; if it is gone, where it was.
  return { rect, focus: (await currentRect(loc)) ?? rect };
}

async function gotoChecked(env: Env, target: string, where: ErrorWhere, timeoutMs: number): Promise<void> {
  const url = absoluteUrl(target, env.script.baseUrl);
  let status: number | undefined;
  try {
    const resp = await env.page.goto(target, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    status = resp?.status();
  } catch (err) {
    const msg = firstLine(err);
    throw await failure(env, "NAVIGATION_FAILED", `${label(where)}: could not open ${url}: ${msg}`, {
      where,
      hint: /ERR_CONNECTION_REFUSED|ERR_NAME_NOT_RESOLVED|ERR_ADDRESS_UNREACHABLE/.test(msg)
        ? "The site is not reachable. Start it / check baseUrl, then retry."
        : /Timeout/i.test(msg)
          ? `The page did not load within ${timeoutMs}ms. Check the URL and that the server responds.`
          : "Check baseUrl + path (open the URL yourself) and that the site is running.",
      details: { targetUrl: url, error: msg },
    });
  }
  if (status != null && status >= 400) {
    throw await failure(env, "NAVIGATION_FAILED", `${label(where)}: ${url} returned HTTP ${status}`, {
      where,
      hint:
        status === 401 || status === 403
          ? "The page needs a logged-in session: add `setup` entries that log in, or a storageState file."
          : status === 404
            ? "No page at that path. Check the path against baseUrl (run `narascreen inspect --url <baseUrl>` and read the links)."
            : "The server returned an error. Check that the site works in a normal browser.",
      details: { targetUrl: url, status },
    });
  }
  // Let images/fonts arrive so the first frames don't show a half-built page.
  await env.page.waitForLoadState("load", { timeout: 5000 }).catch(() => {});
}

function absoluteUrl(target: string, baseUrl: string | undefined): string {
  try {
    return new URL(target, baseUrl).href;
  } catch {
    return target;
  }
}

/**
 * scroll {y}: scroll the page's main scroller — the document, or (apps whose
 * body doesn't scroll) the biggest scrollable element, e.g. an inner <main> —
 * to y, gliding on camera. Warns when there is nothing to scroll.
 */
async function scrollToY(env: Env, y: number, d: DemoDefaults, where: ErrorWhere): Promise<void> {
  const plan = await env.page.evaluate(
    ({ top, key, smooth }) => {
      const se = (document.scrollingElement || document.documentElement) as HTMLElement;
      let target: HTMLElement | null = se.scrollHeight - se.clientHeight > 1 ? se : null;
      if (!target) {
        let best = 0;
        for (const el of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
          if (el.scrollHeight - el.clientHeight <= 1) continue;
          const oy = getComputedStyle(el).overflowY;
          if (oy !== "auto" && oy !== "scroll") continue;
          const area = el.clientWidth * el.clientHeight;
          if (area > best) {
            best = area;
            target = el;
          }
        }
      }
      if (!target) return { found: false, from: 0, to: 0 };
      const to = Math.max(0, Math.min(top, target.scrollHeight - target.clientHeight));
      const from = target.scrollTop;
      (window as unknown as Record<string, unknown>)[key] = [{ a: target, left: target.scrollLeft, top: to }];
      target.scrollTo({ top: to, behavior: (smooth ? "smooth" : "instant") as ScrollBehavior });
      return { found: true, from, to };
    },
    { top: y, key: SCROLL_KEY, smooth: !env.fast },
  );
  if (!plan.found) {
    addWarning(env, `${where.path}: scroll to y=${y} did nothing — neither the page nor any element on it can scroll. Scroll to an element instead ({"act": "scroll", "role": …}).`);
    return;
  }
  await waitForScroll(env.page, Date.now(), d.revealMs);
}

/** Key of the page-global list of { element, target scroll position } being glided to. */
const SCROLL_KEY = "__narascreen_scroll_targets";

/**
 * Wait until every scroller reaches its target position — "the reading did not
 * change" can't tell a finished scroll from one that has not started yet (smooth
 * scrolling can start >1 s late in a fresh browser). After 3 s the positions are
 * set directly. Also waits at least `minMs` since `since` (the on-camera settle).
 */
async function waitForScroll(page: Page, since: number, minMs: number): Promise<void> {
  const check = (force: boolean) =>
    page
      .evaluate(
        ({ key, force }) => {
          const w = window as unknown as Record<string, unknown>;
          const list = (w[key] as { a: Element; left: number; top: number }[] | undefined) ?? [];
          let done = true;
          for (const x of list) {
            if (Math.abs(x.a.scrollTop - x.top) > 1 || Math.abs(x.a.scrollLeft - x.left) > 1) {
              done = false;
              if (force) x.a.scrollTo({ left: x.left, top: x.top, behavior: "instant" as ScrollBehavior });
            }
          }
          if (done || force) delete w[key];
          return done;
        },
        { key: SCROLL_KEY, force },
      )
      .catch(() => true); // navigated away: nothing left to wait for
  const deadline = since + 3000;
  while (!(await check(false))) {
    if (Date.now() > deadline) {
      await check(true);
      break;
    }
    await sleep(40);
  }
  const left = since + minMs - Date.now();
  if (left > 0) await sleep(left);
}

async function selectOption(
  env: Env,
  loc: Locator,
  sel: Selector,
  option: string,
  where: ErrorWhere,
  timeout: number,
): Promise<void> {
  // Read the options first: selectOption() would wait the full timeout for an
  // option that never appears, then fail without saying what IS there.
  const opts = await loc
    .evaluate((el) =>
      el.tagName === "SELECT"
        ? Array.from((el as HTMLSelectElement).options).map((o) => ({ label: o.label.trim(), value: o.value }))
        : null,
    )
    .catch(() => null);
  if (!opts) {
    throw await failure(env, "ACTION_FAILED", `${label(where)}: ${describeSelector(sel)} is not a native <select>`, {
      where,
      selector: sel,
      hint:
        "`select` only works on native <select> elements. For a custom dropdown, use two clicks: " +
        '{"act": "click", …the dropdown…} then {"act": "click", "role": "option", "name": "…"}.',
    });
  }
  const want = option.trim().toLowerCase();
  const index = [
    opts.findIndex((o) => o.label === option),
    opts.findIndex((o) => o.value === option),
    opts.findIndex((o) => o.label.toLowerCase() === want),
  ].find((i) => i >= 0);
  if (index == null) {
    throw await failure(env, "ACTION_FAILED", `${label(where)}: option "${option}" is not in ${describeSelector(sel)}`, {
      where,
      selector: sel,
      hint: `Use one of the labels in details.options, e.g. "${opts[0]?.label ?? ""}".`,
      details: { option, options: opts.map((o) => o.label) },
    });
  }
  await attempt(env, where, sel, "select an option in", () => loc.selectOption({ index }, { timeout }));
}

/** Switch to another saved session mid-run (e.g. a second user). */
async function useSession(env: Env, e: ActEntry, where: ErrorWhere, timeoutMs: number): Promise<void> {
  const file = e.storageState!;
  if (!fs.existsSync(file)) {
    throw await failure(env, "STORAGE_STATE_NOT_FOUND", `${label(where)}: storageState file not found: ${file}`, {
      where,
      hint: "Create the file (Playwright context.storageState({ path })) or fix the path (relative to the script file).",
      details: { path: file },
    });
  }
  let state: StorageState;
  try {
    state = JSON.parse(fs.readFileSync(file, "utf-8")) as StorageState;
  } catch (err) {
    throw await failure(env, "ACTION_FAILED", `${label(where)}: ${file} is not valid JSON: ${firstLine(err)}`, {
      where,
      hint: "useSession needs a Playwright storageState JSON: { cookies: [...], origins: [{ origin, localStorage: [...] }] }.",
      details: { path: file },
    });
  }
  const { page } = env;
  const context = page.context();
  try {
    await context.clearCookies();
    if (state.cookies?.length) await context.addCookies(state.cookies);
    // What a switch replaces: ALL cookies; the current page origin's
    // localStorage + sessionStorage (they belong to the previous session) are
    // cleared, then refilled from the file. Other origins listed in the file are
    // replaced through a throwaway tab whose requests never reach the network.
    // Origins that are neither current nor in the file keep their storage.
    const current = originOf(page.url());
    const origins = state.origins ?? [];
    if (current) {
      const items = origins.find((o) => o.origin === current)?.localStorage ?? [];
      await page.evaluate((list) => {
        localStorage.clear();
        sessionStorage.clear();
        for (const it of list) localStorage.setItem(it.name, it.value);
      }, items);
    }
    for (const o of origins.filter((x) => x.origin !== current && x.localStorage?.length)) {
      env.openingInternal = true;
      const tmp = await context.newPage().finally(() => (env.openingInternal = false));
      env.internalPages.add(tmp);
      try {
        await tmp.route("**/*", (r) => r.fulfill({ status: 200, contentType: "text/html", body: "<html></html>" }));
        await tmp.goto(o.origin);
        await tmp.evaluate((list) => {
          localStorage.clear();
          for (const it of list) localStorage.setItem(it.name, it.value);
        }, o.localStorage);
      } finally {
        await tmp.close().catch(() => {});
      }
    }
    await page.bringToFront().catch(() => {});
  } catch (err) {
    throw await failure(env, "ACTION_FAILED", `${label(where)}: could not load session ${file}: ${firstLine(err)}`, {
      where,
      hint: "Check that the file is a Playwright storageState JSON and that cookie domains match the site.",
      details: { path: file, error: firstLines(errText(err), 4) },
    });
  }
  if (e.path) {
    await gotoChecked(env, e.path, where, timeoutMs);
  } else {
    try {
      await page.reload({ waitUntil: "domcontentloaded", timeout: timeoutMs });
    } catch (err) {
      throw await failure(env, "NAVIGATION_FAILED", `${label(where)}: reload after switching session failed: ${firstLine(err)}`, {
        where,
        hint: "Give useSession a `path` to open after switching.",
      });
    }
  }
}

interface StorageState {
  cookies?: Parameters<BrowserContext["addCookies"]>[0];
  origins?: { origin: string; localStorage: { name: string; value: string }[] }[];
}

function originOf(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" ? u.origin : null;
  } catch {
    return null;
  }
}

// ─── targets ─────────────────────────────────────────────────────────

/**
 * Wait for the selector's element to be visible and return its locator. On
 * timeout, work out WHY (absent / hidden / nth too big / container missing /
 * invalid selector) and throw the matching error.
 */
async function resolveTarget(
  env: Env,
  sel: Selector,
  where: ErrorWhere,
  timeout: number,
  opts: { waitFor?: boolean } = {},
): Promise<Locator> {
  const loc = locate(env.page, sel);
  try {
    await loc.waitFor({ state: "visible", timeout });
  } catch (err) {
    throw await diagnoseMissing(env, sel, where, timeout, err, !!opts.waitFor);
  }
  if (sel.nth == null) {
    // Only visible matches are a real choice (hidden copies — templates, closed menus — aren't).
    const count = await locateAll(env.page, sel).filter({ visible: true }).count().catch(() => 1);
    if (count > 1) {
      addWarning(
        env,
        `${where.path}: selector ${describeSelector(sel)} matched ${count} visible elements; used match #${sel.nth ?? 0}. ` +
          `Add "nth" or "within" to choose explicitly (\`narascreen inspect\` suggests a unique selector).`,
      );
    }
  }
  return loc;
}

async function diagnoseMissing(
  env: Env,
  sel: Selector,
  where: ErrorWhere,
  timeout: number,
  waitErr: unknown,
  isWaitFor: boolean,
): Promise<AgentError> {
  const { page } = env;
  const text = describeSelector(sel);
  let count: number;
  try {
    count = await locateAll(page, sel).count();
  } catch (err) {
    // Playwright throws for unparsable CSS; everything else resolves to 0 matches.
    return failure(env, "SELECTOR_NOT_FOUND", `${label(where)}: invalid selector ${text}: ${firstLine(err)}`, {
      where,
      selector: sel,
      hint: "Fix the CSS syntax, or better, use role(+name) / label / text (see details.candidates).",
    });
  }
  const nth = sel.nth ?? 0;
  const containerMissing = sel.within ? (await scopeLocator(page, sel.within).count().catch(() => 0)) === 0 : false;
  const hiddenByRole =
    count === 0 && sel.role != null ? await locateAll(page, sel, { includeHidden: true }).count().catch(() => 0) : 0;
  const visibleIdx =
    count > 0
      ? await locateAll(page, sel)
          .evaluateAll((els) =>
            els
              .map((el, i) => {
                const r = el.getBoundingClientRect();
                const vis = typeof el.checkVisibility === "function" ? el.checkVisibility() : true;
                return r.width > 0 && r.height > 0 && vis ? i : -1;
              })
              .filter((i) => i >= 0),
          )
          .catch(() => [] as number[])
      : [];
  const details: Record<string, unknown> = { matches: count, timeoutMs: timeout };
  if (visibleIdx.length) details.visibleMatches = visibleIdx;
  const inspectCmd = `narascreen inspect --script <script>${env.prevStep ? ` --until ${env.prevStep}` : ""}`;
  const pickHint = `Pick a selector from details.candidates (each .selector is ready to paste), or list every element on that page with \`${inspectCmd}\`. details.screenshot shows what the page looked like.`;
  const unknownRole =
    sel.role != null && !ARIA_ROLES.includes(sel.role)
      ? `"${sel.role}" is not an ARIA role${suggestRole(sel.role) ? ` — did you mean "${suggestRole(sel.role)}"?` : "."} `
      : "";

  let code: ErrorCode;
  let message: string;
  let hint: string;
  if (containerMissing) {
    code = isWaitFor ? "WAIT_TIMEOUT" : "SELECTOR_NOT_FOUND";
    message = `${label(where)}: the \`within\` container (${text.slice(text.indexOf(" within ") + 8)}) is not on the page`;
    hint = `Fix or drop \`within\`. ${pickHint}`;
  } else if (count === 0 && hiddenByRole > 0) {
    code = isWaitFor ? "WAIT_TIMEOUT" : "TARGET_NOT_VISIBLE";
    message = `${label(where)}: ${text} exists but is hidden (waited ${timeout}ms)`;
    hint = "Do whatever reveals it first in an earlier entry (open the menu/tab/dialog, hover the row).";
    details.hiddenMatches = hiddenByRole;
  } else if (count === 0) {
    code = isWaitFor ? "WAIT_TIMEOUT" : "SELECTOR_NOT_FOUND";
    message = `${label(where)}: no element matches ${text} (waited ${timeout}ms)`;
    hint = isWaitFor
      ? `${unknownRole}Nothing like that appeared. The previous entry probably did not do what you expected — check details.screenshot/headings. If the page is just slow, raise timeoutMs. ${pickHint}`
      : `${unknownRole}${pickHint}`;
  } else if (nth >= count) {
    code = isWaitFor ? "WAIT_TIMEOUT" : "SELECTOR_NOT_FOUND";
    message = `${label(where)}: ${text} asks for match #${nth} but only ${count} element(s) match`;
    hint = `Use nth 0..${count - 1}, or a more specific selector. ${pickHint}`;
  } else {
    code = isWaitFor ? "WAIT_TIMEOUT" : "TARGET_NOT_VISIBLE";
    message = `${label(where)}: ${text} matched ${count} element(s) but match #${nth} is hidden or has no size (waited ${timeout}ms)`;
    const other = visibleIdx.find((i) => i !== nth);
    hint =
      other != null
        ? `Match #${other} is visible — add "nth": ${other}, or narrow with "within". Otherwise do whatever reveals the element first (open the menu/tab/dialog).`
        : "Do whatever reveals it first in an earlier entry (open the menu/tab/dialog, hover the row, switch tabs).";
  }
  if (!isPlaywrightTimeout(waitErr)) details.error = firstLines(errText(waitErr), 3);
  return failure(env, code, message, { where, selector: sel, hint, details });
}

/**
 * Bring the element on camera (scroll it to the middle, let it settle) and return
 * its box in video coordinates. Big elements are aligned to the top instead so
 * their start stays visible.
 */
async function reveal(env: Env, loc: Locator, sel: Selector, where: ErrorWhere, d: DemoDefaults, timeout: number): Promise<Rect> {
  // Scrolled in-page rather than with locator.scrollIntoViewIfNeeded(): that one
  // runs actionability retries which stall on disabled elements, and the target
  // is already known to be visible here. "On screen" means not clipped by the
  // viewport NOR by a scrolling / overflow-hidden ancestor (a row in a list).
  const before = await measureVisible(loc, timeout);
  const started = Date.now();
  try {
    await loc.evaluate(
      (el, o) => {
        // Jump (instantly) when not fully visible, so the glide below is short.
        if (o.jump) el.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" as ScrollBehavior });
        const w = window as unknown as Record<string, unknown>;
        if (!o.center) {
          delete w[o.key];
          return;
        }
        // Glide to the middle ON CAMERA (tall elements: to the top). Record where
        // every scroller ends up (instant dry run, then back) so the caller can
        // wait for the glide to really arrive.
        const block: ScrollLogicalPosition = el.getBoundingClientRect().height > window.innerHeight * 0.8 ? "start" : "center";
        const scrollers: Element[] = [];
        for (let a = el.parentElement; a; a = a.parentElement) {
          if (a.scrollHeight > a.clientHeight || a.scrollWidth > a.clientWidth) scrollers.push(a);
        }
        const se = document.scrollingElement || document.documentElement;
        if (!scrollers.includes(se)) scrollers.push(se);
        const from = scrollers.map((a) => [a.scrollLeft, a.scrollTop]);
        el.scrollIntoView({ block, inline: "center", behavior: "instant" as ScrollBehavior });
        w[o.key] = scrollers.map((a) => ({ a, left: a.scrollLeft, top: a.scrollTop }));
        if (o.smooth) {
          scrollers.forEach((a, i) => a.scrollTo({ left: from[i][0], top: from[i][1], behavior: "instant" as ScrollBehavior }));
          el.scrollIntoView({ block, inline: "center", behavior: "smooth" });
        }
      },
      { center: d.center, jump: !before?.whole, smooth: !env.fast, key: SCROLL_KEY },
      { timeout },
    );
  } catch (err) {
    throw await failure(env, "TARGET_NOT_VISIBLE", `${label(where)}: could not scroll ${describeSelector(sel)} into view: ${firstLine(err)}`, {
      where,
      selector: sel,
      hint: "The element is hidden, detached or covered. Do whatever reveals it first (open the menu/tab/dialog).",
    });
  }
  // Let the glide ARRIVE and settle on camera before measuring.
  await waitForScroll(env.page, started, d.revealMs);
  const box = await settledBox(loc);
  const m = box ? await measureVisible(loc, timeout) : null;
  if (!m?.visible) {
    throw await failure(
      env,
      "TARGET_NOT_VISIBLE",
      `${label(where)}: ${describeSelector(sel)} is ${box ? "outside the visible area (or clipped by a scrolling container)" : "hidden or has no size"} after scrolling`,
      {
        where,
        selector: sel,
        hint: "Target an element that is on screen (e.g. the visible wrapper), or reveal it first (open the menu/tab/dialog).",
        details: box ? { box } : undefined,
      },
    );
  }
  return m.visible;
}

/**
 * Several elements one effect shows at once (spotlight/blur `anchors`, zoom
 * `targets` on one frozen frame). Reveal the FIRST like a single anchor, then
 * measure every one in that same scroll position — rects from different scroll
 * positions would not line up on one frame. If some are off screen but the whole
 * group fits in the viewport, one corrective scroll centres the group and all are
 * measured again; otherwise TARGET_NOT_VISIBLE lists the ones that are off screen.
 */
async function revealGroup(env: Env, items: { sel: Selector; where: ErrorWhere }[], d: DemoDefaults): Promise<Rect[]> {
  const locs: Locator[] = [];
  for (const it of items) locs.push(await resolveTarget(env, it.sel, it.where, d.timeoutMs));
  const first = await reveal(env, locs[0], items[0].sel, items[0].where, d, d.timeoutMs);
  if (locs.length === 1) return [first];

  const vp = env.script.viewport;
  let boxes = await measureAll(locs, vp);
  if (boxes.some((b) => !b.rect) && boxes.every((b) => b.box)) {
    const top = Math.min(...boxes.map((b) => b.box!.y));
    const bottom = Math.max(...boxes.map((b) => b.box!.y + b.box!.height));
    const left = Math.min(...boxes.map((b) => b.box!.x));
    const right = Math.max(...boxes.map((b) => b.box!.x + b.box!.width));
    if (bottom - top <= vp.height && right - left <= vp.width) {
      const dy = (top + bottom) / 2 - vp.height / 2;
      const started = Date.now();
      await env.page.evaluate(
        ({ by, key, smooth }) => {
          const se = document.scrollingElement || document.documentElement;
          const top = Math.max(0, Math.min(se.scrollTop + by, se.scrollHeight - se.clientHeight));
          (window as unknown as Record<string, unknown>)[key] = [{ a: se, left: se.scrollLeft, top }];
          se.scrollTo({ top, behavior: (smooth ? "smooth" : "instant") as ScrollBehavior });
        },
        { by: dy, key: SCROLL_KEY, smooth: !env.fast },
      );
      await waitForScroll(env.page, started, d.revealMs);
      await settledBox(locs[0]);
      boxes = await measureAll(locs, vp);
    }
  }
  const off = boxes
    .map((b, k) => ({ k, ...b }))
    .filter((b) => !b.rect)
    .map((b) => ({
      index: b.k,
      path: items[b.k].where.path,
      selectorText: describeSelector(items[b.k].sel),
      ...(b.box ? { box: b.box } : {}),
    }));
  if (off.length) {
    const k = off[0].index;
    throw await failure(
      env,
      "TARGET_NOT_VISIBLE",
      `${label(items[k].where)}: ${off.length} of ${items.length} elements of this effect are not on screen together with ${describeSelector(items[0].sel)}`,
      {
        where: items[k].where,
        selector: items[k].sel,
        hint: "These elements are not on screen at the same time — split them into separate effects or steps (details.offscreen lists which).",
        details: { offscreen: off, viewport: vp },
      },
    );
  }
  return boxes.map((b) => b.rect!);
}

type Box = { x: number; y: number; width: number; height: number };

/**
 * Every element in the current scroll position (no scrolling). `rect` is set only
 * when the element is wholly visible — not cut by the viewport or by a scrolling /
 * overflow-hidden ancestor. An element bigger than the viewport counts when it
 * fills it.
 */
async function measureAll(locs: Locator[], vp: { width: number; height: number }): Promise<{ box: Box | null; rect: Rect | null }[]> {
  return Promise.all(
    locs.map(async (l) => {
      const m = await measureVisible(l, 1000);
      if (!m) return { box: null, rect: null };
      const huge = m.box.width > vp.width || m.box.height > vp.height;
      const fills = !!m.visible && m.visible[2] >= Math.min(m.box.width, vp.width) - 1 && m.visible[3] >= Math.min(m.box.height, vp.height) - 1;
      return { box: m.box, rect: m.whole || (huge && fills) ? m.visible : null };
    }),
  );
}

/** zoom `targets`: one rect per target, index-aligned (all measured on one frame). */
async function targetRects(env: Env, targets: NonNullable<FxEntry["targets"]>, where: ErrorWhere, d: DemoDefaults): Promise<Rect[]> {
  const items = targets.map((tg, k) => {
    if (!tg.anchor) {
      throw new AgentError("SCRIPT_INVALID", `${label(where)}: zoom target ${k} has no anchor`, {
        hint: "Give every zoom target an `anchor` selector (run `narascreen validate`).",
        where: { ...where, path: `${where.path}.targets[${k}]` },
      });
    }
    return { sel: tg.anchor, where: { ...where, path: `${where.path}.targets[${k}].anchor` } };
  });
  return revealGroup(env, items, d);
}

/** Bounding box once it stops moving (smooth scroll / CSS transition), max ~1s extra. */
async function settledBox(loc: Locator): Promise<{ x: number; y: number; width: number; height: number } | null> {
  let prev = await loc.boundingBox().catch(() => null);
  for (let i = 0; i < 16 && prev; i++) {
    await sleep(60);
    const cur = await loc.boundingBox().catch(() => null);
    if (!cur) return null;
    const same =
      Math.abs(cur.x - prev.x) < 0.5 && Math.abs(cur.y - prev.y) < 0.5 &&
      Math.abs(cur.width - prev.width) < 0.5 && Math.abs(cur.height - prev.height) < 0.5;
    prev = cur;
    if (same) break;
  }
  return prev && prev.width > 0 && prev.height > 0 ? prev : null;
}


/** Run a Playwright action; turn its error into ACTION_FAILED with a useful hint. */
async function attempt(
  env: Env,
  where: ErrorWhere,
  sel: Selector | undefined,
  verb: string,
  fn: () => Promise<unknown>,
): Promise<void> {
  try {
    await fn();
  } catch (err) {
    if (err instanceof AgentError) throw err;
    const msg = errText(err);
    const callLog = callLogLines(msg);
    const all = msg + "\n" + callLog.join("\n");
    let hint = "Look at details.screenshot and details.callLog for what blocked it.";
    let reason = firstLine(err);
    if (/intercepts pointer events/.test(all)) {
      reason = "another element covers it";
      hint = "Another element covers the target (overlay, dialog, toast, sticky header). Close or wait for it first — e.g. a waitFor on the next state, press Escape, or a short wait.";
    } else if (/not enabled|disabled/i.test(all)) {
      reason = "the element is disabled";
      hint = "The element is disabled. Do the step that enables it first (fill required fields, select a row).";
    } else if (/not stable/.test(all)) {
      reason = "the element kept moving";
      hint = "The element kept moving (animation). Add {\"act\": \"wait\", \"ms\": 500} before this entry.";
    } else if (/not an <input>|not editable|contenteditable/i.test(all)) {
      hint = "fill needs an editable field (textbox/textarea/contenteditable). Target the input itself, e.g. by its label.";
    } else if (/Unknown key/i.test(all)) {
      hint = "Use Playwright key names: Enter, Tab, Escape, ArrowDown, Backspace, Control+A, Meta+K, Shift+Tab…";
    } else if (/has been closed|Target closed/i.test(all)) {
      hint = "The page or browser closed during the action (a click that closes the tab?). Don't close the browser during a run.";
    } else if (/detached/i.test(all)) {
      hint = "The page re-rendered and replaced the element. Add a waitFor for the element (or a short wait) before this entry.";
    }
    throw await failure(env, "ACTION_FAILED", `${label(where)}: could not ${verb}${sel ? ` ${describeSelector(sel)}` : ""}: ${reason}`, {
      where,
      selector: sel,
      hint,
      details: { ...(callLog.length ? { callLog } : {}) },
    });
  }
}

// ─── failure reports ─────────────────────────────────────────────────

function label(where: ErrorWhere): string {
  return where.step ? `step "${where.step}" entry ${where.entry} (${where.path})` : where.path ?? "run";
}

/**
 * Build the AgentError for a failed entry: screenshot of the page as it is now,
 * the URL/title/headings (where am I?), and — when a selector was involved — the
 * most similar elements with ready-to-paste selectors.
 */
async function failure(
  env: Pick<Env, "page" | "failuresDir">,
  code: ErrorCode,
  message: string,
  init: { where?: ErrorWhere; selector?: Selector; hint?: string; details?: Record<string, unknown> },
): Promise<AgentError> {
  const { page } = env;
  const details: Record<string, unknown> = {};
  if (init.selector) {
    details.selector = init.selector;
    details.selectorText = describeSelector(init.selector);
  }
  Object.assign(details, init.details);
  details.url = page.url();
  details.title = await page.title().catch(() => "");
  try {
    fs.mkdirSync(env.failuresDir, { recursive: true });
    const w = init.where;
    const name = w?.step != null ? `${w.step}-${w.entry}` : w?.path ? w.path.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/-+$/, "") : "failure";
    const file = path.join(env.failuresDir, `${name}.png`);
    await page.screenshot({ path: file, scale: "css", timeout: 5000 });
    details.screenshot = file;
  } catch {
    /* page gone — report without a screenshot */
  }
  details.headings = await pageHeadings(page, 12);
  if (init.selector) {
    try {
      const all = await withTimeout(collectElements(page, { limit: 200 }), DIAGNOSE_BUDGET_MS);
      details.candidates = similarElements(all, init.selector, 8);
    } catch {
      /* diagnostics are best-effort */
    }
  }
  return new AgentError(code, message, { hint: init.hint, where: init.where, details });
}

/** Navigate like a `goto` act, with the same NAVIGATION_FAILED report (used by inspect). */
export async function gotoPage(
  page: Page,
  target: string,
  opts: { baseUrl: string; failuresDir: string; timeoutMs?: number },
): Promise<void> {
  const env: Env = {
    page,
    script: { baseUrl: opts.baseUrl } as DemoScript,
    failuresDir: path.resolve(opts.failuresDir),
    warnings: [],
    log: () => {},
    currentPath: "url",
    internalPages: new Set(),
  };
  await gotoChecked(env, target, { path: "url" }, opts.timeoutMs ?? MIN_NAV_TIMEOUT_MS);
}

// ─── misc ────────────────────────────────────────────────────────────

async function holdOpen(log: Log, why: string): Promise<void> {
  log(`${why}. Browser held open — inspect it, then press Enter here to close.`);
  await new Promise<void>((resolve) => {
    const done = () => {
      process.stdin.off("data", done);
      process.stdin.off("end", done);
      process.stdin.pause();
      resolve();
    };
    process.stdin.on("data", done);
    process.stdin.on("end", done);
    process.stdin.resume();
  });
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** First line of an error without Playwright's "locator.click: " prefix. */
function firstLine(err: unknown): string {
  return errText(err).split("\n")[0].replace(/^[a-zA-Z]+\.[a-zA-Z]+: /, "").replace(/^Error: /, "").trim();
}

function firstLines(s: string, n: number): string {
  return s.split("\n").slice(0, n).join("\n");
}

function isPlaywrightTimeout(err: unknown): boolean {
  return err instanceof Error && (err.name === "TimeoutError" || /Timeout \d+ms exceeded/.test(err.message));
}

/** The informative tail of Playwright's "Call log:" (what it was waiting on). */
function callLogLines(msg: string): string[] {
  const i = msg.indexOf("Call log:");
  if (i < 0) return [];
  const lines = msg
    .slice(i + "Call log:".length)
    .split("\n")
    .map((l) => l.replace(/^\s*-\s*/, "").trim())
    .filter(Boolean);
  return [...new Set(lines)].slice(-6);
}
