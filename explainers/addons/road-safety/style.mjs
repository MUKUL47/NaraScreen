// Shared colours and small helpers for the road-safety add-on. Matches the figures paper/ink look:
// warm paper, dark-brown ink outlines, muted fills, rounded joins.
export const C = {
  asphalt: '#5d5852',
  asphaltDark: '#4a4640',
  pave: '#d9cba8',
  paveDark: '#c7b78f',
  kerb: '#cfc8b6',
  paint: '#f4efe2',
  housing: '#3a332b',
  screen: '#1f1b17',
  glass: '#cfe2ea',
  tyre: '#2e2823',
  rim: '#cdc7ba',
  // signal lamps: lit / dim
  red: '#e0442f', redDim: '#5e2b23',
  amber: '#f0a632', amberDim: '#5e4724',
  green: '#3fae68', greenDim: '#24452f',
};

// Numbers in SVG output are rounded like the engine does it (h.f1), so frames stay stable.
export const n = (h, v) => h.f1(v);

// A soft glow: stacked circles, no <defs> (several fx on one frame must not share ids).
export const glow = (h, x, y, r, color, a = 1) =>
  [[2.6, 0.08], [1.9, 0.16], [1.4, 0.3]]
    .map(([k, o]) => `<circle cx="${n(h, x)}" cy="${n(h, y)}" r="${n(h, r * k)}" fill="${color}" opacity="${n(h, o * a)}"/>`)
    .join('');

// Default figure scale for a scene: 2.4 on a 1080-high canvas, 0.89 on figures' 900x400.
export const sceneScale = (spec, opts = {}) =>
  Number.isFinite(opts.s) ? opts.s : Math.round(((spec?.h || 400) / 450) * 100) / 100;
