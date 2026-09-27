import type { ButtonHTMLAttributes, Ref } from "react";
import { cx } from "./cx";
import { Icon, type IconLike } from "./icon";
import { Kbd } from "./Kbd";
import { Spinner } from "./Spinner";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "record";
export type ButtonSize = "xs" | "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconLike;
  iconRight?: IconLike;
  /** Swaps the icon for a spinner, keeps the width, blocks clicks. */
  loading?: boolean;
  /** Key spec shown at the right, e.g. "Mod+E". */
  kbd?: string;
  /** Shown as the native title when disabled ("Disabled buttons explain why"). */
  disabledReason?: string;
  fullWidth?: boolean;
  ref?: Ref<HTMLButtonElement>;
}

const VARIANT: Record<ButtonVariant, string> = {
  primary: "bg-primary text-fg-inverse hover:bg-primary-hover",
  secondary: "bg-raised text-fg border border-line-control hover:bg-hover hover:border-line-strong",
  ghost: "bg-transparent text-fg-muted hover:bg-hover hover:text-fg aria-expanded:bg-hover aria-expanded:text-fg",
  danger: "bg-danger-solid text-white hover:brightness-110",
  record: "bg-record text-white hover:brightness-110",
};

const SIZE: Record<ButtonSize, string> = {
  xs: "h-control-xs px-2 gap-1 text-sm",
  sm: "h-control-sm px-2.5 gap-1.5 text-sm",
  md: "h-control-md px-3 gap-2 text-sm",
  lg: "h-control-lg px-4 gap-2 text-base",
};

const BUTTON_ICON_SIZE: Record<ButtonSize, number> = { xs: 14, sm: 14, md: 16, lg: 16 };

/** Text button. Primary is the inverse (white) button; colour is reserved for effects and status. */
export function Button({
  variant = "secondary",
  size = "sm",
  icon,
  iconRight,
  loading = false,
  kbd,
  disabledReason,
  fullWidth,
  className,
  children,
  disabled,
  type = "button",
  title,
  onClick,
  ...rest
}: ButtonProps) {
  const iconSize = BUTTON_ICON_SIZE[size];
  const spinnerOnly = loading && !icon;
  return (
    <button
      type={type}
      disabled={disabled}
      aria-busy={loading || undefined}
      title={disabled && disabledReason ? disabledReason : title}
      onClick={loading ? (e) => e.preventDefault() : onClick}
      className={cx(
        "relative inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap rounded-md font-medium",
        "transition-[background-color,border-color,color,filter] duration-[120ms] ease-standard",
        "disabled:cursor-not-allowed disabled:opacity-40",
        VARIANT[variant],
        SIZE[size],
        fullWidth && "w-full",
        className,
      )}
      {...rest}
    >
      {icon && (loading ? <Spinner size={iconSize === 16 ? 16 : 14} /> : <Icon icon={icon} size={iconSize} />)}
      {children !== undefined && children !== null && (
        <span className={cx("truncate", spinnerOnly && "invisible")}>{children}</span>
      )}
      {iconRight && <Icon icon={iconRight} size={iconSize} className={spinnerOnly ? "invisible" : undefined} />}
      {kbd && <Kbd keys={kbd} tone={variant === "primary" ? "inverse" : "muted"} className={spinnerOnly ? "invisible" : "ml-1"} />}
      {spinnerOnly && (
        <span className="absolute inset-0 flex items-center justify-center">
          <Spinner size={iconSize === 16 ? 16 : 14} />
        </span>
      )}
    </button>
  );
}
