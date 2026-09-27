import type { CSSProperties, ReactNode, Ref, TextareaHTMLAttributes } from "react";
import { cx } from "./cx";
import { speechSeconds } from "./speech";
import { fieldBox, fieldBoxDisabled, fieldBoxError, fieldInput, fieldMessage } from "./styles";

export interface TextAreaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value"> {
  value: string;
  /** Grow with the content between minRows and maxRows (CSS field-sizing, no JS). Default true. */
  autosize?: boolean;
  minRows?: number;
  maxRows?: number;
  /** "chars" shows "38 chars"; "speech" adds "· ≈2.5 s" at ~2.6 words/s (narration). */
  counter?: "chars" | "speech";
  error?: boolean | string;
  /** Content at the right of the counter line (voice select, status). */
  footer?: ReactNode;
  mono?: boolean;
  className?: string;
  ref?: Ref<HTMLTextAreaElement>;
}

/** Multi-line text with autosize and an optional chars / ≈ speech-seconds counter. */
export function TextArea({
  value,
  autosize = true,
  minRows = 2,
  maxRows = 8,
  counter,
  error,
  footer,
  mono,
  className,
  disabled,
  id,
  ref,
  ...rest
}: TextAreaProps) {
  const msg = typeof error === "string" ? error : undefined;
  const lh = 20; // text-base line height
  const style: CSSProperties = autosize
    ? { minHeight: minRows * lh + 12, maxHeight: maxRows * lh + 12 }
    : { height: minRows * lh + 12 };
  const secs = counter === "speech" ? speechSeconds(value) : 0;
  return (
    <div className={cx("min-w-0", className)}>
      <div className={cx(fieldBox, "items-stretch px-2 py-1.5", error && fieldBoxError, disabled && fieldBoxDisabled)}>
        <textarea
          ref={ref}
          id={id}
          value={value}
          disabled={disabled}
          rows={minRows}
          aria-invalid={error ? true : undefined}
          style={style}
          className={cx(fieldInput, "resize-none leading-5", autosize && "field-sizing-content", mono && "font-mono text-sm")}
          {...rest}
        />
      </div>
      {(counter || footer || msg) && (
        <div className={cx(fieldMessage, "flex min-h-4 items-center gap-2")}>
          {msg ? (
            <span className="text-danger">{msg}</span>
          ) : counter ? (
            <span className="timecode text-fg-subtle">
              {value.length} chars{counter === "speech" && value.trim() ? ` · ≈${secs.toFixed(1)} s` : ""}
            </span>
          ) : null}
          {footer && <div className="ml-auto flex items-center gap-2">{footer}</div>}
        </div>
      )}
    </div>
  );
}
