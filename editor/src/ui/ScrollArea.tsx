import type { HTMLAttributes, Ref } from "react";
import { cx } from "./cx";

export interface ScrollAreaProps extends HTMLAttributes<HTMLDivElement> {
  axis?: "y" | "x" | "both";
  /** Reserve the scrollbar gutter so content doesn't shift when it appears (default true for y). */
  stableGutter?: boolean;
  ref?: Ref<HTMLDivElement>;
}

/** Scroll container with thin token-coloured scrollbars (CSS only). */
export function ScrollArea({ axis = "y", stableGutter, className, style, ref, ...rest }: ScrollAreaProps) {
  const gutter = stableGutter ?? axis === "y";
  return (
    <div
      ref={ref}
      className={cx(
        "min-h-0 min-w-0",
        axis === "y" && "overflow-y-auto overflow-x-hidden",
        axis === "x" && "overflow-x-auto overflow-y-hidden",
        axis === "both" && "overflow-auto",
        className,
      )}
      style={{ scrollbarWidth: "thin", scrollbarColor: "var(--color-line-strong) transparent", scrollbarGutter: gutter ? "stable" : undefined, ...style }}
      {...rest}
    />
  );
}
