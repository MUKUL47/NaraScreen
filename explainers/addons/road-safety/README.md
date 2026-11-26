# road-safety add-on

Cars, traffic signals, road signs and two road sets for side-view figures scenes. Load it with
`"addons": ["road-safety"]`. A full worked scene is `explainers/examples/road-crossing/scene.json`.

**Scale.** Every prop is drawn at figure scale 1. Give each fx the same `s` as your figures. On a
1920×1080 scene with `ground` 860, the sets use `s` = 2.4 (the default is `h / 450`).

**Floor props.** For a car, a pole or a sign, `y` is the ground line and the prop draws upwards.
`"y": "@light-post"` (any place) puts it on the floor.

## Two views of one road

In side view there are two ways to show the road, and a crossing story needs both:

| View | Set | What it shows | What moves |
|---|---|---|---|
| crossing | `road` | The road as a band between two kerbs, with the zebra on it | A pedestrian walks left to right, from `near-kerb` to `far-kerb` |
| street | `street` | The road along the whole width, with a stop line and then the zebra | Cars drive along it and stop at `stop-line` |

A car cannot drive in the crossing view, and walking left to right in the street view does not read as
crossing. **Cut between the views** with the set's `cuts` option:

```json
"set": { "name": "road", "cuts": [[8, "street"], [17, "road"], [25, "street"]] }
```

- The scene starts in the set's own view (`road` = crossing, `street` = street).
- At each time, it switches to the named view. Use `"road"` (or `"crossing"`) and `"street"`.
- The cut is hard (one frame).
- **The set does not hide your props.** At each cut, hide or show them yourself:
  - for fx, give `t0`/`t1` with `"fade": 0.001`, and start the incoming fx 0.002 s before the cut (e.g. `"t0": 7.998`);
  - for actors, put two `op` keys 0.02 s apart.
- **Both views share one layout**, so every place has the same x in either view. A pedestrian at
  `near-kerb` can stay put across a cut. Signals at `light-post` can stay on screen all the time.

Other set options:
- `s`: the scale.
- `band: [x0, x1]`: the kerb edges. Default `[0.44w, 0.76w]`.
- `stopLine`: the stop line's x. Default `0.36w`.
- `lightPost`: the light post's x. Default `0.85w`.
- `zebra: false`: no zebra.
- `backdrop: false`: no town skyline.
- `seed`: picks a different skyline.

### Places

All places are on the ground line.

| Place | x | Use |
|---|---|---|
| `near-kerb`, `far-kerb` | 30·s outside each kerb edge | Where a pedestrian waits and arrives |
| `crossing` | The middle of the zebra | |
| `stop-line` | The stop line | |
| `light-post` | The signal pole | `traffic-light`, `ped-signal` |
| `car-stop` | A car's anchor when its front bumper is at the stop line | |
| `driver-seat` | The driver's hip x when the car is at `car-stop` | On a driver actor of the set's scale, `"y": "@driver-seat"` puts the hip on the seat |
| `off-left`, `off-right` | Just outside the frame, for a car | |

## fx

| fx | Fields | Notes |
|---|---|---|
| `car` | `color`, `label`, `face`, `brake`, `fs` | Side view. Anchor is the middle of the car on the road; the body reaches ±149·s (bumpers included) and is 118·s tall. Drive it with `k` keys on `x` (see below). Wheels turn with the distance travelled. Brake lights (`brake: "auto"`) glow while it slows and while it stands after a stop; `1`/`0` forces them. `face` is 1 (right) or -1 (left); by default the car faces the way it moves. `label` is a name plate on the driver's door. Use `"front": true`. |
| `traffic-light` | `state`, `pole`, `flash` | A 3-lamp signal. `state` is `red`, `amber`, `green`, `red-amber` or `off`; animate it with `k`. `pole` is the height under the housing (default 240; 0 = housing only). |
| `ped-signal` | `state`, `side`, `pole`, `flash`, `walkText`, `dontText` | A lit figure plus words. `state` is `walk` or `dont`. `side` puts the box beside the pole: 1 right (default), -1 left, 0 on top. `pole` defaults to 150. `flash: 1` blinks it (e.g. a WALK about to end). |
| `road-sign` | `shape`, `text`, `r`, `pole`, `color`, `fill`, `textColor`, `fs` | `shape` is `round` (red ring), `triangle` (warning) or `square` (blue info). `\n` in `text` makes two lines. Text is auto-sized and escaped. |
| `zebra` | `w`, `depth`, `stripe` | Stripes on a road band. Anchor is the middle of the crossing. |
| `stop-line` | `w`, `depth` | The white line on the road. |
| `crossing-view`, `street-view`, `town-backdrop` | | What the sets draw. You can use them directly in a scene with no set. |

**String states switch at the midpoint between two `k` keys.** For a sharp change, put two keys close
together:

```json
"k": [{ "t": 0, "state": "green" }, { "t": 9.6, "state": "green" }, { "t": 9.64, "state": "amber" },
      { "t": 11.0, "state": "amber" }, { "t": 11.04, "state": "red" }]
```

## A car with a driver

The engine eases `k` keys in and out between every pair of keys, so a car slows at every key. One
segment from far off-screen to the stop reads as "arrives at speed, brakes, stops". Put the start far
enough out that the speeding-up half happens off-screen. For example, 4.5 s from x = -1329 to
`@car-stop` at 1920 wide.

The driver is an ordinary actor in a `driving` pose. Its keys must line up with the car's keys:
- the **same `t`** on every key;
- **x = car x + 14·s** (− when the car faces left);
- **no `move`**, so the actor eases exactly like the car;
- `"y": "@driver-seat"`, or `ground − 33·s` as a number.

Keys that only change pose or expression can go anywhere in a segment where the car stands still.

```json
{ "type": "car", "color": "#3f7cac", "s": 2.4, "y": 860, "front": true,
  "k": [{ "t": 8, "x": -1328.8 }, { "t": 12.5, "x": "@car-stop" }] },
{ "label": "DRIVER", "s": 2.4, "keys": [
  { "t": 0, "x": -1295.2, "y": "@driver-seat", "pose": "driving", "face": 1 },
  { "t": 8, "x": -1295.2 },
  { "t": 12.5, "x": "@driver-seat" },
  { "t": 13.0, "pose": "driving_wave", "wiggle": { "p": 0.4, "a": 6 } },
  { "t": 14.6, "pose": "driving", "wiggle": null } ] }
```

The driver's head shows through the windows. Their label sits just above the roof, so put the driver's
bubble above that label.

## Poses

These are listed in `vocab.offGround`, so lint does not call them floating.

| Pose | What |
|---|---|
| `driving` | Seated, hands on the wheel. |
| `driving_wave` | Seated, the near hand raised in the window. Add `wiggle` to wave. |
| `driving_thumbs` | Seated, the near hand up. |
