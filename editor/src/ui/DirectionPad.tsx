import type { KeyboardEvent } from "react";
import { ArrowDown, ArrowDownLeft, ArrowDownRight, ArrowLeft, ArrowRight, ArrowUp, ArrowUpLeft, ArrowUpRight, type LucideIcon } from "lucide-react";
import { cx } from "./cx";

/** Where the arrow comes from (TimelineAction.arrowFrom). undefined = Auto. */
export type ArrowFrom = "left" | "right" | "above" | "below" | "top-left" | "top-right" | "bottom-left" | "bottom-right";

export interface DirectionPadProps {
  value: ArrowFrom | undefined;
  onChange: (value: ArrowFrom | undefined) => void;
  disabled?: boolean;
  "aria-label"?: string;
  className?: string;
}

type Cell = { from: ArrowFrom | undefined; icon: LucideIcon | null; label: string };

// Row-major 3×3. Each arrow points from its cell toward the target in the centre.
const CELLS: Cell[] = [
  { from: "top-left", icon: ArrowDownRight, label: "From top left" },
  { from: "above", icon: ArrowDown, label: "From above" },
  { from: "top-right", icon: ArrowDownLeft, label: "From top right" },
  { from: "left", icon: ArrowRight, label: "From the left" },
  { from: undefined, icon: null, label: "Auto" },
  { from: "right", icon: ArrowLeft, label: "From the right" },
  { from: "bottom-left", icon: ArrowUpRight, label: "From bottom left" },
  { from: "below", icon: ArrowUp, label: "From below" },
  { from: "bottom-right", icon: ArrowUpLeft, label: "From bottom right" },
];

/** 3×3 arrow-direction picker with Auto in the centre. Arrow keys move in 2D and select. */
export function DirectionPad({ value, onChange, disabled, className, ...aria }: DirectionPadProps) {
  const activeIndex = Math.max(0, CELLS.findIndex((c) => c.from === value));

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const r = Math.floor(i / 3);
    const c = i % 3;
    const moves: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    const m = moves[e.key];
    if (!m) return;
    e.preventDefault();
    const nr = Math.min(2, Math.max(0, r + m[0]));
    const nc = Math.min(2, Math.max(0, c + m[1]));
    const ni = nr * 3 + nc;
    onChange(CELLS[ni].from);
    e.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[ni]?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label={aria["aria-label"] ?? "Arrow direction"}
      className={cx("grid w-max grid-cols-3 gap-0.5 rounded-md border border-line-control bg-app p-0.5", disabled && "pointer-events-none opacity-40", className)}
    >
      {CELLS.map((cell, i) => {
        const checked = i === activeIndex;
        const I = cell.icon;
        return (
          <button
            key={cell.label}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={cell.label}
            title={cell.label}
            tabIndex={checked ? 0 : -1}
            disabled={disabled}
            onClick={() => onChange(cell.from)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={cx(
              "inline-flex size-7 items-center justify-center rounded-sm transition-colors duration-[120ms] focus-visible:outline-offset-0",
              checked ? "bg-selected text-fg shadow-[0_0_0_1px_var(--color-line-strong)]" : "text-fg-subtle hover:bg-hover hover:text-fg",
            )}
          >
            {I ? <I size={14} strokeWidth={1.75} aria-hidden /> : <span className="text-2xs font-semibold uppercase tracking-caps">Auto</span>}
          </button>
        );
      })}
    </div>
  );
}
