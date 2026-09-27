import type { KeyboardEvent } from "react";
import { Plus } from "lucide-react";
import { cx } from "./cx";
import { IconButton } from "./IconButton";
import { StatusDot } from "./StatusDot";

export type LangStatus = "ready" | "partial" | "missing";

export interface LangTabsProps {
  /** Project languages, e.g. ["en", "hi"]. */
  langs: string[];
  active: string;
  onChange: (lang: string) => void;
  /** ● ready (text + audio), ◐ partial (text, audio missing/stale), ○ missing text. */
  status?: Record<string, LangStatus>;
  /** "+" button (opens Project settings → Languages). */
  onAdd?: () => void;
  "aria-label"?: string;
  className?: string;
}

const STATUS_TEXT: Record<LangStatus, string> = { ready: "ready", partial: "audio missing or stale", missing: "text missing" };

/** Small language switcher with a status dot per language. */
export function LangTabs({ langs, active, onChange, status, onAdd, className, ...aria }: LangTabsProps) {
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const n = (i + d + langs.length) % langs.length;
    onChange(langs[n]);
    e.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[n]?.focus();
  };
  return (
    <div className={cx("inline-flex items-center gap-0.5", className)}>
      <div role="tablist" aria-label={aria["aria-label"] ?? "Language"} className="inline-flex items-center gap-0.5">
        {langs.map((l, i) => {
          const sel = l === active;
          const st = status?.[l];
          return (
            <button
              key={l}
              type="button"
              role="tab"
              aria-selected={sel}
              tabIndex={sel ? 0 : -1}
              onClick={() => onChange(l)}
              onKeyDown={(e) => onKeyDown(e, i)}
              className={cx(
                "inline-flex h-control-xs items-center gap-1.5 rounded-md px-2 text-xs font-semibold uppercase tracking-caps",
                "transition-colors duration-[120ms]",
                sel ? "bg-selected text-fg" : "text-fg-muted hover:bg-hover hover:text-fg",
              )}
            >
              {l}
              {st && (
                <StatusDot
                  size={6}
                  tone={st === "ready" ? "success" : st === "partial" ? "warning" : "neutral"}
                  shape={st === "ready" ? "solid" : st === "partial" ? "half" : "hollow"}
                  label={`${l.toUpperCase()}: ${STATUS_TEXT[st]}`}
                />
              )}
            </button>
          );
        })}
      </div>
      {onAdd && <IconButton icon={Plus} label="Add language" size={24} onClick={onAdd} />}
    </div>
  );
}
