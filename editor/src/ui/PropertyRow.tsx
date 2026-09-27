import type { ReactNode } from "react";
import { CircleHelp } from "lucide-react";
import { cx } from "./cx";
import { Tooltip } from "./Tooltip";

export interface PropertyRowProps {
  label: ReactNode;
  /** id of the control, so clicking the label focuses it. */
  htmlFor?: string;
  /** Tooltip text on a (?) icon after the label. */
  help?: string;
  /** Label above, control full width (long text: narration, callout text). */
  stacked?: boolean;
  className?: string;
  children: ReactNode;
}

/** Inspector row: 88 px label column (text-sm fg-muted) | control. */
export function PropertyRow({ label, htmlFor, help, stacked, className, children }: PropertyRowProps) {
  const labelEl = (
    <span className={cx("flex min-w-0 items-center gap-1", !stacked && "w-label shrink-0")}>
      <label htmlFor={htmlFor} className="truncate text-sm text-fg-muted">
        {label}
      </label>
      {help && (
        <Tooltip content={help} side="top">
          <span tabIndex={0} aria-label={help} className="inline-flex shrink-0 text-fg-subtle hover:text-fg-muted">
            <CircleHelp size={12} strokeWidth={1.75} aria-hidden />
          </span>
        </Tooltip>
      )}
    </span>
  );
  if (stacked) {
    return (
      <div className={cx("flex flex-col gap-1 py-0.5", className)}>
        {labelEl}
        {children}
      </div>
    );
  }
  return (
    <div className={cx("flex min-h-control-sm items-center gap-2", className)}>
      {labelEl}
      <div className="flex min-w-0 flex-1 items-center gap-2">{children}</div>
    </div>
  );
}
