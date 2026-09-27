import { useId, type ReactNode } from "react";
import { cx } from "./cx";

export interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Visible label; the whole row toggles. Without it pass aria-label. */
  label?: ReactNode;
  /** Secondary line under the label. */
  description?: ReactNode;
  disabled?: boolean;
  id?: string;
  "aria-label"?: string;
  className?: string;
}

/** Switch for booleans that apply immediately. role="switch", 28×16 track. */
export function Toggle({ checked, onChange, label, description, disabled, id, className, ...aria }: ToggleProps) {
  const rid = useId();
  const labelId = label ? `tg${rid.replace(/[^a-zA-Z0-9]/g, "")}` : undefined;
  const sw = (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={labelId}
      aria-label={label ? undefined : aria["aria-label"]}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        "relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors duration-[120ms] ease-standard",
        checked ? "bg-brand hover:bg-brand-hover" : "bg-line-control hover:bg-fg-disabled",
        "disabled:cursor-not-allowed disabled:opacity-40",
      )}
    >
      <span
        aria-hidden
        className={cx(
          "absolute left-0.5 size-3 rounded-full bg-fg shadow-sm transition-transform duration-[120ms] ease-standard",
          checked && "translate-x-3",
        )}
      />
    </button>
  );
  if (!label) return <span className={cx("inline-flex", className)}>{sw}</span>;
  return (
    <div
      className={cx("flex min-h-control-sm items-center gap-3", disabled && "opacity-70", className)}
      onClick={(e) => {
        if (!disabled && !(e.target as HTMLElement).closest('[role="switch"]')) onChange(!checked);
      }}
    >
      <div className="min-w-0 flex-1 select-none">
        <div id={labelId} className="text-sm text-fg">
          {label}
        </div>
        {description && <div className="text-xs text-fg-subtle">{description}</div>}
      </div>
      {sw}
    </div>
  );
}
