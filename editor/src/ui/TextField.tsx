import type { InputHTMLAttributes, ReactNode, Ref } from "react";
import { cx } from "./cx";
import { Icon, type IconLike } from "./icon";
import { controlHeight, fieldBox, fieldBoxDisabled, fieldBoxError, fieldInput, fieldMessage, fieldPadding, type ControlSize } from "./styles";

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size" | "prefix"> {
  size?: ControlSize;
  /** true = danger border; a string also shows the message below. */
  error?: boolean | string;
  /** Help text below (hidden while an error message shows). */
  hint?: ReactNode;
  icon?: IconLike;
  /** Content at the right inside the box (a unit, a Kbd, an IconButton). */
  suffix?: ReactNode;
  /** JetBrains Mono (paths, selectors). */
  mono?: boolean;
  className?: string;
  ref?: Ref<HTMLInputElement>;
}

/** Single-line text input. Pass `id` so a PropertyRow label and the error message link up. */
export function TextField({
  size = "sm",
  error,
  hint,
  icon,
  suffix,
  mono,
  className,
  disabled,
  id,
  type = "text",
  ref,
  ...rest
}: TextFieldProps) {
  const msg = typeof error === "string" ? error : undefined;
  const msgId = id && (msg || hint) ? `${id}-msg` : undefined;
  return (
    <div className={cx("min-w-0", className)}>
      <div className={cx(fieldBox, controlHeight[size], fieldPadding[size], "gap-1.5", error && fieldBoxError, disabled && fieldBoxDisabled)}>
        {icon && <Icon icon={icon} size={14} className="text-fg-subtle" />}
        <input
          ref={ref}
          id={id}
          type={type}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={cx(rest["aria-describedby"], msgId) || undefined}
          className={cx(fieldInput, size === "xs" && "text-sm", mono && "font-mono text-sm")}
          {...rest}
        />
        {suffix}
      </div>
      {(msg || hint) && (
        <p id={msgId} className={cx(fieldMessage, msg ? "text-danger" : "text-fg-subtle")}>
          {msg ?? hint}
        </p>
      )}
    </div>
  );
}
