import { useProjectStore } from "../../stores/useProjectStore";
import { LanguageAudioSection } from "./NarrateEditor";
import type { TimelineAction } from "../../types";

interface SpotlightEditorProps {
  action: TimelineAction;
  onUpdate: (partial: Partial<TimelineAction>) => void;
}

export function SpotlightEditor({ action, onUpdate }: SpotlightEditorProps) {
  const drawingZoom = useProjectStore((s) => s.drawingZoom);
  const setDrawingZoom = useProjectStore((s) => s.setDrawingZoom);

  return (
    <>
      <div>
        <label className="block text-xs text-slate-400 font-medium mb-1">
          Spotlight Region
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
            ? "Drawing... (click & drag on video)"
            : action.spotlightRect
              ? "Redraw Region"
              : "Draw Spotlight Region"}
        </button>
        {action.spotlightRect && (
          <div className="mt-1 flex items-center justify-between">
            <span className="text-[10px] text-slate-500">
              {action.spotlightRect[0]},{action.spotlightRect[1]} {action.spotlightRect[2]}x
              {action.spotlightRect[3]}
            </span>
            <button
              onClick={() => onUpdate({ spotlightRect: undefined })}
              className="text-[10px] text-red-400 hover:text-red-300"
            >
              Clear
            </button>
          </div>
        )}
      </div>

      <div>
        <label className="block text-xs text-slate-400 font-medium mb-1">
          Dim Opacity ({((action.dimOpacity ?? 0.7) * 100).toFixed(0)}%)
        </label>
        <input
          type="range"
          min={0}
          max={100}
          value={(action.dimOpacity ?? 0.7) * 100}
          onChange={(e) => onUpdate({ dimOpacity: parseInt(e.target.value) / 100 })}
          className="w-full"
        />
        <div className="flex justify-between text-[10px] text-slate-500">
          <span>0% (no dim)</span>
          <span>100% (black)</span>
        </div>
      </div>

      <div>
        <label className="block text-xs text-slate-400 font-medium mb-1">
          Duration (seconds)
        </label>
        <input
          type="number"
          value={action.spotlightDuration ?? 3}
          onChange={(e) =>
            onUpdate({ spotlightDuration: parseFloat(e.target.value) || 3 })
          }
          min={0.5}
          max={30}
          step={0.5}
          className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-blue-400"
        />
      </div>

      <LanguageAudioSection
        action={action}
        label="Narration (optional)"
      />

      <label className="flex items-center gap-2 cursor-pointer mt-2">
        <input
          type="checkbox"
          checked={action.freeze ?? false}
          onChange={(e) => onUpdate({ freeze: e.target.checked })}
          className="w-3 h-3 rounded border-slate-600 bg-slate-800 text-violet-500 focus:ring-violet-500 focus:ring-offset-0"
        />
        <span className="text-[10px] text-slate-400">Freeze video during spotlight</span>
      </label>

      <div className="text-[10px] text-slate-600 border-t border-slate-800 pt-2">
        Highlights the selected region while dimming the rest of the screen.
      </div>
    </>
  );
}
