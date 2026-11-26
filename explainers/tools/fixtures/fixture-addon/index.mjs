// Test fixture add-on for addons.test.mjs: one of everything, each drawing a data-fixture marker.
import { marker } from './helpers.mjs';

export default {
  name: 'fixture',
  poses: {
    fixture_salute: { ra: [[14, -50], [4, -62]] }, // partial pose: other joints come from standing
  },
  exprs: {
    fixture_wince: {
      brow: 0.7, m: -0.4, e: 0.5,
      mark: (f, t, h) => `<circle ${marker('mark')} cx="${h.f1(f.head[0] + 22)}" cy="${h.f1(f.head[1] - 10)}" r="3" fill="${h.BLUE}"/>`,
    },
  },
  items: {
    fixture_flag: (f, t, h) => `<g ${marker('item')}><line x1="0" y1="0" x2="0" y2="-40" stroke="${f.c}" stroke-width="2"/><rect x="0" y="-40" width="22" height="14" fill="${h.RED}"/></g>`,
  },
  looks: {
    fixture_band: { layer: 'head', draw: (f, t, h) => `<rect ${marker('look-head')} x="${h.f1(f.p.head[0] - 18)}" y="${h.f1(f.p.head[1] - 10)}" width="36" height="5" fill="${h.GOLD}"/>` },
    fixture_sash: (f, t, h) => `<line ${marker('look-body')} x1="${h.f1(f.p.sh[0] - 6)}" y1="${h.f1(f.p.sh[1])}" x2="6" y2="-4" stroke="${h.BLUE}" stroke-width="4"/>`,
  },
  fx: {
    fixture_box: (f, t, h) => `<rect ${marker('fx')} x="-20" y="-40" width="40" height="40" fill="${f.color || h.GOLD}" stroke="${h.INK}" stroke-width="2"/>`,
    fixture_wash: {
      layer: 'overlay', wrap: false,
      draw: (f, t, h) => `<rect ${marker('wash')} x="0" y="0" width="${h.W}" height="${h.H}" fill="#ff00ff" opacity="${h.op}"/>`,
    },
  },
  sets: {
    fixture_stage: {
      fx: [{ type: 'fixture_box', x: '@right-150', y: '@right', color: '#3d7a4a' }],
      front: (spec) => [{ type: 'fixture_box', x: (spec.w || 900) - 60, y: spec.ground ?? 355, s: 0.5 }],
      places: (spec) => ({ left: { x: 200, y: spec.ground ?? 355 }, right: { x: 700, y: spec.ground ?? 355 } }),
    },
  },
  vocab: { offGround: [] },
};
