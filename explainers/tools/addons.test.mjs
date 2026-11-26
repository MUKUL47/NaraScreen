// Tests for the add-on system (figures.js patch, addons.mjs, lint.mjs). Run: node --test explainers/tools/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadAddons, prepareAddons, resolvePlaces, applySet } from './addons.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = join(HERE, 'fixtures');
const EXAMPLES = join(HERE, '../vendor/figures/examples');
const SCENE = join(FIX, 'addon-scene.json');
const FIGURES = createRequire(import.meta.url)(join(HERE, '../vendor/figures/figures.js'));
const read = (f) => JSON.parse(readFileSync(f, 'utf8'));
const tmp = () => mkdtempSync(join(tmpdir(), 'addons-test-'));
const node = (args) => spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 300_000 });
const svgAt = (spec, t) => FIGURES.svg(structuredClone(spec), t); // figures caches on the spec object

// sha256 of every example at the captured times, compared with the hashes taken from the unpatched engine.
function assertGolden() {
  const golden = read(join(FIX, 'golden-svg.json'));
  const keys = Object.keys(golden).filter((k) => !k.startsWith('_'));
  assert.ok(keys.some((k) => k.startsWith('hello@')) && keys.includes('hello@2.5'));
  for (const k of keys) {
    const [name, t] = k.split('@');
    const s = svgAt(read(join(EXAMPLES, `${name}.json`)), Number(t));
    assert.equal(createHash('sha256').update(s).digest('hex'), golden[k].sha256, `${k} differs from the unpatched engine`);
  }
}

test('patched engine renders the examples byte-identical to the unpatched one', () => {
  assertGolden();
});

test('fixture add-on renders: pose, item, looks, expression mark, fx, overlay fx, set', async () => {
  const { spec, addons } = await prepareAddons(read(SCENE), SCENE);
  for (const a of addons) FIGURES.extend(a.addon);
  const s3 = svgAt(spec, 3), s5 = svgAt(spec, 5);
  for (const m of ['item', 'look-head', 'look-body', 'mark', 'fx']) assert.match(s3, new RegExp(`data-fixture="${m}"`), m);
  assert.equal((s3.match(/data-fixture="fx"/g) || []).length, 3, 'scene fx + set back fx + set front fx');
  assert.doesNotMatch(s3, /data-fixture="wash"/, 'overlay fx hidden before its t0');
  assert.match(s5, /data-fixture="wash"/);
  // overlay fx sit outside the camera group: after the actors' group closes, before the front group
  const camOpen = /<g transform="translate\([^"]*\) scale\([^"]*\) translate\([^"]*\)">/g;
  const groups = [...s5.matchAll(camOpen)].map((m) => m.index);
  const wash = s5.indexOf('data-fixture="wash"');
  assert.equal(groups.length, 2);
  assert.ok(wash > groups[0] && wash < groups[1], 'wash is between the camera group and the front group');
  // the add-on pose differs from standing
  const standing = structuredClone(spec); standing.actors[0].keys[0].pose = 'standing';
  assert.notEqual(svgAt(spec, 1), svgAt(standing, 1));
  // with the add-on loaded, built-ins are still byte-identical
  assertGolden();
  // re-extending the same add-on is idempotent; another add-on may not take its names
  FIGURES.extend(addons[0].addon);
  assert.throws(() => FIGURES.extend({ name: 'other', fx: { fixture_box: () => '' } }), /already defined by add-on fixture/);
  assert.throws(() => FIGURES.extend({ name: 'other', poses: { standing: {} } }), /built in/);
});

test('unknown names keep the built-in fallback', async () => {
  const { addons } = await prepareAddons(read(SCENE), SCENE);
  for (const a of addons) FIGURES.extend(a.addon);
  const base = { w: 900, h: 400, actors: [{ label: 'X', look: ['tie'], keys: [{ t: 0, x: 300, y: 302, pose: 'waving', item: 'pen', expr: 'happy' }] }], fx: [{ type: 'sun', x: 700, y: 80 }] };
  const variant = (fn) => { const s = structuredClone(base); fn(s); return s; };
  const k0 = (s) => s.actors[0].keys[0];
  const pairs = [
    [variant((s) => { k0(s).pose = 'no_such_pose'; }), variant((s) => { k0(s).pose = 'standing'; })],
    [variant((s) => { k0(s).item = 'no_such_item'; }), variant((s) => { delete k0(s).item; })],
    [variant((s) => { k0(s).expr = 'no_such_expr'; }), variant((s) => { k0(s).expr = 'neutral'; })],
    [variant((s) => { s.actors[0].look = ['tie', 'no_such_look']; }), base],
    [variant((s) => { s.fx.push({ type: 'no_such_fx', x: 1, y: 1 }); }), base],
  ];
  for (const t of [0.5, 2.25]) for (const [a, b] of pairs) assert.equal(svgAt(a, t), svgAt(b, t));
});

test('@place resolves (feet on the place for actor y) and a miss lists the valid places', async () => {
  const scene = read(SCENE);
  const addons = await loadAddons(SCENE, scene.addons);
  const { spec } = applySet(scene, addons);
  const r = resolvePlaces(spec, addons);
  assert.deepEqual([r.actors[0].keys[0].x, r.actors[0].keys[0].y], [200, 355 - 53]);
  assert.deepEqual([r.fx[0].x, r.fx[0].y], [550, 355], 'set fx "@right-150" with an offset');
  const bad = structuredClone(scene); bad.fx[0].x = '@missing';
  assert.throws(() => resolvePlaces(applySet(bad, addons).spec, addons),
    (e) => /unknown place "@missing" at \$\.fx\[1\]\.x; valid places: left, right/.test(e.message));
  // render.mjs reports it in one line
  const f = join(tmp(), 'bad.json');
  writeFileSync(f, JSON.stringify({ ...bad, addons: [join(FIX, 'fixture-addon')] }));
  const out = node([join(HERE, 'render.mjs'), f, '--map']);
  assert.notEqual(out.status, 0);
  assert.equal(out.stderr.trim().split('\n').length, 1, out.stderr);
  assert.match(out.stderr, /valid places: left, right/);
});

test('add-on validation rejects built-in names', async () => {
  const dir = tmp(), f = join(dir, 'clash.mjs');
  writeFileSync(f, "export default { name: 'clash', looks: { cap: () => '' } };\n");
  await assert.rejects(loadAddons(join(dir, 'scene.json'), ['./clash.mjs']), /look "cap" is a built-in name/);
  await assert.rejects(loadAddons(join(dir, 'scene.json'), ['no-such-addon']), /not found \(looked for .*addons\/no-such-addon\/index\.mjs\)/);
});

test('lint accepts add-on names and rejects a typo with a suggestion', () => {
  const ok = node([join(HERE, 'lint.mjs'), SCENE]);
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  assert.equal(ok.stdout, '');
  const scene = read(SCENE);
  scene.addons = [join(FIX, 'fixture-addon')];
  scene.actors[0].keys[0].pose = 'fixture_salut';
  scene.fx[0].type = 'fixture_bx';
  const f = join(tmp(), 'typo.json'); writeFileSync(f, JSON.stringify(scene));
  const bad = node([join(HERE, 'lint.mjs'), f]);
  assert.equal(bad.status, 1);
  const lines = bad.stdout.trim().split('\n');
  assert.ok(lines.some((l) => l.startsWith('$.actors[0].keys[0].pose: ERROR') && l.includes("did you mean 'fixture_salute'?")), bad.stdout);
  assert.ok(lines.some((l) => l.startsWith('$.fx[0].type: ERROR') && l.includes("did you mean 'fixture_box'?")), bad.stdout);
});

test('lint: engine bubble geometry, unescaped text, unknown place', () => {
  const scene = {
    w: 900, h: 400, duration: 4,
    actors: [{ label: 'A', keys: [{ t: 0, x: 200, y: 302, pose: 'standing' }] }],
    // y is the bubble's bottom: a 56-high bubble at y=60 reaches y=4 (check_spec.py thought it was centred)
    fx: [{ type: 'bubble', x: 600, y: 60, text: 'too high' }, { type: 'text', x: 450, y: 200, text: 'Q&A' }, { type: 'heart', x: '@nowhere', y: 100 }],
  };
  const f = join(tmp(), 'geo.json'); writeFileSync(f, JSON.stringify(scene));
  const r = node([join(HERE, 'lint.mjs'), f]);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /^\$\.fx\[0\]: ERROR bubble 'too high' .*crosses the frame edge/m);
  assert.match(r.stdout, /^\$\.fx\[1\]\.text: ERROR raw "&"/m);
  assert.match(r.stdout, /^\$\.fx\[2\]\.x: ERROR unknown place "@nowhere"/m);
});

// The page path: render.mjs loads the add-on (and its relative import) into Chromium.
// The fixture's overlay fx paints the frame magenta from t=4.
test('render.mjs loads add-ons into the page', () => {
  const dir = tmp();
  const r = node([join(HERE, 'render.mjs'), SCENE, dir + '/', '--stills', '1', '5', '--size', '320x180']);
  assert.equal(r.status, 0, r.stderr);
  const px = (t) => [...execFileSync('ffmpeg', ['-v', 'error', '-i', join(dir, `still-${t}.png`), '-vf', 'crop=1:1:160:90', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'])];
  assert.deepEqual(px('5.00'), [255, 0, 255]);
  assert.notDeepEqual(px('1.00'), [255, 0, 255]);
});
