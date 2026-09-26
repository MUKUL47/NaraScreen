// ─── cards: title card before the video, end card after it ───────────
//
// A card is a built-in HTML template (clean | bold | minimal) filled with the
// script's text, drawn by our own Chromium and captured frame by frame with its
// CSS animations paused at each frame's time — so the same card always renders
// the same frames. Its optional narration goes through the normal TTS (same
// cache, voices and engine). The finished card clips are joined around the
// rendered video in one final pass.
//
// Only scripts with `intro`/`outro` get here: the rest of the pipeline is
// untouched, and cards are text (not in the recording fingerprint), so editing
// one never re-records.

import * as fs from "fs";
import * as path from "path";
import { chromium } from "@playwright/test";
import { ffmpegSync, hasAudioStream, probeDuration, probeResolution } from "../electron/ffmpeg";
import { AgentError } from "./errors";
import { synthesizeNarrations, resolveNarration } from "./narration";
import type { Log } from "./output";
import { stage } from "./output";
import type { Card, DemoScript } from "./schema";

const FPS = 30;
/** Intro animations finish by this time; the fade-out takes the last FADE_OUT seconds. */
const ANIM_IN_SEC = 1.2;
const FADE_OUT_SEC = 0.5;
/** Narration starts this far into a card, and the card holds this long after it. */
const VOICE_DELAY_SEC = 0.5;
const VOICE_TAIL_SEC = 0.8;
const DEFAULT_CARD_SEC = 3;
export const DEFAULT_ACCENT = "#4F46E5";

export interface CardResult {
  which: "intro" | "outro";
  durationSec: number;
  narration?: { text: string; voice: string; durationSec: number; cached: boolean };
}

/**
 * Render the script's cards for `lang` and join them around `videoPath` (in
 * place). Returns what was added. No-op when the script has no cards.
 */
export async function addCards(
  script: DemoScript,
  lang: string,
  videoPath: string,
  work: { audioDir: string; tmpDir: string },
  crf: number,
  log: Log,
): Promise<CardResult[]> {
  const cards = (["intro", "outro"] as const).filter((w) => script[w]).map((w) => ({ which: w, card: script[w]! }));
  if (!cards.length) return [];
  stage("render", `Rendering ${cards.map((c) => c.which).join(" + ")} card${cards.length > 1 ? "s" : ""} [${lang}]`, { lang });

  const size = probeResolution(videoPath);
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

  joinAround(videoPath, clips.intro, clips.outro, size, crf);
  return results;
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
    await page.setContent(cardHtml(card, lang, durationSec), { waitUntil: "load" });
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

/** intro + video + outro → video (in place). Every part is normalised to the video's size, 30 fps, stereo 48 kHz. */
function joinAround(videoPath: string, intro: string | undefined, outro: string | undefined, size: { width: number; height: number }, crf: number): void {
  const parts = [intro, videoPath, outro].filter((x): x is string => !!x);
  const args = ["-y"];
  const filters: string[] = [];
  let idx = 0;
  parts.forEach((file, k) => {
    args.push("-i", file);
    const v = idx++;
    filters.push(`[${v}:v]scale=${size.width}:${size.height}:force_original_aspect_ratio=decrease,pad=${size.width}:${size.height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${FPS},format=yuv420p[v${k}]`);
    if (hasAudioStream(file)) {
      filters.push(`[${v}:a]aresample=48000,aformat=channel_layouts=stereo[a${k}]`);
    } else {
      // A silent part (no narration, no music) still needs a track for concat.
      args.push("-f", "lavfi", "-t", String(probeDuration(file)), "-i", "anullsrc=channel_layout=stereo:sample_rate=48000");
      filters.push(`[${idx++}:a]anull[a${k}]`);
    }
  });
  filters.push(`${parts.map((_, k) => `[v${k}][a${k}]`).join("")}concat=n=${parts.length}:v=1:a=1[v][a]`);
  const tmp = videoPath.replace(/\.mp4$/, ".cards.mp4");
  args.push("-filter_complex", filters.join(";"), "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-preset", "medium", "-crf", String(crf), "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", tmp);
  const res = ffmpegSync(args);
  if (res.status !== 0 || !fs.existsSync(tmp)) {
    fs.rmSync(tmp, { force: true });
    throw new AgentError("RENDER_FAILED", "Could not join the title/end cards to the video", {
      hint: "Run `narascreen doctor` (ffmpeg). If it repeats, report it with details.",
      details: { status: res.status, parts },
    });
  }
  fs.renameSync(tmp, videoPath);
}

// ─── templates ───────────────────────────────────────────────────────

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function textFor(v: Card["title"] | undefined, lang: string): string {
  if (v == null) return "";
  return resolveNarration({ narrate: v }, lang)?.text ?? "";
}

function logoDataUri(file: string | undefined): string | undefined {
  if (!file || !fs.existsSync(file)) return undefined;
  const ext = path.extname(file).toLowerCase();
  const mime = ext === ".svg" ? "image/svg+xml" : ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
  return `data:${mime};base64,${fs.readFileSync(file).toString("base64")}`;
}

/** The card page. Sizes are in vmin so one template fits landscape and portrait (phone) videos. */
export function cardHtml(card: Card, lang: string, durationSec: number): string {
  const template = card.template ?? "clean";
  const accent = card.accent ?? DEFAULT_ACCENT;
  const title = textFor(card.title, lang);
  const subtitle = textFor(card.subtitle, lang);
  const cta = textFor(card.cta, lang);
  const logo = logoDataUri(card.logo);
  const out = Math.max(0, durationSec - FADE_OUT_SEC);
  const theme = {
    clean: { bg: "#F8FAFC", fg: "#0F172A", sub: "#475569", pillBg: accent, pillFg: "#FFFFFF", line: accent },
    bold: { bg: accent, fg: "#FFFFFF", sub: "rgba(255,255,255,0.85)", pillBg: "#FFFFFF", pillFg: accent, line: "rgba(255,255,255,0.9)" },
    minimal: { bg: "#0B0F19", fg: "#F8FAFC", sub: "#94A3B8", pillBg: "transparent", pillFg: "#F8FAFC", line: accent },
  }[template];
  return `<!doctype html><html lang="${esc(lang)}"><head><meta charset="utf-8"><style>
  html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; }
  body {
    background: ${theme.bg}; color: ${theme.fg};
    font-family: "Noto Sans", "Noto Sans Devanagari", "Noto Sans CJK SC", system-ui, sans-serif;
    display: flex; align-items: center; justify-content: center;
    animation: fadeOut ${FADE_OUT_SEC}s ease-in ${out}s both;
  }
  .wrap { width: 84vw; display: flex; flex-direction: column; align-items: ${template === "minimal" ? "flex-start" : "center"}; text-align: ${template === "minimal" ? "left" : "center"}; gap: 3.2vmin; }
  .logo { height: 11vmin; max-width: 50vw; object-fit: contain; animation: up 0.6s cubic-bezier(.2,.7,.2,1) 0.1s both;
          ${template === "bold" ? "background: #FFFFFF; padding: 1.8vmin 2.8vmin; border-radius: 2.4vmin;" : ""} }
  h1 { margin: 0; font-size: ${template === "bold" ? "9.5vmin" : "7.6vmin"}; font-weight: ${template === "minimal" ? 600 : 800}; line-height: 1.12; letter-spacing: -0.02em;
       animation: up 0.7s cubic-bezier(.2,.7,.2,1) 0.25s both; }
  .line { height: 0.8vmin; width: 16vmin; background: ${theme.line}; border-radius: 1vmin; transform-origin: ${template === "minimal" ? "left" : "center"};
          animation: grow 0.6s cubic-bezier(.2,.7,.2,1) 0.5s both; }
  .sub { margin: 0; font-size: 3.9vmin; color: ${theme.sub}; line-height: 1.35; max-width: 70vw; animation: up 0.7s cubic-bezier(.2,.7,.2,1) 0.45s both; }
  .cta { margin-top: 1.5vmin; font-size: 3.6vmin; font-weight: 700; padding: 1.8vmin 4.2vmin; border-radius: 99vmin;
         background: ${theme.pillBg}; color: ${theme.pillFg}; ${template === "minimal" ? `border: 0.35vmin solid ${accent};` : ""}
         animation: pop 0.55s cubic-bezier(.2,1.4,.4,1) 0.7s both; }
  ${template === "bold" ? `.stripe { position: fixed; inset: auto -10vw -18vmin -10vw; height: 34vmin; background: rgba(255,255,255,0.08); transform: skewY(-6deg); animation: slide 0.9s cubic-bezier(.2,.7,.2,1) 0s both; }` : ""}
  @keyframes up { from { opacity: 0; transform: translateY(4vmin); } to { opacity: 1; transform: none; } }
  @keyframes grow { from { transform: scaleX(0); } to { transform: scaleX(1); } }
  @keyframes pop { from { opacity: 0; transform: scale(0.85); } to { opacity: 1; transform: none; } }
  @keyframes slide { from { transform: translateY(40vmin) skewY(-6deg); } to { transform: skewY(-6deg); } }
  @keyframes fadeOut { from { opacity: 1; } to { opacity: 0; } }
</style></head><body>
  ${template === "bold" ? `<div class="stripe"></div>` : ""}
  <div class="wrap">
    ${logo ? `<img class="logo" src="${logo}" alt="">` : ""}
    <h1>${esc(title)}</h1>
    <div class="line"></div>
    ${subtitle ? `<p class="sub">${esc(subtitle)}</p>` : ""}
    ${cta ? `<div class="cta">${esc(cta)}</div>` : ""}
  </div>
</body></html>`;
}
