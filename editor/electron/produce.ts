import * as path from "path";
import * as fs from "fs";
import {
  probeDuration,
  probeResolution,
  cutClip,
  cutClipMuted,
  normalizeSegmentAudio,
  concatSegments,
} from "./ffmpeg";
import { generateTTS } from "./tts";
import {
  type Action,
  type ActionGroup,
  type BuildContext,
  type PipelineState,
  type NarrationResult,
  buildEffectGroup,
  applySubtitles,
  estimateEffectDuration,
  cutSpeedClip,
  mixBackgroundMusic,
} from "./effects";

// ─── Segment Plan Types ───────────────────────────────────────

type SegmentPlan =
  | { kind: "clip"; start: number; end: number; speed?: number; muted?: boolean }
  | { kind: "effect"; ts: number; group: ActionGroup; mode: "freeze" | "moving" };

// ─── Range Utilities ──────────────────────────────────────────

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

function getSkipRanges(actions: Action[]): Array<{ start: number; end: number }> {
  return actions
    .filter((a) => a.type === "skip" && a.skipEndTimestamp)
    .map((a) => ({ start: a.timestamp, end: a.skipEndTimestamp! }))
    .sort((a, b) => a.start - b.start);
}

function getSpeedRanges(actions: Action[]): Array<{ start: number; end: number; factor: number }> {
  return actions
    .filter((a) => a.type === "speed" && a.speedEndTimestamp && a.speedFactor)
    .map((a) => ({ start: a.timestamp, end: a.speedEndTimestamp!, factor: a.speedFactor! }))
    .sort((a, b) => a.start - b.start);
}

function getMuteRanges(actions: Action[]): Array<{ start: number; end: number }> {
  return actions
    .filter((a) => a.type === "mute" && a.muteEndTimestamp)
    .map((a) => ({ start: a.timestamp, end: a.muteEndTimestamp as number }))
    .sort((a, b) => a.start - b.start);
}

function isInMuteRange(start: number, end: number, muteRanges: Array<{ start: number; end: number }>): boolean {
  return muteRanges.some((r) => start >= r.start - 0.05 && end <= r.end + 0.05);
}

function isInSkipRange(time: number, skipRanges: Array<{ start: number; end: number }>): boolean {
  return skipRanges.some((r) => time >= r.start && time < r.end);
}

function isRangeSkipped(start: number, end: number, skipRanges: Array<{ start: number; end: number }>): boolean {
  return skipRanges.some((r) => start >= r.start - 0.05 && end <= r.end + 0.05);
}

function getSpeedForRange(start: number, end: number, speedRanges: Array<{ start: number; end: number; factor: number }>): number | null {
  const range = speedRanges.find((r) => start >= r.start - 0.1 && end <= r.end + 0.1);
  return range ? range.factor : null;
}

function getSplitPoints(
  from: number,
  to: number,
  skipRanges: Array<{ start: number; end: number }>,
  speedRanges: Array<{ start: number; end: number; factor: number }>,
  muteRanges: Array<{ start: number; end: number }> = [],
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
  for (const r of muteRanges) {
    if (r.start > from + 0.05 && r.start < to - 0.05) points.add(r.start);
    if (r.end > from + 0.05 && r.end < to - 0.05) points.add(r.end);
  }
  return [...points].sort((a, b) => a - b);
}

// ─── Narration Utilities ──────────────────────────────────────

const LANG_CODES: Record<string, string> = {
  en: "a", "en-gb": "b", hi: "h", es: "e", fr: "f", ja: "j", zh: "z", pt: "p", it: "i",
};

function findNarration(action: Action | null): { text: string; lang: string; audioPath?: string } | null {
  if (!action) return null;

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

function resolveNarrateAction(group: ActionGroup): Action | null {
  const narrateAction = group.actions.find((a) => a.type === "narrate");
  if (narrateAction) return narrateAction;
  const zoomAction = group.actions.find((a) => a.type === "zoom");
  if (zoomAction?.narration) return zoomAction;
  const spotlightAction = group.actions.find((a) => a.type === "spotlight");
  if (spotlightAction?.narration) return spotlightAction;
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

// ═══════════════════════════════════════════════════════════════
// Phase 1: Plan — compute ordered segment list
// ═══════════════════════════════════════════════════════════════

function planClipsBetween(
  from: number,
  to: number,
  skipRanges: Array<{ start: number; end: number }>,
  speedRanges: Array<{ start: number; end: number; factor: number }>,
  muteRanges: Array<{ start: number; end: number }> = [],
): SegmentPlan[] {
  const plans: SegmentPlan[] = [];
  const splitPts = getSplitPoints(from, to, skipRanges, speedRanges, muteRanges);
  const edges = [from, ...splitPts, to];

  for (let i = 0; i < edges.length - 1; i++) {
    const segStart = edges[i];
    const segEnd = edges[i + 1];
    if (segEnd - segStart < 0.1) continue;
    if (isRangeSkipped(segStart, segEnd, skipRanges)) continue;

    const speedFactor = getSpeedForRange(segStart, segEnd, speedRanges);
    const muted = isInMuteRange(segStart, segEnd, muteRanges);
    plans.push({
      kind: "clip",
      start: segStart,
      end: segEnd,
      speed: (speedFactor && speedFactor !== 1) ? speedFactor : undefined,
      muted: muted || undefined,
    });
  }
  return plans;
}

function planSegments(
  groups: ActionGroup[],
  skipRanges: Array<{ start: number; end: number }>,
  speedRanges: Array<{ start: number; end: number; factor: number }>,
  muteRanges: Array<{ start: number; end: number }>,
  totalDuration: number,
): SegmentPlan[] {
  const plans: SegmentPlan[] = [];
  let currentTime = 0;

  for (const group of groups) {
    const ts = group.ts;

    if (isInSkipRange(ts, skipRanges)) continue;

    // Clip plans for video between currentTime and this action
    if (ts > currentTime + 0.1) {
      plans.push(...planClipsBetween(currentTime, ts, skipRanges, speedRanges, muteRanges));
    }

    const wantFreeze = group.actions.some(
      (a) => a.type === "pause" || a.type === "zoom" || a.freeze === true,
    );

    plans.push({
      kind: "effect",
      ts,
      group,
      mode: wantFreeze ? "freeze" : "moving",
    });

    if (!wantFreeze) {
      currentTime = Math.min(ts + estimateEffectDuration(group), totalDuration);
    } else {
      currentTime = ts;
    }
  }

  // Trailing clip after last action
  if (currentTime < totalDuration - 0.1) {
    plans.push(...planClipsBetween(currentTime, totalDuration, skipRanges, speedRanges, muteRanges));
  }

  return plans;
}

// ═══════════════════════════════════════════════════════════════
// Phase 2: Generate Audio — TTS for all narrations
// ═══════════════════════════════════════════════════════════════

function generateAllNarrations(
  plans: SegmentPlan[],
  ctx: BuildContext,
): Map<number, NarrationResult> {
  const results = new Map<number, NarrationResult>();

  for (let i = 0; i < plans.length; i++) {
    const plan = plans[i];
    if (plan.kind !== "effect") continue;

    const effectiveAction = resolveNarrateAction(plan.group);
    if (!effectiveAction) continue;

    const audioPath = path.join(ctx.tempDir, `narr_${String(i).padStart(3, "0")}.wav`);
    const { hasAudio, audioDuration } = prepareNarrationAudio(
      effectiveAction, audioPath, ctx.project, ctx.emit, plan.ts,
    );

    if (hasAudio) {
      const narrInfo = findNarration(effectiveAction);
      results.set(i, {
        audioPath,
        audioDuration,
        text: narrInfo?.text || "",
        lang: narrInfo?.lang || "en",
      });
    }
  }

  return results;
}

// ═══════════════════════════════════════════════════════════════
// Phase 3: Build Segments — execute plans
// ═══════════════════════════════════════════════════════════════

function buildAllSegments(
  plans: SegmentPlan[],
  narrations: Map<number, NarrationResult>,
  ctx: BuildContext,
): { segments: string[]; narrationTimestamps: Array<{ start: number; end: number }> } {
  const segments: string[] = [];
  const state: PipelineState = { segIdx: 0, runningDuration: 0, narrationTimestamps: [] };

  for (let i = 0; i < plans.length; i++) {
    const plan = plans[i];

    if (plan.kind === "clip") {
      const clipPath = path.join(ctx.tempDir, `clip_${String(state.segIdx).padStart(3, "0")}.mp4`);
      if (plan.speed) {
        ctx.emit(`Speed ramp ${plan.speed}x: ${plan.start.toFixed(1)}s - ${plan.end.toFixed(1)}s`);
        cutSpeedClip(ctx.recordingPath, plan.start, plan.end, plan.speed, clipPath);
      } else if (plan.muted) {
        ctx.emit(`Muted clip ${plan.start.toFixed(1)}s - ${plan.end.toFixed(1)}s`);
        cutClipMuted(ctx.recordingPath, plan.start, plan.end, clipPath);
      } else {
        ctx.emit(`Cutting ${plan.start.toFixed(1)}s - ${plan.end.toFixed(1)}s`);
        cutClip(ctx.recordingPath, plan.start, plan.end, clipPath);
      }
      if (fs.existsSync(clipPath) && fs.statSync(clipPath).size > 0) {
        state.runningDuration += probeDuration(clipPath);
        segments.push(clipPath);
        state.segIdx++;
      }
      continue;
    }

    // Effect plan
    const narration = narrations.get(i);
    const result = buildEffectGroup(plan.group, plan.mode, ctx, state, narration);

    // Track narration timestamps for music ducking
    if (narration) {
      const totalEffectDur = result.paths.reduce((s, p) => s + probeDuration(p), 0);
      state.narrationTimestamps.push({
        start: state.runningDuration,
        end: state.runningDuration + totalEffectDur,
      });
    }

    // Apply subtitles as post-step
    const effectiveAction = resolveNarrateAction(plan.group);
    applySubtitles(result, narration, effectiveAction, ctx, state);

    // Accumulate
    for (const p of result.paths) {
      state.runningDuration += probeDuration(p);
      segments.push(p);
    }
  }

  return { segments, narrationTimestamps: state.narrationTimestamps };
}

// ═══════════════════════════════════════════════════════════════
// Phase 4: Normalize & Concat
// ═══════════════════════════════════════════════════════════════

function normalizeAndConcat(
  segments: string[],
  outputPath: string,
  tempDir: string,
  emit: (msg: string) => void,
): void {
  emit(`Normalizing ${segments.length} segments...`);
  const normalized = segments.map((seg, i) => {
    emit(`Normalizing ${i + 1}/${segments.length}...`);
    return normalizeSegmentAudio(seg, seg.replace(".mp4", "_norm.mp4"));
  });

  emit("Concatenating...");
  const concatList = path.join(tempDir, "concat_list.txt");
  concatSegments(normalized, outputPath, concatList);
}

// ═══════════════════════════════════════════════════════════════
// Phase 5: Music
// ═══════════════════════════════════════════════════════════════
// (mixBackgroundMusic imported from effects.ts)

// ─── Version Label ────────────────────────────────────────────

function computeVersionLabel(videoDir: string): string {
  const existing = fs.readdirSync(videoDir).filter((f) => f.match(/^final_v\d+\.mp4$/));
  const maxV = existing.reduce((max, f) => {
    const m = f.match(/^final_v(\d+)\.mp4$/);
    return m ? Math.max(max, parseInt(m[1])) : max;
  }, 0);
  return `v${maxV + 1}`;
}

// ═══════════════════════════════════════════════════════════════
// Main Orchestrator
// ═══════════════════════════════════════════════════════════════

export async function produceTimelineVideo(
  sessionDir: string,
  emit: (msg: string) => void,
  version?: string,
): Promise<string> {
  // ─── Setup ───
  const project = JSON.parse(fs.readFileSync(path.join(sessionDir, "demo-project.json"), "utf-8"));
  const recordingPath = project.recordingPath;
  const actions: Action[] = project.actions || [];
  const videoDir = path.join(sessionDir, "video");
  const tempDir = path.join(videoDir, "temp");
  fs.mkdirSync(videoDir, { recursive: true });
  fs.mkdirSync(tempDir, { recursive: true });
  const totalDuration = probeDuration(recordingPath);
  const res = probeResolution(recordingPath);
  emit(`Recording: ${res.width}x${res.height}, ${totalDuration.toFixed(1)}s`);

  const ctx: BuildContext = { recordingPath, tempDir, res, project, duration: totalDuration, emit };

  // ─── Phase 1: Plan ───
  const skipRanges = getSkipRanges(actions);
  const speedRanges = getSpeedRanges(actions);
  const muteRanges = getMuteRanges(actions);
  const musicAction = actions.find((a) => a.type === "music" && a.musicPath);
  const timelineActions = actions.filter((a) => !["skip", "speed", "music", "mute"].includes(a.type));
  const groups = groupActions(timelineActions);
  const plans = planSegments(groups, skipRanges, speedRanges, muteRanges, totalDuration);
  emit(`Planned ${plans.length} segments (${plans.filter((p) => p.kind === "effect").length} effects)`);

  // ─── Phase 2: Generate Audio ───
  const narrations = generateAllNarrations(plans, ctx);
  emit(`Generated ${narrations.size} narration audio files`);

  // ─── Phase 3: Build Segments ───
  const { segments, narrationTimestamps } = buildAllSegments(plans, narrations, ctx);
  if (segments.length === 0) throw new Error("No video segments produced");

  // ─── Phase 4: Normalize & Concat ───
  const versionLabel = version || computeVersionLabel(videoDir);
  const finalPath = path.join(videoDir, `final_${versionLabel}.mp4`);

  if (musicAction) {
    const preMusicPath = path.join(tempDir, `premusic_${versionLabel}.mp4`);
    normalizeAndConcat(segments, preMusicPath, tempDir, emit);
    // ─── Phase 5: Music ───
    mixBackgroundMusic(preMusicPath, musicAction, narrationTimestamps, finalPath, emit);
  } else {
    normalizeAndConcat(segments, finalPath, tempDir, emit);
  }

  // Cleanup
  try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { /* ignore */ }

  emit("Done!");
  return finalPath;
}
