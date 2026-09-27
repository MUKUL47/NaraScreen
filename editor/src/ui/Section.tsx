import { useId, useState, type ReactNode } from "react";
import { ChevronRight, CircleHelp } from "lucide-react";
import { cx } from "./cx";
import { setSectionOpen, useSectionOpen } from "./persist";
import { Tooltip } from "./Tooltip";

export interface SectionProps {
  title: ReactNode;
  /** Shown after the title: "Regions (1)". */
  count?: number;
  /** Right side of the header (e.g. an IconButton "+ Draw"). Not inside the toggle button. */
  action?: ReactNode;
  /** Tooltip text for a (?) icon next to the title. */
  help?: string;
  /** Extra header content, e.g. a status summary shown while collapsed. */
  summary?: ReactNode;
  defaultOpen?: boolean;
  /** Controlled open state (optional). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Remembers open/closed across sessions (cache key "uiSections"). E.g. "inspector.spotlight.look". */
  persistKey?: string;
  /** false = static header, always open. */
  collapsible?: boolean;
  className?: string;
  bodyClassName?: string;
  children: ReactNode;
}

/** Collapsible inspector/settings section: 28 px header with chevron, aria-expanded, 200 ms collapse. */
export function Section({
  title,
  count,
  action,
  help,
  summary,
  defaultOpen = true,
  open: openProp,
  onOpenChange,
  persistKey,
  collapsible = true,
  className,
  bodyClassName,
  children,
}: SectionProps) {
  const persisted = useSectionOpen(persistKey);
  const [local, setLocal] = useState(defaultOpen);
  const open = !collapsible || (openProp ?? (persistKey ? persisted ?? defaultOpen : local));
  const bodyId = `sec${useId().replace(/[^a-zA-Z0-9]/g, "")}`;

  const toggle = () => {
    const v = !open;
    if (openProp === undefined) {
      if (persistKey) setSectionOpen(persistKey, v);
      else setLocal(v);
    }
    onOpenChange?.(v);
  };

  const heading = (
    <>
      <span className="truncate">{title}</span>
      {count !== undefined && <span className="timecode font-normal text-fg-subtle">({count})</span>}
    </>
  );

  return (
    <section className={cx("border-b border-line-subtle", className)}>
      <div className="flex h-control-sm items-center gap-1 pl-1.5 pr-2">
        {collapsible ? (
          <button
            type="button"
            aria-expanded={open}
            aria-controls={bodyId}
            onClick={toggle}
            className="group flex h-full min-w-0 flex-1 select-none items-center gap-1 rounded-sm text-left text-md font-semibold text-fg focus-visible:outline-offset-[-2px]"
          >
            <ChevronRight
              size={14}
              strokeWidth={2}
              aria-hidden
              className={cx("shrink-0 text-fg-subtle transition-transform duration-200 ease-standard group-hover:text-fg-muted", open && "rotate-90")}
            />
            {heading}
          </button>
        ) : (
          <h3 className="flex min-w-0 flex-1 items-center gap-1 pl-1 text-md font-semibold text-fg">{heading}</h3>
        )}
        {help && (
          <Tooltip content={help} side="top">
            <span tabIndex={0} aria-label={help} className="inline-flex shrink-0 text-fg-subtle hover:text-fg-muted">
              <CircleHelp size={12} strokeWidth={1.75} aria-hidden />
            </span>
          </Tooltip>
        )}
        {summary && <div className="ml-auto flex shrink-0 items-center gap-1.5">{summary}</div>}
        {action && <div className={cx("flex shrink-0 items-center gap-0.5", !summary && "ml-auto")}>{action}</div>}
      </div>
      <div
        id={bodyId}
        inert={!open}
        className={cx("grid transition-[grid-template-rows] duration-200 ease-standard", open ? "grid-rows-[1fr]" : "grid-rows-[0fr]")}
      >
        <div className="min-h-0 overflow-hidden">
          <div className={cx("flex flex-col gap-1 px-3 pb-3 pt-0.5", bodyClassName)}>{children}</div>
        </div>
      </div>
    </section>
  );
}
