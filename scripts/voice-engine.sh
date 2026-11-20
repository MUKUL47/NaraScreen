#!/usr/bin/env bash
# Start NaraScreen's voice engine (Kokoro) on the GPU if one works, else on the CPU.
#
#   scripts/voice-engine.sh            # = up: GPU first, CPU fallback
#   scripts/voice-engine.sh up --cpu   # skip the GPU
#   scripts/voice-engine.sh status     # which engine is running, on what
#   scripts/voice-engine.sh down       # stop it
#
# GPU order: NVIDIA (if nvidia-smi works), then the largest AMD GPU with >= 6 GB of
# its own memory (integrated GPUs are skipped). The GPU engine only counts as working
# if the model loaded on the GPU AND a test sentence comes back as audio; anything
# else (missing image, driver error, silent CPU fallback inside the container,
# timeout) switches to the CPU engine. Every engine serves http://localhost:8880.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
URL="http://localhost:8880"
NAME="narascreen-kokoro"
READY_TIMEOUT="${KOKORO_READY_TIMEOUT:-240}"   # seconds, after the image is pulled

log()  { printf '[voice-engine] %s\n' "$*" >&2; }
compose() { docker compose -f "$ROOT/$1" "${@:2}"; }

stop_all() {
  for f in docker-compose.yml docker-compose.rocm.yml docker-compose.cuda.yml; do
    compose "$f" down --remove-orphans >/dev/null 2>&1 || true
  done
  docker rm -f "$NAME" >/dev/null 2>&1 || true
}

wait_ready() {
  local deadline=$((SECONDS + READY_TIMEOUT))
  while ((SECONDS < deadline)); do
    curl -sf -o /dev/null "$URL/v1/audio/voices" && return 0
    if [[ -z "$(docker ps -q -f "name=^${NAME}$" -f status=running)" ]]; then
      log "container stopped while starting:"
      docker logs --tail 15 "$NAME" 2>&1 | sed 's/^/    /' >&2
      return 1
    fi
    sleep 2
  done
  log "not ready after ${READY_TIMEOUT}s"
  return 1
}

speaks() {  # a real sentence must come back as non-trivial audio
  local bytes
  bytes=$(curl -sf -m 60 -X POST "$URL/v1/audio/speech" -H 'Content-Type: application/json' \
    -d '{"model":"kokoro","input":"Voice engine check.","voice":"af_heart","response_format":"wav"}' | wc -c)
  ((bytes > 10000))
}

on_gpu() {  # the image prints "Loading Kokoro model on cuda" (ROCm reports as cuda too)
  # Capture first: with pipefail, `docker logs | grep -q` fails when grep exits early.
  local logs; logs=$(docker logs "$NAME" 2>&1)
  [[ "$logs" == *"model on cuda"* ]]
}

# --- GPU detection ---------------------------------------------------------
pick_amd_gpu() {  # sets KOKORO_GPU_CARD / _RENDER / _GFX_OVERRIDE / KOKORO_RENDER_GID
  [[ -e /dev/kfd ]] || return 1
  local best_simd=0 best_minor="" best_gfx="" n simd gfx minor vram card
  for n in /sys/class/kfd/kfd/topology/nodes/*/properties; do
    simd=$(awk '$1=="simd_count"{print $2}' "$n")
    gfx=$(awk '$1=="gfx_target_version"{print $2}' "$n")
    minor=$(awk '$1=="drm_render_minor"{print $2}' "$n")
    [[ "${simd:-0}" -gt 0 && -e "/dev/dri/renderD$minor" ]] || continue
    vram=$(cat "/sys/class/drm/renderD$minor/device/mem_info_vram_total" 2>/dev/null || echo 0)
    ((vram >= 6 * 1024 ** 3)) || continue          # skip integrated GPUs
    ((simd > best_simd)) || continue
    best_simd=$simd; best_minor=$minor; best_gfx=$gfx
  done
  [[ -n "$best_minor" ]] || return 1
  card=$(ls "/sys/class/drm/renderD$best_minor/device/drm" | grep -m1 '^card')
  export KOKORO_GPU_RENDER="/dev/dri/renderD$best_minor"
  export KOKORO_GPU_CARD="/dev/dri/$card"
  export KOKORO_RENDER_GID="$(getent group render | cut -d: -f3)"
  # gfx_target_version 100301 = gfx10.3.1. ROCm ships kernels for x.y.0 of these
  # families, so run e.g. gfx1031/gfx1032 as 10.3.0 and gfx1101/gfx1102 as 11.0.0.
  local major=$((best_gfx / 10000)) mid=$((best_gfx / 100 % 100)) step=$((best_gfx % 100))
  export KOKORO_GFX_OVERRIDE=""
  if ((step != 0)) && [[ "$major.$mid" == "10.3" || "$major.$mid" == "11.0" ]]; then
    KOKORO_GFX_OVERRIDE="$major.$mid.0"
  fi
  local pci; pci=$(basename "$(readlink -f "/sys/class/drm/renderD$best_minor/device")")
  log "AMD GPU: $pci gfx$major$(printf '%d%x' "$mid" "$step") ($KOKORO_GPU_CARD, $KOKORO_GPU_RENDER)${KOKORO_GFX_OVERRIDE:+, running as $KOKORO_GFX_OVERRIDE}"
}

try_engine() {  # $1 compose file, $2 label, $3 = "gpu" to require the GPU
  log "starting $2 engine…"
  if ! compose "$1" pull -q >/dev/null 2>&1 && ! docker image inspect "$(compose "$1" config --images 2>/dev/null)" >/dev/null 2>&1; then
    log "$2 image could not be pulled"; return 1
  fi
  if ! compose "$1" up -d >/dev/null 2>&1; then
    log "$2 container failed to start:"; compose "$1" up -d 2>&1 | tail -5 | sed 's/^/    /' >&2
    return 1
  fi
  wait_ready || return 1
  if [[ "${3:-}" == gpu ]] && ! on_gpu; then
    log "$2 engine loaded the model on the CPU, not the GPU"; return 1
  fi
  speaks || { log "$2 engine did not return audio for a test sentence"; return 1; }
  log "ready: $2 engine at $URL"
}

cmd_up() {
  local want_gpu=1
  [[ "${1:-}" == "--cpu" || "${KOKORO_DEVICE:-auto}" == "cpu" ]] && want_gpu=0
  stop_all
  if ((want_gpu)); then
    if nvidia-smi -L >/dev/null 2>&1; then
      try_engine docker-compose.cuda.yml "NVIDIA GPU" gpu && return 0
      stop_all
    elif pick_amd_gpu; then
      try_engine docker-compose.rocm.yml "AMD GPU" gpu && return 0
      stop_all
    else
      log "no usable GPU found"
    fi
    log "falling back to CPU"
  fi
  try_engine docker-compose.yml "CPU" && return 0
  log "the CPU engine failed too; see: docker logs $NAME"
  return 1
}

cmd_status() {
  local image
  image=$(docker inspect -f '{{.Config.Image}}' "$NAME" 2>/dev/null) || { echo "not running"; return 1; }
  local where=CPU
  [[ "$image" == *rocm* || "$image" == *gpu* ]] && on_gpu && where=GPU
  curl -sf -o /dev/null "$URL/v1/audio/voices" && state=ready || state="not responding"
  echo "$image on $where — $state ($URL)"
}

case "${1:-up}" in
  up)     shift || true; cmd_up "$@" ;;
  down)   stop_all; log "stopped" ;;
  status) cmd_status ;;
  *)      echo "usage: $0 [up [--cpu] | status | down]" >&2; exit 2 ;;
esac
