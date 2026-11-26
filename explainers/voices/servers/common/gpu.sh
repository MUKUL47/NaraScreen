# Sourced by the TTS server scripts: pick the GPU the servers run on.
#
# Same rule as scripts/voice-engine.sh uses for Kokoro: the AMD GPU with the most compute
# units and at least 6 GB of its own memory (integrated GPUs are skipped), read from
# /sys/class/kfd. Sets and exports:
#   TTS_GPU_CARD       e.g. /dev/dri/card1
#   TTS_GPU_RENDER     e.g. /dev/dri/renderD128
#   TTS_GPU_GFX        e.g. gfx1031
#   TTS_GFX_OVERRIDE   HSA_OVERRIDE_GFX_VERSION for chips ROCm has no kernels for (gfx1031 -> 10.3.0), or ""
#   TTS_RENDER_GID     the host's render group id
# Returns 1 when there is no such GPU (NVIDIA is not wired up for these servers yet).

pick_tts_gpu() {
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
  export TTS_GPU_RENDER="/dev/dri/renderD$best_minor"
  export TTS_GPU_CARD="/dev/dri/$card"
  export TTS_RENDER_GID; TTS_RENDER_GID="$(getent group render | cut -d: -f3)"
  # gfx_target_version 100301 = gfx10.3.1. ROCm ships kernels for x.y.0 of these
  # families, so run e.g. gfx1031/gfx1032 as 10.3.0 and gfx1101/gfx1102 as 11.0.0.
  local major=$((best_gfx / 10000)) mid=$((best_gfx / 100 % 100)) step=$((best_gfx % 100))
  export TTS_GPU_GFX; TTS_GPU_GFX="gfx$major$(printf '%d%x' "$mid" "$step")"
  export TTS_GFX_OVERRIDE=""
  if ((step != 0)) && [[ "$major.$mid" == "10.3" || "$major.$mid" == "11.0" ]]; then
    TTS_GFX_OVERRIDE="$major.$mid.0"
  fi
}

# RDNA2 (gfx103x): bf16 GEMMs crash there, so Maya runs in fp16 (see maya2/rdna2.patch).
tts_gpu_is_rdna2() { [[ "${TTS_GPU_GFX:-}" == gfx103* ]]; }
