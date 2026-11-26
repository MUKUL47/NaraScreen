# TTS servers for the `chatterbox` and `maya2` engines

The explainers' [`chatterbox`](../chatterbox.mjs) and [`maya2`](../maya2.mjs) voice engines talk HTTP to two self-hosted GPU servers. This folder holds everything needed to run them. The big files (Python env, weights, caches) live outside git, in one data directory.

Start and stop them from the repo root with the same script as Kokoro:

```bash
scripts/voice-engine.sh up chatterbox    # stops maya2 first; Kokoro keeps running
scripts/voice-engine.sh up maya2         # stops chatterbox first; ready after ~80 s
scripts/voice-engine.sh status           # kokoro, chatterbox and maya2, each with its GPU and state
scripts/voice-engine.sh down chatterbox  # or: down maya2   (plain `down` stops Kokoro, as before)
```

`up <engine>` returns once `GET /health` answers 200 (it waits up to `TTS_READY_TIMEOUT`, 300 s by default). The containers are `narascreen-chatterbox` and `narascreen-maya2`, so `docker logs -f narascreen-maya2` shows the log.

## The engines

| | Chatterbox Multilingual V3 | Maya-2-Native |
|---|---|---|
| By | Resemble AI | Maya Research |
| Port | `127.0.0.1:8890` | `127.0.0.1:8891` |
| Server | [`chatterbox/server.py`](chatterbox/server.py), our OpenAI-style wrapper | the upstream `maya3.server` |
| Languages (as the engine module lists them) | `en`, `hi` | `en`, `hi`, `mr`, `gu`, `ta`, `te`, `bn`, `kn`, `ml`, `pa`, `or`, `as` |
| Voices | reference clips in `$NARASCREEN_TTS_HOME/voices/` (`en_f1`, `hi_f1`), or `default` (built-in) | 20 named voices (`Vaidehi`, `Siddhant`…) |
| Speed on an RX 6700 XT | ~1× real time | ~0.85× real time (warm) |
| VRAM | ~4 GB | ~8.3 GB |
| Start-up, until `/health` is 200 | ~30 s | ~80 s (weights, then CUDA-graph capture) |
| Weights on disk | ~3 GB | ~5.1 GB (model 4.7 GB, Mimi 0.4 GB, ECAPA 0.1 GB) |

**One at a time.** On a 12 GB card, Kokoro (~1.5 GB) plus Chatterbox, or Kokoro plus Maya, fit; all three don't. Measured on the 6700 XT with the desktop running: Kokoro + Chatterbox use ~6.1 GB, Kokoro + Maya ~10.2 GB. So `up chatterbox` stops Maya and `up maya2` stops Chatterbox. Never stop Kokoro to make room: NaraScreen's own narration needs it.

## GPU

- **AMD only for now** (ROCm 6.4 build of torch 2.8). NVIDIA is not wired up for these two servers; Kokoro's NVIDIA path is unaffected.
- [`common/run-in-gpu-container.sh`](common/run-in-gpu-container.sh) runs each server in a throwaway `ubuntu:24.04` container that sees only one GPU. [`common/gpu.sh`](common/gpu.sh) picks it with the same rule as `scripts/voice-engine.sh` uses for Kokoro: the AMD GPU with the most compute units and at least 6 GB of its own VRAM, so an integrated GPU is never used. Its card and render nodes and the `HSA_OVERRIDE_GFX_VERSION` value (e.g. gfx1031 runs as `10.3.0`) are read from `/sys/class/kfd`. Nothing is hard-coded.
- **RDNA2 (gfx103x) and Maya:** bf16 GEMMs segfault there with torch 2.8 / ROCm 6.4. On those cards [`maya2/serve.sh`](maya2/serve.sh) applies [`maya2/rdna2.patch`](maya2/rdna2.patch) to the Maya checkout once (it adds two env switches whose defaults keep upstream behaviour) and starts the server with `MAYA3_DTYPE=fp16` and `MAYA3_FUSE_ROPE=0`. On other cards nothing is patched or switched.
- [`common/cc`](common/cc) is a C-compiler shim (zig's clang from the `ziglang` pip package) that Triton uses to build its launcher stubs, so the container needs no gcc.

## The data directory: `$NARASCREEN_TTS_HOME`

Every path comes from one directory:
1. `$NARASCREEN_TTS_HOME`, if set;
2. else the `NARASCREEN_TTS_HOME=/path` line in `explainers/voices/servers/.env.local` (git-ignored; `~` is expanded);
3. else `explainers/voices/servers/.data/` (git-ignored).

```
$NARASCREEN_TTS_HOME/
  python/            uv-managed CPython 3.11 (the venv points here, so it works inside the container)
  .venv/             the shared env of both servers (~14 GB, mostly torch + ROCm)
  src/chatterbox/    resemble-ai/chatterbox @ ab55923, installed editable
  src/maya2/         MayaResearch/maya2-native @ c6b3768, installed editable (+ rdna2.patch on RDNA2)
  models/maya2-native/  models/mimi/  models/ecapa/
  cache/hf/          Hugging Face cache: the Chatterbox weights
  cache/home/ cache/miopen/ cache/numba/ cache/triton/   per-container caches
  voices/            Chatterbox reference clips: <name>.wav|flac|mp3 (en_f1, hi_f1 by default)
```

The directory and this `servers/` folder are mounted into the container at their host paths. The container runs as your user, with `HF_HUB_OFFLINE=1`, so a running server never downloads anything.

### First run (fresh install)

`up chatterbox` or `up maya2` fills in whatever is missing before it starts the container, and uses whatever is there as is:
- **Sources:** clones both upstream repos at the pinned commits (needs `git`).
- **Python env:** creates `.venv` with [uv](https://docs.astral.sh/uv/) (needs `uv` on the host; nothing is installed system-wide) from [`common/requirements-rocm.txt`](common/requirements-rocm.txt), a freeze of a working env, with torch from `https://download.pytorch.org/whl/rocm6.4`. Then it installs `chatterbox` and `maya3` editable, with `--no-deps`. That's about 14 GB.
- **Weights:** Chatterbox (`ResembleAI/chatterbox`: `t3_mtl23ls_v3.safetensors`, `s3gen.pt`, `ve.pt` and the tokenizer files) into `cache/hf`; Maya (`maya-research/maya2-native`), Mimi (`kyutai/mimi`) and ECAPA (`speechbrain/spkrec-ecapa-voxceleb`) into `models/`. That's about 8 GB.
- **Reference voices:** when `voices/en_f1.*` or `hi_f1.*` is missing, it makes a short clip with the local Kokoro engine (`af_heart`, `hf_alpha`). Without Kokoro, Chatterbox uses its built-in voice instead. Drop any 3–10 s clip in `voices/` to add a voice; its file stem is the voice name.

Plan for ~25 GB and a long first start. A half-finished env is detected (it must import both `chatterbox` and `maya3`) and completed on the next run. If that fails, delete `.venv` and run again.

### An existing install

The owner's original evaluation folder already has exactly this layout, plus research leftovers (`samples/`, `scripts/`, the `Chatterbox-Multilingual-hi` cache), so it is used in place through `.env.local`, without downloading anything:

```bash
echo 'NARASCREEN_TTS_HOME=~/path/to/tts-eval' > explainers/voices/servers/.env.local
```

Anything already present is never re-downloaded or rebuilt. If `rdna2.patch` neither applies nor is already in `src/maya2`, `up maya2` stops with that message rather than touch your local edits.

## Files

- `common/env.sh`: resolves the data directory, pins, and the first-run install steps.
- `common/gpu.sh`: picks the GPU.
- `common/run-in-gpu-container.sh`: `docker run` with only that GPU and the mounts and caches.
- `common/cc`: the zig C-compiler shim for Triton.
- `common/requirements-rocm.txt`: the frozen Python env.
- `chatterbox/serve.sh` and `chatterbox/server.py`: the Chatterbox server (`POST /v1/audio/speech`, `GET /v1/voices`, `GET /health`). It accepts `language`; `mr` is read through the Hindi model, but the engine module doesn't list it (Hindi accent). `speed` is accepted and ignored.
- `maya2/serve.sh` and `maya2/rdna2.patch`: the Maya server and its RDNA2 fix.

## Licences

- **Chatterbox** (code and weights): MIT, by Resemble AI. Every clip it generates carries Resemble's **Perth watermark**, which is inaudible and survives MP3 compression. The project is **retired**: the repo stays public as an archive with no support or updates, so the pinned commit is the last word.
- **Maya-2-Native**: the inference code and the weights are Apache-2.0, by Maya Research. It builds on Qwen3-1.7B-Base (Apache-2.0).
- **Mimi codec** (`kyutai/mimi`, used by Maya to turn tokens into audio): **CC-BY-4.0**. Anything you publish with Maya audio needs an attribution, e.g. "Speech generated with Maya-2-Native (Maya Research), using the Mimi codec by Kyutai (CC-BY-4.0)". Put it in the video description or credits.
- **ECAPA speaker encoder** (`speechbrain/spkrec-ecapa-voxceleb`): Apache-2.0.
- Kokoro (`af_heart`, `hf_alpha`, used for the default reference clips): Apache-2.0.
- This folder's own scripts and the Chatterbox wrapper are part of NaraScreen, MIT.
