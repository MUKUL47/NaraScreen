import { useState, type KeyboardEvent, type Ref } from "react";
import { formatTimecode, parseTimecode, snapToFrame } from "../lib/timecode";
import { cx } from "./cx";
import { clamp } from "./mathExpr";
import { controlHeight, fieldBox, fieldBoxDisabled, fieldBoxError, fieldInput, type ControlSize } from "./styles";

export interface TimecodeFieldProps {
  /** Seconds. */
  seconds: number | null | undefined;
  onChange: (seconds: number) => void;
  min?: number;
  max?: number;
  /** Frame rate for ↑/↓ steps and snapping (default 30). */
  fps?: number;
  /** Snap committed values to whole frames (default true). */
  snap?: boolean;
  mixed?: boolean;
  disabled?: boolean;
  error?: boolean;
  size?: ControlSize;
  id?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  className?: string;
  ref?: Ref<HTMLInputElement>;
}

/**
 * Time input showing `0:02.26`. Accepts `1:23.4`, `83.4`, `+0.5` / `-1` (relative to the current
 * value). Enter commits, Esc reverts, ↑/↓ = 1 frame, Shift+↑/↓ = 1 s.
 */
export function TimecodeField({
  seconds,
  onChange,
  min = 0,
  max,
  fps = 30,
  snap = true,
  mixed,
  disabled,
  error,
  size = "sm",
  id,
  className,
  ref,
  ...aria
}: TimecodeFieldProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const formatted = mixed || seconds == null ? "" : formatTimecode(seconds, { fps });
  const text = draft ?? formatted;
  const [invalid, setInvalid] = useState(false);

  const normalize = (v: number) => clamp(snap ? snapToFrame(v, fps) : v, min, max);

  const commit = (raw: string): string => {
    if (raw.trim() === "" || raw === formatted) {
      setInvalid(false);
      return formatted;
    }
    const t = parseTimecode(raw, seconds ?? 0);
    if (t === null) {
      setInvalid(true);
      return raw;
    }
    setInvalid(false);
    const v = normalize(t);
    if (v !== seconds || mixed) onChange(v);
    return formatTimecode(v, { fps });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      setDraft(commit(text));
      e.currentTarget.select();
    } else if (e.key === "Escape") {
      if (draft !== null && draft !== formatted) {
        e.preventDefault();
        e.stopPropagation();
        setInvalid(false);
        setDraft(formatted);
      } else {
        e.currentTarget.blur();
      }
    } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      const base = (draft !== null ? parseTimecode(draft, seconds ?? 0) : null) ?? seconds ?? 0;
      const delta = (e.shiftKey ? 1 : 1 / fps) * (e.key === "ArrowUp" ? 1 : -1);
      const v = normalize(base + delta);
      onChange(v);
      setInvalid(false);
      setDraft(formatTimecode(v, { fps }));
    }
  };

  const showError = error || invalid;
  return (
    <div
      className={cx(
        fieldBox,
        controlHeight[size],
        size === "xs" ? "px-1.5" : "px-2",
        showError && fieldBoxError,
        disabled && fieldBoxDisabled,
        className,
      )}
      title={invalid ? "Use 1:23.4, 83.4, or +0.5 / -1" : undefined}
    >
      <input
        ref={ref}
        id={id}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        spellCheck={false}
        aria-label={aria["aria-label"]}
        aria-labelledby={aria["aria-labelledby"]}
        aria-invalid={showError || undefined}
        disabled={disabled}
        value={text}
        placeholder={mixed ? "Mixed" : "0:00.00"}
        className={cx(fieldInput, "timecode w-full", size === "xs" && "text-sm")}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={(e) => {
          setDraft(formatted);
          const el = e.currentTarget;
          requestAnimationFrame(() => {
            if (document.activeElement === el) el.select();
          });
        }}
        onBlur={() => {
          if (draft !== null) commit(draft);
          setInvalid(false);
          setDraft(null);
        }}
        onKeyDown={onKeyDown}
      />
    </div>
  );
}
