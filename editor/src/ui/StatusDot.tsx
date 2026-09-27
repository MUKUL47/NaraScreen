import { cx } from "./cx";

export type StatusTone = "success" | "warning" | "danger" | "info" | "neutral" | "brand" | "record";

export interface StatusDotProps {
  tone: StatusTone;
  /** solid ● (default), half ◐, hollow ○ — narration status uses all three. */
  shape?: "solid" | "half" | "hollow";
  size?: 6 | 8;
  pulse?: boolean;
  /** Accessible text (colour is never the only signal). Rendered as sr-only text. */
  label?: string;
  className?: string;
}

const TONE: Record<StatusTone, string> = {
  success: "text-success",
  warning: "text-warning",
  danger: "text-danger",
  info: "text-info",
  neutral: "text-fg-subtle",
  brand: "text-brand",
  record: "text-record",
};

/** Small status dot (voice engine, narration status, unsaved). */
export function StatusDot({ tone, shape = "solid", size = 8, pulse, label, className }: StatusDotProps) {
  return (
    <span className={cx("inline-flex shrink-0 items-center", TONE[tone], className)} title={label}>
      <span
        aria-hidden
        className={cx(
          "inline-block rounded-full",
          size === 6 ? "size-1.5" : "size-2",
          shape === "solid" && "bg-current",
          shape !== "solid" && "border-[1.5px] border-current",
          pulse && "animate-rec-pulse",
        )}
        style={shape === "half" ? { background: "linear-gradient(90deg, currentColor 50%, transparent 50%)" } : undefined}
      />
      {label && <span className="sr-only">{label}</span>}
    </span>
  );
}
