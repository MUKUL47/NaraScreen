---
name: figures
description: Animate stick-figure scenes from short JSON scripts and render them to SVG, MP4 or GIF. The engine handles walking, gestures, facial expressions, blinking and eye contact on its own. Use when someone asks for an explainer animation, a stick-figure story, a short character clip for a lesson or social post, or wants to turn a dialogue or a cause-and-effect idea into a few seconds of animation.
license: MIT
compatibility: Needs Node.js or a browser for the engine. Rendering video or stills needs Python 3, Playwright with Chromium, and ffmpeg.
metadata:
  version: "0.1.0"
  repository: "https://github.com/cherifya/figures"
---

# figures

You write a scene as JSON: a few characters, where they stand, and what they do at which second. `scripts/figures.js` turns it into SVG for any moment of the scene. `scripts/render.py` captures frames in parallel headless browsers and encodes them to video.

The engine does the in-between motion by itself. Characters walk with planted feet, breathe, blink, look at whoever is closest, and spring into poses with a small overshoot. A change of expression blends over a fifth of a second. Spend your keyframes on acting beats and leave the fidgeting to the engine.

Paths below are relative to this skill's folder.

## Setup

The engine has no dependencies. For video and stills:

```bash
pip install playwright && playwright install chromium
# and ffmpeg on PATH (brew install ffmpeg, apt install ffmpeg, ...)
```

## Making a scene

1. **Plan the beats before writing JSON.** One line per beat: who does what, and who reacts. Two to four beats fit in ten seconds. Give each beat one clear gesture and let the other character react 0.2 to 0.4 s later. Hold the last pose for at least 0.8 s so the ending lands.
2. **Write the spec.** Copy `assets/examples/hello.json` and edit it. `references/spec.md` lists every pose, expression, costume, prop and effect. `references/acting.md` has timings for common beats: greetings, handshakes, reveals, arguments, wins and defeats. Some rules that catch everyone:
   - Keys are sparse. Fields you leave out carry over from the previous key.
   - A standing character's hip sits at `y = ground - 53 * s`.
   - `move: "walk"` (or `"run"`) goes on the key where the walk ends, not where it starts.
3. **Lint it.**
   ```bash
   python3 scripts/check_spec.py scene.json
   ```
   It reports:
   - unknown names;
   - unsorted keys;
   - characters floating off the ground or crowding each other;
   - walks too fast for the legs;
   - waves that never stop;
   - speech bubbles covering a head or a name label.

   Fix every ERROR. WARNs are judgment calls.
4. **Look at stills before rendering video.**
   ```bash
   python3 scripts/render.py scene.json qa/ --stills 1.0 2.5 4.0
   ```
   Take one still per beat, mid-gesture. If you can view images, open them and check:
   - the faces read the way you meant;
   - bubbles clear the labels;
   - nothing is cut off at the edges;
   - legs look right mid-stride.
5. **Render.**
   ```bash
   python3 scripts/render.py scene.json out.mp4 --workers 4
   python3 scripts/render.py scene.json out.gif --size 1350x600
   ```
   Each worker is a headless browser that renders its own slice of frames. The slices join seamlessly because every frame depends only on the scene and the time. Four workers is about right for a laptop. More than that tends to slow down once the machine gets hot.

## Using the engine in code

```html
<script src="scripts/figures.js"></script>
<script>stage.innerHTML = FIGURES.svg(spec, 2.5)</script>   <!-- the scene at t = 2.5 s -->
```

In Node: `const FIGURES = require('./scripts/figures.js')`. `FIGURES.POSES` and `FIGURES.EXPRESSIONS` list the vocabulary.

If you change the engine, keep every frame a pure function of `(spec, t)`. Use the seeded noise helpers (`hsh`, `nz`) and never `Math.random()` or state carried between calls. Otherwise parallel renders will flicker where the slices meet.

## Things the engine already does

Don't animate these by hand:
- Pose changes spring in. Big arm moves wind up first and squash a little on landing.
- Walk and run cycles follow the distance covered, so feet never slide. The body bobs, arms swing, and a puff of dust marks the stop.
- Flipping `face` plays a turn rather than an instant mirror.
- Idle characters breathe, sway, blink and tilt their heads. Their eyes track the nearest character.
- Hair, hats, ties and robes trail behind fast moves.
- Expressions add their own marks:
  - shock lines for `surprised`;
  - a throbbing anger mark for `angry`;
  - a sweat drop for `worried` or `cold`;
  - laugh lines and a chuckle bounce for `laughing`.
- `cheer` with `happy` or `laughing` makes the character hop, and the shadow shrinks as the figure leaves the ground.

## Common mistakes

- **Bubbles.** On a 400-high canvas with `s` 1.3, put speech bubbles beside and above the speaker's head, around y 116 to 122, and away from the name label. `tail: -1` points down and left; `1` points down and right.
- **Distance between characters.** Two people shaking hands stand about 100 px apart (hip to hip). Anyone else needs at least 110 px, or their arms tangle.
- **Seated poses.** `sitting` and `sit_*` keep seated legs. When a character stands up, change `y` back to the standing hip on the same key.
- **Waving.** `wiggle: {p, a}` keeps the right forearm waving until a later key sets `wiggle: null`. Forget the null and the character waves for the rest of the scene.
- **Turning while walking.** Flipping `face` on the key that ends a long walk makes the character moonwalk for a moment. Turn on the key before.
- **Edges.** Keep important props 40 px or more from the edges, because the camera drifts in slightly.
- **ffmpeg filters** (if you add audio): write durations with a leading zero (`d=0.3`), and use `asplit` before trimming one audio input twice.

## Files

- `scripts/figures.js`: the engine.
- `scripts/render.py`, `scripts/frame.html`: the parallel renderer and the page it drives.
- `scripts/check_spec.py`: the spec linter (Python standard library only). `--strict` also fails on warnings.
- `references/spec.md`: the scene format in full.
- `references/acting.md`: beat timings that read well.
- `assets/examples/`: `hello.json` (two people meet), `mirror.json` and `court.json` (scenes from a series on power and history).
