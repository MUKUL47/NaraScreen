/**
 * Evaluates the small arithmetic a number field accepts: `2*1.5`, `(10+2)/4`, `-0.5`, `.5`,
 * `70%`, `24px`, `1,5`. Returns null for anything else (never uses eval).
 */
export function evalMath(input: string): number | null {
  let s = input.trim().replace(/\s+/g, "").replace(/,/g, ".");
  s = s.replace(/(px|ms|%|s|×|x|°)$/i, "").replace(/×/g, "*").replace(/÷/g, "/");
  if (!s) return null;
  let i = 0;

  const peek = () => s[i];
  function number(): number | null {
    const m = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(s.slice(i));
    if (!m) return null;
    i += m[0].length;
    return Number(m[0]);
  }
  function factor(): number | null {
    const c = peek();
    if (c === "+" || c === "-") {
      i++;
      const f = factor();
      return f === null ? null : c === "-" ? -f : f;
    }
    if (c === "(") {
      i++;
      const v = expr();
      if (v === null || peek() !== ")") return null;
      i++;
      return v;
    }
    return number();
  }
  function term(): number | null {
    let v = factor();
    while (v !== null && (peek() === "*" || peek() === "/")) {
      const op = s[i++];
      const r = factor();
      if (r === null) return null;
      v = op === "*" ? v * r : v / r;
    }
    return v;
  }
  function expr(): number | null {
    let v = term();
    while (v !== null && (peek() === "+" || peek() === "-")) {
      const op = s[i++];
      const r = term();
      if (r === null) return null;
      v = op === "+" ? v + r : v - r;
    }
    return v;
  }

  const v = expr();
  if (v === null || i !== s.length || !Number.isFinite(v)) return null;
  return v;
}

/** Decimal places implied by a step (0.05 → 2, 1 → 0). */
export function decimalsOf(step: number): number {
  if (!Number.isFinite(step) || step <= 0) return 0;
  const str = String(step);
  if (str.includes("e-")) return Number(str.split("e-")[1]);
  const dot = str.indexOf(".");
  return dot < 0 ? 0 : str.length - dot - 1;
}

export function roundTo(v: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(v * f) / f;
}

export function clamp(v: number, min?: number, max?: number): number {
  if (min !== undefined && v < min) return min;
  if (max !== undefined && v > max) return max;
  return v;
}

/** Formats a number for a field: fixed decimals, trailing zeros trimmed ("0.50" → "0.5"). */
export function formatNumber(v: number, decimals: number): string {
  if (!Number.isFinite(v)) return "";
  const fixed = v.toFixed(decimals);
  return decimals > 0 ? fixed.replace(/\.?0+$/, "") : fixed;
}
