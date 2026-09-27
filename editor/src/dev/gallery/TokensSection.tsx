import { Demo, GallerySection } from "./Demo";

const GROUPS: { title: string; tokens: string[] }[] = [
  { title: "Surfaces", tokens: ["app", "panel", "raised", "hover", "selected"] },
  { title: "Lines", tokens: ["line-subtle", "line", "line-strong", "line-control"] },
  { title: "Text", tokens: ["fg", "fg-muted", "fg-subtle", "fg-disabled", "fg-inverse"] },
  { title: "Interaction", tokens: ["primary", "primary-hover", "brand", "brand-hover", "focus", "playhead"] },
  { title: "Status", tokens: ["success", "warning", "danger", "danger-solid", "record", "info"] },
  {
    title: "Effects",
    tokens: ["fx-narrate", "fx-zoom", "fx-spotlight", "fx-arrow", "fx-callout", "fx-blur", "fx-speed", "fx-skip", "fx-pause", "fx-mute", "fx-music"],
  },
];

const TYPE: { cls: string; label: string; weight: string }[] = [
  { cls: "text-2xs font-medium", label: "text-2xs 10/14 · ruler labels, Kbd", weight: "500" },
  { cls: "text-xs", label: "text-xs 11/16 · meta, clip labels, hints", weight: "400" },
  { cls: "text-sm font-medium", label: "text-sm 12/16 · controls, buttons, menus", weight: "500" },
  { cls: "text-base", label: "text-base 13/20 · inputs, body, narration", weight: "400" },
  { cls: "text-md font-semibold", label: "text-md 14/20 · panel + section titles", weight: "600" },
  { cls: "text-lg font-semibold", label: "text-lg 16/24 · dialog titles", weight: "600" },
  { cls: "text-xl font-semibold", label: "text-xl 20/28 · Home headings", weight: "600" },
  { cls: "text-2xl font-semibold tracking-[-0.01em]", label: "text-2xl 24/32 · Home hero", weight: "600" },
];

export function TokensSection() {
  return (
    <GallerySection id="tokens" title="Tokens">
      <Demo title="Colour" note="bg-*, text-*, border-* utilities" wide>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-x-4 gap-y-3">
          {GROUPS.map((g) => (
            <div key={g.title} className="flex flex-col gap-1.5">
              <div className="label-caps">{g.title}</div>
              {g.tokens.map((t) => (
                <div key={t} className="flex items-center gap-2">
                  <span
                    className="size-6 shrink-0 rounded-sm border border-white/10"
                    style={{ background: `var(--color-${t})` }}
                  />
                  <span className="truncate font-mono text-xs text-fg-muted">{t}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </Demo>
      <Demo title="Type scale" note="Inter Variable; timecodes use tabular figures" wide>
        <div className="flex flex-col gap-2">
          {TYPE.map((t) => (
            <div key={t.cls} className="flex items-baseline gap-4">
              <span className="w-72 shrink-0 text-xs text-fg-subtle">{t.label}</span>
              <span className={t.cls}>Spotlights glide in with a soft glow</span>
            </div>
          ))}
          <div className="flex items-baseline gap-4">
            <span className="w-72 shrink-0 text-xs text-fg-subtle">timecode (tabular) · overline</span>
            <span className="timecode text-base">0:02.26 → 0:05.86 · 1:11.11</span>
            <span className="label-caps">Export settings</span>
          </div>
          <div className="flex items-baseline gap-4">
            <span className="w-72 shrink-0 text-xs text-fg-subtle">font-mono (JetBrains Mono)</span>
            <span className="font-mono text-sm text-fg-muted">{'{ "fx": "spotlight", "at": 2.26 }'}</span>
          </div>
        </div>
      </Demo>
      <Demo title="Radii · elevation · sizes">
        <div className="flex flex-wrap items-end gap-3">
          {["xs", "sm", "md", "lg", "xl"].map((r) => (
            <div key={r} className="flex flex-col items-center gap-1">
              <div className="size-10 border border-line-strong bg-raised" style={{ borderRadius: `var(--radius-${r})` }} />
              <span className="text-2xs text-fg-subtle">{r}</span>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-4 py-2">
          <div className="flex h-12 w-24 items-center justify-center rounded-lg bg-raised text-xs text-fg-muted shadow-popover">popover</div>
          <div className="flex h-12 w-24 items-center justify-center rounded-xl bg-raised text-xs text-fg-muted shadow-modal">modal</div>
          <div className="flex h-12 w-24 items-center justify-center rounded-sm bg-raised text-xs text-fg-muted shadow-drag">drag</div>
        </div>
        <div className="flex items-end gap-2">
          {["control-xs", "control-sm", "control-md", "control-lg"].map((s) => (
            <div key={s} className="flex flex-col items-center gap-1">
              <div className="w-12 rounded-md border border-line-control bg-raised" style={{ height: `var(--spacing-${s})` }} />
              <span className="text-2xs text-fg-subtle">{s.replace("control-", "")}</span>
            </div>
          ))}
        </div>
      </Demo>
    </GallerySection>
  );
}
