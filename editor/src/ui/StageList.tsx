import type { ReactNode } from "react";
import { Check, Circle, Minus, TriangleAlert, X } from "lucide-react";
import { formatDuration } from "../lib/timecode";
import { cx } from "./cx";
import { Spinner } from "./Spinner";

export type StageStatus = "pending" | "running" | "done" | "error" | "skipped" | "warning";

export interface Stage {
  id: string;
  label: string;
  status: StageStatus;
  /** "narration (3 of 12)", an error line… */
  detail?: ReactNode;
  /** Seconds (formatted) or preformatted text. */
  duration?: number | string;
}

export interface StageListProps {
  stages: Stage[];
  /** list = one row per stage; inline = compact chips "✓narration ✓skip ●final". */
  variant?: "list" | "inline";
  className?: string;
  "aria-label"?: string;
}

const STATUS_TEXT: Record<StageStatus, string> = {
  pending: "pending", running: "running", done: "done", error: "failed", skipped: "skipped", warning: "done with warnings",
};

function StageIcon({ status }: { status: StageStatus }) {
  switch (status) {
    case "done":
      return <Check size={12} strokeWidth={2.25} className="text-success" aria-hidden />;
    case "running":
      return <Spinner size={12} className="text-brand" />;
    case "error":
      return <X size={12} strokeWidth={2.25} className="text-danger" aria-hidden />;
    case "warning":
      return <TriangleAlert size={12} strokeWidth={2} className="text-warning" aria-hidden />;
    case "skipped":
      return <Minus size={12} strokeWidth={2} className="text-fg-disabled" aria-hidden />;
    default:
      return <Circle size={8} strokeWidth={2} className="text-fg-disabled" aria-hidden />;
  }
}

/** Render passes / script stages with status icons. */
export function StageList({ stages, variant = "list", className, ...aria }: StageListProps) {
  if (variant === "inline") {
    return (
      <ul aria-label={aria["aria-label"]} className={cx("flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs", className)}>
        {stages.map((s) => (
          <li
            key={s.id}
            className={cx(
              "inline-flex items-center gap-0.5",
              s.status === "running" ? "text-fg" : s.status === "pending" || s.status === "skipped" ? "text-fg-subtle" : "text-fg-muted",
            )}
          >
            <StageIcon status={s.status} />
            <span>{s.label}</span>
            <span className="sr-only">, {STATUS_TEXT[s.status]}</span>
          </li>
        ))}
      </ul>
    );
  }
  return (
    <ol aria-label={aria["aria-label"]} className={cx("flex flex-col", className)}>
      {stages.map((s) => (
        <li key={s.id} className="flex min-h-control-xs items-start gap-2 py-1 text-sm">
          <span className="flex h-4 w-3.5 shrink-0 items-center justify-center">
            <StageIcon status={s.status} />
          </span>
          <span className="min-w-0 flex-1">
            <span
              className={cx(
                "block truncate leading-4",
                s.status === "running" ? "font-medium text-fg" : s.status === "error" ? "text-danger" : s.status === "pending" ? "text-fg-subtle" : "text-fg-muted",
              )}
            >
              {s.label}
              <span className="sr-only">, {STATUS_TEXT[s.status]}</span>
            </span>
            {s.detail && <span className="block text-xs text-fg-subtle">{s.detail}</span>}
          </span>
          {s.duration !== undefined && (
            <span className="timecode shrink-0 text-xs leading-4 text-fg-subtle">
              {typeof s.duration === "number" ? formatDuration(s.duration, 1) : s.duration}
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}
