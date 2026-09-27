// Timecode formatting and parsing (pure). Timecodes use Inter tabular figures in the UI.

export interface TimecodeOptions {
  /** Frames per second for `showFrames` and frame snapping (default 30). */
  fps?: number;
  /** Show frames instead of hundredths: `0:02:08` (m:ss:ff). Default false → `0:02.26`. */
  showFrames?: boolean;
}

/**
 * `2.26` → `"0:02.26"`, `83.4` → `"1:23.40"`, `3725` → `"1:02:05.00"`, `-1.5` → `"-0:01.50"`.
 * With `showFrames`: `2.26` at 30 fps → `"0:02:08"`.
 */
export function formatTimecode(sec: number, opts: TimecodeOptions = {}): string {
  const { fps = 30, showFrames = false } = opts;
  if (!Number.isFinite(sec)) return showFrames ? "0:00:00" : "0:00.00";
  const sign = sec < 0 ? "-" : "";
  const abs = Math.abs(sec);

  let whole: number;
  let frac: string;
  if (showFrames) {
    const totalFrames = Math.round(abs * fps);
    whole = Math.floor(totalFrames / fps);
    frac = ":" + String(totalFrames % fps).padStart(String(Math.max(1, fps - 1)).length, "0");
  } else {
    const centis = Math.round(abs * 100);
    whole = Math.floor(centis / 100);
    frac = "." + String(centis % 100).padStart(2, "0");
  }

  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = whole % 60;
  const ss = String(s).padStart(2, "0");
  const body = h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
  return sign + body + frac;
}

/** Short label without fractions: `0:02`, `1:23`, `1:02:05` (ruler, lists). */
export function formatTimeShort(sec: number): string {
  const t = Math.max(0, Math.floor(Number.isFinite(sec) ? sec : 0));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = String(t % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

/** A duration in seconds: `3.6` → `"3.60 s"`, `83` → `"1:23.00"` (≥ 60 s switches to m:ss). */
export function formatDuration(sec: number, decimals = 2): string {
  if (!Number.isFinite(sec)) return "–";
  if (Math.abs(sec) >= 60) return formatTimecode(sec);
  return `${sec.toFixed(decimals)} s`;
}

const DECIMAL = /^(\d+\.?\d*|\.\d+)$/;

function parseAbsolute(s: string): number | null {
  const str = s.replace(/s$/i, "");
  if (!str) return null;
  // plain seconds: 83, 83.4, .5, 83.
  if (DECIMAL.test(str)) return Number(str);
  // m:ss(.f) or h:mm:ss(.f)
  const parts = str.split(":");
  if (parts.length < 2 || parts.length > 3) return null;
  const secPart = parts[parts.length - 1];
  const units = parts.slice(0, -1);
  if (!DECIMAL.test(secPart) || !units.every((p) => /^\d+$/.test(p))) return null;
  const minutes = Number(units[units.length - 1]);
  const hours = units.length === 2 ? Number(units[0]) : 0;
  return hours * 3600 + minutes * 60 + Number(secPart);
}

/**
 * Parses what a TimecodeField accepts. Returns seconds or null when unreadable.
 * - absolute: `1:23.4`, `0:02.26`, `1:02:05`, `83.4`, `83`, `83.4s`, `.5`, `1,5`
 * - relative: `+0.5`, `-1`, `+0:01.5` → `relativeTo ± n` (relativeTo defaults to 0)
 */
export function parseTimecode(input: string, relativeTo = 0): number | null {
  const s = input.trim().replace(/\s+/g, "").replace(/,/g, ".");
  if (!s) return null;
  const sign = s[0] === "+" ? 1 : s[0] === "-" || s[0] === "−" ? -1 : 0;
  if (sign !== 0) {
    const n = parseAbsolute(s.slice(1));
    return n === null ? null : relativeTo + sign * n;
  }
  return parseAbsolute(s);
}

/** Rounds seconds to the nearest frame. */
export function snapToFrame(sec: number, fps = 30): number {
  return Math.round(sec * fps) / fps;
}
