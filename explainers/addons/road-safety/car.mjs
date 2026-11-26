// car: a side-view hatchback, drawn at figure scale 1 (set the fx "s" to your figures' scale).
// Anchor: x = the middle of the car, y = the road surface (the ground line). Drive it with "k" keys on x.
//
// Fields: color, label (a name plate on the driver's door), face (1 right, -1 left; default: the way it
// moves), brake ("auto" | 1 | 0; auto = lit while slowing down and while standing after a stop).
// Wheels turn by the distance travelled. Use "front": true so the body covers a driver actor.
import { C, n, glow } from './style.mjs';

export const CAR = Object.freeze({
  half: 142,            // half the body length (front bumper at x + 146*s)
  wheelR: 22, wheelX: 88,
  seat: { dx: 14, dy: -33 }, // driver's hip relative to the anchor, facing right
});

const BODY = 'M -134 -22 L 134 -22 Q 142 -22 142 -32 L 142 -48 Q 140 -62 124 -66 L 76 -72 L 50 -112 Q 45 -118 36 -118 ' +
  'L -60 -118 Q -70 -118 -76 -112 L -108 -74 L -128 -70 Q -140 -66 -140 -54 L -140 -30 Q -140 -22 -134 -22 Z';
const WIN_F = 'M -6 -78 L 70 -78 L 48 -108 Q 45 -112 39 -112 L -6 -112 Z';
const WIN_R = 'M -14 -78 L -14 -112 L -58 -112 Q -64 -112 -68 -107 L -96 -78 Z';

const sign = (v) => (v < 0 ? -1 : 1);

// Did the car come to rest after moving? (Brake lights stay on while it waits.)
function stoppedAfterMove(f, t, h) {
  const K = Array.isArray(f.k) ? f.k : null;
  if (!K || K.length < 2) return false;
  let j = -1;
  for (let i = 0; i < K.length; i++) if (K[i].t <= t) j = i;
  for (let i = j; i >= 1; i--) {
    if (Math.abs(h.kv(f, K[i].t, 'x', 0) - h.kv(f, K[i - 1].t, 'x', 0)) > 1) return true;
  }
  return false;
}

function wheel(h, x, ang) {
  const spokes = [0, 72, 144, 216, 288].map((a) => {
    const r = ((a + ang) * Math.PI) / 180;
    return `<line x1="${n(h, x + 4 * Math.cos(r))}" y1="${n(h, -22 + 4 * Math.sin(r))}" x2="${n(h, x + 11 * Math.cos(r))}" y2="${n(h, -22 + 11 * Math.sin(r))}" stroke="${h.INK}" stroke-width="2" stroke-linecap="round"/>`;
  }).join('');
  return `<circle cx="${x}" cy="-22" r="22" fill="${C.tyre}" stroke="${h.INK}" stroke-width="3"/>` +
    `<circle cx="${x}" cy="-22" r="12.5" fill="${C.rim}" stroke="${h.INK}" stroke-width="1.6"/>${spokes}` +
    `<circle cx="${x}" cy="-22" r="3" fill="${h.INK}"/>`;
}

export function car(f, t, h) {
  const S = h.s || 1, X = h.x;
  const xAt = (tt) => h.kv(f, tt, 'x', 0);
  const xp = xAt(t - 0.05), xpp = xAt(t - 0.1);
  const v = (X - xp) / 0.05 / S, vp = (xp - xpp) / 0.05 / S; // local units per second
  const speed = Math.abs(v), acc = (speed - Math.abs(vp)) / 0.05;

  // facing
  const fv = h.kv(f, t, 'face', null);
  let dir;
  if (typeof fv === 'number' && fv !== 0) dir = sign(fv);
  else if (speed > 1) dir = sign(v);
  else {
    const K = Array.isArray(f.k) ? f.k : [];
    dir = K.length > 1 ? sign(xAt(K[K.length - 1].t) - xAt(K[0].t) || 1) : 1;
  }

  // brake lights
  const bv = h.kv(f, t, 'brake', 'auto');
  let brake;
  if (bv === true || (typeof bv === 'number' && bv > 0.5)) brake = true;
  else if (bv === false || bv === 0 || (typeof bv === 'number' && bv <= 0.5)) brake = false;
  else brake = (acc < -25 && Math.abs(vp) > 3) || (speed < 1 && stoppedAfterMove(f, t, h));

  // wheel spin from distance travelled; mirrored when facing left, so multiply by dir
  const x0 = xAt(-1e9);
  const ang = ((dir * (X - x0)) / (CAR.wheelR * S)) * (180 / Math.PI);

  // body life: a little road shake when moving, nose dips when braking
  const bob = speed > 2 ? 0.7 * h.nz(7.3, t * 9) * Math.min(1, speed / 150) : 0;
  const pitch = h.cl(-acc / 140, -1.6, 1.6);

  const color = f.color || h.BLUE;
  const tail = brake ? C.red : C.redDim;

  let speedLines = '';
  if (speed > 140) {
    const a = h.cl((speed - 140) / 400);
    speedLines = [[-44, 1], [-70, 0.7], [-96, 0.85]].map(([y, k], i) => {
      const len = (40 + 90 * a) * k, x1 = -156 - 8 * i;
      return `<line x1="${n(h, x1)}" y1="${y}" x2="${n(h, x1 - len)}" y2="${y}" stroke="${h.INK}" stroke-width="3" stroke-linecap="round" opacity="${n(h, 0.45 * a)}"/>`;
    }).join('');
  }

  const body =
    `<path d="${BODY} ${WIN_F} ${WIN_R}" fill="${color}" fill-rule="evenodd" stroke="${h.INK}" stroke-width="3" stroke-linejoin="round"/>` +
    `<path d="${WIN_F} ${WIN_R}" fill="${C.glass}" opacity="0.2"/>` +
    `<path d="${WIN_F} ${WIN_R}" fill="none" stroke="${h.INK}" stroke-width="2.2" stroke-linejoin="round"/>` +
    `<path d="M -80 -84 L -72 -96" stroke="#ffffff" stroke-width="3" stroke-linecap="round" opacity="0.55"/>` +
    `<line x1="-138" y1="-42" x2="141" y2="-42" stroke="${h.INK}" stroke-width="1.6" opacity="0.25"/>` +
    `<path d="M -10 -78 L -10 -26 M 72 -72 Q 76 -48 70 -26 M -100 -74 Q -104 -50 -98 -26" stroke="${h.INK}" stroke-width="1.6" fill="none" opacity="0.4"/>` +
    `<rect x="2" y="-68" width="15" height="4" rx="2" fill="${h.INK}" opacity="0.6"/><rect x="-86" y="-68" width="15" height="4" rx="2" fill="${h.INK}" opacity="0.6"/>` +
    `<path d="M 132 -61 Q 141 -59 141 -50 L 132 -50 Z" fill="#fbeaa6" stroke="${h.INK}" stroke-width="1.6" stroke-linejoin="round"/>` +
    `<rect x="-143" y="-65" width="7" height="17" rx="2" fill="${tail}" stroke="${h.INK}" stroke-width="1.4"/>` +
    (brake ? glow(h, -141, -56, 9, C.red, 1) : '') +
    `<path d="M 134 -40 L 145 -40 Q 149 -40 149 -36 L 149 -28 Q 149 -24 145 -24 L 134 -24 Z" fill="#3d362f" stroke="${h.INK}" stroke-width="2" stroke-linejoin="round"/>` +
    `<path d="M -134 -40 L -145 -40 Q -149 -40 -149 -36 L -149 -28 Q -149 -24 -145 -24 L -134 -24 Z" fill="#3d362f" stroke="${h.INK}" stroke-width="2" stroke-linejoin="round"/>` +
    [-88, 88].map((x) => `<path d="M ${x - 29} -22 A 29 29 0 0 1 ${x + 29} -22 Z" fill="${h.INK}" opacity="0.85"/>`).join('');

  let out = `<ellipse cx="0" cy="1" rx="152" ry="7" fill="${h.INK}" opacity="0.16"/>` +
    `<g transform="scale(${dir} 1)">${speedLines}` +
    `<g transform="translate(0 ${n(h, bob)}) rotate(${n(h, pitch)} 0 -22)">${body}</g>` +
    wheel(h, -88, ang) + wheel(h, 88, ang) + '</g>';

  if (f.label) {
    const text = h.esc(f.label), fs = f.fs || 14, w = String(f.label).length * fs * 0.74 + 14, cx = dir * 30;
    out += `<g transform="translate(0 ${n(h, bob)})"><rect x="${n(h, cx - w / 2)}" y="${n(h, -60 - fs * 0.95)}" width="${n(h, w)}" height="${n(h, fs * 1.35)}" rx="${n(h, fs * 0.4)}" fill="#f6ecd4" stroke="${h.INK}" stroke-width="1.2" opacity="0.95"/>` +
      `<text x="${n(h, cx)}" y="${n(h, -60)}" text-anchor="middle" font-family="Cinzel,Georgia,serif" font-weight="700" font-size="${fs}" letter-spacing="1.5" fill="${f.labelColor || h.RED}">${text}</text></g>`;
  }
  return out;
}
