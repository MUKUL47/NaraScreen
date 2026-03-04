import { useProjectStore } from "../../stores/useProjectStore";
import { LanguageAudioSection } from "./NarrateEditor";
import type { TimelineAction } from "../../types";

interface ZoomEditorProps {
  action: TimelineAction;
  onUpdate: (partial: Partial<TimelineAction>) => void;
}

export function ZoomEditor({ action, onUpdate }: ZoomEditorProps) {
  const drawingZoom = useProjectStore((s) => s.drawingZoom);
  const setDrawingZoom = useProjectStore((s) => s.setDrawingZoom);
  const viewport = useProjectStore((s) => s.project?.viewport);

  // Calculate zoom scale
  const zoomScale = action.zoomRect && viewport
    ? Math.min(viewport.width / action.zoomRect[2], viewport.height / action.zoomRect[3]).toFixed(1)
    : null;

  return (
    <>
      <div>
        <label className="block text-xs text-slate-400 font-medium mb-1">
          Zoom Region
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
            : action.zoomRect
              ? "Redraw Region"
              : "Draw Zoom Region"}
        </button>
        {action.zoomRect && (
          <div className="mt-1 flex items-center justify-between">
            <span className="text-[10px] text-slate-500">
              {action.zoomRect[0]},{action.zoomRect[1]} {action.zoomRect[2]}x
              {action.zoomRect[3]}
              {zoomScale && (
                <span className="text-violet-400 ml-1.5">{zoomScale}x zoom</span>
              )}
            </span>
            <button
              onClick={() => onUpdate({ zoomRect: undefined })}
              className="text-[10px] text-red-400 hover:text-red-300"
            >
              Clear
            </button>
          </div>
        )}
      </div>

      <div>
        <label className="block text-xs text-slate-400 font-medium mb-1">
          Animation Duration (seconds)
        </label>
        <input
          type="number"
          value={action.zoomDuration ?? 1}
          onChange={(e) =>
            onUpdate({ zoomDuration: parseFloat(e.target.value) || 1 })
          }
          min={0.3}
          max={5}
          step={0.1}
          className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-blue-400"
        />
      </div>

      <div>
        <label className="block text-xs text-slate-400 font-medium mb-1">
          Hold Duration (seconds)
        </label>
        <input
          type="number"
          value={action.zoomHold ?? ""}
          onChange={(e) =>
            onUpdate({
              zoomHold: e.target.value ? parseFloat(e.target.value) : undefined,
            })
          }
          placeholder="Auto (audio duration or 3s)"
          min={0}
          step={0.5}
          className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-blue-400"
        />
      </div>

      <LanguageAudioSection
        action={action}
        label="Narration (plays while zoomed)"
      />

      <div className="text-[10px] text-slate-600 border-t border-slate-800 pt-2">
        Flow: Zoom In ({action.zoomDuration ?? 1}s) → Hold (frozen) → Zoom Out ({action.zoomDuration ?? 1}s)
      </div>
    </>
  );
}
