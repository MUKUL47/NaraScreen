import { useState, type FocusEvent, type KeyboardEvent, type ReactNode, type Ref } from "react";
import { cx } from "./cx";
import { clamp, decimalsOf, evalMath, formatNumber, roundTo } from "./mathExpr";
import { controlHeight, fieldBox, fieldBoxDisabled, fieldBoxError, fieldInput, fieldMessage, type ControlSize } from "./styles";
import { useScrub } from "./useScrub";

export interface NumberFieldProps {
  /** Current value; null/undefined shows empty (or "Mixed" with `mixed`). */
  value: number | null | undefined;
  /** Committed value: Enter, blur, ↑/↓, end of a scrub. Clamped to min/max and rounded to precision. */
  onChange: (v: number) => void;
  /** Live value while scrubbing (optional; commit still goes through onChange). */
  onLiveChange?: (v: number) => void;
  min?: number;
  max?: number;
  /** ↑/↓ and scrub step (default 1). Shift = shiftStep (default step × 10), Alt = step / 10. */
  step?: number;
  shiftStep?: number;
  /** Decimals shown/kept (default: from step). */
  precision?: number;
  /** Suffix inside the field: "%", "px", "s", "×". */
  unit?: string;
  /** Draggable prefix inside the field (Figma-style "X", or an icon). */
  scrubLabel?: ReactNode;
  /** Multi-selection with differing values: empty with a "Mixed" placeholder. */
  mixed?: boolean;
  placeholder?: string;
  disabled?: boolean;
  /** true = danger border; a string also shows the message below. */
  error?: boolean | string;
  size?: ControlSize;
  id?: string;
  name?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
  className?: string;
  autoFocus?: boolean;
  onFocus?: (e: FocusEvent<HTMLInputElement>) => void;
  onBlur?: (e: FocusEvent<HTMLInputElement>) => void;
  ref?: Ref<HTMLInputElement>;
}

const PAD_L: Record<ControlSize, string> = { xs: "pl-1.5", sm: "pl-2", md: "pl-2.5" };
const PAD_R: Record<ControlSize, string> = { xs: "pr-1.5", sm: "pr-2", md: "pr-2.5" };

/**
 * Number input with local text state (typing "0", "0.", "0.5" never snaps: fixes audit D23).
 * Accepts simple math (`2*1.5`, `(10+2)/4`), ↑/↓ steps, Enter commits, Esc reverts (a second Esc
 * leaves the field), and scrubbing by dragging `scrubLabel`.
 */
export function NumberField({
  value,
  onChange,
  onLiveChange,
  min,
  max,
  step = 1,
  shiftStep,
  precision,
  unit,
  scrubLabel,
  mixed = false,
  placeholder,
  disabled,
  error,
  size = "sm",
  id,
  name,
  className,
  autoFocus,
  onFocus,
  onBlur,
  ref,
  ...aria
}: NumberFieldProps) {
  const decimals = precision ?? decimalsOf(step);
  const [draft, setDraft] = useState<string | null>(null);
  const scrub = useScrub({
    value,
    step,
    shiftStep,
    min,
    max,
    precision: decimals,
    disabled,
    onScrub: onLiveChange,
    onCommit: onChange,
  });

  const shown = scrub.liveValue ?? value;
  const formatted = mixed && scrub.liveValue === null ? "" : shown == null ? "" : formatNumber(shown, decimals);
  const text = draft ?? formatted;

  const normalize = (n: number) => clamp(roundTo(n, decimals), min, max);

  /** Commits a text; returns the new formatted text (or the reverted one). */
  const commit = (raw: string): string => {
    if (raw.trim() === "" || raw === formatted) return formatted;
    const n = evalMath(raw);
    if (n === null) return formatted;
    const v = normalize(n);
    if (v !== value || mixed) onChange(v);
    return formatNumber(v, decimals);
  };

  const stepBy = (dir: 1 | -1, e: KeyboardEvent<HTMLInputElement>) => {
    const s = e.shiftKey ? shiftStep ?? step * 10 : e.altKey ? step / 10 : step;
    const base = (draft !== null ? evalMath(draft) : null) ?? value ?? clamp(0, min, max);
    const d = Math.max(decimals, decimalsOf(s));
    const v = clamp(roundTo(base + dir * s, d), min, max);
    onChange(v);
    setDraft(formatNumber(v, d));
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const next = commit(text);
      setDraft(next);
      e.currentTarget.select();
    } else if (e.key === "Escape") {
      if (draft !== null && draft !== formatted) {
        e.preventDefault();
        e.stopPropagation();
        setDraft(formatted);
        const el = e.currentTarget;
        requestAnimationFrame(() => el.select());
      } else {
        e.currentTarget.blur();
      }
    } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      stepBy(e.key === "ArrowUp" ? 1 : -1, e);
    }
  };

  const errorMsg = typeof error === "string" ? error : undefined;
  const msgId = errorMsg && id ? `${id}-error` : undefined;

  return (
    <div className={cx("min-w-0", className)}>
      <div
        className={cx(
          fieldBox,
          controlHeight[size],
          scrubLabel ? "pl-0" : PAD_L[size],
          unit && !(mixed && shown == null) ? "pr-1.5" : PAD_R[size],
          error && fieldBoxError,
          disabled && fieldBoxDisabled,
        )}
      >
        {scrubLabel !== undefined && (
          <span
            onPointerDown={scrub.onPointerDown}
            aria-hidden
            className={cx(
              "flex h-full min-w-6 shrink-0 cursor-ew-resize select-none items-center justify-center px-1.5 text-sm text-fg-subtle",
              "hover:text-fg-muted",
              scrub.scrubbing && "text-fg",
            )}
          >
            {scrubLabel}
          </span>
        )}
        <input
          ref={ref}
          id={id}
          name={name}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          role="spinbutton"
          aria-valuenow={shown ?? undefined}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuetext={mixed ? "Mixed" : shown == null ? undefined : `${formatted}${unit ? ` ${unit}` : ""}`}
          aria-invalid={error ? true : undefined}
          aria-describedby={cx(aria["aria-describedby"], msgId) || undefined}
          aria-label={aria["aria-label"]}
          aria-labelledby={aria["aria-labelledby"]}
          disabled={disabled}
          autoFocus={autoFocus}
          value={text}
          placeholder={mixed ? "Mixed" : placeholder}
          className={cx(fieldInput, "timecode", size === "xs" && "text-sm")}
          onChange={(e) => setDraft(e.target.value)}
          onFocus={(e) => {
            setDraft(formatted);
            const el = e.currentTarget;
            requestAnimationFrame(() => {
              if (document.activeElement === el) el.select();
            });
            onFocus?.(e);
          }}
          onBlur={(e) => {
            if (draft !== null) commit(draft);
            setDraft(null);
            onBlur?.(e);
          }}
          onKeyDown={onKeyDown}
        />
        {unit && !(mixed && shown == null) && <span className="pointer-events-none shrink-0 pl-1 text-sm text-fg-subtle">{unit}</span>}
      </div>
      {errorMsg && (
        <p id={msgId} className={cx(fieldMessage, "text-danger")}>
          {errorMsg}
        </p>
      )}
    </div>
  );
}
