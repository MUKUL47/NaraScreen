import { EFFECT_KINDS, EFFECT_META, LANES, VIDEO_LANE } from "../../lib/effects-meta";
import { Badge, Kbd, cx } from "../../ui";
import { Demo, GallerySection } from "./Demo";

export function EffectsSection() {
  return (
    <GallerySection id="effects" title="Effect registry">
      <Demo title="EFFECT_META" note="icon · colour · label · lane · shortcut · clip fill / selected / solid chip" wide>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-2">
          {EFFECT_KINDS.map((k) => {
            const m = EFFECT_META[k];
            const I = m.icon;
            return (
              <div key={k} className="flex flex-col gap-2 rounded-md border border-line-subtle bg-app p-2.5">
                <div className="flex items-center gap-2">
                  <I size={14} strokeWidth={1.75} className={m.cls.text} aria-hidden />
                  <span className="text-sm font-medium">{m.label}</span>
                  <span className="text-xs text-fg-subtle">{m.lane}</span>
                  <span className="ml-auto">{m.shortcut ? <Kbd keys={m.shortcut} /> : <span className="text-2xs text-fg-disabled">palette</span>}</span>
                </div>
                <div className="text-xs text-fg-muted">{m.description}</div>
                <div className="flex items-center gap-1.5">
                  <div className={cx("relative flex h-6 min-w-0 flex-1 items-center gap-1 overflow-hidden rounded-sm border border-line-subtle pl-2.5 pr-1.5 text-xs", m.cls.fill)}>
                    <span className={cx("absolute inset-y-0 left-0 w-0.5", m.cls.bg)} />
                    <I size={12} strokeWidth={1.75} className={m.cls.text} aria-hidden />
                    <span className="truncate">clip</span>
                  </div>
                  <div className={cx("relative flex h-6 min-w-0 flex-1 items-center gap-1 overflow-hidden rounded-sm pl-2.5 pr-1.5 text-xs outline outline-[1.5px] outline-fg", m.cls.fillSel)}>
                    <span className={cx("absolute inset-y-0 left-0 w-0.5", m.cls.bg)} />
                    <I size={12} strokeWidth={1.75} className={m.cls.text} aria-hidden />
                    <span className="truncate">selected</span>
                  </div>
                  <Badge tone={`fx-${k}`} variant="solid" icon={I}>
                    {m.label}
                  </Badge>
                </div>
                <div className="truncate text-2xs text-fg-subtle">
                  {m.shape} · {m.hasRegions ? "regions" : "no regions"} · {m.speaks ? "speaks" : "silent"} · {m.aliases.slice(0, 3).join(", ")}
                </div>
              </div>
            );
          })}
        </div>
      </Demo>
      <Demo title="LANES" note="timeline families, top to bottom">
        {[VIDEO_LANE, ...LANES].map((l) => {
          const I = l.icon;
          const kinds = "kinds" in l ? l.kinds : [];
          return (
            <div key={l.id} className="flex items-center gap-2">
              <I size={14} strokeWidth={1.75} className="text-fg-muted" aria-hidden />
              <span className="w-20 text-sm">{l.label}</span>
              <div className="flex flex-wrap gap-1">
                {kinds.map((k) => (
                  <Badge key={k} tone={`fx-${k}`} icon={EFFECT_META[k].icon}>
                    {EFFECT_META[k].label}
                  </Badge>
                ))}
                {kinds.length === 0 && <span className="text-xs text-fg-subtle">filmstrip</span>}
              </div>
            </div>
          );
        })}
      </Demo>
      <Demo title="Add bar" note="ghost buttons; icon takes the effect colour on hover">
        <div className="flex flex-wrap items-center gap-0.5 rounded-md border border-line bg-panel p-1">
          {EFFECT_KINDS.map((k, i) => {
            const m = EFFECT_META[k];
            const I = m.icon;
            const sep = i === 6 || i === 10;
            return (
              <span key={k} className="flex items-center">
                {sep && <span className="mx-1 h-4 w-px bg-line" />}
                <button type="button" className="group inline-flex h-control-sm items-center gap-1.5 rounded-md px-2 text-sm font-medium text-fg-muted hover:bg-hover hover:text-fg">
                  <I size={14} strokeWidth={1.75} className={cx("text-fg-subtle", m.cls.groupHoverText)} aria-hidden />
                  {m.label}
                </button>
              </span>
            );
          })}
        </div>
      </Demo>
    </GallerySection>
  );
}
