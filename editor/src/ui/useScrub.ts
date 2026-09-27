import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { clamp, decimalsOf, roundTo } from "./mathExpr";

export interface ScrubOptions {
  value: number | null | undefined;
  /** Value change per `pixelsPerStep` of horizontal drag (default 1). Shift = shiftStep, Alt = step / 10. */
  step?: number;
  shiftStep?: number;
  min?: number;
  max?: number;
  precision?: number;
  /** Drag distance per step in px (default 3). */
  pixelsPerStep?: number;
  disabled?: boolean;
  /** Live value while dragging (rAF-throttled). */
  onScrub?: (v: number) => void;
  /** Final value on release (only when it changed). Esc during a drag reverts and skips this. */
  onCommit: (v: number) => void;
}

export interface ScrubHandle {
  scrubbing: boolean;
  /** The in-flight value while dragging, else null. */
  liveValue: number | null;
  /** Spread on the drag handle (a label or prefix). */
  onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
}

/**
 * Figma-style scrubbing: drag a label horizontally to change a number. Uses the Pointer Lock API
 * after a 3 px threshold so the drag never hits the screen edge; falls back to pointer capture.
 * A plain click (no drag) still reaches the element (a <label> then focuses its input).
 */
export function useScrub(opts: ScrubOptions): ScrubHandle {
  const optsRef = useRef(opts);
  useEffect(() => {
    optsRef.current = opts;
  });
  const [live, setLive] = useState<number | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanupRef.current?.(), []);

  const onPointerDown = (e: ReactPointerEvent<HTMLElement>) => {
    const o = optsRef.current;
    if (o.disabled || e.button !== 0 || e.pointerType === "touch") return;
    e.preventDefault(); // no text selection while dragging; a click still fires
    const el = e.currentTarget;
    const pointerId = e.pointerId;
    const startX = e.clientX;
    let lastX = e.clientX;
    let started = false;
    let locked = false;
    let acc = 0;
    const start = o.value ?? clamp(0, o.min, o.max);
    let v = start;
    let raf = 0;

    const flush = () => {
      raf = 0;
      setLive(v);
      optsRef.current.onScrub?.(v);
    };
    const onMove = (ev: PointerEvent) => {
      // Locked: movementX (clientX is frozen). Synthetic/remote input may report movementX 0 while
      // clientX moves, so fall back to the clientX delta.
      const dx = locked ? ev.movementX || ev.clientX - lastX : ev.clientX - lastX;
      lastX = ev.clientX;
      if (!started) {
        if (Math.abs(ev.clientX - startX) < 3) return;
        started = true;
        try {
          el.setPointerCapture(pointerId);
        } catch {
          /* pointer already gone */
        }
        try {
          const r = el.requestPointerLock() as unknown;
          if (r instanceof Promise) r.catch(() => undefined);
        } catch {
          /* no pointer lock: capture fallback */
        }
      }
      const cur = optsRef.current;
      const step = cur.step ?? 1;
      const stepNow = ev.shiftKey ? cur.shiftStep ?? step * 10 : ev.altKey ? step / 10 : step;
      const px = cur.pixelsPerStep ?? 3;
      acc += dx;
      const n = Math.trunc(acc / px);
      if (n === 0) return;
      acc -= n * px;
      const decimals = Math.max(cur.precision ?? 0, decimalsOf(stepNow));
      v = clamp(roundTo(v + n * stepNow, decimals), cur.min, cur.max);
      if (!raf) raf = requestAnimationFrame(flush);
    };
    const onLockChange = () => {
      locked = document.pointerLockElement === el;
    };
    const cleanup = () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onUp);
      document.removeEventListener("pointerlockchange", onLockChange);
      window.removeEventListener("keydown", onKey, true);
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      if (document.pointerLockElement === el) document.exitPointerLock();
      cleanupRef.current = null;
    };
    const finish = (commit: boolean) => {
      cleanup();
      if (started) {
        // The click that ends a drag must not focus/activate anything.
        const suppress = (ce: MouseEvent) => {
          ce.stopPropagation();
          ce.preventDefault();
        };
        window.addEventListener("click", suppress, { capture: true, once: true });
        setTimeout(() => window.removeEventListener("click", suppress, true), 0);
        if (commit && v !== start) optsRef.current.onCommit(v);
      }
      setLive(null);
    };
    function onUp() {
      finish(true);
    }
    function onKey(ev: KeyboardEvent) {
      if (ev.key !== "Escape") return;
      ev.preventDefault();
      ev.stopPropagation();
      v = start;
      optsRef.current.onScrub?.(start);
      finish(false);
    }

    cleanupRef.current?.();
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onUp);
    document.addEventListener("pointerlockchange", onLockChange);
    window.addEventListener("keydown", onKey, true);
    cleanupRef.current = cleanup;
  };

  return { scrubbing: live !== null, liveValue: live, onPointerDown };
}
