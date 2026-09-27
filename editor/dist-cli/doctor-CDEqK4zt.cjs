"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
const child_process = require("child_process");
const fs = require("fs");
const path = require("path");
const narascreen = require("./narascreen.cjs");
const index = require("./job-W-Szny1w.cjs");
require("util");
require("url");
require("os");
require("crypto");
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
const EDITOR_DIR = path__namespace.resolve(__dirname, "..");
const MIN_NODE_MAJOR = 18;
const FFMPEG_FIX = process.platform === "darwin" ? "brew install ffmpeg" : process.platform === "win32" ? "winget install Gyan.FFmpeg" : "sudo apt install ffmpeg";
const FFMPEG_NOTE = "install a full ffmpeg build (with libass), on PATH";
const KOKORO_DOCKER = "docker run -d --name narascreen-kokoro -p 8880:8880 ghcr.io/remsky/kokoro-fastapi-cpu:latest";
const FILTERS = [
  { name: "drawtext", required: false, usedFor: "timestamps on preview frames" },
  { name: "ass", required: true, usedFor: "lower-third and caption rendering" },
  { name: "zoompan", required: false, usedFor: "the zoom effect" },
  { name: "boxblur", required: false, usedFor: "the blur effect" }
];
async function runDoctor(opts = {}) {
  index.stage("doctor", "Checking the environment");
  const checks = [];
  const add = (c) => {
    checks.push(c);
    index.log(`${c.ok ? "ok  " : c.required ? "FAIL" : "warn"} ${c.id}: ${c.detail}`);
  };
  add(checkNode());
  const { FFMPEG_PATH, FFPROBE_PATH } = await Promise.resolve().then(() => require("./job-W-Szny1w.cjs")).then((n) => n.binPaths);
  const ffmpeg = checkBinary("ffmpeg", FFMPEG_PATH);
  add(ffmpeg);
  add(checkBinary("ffprobe", FFPROBE_PATH));
  for (const c of checkFilters(FFMPEG_PATH, ffmpeg.ok)) add(c);
  const s = opts.script;
  const needsBrowser = !s?.source || !!(s.intro || s.outro);
  const [browser, tts] = await Promise.all([checkChromium(needsBrowser), checkTtsEngine(opts.script)]);
  add(browser);
  add(tts);
  add(checkOutputDir(opts.outDir ?? path__namespace.resolve("narascreen-out")));
  if (opts.script?.plugins?.flutter) add(await checkFlutterSite(opts.script.baseUrl));
  const ready = checks.every((c) => c.ok || !c.required);
  return { ready, checks };
}
async function checkFlutterSite(baseUrl) {
  const { checkFlutterBuild } = await Promise.resolve().then(() => require("./job-W-Szny1w.cjs")).then((n) => n.index);
  const fix = "Serve the output of `flutter build web` (e.g. `cd build/web && python3 -m http.server 8080`) and set baseUrl to it.";
  if (!baseUrl) return { id: "flutter", ok: false, required: true, detail: "plugins.flutter is set but the script has no baseUrl", fix };
  try {
    const res = await fetch(baseUrl, { signal: AbortSignal.timeout(1e4) });
    if (!res.ok) return { id: "flutter", ok: false, required: true, detail: `${baseUrl} answered HTTP ${res.status}`, fix };
    await checkFlutterBuild(baseUrl);
    return { id: "flutter", ok: true, required: true, detail: `${baseUrl} serves a Flutter web build` };
  } catch (e) {
    return { id: "flutter", ok: false, required: true, detail: `${baseUrl}: ${firstLine(e)}`, fix };
  }
}
function checkNode() {
  const major = Number(process.versions.node.split(".")[0]);
  const ok = major >= MIN_NODE_MAJOR;
  return {
    id: "node",
    ok,
    required: true,
    detail: `Node.js ${process.versions.node}${ok ? "" : ` — need ${MIN_NODE_MAJOR} or newer (LTS from https://nodejs.org)`}`,
    ...ok ? {} : { fix: "nvm install --lts" }
  };
}
function checkBinary(id, bin) {
  const r = child_process.spawnSync(bin, ["-version"], { encoding: "utf-8", timeout: 15e3 });
  if (r.error || r.status !== 0) {
    const why = r.error ? r.error.code ?? r.error.message : `exit code ${r.status}`;
    return { id, ok: false, required: true, detail: `${id} is not runnable (${bin}: ${why}) — ${FFMPEG_NOTE}`, fix: FFMPEG_FIX };
  }
  const first = (r.stdout ?? "").split("\n")[0] ?? "";
  const version = /version\s+(\S+)/.exec(first)?.[1] ?? "unknown version";
  return { id, ok: true, required: true, detail: `${id} ${version} (${whichSync(bin) ?? bin})` };
}
function checkFilters(ffmpegPath, ffmpegOk) {
  let available = /* @__PURE__ */ new Set();
  let probeError = "";
  if (ffmpegOk) {
    const r = child_process.spawnSync(ffmpegPath, ["-hide_banner", "-filters"], { encoding: "utf-8", timeout: 15e3 });
    if (r.status === 0) available = parseFilterList(r.stdout ?? "");
    else probeError = r.error?.message ?? `ffmpeg -filters exited with ${r.status}`;
  } else {
    probeError = "ffmpeg is not runnable";
  }
  return FILTERS.map(({ name, required, usedFor }) => {
    const ok = available.has(name);
    return {
      id: `ffmpeg.${name}`,
      ok,
      required,
      detail: ok ? `filter ${name} available (${usedFor})` : `filter ${name} missing — needed for ${usedFor}${probeError ? ` (${probeError})` : ""}; ${FFMPEG_NOTE}`,
      ...ok ? {} : { fix: FFMPEG_FIX }
    };
  });
}
function parseFilterList(text) {
  const names = /* @__PURE__ */ new Set();
  for (const line of text.split("\n")) {
    const m = /^\s*[A-Z.|]{2,4}\s+(\w+)\s+\S*->\S*/.exec(line);
    if (m) names.add(m[1]);
  }
  return names;
}
async function checkChromium(required) {
  let chromium;
  try {
    ({ chromium } = await import("playwright-core"));
  } catch (e) {
    return {
      id: "chromium",
      ok: false,
      required,
      ...narascreen.isBundled() ? { detail: `playwright-core is missing from the app (${firstLine(e)}) — reinstall NaraScreen` } : { detail: `Playwright is not installed: ${firstLine(e)}`, fix: `cd ${quote(EDITOR_DIR)} && npm install && ${playwrightInstall(false)}` }
    };
  }
  const exe = chromium.executablePath();
  if (!exe || !fs__namespace.existsSync(exe)) {
    return { id: "chromium", ok: false, required, detail: `Playwright Chromium is not installed (expected at ${exe})`, fix: playwrightInstall(false) };
  }
  try {
    const browser = await chromium.launch({ headless: true, timeout: 3e4 });
    const version = browser.version();
    await browser.close();
    return { id: "chromium", ok: true, required, detail: `Chromium ${version} (${exe})` };
  } catch (e) {
    return {
      id: "chromium",
      ok: false,
      required,
      detail: `Chromium is installed but did not start: ${firstLine(e)}`,
      fix: playwrightInstall(process.platform === "linux")
    };
  }
}
function playwrightInstall(withDeps) {
  let cliJs;
  try {
    cliJs = path__namespace.join(path__namespace.dirname(require.resolve("playwright-core/package.json")), "cli.js");
  } catch {
    return `cd ${quote(EDITOR_DIR)} && npx playwright install${withDeps ? " --with-deps" : ""} chromium`;
  }
  const run = `${quote(process.execPath)} ${quote(cliJs)} install${withDeps ? " --with-deps" : ""} chromium`;
  if (!process.versions.electron) return run;
  return process.platform === "win32" ? `set ELECTRON_RUN_AS_NODE=1&& ${run}` : `ELECTRON_RUN_AS_NODE=1 ${run}`;
}
async function checkTtsEngine(script) {
  const required = script ? needsSpeech(script) : true;
  try {
    const { resolveTtsTarget, checkTts } = await Promise.resolve().then(() => require("./narration-C9OhKhcT.cjs")).then((n) => n.narration);
    const target = resolveTtsTarget(script);
    const res = await checkTts(target);
    if (res.ok) return { id: "tts", ok: true, required, detail: res.detail };
    return { id: "tts", ok: false, required, ...ttsFix(target, res.detail) };
  } catch (e) {
    return { id: "tts", ok: false, required, ...ttsFix({ mode: "http" }, `TTS check failed: ${firstLine(e)}`) };
  }
}
function needsSpeech(script) {
  return script.steps.some(
    (b) => b.beat.some((e) => {
      if (!index.isFx(e) || e.disabled) return false;
      if (e.narrate != null && e.audio == null) return true;
      return (e.targets ?? []).some((t) => t.narrate != null && t.audio == null);
    })
  );
}
function ttsFix(target, detail) {
  if (target.mode === "python") {
    return {
      detail: `${detail} — install the kokoro package for ${target.python ?? "python3"}, or unset KOKORO_PYTHON to use the Kokoro HTTP server`,
      fix: `${quote(target.python ?? "python3")} -m pip install kokoro soundfile`
    };
  }
  const custom = target.endpoint && target.endpoint !== index.DEFAULT_KOKORO_ENDPOINT;
  return {
    detail: `${detail} — start Kokoro with the fix command (its first start downloads the voice model: wait ~1–2 minutes, then run doctor again)` + (custom ? `, or start your server at ${target.endpoint}` : ""),
    fix: KOKORO_DOCKER
  };
}
function checkOutputDir(outDir) {
  let probe = path__namespace.resolve(outDir);
  while (!fs__namespace.existsSync(probe) && path__namespace.dirname(probe) !== probe) probe = path__namespace.dirname(probe);
  const testFile = path__namespace.join(probe, `.narascreen-write-test-${process.pid}`);
  try {
    fs__namespace.writeFileSync(testFile, "");
    fs__namespace.rmSync(testFile, { force: true });
  } catch (e) {
    return {
      id: "output",
      ok: false,
      required: true,
      detail: `cannot write to ${probe}: ${firstLine(e)} — run from a writable directory, or pass a writable --out / --workspace`
    };
  }
  let free = "";
  try {
    const s = fs__namespace.statfsSync(probe);
    free = `, ${(s.bavail * s.bsize / 1024 ** 3).toFixed(1)} GB free`;
  } catch {
  }
  return { id: "output", ok: true, required: true, detail: `${outDir} is writable${free}` };
}
function whichSync(bin) {
  if (path__namespace.isAbsolute(bin)) return bin;
  const exts = process.platform === "win32" ? (process.env.PATHEXT ?? ".EXE;.CMD").split(";") : [""];
  for (const dir of (process.env.PATH ?? "").split(path__namespace.delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const cand = path__namespace.join(dir, bin + ext);
      try {
        if (fs__namespace.statSync(cand).isFile()) return cand;
      } catch {
      }
    }
  }
  return void 0;
}
function firstLine(e) {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.split("\n").find((l) => l.trim())?.trim() ?? msg;
}
function quote(p) {
  return /^[\w@%+=:,./\\-]+$/.test(p) ? p : `"${p}"`;
}
exports.runDoctor = runDoctor;
