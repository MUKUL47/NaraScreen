import type { CSSProperties } from "react";

/** Where a floating element sits relative to its anchor. */
export type Side = "top" | "bottom" | "left" | "right";
export type Align = "start" | "center" | "end";

/** A valid CSS dashed-ident for `anchor-name` built from a React `useId()` value. */
export function anchorName(reactId: string, prefix = "a"): string {
  return `--${prefix}-${reactId.replace(/[^a-zA-Z0-9_-]/g, "")}`;
}

/** CSS `position-area` value for a side + alignment (Chromium 129+ naming). */
export function positionArea(side: Side, align: Align): string {
  if (align === "center") return side;
  if (side === "top" || side === "bottom") return `${side} ${align === "start" ? "span-right" : "span-left"}`;
  return `${side} ${align === "start" ? "span-bottom" : "span-top"}`;
}

/** Inline style that positions a fixed/top-layer element against the named anchor. */
export function anchoredStyle(name: string, side: Side, align: Align, offset: number): CSSProperties {
  const margin: CSSProperties =
    side === "top" ? { marginBottom: offset } :
    side === "bottom" ? { marginTop: offset } :
    side === "left" ? { marginRight: offset } : { marginLeft: offset };
  return { positionAnchor: name, positionArea: positionArea(side, align), ...margin };
}
