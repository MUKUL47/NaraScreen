/** Dev-only component gallery (renderer URL `?gallery`, dev builds only). */
import { useEffect, useState } from "react";
import { Keyboard } from "lucide-react";
import { registerCommands, shortcutLabel, useCommands, useKeymap } from "../commands";
import { EFFECT_KINDS, EFFECT_META } from "../lib/effects-meta";
import { cx, Kbd, ScrollArea, Segmented } from "../ui";
import { ControlsSection } from "./gallery/ControlsSection";
import { EffectsSection } from "./gallery/EffectsSection";
import { FeedbackSection } from "./gallery/FeedbackSection";
import { NavSection } from "./gallery/NavSection";
import { OverlaySection } from "./gallery/OverlaySection";
import { TokensSection } from "./gallery/TokensSection";

const NAV = [
  ["tokens", "Tokens"],
  ["effects", "Effect registry"],
  ["controls", "Controls"],
  ["navigation", "Structure"],
  ["overlays", "Overlays"],
  ["feedback", "Feedback"],
] as const;

export default function UiGallery() {
  useKeymap();
  const [density, setDensity] = useState<"default" | "compact">("default");
  const [lastCmd, setLastCmd] = useState("—");
  const commands = useCommands();

  // Demo commands: number keys add effects, Mod+K and ? show that the registry dispatches.
  useEffect(
    () =>
      registerCommands([
        ...EFFECT_KINDS.filter((k) => EFFECT_META[k].shortcut).map((k) => ({
          id: `add.${k}`,
          title: `Add ${EFFECT_META[k].label}`,
          section: "Add",
          keys: [EFFECT_META[k].shortcut!],
          icon: EFFECT_META[k].icon,
          run: () => setLastCmd(`Add ${EFFECT_META[k].label}`),
        })),
        { id: "palette.open", title: "Command palette", section: "Help", keys: ["Mod+K"], run: () => setLastCmd("Command palette") },
        { id: "help.shortcuts", title: "Keyboard shortcuts", section: "Help", keys: ["?"], run: () => setLastCmd("Keyboard shortcuts") },
        { id: "file.save", title: "Save", section: "File", keys: ["Mod+S"], run: () => setLastCmd("Save") },
      ]),
    [],
  );

  return (
    <div className="flex h-full bg-app text-fg">
      <nav className="flex w-52 shrink-0 flex-col gap-0.5 border-r border-line bg-panel p-3">
        <div className="mb-3 flex items-center gap-2 px-2">
          <span className="text-brand">◆</span>
          <span className="text-md font-semibold">UI gallery</span>
        </div>
        {NAV.map(([id, label]) => (
          <a key={id} href={`#${id}`} className="rounded-md px-2 py-1 text-sm text-fg-muted hover:bg-hover hover:text-fg">
            {label}
          </a>
        ))}
        <div className="mt-auto flex flex-col gap-2 border-t border-line-subtle px-2 pt-3">
          <div className="label-caps">Density</div>
          <Segmented
            size="xs"
            aria-label="Density"
            value={density}
            onChange={setDensity}
            options={[{ value: "default", label: "Default" }, { value: "compact", label: "Compact" }]}
          />
          <div className="label-caps mt-2 flex items-center gap-1">
            <Keyboard size={10} aria-hidden /> Registry
          </div>
          <div className="text-xs text-fg-muted">
            {commands.length} commands · press <Kbd keys="1" /> <Kbd keys="Mod+K" /> <Kbd keys="?" />
          </div>
          <div className="text-xs text-fg-subtle">
            Last: <span id="g-last-cmd" className="text-fg">{lastCmd}</span>
          </div>
          <div className="text-xs text-fg-subtle">Save = {shortcutLabel("file.save") ?? "—"}</div>
        </div>
      </nav>
      <ScrollArea id="g-scroll" className={cx("flex-1", density === "compact" && "compact")}>
        <main className="mx-auto flex max-w-[1240px] flex-col gap-10 p-6 pb-24">
          <TokensSection />
          <EffectsSection />
          <ControlsSection />
          <NavSection />
          <OverlaySection />
          <FeedbackSection />
        </main>
      </ScrollArea>
    </div>
  );
}
