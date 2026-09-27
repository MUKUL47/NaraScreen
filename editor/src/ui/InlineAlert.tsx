import type { ReactNode } from "react";
import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from "lucide-react";
import { cx } from "./cx";
import { Icon, type IconLike } from "./icon";

export interface InlineAlertProps {
  tone?: "info" | "success" | "warning" | "danger";
  title?: ReactNode;
  children?: ReactNode;
  /** A Button (e.g. "Copy command", "Retry"). */
  action?: ReactNode;
  onDismiss?: () => void;
  icon?: IconLike;
  /** Announce when it appears (role="alert" for danger/warning, "status" otherwise). */
  live?: boolean;
  className?: string;
}

const STYLE = {
  info: { box: "border-info/25 bg-info/8", icon: "text-info", Default: Info },
  success: { box: "border-success/25 bg-success/8", icon: "text-success", Default: CircleCheck },
  warning: { box: "border-warning/25 bg-warning/8", icon: "text-warning", Default: TriangleAlert },
  danger: { box: "border-danger/30 bg-danger/8", icon: "text-danger", Default: CircleAlert },
} as const;

/** In-context message. Replaces banners and toasts (house rule: no toasts). */
export function InlineAlert({ tone = "info", title, children, action, onDismiss, icon, live, className }: InlineAlertProps) {
  const s = STYLE[tone];
  return (
    <div
      role={live ? (tone === "danger" || tone === "warning" ? "alert" : "status") : undefined}
      className={cx("flex items-start gap-2 rounded-lg border px-3 py-2 text-sm", s.box, className)}
    >
      <span className={cx("mt-px flex shrink-0", s.icon)}>
        <Icon icon={icon ?? s.Default} size={14} />
      </span>
      <div className="min-w-0 flex-1">
        {title && <div className="font-medium text-fg">{title}</div>}
        {children && <div className={cx("text-fg-muted", title && "mt-0.5")}>{children}</div>}
        {action && <div className="mt-2 flex flex-wrap items-center gap-2">{action}</div>}
      </div>
      {onDismiss && (
        <button
          type="button"
          aria-label="Dismiss"
          onClick={onDismiss}
          className="-mr-1 inline-flex size-5 shrink-0 items-center justify-center rounded-sm text-fg-subtle hover:bg-hover hover:text-fg"
        >
          <X size={12} strokeWidth={2} aria-hidden />
        </button>
      )}
    </div>
  );
}
