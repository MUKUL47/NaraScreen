import type { ButtonHTMLAttributes, Ref } from "react";
import type { Align, Side } from "./anchor";
import { cx } from "./cx";
import { Icon, type IconLike } from "./icon";
import { Spinner } from "./Spinner";
import { Tooltip } from "./Tooltip";

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  icon: IconLike;
  /** Required: the aria-label and the tooltip text. */
  label: string;
  /** Key spec shown in the tooltip, e.g. "Mod+Z". */
  shortcut?: string;
  /** Toggle state → aria-pressed + selected look. */
  pressed?: boolean;
  size?: 24 | 28 | 32;
  variant?: "ghost" | "secondary" | "danger";
  loading?: boolean;
  tooltipSide?: Side;
  tooltipAlign?: Align;
  /** Set false to skip the tooltip (e.g. when a visible label sits next to it). */
  tooltip?: boolean;
  ref?: Ref<HTMLButtonElement>;
}

const SIZE = { 24: "size-control-xs", 28: "size-control-sm", 32: "size-control-md" } as const;

const VARIANT = {
  ghost: "text-fg-muted hover:bg-hover hover:text-fg aria-expanded:bg-hover aria-expanded:text-fg",
  secondary: "bg-raised border border-line-control text-fg-muted hover:bg-hover hover:text-fg hover:border-line-strong",
  danger: "text-fg-muted hover:bg-danger/12 hover:text-danger",
} as const;

/** Square icon-only button with a tooltip (label + shortcut). */
export function IconButton({
  icon,
  label,
  shortcut,
  pressed,
  size = 28,
  variant = "ghost",
  loading,
  tooltipSide = "bottom",
  tooltipAlign = "center",
  tooltip = true,
  className,
  type = "button",
  ...rest
}: IconButtonProps) {
  const btn = (
    <button
      type={type}
      aria-label={label}
      aria-pressed={pressed}
      aria-busy={loading || undefined}
      className={cx(
        "inline-flex shrink-0 select-none items-center justify-center rounded-md",
        "transition-[background-color,border-color,color] duration-[120ms] ease-standard",
        "disabled:cursor-not-allowed disabled:opacity-40",
        SIZE[size],
        VARIANT[variant],
        pressed && "bg-selected text-fg hover:bg-selected",
        className,
      )}
      {...rest}
    >
      {loading ? <Spinner size={size === 32 ? 16 : 14} /> : <Icon icon={icon} size={size === 32 ? 16 : 14} />}
    </button>
  );
  if (!tooltip) return btn;
  return (
    <Tooltip content={label} shortcut={shortcut} side={tooltipSide} align={tooltipAlign}>
      {btn}
    </Tooltip>
  );
}
