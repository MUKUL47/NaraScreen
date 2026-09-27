"use strict";
Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
const fs = require("fs");
const path = require("path");
const playwrightCore = require("playwright-core");
const index = require("./job-W-Szny1w.cjs");
const narascreen = require("./narascreen.cjs");
const child_process = require("child_process");
require("os");
require("crypto");
require("util");
require("url");
function _interopNamespaceDefault(e) {
  const n = Object.create(null, { [Symbol.toStringTag]: { value: "Module" } });
  if (e) {
    for (const k in e) {
      if (k !== "default") {
        const d = Object.getOwnPropertyDescriptor(e, k);
        Object.defineProperty(n, k, d.get ? d : {
          enumerable: true,
          get: () => e[k]
        });
      }
    }
  }
  n.default = e;
  return Object.freeze(n);
}
const fs__namespace = /* @__PURE__ */ _interopNamespaceDefault(fs);
const path__namespace = /* @__PURE__ */ _interopNamespaceDefault(path);
async function startScreencast(page, framesDir, opts = {}) {
  fs__namespace.mkdirSync(framesDir, { recursive: true });
  const client = await page.context().newCDPSession(page);
  const frames = [];
  let idx = 0;
  let stopped = false;
  let writeError = null;
  let started = 0;
  let firstFrame = () => {
  };
  const gotFirst = new Promise((resolve) => firstFrame = resolve);
  const elapsed = () => started ? (Date.now() - started) / 1e3 : 0;
  client.on("Page.screencastFrame", (frame) => {
    void client.send("Page.screencastFrameAck", { sessionId: frame.sessionId }).catch(() => {
    });
    if (stopped) return;
    try {
      if (!started) {
        started = Date.now();
        firstFrame();
      }
      const arrived = elapsed();
      const captured = frame.metadata?.timestamp != null ? (frame.metadata.timestamp * 1e3 - started) / 1e3 : NaN;
      let t = Number.isFinite(captured) && captured <= arrived + 0.05 && captured >= arrived - 2 ? captured : arrived;
      if (frames.length) t = Math.max(t, frames[frames.length - 1].t);
      const file = path__namespace.join(framesDir, `frame_${String(idx++).padStart(5, "0")}.jpg`);
      fs__namespace.writeFileSync(file, Buffer.from(frame.data, "base64"));
      frames.push({ t, file });
    } catch (err) {
      writeError ??= err;
    }
  });
  await client.send("Page.startScreencast", {
    format: "jpeg",
    quality: opts.quality ?? 92,
    everyNthFrame: opts.everyNthFrame ?? 1
  });
  const timeout = new Promise((r) => setTimeout(() => r("timeout"), opts.firstFrameTimeoutMs ?? 1e4).unref());
  if (await Promise.race([gotFirst, timeout]) === "timeout") {
    stopped = true;
    await client.send("Page.stopScreencast").catch(() => {
    });
    await client.detach().catch(() => {
    });
    throw new Error(`Chrome sent no screencast frame within ${opts.firstFrameTimeoutMs ?? 1e4}ms`);
  }
  const halt = async () => {
    stopped = true;
    await client.send("Page.stopScreencast").catch(() => {
    });
    await client.detach().catch(() => {
    });
  };
  return {
    now: elapsed,
    frameCount: () => frames.length,
    abort: halt,
    async stop(outputPath) {
      const endT = elapsed();
      await halt();
      if (writeError) {
        throw new Error(`could not save screencast frames: ${writeError instanceof Error ? writeError.message : writeError}`);
      }
      if (frames.length === 0) {
        throw new Error("screencast captured 0 frames");
      }
      const lines = [];
      for (let i = 0; i < frames.length; i++) {
        const cur = frames[i];
        const from = i === 0 ? 0 : cur.t;
        const next = i + 1 < frames.length ? frames[i + 1].t : endT;
        const dur = Math.max(1e-3, next - from);
        lines.push(`file '${cur.file.replace(/'/g, "'\\''")}'`);
        lines.push(`duration ${dur.toFixed(4)}`);
      }
      lines.push(`file '${frames[frames.length - 1].file.replace(/'/g, "'\\''")}'`);
      const listPath = path__namespace.join(framesDir, "frames.txt");
      fs__namespace.writeFileSync(listPath, lines.join("\n") + "\n");
      fs__namespace.mkdirSync(path__namespace.dirname(outputPath), { recursive: true });
      const args = ["-y", "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", listPath, "-t", endT.toFixed(3)];
      const filters = ["fps=30"];
      if (opts.outputSize) {
        const { width, height } = opts.outputSize;
        filters.push(`scale=${width}:${height}:flags=lanczos`);
        if (width % 2 || height % 2) filters.push(`pad=${width + width % 2}:${height + height % 2}:0:0`);
      } else {
        filters.push("pad=ceil(iw/2)*2:ceil(ih/2)*2:0:0");
      }
      args.push("-vf", filters.join(","));
      args.push("-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", outputPath);
      const timeoutMs = Math.ceil(Math.max(10 * 6e4, endT * 2e4));
      const res = child_process.spawnSync(index.FFMPEG_PATH, args, { stdio: ["ignore", "ignore", "pipe"], maxBuffer: 16 * 1024 * 1024, timeout: timeoutMs });
      if (res.error || res.status !== 0) {
        const tail = (res.stderr?.toString() ?? "").trim().split("\n").slice(-8).join("\n");
        throw new Error(
          `ffmpeg could not assemble ${frames.length} frames (exit ${res.status ?? res.error?.message}): ${tail || "no output"}`
        );
      }
      return index.probeDuration(outputPath);
    }
  };
}
const LEAD_IN_MS = 500;
const TAIL_PAD_MS = 500;
const MIN_NAV_TIMEOUT_MS = 3e4;
const DIAGNOSE_BUDGET_MS = 15e3;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const round3 = (n) => Math.round(n * 1e3) / 1e3;
async function run(script, recordingsDir, opts) {
  const log = opts.log ?? index.log;
  const check = !!opts.check;
  const fastCheck = check && !opts.headed;
  const base = { ...index.BUILTIN_DEFAULTS, ...script.defaults };
  const d = fastCheck ? { ...base, dwellMs: 0, revealMs: 120 } : base;
  if (script.source) {
    throw new index.AgentError("USAGE", "Video-source scripts are imported, not run: there is no browser step to execute", {
      hint: "`record`/`make` import source.video directly; look at the video with `narascreen preview <job> --raw`.",
      where: { path: "source" }
    });
  }
  const baseUrl = script.baseUrl;
  if (!baseUrl) {
    throw new index.AgentError("SCRIPT_INVALID", "The script has no baseUrl, so there is no website to open", {
      hint: 'Add "baseUrl": "https://…" (the site to record), then run `narascreen validate`.',
      where: { path: "baseUrl" }
    });
  }
  const steps = stepsToRun(script, opts.untilStep);
  if (script.storageState && !fs__namespace.existsSync(script.storageState)) {
    throw new index.AgentError("STORAGE_STATE_NOT_FOUND", `storageState file not found: ${script.storageState}`, {
      hint: "Create it (log in with Playwright and save context.storageState()), or remove storageState and log in with `setup` entries.",
      where: { path: "storageState" },
      details: { path: script.storageState }
    });
  }
  const plugins = index.pluginsFor(script);
  const browserViewport = plugins.find((p) => p.browserViewport)?.browserViewport;
  const browserScript = browserViewport ? { ...script, viewport: browserViewport } : script;
  for (const p of plugins) await p.preflight?.(script);
  const browser = await launchBrowser(!!opts.headed);
  const framesDir = path__namespace.join(recordingsDir, "frames");
  let screencast = null;
  let env;
  try {
    const context = await newContext(browser, browserScript, plugins);
    const page = await context.newPage();
    env = {
      page,
      script: browserScript,
      plugins,
      failuresDir: path__namespace.resolve(opts.failuresDir),
      warnings: [],
      log,
      currentPath: "",
      internalPages: /* @__PURE__ */ new Set(),
      fast: fastCheck,
      now: () => 0,
      lastChange: 0
    };
    watchPageEvents(env, context);
    for (const p of plugins) await p.attach?.(context, page, (m) => addWarning(env, m));
    if (script.setup?.length) {
      index.stage("setup", `Running ${script.setup.length} setup action(s) — not recorded`);
      const sd = { ...d, dwellMs: 0, revealMs: 0, typeDelayMs: 0, center: false };
      for (let i = 0; i < script.setup.length; i++) {
        const e = script.setup[i];
        const where = { entry: i, path: `setup[${i}]` };
        env.currentPath = where.path;
        await runAct(env, e, where, sd);
        log(`${where.path} ${describeEntry(e)}`);
      }
      await page.waitForLoadState("load", { timeout: 5e3 }).catch(() => {
      });
    }
    if (steps.length && page.url() === "about:blank" && !startsWithNavigation(steps[0])) {
      env.currentPath = "steps[0]";
      await gotoChecked(env, baseUrl, { path: "baseUrl" }, navTimeout(d));
      addWarning(env, `steps[0] does not start with a goto, so NaraScreen opened baseUrl (${baseUrl}) first. Add {"act": "goto", "path": "/…"} to make the start explicit.`);
    }
    if (steps.length) {
      index.stage(
        "record",
        check ? `Checking ${steps.length} step(s) — dry run, nothing is recorded` : `Recording ${steps.length} step(s)`,
        { steps: steps.length, check }
      );
    }
    if (!check) {
      fs__namespace.mkdirSync(recordingsDir, { recursive: true });
      try {
        screencast = await startScreencast(page, framesDir, { outputSize: script.viewport });
      } catch (err) {
        throw new index.AgentError("RECORDING_FAILED", `Could not start the screen recording: ${firstLine(err)}`, {
          hint: "Retry. If it repeats, run `narascreen doctor` and check that Chromium starts.",
          details: { error: errText(err) }
        });
      }
      await sleep(LEAD_IN_MS);
    }
    const t0 = Date.now();
    const now = () => screencast ? screencast.now() : (Date.now() - t0) / 1e3;
    env.now = now;
    env.lastChange = 0;
    const trace = [];
    for (let si = 0; si < steps.length; si++) {
      const beat = steps[si];
      await runStep(env, beat, si, steps.length, d, fastCheck, now, trace);
      env.prevStep = beat.id;
    }
    for (const p of plugins) await p.finish?.(pageApi(env, d.timeoutMs));
    let durationSec = round3(now());
    let recordingPath;
    if (screencast) {
      await sleep(d.dwellMs + TAIL_PAD_MS);
      const sc = screencast;
      screencast = null;
      recordingPath = path__namespace.join(recordingsDir, "recording.mp4");
      try {
        durationSec = round3(await sc.stop(recordingPath));
      } catch (err) {
        throw new index.AgentError("RECORDING_FAILED", `The screen recording could not be assembled: ${firstLine(err)}`, {
          hint: "Retry the recording. If it repeats, run `narascreen doctor` (ffmpeg) and report details.",
          details: { error: errText(err), frames: sc.frameCount(), recordingPath }
        });
      }
      if (!(durationSec > 0)) {
        throw new index.AgentError("RECORDING_FAILED", "The assembled recording has no duration", {
          hint: "Retry the recording. If it repeats, run `narascreen doctor` (ffmpeg).",
          details: { recordingPath, frames: sc.frameCount() }
        });
      }
      const inside = (x) => round3(Math.max(0, Math.min(x, durationSec - 0.05)));
      for (const e of trace) {
        e.t = inside(e.t);
        if (e.start != null) e.start = inside(e.start);
        if (e.end != null) e.end = inside(e.end);
      }
    }
    if (opts.onPage) {
      const e = env;
      await opts.onPage(page, async () => {
        for (const p of plugins) {
          await p.ready?.(pageApi(e, d.timeoutMs));
          for (const n of await p.inspectNotes?.(page) ?? []) addWarning(e, n);
        }
      });
    }
    if (opts.holdOpen && opts.headed) await holdOpen(log, "Run finished");
    return { recordingPath, trace, durationSec, warnings: env.warnings };
  } catch (caught) {
    let err = caught;
    if (env?.plugins.length && err instanceof index.AgentError) {
      for (const p of env.plugins) {
        const better = await p.explainFailure?.(err, pageApi(env, d.timeoutMs, err.where)).catch(() => void 0);
        if (better) {
          err = better;
          break;
        }
      }
    }
    if (opts.holdOpen && opts.headed && env) {
      await holdOpen(log, `Run failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    throw err;
  } finally {
    if (screencast) await screencast.abort().catch(() => {
    });
    if (!check) fs__namespace.rmSync(framesDir, { recursive: true, force: true });
    await browser.close().catch(() => {
    });
  }
}
function stepsToRun(script, untilStep) {
  if (untilStep == null) return script.steps;
  const idx = script.steps.findIndex((s) => s.id === untilStep);
  if (idx < 0) {
    const ids = script.steps.map((s) => s.id);
    throw new index.AgentError("BEAT_NOT_FOUND", `No step with id "${untilStep}" in the script`, {
      hint: `Pass one of the step ids: ${ids.join(", ")}.`,
      details: { untilStep, stepIds: ids }
    });
  }
  return script.steps.slice(0, idx + 1);
}
function startsWithNavigation(beat) {
  const first = beat.beat[0];
  return !!first && index.isAct(first) && (first.act === "goto" || first.act === "useSession");
}
async function runStep(env, beat, si, total, d, fastCheck, now, trace) {
  index.step(`step ${si + 1}/${total} · ${beat.id}${beat.label ? ` — ${beat.label}` : ""}`, {
    index: si + 1,
    total,
    id: beat.id,
    ...beat.label ? { label: beat.label } : {}
  });
  const dwell = fastCheck ? 0 : beat.dwellMs ?? d.dwellMs;
  let lastRect;
  for (let i = 0; i < beat.beat.length; i++) {
    const entry = beat.beat[i];
    const where = { step: beat.id, entry: i, path: `steps[${si}].beat[${i}]` };
    env.currentPath = where.path;
    const begun = now();
    if (env.plugins.length && !index.isAct(entry)) for (const p of env.plugins) await p.ready?.(pageApi(env, d.timeoutMs, where));
    let rect;
    let rects;
    let blurStart;
    let at;
    let end;
    if (index.isAct(entry)) {
      const res = await runAct(env, entry, where, d);
      rect = res.rect;
      if (res.focus !== void 0) lastRect = res.focus ?? void 0;
      if (res.changedAt != null) env.lastChange = Math.max(env.lastChange, res.changedAt);
      if (res.at != null) {
        at = res.at;
        end = now();
      }
    } else {
      rect = index.RANGE_FX.includes(entry.fx) ? void 0 : lastRect;
      const blurSels = entry.fx === "blur" ? entry.anchors?.length ? entry.anchors : entry.anchor ? [entry.anchor] : [] : [];
      const blurBefore = blurSels.length ? await Promise.all(blurSels.map((a) => narascreen.measureVisible(narascreen.locate(env.page, a), 500).catch(() => null))) : [];
      const inPlace = blurSels.length > 0 && blurBefore.every((b) => !!b?.whole);
      const rd = inPlace ? { ...d, center: false } : d;
      env.movedAt = void 0;
      if (entry.targets?.length) {
        rects = await targetRects(env, entry.targets, where, rd);
        rect = rects[0];
      } else if (entry.anchors?.length) {
        const items = entry.anchors.map((sel, k) => ({ sel, where: { ...where, path: `${where.path}.anchors[${k}]` } }));
        rects = await revealGroup(env, items, rd);
        rect = rects[0];
      } else if (entry.anchor) {
        const atAnchor = { ...where, path: `${where.path}.anchor` };
        const loc = await resolveTarget(env, entry.anchor, atAnchor, d.timeoutMs);
        rect = await reveal(env, loc, entry.anchor, atAnchor, rd, d.timeoutMs);
      }
      if (env.movedAt != null) env.lastChange = Math.max(env.lastChange, env.movedAt);
      if (rect) lastRect = rect;
      if (blurSels.length) {
        const after = rects ?? (rect ? [rect] : []);
        const unmoved = after.length === blurBefore.length && blurBefore.every((b, k) => !!b?.whole && !!b.visible && b.visible.every((v, n) => Math.abs(v - after[k][n]) <= 2));
        if (unmoved) {
          blurStart = env.lastChange;
        } else if (blurBefore.some((b) => b?.visible)) {
          addWarning(
            env,
            `${where.path}: the element to blur moved while being revealed (scrolled into place), so it was visible unblurred for a moment. Put the blur where the element is already on screen (e.g. after a scroll to it), or accept the brief exposure.`
          );
        }
      }
    }
    let t = round3(blurStart ?? at ?? now());
    if (!index.isAct(entry) && trace.length === 0 && env.lastChange === 0) t = 0;
    trace.push({
      beat: beat.id,
      i,
      kind: index.isAct(entry) ? "act" : "fx",
      ...index.isAct(entry) ? { act: entry.act } : { fx: entry.fx },
      t,
      start: round3(begun),
      ...end != null && end > t + 1e-3 ? { end: round3(end) } : {},
      ...rect ? { rect: env.plugins.length ? videoRect(env, rect) : rect } : {},
      ...rects ? { rects: env.plugins.length ? rects.map((x) => videoRect(env, x)) : rects } : {}
    });
    env.log(`${where.path} ${describeEntry(entry)} · t=${t.toFixed(2)}s`);
    await sleep(dwell);
  }
}
function describeEntry(e) {
  if (index.isAct(e)) {
    const sel = narascreen.pickSelector(e);
    const extra = e.act === "goto" ? ` ${e.url ?? e.path}` : e.act === "wait" ? ` ${e.ms}ms` : e.act === "press" ? ` ${e.key}` : e.act === "select" ? ` "${e.option}"` : e.act === "useSession" ? ` ${e.storageState}` : e.act === "upload" ? ` ${uploadList(e).map((f) => path__namespace.basename(f)).join(", ")}` : e.act === "swipe" ? ` ${e.direction}${e.to ? ` to ${narascreen.describeSelector(e.to)}` : ""}` : e.act === "scroll" && !sel ? ` y=${e.y}` : "";
    return `${e.act}${sel ? ` ${narascreen.describeSelector(sel)}` : ""}${extra}`;
  }
  const target = e.targets?.length ? ` ${e.targets.length} targets` : e.anchors?.length ? ` ${e.anchors.map(narascreen.describeSelector).join(" + ")}` : e.anchor ? ` ${narascreen.describeSelector(e.anchor)}` : "";
  return `fx ${e.fx}${target}${e.disabled ? " (disabled)" : ""}`;
}
async function launchBrowser(headed) {
  try {
    return await playwrightCore.chromium.launch({ headless: !headed });
  } catch (err) {
    const msg = errText(err);
    if (/Executable doesn't exist|download new browsers|playwright install/i.test(msg)) {
      throw new index.AgentError("BROWSER_MISSING", "Playwright's Chromium is not installed", {
        hint: "Run `npx playwright install chromium` in the NaraScreen editor folder, then retry (`narascreen doctor` checks it).",
        details: { error: firstLines(msg, 4) }
      });
    }
    if (/missing dependencies/i.test(msg)) {
      throw new index.AgentError("BROWSER_MISSING", "Chromium is installed but the system is missing libraries it needs", {
        hint: "Run `npx playwright install-deps chromium` (needs admin rights), then retry.",
        details: { error: firstLines(msg, 8) }
      });
    }
    if (headed && /display|X server|XServer/i.test(msg)) {
      throw new index.AgentError("BROWSER_MISSING", "Cannot open a browser window: no display available", {
        hint: "Run without --headed on machines without a screen.",
        details: { error: firstLines(msg, 4) }
      });
    }
    throw new index.AgentError("BROWSER_MISSING", `Chromium failed to start: ${firstLine(err)}`, {
      hint: "Run `narascreen doctor`; reinstall the browser with `npx playwright install chromium`.",
      details: { error: firstLines(msg, 8) }
    });
  }
}
async function newContext(browser, script, plugins = []) {
  try {
    return await browser.newContext({
      // baseURL makes goto("/settings") resolve against the site.
      baseURL: script.baseUrl,
      viewport: script.viewport,
      // Supersampled capture; screencast.ts downscales to the viewport, so video
      // pixels == CSS pixels == trace rects, with crisper text.
      deviceScaleFactor: 2,
      ...script.storageState ? { storageState: script.storageState } : {},
      ...Object.assign({}, ...plugins.map((p) => p.contextOptions ?? {}))
    });
  } catch (err) {
    if (script.storageState) {
      throw new index.AgentError("STORAGE_STATE_NOT_FOUND", `Could not load storageState ${script.storageState}: ${firstLine(err)}`, {
        hint: "The file must be a Playwright storageState JSON ({ cookies, origins }). Re-create it, or log in with `setup` entries.",
        where: { path: "storageState" },
        details: { path: script.storageState, error: firstLines(errText(err), 4) }
      });
    }
    throw err;
  }
}
function watchPageEvents(env, context) {
  env.page.on("dialog", (dlg) => {
    addWarning(
      env,
      `${env.currentPath}: a native ${dlg.type()} dialog ("${dlg.message().slice(0, 80)}") was accepted automatically; it does not appear in the video.`
    );
    void dlg.accept().catch(() => {
    });
  });
  context.on("page", (p) => {
    if (env.openingInternal || env.internalPages.has(p)) return;
    addWarning(
      env,
      `${env.currentPath}: the site opened a new tab/window. Only the original tab is recorded and the script keeps acting there. Prefer a goto to that URL instead.`
    );
  });
}
function addWarning(env, msg) {
  env.warnings.push(msg);
  index.warn(msg);
}
function navTimeout(d) {
  return Math.max(MIN_NAV_TIMEOUT_MS, d.timeoutMs);
}
async function currentRect(loc) {
  if (!await loc.count().catch(() => 0)) return null;
  return (await narascreen.measureVisible(loc, 150))?.visible ?? null;
}
async function runAct(env, e, where, d) {
  const { page } = env;
  const timeout = e.timeoutMs ?? d.timeoutMs;
  const sel = narascreen.pickSelector(e);
  for (const p of env.plugins) await p.ready?.(pageApi(env, timeout, where));
  env.movedAt = void 0;
  if (env.plugins.length) {
    const t02 = env.now();
    const res = await pluginAct(env, e, where, timeout);
    if (res) return { ...res, changedAt: t02 };
  }
  switch (e.act) {
    case "goto": {
      const t02 = env.now();
      let committed;
      const onNav = (f) => {
        if (f === page.mainFrame() && committed == null) committed = env.now();
      };
      page.on("framenavigated", onNav);
      try {
        await gotoChecked(env, e.url ?? e.path, where, navTimeout(d));
      } finally {
        page.off("framenavigated", onNav);
      }
      return { changedAt: committed ?? t02 };
    }
    case "wait":
      await sleep(e.ms ?? 0);
      return {};
    case "useSession": {
      const t02 = env.now();
      await useSession(env, e, where, navTimeout(d));
      return { changedAt: t02 };
    }
    case "waitFor": {
      const loc2 = await resolveTarget(env, sel, where, timeout, { waitFor: true });
      await settledBox(loc2);
      return { focus: await currentRect(loc2) };
    }
    case "press": {
      const key = e.key;
      if (sel) {
        const loc2 = await resolveTarget(env, sel, where, timeout);
        const t03 = env.now();
        await attempt(env, where, sel, `press "${key}" on`, () => loc2.press(key, { timeout }));
        const at2 = env.now();
        return { focus: await currentRect(loc2), at: at2, changedAt: t03 };
      }
      const t02 = env.now();
      await attempt(env, where, void 0, `press "${key}"`, () => page.keyboard.press(key));
      return { at: env.now(), changedAt: t02 };
    }
    case "scroll":
      if (!sel) {
        const t02 = env.now();
        await scrollToY(env, e.y ?? 0, d, where);
        return { changedAt: t02 };
      }
      break;
  }
  if (!sel) {
    throw await failure(env, "ACTION_FAILED", `${label(where)}: "${e.act}" needs a selector`, {
      where,
      hint: "Add one of role(+name) | label | text | placeholder | testId | css. Run `narascreen validate` first."
    });
  }
  if (e.act === "upload") {
    const t02 = env.now();
    return { ...await uploadFiles(env, e, sel, where, d, timeout), changedAt: t02 };
  }
  const loc = await resolveTarget(env, sel, where, timeout);
  const rect = await reveal(env, loc, sel, where, d, timeout);
  const t0 = env.movedAt ?? env.now();
  switch (e.act) {
    case "click":
      await attempt(env, where, sel, "click", () => env.plugins.some((p) => p.touch) ? loc.tap({ timeout }) : loc.click({ timeout }));
      break;
    case "hover":
      await attempt(env, where, sel, "hover", () => loc.hover({ timeout }));
      break;
    case "fill": {
      const value = e.value ?? "";
      const typing = timeout + value.length * (d.typeDelayMs + 30);
      await attempt(env, where, sel, "type into", async () => {
        await loc.fill("", { timeout });
        for (const p of env.plugins) await p.afterFocus?.(loc);
        if (value) await loc.pressSequentially(value, { delay: d.typeDelayMs, timeout: typing });
      });
      break;
    }
    case "select":
      await selectOption(env, loc, sel, e.option, where, timeout);
      break;
    case "scroll":
      return { rect, focus: rect, changedAt: t0 };
  }
  const at = env.now();
  return { rect, focus: await currentRect(loc) ?? rect, at, changedAt: t0 };
}
function pageApi(env, timeoutMs, where) {
  return {
    page: env.page,
    timeoutMs,
    fail: (code, message, init) => failure(env, code, where ? `${label(where)}: ${message}` : message, { where, ...init }),
    warn: (m) => addWarning(env, m)
  };
}
function videoRect(env, r) {
  return env.plugins.reduce((acc, p) => p.toVideo ? p.toVideo(acc) : acc, r);
}
async function pluginAct(env, e, where, timeout) {
  const api = {
    page: env.page,
    timeoutMs: timeout,
    resolve: (sel, t) => resolveTarget(env, sel, where, t),
    locate: (sel) => narascreen.locate(env.page, sel),
    fail: (code, message, init) => failure(env, code, `${label(where)}: ${message}`, { where, ...init })
  };
  for (const p of env.plugins) {
    const res = await p.runAct?.(e, api);
    if (res) return res;
  }
  return void 0;
}
function uploadList(e) {
  return e.files == null ? [] : Array.isArray(e.files) ? e.files : [e.files];
}
const UPLOAD_TARGET_HINT = "target is neither a file input nor something that opens a file picker — point at the input, or at the button that opens the picker";
async function uploadFiles(env, e, sel, where, d, timeout) {
  const files = uploadList(e);
  const names = files.map((f) => path__namespace.basename(f)).join(", ");
  let loc = await resolveTarget(env, sel, where, timeout, { attached: true });
  const info = await loc.evaluate((el) => {
    const r = el.getBoundingClientRect();
    let op = 1;
    for (let a = el; a; a = a.parentElement) op *= Number(getComputedStyle(a).opacity) || 0;
    return {
      fileInput: el instanceof HTMLInputElement && el.type === "file",
      multiple: el instanceof HTMLInputElement && el.multiple,
      shown: r.width >= 8 && r.height >= 8 && op > 0.1
    };
  }).catch(() => ({ fileInput: false, multiple: false, shown: false }));
  const tooMany = (multiple) => failure(env, "ACTION_FAILED", `${label(where)}: ${files.length} files given but ${narascreen.describeSelector(sel)} accepts only one`, {
    where,
    selector: sel,
    hint: "Pass a single file, or target an input that has the `multiple` attribute.",
    details: { files, multiple }
  });
  if (info.fileInput) {
    if (files.length > 1 && !info.multiple) throw await tooMany(false);
    const rect2 = info.shown && await loc.isVisible().catch(() => false) ? await reveal(env, loc, sel, where, d, timeout) : await revealUploadProxy(env, loc, sel, where, d, timeout);
    await attempt(env, where, sel, `choose ${names} in`, () => loc.setInputFiles(files, { timeout }));
    return { ...rect2 ? { rect: rect2 } : {}, focus: rect2 };
  }
  if (!await loc.isVisible().catch(() => false)) loc = await resolveTarget(env, sel, where, timeout);
  const rect = await reveal(env, loc, sel, where, d, timeout);
  const chooser = env.page.waitForEvent("filechooser", { timeout }).catch((err) => err);
  await attempt(env, where, sel, "click", () => loc.click({ timeout }));
  const fc = await chooser;
  if (fc instanceof Error) {
    throw await failure(env, "ACTION_FAILED", `${label(where)}: clicking ${narascreen.describeSelector(sel)} did not open a file picker (waited ${timeout}ms)`, {
      where,
      selector: sel,
      hint: UPLOAD_TARGET_HINT
    });
  }
  if (files.length > 1 && !fc.isMultiple()) throw await tooMany(false);
  await attempt(env, where, sel, `choose ${names} in`, () => fc.setFiles(files, { timeout }));
  return { rect, focus: await currentRect(loc) ?? rect };
}
async function revealUploadProxy(env, input, sel, where, d, timeout) {
  const key = `u${Date.now().toString(36)}`;
  const found = await input.evaluate((el, k) => {
    const input2 = el;
    const cands = [];
    if (input2.id) cands.push(...Array.from(document.querySelectorAll(`label[for="${CSS.escape(input2.id)}"]`)));
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
      if (a.matches("label, button, a, [role=button], [tabindex], [onclick]") || getComputedStyle(a).cursor === "pointer") cands.push(a);
    }
    const hit = cands.find((x) => {
      const r = x.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && (typeof x.checkVisibility !== "function" || x.checkVisibility());
    });
    if (!hit) return false;
    hit.setAttribute("data-narascreen-upload", k);
    return true;
  }, key).catch(() => false);
  if (!found) return null;
  const proxy = env.page.locator(`[data-narascreen-upload="${key}"]`).first();
  try {
    return await reveal(env, proxy, sel, where, d, timeout);
  } catch {
    return null;
  } finally {
    await proxy.evaluate((el) => el.removeAttribute("data-narascreen-upload")).catch(() => {
    });
  }
}
async function gotoChecked(env, target, where, timeoutMs) {
  const url = absoluteUrl(target, env.script.baseUrl);
  let status;
  try {
    const resp = await env.page.goto(target, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    status = resp?.status();
  } catch (err) {
    const msg = firstLine(err);
    throw await failure(env, "NAVIGATION_FAILED", `${label(where)}: could not open ${url}: ${msg}`, {
      where,
      hint: /ERR_CONNECTION_REFUSED|ERR_NAME_NOT_RESOLVED|ERR_ADDRESS_UNREACHABLE/.test(msg) ? "The site is not reachable. Start it / check baseUrl, then retry." : /Timeout/i.test(msg) ? `The page did not load within ${timeoutMs}ms. Check the URL and that the server responds.` : "Check baseUrl + path (open the URL yourself) and that the site is running.",
      details: { targetUrl: url, error: msg }
    });
  }
  if (status != null && status >= 400) {
    throw await failure(env, "NAVIGATION_FAILED", `${label(where)}: ${url} returned HTTP ${status}`, {
      where,
      hint: status === 401 || status === 403 ? "The page needs a logged-in session: add `setup` entries that log in, or a storageState file." : status === 404 ? "No page at that path. Check the path against baseUrl (run `narascreen inspect --url <baseUrl>` and read the links)." : "The server returned an error. Check that the site works in a normal browser.",
      details: { targetUrl: url, status }
    });
  }
  await env.page.waitForLoadState("load", { timeout: 5e3 }).catch(() => {
  });
}
function absoluteUrl(target, baseUrl) {
  try {
    return new URL(target, baseUrl).href;
  } catch {
    return target;
  }
}
async function scrollToY(env, y, d, where) {
  const plan = await env.page.evaluate(
    ({ top, key, smooth }) => {
      const se = document.scrollingElement || document.documentElement;
      let target = se.scrollHeight - se.clientHeight > 1 ? se : null;
      if (!target) {
        let best = 0;
        for (const el of Array.from(document.querySelectorAll("body *"))) {
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
      window[key] = [{ a: target, left: target.scrollLeft, top: to }];
      target.scrollTo({ top: to, behavior: smooth ? "smooth" : "instant" });
      return { found: true, from, to };
    },
    { top: y, key: SCROLL_KEY, smooth: !env.fast }
  );
  if (!plan.found) {
    addWarning(env, `${where.path}: scroll to y=${y} did nothing — neither the page nor any element on it can scroll. Scroll to an element instead ({"act": "scroll", "role": …}).`);
    return;
  }
  await waitForScroll(env.page, Date.now(), d.revealMs);
}
const SCROLL_KEY = "__narascreen_scroll_targets";
async function waitForScroll(page, since, minMs) {
  const check = (force) => page.evaluate(
    ({ key, force: force2 }) => {
      const w = window;
      const list = w[key] ?? [];
      let done = true;
      for (const x of list) {
        if (Math.abs(x.a.scrollTop - x.top) > 1 || Math.abs(x.a.scrollLeft - x.left) > 1) {
          done = false;
          if (force2) x.a.scrollTo({ left: x.left, top: x.top, behavior: "instant" });
        }
      }
      if (done || force2) delete w[key];
      return done;
    },
    { key: SCROLL_KEY, force }
  ).catch(() => true);
  const deadline = since + 3e3;
  while (!await check(false)) {
    if (Date.now() > deadline) {
      await check(true);
      break;
    }
    await sleep(40);
  }
  const left = since + minMs - Date.now();
  if (left > 0) await sleep(left);
}
async function selectOption(env, loc, sel, option, where, timeout) {
  const opts = await loc.evaluate(
    (el) => el.tagName === "SELECT" ? Array.from(el.options).map((o) => ({ label: o.label.trim(), value: o.value })) : null
  ).catch(() => null);
  if (!opts) {
    throw await failure(env, "ACTION_FAILED", `${label(where)}: ${narascreen.describeSelector(sel)} is not a native <select>`, {
      where,
      selector: sel,
      hint: '`select` only works on native <select> elements. For a custom dropdown, use two clicks: {"act": "click", …the dropdown…} then {"act": "click", "role": "option", "name": "…"}.'
    });
  }
  const want = option.trim().toLowerCase();
  const index2 = [
    opts.findIndex((o) => o.label === option),
    opts.findIndex((o) => o.value === option),
    opts.findIndex((o) => o.label.toLowerCase() === want)
  ].find((i) => i >= 0);
  if (index2 == null) {
    throw await failure(env, "ACTION_FAILED", `${label(where)}: option "${option}" is not in ${narascreen.describeSelector(sel)}`, {
      where,
      selector: sel,
      hint: `Use one of the labels in details.options, e.g. "${opts[0]?.label ?? ""}".`,
      details: { option, options: opts.map((o) => o.label) }
    });
  }
  await attempt(env, where, sel, "select an option in", () => loc.selectOption({ index: index2 }, { timeout }));
}
async function useSession(env, e, where, timeoutMs) {
  const file = e.storageState;
  if (!fs__namespace.existsSync(file)) {
    throw await failure(env, "STORAGE_STATE_NOT_FOUND", `${label(where)}: storageState file not found: ${file}`, {
      where,
      hint: "Create the file (Playwright context.storageState({ path })) or fix the path (relative to the script file).",
      details: { path: file }
    });
  }
  let state;
  try {
    state = JSON.parse(fs__namespace.readFileSync(file, "utf-8"));
  } catch (err) {
    throw await failure(env, "ACTION_FAILED", `${label(where)}: ${file} is not valid JSON: ${firstLine(err)}`, {
      where,
      hint: "useSession needs a Playwright storageState JSON: { cookies: [...], origins: [{ origin, localStorage: [...] }] }.",
      details: { path: file }
    });
  }
  const { page } = env;
  const context = page.context();
  try {
    await context.clearCookies();
    if (state.cookies?.length) await context.addCookies(state.cookies);
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
      const tmp = await context.newPage().finally(() => env.openingInternal = false);
      env.internalPages.add(tmp);
      try {
        await tmp.route("**/*", (r) => r.fulfill({ status: 200, contentType: "text/html", body: "<html></html>" }));
        await tmp.goto(o.origin);
        await tmp.evaluate((list) => {
          localStorage.clear();
          for (const it of list) localStorage.setItem(it.name, it.value);
        }, o.localStorage);
      } finally {
        await tmp.close().catch(() => {
        });
      }
    }
    await page.bringToFront().catch(() => {
    });
  } catch (err) {
    throw await failure(env, "ACTION_FAILED", `${label(where)}: could not load session ${file}: ${firstLine(err)}`, {
      where,
      hint: "Check that the file is a Playwright storageState JSON and that cookie domains match the site.",
      details: { path: file, error: firstLines(errText(err), 4) }
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
        hint: "Give useSession a `path` to open after switching."
      });
    }
  }
}
function originOf(url) {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" ? u.origin : null;
  } catch {
    return null;
  }
}
async function resolveTarget(env, sel, where, timeout, opts = {}) {
  const loc = narascreen.locate(env.page, sel);
  try {
    await loc.waitFor({ state: opts.attached ? "attached" : "visible", timeout });
  } catch (err) {
    throw await diagnoseMissing(env, sel, where, timeout, err, !!opts.waitFor);
  }
  if (sel.nth == null) {
    const count = await narascreen.locateAll(env.page, sel).filter({ visible: true }).count().catch(() => 1);
    if (count > 1) {
      addWarning(
        env,
        `${where.path}: selector ${narascreen.describeSelector(sel)} matched ${count} visible elements; used match #${sel.nth ?? 0}. Add "nth" or "within" to choose explicitly (\`narascreen inspect\` suggests a unique selector).`
      );
    }
  }
  return loc;
}
async function diagnoseMissing(env, sel, where, timeout, waitErr, isWaitFor) {
  const { page } = env;
  const text = narascreen.describeSelector(sel);
  let count;
  try {
    count = await narascreen.locateAll(page, sel).count();
  } catch (err) {
    return failure(env, "SELECTOR_NOT_FOUND", `${label(where)}: invalid selector ${text}: ${firstLine(err)}`, {
      where,
      selector: sel,
      hint: "Fix the CSS syntax, or better, use role(+name) / label / text (see details.candidates)."
    });
  }
  const nth = sel.nth ?? 0;
  const containerMissing = sel.within ? await narascreen.scopeLocator(page, sel.within).count().catch(() => 0) === 0 : false;
  const hiddenByRole = count === 0 && sel.role != null ? await narascreen.locateAll(page, sel, { includeHidden: true }).count().catch(() => 0) : 0;
  const visibleIdx = count > 0 ? await narascreen.locateAll(page, sel).evaluateAll(
    (els) => els.map((el, i) => {
      const r = el.getBoundingClientRect();
      const vis = typeof el.checkVisibility === "function" ? el.checkVisibility() : true;
      return r.width > 0 && r.height > 0 && vis ? i : -1;
    }).filter((i) => i >= 0)
  ).catch(() => []) : [];
  const details = { matches: count, timeoutMs: timeout };
  if (visibleIdx.length) details.visibleMatches = visibleIdx;
  const inspectCmd = `narascreen inspect --script <script>${env.prevStep ? ` --until ${env.prevStep}` : ""}`;
  const pickHint = `Pick a selector from details.candidates (each .selector is ready to paste), or list every element on that page with \`${inspectCmd}\`. details.screenshot shows what the page looked like.`;
  const unknownRole = sel.role != null && !narascreen.ARIA_ROLES.includes(sel.role) ? `"${sel.role}" is not an ARIA role${narascreen.suggestRole(sel.role) ? ` — did you mean "${narascreen.suggestRole(sel.role)}"?` : "."} ` : "";
  let code;
  let message;
  let hint;
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
    hint = isWaitFor ? `${unknownRole}Nothing like that appeared. The previous entry probably did not do what you expected — check details.screenshot/headings. If the page is just slow, raise timeoutMs. ${pickHint}` : `${unknownRole}${pickHint}`;
  } else if (nth >= count) {
    code = isWaitFor ? "WAIT_TIMEOUT" : "SELECTOR_NOT_FOUND";
    message = `${label(where)}: ${text} asks for match #${nth} but only ${count} element(s) match`;
    hint = `Use nth 0..${count - 1}, or a more specific selector. ${pickHint}`;
  } else {
    code = isWaitFor ? "WAIT_TIMEOUT" : "TARGET_NOT_VISIBLE";
    message = `${label(where)}: ${text} matched ${count} element(s) but match #${nth} is hidden or has no size (waited ${timeout}ms)`;
    const other = visibleIdx.find((i) => i !== nth);
    hint = other != null ? `Match #${other} is visible — add "nth": ${other}, or narrow with "within". Otherwise do whatever reveals the element first (open the menu/tab/dialog).` : "Do whatever reveals it first in an earlier entry (open the menu/tab/dialog, hover the row, switch tabs).";
  }
  if (!isPlaywrightTimeout(waitErr)) details.error = firstLines(errText(waitErr), 3);
  return failure(env, code, message, { where, selector: sel, hint, details });
}
async function reveal(env, loc, sel, where, d, timeout) {
  const before = await narascreen.measureVisible(loc, timeout);
  const started = Date.now();
  const startedT = env.now();
  try {
    await loc.evaluate(
      (el, o) => {
        if (o.jump) el.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
        const w = window;
        if (!o.center) {
          delete w[o.key];
          return;
        }
        const block = el.getBoundingClientRect().height > window.innerHeight * 0.8 ? "start" : "center";
        const scrollers = [];
        for (let a = el.parentElement; a; a = a.parentElement) {
          if (a.scrollHeight > a.clientHeight || a.scrollWidth > a.clientWidth) scrollers.push(a);
        }
        const se = document.scrollingElement || document.documentElement;
        if (!scrollers.includes(se)) scrollers.push(se);
        const from = scrollers.map((a) => [a.scrollLeft, a.scrollTop]);
        el.scrollIntoView({ block, inline: "center", behavior: "instant" });
        w[o.key] = scrollers.map((a) => ({ a, left: a.scrollLeft, top: a.scrollTop }));
        if (o.smooth) {
          scrollers.forEach((a, i) => a.scrollTo({ left: from[i][0], top: from[i][1], behavior: "instant" }));
          el.scrollIntoView({ block, inline: "center", behavior: "smooth" });
        }
      },
      { center: d.center, jump: !before?.whole, smooth: !env.fast, key: SCROLL_KEY },
      { timeout }
    );
  } catch (err) {
    throw await failure(env, "TARGET_NOT_VISIBLE", `${label(where)}: could not scroll ${narascreen.describeSelector(sel)} into view: ${firstLine(err)}`, {
      where,
      selector: sel,
      hint: "The element is hidden, detached or covered. Do whatever reveals it first (open the menu/tab/dialog)."
    });
  }
  await waitForScroll(env.page, started, d.revealMs);
  const box = await settledBox(loc);
  const m = box ? await narascreen.measureVisible(loc, timeout) : null;
  if (m?.visible && !(before?.visible && before.visible.every((v, n) => Math.abs(v - m.visible[n]) <= 2))) {
    env.movedAt ??= startedT;
  }
  if (!m?.visible) {
    throw await failure(
      env,
      "TARGET_NOT_VISIBLE",
      `${label(where)}: ${narascreen.describeSelector(sel)} is ${box ? "outside the visible area (or clipped by a scrolling container)" : "hidden or has no size"} after scrolling`,
      {
        where,
        selector: sel,
        hint: "Target an element that is on screen (e.g. the visible wrapper), or reveal it first (open the menu/tab/dialog).",
        details: box ? { box } : void 0
      }
    );
  }
  return m.visible;
}
async function revealGroup(env, items, d) {
  const locs = [];
  for (const it of items) locs.push(await resolveTarget(env, it.sel, it.where, d.timeoutMs));
  const first = await reveal(env, locs[0], items[0].sel, items[0].where, d, d.timeoutMs);
  if (locs.length === 1) return [first];
  const vp = env.script.viewport;
  let boxes = await measureAll(locs, vp);
  if (boxes.some((b) => !b.rect) && boxes.every((b) => b.box)) {
    const top = Math.min(...boxes.map((b) => b.box.y));
    const bottom = Math.max(...boxes.map((b) => b.box.y + b.box.height));
    const left = Math.min(...boxes.map((b) => b.box.x));
    const right = Math.max(...boxes.map((b) => b.box.x + b.box.width));
    if (bottom - top <= vp.height && right - left <= vp.width) {
      const dy = (top + bottom) / 2 - vp.height / 2;
      const started = Date.now();
      env.movedAt ??= env.now();
      await env.page.evaluate(
        ({ by, key, smooth }) => {
          const se = document.scrollingElement || document.documentElement;
          const top2 = Math.max(0, Math.min(se.scrollTop + by, se.scrollHeight - se.clientHeight));
          window[key] = [{ a: se, left: se.scrollLeft, top: top2 }];
          se.scrollTo({ top: top2, behavior: smooth ? "smooth" : "instant" });
        },
        { by: dy, key: SCROLL_KEY, smooth: !env.fast }
      );
      await waitForScroll(env.page, started, d.revealMs);
      await settledBox(locs[0]);
      boxes = await measureAll(locs, vp);
    }
  }
  const off = boxes.map((b, k) => ({ k, ...b })).filter((b) => !b.rect).map((b) => ({
    index: b.k,
    path: items[b.k].where.path,
    selectorText: narascreen.describeSelector(items[b.k].sel),
    ...b.box ? { box: b.box } : {}
  }));
  if (off.length) {
    const k = off[0].index;
    throw await failure(
      env,
      "TARGET_NOT_VISIBLE",
      `${label(items[k].where)}: ${off.length} of ${items.length} elements of this effect are not on screen together with ${narascreen.describeSelector(items[0].sel)}`,
      {
        where: items[k].where,
        selector: items[k].sel,
        hint: "These elements are not on screen at the same time — split them into separate effects or steps (details.offscreen lists which).",
        details: { offscreen: off, viewport: vp }
      }
    );
  }
  return boxes.map((b) => b.rect);
}
async function measureAll(locs, vp) {
  return Promise.all(
    locs.map(async (l) => {
      const m = await narascreen.measureVisible(l, 1e3);
      if (!m) return { box: null, rect: null };
      const huge = m.box.width > vp.width || m.box.height > vp.height;
      const fills = !!m.visible && m.visible[2] >= Math.min(m.box.width, vp.width) - 1 && m.visible[3] >= Math.min(m.box.height, vp.height) - 1;
      return { box: m.box, rect: m.whole || huge && fills ? m.visible : null };
    })
  );
}
async function targetRects(env, targets, where, d) {
  const items = targets.map((tg, k) => {
    if (!tg.anchor) {
      throw new index.AgentError("SCRIPT_INVALID", `${label(where)}: zoom target ${k} has no anchor`, {
        hint: "Give every zoom target an `anchor` selector (run `narascreen validate`).",
        where: { ...where, path: `${where.path}.targets[${k}]` }
      });
    }
    return { sel: tg.anchor, where: { ...where, path: `${where.path}.targets[${k}].anchor` } };
  });
  return revealGroup(env, items, d);
}
async function settledBox(loc) {
  let prev = await loc.boundingBox().catch(() => null);
  for (let i = 0; i < 16 && prev; i++) {
    await sleep(60);
    const cur = await loc.boundingBox().catch(() => null);
    if (!cur) return null;
    const same = Math.abs(cur.x - prev.x) < 0.5 && Math.abs(cur.y - prev.y) < 0.5 && Math.abs(cur.width - prev.width) < 0.5 && Math.abs(cur.height - prev.height) < 0.5;
    prev = cur;
    if (same) break;
  }
  return prev && prev.width > 0 && prev.height > 0 ? prev : null;
}
async function attempt(env, where, sel, verb, fn) {
  try {
    await fn();
  } catch (err) {
    if (err instanceof index.AgentError) throw err;
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
      hint = 'The element kept moving (animation). Add {"act": "wait", "ms": 500} before this entry.';
    } else if (/not an <input>|not editable|contenteditable/i.test(all)) {
      hint = "fill needs an editable field (textbox/textarea/contenteditable). Target the input itself, e.g. by its label.";
    } else if (/Unknown key/i.test(all)) {
      hint = "Use Playwright key names: Enter, Tab, Escape, ArrowDown, Backspace, Control+A, Meta+K, Shift+Tab…";
    } else if (/has been closed|Target closed/i.test(all)) {
      hint = "The page or browser closed during the action (a click that closes the tab?). Don't close the browser during a run.";
    } else if (/detached/i.test(all)) {
      hint = "The page re-rendered and replaced the element. Add a waitFor for the element (or a short wait) before this entry.";
    }
    throw await failure(env, "ACTION_FAILED", `${label(where)}: could not ${verb}${sel ? ` ${narascreen.describeSelector(sel)}` : ""}: ${reason}`, {
      where,
      selector: sel,
      hint,
      details: { ...callLog.length ? { callLog } : {} }
    });
  }
}
function label(where) {
  return where.step ? `step "${where.step}" entry ${where.entry} (${where.path})` : where.path ?? "run";
}
async function failure(env, code, message, init) {
  const { page } = env;
  const details = {};
  if (init.selector) {
    details.selector = init.selector;
    details.selectorText = narascreen.describeSelector(init.selector);
  }
  Object.assign(details, init.details);
  details.url = page.url();
  details.title = await page.title().catch(() => "");
  try {
    fs__namespace.mkdirSync(env.failuresDir, { recursive: true });
    const w = init.where;
    const name = w?.step != null ? `${w.step}-${w.entry}` : w?.path ? w.path.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/-+$/, "") : "failure";
    const file = path__namespace.join(env.failuresDir, `${name}.png`);
    await page.screenshot({ path: file, scale: "css", timeout: 5e3 });
    details.screenshot = file;
  } catch {
  }
  details.headings = await narascreen.pageHeadings(page, 12);
  if (init.selector) {
    try {
      const all = await withTimeout(narascreen.collectElements(page, { limit: 200 }), DIAGNOSE_BUDGET_MS);
      details.candidates = narascreen.similarElements(all, init.selector, 8);
    } catch {
    }
  }
  return new index.AgentError(code, message, { hint: init.hint, where: init.where, details });
}
async function gotoPage(page, target, opts) {
  const env = {
    page,
    script: { baseUrl: opts.baseUrl },
    plugins: [],
    failuresDir: path__namespace.resolve(opts.failuresDir),
    warnings: [],
    log: () => {
    },
    currentPath: "url",
    internalPages: /* @__PURE__ */ new Set(),
    now: () => 0,
    lastChange: 0
  };
  await gotoChecked(env, target, { path: "url" }, opts.timeoutMs ?? MIN_NAV_TIMEOUT_MS);
}
async function holdOpen(log, why) {
  log(`${why}. Browser held open — inspect it, then press Enter here to close.`);
  await new Promise((resolve) => {
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
function withTimeout(p, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      }
    );
  });
}
function errText(err) {
  return err instanceof Error ? err.message : String(err);
}
function firstLine(err) {
  return errText(err).split("\n")[0].replace(/^[a-zA-Z]+\.[a-zA-Z]+: /, "").replace(/^Error: /, "").trim();
}
function firstLines(s, n) {
  return s.split("\n").slice(0, n).join("\n");
}
function isPlaywrightTimeout(err) {
  return err instanceof Error && (err.name === "TimeoutError" || /Timeout \d+ms exceeded/.test(err.message));
}
function callLogLines(msg) {
  const i = msg.indexOf("Call log:");
  if (i < 0) return [];
  const lines = msg.slice(i + "Call log:".length).split("\n").map((l) => l.replace(/^\s*-\s*/, "").trim()).filter(Boolean);
  return [...new Set(lines)].slice(-6);
}
exports.gotoPage = gotoPage;
exports.run = run;
