import * as path from "path";
import * as fs from "fs";
import {
  ffmpegSync,
  probeDuration,
  probeResolution,
  extractFrame,
  cutClip,
  cutClipMuted,
  normalizeSegmentAudio,
  concatSegments,
  hasAudioStream,
} from "./ffmpeg";
import { generateTTS } from "./tts";
import {
  type Action,
  type NarrationResult,
  cutSpeedClip,
  mixBackgroundMusic,
} from "./effects";

// ─── Helpers ─────────────────────────────────────────────────

const LANG_CODES: Record<string, string> = {
  en: "a", "en-gb": "b", hi: "h", es: "e", fr: "f", ja: "j", zh: "z", pt: "p", it: "i",
};

function findNarration(action: Action): { text: string; lang: string; audioPath?: string } | null {
  if (action.customAudioPath && fs.existsSync(action.customAudioPath)) {
    return { text: "", lang: "custom", audioPath: action.customAudioPath };
  }
  if (action.audioPath) {
    for (const [lang, ap] of Object.entries(action.audioPath)) {
      if (ap && fs.existsSync(ap)) {
        const text = action.narrations?.[lang] || (lang === "en" ? action.narration : undefined) || (lang === "hi" ? action.narration_hi : undefined) || "";
        return { text, lang, audioPath: ap };
      }
    }
  }
  if (action.narrations) {
    for (const [lang, text] of Object.entries(action.narrations)) {
      if (text?.trim()) return { text, lang };
    }
  }
  if (action.narration?.trim()) return { text: action.narration, lang: "en" };
  if (action.narration_hi?.trim()) return { text: action.narration_hi, lang: "hi" };
  return null;
}

function prepareNarrationAudio(
  action: Action,
  audioOutputPath: string,
  project: Record<string, unknown>,
  emit: (msg: string) => void,
  ts: number,
): { hasAudio: boolean; audioDuration: number } {
  const narr = findNarration(action);
  if (!narr) return { hasAudio: false, audioDuration: 0 };

  if (narr.audioPath) {
    emit(`  Using pre-generated ${narr.lang} audio for action at ${ts.toFixed(1)}s`);
    fs.copyFileSync(narr.audioPath, audioOutputPath);
  } else {
    emit(`  Generating ${narr.lang} TTS for action at ${ts.toFixed(1)}s`);
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

function computeVersionLabel(videoDir: string): string {
  const existing = fs.readdirSync(videoDir).filter((f) => f.match(/^final_v\d+\.mp4$/));
  const maxV = existing.reduce((max, f) => {
    const m = f.match(/^final_v(\d+)\.mp4$/);
    return m ? Math.max(max, parseInt(m[1])) : max;
  }, 0);
  return `v${maxV + 1}`;
}

// ═════════════════════════════════════════════════════════════
// Overlay Passes (blur, spotlight, callout)
// These apply timed filters on the full video — no duration change
// ═════════════════════════════════════════════════════════════

function applyBlurPass(
  inputPath: string,
  blurActions: Action[],
  outputPath: string,
  res: { width: number; height: number },
  totalDuration: number,
  emit: (msg: string) => void,
): void {
  emit(`\n[Pass: Blur] Applying ${blurActions.length} blur effect(s)...`);

  let filterChain = "";
  let lastLabel = "0:v";
  let idx = 0;

  for (const action of blurActions) {
    const rects = action.blurRects ?? [];
    if (rects.length === 0) continue;

    const radius = action.blurRadius ?? 20;
    const start = action.timestamp;
    const end = start + (action.blurDuration ?? 3);
    const enableExpr = `between(t,${start.toFixed(3)},${Math.min(end, totalDuration).toFixed(3)})`;

    emit(`  Blur at ${start.toFixed(1)}s-${end.toFixed(1)}s (${rects.length} region${rects.length > 1 ? "s" : ""})`);

    for (const [bx, by, bw, bh] of rects) {
      const x = Math.max(0, Math.min(bx, res.width - 1));
      const y = Math.max(0, Math.min(by, res.height - 1));
      const w = Math.min(bw, res.width - x);
      const h = Math.min(bh, res.height - y);
      if (w <= 0 || h <= 0) continue;

      const sep = filterChain ? ";" : "";
      filterChain += `${sep}[${lastLabel}]split[base${idx}][src${idx}]`;
      filterChain += `;[src${idx}]crop=${w}:${h}:${x}:${y},boxblur=${radius}:${radius}[blur${idx}]`;
      filterChain += `;[base${idx}][blur${idx}]overlay=${x}:${y}:enable='${enableExpr}'[out${idx}]`;
      lastLabel = `out${idx}`;
      idx++;
    }
  }

  if (!filterChain) {
    fs.copyFileSync(inputPath, outputPath);
    return;
  }

  const args = ["-y", "-i", inputPath, "-filter_complex", filterChain];
  args.push("-map", `[${lastLabel}]`);
  if (hasAudioStream(inputPath)) {
    args.push("-map", "0:a", "-c:a", "copy");
  }
  args.push("-c:v", "libx264", "-preset", "fast", "-crf", "18", "-pix_fmt", "yuv420p");
  args.push(outputPath);
  ffmpegSync(args);
}

function applySpotlightPass(
  inputPath: string,
  spotActions: Action[],
  outputPath: string,
  res: { width: number; height: number },
  totalDuration: number,
  emit: (msg: string) => void,
): void {
  emit(`\n[Pass: Spotlight] Applying ${spotActions.length} spotlight effect(s)...`);

  let filterChain = "";
  let lastLabel = "0:v";
  let idx = 0;

  for (const action of spotActions) {
    const rects = action.spotlightRects ?? (action.spotlightRect ? [action.spotlightRect] : []);
    if (rects.length === 0) continue;

    const alpha = (action.dimOpacity ?? 0.7).toFixed(2);
    const start = action.timestamp;
    const end = start + (action.spotlightDuration ?? 3);
    const enableExpr = `between(t,${start.toFixed(3)},${Math.min(end, totalDuration).toFixed(3)})`;

    emit(`  Spotlight at ${start.toFixed(1)}s-${end.toFixed(1)}s (${rects.length} region${rects.length > 1 ? "s" : ""})`);

    const sep = filterChain ? ";" : "";
    const splitCount = 2 + rects.length;
    const splitLabels = [`pass${idx}`, `dark${idx}`, ...rects.map((_, ri) => `crop${idx}_${ri}`)];
    filterChain += `${sep}[${lastLabel}]split=${splitCount}${splitLabels.map((l) => `[${l}]`).join("")}`;

    filterChain += `;[dark${idx}]drawbox=x=0:y=0:w=iw:h=ih:color=black@${alpha}:t=fill[dimmed${idx}]`;

    let compositeLabel = `dimmed${idx}`;
    for (let ri = 0; ri < rects.length; ri++) {
      const [sx, sy, sw, sh] = rects[ri];
      filterChain += `;[crop${idx}_${ri}]crop=${sw}:${sh}:${sx}:${sy}[bright${idx}_${ri}]`;
      const outLabel = ri < rects.length - 1 ? `comp${idx}_${ri}` : `spotlight${idx}`;
      filterChain += `;[${compositeLabel}][bright${idx}_${ri}]overlay=${sx}:${sy}[${outLabel}]`;
      compositeLabel = outLabel;
    }

    filterChain += `;[pass${idx}][spotlight${idx}]overlay=0:0:enable='${enableExpr}'[out${idx}]`;
    lastLabel = `out${idx}`;
    idx++;
  }

  if (!filterChain) {
    fs.copyFileSync(inputPath, outputPath);
    return;
  }

  const args = ["-y", "-i", inputPath, "-filter_complex", filterChain];
  args.push("-map", `[${lastLabel}]`);
  if (hasAudioStream(inputPath)) {
    args.push("-map", "0:a", "-c:a", "copy");
  }
  args.push("-c:v", "libx264", "-preset", "fast", "-crf", "18", "-pix_fmt", "yuv420p");
  args.push(outputPath);
  ffmpegSync(args);
}

function escapeDrawtext(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\u2019")
    .replace(/:/g, "\\:")
    .replace(/;/g, "\\;");
}

function applyCalloutPass(
  inputPath: string,
  calloutActions: Action[],
  outputPath: string,
  totalDuration: number,
  emit: (msg: string) => void,
): void {
  emit(`\n[Pass: Callout] Applying ${calloutActions.length} callout(s)...`);

  const filters: string[] = [];

  for (const action of calloutActions) {
    const start = action.timestamp;
    const end = start + (action.calloutDuration ?? 3);
    const enableExpr = `between(t,${start.toFixed(3)},${Math.min(end, totalDuration).toFixed(3)})`;
    const style = action.calloutStyle || "label";
    const step = action.calloutStep;

    const panels = action.calloutPanels;
    if (panels && panels.length > 0) {
      emit(`  Callout at ${start.toFixed(1)}s-${end.toFixed(1)}s (${panels.length} panel${panels.length > 1 ? "s" : ""})`);
      for (const panel of panels) {
        if (!panel.text) continue;
        let displayText = panel.text;
        if (style === "step-counter" && step) {
          displayText = `Step ${step}: ${displayText}`;
        }
        displayText = escapeDrawtext(displayText);
        const fontSize = panel.fontSize || 24;
        const x = panel.rect[0];
        const y = panel.rect[1];
        filters.push(
          `drawtext=text='${displayText}':fontsize=${fontSize}:fontcolor=white:x=${x}:y=${y}:box=1:boxcolor=black@0.7:boxborderw=10:enable='${enableExpr}'`,
        );
      }
      continue;
    }

    const text = action.calloutText;
    if (!text) continue;

    emit(`  Callout at ${start.toFixed(1)}s-${end.toFixed(1)}s: "${text.slice(0, 30)}..."`);

    let displayText = text;
    if (style === "step-counter" && step) {
      displayText = `Step ${step}: ${text}`;
    }
    displayText = escapeDrawtext(displayText);

    const position = action.calloutPosition as [number, number] | undefined;
    if (style === "lower-third") {
      filters.push(
        `drawtext=text='${displayText}':fontsize=36:fontcolor=white:x=(w-text_w)/2:y=h-80:box=1:boxcolor=black@0.7:boxborderw=15:enable='${enableExpr}'`,
      );
    } else if (style === "step-counter") {
      const x = position ? position[0] : 100;
      const y = position ? position[1] : 100;
      filters.push(
        `drawtext=text='${displayText}':fontsize=28:fontcolor=white:x=${x}:y=${y}:box=1:boxcolor=0x2563EB@0.9:boxborderw=12:enable='${enableExpr}'`,
      );
    } else {
      const x = position ? position[0] : 100;
      const y = position ? position[1] : 100;
      filters.push(
        `drawtext=text='${displayText}':fontsize=28:fontcolor=white:x=${x}:y=${y}:box=1:boxcolor=black@0.8:boxborderw=10:enable='${enableExpr}'`,
      );
    }
  }

  if (filters.length === 0) {
    fs.copyFileSync(inputPath, outputPath);
    return;
  }

  let chain = "";
  let lastLabel = "0:v";
  for (let i = 0; i < filters.length; i++) {
    const outLabel = i < filters.length - 1 ? `dt${i}` : "vout";
    const sep = chain ? ";" : "";
    chain += `${sep}[${lastLabel}]${filters[i]}[${outLabel}]`;
    lastLabel = outLabel;
  }

  const args = ["-y", "-i", inputPath, "-filter_complex", chain];
  args.push("-map", "[vout]");
  if (hasAudioStream(inputPath)) {
    args.push("-map", "0:a", "-c:a", "copy");
  }
  args.push("-c:v", "libx264", "-preset", "fast", "-crf", "18", "-pix_fmt", "yuv420p");
  args.push(outputPath);
  ffmpegSync(args);
}

// ═════════════════════════════════════════════════════════════
// Pass: Skip/Cut — removes sections from the video
// ═════════════════════════════════════════════════════════════

function getSkipRanges(actions: Action[]): Array<{ start: number; end: number }> {
  return actions
    .filter((a) => a.type === "skip" && a.skipEndTimestamp)
    .map((a) => ({ start: a.timestamp, end: a.skipEndTimestamp! }))
    .sort((a, b) => a.start - b.start);
}

function applySkipPass(
  inputPath: string,
  skipRanges: Array<{ start: number; end: number }>,
  outputPath: string,
  tempDir: string,
  emit: (msg: string) => void,
): void {
  const totalDuration = probeDuration(inputPath);
  emit(`\n[Pass: Skip] Removing ${skipRanges.length} section(s)...`);

  const segments: string[] = [];
  let cursor = 0;
  let segIdx = 0;

  for (const range of skipRanges) {
    if (cursor < range.start - 0.05) {
      emit(`  Keep ${cursor.toFixed(1)}s-${range.start.toFixed(1)}s`);
      const clipPath = path.join(tempDir, `keep_${String(segIdx).padStart(3, "0")}.mp4`);
      cutClip(inputPath, cursor, range.start, clipPath);
      if (fs.existsSync(clipPath) && fs.statSync(clipPath).size > 0) {
        segments.push(clipPath);
        segIdx++;
      }
    }
    emit(`  Skip ${range.start.toFixed(1)}s-${range.end.toFixed(1)}s`);
    cursor = range.end;
  }

  if (cursor < totalDuration - 0.05) {
    const clipPath = path.join(tempDir, `keep_${String(segIdx).padStart(3, "0")}.mp4`);
    cutClip(inputPath, cursor, totalDuration, clipPath);
    if (fs.existsSync(clipPath) && fs.statSync(clipPath).size > 0) {
      segments.push(clipPath);
    }
  }

  if (segments.length === 0) {
    fs.copyFileSync(inputPath, outputPath);
    return;
  }

  emit(`  Normalizing ${segments.length} segments...`);
  const normalized = segments.map((seg) => normalizeSegmentAudio(seg, seg.replace(".mp4", "_norm.mp4")));
  const concatList = path.join(tempDir, "skip_concat.txt");
  concatSegments(normalized, outputPath, concatList);
}

// ═════════════════════════════════════════════════════════════
// Pass: Speed — applies speed ramps to sections
// ═════════════════════════════════════════════════════════════

function getSpeedRanges(actions: Action[]): Array<{ start: number; end: number; factor: number }> {
  return actions
    .filter((a) => a.type === "speed" && a.speedEndTimestamp && a.speedFactor)
    .map((a) => ({ start: a.timestamp, end: a.speedEndTimestamp!, factor: a.speedFactor! }))
    .sort((a, b) => a.start - b.start);
}

function applySpeedPass(
  inputPath: string,
  speedRanges: Array<{ start: number; end: number; factor: number }>,
  outputPath: string,
  tempDir: string,
  emit: (msg: string) => void,
): void {
  const totalDuration = probeDuration(inputPath);
  emit(`\n[Pass: Speed] Applying ${speedRanges.length} speed ramp(s)...`);

  const segments: string[] = [];
  let cursor = 0;
  let segIdx = 0;

  for (const range of speedRanges) {
    if (cursor < range.start - 0.05) {
      const clipPath = path.join(tempDir, `spd_${String(segIdx).padStart(3, "0")}.mp4`);
      cutClip(inputPath, cursor, range.start, clipPath);
      if (fs.existsSync(clipPath) && fs.statSync(clipPath).size > 0) {
        segments.push(clipPath);
        segIdx++;
      }
    }

    emit(`  Speed ${range.factor}x: ${range.start.toFixed(1)}s-${range.end.toFixed(1)}s`);
    const clipPath = path.join(tempDir, `spd_${String(segIdx).padStart(3, "0")}.mp4`);
    cutSpeedClip(inputPath, range.start, range.end, range.factor, clipPath);
    if (fs.existsSync(clipPath) && fs.statSync(clipPath).size > 0) {
      segments.push(clipPath);
      segIdx++;
    }

    cursor = range.end;
  }

  if (cursor < totalDuration - 0.05) {
    const clipPath = path.join(tempDir, `spd_${String(segIdx).padStart(3, "0")}.mp4`);
    cutClip(inputPath, cursor, totalDuration, clipPath);
    if (fs.existsSync(clipPath) && fs.statSync(clipPath).size > 0) {
      segments.push(clipPath);
    }
  }

  if (segments.length === 0) {
    fs.copyFileSync(inputPath, outputPath);
    return;
  }

  emit(`  Normalizing ${segments.length} segments...`);
  const normalized = segments.map((seg) => normalizeSegmentAudio(seg, seg.replace(".mp4", "_norm.mp4")));
  const concatList = path.join(tempDir, "speed_concat.txt");
  concatSegments(normalized, outputPath, concatList);
}

// ═════════════════════════════════════════════════════════════
// Timestamp Remapping
// Maps original timestamps → post-skip/speed coordinates
// ═════════════════════════════════════════════════════════════

function buildSkipRemap(
  skipRanges: Array<{ start: number; end: number }>,
): (ts: number) => number {
  return (ts: number): number => {
    let offset = 0;
    for (const range of skipRanges) {
      if (range.end <= ts) {
        offset += range.end - range.start;
      } else if (range.start < ts) {
        // Inside a skip range — clamp to the start of the skip
        return range.start - offset;
      }
    }
    return ts - offset;
  };
}

function buildSpeedRemap(
  speedRanges: Array<{ start: number; end: number; factor: number }>,
): (ts: number) => number {
  return (ts: number): number => {
    let outputTime = 0;
    let cursor = 0;

    for (const range of speedRanges) {
      if (ts <= range.start) {
        return outputTime + (ts - cursor);
      }
      outputTime += range.start - cursor;
      cursor = range.start;

      if (ts <= range.end) {
        return outputTime + (ts - range.start) / range.factor;
      }
      outputTime += (range.end - range.start) / range.factor;
      cursor = range.end;
    }

    return outputTime + (ts - cursor);
  };
}

function remapRanges<T extends { start: number; end: number }>(
  ranges: T[],
  remap: (ts: number) => number,
): T[] {
  return ranges
    .map((r) => ({ ...r, start: remap(r.start), end: remap(r.end) }))
    .filter((r) => r.end > r.start + 0.05);
}

// ═════════════════════════════════════════════════════════════
// Pass: Mute (audio filter)
// ═════════════════════════════════════════════════════════════

function applyMutePass(
  inputPath: string,
  muteRanges: Array<{ start: number; end: number }>,
  outputPath: string,
  emit: (msg: string) => void,
): void {
  emit(`\n[Pass: Mute] Applying ${muteRanges.length} mute range(s)...`);

  const filters: string[] = [];
  for (const range of muteRanges) {
    emit(`  Mute ${range.start.toFixed(1)}s-${range.end.toFixed(1)}s`);
    filters.push(`volume=enable='between(t,${range.start.toFixed(3)},${range.end.toFixed(3)})':volume=0`);
  }

  if (filters.length === 0 || !hasAudioStream(inputPath)) {
    fs.copyFileSync(inputPath, outputPath);
    return;
  }

  ffmpegSync([
    "-y", "-i", inputPath,
    "-af", filters.join(","),
    "-c:v", "copy",
    "-c:a", "aac", "-ar", "44100", "-ac", "2", "-b:a", "192k",
    outputPath,
  ]);
}

// ═════════════════════════════════════════════════════════════
// Subtitle Utilities
// ═════════════════════════════════════════════════════════════

function secToAssTs(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const cs = Math.round((sec - Math.floor(sec)) * 100);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

function generateSubtitleFile(
  text: string, duration: number, outputPath: string,
  res: { width: number; height: number }, fontSize: number = 28,
): void {
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

function burnSubtitles(videoPath: string, subtitlePath: string, outputPath: string): boolean {
  ffmpegSync([
    "-y", "-i", videoPath,
    "-vf", `ass=${subtitlePath}`,
    "-c:v", "libx264", "-preset", "fast", "-crf", "18", "-pix_fmt", "yuv420p",
    "-c:a", "copy",
    outputPath,
  ]);
  return fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0;
}

// ═════════════════════════════════════════════════════════════
// Insert Effect Builders (zoom, pause, narrate)
// ═════════════════════════════════════════════════════════════

function buildSingleZoom(
  zoomRect: [number, number, number, number],
  framePath: string,
  tempDir: string,
  segIdx: number,
  zoomIdx: number,
  res: { width: number; height: number },
  zoomDuration: number,
  holdDuration: number,
  narration: NarrationResult | undefined,
  emit: (msg: string) => void,
): string[] {
  const [zx, zy, zw, zh] = zoomRect;
  const { width: outW, height: outH } = res;
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

  const tag = `${String(segIdx).padStart(3, "0")}_z${zoomIdx}`;
  const paths: string[] = [];

  // Zoom-in
  const zoomInPath = path.join(tempDir, `zoomin_${tag}.mp4`);
  const zpIn = [
    `zoompan=z='1+(${maxZ.toFixed(4)}-1)*${ssForward}'`,
    `x='${xExpr}'`, `y='${yExpr}'`,
    `d=${inFrames}`, `s=${outW}x${outH}`, `fps=30`,
  ].join(":");
  ffmpegSync(["-y", "-i", framePath, "-vf", zpIn, "-c:v", "libx264", "-preset", "fast", "-crf", "18", "-pix_fmt", "yuv420p", zoomInPath]);
  paths.push(zoomInPath);

  // Hold (with narration audio if provided)
  const holdPath = path.join(tempDir, `zoomhold_${tag}.mp4`);
  const zpHold = [`zoompan=z='${maxZ.toFixed(4)}'`, `x='${xExpr}'`, `y='${yExpr}'`, `d=${holdFrames}`, `s=${outW}x${outH}`, `fps=30`].join(":");
  const holdArgs = ["-y", "-i", framePath];
  if (narration) holdArgs.push("-i", narration.audioPath);
  holdArgs.push("-vf", zpHold, "-c:v", "libx264", "-preset", "fast", "-crf", "18", "-pix_fmt", "yuv420p");
  if (narration) holdArgs.push("-c:a", "aac", "-b:a", "192k", "-shortest");
  holdArgs.push(holdPath);
  ffmpegSync(holdArgs);
  paths.push(holdPath);

  // Zoom-out
  const zoomOutPath = path.join(tempDir, `zoomout_${tag}.mp4`);
  const zpOut = [`zoompan=z='1+(${maxZ.toFixed(4)}-1)*${ssReverse}'`, `x='${xExpr}'`, `y='${yExpr}'`, `d=${inFrames}`, `s=${outW}x${outH}`, `fps=30`].join(":");
  ffmpegSync(["-y", "-i", framePath, "-vf", zpOut, "-c:v", "libx264", "-preset", "fast", "-crf", "18", "-pix_fmt", "yuv420p", zoomOutPath]);
  paths.push(zoomOutPath);

  return paths;
}

function findZoomTargetNarration(
  target: { narrations?: Record<string, string>; audioPath?: Record<string, string>; customAudioPath?: string },
): { text: string; lang: string; audioPath?: string } | null {
  if (target.customAudioPath && fs.existsSync(target.customAudioPath)) {
    return { text: "", lang: "custom", audioPath: target.customAudioPath };
  }
  if (target.audioPath) {
    for (const [lang, ap] of Object.entries(target.audioPath)) {
      if (ap && fs.existsSync(ap)) {
        const text = target.narrations?.[lang] || "";
        return { text, lang, audioPath: ap };
      }
    }
  }
  if (target.narrations) {
    for (const [lang, text] of Object.entries(target.narrations)) {
      if (text?.trim()) return { text, lang };
    }
  }
  return null;
}

function prepareZoomTargetAudio(
  target: { narrations?: Record<string, string>; audioPath?: Record<string, string>; customAudioPath?: string },
  audioOutputPath: string,
  project: Record<string, unknown>,
  emit: (msg: string) => void,
  label: string,
): NarrationResult | undefined {
  const narr = findZoomTargetNarration(target);
  if (!narr) return undefined;

  if (narr.audioPath) {
    emit(`    Using pre-generated ${narr.lang} audio for ${label}`);
    fs.copyFileSync(narr.audioPath, audioOutputPath);
  } else {
    emit(`    Generating ${narr.lang} TTS for ${label}`);
    const tts = project.tts as { voiceEn?: string; voiceHi?: string; speed?: number; kokoroEndpoint?: string; voices?: Record<string, string[]> } | undefined;
    const voice = tts?.voices?.[narr.lang]?.[0] || (narr.lang === "hi" ? tts?.voiceHi || "hf_alpha" : tts?.voiceEn || "af_heart");
    const speed = tts?.speed || 1;
    const langCode = LANG_CODES[narr.lang] || "a";
    generateTTS(narr.text, voice, speed, langCode, audioOutputPath, tts?.kokoroEndpoint);
  }

  if (fs.existsSync(audioOutputPath) && fs.statSync(audioOutputPath).size > 100) {
    const dur = probeDuration(audioOutputPath);
    if (dur > 0) return { audioPath: audioOutputPath, audioDuration: dur, text: narr.text, lang: narr.lang };
  }
  return undefined;
}

function buildZoomInsert(
  action: Action,
  videoPath: string,
  tempDir: string,
  segIdx: number,
  res: { width: number; height: number },
  narration: NarrationResult | undefined,
  project: Record<string, unknown>,
  emit: (msg: string) => void,
  frameTs: number,
): string[] {
  type ZoomTarget = { rect: [number, number, number, number]; narrations?: Record<string, string>; audioPath?: Record<string, string>; customAudioPath?: string };
  let targets: ZoomTarget[];
  if (action.zoomTargets?.length) {
    targets = action.zoomTargets as ZoomTarget[];
  } else if (action.zoomRects?.length) {
    targets = action.zoomRects.map((r) => ({ rect: r as [number, number, number, number] }));
  } else if (action.zoomRect) {
    targets = [{ rect: action.zoomRect }];
  } else {
    return [];
  }

  const zoomDuration = action.zoomDuration ?? 1;
  const holdDuration = action.zoomHold ?? 2;

  const framePath = path.join(tempDir, `frame_${String(segIdx).padStart(3, "0")}.png`);
  extractFrame(videoPath, frameTs, framePath);

  emit(`  Zoom at ${frameTs.toFixed(1)}s (${targets.length} target${targets.length > 1 ? "s" : ""})`);

  const allPaths: string[] = [];

  for (let i = 0; i < targets.length; i++) {
    const target = targets[i];

    let narrForThis: NarrationResult | undefined;
    const hasTargetNarration = findZoomTargetNarration(target) !== null;

    if (hasTargetNarration) {
      const audioPath = path.join(tempDir, `zoomnarr_${String(segIdx).padStart(3, "0")}_z${i}.wav`);
      narrForThis = prepareZoomTargetAudio(target, audioPath, project, emit, `zoom target ${i + 1}`);
    } else if (i === 0 && narration) {
      narrForThis = narration;
    }

    const thisHold = narrForThis ? narrForThis.audioDuration + 0.5 : holdDuration;

    emit(`    Target ${i + 1}: ${target.rect[2]}x${target.rect[3]} hold=${thisHold.toFixed(1)}s${narrForThis ? " (with narration)" : ""}`);

    const paths = buildSingleZoom(
      target.rect, framePath, tempDir, segIdx, i, res,
      zoomDuration, thisHold, narrForThis, emit,
    );
    allPaths.push(...paths);
  }

  return allPaths;
}

function buildPauseInsert(
  action: Action,
  videoPath: string,
  tempDir: string,
  segIdx: number,
  res: { width: number; height: number },
  narration: NarrationResult | undefined,
  emit: (msg: string) => void,
  frameTs: number,
): string[] {
  const framePath = path.join(tempDir, `frame_${String(segIdx).padStart(3, "0")}.png`);
  extractFrame(videoPath, frameTs, framePath);

  let duration = 3;
  if (narration && narration.audioDuration > 0) duration = narration.audioDuration + 0.5;
  if (typeof action.resumeAfter === "number") duration = action.resumeAfter;

  emit(`  Pause at ${frameTs.toFixed(1)}s (${duration.toFixed(1)}s)`);

  const { width, height } = res;
  const vf = `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`;
  const freezePath = path.join(tempDir, `freeze_${String(segIdx).padStart(3, "0")}.mp4`);

  const args = ["-y", "-loop", "1", "-framerate", "30", "-i", framePath];
  if (narration) args.push("-i", narration.audioPath);
  args.push("-t", duration.toFixed(3), "-r", "30", "-vf", vf);
  args.push("-c:v", "libx264", "-preset", "fast", "-crf", "18", "-pix_fmt", "yuv420p");
  if (narration) args.push("-c:a", "aac", "-b:a", "192k", "-shortest");
  args.push(freezePath);
  ffmpegSync(args);

  return [freezePath];
}

function buildNarrateInsert(
  action: Action,
  videoPath: string,
  tempDir: string,
  segIdx: number,
  res: { width: number; height: number },
  totalDuration: number,
  narration: NarrationResult | undefined,
  emit: (msg: string) => void,
  frameTs: number,
): string[] {
  // If freeze requested, build a freeze frame
  if (action.freeze === true || action.type === "pause") {
    return buildPauseInsert(action, videoPath, tempDir, segIdx, res, narration, emit, frameTs);
  }

  // Otherwise, play video with narration overlay
  let duration = narration ? narration.audioDuration + 0.5 : 3;
  if (typeof action.resumeAfter === "number") duration = action.resumeAfter;
  const clipEnd = Math.min(frameTs + duration, totalDuration);

  emit(`  Narrate at ${frameTs.toFixed(1)}s (${duration.toFixed(1)}s)`);

  const playPath = path.join(tempDir, `play_${String(segIdx).padStart(3, "0")}.mp4`);
  cutClip(videoPath, frameTs, clipEnd, playPath);

  if (narration) {
    const withAudioPath = path.join(tempDir, `playaudio_${String(segIdx).padStart(3, "0")}.mp4`);
    const clipHasAudio = hasAudioStream(playPath);

    if (clipHasAudio) {
      emit(`    Mixing narration with original audio (ducking original to 20%)`);
      ffmpegSync([
        "-y", "-i", playPath, "-i", narration.audioPath,
        "-filter_complex", "[0:a]volume=0.2[bg];[1:a]volume=1.0[narr];[bg][narr]amix=inputs=2:duration=shortest:dropout_transition=0[aout]",
        "-map", "0:v", "-map", "[aout]",
        "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest",
        withAudioPath,
      ]);
    } else {
      ffmpegSync([
        "-y", "-i", playPath, "-i", narration.audioPath,
        "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest",
        withAudioPath,
      ]);
    }

    if (fs.existsSync(withAudioPath) && fs.statSync(withAudioPath).size > 0) {
      return [withAudioPath];
    }
  }

  return [playPath];
}

// ═════════════════════════════════════════════════════════════
// Pass: Insert Effects (zoom, pause, narrate)
// Walks forward through the video, cutting clips and inserting effects
// ═════════════════════════════════════════════════════════════

function executeInsertPass(
  inputPath: string,
  insertActions: Action[],
  narrations: Map<Action, NarrationResult>,
  outputPath: string,
  tempDir: string,
  res: { width: number; height: number },
  project: Record<string, unknown>,
  emit: (msg: string) => void,
  remapTs: (ts: number) => number,
): { narrationTimestamps: Array<{ start: number; end: number }> } {
  const totalDuration = probeDuration(inputPath);

  // Sort inserts by their remapped timestamp
  const sorted = insertActions
    .map((a) => ({ action: a, mappedTs: remapTs(a.timestamp) }))
    .filter((a) => a.mappedTs >= 0 && a.mappedTs < totalDuration)
    .sort((a, b) => a.mappedTs - b.mappedTs);

  emit(`\n[Pass: Inserts] Processing ${sorted.length} insert(s)...`);

  const segments: string[] = [];
  const narrationTimestamps: Array<{ start: number; end: number }> = [];
  let cursor = 0;
  let segIdx = 0;
  let runningDuration = 0;

  for (const { action, mappedTs } of sorted) {
    // Clip before this insert
    if (mappedTs > cursor + 0.05) {
      const clipPath = path.join(tempDir, `ins_clip_${String(segIdx).padStart(3, "0")}.mp4`);
      cutClip(inputPath, cursor, mappedTs, clipPath);
      if (fs.existsSync(clipPath) && fs.statSync(clipPath).size > 0) {
        runningDuration += probeDuration(clipPath);
        segments.push(clipPath);
        segIdx++;
      }
    }

    // Build the insert effect
    const narration = narrations.get(action);
    let insertPaths: string[];

    if (action.type === "zoom" && (action.zoomRect || action.zoomRects?.length || action.zoomTargets?.length)) {
      insertPaths = buildZoomInsert(action, inputPath, tempDir, segIdx, res, narration, project, emit, mappedTs);
    } else if (action.type === "pause" || action.freeze === true) {
      insertPaths = buildPauseInsert(action, inputPath, tempDir, segIdx, res, narration, emit, mappedTs);
    } else {
      insertPaths = buildNarrateInsert(action, inputPath, tempDir, segIdx, res, totalDuration, narration, emit, mappedTs);
    }

    // Apply subtitles if narration has text
    if (narration?.text && action.showSubtitles !== false && insertPaths.length > 0) {
      const lastPath = insertPaths[insertPaths.length - 1];
      const subPath = path.join(tempDir, `sub_${String(segIdx).padStart(3, "0")}.ass`);
      const subOutPath = path.join(tempDir, `subseg_${String(segIdx).padStart(3, "0")}.mp4`);
      generateSubtitleFile(narration.text, narration.audioDuration, subPath, res, action.subtitleSize ?? 28);
      if (burnSubtitles(lastPath, subPath, subOutPath)) {
        insertPaths[insertPaths.length - 1] = subOutPath;
      }
    }

    // Track narration timestamps for music ducking
    if (narration) {
      const totalEffectDur = insertPaths.reduce((s, p) => s + probeDuration(p), 0);
      narrationTimestamps.push({ start: runningDuration, end: runningDuration + totalEffectDur });
    }

    for (const p of insertPaths) {
      runningDuration += probeDuration(p);
      segments.push(p);
      segIdx++;
    }

    // Advance cursor — freeze inserts resume from same point, narrate-without-freeze advances
    if (action.type === "zoom" || action.type === "pause" || action.freeze === true) {
      cursor = mappedTs;
    } else {
      // Narrate without freeze — video played during narration, so skip past that section
      const narrDur = narration ? narration.audioDuration + 0.5 : 3;
      const dur = typeof action.resumeAfter === "number" ? action.resumeAfter : narrDur;
      cursor = Math.min(mappedTs + dur, totalDuration);
    }
  }

  // Trailing clip after last insert
  if (cursor < totalDuration - 0.05) {
    const clipPath = path.join(tempDir, `ins_clip_${String(segIdx).padStart(3, "0")}.mp4`);
    cutClip(inputPath, cursor, totalDuration, clipPath);
    if (fs.existsSync(clipPath) && fs.statSync(clipPath).size > 0) {
      segments.push(clipPath);
    }
  }

  if (segments.length === 0) {
    fs.copyFileSync(inputPath, outputPath);
    return { narrationTimestamps };
  }

  // Normalize & concat
  emit(`  Normalizing ${segments.length} segments...`);
  const normalized = segments.map((seg, i) => {
    if (i % 10 === 0) emit(`  Normalizing ${i + 1}/${segments.length}...`);
    return normalizeSegmentAudio(seg, seg.replace(".mp4", "_norm.mp4"));
  });

  emit("  Concatenating...");
  const concatList = path.join(tempDir, "insert_concat.txt");
  concatSegments(normalized, outputPath, concatList);

  return { narrationTimestamps };
}

// ═════════════════════════════════════════════════════════════
// Main Orchestrator — N-Pass Pipeline
//
// Order of passes:
// 1. Trim (pre-cut source)
// 2. Overlay passes (blur → spotlight → callout) — original timestamps
// 3. Skip pass — removes skipped sections
// 4. Speed pass — applies speed ramps (remapped timestamps)
// 5. Mute pass — silences audio ranges (remapped timestamps)
// 6. Insert pass — zoom/pause/narrate (remapped timestamps)
// 7. Music pass — background music mixing
// 8. Final re-encode — resolution/CRF
// ═════════════════════════════════════════════════════════════

export async function produceTimelineVideo(
  sessionDir: string,
  emit: (msg: string) => void,
  version?: string,
  selectedActionIds?: string[],
  resolution?: { width: number; height: number },
  crf?: number,
  trim?: { start: number; end: number },
): Promise<string> {
  // ─── Setup ───
  const project = JSON.parse(fs.readFileSync(path.join(sessionDir, "demo-project.json"), "utf-8"));
  const recordingPath = project.recordingPath;
  let allActions: Action[] = project.actions || [];
  const videoDir = path.join(sessionDir, "video");
  const tempDir = path.join(videoDir, "temp");
  fs.mkdirSync(videoDir, { recursive: true });
  fs.mkdirSync(tempDir, { recursive: true });
  const totalDuration = probeDuration(recordingPath);
  const nativeRes = probeResolution(recordingPath);
  const res = resolution || nativeRes;
  emit(`Recording: ${nativeRes.width}x${nativeRes.height}, ${totalDuration.toFixed(1)}s`);
  if (resolution) emit(`Output resolution: ${resolution.width}x${resolution.height}`);
  if (crf) emit(`Output quality CRF: ${crf}`);

  // ─── Trim: pre-cut the source video if trim range is specified ───
  let effectiveRecording = recordingPath;
  let trimOffset = 0;
  if (trim) {
    emit(`\n[Trim] Cutting source video ${trim.start.toFixed(1)}s - ${trim.end.toFixed(1)}s...`);
    const trimmedPath = path.join(tempDir, "trimmed_source.mp4");
    cutClip(recordingPath, trim.start, trim.end, trimmedPath);
    if (fs.existsSync(trimmedPath) && fs.statSync(trimmedPath).size > 0) {
      effectiveRecording = trimmedPath;
      trimOffset = trim.start;
      emit(`  Trimmed source: ${probeDuration(trimmedPath).toFixed(1)}s`);
    } else {
      emit("  Warning: Trim failed, using full source");
    }
  }

  // ─── Filter by selection ───
  if (selectedActionIds && selectedActionIds.length > 0) {
    allActions = allActions.filter((a: Action & { id?: string }) => selectedActionIds.includes(a.id ?? ""));
    emit(`Selected ${allActions.length} action(s) for processing`);
  }

  // ─── Remap action timestamps if trimmed ───
  if (trimOffset > 0) {
    allActions = allActions.map((a) => {
      const remapped = { ...a, timestamp: a.timestamp - trimOffset };
      if (remapped.muteEndTimestamp != null) remapped.muteEndTimestamp -= trimOffset;
      if (remapped.speedEndTimestamp != null) remapped.speedEndTimestamp -= trimOffset;
      if (remapped.skipEndTimestamp != null) remapped.skipEndTimestamp -= trimOffset;
      if (remapped.musicEndTimestamp != null) remapped.musicEndTimestamp -= trimOffset;
      return remapped;
    });
  }

  // ─── Categorize actions by type ───
  const blurActions = allActions.filter((a) => a.type === "blur" && a.blurRects && a.blurRects.length > 0);
  const spotlightActions = allActions.filter((a) => a.type === "spotlight" && (a.spotlightRect || (a.spotlightRects && a.spotlightRects.length > 0)));
  const calloutActions = allActions.filter((a) => a.type === "callout" && (a.calloutText || (a.calloutPanels && a.calloutPanels.length > 0)));
  const zoomActions = allActions.filter((a) => a.type === "zoom" && (a.zoomRect || (a.zoomRects && a.zoomRects.length > 0) || (a.zoomTargets && a.zoomTargets.length > 0)));
  const pauseActions = allActions.filter((a) => a.type === "pause");
  const narrateActions = allActions.filter((a) => a.type === "narrate");
  const speedActions = allActions.filter((a) => a.type === "speed" && a.speedEndTimestamp && a.speedFactor);
  const skipActions = allActions.filter((a) => a.type === "skip" && a.skipEndTimestamp);
  const muteActions = allActions.filter((a) => a.type === "mute" && a.muteEndTimestamp);
  const musicAction = allActions.find((a) => a.type === "music" && a.musicPath);

  // Track intermediate files
  let currentInput = effectiveRecording;
  let passIdx = 0;

  const nextOutput = () => {
    passIdx++;
    return path.join(tempDir, `pass_${passIdx}.mp4`);
  };

  const effectiveTotalDuration = probeDuration(effectiveRecording);

  // ═══════════════════════════════════════════════════════════
  // Pass 1: Overlay Effects (blur → spotlight → callout)
  // Applied on original timestamps — no duration change
  // ═══════════════════════════════════════════════════════════

  if (blurActions.length > 0) {
    const out = nextOutput();
    applyBlurPass(currentInput, blurActions, out, res, effectiveTotalDuration, emit);
    if (fs.existsSync(out) && fs.statSync(out).size > 0) {
      currentInput = out;
    } else {
      emit("  Warning: Blur pass produced no output, skipping");
    }
  }

  if (spotlightActions.length > 0) {
    const out = nextOutput();
    applySpotlightPass(currentInput, spotlightActions, out, res, effectiveTotalDuration, emit);
    if (fs.existsSync(out) && fs.statSync(out).size > 0) {
      currentInput = out;
    } else {
      emit("  Warning: Spotlight pass produced no output, skipping");
    }
  }

  if (calloutActions.length > 0) {
    const out = nextOutput();
    applyCalloutPass(currentInput, calloutActions, out, effectiveTotalDuration, emit);
    if (fs.existsSync(out) && fs.statSync(out).size > 0) {
      currentInput = out;
    } else {
      emit("  Warning: Callout pass produced no output, skipping");
    }
  }

  // ═══════════════════════════════════════════════════════════
  // Pass 2: Skip/Cut — remove skipped sections
  // ═══════════════════════════════════════════════════════════

  const skipRanges = getSkipRanges(skipActions);
  const skipRemap = buildSkipRemap(skipRanges);

  if (skipRanges.length > 0) {
    const out = nextOutput();
    applySkipPass(currentInput, skipRanges, out, tempDir, emit);
    if (fs.existsSync(out) && fs.statSync(out).size > 0) {
      currentInput = out;
    } else {
      emit("  Warning: Skip pass produced no output, skipping");
    }
  }

  // ═══════════════════════════════════════════════════════════
  // Pass 3: Speed — apply speed ramps (remapped through skip)
  // ═══════════════════════════════════════════════════════════

  const rawSpeedRanges = getSpeedRanges(speedActions);
  const postSkipSpeedRanges = remapRanges(rawSpeedRanges, skipRemap);
  const speedRemap = buildSpeedRemap(postSkipSpeedRanges);

  if (postSkipSpeedRanges.length > 0) {
    const out = nextOutput();
    applySpeedPass(currentInput, postSkipSpeedRanges, out, tempDir, emit);
    if (fs.existsSync(out) && fs.statSync(out).size > 0) {
      currentInput = out;
    } else {
      emit("  Warning: Speed pass produced no output, skipping");
    }
  }

  // Combined remap: original → post-skip → post-speed
  const remapTs = (ts: number) => speedRemap(skipRemap(ts));

  // ═══════════════════════════════════════════════════════════
  // Pass 4: Mute — silence audio ranges (remapped timestamps)
  // Applied BEFORE inserts so muted audio stays muted in clips
  // ═══════════════════════════════════════════════════════════

  if (muteActions.length > 0) {
    const rawMuteRanges = muteActions
      .filter((a) => a.muteEndTimestamp)
      .map((a) => ({ start: a.timestamp, end: a.muteEndTimestamp! }))
      .sort((a, b) => a.start - b.start);
    const remappedMuteRanges = remapRanges(rawMuteRanges, remapTs);

    if (remappedMuteRanges.length > 0) {
      const out = nextOutput();
      applyMutePass(currentInput, remappedMuteRanges, out, emit);
      if (fs.existsSync(out) && fs.statSync(out).size > 0) {
        currentInput = out;
      }
    }
  }

  // ═══════════════════════════════════════════════════════════
  // Pass 5: Insert Effects (zoom, pause, narrate)
  // Uses remapped timestamps for cutting the processed video
  // ═══════════════════════════════════════════════════════════

  const insertActions = [...zoomActions, ...pauseActions, ...narrateActions];
  let narrationTimestamps: Array<{ start: number; end: number }> = [];

  if (insertActions.length > 0) {
    // Pre-generate narration audio
    const narrations = new Map<Action, NarrationResult>();
    for (let i = 0; i < insertActions.length; i++) {
      const action = insertActions[i];
      const narr = findNarration(action);
      if (!narr) continue;

      const audioPath = path.join(tempDir, `narr_${String(i).padStart(3, "0")}.wav`);
      const { hasAudio, audioDuration } = prepareNarrationAudio(action, audioPath, project, emit, action.timestamp);
      if (hasAudio) {
        narrations.set(action, { audioPath, audioDuration, text: narr.text || "", lang: narr.lang || "en" });
      }
    }

    const out = nextOutput();
    const result = executeInsertPass(
      currentInput, insertActions, narrations,
      out, tempDir, res, project, emit, remapTs,
    );
    narrationTimestamps = result.narrationTimestamps;
    if (fs.existsSync(out) && fs.statSync(out).size > 0) {
      currentInput = out;
    } else {
      emit("  Warning: Insert pass produced no output, skipping");
    }
  }

  // ═══════════════════════════════════════════════════════════
  // Pass 6: Music — mix background music
  // ═══════════════════════════════════════════════════════════

  const versionLabel = version || computeVersionLabel(videoDir);
  const finalPath = path.join(videoDir, `final_${versionLabel}.mp4`);

  if (musicAction) {
    emit(`\n[Pass: Music] Mixing background music...`);
    mixBackgroundMusic(currentInput, musicAction, narrationTimestamps, finalPath, emit);
    currentInput = finalPath;
  } else if (currentInput === effectiveRecording) {
    emit("\nNo effects to apply, copying original recording...");
    fs.copyFileSync(currentInput, finalPath);
    currentInput = finalPath;
  } else {
    fs.renameSync(currentInput, finalPath);
    currentInput = finalPath;
  }

  // ═══════════════════════════════════════════════════════════
  // Pass 7: Final — Resolution scaling + CRF re-encode
  // ═══════════════════════════════════════════════════════════

  const needsScale = resolution && (resolution.width !== nativeRes.width || resolution.height !== nativeRes.height);
  const needsReencode = crf && crf !== 18;

  if (needsScale || needsReencode) {
    emit(`\n[Final] Re-encoding${needsScale ? ` to ${res.width}x${res.height}` : ""}${needsReencode ? ` CRF ${crf}` : ""}...`);
    const reencoded = path.join(tempDir, "final_reencoded.mp4");
    fs.mkdirSync(tempDir, { recursive: true });
    const args = ["-y", "-i", finalPath];
    if (needsScale) {
      args.push("-vf", `scale=${res.width}:${res.height}:force_original_aspect_ratio=decrease,pad=${res.width}:${res.height}:(ow-iw)/2:(oh-ih)/2`);
    }
    args.push("-c:v", "libx264", "-preset", "fast", "-crf", String(crf || 18), "-pix_fmt", "yuv420p");
    if (hasAudioStream(finalPath)) {
      args.push("-c:a", "aac", "-b:a", "192k");
    }
    args.push(reencoded);
    ffmpegSync(args);
    if (fs.existsSync(reencoded) && fs.statSync(reencoded).size > 0) {
      fs.renameSync(reencoded, finalPath);
    }
  }

  // ─── Cleanup ───
  try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { /* ignore */ }

  emit("\nDone!");
  return finalPath;
}
