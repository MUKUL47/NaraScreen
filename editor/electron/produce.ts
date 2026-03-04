import { spawnSync } from "child_process";
import type { BrowserWindow } from "electron";
import * as path from "path";
import * as fs from "fs";
import { generateTTS } from "./tts";
import {
  probeDuration,
  probeResolution,
  extractFrame,
  cutClip,
  normalizeSegmentAudio,
  concatSegments,
} from "./ffmpeg";

interface Action {
  type: string;
  timestamp: number;
  resumeAfter?: string | number;
  narration?: string;
  narration_hi?: string;
  narrations?: Record<string, string>;
  audioPath?: Record<string, string>;
  playFor?: number;
  customAudioPath?: string;
  zoomRect?: [number, number, number, number];
  zoomDuration?: number;
  zoomHold?: number;
  spotlightRect?: [number, number, number, number];
  dimOpacity?: number;
  spotlightDuration?: number;
  speedFactor?: number;
  speedEndTimestamp?: number;
  skipEndTimestamp?: number;
  calloutText?: string;
  calloutPosition?: [number, number];
  calloutStyle?: string;
  calloutStep?: number;
  calloutDuration?: number;
  musicPath?: string;
  musicVolume?: number;
  musicDuckTo?: number;
  musicEndTimestamp?: number;
  subtitleSize?: number;
  showSubtitles?: boolean;
  [key: string]: unknown;
}

interface ActionGroup {
  ts: number;
  actions: Action[];
}

/** Group actions that occur within 0.1s of each other */
function groupActions(actions: Action[]): ActionGroup[] {
  const sorted = [...actions].sort((a, b) => a.timestamp - b.timestamp);
  const groups: ActionGroup[] = [];
  for (const action of sorted) {
    const last = groups[groups.length - 1];
    if (last && Math.abs(last.ts - action.timestamp) < 0.1) {
      last.actions.push(action);
    } else {
      groups.push({ ts: action.timestamp, actions: [action] });
    }
  }
  return groups;
}

/** Collect skip ranges from all actions, sorted */
function getSkipRanges(actions: Action[]): Array<{ start: number; end: number }> {
  return actions
    .filter((a) => a.type === "skip" && a.skipEndTimestamp)
    .map((a) => ({ start: a.timestamp, end: a.skipEndTimestamp! }))
    .sort((a, b) => a.start - b.start);
}

/** Collect speed ranges from all actions */
function getSpeedRanges(actions: Action[]): Array<{ start: number; end: number; factor: number }> {
  return actions
    .filter((a) => a.type === "speed" && a.speedEndTimestamp && a.speedFactor)
    .map((a) => ({ start: a.timestamp, end: a.speedEndTimestamp!, factor: a.speedFactor! }))
    .sort((a, b) => a.start - b.start);
}

/** Check if a time range overlaps with any skip range */
function isInSkipRange(time: number, skipRanges: Array<{ start: number; end: number }>): boolean {
  return skipRanges.some((r) => time >= r.start && time < r.end);
}

/** Get speed factor for a given time range */
function getSpeedForRange(start: number, end: number, speedRanges: Array<{ start: number; end: number; factor: number }>): number | null {
  const range = speedRanges.find((r) => start >= r.start - 0.1 && end <= r.end + 0.1);
  return range ? range.factor : null;
}

/** Get all split points (skip and speed boundaries) within a time range, sorted */
function getSplitPoints(
  from: number,
  to: number,
  skipRanges: Array<{ start: number; end: number }>,
  speedRanges: Array<{ start: number; end: number; factor: number }>,
): number[] {
  const points = new Set<number>();
  for (const r of skipRanges) {
    if (r.start > from + 0.05 && r.start < to - 0.05) points.add(r.start);
    if (r.end > from + 0.05 && r.end < to - 0.05) points.add(r.end);
  }
  for (const r of speedRanges) {
    if (r.start > from + 0.05 && r.start < to - 0.05) points.add(r.start);
    if (r.end > from + 0.05 && r.end < to - 0.05) points.add(r.end);
  }
  return [...points].sort((a, b) => a - b);
}

/** Check if a time range is inside a skip range */
function isRangeSkipped(start: number, end: number, skipRanges: Array<{ start: number; end: number }>): boolean {
  return skipRanges.some((r) => start >= r.start - 0.05 && end <= r.end + 0.05);
}

/** Find the first available narration text + audio from any language */
function findNarration(action: Action | null): { text: string; lang: string; audioPath?: string } | null {
  if (!action) return null;

  // Custom recorded audio takes priority
  if (action.customAudioPath && fs.existsSync(action.customAudioPath)) {
    return { text: "", lang: "custom", audioPath: action.customAudioPath };
  }

  // Check pre-generated audio first (any language)
  if (action.audioPath) {
    for (const [lang, ap] of Object.entries(action.audioPath)) {
      if (ap && fs.existsSync(ap)) {
        const text = action.narrations?.[lang] || (lang === "en" ? action.narration : undefined) || (lang === "hi" ? action.narration_hi : undefined) || "";
        return { text, lang, audioPath: ap };
      }
    }
  }

  // Check narrations record
  if (action.narrations) {
    for (const [lang, text] of Object.entries(action.narrations)) {
      if (text?.trim()) return { text, lang };
    }
  }

  // Legacy fields
  if (action.narration?.trim()) return { text: action.narration, lang: "en" };
  if (action.narration_hi?.trim()) return { text: action.narration_hi, lang: "hi" };

  return null;
}

/** Kokoro lang codes */
const LANG_CODES: Record<string, string> = {
  en: "a", "en-gb": "b", hi: "h", es: "e", fr: "f", ja: "j", zh: "z", pt: "p", it: "i",
};

/** Prepare narration audio — returns audioPath and whether audio exists */
function prepareNarrationAudio(
  action: Action | null,
  audioOutputPath: string,
  project: Record<string, unknown>,
  emit: (msg: string) => void,
  ts: number,
): { hasAudio: boolean; audioDuration: number } {
  const narr = findNarration(action);
  if (!narr) return { hasAudio: false, audioDuration: 0 };

  if (narr.audioPath) {
    emit(`Using pre-generated ${narr.lang} audio for action at ${ts.toFixed(1)}s`);
    fs.copyFileSync(narr.audioPath, audioOutputPath);
  } else {
    emit(`Generating ${narr.lang} TTS for action at ${ts.toFixed(1)}s`);
    const tts = project.tts as { voiceEn?: string; voiceHi?: string; speed?: number; kokoroEndpoint?: string; voices?: Record<string, string[]> } | undefined;
    const voice = tts?.voices?.[narr.lang]?.[0] || (narr.lang === "hi" ? tts?.voiceHi || "hf_alpha" : tts?.voiceEn || "af_heart");
    const speed = tts?.speed || 1;
    const langCode = LANG_CODES[narr.lang] || "a";
    generateTTS(narr.text, voice, speed, langCode, audioOutputPath, tts?.kokoroEndpoint);
  }

  if (fs.existsSync(audioOutputPath) && fs.statSync(audioOutputPath).size > 100) {
    const dur = probeDuration(audioOutputPath);
    return { hasAudio: true, audioDuration: dur > 0 ? dur : 0 };
  }
  return { hasAudio: false, audioDuration: 0 };
}

/** Build a freeze-frame segment (pause/narrate) */
function buildFreezeSegment(
  framePath: string,
  audioPath: string | null,
  hasAudio: boolean,
  freezeDuration: number,
  outputPath: string,
  res: { width: number; height: number },
  vf?: string,
): void {
  const args = ["-y", "-loop", "1", "-framerate", "30", "-i", framePath];
  if (hasAudio && audioPath) args.push("-i", audioPath);

  const filter = vf || `scale=${res.width}:${res.height}:force_original_aspect_ratio=decrease,pad=${res.width}:${res.height}:(ow-iw)/2:(oh-ih)/2`;
  args.push(
    "-t", freezeDuration.toFixed(3),
    "-r", "30",
    "-vf", filter,
    "-c:v", "libx264", "-preset", "fast", "-crf", "18",
    "-pix_fmt", "yuv420p",
  );

  if (hasAudio && audioPath) {
    args.push("-c:a", "aac", "-b:a", "192k", "-shortest");
  }
  args.push(outputPath);
  spawnSync("ffmpeg", args);
}

/** Build a 3-part zoom segment (zoom-in → hold → zoom-out) */
function buildZoomSegment(
  framePath: string,
  audioPath: string | null,
  hasAudio: boolean,
  zoomRect: [number, number, number, number],
  zoomDuration: number,
  holdDuration: number,
  segIdx: number,
  videoDir: string,
  res: { width: number; height: number },
): { paths: string[]; nextSegIdx: number } {
  const [zx, zy, zw, zh] = zoomRect;
  const outW = res.width;
  const outH = res.height;
  const cx = Math.round(zx + zw / 2);
  const cy = Math.round(zy + zh / 2);
  const maxZ = Math.min(outW / zw, outH / zh);
  const inFrames = Math.max(Math.round(30 * zoomDuration), 2);
  const holdFrames = Math.max(Math.round(30 * holdDuration), 2);
  const N = inFrames - 1;

  const ssForward = `(on/${N})*(on/${N})*(3-2*on/${N})`;
  const ssReverse = `(1-(on/${N})*(on/${N})*(3-2*on/${N}))`;
  const xExpr = `${cx}-iw/zoom/2`;
  const yExpr = `${cy}-ih/zoom/2`;

  const paths: string[] = [];

  // Part 1: Zoom-in
  const zoomInPath = path.join(videoDir, `zoomin_${String(segIdx).padStart(3, "0")}.mp4`);
  const zpIn = [
    `zoompan=z='1+(${maxZ.toFixed(4)}-1)*${ssForward}'`,
    `x='${xExpr}'`, `y='${yExpr}'`,
    `d=${inFrames}`, `s=${outW}x${outH}`, `fps=30`,
  ].join(":");
  spawnSync("ffmpeg", ["-y", "-i", framePath, "-vf", zpIn, "-c:v", "libx264", "-preset", "fast", "-crf", "18", "-pix_fmt", "yuv420p", zoomInPath]);
  paths.push(zoomInPath);
  segIdx++;

  // Part 2: Hold
  const holdPath = path.join(videoDir, `zoomhold_${String(segIdx).padStart(3, "0")}.mp4`);
  const zpHold = [`zoompan=z='${maxZ.toFixed(4)}'`, `x='${xExpr}'`, `y='${yExpr}'`, `d=${holdFrames}`, `s=${outW}x${outH}`, `fps=30`].join(":");
  const holdArgs = ["-y", "-i", framePath];
  if (hasAudio && audioPath) holdArgs.push("-i", audioPath);
  holdArgs.push("-vf", zpHold, "-c:v", "libx264", "-preset", "fast", "-crf", "18", "-pix_fmt", "yuv420p");
  if (hasAudio && audioPath) holdArgs.push("-c:a", "aac", "-b:a", "192k", "-shortest");
  holdArgs.push(holdPath);
  spawnSync("ffmpeg", holdArgs);
  paths.push(holdPath);
  segIdx++;

  // Part 3: Zoom-out
  const zoomOutPath = path.join(videoDir, `zoomout_${String(segIdx).padStart(3, "0")}.mp4`);
  const zpOut = [`zoompan=z='1+(${maxZ.toFixed(4)}-1)*${ssReverse}'`, `x='${xExpr}'`, `y='${yExpr}'`, `d=${inFrames}`, `s=${outW}x${outH}`, `fps=30`].join(":");
  spawnSync("ffmpeg", ["-y", "-i", framePath, "-vf", zpOut, "-c:v", "libx264", "-preset", "fast", "-crf", "18", "-pix_fmt", "yuv420p", zoomOutPath]);
  paths.push(zoomOutPath);
  segIdx++;

  return { paths, nextSegIdx: segIdx };
}

/** Build a spotlight segment: dim everything except highlighted region */
function buildSpotlightSegment(
  framePath: string,
  audioPath: string | null,
  hasAudio: boolean,
  spotlightRect: [number, number, number, number],
  dimOpacity: number,
  duration: number,
  outputPath: string,
): void {
  const [sx, sy, sw, sh] = spotlightRect;
  // Use drawbox to create the dim effect with 4 dark regions around the spotlight
  // Fill entire frame with dark overlay, then copy original pixels in spotlight region
  const alpha = dimOpacity.toFixed(2);
  const vf = [
    `split[main][copy]`,
    `[copy]drawbox=x=0:y=0:w=iw:h=ih:color=black@${alpha}:t=fill[dim]`,
    `[dim][main]overlay=0:0:format=auto,` +
    `drawbox=x=${sx}:y=${sy}:w=${sw}:h=${sh}:color=black@0:t=fill`,
  ].join(";");

  // Simpler approach: use a single complex filter with crop+overlay
  // Actually, the easiest ffmpeg approach: darken all, then overlay the original cropped region
  const complexFilter = [
    `[0:v]split[orig][dark]`,
    `[dark]drawbox=x=0:y=0:w=iw:h=ih:color=black@${alpha}:t=fill[dimmed]`,
    `[orig]crop=${sw}:${sh}:${sx}:${sy}[bright]`,
    `[dimmed][bright]overlay=${sx}:${sy}[out]`,
  ].join(";");

  const args = ["-y", "-loop", "1", "-framerate", "30", "-i", framePath];
  if (hasAudio && audioPath) args.push("-i", audioPath);
  args.push(
    "-filter_complex", complexFilter,
    "-map", "[out]",
  );
  if (hasAudio && audioPath) args.push("-map", "1:a");
  args.push(
    "-t", duration.toFixed(3),
    "-r", "30",
    "-c:v", "libx264", "-preset", "fast", "-crf", "18",
    "-pix_fmt", "yuv420p",
  );
  if (hasAudio && audioPath) args.push("-c:a", "aac", "-b:a", "192k", "-shortest");
  args.push(outputPath);
  spawnSync("ffmpeg", args);
}

/** Build a callout (text overlay) segment */
function buildCalloutSegment(
  framePath: string,
  calloutText: string,
  style: string,
  position: [number, number] | undefined,
  step: number | undefined,
  duration: number,
  outputPath: string,
  res: { width: number; height: number },
): void {
  let displayText = calloutText;
  if (style === "step-counter" && step) {
    displayText = `Step ${step}: ${calloutText}`;
  }

  // Escape special chars for drawtext
  displayText = displayText.replace(/'/g, "'\\''").replace(/:/g, "\\:");

  let drawtext: string;
  if (style === "lower-third") {
    // Bottom banner
    drawtext = `drawtext=text='${displayText}':fontsize=36:fontcolor=white:x=(w-text_w)/2:y=h-80:box=1:boxcolor=black@0.7:boxborderw=15`;
  } else if (style === "step-counter") {
    const x = position ? position[0] : 100;
    const y = position ? position[1] : 100;
    drawtext = `drawtext=text='${displayText}':fontsize=28:fontcolor=white:x=${x}:y=${y}:box=1:boxcolor=0x2563EB@0.9:boxborderw=12`;
  } else {
    // Default label
    const x = position ? position[0] : 100;
    const y = position ? position[1] : 100;
    drawtext = `drawtext=text='${displayText}':fontsize=28:fontcolor=white:x=${x}:y=${y}:box=1:boxcolor=black@0.8:boxborderw=10`;
  }

  const vf = `scale=${res.width}:${res.height}:force_original_aspect_ratio=decrease,pad=${res.width}:${res.height}:(ow-iw)/2:(oh-ih)/2,${drawtext}`;

  spawnSync("ffmpeg", [
    "-y", "-loop", "1", "-framerate", "30", "-i", framePath,
    "-t", duration.toFixed(3),
    "-r", "30",
    "-vf", vf,
    "-c:v", "libx264", "-preset", "fast", "-crf", "18",
    "-pix_fmt", "yuv420p",
    outputPath,
  ]);
}

/** Build a moving-video callout segment (text overlay on moving video) */
function buildMovingCalloutSegment(
  inputPath: string,
  startTime: number,
  endTime: number,
  calloutText: string,
  style: string,
  position: [number, number] | undefined,
  step: number | undefined,
  outputPath: string,
  res: { width: number; height: number },
): void {
  let displayText = calloutText;
  if (style === "step-counter" && step) {
    displayText = `Step ${step}: ${calloutText}`;
  }
  displayText = displayText.replace(/'/g, "'\\''").replace(/:/g, "\\:");

  let drawtext: string;
  if (style === "lower-third") {
    drawtext = `drawtext=text='${displayText}':fontsize=36:fontcolor=white:x=(w-text_w)/2:y=h-80:box=1:boxcolor=black@0.7:boxborderw=15`;
  } else if (style === "step-counter") {
    const x = position ? position[0] : 100;
    const y = position ? position[1] : 100;
    drawtext = `drawtext=text='${displayText}':fontsize=28:fontcolor=white:x=${x}:y=${y}:box=1:boxcolor=0x2563EB@0.9:boxborderw=12`;
  } else {
    const x = position ? position[0] : 100;
    const y = position ? position[1] : 100;
    drawtext = `drawtext=text='${displayText}':fontsize=28:fontcolor=white:x=${x}:y=${y}:box=1:boxcolor=black@0.8:boxborderw=10`;
  }

  spawnSync("ffmpeg", [
    "-y", "-i", inputPath,
    "-ss", startTime.toFixed(3), "-to", endTime.toFixed(3),
    "-vf", drawtext,
    "-c:v", "libx264", "-preset", "fast", "-crf", "18",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "192k",
    outputPath,
  ]);
}

/** Build a moving-video spotlight segment (dim overlay on moving video) */
function buildMovingSpotlightSegment(
  inputPath: string,
  startTime: number,
  endTime: number,
  spotlightRect: [number, number, number, number],
  dimOpacity: number,
  audioPath: string | null,
  hasAudio: boolean,
  outputPath: string,
): void {
  const [sx, sy, sw, sh] = spotlightRect;
  const alpha = dimOpacity.toFixed(2);

  const complexFilter = [
    `[0:v]split[orig][dark]`,
    `[dark]drawbox=x=0:y=0:w=iw:h=ih:color=black@${alpha}:t=fill[dimmed]`,
    `[orig]crop=${sw}:${sh}:${sx}:${sy}[bright]`,
    `[dimmed][bright]overlay=${sx}:${sy}[out]`,
  ].join(";");

  const args = [
    "-y", "-i", inputPath,
    "-ss", startTime.toFixed(3), "-to", endTime.toFixed(3),
  ];
  if (hasAudio && audioPath) args.push("-i", audioPath);
  args.push("-filter_complex", complexFilter, "-map", "[out]");
  if (hasAudio && audioPath) args.push("-map", "1:a");
  args.push(
    "-c:v", "libx264", "-preset", "fast", "-crf", "18",
    "-pix_fmt", "yuv420p",
  );
  if (hasAudio && audioPath) args.push("-c:a", "aac", "-b:a", "192k", "-shortest");
  args.push(outputPath);
  spawnSync("ffmpeg", args);
}


/** Generate ASS subtitle file with karaoke word highlighting */
function generateSubtitleFile(
  text: string,
  duration: number,
  outputPath: string,
  res: { width: number; height: number },
  fontSize: number = 28,
): void {
  // Split text into subtitle entries at sentence boundaries
  const sentences = text.match(/[^.!?\n]+[.!?\n]*/g) || [text];
  const entries: string[] = [];
  for (const sentence of sentences) {
    const trimmed = sentence.trim();
    if (!trimmed) continue;
    if (trimmed.length <= 60) {
      entries.push(trimmed);
    } else {
      const clauses = trimmed.split(/(?<=[,;])\s+/);
      let current = "";
      for (const clause of clauses) {
        if (current.length + clause.length > 60 && current.length > 0) {
          entries.push(current.trim());
          current = "";
        }
        current += (current ? " " : "") + clause;
      }
      if (current.trim()) entries.push(current.trim());
    }
  }

  const totalChars = entries.reduce((sum, e) => sum + e.length, 0);
  let currentTime = 0;
  const dialogues: string[] = [];

  for (const entry of entries) {
    const entryDuration = totalChars > 0 ? duration * (entry.length / totalChars) : duration / entries.length;
    const startTs = secToAssTs(currentTime);
    const endTs = secToAssTs(currentTime + entryDuration);

    const words = entry.trim().split(/\s+/);
    const wordChars = words.reduce((sum, w) => sum + w.length, 0);
    const karokeParts = words.map((w) => {
      const wordDur = wordChars > 0 ? entryDuration * (w.length / wordChars) : entryDuration / words.length;
      const cs = Math.max(1, Math.round(wordDur * 100));
      return `{\\kf${cs}}${w} `;
    }).join("").trim();

    dialogues.push(`Dialogue: 0,${startTs},${endTs},Default,,0000,0000,0000,karaoke,${karokeParts}`);
    currentTime += entryDuration;
  }

  const assContent = `[Script Info]
Title: Demo Subtitle
ScriptType: v4.00+
PlayResX: ${res.width}
PlayResY: ${res.height}

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Noto Sans,${fontSize},&H00FFFFFF,&H0000FFFF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,2,1,2,20,20,50,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${dialogues.join("\n")}
`;

  fs.writeFileSync(outputPath, assContent, "utf-8");
}

/** Convert seconds to ASS timestamp format (h:mm:ss.cc) */
function secToAssTs(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const cs = Math.round((sec - Math.floor(sec)) * 100);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

/** Burn subtitles into a video segment */
function burnSubtitles(
  videoPath: string,
  subtitlePath: string,
  outputPath: string,
): boolean {
  const result = spawnSync("ffmpeg", [
    "-y", "-i", videoPath,
    "-vf", `ass=${subtitlePath}`,
    "-c:v", "libx264", "-preset", "fast", "-crf", "18",
    "-pix_fmt", "yuv420p",
    "-c:a", "copy",
    outputPath,
  ]);
  return fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0;
}

/** Overlay audio onto a video clip */
function overlayAudio(
  videoPath: string,
  audioPath: string,
  outputPath: string,
): boolean {
  spawnSync("ffmpeg", [
    "-y", "-i", videoPath, "-i", audioPath,
    "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest",
    outputPath,
  ]);
  return fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0;
}

/** Cut a speed-ramped clip */
function cutSpeedClip(
  inputPath: string,
  startTime: number,
  endTime: number,
  speedFactor: number,
  outputPath: string,
): void {
  const pts = (1 / speedFactor).toFixed(4);
  // For speed > 1: atempo can only handle 0.5-2x per filter, chain if needed
  let atempoFilter = "";
  if (speedFactor > 1) {
    let remaining = speedFactor;
    const parts: string[] = [];
    while (remaining > 2) {
      parts.push("atempo=2.0");
      remaining /= 2;
    }
    if (remaining > 0.5) parts.push(`atempo=${remaining.toFixed(4)}`);
    atempoFilter = parts.length > 0 ? parts.join(",") : "";
  } else if (speedFactor < 1) {
    let remaining = speedFactor;
    const parts: string[] = [];
    while (remaining < 0.5) {
      parts.push("atempo=0.5");
      remaining /= 0.5;
    }
    parts.push(`atempo=${remaining.toFixed(4)}`);
    atempoFilter = parts.join(",");
  }

  const args = [
    "-y", "-i", inputPath,
    "-ss", startTime.toFixed(3),
    "-to", endTime.toFixed(3),
    "-vf", `setpts=${pts}*PTS`,
  ];

  // No audio for speed-ramped clips (simpler, avoids atempo issues)
  args.push(
    "-c:v", "libx264", "-preset", "fast", "-crf", "18",
    "-pix_fmt", "yuv420p", "-an",
    outputPath,
  );

  spawnSync("ffmpeg", args);
}

/** Mix background music into the final video */
function mixBackgroundMusic(
  videoPath: string,
  musicAction: Action,
  narrationTimestamps: Array<{ start: number; end: number }>,
  outputPath: string,
  emit: (msg: string) => void,
): void {
  const musicPath = musicAction.musicPath;
  if (!musicPath || !fs.existsSync(musicPath)) {
    emit("Music file not found, skipping music mix");
    fs.copyFileSync(videoPath, outputPath);
    return;
  }

  const volume = musicAction.musicVolume ?? 0.5;
  const duckTo = musicAction.musicDuckTo ?? 0.2;

  emit(`Mixing background music (vol=${volume}, duck=${duckTo})...`);

  // Build volume envelope for ducking
  // During narration segments: lower music volume
  let volumeFilter = `volume=${volume}`;
  if (narrationTimestamps.length > 0) {
    const enableParts: string[] = [];
    for (const seg of narrationTimestamps) {
      enableParts.push(
        `volume=enable='between(t,${seg.start.toFixed(1)},${seg.end.toFixed(1)})':volume=${duckTo / volume}`
      );
    }
    volumeFilter = `volume=${volume},${enableParts.join(",")}`;
  }

  // Mix: video audio + music
  spawnSync("ffmpeg", [
    "-y",
    "-i", videoPath,
    "-i", musicPath,
    "-filter_complex",
    `[1:a]${volumeFilter},aloop=-1:2e9[music];[0:a][music]amix=inputs=2:duration=shortest:dropout_transition=2[aout]`,
    "-map", "0:v",
    "-map", "[aout]",
    "-c:v", "copy",
    "-c:a", "aac", "-ar", "44100", "-ac", "2", "-b:a", "192k",
    outputPath,
  ]);
}

export async function produceTimelineVideo(
  sessionDir: string,
  win: BrowserWindow | null,
  version?: string,
): Promise<string> {
  const projectPath = path.join(sessionDir, "demo-project.json");
  const project = JSON.parse(fs.readFileSync(projectPath, "utf-8"));

  const recordingPath = project.recordingPath;
  const actions: Action[] = project.actions || [];
  const videoDir = path.join(sessionDir, "video");
  fs.mkdirSync(videoDir, { recursive: true });

  const emit = (msg: string) => win?.webContents.send("produce-progress", msg);

  const duration = probeDuration(recordingPath);
  const res = probeResolution(recordingPath);
  emit(`Recording: ${res.width}x${res.height}, ${duration.toFixed(1)}s`);
  const skipRanges = getSkipRanges(actions);
  const speedRanges = getSpeedRanges(actions);
  const musicAction = actions.find((a) => a.type === "music" && a.musicPath);

  // Filter out skip/speed/music actions from timeline groups (they're handled differently)
  const timelineActions = actions.filter(
    (a) => !["skip", "speed", "music"].includes(a.type),
  );
  const groups = groupActions(timelineActions);

  const segments: string[] = [];
  let segIdx = 0;
  let currentTime = 0;
  const narrationTimestamps: Array<{ start: number; end: number }> = [];
  let runningDuration = 0; // Track actual output duration for music ducking

  for (const group of groups) {
    const ts = group.ts;

    // Check if this action is inside a skip range
    if (isInSkipRange(ts, skipRanges)) {
      emit(`Skipping action at ${ts.toFixed(1)}s (inside cut range)`);
      continue;
    }

    // Video segment before action point (respecting skip/speed ranges)
    if (ts > currentTime + 0.1) {
      const splitPts = getSplitPoints(currentTime, ts, skipRanges, speedRanges);
      const edges = [currentTime, ...splitPts, ts];

      for (let i = 0; i < edges.length - 1; i++) {
        const segStart = edges[i];
        const segEnd = edges[i + 1];
        if (segEnd - segStart < 0.1) continue;
        if (isRangeSkipped(segStart, segEnd, skipRanges)) continue;

        const speedFactor = getSpeedForRange(segStart, segEnd, speedRanges);
        const clipPath = path.join(videoDir, `clip_${String(segIdx).padStart(3, "0")}.mp4`);

        if (speedFactor && speedFactor !== 1) {
          emit(`Speed ramp ${speedFactor}x: ${segStart.toFixed(1)}s - ${segEnd.toFixed(1)}s`);
          cutSpeedClip(recordingPath, segStart, segEnd, speedFactor, clipPath);
        } else {
          emit(`Cutting segment ${segStart.toFixed(1)}s - ${segEnd.toFixed(1)}s`);
          cutClip(recordingPath, segStart, segEnd, clipPath);
        }

        if (fs.existsSync(clipPath) && fs.statSync(clipPath).size > 0) {
          const clipDur = probeDuration(clipPath);
          runningDuration += clipDur;
          segments.push(clipPath);
          segIdx++;
        }
      }
    }

    // Detect action types in group
    const hasZoom = group.actions.some((a) => a.type === "zoom");
    const hasPause = group.actions.some((a) => a.type === "pause");
    const hasNarrate = group.actions.some((a) => a.type === "narrate");
    const hasSpotlight = group.actions.some((a) => a.type === "spotlight");
    const hasCallout = group.actions.some((a) => a.type === "callout");

    const narrateAction = group.actions.find((a) => a.type === "narrate");
    const zoomAction = group.actions.find((a) => a.type === "zoom");
    const spotlightAction = group.actions.find((a) => a.type === "spotlight");
    const calloutAction = group.actions.find((a) => a.type === "callout");
    const effectiveNarrateAction = narrateAction || (zoomAction?.narration ? zoomAction : null) || (spotlightAction?.narration ? spotlightAction : null);

    // Determine if any action in this group wants freeze mode
    // Zoom always freezes the video frame for a clean zoompan effect
    const wantFreeze = hasPause || hasZoom || group.actions.some((a) => a.freeze === true);

    if (hasPause || hasNarrate || hasZoom || hasSpotlight || hasCallout) {
      // Prepare narration audio
      const audioPath = path.join(videoDir, `narr_${String(segIdx).padStart(3, "0")}.wav`);
      const { hasAudio, audioDuration } = prepareNarrationAudio(
        effectiveNarrateAction, audioPath, project, emit, ts,
      );

      // Calculate effect duration
      let effectDuration = 3;
      if (hasAudio && audioDuration > 0) effectDuration = audioDuration + 0.5;
      if (hasCallout) effectDuration = Math.max(effectDuration, calloutAction?.calloutDuration ?? 3);
      if (hasSpotlight) effectDuration = Math.max(effectDuration, spotlightAction?.spotlightDuration ?? 3);
      if (hasZoom) effectDuration = Math.max(effectDuration, (zoomAction?.zoomDuration ?? 1) * 2 + (zoomAction?.zoomHold ?? 2));
      for (const a of group.actions) {
        if (typeof a.resumeAfter === "number") effectDuration = a.resumeAfter;
      }

      // Track narration timestamps for music ducking
      if (hasAudio) {
        narrationTimestamps.push({
          start: runningDuration,
          end: runningDuration + effectDuration,
        });
      }

      // Get narration text for subtitles
      const narrInfo = findNarration(effectiveNarrateAction);
      const showSubtitles = effectiveNarrateAction?.showSubtitles !== false;

      if (wantFreeze) {
        // ===== FREEZE MODE (pause type or freeze: true) =====
        const framePath = path.join(videoDir, `frame_${String(segIdx).padStart(3, "0")}.png`);
        extractFrame(recordingPath, ts, framePath);

        if (hasZoom && zoomAction?.zoomRect) {
          const zoomDur = zoomAction.zoomDuration ?? 1;
          const zoomHold = hasAudio ? effectDuration : (zoomAction.zoomHold ?? effectDuration);
          emit(`[freeze] Zoom at ${ts.toFixed(1)}s hold=${zoomHold.toFixed(1)}s`);
          const result = buildZoomSegment(
            framePath, hasAudio ? audioPath : null, hasAudio,
            zoomAction.zoomRect, zoomDur, zoomHold, segIdx, videoDir, res,
          );
          for (const p of result.paths) runningDuration += probeDuration(p);
          segments.push(...result.paths);
          segIdx = result.nextSegIdx;
        } else if (hasSpotlight && spotlightAction?.spotlightRect) {
          const spotDur = Math.max(spotlightAction.spotlightDuration ?? 3, effectDuration);
          emit(`[freeze] Spotlight at ${ts.toFixed(1)}s (${spotDur.toFixed(1)}s)`);
          const spotPath = path.join(videoDir, `spot_${String(segIdx).padStart(3, "0")}.mp4`);
          buildSpotlightSegment(
            framePath, hasAudio ? audioPath : null, hasAudio,
            spotlightAction.spotlightRect, spotlightAction.dimOpacity ?? 0.7, spotDur, spotPath,
          );
          runningDuration += spotDur;
          segments.push(spotPath);
          segIdx++;
        } else if (hasCallout && calloutAction?.calloutText) {
          const callDur = Math.max(calloutAction.calloutDuration ?? 3, effectDuration);
          emit(`[freeze] Callout at ${ts.toFixed(1)}s: "${calloutAction.calloutText.slice(0, 30)}..."`);
          const callPath = path.join(videoDir, `call_${String(segIdx).padStart(3, "0")}.mp4`);
          buildCalloutSegment(
            framePath, calloutAction.calloutText,
            calloutAction.calloutStyle || "label",
            calloutAction.calloutPosition as [number, number] | undefined,
            calloutAction.calloutStep,
            callDur, callPath, res,
          );
          runningDuration += callDur;
          segments.push(callPath);
          segIdx++;
        } else {
          emit(`[freeze] Freeze frame at ${ts.toFixed(1)}s (${effectDuration.toFixed(1)}s)`);
          const freezePath = path.join(videoDir, `freeze_${String(segIdx).padStart(3, "0")}.mp4`);
          buildFreezeSegment(framePath, hasAudio ? audioPath : null, hasAudio, effectDuration, freezePath, res);
          runningDuration += effectDuration;
          segments.push(freezePath);
          segIdx++;
        }

        // Burn subtitles on the last segment if needed
        if (showSubtitles && hasAudio && narrInfo?.text) {
          const lastSeg = segments[segments.length - 1];
          const subPath = path.join(videoDir, `sub_${String(segIdx).padStart(3, "0")}.ass`);
          generateSubtitleFile(narrInfo.text, audioDuration, subPath, res, effectiveNarrateAction?.subtitleSize ?? 28);
          const subOutPath = path.join(videoDir, `subseg_${String(segIdx).padStart(3, "0")}.mp4`);
          if (burnSubtitles(lastSeg, subPath, subOutPath)) {
            segments[segments.length - 1] = subOutPath;
          }
        }
      } else {
        // ===== MOVING VIDEO MODE (default) =====
        // Use max(ts, currentTime) to avoid re-including already-consumed video
        const effectStart = Math.max(ts, currentTime);
        const clipEnd = Math.min(effectStart + effectDuration, duration);

        if (hasSpotlight && spotlightAction?.spotlightRect) {
          const spotDur = Math.max(spotlightAction.spotlightDuration ?? 3, effectDuration);
          emit(`[moving] Spotlight at ${effectStart.toFixed(1)}s (${spotDur.toFixed(1)}s)`);
          const spotPath = path.join(videoDir, `spot_${String(segIdx).padStart(3, "0")}.mp4`);
          buildMovingSpotlightSegment(
            recordingPath, effectStart, Math.min(effectStart + spotDur, duration),
            spotlightAction.spotlightRect, spotlightAction.dimOpacity ?? 0.7,
            hasAudio ? audioPath : null, hasAudio, spotPath,
          );
          const segDur = probeDuration(spotPath);
          runningDuration += segDur > 0 ? segDur : spotDur;
          segments.push(spotPath);
          segIdx++;
        } else if (hasCallout && calloutAction?.calloutText) {
          const callDur = Math.max(calloutAction.calloutDuration ?? 3, effectDuration);
          emit(`[moving] Callout at ${effectStart.toFixed(1)}s: "${calloutAction.calloutText.slice(0, 30)}..."`);
          const callPath = path.join(videoDir, `call_${String(segIdx).padStart(3, "0")}.mp4`);
          buildMovingCalloutSegment(
            recordingPath, effectStart, Math.min(effectStart + callDur, duration),
            calloutAction.calloutText,
            calloutAction.calloutStyle || "label",
            calloutAction.calloutPosition as [number, number] | undefined,
            calloutAction.calloutStep,
            callPath, res,
          );
          // Overlay audio if needed
          if (hasAudio) {
            const withAudioPath = path.join(videoDir, `callaudio_${String(segIdx).padStart(3, "0")}.mp4`);
            if (overlayAudio(callPath, audioPath, withAudioPath)) {
              const segDur = probeDuration(withAudioPath);
              runningDuration += segDur;
              segments.push(withAudioPath);
            } else {
              runningDuration += probeDuration(callPath);
              segments.push(callPath);
            }
          } else {
            runningDuration += probeDuration(callPath);
            segments.push(callPath);
          }
          segIdx++;
        } else {
          // Narrate-only on moving video (default)
          emit(`[moving] Narration at ${effectStart.toFixed(1)}s (${effectDuration.toFixed(1)}s)`);
          const playPath = path.join(videoDir, `play_${String(segIdx).padStart(3, "0")}.mp4`);
          cutClip(recordingPath, effectStart, clipEnd, playPath);

          if (hasAudio) {
            const withAudioPath = path.join(videoDir, `playaudio_${String(segIdx).padStart(3, "0")}.mp4`);
            if (overlayAudio(playPath, audioPath, withAudioPath)) {
              segments.push(withAudioPath);
              runningDuration += probeDuration(withAudioPath);
            } else {
              segments.push(playPath);
              runningDuration += probeDuration(playPath);
            }
          } else {
            segments.push(playPath);
            runningDuration += probeDuration(playPath);
          }
          segIdx++;
        }

        // Burn subtitles on the last segment if needed (for non-zoom moving)
        if (showSubtitles && hasAudio && narrInfo?.text && !(hasZoom && zoomAction?.zoomRect)) {
          const lastSeg = segments[segments.length - 1];
          const subPath = path.join(videoDir, `sub_${String(segIdx).padStart(3, "0")}.ass`);
          generateSubtitleFile(narrInfo.text, audioDuration, subPath, res, effectiveNarrateAction?.subtitleSize ?? 28);
          const subOutPath = path.join(videoDir, `subseg_${String(segIdx).padStart(3, "0")}.mp4`);
          if (burnSubtitles(lastSeg, subPath, subOutPath)) {
            segments[segments.length - 1] = subOutPath;
          }
        }

        // Advance currentTime past the consumed video
        currentTime = Math.min(effectStart + effectDuration, duration);
        continue; // skip the default currentTime = ts below
      }
    }

    currentTime = ts;
  }

  // Final segment after last action (respecting skips/speed)
  if (currentTime < duration - 0.1) {
    const splitPts = getSplitPoints(currentTime, duration, skipRanges, speedRanges);
    const edges = [currentTime, ...splitPts, duration];

    for (let i = 0; i < edges.length - 1; i++) {
      const segStart = edges[i];
      const segEnd = edges[i + 1];
      if (segEnd - segStart < 0.1) continue;
      if (isRangeSkipped(segStart, segEnd, skipRanges)) continue;

      const speedFactor = getSpeedForRange(segStart, segEnd, speedRanges);
      const clipPath = path.join(videoDir, `clip_${String(segIdx).padStart(3, "0")}.mp4`);

      if (speedFactor && speedFactor !== 1) {
        emit(`Speed ramp ${speedFactor}x: ${segStart.toFixed(1)}s - ${segEnd.toFixed(1)}s`);
        cutSpeedClip(recordingPath, segStart, segEnd, speedFactor, clipPath);
      } else {
        emit(`Cutting final segment ${segStart.toFixed(1)}s - ${segEnd.toFixed(1)}s`);
        cutClip(recordingPath, segStart, segEnd, clipPath);
      }

      if (fs.existsSync(clipPath) && fs.statSync(clipPath).size > 0) {
        segments.push(clipPath);
        segIdx++;
      }
    }
  }

  if (segments.length === 0) {
    emit("No segments to concatenate!");
    throw new Error("No video segments produced");
  }

  // Normalize all segments to common audio format
  emit(`Normalizing ${segments.length} segments to common audio format...`);
  const normalizedSegments: string[] = [];
  for (let i = 0; i < segments.length; i++) {
    emit(`Normalizing segment ${i + 1}/${segments.length}...`);
    const seg = segments[i];
    const normPath = seg.replace(".mp4", "_norm.mp4");
    normalizedSegments.push(normalizeSegmentAudio(seg, normPath));
  }

  // Concat and version
  emit("Concatenating segments...");
  let versionLabel = version;
  if (!versionLabel) {
    const existing = fs.readdirSync(videoDir).filter((f) => f.match(/^final_v\d+\.mp4$/));
    const maxV = existing.reduce((max, f) => {
      const m = f.match(/^final_v(\d+)\.mp4$/);
      return m ? Math.max(max, parseInt(m[1])) : max;
    }, 0);
    versionLabel = `v${maxV + 1}`;
  }

  let finalPath = path.join(videoDir, `final_${versionLabel}.mp4`);
  const concatList = path.join(videoDir, "concat_list.txt");

  if (musicAction) {
    // Concat to temp file first, then mix music
    const tempPath = path.join(videoDir, `temp_${versionLabel}.mp4`);
    concatSegments(normalizedSegments, tempPath, concatList);
    mixBackgroundMusic(tempPath, musicAction, narrationTimestamps, finalPath, emit);
    // Clean up temp
    try { fs.unlinkSync(tempPath); } catch { /* ignore */ }
  } else {
    concatSegments(normalizedSegments, finalPath, concatList);
  }

  emit("Done!");
  return finalPath;
}
