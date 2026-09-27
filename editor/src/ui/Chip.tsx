import type { ReactNode } from "react";
import { X } from "lucide-react";
import { cx } from "./cx";
import { Icon, type IconLike } from "./icon";
import { toneClasses, type Tone } from "./tones";

export interface ChipProps {
  children: ReactNode;
  /** Toggle chips (filters): aria-pressed + selected look. */
  selected?: boolean;
  onClick?: () => void;
  /** Adds a × button with this accessible label context. */
  onRemove?: () => void;
  icon?: IconLike;
  /** Colours the icon/dot (e.g. "fx-zoom" for an Outline filter). */
  tone?: Tone;
  count?: number;
  disabled?: boolean;
  title?: string;
  className?: string;
}

/** Interactive pill: filter chips, language chips, removable tags. */
export function Chip({ children, selected, onClick, onRemove, icon, tone, count, disabled, title, className }: ChipProps) {
  const toneText = tone ? toneClasses(tone).text : "text-fg-muted";
  const body = (
    <>
      <Icon icon={icon} size={12} className={toneText} />
      <span className="truncate">{children}</span>
      {count !== undefined && <span className="timecode text-fg-subtle">{count}</span>}
    </>
  );
  return (
    <span
      title={title}
      className={cx(
        "inline-flex h-control-xs shrink-0 items-center rounded-full border text-xs font-medium transition-colors duration-[120ms]",
        selected ? "border-line-strong bg-selected text-fg" : "border-line bg-transparent text-fg-muted",
        disabled && "pointer-events-none opacity-40",
        className,
      )}
    >
      {onClick ? (
        <button
          type="button"
          aria-pressed={selected}
          disabled={disabled}
          onClick={onClick}
          className={cx("inline-flex h-full min-w-0 items-center gap-1 rounded-full pl-2.5 hover:text-fg", onRemove ? "pr-1" : "pr-2.5")}
        >
          {body}
        </button>
      ) : (
        <span className={cx("inline-flex min-w-0 items-center gap-1 pl-2.5", onRemove ? "pr-1" : "pr-2.5")}>{body}</span>
      )}
      {onRemove && (
        <button
          type="button"
          aria-label={`Remove ${typeof children === "string" ? children : ""}`.trim()}
          disabled={disabled}
          onClick={onRemove}
          className="mr-1 inline-flex size-4 items-center justify-center rounded-full text-fg-subtle hover:bg-hover hover:text-fg"
        >
          <X size={10} strokeWidth={2.25} aria-hidden />
        </button>
      )}
    </span>
  );
}
