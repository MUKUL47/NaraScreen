import type { KeyboardEvent, ReactNode } from "react";
import { cx } from "./cx";
import { Icon, type IconLike } from "./icon";
import type { ControlSize } from "./styles";

export interface SegmentedOption<V extends string | number = string> {
  value: V;
  label?: ReactNode;
  icon?: IconLike;
  /** Tooltip (title) and the accessible name for icon-only segments. */
  title?: string;
  disabled?: boolean;
}

export interface SegmentedProps<V extends string | number = string> {
  options: SegmentedOption<V>[];
  /** null/undefined = nothing active (e.g. presets when values are "Custom"). */
  value: V | null | undefined;
  onChange: (value: V) => void;
  size?: ControlSize;
  /** Stretch segments to fill the width equally. */
  fullWidth?: boolean;
  disabled?: boolean;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  className?: string;
}

const H: Record<ControlSize, string> = { xs: "h-control-xs", sm: "h-control-sm", md: "h-control-md" };

/** Mutually exclusive options (≤ 5). role="radiogroup"; arrow keys move and select. */
export function Segmented<V extends string | number = string>({
  options,
  value,
  onChange,
  size = "sm",
  fullWidth,
  disabled,
  className,
  ...aria
}: SegmentedProps<V>) {
  const activeIndex = options.findIndex((o) => o.value === value);
  const tabIndexFor = (i: number) =>
    activeIndex >= 0 ? (i === activeIndex ? 0 : -1) : i === options.findIndex((o) => !o.disabled) ? 0 : -1;

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const dir = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    let next = -1;
    if (dir !== 0) {
      for (let k = 1; k <= options.length; k++) {
        const j = (i + dir * k + options.length) % options.length;
        if (!options[j].disabled) {
          next = j;
          break;
        }
      }
    } else if (e.key === "Home") next = options.findIndex((o) => !o.disabled);
    else if (e.key === "End") next = options.length - 1 - [...options].reverse().findIndex((o) => !o.disabled);
    if (next < 0 || next >= options.length) return;
    e.preventDefault();
    onChange(options[next].value);
    const group = e.currentTarget.parentElement;
    (group?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next])?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-disabled={disabled || undefined}
      {...aria}
      className={cx(
        "inline-flex min-w-0 items-stretch gap-0.5 rounded-md border border-line-control bg-app p-0.5",
        H[size],
        fullWidth && "flex w-full",
        disabled && "pointer-events-none opacity-40",
        className,
      )}
    >
      {options.map((o, i) => {
        const checked = i === activeIndex;
        const iconOnly = !o.label && !!o.icon;
        return (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={iconOnly ? o.title : undefined}
            title={o.title}
            disabled={disabled || o.disabled}
            tabIndex={tabIndexFor(i)}
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={cx(
              "inline-flex min-w-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-sm text-sm font-medium",
              "transition-colors duration-[120ms] ease-standard focus-visible:outline-offset-0",
              iconOnly ? "aspect-square" : size === "xs" ? "px-1.5" : "px-2",
              fullWidth && "flex-1",
              checked
                ? "bg-selected text-fg shadow-[0_0_0_1px_var(--color-line-strong)]"
                : "text-fg-muted hover:bg-hover hover:text-fg",
              "disabled:cursor-not-allowed disabled:opacity-40",
            )}
          >
            <Icon icon={o.icon} size={14} />
            {o.label !== undefined && <span className="truncate">{o.label}</span>}
          </button>
        );
      })}
    </div>
  );
}
