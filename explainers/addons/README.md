# Figures add-ons

An add-on adds names to the figures engine without editing it. It can add:
- poses, expressions, held items and looks;
- fx (props and effects);
- sets: a background, a foreground and named places.

A scene lists the add-ons it uses:

```json
{ "addons": ["road-safety", "./my-props.mjs"], "set": "road", "actors": [ ... ], "fx": [ ... ] }
```

- **A bare name** (`road-safety`) loads `explainers/addons/<name>/index.mjs`, from the base library in this folder.
- **Anything else** is a path relative to the scene file: a `.mjs` file, or a folder that contains `index.mjs`.

Built-in names always win. An add-on may not reuse a built-in name; the loader refuses one that does. Two add-ons in the same scene may not define the same name either. An unknown name still falls back exactly as before: poses fall back to `standing`, expressions to `neutral`, and items, looks and fx to nothing. Lint catches unknown names.

The tools:
- `node explainers/tools/lint.mjs scene.json` checks the scene against the built-in vocabulary plus its add-ons' vocabulary.
- `explainers/tools/render.mjs` loads the add-ons into both Chromium and Node, so renders, stills and `--map` all use them.
- The engine side (`FIGURES.extend`) is a small marked patch to the vendored `figures.js`. See `explainers/vendor/figures/VENDORED.md`.

## The module

An add-on is an ES module whose default export is a plain object:

```js
export default {
  name: 'my-props',          // required, unique
  poses: { ... },            // name -> joints
  exprs: { ... },            // name -> face parameters (+ optional mark drawer)
  items: { ... },            // name -> drawer
  looks: { ... },            // name -> drawer | { layer, draw }
  fx:    { ... },            // name -> drawer | { layer, wrap, draw }
  sets:  { ... },            // name -> { fx, front, places }
  vocab: { offGround: [] },  // optional hints for lint.mjs
};
```

**Rules**, because the same module runs in Node (lint, `--map`) and in headless Chromium (the frames):
- **Browser-safe JS only.** No `node:` imports and no npm packages. Relative imports of your own `.mjs`/`.js` files are fine; the page loader serves them from disk.
- **Drawers are pure functions of their arguments.** Every frame is `FIGURES.svg(spec, t)`, so the same `t` must give the same SVG: no `Math.random()`, `Date` or module-level state. For deterministic noise use `h.hsh` or `h.nz`.
- **Drawers return an SVG markup string.** Returning `''`, `null` or `undefined` draws nothing.
- **Escape any text that comes from the scene** with `h.esc(...)`. The engine inserts text unescaped.

## Coordinates

- The scene is `w`×`h` units (default 900×400), with y pointing down. The ground line is `spec.ground` (default 355).
- An actor's `x`,`y` is its **hip**. A standing figure of scale `s` has its hip at `ground − 53·s` and its head centre about 60·s above the hip.
- Actors and ordinary fx are drawn inside a gentle camera drift (zoom up to 1.6%). `layer: 'overlay'` fx are not.

## Drawers and their arguments

Every drawer is called as `draw(f, t, h)`:
- `t` is the scene time in seconds.
- `h` is the helper object described below.
- `f` depends on the kind: for fx it is the scene's fx object itself; for the other kinds it is a small context object.

### `poses`: `name -> joints`

This uses the same joint format as the built-ins in `vendor/figures/figures.js` (`POSES`):
- Coordinates are relative to the hip at `0,0`, with y negative upwards, facing right.
- `neck` and `head` are `[x, y]`.
- `la` and `ra` (left and right arm) are `[[elbowX, elbowY], [handX, handY]]`.
- `ll` and `rl` (legs) are `[[kneeX, kneeY], [footX, footY]]`.
- Joints you leave out come from `standing`: `neck [0,-42]`, `head [0,-60]`, `la [[-18,-17],[-20,0]]`, `ra [[18,-17],[20,0]]`, `ll [[-15,35],[-20,53]]`, `rl [[15,35],[20,53]]`.
- Feet at y = 53 stand on the ground.
- Held items attach to the `ra` hand.

The engine springs between poses, so a new pose blends in like a built-in one. Add any pose whose feet are not at y = 53 (sitting in a car, lying down) to `vocab.offGround`. Lint will then not warn that the figure is floating.

### `exprs`: `name -> face parameters`

Expressions are parameter sets, not drawings, so they blend smoothly with the built-ins. Missing fields come from `neutral`.

| Field | Meaning | neutral |
|---|---|---|
| `brow` | brow angle: + angry, − worried | 0 |
| `by` | brow lift (negative = raised) | 0 |
| `m` | mouth curve: + smile, − frown | 0.1 |
| `o` | mouth open, 0..1 | 0 |
| `e` | eye open, 0..1.3 | 1 |
| `arc` | closed happy eyes, 0/1 | 0 |
| `sk` | smirk skew | 0 |
| `r` | eye radius | 2 |

You can add an optional `mark: (f, t, h) => svg`, drawn while the expression is active. It works like the engine's automatic marks (sweat drop, anger vein):
- `f = { type, head: [hx, hy], since, c }`.
- `head` is the head centre in actor-local coordinates.
- `since` is the number of seconds since the expression finished blending in. It is negative while blending.
- `c` is the ink colour.

### `items`: `name -> draw(f, t, h)`

Items are held in the right hand.
- `f = { type, rot, c }`.
- Draw with the **hand at `0,0`**. The engine applies the hand position and the rotation (`irot` on the key, plus follow-through).
- Up is −y. Built-in items mostly extend upwards from the grip.

### `looks`: `name -> draw(f, t, h)` or `{ layer, draw }`

Looks are accessories listed in an actor's `look` array. The layer decides when the look is drawn:
- `'body'` (default): after the legs and spine, before the arms, so arms go over it. For vests, sashes and badges.
- `'behind'`: before the legs. For skirts, capes and backpacks.
- `'head'`: in the hat group, which lags with head follow-through. For hats and hair.

`f = { type, layer, p, c, lag, state }`:
- `p` holds the actor's joints for this frame, in actor-local coordinates (hip `0,0`, facing right; the engine mirrors for `face: -1` and applies the scale): `p.neck`, `p.head`, `p.sh` (shoulder point), `p.la`/`p.ra` (`[elbow, hand]`) and `p.ll`/`p.rl` (`[knee, foot]`).
- `lag` is the follow-through offset, between −12 and 12. Use it to make cloth swing.
- `state` is the engine's resolved key state at `t`.

A label above a tall hat may collide with it. Lift the label with `labelDy` on the actor.

### `fx`: `name -> draw(f, t, h)` or `{ layer, wrap, draw }`

`f` is the fx object from the scene.

**Timing and position are handled for you:**
- `t0`/`t1`/`fade` set the window (fade in and out).
- `x`, `y`, `s` and `op` follow the fx's `k` keyframes (eased).
- `front: true` draws the fx in front of the actors.

**`wrap` and `layer`:**
- By default (`wrap: true`), draw with the fx's anchor at `0,0`. The engine wraps your markup in `translate(x y) scale(s)` with the window opacity.
- `wrap: false` puts you in scene coordinates, and you apply `h.op` yourself.
- `layer: 'overlay'` draws the fx after the actors and outside the camera drift, like `tint`, `night` and `snow`. It suits full-frame washes and screen-fixed captions.
- `layer: 'scene'` (default) draws it behind the actors, or in front with `front: true`.
- By convention, an fx sitting on the floor has its `y` on the ground line and draws upwards (negative y), like `door` and `table`.

**Your own fields:** read extra fields from `f`. For an animatable field, use `h.kv(f, t, 'state', 'red')`. It interpolates numbers through `k` keys and switches strings at the midpoint between keys. Speed or direction comes from comparing `h.kv(f, t, 'x', 0)` with `h.kv(f, t - 0.05, 'x', 0)`.

### `sets`: `name -> { fx, front, places }`

A scene picks one set with `"set": "name"` or `"set": { "name": "road", ...options }`.
- `fx`: fx drawn **behind** the scene's own fx.
- `front`: fx drawn **in front** of the actors (`front: true` is added for you).
- `places`: `{ placeName: { x, y } }`. The scene's own `"places"` object adds to these or overrides them.

Each of the three can be a value, or a function `(spec, opts) => value`:
- `spec` is the scene, so you can read `spec.w` and `spec.ground`.
- `opts` is the `set` object, or `{}`.

Set expansion and place resolution happen in the tooling (`addons.mjs`), before the engine sees the spec.

**Places** are points on the floor. In the scene, an `x`, `y`, `x1`, `y1`, `x2` or `y2` value can be a string `"@place"`, or `"@place+N"` / `"@place-N"` to offset by N units. These work on actor keys, on fx and on fx `k` keys.
- **On an actor's `y`**, `"@kerb"` means "feet on the place": the hip goes to `place.y − 53·s`, where `s` is the actor's scale times the key's scale. For a non-standing pose, give `y` as a number.
- **Everywhere else** the place's own `x` or `y` is used.
- An unknown place is an error that lists the valid places.

### `vocab` (lint hints)

- `offGround: ['pose', ...]`: add-on poses whose feet are not on the ground, so lint skips its "standing pose floating" check.

## The helper object `h`

| Name | What |
|---|---|
| `h.INK` `h.PAPER` `h.RED` `h.GOLD` `h.BLUE` `h.GREY` | engine palette: `#2b2117` `#efe3c6` `#a8322d` `#c08a2e` `#4f7fa3` `#8a7f6c` |
| `h.f1(v)` | round to 1 decimal, as the engine formats every number |
| `h.kv(f, t, key, def)` | an fx field at `t`, following `f.k` keyframes (ease-in-out; strings switch at the midpoint) |
| `h.win(f, t)` | the fx window opacity from `t0`/`t1`/`fade` (0..1) |
| `h.lerp(a, b, u)`, `h.cl(x, lo=0, hi=1)` | linear interpolation, clamp |
| `h.eio(u)`, `h.eo(u)` | ease-in-out cubic, ease-out cubic (input clamped 0..1) |
| `h.hsh(a, b)` | deterministic hash in 0..1 |
| `h.nz(seed, t)` | smooth deterministic noise in −1..1 |
| `h.TAU` | 2π |
| `h.esc(text)` | escape `& < > "` for SVG text and attributes |
| `h.spec`, `h.W`, `h.H`, `h.ground` | the scene being drawn, its width, height and ground line |
| `h.op`, `h.x`, `h.y`, `h.s` | **fx only**: the opacity (window × `op`) and the keyframed anchor and scale at `t` |

Treat `h` as read-only. It is a fresh object on every call.

## Minimal example

`explainers/examples/my-scene/props.mjs`:

```js
const lamp = (f, t, h) => {
  const on = h.kv(f, t, 'on', 1) > 0.5;
  return `<line x1="0" y1="0" x2="0" y2="-120" stroke="${h.INK}" stroke-width="4"/>` +
    `<circle cx="0" cy="-130" r="12" fill="${on ? h.GOLD : h.GREY}" stroke="${h.INK}" stroke-width="2"/>`;
};

export default {
  name: 'my-props',
  poses: { stretch: { la: [[-14, -60], [-10, -82]], ra: [[14, -60], [10, -82]] } },
  items: { umbrella: (f, t, h) => `<line x1="0" y1="0" x2="0" y2="-50" stroke="${f.c}" stroke-width="2"/><path d="M -30 -50 Q 0 -80 30 -50 Z" fill="${h.BLUE}" stroke="${f.c}" stroke-width="2"/>` },
  looks: { badge: (f, t, h) => `<circle cx="${h.f1(f.p.sh[0] + 5)}" cy="${h.f1(f.p.sh[1] + 10)}" r="4" fill="${h.GOLD}"/>` },
  fx: { lamp },
  sets: {
    street: {
      fx: (spec) => [{ type: 'lamp', x: 120, y: spec.ground ?? 355 }],
      places: (spec) => ({ corner: { x: 300, y: spec.ground ?? 355 } }),
    },
  },
};
```

Scene:

```json
{ "w": 900, "h": 400, "duration": 4, "addons": ["./props.mjs"], "set": "street",
  "actors": [{ "label": "SAM", "look": ["badge"], "keys": [
    { "t": 0, "x": "@corner", "y": "@corner", "pose": "standing", "item": "umbrella" },
    { "t": 2, "pose": "stretch" } ] }],
  "fx": [{ "type": "lamp", "x": "@corner+200", "y": "@corner", "k": [{ "t": 0, "on": 0 }, { "t": 3, "on": 1 }] }] }
```

Lint it, then look at a still:

```sh
node explainers/tools/lint.mjs scene.json
node explainers/tools/render.mjs scene.json out/ --stills 1 3
```

A complete, tested example is the fixture add-on in `explainers/tools/fixtures/fixture-addon/`, used by `explainers/tools/fixtures/addon-scene.json`.
