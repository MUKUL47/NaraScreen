import { useEffect, useState } from "react";
import { FileVideo, SquareDashedMousePointer } from "lucide-react";
import { EFFECT_META } from "../../lib/effects-meta";
import {
  Badge, Button, Chip, EmptyState, InlineAlert, ProgressBar, ProgressRing, ScrollArea, Spinner, Splitter, StageList, StatusDot,
} from "../../ui";
import { Demo, GallerySection, Row } from "./Demo";

export function FeedbackSection() {
  const [prog, setProg] = useState({ pct: 0, run: 0 });
  const [split, setSplit] = useState(160);
  const [filters, setFilters] = useState<string[]>(["zoom"]);
  useEffect(() => {
    // Input climbs but sometimes jumps back; the bar holds its peak until a new run (resetKey).
    let tick = 0;
    const t = setInterval(() => {
      tick++;
      setProg((p) => (p.pct >= 100 ? { pct: 0, run: p.run + 1 } : { pct: Math.min(100, p.pct + (tick % 3 === 0 ? -12 : 9)), run: p.run }));
    }, 500);
    return () => clearInterval(t);
  }, []);
  const toggle = (k: string) => setFilters((f) => (f.includes(k) ? f.filter((x) => x !== k) : [...f, k]));

  return (
    <GallerySection id="feedback" title="Feedback">
      <Demo title="ProgressBar · ProgressRing · Spinner" note="monotonic: never goes backwards">
        <ProgressBar value={62} label="EN · final pass" eta="≈0:18 left" valueText="EN 62 %, final pass" />
        <ProgressBar value={prog.pct} label={`Monotonic demo · input ${prog.pct} %`} resetKey={prog.run} />
        <ProgressBar label="Preparing…" showValue={false} />
        <Row label="ring / spinner">
          <ProgressRing value={41} aria-label="Export 41 %" />
          <ProgressRing aria-label="Working" />
          <ProgressRing value={100} tone="success" aria-label="Done" />
          <Spinner size={12} />
          <Spinner size={14} />
          <Spinner size={16} label="Loading" />
        </Row>
      </Demo>

      <Demo title="StageList" note="render passes / script stages">
        <StageList
          aria-label="Render passes"
          stages={[
            { id: "n", label: "Narration", status: "done", duration: 3.2 },
            { id: "s", label: "Skip + speed", status: "done", duration: 1.1 },
            { id: "b", label: "Blur", status: "warning", detail: "1 region outside the frame", duration: 0.8 },
            { id: "f", label: "Final pass", status: "running", detail: "62 % · ≈0:18 left" },
            { id: "m", label: "Music", status: "pending" },
            { id: "c", label: "Cards", status: "skipped" },
          ]}
        />
        <StageList variant="inline" stages={[{ id: "a", label: "narration", status: "done" }, { id: "b", label: "skip", status: "done" }, { id: "c", label: "final", status: "running" }, { id: "d", label: "music", status: "pending" }]} />
        <StageList stages={[{ id: "x", label: "Check", status: "error", detail: "Selector '#save' not found on step 3" }]} />
      </Demo>

      <Demo title="Badge · Chip · StatusDot">
        <Row label="badge">
          <Badge>12</Badge>
          <Badge tone="success" dot>Ready</Badge>
          <Badge tone="warning">3 stale</Badge>
          <Badge tone="danger" variant="outline">Failed</Badge>
          <Badge tone="brand" size="xs">NEW</Badge>
          <Badge tone="fx-zoom" icon={SquareDashedMousePointer}>2.3×</Badge>
        </Row>
        <Row label="chip">
          {["zoom", "spotlight", "narrate"].map((k) => (
            <Chip key={k} tone={`fx-${k}` as "fx-zoom"} selected={filters.includes(k)} onClick={() => toggle(k)} icon={EFFECT_META[k as "zoom"].icon}>
              {EFFECT_META[k as "zoom"].label}
            </Chip>
          ))}
          <Chip onRemove={() => undefined}>HI</Chip>
        </Row>
        <Row label="status dot">
          <span className="flex items-center gap-1.5 text-xs"><StatusDot tone="success" label="Voice connected" /> Voice</span>
          <span className="flex items-center gap-1.5 text-xs"><StatusDot tone="warning" /> Unsaved</span>
          <span className="flex items-center gap-1.5 text-xs"><StatusDot tone="success" /><StatusDot tone="warning" shape="half" /><StatusDot tone="neutral" shape="hollow" /> ready / partial / missing</span>
          <span className="flex items-center gap-1.5 text-xs"><StatusDot tone="record" pulse /> REC</span>
        </Row>
      </Demo>

      <Demo title="InlineAlert" note="replaces banners and toasts">
        <InlineAlert tone="warning" title="Voice engine not running" action={<Button size="xs">Copy start command</Button>}>
          Narration can't be generated until Kokoro is reachable on localhost:8880.
        </InlineAlert>
        <InlineAlert tone="danger" title="Export failed" onDismiss={() => undefined}>ffmpeg exited with code 1 during the final pass.</InlineAlert>
        <InlineAlert tone="info">Effects inside a cut won't appear in the video.</InlineAlert>
        <InlineAlert tone="success" title="Exported 2 videos" />
      </Demo>

      <Demo title="EmptyState">
        <EmptyState icon={FileVideo} title="No exports yet" body="Export the video to see versions here." action={<Button variant="primary" size="sm">Export…</Button>} secondary={<Button variant="ghost" size="sm">Learn more</Button>} />
        <EmptyState size="compact" icon={SquareDashedMousePointer} title="No regions" body="Draw a region on the video · R" />
      </Demo>

      <Demo title="Splitter · ScrollArea" note="drag, or focus and use ←/→, Home/End, Enter resets">
        <div className="flex h-40 overflow-hidden rounded-md border border-line-subtle">
          <div className="flex items-center justify-center bg-panel text-xs text-fg-subtle" style={{ width: split }}>
            {Math.round(split)} px
          </div>
          <Splitter orientation="vertical" value={split} onChange={setSplit} min={80} max={300} defaultValue={160} aria-label="Resize panel" />
          <ScrollArea className="flex-1 bg-app p-2">
            {Array.from({ length: 30 }, (_, i) => (
              <div key={i} className="py-0.5 text-xs text-fg-muted">Row {i + 1}</div>
            ))}
          </ScrollArea>
        </div>
      </Demo>
    </GallerySection>
  );
}
