// Workplace looks (worn) and items (held in the right hand).
// Looks draw in actor-local coordinates: hip at 0,0, facing right (the engine mirrors and scales).

const HIVIS = '#d8e23a', HIVIS_ORANGE = '#f08a24', REFLECT = '#e6e6e6';

// A vest over the torso: from the shoulders to just above the hip, following the spine's lean.
function vestOf(colour) {
  return (f, t, h) => {
    const sh = f.p.sh, sx = sh[0], sy = sh[1];
    const at = (u) => [sx * (1 - u), sy * (1 - u)]; // point on the spine, u = 0 shoulder .. 1 hip
    const [ax, ay] = at(0.02), [bx, by] = at(0.92);
    const P = (pts) => pts.map(([x, y]) => `${h.f1(x)} ${h.f1(y)}`).join(' L ');
    let s = `<path d="M ${P([[ax - 8, ay + 1], [ax + 8, ay + 1], [bx + 10, by], [bx - 10, by]])} Z" fill="${colour}" stroke="${h.INK}" stroke-width="1.6" stroke-linejoin="round"/>`;
    for (const u of [0.45, 0.7]) {
      const [cx, cy] = at(u), hw = 8.6 + 1.4 * u;
      s += `<path d="M ${h.f1(cx - hw)} ${h.f1(cy - 1.6)} L ${h.f1(cx + hw)} ${h.f1(cy - 1.6)} L ${h.f1(cx + hw)} ${h.f1(cy + 1.6)} L ${h.f1(cx - hw)} ${h.f1(cy + 1.6)} Z" fill="${REFLECT}" stroke="${h.INK}" stroke-width="0.8"/>`;
    }
    return s;
  };
}

// A hard hat: a yellow dome with a brim all round.
function hardHat(f, t, h) {
  const [hx, hy] = f.p.head;
  return `<path d="M ${h.f1(hx - 17)} ${h.f1(hy - 8)} Q ${h.f1(hx - 16)} ${h.f1(hy - 31)} ${h.f1(hx)} ${h.f1(hy - 31)} Q ${h.f1(hx + 16)} ${h.f1(hy - 31)} ${h.f1(hx + 17)} ${h.f1(hy - 8)} Z" fill="#f2c230" stroke="${h.INK}" stroke-width="1.6"/>` +
    `<path d="M ${h.f1(hx - 23)} ${h.f1(hy - 8)} L ${h.f1(hx + 25)} ${h.f1(hy - 8)}" stroke="${h.INK}" stroke-width="3.2" stroke-linecap="round"/>` +
    `<path d="M ${h.f1(hx)} ${h.f1(hy - 31)} L ${h.f1(hx)} ${h.f1(hy - 10)}" stroke="${h.INK}" stroke-width="1.2" opacity="0.6"/>`;
}

// A work cap: a coloured cap with its peak to the front.
function workCap(f, t, h) {
  const [hx, hy] = f.p.head;
  return `<path d="M ${h.f1(hx - 17)} ${h.f1(hy - 7)} Q ${h.f1(hx - 14)} ${h.f1(hy - 28)} ${h.f1(hx + 1)} ${h.f1(hy - 27)} Q ${h.f1(hx + 15)} ${h.f1(hy - 26)} ${h.f1(hx + 17)} ${h.f1(hy - 7)} Z" fill="${h.BLUE}" stroke="${h.INK}" stroke-width="1.6"/>` +
    `<path d="M ${h.f1(hx + 12)} ${h.f1(hy - 9)} Q ${h.f1(hx + 26)} ${h.f1(hy - 11)} ${h.f1(hx + 32)} ${h.f1(hy - 6)} L ${h.f1(hx + 14)} ${h.f1(hy - 5)} Z" fill="${h.BLUE}" stroke="${h.INK}" stroke-width="1.6" stroke-linejoin="round"/>`;
}

// A name badge on the chest (front of the torso, just below the shoulder).
function nameBadge(f, t, h) {
  const [sx, sy] = f.p.sh, x = sx * 0.75 + 3, y = sy * 0.75 + 3;
  return `<rect x="${h.f1(x)}" y="${h.f1(y)}" width="10" height="7" rx="1" fill="#fffaf0" stroke="${h.INK}" stroke-width="1"/>` +
    `<rect x="${h.f1(x)}" y="${h.f1(y)}" width="10" height="2.4" fill="${h.RED}"/>` +
    `<line x1="${h.f1(x + 2)}" y1="${h.f1(y + 4.8)}" x2="${h.f1(x + 8)}" y2="${h.f1(y + 4.8)}" stroke="${h.INK}" stroke-width="0.9"/>`;
}

// An apron from chest to knee.
function apron(f, t, h) {
  const [sx, sy] = f.p.sh, lag = f.lag || 0;
  return `<path d="M ${h.f1(sx * 0.8 - 7)} ${h.f1(sy * 0.8)} L ${h.f1(sx * 0.8 + 7)} ${h.f1(sy * 0.8)} L ${h.f1(13 - lag * 0.4)} 32 L ${h.f1(-13 - lag * 0.4)} 32 Z" fill="#3d7a4a" stroke="${h.INK}" stroke-width="1.6" stroke-linejoin="round"/>` +
    `<rect x="-6" y="6" width="12" height="7" fill="none" stroke="${h.INK}" stroke-width="1"/>`;
}

export const looks = {
  vest: { layer: 'body', draw: vestOf(HIVIS) },
  'vest-orange': { layer: 'body', draw: vestOf(HIVIS_ORANGE) },
  'name-badge': { layer: 'body', draw: nameBadge },
  apron: { layer: 'body', draw: apron },
  'hard-hat': { layer: 'head', draw: hardHat },
  'work-cap': { layer: 'head', draw: workCap },
};

// Items: drawn with the hand at 0,0, up is -y.
export const items = {
  // A boxed product held up from the grip.
  product: (f, t, h) => `<rect x="-9" y="-22" width="18" height="22" rx="1.5" fill="${h.RED}" stroke="${f.c}" stroke-width="1.8"/>` +
    `<rect x="-9" y="-15" width="18" height="6" fill="#fffaf0" stroke="${f.c}" stroke-width="1"/>`,
  // A paper shopping bag hanging below the hand.
  'shopping-bag': (f, t, h) => `<path d="M -6 2 Q -6 -6 0 -6 Q 6 -6 6 2" stroke="${f.c}" stroke-width="1.6" fill="none"/>` +
    `<path d="M -11 2 L 11 2 L 13 26 L -13 26 Z" fill="#c9a26b" stroke="${f.c}" stroke-width="1.8" stroke-linejoin="round"/>` +
    `<line x1="-12" y1="8" x2="12" y2="8" stroke="${f.c}" stroke-width="1"/>`,
  // A payment card.
  card: (f, t, h) => `<rect x="-2" y="-14" width="22" height="14" rx="2" fill="${h.BLUE}" stroke="${f.c}" stroke-width="1.6"/>` +
    `<rect x="1" y="-11" width="5" height="4" fill="${h.GOLD}"/>`,
};
