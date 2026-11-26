#!/usr/bin/env node
// Render a figures scene (explainers/vendor/figures) to MP4 or PNG stills, using the Playwright +
// Chromium that NaraScreen's editor already ships, and ffmpeg from PATH. Nothing new to install.
//
//   node render.mjs <scene.json> <out.mp4> [--size 1920x1080] [--fps 30] [--bg #FFFFFF] [--workers 4]
//     --workers N: N headless Chromiums render frames in parallel (4 ≈ 1 min per 30 s of 1080p30)
//   node render.mjs <scene.json> <outdir/> --stills 1.5 4.0 [--size ...] [--bg ...]
//   node render.mjs <scene.json> --map [--size ...] [--at <t>]
//
// Times (frames, --stills, --at) are video seconds: video time 0 is the scene's `start`.
// Frame i is drawn at scene time start + i / fps; the video has round(duration * fps) frames.
// A scene whose w x h differs from the output aspect is letterboxed, centred on --bg, never stretched.
// --map prints how scene units become output-video pixels: px = unit * scale + offset.
// With --at it folds in figures' camera drift at that moment (actors and non-overlay fx are inside
// the camera; tint/night/snow and the frame border are not, so use the plain --map for those).
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync, accessSync, constants } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve, delimiter } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { prepareAddons, pageSetup } from './addons.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIGURES_JS = resolve(HERE, '../vendor/figures/figures.js');
const PLAYWRIGHT_DIR = process.env.FIGURES_PLAYWRIGHT || resolve(HERE, '../../editor/node_modules/playwright');

class Fail extends Error {}
const fail = (msg) => { throw new Fail(msg); };

// ---------- arguments ----------
function parseArgs(argv) {
  const o = { pos: [], size: '1920x1080', fps: 30, bg: '#FFFFFF', workers: 4, stills: null, map: false, at: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], val = () => argv[++i] ?? fail(`${a} needs a value`);
    if (a === '--size') o.size = val();
    else if (a === '--fps') o.fps = Number(val());
    else if (a === '--bg') o.bg = val();
    else if (a === '--workers') o.workers = Number(val());
    else if (a === '--map') o.map = true;
    else if (a === '--at') o.at = Number(val());
    else if (a === '--stills') { o.stills = []; while (i + 1 < argv.length && /^-?\d*\.?\d+$/.test(argv[i + 1])) o.stills.push(Number(argv[++i])); }
    else if (a.startsWith('--')) fail(`unknown option ${a}`);
    else o.pos.push(a);
  }
  const m = /^(\d+)x(\d+)$/.exec(o.size) || fail(`--size must look like 1920x1080, got ${o.size}`);
  o.W = Number(m[1]); o.H = Number(m[2]);
  if (o.W % 2 || o.H % 2) fail('--size width and height must be even (H.264 yuv420p)');
  if (!(o.fps > 0)) fail('--fps must be a positive number');
  if (!(o.workers >= 1)) fail('--workers must be at least 1');
  if (o.at !== null && !Number.isFinite(o.at)) fail('--at needs a number of seconds');
  if (o.stills && !o.stills.length) fail('--stills needs at least one time in seconds');
  if (!o.pos[0]) fail('usage: render.mjs <scene.json> (<out.mp4> | <outdir/> --stills t... | --map)');
  if (!o.map && !o.pos[1]) fail('missing output path (out.mp4, or a folder with --stills)');
  return o;
}

function loadSpec(file) {
  let text;
  try { text = readFileSync(file, 'utf8'); } catch { fail(`cannot read scene ${file}`); }
  try { return JSON.parse(text); } catch (e) { fail(`scene ${file} is not valid JSON: ${e.message}`); }
}

// ---------- geometry ----------
// Letterbox the scene's viewBox inside the video, centred: the same box the page uses to draw.
function sceneMap(spec, W, H) {
  const w = spec.w || 900, h = spec.h || 400, scale = Math.min(W / w, H / h);
  return { scale, offsetX: (W - w * scale) / 2, offsetY: (H - h * scale) / 2, videoW: W, videoH: H, duration: spec.duration ?? null };
}
// ---------- scene preparation ----------
// The single place where a scene is turned into what gets drawn. Returns:
//   spec         the spec to draw: the scene's "set" expanded and "@place" references resolved
//   pageScripts  extra scripts injected after figures.js and before the first frame,
//                each a Playwright addScriptTag option ({ path } or { content })
//   setupPage    null, or async (page) run after pageScripts: loads the scene's add-ons into the page
//   setupEngine  called with the Node copy of FIGURES before --map --at reads the camera
// Render, stills and --map all go through it. Add-ons: explainers/addons/README.md.
async function prepareScene(spec, scenePath) {
  let prepared;
  try { prepared = await prepareAddons(spec, scenePath); } catch (e) { fail(e.message); }
  const { addons } = prepared;
  return {
    spec: prepared.spec,
    pageScripts: [],
    setupPage: pageSetup(addons),
    setupEngine: (FIGURES) => { for (const a of addons) FIGURES.extend(a.addon); },
  };
}

// figures wraps actors and most fx in translate(W/2 cy) scale(z) translate(-cx -cy). Read it from the
// engine's own output so the numbers are exactly what gets drawn.
function cameraAt(scene, t) {
  const FIGURES = createRequire(import.meta.url)(FIGURES_JS);
  scene.setupEngine(FIGURES);
  const svg = FIGURES.svg(structuredClone(scene.spec), t); // figures caches on the spec; keep ours clean
  const m = /<g transform="translate\(([-\d.]+) ([-\d.]+)\) scale\(([-\d.]+)\) translate\(([-\d.]+) ([-\d.]+)\)">/.exec(svg)
    || fail('could not find the camera transform in figures output');
  const [tx, ty, zoom, ncx, ncy] = m.slice(1).map(Number);
  return { zoom, cx: -ncx, cy: -ncy, tx, ty };
}

function mapAt(base, cam, at) {
  // unit -> camera: (u - c) * z + T ; camera -> video: * scale + offset
  const { scale, offsetX, offsetY } = base, z = cam.zoom;
  return { ...base, at, scale: scale * z, offsetX: offsetX + scale * (cam.tx - cam.cx * z), offsetY: offsetY + scale * (cam.ty - cam.cy * z), camera: cam };
}

// ---------- dependencies ----------
function findFfmpeg() {
  const dirs = (process.env.PATH || '').split(delimiter).filter(Boolean);
  for (const d of dirs) {
    const p = join(d, 'ffmpeg');
    try { accessSync(p, constants.X_OK); if (statSync(p).isFile()) return p; } catch {}
  }
  fail(`ffmpeg not found on PATH (looked in: ${dirs.join(delimiter) || 'empty PATH'}); expected /usr/bin/ffmpeg`);
}

async function loadChromium() {
  const entry = join(PLAYWRIGHT_DIR, 'index.mjs');
  if (!existsSync(entry)) fail(`Playwright not found at ${PLAYWRIGHT_DIR} (set FIGURES_PLAYWRIGHT or run npm install in editor/)`);
  return (await import(pathToFileURL(entry).href)).chromium;
}

// One browser per worker: pages sharing a browser screenshot one at a time, and concurrent
// screenshots across browsers fail ("Unable to capture screenshot") unless the GPU is off.
async function launchBrowsers(n) {
  const chromium = await loadChromium();
  const all = await Promise.allSettled(Array.from({ length: n }, () => chromium.launch({ args: ['--disable-gpu'] })));
  const bad = all.find((r) => r.status === 'rejected');
  if (bad) {
    await Promise.all(all.filter((r) => r.status === 'fulfilled').map((r) => r.value.close()));
    fail(`Chromium for Playwright failed to launch (browsers live in ~/.cache/ms-playwright): ${String(bad.reason?.message).split('\n')[0]}`);
  }
  return all.map((r) => r.value);
}

// ---------- drawing ----------
// One page = one viewport at the output size, a --bg body and a div at the letterbox box.
async function openPage(browser, scene, map, bg) {
  const page = await browser.newPage({ viewport: { width: map.videoW, height: map.videoH } });
  const { spec } = scene;
  const box = `left:${map.offsetX}px;top:${map.offsetY}px;width:${(spec.w || 900) * map.scale}px;height:${(spec.h || 400) * map.scale}px`;
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;width:100%;height:100%;overflow:hidden;background:${bg}}
    #v{position:absolute;${box}} #v>svg{width:100%;height:100%;display:block}</style></head>
    <body><div id="v"></div></body></html>`);
  await page.addScriptTag({ path: FIGURES_JS });
  for (const s of scene.pageScripts) await page.addScriptTag(s);
  if (scene.setupPage) {
    try { await scene.setupPage(page); } catch (e) { fail(String(e?.message || e).split('\n')[0]); }
  }
  await page.evaluate((s) => {
    window.SPEC = s;
    window.draw = (t) => {
      const v = document.getElementById('v');
      v.innerHTML = FIGURES.svg(window.SPEC, t);
      v.firstChild.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    };
  }, spec);
  return page;
}

// Headless Chromium now and then refuses a capture under load ("Unable to capture screenshot");
// frames are pure functions of t, so drawing again and retrying is safe.
async function frameAt(page, t) {
  for (let attempt = 1; ; attempt++) {
    await page.evaluate((x) => window.draw(x), t);
    try { return await page.screenshot({ type: 'png' }); }
    catch (e) {
      if (attempt >= 4 || !/Unable to capture screenshot/.test(e.message)) throw e;
      await new Promise((r) => setTimeout(r, 50 * attempt));
    }
  }
}

const closeAll = (browsers) => Promise.all(browsers.map((b) => b.close().catch(() => {})));

async function renderStills(scene, map, opts, outDir) {
  mkdirSync(outDir, { recursive: true });
  const [browser] = await launchBrowsers(1);
  try {
    const page = await openPage(browser, scene, map, opts.bg);
    const files = [];
    for (const t of opts.stills) {
      const f = join(outDir, `still-${t.toFixed(2)}.png`);
      writeFileSync(f, await frameAt(page, (scene.spec.start || 0) + t));
      files.push(f);
    }
    return { stills: files };
  } finally { await closeAll([browser]); }
}

async function renderVideo(scene, map, opts, out) {
  const { spec } = scene;
  if (!(spec.duration > 0)) fail('scene has no positive "duration" (seconds); add one to the scene JSON');
  const ffmpeg = findFfmpeg();
  const n = Math.round(spec.duration * opts.fps), start = spec.start || 0, K = Math.min(opts.workers, n), t0 = Date.now();
  mkdirSync(dirname(resolve(out)), { recursive: true });
  const browsers = await launchBrowsers(K);
  const enc = spawn(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'image2pipe', '-framerate', String(opts.fps), '-c:v', 'png', '-i', '-',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p',
    '-r', String(opts.fps), '-movflags', '+faststart', out], { stdio: ['pipe', 'ignore', 'pipe'] });
  let encErr = '';
  enc.stderr.on('data', (d) => { encErr += d; });
  const encDone = new Promise((res) => enc.on('close', res));
  enc.stdin.on('error', () => {}); // reported through ffmpeg's exit code below

  try {
    // Workers pull the next frame number; the writer feeds ffmpeg strictly in frame order.
    const pending = new Map(), waiters = [];
    let next = 0, written = 0, writing = Promise.resolve();
    const flush = async () => {
      while (pending.has(written)) {
        const buf = pending.get(written); pending.delete(written); written++;
        if (!enc.stdin.write(buf)) await new Promise((r) => enc.stdin.once('drain', r));
      }
      waiters.splice(0).forEach((r) => r());
    };
    const worker = async (browser) => {
      const page = await openPage(browser, scene, map, opts.bg);
      for (let i; (i = next++) < n;) {
        pending.set(i, await frameAt(page, start + i / opts.fps));
        writing = writing.then(flush);
        while (pending.size > K * 4) await new Promise((r) => waiters.push(r)); // bound memory if one worker lags
      }
    };
    await Promise.all(browsers.map(worker));
    await writing;
    enc.stdin.end();
  } catch (e) { enc.kill(); throw e; }
  finally { await closeAll(browsers); }
  const code = await encDone;
  if (code !== 0) fail(`ffmpeg failed (exit ${code}): ${encErr.trim().split('\n').pop() || 'no message'}`);
  return { out, frames: n, fps: opts.fps, workers: K, seconds: Math.round((Date.now() - t0) / 100) / 10 };
}

// ---------- main ----------
async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const scene = await prepareScene(loadSpec(opts.pos[0]), resolve(opts.pos[0]));
  const map = sceneMap(scene.spec, opts.W, opts.H);
  let result;
  if (opts.map) result = opts.at === null ? map : mapAt(map, cameraAt(scene, (scene.spec.start || 0) + opts.at), opts.at);
  else if (opts.stills) result = await renderStills(scene, map, opts, opts.pos[1]);
  else result = await renderVideo(scene, map, opts, opts.pos[1]);
  process.stdout.write(JSON.stringify(result) + '\n');
}

main().catch((e) => {
  const msg = e instanceof Fail ? e.message : String(e?.message || e).split('\n')[0];
  process.stderr.write(`render.mjs: ${msg}\n`);
  process.exit(1);
});
