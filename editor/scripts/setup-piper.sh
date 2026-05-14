#!/bin/bash
# Download Piper TTS binary for the current platform
# Usage: ./setup-piper.sh [install-dir]

set -euo pipefail

INSTALL_DIR="${1:-piper}"
PIPER_VERSION="2023.11.14-2"

# Detect platform
OS="$(uname -s)"
ARCH="$(uname -m)"

case "$OS" in
  Linux)
    case "$ARCH" in
      x86_64)  PLATFORM="linux_x86_64" ;;
      aarch64) PLATFORM="linux_aarch64" ;;
      *)       echo "Unsupported Linux arch: $ARCH"; exit 1 ;;
    esac
    ;;
  Darwin)
    case "$ARCH" in
      x86_64)  PLATFORM="macos_x64" ;;
      arm64)   PLATFORM="macos_aarch64" ;;
      *)       echo "Unsupported macOS arch: $ARCH"; exit 1 ;;
    esac
    ;;
  *)
    echo "Unsupported OS: $OS (use WSL on Windows)"
    exit 1
    ;;
esac

URL="https://github.com/rhasspy/piper/releases/download/${PIPER_VERSION}/piper_${PLATFORM}.tar.gz"

echo "Downloading Piper TTS (${PLATFORM})..."
echo "  URL: $URL"

mkdir -p "$INSTALL_DIR"
curl -L --progress-bar "$URL" | tar xz -C "$INSTALL_DIR" --strip-components=1

chmod +x "$INSTALL_DIR/piper"

echo ""
echo "Piper TTS installed to: $INSTALL_DIR/"
echo "Binary: $INSTALL_DIR/piper"
echo ""
echo "Voice models will be downloaded on demand to:"
echo "  ~/.config/narascreen/narascreen-models/piper/"
echo ""
echo "To test: echo 'Hello world' | $INSTALL_DIR/piper --model <model.onnx> --output_file test.wav"
