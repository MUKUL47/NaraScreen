import { useEffect, useRef, type ReactNode } from "react";
import { Check, Minus } from "lucide-react";
import { cx } from "./cx";

export interface CheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Tri-state "some selected" look (Select all rows). */
  indeterminate?: boolean;
  label?: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  id?: string;
  "aria-label"?: string;
  className?: string;
}

/** Checkbox for lists (export include-list, multi-pick). Native input underneath. */
export function Checkbox({ checked, onChange, indeterminate, label, description, disabled, id, className, ...aria }: CheckboxProps) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = !!indeterminate;
  }, [indeterminate]);
  const on = checked || indeterminate;
  return (
    <label
      className={cx(
        "group inline-flex min-h-control-xs select-none items-start gap-2 text-sm text-fg",
        disabled ? "cursor-not-allowed opacity-40" : "cursor-default",
        className,
      )}
    >
      <input
        ref={ref}
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        aria-label={aria["aria-label"]}
        onChange={(e) => onChange(e.target.checked)}
        className="peer sr-only"
      />
      <span
        aria-hidden
        className={cx(
          "mt-1 inline-flex size-3.5 shrink-0 items-center justify-center rounded-sm border transition-colors duration-[120ms]",
          on ? "border-brand bg-brand text-fg-inverse" : "border-line-control bg-raised group-hover:border-fg-subtle",
          "peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-focus",
        )}
      >
        {indeterminate ? <Minus size={10} strokeWidth={3} /> : checked ? <Check size={10} strokeWidth={3} /> : null}
      </span>
      {(label || description) && (
        <span className="min-w-0 pt-0.5">
          {label && <span className="block leading-4">{label}</span>}
          {description && <span className="block text-xs text-fg-subtle">{description}</span>}
        </span>
      )}
    </label>
  );
}
