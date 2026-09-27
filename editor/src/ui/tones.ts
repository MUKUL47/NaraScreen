import { EFFECT_META, type EffectKind } from "../lib/effects-meta";

/** Colour tones for Badge / Chip: neutral chrome, status, or an effect kind ("fx-zoom"). */
export type Tone = "neutral" | "success" | "warning" | "danger" | "info" | "brand" | `fx-${EffectKind}`;

const STATUS: Record<Exclude<Tone, `fx-${string}`>, { soft: string; solid: string; text: string; outline: string }> = {
  neutral: { soft: "bg-selected text-fg-muted", solid: "bg-fg-muted text-fg-inverse", text: "text-fg-muted", outline: "border-line-control text-fg-muted" },
  success: { soft: "bg-success/15 text-success", solid: "bg-success text-fg-inverse", text: "text-success", outline: "border-success/50 text-success" },
  warning: { soft: "bg-warning/15 text-warning", solid: "bg-warning text-fg-inverse", text: "text-warning", outline: "border-warning/50 text-warning" },
  danger: { soft: "bg-danger/15 text-danger", solid: "bg-danger-solid text-white", text: "text-danger", outline: "border-danger/50 text-danger" },
  info: { soft: "bg-info/15 text-info", solid: "bg-info text-fg-inverse", text: "text-info", outline: "border-info/50 text-info" },
  brand: { soft: "bg-brand/15 text-brand", solid: "bg-brand text-fg-inverse", text: "text-brand", outline: "border-brand/50 text-brand" },
};

export function toneClasses(tone: Tone): { soft: string; solid: string; text: string; outline: string } {
  if (tone.startsWith("fx-")) {
    const m = EFFECT_META[tone.slice(3) as EffectKind];
    if (m) return { soft: `${m.cls.fill} ${m.cls.text}`, solid: m.cls.solid, text: m.cls.text, outline: `${m.cls.borderSoft} ${m.cls.text}` };
  }
  return STATUS[tone as keyof typeof STATUS] ?? STATUS.neutral;
}
