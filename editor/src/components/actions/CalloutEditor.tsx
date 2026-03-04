import { useProjectStore } from "../../stores/useProjectStore";
import type { TimelineAction } from "../../types";

interface CalloutEditorProps {
  action: TimelineAction;
  onUpdate: (partial: Partial<TimelineAction>) => void;
}

export function CalloutEditor({ action, onUpdate }: CalloutEditorProps) {
  const drawingZoom = useProjectStore((s) => s.drawingZoom);
  const setDrawingZoom = useProjectStore((s) => s.setDrawingZoom);

  return (
    <>
      <div>
        <label className="block text-xs text-slate-400 font-medium mb-1">
          Callout Text
        </label>
        <textarea
          value={action.calloutText ?? ""}
          onChange={(e) => onUpdate({ calloutText: e.target.value })}
          rows={2}
          placeholder="Text to display on screen..."
          className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-blue-400 resize-none"
        />
      </div>

      <div>
        <label className="block text-xs text-slate-400 font-medium mb-1">
          Style
        </label>
        <select
          value={action.calloutStyle ?? "label"}
          onChange={(e) =>
            onUpdate({ calloutStyle: e.target.value as TimelineAction["calloutStyle"] })
          }
          className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-blue-400"
        >
          <option value="label">Label (boxed text)</option>
          <option value="step-counter">Step Counter (numbered badge)</option>
          <option value="lower-third">Lower Third (bottom banner)</option>
        </select>
      </div>

      {action.calloutStyle === "step-counter" && (
        <div>
          <label className="block text-xs text-slate-400 font-medium mb-1">
            Step Number
          </label>
          <input
            type="number"
            value={action.calloutStep ?? 1}
            onChange={(e) => onUpdate({ calloutStep: parseInt(e.target.value) || 1 })}
            min={1}
            className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-blue-400"
          />
        </div>
      )}

      {action.calloutStyle !== "lower-third" && (
        <div>
          <label className="block text-xs text-slate-400 font-medium mb-1">
            Position
          </label>
          <button
            onClick={() => setDrawingZoom(!drawingZoom)}
            className={`px-3 py-1.5 text-xs rounded w-full ${
              drawingZoom
                ? "bg-yellow-600 text-white"
                : "bg-slate-700 hover:bg-slate-600 text-slate-300"
            }`}
          >
            {drawingZoom
              ? "Click on video to place..."
              : action.calloutPosition
                ? `Position: ${action.calloutPosition[0]}, ${action.calloutPosition[1]}`
                : "Click to place on video"}
          </button>
        </div>
      )}

      <div>
        <label className="block text-xs text-slate-400 font-medium mb-1">
          Duration (seconds)
        </label>
        <input
          type="number"
          value={action.calloutDuration ?? 3}
          onChange={(e) =>
            onUpdate({ calloutDuration: parseFloat(e.target.value) || 3 })
          }
          min={0.5}
          max={30}
          step={0.5}
          className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-blue-400"
        />
      </div>

      <label className="flex items-center gap-2 cursor-pointer mt-2">
        <input
          type="checkbox"
          checked={action.freeze ?? false}
          onChange={(e) => onUpdate({ freeze: e.target.checked })}
          className="w-3 h-3 rounded border-slate-600 bg-slate-800 text-violet-500 focus:ring-violet-500 focus:ring-offset-0"
        />
        <span className="text-[10px] text-slate-400">Freeze video during callout</span>
      </label>

      <div className="text-[10px] text-slate-600 border-t border-slate-800 pt-2">
        {action.freeze ? "Overlays text on a freeze frame." : "Overlays text on moving video."}
      </div>
    </>
  );
}
