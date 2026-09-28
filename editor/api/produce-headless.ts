// ─── produce-headless: one job + one language → final_<lang>.mp4 ─────
//
//   tts      synthesizeNarrations → audio/tts_<hash>.wav (cached by content;
//            recorded `audio` files are used in place)
//   compile  script + trace + clips → NaraScreen actions (auto durations fitted
//            to the real clip lengths)
//   cards    optional title/end card clips, rendered first at the final size
//   render   demo-project.<lang>.json → produceTimelineVideo — the SAME pipeline
//            the desktop app uses. The audio is pre-generated, so the producer
//            only copies it (its own silent TTS fallback never runs). Its final
//            pass also letterboxes to an output resolution preset and joins the cards.
//
// The job folder doubles as a desktop session: demo-project.json has the
// DemoProject shape (src/types.ts), so a human can open the job in NaraScreen
// for touch-ups. demo-project.<lang>.json keeps each language's version.
//
// Runs outside Electron (plain node via tsx); bin-paths.ts prefers the system
// ffmpeg, which has the drawtext/ass filters callouts and subtitles need.

import * as fs from "fs";
import * as path from "path";
import { produceTimelineVideo } from "../electron/produce";
import { renderCards, type CardResult } from "./cards";
import { ffmpegSync, hasAudioStream, probeDuration, probeResolution } from "../electron/ffmpeg";
import { DEFAULT_VOICES } from "../src/lib/voices";
import { compile, modelTimeline, spotlightOverlaps } from "./compiler";
import { AgentError } from "./errors";
import { jobPaths, readJob } from "./job";
import { scriptVoice, synthesizeNarrations } from "./narration";
import { stage, warn, type Log } from "./output";
import { DEFAULT_KOKORO_ENDPOINT, QUALITY_CRF, RESOLUTIONS, type DemoScript, type Quality, type ResolutionName } from "./schema";
import type { NaraAction, TraceEntry } from "./types";
import type { Chapter } from "../electron/fx-chapters";
import { titleFor } from "./fx-structure";
import { motionProject } from "./cursor-trace";

export interface ProduceResult {
  lang: string;
  videoPath: string;
  durationSec: number;
  /** final frame size (after any resolution preset) */
  width: number;
  height: number;
  projectPath: string;
  logPath: string;
  actions: number;
  narrations: { step: string; entry: number; text: string; voice: string; durationSec: number; cached: boolean }[];
  warnings: string[];
  /** Title/end cards joined around the video (only when the script has them). */
  cards?: CardResult[];
  /** Chapters of the finished video (only when the script has chapters): seconds from its start, cards included. */
  chapters?: Chapter[];
  /** video/chapters_<lang>.txt (YouTube description lines) and .json */
  chapterFiles?: { youtube: string; json: string };
  /** Seconds spent per stage: narration (speech), cards, render (and its passes). */
  timings: ProduceTimings;
}

export interface ProduceTimings {
  narrationSec: number;
  cardsSec?: number;
  renderSec: number;
  /** The renderer's passes: skip, speed, mute, blur, inserts, music, final. */
  passes: Record<string, number>;
  totalSec: number;
}

export interface ProduceOptions {
  /** overrides script.output.resolution (CLI --resolution) */
  resolution?: ResolutionName;
  /** overrides script.output.quality (CLI --quality) */
  quality?: Quality;
  /** Also write demo-project.json, the file the desktop app opens (default true).
   *  Off while languages render in parallel; the caller writes it afterwards. */
  sessionProject?: boolean;
}

/** A rendered video this far off the modelled length lost an effect. */
const DURATION_TOLERANCE_SEC = 2;
/** Renderer log lines meaning an effect pass failed and was left out
 *  (skip/speed/insert/overlay passes, and a music file that vanished). */
const SKIPPED_PASS = /produced no output, skipping|music file not found, skipping/i;

/** What the desktop needs to link a compiled project back to its job and script. */
export interface ProjectOrigin {
  /** The script the job was recorded from (job.json scriptPath). */
  scriptPath?: string;
  /** The output settings this render used (flags over script.output). */
  resolution?: ResolutionName;
  quality?: Quality;
}

/** The desktop app's project file (src/types.ts DemoProject, projectVersion 2). */
export function buildProject(
  script: DemoScript,
  recordingPath: string,
  actions: NaraAction[],
  lang: string,
  origin: ProjectOrigin = {},
): Record<string, unknown> {
  const native = probeResolution(recordingPath);
  const languages = [...new Set([...(script.languages ?? ["en"]), lang])];
  const resolution = origin.resolution ?? script.output?.resolution ?? "native";
  const quality = origin.quality ?? script.output?.quality ?? "high";
  return {
    projectVersion: 2,
    ...(origin.scriptPath ? { origin: { kind: "job", scriptPath: origin.scriptPath, lang } } : {}),
    title: script.scope,
    baseUrl: script.baseUrl ?? "",
    recordingPath,
    recordingDuration: probeDuration(recordingPath),
    viewport: script.viewport,
    output: { width: native.width, height: native.height, fps: 30, format: "mp4", resolution, quality },
    tts: {
      provider: "kokoro",
      kokoroEndpoint: script.tts?.kokoroEndpoint ?? DEFAULT_KOKORO_ENDPOINT,
      voiceEn: scriptVoice(script, "en"),
      voiceHi: scriptVoice(script, "hi"),
      speed: script.tts?.speed ?? 1,
      // The script's voice first (the producer and the editor treat [0] as the
      // default), then the rest of the catalog so the editor's picker is full.
      voices: Object.fromEntries(
        languages.map((l) => {
          const v = scriptVoice(script, l);
          return [l, [v, ...(DEFAULT_VOICES[l] ?? []).filter((x) => x !== v)]];
        }),
      ),
      languages,
    },
    // Whole-video music, as in the script (the compiler also emits it as a music action).
    ...(script.music
      ? { music: { path: script.music.path, volume: script.music.volume ?? 0.5, duckTo: script.music.duckTo ?? 0.2 } }
      : {}),
    ...(script.intro ? { intro: script.intro } : {}),
    ...(script.outro ? { outro: script.outro } : {}),
    ...(script.plan ? { plan: script.plan } : {}),
    actions,
  };
}

/** job.json's scriptPath, when this folder is a job (it always is under produce). */
function jobScriptPath(jobDir: string): string | undefined {
  try {
    return readJob(jobDir).scriptPath;
  } catch {
    return undefined;
  }
}

export async function produceLanguage(
  jobDir: string,
  script: DemoScript,
  trace: TraceEntry[],
  lang: string,
  log: Log,
  opts: ProduceOptions = {},
): Promise<ProduceResult> {
  const p = jobPaths(jobDir);
  if (!fs.existsSync(p.recording)) {
    throw new AgentError("JOB_NOT_RECORDED", `No recording at ${p.recording}`, {
      hint: "Record first: `narascreen record <script> --out <job>` (or `narascreen make <script>`).",
    });
  }
  const startedAt = Date.now();
  const secSince = (t: number) => Math.round((Date.now() - t) / 100) / 10;
  const recordingSec = probeDuration(p.recording);
  const quality = opts.quality ?? script.output?.quality ?? "high";
  const resolution = opts.resolution ?? script.output?.resolution ?? "native";

  // Compile once without audio first: a script/trace mismatch should fail in
  // milliseconds, not after minutes of speech synthesis.
  compile(script, trace, lang, undefined, [], { durationSec: recordingSec });

  const ttsAt = Date.now();
  const clips = await synthesizeNarrations(script, lang, p.audioDir, log);
  const narrationSec = secSince(ttsAt);

  stage("compile", `Compiling effects [${lang}]`, { lang });
  const warnings: string[] = [];
  const actions = compile(script, trace, lang, clips, warnings, { durationSec: recordingSec });
  for (const w of warnings) warn(w);
  log(`${actions.length} actions (${actions.map((a) => a.type).join(", ") || "none"})`);
  const clipSec = new Map([...clips.values()].map((c) => [c.audioPath, c.durationSec]));
  const timeline = modelTimeline(actions, (a) => clipSec.get(a));
  // The producer only detects overlapping spotlights after the (slow) insert
  // pass. Fail now when the overlap is clearly beyond the model's error
  // (a few ms per insert between the two).
  const overlap = spotlightOverlaps(actions, timeline).find(
    (o) => o.firstEnd - o.nextStart > 0.1 + 0.05 * o.insertsBetween,
  );
  if (overlap) {
    const where = entryWhere(script, overlap.first);
    throw spotlightOverlap(
      `${where?.path ?? overlap.first.name} (spotlight) is on screen until ${overlap.firstEnd.toFixed(1)}s but the next spotlight ` +
        `(${entryWhere(script, overlap.next)?.path ?? overlap.next.name}) starts at ${overlap.nextStart.toFixed(1)}s [${lang}]`,
      { where, details: { overlaps: warnings.filter((w) => /SPOTLIGHT_OVERLAP/.test(w)) } },
    );
  }

  const project = buildProject(script, p.recording, actions, lang, { scriptPath: jobScriptPath(p.root), resolution, quality });
  // Drawn pointer + follow camera (cursor-trace.ts → electron/fx-motion.ts).
  Object.assign(project, motionProject(script, trace, recordingSec, warnings));
  const projectPath = path.join(p.root, `demo-project.${lang}.json`);
  const json = JSON.stringify(project, null, 2) + "\n";
  fs.writeFileSync(projectPath, json);
  // demo-project.json is what the desktop app opens (the most recently produced language).
  if (opts.sessionProject !== false) fs.writeFileSync(path.join(p.root, "demo-project.json"), json);

  // Title/end cards (only scripts that have them), at the video's final size:
  // the renderer's final pass joins them in the same encode.
  const native = probeResolution(p.recording);
  const outSize = resolution !== "native" ? RESOLUTIONS[resolution] : native;
  const cardsAt = Date.now();
  const cardSet = script.intro || script.outro
    ? await renderCards(script, lang, outSize, { audioDir: p.audioDir, tmpDir: path.join(p.root, "cards") }, crfFor(quality), log)
    : { results: [] as CardResult[] };
  const cardsSec = cardSet.results.length ? secSince(cardsAt) : undefined;

  stage("render", `Rendering video/final_${lang}.mp4 (${actions.length} actions)`, { lang, actions: actions.length, quality, resolution });
  fs.mkdirSync(p.logsDir, { recursive: true });
  const logPath = path.join(p.logsDir, `produce-${lang}.log`);
  fs.writeFileSync(logPath, "");
  const videoPath = path.join(p.videoDir, `final_${lang}.mp4`);
  fs.rmSync(videoPath, { force: true }); // never mistake a stale video for this run's
  for (const ext of ["txt", "json"]) fs.rmSync(path.join(p.videoDir, `chapters_${lang}.${ext}`), { force: true });
  let chapterOut: { chapters: Chapter[]; files?: { youtube: string; json: string } } | undefined;
  const rendererWarnings: string[] = [];
  // The renderer never throws when an ffmpeg pass fails — it logs and carries
  // on without that pass. A video missing an effect (a secret left unblurred,
  // a narration not inserted) must never be delivered, so those lines fail.
  const skippedPasses: string[] = [];
  const emit = (msg: string) => {
    fs.appendFileSync(logPath, msg + "\n");
    for (const line of msg.split("\n")) {
      const l = line.trim();
      if (!l) continue;
      if (SKIPPED_PASS.test(l)) skippedPasses.push(l);
      else if (/^warning\b/i.test(l)) rendererWarnings.push(`renderer [${lang}]: ${l.replace(/^warning:?\s*/i, "")}`);
      // Languages can render at the same time: say whose line this is.
      log(`[${lang}] ${l}`);
    }
  };

  const crf = crfFor(quality);
  const renderAt = Date.now();
  let passes: Record<string, number> = {};
  try {
    // The renderer's own `resolution` argument stays unset: it would build
    // freezes and zooms at the preset size while the clips keep the recording's.
    // `letterbox` scales in the final pass only.
    await produceTimelineVideo(p.root, emit, lang, undefined, undefined, crf, undefined, {
      projectFile: projectPath,
      letterbox: resolution !== "native" ? outSize : undefined,
      wrap: { before: cardSet.intro, after: cardSet.outro },
      onTimings: (t) => (passes = t),
      chapterLeadTitle: titleFor(script.chapters?.introTitle, lang),
      onChapters: (c) => (chapterOut = c),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    emit(`ERROR: ${message}`);
    if (/overlapping spotlights/i.test(message)) {
      throw spotlightOverlap(`Two spotlights are on screen at the same time [${lang}]: ${message.split(". Use")[0]}`, {
        details: { logPath, overlaps: warnings.filter((w) => /SPOTLIGHT_OVERLAP/.test(w)), renderer: message },
      });
    }
    throw renderFailed(`The renderer failed [${lang}]: ${message}`, logPath);
  }

  if (skippedPasses.length) {
    throw renderFailed(`The renderer skipped part of the video [${lang}]: ${skippedPasses[0].replace(/^warning:\s*/i, "")}`, logPath, {
      pass: skippedPasses[0],
      ...(skippedPasses.length > 1 ? { passes: skippedPasses } : {}),
      rejectedVideo: reject(videoPath, lang),
    });
  }
  let durationSec = fs.existsSync(videoPath) ? probeDuration(videoPath) : 0;
  if (!(durationSec > 0)) throw renderFailed(`The renderer produced no playable video at ${videoPath}`, logPath);
  // Narration must never go missing silently: if we have clips, the video has
  // to carry sound, and its length has to match the timeline.
  if (clips.size > 0 && !hasAudioStream(videoPath)) {
    throw renderFailed(`${videoPath} has no audio track although ${clips.size} narration clip(s) were generated`, logPath, {
      rejectedVideo: reject(videoPath, lang),
    });
  }
  const cardsTotal = cardSet.results.reduce((s, c) => s + c.durationSec, 0);
  const expected = timeline.finalDuration(recordingSec) + cardsTotal;
  if (Math.abs(durationSec - expected) > Math.max(DURATION_TOLERANCE_SEC, expected * 0.05)) {
    rendererWarnings.push(
      `final_${lang}.mp4 is ${durationSec.toFixed(1)}s but the timeline adds up to ~${expected.toFixed(1)}s — ` +
        `an effect may have been skipped. Check ${logPath} and the preview.`,
    );
  }

  const renderSec = secSince(renderAt);
  // Normally a no-op (the final pass letterboxed already); kept for a video
  // the final pass left at another size.
  if (resolution !== "native") {
    resizeTo(videoPath, RESOLUTIONS[resolution], crf, emit, logPath);
    durationSec = probeDuration(videoPath);
  }
  const cards = cardSet.results;
  const { width, height } = probeResolution(videoPath);
  const timings: ProduceTimings = {
    narrationSec,
    ...(cardsSec != null ? { cardsSec } : {}),
    renderSec,
    passes,
    totalSec: secSince(startedAt),
  };
  emit(`\nTimings: speech ${narrationSec}s${cardsSec != null ? `, cards ${cardsSec}s` : ""}, render ${renderSec}s (${Object.entries(passes).map(([k, v]) => `${k} ${v}s`).join(", ") || "no passes"}), total ${timings.totalSec}s`);
  for (const w of rendererWarnings) warn(w);

  return {
    lang,
    videoPath,
    durationSec,
    width,
    height,
    projectPath,
    logPath,
    actions: actions.length,
    narrations: [...clips.values()].map((c) => ({
      step: c.step,
      entry: c.entry,
      text: c.text,
      voice: c.voice,
      durationSec: Math.round(c.durationSec * 100) / 100,
      cached: c.cached,
    })),
    warnings: [...warnings, ...rendererWarnings],
    ...(cards.length ? { cards } : {}),
    ...(chapterOut?.chapters.length ? { chapters: chapterOut.chapters, ...(chapterOut.files ? { chapterFiles: chapterOut.files } : {}) } : {}),
    timings,
  };
}

function crfFor(quality: Quality): number {
  return QUALITY_CRF[quality];
}

/** Move an incomplete render away from final_<lang>.mp4 (kept for debugging)
 *  so nothing downstream mistakes it for the product. */
function reject(videoPath: string, lang: string): string | undefined {
  if (!fs.existsSync(videoPath)) return undefined;
  const to = path.join(path.dirname(videoPath), `rejected_${lang}.mp4`);
  fs.renameSync(videoPath, to);
  return to;
}

/** Scale to fit the preset and pad (letterbox) to its exact size, in place. */
function resizeTo(video: string, size: { width: number; height: number }, crf: number, emit: (m: string) => void, logPath: string) {
  const now = probeResolution(video);
  if (now.width === size.width && now.height === size.height) return;
  const { width: W, height: H } = size;
  emit(`\n[Output] Letterboxing ${now.width}x${now.height} → ${W}x${H} (CRF ${crf})...`);
  const tmp = video.replace(/\.mp4$/, ".resized.mp4");
  const args = [
    "-y", "-i", video,
    "-vf", `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1`,
    "-c:v", "libx264", "-preset", "fast", "-crf", String(crf), "-pix_fmt", "yuv420p",
  ];
  if (hasAudioStream(video)) args.push("-c:a", "copy");
  args.push(tmp);
  const r = ffmpegSync(args);
  if (r.status !== 0 || !fs.existsSync(tmp) || !(probeDuration(tmp) > 0)) {
    fs.rmSync(tmp, { force: true });
    throw renderFailed(`Could not scale ${video} to ${W}x${H} (ffmpeg exit ${r.status})`, logPath);
  }
  fs.renameSync(tmp, video);
}

/** steps[s].beat[i] of a compiled action (its name is `<step> #<entry> <fx>`). */
function entryWhere(script: DemoScript, a: NaraAction): { step: string; entry: number; path: string } | undefined {
  const m = /^(.+) #(\d+) \w+$/.exec(a.name ?? "");
  const s = m ? script.steps.findIndex((b) => b.id === m[1]) : -1;
  return m && s >= 0 ? { step: m[1], entry: Number(m[2]), path: `steps[${s}].beat[${m[2]}]` } : undefined;
}

function spotlightOverlap(message: string, init: { where?: ReturnType<typeof entryWhere>; details: Record<string, unknown> }): AgentError {
  return new AgentError("SPOTLIGHT_OVERLAP", message, {
    hint:
      "Give the first spotlight a shorter explicit duration (or drop `duration` so \"auto\" ends it before the next one), " +
      "or remove one of them.",
    where: init.where,
    details: init.details,
  });
}

function renderFailed(message: string, logPath: string, extra: Record<string, unknown> = {}): AgentError {
  let lastLines: string[] = [];
  try {
    lastLines = fs.readFileSync(logPath, "utf-8").split("\n").filter((l) => l.trim()).slice(-20);
  } catch {
    /* no log yet */
  }
  return new AgentError("RENDER_FAILED", message, {
    hint: "Run `narascreen doctor` (ffmpeg and its drawtext/ass filters must be available), then produce again. details.logPath has the full renderer log.",
    details: { logPath, ...extra, lastLines },
  });
}
