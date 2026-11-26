#!/usr/bin/env bash
# Start Chatterbox Multilingual V3 (Resemble AI, MIT) as an OpenAI-style server on http://127.0.0.1:8890,
# in a container that sees only the chosen AMD GPU. Returns once the container is started; it is ready
# when GET /health answers 200 (~15 s once the weights are on disk).
#
# Normally run by: scripts/voice-engine.sh up chatterbox   (stops maya2 first; only one fits next to Kokoro)
# First run: creates the venv and downloads the weights into $NARASCREEN_TTS_HOME (see ../README.md).
# Logs: docker logs -f narascreen-chatterbox     Stop: scripts/voice-engine.sh down chatterbox
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$HERE/../common/env.sh"
NAME=${CHATTERBOX_CONTAINER:-narascreen-chatterbox}
PORT=${CHATTERBOX_PORT:-8890}

tts_install_common
tts_ensure_chatterbox_weights
tts_ensure_voices

docker rm -f "$NAME" >/dev/null 2>&1 || true
exec "$HERE/../common/run-in-gpu-container.sh" -d --name "$NAME" -p "127.0.0.1:$PORT:$PORT" -e PORT="$PORT" -- \
  "$TTS_PY" -I "$HERE/server.py"
