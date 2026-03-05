# NaraScreen

Desktop app for recording, editing, and producing polished demo videos with TTS narration, zoom effects, blur, and more.

**Stack:** Electron + React + Zustand + Tailwind v4 + FFmpeg

## Setup

```bash
# Requirements: Node.js 20+
npm install
npm run dev
```

## TTS (Kokoro)

NaraScreen uses Kokoro for text-to-speech. Two modes:

**Option A — Docker (recommended):**
```bash
docker run -p 8880:8880 ghcr.io/remsky/kokoro-fastapi-cpu
```

**Option B — Direct Python:**
```bash
pip install kokoro soundfile numpy
export KOKORO_PYTHON=$(which python3)
```

## Building Distributables

Builds a self-contained binary with bundled FFmpeg and FFprobe. No external dependencies needed for end users.

### Prerequisites

- Node.js 20+
- npm

### Build for Current Platform

```bash
npm run dist
```

### Build for Specific Platform

```bash
# Linux — produces AppImage
npm run dist:linux

# macOS — produces DMG (must build on macOS)
npm run dist:mac

# Windows — produces portable EXE (must build on Windows)
npm run dist:win
```

### Output

Binaries are written to `release/`:

| Platform | Format | File |
|----------|--------|------|
| Linux | AppImage | `NaraScreen-1.0.0.AppImage` |
| macOS | DMG | `NaraScreen-1.0.0.dmg` |
| Windows | Portable | `NaraScreen-1.0.0.exe` |

### Cross-Platform Builds

You **cannot** cross-compile — each platform must be built on its native OS because `ffmpeg-static` downloads platform-specific binaries at `npm install` time.

For all 3 platforms, use GitHub Actions CI:

```yaml
# .github/workflows/build.yml
name: Build
on:
  push:
    tags: ['v*']

jobs:
  build:
    strategy:
      matrix:
        os: [ubuntu-latest, macos-latest, windows-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
        working-directory: editor
      - run: npm run dist
        working-directory: editor
      - uses: actions/upload-artifact@v4
        with:
          name: release-${{ matrix.os }}
          path: editor/release/*
```

### What Gets Bundled

- Electron runtime (~100 MB)
- FFmpeg binary (~77 MB) — via `ffmpeg-static`
- FFprobe binary (~62 MB) — via `ffprobe-static`
- React app + Electron main process code

### Kokoro TTS in Packaged App

Kokoro is **not bundled** (it would add ~500 MB+ of Python). Users have two options:

1. **HTTP API** (default) — run the Docker container, app connects to `localhost:8880`
2. **Bundled venv** (optional) — place a Python venv with kokoro at `resources/kokoro-venv/` before building. The app auto-detects it.

### App Icon

Replace `build/icon.png` with your own 512x512 PNG before building.

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+Z` | Undo |
| `Ctrl+Shift+Z` / `Ctrl+Y` | Redo |
| `Ctrl+S` | Save |
| `Delete` | Delete selected action |
| `Escape` | Deselect |
| `Space` | Play / Pause |
| `Left` / `Right` | Seek ±1s |
| `Shift+Left` / `Shift+Right` | Seek ±5s |
| `Ctrl+Scroll` | Timeline zoom |

## Action Types

| Type | Key | Description |
|------|-----|-------------|
| Pause | P | Freeze video, resume after narration/zoom/duration |
| Zoom | Z | Animated zoom in → hold → zoom out on a region |
| Narrate | N | TTS or voice recording with optional subtitles |
| Spotlight | S | Highlight region, dim the rest |
| Speed | F | Time-stretch a section (0.25x–4x) |
| Skip | X | Cut out a section entirely |
| Callout | T | Text overlay (label, step-counter, lower-third) |
| Music | M | Background music with auto-ducking |
| Blur | B | Blur sensitive regions (multi-region) |
| Mute | 🔇 | Strip audio from a time range |
