import { useRef, useState, type HTMLAttributes, type KeyboardEvent, type ReactElement } from "react";
import { Check, ChevronRight } from "lucide-react";
import type { Align, Side } from "./anchor";
import { cx } from "./cx";
import { Icon, type IconLike } from "./icon";
import { Kbd } from "./Kbd";
import { Popover, type PopoverAnchor } from "./Popover";

export type MenuItem =
  | {
      type?: "item";
      /** Stable key (defaults to the label). */
      id?: string;
      label: string;
      icon?: IconLike;
      /** Key spec shown at the right, e.g. "Mod+D". */
      shortcut?: string;
      description?: string;
      danger?: boolean;
      disabled?: boolean;
      /** Makes it a menuitemcheckbox with a check mark. */
      checked?: boolean;
      onSelect?: () => void;
      submenu?: MenuItem[];
    }
  | { type: "separator"; id?: string }
  | { type: "label"; label: string; id?: string };

export interface MenuProps {
  trigger?: ReactElement<HTMLAttributes<HTMLElement>>;
  anchor?: PopoverAnchor;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Items, or a function evaluated when the menu opens. */
  items: MenuItem[] | (() => MenuItem[]);
  side?: Side;
  align?: Align;
  minWidth?: number;
  "aria-label"?: string;
}

/**
 * Dropdown menu: roving focus (↑/↓, Home/End), type-ahead, Enter/Space, → / ← for submenus,
 * Esc closes, Tab leaves. Items show icon, label, shortcut; `danger` items are red.
 */
export function Menu({ trigger, anchor, open, onOpenChange, items, side = "bottom", align = "start", minWidth = 200, ...aria }: MenuProps) {
  return (
    <Popover
      trigger={trigger}
      anchor={anchor}
      open={open}
      onOpenChange={onOpenChange}
      side={side}
      align={align}
      role="presentation"
      hasPopup="menu"
      initialFocus={ITEM_SELECTOR}
      className="py-1"
    >
      {({ close }) => (
        <MenuList
          items={typeof items === "function" ? items() : items}
          onCloseAll={close}
          minWidth={minWidth}
          label={aria["aria-label"]}
        />
      )}
    </Popover>
  );
}

interface MenuListProps {
  items: MenuItem[];
  onCloseAll: () => void;
  /** Submenus: close just this level (ArrowLeft / Esc). */
  onCloseSelf?: () => void;
  minWidth: number;
  label?: string;
}

const ITEM_SELECTOR = '[role^="menuitem"]:not([aria-disabled="true"])';

function MenuList({ items, onCloseAll, onCloseSelf, minWidth, label }: MenuListProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [sub, setSub] = useState<{ index: number; focus: boolean } | null>(null);
  const typeahead = useRef({ buf: "", at: 0 });

  const itemEls = () => [...(ref.current?.querySelectorAll<HTMLElement>(ITEM_SELECTOR) ?? [])];
  const focusAt = (i: number) => {
    const els = itemEls();
    if (els.length) els[(i + els.length) % els.length].focus();
  };
  const currentIndex = () => itemEls().indexOf(document.activeElement as HTMLElement);

  const activate = (i: number) => {
    const it = items[i];
    if (!it || it.type === "separator" || it.type === "label" || it.disabled) return;
    if (it.submenu) {
      setSub({ index: i, focus: true });
      return;
    }
    onCloseAll();
    if (it.onSelect) setTimeout(it.onSelect, 0);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    const idx = Number(target.dataset.index ?? -1);
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        focusAt(currentIndex() + 1);
        return;
      case "ArrowUp":
        e.preventDefault();
        focusAt(currentIndex() - 1);
        return;
      case "Home":
        e.preventDefault();
        focusAt(0);
        return;
      case "End":
        e.preventDefault();
        focusAt(-1);
        return;
      case "ArrowRight": {
        const it = items[idx];
        if (it && it.type !== "separator" && it.type !== "label" && it.submenu && !it.disabled) {
          e.preventDefault();
          setSub({ index: idx, focus: true });
        }
        return;
      }
      case "ArrowLeft":
        if (onCloseSelf) {
          e.preventDefault();
          e.stopPropagation();
          onCloseSelf();
        }
        return;
      case "Escape":
        e.preventDefault();
        e.stopPropagation();
        if (onCloseSelf) onCloseSelf();
        else onCloseAll();
        return;
      case "Enter":
      case " ":
        e.preventDefault();
        if (idx >= 0) activate(idx);
        return;
      case "Tab":
        onCloseAll();
        return;
    }
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      const now = Date.now();
      const t = typeahead.current;
      t.buf = now - t.at > 600 ? e.key.toLowerCase() : t.buf + e.key.toLowerCase();
      t.at = now;
      const els = itemEls();
      const start = Math.max(0, currentIndex());
      for (let k = 0; k < els.length; k++) {
        const el = els[(start + (t.buf.length === 1 ? 1 : 0) + k) % els.length];
        if ((el.dataset.label ?? "").toLowerCase().startsWith(t.buf)) {
          el.focus();
          break;
        }
      }
    }
  };

  return (
    <div ref={ref} role="menu" aria-label={label} aria-orientation="vertical" style={{ minWidth }} onKeyDown={onKeyDown}>
      {items.map((it, i) => {
        const key = it.id ?? (it.type === "separator" ? `sep-${i}` : `${it.label}-${i}`);
        if (it.type === "separator") return <div key={key} role="separator" className="my-1 h-px bg-line-subtle" />;
        if (it.type === "label")
          return (
            <div key={key} role="presentation" className="label-caps px-3 pb-1 pt-2">
              {it.label}
            </div>
          );
        const hasSub = !!it.submenu?.length;
        const subOpen = sub?.index === i;
        return (
          <div key={key}>
            <div
              role={it.checked !== undefined ? "menuitemcheckbox" : "menuitem"}
              aria-checked={it.checked}
              aria-disabled={it.disabled || undefined}
              aria-haspopup={hasSub ? "menu" : undefined}
              aria-expanded={hasSub ? subOpen : undefined}
              tabIndex={-1}
              data-index={i}
              data-label={it.label}
              onClick={() => activate(i)}
              onPointerMove={(e) => {
                if (it.disabled) return;
                if (document.activeElement !== e.currentTarget) e.currentTarget.focus({ preventScroll: true });
                if (hasSub && !subOpen) setSub({ index: i, focus: false });
                else if (!hasSub && sub) setSub(null);
              }}
              className={cx(
                "mx-1 flex h-control-sm select-none items-center gap-2 rounded-sm px-2 text-sm outline-none",
                it.disabled
                  ? "text-fg-disabled"
                  : it.danger
                    ? "text-danger focus:bg-danger/12"
                    : "text-fg focus:bg-hover",
                subOpen && "bg-hover",
              )}
            >
              <span className="flex w-3.5 shrink-0 justify-center">
                {it.checked ? <Check size={14} strokeWidth={2} aria-hidden /> : <Icon icon={it.icon} size={14} className={it.danger ? "" : "text-fg-muted"} />}
              </span>
              <span className="min-w-0 flex-1 truncate">
                {it.label}
                {it.description && <span className="ml-2 text-xs text-fg-subtle">{it.description}</span>}
              </span>
              {it.shortcut && <Kbd keys={it.shortcut} className="ml-4" />}
              {hasSub && <ChevronRight size={14} strokeWidth={1.75} aria-hidden className="text-fg-subtle" />}
            </div>
            {hasSub && subOpen && (
              <Popover
                anchor={() => ref.current?.querySelector<HTMLElement>(`[data-index="${i}"]`) ?? null}
                open
                onOpenChange={(o) => !o && setSub(null)}
                side="right"
                align="start"
                offset={2}
                role="presentation"
                initialFocus={sub.focus ? ITEM_SELECTOR : "none"}
                className="py-1"
              >
                <MenuList
                  items={it.submenu!}
                  onCloseAll={onCloseAll}
                  onCloseSelf={() => setSub(null)}
                  minWidth={Math.max(160, minWidth - 40)}
                  label={it.label}
                />
              </Popover>
            )}
          </div>
        );
      })}
    </div>
  );
}
