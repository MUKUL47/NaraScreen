import { useState } from "react";
import { AlertTriangle, ListTree, Mic, MoreHorizontal, Plus, Trash2 } from "lucide-react";
import { EFFECT_META } from "../../lib/effects-meta";
import { Badge, IconButton, LangTabs, PropertyRow, Section, Segmented, SliderField, TabPanel, Tabs, TextArea, TimecodeField, Toggle } from "../../ui";
import { Demo, GallerySection } from "./Demo";

export function NavSection() {
  const [tab, setTab] = useState("outline");
  const [pill, setPill] = useState("edit");
  const [lang, setLang] = useState("en");
  const [dim, setDim] = useState(70);
  const [feather, setFeather] = useState(12);
  const [freeze, setFreeze] = useState(false);
  const [preset, setPreset] = useState<string | null>("focus");
  const [text, setText] = useState("Overdue tasks turn red, so nothing slips.");
  const m = EFFECT_META.spotlight;

  return (
    <GallerySection id="navigation" title="Structure">
      <Demo title="Tabs · LangTabs" note="underline (panels) · pill (mode switch) · language status dots">
        <div className="rounded-md border border-line-subtle bg-panel">
          <Tabs
            idPrefix="gtabs"
            aria-label="Left panel"
            value={tab}
            onChange={setTab}
            tabs={[
              { value: "outline", label: "Outline", icon: ListTree },
              { value: "narration", label: "Narration", icon: Mic },
              { value: "issues", label: "Issues", icon: AlertTriangle, count: 2 },
            ]}
          />
          <TabPanel idPrefix="gtabs" value={tab} className="px-3 py-2 text-xs text-fg-subtle">
            Panel: {tab}
          </TabPanel>
        </div>
        <Tabs variant="pill" aria-label="Mode" value={pill} onChange={setPill} tabs={[{ value: "edit", label: "Edit" }, { value: "script", label: "Script" }]} />
        <LangTabs langs={["en", "hi", "es"]} active={lang} onChange={setLang} status={{ en: "ready", hi: "partial", es: "missing" }} onAdd={() => undefined} />
      </Demo>

      <Demo title="Inspector mock" note="Section (persisted) + PropertyRow 88 px labels">
        <div className="w-[320px] overflow-hidden rounded-md border border-line-subtle bg-panel">
          <div className="flex h-10 items-center gap-2 border-b border-line-subtle px-3">
            <Badge tone="fx-spotlight" variant="solid" icon={m.icon}>
              Spotlight
            </Badge>
            <span className="min-w-0 flex-1 truncate text-md font-semibold">Overdue card</span>
            <IconButton icon={MoreHorizontal} label="More" size={24} />
          </div>
          <div className="flex h-control-md items-center gap-2 border-b border-line-subtle px-3 text-xs text-fg-subtle">
            Start <TimecodeField seconds={2.26} onChange={() => undefined} size="xs" className="w-[72px]" aria-label="Start" />
            End <TimecodeField seconds={5.86} onChange={() => undefined} size="xs" className="w-[72px]" aria-label="End" />
            <span className="timecode ml-auto text-fg-muted">3.60 s</span>
          </div>
          <Section title="Regions" count={1} persistKey="gallery.regions" action={<IconButton icon={Plus} label="Draw region" shortcut="R" size={24} />}>
            <div className="flex h-control-sm items-center gap-2 rounded-sm px-1 text-sm hover:bg-hover">
              <span className="flex size-4 items-center justify-center rounded-full bg-fx-spotlight text-2xs font-semibold text-fg-inverse">1</span>
              <span className="timecode flex-1 text-fg-muted">389 × 181</span>
              <IconButton icon={Trash2} label="Remove region" variant="danger" size={24} />
            </div>
          </Section>
          <Section title="Look" persistKey="gallery.look" help="How the dimmed area and the lit box look.">
            <Segmented fullWidth aria-label="Preset" value={preset} onChange={setPreset} options={[{ value: "subtle", label: "Subtle" }, { value: "focus", label: "Focus" }, { value: "dramatic", label: "Dramatic" }]} />
            <SliderField label="Dim" value={dim} onChange={setDim} min={0} max={100} unit="%" defaultValue={70} />
            <SliderField label="Soft edge" value={feather} onChange={setFeather} min={0} max={64} unit="px" defaultValue={0} />
          </Section>
          <Section title="Timing" persistKey="gallery.timing" defaultOpen={false}>
            <PropertyRow label="Freeze" help="Holds the frame while the effect plays">
              <Toggle checked={freeze} onChange={setFreeze} aria-label="Freeze video" />
            </PropertyRow>
          </Section>
          <Section title="Narration" persistKey="gallery.narration" summary={<LangTabs langs={["en", "hi"]} active={lang} onChange={setLang} status={{ en: "ready", hi: "missing" }} />}>
            <PropertyRow label="Text" stacked>
              <TextArea value={text} onChange={(e) => setText(e.target.value)} counter="speech" aria-label="Narration text" />
            </PropertyRow>
          </Section>
        </div>
      </Demo>
    </GallerySection>
  );
}
