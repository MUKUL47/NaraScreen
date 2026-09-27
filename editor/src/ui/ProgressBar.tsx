import { useState, type ReactNode } from "react";
import { cx } from "./cx";

export interface ProgressBarProps {
  /** 0–100. undefined = indeterminate. Never goes backwards (clamps to its previous max) until resetKey changes. */
  value?: number;
  /** Change it to start a new run (lets the bar go back to 0). */
  resetKey?: string | number;
  /** Left caption, e.g. "EN · final pass". */
  label?: ReactNode;
  /** Right caption, e.g. "≈0:18 left". The percentage is prepended when showValue. */
  eta?: ReactNode;
  showValue?: boolean;
  /** aria-valuetext, e.g. "EN 62 %, final pass". */
  valueText?: string;
  tone?: "brand" | "success" | "warning" | "danger";
  size?: "xs" | "sm" | "md";
  "aria-label"?: string;
  className?: string;
}

const FILL = { brand: "bg-brand", success: "bg-success", warning: "bg-warning", danger: "bg-danger" } as const;
const H = { xs: "h-0.5", sm: "h-1", md: "h-1.5" } as const;

/** Determinate or indeterminate progress. role="progressbar". */
export function ProgressBar({ value, resetKey, label, eta, showValue = true, valueText, tone = "brand", size = "sm", className, ...aria }: ProgressBarProps) {
  const [peak, setPeak] = useState<{ key: typeof resetKey; v: number }>({ key: resetKey, v: value ?? 0 });
  let shown: number | undefined;
  if (value !== undefined) {
    const v = Math.min(100, Math.max(0, value));
    if (peak.key !== resetKey) {
      setPeak({ key: resetKey, v });
      shown = v;
    } else {
      if (v > peak.v) setPeak({ key: resetKey, v });
      shown = Math.max(v, peak.v);
    }
  }
  const pct = shown === undefined ? undefined : Math.round(shown);
  const hasCaption = label || eta || (showValue && pct !== undefined);

  return (
    <div className={cx("min-w-0", className)}>
      {hasCaption && (
        <div className="mb-1 flex items-baseline gap-2 text-xs">
          {label && <span className="min-w-0 flex-1 truncate text-fg">{label}</span>}
          <span className="timecode ml-auto shrink-0 text-fg-subtle">
            {showValue && pct !== undefined && <span className="text-fg-muted">{pct} %</span>}
            {showValue && pct !== undefined && eta ? " · " : ""}
            {eta}
          </span>
        </div>
      )}
      <div
        role="progressbar"
        aria-label={aria["aria-label"] ?? (typeof label === "string" ? label : undefined)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-valuetext={valueText}
        aria-busy={pct === undefined || undefined}
        className={cx("relative w-full overflow-hidden rounded-full bg-line", H[size])}
      >
        {pct === undefined ? (
          <div className={cx("absolute inset-y-0 left-0 w-2/5 rounded-full animate-indeterminate", FILL[tone])} />
        ) : (
          <div
            className={cx("h-full rounded-full transition-[width] duration-200 ease-standard", FILL[tone])}
            style={{ width: `${shown}%` }}
          />
        )}
      </div>
    </div>
  );
}
