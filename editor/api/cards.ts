// ─── cards: title card before the video, end card after it ───────────
//
// A card is a built-in HTML template (clean | bold | minimal) filled with the
// script's text, drawn by our own Chromium and captured frame by frame with its
// CSS animations paused at each frame's time — so the same card always renders
// the same frames. Its optional narration goes through the normal TTS (same
// cache, voices and engine). The card clips are rendered first; the renderer's
// final pass joins them around the video in the same encode (no extra pass).
//
// Only scripts with `intro`/`outro` get here: the rest of the pipeline is
// untouched, and cards are text (not in the recording fingerprint), so editing
// one never re-records.

import * as fs from "fs";
import * as path from "path";
import { chromium } from "playwright-core";
import { ffmpegSync } from "../electron/ffmpeg";
import { ANIM_IN_SEC, DEFAULT_CARD_SEC, FADE_OUT_SEC, VOICE_DELAY_SEC, VOICE_TAIL_SEC, cardHtml } from "./card-template";
import { AgentError } from "./errors";
import { synthesizeNarrations } from "./narration";
import type { Log } from "./output";
import { stage } from "./output";
import type { Card, DemoScript } from "./schema";

export { DEFAULT_ACCENT, cardHtml } from "./card-template";

const FPS = 30;

export interface CardResult {
  which: "intro" | "outro";
  durationSec: number;
  narration?: { text: string; voice: string; durationSec: number; cached: boolean };
}

/**
 * Render the script's cards for `lang` at the video's final `size`. Returns
 * what was made and the clip files; the renderer joins them around the video
 * (ProduceOptions.wrap). Nothing when the script has no cards.
 */
export async function renderCards(
  script: DemoScript,
  lang: string,
  size: { width: number; height: number },
  work: { audioDir: string; tmpDir: string },
  crf: number,
  log: Log,
): Promise<{ results: CardResult[]; intro?: string; outro?: string }> {
  const cards = (["intro", "outro"] as const).filter((w) => script[w]).map((w) => ({ which: w, card: script[w]! }));
  if (!cards.length) return { results: [] };
  stage("render", `Rendering ${cards.map((c) => c.which).join(" + ")} card${cards.length > 1 ? "s" : ""} [${lang}]`, { lang });

  fs.mkdirSync(work.tmpDir, { recursive: true });
  const results: CardResult[] = [];
  const clips: Record<string, string> = {};

  for (const { which, card } of cards) {
    // Narration: a one-entry script through the normal TTS path (cache, voices, retries).
    let voice: CardResult["narration"];
    let voicePath: string | undefined;
    if (card.narrate != null) {
      const mini: DemoScript = {
        ...script,
        intro: undefined,
        outro: undefined,
        steps: [{ id: which, beat: [{ fx: "narrate", narrate: card.narrate, ...(card.voice ? { voice: card.voice } : {}) }] }],
      };
      const got = [...(await synthesizeNarrations(mini, lang, work.audioDir, log)).values()][0];
      if (got) {
        voicePath = got.audioPath;
        voice = { text: got.text, voice: got.voice, durationSec: Math.round(got.durationSec * 100) / 100, cached: got.cached };
      }
    }
    const needed = voice ? VOICE_DELAY_SEC + voice.durationSec + VOICE_TAIL_SEC : 0;
    let durationSec = typeof card.duration === "number" ? card.duration : voice ? needed : DEFAULT_CARD_SEC;
    if (durationSec < needed) {
      log(`${which}: duration ${durationSec}s is shorter than its narration — using ${needed.toFixed(1)}s`);
      durationSec = needed;
    }
    durationSec = Math.round(durationSec * FPS) / FPS;

    const clip = path.join(work.tmpDir, `${which}_${lang}.mp4`);
    await renderCard(card, lang, size, durationSec, clip, voicePath, crf, path.join(work.tmpDir, `${which}_${lang}_frames`));
    clips[which] = clip;
    results.push({ which, durationSec: Math.round(durationSec * 100) / 100, ...(voice ? { narration: voice } : {}) });
    log(`${which} card ${durationSec.toFixed(1)}s (${card.template ?? "clean"})`);
  }

  return { results, intro: clips.intro, outro: clips.outro };
}

// ─── rendering one card ──────────────────────────────────────────────

async function renderCard(
  card: Card,
  lang: string,
  size: { width: number; height: number },
  durationSec: number,
  outPath: string,
  voicePath: string | undefined,
  crf: number,
  framesDir: string,
): Promise<void> {
  fs.rmSync(framesDir, { recursive: true, force: true });
  fs.mkdirSync(framesDir, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: size, deviceScaleFactor: 1 });
    await page.setContent(cardHtml(card, lang, durationSec, logoDataUri(card.logo)), { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    const total = Math.round(durationSec * FPS);
    // Frames between the intro animation and the fade-out are identical: shoot one, copy it.
    let hold: string | undefined;
    for (let f = 0; f < total; f++) {
      const t = f / FPS;
      const file = path.join(framesDir, `f${String(f).padStart(5, "0")}.png`);
      const still = t > ANIM_IN_SEC && t < durationSec - FADE_OUT_SEC;
      if (still && hold) {
        fs.copyFileSync(hold, file);
        continue;
      }
      await page.evaluate((ms) => {
        for (const a of document.getAnimations()) {
          a.pause();
          a.currentTime = ms;
        }
      }, t * 1000);
      await page.screenshot({ path: file, type: "png" });
      if (still) hold = file;
    }
  } finally {
    await browser.close().catch(() => {});
  }

  // Frames + (narration delayed, or silence) → one clip with a stereo 48 kHz track.
  const args = ["-y", "-framerate", String(FPS), "-i", path.join(framesDir, "f%05d.png")];
  if (voicePath) {
    args.push("-i", voicePath, "-filter_complex", `[1:a]adelay=${Math.round(VOICE_DELAY_SEC * 1000)}:all=1,aresample=48000,aformat=channel_layouts=stereo,apad[a]`, "-map", "0:v", "-map", "[a]");
  } else {
    args.push("-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000", "-map", "0:v", "-map", "1:a");
  }
  args.push("-t", String(durationSec), "-c:v", "libx264", "-preset", "medium", "-crf", String(crf), "-pix_fmt", "yuv420p", "-r", String(FPS), "-c:a", "aac", "-b:a", "192k", outPath);
  const res = ffmpegSync(args);
  fs.rmSync(framesDir, { recursive: true, force: true });
  if (res.status !== 0 || !fs.existsSync(outPath)) {
    throw new AgentError("RENDER_FAILED", `Could not encode the ${path.basename(outPath)} card`, {
      hint: "Run `narascreen doctor` (ffmpeg). If it repeats, report it with details.",
      details: { status: res.status },
    });
  }
}

// ─── logo ────────────────────────────────────────────────────────────

/** The card page is loaded from a string, so the logo file travels inline. */
function logoDataUri(file: string | undefined): string | undefined {
  if (!file || !fs.existsSync(file)) return undefined;
  const ext = path.extname(file).toLowerCase();
  const mime = ext === ".svg" ? "image/svg+xml" : ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
  return `data:${mime};base64,${fs.readFileSync(file).toString("base64")}`;
}
