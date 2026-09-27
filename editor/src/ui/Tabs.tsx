import type { KeyboardEvent, ReactNode } from "react";
import { cx } from "./cx";
import { Icon, type IconLike } from "./icon";

export interface TabItem<V extends string = string> {
  value: V;
  label: ReactNode;
  icon?: IconLike;
  /** Small count after the label (e.g. Issues 2). */
  count?: number;
  disabled?: boolean;
}

export interface TabsProps<V extends string = string> {
  tabs: TabItem<V>[];
  value: V;
  onChange: (value: V) => void;
  /** underline: panel tabs (2 px brand underline). pill: compact switcher. */
  variant?: "underline" | "pill";
  /** Links tabs to <TabPanel idPrefix value>: ids `${idPrefix}-tab-${v}` / `${idPrefix}-panel-${v}`. */
  idPrefix?: string;
  fullWidth?: boolean;
  "aria-label"?: string;
  className?: string;
}

/** role="tablist" with automatic activation: ←/→ (and Home/End) move and select. */
export function Tabs<V extends string = string>({ tabs, value, onChange, variant = "underline", idPrefix, fullWidth, className, ...aria }: TabsProps<V>) {
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const enabled = tabs.map((t, k) => (t.disabled ? -1 : k)).filter((k) => k >= 0);
    const pos = enabled.indexOf(i);
    let next = -1;
    if (e.key === "ArrowRight") next = enabled[(pos + 1) % enabled.length];
    else if (e.key === "ArrowLeft") next = enabled[(pos - 1 + enabled.length) % enabled.length];
    else if (e.key === "Home") next = enabled[0];
    else if (e.key === "End") next = enabled[enabled.length - 1];
    if (next < 0 || next === undefined) return;
    e.preventDefault();
    onChange(tabs[next].value);
    e.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
  };

  return (
    <div
      role="tablist"
      aria-label={aria["aria-label"]}
      className={cx(
        "flex min-w-0 items-stretch",
        variant === "underline" ? "h-control-md gap-3 border-b border-line-subtle px-3" : "h-control-sm gap-0.5",
        className,
      )}
    >
      {tabs.map((t, i) => {
        const selected = t.value === value;
        return (
          <button
            key={t.value}
            type="button"
            role="tab"
            id={idPrefix ? `${idPrefix}-tab-${t.value}` : undefined}
            aria-controls={idPrefix ? `${idPrefix}-panel-${t.value}` : undefined}
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            disabled={t.disabled}
            onClick={() => onChange(t.value)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={cx(
              "relative inline-flex min-w-0 select-none items-center justify-center gap-1.5 whitespace-nowrap text-sm font-medium",
              "transition-colors duration-[120ms] ease-standard disabled:opacity-40",
              fullWidth && "flex-1",
              variant === "underline"
                ? cx(
                    "focus-visible:outline-offset-[-2px]",
                    selected
                      ? "text-fg after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:rounded-full after:bg-brand"
                      : "text-fg-muted hover:text-fg",
                  )
                : cx("rounded-md px-2.5", selected ? "bg-selected text-fg" : "text-fg-muted hover:bg-hover hover:text-fg"),
            )}
          >
            <Icon icon={t.icon} size={14} />
            <span className="truncate">{t.label}</span>
            {t.count !== undefined && <span className="timecode text-xs text-fg-subtle">{t.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

export interface TabPanelProps {
  idPrefix: string;
  value: string;
  /** Only the active panel should render (or pass hidden). */
  hidden?: boolean;
  className?: string;
  children: ReactNode;
}

/** The panel for a tab (role="tabpanel", labelled by its tab). */
export function TabPanel({ idPrefix, value, hidden, className, children }: TabPanelProps) {
  return (
    <div role="tabpanel" id={`${idPrefix}-panel-${value}`} aria-labelledby={`${idPrefix}-tab-${value}`} hidden={hidden} className={className}>
      {children}
    </div>
  );
}
