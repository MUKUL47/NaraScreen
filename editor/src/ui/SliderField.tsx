import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { cx } from "./cx";
import { clamp, decimalsOf, roundTo } from "./mathExpr";
import { NumberField } from "./NumberField";
import { Tooltip } from "./Tooltip";
import { useScrub } from "./useScrub";

export interface SliderFieldProps {
  label: string;
  value: number | null | undefined;
  /** Committed value (slider release, number commit, label scrub end, double-click reset). */
  onChange: (v: number) => void;
  /** Live value while dragging the slider or scrubbing the label. */
  onLiveChange?: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  shiftStep?: number;
  precision?: number;
  unit?: string;
  /** Double-clicking the label resets to this. */
  defaultValue?: number;
  /** Tick marks under the track. */
  marks?: number[];
  /** "log" needs min > 0 (zoom factors, durations). */
  scale?: "linear" | "log";
  mixed?: boolean;
  disabled?: boolean;
  /** Tooltip on the label. */
  help?: string;
  id?: string;
  className?: string;
}

const LOG_STEPS = 1000;

/**
 * Inspector row: scrubbable label (88 px column) | range slider | 56 px NumberField with unit.
 * Figma-style: drag the label to scrub (Shift ×10), double-click it to reset.
 */
export function SliderField({
  label,
  value,
  onChange,
  onLiveChange,
  min,
  max,
  step = 1,
  shiftStep,
  precision,
  unit,
  defaultValue,
  marks,
  scale = "linear",
  mixed,
  disabled,
  help,
  id,
  className,
}: SliderFieldProps) {
  const rid = useId();
  const inputId = id ?? `sf${rid.replace(/[^a-zA-Z0-9]/g, "")}`;
  const decimals = precision ?? decimalsOf(step);
  const isLog = scale === "log" && min > 0;
  const [live, setLive] = useState<number | null>(null);
  const rangeRef = useRef<HTMLInputElement>(null);
  const latest = useRef({ onChange, isLog, min, max, decimals });
  useEffect(() => {
    latest.current = { onChange, isLog, min, max, decimals };
  });

  const scrub = useScrub({ value, step, shiftStep, min, max, precision: decimals, disabled, onScrub: onLiveChange, onCommit: onChange });

  const toPos = (v: number) => (isLog ? (Math.log(v / min) / Math.log(max / min)) * LOG_STEPS : v);
  const current = live ?? scrub.liveValue ?? value ?? min;
  const pos = toPos(clamp(current, min, max));
  const posMin = isLog ? 0 : min;
  const posMax = isLog ? LOG_STEPS : max;
  const pct = posMax > posMin ? ((pos - posMin) / (posMax - posMin)) * 100 : 0;

  // Native `change` fires on release (mouse) and per key press: that is the commit.
  useEffect(() => {
    const el = rangeRef.current;
    if (!el) return;
    const onCommit = () => {
      const l = latest.current;
      const p = Number(el.value);
      const v = l.isLog ? l.min * Math.pow(l.max / l.min, p / LOG_STEPS) : p;
      setLive(null);
      l.onChange(clamp(roundTo(v, l.decimals), l.min, l.max));
    };
    el.addEventListener("change", onCommit);
    return () => el.removeEventListener("change", onCommit);
  }, []);

  const labelEl = (
    <label
      htmlFor={inputId}
      onPointerDown={scrub.onPointerDown}
      onDoubleClick={() => defaultValue !== undefined && !disabled && onChange(defaultValue)}
      title={defaultValue !== undefined ? "Drag to adjust · double-click to reset" : "Drag to adjust"}
      className={cx(
        "w-label shrink-0 cursor-ew-resize select-none truncate text-sm text-fg-muted hover:text-fg",
        scrub.scrubbing && "text-fg",
        disabled && "pointer-events-none opacity-40",
      )}
    >
      {label}
    </label>
  );

  return (
    <div className={cx("flex min-h-control-sm items-center gap-2", className)}>
      {help ? <Tooltip content={help} side="left">{labelEl}</Tooltip> : labelEl}
      <div className="relative flex min-w-0 flex-1 items-center">
        <input
          ref={rangeRef}
          type="range"
          aria-label={label}
          aria-valuetext={mixed ? "Mixed" : `${roundTo(current, decimals)}${unit ? ` ${unit}` : ""}`}
          className={cx("ui-range w-full", mixed && "opacity-50")}
          min={posMin}
          max={posMax}
          step={isLog ? 1 : step}
          value={pos}
          disabled={disabled}
          tabIndex={-1}
          style={{ "--pct": `${pct}%` } as CSSProperties}
          onChange={(e) => {
            const p = Number(e.target.value);
            const v = clamp(roundTo(isLog ? min * Math.pow(max / min, p / LOG_STEPS) : p, decimals), min, max);
            setLive(v);
            onLiveChange?.(v);
          }}
        />
        {marks && marks.length > 0 && (
          <div className="pointer-events-none absolute inset-x-1.5 top-full -mt-0.5 h-1" aria-hidden>
            {marks.map((m) => (
              <span
                key={m}
                className="absolute h-1 w-px bg-line-strong"
                style={{ left: `${((toPos(m) - posMin) / (posMax - posMin)) * 100}%` }}
              />
            ))}
          </div>
        )}
      </div>
      <NumberField
        id={inputId}
        className="w-numfield shrink-0"
        value={live ?? scrub.liveValue ?? value}
        onChange={onChange}
        onLiveChange={onLiveChange}
        min={min}
        max={max}
        step={step}
        shiftStep={shiftStep}
        precision={decimals}
        unit={unit}
        mixed={mixed}
        disabled={disabled}
        aria-label={label}
      />
    </div>
  );
}
