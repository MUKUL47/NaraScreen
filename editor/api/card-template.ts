// ─── card-template: the title/end card page (pure) ──────────────────
//
// The HTML of an intro/outro card, with its animations. api/cards.ts renders it
// frame by frame in Chromium; the desktop app shows the same page live in an
// <iframe srcdoc> for a WYSIWYG preview. So this module must stay pure: no
// Playwright, no fs, no Node APIs (the logo arrives as a data: URI or a URL).

import type { Card } from "./schema";

/** Intro animations finish by this time; the fade-out takes the last FADE_OUT seconds. */
export const ANIM_IN_SEC = 1.2;
export const FADE_OUT_SEC = 0.5;
/** Narration starts this far into a card, and the card holds this long after it. */
export const VOICE_DELAY_SEC = 0.5;
export const VOICE_TAIL_SEC = 0.8;
export const DEFAULT_CARD_SEC = 3;
export const DEFAULT_ACCENT = "#4F46E5";

export type CardTemplateName = NonNullable<Card["template"]>;

export interface CardTheme {
  bg: string;
  fg: string;
  sub: string;
  pillBg: string;
  pillFg: string;
  line: string;
}

/** Colours of each template for an accent colour. */
export function cardTheme(template: CardTemplateName, accent: string): CardTheme {
  return {
    clean: { bg: "#F8FAFC", fg: "#0F172A", sub: "#475569", pillBg: accent, pillFg: "#FFFFFF", line: accent },
    bold: { bg: accent, fg: "#FFFFFF", sub: "rgba(255,255,255,0.85)", pillBg: "#FFFFFF", pillFg: accent, line: "rgba(255,255,255,0.9)" },
    minimal: { bg: "#0B0F19", fg: "#F8FAFC", sub: "#94A3B8", pillBg: "transparent", pillFg: "#F8FAFC", line: accent },
  }[template];
}

/** How long a card lasts: its duration, else its narration + margins, else 3 s
 *  (never shorter than its narration). Same rule api/cards.ts renders with. */
export function cardDurationSec(card: Pick<Card, "duration">, narrationSec?: number): number {
  const needed = narrationSec != null ? VOICE_DELAY_SEC + narrationSec + VOICE_TAIL_SEC : 0;
  const d = typeof card.duration === "number" ? card.duration : narrationSec != null ? needed : DEFAULT_CARD_SEC;
  return Math.max(d, needed);
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** A card text (string or per-language map) in `lang`, falling back to "en" —
 *  the same resolution narration text gets (api/narration.ts resolveNarration). */
export function cardText(v: Card["title"] | undefined, lang: string): string {
  if (v == null) return "";
  if (typeof v === "string") return v.trim() ? v : "";
  const text = v[lang] != null ? v[lang] : v["en"];
  return text?.trim() ? text : "";
}

/**
 * The card page. Sizes are in vmin so one template fits landscape and portrait
 * (phone) videos. `logoSrc` is what the <img> shows: a data: URI (the renderer
 * inlines the file) or any URL the viewer can load.
 */
export function cardHtml(card: Card, lang: string, durationSec: number, logoSrc?: string): string {
  const template = card.template ?? "clean";
  const accent = card.accent ?? DEFAULT_ACCENT;
  const title = cardText(card.title, lang);
  const subtitle = cardText(card.subtitle, lang);
  const cta = cardText(card.cta, lang);
  const logo = logoSrc;
  const out = Math.max(0, durationSec - FADE_OUT_SEC);
  const theme = cardTheme(template, accent);
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
    ${logo ? `<img class="logo" src="${esc(logo)}" alt="">` : ""}
    <h1>${esc(title)}</h1>
    <div class="line"></div>
    ${subtitle ? `<p class="sub">${esc(subtitle)}</p>` : ""}
    ${cta ? `<div class="cta">${esc(cta)}</div>` : ""}
  </div>
</body></html>`;
}
