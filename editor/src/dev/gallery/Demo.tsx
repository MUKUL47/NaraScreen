import type { ReactNode } from "react";
import { cx } from "../../ui";

/** A gallery card: title, optional note, and the specimens. */
export function Demo({ title, note, children, className, wide }: { title: string; note?: ReactNode; children: ReactNode; className?: string; wide?: boolean }) {
  return (
    <div className={cx("rounded-lg border border-line bg-panel", wide && "col-span-full", className)}>
      <div className="flex items-baseline gap-2 border-b border-line-subtle px-4 py-2">
        <h3 className="shrink-0 whitespace-nowrap text-sm font-semibold text-fg">{title}</h3>
        {note && <span className="truncate text-xs text-fg-subtle">{note}</span>}
      </div>
      <div className="flex flex-col gap-3 p-4">{children}</div>
    </div>
  );
}

/** A labelled specimen row inside a Demo. */
export function Row({ label, children, className }: { label?: string; children: ReactNode; className?: string }) {
  return (
    <div className={cx("flex flex-wrap items-center gap-2", className)}>
      {label && <span className="w-24 shrink-0 text-xs text-fg-subtle">{label}</span>}
      {children}
    </div>
  );
}

export function GallerySection({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-4">
      <h2 className="mb-3 text-xl font-semibold tracking-[-0.01em] text-fg">{title}</h2>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(360px,1fr))] gap-4">{children}</div>
    </section>
  );
}
