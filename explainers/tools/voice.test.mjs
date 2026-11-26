// Tests for voice.mjs and make.mjs. Run: node --test explainers/tools/voice.test.mjs
// A fake engine (a sine tone of a known length) stands in for Kokoro; one integration test runs
// against Kokoro only when it answers at localhost:8880.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  resolveEngine, planLines, synthesizeLines, estimateLines, checkTiming, injectBubbles, VoiceError, xmlEscape,
} from './voice.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const MAKE = join(HERE, 'make.mjs');
const tmp = () => mkdtempSync(join(tmpdir(), 'voice-test-'));

// Fake engine: duration = options.durations[text] ?? 0.08 s per character; counts calls in options.counter.
const FAKE = `
import { writeFileSync, appendFileSync } from 'node:fs';
export default {
  name: 'fake',
  languages: (o) => o.languages || ['en', 'hi', 'mr', 'gu'],
  voices: () => ['v1', 'v2'],
  async check() { return { ok: true, detail: 'fake' }; },
  async synthesize({ text, voice, lang, speed, options }, out) {
    if (options.counter) appendFileSync(options.counter, text + '\\n');
    const d = options.durations?.[text] ?? text.length * 0.08, rate = 24000, n = Math.round(d * rate);
    const b = Buffer.alloc(44 + n * 2);
    b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVE', 8); b.write('fmt ', 12);
    b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24);
    b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
    for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(12000 * Math.sin(2 * Math.PI * 440 * i / rate)), 44 + i * 2);
    writeFileSync(out, b);
    return { durationSec: n / rate };
  },
};`;

function setup(extra = {}) {
  const dir = tmp();
  writeFileSync(join(dir, 'fake-engine.mjs'), FAKE);
  const counter = join(dir, 'calls.txt');
  const spec = {
    w: 320, h: 180, ground: 160, labelFs: 12, duration: 3,
    actors: [{ label: 'ANA', s: 1, keys: [{ t: 0, x: 100, y: 107, pose: 'standing', face: 1 }, { t: 2, x: 200, move: 'walk' }] }],
    voice: { engine: './fake-engine.mjs', lang: 'en', voices: { narrator: 'v1', ANA: { en: 'v2', hi: 'v2', gu: 'v2', mr: 'v2' } },
      options: { counter, durations: { 'Hello.': 0.6, 'Bye now.': 0.7 } } },
    lines: [
      { t: 0.5, who: 'narrator', text: 'Hello.' },
      { t: 1.8, who: 'ANA', text: 'Bye now.', bubble: true },
    ],
    ...extra,
  };
  const scene = join(dir, 'scene.json');
  writeFileSync(scene, JSON.stringify(spec));
  return { dir, spec, scene, counter, cache: join(dir, 'cache') };
}
const calls = (f) => (existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).length : 0);
const throwsVoice = (fn, re) => assert.throws(fn, (e) => e instanceof VoiceError && re.test(e.line), 'expected a VoiceError matching ' + re);
const rejectsVoice = (p, re) => assert.rejects(p, (e) => e instanceof VoiceError && re.test(e.line));
const make = (args, env = {}) => spawnSync(process.execPath, [MAKE, ...args], { encoding: 'utf8', env: { ...process.env, ...env }, timeout: 300_000 });

async function synth(s, opts = {}) {
  const plan = planLines(s.spec, opts);
  const engine = await resolveEngine(plan.engineRef, s.scene);
  return { plan, lines: await synthesizeLines(plan, engine, { cacheDir: s.cache }) };
}

test('engine resolves by bare name and by path', async () => {
  const s = setup();
  const k = await resolveEngine('kokoro', s.scene);
  assert.equal(k.name, 'kokoro');
  assert.deepEqual(k.languages, ['en', 'hi']);
  const o = await resolveEngine('openai-compatible', s.scene);
  assert.equal(o.name, 'openai-compatible');
  const f = await resolveEngine('./fake-engine.mjs', s.scene);
  assert.equal(f.name, 'fake');
  assert.equal(f.file, join(s.dir, 'fake-engine.mjs'));
  await rejectsVoice(resolveEngine('nope', s.scene), /voice engine "nope" not found.*hint: built-in engines are kokoro/);
});

test('cache is hit on the second run', async () => {
  const s = setup();
  const a = await synth(s);
  assert.equal(calls(s.counter), 2);
  assert.deepEqual(a.lines.map((l) => l.cached), [false, false]);
  assert.ok(Math.abs(a.lines[0].durationSec - 0.6) < 1e-3);
  const b = await synth(s);
  assert.equal(calls(s.counter), 2, 'no new engine calls');
  assert.deepEqual(b.lines.map((l) => l.cached), [true, true]);
  assert.equal(b.lines[1].durationSec, a.lines[1].durationSec);
  // a different speed is a different cache entry
  s.spec.lines[0].speed = 1.2;
  await synth(s);
  assert.equal(calls(s.counter), 3);
});

test('bubble injected for the actor line with t1 = t + duration + pad, text escaped', async () => {
  const s = setup();
  s.spec.lines[1].text = 'Bye now.';
  const { lines } = await synth(s);
  const out = injectBubbles(s.spec, lines, { pad: 0.4 });
  const bubbles = out.fx.filter((f) => f.type === 'bubble');
  assert.equal(bubbles.length, 1, 'narrator line is voice only');
  const b = bubbles[0];
  assert.equal(b.t0, 1.8);
  assert.ok(Math.abs(b.t1 - (1.8 + 0.7 + 0.4)) < 0.011, `t1 ${b.t1}`);
  // ANA walks from x=100 (t=0) to 200 (t=2): at 1.8 she is at x=190 facing right, too near the right
  // edge for the bubble, so it flips to her left with the tail pointing back at her
  assert.ok(b.x < 190 && b.x - b.w / 2 >= 20 && b.x + b.w / 2 <= 300, `x ${b.x} w ${b.w}`);
  assert.ok(b.y < 107 && b.y - b.h >= 0, `y ${b.y}`); // tiny frame: clamped to stay inside
  assert.equal(b.tail, -1);
  // earlier, at x≈120, there is room on the side she faces
  const early = injectBubbles(s.spec, [{ ...lines[1], t: 0.4 }]).fx.at(-1);
  assert.ok(early.x > 130 && early.tail === 1, `early x ${early.x}`);
  assert.equal(xmlEscape('Tom & <Jerry>'), 'Tom &amp; &lt;Jerry&gt;');
  const esc = injectBubbles(s.spec, [{ ...lines[1], text: 'A & B <c>' }]).fx.at(-1);
  assert.equal(esc.text, 'A &amp; B &lt;c&gt;');
  // a placed bubble keeps its fields
  const placed = injectBubbles(s.spec, [{ ...lines[1], bubble: { x: 50, y: 40, tail: -1 } }]).fx.at(-1);
  assert.deepEqual([placed.x, placed.y, placed.tail], [50, 40, -1]);
});

test('overlap with the next line from the same speaker is an error with the measured length', async () => {
  const s = setup();
  s.spec.lines = [{ t: 0.5, who: 'ANA', text: 'Hello.' }, { t: 0.9, who: 'ANA', text: 'Bye now.' }];
  const { plan, lines } = await synth(s);
  throwsVoice(() => checkTiming(lines, plan), /lines\[0\] \(ANA, t=0.5\) overlaps lines\[1\] \(t=0.9\).*hint: measured 0.6 s.*t ≥ 1.3/);
  // a different speaker may overlap: only a warning
  s.spec.lines[1].who = 'narrator';
  const w = checkTiming((await synth(s)).lines, plan);
  assert.equal(w.length, 1);
});

test('a line past the end of the scene is an error', async () => {
  const s = setup();
  s.spec.lines = [{ t: 2.6, who: 'ANA', text: 'Bye now.' }];
  const { plan, lines } = await synth(s);
  throwsVoice(() => checkTiming(lines, plan), /runs to 3.3 s, past the scene end 3 s.*measured 0.7 s/);
  s.spec.lines = [{ t: 3.5, who: 'ANA', text: 'x' }];
  throwsVoice(() => planLines(s.spec), /outside the scene/);
  s.spec.lines = [{ t: 1, who: 'BOB', text: 'x' }];
  throwsVoice(() => planLines(s.spec), /unknown who "BOB".*ANA/);
});

test('a missing language falls back to en, and fails with no en', () => {
  const s = setup();
  s.spec.lines = [{ t: 0.5, who: 'ANA', text: { en: 'Hello.', hi: 'नमस्ते।' } }, { t: 1.5, who: 'ANA', text: { en: 'Bye now.' } }];
  const p = planLines(s.spec, { lang: 'hi' });
  assert.deepEqual(p.lines.map((l) => [l.lang, l.text]), [['hi', 'नमस्ते।'], ['en', 'Bye now.']]);
  assert.equal(p.warnings.length, 1);
  s.spec.lines = [{ t: 0.5, who: 'ANA', text: { hi: 'नमस्ते।' } }];
  throwsVoice(() => planLines(s.spec, { lang: 'gu' }), /has no "gu" text and no "en" fallback \(has: hi\)/);
  throwsVoice(() => planLines(s.spec, { lang: 'fr' }), /unknown language "fr"/);
});

test('a language the engine cannot speak fails before anything is synthesised', async () => {
  const s = setup();
  s.spec.voice.options.languages = ['en', 'hi'];
  s.spec.lines = [{ t: 0.5, who: 'ANA', text: { en: 'Hello.', gu: 'કેમ છો?' } }];
  await rejectsVoice(synth(s, { lang: 'gu' }), /cannot speak Gujarati \("gu"\).*hint: set voice.engine to an engine that supports "gu"/);
  assert.equal(calls(s.counter), 0);
  // kokoro: Hindi with an English voice is refused by check(), before any HTTP synthesis
  const k = await resolveEngine('kokoro');
  const c = await k.check({}, { voices: [{ voice: 'af_heart', lang: 'hi' }] });
  assert.equal(c.ok, false);
  assert.match(c.detail, /does not match language hi/);
});

test('make: mixed audio matches the video length and lines start at their t', () => {
  const s = setup();
  const out = join(s.dir, 'out.mp4');
  const r = make([s.scene, out, '--size', '320x180', '--fps', '10', '--workers', '1'], { EXPLAINERS_VOICE_CACHE: s.cache });
  assert.equal(r.status, 0, r.stderr);
  const p = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name,duration', '-of', 'json', out], { encoding: 'utf8' }));
  const v = p.streams.find((x) => x.codec_type === 'video'), a = p.streams.find((x) => x.codec_type === 'audio');
  assert.equal(a.codec_name, 'aac');
  assert.equal(v.codec_name, 'h264');
  assert.ok(Math.abs(Number(a.duration) - Number(v.duration)) < 0.05, `audio ${a.duration} vs video ${v.duration}`);
  // silence ends where each tone starts (0.5, 1.8) and starts where it ends (1.1, 2.5)
  const det = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', out, '-af', 'silencedetect=n=-45dB:d=0.1', '-f', 'null', '-'], { encoding: 'utf8' }).stderr;
  const ends = [...det.matchAll(/silence_end: ([\d.]+)/g)].map((m) => Number(m[1]));
  const starts = [...det.matchAll(/silence_start: ([\d.]+)/g)].map((m) => Number(m[1]));
  const near = (xs, x) => xs.some((y) => Math.abs(y - x) < 0.05);
  assert.ok(near(ends, 0.5) && near(ends, 1.8), `silence_end ${ends}`);
  assert.ok(near(starts, 1.1) && near(starts, 2.5), `silence_start ${starts}`);
});

test('make --no-voice: no audio stream and no engine call', () => {
  const s = setup();
  const out = join(s.dir, 'silent.mp4');
  const r = make([s.scene, out, '--no-voice', '--size', '320x180', '--fps', '10', '--workers', '1'], { EXPLAINERS_VOICE_CACHE: s.cache });
  assert.equal(r.status, 0, r.stderr);
  const types = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', out], { encoding: 'utf8' }).trim().split('\n');
  assert.deepEqual(types, ['video']);
  assert.equal(calls(s.counter), 0);
});

test('make: errors are one line with a hint and exit 1', () => {
  const s = setup();
  s.spec.lines.push({ t: 2.0, who: 'ANA', text: 'Bye now.' });
  writeFileSync(s.scene, JSON.stringify(s.spec));
  const r = make([s.scene, join(s.dir, 'x.mp4')], { EXPLAINERS_VOICE_CACHE: s.cache });
  assert.equal(r.status, 1);
  const errLines = r.stderr.trim().split('\n').filter((l) => l.startsWith('make.mjs:'));
  assert.equal(errLines.length, 1, r.stderr);
  assert.match(errLines[0], /^make\.mjs: lines\[1\] \(ANA, t=1.8\) overlaps lines\[2\].*\(hint: measured 0.7 s/);
});

test('make --stills: Gujarati and Marathi bubbles render with --no-voice', () => {
  const s = setup();
  s.spec.w = 900; s.spec.h = 400; s.spec.ground = 355; s.spec.labelFs = 18;
  s.spec.actors = [
    { label: 'ANA', s: 1.3, keys: [{ t: 0, x: 220, y: 286, pose: 'standing', face: 1 }] },
    { label: 'RAJ', s: 1.3, keys: [{ t: 0, x: 680, y: 286, pose: 'standing', face: -1 }] },
  ];
  s.spec.lines = [
    { t: 0.5, who: 'ANA', text: { en: 'How are you?', gu: 'તમે કેમ છો?', mr: 'तुम्ही कसे आहात?' } },
    { t: 0.5, who: 'RAJ', text: { en: 'All good.', gu: 'હું મજામાં છું.', mr: 'मी मजेत आहे.' } },
  ];
  writeFileSync(s.scene, JSON.stringify(s.spec));
  for (const lang of ['gu', 'mr']) {
    const dir = join(s.dir, `stills-${lang}`);
    const r = make([s.scene, dir + '/', '--no-voice', '--lang', lang, '--stills', '1.0', '--size', '960x540'], { EXPLAINERS_VOICE_CACHE: s.cache });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(readdirSync(dir), ['still-1.00.png']);
    if (process.env.KEEP_STILLS) execFileSync('cp', [join(dir, 'still-1.00.png'), join(process.env.KEEP_STILLS, `indic-${lang}.png`)]);
  }
});

const kokoroUp = await fetch('http://localhost:8880/v1/audio/voices', { signal: AbortSignal.timeout(1000) }).then((r) => r.ok).catch(() => false);
test('kokoro integration (en + hi)', { skip: kokoroUp ? false : 'Kokoro not reachable at localhost:8880' }, async () => {
  const s = setup();
  s.spec.voice = { engine: 'kokoro', voices: { narrator: { en: 'af_heart', hi: 'hf_alpha' }, ANA: { en: 'am_michael', hi: 'hm_omega' } } };
  s.spec.duration = 10;
  s.spec.lines = [{ t: 0.5, who: 'narrator', text: { en: 'Stop at the kerb.', hi: 'किनारे पर रुकें।' } }];
  for (const lang of ['en', 'hi']) {
    const { lines } = await synth(s, { lang });
    assert.ok(lines[0].durationSec > 0.5 && lines[0].durationSec < 5, `${lang} ${lines[0].durationSec}`);
    const p = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', lines[0].wav], { encoding: 'utf8' }));
    assert.ok(Math.abs(Number(p.format.duration) - lines[0].durationSec) < 0.02);
  }
  s.spec.voice.voices.narrator.hi = 'af_heart';
  await rejectsVoice(synth(s, { lang: 'hi' }), /does not match language hi/);
});
