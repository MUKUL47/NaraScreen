import { useState } from "react";
import { Copy, Download, EyeOff, FolderOpen, MoreHorizontal, Pencil, Scissors, Trash2 } from "lucide-react";
import { EFFECT_KINDS, EFFECT_META } from "../../lib/effects-meta";
import { Button, ContextMenu, Drawer, IconButton, Kbd, Menu, Modal, Popover, Segmented, TextField, Tooltip, type MenuItem } from "../../ui";
import { Demo, GallerySection, Row } from "./Demo";

const clipMenu: MenuItem[] = [
  { label: "Rename", icon: Pencil, shortcut: "F2" },
  { label: "Duplicate", icon: Copy, shortcut: "D" },
  { label: "Split at playhead", icon: Scissors, shortcut: "B" },
  { label: "Disable", icon: EyeOff, shortcut: "H" },
  { type: "separator" },
  {
    label: "Add",
    submenu: EFFECT_KINDS.slice(0, 6).map((k) => ({ label: EFFECT_META[k].label, icon: EFFECT_META[k].icon, shortcut: EFFECT_META[k].shortcut })),
  },
  { label: "Snapping", checked: true, shortcut: "N" },
  { type: "separator" },
  { label: "Delete", icon: Trash2, shortcut: "Delete", danger: true },
];

export function OverlaySection() {
  const [modal, setModal] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [res, setRes] = useState("1080p");
  const [last, setLast] = useState("");

  const items = clipMenu.map((it) =>
    it.type === "separator" || it.type === "label" ? it : { ...it, onSelect: () => setLast(it.label) },
  );

  return (
    <GallerySection id="overlays" title="Overlays">
      <Demo title="Tooltip · Kbd" note="500 ms hover, instant on keyboard focus; ⌘ on macOS">
        <Row label="tooltip">
          <Tooltip content="Magnify part of the frame" shortcut="1">
            <Button id="g-tooltip-target" variant="ghost">Hover me</Button>
          </Tooltip>
          <Tooltip content="Below, with a long explanation that wraps onto a second line when needed" side="bottom">
            <Button variant="ghost">Bottom</Button>
          </Tooltip>
        </Row>
        <Row label="kbd">
          <Kbd keys="Mod+K" />
          <Kbd keys="Mod+Shift+Z" />
          <Kbd keys="?" />
          <Kbd keys="Alt+ArrowLeft" />
          <Kbd keys="Space" />
        </Row>
      </Demo>

      <Demo title="Popover · Menu · ContextMenu" note="native popover + anchor positioning; roving focus, type-ahead">
        <Row>
          <Popover
            aria-label="Voice engine"
            width={280}
            trigger={<Button id="g-popover-trigger">Popover</Button>}
          >
            <div className="flex flex-col gap-2 p-3">
              <div className="text-sm font-semibold">Voice engine</div>
              <div className="text-xs text-fg-muted">Connected · localhost:8880</div>
              <TextField mono readOnly value="docker run -p 8880:8880 kokoro" aria-label="Command" size="xs" />
              <div className="flex justify-end gap-2">
                <Button size="xs">Test</Button>
                <Button size="xs" variant="primary">Copy</Button>
              </div>
            </div>
          </Popover>
          <Menu aria-label="Clip" items={items} trigger={<Button id="g-menu-trigger" iconRight={MoreHorizontal}>Menu</Button>} />
          <Menu
            aria-label="Project"
            align="end"
            items={[{ label: "Open…", icon: FolderOpen, shortcut: "Mod+O" }, { label: "Export…", icon: Download, shortcut: "Mod+E" }]}
            trigger={<IconButton icon={MoreHorizontal} label="Project menu" />}
          />
        </Row>
        <ContextMenu items={items} aria-label="Clip">
          <div id="g-context-target" tabIndex={0} className="flex h-16 items-center justify-center rounded-md border border-dashed border-line-control text-xs text-fg-subtle">
            Right-click (or Shift+F10) here
          </div>
        </ContextMenu>
        <div className="text-xs text-fg-subtle">Last menu action: {last || "—"}</div>
      </Demo>

      <Demo title="Modal · Drawer" note="native <dialog>.showModal(); drawer overlays from the side">
        <Row>
          <Button id="g-modal-open" variant="primary" onClick={() => setModal(true)} kbd="Mod+E">
            Export…
          </Button>
          <Button id="g-drawer-open" onClick={() => setDrawer(true)}>
            Open drawer
          </Button>
        </Row>
        <Modal
          open={modal}
          onClose={() => setModal(false)}
          title="Export"
          description="2 languages · 1440×900 recording"
          footer={
            <>
              <span className="mr-auto text-xs text-fg-subtle">≈ 40 s per language</span>
              <Button onClick={() => setModal(false)}>Cancel</Button>
              <Button variant="primary" onClick={() => setModal(false)}>Export 2 videos</Button>
            </>
          }
        >
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <span className="w-label text-sm text-fg-muted">Resolution</span>
              <Segmented aria-label="Resolution" value={res} onChange={setRes} options={[{ value: "native", label: "Native" }, { value: "1080p", label: "1080p" }, { value: "720p", label: "720p" }]} />
            </div>
            <div className="flex items-center gap-3">
              <span className="w-label text-sm text-fg-muted">File name</span>
              <TextField data-autofocus defaultValue="final_{lang}_v4" aria-label="File name" className="flex-1" />
            </div>
            <div className="flex items-center gap-3">
              <span className="w-label text-sm text-fg-muted">More</span>
              <Menu aria-label="More" items={items} trigger={<Button size="xs" iconRight={MoreHorizontal}>Menu inside modal</Button>} />
            </div>
          </div>
        </Modal>
        <Drawer open={drawer} onClose={() => setDrawer(false)} title="Outline" width={280} top={0}>
          <div className="flex flex-col gap-1 p-2">
            {EFFECT_KINDS.map((k) => {
              const I = EFFECT_META[k].icon;
              return (
                <button key={k} type="button" className="flex h-control-sm items-center gap-2 rounded-sm px-2 text-sm hover:bg-hover">
                  <I size={14} strokeWidth={1.75} className={EFFECT_META[k].cls.text} aria-hidden />
                  {EFFECT_META[k].label}
                </button>
              );
            })}
          </div>
        </Drawer>
      </Demo>
    </GallerySection>
  );
}
