/** Joins class names, skipping anything that isn't a non-empty string (false, null, 0, ReactNode…). */
export function cx(...parts: unknown[]): string {
  let out = "";
  for (const p of parts) if (typeof p === "string" && p) out = out ? `${out} ${p}` : p;
  return out;
}
