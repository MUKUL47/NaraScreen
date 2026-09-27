import { cx } from "./cx";

export interface ProgressRingProps {
  /** 0–100; undefined = spinning (indeterminate). */
  value?: number;
  size?: number;
  tone?: "brand" | "success" | "danger" | "fg";
  "aria-label"?: string;
  className?: string;
}

const TONE = { brand: "text-brand", success: "text-success", danger: "text-danger", fg: "text-fg" } as const;

/** 16 px ring (export pill). */
export function ProgressRing({ value, size = 16, tone = "brand", className, ...aria }: ProgressRingProps) {
  const r = 6.25;
  const c = 2 * Math.PI * r;
  const pct = value === undefined ? undefined : Math.min(100, Math.max(0, value));
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      role="progressbar"
      aria-label={aria["aria-label"]}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct === undefined ? undefined : Math.round(pct)}
      className={cx("shrink-0 -rotate-90", TONE[tone], pct === undefined && "animate-spin", className)}
    >
      <circle cx="8" cy="8" r={r} fill="none" stroke="currentColor" strokeOpacity="0.2" strokeWidth="2" />
      <circle
        cx="8"
        cy="8"
        r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={pct === undefined ? c * 0.72 : c * (1 - pct / 100)}
        style={{ transition: "stroke-dashoffset 200ms var(--ease-standard)" }}
      />
    </svg>
  );
}
