import { cloneElement, useState, type HTMLAttributes, type KeyboardEvent, type MouseEvent, type ReactElement } from "react";
import { Menu, type MenuItem } from "./Menu";

export interface ContextMenuProps {
  /** Items, or a function evaluated at open time (e.g. depends on what was right-clicked). */
  items: MenuItem[] | (() => MenuItem[]);
  /** The element that gets the right-click (and Shift+F10 / Menu key when focused). */
  children: ReactElement<HTMLAttributes<HTMLElement>>;
  disabled?: boolean;
  /** Called before opening with the event; return false to skip. */
  onBeforeOpen?: (e: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>) => boolean | void;
  "aria-label"?: string;
}

/** Right-click menu at the pointer. Same keyboard model as Menu. */
export function ContextMenu({ items, children, disabled, onBeforeOpen, ...aria }: ContextMenuProps) {
  const [point, setPoint] = useState<{ x: number; y: number } | null>(null);
  const p = children.props;
  const child = cloneElement(children, {
    onContextMenu: (e: MouseEvent<HTMLElement>) => {
      p.onContextMenu?.(e);
      if (disabled || e.defaultPrevented) return;
      if (onBeforeOpen?.(e) === false) return;
      e.preventDefault();
      setPoint({ x: e.clientX, y: e.clientY });
    },
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
      p.onKeyDown?.(e);
      if (disabled || e.defaultPrevented) return;
      if (e.key === "ContextMenu" || (e.key === "F10" && e.shiftKey)) {
        if (onBeforeOpen?.(e) === false) return;
        e.preventDefault();
        const r = e.currentTarget.getBoundingClientRect();
        setPoint({ x: r.left + 8, y: r.bottom });
      }
    },
  } as HTMLAttributes<HTMLElement>);
  return (
    <>
      {child}
      {point && (
        <Menu
          anchor={point}
          open
          onOpenChange={(o) => !o && setPoint(null)}
          items={items}
          side="bottom"
          align="start"
          aria-label={aria["aria-label"]}
        />
      )}
    </>
  );
}
