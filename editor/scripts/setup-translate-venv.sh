#!/bin/bash
# Create a lightweight Python venv for CTranslate2 + SentencePiece (offline translation)
# Usage: ./setup-translate-venv.sh [venv-dir]

set -euo pipefail

VENV_DIR="${1:-translate-venv}"

echo "Creating translation Python venv at: $VENV_DIR"

python3 -m venv "$VENV_DIR"

# Activate and install
"$VENV_DIR/bin/pip" install --upgrade pip
"$VENV_DIR/bin/pip" install \
  ctranslate2 \
  sentencepiece \
  transformers \
  --no-cache-dir

# Install CPU-only PyTorch (needed for converting models without pre-converted CT2 versions)
"$VENV_DIR/bin/pip" install torch --index-url https://download.pytorch.org/whl/cpu --no-cache-dir

echo ""
echo "Translation venv ready: $VENV_DIR"
echo "  Python: $VENV_DIR/bin/python3"
echo ""
echo "Packages installed:"
"$VENV_DIR/bin/pip" list --format=columns | grep -E "ctranslate2|sentencepiece|transformers"
echo ""
echo "Translation models will be downloaded on demand to:"
echo "  ~/.config/narascreen/narascreen-models/translation/"
echo ""
echo "Total venv size:"
du -sh "$VENV_DIR"
