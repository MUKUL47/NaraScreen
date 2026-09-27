import type { ReactNode } from "react";
import { cx } from "./cx";
import { Icon, type IconLike } from "./icon";
import { toneClasses, type Tone } from "./tones";

export interface BadgeProps {
  tone?: Tone;
  /** soft (default): tinted fill · solid: full colour, dark text (effect type chip) · outline. */
  variant?: "soft" | "solid" | "outline";
  /** Leading dot in the tone colour. */
  dot?: boolean;
  icon?: IconLike;
  size?: "xs" | "sm";
  title?: string;
  className?: string;
  children?: ReactNode;
}

/** Static label: counts, language codes, the inspector's effect type chip, "Mixed". */
export function Badge({ tone = "neutral", variant = "soft", dot, icon, size = "sm", title, className, children }: BadgeProps) {
  const t = toneClasses(tone);
  return (
    <span
      title={title}
      className={cx(
        "inline-flex shrink-0 select-none items-center gap-1 whitespace-nowrap font-medium",
        size === "xs" ? "h-4 rounded-xs px-1 text-2xs" : "h-5 rounded-sm px-1.5 text-xs",
        variant === "soft" ? t.soft : variant === "solid" ? t.solid : cx("border", t.outline),
        className,
      )}
    >
      {dot && <span aria-hidden className="size-1.5 rounded-full bg-current" />}
      <Icon icon={icon} size={size === "xs" ? 10 : 12} />
      {children}
    </span>
  );
}
