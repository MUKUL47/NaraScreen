import type { ReactNode } from "react";
import { cx } from "./cx";
import { Icon, type IconLike } from "./icon";

export interface EmptyStateProps {
  icon?: IconLike;
  title: ReactNode;
  body?: ReactNode;
  /** One primary action (NN/g). */
  action?: ReactNode;
  secondary?: ReactNode;
  /** compact = inside panels/sections; default = centred page area. */
  size?: "compact" | "default";
  className?: string;
}

/** Empty surface with one clear next step ("Draw a region on the video · R"). */
export function EmptyState({ icon, title, body, action, secondary, size = "default", className }: EmptyStateProps) {
  const compact = size === "compact";
  return (
    <div className={cx("flex flex-col items-center text-center", compact ? "gap-1.5 px-3 py-4" : "gap-2 px-6 py-10", className)}>
      {icon && (
        <div
          className={cx(
            "mb-1 flex items-center justify-center rounded-lg border border-line bg-raised text-fg-muted",
            compact ? "size-8" : "size-10",
          )}
        >
          <Icon icon={icon} size={compact ? 16 : 20} />
        </div>
      )}
      <div className={cx("font-semibold text-fg", compact ? "text-sm" : "text-md")}>{title}</div>
      {body && <div className={cx("max-w-xs text-fg-muted", compact ? "text-xs" : "text-sm")}>{body}</div>}
      {(action || secondary) && (
        <div className="mt-2 flex items-center gap-2">
          {action}
          {secondary}
        </div>
      )}
    </div>
  );
}
