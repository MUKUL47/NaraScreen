import type { ReactNode, Ref, SelectHTMLAttributes } from "react";
import { ChevronDown } from "lucide-react";
import { cx } from "./cx";
import { controlHeight, fieldBox, fieldBoxDisabled, fieldBoxError, type ControlSize } from "./styles";

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "size" | "onChange" | "value"> {
  value: string;
  onChange: (value: string) => void;
  options?: SelectOption[];
  /** Or pass <option>/<optgroup> children. */
  children?: ReactNode;
  size?: ControlSize;
  error?: boolean;
  /** Shown as a disabled first option when value is "". */
  placeholder?: string;
  className?: string;
  ref?: Ref<HTMLSelectElement>;
}

/** Styled native <select> (Chromium renders its popup dark via color-scheme). For simple lists. */
export function Select({ value, onChange, options, children, size = "sm", error, placeholder, className, disabled, ref, ...rest }: SelectProps) {
  return (
    <div className={cx(fieldBox, controlHeight[size], "relative", error && fieldBoxError, disabled && fieldBoxDisabled, className)}>
      <select
        ref={ref}
        value={value}
        disabled={disabled}
        aria-invalid={error || undefined}
        onChange={(e) => onChange(e.target.value)}
        className={cx(
          "h-full w-full min-w-0 appearance-none truncate bg-transparent pl-2 pr-7 text-base text-fg outline-none",
          size === "xs" && "pl-1.5 text-sm",
          value === "" && placeholder && "text-fg-subtle",
        )}
        {...rest}
      >
        {placeholder && (
          <option value="" disabled>
            {placeholder}
          </option>
        )}
        {options?.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
        {children}
      </select>
      <ChevronDown size={14} strokeWidth={1.75} aria-hidden className="pointer-events-none absolute right-2 text-fg-subtle" />
    </div>
  );
}
