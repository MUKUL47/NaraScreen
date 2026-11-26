// Signals and signs. All are floor props: anchor x = the pole, y = the ground line; they draw upwards.
// Drawn at figure scale 1, so set the fx "s" to your figures' scale.
import { C, n, glow } from './style.mjs';

const pole = (h, top, w = 7) =>
  `<rect x="${-w / 2}" y="${n(h, -top)}" width="${w}" height="${n(h, top)}" fill="#6b6258" stroke="${h.INK}" stroke-width="2"/>` +
  `<rect x="-11" y="-5" width="22" height="5" rx="2" fill="#6b6258" stroke="${h.INK}" stroke-width="2"/>`;

const blinkOn = (h, f, t) => {
  const fl = h.kv(f, t, 'flash', 0);
  return !(fl === true || (typeof fl === 'number' && fl > 0.5)) || Math.floor(t * 2.4) % 2 === 0;
};

// traffic-light: vertical 3-lamp signal for drivers.
// Fields: state ("red" | "amber" | "green" | "red-amber" | "off", animatable with k), pole (height of the
// pole under the housing, default 240; 0 = housing only, anchored at its bottom), flash (blink the lit lamp).
export function trafficLight(f, t, h) {
  const P = Number.isFinite(f.pole) ? f.pole : 240;
  const state = String(h.kv(f, t, 'state', 'red')).toLowerCase();
  const on = blinkOn(h, f, t);
  const top = -P - 88;
  const lamps = [['red', C.red, C.redDim, 16], ['amber', C.amber, C.amberDim, 44], ['green', C.green, C.greenDim, 72]];
  let s = P > 0 ? pole(h, P + 4) : '';
  s += `<rect x="-17" y="${top}" width="34" height="88" rx="8" fill="${C.housing}" stroke="${h.INK}" stroke-width="2.5"/>`;
  for (const [name, lit, dim, dy] of lamps) {
    const cy = top + dy;
    const isLit = on && (state === name || (state === 'red-amber' && (name === 'red' || name === 'amber')));
    if (isLit) s += glow(h, 0, cy, 11, lit, 0.9);
    s += `<circle cx="0" cy="${cy}" r="10.5" fill="${isLit ? lit : dim}" stroke="${h.INK}" stroke-width="1.6"/>`;
    if (isLit) s += `<circle cx="-3.5" cy="${cy - 3.5}" r="2.6" fill="#ffffff" opacity="0.7"/>`;
    s += `<path d="M -13 ${cy - 7} Q 0 ${cy - 18} 13 ${cy - 7}" fill="none" stroke="${h.INK}" stroke-width="3" stroke-linecap="round" opacity="0.8"/>`;
  }
  return s;
}

const ICON = {
  dont: 'M 0 -9 L 0 7 M 0 -6 L -7 6 M 0 -6 L 7 6 M 0 7 L -4 20 M 0 7 L 4 20',
  walk: 'M 1 -9 L -1 6 M 1 -6 L -8 2 M 1 -6 L 8 1 M -1 6 L -8 19 M -1 6 L 4 12 L 6 20',
};

// ped-signal: the pedestrian signal, a box with a lit figure and its words.
// Fields: state ("walk" | "dont", animatable with k; "go"/"green" also mean walk), side (box beside the
// pole: 1 right (default), -1 left, 0 on top), pole (default 150), flash, walkText ("WALK"),
// dontText ("DON'T WALK").
export function pedSignal(f, t, h) {
  const P = Number.isFinite(f.pole) ? f.pole : 150;
  const side = Number.isFinite(f.side) ? Math.sign(f.side) : 1;
  const state = String(h.kv(f, t, 'state', 'dont')).toLowerCase();
  const walk = ['walk', 'go', 'green'].includes(state);
  const on = blinkOn(h, f, t);
  const W = 72, H = 88, top = -P - H;
  const bx = side > 0 ? 3.5 : side < 0 ? -3.5 - W : -W / 2;
  const cx = bx + W / 2, col = walk ? C.green : C.red;
  let s = pole(h, side ? P + H : P + 2);
  if (side) s += `<rect x="${side > 0 ? 0 : -6}" y="${top + 10}" width="6" height="6" fill="${h.INK}"/><rect x="${side > 0 ? 0 : -6}" y="${top + H - 16}" width="6" height="6" fill="${h.INK}"/>`;
  s += `<rect x="${bx}" y="${top}" width="${W}" height="${H}" rx="7" fill="${C.housing}" stroke="${h.INK}" stroke-width="2.5"/>`;
  s += `<rect x="${bx + 6}" y="${top + 6}" width="${W - 12}" height="56" rx="4" fill="${C.screen}"/>`;
  if (on) {
    s += glow(h, cx, top + 34, 12, col, 0.7);
    s += `<g transform="translate(${n(h, cx)} ${top + 36})"><circle cx="${walk ? 2 : 0}" cy="-15" r="5" fill="${col}"/>` +
      `<path d="${walk ? ICON.walk : ICON.dont}" stroke="${col}" stroke-width="3.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/></g>`;
  }
  const words = h.esc(walk ? (f.walkText ?? 'WALK') : (f.dontText ?? "DON'T WALK"));
  s += `<text x="${n(h, cx)}" y="${top + 79}" text-anchor="middle" font-family="Inter,Arial,sans-serif" font-weight="800" font-size="10.5" letter-spacing="0.4" fill="${on ? col : '#6d635a'}">${words}</text>`;
  return s;
}

// road-sign: a sign on a post. Fields: shape ("round" (default) | "triangle" | "square"), text (use \n for
// two lines), r (size, default 30), pole (default 110), color (border, default red; square default blue),
// fill (default paper white), textColor (default ink), fs (font size; default fits the sign).
export function roadSign(f, t, h) {
  const P = Number.isFinite(f.pole) ? f.pole : 110;
  const r = f.r || 30, shape = f.shape || 'round';
  const ring = f.color || (shape === 'square' ? h.BLUE : '#c0392b');
  const fill = f.fill || (shape === 'square' ? ring : '#fbf6ea');
  const tc = f.textColor || (shape === 'square' ? '#fbf6ea' : h.INK);
  const lines = String(f.text ?? '').split('\n').filter(Boolean);
  let s = pole(h, P + r, 6);
  let cy;
  if (shape === 'triangle') {
    const k = r * 1.25; cy = -P - k * 0.62;
    const pts = (q) => `0,${n(h, cy - q)} ${n(h, q * 0.866)},${n(h, cy + q * 0.5)} ${n(h, -q * 0.866)},${n(h, cy + q * 0.5)}`;
    s += `<polygon points="${pts(k + 4)}" fill="${ring}" stroke="${h.INK}" stroke-width="2" stroke-linejoin="round"/>`;
    s += `<polygon points="${pts(k - 6)}" fill="${fill}" stroke-linejoin="round"/>`;
    cy += k * 0.18;
  } else if (shape === 'square') {
    cy = -P - r;
    s += `<rect x="${-r}" y="${-P - 2 * r}" width="${2 * r}" height="${2 * r}" rx="5" fill="${fill}" stroke="${h.INK}" stroke-width="2"/>`;
    s += `<rect x="${-r + 4}" y="${-P - 2 * r + 4}" width="${2 * r - 8}" height="${2 * r - 8}" rx="3" fill="none" stroke="#fbf6ea" stroke-width="1.6"/>`;
  } else {
    cy = -P - r;
    s += `<circle cx="0" cy="${cy}" r="${r + 1}" fill="${ring}" stroke="${h.INK}" stroke-width="2"/>`;
    s += `<circle cx="0" cy="${cy}" r="${r - 6}" fill="${fill}"/>`;
  }
  if (lines.length) {
    const longest = Math.max(...lines.map((l) => l.length));
    const room = shape === 'triangle' ? r * 1.1 : r * 1.4;
    const fs = f.fs || Math.min(r * 0.62, room / Math.max(1, longest * 0.7), (r * 1.2) / lines.length);
    const y0 = cy - ((lines.length - 1) * fs * 1.05) / 2 + fs * 0.36;
    lines.forEach((l, i) => {
      s += `<text x="0" y="${n(h, y0 + i * fs * 1.05)}" text-anchor="middle" font-family="Inter,Arial,sans-serif" font-weight="800" font-size="${n(h, fs)}" fill="${tc}">${h.esc(l)}</text>`;
    });
  }
  return s;
}
