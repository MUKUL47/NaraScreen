#!/usr/bin/env bash
# Run a command in a throwaway ubuntu:24.04 container that sees ONLY the chosen AMD GPU
# (its card + render node and /dev/kfd), never an integrated GPU. The data directory
# ($NARASCREEN_TTS_HOME) and this servers/ folder are mounted at their host paths, so the
# venv and every path work unchanged. ROCm itself comes with the venv's torch wheels.
#
# Usage: common/run-in-gpu-container.sh [docker-run-opts --] <cmd...>
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$HERE/env.sh"
source "$HERE/gpu.sh"

pick_tts_gpu || tts_die "no AMD GPU with >= 6 GB of its own memory found (/dev/kfd, /sys/class/kfd); these servers need one"
tts_log "GPU: $TTS_GPU_GFX ($TTS_GPU_CARD, $TTS_GPU_RENDER)${TTS_GFX_OVERRIDE:+, running as $TTS_GFX_OVERRIDE}"

EXTRA=()
if [[ " $* " == *" -- "* ]]; then
  while [[ "$1" != "--" ]]; do EXTRA+=("$1"); shift; done; shift
fi
C=$H/cache
LIBDRM=()
[[ -d /usr/share/libdrm ]] && LIBDRM=(-v /usr/share/libdrm:/usr/share/libdrm:ro -v /usr/share/libdrm:/opt/amdgpu/share/libdrm:ro)

exec docker run --rm \
  --device /dev/kfd --device "$TTS_GPU_CARD" --device "$TTS_GPU_RENDER" \
  --group-add video ${TTS_RENDER_GID:+--group-add "$TTS_RENDER_GID"} \
  --user "$(id -u):$(id -g)" \
  ${TTS_GFX_OVERRIDE:+-e HSA_OVERRIDE_GFX_VERSION="$TTS_GFX_OVERRIDE"} \
  -e NARASCREEN_TTS_HOME="$H" \
  -e HF_HOME="$C/hf" -e HOME="$C/home" -e HF_HUB_OFFLINE=1 \
  -e MIOPEN_USER_DB_PATH="$C/miopen" -e MIOPEN_CUSTOM_CACHE_DIR="$C/miopen" -e MIOPEN_FIND_MODE=2 \
  -e NUMBA_CACHE_DIR="$C/numba" -e TRITON_CACHE_DIR="$C/triton" \
  -e CC="$TTS_SERVERS/common/cc" \
  -e PYTHONUNBUFFERED=1 -e TQDM_DISABLE=1 \
  -v "$TTS_SERVERS:$TTS_SERVERS:ro" -v "$H:$H" -w "$H" \
  "${LIBDRM[@]}" \
  "${EXTRA[@]}" \
  ubuntu:24.04 "$@"
