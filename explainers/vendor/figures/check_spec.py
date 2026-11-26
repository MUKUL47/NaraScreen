#!/usr/bin/env python3
"""Static linter for figures scene specs (stdlib only).

usage: python3 check_spec.py scene.json [more.json ...] [--strict]
exit 1 on any ERROR (or any WARN with --strict).
"""
import json, sys

POSES = {"standing", "walk_a", "walk_b", "run_a", "run_b", "sitting", "sit_write", "arms_raised", "cheer", "waving", "reaching",
         "pointing", "point_fwd", "holding", "hold_up", "present", "arms_crossed", "hands_hips", "facepalm", "think", "shrug",
         "thumbs_up", "pat", "pat_low", "sneak", "grab", "whisper", "bow", "kneel", "slump", "dagger", "telescope", "handshake",
         "sign", "lying", "crouch", "pat_sneak", "sit_think", "sit_handshake", "stride"}
EXPR = {"neutral", "happy", "laughing", "sad", "surprised", "determined", "angry", "smirk", "worried", "sleep", "cold"}
LOOKS = {"beard", "cap", "crown", "dress", "glasses", "hair", "musket", "robe", "sword", "tie", "tophat", "wig"}
ITEMS = {"mirror", "telescope", "scroll", "dagger", "pen", "clipboard", "coinbag", "crown", "wallet", "paper", "medal"}
FX = {"arrow", "bars", "beam", "bed", "bubble", "chair", "chateau", "check", "cross", "crownfx", "curtain", "doc", "door",
      "firework", "garden", "heart", "jupiter", "mirrorstand", "moon", "night", "screen", "snow", "sparkle", "stars", "sun",
      "sweat", "table", "text", "thought", "throne", "tint", "wallet", "zzz"}
SEATED = {"sitting", "sit_write", "sit_think", "sit_handshake"}
TALL = {"crown", "tophat", "musket"}


def timeline(keys):
    """Return list of fully-resolved key states (carry-forward)."""
    out, cur = [], {}
    for k in keys:
        cur = {**cur, **{a: b for a, b in k.items() if b is not None or a == "wiggle"}}
        out.append(dict(cur))
    return out


def at(states, t):
    """Resolved state with linearly interpolated x at time t (approximate, good enough for staging checks)."""
    if t <= states[0]["t"]:
        return states[0]
    for a, b in zip(states, states[1:]):
        if a["t"] <= t <= b["t"]:
            u = (t - a["t"]) / max(1e-6, b["t"] - a["t"])
            s = dict(a if u < 1 else b)
            for f in ("x", "y", "op"):
                va, vb = a.get(f, 1 if f == "op" else 0), b.get(f, a.get(f, 1 if f == "op" else 0))
                s[f] = va + (vb - va) * u
            return s
    return states[-1]


def check(path, strict=False):
    errs, warns = [], []
    E, Wn = errs.append, warns.append
    try:
        spec = json.load(open(path))
    except Exception as e:
        print(f"{path}: ERROR cannot parse JSON: {e}")
        return False
    W, H, G = spec.get("w", 900), spec.get("h", 400), spec.get("ground", 355)
    dur = spec.get("duration")
    st = spec.get("start", 0)
    if not dur:
        Wn('no "duration": tools/render.py needs --duration')
    end = st + (dur or 10)
    actors = spec.get("actors", [])
    if not actors:
        Wn("no actors")
    res = []
    for i, ac in enumerate(actors):
        nm = ac.get("label") or f"actor[{i}]"
        keys = ac.get("keys") or []
        if not keys:
            E(f"{nm}: no keys"); continue
        for f in ("t", "x", "y", "pose"):
            if f not in keys[0]:
                E(f"{nm}: first key missing '{f}'")
        ts = [k.get("t") for k in keys]
        if any(t is None for t in ts):
            E(f"{nm}: every key needs 't'")
            continue
        if ts != sorted(ts):
            E(f"{nm}: keys not sorted by t ({ts})")
        for a, b in zip(ts, ts[1:]):
            if a == b:
                Wn(f"{nm}: two keys at t={a}; the second wins silently")
        for lk in ac.get("look", []):
            if lk not in LOOKS:
                E(f"{nm}: unknown look '{lk}' (known: {', '.join(sorted(LOOKS))})")
        s = ac.get("s", 1)
        states = timeline(keys)
        wig_on = None
        for k, sres in zip(keys, states):
            t = k["t"]
            if "pose" in k and k["pose"] not in POSES:
                E(f"{nm} t={t}: unknown pose '{k['pose']}'")
            if "expr" in k and k["expr"] not in EXPR:
                E(f"{nm} t={t}: unknown expr '{k['expr']}' (known: {', '.join(sorted(EXPR))})")
            if k.get("item") and k["item"] not in ITEMS:
                E(f"{nm} t={t}: unknown item '{k['item']}'")
            if k.get("move") not in (None, "walk", "run"):
                E(f"{nm} t={t}: move must be 'walk' or 'run'")
            if "face" in k and k["face"] not in (1, -1):
                Wn(f"{nm} t={t}: face should be 1 or -1")
            if "wiggle" in k:
                wig_on = t if k["wiggle"] else None
            stand_y = G - 53 * s * sres.get("s", 1)
            if sres.get("pose") not in SEATED and sres.get("pose") not in ("lying", "kneel", "crouch") and abs(sres.get("y", stand_y) - stand_y) > 6 and not k.get("rot"):
                Wn(f"{nm} t={t}: standing pose with y={sres.get('y'):.1f}; feet on ground needs y≈{stand_y:.1f}")
        if wig_on is not None:
            Wn(f"{nm}: wiggle started at t={wig_on} never stopped (set \"wiggle\": null on a later key)")
        for a, b in zip(keys, keys[1:]):
            if b.get("move") and "face" in b and b["face"] != timeline([a])[0].get("face", b["face"]):
                Wn(f"{nm} t={b['t']}: face flips on a walk key; turn on the previous key instead")
            if b.get("move") and "x" in b:
                xa = next((sx.get("x") for sx in timeline(keys[:keys.index(a) + 1])[-1:]), None)
                if xa is not None:
                    v = abs(b["x"] - xa) / max(1e-6, b["t"] - a["t"])
                    stride = (80 if b["move"] == "run" else 52) * s
                    cad = v / stride
                    lim = 3.8 if b["move"] == "run" else 2.6
                    if cad > lim:
                        Wn(f"{nm} t={b['t']}: {b['move']} cadence {cad:.1f} stride cycles/s looks frantic (≤{lim}); give it more time" + (" or use run" if b["move"] == "walk" else ""))
        res.append((nm, ac, states, s))
    # staging checks sampled over time
    bubbles = [f for f in spec.get("fx", []) if f.get("type") in ("bubble", "thought")]
    for f in spec.get("fx", []):
        if f.get("type") not in FX:
            E(f"fx '{f.get('type')}' unknown")
    warned = set()
    t = st
    while t <= end:
        live = []
        for nm, ac, states, s in res:
            q = at(states, t)
            if q.get("op", 1) < 0.3:
                continue
            x, y = q.get("x", 0), q.get("y", 0)
            tall = any(l in TALL for l in ac.get("look", []))
            fs = spec.get("labelFs", 15)
            head_y = y - 60 * s
            ly = y + (-60 - (62 if tall else 34)) * s + ac.get("labelDy", 0)
            tw = len(ac.get("label") or "") * fs * .78 + 14
            lab = (x - tw / 2, x + tw / 2, ly - fs * .95, ly + fs * .35) if ac.get("label") else None
            live.append((nm, x, y, head_y, lab, q))
            if 0 < x < W and (x < 25 * s or x > W - 25 * s) and ("edge", nm) not in warned:
                warned.add(("edge", nm)); Wn(f"{nm} t≈{t:.1f}: hugging the canvas edge (x={x:.0f})")
        for i in range(len(live)):
            for j in range(i + 1, len(live)):
                a, b = live[i], live[j]
                d = abs(a[1] - b[1])
                hs = a[5].get("pose") == "handshake" or b[5].get("pose") == "handshake"
                if d < (80 if hs else 95) and 0 < a[1] < W and 0 < b[1] < W and ("near", a[0], b[0]) not in warned:
                    warned.add(("near", a[0], b[0])); Wn(f"{a[0]} and {b[0]} t≈{t:.1f}: only {d:.0f} px apart (limbs may tangle)")
        for bi, f in enumerate(bubbles):
            if not (f.get("t0", 0) <= t <= f.get("t1", 1e9)):
                continue
            bw, bh = f.get("w", 160), f.get("h", 46)
            bx0, bx1, by0, by1 = f["x"] - bw / 2, f["x"] + bw / 2, f["y"] - bh / 2, f["y"] + bh / 2
            if bx0 < 14 or bx1 > W - 14 or by0 < 14:
                if ("bclip", bi) not in warned:
                    warned.add(("bclip", bi)); E(f"bubble '{f.get('text', '')}' t≈{t:.1f}: crosses the frame edge")
            for nm, x, y, hy, lab, q in live:
                def ov(r):
                    return min(bx1, r[1]) - max(bx0, r[0]), min(by1, r[3]) - max(by0, r[2])
                hit = None
                if lab:
                    ox, oy = ov(lab)
                    if ox > 0 and oy > 0:
                        hit = ("label", min(ox, oy))
                ox, oy = ov((x - 20 * s, x + 20 * s, hy - 20 * s, hy + 20 * s))
                if ox > 0 and oy > 0 and (not hit or min(ox, oy) > hit[1]):
                    hit = ("head", min(ox, oy))
                if hit and hit[1] >= 1 and ("bhit", bi, nm) not in warned:
                    warned.add(("bhit", bi, nm))
                    msg = f"bubble '{f.get('text', '')}' t≈{t:.1f}: overlaps {nm}'s {hit[0]} by {hit[1]:.0f} px"
                    (E if hit[1] > 8 else Wn)(msg + ("" if hit[1] > 8 else " (touching)"))
        t += 0.25
    for m in errs:
        print(f"{path}: ERROR {m}")
    for m in warns:
        print(f"{path}: WARN  {m}")
    ok = not errs and not (strict and warns)
    print(f"{path}: {'ok' if ok else 'FAIL'} ({len(errs)} errors, {len(warns)} warnings)")
    return ok


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if not args:
        sys.exit(__doc__)
    strict = "--strict" in sys.argv
    sys.exit(0 if all([check(p, strict) for p in args]) else 1)
