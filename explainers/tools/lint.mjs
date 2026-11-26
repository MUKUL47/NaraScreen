#!/usr/bin/env node
// Static linter for figures scenes, add-on aware. A port of vendor/figures/check_spec.py (same checks,
// same thresholds) plus:
//   - the scene's add-on vocabulary (poses, expressions, items, looks, fx, sets), with typo suggestions;
//   - "set" and "@place" references (a miss lists the valid places);
//   - bubble/thought boxes measured the way the engine draws them (y is the bottom-centre of the box,
//     not its centre as check_spec.py assumes; defaults 170 x 56; follows "k" keys and "s");
//   - raw "&" or "<" in text fields (figures inserts text into the SVG unescaped);
//   - looks given on keys as well as on the actor, and look lists that are not arrays.
//
//   node lint.mjs <scene.json> [more.json ...] [--strict]
// One line per problem: "<JSON path>: ERROR|WARN <message>" (prefixed with the file when several are
// given). A summary goes to stderr. Exit 0 when there are no errors (and, with --strict, no warnings).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadAddons, vocabulary, applySet, substitutePlaces, missMessage, placesFor } from './addons.mjs';

const SEATED = new Set(['sitting', 'sit_write', 'sit_think', 'sit_handshake']);
const OFF_GROUND = new Set([...SEATED, 'lying', 'kneel', 'crouch']);
const TALL = new Set(['crown', 'tophat', 'musket']);

// ---------- helpers ----------
const cl = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const eio = (x) => { x = cl(x); return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; };
const lerp = (a, b, u) => a + (b - a) * u;
const num = (v) => typeof v === 'number' && Number.isFinite(v);
const fmt = (v, d = 1) => (num(v) ? v.toFixed(d) : String(v));

// figures' kv(): a fx field at time t, following its "k" keyframes with ease-in-out.
function kv(f, t, k, def) {
  if (!Array.isArray(f.k) || !f.k.length) return f[k] ?? def;
  const K = f.k;
  if (t <= K[0].t) return K[0][k] ?? f[k] ?? def;
  if (t >= K[K.length - 1].t) return K[K.length - 1][k] ?? f[k] ?? def;
  let i = 0; while (K[i + 1].t <= t) i++;
  const u = eio((t - K[i].t) / (K[i + 1].t - K[i].t)), a = K[i][k] ?? f[k] ?? def, b = K[i + 1][k] ?? a;
  return typeof a === 'number' ? lerp(a, b, u) : (u < 0.5 ? a : b);
}

function lev(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
function unknown(kind, name, known) {
  const best = known.map((k) => [lev(String(name), k), k]).sort((x, y) => x[0] - y[0])[0];
  const near = best && best[0] <= Math.max(2, Math.floor(String(name).length / 3));
  return `unknown ${kind} '${name}' ` + (near ? `(did you mean '${best[1]}'?)` : `(known: ${[...known].sort().join(', ')})`);
}

// check_spec.py's timeline(): carry each key's fields forward (null clears, except wiggle).
function timeline(keys) {
  let cur = {};
  return keys.map((k) => (cur = { ...cur, ...Object.fromEntries(Object.entries(k).filter(([a, b]) => b !== null || a === 'wiggle')) }));
}
// check_spec.py's at(): state at time t with x, y, op linearly interpolated.
function at(states, t) {
  if (t <= states[0].t) return states[0];
  for (let i = 0; i + 1 < states.length; i++) {
    const a = states[i], b = states[i + 1];
    if (a.t <= t && t <= b.t) {
      const u = (t - a.t) / Math.max(1e-6, b.t - a.t), s = { ...(u < 1 ? a : b) };
      for (const f of ['x', 'y', 'op']) {
        const dv = f === 'op' ? 1 : 0, va = a[f] ?? dv, vb = b[f] ?? va;
        s[f] = num(va) && num(vb) ? va + (vb - va) * u : va;
      }
      return s;
    }
  }
  return states[states.length - 1];
}

const RAW_TEXT = /<|&(?!(?:[a-z][a-z0-9]*|#\d+|#x[0-9a-f]+);)/i;
const TEXT_FIELDS = ['text', 'title', 'big'];

// ---------- the linter ----------
export async function lintScene(file) {
  const errs = [], warns = [];
  const E = (path, msg) => errs.push({ level: 'ERROR', path, msg });
  const Wn = (path, msg) => warns.push({ level: 'WARN', path, msg });
  const done = () => [...errs, ...warns];

  let spec;
  try { spec = JSON.parse(readFileSync(file, 'utf8')); }
  catch (e) { E('$', `cannot read or parse JSON: ${e.message}`); return done(); }
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) { E('$', 'a scene must be a JSON object'); return done(); }

  // add-ons, set and places
  let addons = [];
  try { addons = await loadAddons(resolve(file), spec.addons); } catch (e) { E('$.addons', e.message); }
  const V = vocabulary(addons);
  const offGround = new Set([...OFF_GROUND, ...V.offGround]);
  let S = spec, counts = { back: 0, front: 0 }, places = {};
  try { ({ spec: S, counts } = applySet(spec, addons)); places = placesFor(spec, addons); } catch (e) { E('$.set', e.message); }
  const nScene = (spec.fx || []).length;
  const fxPath = (i) => (i < counts.back ? `$.set.fx[${i}]` : i < counts.back + nScene ? `$.fx[${i - counts.back}]` : `$.set.front[${i - counts.back - nScene}]`);
  const remap = (p) => p.replace(/^\$\.fx\[(\d+)\]/, (_, i) => fxPath(Number(i)));
  {
    const r = substitutePlaces(S, places);
    for (const m of r.misses) E(remap(m.path), missMessage({ ...m, path: remap(m.path) }, places));
    S = r.spec;
  }

  const W = S.w ?? 900, H = S.h ?? 400, G = S.ground ?? 355, dur = S.duration, st = S.start ?? 0;
  if (!dur) Wn('$.duration', 'no "duration": render.mjs needs one to make a video');
  const end = st + (dur || 10);
  const actors = Array.isArray(S.actors) ? S.actors : [];
  if (!actors.length) Wn('$.actors', 'no actors');

  const checkLooks = (look, path, nm) => {
    if (look === undefined || look === null) return;
    if (!Array.isArray(look)) { E(path, `${nm}: "look" must be an array of names`); return; }
    look.forEach((lk, m) => { if (!V.looks.includes(lk)) E(`${path}[${m}]`, `${nm}: ${unknown('look', lk, V.looks)}`); });
  };
  const checkText = (v, path) => {
    if (typeof v !== 'string' || !RAW_TEXT.test(v)) return;
    const lt = v.includes('<');
    E(path, `raw "${lt ? '<' : '&'}" in text; figures inserts text into the SVG unescaped, so write ${lt ? '&lt;' : '&amp;'}`);
  };

  const res = [];
  actors.forEach((ac, i) => {
    const P = `$.actors[${i}]`, nm = ac.label || `actor[${i}]`;
    checkText(ac.label, `${P}.label`);
    const keys = Array.isArray(ac.keys) ? ac.keys : [];
    if (!keys.length) { E(`${P}.keys`, `${nm}: no keys`); return; }
    for (const f of ['t', 'x', 'y', 'pose']) if (!(f in keys[0])) E(`${P}.keys[0]`, `${nm}: first key missing '${f}'`);
    const ts = keys.map((k) => k.t);
    if (ts.some((t) => !num(t))) { E(`${P}.keys`, `${nm}: every key needs a numeric 't'`); return; }
    if (ts.some((t, j) => j && t < ts[j - 1])) E(`${P}.keys`, `${nm}: keys not sorted by t (${ts.join(', ')})`);
    ts.forEach((t, j) => { if (j && t === ts[j - 1]) Wn(`${P}.keys[${j}]`, `${nm}: two keys at t=${t}; the second wins silently`); });
    checkLooks(ac.look, `${P}.look`, nm);
    const s = ac.s ?? 1, states = timeline(keys);
    let wigOn = null;
    keys.forEach((k, j) => {
      const K = `${P}.keys[${j}]`, t = k.t, sres = states[j];
      if ('pose' in k && !V.poses.includes(k.pose)) E(`${K}.pose`, `${nm} t=${t}: ${unknown('pose', k.pose, V.poses)}`);
      if ('expr' in k && !V.exprs.includes(k.expr)) E(`${K}.expr`, `${nm} t=${t}: ${unknown('expr', k.expr, V.exprs)}`);
      if (k.item && !V.items.includes(k.item)) E(`${K}.item`, `${nm} t=${t}: ${unknown('item', k.item, V.items)}`);
      if (![undefined, null, 'walk', 'run'].includes(k.move)) E(`${K}.move`, `${nm} t=${t}: move must be 'walk' or 'run'`);
      if ('face' in k && k.face !== 1 && k.face !== -1) Wn(`${K}.face`, `${nm} t=${t}: face should be 1 or -1`);
      if ('look' in k) checkLooks(k.look, `${K}.look`, nm);
      if ('wiggle' in k) wigOn = k.wiggle ? t : null;
      const standY = G - 53 * s * (sres.s ?? 1), y = sres.y ?? standY;
      if (!offGround.has(sres.pose) && num(y) && Math.abs(y - standY) > 6 && !k.rot)
        Wn(`${K}.y`, `${nm} t=${t}: standing pose with y=${fmt(y)}; feet on ground needs y≈${fmt(standY)}`);
    });
    if (wigOn !== null) Wn(P, `${nm}: wiggle started at t=${wigOn} never stopped (set "wiggle": null on a later key)`);
    for (let j = 1; j < keys.length; j++) {
      const a = keys[j - 1], b = keys[j], K = `${P}.keys[${j}]`;
      if (b.move && 'face' in b && b.face !== (states[j - 1].face ?? 1)) Wn(`${K}.face`, `${nm} t=${b.t}: face flips on a walk key; turn on the previous key instead`);
      const xa = states[j - 1].x;
      if (b.move && num(b.x) && num(xa)) {
        const v = Math.abs(b.x - xa) / Math.max(1e-6, b.t - a.t), stride = (b.move === 'run' ? 80 : 52) * s, cad = v / stride, lim = b.move === 'run' ? 3.8 : 2.6;
        if (cad > lim) Wn(K, `${nm} t=${b.t}: ${b.move} cadence ${fmt(cad)} stride cycles/s looks frantic (≤${lim}); give it more time${b.move === 'walk' ? ' or use run' : ''}`);
      }
    }
    res.push({ nm, ac, states, s });
  });

  const fx = Array.isArray(S.fx) ? S.fx : [];
  fx.forEach((f, i) => {
    const p = fxPath(i);
    if (!f || typeof f.type !== 'string') { E(p, 'fx needs a "type"'); return; }
    if (!V.fx.includes(f.type)) E(`${p}.type`, unknown('fx type', f.type, V.fx));
    for (const k of TEXT_FIELDS) checkText(f[k], `${p}.${k}`);
    (Array.isArray(f.k) ? f.k : []).forEach((kk, j) => { for (const k of TEXT_FIELDS) checkText(kk?.[k], `${p}.k[${j}].${k}`); });
  });

  // staging, sampled every 0.25 s (as check_spec.py)
  const bubbles = fx.map((f, i) => ({ f, i })).filter(({ f }) => f && (f.type === 'bubble' || f.type === 'thought'));
  const warned = new Set(), once = (k) => (warned.has(k) ? false : (warned.add(k), true));
  const fs = S.labelFs ?? 15;
  for (let t = st; t <= end + 1e-9; t += 0.25) {
    const live = [];
    for (const { nm, ac, states, s: s0 } of res) {
      const q = at(states, t);
      if ((q.op ?? 1) < 0.3 || !num(q.x) || !num(q.y)) continue;
      const s = s0 * (q.s ?? 1), x = q.x, y = q.y, tall = (Array.isArray(ac.look) ? ac.look : []).some((l) => TALL.has(l));
      const headY = y - 60 * s, ly = y + (-60 - (tall ? 62 : 34)) * s + (ac.labelDy ?? 0);
      let lab = null;
      if (ac.label) { const tw = String(ac.label).length * fs * 0.78 + 14, lx = cl(x, tw / 2 + 16, W - tw / 2 - 16); lab = [lx - tw / 2, lx + tw / 2, ly - fs * 0.95, ly + fs * 0.35]; }
      live.push({ nm, x, y, headY, lab, q, s, path: `$.actors[${actors.indexOf(ac)}]` });
      if (x > 0 && x < W && (x < 25 * s || x > W - 25 * s) && once(`edge|${nm}`)) Wn(live.at(-1).path, `${nm} t≈${fmt(t)}: hugging the canvas edge (x=${fmt(x, 0)})`);
    }
    for (let a = 0; a < live.length; a++) for (let b = a + 1; b < live.length; b++) {
      const A = live[a], B = live[b], d = Math.abs(A.x - B.x), hs = A.q.pose === 'handshake' || B.q.pose === 'handshake';
      if (d < (hs ? 80 : 95) && A.x > 0 && A.x < W && B.x > 0 && B.x < W && once(`near|${A.nm}|${B.nm}`))
        Wn(B.path, `${A.nm} and ${B.nm} t≈${fmt(t)}: only ${fmt(d, 0)} px apart (limbs may tangle)`);
    }
    for (const { f, i } of bubbles) {
      if (t < (f.t0 ?? -1e9) || t > (f.t1 ?? 1e9)) continue;
      const X = kv(f, t, 'x', 0), Y = kv(f, t, 'y', 0), Sc = kv(f, t, 's', 1), bw = (f.w || 170) * Sc, bh = (f.h || 56) * Sc;
      if (!num(X) || !num(Y)) continue;
      // bubble: box from Y - h up to Y, tail 22 below; thought: ellipse from Y - h - 6 to Y + 6, dots below
      const thought = f.type === 'thought', bx0 = X - bw / 2, bx1 = X + bw / 2;
      const by0 = thought ? Y - bh - 6 * Sc : Y - bh, by1 = thought ? Y + 6 * Sc : Y, low = thought ? Y + 38 * Sc : Y + 22 * Sc;
      const label = `${f.type} '${f.text ?? ''}'`, p = fxPath(i);
      if ((bx0 < 14 || bx1 > W - 14 || by0 < 14 || low > H - 14) && once(`bclip|${i}`))
        E(p, `${label} t≈${fmt(t)}: crosses the frame edge (box x ${fmt(bx0, 0)}..${fmt(bx1, 0)}, y ${fmt(by0, 0)}..${fmt(low, 0)}; y is the bottom of the box)`);
      for (const L of live) {
        const ov = (r) => [Math.min(bx1, r[1]) - Math.max(bx0, r[0]), Math.min(by1, r[3]) - Math.max(by0, r[2])];
        let hit = null;
        if (L.lab) { const [ox, oy] = ov(L.lab); if (ox > 0 && oy > 0) hit = ['label', Math.min(ox, oy)]; }
        const [ox, oy] = ov([L.x - 20 * L.s, L.x + 20 * L.s, L.headY - 20 * L.s, L.headY + 20 * L.s]);
        if (ox > 0 && oy > 0 && (!hit || Math.min(ox, oy) > hit[1])) hit = ['head', Math.min(ox, oy)];
        if (hit && hit[1] >= 1 && once(`bhit|${i}|${L.nm}`)) {
          const msg = `${label} t≈${fmt(t)}: overlaps ${L.nm}'s ${hit[0]} by ${fmt(hit[1], 0)} px`;
          hit[1] > 8 ? E(p, msg) : Wn(p, msg + ' (touching)');
        }
      }
    }
  }
  return done();
}

// ---------- CLI ----------
async function main() {
  const argv = process.argv.slice(2), files = argv.filter((a) => !a.startsWith('--')), strict = argv.includes('--strict');
  if (!files.length) { process.stderr.write('usage: node lint.mjs <scene.json> [more.json ...] [--strict]\n'); process.exit(2); }
  let ok = true;
  for (const file of files) {
    const probs = await lintScene(file), nE = probs.filter((p) => p.level === 'ERROR').length, nW = probs.length - nE;
    for (const p of probs) process.stdout.write(`${files.length > 1 ? file + ' ' : ''}${p.path}: ${p.level} ${p.msg}\n`);
    const fileOk = !nE && !(strict && nW);
    ok &&= fileOk;
    process.stderr.write(`lint: ${file}: ${fileOk ? 'ok' : 'FAIL'} (${nE} errors, ${nW} warnings)\n`);
  }
  process.exit(ok ? 0 : 1);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
