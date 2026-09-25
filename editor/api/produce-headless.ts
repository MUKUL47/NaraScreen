// ─── produce-headless: one job + one language → final_<lang>.mp4 ─────
//
//   tts      synthesizeNarrations → audio/tts_<hash>.wav (cached by content)
//   compile  script + trace + clips → NaraScreen actions (auto durations fitted
//            to the real clip lengths)
//   render   demo-project.json → produceTimelineVideo — the SAME pipeline the
//            desktop app uses, unchanged. The audio is pre-generated, so the
//            producer only copies it (its own silent TTS fallback never runs).
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
import { hasAudioStream, probeDuration, probeResolution } from "../electron/ffmpeg";
import { DEFAULT_VOICES } from "../src/lib/voices";
import { compile, modelTimeline, spotlightOverlaps } from "./compiler";
import { AgentError } from "./errors";
import { jobPaths } from "./job";
import { scriptVoice, synthesizeNarrations } from "./narration";
import { stage, warn, type Log } from "./output";
import { DEFAULT_KOKORO_ENDPOINT, type DemoScript } from "./schema";
import type { NaraAction, TraceEntry } from "./types";

export interface ProduceResult {
  lang: string;
  videoPath: string;
  durationSec: number;
  projectPath: string;
  logPath: string;
  actions: number;
  narrations: { step: string; entry: number; text: string; voice: string; durationSec: number; cached: boolean }[];
  warnings: string[];
}

/** A rendered video this far off the modelled length lost an effect. */
const DURATION_TOLERANCE_SEC = 2;

/** The desktop app's project file (src/types.ts DemoProject). */
export function buildProject(
  script: DemoScript,
  recordingPath: string,
  actions: NaraAction[],
  lang: string,
): Record<string, unknown> {
  const native = probeResolution(recordingPath);
  const languages = [...new Set([...(script.languages ?? ["en"]), lang])];
  return {
    title: script.scope,
    baseUrl: script.baseUrl ?? "",
    recordingPath,
    recordingDuration: probeDuration(recordingPath),
    viewport: script.viewport,
    output: { width: native.width, height: native.height, fps: 30, format: "mp4" },
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
    actions,
  };
}

export async function produceLanguage(
  jobDir: string,
  script: DemoScript,
  trace: TraceEntry[],
  lang: string,
  log: Log,
): Promise<ProduceResult> {
  const p = jobPaths(jobDir);
  if (!fs.existsSync(p.recording)) {
    throw new AgentError("JOB_NOT_RECORDED", `No recording at ${p.recording}`, {
      hint: "Record first: `narascreen record <script> --out <job>` (or `narascreen make <script>`).",
    });
  }
  // Compile once without audio first: a script/trace mismatch should fail in
  // milliseconds, not after minutes of speech synthesis.
  compile(script, trace, lang);

  const clips = await synthesizeNarrations(script, lang, p.audioDir, log);

  stage("compile", `Compiling effects [${lang}]`, { lang });
  const warnings: string[] = [];
  const actions = compile(script, trace, lang, clips, warnings);
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

  const project = buildProject(script, p.recording, actions, lang);
  const projectPath = path.join(p.root, `demo-project.${lang}.json`);
  const json = JSON.stringify(project, null, 2) + "\n";
  fs.writeFileSync(projectPath, json);
  // produceTimelineVideo reads demo-project.json specifically; it is also what
  // the desktop app opens (the most recently produced language).
  fs.writeFileSync(path.join(p.root, "demo-project.json"), json);

  stage("render", `Rendering video/final_${lang}.mp4 (${actions.length} actions)`, { lang, actions: actions.length });
  fs.mkdirSync(p.logsDir, { recursive: true });
  const logPath = path.join(p.logsDir, `produce-${lang}.log`);
  fs.writeFileSync(logPath, "");
  const videoPath = path.join(p.videoDir, `final_${lang}.mp4`);
  fs.rmSync(videoPath, { force: true }); // never mistake a stale video for this run's
  const rendererWarnings: string[] = [];
  const emit = (msg: string) => {
    fs.appendFileSync(logPath, msg + "\n");
    for (const line of msg.split("\n")) {
      const l = line.trim();
      if (!l) continue;
      if (/^warning\b/i.test(l)) rendererWarnings.push(`renderer [${lang}]: ${l.replace(/^warning:?\s*/i, "")}`);
      log(l);
    }
  };

  try {
    await produceTimelineVideo(p.root, emit, lang);
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

  const durationSec = fs.existsSync(videoPath) ? probeDuration(videoPath) : 0;
  if (!(durationSec > 0)) throw renderFailed(`The renderer produced no playable video at ${videoPath}`, logPath);
  // Narration must never go missing silently: if we generated clips, the
  // video has to carry sound, and its length has to match the timeline.
  if (clips.size > 0 && !hasAudioStream(videoPath)) {
    throw renderFailed(`${videoPath} has no audio track although ${clips.size} narration clip(s) were generated`, logPath);
  }
  const expected = probeDuration(p.recording) + timeline.addedSec;
  if (Math.abs(durationSec - expected) > Math.max(DURATION_TOLERANCE_SEC, expected * 0.05)) {
    rendererWarnings.push(
      `final_${lang}.mp4 is ${durationSec.toFixed(1)}s but the timeline adds up to ~${expected.toFixed(1)}s — ` +
        `an effect may have been skipped. Check ${logPath} and the preview.`,
    );
  }
  for (const w of rendererWarnings) warn(w);

  return {
    lang,
    videoPath,
    durationSec,
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
  };
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

function renderFailed(message: string, logPath: string): AgentError {
  let lastLines: string[] = [];
  try {
    lastLines = fs.readFileSync(logPath, "utf-8").split("\n").filter((l) => l.trim()).slice(-20);
  } catch {
    /* no log yet */
  }
  return new AgentError("RENDER_FAILED", message, {
    hint: "Run `narascreen doctor` (ffmpeg and its drawtext/ass filters must be available), then produce again. details.logPath has the full renderer log.",
    details: { logPath, lastLines },
  });
}
