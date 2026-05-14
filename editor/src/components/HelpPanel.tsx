import { useEffect } from "react";
import { X } from "lucide-react";

interface HelpPanelProps {
  onClose: () => void;
}

interface FeatureEntry {
  name: string;
  what: string;
  actions: string[];
}

interface Section {
  title: string;
  entries: FeatureEntry[];
}

const SECTIONS: Section[] = [
  {
    title: "Recording & Importing",
    entries: [
      {
        name: "Record Screen",
        what: "Capture your screen to a new session folder.",
        actions: [
          "Click Record Screen and pick a display.",
          "Name the recording or accept the timestamp default.",
          "Click Stop & Edit to finish, or Discard to throw it away (confirmation required).",
        ],
      },
      {
        name: "Import Video",
        what: "Bring an existing MP4 into NaraScreen as a session.",
        actions: ["Click Import Video, pick a file, choose a destination folder."],
      },
      {
        name: "Open",
        what: "Reopen any existing session folder. The last session auto-restores on launch.",
        actions: ["Click Open and choose a folder containing demo-project.json."],
      },
    ],
  },
  {
    title: "Project",
    entries: [
      {
        name: "Save",
        what: "Persist the project to disk. Auto-saves 3s after any edit.",
        actions: ["Ctrl+S, or click Save (amber = unsaved changes)."],
      },
      {
        name: "Undo / Redo",
        what: "Step through up to 50 recent edits.",
        actions: ["Ctrl+Z to undo, Ctrl+Shift+Z (or Ctrl+Y) to redo."],
      },
      {
        name: "Produce",
        what: "Render the final video via ffmpeg. Pick which actions to include, resolution, and quality.",
        actions: [
          "Click Produce, choose actions/resolution/quality, confirm.",
          "Cancel mid-production from the loading overlay.",
        ],
      },
      {
        name: "Versions",
        what: "Browse produced output videos for this session.",
        actions: ["Click Versions to toggle the list, then Open or Show in Folder."],
      },
    ],
  },
  {
    title: "Video Player",
    entries: [
      {
        name: "Playback",
        what: "Standard video controls driven by the playhead.",
        actions: [
          "Space — play / pause.",
          "← / → — seek 1s (Shift = 5s).",
          "Click in the timeline to seek directly.",
        ],
      },
    ],
  },
  {
    title: "Timeline",
    entries: [
      {
        name: "Actions on the timeline",
        what: "Each action sits on a lane at a specific timestamp. Range actions (spotlight/blur/mute/speed/skip/callout/music) have a duration.",
        actions: [
          "Click an action pill to select it.",
          "Drag the right edge of a range action to resize.",
          "Drag the resize handle between the player and timeline to change timeline height.",
        ],
      },
      {
        name: "Quick-add (1–9)",
        what: "Drop a new action at the current playhead time.",
        actions: [
          "1 Zoom · 2 Narrate · 3 Spotlight · 4 Blur · 5 Mute · 6 Speed · 7 Callout · 8 Music · 9 Skip.",
        ],
      },
      {
        name: "Duplicate / Split / Delete",
        what: "Edit the selected action.",
        actions: [
          "D — duplicate (+1s).",
          "B — split a range action at the playhead.",
          "Del / Backspace — delete.",
          "Esc — deselect.",
        ],
      },
    ],
  },
  {
    title: "Region Annotations (Zoom · Spotlight · Blur · Callout)",
    entries: [
      {
        name: "Draw a region",
        what: "Place a rectangle on the video for the selected action. Multiple regions per action are supported.",
        actions: [
          "Open the action editor, click Draw … Region.",
          "Click and drag on the video. The live W×H readout shows the size in video pixels.",
          "Drawing mode stays on so you can add more regions; click the button again to exit.",
        ],
      },
      {
        name: "Move",
        what: "Reposition an existing region without redrawing it.",
        actions: [
          "Click and drag any region on the video. Selected regions show a move cursor.",
          "A quick click (no drag) just selects the action.",
          "Esc cancels an in-progress drag.",
        ],
      },
      {
        name: "Resize",
        what: "Change a region's size via handles on the selected overlay.",
        actions: [
          "Select the action so the eight resize handles appear.",
          "Drag a corner or edge handle. Minimum size is 10×10 px.",
        ],
      },
      {
        name: "Nudge",
        what: "Pixel-precise positioning after a rough drag.",
        actions: [
          "Alt + ← ↑ → ↓ — move every region in the selected action by 1 px.",
          "Alt + Shift + Arrow — move by 10 px.",
        ],
      },
      {
        name: "Remove",
        what: "Drop individual regions or clear them all.",
        actions: [
          "Use the per-region Remove button in the editor sidebar.",
          "Or Clear All to drop them all (confirmation required).",
        ],
      },
    ],
  },
  {
    title: "Action Types",
    entries: [
      { name: "Zoom",      what: "Smoothly zoom into one or more regions in sequence.",                actions: ["Set duration + hold. Add per-target narration in the editor."] },
      { name: "Narrate",   what: "TTS voiceover via Kokoro. Multi-language support.",                  actions: ["Type text per language, pick voice/speed, Generate Audio.", "Generation auto-saves the project first."] },
      { name: "Spotlight", what: "Highlight one or more regions while dimming the rest.",             actions: ["Adjust dim opacity, duration, freeze toggle."] },
      { name: "Blur",      what: "Mask regions to hide sensitive content.",                           actions: ["Adjust blur radius, duration, freeze toggle."] },
      { name: "Callout",   what: "Text panels positioned anywhere on the video.",                     actions: ["Draw a region, type text, set font size.", "Style: label / step counter / lower-third."] },
      { name: "Mute",      what: "Strip audio over a time range.",                                    actions: [] },
      { name: "Speed Ramp", what: "Change playback speed over a range.",                              actions: ["Set the speed factor (e.g. 2× fast-forward, 0.5× slow-mo)."] },
      { name: "Skip",      what: "Cut a section out of the recording.",                               actions: [] },
      { name: "Music",     what: "Background music with auto-ducking under narration.",               actions: ["Pick a file, set volume + duck-to level."] },
      { name: "Pause",     what: "Freeze a frame.",                                                   actions: ["Resume after narration, after zoom, or a fixed duration."] },
    ],
  },
  {
    title: "Voice Engine",
    entries: [
      {
        name: "Kokoro TTS",
        what: "Local TTS engine. The mic icon in the navbar shows status (green = connected).",
        actions: [
          "If disconnected, run: docker run -d -p 8880:8880 ghcr.io/remsky/kokoro-fastapi-cpu:latest",
          "Endpoint defaults to localhost:8880; configurable per project.",
        ],
      },
    ],
  },
];

export function HelpPanel({ onClose }: HelpPanelProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopImmediatePropagation();
        e.preventDefault();
        onClose();
      }
    };
    // Capture phase so we beat the global "Esc deselects action" handler.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-9999 bg-black/70 flex items-center justify-center p-6"
      onClick={onClose}
    >
      <div
        className="bg-zinc-900 border border-zinc-800 rounded-lg w-full max-w-3xl max-h-[90vh] flex flex-col shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b border-zinc-800 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-zinc-200">NaraScreen — Help</h2>
            <p className="text-[11px] text-zinc-500 mt-0.5">Every feature, what it does, and how to use it.</p>
          </div>
          <button
            onClick={onClose}
            title="Close (Esc)"
            className="p-1 text-zinc-500 hover:text-zinc-200 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        <div className="overflow-y-auto px-5 py-4 space-y-5">
          {SECTIONS.map((section) => (
            <section key={section.title}>
              <h3 className="text-[11px] uppercase tracking-wider text-zinc-500 font-semibold mb-2">
                {section.title}
              </h3>
              <div className="space-y-3">
                {section.entries.map((entry) => (
                  <div key={entry.name} className="bg-zinc-950/60 border border-zinc-800/60 rounded-md px-3 py-2">
                    <div className="text-xs font-semibold text-zinc-200">{entry.name}</div>
                    <p className="text-[11px] text-zinc-400 mt-0.5 leading-relaxed">{entry.what}</p>
                    {entry.actions.length > 0 && (
                      <ul className="mt-1.5 space-y-0.5">
                        {entry.actions.map((a, i) => (
                          <li key={i} className="text-[11px] text-zinc-300 leading-relaxed flex gap-1.5">
                            <span className="text-zinc-600 shrink-0">›</span>
                            <span>{a}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            </section>
          ))}

          <section>
            <h3 className="text-[11px] uppercase tracking-wider text-zinc-500 font-semibold mb-2">
              Keyboard shortcuts
            </h3>
            <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-[11px] text-zinc-300 bg-zinc-950/60 border border-zinc-800/60 rounded-md px-3 py-2.5">
              <KeyRow keys="Ctrl+S" desc="Save project" />
              <KeyRow keys="Ctrl+Z" desc="Undo" />
              <KeyRow keys="Ctrl+Shift+Z / Ctrl+Y" desc="Redo" />
              <KeyRow keys="Space" desc="Play / pause" />
              <KeyRow keys="← / →" desc="Seek 1s (Shift = 5s)" />
              <KeyRow keys="1–9" desc="Add action at playhead" />
              <KeyRow keys="D" desc="Duplicate selected action" />
              <KeyRow keys="B" desc="Split selected action at playhead" />
              <KeyRow keys="Del / Backspace" desc="Delete selected action" />
              <KeyRow keys="Esc" desc="Deselect / cancel drag" />
              <KeyRow keys="Alt + Arrow" desc="Nudge rects by 1px" />
              <KeyRow keys="Alt + Shift + Arrow" desc="Nudge rects by 10px" />
            </div>
          </section>
        </div>

        <div className="px-5 py-2.5 border-t border-zinc-800 text-[10px] text-zinc-500 flex justify-end">
          Press Esc or click outside to close.
        </div>
      </div>
    </div>
  );
}

function KeyRow({ keys, desc }: { keys: string; desc: string }) {
  return (
    <div className="flex items-center gap-2 min-w-0">
      <kbd className="bg-zinc-800 border border-zinc-700 rounded px-1.5 py-px text-[10px] font-mono text-zinc-200 whitespace-nowrap shrink-0">
        {keys}
      </kbd>
      <span className="text-zinc-400 truncate">{desc}</span>
    </div>
  );
}
