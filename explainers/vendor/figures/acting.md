# Acting patterns

These are small beat recipes that read clearly at explainer speed. Times are relative to the start of the beat. `s` is 1.3 on a 900×400 canvas with ground 355, which puts the standing hip at y 286.

## Entrance
- **0.0** Start off-panel (`x: -80` or `w + 80`) in pose `standing`.
- **1.8 to 2.6** Walk to the mark with `move: "walk"`, about 150 px per second. Use `"run"` for urgency, about 300 px per second.
- **+0.3** Arrive with an expression change (`happy`, `determined`). The spring settle and the dust puff come for free.

## Greeting
- **A:** `waving` plus `wiggle {p: .4, a: 6}` and a bubble "Hi".
- **B:**
  - +0.5 `surprised`;
  - +1.0 `waving` + `happy`;
  - stop both wiggles with `wiggle: null` about 1.2 s later.

## Handshake
- Walk both actors to about 100 px apart (A to center-50, B to center+50).
- On the same key, set `pose: "handshake"` and `expr: "happy"` on both.
- Hold 0.8 s, then return to `standing`.
- A small `heart` or `sparkle` fx above them sells it.

## Reveal or surprise
- **Setup:** B is in `think`, `neutral`.
- **Reveal:** A goes `present` or `hold_up`, with an `item` (scroll, medal, paper).
- **+0.25** B goes `surprised` and steps back 20 px, with no `move` (a quick slide reads as a flinch).
- **+0.9** B goes `happy` or `worried`, depending on the story.

## Argument
- Alternate `pointing` + `angry` and `arms_crossed` + `determined`, swapping every 0.8 to 1.2 s.
- Use a speech bubble on the pointer only.
- End with one character turning away: flip `face` and walk 60 px.

## Triumph
- `cheer` plus `laughing` or `happy` gives an automatic hop.
- Add a `firework` or `sparkle` behind the character (not `front`).
- The `glow: 1` halo is good for the "winner" of a story.

## Defeat
- `slump` plus `sad` slows the breathing and the head tilts down automatically.
- Optionally move the figure 10 px down and use `op: 0.85` so it fades back.
- A `sweat` fx or a `worried` expression makes it read as nervous rather than crushed.

## Comedy timing
- Go setup, pause, punchline. Let the listener *not* react for 0.6 s, then react big (`facepalm`, `laughing`).
- Repetition with a twist works: do the same gesture twice, then a third time with a different result.
