# Sourced by the TTS server scripts: where everything lives, and the first-run install.
#
# Everything big (Python, the venv, source checkouts, weights, caches, reference voices)
# lives in ONE data directory, $NARASCREEN_TTS_HOME. When it is unset it is read from
# servers/.env.local (a line NARASCREEN_TTS_HOME=/path; git-ignored), else it defaults to
# servers/.data/ (git-ignored). Layout:
#   python/   uv-managed CPython 3.11        .venv/    the shared env of both servers
#   src/chatterbox, src/maya2                pinned source checkouts (installed editable)
#   models/maya2-native, models/mimi, models/ecapa      Maya weights
#   cache/hf  Hugging Face cache (Chatterbox weights)   cache/{home,miopen,numba,triton}
#   voices/   reference clips for Chatterbox (en_f1.flac, hi_f1.flac, any <name>.wav|flac|mp3)
# Anything missing is created on first start; anything present is used as is.

TTS_SERVERS="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

tts_log() { printf '[tts-servers] %s\n' "$*" >&2; }
tts_die() { tts_log "$*"; exit 1; }

if [[ -z "${NARASCREEN_TTS_HOME:-}" && -f "$TTS_SERVERS/.env.local" ]]; then
  NARASCREEN_TTS_HOME=$(sed -n 's/^[[:space:]]*\(export[[:space:]]\+\)\?NARASCREEN_TTS_HOME=//p' "$TTS_SERVERS/.env.local" | tail -1)
  NARASCREEN_TTS_HOME=${NARASCREEN_TTS_HOME%\"}; NARASCREEN_TTS_HOME=${NARASCREEN_TTS_HOME#\"}
  NARASCREEN_TTS_HOME=${NARASCREEN_TTS_HOME%\'}; NARASCREEN_TTS_HOME=${NARASCREEN_TTS_HOME#\'}
  NARASCREEN_TTS_HOME=${NARASCREEN_TTS_HOME/#\~/$HOME}
fi
NARASCREEN_TTS_HOME=${NARASCREEN_TTS_HOME:-$TTS_SERVERS/.data}
[[ "$NARASCREEN_TTS_HOME" == /* ]] || NARASCREEN_TTS_HOME="$TTS_SERVERS/$NARASCREEN_TTS_HOME"
mkdir -p "$NARASCREEN_TTS_HOME" || tts_die "cannot create NARASCREEN_TTS_HOME=$NARASCREEN_TTS_HOME"
NARASCREEN_TTS_HOME="$(cd "$NARASCREEN_TTS_HOME" && pwd)"
export NARASCREEN_TTS_HOME

H=$NARASCREEN_TTS_HOME
TTS_VENV=$H/.venv
TTS_PY=$TTS_VENV/bin/python

# Pinned upstream sources (the commits this setup was tested with)
CHATTERBOX_GIT=https://github.com/resemble-ai/chatterbox.git
CHATTERBOX_REF=ab55923c27757c90cfcc407baa57dc25a7d25217
MAYA2_GIT=https://github.com/MayaResearch/maya2-native
MAYA2_REF=c6b376868e268551d065c4206193e96257bef4a1
TORCH_INDEX=https://download.pytorch.org/whl/rocm6.4

_clone() {  # $1 dir, $2 url, $3 commit
  [[ -d "$1/.git" || -f "$1/pyproject.toml" ]] && return 0
  command -v git >/dev/null || tts_die "git is needed to fetch $2"
  tts_log "fetching $2 @ ${3:0:7} into $1"
  mkdir -p "$(dirname "$1")"
  git clone -q "$2" "$1" && git -C "$1" checkout -q "$3" || tts_die "could not fetch $2"
}

_venv_ok() {
  [[ -x "$TTS_PY" ]] && "$TTS_PY" -I -c 'import importlib.util as u, sys; sys.exit(0 if u.find_spec("chatterbox") and u.find_spec("maya3") else 1)' 2>/dev/null
}

# The shared venv and both source checkouts (~8 GB, mostly torch). Needs uv and git on the host.
tts_install_common() {
  mkdir -p "$H"/cache/{hf,home,miopen,numba,triton} "$H/voices" "$H/models"
  _clone "$H/src/chatterbox" "$CHATTERBOX_GIT" "$CHATTERBOX_REF"
  _clone "$H/src/maya2" "$MAYA2_GIT" "$MAYA2_REF"
  _venv_ok && return 0
  command -v uv >/dev/null || tts_die "first run: uv is needed to create $TTS_VENV (https://docs.astral.sh/uv/)"
  tts_log "first run: creating the Python env in $TTS_VENV (torch for ROCm, several GB)"
  [[ -x "$TTS_PY" ]] || UV_PYTHON_INSTALL_DIR="$H/python" uv venv -q --python 3.11 --managed-python "$TTS_VENV" \
    || tts_die "uv venv failed"
  uv pip install -q --python "$TTS_PY" -r "$TTS_SERVERS/common/requirements-rocm.txt" \
    --extra-index-url "$TORCH_INDEX" --index-strategy unsafe-best-match || tts_die "installing requirements failed"
  uv pip install -q --python "$TTS_PY" --no-deps -e "$H/src/chatterbox" -e "$H/src/maya2" \
    || tts_die "installing chatterbox/maya3 failed"
  _venv_ok || tts_die "the env in $TTS_VENV still cannot import chatterbox and maya3"
}

_hf() {  # $1 repo, $2 local dir ("" = the HF cache), $3.. allow patterns
  local repo=$1 dir=$2; shift 2
  tts_log "first run: downloading $repo${dir:+ into $dir}"
  HF_HOME="$H/cache/hf" "$TTS_PY" -I -c '
import sys
from huggingface_hub import snapshot_download
repo, d, pats = sys.argv[1], sys.argv[2] or None, sys.argv[3:]
snapshot_download(repo, local_dir=d, allow_patterns=pats or None)' "$repo" "$dir" "$@" || tts_die "downloading $repo failed"
}

# Chatterbox Multilingual V3 weights (~3 GB) into the HF cache, as from_pretrained(t3_model="v3") wants them.
tts_ensure_chatterbox_weights() {
  compgen -G "$H/cache/hf/hub/models--ResembleAI--chatterbox/snapshots/*/t3_mtl23ls_v3.safetensors" >/dev/null && return 0
  _hf ResembleAI/chatterbox "" ve.pt t3_mtl23ls_v3.safetensors s3gen.pt grapheme_mtl_merged_expanded_v1.json conds.pt Cangjie5_TC.json
}

# Maya-2-Native release (~4.7 GB), the Mimi codec and the ECAPA speaker encoder, as local folders.
tts_ensure_maya2_weights() {
  local m=$H/models
  [[ -f "$m/maya2-native/maya3_config.json" && -f "$m/maya2-native/model.safetensors.index.json" ]] || \
    _hf maya-research/maya2-native "$m/maya2-native" '*.safetensors' '*.safetensors.index.json' maya3_config.json \
      config.json 'backbone/*' 'voices/*' README.md LICENSE
  [[ -f "$m/mimi/model.safetensors" ]] || _hf kyutai/mimi "$m/mimi" config.json model.safetensors preprocessor_config.json
  [[ -f "$m/ecapa/embedding_model.ckpt" ]] || _hf speechbrain/spkrec-ecapa-voxceleb "$m/ecapa" embedding_model.ckpt hyperparams.yaml
}

# Chatterbox's "female" voices are reference clips. When they are missing, make them with the local
# Kokoro engine (Apache-2.0 voices af_heart / hf_alpha); without Kokoro the built-in voice is used.
tts_ensure_voices() {
  local v=$H/voices name voice text
  mkdir -p "$v"
  for name in en_f1 hi_f1; do
    compgen -G "$v/$name.*" >/dev/null && continue
    if [[ $name == en_f1 ]]; then voice=af_heart; text="Hello and welcome. Today I will show you how this works, one simple step at a time."
    else voice=hf_alpha; text="नमस्ते और आपका स्वागत है। आज मैं आपको एक-एक करके दिखाऊँगी कि यह कैसे काम करता है।"; fi
    # --retry: Kokoro's first request in a new language can fail while that pipeline loads
    if curl -sf -m 90 --retry 2 --retry-all-errors -o "$v/.$name.wav" -X POST http://localhost:8880/v1/audio/speech \
         -H 'Content-Type: application/json' \
         -d "{\"model\":\"kokoro\",\"input\":\"$text\",\"voice\":\"$voice\",\"response_format\":\"wav\"}" &&
       ffmpeg -loglevel error -y -i "$v/.$name.wav" -ac 1 -ar 24000 "$v/$name.flac"; then
      tts_log "made reference voice $name from Kokoro's $voice"
    else
      tts_log "warning: no $v/$name.flac (Kokoro not reachable?); Chatterbox will use its built-in voice for it"
    fi
    rm -f "$v/.$name.wav"
  done
}
