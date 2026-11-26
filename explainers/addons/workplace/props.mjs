// Workplace props (fx). Sizes are in figure units: a standing figure at s = 1 is about 130 units
// tall, like the built-in door. Give each prop the same `s` as the actors around it.
// Floor props have their anchor (x, y) on the floor and draw upwards. exit-sign anchors at its
// centre, because it hangs on a wall. room draws in scene coordinates (wrap: false).

const PALETTE = ['#a8322d', '#4f7fa3', '#c08a2e', '#3d7a4a', '#c46a3a', '#7a5a9a', '#d9c49c'];
const WOOD = '#b98a56', WOOD_DARK = '#8a6a45', HIVIS = '#f2c230', ORANGE = '#e8702a', EXIT_GREEN = '#2e8b57';

const rect = (h, x, y, w, ht, fill, extra = '') =>
  `<rect x="${h.f1(x)}" y="${h.f1(y)}" width="${h.f1(w)}" height="${h.f1(ht)}" fill="${fill}" stroke="${h.INK}" stroke-width="2" ${extra}/>`;

// One shelf item, standing on y = 0, centred on x. kind: 0 box, 1 can, 2 bottle.
function good(h, kind, x, w, ht, col) {
  if (kind === 0) return rect(h, x - w / 2, -ht, w, ht, col, 'stroke-width="1.5"') +
    `<line x1="${h.f1(x - w / 2 + 2)}" y1="${h.f1(-ht * 0.6)}" x2="${h.f1(x + w / 2 - 2)}" y2="${h.f1(-ht * 0.6)}" stroke="#fffaf0" stroke-width="1.5"/>`;
  if (kind === 1) return rect(h, x - w * 0.4, -ht * 0.75, w * 0.8, ht * 0.75, col, 'rx="2" stroke-width="1.5"') +
    `<line x1="${h.f1(x - w * 0.4)}" y1="${h.f1(-ht * 0.45)}" x2="${h.f1(x + w * 0.4)}" y2="${h.f1(-ht * 0.45)}" stroke="#fffaf0" stroke-width="2"/>`;
  const bw = w * 0.35;
  return `<path d="M ${h.f1(x - bw)} 0 V ${h.f1(-ht * 0.55)} Q ${h.f1(x - bw)} ${h.f1(-ht * 0.75)} ${h.f1(x - bw * 0.4)} ${h.f1(-ht * 0.8)} V ${h.f1(-ht)} H ${h.f1(x + bw * 0.4)} V ${h.f1(-ht * 0.8)} Q ${h.f1(x + bw)} ${h.f1(-ht * 0.75)} ${h.f1(x + bw)} ${h.f1(-ht * 0.55)} V 0 Z" fill="${col}" stroke="${h.INK}" stroke-width="1.5"/>`;
}

// shelf {w, h, rows, seed, sign, pick: [row, slot], picked (0..1, animatable)}
// Rows count from the bottom (row 0 is the floor-level shelf); slots from the left, or from the
// right when negative (-1 = last). The picked item is drawn in pickColor and fades out as picked → 1.
export function shelf(f, t, h) {
  const w = f.w ?? 120, ht = f.h ?? 130, rows = f.rows ?? 4, seed = f.seed ?? 7;
  const pick = Array.isArray(f.pick) ? f.pick : null, picked = h.cl(h.kv(f, t, 'picked', 0));
  const step = ht / rows;
  let s = rect(h, -w / 2 - 4, -ht - 4, w + 8, ht + 4, '#e9dcc0');
  for (let r = 0; r < rows; r++) {
    const base = -r * step - 4, room = step - 8, row = [];
    let x = -w / 2 + 4;
    for (let slot = 0; ; slot++) {
      const gw = 12 + 8 * h.hsh(seed + r, slot + 11);
      if (x + gw > w / 2 - 3) break;
      row.push({ x: x + gw / 2, gw, slot });
      x += gw + 3;
    }
    // A negative pick slot counts from the right (-1 = the last item on that row).
    const pickSlot = pick && pick[0] === r ? (pick[1] < 0 ? row.length + pick[1] : pick[1]) : -1;
    for (const { x: cx, gw, slot } of row) {
      const kind = Math.floor(h.hsh(seed + r * 31, slot * 7 + 3) * 3);
      const gh = room * (0.55 + 0.4 * h.hsh(seed + slot, r + 5));
      const col = PALETTE[Math.floor(h.hsh(seed * 3 + r, slot * 5) * PALETTE.length)];
      const isPick = slot === pickSlot, op = isPick ? 1 - picked : 1;
      if (op > 0.01) s += `<g transform="translate(0 ${h.f1(base)})" opacity="${h.f1(op)}">${good(h, kind, cx, gw, gh, isPick ? (f.pickColor || h.RED) : col)}</g>`;
    }
  }
  for (let r = 0; r <= rows; r++) s += rect(h, -w / 2 - 6, -r * step - 4, w + 12, 4, WOOD_DARK, 'stroke-width="1.5"');
  s += rect(h, -w / 2 - 8, -ht - 6, 6, ht + 6, WOOD) + rect(h, w / 2 + 2, -ht - 6, 6, ht + 6, WOOD);
  if (f.sign) {
    const sw = Math.max(50, String(f.sign).length * 7 + 16);
    s += rect(h, -sw / 2, -ht - 26, sw, 16, '#fffaf0', 'rx="3"') +
      `<text x="0" y="${h.f1(-ht - 14)}" text-anchor="middle" font-family="Georgia,serif" font-weight="700" font-size="11" fill="${h.INK}">${h.esc(f.sign)}</text>`;
  }
  return s;
}

// counter {w, h}: a shop counter, about hip high (h 50; its top is h + 7 above the anchor). Use it as a front fx so the person behind it is
// hidden from the waist down (the shop set does this for you).
export function counter(f, t, h) {
  const w = f.w ?? 130, ht = f.h ?? 50;
  // The front panel runs 5 units below the anchor: the counter is nearer the viewer than the feet
  // behind it, and this also covers their ground shadow.
  let s = rect(h, -w / 2, -ht, w, ht + 5, f.color || WOOD);
  const n = Math.max(2, Math.round(w / 45));
  for (let i = 0; i < n; i++) {
    const pw = (w - 12) / n;
    s += rect(h, -w / 2 + 6 + i * pw + 3, -ht + 12, pw - 6, ht - 16, 'none', `stroke="${WOOD_DARK}" stroke-width="1.5"`);
  }
  s += rect(h, -w / 2 - 6, -ht - 7, w + 12, 8, WOOD_DARK, 'rx="2"');
  return s;
}

// till {display, open (0..1, animatable), dir (1 drawer slides right, -1 left)}: a cash register.
// Its anchor is the bottom of the till: put y on the counter top (counter y − (counter h + 7) · s).
export function till(f, t, h) {
  const open = h.cl(h.kv(f, t, 'open', 0)), dir = f.dir ?? -1;
  let s = rect(h, -16 + dir * open * 12, -8, 32, 8, '#6b6b6b', 'rx="1"');
  s += `<path d="M -18 -8 L -15 -26 L 15 -26 L 18 -8 Z" fill="#8a8a8a" stroke="${h.INK}" stroke-width="2" stroke-linejoin="round"/>`;
  for (let i = 0; i < 3; i++) for (let j = 0; j < 4; j++) s += `<rect x="${h.f1(-11 + j * 6)}" y="${h.f1(-23 + i * 5)}" width="4" height="3" fill="#efe3c6"/>`;
  s += `<line x1="0" y1="-26" x2="0" y2="-32" stroke="${h.INK}" stroke-width="2"/>`;
  s += `<g transform="rotate(${-8 * dir} 0 -38)">${rect(h, -15, -44, 30, 13, '#23302a', 'rx="2"')}` +
    `<text x="0" y="-34.5" text-anchor="middle" font-family="monospace" font-weight="700" font-size="8" fill="#9be37a">${h.esc(f.display ?? '')}</text></g>`;
  return s;
}

// wet-floor-sign {text}: a yellow A-frame caution sign.
export function wetFloorSign(f, t, h) {
  const text = h.esc(f.text ?? 'WET FLOOR');
  return `<path d="M -20 0 L -12 -58 L 12 -58 L 20 0" fill="${HIVIS}" stroke="${h.INK}" stroke-width="2" stroke-linejoin="round"/>` +
    `<path d="M 0 -50 L 9 -34 L -9 -34 Z" fill="#fffaf0" stroke="${h.INK}" stroke-width="1.5" stroke-linejoin="round"/>` +
    `<text x="0" y="-36" text-anchor="middle" font-family="Georgia,serif" font-weight="700" font-size="10" fill="${h.INK}">!</text>` +
    `<text x="0" y="-14" text-anchor="middle" font-family="Georgia,serif" font-weight="700" font-size="6" textLength="${h.f1(Math.min(30, String(f.text ?? 'WET FLOOR').length * 3.4))}" lengthAdjust="spacingAndGlyphs" fill="${h.INK}">${text}</text>`;
}

// cone: an orange traffic cone with reflective bands.
export function cone(f, t, h) {
  return `<path d="M -16 0 L 16 0 L 16 -4 L -16 -4 Z" fill="${f.color || ORANGE}" stroke="${h.INK}" stroke-width="2"/>` +
    `<path d="M -11 -4 L -3 -38 L 3 -38 L 11 -4 Z" fill="${f.color || ORANGE}" stroke="${h.INK}" stroke-width="2" stroke-linejoin="round"/>` +
    `<path d="M -8.2 -16 L -6.4 -24 L 6.4 -24 L 8.2 -16 Z" fill="#fffaf0"/>` +
    `<path d="M -5 -29 L -4 -33 L 4 -33 L 5 -29 Z" fill="#fffaf0"/>`;
}

// extinguisher: a red fire extinguisher standing on the floor (raise y to hang it on a wall).
export function extinguisher(f, t, h) {
  return rect(h, -7, -38, 14, 38, f.color || h.RED, 'rx="6"') +
    rect(h, -3, -44, 6, 6, h.INK) +
    `<path d="M -2 -44 L -10 -48" stroke="${h.INK}" stroke-width="2.5" stroke-linecap="round"/>` +
    `<path d="M 3 -42 Q 14 -40 12 -24 Q 11 -14 8 -10" stroke="${h.INK}" stroke-width="2" fill="none" stroke-linecap="round"/>` +
    rect(h, -7, -26, 14, 8, '#fffaf0', 'stroke-width="1"');
}

// exit-sign {text, arrow: 1 | -1 | 0}: a green wall sign. Its anchor is the sign's centre.
export function exitSign(f, t, h) {
  const text = h.esc(f.text ?? 'EXIT'), dir = f.arrow ?? 1;
  const man = `<g transform="translate(-21 0)" stroke="#fffaf0" stroke-width="1.6" fill="none" stroke-linecap="round">` +
    `<circle cx="1" cy="-6" r="1.8" fill="#fffaf0"/><line x1="0" y1="-4" x2="-1" y2="2"/><path d="M -1 2 L -4 6 M -1 2 L 3 5"/><path d="M 0 -3 L -4 -1 M 0 -3 L 4 -1"/></g>`;
  const arrow = dir ? `<path d="M ${17 * dir} 0 h ${6 * dir} M ${21 * dir} -3 L ${24 * dir} 0 L ${21 * dir} 3" stroke="#fffaf0" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>` : '';
  return rect(h, -30, -10, 60, 20, EXIT_GREEN, 'rx="2"') + man + arrow +
    `<text x="${dir < 0 ? 2 : -2}" y="4" text-anchor="middle" font-family="Georgia,serif" font-weight="700" font-size="11" fill="#fffaf0">${text}</text>`;
}

// desk {w, h, monitor}: an office desk with a drawer pedestal and an optional monitor.
export function desk(f, t, h) {
  const w = f.w ?? 120, ht = f.h ?? 50;
  let s = rect(h, w / 2 - 38, -ht, 34, ht, WOOD);
  for (let i = 0; i < 3; i++) s += `<line x1="${h.f1(w / 2 - 38)}" y1="${h.f1(-ht + (i + 1) * ht / 3)}" x2="${h.f1(w / 2 - 4)}" y2="${h.f1(-ht + (i + 1) * ht / 3)}" stroke="${h.INK}" stroke-width="1.5"/>` +
    `<line x1="${h.f1(w / 2 - 25)}" y1="${h.f1(-ht + i * ht / 3 + 8)}" x2="${h.f1(w / 2 - 17)}" y2="${h.f1(-ht + i * ht / 3 + 8)}" stroke="${h.INK}" stroke-width="2"/>`;
  s += `<line x1="${h.f1(-w / 2 + 6)}" y1="${h.f1(-ht)}" x2="${h.f1(-w / 2 + 6)}" y2="0" stroke="${h.INK}" stroke-width="3"/>`;
  s += rect(h, -w / 2, -ht - 6, w, 6, WOOD_DARK, 'rx="2"');
  if (f.monitor ?? true) {
    s += `<line x1="${h.f1(w / 2 - 30)}" y1="${h.f1(-ht - 6)}" x2="${h.f1(w / 2 - 30)}" y2="${h.f1(-ht - 16)}" stroke="${h.INK}" stroke-width="3"/>` +
      rect(h, w / 2 - 48, -ht - 44, 36, 28, '#23302a', 'rx="2"') +
      `<rect x="${h.f1(w / 2 - 44)}" y="${h.f1(-ht - 40)}" width="28" height="20" fill="#4f7fa3" opacity="0.6"/>`;
  }
  return s;
}

// whiteboard {w, h, lines: ["..."], color}: a whiteboard on a stand, standing on the floor.
export function whiteboard(f, t, h) {
  const w = f.w ?? 110, ht = f.h ?? 70, top = -40 - ht;
  let s = `<path d="M -30 0 L -26 ${-40} M 30 0 L 26 ${-40} M -38 0 H -22 M 22 0 H 38" stroke="${h.INK}" stroke-width="3" stroke-linecap="round"/>`;
  s += rect(h, -w / 2, top, w, ht, '#fbfbf6', 'rx="2"') + rect(h, -w / 2 + 10, -42, w - 20, 4, '#9a9a9a');
  (f.lines || []).slice(0, 5).forEach((ln, i) => {
    s += `<text x="${h.f1(-w / 2 + 8)}" y="${h.f1(top + 16 + i * 13)}" font-family="Comic Sans MS,Georgia,sans-serif" font-weight="700" font-size="10" fill="${f.color || h.BLUE}">${h.esc(ln)}</text>`;
  });
  return s;
}

// room {wall, floor, skirting}: back wall down to the ground line and a tiled floor below it, full
// width. Drawn in scene coordinates; put it first so everything else sits on top.
export const room = {
  wrap: false,
  draw(f, t, h) {
    const W = h.W, H = h.H, g = h.ground, op = h.f1(h.op);
    let s = `<g opacity="${op}"><rect x="0" y="0" width="${W}" height="${h.f1(g)}" fill="${f.wall || '#f3ead6'}"/>` +
      `<rect x="0" y="${h.f1(g)}" width="${W}" height="${h.f1(H - g)}" fill="${f.floor || '#e2d3b2'}"/>` +
      `<rect x="0" y="${h.f1(g - 14)}" width="${W}" height="14" fill="${f.skirting || '#c9b48a'}"/>` +
      `<line x1="0" y1="${h.f1(g)}" x2="${W}" y2="${h.f1(g)}" stroke="${h.INK}" stroke-width="2"/>`;
    const tile = f.tile ?? 120;
    for (let x = tile; x < W + H; x += tile) {
      s += `<line x1="${h.f1(x)}" y1="${h.f1(g)}" x2="${h.f1(x - (H - g) * 0.6)}" y2="${H}" stroke="#cdbb95" stroke-width="2"/>`;
    }
    for (let y = g + (H - g) / 2.5; y < H; y += (H - g) / 2.5) s += `<line x1="0" y1="${h.f1(y)}" x2="${W}" y2="${h.f1(y)}" stroke="#cdbb95" stroke-width="2"/>`;
    return s + '</g>';
  },
};
