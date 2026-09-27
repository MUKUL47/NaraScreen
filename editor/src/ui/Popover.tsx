import {
  cloneElement, useEffect, useId, useLayoutEffect, useRef, useState,
  type CSSProperties, type HTMLAttributes, type KeyboardEvent, type MouseEvent, type PointerEvent,
  type ReactElement, type ReactNode, type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { anchorName, anchoredStyle, type Align, type Side } from "./anchor";
import { cx } from "./cx";
import { LayerContext, useLayerRoot } from "./layer";

/** What a popover is positioned against when there is no `trigger`. */
export type PopoverAnchor =
  | RefObject<HTMLElement | null>
  | (() => HTMLElement | null)
  | { x: number; y: number };

export interface PopoverProps {
  /** Clickable element that toggles the popover (gets anchor-name, aria-expanded, aria-controls). */
  trigger?: ReactElement<HTMLAttributes<HTMLElement>>;
  /** Alternative to `trigger`: an element (ref or getter) or a viewport point (context menus). */
  anchor?: PopoverAnchor;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  side?: Side;
  align?: Align;
  /** Gap to the anchor in px (default 6). */
  offset?: number;
  /** At least as wide as the anchor. */
  matchWidth?: boolean;
  width?: number | string;
  /** Surface role (default "dialog"). Menu/Listbox set their own roles inside. */
  role?: string;
  "aria-label"?: string;
  /** aria-haspopup on the trigger (default "dialog"). */
  hasPopup?: "dialog" | "menu" | "listbox";
  /** Focus on open: first focusable (default), the surface itself, or leave focus alone. */
  initialFocus?: "first" | "container" | "none";
  className?: string;
  onKeyDown?: (e: KeyboardEvent<HTMLDivElement>) => void;
  children: ReactNode | ((api: { close: () => void }) => ReactNode);
}

const FOCUSABLE =
  'input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

/**
 * Floating panel: native `popover="auto"` (top layer, light dismiss, Esc) positioned with CSS
 * anchor positioning; flips when it would leave the window. Nested popovers portal into their
 * parent so the browser keeps the parent open.
 */
export function Popover({
  trigger,
  anchor,
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  side = "bottom",
  align = "start",
  offset = 6,
  matchWidth,
  width,
  role = "dialog",
  hasPopup = "dialog",
  initialFocus = "first",
  className,
  onKeyDown,
  children,
  ...aria
}: PopoverProps) {
  const rid = useId();
  const name = anchorName(rid, "pop");
  const popId = `pop${name.slice(5)}`;
  const [uncontrolled, setUncontrolled] = useState(defaultOpen);
  const open = openProp ?? uncontrolled;
  const openAtPointerDown = useRef(false);
  const root = useLayerRoot();

  const setOpen = (v: boolean) => {
    if (openProp === undefined) setUncontrolled(v);
    onOpenChange?.(v);
  };
  const close = () => setOpen(false);

  // Anchor given as ref/getter: name it while open.
  const isPoint = !!anchor && typeof anchor === "object" && "x" in anchor;
  useLayoutEffect(() => {
    if (!open || !anchor || isPoint) return;
    const el = typeof anchor === "function" ? anchor() : (anchor as RefObject<HTMLElement | null>).current;
    if (!el) return;
    const prev = el.style.getPropertyValue("anchor-name");
    el.style.setProperty("anchor-name", prev && prev !== "none" ? `${prev}, ${name}` : name);
    return () => {
      if (prev) el.style.setProperty("anchor-name", prev);
      else el.style.removeProperty("anchor-name");
    };
  }, [open, anchor, isPoint, name]);

  let triggerEl: ReactNode = null;
  if (trigger) {
    const p = trigger.props;
    const style = p.style as CSSProperties | undefined;
    const existing = style?.anchorName;
    triggerEl = cloneElement(trigger, {
      style: { ...style, anchorName: existing && existing !== "none" ? `${existing}, ${name}` : name },
      "aria-haspopup": hasPopup,
      "aria-expanded": open,
      "aria-controls": open ? popId : undefined,
      "data-popover-anchor": popId,
      onPointerDown: (e: PointerEvent<HTMLElement>) => {
        p.onPointerDown?.(e);
        openAtPointerDown.current = open;
      },
      onClick: (e: MouseEvent<HTMLElement>) => {
        p.onClick?.(e);
        if (e.defaultPrevented) return;
        // A click on the trigger of an open popover: light dismiss already closed it on pointerup.
        const wasOpen = e.detail > 0 ? openAtPointerDown.current : open;
        openAtPointerDown.current = false;
        setOpen(!wasOpen);
      },
      onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
        p.onKeyDown?.(e);
        if (!e.defaultPrevented && !open && hasPopup !== "dialog" && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
          e.preventDefault();
          setOpen(true);
        }
      },
    } as HTMLAttributes<HTMLElement>);
  }

  const returnFocusTo = (): HTMLElement | null => {
    if (trigger) return document.querySelector<HTMLElement>(`[data-popover-anchor="${popId}"]`);
    if (anchor && !isPoint) return typeof anchor === "function" ? anchor() : (anchor as RefObject<HTMLElement | null>).current;
    return null;
  };

  const surfaceStyle: CSSProperties = {
    ...anchoredStyle(name, side, align, offset),
    ...(matchWidth ? { minWidth: "anchor-size(width)" } : null),
    ...(width !== undefined ? { width } : null),
  };

  return (
    <>
      {triggerEl}
      {open &&
        createPortal(
          <>
            {isPoint && (
              <span
                aria-hidden
                style={{
                  position: "fixed",
                  left: (anchor as { x: number }).x,
                  top: (anchor as { y: number }).y,
                  width: 0,
                  height: 0,
                  anchorName: name,
                }}
              />
            )}
            <PopoverSurface
              id={popId}
              role={role}
              aria-label={aria["aria-label"]}
              className={className}
              style={surfaceStyle}
              initialFocus={initialFocus}
              onClosed={close}
              returnFocusTo={returnFocusTo}
              onKeyDown={onKeyDown}
            >
              {typeof children === "function" ? children({ close }) : children}
            </PopoverSurface>
          </>,
          root,
        )}
    </>
  );
}

interface SurfaceProps {
  id: string;
  role: string;
  "aria-label"?: string;
  className?: string;
  style: CSSProperties;
  initialFocus: "first" | "container" | "none";
  onClosed: () => void;
  returnFocusTo: () => HTMLElement | null;
  onKeyDown?: (e: KeyboardEvent<HTMLDivElement>) => void;
  children: ReactNode;
}

function PopoverSurface({ id, role, className, style, initialFocus, onClosed, returnFocusTo, onKeyDown, children, ...aria }: SurfaceProps) {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const latest = useRef({ onClosed, returnFocusTo });
  useEffect(() => {
    latest.current = { onClosed, returnFocusTo };
  });

  useLayoutEffect(() => {
    if (!el) return;
    let unmounting = false;
    let outsidePointerAt = -Infinity;
    const onToggle = (e: Event) => {
      if ((e as ToggleEvent).newState === "closed" && !unmounting) latest.current.onClosed();
    };
    const onDocPointerDown = (e: globalThis.PointerEvent) => {
      if (!el.contains(e.target as Node)) outsidePointerAt = performance.now();
    };
    el.addEventListener("toggle", onToggle);
    document.addEventListener("pointerdown", onDocPointerDown, true);
    try {
      el.showPopover();
    } catch {
      /* not connected */
    }
    if (initialFocus === "container") el.focus({ preventScroll: true });
    else if (initialFocus === "first") (el.querySelector<HTMLElement>(FOCUSABLE) ?? el).focus({ preventScroll: true });

    return () => {
      unmounting = true;
      el.removeEventListener("toggle", onToggle);
      document.removeEventListener("pointerdown", onDocPointerDown, true);
      const active = document.activeElement;
      const focusInside = !active || active === document.body || el.contains(active);
      try {
        if (el.matches(":popover-open")) el.hidePopover();
      } catch {
        /* gone */
      }
      // Esc / selection: focus goes back to the trigger. A click elsewhere keeps its own focus.
      if (focusInside && performance.now() - outsidePointerAt > 400) latest.current.returnFocusTo()?.focus({ preventScroll: true });
    };
    // initialFocus is read once per open on purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [el]);

  return (
    <div
      ref={setEl}
      id={id}
      role={role}
      aria-label={aria["aria-label"]}
      popover="auto"
      tabIndex={-1}
      className={cx("ui-popover outline-none", className)}
      style={style}
      onKeyDown={onKeyDown}
    >
      <LayerContext.Provider value={el}>{children}</LayerContext.Provider>
    </div>
  );
}
