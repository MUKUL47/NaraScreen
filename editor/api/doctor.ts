// ─── doctor: is this machine ready to make videos? ───────────────────
//
// `narascreen doctor` is the first thing an agent runs. Every check says what
// it found (`detail`, including any explanation) and, when it fails, the shell
// command that fixes it (`fix` — always a runnable command, never prose, so the
// CLI can hand it straight to an agent as a `next` step).
// `required` checks gate `ready`; optional ones only degrade some effects.
//
// Nothing here prints: results go back to the caller, progress goes through the
// output.ts event helpers (stderr).

import { spawnSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { isBundled } from "./cli-process";
import { DEFAULT_KOKORO_ENDPOINT, isFx, type DemoScript } from "./schema";
import { log, stage } from "./output";

export interface DoctorCheck {
  id: string;
  ok: boolean;
  /** false → the check failing does not make the machine "not ready". */
  required: boolean;
  detail: string;
  /** Shell command that fixes a failed check (explanations belong in `detail`). */
  fix?: string;
}

export interface DoctorOptions {
  /** Check this script's TTS endpoint (and skip TTS as a requirement if it narrates nothing). */
  script?: DemoScript;
  /** Where job folders will be written (default ./narascreen-out). */
  outDir?: string;
}

export interface DoctorReport {
  ready: boolean;
  checks: DoctorCheck[];
}

const EDITOR_DIR = path.resolve(__dirname, "..");
const MIN_NODE_MAJOR = 18;

const FFMPEG_FIX =
  process.platform === "darwin" ? "brew install ffmpeg" : process.platform === "win32" ? "winget install Gyan.FFmpeg" : "sudo apt install ffmpeg";
const FFMPEG_NOTE = "install a full ffmpeg build (with libass), on PATH";
const KOKORO_DOCKER = "docker run -d --name narascreen-kokoro -p 8880:8880 ghcr.io/remsky/kokoro-fastapi-cpu:latest";

/** Filters the renderer uses. ass draws callouts and captions (required);
 *  zoompan and boxblur only power the zoom/blur effects. drawtext is only used
 *  for the optional frame labels of `preview` (the renderer no longer needs it,
 *  and the ffmpeg bundled with the desktop app does not have it). */
const FILTERS: { name: string; required: boolean; usedFor: string }[] = [
  { name: "drawtext", required: false, usedFor: "timestamps on preview frames" },
  { name: "ass", required: true, usedFor: "lower-third and caption rendering" },
  { name: "zoompan", required: false, usedFor: "the zoom effect" },
  { name: "boxblur", required: false, usedFor: "the blur effect" },
];

export async function runDoctor(opts: DoctorOptions = {}): Promise<DoctorReport> {
  stage("doctor", "Checking the environment");
  const checks: DoctorCheck[] = [];
  const add = (c: DoctorCheck) => {
    checks.push(c);
    log(`${c.ok ? "ok  " : c.required ? "FAIL" : "warn"} ${c.id}: ${c.detail}`);
  };

  add(checkNode());

  // bin-paths resolves ffmpeg the same way the renderer will (system PATH first,
  // then the npm static builds), so the check matches what produce actually runs.
  const { FFMPEG_PATH, FFPROBE_PATH } = await import("../electron/bin-paths");
  const ffmpeg = checkBinary("ffmpeg", FFMPEG_PATH);
  add(ffmpeg);
  add(checkBinary("ffprobe", FFPROBE_PATH));
  for (const c of checkFilters(FFMPEG_PATH, ffmpeg.ok)) add(c);

  // The two slow checks (browser launch, TTS round trip) run side by side.
  // A video-source script opens a browser only to draw its title/end cards.
  const s = opts.script;
  const needsBrowser = !s?.source || !!(s.intro || s.outro);
  const [browser, tts] = await Promise.all([checkChromium(needsBrowser), checkTtsEngine(opts.script)]);
  add(browser);
  add(tts);

  add(checkOutputDir(opts.outDir ?? path.resolve("narascreen-out")));
  if (opts.script?.plugins?.flutter) add(await checkFlutterSite(opts.script.baseUrl));

  const ready = checks.every((c) => c.ok || !c.required);
  return { ready, checks };
}

// ─── individual checks ───────────────────────────────────────────────

/** plugins.flutter: baseUrl must be up and serve a Flutter web build. */
async function checkFlutterSite(baseUrl: string | undefined): Promise<DoctorCheck> {
  const { checkFlutterBuild } = await import("./plugins/flutter");
  const fix = "Serve the output of `flutter build web` (e.g. `cd build/web && python3 -m http.server 8080`) and set baseUrl to it.";
  if (!baseUrl) return { id: "flutter", ok: false, required: true, detail: "plugins.flutter is set but the script has no baseUrl", fix };
  try {
    const res = await fetch(baseUrl, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return { id: "flutter", ok: false, required: true, detail: `${baseUrl} answered HTTP ${res.status}`, fix };
    await checkFlutterBuild(baseUrl);
    return { id: "flutter", ok: true, required: true, detail: `${baseUrl} serves a Flutter web build` };
  } catch (e) {
    return { id: "flutter", ok: false, required: true, detail: `${baseUrl}: ${firstLine(e)}`, fix };
  }
}

function checkNode(): DoctorCheck {
  const major = Number(process.versions.node.split(".")[0]);
  const ok = major >= MIN_NODE_MAJOR;
  return {
    id: "node",
    ok,
    required: true,
    detail: `Node.js ${process.versions.node}${ok ? "" : ` — need ${MIN_NODE_MAJOR} or newer (LTS from https://nodejs.org)`}`,
    ...(ok ? {} : { fix: "nvm install --lts" }),
  };
}

function checkBinary(id: "ffmpeg" | "ffprobe", bin: string): DoctorCheck {
  const r = spawnSync(bin, ["-version"], { encoding: "utf-8", timeout: 15_000 });
  if (r.error || r.status !== 0) {
    const why = r.error ? (r.error as NodeJS.ErrnoException).code ?? r.error.message : `exit code ${r.status}`;
    return { id, ok: false, required: true, detail: `${id} is not runnable (${bin}: ${why}) — ${FFMPEG_NOTE}`, fix: FFMPEG_FIX };
  }
  const first = (r.stdout ?? "").split("\n")[0] ?? "";
  const version = /version\s+(\S+)/.exec(first)?.[1] ?? "unknown version";
  return { id, ok: true, required: true, detail: `${id} ${version} (${whichSync(bin) ?? bin})` };
}

function checkFilters(ffmpegPath: string, ffmpegOk: boolean): DoctorCheck[] {
  let available = new Set<string>();
  let probeError = "";
  if (ffmpegOk) {
    const r = spawnSync(ffmpegPath, ["-hide_banner", "-filters"], { encoding: "utf-8", timeout: 15_000 });
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
      detail: ok
        ? `filter ${name} available (${usedFor})`
        : `filter ${name} missing — needed for ${usedFor}${probeError ? ` (${probeError})` : ""}; ${FFMPEG_NOTE}`,
      ...(ok ? {} : { fix: FFMPEG_FIX }),
    };
  });
}

/** `ffmpeg -filters` lines look like " T.. drawtext   V->V   Draw text …". */
function parseFilterList(text: string): Set<string> {
  const names = new Set<string>();
  for (const line of text.split("\n")) {
    const m = /^\s*[A-Z.|]{2,4}\s+(\w+)\s+\S*->\S*/.exec(line);
    if (m) names.add(m[1]);
  }
  return names;
}

async function checkChromium(required: boolean): Promise<DoctorCheck> {
  let chromium: typeof import("playwright-core").chromium;
  try {
    ({ chromium } = await import("playwright-core"));
  } catch (e) {
    return {
      id: "chromium",
      ok: false,
      required,
      ...(isBundled()
        ? { detail: `playwright-core is missing from the app (${firstLine(e)}) — reinstall NaraScreen` }
        : { detail: `Playwright is not installed: ${firstLine(e)}`, fix: `cd ${quote(EDITOR_DIR)} && npm install && ${playwrightInstall(false)}` }),
    };
  }
  const exe = chromium.executablePath();
  if (!exe || !fs.existsSync(exe)) {
    return { id: "chromium", ok: false, required, detail: `Playwright Chromium is not installed (expected at ${exe})`, fix: playwrightInstall(false) };
  }
  // Launching (not just finding the file) also catches missing system libraries
  // and a missing headless shell, which a bare existence check would not.
  try {
    const browser = await chromium.launch({ headless: true, timeout: 30_000 });
    const version = browser.version();
    await browser.close();
    return { id: "chromium", ok: true, required, detail: `Chromium ${version} (${exe})` };
  } catch (e) {
    return {
      id: "chromium",
      ok: false,
      required,
      detail: `Chromium is installed but did not start: ${firstLine(e)}`,
      fix: playwrightInstall(process.platform === "linux"),
    };
  }
}

/** `playwright install chromium`, run with this very Node (or Electron-as-Node)
 *  and the playwright-core it loads — no npx, which a packaged app does not have. */
function playwrightInstall(withDeps: boolean): string {
  let cliJs: string;
  try {
    cliJs = path.join(path.dirname(require.resolve("playwright-core/package.json")), "cli.js");
  } catch {
    return `cd ${quote(EDITOR_DIR)} && npx playwright install${withDeps ? " --with-deps" : ""} chromium`;
  }
  const run = `${quote(process.execPath)} ${quote(cliJs)} install${withDeps ? " --with-deps" : ""} chromium`;
  if (!process.versions.electron) return run;
  return process.platform === "win32" ? `set ELECTRON_RUN_AS_NODE=1&& ${run}` : `ELECTRON_RUN_AS_NODE=1 ${run}`;
}

async function checkTtsEngine(script?: DemoScript): Promise<DoctorCheck> {
  // Only generated speech needs the engine: a script that narrates nothing, or
  // only plays pre-recorded `audio`, can be produced without it.
  const required = script ? needsSpeech(script) : true;
  try {
    const { resolveTtsTarget, checkTts } = await import("./narration");
    const target = resolveTtsTarget(script);
    const res = await checkTts(target);
    if (res.ok) return { id: "tts", ok: true, required, detail: res.detail };
    return { id: "tts", ok: false, required, ...ttsFix(target, res.detail) };
  } catch (e) {
    return { id: "tts", ok: false, required, ...ttsFix({ mode: "http" }, `TTS check failed: ${firstLine(e)}`) };
  }
}

function needsSpeech(script: DemoScript): boolean {
  return script.steps.some((b) =>
    b.beat.some((e) => {
      if (!isFx(e) || e.disabled) return false;
      if (e.narrate != null && e.audio == null) return true;
      return (e.targets ?? []).some((t) => t.narrate != null && t.audio == null);
    }),
  );
}

function ttsFix(target: { mode: "http" | "python"; endpoint?: string; python?: string }, detail: string): { detail: string; fix: string } {
  if (target.mode === "python") {
    return {
      detail: `${detail} — install the kokoro package for ${target.python ?? "python3"}, or unset KOKORO_PYTHON to use the Kokoro HTTP server`,
      fix: `${quote(target.python ?? "python3")} -m pip install kokoro soundfile`,
    };
  }
  const custom = target.endpoint && target.endpoint !== DEFAULT_KOKORO_ENDPOINT;
  return {
    detail:
      `${detail} — start Kokoro with the fix command (its first start downloads the voice model: wait ~1–2 minutes, then run doctor again)` +
      (custom ? `, or start your server at ${target.endpoint}` : ""),
    fix: KOKORO_DOCKER,
  };
}

function checkOutputDir(outDir: string): DoctorCheck {
  // Probe the nearest existing ancestor so doctor never creates folders itself.
  let probe = path.resolve(outDir);
  while (!fs.existsSync(probe) && path.dirname(probe) !== probe) probe = path.dirname(probe);
  const testFile = path.join(probe, `.narascreen-write-test-${process.pid}`);
  try {
    fs.writeFileSync(testFile, "");
    fs.rmSync(testFile, { force: true });
  } catch (e) {
    return {
      id: "output",
      ok: false,
      required: true,
      detail: `cannot write to ${probe}: ${firstLine(e)} — run from a writable directory, or pass a writable --out / --workspace`,
    };
  }
  let free = "";
  try {
    const s = fs.statfsSync(probe);
    free = `, ${((s.bavail * s.bsize) / 1024 ** 3).toFixed(1)} GB free`;
  } catch {
    // statfs is unavailable on some platforms — free space is only informational.
  }
  return { id: "output", ok: true, required: true, detail: `${outDir} is writable${free}` };
}

// ─── helpers ─────────────────────────────────────────────────────────

/** Absolute path of a command found on PATH (for display only). */
function whichSync(bin: string): string | undefined {
  if (path.isAbsolute(bin)) return bin;
  const exts = process.platform === "win32" ? (process.env.PATHEXT ?? ".EXE;.CMD").split(";") : [""];
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const cand = path.join(dir, bin + ext);
      try {
        if (fs.statSync(cand).isFile()) return cand;
      } catch {
        // not in this PATH entry
      }
    }
  }
  return undefined;
}

function firstLine(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.split("\n").find((l) => l.trim())?.trim() ?? msg;
}

function quote(p: string): string {
  return /^[\w@%+=:,./\\-]+$/.test(p) ? p : `"${p}"`;
}
