// Add-on loading for figures scenes: find and validate add-on modules, expand a scene's set,
// resolve "@place" references, and load the same modules into a Playwright page.
// The contract an add-on follows is in explainers/addons/README.md.
//
//   loadAddons(scenePath, names)  -> [{ name, file, addon }]
//   applySet(spec, addons)        -> { spec, places, counts: { back, front } }
//   resolvePlaces(spec, addons)   -> spec with "@name" x/y strings replaced (throws on a miss)
//   prepareAddons(spec, scenePath)-> { spec, addons }   (all of the above, what render.mjs uses)
//   pageSetup(addons)             -> async (page) => {} or null
import { createRequire } from 'node:module';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const ADDONS_DIR = resolve(HERE, '../addons');
export const FIGURES_JS = resolve(HERE, '../vendor/figures/figures.js');
const FIG = createRequire(import.meta.url)(FIGURES_JS);

// Built-in vocabulary. Poses and expressions come from the engine's tables; looks, items and fx are
// switch cases / includes() checks in figures.js, so they are listed here (same lists as check_spec.py).
export const BUILTIN = Object.freeze({
  poses: Object.keys(FIG.POSES),
  exprs: [...FIG.EXPRESSIONS],
  looks: ['beard', 'cap', 'crown', 'dress', 'glasses', 'hair', 'musket', 'robe', 'sword', 'tie', 'tophat', 'wig'],
  items: ['mirror', 'telescope', 'scroll', 'dagger', 'pen', 'clipboard', 'coinbag', 'crown', 'wallet', 'paper', 'medal'],
  fx: ['arrow', 'bars', 'beam', 'bed', 'bubble', 'chair', 'chateau', 'check', 'cross', 'crownfx', 'curtain', 'doc', 'door',
    'firework', 'garden', 'heart', 'jupiter', 'mirrorstand', 'moon', 'night', 'screen', 'snow', 'sparkle', 'stars', 'sun',
    'sweat', 'table', 'text', 'thought', 'throne', 'tint', 'wallet', 'zzz'],
});
const KINDS = { poses: 'pose', exprs: 'expression', items: 'item', looks: 'look', fx: 'fx', sets: 'set' };
const BARE = /^[a-z0-9][a-z0-9_-]*$/i;
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const drawOf = (v) => (typeof v === 'function' ? v : isObj(v) ? v.draw : undefined);

function resolveAddonFile(scenePath, ref) {
  if (BARE.test(ref)) return join(ADDONS_DIR, ref, 'index.mjs');
  const p = resolve(dirname(scenePath), ref);
  return existsSync(p) && statSync(p).isDirectory() ? join(p, 'index.mjs') : p;
}

function validateAddon(a, ref) {
  const bad = (m) => { throw new Error(`add-on "${ref}": ${m}`); };
  if (!isObj(a)) bad('the module must export an add-on object (export default { name, ... })');
  if (typeof a.name !== 'string' || !a.name) bad('missing "name" (a string)');
  for (const t of Object.keys(KINDS)) if (a[t] !== undefined && !isObj(a[t])) bad(`"${t}" must be an object of name -> definition`);
  for (const t of ['poses', 'exprs', 'items', 'looks', 'fx']) {
    for (const n of Object.keys(a[t] || {})) if (BUILTIN[t].includes(n)) bad(`${KINDS[t]} "${n}" is a built-in name; pick another`);
  }
  for (const [n, p] of Object.entries(a.poses || {})) {
    if (!isObj(p)) bad(`pose "${n}" must be an object of joints`);
    for (const [j, v] of Object.entries(p)) {
      if (!['neck', 'head', 'la', 'ra', 'll', 'rl'].includes(j)) bad(`pose "${n}": unknown joint "${j}" (neck, head, la, ra, ll, rl)`);
      const ok = (q) => Array.isArray(q) && q.length === 2 && q.every(Number.isFinite);
      if ((j === 'neck' || j === 'head') ? !ok(v) : !(Array.isArray(v) && v.length === 2 && v.every(ok))) bad(`pose "${n}": joint "${j}" has the wrong shape`);
    }
  }
  for (const [n, e] of Object.entries(a.exprs || {})) if (!isObj(e)) bad(`expression "${n}" must be an object of face parameters`);
  for (const t of ['items', 'looks', 'fx']) {
    for (const [n, d] of Object.entries(a[t] || {})) if (typeof drawOf(d) !== 'function') bad(`${KINDS[t]} "${n}" needs a draw function`);
  }
  for (const [n, d] of Object.entries(a.looks || {})) if (isObj(d) && d.layer && !['behind', 'body', 'head'].includes(d.layer)) bad(`look "${n}": layer must be behind, body or head`);
  for (const [n, d] of Object.entries(a.fx || {})) if (isObj(d) && d.layer && !['scene', 'overlay'].includes(d.layer)) bad(`fx "${n}": layer must be scene or overlay`);
  for (const [n, s] of Object.entries(a.sets || {})) {
    if (!isObj(s)) bad(`set "${n}" must be an object { fx?, front?, places? }`);
    for (const k of ['fx', 'front']) if (s[k] !== undefined && !Array.isArray(s[k]) && typeof s[k] !== 'function') bad(`set "${n}": "${k}" must be an array of fx or a function (spec, opts) => fx[]`);
    if (s.places !== undefined && !isObj(s.places) && typeof s.places !== 'function') bad(`set "${n}": "places" must be { name: { x, y } } or a function (spec, opts) => places`);
  }
  return a;
}

export async function loadAddons(scenePath, names) {
  if (names == null) return [];
  if (!Array.isArray(names) || names.some((n) => typeof n !== 'string' || !n)) throw new Error('"addons" must be an array of add-on names or paths');
  const out = [], owner = {};
  for (const ref of names) {
    const file = resolveAddonFile(scenePath, ref);
    if (out.some((a) => a.file === file)) continue;
    if (!existsSync(file)) throw new Error(`add-on "${ref}" not found (looked for ${file})`);
    let mod;
    try { mod = await import(pathToFileURL(file).href); }
    catch (e) { throw new Error(`add-on "${ref}" failed to load: ${String(e?.message || e).split('\n')[0]}`); }
    const addon = validateAddon(mod.default ?? mod, ref);
    for (const t of Object.keys(KINDS)) {
      for (const n of Object.keys(addon[t] || {})) {
        const k = `${t}:${n}`;
        if (owner[k] && owner[k] !== addon.name) throw new Error(`add-on "${ref}": ${KINDS[t]} "${n}" is also defined by add-on "${owner[k]}"`);
        owner[k] = addon.name;
      }
    }
    out.push({ name: addon.name, file, addon });
  }
  return out;
}

// Every name the scene may use: built-ins plus its add-ons, with where each add-on name came from.
export function vocabulary(addons) {
  const v = { poses: [...BUILTIN.poses], exprs: [...BUILTIN.exprs], looks: [...BUILTIN.looks], items: [...BUILTIN.items], fx: [...BUILTIN.fx], sets: [], offGround: [] };
  for (const { addon } of addons) {
    for (const t of Object.keys(KINDS)) v[t].push(...Object.keys(addon[t] || {}));
    v.offGround.push(...(addon.vocab?.offGround || []));
  }
  return v;
}

const setRef = (spec) => (spec.set == null ? null : typeof spec.set === 'string' ? { name: spec.set, opts: {} } : { name: spec.set.name, opts: spec.set });
function findSet(spec, addons) {
  const ref = setRef(spec);
  if (!ref) return null;
  const all = addons.flatMap(({ addon }) => Object.entries(addon.sets || {}));
  const hit = all.find(([n]) => n === ref.name);
  if (!hit) throw new Error(`unknown set "${ref.name}"; sets from this scene's add-ons: ${all.map(([n]) => n).join(', ') || '(none: add the add-on to "addons")'}`);
  return { set: hit[1], opts: ref.opts };
}
const call = (v, spec, opts) => (typeof v === 'function' ? v(spec, opts) : v);

// The places a scene can refer to: its set's places, overridden by the scene's own "places".
export function placesFor(spec, addons) {
  const s = findSet(spec, addons);
  return { ...(s ? call(s.set.places, spec, s.opts) : {}), ...(isObj(spec.places) ? spec.places : {}) };
}

// Put the set's background fx before the scene's fx and its foreground fx (front: true) after them.
export function applySet(spec, addons) {
  const out = structuredClone(spec);
  const s = findSet(spec, addons);
  if (!s) return { spec: out, places: placesFor(spec, addons), counts: { back: 0, front: 0 } };
  const back = structuredClone(call(s.set.fx, spec, s.opts) || []);
  const front = structuredClone(call(s.set.front, spec, s.opts) || []).map((f) => ({ ...f, front: true }));
  out.fx = [...back, ...(spec.fx || []), ...front];
  return { spec: out, places: placesFor(spec, addons), counts: { back: back.length, front: front.length } };
}

// "@name" or "@name+N" / "@name-N" (N in scene units). On an actor's y, a place is where the feet
// stand: the hip goes 53 * scale above it, like a standing figure. Everywhere else it is the point itself.
const PLACE_KEYS = ['x', 'y', 'x1', 'y1', 'x2', 'y2'];
function lookupPlace(ref, places) {
  const body = ref.slice(1);
  if (places[body]) return { place: places[body], off: 0 };
  const m = /^(.+?)([+-]\d+(?:\.\d+)?)$/.exec(body);
  if (m && places[m[1]]) return { place: places[m[1]], off: Number(m[2]) };
  return null;
}

export function substitutePlaces(spec, places) {
  const out = structuredClone(spec), misses = [];
  const fix = (obj, path, footScale) => {
    for (const k of PLACE_KEYS) {
      const v = obj[k];
      if (typeof v !== 'string' || !v.startsWith('@')) continue;
      const hit = lookupPlace(v, places);
      if (!hit) { misses.push({ path: `${path}.${k}`, ref: v }); continue; }
      const axis = k[0], base = hit.place[axis];
      if (!Number.isFinite(base)) { misses.push({ path: `${path}.${k}`, ref: v, why: `place has no numeric ${axis}` }); continue; }
      obj[k] = (axis === 'y' && footScale ? base - 53 * footScale : base) + hit.off;
    }
  };
  (out.actors || []).forEach((ac, i) => {
    let s = 1;
    (ac.keys || []).forEach((key, j) => { if (Number.isFinite(key.s)) s = key.s; fix(key, `$.actors[${i}].keys[${j}]`, (ac.s || 1) * s); });
  });
  (out.fx || []).forEach((f, i) => {
    fix(f, `$.fx[${i}]`, 0);
    if (Array.isArray(f.k)) f.k.forEach((kk, j) => fix(kk, `$.fx[${i}].k[${j}]`, 0));
  });
  return { spec: out, misses };
}

export const placeList = (places) => Object.keys(places).sort().join(', ') || '(none: the scene has no "set" and no "places")';
export function missMessage(m, places) {
  return m.why ? `place "${m.ref}" at ${m.path}: ${m.why}` : `unknown place "${m.ref}" at ${m.path}; valid places: ${placeList(places)}`;
}

export function resolvePlaces(spec, addons) {
  const places = placesFor(spec, addons);
  const { spec: out, misses } = substitutePlaces(spec, places);
  if (misses.length) throw new Error(missMessage(misses[0], places) + (misses.length > 1 ? ` (and ${misses.length - 1} more)` : ''));
  return out;
}

export async function prepareAddons(spec, scenePath) {
  const addons = await loadAddons(scenePath, spec.addons);
  const { spec: withSet } = applySet(spec, addons);
  return { spec: resolvePlaces(withSet, addons), addons };
}

// ---------- page side ----------
// The page is about:blank, so add-on modules (and anything they import relatively) are served from
// disk through a Playwright route on a fake origin, then imported with dynamic import().
export const PAGE_ORIGIN = 'http://figures-addons.invalid';
export function pageSetup(addons) {
  if (!addons.length) return null;
  const urls = addons.map((a) => PAGE_ORIGIN + pathToFileURL(a.file).pathname);
  return async (page) => {
    await page.route(`${PAGE_ORIGIN}/**`, (route) => {
      const p = decodeURIComponent(new URL(route.request().url()).pathname);
      if (!/\.m?js$/.test(p) || !existsSync(p)) return route.fulfill({ status: 404, body: `not found: ${p}` });
      return route.fulfill({ status: 200, contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' }, body: readFileSync(p, 'utf8') });
    });
    await page.addScriptTag({ content: `window.__addonsReady=(async()=>{for(const u of ${JSON.stringify(urls)}){const m=await import(u);FIGURES.extend(m.default||m)}return FIGURES.vocab()})();` });
    let got;
    try { got = await page.evaluate(() => window.__addonsReady); }
    catch (e) { throw new Error(`add-ons failed to load in the page: ${String(e?.message || e).split('\n')[0]}`); }
    for (const { name, addon } of addons) {
      for (const t of ['poses', 'exprs', 'items', 'looks', 'fx', 'sets']) {
        const miss = Object.keys(addon[t] || {}).find((n) => !got[t].includes(n));
        if (miss) throw new Error(`add-on "${name}": ${KINDS[t]} "${miss}" did not register in the page`);
      }
    }
  };
}
