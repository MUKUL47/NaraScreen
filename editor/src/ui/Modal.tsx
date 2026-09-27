import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cx } from "./cx";
import { IconButton } from "./IconButton";
import { LayerContext, useLayerRoot } from "./layer";

export interface ModalProps {
  open: boolean;
  /** Esc, backdrop click and the × button call this; the parent sets open=false. */
  onClose: () => void;
  title?: ReactNode;
  /** Line under the title. */
  description?: ReactNode;
  /** Right-aligned action row with a top border. */
  footer?: ReactNode;
  /** Extra header content left of × (e.g. a status chip). */
  headerExtra?: ReactNode;
  /** sm 400 · md 560 (default) · lg 760 · xl 960, or a pixel width. */
  size?: "sm" | "md" | "lg" | "xl" | number;
  /** Fixed height (e.g. 560 for Project settings); default fits content up to the window. */
  height?: number;
  dismissOnBackdrop?: boolean;
  /** Body padding 20 px (default true). Set false for layouts with their own nav/columns. */
  padded?: boolean;
  bodyClassName?: string;
  "aria-label"?: string;
  children?: ReactNode;
}

const WIDTH = { sm: 400, md: 560, lg: 760, xl: 960 } as const;

/**
 * Native <dialog>.showModal(): focus trap, Esc, inert background and top layer for free.
 * Initial focus: an element with `data-autofocus`, else the first field, else the dialog.
 * Focus returns to the opener on close.
 */
export function Modal(props: ModalProps) {
  if (!props.open) return null;
  return <ModalDialog {...props} />;
}

function ModalDialog({
  onClose,
  title,
  description,
  footer,
  headerExtra,
  size = "md",
  height,
  dismissOnBackdrop = true,
  padded = true,
  bodyClassName,
  children,
  ...aria
}: ModalProps) {
  const [el, setEl] = useState<HTMLDialogElement | null>(null);
  const root = useLayerRoot();
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });
  const downOnBackdrop = useRef(false);

  useLayoutEffect(() => {
    if (!el) return;
    const opener = document.activeElement as HTMLElement | null;
    try {
      el.showModal();
    } catch {
      /* not connected */
    }
    const target =
      el.querySelector<HTMLElement>("[data-autofocus]") ??
      el.querySelector<HTMLElement>('[data-modal-body] :is(input:not([type="hidden"]):not([disabled]), textarea:not([disabled]), select:not([disabled]))');
    (target ?? el).focus({ preventScroll: true });
    const onCancel = (e: Event) => {
      e.preventDefault();
      onCloseRef.current();
    };
    el.addEventListener("cancel", onCancel);
    return () => {
      el.removeEventListener("cancel", onCancel);
      if (el.open) el.close();
      if (opener && opener.isConnected) opener.focus({ preventScroll: true });
    };
  }, [el]);

  const width = typeof size === "number" ? size : WIDTH[size];
  const rid = useId();
  const titleId = title ? `mt${rid.replace(/[^a-zA-Z0-9]/g, "")}` : undefined;

  return createPortal(
    <dialog
      ref={setEl}
      tabIndex={-1}
      aria-label={aria["aria-label"]}
      aria-labelledby={aria["aria-label"] ? undefined : titleId}
      className="ui-modal outline-none"
      style={{ width, height }}
      onPointerDown={(e) => {
        downOnBackdrop.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (dismissOnBackdrop && downOnBackdrop.current && e.target === e.currentTarget) onClose();
        downOnBackdrop.current = false;
      }}
    >
      <LayerContext.Provider value={el}>
        {(title || headerExtra) && (
          <header className="flex shrink-0 items-start gap-3 px-5 pb-2 pt-4">
            <div className="min-w-0 flex-1">
              {title && (
                <h2 id={titleId} className="truncate text-lg font-semibold text-fg">
                  {title}
                </h2>
              )}
              {description && <p className="mt-0.5 text-sm text-fg-muted">{description}</p>}
            </div>
            {headerExtra}
            <IconButton icon={X} label="Close" shortcut="Escape" onClick={onClose} className="-mr-2 -mt-0.5" />
          </header>
        )}
        <div data-modal-body className={cx("min-h-0 flex-1 overflow-y-auto", padded && "px-5 pb-5 pt-2", bodyClassName)}>
          {children}
        </div>
        {footer && (
          <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-line-subtle px-5 py-3">{footer}</footer>
        )}
      </LayerContext.Provider>
    </dialog>,
    root,
  );
}
