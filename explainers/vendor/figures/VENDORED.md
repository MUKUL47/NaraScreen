# Vendored: figures

- Source: https://github.com/cherifya/figures
- Commit: f3c70cf1fe5991764883e5446c1398dc12dd946e (2026-10-28)
- Vendored on: 2026-11-26
- Licence: MIT (`LICENSE`). Pose library, props and effects derive from stix by Bassime Ledath (MIT).

| File here | Upstream path |
|---|---|
| `figures.js` | `skills/figures/scripts/figures.js` (identical to `src/figures.js`) |
| `check_spec.py` | `skills/figures/scripts/check_spec.py` (Python standard library only) |
| `spec.md` | `skills/figures/references/spec.md` |
| `acting.md` | `skills/figures/references/acting.md` |
| `SKILL.md` | `skills/figures/SKILL.md` (mentions `render.py`; use `explainers/tools/render.mjs` instead) |
| `examples/*.json` | `skills/figures/assets/examples/*.json` |
| `LICENSE` | `LICENSE` |

**Do not edit these files.** Wrappers go in `explainers/tools/`. The one exception is the add-on patch
to `figures.js` described below. It is the only local change, and it must be kept when upgrading.

## Local patch: add-on registry (`figures.js`)

`figures.js` sha256:
- upstream, unpatched: `3ad2abef76503d2b76dd7e62dc8063167f845e2be5ffe43f1cc31ff2f1c6653a`
- patched: `8931959b2aa1534754ac86c11668652e44ce55cd1cad2a194167294a1cea7cf1`

**What it does.** It adds `FIGURES.extend(addon)`, `FIGURES.vocab()` and `FIGURES.sets` (the contract
is in `explainers/addons/README.md`). Built-in names always win. Each hook only reaches the registry
where the engine would otherwise fall back (`PP.standing`, `EX.neutral`, `''`), so built-in output is
byte-identical. `explainers/tools/addons.test.mjs` proves this against SVG hashes taken from the
unpatched engine (`explainers/tools/fixtures/golden-svg.json`).

**The patch has two parts.**
1. **One block**, between `/* NARASCREEN ADDON PATCH START` and `/* NARASCREEN ADDON PATCH END */`,
   placed right after the line `const API={svg,POSES,...};` and before `root.FIGURES=API;`. It
   defines `ADD` (the registry), `HELP` (the `h` helper object), `extend()` and the API additions. The
   block uses these engine internals: `POSES`, `B`, `toPolar`, `EX`, `INK`/`PAPER`/`RED`/`GOLD`/`BLUE`/`GREY`,
   `TAU`, `f1`, `cl`, `lerp`, `eio`, `eo`, `kv`, `win`, `hsh` and `nz`.
2. **Eleven hook lines**, each ending in `/* NARASCREEN ADDON HOOK */`. Line numbers are in the patched file.

| Line | Where | Upstream | Patched |
|---|---|---|---|
| 114 | `held()` switch default | `default:return '';` | `default:return ADD.it[item]?g(ADD.item(item,rot,c)):'';` |
| 131 | pose lookup | `const Q=n=>PP[n]\|\|PP.standing;` | `const Q=n=>PP[n]\|\|ADD.pp[n]\|\|PP.standing;` |
| 149 | expression lookup | `const EXv=n=>EX[n]\|\|EX.neutral;` | `const EXv=n=>EX[n]\|\|ADD.ex[n]\|\|EX.neutral;` |
| 225 | `drawActor2`, new line after the `robe` line | (none) | `g+=ADD.look(look,'behind',p,col,lag,s);` |
| 231 | `drawActor2`, new line after the `sword` line | (none) | `g+=ADD.look(look,'body',p,col,lag,s);` |
| 247 | `drawActor2`, new line after the `laughing` marks line | (none) | `g+=ADD.mark(X.name,hx,hy,se,col);` |
| 248 | `drawActor2` hat group | `...${hat(look,p.head,col)}</g>\`;` | `...${hat(look,p.head,col)}${ADD.look(look,'head',p,col,lag,s)}</g>\`;` |
| 315 | end of `drawFx()` | `return ''}` | `return ADD.fx(f,t,W,H,G,op,X,Y,S)}` |
| 318 | `svg()`, new first line | (none) | `ADD.t=t;ADD.spec=spec;` |
| 329 | `svg()` back filter | `...filter(f=>!f.front&&f.type!=='tint'&&f.type!=='night'&&f.type!=='snow')...` | `...filter(f=>!f.front&&!ADD.over(f))...` |
| 330 | `svg()` overlay filter | `...filter(f=>!f.front&&(f.type==='tint'\|\|f.type==='night'\|\|f.type==='snow'));` | `...filter(f=>!f.front&&ADD.over(f));` |

**To reapply after an upstream upgrade:**
1. Copy the new upstream `figures.js` here.
2. Paste the block back after `const API=`.
3. Redo the eleven hooks at the matching fallback sites. `ADD.over(f)` already includes `tint`, `night` and `snow`; if upstream adds another overlay type, add it there too.
4. Update the built-in name lists in `explainers/tools/addons.mjs` (`BUILTIN`) from the new `held()`/`drawFx()` switches and `look.includes` checks.
5. Regenerate `golden-svg.json` from the new unpatched file (the method is in its `_about` field), then run `node --test explainers/tools/`.
