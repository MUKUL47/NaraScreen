# workplace add-on

Shop and office props, staff clothing, and two sets: `shop` and `office`. Use it with `"addons": ["workplace"]`.

Sizes are in figure units. A standing figure at `s: 1` is about 130 units tall. Give each prop the same `s` as the actors near it. The sets do this for you through their `s` option.

## fx

Floor props put `x`, `y` on the floor and draw upwards.

| Name | Fields | Notes |
|---|---|---|
| `shelf` | `w` 120, `h` 130, `rows` 4, `seed`, `sign`, `pick: [row, slot]`, `picked` 0..1, `pickColor` | Goods are generated from `seed`. Rows count up from the floor (row 0). Slots count from the left, or from the right when negative (`-1` = last). The picked item is drawn in `pickColor` (default red) and fades out as `picked` goes to 1, so animate it with `k`. `sign` puts a label on top. |
| `counter` | `w` 130, `h` 50, `color` | Top is `(h + 7)·s` above the floor. Use `front: true` so it hides the legs of whoever stands behind it. |
| `till` | `display`, `open` 0..1, `dir` ±1 | Cash register. Its anchor is its base, so put `y` on the counter top. The drawer slides out as `open` goes to 1. |
| `wet-floor-sign` | `text` ("WET FLOOR") | Yellow A-frame. Long text is squeezed to fit. |
| `cone` | `color` | Traffic cone. |
| `extinguisher` | `color` | Stands on the floor. Raise `y` to hang it on a wall. |
| `exit-sign` | `text` ("EXIT"), `arrow` 1 / −1 / 0 | Green wall sign. **Anchored at its centre**, not on the floor. |
| `desk` | `w` 120, `h` 50, `monitor` (true) | Office desk with drawers. Use `front: true` to hide a seated person's legs. |
| `whiteboard` | `w` 110, `h` 70, `lines` (up to 5), `color` | A whiteboard on a stand. |
| `room` | `wall`, `floor`, `skirting`, `tile` | Back wall down to `ground`, with a tiled floor below. Full width, in scene coordinates. Put it first, and set `"groundLine": false`. |

## looks

| Name | Layer | |
|---|---|---|
| `vest` | body | Hi-vis yellow with reflective bands |
| `vest-orange` | body | Hi-vis orange |
| `name-badge` | body | Small badge on the chest |
| `apron` | body | Green shop apron, chest to knee (best on standing figures) |
| `hard-hat` | head | Yellow hard hat |
| `work-cap` | head | Blue cap with a peak (the built-in `cap` is a red dome) |

A head look sits close to the actor's label. Add `"labelDy": -10` to lift the label.

## items

These are held in the right hand.
- `product`: a red boxed product, matching a shelf's picked item.
- `shopping-bag`: a paper bag that hangs below the hand.
- `card`: a payment card.

The built-ins `wallet` and `coinbag` also suit shops.

## Sets

### `shop`

Draws a room, a door (1.2 × `s`), an exit sign above the door, a shelf and an extinguisher. Its front layer is a counter with a till on it.

**Options:**
- `s`: the prop scale. Default `1.3 × h / 400`.
- `door`, `shelf`, `counter`: x positions. Defaults 9 %, 34 % and 74 % of `w`.
- `shelfSign`: the label on the shelf.
- `pick: [row, slot]` and `pickAt`: that shelf item vanishes at `pickAt` seconds.
- `display`: the till text.
- `tillOpen: [open, close]`: when the till drawer opens and closes, in seconds.
- `exit` and `extinguisher`: booleans, both default true.

**Places:**
- `door`;
- `shelf`: just right of the shelf, where someone stands to reach into it facing left;
- `counter-staff`: behind the counter;
- `counter-customer`: in front of it, 100·`s` from the staff;
- `till`: the till's base on the counter top. Use it for fx such as `check`, `"y": "@till-200"`.

### `office`

Draws a room, a door, a whiteboard and a chair. Its front layer is a desk.

**Options:**
- `s`;
- `door`, `whiteboard`, `desk`: x positions. Defaults 8 %, 30 % and 68 % of `w`;
- `lines`: the whiteboard text.

**Places:**
- `door`;
- `whiteboard`: to the right of the board, facing left to present;
- `desk`: to the right of the desk;
- `chair`: the chair's x.

To seat someone on the chair, give `y` as a number, `ground − 30·s`: the hip goes on the seat. Use `"face": 1` and a `sit_write` or `sitting` pose.

## Examples

- `demo-office.json` in this folder: the office set, every look, and the safety props.
- `explainers/examples/shop-greeting/`: the shop set in a full video.
