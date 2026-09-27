import { useState } from "react";
import { HexColorPicker } from "react-colorful";
import { Plus } from "lucide-react";
import { cx } from "./cx";
import { Popover } from "./Popover";
import { TextField } from "./TextField";

/** Default swatches: the arrow's render default (#F97316) first. */
const DEFAULT_SWATCHES = ["#F97316", "#EF4444", "#F59E0B", "#22C55E", "#06B6D4", "#3B82F6", "#8B5CF6", "#FFFFFF"];

export interface ColorFieldProps {
  /** "#RRGGBB" */
  value: string | null | undefined;
  onChange: (hex: string) => void;
  /** Live value while dragging in the custom picker. */
  onLiveChange?: (hex: string) => void;
  swatches?: string[];
  allowCustom?: boolean;
  disabled?: boolean;
  "aria-label"?: string;
  className?: string;
}

const HEX = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i;
function normalizeHex(s: string): string | null {
  const m = HEX.exec(s.trim());
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].split("").map((c) => c + c).join("") : m[1];
  return `#${h.toUpperCase()}`;
}

/** Colour picker: swatches, then "Custom" opening react-colorful + a hex field. */
export function ColorField({ value, onChange, onLiveChange, swatches = DEFAULT_SWATCHES, allowCustom = true, disabled, className, ...aria }: ColorFieldProps) {
  const current = value ? normalizeHex(value) : null;
  const isCustom = !!current && !swatches.some((s) => normalizeHex(s) === current);
  const [live, setLive] = useState<string | null>(null);
  const [hexDraft, setHexDraft] = useState<string | null>(null);
  const pickerValue = live ?? current ?? "#F97316";

  const commitLive = () => {
    if (!live) return;
    onChange(live);
    setLive(null);
  };
  const commitHex = (raw: string) => {
    const h = normalizeHex(raw);
    if (h) onChange(h);
    setHexDraft(null);
  };

  return (
    <div
      role="group"
      aria-label={aria["aria-label"]}
      className={cx("flex flex-wrap items-center gap-1", disabled && "pointer-events-none opacity-40", className)}
    >
      {swatches.map((s) => {
        const h = normalizeHex(s) ?? s;
        const checked = current === h;
        return (
          <button
            key={h}
            type="button"
            aria-pressed={checked}
            aria-label={h}
            title={h}
            disabled={disabled}
            onClick={() => onChange(h)}
            className={cx(
              "size-5 shrink-0 rounded-full border border-white/15 transition-shadow duration-[120ms]",
              checked ? "shadow-[0_0_0_2px_var(--color-panel),0_0_0_3.5px_var(--color-fg)]" : "hover:shadow-[0_0_0_2px_var(--color-panel),0_0_0_3.5px_var(--color-line-strong)]",
            )}
            style={{ background: h }}
          />
        );
      })}
      {allowCustom && (
        <Popover
          side="bottom"
          align="start"
          width={216}
          className="p-2"
          aria-label="Custom colour"
          initialFocus="none"
          onOpenChange={(o) => !o && setLive(null)}
          trigger={
            <button
              type="button"
              aria-pressed={isCustom}
              aria-label={isCustom ? `Custom colour ${current}` : "Custom colour…"}
              title="Custom…"
              disabled={disabled}
              className={cx(
                "inline-flex size-5 shrink-0 items-center justify-center rounded-full border border-dashed border-line-control text-fg-muted hover:text-fg",
                isCustom && "border-solid border-white/15 shadow-[0_0_0_2px_var(--color-panel),0_0_0_3.5px_var(--color-fg)]",
              )}
              style={isCustom ? { background: current! } : undefined}
            >
              {!isCustom && <Plus size={12} strokeWidth={2} aria-hidden />}
            </button>
          }
        >
          <div
            className="flex flex-col gap-2"
            onPointerUp={commitLive}
            onKeyUp={(e) => {
              if (e.key.startsWith("Arrow")) commitLive();
            }}
          >
            <HexColorPicker
              color={pickerValue}
              onChange={(c) => {
                const h = normalizeHex(c) ?? c;
                setLive(h);
                onLiveChange?.(h);
              }}
              style={{ width: "100%", height: 150 }}
            />
            <TextField
              size="xs"
              mono
              aria-label="Hex colour"
              value={hexDraft ?? pickerValue}
              onChange={(e) => setHexDraft(e.target.value)}
              onBlur={(e) => hexDraft !== null && commitHex(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitHex(e.currentTarget.value);
              }}
              error={hexDraft !== null && !normalizeHex(hexDraft)}
              suffix={<span className="size-3 shrink-0 rounded-xs border border-white/15" style={{ background: pickerValue }} />}
            />
          </div>
        </Popover>
      )}
    </div>
  );
}
