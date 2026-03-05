# NaraScreen

**Record your screen. Add narration. Produce a professional demo video.**

Free. Local. Open source. No cloud, no subscriptions, no watermarks.

---

## What is this?

NaraScreen is a desktop app that turns raw screen recordings into polished product demos with voiceover narration. Record yourself clicking through any app, then use the visual timeline editor to add zoom effects, narration in 9 languages, spotlights, speed ramps, text callouts, and background music. Hit produce and get a finished MP4.

Everything runs on your machine. The voice engine (Kokoro TTS) runs locally via Docker. No data leaves your computer.

---

## Quick Start

### Prerequisites

- **[Node.js](https://nodejs.org/)** 18+
- **[FFmpeg](https://ffmpeg.org/)** installed and in PATH
- **[Docker](https://www.docker.com/)** (for the voice engine)

### 1. Start the voice engine

```bash
docker compose up -d
```

First run downloads the Kokoro model (~500MB). After that it starts in seconds.

### 2. Install dependencies and launch the editor

```bash
cd editor
npm install
npm run dev
```

The Electron app opens. Record your screen, add actions on the timeline, produce your video.

---

## How It Works

```
Record Screen ──> Visual Timeline Editor ──> Produce MP4
                       │
                       ├── Add narration (TTS or record your voice)
                       ├── Zoom into regions
                       ├── Spotlight & dim
                       ├── Speed ramp sections
                       ├── Text callouts & step counters
                       └── Background music with auto-ducking
```

1. **Record** — Click "Record Screen", pick a display, perform your demo
2. **Edit** — Place actions on the timeline: zoom, narrate, spotlight, speed ramp, callouts, music
3. **Generate Audio** — Pick a language and voice, write narration text, click generate
4. **Produce** — One click renders the final video with all effects baked in

---

## Features

### Timeline Editor
- **Multi-lane timeline** — Per-action-type horizontal lanes with colored pill clips
- **Visual filmstrip** — Thumbnail strip of your recording for easy navigation
- **Playhead scrubbing** — Click anywhere to seek, frame-accurate positioning
- **Drag-to-select** — Drag a range on the timeline to quickly add range-based actions
- **Drag-to-move** — Grab any action pill and drag it to reposition on the timeline
- **Drag edge handles** — Hover pill edges to resize action duration directly on the timeline
- **Snap-to-playhead** — Actions snap to the playhead, timeline boundaries, and other action edges when dragging (yellow guide line)
- **Adaptive time ruler** — Tick intervals adjust automatically based on timeline density

### Action Types

| Action | Description |
|--------|-------------|
| **Narrate** | Text-to-speech or record your own voice, with karaoke-style word-highlighted subtitles |
| **Zoom** | Draw a region on the video, smooth animated zoom in → hold → zoom out |
| **Pause** | Freeze the video frame for emphasis |
| **Spotlight** | Highlight a region, dim everything else with adjustable opacity |
| **Blur** | Blur one or multiple regions to hide sensitive data |
| **Mute** | Strip audio from a specific time range |
| **Speed Ramp** | 0.25x to 4x playback speed for any section |
| **Skip/Cut** | Remove a section of the recording entirely |
| **Text Callout** | Labels, step counters, lower-third banners overlaid on the video |
| **Background Music** | Ambient audio track that auto-ducks during narration |

### Video Player
- **Playback speed control** — Cycle through 0.5x / 1x / 1.5x / 2x
- **Frame-by-frame seeking** — Arrow keys for 1s, Shift+arrows for 5s jumps
- **Draw regions** — Click and drag on the video to define zoom, spotlight, blur, or callout regions

### Editing Workflow
- **Duplicate action** — Press D to clone any action (offset by 1 second)
- **Split action at playhead** — Press B to split range-based actions into two parts
- **Undo/Redo** — 50-level history (Ctrl+Z / Ctrl+Shift+Z)
- **Auto-save** — Debounced 3-second save after any change, never lose work
- **Quick-add shortcuts** — Number keys 1-9 to instantly add actions at the playhead

### Narration
- **62 TTS voices** across **9 languages** via Kokoro
- **Record your own voice** — microphone recording directly in the editor
- **Multi-language** — Add multiple languages per action, switch from a dropdown
- **Karaoke subtitles** — Word-by-word highlighting synced to audio
- **Adjustable subtitle size** — Slider from 16px to 64px
- **Freeze or play** — Choose whether video freezes or keeps playing during narration

### Production
- **One-click produce** — Renders final MP4 with all effects baked in
- **Versioned output** — Auto-saves as `final_v1.mp4`, `final_v2.mp4`, etc.
- **Live production logs** — Real-time progress logs in the loading overlay
- **FFmpeg pipeline** — zoompan, setpts, drawtext, concat, amix, ASS subtitles

### Keyboard Shortcuts

| Key | Action |
|-----|--------|
| Space | Play / Pause |
| Left / Right | Seek -1s / +1s |
| Shift + Left / Right | Seek -5s / +5s |
| Ctrl+Z | Undo |
| Ctrl+Shift+Z / Ctrl+Y | Redo |
| Ctrl+S | Save |
| Delete / Backspace | Delete selected action |
| D | Duplicate selected action |
| B | Split selected action at playhead |
| Escape | Deselect action |
| 1-9 | Quick-add action at playhead (1=Zoom, 2=Narrate, 3=Spotlight, 4=Blur, 5=Mute, 6=Speed, 7=Callout, 8=Music, 9=Skip) |

---

## Architecture

```
ui-demo-pipeline/
├── editor/                    # Electron + React app
│   ├── electron/              # Main process (Node.js)
│   │   ├── main.ts            # Electron entry, IPC handlers
│   │   ├── capture.ts         # Screen recording via x11grab
│   │   ├── produce.ts         # Video production pipeline
│   │   ├── ffmpeg.ts          # FFmpeg wrapper functions
│   │   └── preload.ts         # Electron preload bridge
│   ├── src/                   # Renderer process (React)
│   │   ├── App.tsx            # Root component
│   │   ├── components/
│   │   │   ├── Timeline.tsx       # Visual timeline with filmstrip
│   │   │   ├── Toolbar.tsx        # Top toolbar (record, save, produce)
│   │   │   ├── VideoPlayer.tsx    # Preview player
│   │   │   ├── ActionPanel.tsx    # Action editor sidebar
│   │   │   ├── ActionIcon.tsx     # Lucide icon mappings
│   │   │   ├── CaptureToolbar.tsx # Recording controls
│   │   │   └── actions/           # Per-action-type editors
│   │   │       ├── NarrateEditor.tsx
│   │   │       ├── AudioControls.tsx
│   │   │       └── ...
│   │   ├── stores/
│   │   │   └── useProjectStore.ts # Zustand state management
│   │   ├── lib/               # Utilities (constants, formatTime, fileOps)
│   │   └── types.ts           # TypeScript type definitions
│   └── package.json
├── docker-compose.yml         # Kokoro TTS voice engine
├── docker-compose.web.yml     # Browser-only mode
├── Dockerfile                 # Web container build
└── README.md
```

### Production Pipeline (produce.ts)

The produce step processes the recording through these stages:

1. **Parse actions** — Group actions by timestamp, identify skip/speed ranges
2. **Cut segments** — Split recording at action boundaries, apply speed ramps via `setpts`
3. **Render effects** — For each action group: freeze frames, zoompan, spotlight overlays, text callouts, subtitle burn
4. **Overlay audio** — Mix TTS/recorded narration onto video segments
5. **Normalize** — Ensure all segments have consistent audio format (44100Hz stereo AAC)
6. **Concatenate** — Join all segments with ffmpeg concat demuxer
7. **Mix music** — Layer background music with auto-ducking during narration sections

---

## Voice Engine (Kokoro TTS)

NaraScreen uses [Kokoro FastAPI](https://github.com/remsky/Kokoro-FastAPI) for text-to-speech — a fast, local TTS engine with natural-sounding voices.

**62 voices across 9 languages:**

| Language | Voices | Examples |
|----------|--------|----------|
| English (US) | 20 | af_heart, af_bella, af_nova, am_adam |
| English (UK) | 8 | bf_alice, bf_emma, bm_daniel, bm_george |
| Hindi | 4 | hf_alpha, hf_beta, hm_omega, hm_psi |
| Japanese | 5 | jf_alpha, jf_gongitsune, jm_kumo |
| Chinese | 8 | zf_xiaobei, zf_xiaoni, zm_yunjian |
| Spanish | 3 | ef_dora, em_alex |
| Brazilian Portuguese | 3 | pf_dora, pm_alex |
| Italian | 2 | if_sara, im_nicola |
| French | 1 | ff_siwis |

### Running Kokoro without Docker

```bash
pip install kokoro-fastapi
kokoro-fastapi --host 0.0.0.0 --port 8880
```

**Without any voice engine:** The editor still works — produce will skip TTS if audio files don't exist.

---

## Docker Commands

```bash
# Start voice engine
docker compose up -d

# Stop
docker compose down

# View logs
docker compose logs -f kokoro

# Verify running
curl http://localhost:8880/v1/models
```

### GPU Acceleration (NVIDIA)

Edit `docker-compose.yml`, uncomment the GPU section, then:

```bash
docker compose up -d --force-recreate kokoro
```

---

## Built With

NaraScreen stands on the shoulders of these incredible open source projects:

- **[Electron](https://github.com/electron/electron)** — Cross-platform desktop apps with web technologies. Powers our entire desktop experience.
- **[React](https://github.com/facebook/react)** (v19) — The UI library behind the timeline editor, action panels, and every interactive element.
- **[FFmpeg](https://github.com/FFmpeg/FFmpeg)** — The backbone of our entire video pipeline. Every cut, zoom, speed ramp, subtitle burn, audio mix, and concat runs through FFmpeg. None of this would be possible without it.
- **[Kokoro FastAPI](https://github.com/remsky/Kokoro-FastAPI)** — Local text-to-speech engine providing 62 natural-sounding voices across 9 languages. Built by [@remsky](https://github.com/remsky).
- **[Vite](https://github.com/vitejs/vite)** — Lightning-fast dev server and build tool.
- **[Zustand](https://github.com/pmndrs/zustand)** — Minimal, fast state management for React.
- **[Tailwind CSS](https://github.com/tailwindlabs/tailwindcss)** (v4) — Utility-first CSS framework for the dark-themed editor UI.
- **[Lucide](https://github.com/lucide-icons/lucide)** — Beautiful, consistent icon set used throughout the interface.
- **[TypeScript](https://github.com/microsoft/TypeScript)** — Type safety across the entire codebase.

---

## License

MIT — Use it for anything. Free forever.

## Roadmap

- [x] Voice recording (record your own narration)
- [x] Keep video playing during narration
- [x] Drag-to-select timeline ranges
- [x] Adjustable subtitle size
- [x] Speed ramp production
- [x] Multi-language narration support
- [ ] Pan effect (smooth camera movement)
- [ ] Blur region (hide sensitive data)
- [ ] Cursor highlight (glowing click indicator)
- [ ] Picture-in-picture (webcam overlay)
- [ ] GIF export
- [ ] Multi-resolution export (1080p, 720p, 9:16)
- [ ] One-click installer with bundled Kokoro
