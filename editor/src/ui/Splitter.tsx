import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { cx } from "./cx";
import { clamp } from "./mathExpr";
import { uiCacheGet, uiCacheSet } from "./persist";

export interface SplitterProps {
  /**
   * "vertical": a vertical bar between left/right panes (resizes a width, drag X).
   * "horizontal": a horizontal bar between top/bottom panes (resizes a height, drag Y).
   */
  orientation: "vertical" | "horizontal";
  /** Size in px of the pane this splitter controls. */
  value: number;
  /** Live size while dragging (rAF-throttled) and on keyboard steps. */
  onChange: (size: number) => void;
  /** Final size at the end of a drag / after a key step. */
  onCommit?: (size: number) => void;
  min: number;
  max: number;
  /** Enter resets to this. */
  defaultValue?: number;
  /** Keyboard step in px (default 16). */
  step?: number;
  /**
   * The controlled pane sits after the splitter (right of it / below it), so dragging
   * right/down makes it smaller: the inspector, the timeline.
   */
  reverse?: boolean;
  /** Cache key (e.g. "timelineHeight", "inspectorWidth"): restored on mount via onChange, saved on commit. */
  persistKey?: string;
  "aria-label": string;
  /** id of the pane (aria-controls). */
  controls?: string;
  className?: string;
}

/** WAI-ARIA window splitter: 1 px line, 6 px hit area, arrows ±16 px, Home/End, Enter resets. */
export function Splitter({
  orientation,
  value,
  onChange,
  onCommit,
  min,
  max,
  defaultValue,
  step = 16,
  reverse,
  persistKey,
  className,
  controls,
  ...aria
}: SplitterProps) {
  const vertical = orientation === "vertical";
  const [dragging, setDragging] = useState(false);
  const latest = useRef({ onChange, min, max });
  useEffect(() => {
    latest.current = { onChange, min, max };
  });
  const drag = useRef<{ start: number; startValue: number; v: number; raf: number } | null>(null);

  // Restore the persisted size once.
  useEffect(() => {
    if (!persistKey) return;
    let alive = true;
    void uiCacheGet(persistKey).then((v) => {
      if (!alive || typeof v !== "number" || !Number.isFinite(v)) return;
      const l = latest.current;
      l.onChange(clamp(v, l.min, l.max));
    });
    return () => {
      alive = false;
    };
  }, [persistKey]);

  const commit = (v: number) => {
    onCommit?.(v);
    if (persistKey) uiCacheSet(persistKey, Math.round(v));
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { start: vertical ? e.clientX : e.clientY, startValue: value, v: value, raf: 0 };
    setDragging(true);
    document.documentElement.style.cursor = vertical ? "col-resize" : "row-resize";
    document.documentElement.style.userSelect = "none";
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const delta = (vertical ? e.clientX : e.clientY) - d.start;
    d.v = clamp(d.startValue + (reverse ? -delta : delta), min, max);
    if (!d.raf)
      d.raf = requestAnimationFrame(() => {
        if (!drag.current) return;
        drag.current.raf = 0;
        latest.current.onChange(drag.current.v);
      });
  };
  const endDrag = () => {
    const d = drag.current;
    if (!d) return;
    if (d.raf) cancelAnimationFrame(d.raf);
    drag.current = null;
    setDragging(false);
    document.documentElement.style.cursor = "";
    document.documentElement.style.userSelect = "";
    onChange(d.v);
    if (d.v !== d.startValue) commit(d.v);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const decKey = vertical ? "ArrowLeft" : "ArrowUp";
    const incKey = vertical ? "ArrowRight" : "ArrowDown";
    let next: number | null = null;
    if (e.key === decKey || e.key === incKey) {
      const move = e.key === incKey ? step : -step;
      next = value + (reverse ? -move : move);
    } else if (e.key === "Home") next = min;
    else if (e.key === "End") next = max;
    else if (e.key === "Enter" && defaultValue !== undefined) next = defaultValue;
    if (next === null) return;
    e.preventDefault();
    const v = clamp(next, min, max);
    onChange(v);
    commit(v);
  };

  return (
    <div
      role="separator"
      tabIndex={0}
      aria-orientation={orientation}
      aria-valuenow={Math.round(value)}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-label={aria["aria-label"]}
      aria-controls={controls}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onLostPointerCapture={endDrag}
      onKeyDown={onKeyDown}
      onDoubleClick={() => {
        if (defaultValue === undefined) return;
        onChange(defaultValue);
        commit(defaultValue);
      }}
      className={cx(
        "group relative z-sticky shrink-0 touch-none select-none focus-visible:outline-offset-0",
        vertical ? "w-px cursor-col-resize" : "h-px cursor-row-resize",
        className,
      )}
    >
      {/* 6 px hit area around the 1 px line */}
      <span aria-hidden className={cx("absolute", vertical ? "inset-y-0 -left-[2.5px] w-1.5" : "inset-x-0 -top-[2.5px] h-1.5")} />
      <span
        aria-hidden
        className={cx(
          "absolute inset-0 transition-colors duration-[120ms]",
          dragging ? "bg-brand" : "bg-line group-hover:bg-line-strong",
        )}
      />
    </div>
  );
}
