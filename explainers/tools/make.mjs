#!/usr/bin/env node
// One JSON in, a voiced MP4 out: a figures scene plus its "voice" and "lines".
//
//   node make.mjs <scene.json> <out.mp4> [--lang hi] [--no-voice] [--pad 0.4] [--cache <dir>]
//                 [--size 1920x1080] [--fps 30] [--bg #FFFFFF] [--workers 4]
//   node make.mjs <scene.json> <outdir/> --stills 4.2 9.0 [--lang hi] [--no-voice] ...
//
//   1. synthesise every line (cached in explainers/.voice-cache/ by engine, voice, lang, speed, text)
//   2. measure each one and check the timing (same-speaker overlap, past the end)
//   3. inject bubble fx with the real durations
//   4. render frames through render.mjs, unchanged, as a subprocess
//   5. mix the lines at their t into one loudness-normalised track
//   6. mux it into the MP4: video stream copied, audio AAC
//
// --no-voice: no engine call and no audio stream; bubbles still appear, timed by the cached
//   measurement when there is one, else by an estimate from the text length.
// --stills: same bubbles, PNG stills through render.mjs --stills (no audio).
// Errors are one line on stderr ("make.mjs: <problem> (hint: ...)") with exit code 1.
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  VoiceError, DEFAULT_CACHE, planLines, resolveEngine, synthesizeLines, estimateLines, checkTiming,
  injectBubbles, sceneForRender, geometrySpec, mixTrack, mux, probe,
} from './voice.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const RENDER = join(HERE, 'render.mjs');
const fail = (m, h) => { throw new VoiceError(m, h); };
const log = (s) => process.stderr.write(s + '\n');

function parseArgs(argv) {
  const o = { pos: [], lang: null, noVoice: false, pad: 0.4, cache: process.env.EXPLAINERS_VOICE_CACHE || DEFAULT_CACHE, pass: [], stills: null, fps: 30 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], val = () => argv[++i] ?? fail(`${a} needs a value`);
    if (a === '--lang') o.lang = val();
    else if (a === '--no-voice') o.noVoice = true;
    else if (a === '--pad') o.pad = Number(val());
    else if (a === '--cache') o.cache = resolve(val());
    else if (['--size', '--bg', '--workers'].includes(a)) o.pass.push(a, val());
    else if (a === '--fps') { o.fps = Number(val()); o.pass.push(a, String(o.fps)); }
    else if (a === '--stills') { o.stills = []; while (i + 1 < argv.length && /^-?\d*\.?\d+$/.test(argv[i + 1])) o.stills.push(argv[++i]); }
    else if (a.startsWith('--')) fail(`unknown option ${a}`, 'options: --lang, --no-voice, --pad, --cache, --stills, --size, --fps, --bg, --workers');
    else o.pos.push(a);
  }
  if (o.pos.length < 2) fail('usage: make.mjs <scene.json> <out.mp4> [--lang hi] [--no-voice]', 'or <scene.json> <outdir/> --stills t...');
  if (!(o.pad >= 0)) fail('--pad must be a number of seconds ≥ 0');
  if (!(o.fps > 0)) fail('--fps must be a positive number');
  if (o.stills && !o.stills.length) fail('--stills needs at least one time in seconds');
  return o;
}

function renderMjs(args) {
  return new Promise((res, rej) => {
    const p = spawn(process.execPath, [RENDER, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('close', (code) => {
      if (code === 0) return res(out.trim() ? JSON.parse(out.trim().split('\n').pop()) : {});
      rej(new VoiceError((err.trim().split('\n').pop() || `render.mjs exited ${code}`).replace(/^render\.mjs: /, 'render: ')));
    });
  });
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const scenePath = resolve(o.pos[0]), out = resolve(o.pos[1]);
  let spec;
  try { spec = JSON.parse(readFileSync(scenePath, 'utf8')); }
  catch (e) { fail(`cannot read scene ${o.pos[0]}: ${e.message.split('\n')[0]}`); }
  if (!(spec.duration > 0)) fail('scene has no positive "duration" (seconds)');

  const plan = planLines(spec, { lang: o.lang, noVoice: o.noVoice });
  plan.warnings.forEach((w) => log(`make.mjs: warning: ${w}`));
  let lines;
  if (o.noVoice || o.stills) {
    lines = estimateLines(plan, { cacheDir: o.cache });
  } else {
    const engine = await resolveEngine(plan.engineRef, scenePath);
    lines = await synthesizeLines(plan, engine, { cacheDir: o.cache, log });
  }
  checkTiming(lines, plan).forEach((w) => log(`make.mjs: warning: ${w}`));
  if (lines.length) {
    log(`voice: ${lines.length} lines, lang ${plan.lang}, engine ${o.noVoice ? 'none (--no-voice)' : plan.engineRef}`);
    for (const L of lines) log(`  t=${L.t.toFixed(2)}–${(L.t + L.durationSec).toFixed(2)}  ${L.who.padEnd(9)} ${L.durationSec.toFixed(2)} s${L.cached ? ' (cached)' : L.estimated ? ' (estimated)' : ''}  ${L.text}`);
  }

  const geo = await geometrySpec(spec, scenePath);
  const scene = sceneForRender(injectBubbles(spec, lines, { pad: o.pad }, geo), scenePath);

  const tmp = mkdtempSync(join(tmpdir(), 'explainers-make-'));
  try {
    const tmpScene = join(tmp, 'scene.json');
    writeFileSync(tmpScene, JSON.stringify(scene));
    if (o.stills) {
      const r = await renderMjs([tmpScene, out, '--stills', ...o.stills, ...o.pass]);
      process.stdout.write(JSON.stringify({ ...r, lines: lines.length }) + '\n');
      return;
    }
    if (o.noVoice) {
      const r = await renderMjs([tmpScene, out, ...o.pass]);
      process.stdout.write(JSON.stringify({ ...r, audio: false, lines: lines.length }) + '\n');
      return;
    }
    const video = join(tmp, 'video.mp4');
    const r = await renderMjs([tmpScene, video, ...o.pass]);
    const frames = r.frames ?? Math.round(spec.duration * o.fps);
    const duration = frames / (r.fps ?? o.fps);
    const wav = await mixTrack(lines, { start: plan.start, duration }, join(tmp, 'voice.wav'), { tmpDir: tmp });
    await mux(video, wav, out);
    const p = await probe(out);
    process.stdout.write(JSON.stringify({ out, frames, duration, lang: plan.lang, lines: lines.length,
      synthesised: lines.filter((l) => !l.cached).length, streams: p.streams.map((s) => s.codec_name) }) + '\n');
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}

main().catch((e) => {
  const msg = e instanceof VoiceError ? e.line : String(e?.message || e).split('\n')[0];
  process.stderr.write(`make.mjs: ${msg}\n`);
  process.exit(1);
});
