import { useState } from "react";
import { Download, FolderOpen, Mic, Play, Plus, Redo2, Search, Settings, Trash2, Undo2, Video } from "lucide-react";
import {
  Button, Checkbox, ColorField, DirectionPad, IconButton, Listbox, NumberField, Segmented, Select, SliderField,
  TextArea, TextField, TimecodeField, Toggle, type ArrowFrom,
} from "../../ui";
import { Demo, GallerySection, Row } from "./Demo";

const VOICES = [
  { value: "af_heart", label: "Heart", description: "American English · female · default" },
  { value: "af_bella", label: "Bella", description: "American English · female" },
  { value: "am_michael", label: "Michael", description: "American English · male" },
  { value: "bf_emma", label: "Emma", description: "British English · female" },
  { value: "bm_george", label: "George", description: "British English · male", disabled: true },
];

export function ControlsSection() {
  const [num, setNum] = useState<number>(0.5);
  const [dim, setDim] = useState(70);
  const [feather, setFeather] = useState(24);
  const [factor, setFactor] = useState(2);
  const [tc, setTc] = useState(2.26);
  const [name, setName] = useState("Overdue card");
  const [text, setText] = useState("Spotlights glide in, with a soft glow around the overdue card.");
  const [sel, setSel] = useState("1080p");
  const [voice, setVoice] = useState<string>("af_heart");
  const [preset, setPreset] = useState<string | null>("focus");
  const [quality, setQuality] = useState("high");
  const [freeze, setFreeze] = useState(true);
  const [subs, setSubs] = useState(false);
  const [checks, setChecks] = useState({ a: true, b: false });
  const [color, setColor] = useState("#F97316");
  const [dir, setDir] = useState<ArrowFrom | undefined>(undefined);
  const [loading, setLoading] = useState(false);

  return (
    <GallerySection id="controls" title="Controls">
      <Demo title="Button" note="primary is inverse; colour is reserved for effects and status">
        <Row label="variants">
          <Button variant="primary" icon={Download} kbd="Mod+E">Export</Button>
          <Button icon={FolderOpen}>Open…</Button>
          <Button variant="ghost" icon={Plus}>Add</Button>
          <Button variant="danger" icon={Trash2}>Delete</Button>
          <Button variant="record" icon={Video}>Record</Button>
        </Row>
        <Row label="sizes">
          <Button size="xs">xs 24</Button>
          <Button size="sm">sm 28</Button>
          <Button size="md">md 32</Button>
          <Button size="lg" variant="primary">lg 36</Button>
        </Row>
        <Row label="states">
          <Button icon={Mic} loading={loading} onClick={() => { setLoading(true); setTimeout(() => setLoading(false), 2500); }}>
            Generate
          </Button>
          <Button loading variant="primary">Saving</Button>
          <Button disabled disabledReason="Draw a region first">Disabled</Button>
          <Button variant="primary" disabled>Export</Button>
        </Row>
      </Demo>

      <Demo title="IconButton" note="label = aria-label + tooltip; shortcut in the tooltip">
        <Row label="ghost">
          <IconButton icon={Undo2} label="Undo" shortcut="Mod+Z" />
          <IconButton icon={Redo2} label="Redo" shortcut="Mod+Shift+Z" />
          <IconButton icon={Settings} label="Project settings" shortcut="Mod+," />
          <IconButton icon={Search} label="Search" size={24} />
          <IconButton icon={Play} label="Play" size={32} shortcut="Space" />
        </Row>
        <Row label="pressed / other">
          <IconButton icon={Video} label="Live preview" pressed shortcut="P" />
          <IconButton icon={Plus} label="Add" variant="secondary" />
          <IconButton icon={Trash2} label="Remove region" variant="danger" />
          <IconButton icon={Mic} label="Generating" loading />
          <IconButton icon={Trash2} label="Disabled" disabled />
        </Row>
      </Demo>

      <Demo title="NumberField" note="type 0 / 0.5 / 2*1.5 · ↑↓ (Shift ×10) · Enter · Esc · drag the prefix">
        <Row label="default">
          <NumberField value={num} onChange={setNum} step={0.1} min={0} max={10} className="w-24" aria-label="Seconds" unit="s" />
          <span className="timecode text-xs text-fg-subtle">value = {num}</span>
        </Row>
        <Row label="scrub prefix">
          <NumberField value={feather} onChange={setFeather} min={0} max={64} scrubLabel="W" unit="px" className="w-24" aria-label="Width" />
          <NumberField value={factor} onChange={setFactor} min={0.25} max={4} step={0.25} scrubLabel="×" className="w-24" aria-label="Factor" />
        </Row>
        <Row label="mixed / error">
          <NumberField value={undefined} mixed onChange={() => undefined} className="w-24" aria-label="Mixed" unit="%" />
          <NumberField value={120} error="Max 100" onChange={() => undefined} className="w-24" aria-label="Error" id="nf-err" />
          <NumberField value={3} disabled onChange={() => undefined} className="w-20" aria-label="Disabled" />
        </Row>
      </Demo>

      <Demo title="SliderField" note="drag the label to scrub · double-click it to reset">
        <div className="w-[300px]">
          <SliderField label="Dim" value={dim} onChange={setDim} min={0} max={100} unit="%" defaultValue={70} />
          <SliderField label="Soft edge" value={feather} onChange={setFeather} min={0} max={64} unit="px" defaultValue={0} marks={[0, 12, 24]} />
          <SliderField label="Zoom" value={factor} onChange={setFactor} min={1} max={8} step={0.1} scale="log" unit="×" help="Logarithmic scale" />
          <SliderField label="Mixed" value={undefined} mixed onChange={() => undefined} min={0} max={100} unit="%" />
          <SliderField label="Disabled" value={40} disabled onChange={() => undefined} min={0} max={100} />
        </div>
      </Demo>

      <Demo title="TimecodeField · TextField" note="1:23.4 · 83.4 · +0.5 · -1">
        <Row label="timecode">
          <TimecodeField seconds={tc} onChange={setTc} className="w-24" aria-label="Start" />
          <TimecodeField seconds={5.86} onChange={() => undefined} className="w-24" aria-label="End" size="xs" />
          <TimecodeField seconds={undefined} mixed onChange={() => undefined} className="w-24" aria-label="Mixed" />
        </Row>
        <Row label="text">
          <TextField value={name} onChange={(e) => setName(e.target.value)} placeholder="Spotlight · 0:02" className="w-48" aria-label="Name" />
          <TextField icon={Search} placeholder="Search…" className="w-40" aria-label="Search" size="xs" />
        </Row>
        <Row label="error / mono">
          <TextField id="tf-err" value="https://" error="Enter a full URL" onChange={() => undefined} className="w-48" aria-label="URL" />
          <TextField mono value="/home/me/demo/recording.mp4" readOnly className="w-56" aria-label="Path" />
        </Row>
      </Demo>

      <Demo title="TextArea" note="autosize 2–8 lines · chars and ≈ seconds of speech">
        <TextArea value={text} onChange={(e) => setText(e.target.value)} counter="speech" aria-label="Narration" footer={<span className="text-xs text-fg-subtle">Voice: Heart</span>} />
        <TextArea value="" onChange={() => undefined} placeholder="Type the narration…" error="Text is required for HI" minRows={2} aria-label="Empty" />
      </Demo>

      <Demo title="Select · Listbox" note="native select for simple lists; Listbox for rich rows">
        <Row label="select">
          <Select value={sel} onChange={setSel} className="w-40" aria-label="Resolution" options={[{ value: "native", label: "Native 1440×900" }, { value: "1080p", label: "1080p" }, { value: "720p", label: "720p" }]} />
          <Select value="" placeholder="Choose…" onChange={() => undefined} className="w-32" aria-label="Empty" options={[{ value: "a", label: "A" }]} />
        </Row>
        <Row label="listbox">
          <Listbox
            value={voice}
            onChange={setVoice}
            searchable
            aria-label="Voice"
            className="w-56"
            options={VOICES.map((v) => ({
              ...v,
              icon: Mic,
              trailing: <IconButton icon={Play} label={`Play ${v.label} sample`} size={24} tooltip={false} onClick={(e) => e.stopPropagation()} />,
            }))}
          />
        </Row>
      </Demo>

      <Demo title="Segmented · Toggle · Checkbox">
        <Row label="segmented">
          <Segmented aria-label="Preset" value={preset} onChange={setPreset} options={[{ value: "subtle", label: "Subtle" }, { value: "focus", label: "Focus" }, { value: "dramatic", label: "Dramatic" }]} />
          <Segmented aria-label="Quality" size="xs" value={quality} onChange={setQuality} options={[{ value: "high", label: "High" }, { value: "medium", label: "Medium" }, { value: "low", label: "Low", disabled: true }]} />
        </Row>
        <Row label="no selection">
          <Segmented aria-label="Custom" value={null} onChange={setPreset} options={[{ value: "subtle", label: "Subtle" }, { value: "focus", label: "Focus" }]} />
        </Row>
        <div className="w-[300px]">
          <Toggle checked={freeze} onChange={setFreeze} label="Freeze video during effect" />
          <Toggle checked={subs} onChange={setSubs} label="Show subtitles" description="Word-by-word highlight" />
          <Toggle checked disabled onChange={() => undefined} label="Disabled (on)" />
        </div>
        <Row label="checkbox">
          <Checkbox checked={checks.a} onChange={(a) => setChecks({ ...checks, a })} label="Narration" />
          <Checkbox checked={checks.b} onChange={(b) => setChecks({ ...checks, b })} label="Spotlight" />
          <Checkbox checked={false} indeterminate onChange={() => undefined} label="Select all" />
          <Checkbox checked disabled onChange={() => undefined} label="Disabled" />
        </Row>
      </Demo>

      <Demo title="ColorField · DirectionPad" note="8 swatches + Custom (react-colorful) · 3×3 with Auto">
        <ColorField value={color} onChange={setColor} aria-label="Arrow colour" />
        <div className="flex items-center gap-4">
          <DirectionPad value={dir} onChange={setDir} />
          <span className="text-xs text-fg-subtle">arrowFrom = {dir ?? "auto"} · colour = {color}</span>
        </div>
      </Demo>
    </GallerySection>
  );
}
