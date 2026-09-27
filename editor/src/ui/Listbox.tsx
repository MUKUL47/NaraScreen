import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import { cx } from "./cx";
import { Icon, type IconLike } from "./icon";
import { Popover } from "./Popover";
import { controlHeight, fieldBox, fieldBoxDisabled, type ControlSize } from "./styles";

export interface ListboxOption<V extends string = string> {
  value: V;
  label: string;
  description?: ReactNode;
  icon?: IconLike;
  disabled?: boolean;
  /** Right-side content, e.g. a ▶ sample IconButton (call e.stopPropagation() in its onClick). */
  trailing?: ReactNode;
  /** Extra search text. */
  keywords?: string;
}

export interface ListboxProps<V extends string = string> {
  value: V | null | undefined;
  onChange: (value: V) => void;
  options: ListboxOption<V>[];
  placeholder?: string;
  /** Filter field at the top (long lists: voices, languages). */
  searchable?: boolean;
  searchPlaceholder?: string;
  emptyText?: string;
  size?: ControlSize;
  disabled?: boolean;
  /** Popup width (default: at least the trigger width). */
  width?: number;
  /** Custom trigger content for the selected option. */
  renderValue?: (option: ListboxOption<V> | undefined) => ReactNode;
  id?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  className?: string;
}

/** Select-like picker with rich rows (description, icon, trailing action), search and full keyboard. */
export function Listbox<V extends string = string>({
  value,
  onChange,
  options,
  placeholder = "Select…",
  searchable,
  searchPlaceholder = "Search…",
  emptyText = "No matches",
  size = "sm",
  disabled,
  width,
  renderValue,
  id,
  className,
  ...aria
}: ListboxProps<V>) {
  const rid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const typeahead = useRef({ buf: "", at: 0 });

  const selected = options.find((o) => o.value === value);
  const q = query.trim().toLowerCase();
  const shown = q ? options.filter((o) => `${o.label} ${o.keywords ?? ""} ${o.value}`.toLowerCase().includes(q)) : options;

  const onOpenChange = (o: boolean) => {
    setOpen(o);
    if (o) {
      setQuery("");
      setActive(Math.max(0, options.findIndex((x) => x.value === value)));
    }
  };

  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  const move = (to: number) => {
    if (!shown.length) return;
    let i = Math.max(0, Math.min(shown.length - 1, to));
    const dir = to >= active ? 1 : -1;
    while (shown[i]?.disabled && i + dir >= 0 && i + dir < shown.length) i += dir;
    setActive(i);
  };
  const choose = (o: ListboxOption<V> | undefined) => {
    if (!o || o.disabled) return;
    onChange(o.value);
    setOpen(false);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const keys: Record<string, () => void> = {
      ArrowDown: () => move(active + 1),
      ArrowUp: () => move(active - 1),
      Home: () => move(0),
      End: () => move(shown.length - 1),
      PageDown: () => move(active + 8),
      PageUp: () => move(active - 8),
      Enter: () => choose(shown[active]),
    };
    if (keys[e.key]) {
      e.preventDefault();
      keys[e.key]();
      return;
    }
    if (e.key === " " && !searchable) {
      e.preventDefault();
      choose(shown[active]);
      return;
    }
    if (!searchable && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const now = Date.now();
      const t = typeahead.current;
      t.buf = now - t.at > 600 ? e.key.toLowerCase() : t.buf + e.key.toLowerCase();
      t.at = now;
      const i = shown.findIndex((o) => o.label.toLowerCase().startsWith(t.buf) && !o.disabled);
      if (i >= 0) setActive(i);
    }
  };

  const optId = (i: number) => `lb${rid}-${i}`;

  return (
    <Popover
      open={open}
      onOpenChange={onOpenChange}
      hasPopup="listbox"
      role="presentation"
      matchWidth
      width={width}
      className="flex flex-col p-1"
      onKeyDown={onKeyDown}
      trigger={
        <button
          id={id}
          type="button"
          disabled={disabled}
          aria-label={aria["aria-label"]}
          aria-labelledby={aria["aria-labelledby"]}
          className={cx(
            fieldBox,
            controlHeight[size],
            "w-full gap-2 pl-2 pr-1.5 text-left text-base",
            disabled && fieldBoxDisabled,
            className,
          )}
        >
          <span className={cx("flex min-w-0 flex-1 items-center gap-2 truncate", !selected && "text-fg-subtle")}>
            {renderValue ? renderValue(selected) : selected ? (
              <>
                <Icon icon={selected.icon} size={14} className="text-fg-muted" />
                <span className="truncate">{selected.label}</span>
              </>
            ) : (
              placeholder
            )}
          </span>
          <ChevronDown size={14} strokeWidth={1.75} aria-hidden className="shrink-0 text-fg-subtle" />
        </button>
      }
    >
      {searchable && (
        <div className="mb-1 flex h-control-sm shrink-0 items-center gap-1.5 border-b border-line-subtle px-2">
          <Search size={14} strokeWidth={1.75} aria-hidden className="text-fg-subtle" />
          <input
            type="text"
            role="combobox"
            aria-expanded
            aria-controls={`lb${rid}`}
            aria-activedescendant={shown[active] ? optId(active) : undefined}
            aria-autocomplete="list"
            value={query}
            placeholder={searchPlaceholder}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            className="min-w-0 flex-1 bg-transparent text-base text-fg outline-none placeholder:text-fg-subtle"
          />
        </div>
      )}
      <div
        ref={listRef}
        id={`lb${rid}`}
        role="listbox"
        tabIndex={searchable ? -1 : 0}
        aria-label={aria["aria-label"]}
        aria-activedescendant={!searchable && shown[active] ? optId(active) : undefined}
        className="max-h-72 min-h-0 overflow-y-auto outline-none"
      >
        {shown.length === 0 && <div className="px-2 py-2 text-sm text-fg-subtle">{emptyText}</div>}
        {shown.map((o, i) => {
          const isSel = o.value === value;
          return (
            <div
              key={o.value}
              id={optId(i)}
              data-i={i}
              role="option"
              aria-selected={isSel}
              aria-disabled={o.disabled || undefined}
              onPointerMove={() => !o.disabled && active !== i && setActive(i)}
              onClick={() => choose(o)}
              className={cx(
                "flex min-h-control-sm select-none items-center gap-2 rounded-sm px-2 py-1 text-sm",
                o.disabled ? "text-fg-disabled" : "text-fg",
                i === active && !o.disabled && "bg-hover",
              )}
            >
              <Icon icon={o.icon} size={14} className="text-fg-muted" />
              <span className="min-w-0 flex-1">
                <span className="block truncate">{o.label}</span>
                {o.description && <span className="block truncate text-xs text-fg-subtle">{o.description}</span>}
              </span>
              {o.trailing}
              <Check size={14} strokeWidth={2} aria-hidden className={cx("shrink-0 text-fg", !isSel && "invisible")} />
            </div>
          );
        })}
      </div>
    </Popover>
  );
}
