// road-safety: cars, signals, signs and the road / street sets for figures scenes.
// Vocabulary and recipes: README.md in this folder. Contract: explainers/addons/README.md.
import { car } from './car.mjs';
import { trafficLight, pedSignal, roadSign } from './signals.mjs';
import { zebra, stopLine, crossingView, streetView, townBackdrop, sets } from './road.mjs';

// Seated behind the wheel (facing right). Feet are hidden by the car body, so these are off-ground.
const wheel = { la: [[16, -20], [30, -28]], ra: [[18, -18], [32, -26]], ll: [[22, -4], [42, 8]], rl: [[24, -2], [44, 10]] };

export default {
  name: 'road-safety',
  poses: {
    driving: { neck: [0, -42], head: [-1, -60], ...wheel },
    driving_wave: { neck: [0, -42], head: [-1, -60], ...wheel, ra: [[26, -46], [30, -70]] },
    driving_thumbs: { neck: [0, -42], head: [-1, -60], ...wheel, ra: [[26, -42], [30, -60]] },
  },
  fx: {
    car,
    'traffic-light': trafficLight,
    'ped-signal': pedSignal,
    'road-sign': roadSign,
    zebra,
    'stop-line': stopLine,
    'crossing-view': crossingView,
    'street-view': streetView,
    'town-backdrop': townBackdrop,
  },
  sets,
  vocab: { offGround: ['driving', 'driving_wave', 'driving_thumbs'] },
};
