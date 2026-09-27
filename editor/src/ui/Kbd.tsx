import { shortcutParts } from "../commands/keys";
import { cx } from "./cx";

export interface KbdProps {
  /** A key spec ("Mod+Shift+Z", "?", "ArrowLeft") or its parts (["Mod", "K"]). Mod = ⌘ on macOS, Ctrl elsewhere. */
  keys: string | string[];
  className?: string;
  /** "muted" (default) sits on panels; "inverse" sits on the primary (light) button. */
  tone?: "muted" | "inverse";
}

/** Keyboard shortcut caps. */
export function Kbd({ keys, className, tone = "muted" }: KbdProps) {
  const spec = Array.isArray(keys) ? keys.join("+") : keys;
  const parts = shortcutParts(spec);
  return (
    <kbd className={cx("inline-flex shrink-0 items-center gap-0.5 font-sans", className)} aria-label={parts.join(" ")}>
      {parts.map((p, i) => (
        <kbd
          key={i}
          className={cx(
            "inline-flex h-4 min-w-4 items-center justify-center rounded-sm px-1 text-2xs font-medium",
            tone === "inverse" ? "bg-fg-inverse/10 text-fg-inverse/70" : "bg-selected text-fg-muted",
          )}
        >
          {p}
        </kbd>
      ))}
    </kbd>
  );
}
