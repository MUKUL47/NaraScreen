import { useProjectStore } from "../../stores/useProjectStore";
import type { TimelineAction, CalloutPanel } from "../../types";

interface CalloutEditorProps {
  action: TimelineAction;
  onUpdate: (partial: Partial<TimelineAction>) => void;
}

export function CalloutEditor({ action, onUpdate }: CalloutEditorProps) {
  const drawingZoom = useProjectStore((s) => s.drawingZoom);
  const setDrawingZoom = useProjectStore((s) => s.setDrawingZoom);
  const duration = useProjectStore((s) => s.project?.recordingDuration ?? 999);

  const panels = action.calloutPanels ?? [];

  const updatePanel = (index: number, partial: Partial<CalloutPanel>) => {
    const updated = panels.map((p, i) =>
      i === index ? { ...p, ...partial } : p,
    );
    onUpdate({ calloutPanels: updated });
  };

  const removePanel = (index: number) => {
    const updated = panels.filter((_, i) => i !== index);
    onUpdate({ calloutPanels: updated.length > 0 ? updated : undefined });
  };

  return (
    <>
      {/* Text Panels */}
      <div>
        <label className="block text-xs text-zinc-400 font-medium mb-1">
          Text Panels ({panels.length})
        </label>
        <button
          onClick={() => setDrawingZoom(!drawingZoom)}
          className={`px-3 py-1.5 text-xs rounded w-full ${
            drawingZoom
              ? "bg-yellow-600 text-white"
              : "bg-zinc-800 hover:bg-zinc-700 text-zinc-300"
          }`}
        >
          {drawingZoom
            ? "Draw region on video..."
            : panels.length > 0
              ? "Add Another Panel"
              : "Draw Text Region on Video"}
        </button>

        {panels.length > 0 && (
          <div className="mt-2 space-y-2">
            {panels.map((panel, i) => (
              <div
                key={i}
                className="bg-zinc-900 rounded-md p-2 space-y-1.5 border border-zinc-800/50"
              >
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-zinc-500 font-mono">
                    #{i + 1} — {panel.rect[0]},{panel.rect[1]}{" "}
                    {panel.rect[2]}x{panel.rect[3]}
                  </span>
                  <button
                    onClick={() => removePanel(i)}
                    className="text-[10px] text-red-400 hover:text-red-300"
                  >
                    Remove
                  </button>
                </div>

                <textarea
                  value={panel.text}
                  onChange={(e) => updatePanel(i, { text: e.target.value })}
                  rows={2}
                  placeholder="Text to display..."
                  className="w-full bg-zinc-950 border border-zinc-700/50 rounded px-2 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-blue-400 resize-none"
                />

                <div>
                  <label className="block text-[10px] text-zinc-500 mb-0.5">
                    Font Size ({panel.fontSize}px)
                  </label>
                  <input
                    type="range"
                    min={12}
                    max={72}
                    value={panel.fontSize}
                    onChange={(e) =>
                      updatePanel(i, { fontSize: parseInt(e.target.value) })
                    }
                    className="w-full"
                  />
                  <div className="flex justify-between text-[9px] text-zinc-600">
                    <span>12px</span>
                    <span>72px</span>
                  </div>
                </div>
              </div>
            ))}
            <button
              onClick={() => onUpdate({ calloutPanels: undefined })}
              className="text-[10px] text-red-400 hover:text-red-300"
            >
              Clear All
            </button>
          </div>
        )}
      </div>

      {/* Legacy single-text fallback for old callouts without panels */}
      {panels.length === 0 && (
        <div>
          <label className="block text-xs text-zinc-400 font-medium mb-1">
            Quick Text (no position)
          </label>
          <textarea
            value={action.calloutText ?? ""}
            onChange={(e) => onUpdate({ calloutText: e.target.value })}
            rows={2}
            placeholder="Or type text without drawing a region..."
            className="w-full bg-zinc-950 border border-zinc-700/50 rounded px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-blue-400 resize-none"
          />
        </div>
      )}

      <div>
        <label className="block text-xs text-zinc-400 font-medium mb-1">
          Style
        </label>
        <select
          value={action.calloutStyle ?? "label"}
          onChange={(e) =>
            onUpdate({ calloutStyle: e.target.value as TimelineAction["calloutStyle"] })
          }
          className="w-full bg-zinc-950 border border-zinc-700/50 rounded px-3 py-1.5 text-sm text-zinc-200 focus:outline-none focus:border-blue-400"
        >
          <option value="label">Label (boxed text)</option>
          <option value="step-counter">Step Counter (numbered badge)</option>
          <option value="lower-third">Lower Third (bottom banner)</option>
        </select>
      </div>

      {action.calloutStyle === "step-counter" && (
        <div>
          <label className="block text-xs text-zinc-400 font-medium mb-1">
            Step Number
          </label>
          <input
            type="number"
            value={action.calloutStep ?? 1}
            onChange={(e) => onUpdate({ calloutStep: parseInt(e.target.value) || 1 })}
            min={1}
            className="w-full bg-zinc-950 border border-zinc-700/50 rounded px-3 py-1.5 text-sm text-zinc-200 focus:outline-none focus:border-blue-400"
          />
        </div>
      )}

      <div>
        <label className="block text-xs text-zinc-400 font-medium mb-1">
          Duration (seconds)
        </label>
        <input
          type="number"
          value={action.calloutDuration ?? 3}
          onChange={(e) =>
            onUpdate({ calloutDuration: parseFloat(e.target.value) || 3 })
          }
          min={0.5}
          max={duration}
          step={0.5}
          className="w-full bg-zinc-950 border border-zinc-700/50 rounded px-3 py-1.5 text-sm text-zinc-200 focus:outline-none focus:border-blue-400"
        />
      </div>

      <label className="flex items-center gap-2 cursor-pointer mt-2">
        <input
          type="checkbox"
          checked={action.freeze ?? false}
          onChange={(e) => onUpdate({ freeze: e.target.checked })}
          className="w-3 h-3 rounded border-zinc-700 bg-zinc-900 accent-zinc-400"
        />
        <span className="text-[10px] text-zinc-400">Freeze video during callout</span>
      </label>

      <div className="text-[10px] text-zinc-600 border-t border-zinc-800/50 pt-2">
        Draw regions on the video to place text panels. Each panel has its own text and font size.
      </div>
    </>
  );
}
