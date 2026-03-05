import * as path from "path";
import * as fs from "fs";
import {
  ffmpegSync,
  probeDuration,
  extractFrame,
  cutClip,
  hasAudioStream,
} from "./ffmpeg";

// ─── Types (shared with produce.ts) ───────────────────────────

export interface Action {
  type: string;
  timestamp: number;
  name?: string;
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
  spotlightRects?: [number, number, number, number][];
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
  calloutPanels?: { text: string; rect: [number, number, number, number]; fontSize: number }[];
  musicPath?: string;
  musicVolume?: number;
  musicDuckTo?: number;
  musicEndTimestamp?: number;
  blurRects?: [number, number, number, number][];
  blurRadius?: number;
  blurDuration?: number;
  muteEndTimestamp?: number;
  subtitleSize?: number;
  showSubtitles?: boolean;
  freeze?: boolean;
  [key: string]: unknown;
}

export interface ActionGroup {
  ts: number;
  actions: Action[];
}

export interface BuildContext {
  recordingPath: string;
  tempDir: string;
  res: { width: number; height: number };
  project: Record<string, unknown>;
  duration: number;
  emit: (msg: string) => void;
}

export interface EffectResult {
  paths: string[];
}

export interface PipelineState {
  segIdx: number;
  runningDuration: number;
  narrationTimestamps: Array<{ start: number; end: number }>;
}

export interface NarrationResult {
  audioPath: string;
  audioDuration: number;
  text: string;
  lang: string;
}

// ─── Effect Builders ──────────────────────────────────────────

/** Build a plain freeze frame with optional narration audio */
function buildPlainFreeze(
  group: ActionGroup,
  ctx: BuildContext,
  state: PipelineState,
  narration: NarrationResult | undefined,
): EffectResult {
  const framePath = path.join(ctx.tempDir, `frame_${String(state.segIdx).padStart(3, "0")}.png`);
  extractFrame(ctx.recordingPath, group.ts, framePath);

  const effectDuration = computeEffectDuration(group, narration);
  ctx.emit(`[freeze] Freeze frame at ${group.ts.toFixed(1)}s (${effectDuration.toFixed(1)}s)`);

  const freezePath = path.join(ctx.tempDir, `freeze_${String(state.segIdx).padStart(3, "0")}.mp4`);
  const { width, height } = ctx.res;
  const vf = `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`;

  const args = ["-y", "-loop", "1", "-framerate", "30", "-i", framePath];
  if (narration) args.push("-i", narration.audioPath);
  args.push("-t", effectDuration.toFixed(3), "-r", "30", "-vf", vf);
  args.push("-c:v", "libx264", "-preset", "fast", "-crf", "18", "-pix_fmt", "yuv420p");
  if (narration) args.push("-c:a", "aac", "-b:a", "192k", "-shortest");
  args.push(freezePath);
  ffmpegSync(args);

  state.segIdx++;
  return { paths: [freezePath] };
}

/** Build a 3-part zoom segment (zoom-in → hold → zoom-out) */
function buildZoomEffect(
  group: ActionGroup,
  ctx: BuildContext,
  state: PipelineState,
  narration: NarrationResult | undefined,
): EffectResult {
  const zoomAction = group.actions.find((a) => a.type === "zoom")!;
  const zoomRect = zoomAction.zoomRect!;
  const zoomDuration = zoomAction.zoomDuration ?? 1;
  const effectDuration = computeEffectDuration(group, narration);
  const holdDuration = narration ? effectDuration : (zoomAction.zoomHold ?? effectDuration);

  const framePath = path.join(ctx.tempDir, `frame_${String(state.segIdx).padStart(3, "0")}.png`);
  extractFrame(ctx.recordingPath, group.ts, framePath);
  ctx.emit(`[freeze] Zoom at ${group.ts.toFixed(1)}s hold=${holdDuration.toFixed(1)}s`);

  const [zx, zy, zw, zh] = zoomRect;
  const { width: outW, height: outH } = ctx.res;
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

  // Zoom-in
  const zoomInPath = path.join(ctx.tempDir, `zoomin_${String(state.segIdx).padStart(3, "0")}.mp4`);
  const zpIn = [
    `zoompan=z='1+(${maxZ.toFixed(4)}-1)*${ssForward}'`,
    `x='${xExpr}'`, `y='${yExpr}'`,
    `d=${inFrames}`, `s=${outW}x${outH}`, `fps=30`,
  ].join(":");
  ffmpegSync(["-y", "-i", framePath, "-vf", zpIn, "-c:v", "libx264", "-preset", "fast", "-crf", "18", "-pix_fmt", "yuv420p", zoomInPath]);
  paths.push(zoomInPath);
  state.segIdx++;

  // Hold
  const holdPath = path.join(ctx.tempDir, `zoomhold_${String(state.segIdx).padStart(3, "0")}.mp4`);
  const zpHold = [`zoompan=z='${maxZ.toFixed(4)}'`, `x='${xExpr}'`, `y='${yExpr}'`, `d=${holdFrames}`, `s=${outW}x${outH}`, `fps=30`].join(":");
  const holdArgs = ["-y", "-i", framePath];
  if (narration) holdArgs.push("-i", narration.audioPath);
  holdArgs.push("-vf", zpHold, "-c:v", "libx264", "-preset", "fast", "-crf", "18", "-pix_fmt", "yuv420p");
  if (narration) holdArgs.push("-c:a", "aac", "-b:a", "192k", "-shortest");
  holdArgs.push(holdPath);
  ffmpegSync(holdArgs);
  paths.push(holdPath);
  state.segIdx++;

  // Zoom-out
  const zoomOutPath = path.join(ctx.tempDir, `zoomout_${String(state.segIdx).padStart(3, "0")}.mp4`);
  const zpOut = [`zoompan=z='1+(${maxZ.toFixed(4)}-1)*${ssReverse}'`, `x='${xExpr}'`, `y='${yExpr}'`, `d=${inFrames}`, `s=${outW}x${outH}`, `fps=30`].join(":");
  ffmpegSync(["-y", "-i", framePath, "-vf", zpOut, "-c:v", "libx264", "-preset", "fast", "-crf", "18", "-pix_fmt", "yuv420p", zoomOutPath]);
  paths.push(zoomOutPath);
  state.segIdx++;

  return { paths };
}

/** Build spotlight on a frozen frame */
function buildFreezeSpotlight(
  group: ActionGroup,
  ctx: BuildContext,
  state: PipelineState,
  narration: NarrationResult | undefined,
): EffectResult {
  const spotAction = group.actions.find((a) => a.type === "spotlight")!;
  const [sx, sy, sw, sh] = spotAction.spotlightRect!;
  const alpha = (spotAction.dimOpacity ?? 0.7).toFixed(2);
  const effectDuration = computeEffectDuration(group, narration);
  const spotDur = Math.max(spotAction.spotlightDuration ?? 3, effectDuration);

  const framePath = path.join(ctx.tempDir, `frame_${String(state.segIdx).padStart(3, "0")}.png`);
  extractFrame(ctx.recordingPath, group.ts, framePath);
  ctx.emit(`[freeze] Spotlight at ${group.ts.toFixed(1)}s (${spotDur.toFixed(1)}s)`);

  const complexFilter = [
    `[0:v]split[orig][dark]`,
    `[dark]drawbox=x=0:y=0:w=iw:h=ih:color=black@${alpha}:t=fill[dimmed]`,
    `[orig]crop=${sw}:${sh}:${sx}:${sy}[bright]`,
    `[dimmed][bright]overlay=${sx}:${sy}[out]`,
  ].join(";");

  const spotPath = path.join(ctx.tempDir, `spot_${String(state.segIdx).padStart(3, "0")}.mp4`);
  const args = ["-y", "-loop", "1", "-framerate", "30", "-i", framePath];
  if (narration) args.push("-i", narration.audioPath);
  args.push("-filter_complex", complexFilter, "-map", "[out]");
  if (narration) args.push("-map", "1:a");
  args.push("-t", spotDur.toFixed(3), "-r", "30");
  args.push("-c:v", "libx264", "-preset", "fast", "-crf", "18", "-pix_fmt", "yuv420p");
  if (narration) args.push("-c:a", "aac", "-b:a", "192k", "-shortest");
  args.push(spotPath);
  ffmpegSync(args);

  state.segIdx++;
  return { paths: [spotPath] };
}

/** Build spotlight on moving video */
function buildMovingSpotlight(
  group: ActionGroup,
  ctx: BuildContext,
  state: PipelineState,
  narration: NarrationResult | undefined,
): EffectResult {
  const spotAction = group.actions.find((a) => a.type === "spotlight")!;
  const [sx, sy, sw, sh] = spotAction.spotlightRect!;
  const alpha = (spotAction.dimOpacity ?? 0.7).toFixed(2);
  const effectDuration = computeEffectDuration(group, narration);
  const spotDur = Math.max(spotAction.spotlightDuration ?? 3, effectDuration);
  const effectStart = group.ts;

  ctx.emit(`[moving] Spotlight at ${effectStart.toFixed(1)}s (${spotDur.toFixed(1)}s)`);

  const complexFilter = [
    `[0:v]split[orig][dark]`,
    `[dark]drawbox=x=0:y=0:w=iw:h=ih:color=black@${alpha}:t=fill[dimmed]`,
    `[orig]crop=${sw}:${sh}:${sx}:${sy}[bright]`,
    `[dimmed][bright]overlay=${sx}:${sy}[out]`,
  ].join(";");

  const spotPath = path.join(ctx.tempDir, `spot_${String(state.segIdx).padStart(3, "0")}.mp4`);
  const clipDur = Math.min(spotDur, ctx.duration - effectStart);
  const args = [
    "-y",
    "-ss", effectStart.toFixed(3),
    "-i", ctx.recordingPath,
    "-t", clipDur.toFixed(3),
  ];
  if (narration) args.push("-i", narration.audioPath);
  args.push("-filter_complex", complexFilter, "-map", "[out]");
  if (narration) {
    args.push("-map", "1:a");
  } else if (hasAudioStream(ctx.recordingPath)) {
    args.push("-map", "0:a");
  }
  args.push("-c:v", "libx264", "-preset", "fast", "-crf", "18", "-pix_fmt", "yuv420p");
  if (narration) {
    args.push("-c:a", "aac", "-b:a", "192k", "-shortest");
  } else if (hasAudioStream(ctx.recordingPath)) {
    args.push("-c:a", "aac", "-b:a", "192k");
  }
  args.push(spotPath);
  ffmpegSync(args);

  state.segIdx++;
  return { paths: [spotPath] };
}

/** Build drawtext filter string for callouts */
function buildDrawtextFilter(
  text: string,
  style: string,
  position: [number, number] | undefined,
  step: number | undefined,
): string {
  let displayText = text;
  if (style === "step-counter" && step) {
    displayText = `Step ${step}: ${text}`;
  }
  displayText = displayText.replace(/'/g, "'\\''").replace(/:/g, "\\:");

  if (style === "lower-third") {
    return `drawtext=text='${displayText}':fontsize=36:fontcolor=white:x=(w-text_w)/2:y=h-80:box=1:boxcolor=black@0.7:boxborderw=15`;
  } else if (style === "step-counter") {
    const x = position ? position[0] : 100;
    const y = position ? position[1] : 100;
    return `drawtext=text='${displayText}':fontsize=28:fontcolor=white:x=${x}:y=${y}:box=1:boxcolor=0x2563EB@0.9:boxborderw=12`;
  } else {
    const x = position ? position[0] : 100;
    const y = position ? position[1] : 100;
    return `drawtext=text='${displayText}':fontsize=28:fontcolor=white:x=${x}:y=${y}:box=1:boxcolor=black@0.8:boxborderw=10`;
  }
}

/** Build callout on a frozen frame */
function buildFreezeCallout(
  group: ActionGroup,
  ctx: BuildContext,
  state: PipelineState,
  narration: NarrationResult | undefined,
): EffectResult {
  const calloutAction = group.actions.find((a) => a.type === "callout")!;
  const effectDuration = computeEffectDuration(group, narration);
  const callDur = Math.max(calloutAction.calloutDuration ?? 3, effectDuration);

  const framePath = path.join(ctx.tempDir, `frame_${String(state.segIdx).padStart(3, "0")}.png`);
  extractFrame(ctx.recordingPath, group.ts, framePath);
  ctx.emit(`[freeze] Callout at ${group.ts.toFixed(1)}s: "${(calloutAction.calloutText || "").slice(0, 30)}..."`);

  const drawtext = buildDrawtextFilter(
    calloutAction.calloutText || "",
    calloutAction.calloutStyle || "label",
    calloutAction.calloutPosition as [number, number] | undefined,
    calloutAction.calloutStep,
  );

  const { width, height } = ctx.res;
  const vf = `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,${drawtext}`;
  const callPath = path.join(ctx.tempDir, `call_${String(state.segIdx).padStart(3, "0")}.mp4`);

  ffmpegSync([
    "-y", "-loop", "1", "-framerate", "30", "-i", framePath,
    "-t", callDur.toFixed(3), "-r", "30",
    "-vf", vf,
    "-c:v", "libx264", "-preset", "fast", "-crf", "18", "-pix_fmt", "yuv420p",
    callPath,
  ]);

  state.segIdx++;
  return { paths: [callPath] };
}

/** Build callout on moving video */
function buildMovingCallout(
  group: ActionGroup,
  ctx: BuildContext,
  state: PipelineState,
  narration: NarrationResult | undefined,
): EffectResult {
  const calloutAction = group.actions.find((a) => a.type === "callout")!;
  const effectDuration = computeEffectDuration(group, narration);
  const callDur = Math.max(calloutAction.calloutDuration ?? 3, effectDuration);
  const effectStart = group.ts;

  ctx.emit(`[moving] Callout at ${effectStart.toFixed(1)}s: "${(calloutAction.calloutText || "").slice(0, 30)}..."`);

  const drawtext = buildDrawtextFilter(
    calloutAction.calloutText || "",
    calloutAction.calloutStyle || "label",
    calloutAction.calloutPosition as [number, number] | undefined,
    calloutAction.calloutStep,
  );

  const callPath = path.join(ctx.tempDir, `call_${String(state.segIdx).padStart(3, "0")}.mp4`);
  const clipDur = Math.min(callDur, ctx.duration - effectStart);
  const callArgs = [
    "-y",
    "-ss", effectStart.toFixed(3),
    "-i", ctx.recordingPath,
    "-t", clipDur.toFixed(3),
    "-vf", drawtext,
    "-c:v", "libx264", "-preset", "fast", "-crf", "18", "-pix_fmt", "yuv420p",
  ];
  if (hasAudioStream(ctx.recordingPath)) {
    callArgs.push("-c:a", "aac", "-b:a", "192k");
  }
  callArgs.push(callPath);
  ffmpegSync(callArgs);

  // Overlay narration audio if needed
  if (narration) {
    const withAudioPath = path.join(ctx.tempDir, `callaudio_${String(state.segIdx).padStart(3, "0")}.mp4`);
    if (overlayAudio(callPath, narration.audioPath, withAudioPath)) {
      state.segIdx++;
      return { paths: [withAudioPath] };
    }
  }

  state.segIdx++;
  return { paths: [callPath] };
}

/** Build moving video with narration overlay (default moving effect) */
function buildMovingNarrate(
  group: ActionGroup,
  ctx: BuildContext,
  state: PipelineState,
  narration: NarrationResult | undefined,
): EffectResult {
  const effectDuration = computeEffectDuration(group, narration);
  const effectStart = group.ts;
  const clipEnd = Math.min(effectStart + effectDuration, ctx.duration);

  ctx.emit(`[moving] Narration at ${effectStart.toFixed(1)}s (${effectDuration.toFixed(1)}s)`);

  const playPath = path.join(ctx.tempDir, `play_${String(state.segIdx).padStart(3, "0")}.mp4`);
  cutClip(ctx.recordingPath, effectStart, clipEnd, playPath);

  if (narration) {
    const withAudioPath = path.join(ctx.tempDir, `playaudio_${String(state.segIdx).padStart(3, "0")}.mp4`);
    if (overlayAudio(playPath, narration.audioPath, withAudioPath)) {
      state.segIdx++;
      return { paths: [withAudioPath] };
    }
  }

  state.segIdx++;
  return { paths: [playPath] };
}

// ─── Overlay & Subtitle Utilities ─────────────────────────────

/** Overlay audio onto a video clip */
function overlayAudio(videoPath: string, audioPath: string, outputPath: string): boolean {
  ffmpegSync([
    "-y", "-i", videoPath, "-i", audioPath,
    "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest",
    outputPath,
  ]);
  return fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0;
}

/** Convert seconds to ASS timestamp format (h:mm:ss.cc) */
function secToAssTs(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const cs = Math.round((sec - Math.floor(sec)) * 100);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

/** Generate ASS subtitle file with karaoke word highlighting */
function generateSubtitleFile(
  text: string,
  duration: number,
  outputPath: string,
  res: { width: number; height: number },
  fontSize: number = 28,
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

/** Burn subtitles into a video segment */
function burnSubtitles(videoPath: string, subtitlePath: string, outputPath: string): boolean {
  const result = ffmpegSync([
    "-y", "-i", videoPath,
    "-vf", `ass=${subtitlePath}`,
    "-c:v", "libx264", "-preset", "fast", "-crf", "18",
    "-pix_fmt", "yuv420p",
    "-c:a", "copy",
    outputPath,
  ]);
  return fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0;
}

// ─── Blur Effect Builders ─────────────────────────────────────

/** Build ffmpeg filter for blurring multiple rects */
function buildBlurFilter(
  rects: [number, number, number, number][],
  radius: number,
  res: { width: number; height: number },
): { filter: string; lastLabel: string } {
  // Chain: split → crop each → blur each → overlay each back
  // For N rects we need N stages of split+crop+blur+overlay
  let filter = "";
  let lastLabel = "0:v";

  for (let i = 0; i < rects.length; i++) {
    const [bx, by, bw, bh] = rects[i];
    // Clamp to video bounds
    const x = Math.max(0, Math.min(bx, res.width - 1));
    const y = Math.max(0, Math.min(by, res.height - 1));
    const w = Math.min(bw, res.width - x);
    const h = Math.min(bh, res.height - y);

    if (w <= 0 || h <= 0) continue;

    const sep = filter ? ";" : "";
    filter += `${sep}[${lastLabel}]split[base${i}][src${i}]`;
    filter += `;[src${i}]crop=${w}:${h}:${x}:${y},boxblur=${radius}:${radius}[blur${i}]`;
    filter += `;[base${i}][blur${i}]overlay=${x}:${y}[out${i}]`;
    lastLabel = `out${i}`;
  }

  return { filter, lastLabel };
}

/** Build blur on a frozen frame */
function buildFreezeBlur(
  group: ActionGroup,
  ctx: BuildContext,
  state: PipelineState,
  narration: NarrationResult | undefined,
): EffectResult {
  const blurAction = group.actions.find((a) => a.type === "blur")!;
  const rects = blurAction.blurRects ?? [];
  if (rects.length === 0) return buildPlainFreeze(group, ctx, state, narration);

  const radius = blurAction.blurRadius ?? 20;
  const effectDuration = computeEffectDuration(group, narration);
  const blurDur = Math.max(blurAction.blurDuration ?? 3, effectDuration);

  const idx = String(state.segIdx).padStart(3, "0");
  const framePath = path.join(ctx.tempDir, `frame_${idx}.png`);
  extractFrame(ctx.recordingPath, group.ts, framePath);
  ctx.emit(`[freeze] Blur at ${group.ts.toFixed(1)}s (${rects.length} region${rects.length > 1 ? "s" : ""}, ${blurDur.toFixed(1)}s)`);

  const { filter, lastLabel } = buildBlurFilter(rects, radius, ctx.res);

  const blurPath = path.join(ctx.tempDir, `blur_${idx}.mp4`);
  const args = ["-y", "-loop", "1", "-framerate", "30", "-i", framePath];
  if (narration) args.push("-i", narration.audioPath);
  args.push("-filter_complex", filter + `;[${lastLabel}]null[vout]`);
  args.push("-map", "[vout]");
  if (narration) args.push("-map", "1:a");
  args.push("-t", blurDur.toFixed(3), "-r", "30");
  args.push("-c:v", "libx264", "-preset", "fast", "-crf", "18", "-pix_fmt", "yuv420p");
  if (narration) args.push("-c:a", "aac", "-b:a", "192k", "-shortest");
  args.push(blurPath);
  ffmpegSync(args);

  state.segIdx++;
  return { paths: [blurPath] };
}

/** Build blur on moving video */
function buildMovingBlur(
  group: ActionGroup,
  ctx: BuildContext,
  state: PipelineState,
  narration: NarrationResult | undefined,
): EffectResult {
  const blurAction = group.actions.find((a) => a.type === "blur")!;
  const rects = blurAction.blurRects ?? [];
  if (rects.length === 0) return buildMovingNarrate(group, ctx, state, narration);

  const radius = blurAction.blurRadius ?? 20;
  const effectDuration = computeEffectDuration(group, narration);
  const blurDur = Math.max(blurAction.blurDuration ?? 3, effectDuration);
  const effectStart = group.ts;

  ctx.emit(`[moving] Blur at ${effectStart.toFixed(1)}s (${rects.length} region${rects.length > 1 ? "s" : ""}, ${blurDur.toFixed(1)}s)`);

  const { filter, lastLabel } = buildBlurFilter(rects, radius, ctx.res);

  const idx = String(state.segIdx).padStart(3, "0");
  const blurPath = path.join(ctx.tempDir, `blur_${idx}.mp4`);
  const clipDur = Math.min(blurDur, ctx.duration - effectStart);
  const args = [
    "-y",
    "-ss", effectStart.toFixed(3),
    "-i", ctx.recordingPath,
    "-t", clipDur.toFixed(3),
  ];
  if (narration) args.push("-i", narration.audioPath);
  args.push("-filter_complex", filter + `;[${lastLabel}]null[vout]`);
  args.push("-map", "[vout]");
  if (narration) {
    args.push("-map", "1:a");
  } else if (hasAudioStream(ctx.recordingPath)) {
    args.push("-map", "0:a");
  }
  args.push("-c:v", "libx264", "-preset", "fast", "-crf", "18", "-pix_fmt", "yuv420p");
  if (narration) {
    args.push("-c:a", "aac", "-b:a", "192k", "-shortest");
  } else if (hasAudioStream(ctx.recordingPath)) {
    args.push("-c:a", "aac", "-b:a", "192k");
  }
  args.push(blurPath);
  ffmpegSync(args);

  state.segIdx++;
  return { paths: [blurPath] };
}

// ─── Effect Dispatch ──────────────────────────────────────────

/** Priority order for effect types */
const PRIORITY_ORDER = ["zoom", "spotlight", "blur", "callout"];

const EFFECT_BUILDERS: Record<string, {
  freeze: typeof buildPlainFreeze;
  moving: typeof buildMovingNarrate;
}> = {
  zoom:      { freeze: buildZoomEffect,      moving: buildZoomEffect },
  spotlight: { freeze: buildFreezeSpotlight,  moving: buildMovingSpotlight },
  blur:      { freeze: buildFreezeBlur,       moving: buildMovingBlur },
  callout:   { freeze: buildFreezeCallout,    moving: buildMovingCallout },
};

/** Dispatch to the correct effect builder based on group actions and mode */
export function buildEffectGroup(
  group: ActionGroup,
  mode: "freeze" | "moving",
  ctx: BuildContext,
  state: PipelineState,
  narration: NarrationResult | undefined,
): EffectResult {
  for (const type of PRIORITY_ORDER) {
    const action = group.actions.find((a) => a.type === type);
    if (action) {
      // Verify the action has the required data for its type
      if (type === "zoom" && !action.zoomRect) continue;
      if (type === "spotlight" && !action.spotlightRect) continue;
      if (type === "blur" && (!action.blurRects || action.blurRects.length === 0)) continue;
      if (type === "callout" && !action.calloutText) continue;
      return EFFECT_BUILDERS[type][mode](group, ctx, state, narration);
    }
  }

  return mode === "freeze"
    ? buildPlainFreeze(group, ctx, state, narration)
    : buildMovingNarrate(group, ctx, state, narration);
}

/** Apply subtitles as a post-step on the last segment of an effect result */
export function applySubtitles(
  result: EffectResult,
  narration: NarrationResult | undefined,
  effectiveAction: Action | null,
  ctx: BuildContext,
  state: PipelineState,
): void {
  if (!narration?.text) return;
  if (effectiveAction?.showSubtitles === false) return;
  if (result.paths.length === 0) return;

  const lastPath = result.paths[result.paths.length - 1];
  const subPath = path.join(ctx.tempDir, `sub_${String(state.segIdx).padStart(3, "0")}.ass`);
  const subOutPath = path.join(ctx.tempDir, `subseg_${String(state.segIdx).padStart(3, "0")}.mp4`);

  generateSubtitleFile(
    narration.text, narration.audioDuration, subPath, ctx.res,
    effectiveAction?.subtitleSize ?? 28,
  );

  if (burnSubtitles(lastPath, subPath, subOutPath)) {
    result.paths[result.paths.length - 1] = subOutPath;
  }
}

// ─── Shared Helpers ───────────────────────────────────────────

/** Compute effect duration from group actions and narration */
export function computeEffectDuration(
  group: ActionGroup,
  narration: NarrationResult | undefined,
): number {
  let dur = 3;
  if (narration && narration.audioDuration > 0) dur = narration.audioDuration + 0.5;

  for (const a of group.actions) {
    if (typeof a.resumeAfter === "number") return a.resumeAfter;
    if (a.type === "callout") dur = Math.max(dur, a.calloutDuration ?? 3);
    if (a.type === "spotlight") dur = Math.max(dur, a.spotlightDuration ?? 3);
    if (a.type === "blur") dur = Math.max(dur, a.blurDuration ?? 3);
    if (a.type === "zoom") dur = Math.max(dur, (a.zoomDuration ?? 1) * 2 + (a.zoomHold ?? 2));
  }
  return dur;
}

/** Estimate effect duration statically (no audio) — used for planning */
export function estimateEffectDuration(group: ActionGroup): number {
  let dur = 3;
  for (const a of group.actions) {
    if (typeof a.resumeAfter === "number") return a.resumeAfter;
    if (a.type === "callout") dur = Math.max(dur, a.calloutDuration ?? 3);
    if (a.type === "spotlight") dur = Math.max(dur, a.spotlightDuration ?? 3);
    if (a.type === "blur") dur = Math.max(dur, a.blurDuration ?? 3);
    if (a.type === "zoom") dur = Math.max(dur, (a.zoomDuration ?? 1) * 2 + (a.zoomHold ?? 2));
  }
  return dur;
}

/** Cut a speed-ramped clip */
export function cutSpeedClip(
  inputPath: string,
  startTime: number,
  endTime: number,
  speedFactor: number,
  outputPath: string,
): void {
  const pts = (1 / speedFactor).toFixed(4);

  const hasAudio = hasAudioStream(inputPath);
  const args = [
    "-y",
    "-ss", startTime.toFixed(3),
    "-i", inputPath,
    "-t", (endTime - startTime).toFixed(3),
    "-vf", `setpts=${pts}*PTS`,
    "-c:v", "libx264", "-preset", "fast", "-crf", "18",
    "-pix_fmt", "yuv420p",
  ];
  if (hasAudio) {
    args.push("-af", `atempo=${speedFactor}`);
    args.push("-c:a", "aac", "-b:a", "192k");
  } else {
    args.push("-an");
  }
  args.push(outputPath);

  ffmpegSync(args);
}

/** Mix background music into the final video */
export function mixBackgroundMusic(
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

  ffmpegSync([
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
