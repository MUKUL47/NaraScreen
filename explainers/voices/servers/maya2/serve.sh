#!/usr/bin/env bash
# Start Maya-2-Native (Maya Research, Apache-2.0; English + 11 Indian languages) with its own OpenAI-style
# server (maya3.server) on http://127.0.0.1:8891, in a container that sees only the chosen AMD GPU.
# Returns once the container is started; it is ready when GET /health answers 200 (~80 s).
#
# RDNA2 (gfx103x, e.g. RX 6700 XT): bf16 GEMMs segfault there (torch 2.8 / ROCm 6.4), so rdna2.patch is
# applied to the Maya checkout (once; it only adds two env switches whose defaults keep upstream behaviour)
# and the server runs with MAYA3_DTYPE=fp16 and MAYA3_FUSE_ROPE=0 (no fused Triton RoPE kernel).
#
# Normally run by: scripts/voice-engine.sh up maya2   (stops chatterbox first; only one fits next to Kokoro)
# First run: creates the venv and downloads the weights into $NARASCREEN_TTS_HOME (see ../README.md).
# Logs: docker logs -f narascreen-maya2     Stop: scripts/voice-engine.sh down maya2
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$HERE/../common/env.sh"
source "$HERE/../common/gpu.sh"
NAME=${MAYA2_CONTAINER:-narascreen-maya2}
PORT=${MAYA2_PORT:-8891}
M=$H/models

tts_install_common
tts_ensure_maya2_weights

pick_tts_gpu || tts_die "no AMD GPU with >= 6 GB of its own memory found"
RDNA2=()
if tts_gpu_is_rdna2; then
  src=$H/src/maya2
  if git -C "$src" apply --check "$HERE/rdna2.patch" 2>/dev/null; then
    git -C "$src" apply "$HERE/rdna2.patch" && tts_log "applied rdna2.patch to $src"
  elif ! git -C "$src" apply -R --check "$HERE/rdna2.patch" 2>/dev/null; then
    tts_die "rdna2.patch neither applies to nor is already in $src (local edits?); see ../README.md"
  fi
  RDNA2=(-e MAYA3_DTYPE=fp16 -e MAYA3_FUSE_ROPE=0)
fi

docker rm -f "$NAME" >/dev/null 2>&1 || true
exec "$HERE/../common/run-in-gpu-container.sh" -d --name "$NAME" -p "127.0.0.1:$PORT:$PORT" \
  -e MAYA3_MIMI_DIR="$M/mimi" -e MAYA3_ECAPA_DIR="$M/ecapa" "${RDNA2[@]}" -- \
  "$TTS_PY" -I -m maya3.server --ckpt "$M/maya2-native" --mimi-dir "$M/mimi" --ecapa-dir "$M/ecapa" \
  --host 0.0.0.0 --port "$PORT" --max-seats "${MAYA_SEATS:-2}"
