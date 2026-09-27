import {
  Children, cloneElement, useEffect, useId, useLayoutEffect, useRef, useState,
  type CSSProperties, type FocusEvent, type HTMLAttributes, type KeyboardEvent, type PointerEvent,
  type ReactElement, type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { anchorName, anchoredStyle, type Align, type Side } from "./anchor";
import { useLayerRoot } from "./layer";
import { Kbd } from "./Kbd";

export interface TooltipProps {
  content: ReactNode;
  /** Key spec shown as a Kbd after the text, e.g. "Mod+K". */
  shortcut?: string;
  side?: Side;
  align?: Align;
  /** Hover delay in ms (default 500). Moving between tooltips shows the next one at once. */
  delay?: number;
  disabled?: boolean;
  /** One element that forwards DOM props (style, pointer/focus handlers, aria-describedby). */
  children: ReactElement<HTMLAttributes<HTMLElement>>;
}

// Shared warm-up: after a tooltip closes, the next one opens without delay for a moment.
const WARM_MS = 400;
let lastClosedAt = 0;
function markClosed() {
  lastClosedAt = performance.now();
}
function isWarm() {
  return performance.now() - lastClosedAt < WARM_MS;
}

type Handler<E> = ((e: E) => void) | undefined;
function chain<E>(a: Handler<E>, b: (e: E) => void) {
  return (e: E) => {
    a?.(e);
    b(e);
  };
}

/**
 * Hover (500 ms) / keyboard-focus tooltip. Native `popover="manual"` in the top layer, positioned
 * with CSS anchor positioning; flips when it would leave the window.
 */
export function Tooltip({ content, shortcut, side = "top", align = "center", delay = 500, disabled, children }: TooltipProps) {
  const rid = useId();
  const name = anchorName(rid, "tt");
  const tipId = `tip${name.slice(4)}`;
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const root = useLayerRoot();

  useEffect(() => () => clearTimeout(timer.current), []);

  const enabled = !disabled && content !== undefined && content !== null && content !== "";
  const show = (immediate: boolean) => {
    clearTimeout(timer.current);
    if (!enabled) return;
    if (immediate || isWarm()) setOpen(true);
    else timer.current = setTimeout(() => setOpen(true), delay);
  };
  const hide = () => {
    clearTimeout(timer.current);
    if (open) markClosed();
    setOpen(false);
  };

  const child = Children.only(children);
  const p = child.props;
  const style = p.style as CSSProperties | undefined;
  const existing = style?.anchorName;
  const trigger = cloneElement(child, {
    style: { ...style, anchorName: existing && existing !== "none" ? `${existing}, ${name}` : name },
    "aria-describedby": open && enabled ? tipId : p["aria-describedby"],
    onPointerEnter: chain(p.onPointerEnter, (e: PointerEvent<HTMLElement>) => {
      if (e.pointerType !== "touch") show(false);
    }),
    onPointerLeave: chain(p.onPointerLeave, hide),
    onPointerDown: chain(p.onPointerDown, hide),
    onFocus: chain(p.onFocus, (e: FocusEvent<HTMLElement>) => {
      if (e.currentTarget.matches(":focus-visible")) show(true);
    }),
    onBlur: chain(p.onBlur, hide),
    onKeyDown: chain(p.onKeyDown, (e: KeyboardEvent<HTMLElement>) => {
      if (e.key === "Escape" && open) hide();
    }),
  } as HTMLAttributes<HTMLElement>);

  return (
    <>
      {trigger}
      {open && enabled &&
        createPortal(
          <TooltipBubble id={tipId} style={anchoredStyle(name, side, align, 6)}>
            <span className="inline-flex items-center gap-2">
              <span>{content}</span>
              {shortcut && <Kbd keys={shortcut} />}
            </span>
          </TooltipBubble>,
          root,
        )}
    </>
  );
}

function TooltipBubble({ id, style, children }: { id: string; style: CSSProperties; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    try {
      if (!el.matches(":popover-open")) el.showPopover();
    } catch {
      /* not connected */
    }
    return () => {
      try {
        if (el.matches(":popover-open")) el.hidePopover();
      } catch {
        /* already gone */
      }
    };
  }, []);
  return (
    <div ref={ref} id={id} role="tooltip" popover="manual" className="ui-tooltip" style={style}>
      {children}
    </div>
  );
}
