/** Shared class strings for form controls, so every field looks and sizes the same. */

export type ControlSize = "xs" | "sm" | "md";

export const controlHeight: Record<ControlSize, string> = {
  xs: "h-control-xs",
  sm: "h-control-sm",
  md: "h-control-md",
};

/** The input "box": raised fill, control border, focus ring on the box. */
export const fieldBox =
  "flex items-center min-w-0 rounded-md border bg-raised text-fg transition-colors duration-[120ms] " +
  "border-line-control hover:border-line-strong " +
  "focus-within:border-focus focus-within:ring-1 focus-within:ring-focus";

export const fieldBoxError = "border-danger hover:border-danger focus-within:border-danger";
export const fieldBoxDisabled = "opacity-40 pointer-events-none";

/** The bare <input>/<textarea> inside a fieldBox. */
export const fieldInput =
  "min-w-0 flex-1 bg-transparent text-base text-fg outline-none placeholder:text-fg-subtle " +
  "disabled:cursor-not-allowed";

export const fieldPadding: Record<ControlSize, string> = {
  xs: "px-1.5 text-sm",
  sm: "px-2",
  md: "px-2.5",
};

/** Small caption under a field (help or error). */
export const fieldMessage = "mt-1 text-xs";
