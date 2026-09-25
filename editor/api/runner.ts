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

  for (let i = 0; i < beat.beat.length; i++) {
    const entry = beat.beat[i];
    const where: ErrorWhere = { step: beat.id, entry: i, path: `steps[${si}].beat[${i}]` };
    env.currentPath = where.path!;
    let rect: Rect | undefined;
    let rects: Rect[] | undefined;
    if (isAct(entry)) {
      rect = await runAct(env, entry, where, d);
      if (rect) lastRect = rect;
    } else {
      // A `disabled` fx is still revealed and dwelled on: toggling it must not
      // change the recording (it is not part of the job's structure hash).
      // Range fx (speed/skip/mute) only mark a time, so they carry no box.
      rect = RANGE_FX.includes(entry.fx) ? undefined : lastRect;
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
    }
    // Stamp AFTER the act/reveal: t marks the on-screen result, which the dwell
    // then holds and any following fx aligns to.
    const t = round3(now());
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
    if (env.internalPages.has(p)) return;
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

/** Execute one act. Returns the target's post-reveal box for element acts. */
async function runAct(env: Env, e: ActEntry, where: ErrorWhere, d: DemoDefaults): Promise<Rect | undefined> {
  const { page } = env;
  const timeout = e.timeoutMs ?? d.timeoutMs;
  const sel = pickSelector(e);

  switch (e.act) {
    case "goto":
      await gotoChecked(env, (e.url ?? e.path)!, where, navTimeout(d));
      return undefined;

    case "wait":
      await sleep(e.ms ?? 0);
      return undefined;

    case "useSession":
      await useSession(env, e, where, navTimeout(d));
      return undefined;

    case "waitFor":
      await resolveTarget(env, sel!, where, timeout, { waitFor: true });
      return undefined; // a gate only: nothing to show

    case "press": {
      const key = e.key!;
      if (sel) {
        const loc = await resolveTarget(env, sel, where, timeout);
        await attempt(env, where, sel, `press "${key}" on`, () => loc.press(key, { timeout }));
      } else {
        await attempt(env, where, undefined, `press "${key}"`, () => page.keyboard.press(key));
      }
      return undefined;
    }

    case "scroll":
      if (!sel) {
        await scrollToY(page, e.y ?? 0, d);
        return undefined;
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
      break;
  }
  return rect;
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

async function scrollToY(page: Page, y: number, d: DemoDefaults): Promise<void> {
  await page.evaluate((top) => window.scrollTo({ top, behavior: "smooth" }), y);
  await sleep(d.revealMs);
  // Smooth scrolling over a long distance can outlast revealMs: wait until it stops.
  let last = -1;
  for (let i = 0; i < 25; i++) {
    const cur = await page.evaluate(() => window.scrollY).catch(() => last);
    if (cur === last) break;
    last = cur;
    await sleep(60);
  }
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
    // localStorage: the current origin is replaced in place (it belongs to the
    // previous session); other origins are seeded through a throwaway tab whose
    // requests never reach the network.
    const current = originOf(page.url());
    const origins = state.origins ?? [];
    if (current) {
      const items = origins.find((o) => o.origin === current)?.localStorage ?? [];
      await page.evaluate((list) => {
        localStorage.clear();
        for (const it of list) localStorage.setItem(it.name, it.value);
      }, items);
    }
    for (const o of origins.filter((x) => x.origin !== current && x.localStorage?.length)) {
      const tmp = await context.newPage();
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
    const count = await locateAll(env.page, sel).count().catch(() => 1);
    if (count > 1) {
      addWarning(
        env,
        `${where.path}: selector ${describeSelector(sel)} matched ${count} elements; used the first. ` +
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
  // is already known to be visible here.
  try {
    await loc.evaluate(
      (el, center) => {
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        let r = el.getBoundingClientRect();
        if (r.top < 0 || r.left < 0 || r.bottom > vh || r.right > vw) {
          el.scrollIntoView({ block: "nearest", inline: "nearest" }); // jump: get it on screen
          r = el.getBoundingClientRect();
        }
        if (center) {
          // then glide it to the middle ON CAMERA (tall elements: to the top)
          el.scrollIntoView({ block: r.height > vh * 0.8 ? "start" : "center", inline: "center", behavior: "smooth" });
        }
      },
      d.center,
      { timeout },
    );
  } catch (err) {
    throw await failure(env, "TARGET_NOT_VISIBLE", `${label(where)}: could not scroll ${describeSelector(sel)} into view: ${firstLine(err)}`, {
      where,
      selector: sel,
      hint: "The element is hidden, detached or covered. Do whatever reveals it first (open the menu/tab/dialog).",
    });
  }
  await sleep(d.revealMs); // let the scroll settle ON CAMERA
  const box = await settledBox(loc);
  const rect = box ? clampToViewport(box, env.script.viewport) : null;
  if (!rect) {
    throw await failure(
      env,
      "TARGET_NOT_VISIBLE",
      `${label(where)}: ${describeSelector(sel)} is ${box ? "outside the visible area" : "hidden or has no size"} after scrolling`,
      {
        where,
        selector: sel,
        hint: "Target an element that is on screen (e.g. the visible wrapper), or reveal it first (open the menu/tab/dialog).",
        details: box ? { box } : undefined,
      },
    );
  }
  return rect;
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
      await env.page.evaluate((by) => window.scrollBy({ top: by, behavior: "smooth" }), dy);
      await sleep(d.revealMs);
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

/** Every box in the current scroll position (no scrolling); rect only when fully on screen. */
async function measureAll(locs: Locator[], vp: { width: number; height: number }): Promise<{ box: Box | null; rect: Rect | null }[]> {
  return Promise.all(
    locs.map(async (l) => {
      const box = await l.boundingBox().catch(() => null);
      const rect = box && box.width > 0 && box.height > 0 && fullyInside(box, vp) ? clampToViewport(box, vp) : null;
      return { box, rect };
    }),
  );
}

/** Entirely on screen (1px slack); an element bigger than the viewport only has to cover it. */
function fullyInside(box: Box, vp: { width: number; height: number }): boolean {
  const okX = box.width > vp.width ? box.x <= 1 && box.x + box.width >= vp.width - 1 : box.x >= -1 && box.x + box.width <= vp.width + 1;
  const okY = box.height > vp.height ? box.y <= 1 && box.y + box.height >= vp.height - 1 : box.y >= -1 && box.y + box.height <= vp.height + 1;
  return okX && okY;
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

function clampToViewport(
  box: { x: number; y: number; width: number; height: number },
  vp: { width: number; height: number },
): Rect | null {
  const x0 = Math.max(0, box.x);
  const y0 = Math.max(0, box.y);
  const x1 = Math.min(vp.width, box.x + box.width);
  const y1 = Math.min(vp.height, box.y + box.height);
  if (x1 - x0 < 1 || y1 - y0 < 1) return null;
  return [Math.round(x0), Math.round(y0), Math.round(x1 - x0), Math.round(y1 - y0)];
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
  return errText(err).split("\n")[0].replace(/^[a-zA-Z]+\.[a-zA-Z]+: /, "").trim();
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
