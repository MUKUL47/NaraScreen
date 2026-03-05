#!/bin/bash
# Creates a portable Python venv with Kokoro TTS for bundling into the app.
# Run this BEFORE `npm run dist` to include Kokoro in the binary.
# This is OPTIONAL — the app works without it (falls back to HTTP API).
#
# Usage: bash scripts/setup-kokoro-venv.sh

set -e

VENV_DIR="kokoro-venv"

echo "[kokoro] Creating venv at $VENV_DIR..."
python3 -m venv "$VENV_DIR"

echo "[kokoro] Installing packages (kokoro + dependencies)..."
"$VENV_DIR/bin/pip" install --upgrade pip
"$VENV_DIR/bin/pip" install kokoro soundfile numpy

# Use CPU-only torch to keep size smaller (~200MB vs ~2GB)
"$VENV_DIR/bin/pip" install torch --index-url https://download.pytorch.org/whl/cpu

echo "[kokoro] Cleaning pip cache from venv..."
rm -rf "$VENV_DIR/lib/python*/site-packages/pip" 2>/dev/null || true
rm -rf "$VENV_DIR/lib/python*/site-packages/setuptools" 2>/dev/null || true
find "$VENV_DIR" -name "__pycache__" -type d -exec rm -rf {} + 2>/dev/null || true
find "$VENV_DIR" -name "*.pyc" -delete 2>/dev/null || true

SIZE=$(du -sh "$VENV_DIR" | cut -f1)
echo "[kokoro] Done! Venv size: $SIZE"
echo "[kokoro] Run 'npm run dist' to bundle it into the app."
