import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cx } from "./cx";
import { IconButton } from "./IconButton";
import { LayerContext, useLayerRoot } from "./layer";

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  side?: "left" | "right";
  /** px (default 280). */
  width?: number;
  /** Distance from the window top, e.g. 44 to sit under the top bar. */
  top?: number;
  title?: ReactNode;
  /** Close when clicking outside (default true). */
  dismissOnOutsideClick?: boolean;
  className?: string;
  "aria-label"?: string;
  children: ReactNode;
}

/**
 * Side panel that overlays the canvas (the left panel below 1440 px). Top-layer manual popover:
 * Esc and an outside click close it; menus inside it stay nested.
 */
export function Drawer(props: DrawerProps) {
  if (!props.open) return null;
  return <DrawerSurface {...props} />;
}

function DrawerSurface({ onClose, side = "left", width = 280, top = 0, title, dismissOnOutsideClick = true, className, children, ...aria }: DrawerProps) {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const root = useLayerRoot();
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useLayoutEffect(() => {
    if (!el) return;
    const opener = document.activeElement as HTMLElement | null;
    try {
      el.showPopover();
    } catch {
      /* not connected */
    }
    const onDown = (e: PointerEvent) => {
      if (!dismissOnOutsideClick) return;
      const t = e.target as Node;
      if (el.contains(t)) return;
      // Clicks inside another open layer (a dialog above) don't close the drawer.
      if ((t as Element).closest?.("dialog[open], [popover]:popover-open")) return;
      onCloseRef.current();
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      const focusInside = el.contains(document.activeElement);
      try {
        if (el.matches(":popover-open")) el.hidePopover();
      } catch {
        /* gone */
      }
      if (focusInside && opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, [el, dismissOnOutsideClick]);

  return createPortal(
    <div
      ref={setEl}
      popover="manual"
      role="dialog"
      aria-label={aria["aria-label"] ?? (typeof title === "string" ? title : undefined)}
      tabIndex={-1}
      className={cx("ui-drawer outline-none", side === "left" ? "border-r border-line" : "border-l border-line", className)}
      style={{ top, bottom: 0, width, height: `calc(100vh - ${top}px)`, left: side === "left" ? 0 : "auto", right: side === "right" ? 0 : "auto" }}
      onKeyDown={(e) => {
        if (e.key === "Escape" && !e.defaultPrevented) {
          e.preventDefault();
          onClose();
        }
      }}
    >
      <LayerContext.Provider value={el}>
        {title && (
          <div className="flex h-control-md shrink-0 items-center gap-2 border-b border-line-subtle pl-3 pr-1.5">
            <h2 className="min-w-0 flex-1 truncate text-md font-semibold">{title}</h2>
            <IconButton icon={X} label="Close" shortcut="Escape" onClick={onClose} size={24} />
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-auto">{children}</div>
      </LayerContext.Provider>
    </div>,
    root,
  );
}
