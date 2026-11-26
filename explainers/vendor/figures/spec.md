# Spec reference

A scene is one JSON object. `FIGURES.svg(spec, t)` draws it at time `t` (seconds).

```json
{
  "title": "optional, shown by the player",
  "w": 900, "h": 400, "ground": 355, "labelFs": 20,
  "duration": 12.0,
  "start": 0,
  "fx": [ ... ],
  "actors": [ ... ]
}
```

- `w`, `h`: the SVG viewBox. `ground`: y of the dashed ground line. Set `groundLine: false` to hide it.
- `duration` and `start` are used by the tools. `start` lets you render a window of a longer scene.

## Actors

```json
{"label": "ADA", "s": 1.3, "look": ["hair"],
 "keys": [
   {"t": 0,   "x": -80, "y": 286, "pose": "standing", "expr": "neutral", "face": 1},
   {"t": 2.6, "x": 330, "move": "walk", "expr": "happy"},
   {"t": 3.2, "pose": "waving", "wiggle": {"p": 0.4, "a": 6}},
   {"t": 4.6, "pose": "standing", "wiggle": null}
 ]}
```

- **Keys** are sparse. Any field you leave out carries forward from the previous key.
- **Placement**: `x`, `y` is the hip. A standing hip sits at `y = ground - 53 * s`. A seated hip sits on the chair: `y = chair y`, with the chair at `ground - 15 * s`.
- **Movement**:
  - `move: "walk" | "run"` on the *target* key moves the hip in a straight line.
  - The legs run a stride cycle driven by the distance covered, so feet stay planted at any speed.
  - The body bobs and the arms swing opposite the legs. A small dust puff marks the stop.
- **Pose changes**:
  - Each change blends over up to 0.42 s and lands on the key time.
  - The blend is a damped spring with about 8% overshoot.
  - Big arm moves get an anticipation dip and squash and stretch.
- **`face`**: `1` faces right, `-1` faces left. Turning is animated: the figure narrows through profile instead of flipping.
- **`expr`** changes blend over 0.22 s. Each expression triggers its own automatic emotion marks (see below).
- **Other fields**:
  - `op`: opacity.
  - `s`: scale multiplier.
  - `rot`: tilt.
  - `glow`: golden halo, 0 to 1.
  - `item` + `irot`: a prop held in the right hand.
  - `wiggle: {p, a}`: makes the right arm wave until a later key sets `wiggle: null`.
- **Actor-level**: `label`, `labelDy`, `labelColor`, `s` (base scale), `look` (accessories), `shadow: true` (a silhouette).

**What the engine adds by itself:**
- breathing and a slight sway;
- seeded blinks (and a double blink on surprise);
- eyes that track the nearest other character;
- a small head tilt;
- hair, hats, ties, robes and props that trail motion;
- a hop when someone cheers happily;
- a ground shadow that shrinks as the figure leaves the ground;
- hand-drawn line boil redrawn 12 times a second.

### Vocabulary

**Poses:** standing, walk_a, walk_b, run_a, run_b, sitting, sit_write, sit_think, sit_handshake, arms_raised, cheer, waving, reaching, pointing, point_fwd, holding, hold_up, present, arms_crossed, hands_hips, facepalm, think, shrug, thumbs_up, pat, pat_low, pat_sneak, sneak, grab, whisper, bow, kneel, slump, dagger, telescope, handshake, sign, lying, crouch, stride.

**Expressions (`expr`) and their automatic marks:**
- `neutral`, `happy`, `sad`, `determined`, `smirk`, `sleep`: no marks.
- `surprised`: shock lines.
- `angry`: a throbbing anger mark.
- `worried`, `cold`: a sliding sweat drop.
- `laughing`: laugh lines and a chuckle bounce.

**Looks:** crown, wig, cap, musket, tophat, beard, hair, glasses, tie, sword, robe, dress.

**Items:** mirror, telescope, scroll, dagger, pen, clipboard, coinbag, crown, wallet, paper, medal.

## Effects (`fx`)

**Common fields:**
- `type`, `x`, `y`, `s`, `op`.
- `t0` and `t1`: the visible window. The effect fades over `fade` seconds (default 0.35).
- `front: true` draws the effect over the actors.
- Any numeric field can be animated with `"k": [{"t": .., "x": ..}, ...]`, which is eased.

**Types:**
- **Sky and light:** `sun`, `moon`, `stars {w,h,n}`, `beam {x1,y1,x2,y2,w1,w2,color}`.
- **Overlays:** `night {a}`, `tint {color,a}`, `snow`.
- **Reactions:** `sparkle {r,n,color}`, `firework {bursts:[[x,y,delay]],r}`, `heart`, `check`, `cross`, `sweat`, `zzz`.
- **Speech and text:** `bubble {text,w,h,fs,tail:-1|1}`, `thought {text,w,h,fs}`, `text {text,fs,color,anchor,font}`.
- **Props:**
  - `table {w,h}`, `chair {back}`, `throne`, `bed`, `door`.
  - `doc {title, signed via k}`.
  - `screen {w,h,leg,title,big,bfs,chart,chartColor}`.
  - `bars {w,h, drop via k}`.
  - `mirrorstand {rot}`, `wallet`, `crownfx`, `jupiter`, `chateau`, `garden {n}`.
  - `arrow {len,color}`, `curtain`.

## Staging tips

- Give each beat one clear gesture, then let the other character react 6 to 10 frames later.
- Hold the final tableau for at least 0.8 s.
- Keep bubbles beside or above the speaker's head, clear of labels.
- Keep actors at least 110 px apart unless they touch on purpose (a handshake is about 100 px).
- Enter from off-panel (`x` -80 or `w`+80) with `move: "walk"`.
