// Tests for render.mjs. Run: node --test explainers/tools/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const RENDER = join(HERE, 'render.mjs');
const HELLO = join(HERE, 'fixtures', 'hello.json');
const spec = JSON.parse(readFileSync(HELLO, 'utf8'));
const tmp = () => mkdtempSync(join(tmpdir(), 'render-test-'));
const run = (args, env = process.env) =>
  spawnSync(process.execPath, [RENDER, ...args], { encoding: 'utf8', env, timeout: 300_000 });

function probe(file) {
  const out = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height,nb_frames:format=duration', '-of', 'json', file], { encoding: 'utf8' });
  const j = JSON.parse(out);
  return { ...j.streams[0], duration: Number(j.format.duration) };
}

// PNG width/height live at fixed offsets in the IHDR chunk.
const pngSize = (file) => { const b = readFileSync(file); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };

test('renders mp4 with exact duration', () => {
  const out = join(tmp(), 'hello.mp4');
  const r = run([HELLO, out]);
  assert.equal(r.status, 0, r.stderr);
  const p = probe(out);
  assert.equal(p.width, 1920);
  assert.equal(p.height, 1080);
  assert.equal(Number(p.nb_frames), Math.round(spec.duration * 30));
  assert.ok(Math.abs(p.duration - spec.duration) <= 1 / 30, `duration ${p.duration} vs ${spec.duration}`);
});

test('map letterboxes non-16:9', () => {
  const r = run([HELLO, '--map']);
  assert.equal(r.status, 0, r.stderr);
  const m = JSON.parse(r.stdout);
  assert.ok(Math.abs(m.scale - 2.1333) <= 0.001, `scale ${m.scale}`);
  assert.equal(m.offsetX, 0);
  assert.ok(Math.abs(m.offsetY - 113.33) <= 0.5, `offsetY ${m.offsetY}`);
  assert.equal(m.videoW, 1920);
  assert.equal(m.videoH, 1080);
  assert.equal(m.duration, spec.duration);
});

test('map honours --size and --at adds the camera drift', () => {
  const m = JSON.parse(run([HELLO, '--map', '--size', '1280x720']).stdout);
  assert.ok(Math.abs(m.scale - 1280 / 900) <= 0.001);
  const c = JSON.parse(run([HELLO, '--map', '--size', '1280x720', '--at', '9']).stdout);
  assert.equal(c.at, 9);
  assert.ok(c.camera.zoom > 1 && c.camera.zoom < 1.02, `zoom ${c.camera.zoom}`);
  assert.ok(Math.abs(c.scale - m.scale * c.camera.zoom) < 1e-9);
});

test('stills land at requested times', () => {
  const dir = tmp();
  const r = run([HELLO, dir + '/', '--stills', '1.5']);
  assert.equal(r.status, 0, r.stderr);
  const f = join(dir, 'still-1.50.png');
  assert.ok(existsSync(f), 'still-1.50.png missing');
  assert.deepEqual(pngSize(f), [1920, 1080]);
});

test('missing ffmpeg fails cleanly', () => {
  const r = run([HELLO, join(tmp(), 'x.mp4')], { ...process.env, PATH: '/nonexistent' });
  assert.notEqual(r.status, 0);
  const lines = r.stderr.trim().split('\n');
  assert.equal(lines.length, 1, r.stderr);
  assert.match(lines[0], /ffmpeg/);
});

test('missing playwright fails cleanly', () => {
  const r = run([HELLO, tmp() + '/', '--stills', '1'], { ...process.env, FIGURES_PLAYWRIGHT: '/nonexistent/playwright' });
  assert.notEqual(r.status, 0);
  const lines = r.stderr.trim().split('\n');
  assert.equal(lines.length, 1, r.stderr);
  assert.match(lines[0], /[Pp]laywright.*\/nonexistent\/playwright/);
});

test('scene without duration is rejected in one line', () => {
  const dir = tmp(), f = join(dir, 'nodur.json');
  writeFileSync(f, JSON.stringify({ ...spec, duration: undefined }));
  const r = run([f, join(dir, 'x.mp4')]);
  assert.notEqual(r.status, 0);
  assert.equal(r.stderr.trim().split('\n').length, 1, r.stderr);
  assert.match(r.stderr, /duration/);
});
