import { cx } from "./cx";

export interface SpinnerProps {
  /** 12 | 14 | 16 px (default 14). */
  size?: 12 | 14 | 16 | 20;
  className?: string;
  /** Accessible label; when set the spinner is announced as a status. */
  label?: string;
}

/** Looped indicator for 2–9 s waits (TTS generate, probing). Inherits the text colour. */
export function Spinner({ size = 14, className, label }: SpinnerProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      className={cx("shrink-0 animate-spin", className)}
      role={label ? "status" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeOpacity="0.25" strokeWidth="1.75" />
      <path d="M14.25 8A6.25 6.25 0 0 0 8 1.75" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  );
}
