// Road surfaces and the two sets.
//
// Side view has two readings of "the road", and a crossing scene usually needs both:
//   - the crossing view ("road" set): the road is a band between two kerbs; a pedestrian walks from the
//     near kerb, over the zebra, to the far kerb (left to right). Cars cannot drive here.
//   - the street view ("street" set): the road runs the whole width; cars drive along it and stop at the
//     stop line, before the zebra.
// Both views share one layout, so a place means the same x in either, and "cuts" switch between them.
import { C, n, sceneScale } from './style.mjs';
import { CAR } from './car.mjs';

const stripes = (h, x0, x1, y0, y1, stripe) => {
  let s = '';
  const step = stripe * 2, count = Math.max(1, Math.floor((x1 - x0 + stripe) / step));
  const start = x0 + (x1 - x0 - (count * step - stripe)) / 2;
  for (let i = 0; i < count; i++) {
    s += `<rect x="${n(h, start + i * step)}" y="${n(h, y0)}" width="${n(h, stripe)}" height="${n(h, y1 - y0)}" rx="1.5" fill="${C.paint}" opacity="0.93"/>`;
  }
  return s;
};

// Deterministic road grit, so the asphalt is not a flat block.
const grit = (h, x0, x1, y0, y1, seed) => {
  let s = '';
  const count = Math.max(4, Math.round((x1 - x0) / 38));
  for (let i = 0; i < count; i++) {
    const x = x0 + h.hsh(seed, i) * (x1 - x0), y = y0 + h.hsh(seed + 1, i) * (y1 - y0);
    s += `<circle cx="${n(h, x)}" cy="${n(h, y)}" r="${n(h, 1 + h.hsh(seed + 2, i) * 1.6)}" fill="#8a847b" opacity="0.5"/>`;
  }
  return s;
};

// zebra: crossing stripes on the road band (anchor = middle of the crossing, on the ground line).
// Fields: w (width, default 260), depth (band depth, default 28), stripe (stripe width, default 18).
export function zebra(f, t, h) {
  const w = f.w || 260, d = f.depth || 28, st = f.stripe || 18;
  return stripes(h, -w / 2, w / 2, 3, d - 4, st);
}

// stop-line: the white line across the lane where cars stop (anchor = the line, on the ground line).
// Fields: w (line thickness, default 8), depth (default 28).
export function stopLine(f, t, h) {
  const w = f.w || 8, d = f.depth || 28;
  return `<rect x="${-w / 2}" y="2" width="${w}" height="${d - 4}" rx="1.5" fill="${C.paint}"/>`;
}

// crossing-view (scene coordinates): near pavement | kerb | road band with zebra | kerb | far pavement.
// Fields: x0, x1 (the kerb edges), zebra (default true). Scale comes from the fx "s".
export const crossingView = {
  wrap: false,
  draw(f, t, h) {
    const s = h.s || 1, G = h.ground, W = h.W;
    const x0 = Number.isFinite(f.x0) ? f.x0 : W * 0.44, x1 = Number.isFinite(f.x1) ? f.x1 : W * 0.76;
    const P = 24 * s, R = 30 * s, K = 12 * s, sw = n(h, 1.1 * s);
    let g = '';
    for (const [a, b] of [[-80, x0], [x1, W + 80]]) {
      g += `<rect x="${n(h, a)}" y="${n(h, G)}" width="${n(h, b - a)}" height="${n(h, P)}" fill="${C.pave}" stroke="${h.INK}" stroke-width="${sw}"/>`;
      for (let x = a + 70 * s; x < b - 20 * s; x += 70 * s) g += `<line x1="${n(h, x)}" y1="${n(h, G + 3 * s)}" x2="${n(h, x)}" y2="${n(h, G + P - 3 * s)}" stroke="${h.INK}" stroke-width="${sw}" opacity="0.18"/>`;
    }
    g += `<rect x="${n(h, x0)}" y="${n(h, G)}" width="${n(h, x1 - x0)}" height="${n(h, R)}" fill="${C.asphalt}" stroke="${h.INK}" stroke-width="${sw}"/>`;
    g += grit(h, x0 + 6 * s, x1 - 6 * s, G + 4 * s, G + R - 4 * s, 11);
    if (f.zebra !== false) g += stripes(h, x0 + 16 * s, x1 - 16 * s, G + 3 * s, G + R - 5 * s, 20 * s);
    for (const x of [x0 - K, x1]) g += `<rect x="${n(h, x)}" y="${n(h, G - 3 * s)}" width="${n(h, K)}" height="${n(h, P + 7 * s)}" rx="${n(h, 2 * s)}" fill="${C.kerb}" stroke="${h.INK}" stroke-width="${sw}"/>`;
    return `<g opacity="${n(h, h.op)}">${g}</g>`;
  },
};

// street-view (scene coordinates): the road along the whole width, a near pavement in front of it,
// a stop line and a zebra. Fields: stopLine (x, or false), zebra ([x0, x1], or false).
export const streetView = {
  wrap: false,
  draw(f, t, h) {
    const s = h.s || 1, G = h.ground, W = h.W, R = 30 * s, P = 18 * s, sw = n(h, 1.1 * s);
    let g = `<rect x="-80" y="${n(h, G)}" width="${W + 160}" height="${n(h, R)}" fill="${C.asphalt}" stroke="${h.INK}" stroke-width="${sw}"/>`;
    g += grit(h, 0, W, G + 4 * s, G + R - 4 * s, 23);
    if (Array.isArray(f.zebra)) g += stripes(h, f.zebra[0] + 16 * s, f.zebra[1] - 16 * s, G + 3 * s, G + R - 5 * s, 20 * s);
    if (Number.isFinite(f.stopLine)) g += `<rect x="${n(h, f.stopLine)}" y="${n(h, G + 2 * s)}" width="${n(h, 8 * s)}" height="${n(h, R - 4 * s)}" rx="${n(h, 1.5 * s)}" fill="${C.paint}"/>`;
    g += `<rect x="-80" y="${n(h, G + R - 1 * s)}" width="${W + 160}" height="${n(h, 6 * s)}" fill="${C.kerb}" stroke="${h.INK}" stroke-width="${sw}"/>`;
    g += `<rect x="-80" y="${n(h, G + R + 5 * s)}" width="${W + 160}" height="${n(h, P)}" fill="${C.pave}" stroke="${h.INK}" stroke-width="${sw}"/>`;
    for (let x = 40 * s; x < W; x += 70 * s) g += `<line x1="${n(h, x)}" y1="${n(h, G + R + 8 * s)}" x2="${n(h, x)}" y2="${n(h, G + R + P + 2 * s)}" stroke="${h.INK}" stroke-width="${sw}" opacity="0.18"/>`;
    return `<g opacity="${n(h, h.op)}">${g}</g>`;
  },
};

// town-backdrop (scene coordinates): faint houses and trees along the back, so the street has a place.
// Fields: seed (changes the skyline, default 1), a (strength, default 1).
export const townBackdrop = {
  wrap: false,
  draw(f, t, h) {
    const s = h.s || 1, G = h.ground, W = h.W, seed = f.seed ?? 1, a = f.a ?? 1;
    let g = '', x = -30 * s, i = 0;
    while (x < W + 40 && i < 60) {
      const kind = h.hsh(seed, i);
      if (kind < 0.22) { // a tree
        const tr = (18 + 10 * h.hsh(seed + 4, i)) * s, th = (40 + 30 * h.hsh(seed + 5, i)) * s, cx = x + tr;
        g += `<line x1="${n(h, cx)}" y1="${n(h, G)}" x2="${n(h, cx)}" y2="${n(h, G - th)}" stroke="${h.INK}" stroke-width="${n(h, 1.4 * s)}" opacity="0.3"/>`;
        g += `<circle cx="${n(h, cx)}" cy="${n(h, G - th - tr * 0.8)}" r="${n(h, tr)}" fill="#b7bf8f" opacity="0.35" stroke="${h.INK}" stroke-width="${n(h, 1.2 * s)}" stroke-opacity="0.35"/>`;
        x += tr * 2 + 14 * s;
      } else { // a house or a block
        const bw = (70 + 70 * h.hsh(seed + 1, i)) * s, bh = (70 + 110 * h.hsh(seed + 2, i)) * s, roof = h.hsh(seed + 3, i) < 0.5;
        const tint = ['#e3cfa5', '#dcc7a0', '#e6d6b2'][i % 3];
        g += `<rect x="${n(h, x)}" y="${n(h, G - bh)}" width="${n(h, bw)}" height="${n(h, bh)}" fill="${tint}" opacity="0.55" stroke="${h.INK}" stroke-width="${n(h, 1.2 * s)}" stroke-opacity="0.32"/>`;
        if (roof) g += `<path d="M ${n(h, x - 6 * s)} ${n(h, G - bh)} L ${n(h, x + bw / 2)} ${n(h, G - bh - 26 * s)} L ${n(h, x + bw + 6 * s)} ${n(h, G - bh)} Z" fill="#cfae86" opacity="0.5" stroke="${h.INK}" stroke-width="${n(h, 1.2 * s)}" stroke-opacity="0.32"/>`;
        const cols = Math.max(1, Math.floor(bw / (30 * s))), rows = Math.max(1, Math.floor((bh - 36 * s) / (34 * s)));
        for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
          const wx = x + (bw - cols * 30 * s) / 2 + c * 30 * s + 8 * s, wy = G - bh + 14 * s + r * 34 * s;
          g += `<rect x="${n(h, wx)}" y="${n(h, wy)}" width="${n(h, 14 * s)}" height="${n(h, 16 * s)}" fill="none" stroke="${h.INK}" stroke-width="${n(h, s)}" opacity="0.25"/>`;
        }
        x += bw + (8 + 20 * h.hsh(seed + 6, i)) * s;
      }
      i++;
    }
    return `<g opacity="${n(h, h.op * a)}">${g}</g>`;
  },
};

// ---------- sets ----------
export function layout(spec, opts = {}) {
  const W = spec.w || 900, G = spec.ground ?? 355, s = sceneScale(spec, opts);
  const band = Array.isArray(opts.band) && opts.band.length === 2 ? opts.band : [W * 0.44, W * 0.76];
  return {
    W, G, s, x0: band[0], x1: band[1],
    stop: Number.isFinite(opts.stopLine) ? opts.stopLine : W * 0.36,
    post: Number.isFinite(opts.lightPost) ? opts.lightPost : W * 0.85,
  };
}

export function places(spec, opts = {}) {
  const L = layout(spec, opts), s = L.s, carStop = L.stop - 152 * s;
  return {
    'near-kerb': { x: L.x0 - 30 * s, y: L.G },
    'far-kerb': { x: L.x1 + 30 * s, y: L.G },
    crossing: { x: (L.x0 + L.x1) / 2, y: L.G },
    'stop-line': { x: L.stop, y: L.G },
    'light-post': { x: L.post, y: L.G },
    'car-stop': { x: carStop, y: L.G },
    // a driver actor of the set's scale: x when the car is at car-stop; y puts the hip on the seat
    'driver-seat': { x: carStop + CAR.seat.dx * s, y: L.G + (53 + CAR.seat.dy) * s },
    'off-left': { x: -170 * s, y: L.G },
    'off-right': { x: L.W + 170 * s, y: L.G },
  };
}

const VIEW = { road: 'road', crossing: 'road', street: 'street' };

// The set's own fx: the backdrop, then one view fx per stretch of time between cuts.
function setFx(first) {
  return (spec, opts = {}) => {
    const L = layout(spec, opts);
    const win = (a, b) => (a == null && b == null ? {} : { ...(a == null ? {} : { t0: a - 0.002 }), ...(b == null ? {} : { t1: b }), fade: 0.001 });
    const make = (view, a, b) => (view === 'street'
      ? { type: 'street-view', s: L.s, stopLine: opts.stopLine === false ? null : L.stop, zebra: opts.zebra === false ? false : [L.x0, L.x1], ...win(a, b) }
      : { type: 'crossing-view', s: L.s, x0: L.x0, x1: L.x1, zebra: opts.zebra !== false, ...win(a, b) });
    const cuts = (Array.isArray(opts.cuts) ? opts.cuts : [])
      .filter((c) => Array.isArray(c) && Number.isFinite(c[0]) && VIEW[c[1]])
      .sort((p, q) => p[0] - q[0]);
    const out = opts.backdrop === false ? [] : [{ type: 'town-backdrop', s: L.s, seed: opts.seed ?? 1 }];
    let cur = first, start = null;
    for (const [t, v] of cuts) {
      if (VIEW[v] === cur) continue;
      out.push(make(cur, start, t));
      cur = VIEW[v]; start = t;
    }
    out.push(make(cur, start, null));
    return out;
  };
}

export const sets = {
  road: { fx: setFx('road'), places },
  street: { fx: setFx('street'), places },
};
