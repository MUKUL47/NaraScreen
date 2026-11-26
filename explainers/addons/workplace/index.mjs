// Workplace add-on: shop and office props, hi-vis and staff looks, a `shop` set and an `office` set.
// See explainers/addons/README.md for the add-on contract and the vocabulary list in this folder's
// README.md for every name, field and place.
import * as P from './props.mjs';
import { looks, items } from './wear.mjs';

const G = (spec) => spec.ground ?? 355;
// Prop scale: the set's `s`, else the actor scale that suits the scene height (1.3 at h = 400).
const scaleOf = (spec, o) => o.s ?? Math.round(((spec.h || 400) / 400) * 1.3 * 10) / 10;
const r1 = (v) => Math.round(v * 10) / 10;

// ---------- shop ----------
// Options: { s, door, shelf, counter (x positions), shelfSign, pick: [row, slot], pickAt (seconds:
// that shelf item vanishes, as if taken), display (till text), tillOpen: [open, close] (seconds),
// exit (bool), extinguisher (bool) }
function shopLayout(spec, o = {}) {
  const W = spec.w || 900, g = G(spec), s = scaleOf(spec, o);
  const door = o.door ?? r1(W * 0.09), shelf = o.shelf ?? r1(W * 0.34), counter = o.counter ?? r1(W * 0.74);
  return {
    W, g, s, door, shelf, counter,
    till: r1(counter + 40 * s),
    staff: r1(counter - 15 * s),
    customer: r1(counter - 115 * s),
    shelfSpot: r1(shelf + 88 * s),
    tillTop: r1(g - 57 * s),
  };
}

const shop = {
  fx: (spec, o) => {
    const L = shopLayout(spec, o);
    const fx = [
      { type: 'room' },
      { type: 'door', x: L.door, y: L.g, s: r1(L.s * 1.2) },
      { type: 'shelf', x: L.shelf, y: L.g, s: L.s, seed: 7, sign: o.shelfSign ?? '', pick: o.pick, ...(o.pickAt != null ? { k: [{ t: o.pickAt - 0.2, picked: 0 }, { t: o.pickAt, picked: 1 }] } : {}) },
    ];
    if (o.exit ?? true) fx.push({ type: 'exit-sign', x: L.door, y: r1(L.g - 172 * L.s), s: L.s, arrow: -1 });
    if (o.extinguisher ?? true) fx.push({ type: 'extinguisher', x: r1(L.counter + 95 * L.s), y: r1(L.g - 22 * L.s), s: L.s });
    return fx;
  },
  front: (spec, o) => {
    const L = shopLayout(spec, o);
    return [
      { type: 'counter', x: L.counter, y: L.g, s: L.s },
      { type: 'till', x: L.till, y: L.tillTop, s: L.s, display: o.display ?? '', dir: 1,
        ...(Array.isArray(o.tillOpen) ? { k: [{ t: o.tillOpen[0], open: 0 }, { t: o.tillOpen[0] + 0.3, open: 1 }, { t: o.tillOpen[1], open: 1 }, { t: o.tillOpen[1] + 0.3, open: 0 }] } : {}) },
    ];
  },
  places: (spec, o) => {
    const L = shopLayout(spec, o);
    return {
      door: { x: L.door, y: L.g },
      shelf: { x: L.shelfSpot, y: L.g },
      'counter-staff': { x: L.staff, y: L.g },
      'counter-customer': { x: L.customer, y: L.g },
      till: { x: L.till, y: L.tillTop },
    };
  },
};

// ---------- office ----------
// Options: { s, door, whiteboard, desk (x positions), lines (whiteboard text) }
function officeLayout(spec, o = {}) {
  const W = spec.w || 900, g = G(spec), s = scaleOf(spec, o);
  const door = o.door ?? r1(W * 0.08), board = o.whiteboard ?? r1(W * 0.3), desk = o.desk ?? r1(W * 0.68);
  return { W, g, s, door, board, desk, chair: r1(desk - 72 * s) };
}

const office = {
  fx: (spec, o) => {
    const L = officeLayout(spec, o);
    return [
      { type: 'room', wall: '#e9eef0', floor: '#d6cfc0', skirting: '#b8b2a4' },
      { type: 'door', x: L.door, y: L.g, s: r1(L.s * 1.2) },
      { type: 'whiteboard', x: L.board, y: L.g, s: L.s, lines: o.lines ?? [] },
      { type: 'chair', x: L.chair, y: r1(L.g - 30 * L.s), s: L.s, back: -14 },
    ];
  },
  front: (spec, o) => {
    const L = officeLayout(spec, o);
    return [{ type: 'desk', x: L.desk, y: L.g, s: L.s }];
  },
  places: (spec, o) => {
    const L = officeLayout(spec, o);
    return {
      door: { x: L.door, y: L.g },
      whiteboard: { x: r1(L.board + 80 * L.s), y: L.g },
      desk: { x: r1(L.desk + 90 * L.s), y: L.g },
      chair: { x: L.chair, y: L.g },
    };
  },
};

export default {
  name: 'workplace',
  looks,
  items,
  fx: {
    shelf: P.shelf,
    counter: P.counter,
    till: P.till,
    'wet-floor-sign': P.wetFloorSign,
    cone: P.cone,
    extinguisher: P.extinguisher,
    'exit-sign': P.exitSign,
    desk: P.desk,
    whiteboard: P.whiteboard,
    room: P.room,
  },
  sets: { shop, office },
  vocab: { offGround: [] },
};
