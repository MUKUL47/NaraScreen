import { isValidElement, type ReactElement, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

/** An icon prop: a lucide component (rendered at the control's icon size) or any element. */
export type IconLike = LucideIcon | ReactElement;

/** Renders an IconLike at `size` px with the house stroke width. */
export function Icon({ icon, size = 14, className }: { icon: IconLike | undefined; size?: number; className?: string }): ReactNode {
  if (!icon) return null;
  if (isValidElement(icon)) return icon;
  const C = icon as LucideIcon;
  return <C size={size} strokeWidth={1.75} className={className ? `shrink-0 ${className}` : "shrink-0"} aria-hidden />;
}
