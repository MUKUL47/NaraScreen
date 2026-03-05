import { useProjectStore } from "../../stores/useProjectStore";
import { LanguageAudioSection } from "./NarrateEditor";
import type { TimelineAction } from "../../types";

interface BlurEditorProps {
  action: TimelineAction;
  onUpdate: (partial: Partial<TimelineAction>) => void;
}

export function BlurEditor({ action, onUpdate }: BlurEditorProps) {
  const drawingZoom = useProjectStore((s) => s.drawingZoom);
  const setDrawingZoom = useProjectStore((s) => s.setDrawingZoom);

  const rects = action.blurRects ?? [];

  return (
    <>
      <div>
        <label className="block text-xs text-zinc-400 font-medium mb-1">
          Blur Regions ({rects.length})
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
            ? "Drawing... (click & drag on video)"
            : rects.length > 0
              ? "Add Another Region"
              : "Draw Blur Region"}
        </button>
        {rects.length > 0 && (
          <div className="mt-1.5 space-y-1">
            {rects.map((r, i) => (
              <div key={i} className="flex items-center justify-between bg-zinc-900 rounded px-2 py-1">
                <span className="text-[10px] text-zinc-400 font-mono">
                  #{i + 1}: {r[0]},{r[1]} {r[2]}x{r[3]}
                </span>
                <button
                  onClick={() => {
                    const updated = rects.filter((_, idx) => idx !== i);
                    onUpdate({ blurRects: updated.length > 0 ? updated : undefined });
                  }}
                  className="text-[10px] text-red-400 hover:text-red-300"
                >
                  Remove
                </button>
              </div>
            ))}
            <button
              onClick={() => onUpdate({ blurRects: undefined })}
              className="text-[10px] text-red-400 hover:text-red-300"
            >
              Clear All
            </button>
          </div>
        )}
      </div>

      <div>
        <label className="block text-xs text-zinc-400 font-medium mb-1">
          Blur Radius ({action.blurRadius ?? 20})
        </label>
        <input
          type="range"
          min={1}
          max={50}
          value={action.blurRadius ?? 20}
          onChange={(e) => onUpdate({ blurRadius: parseInt(e.target.value) })}
          className="w-full"
        />
        <div className="flex justify-between text-[10px] text-zinc-500">
          <span>Subtle</span>
          <span>Heavy</span>
        </div>
      </div>

      <div>
        <label className="block text-xs text-zinc-400 font-medium mb-1">
          Duration (seconds)
        </label>
        <input
          type="number"
          value={action.blurDuration ?? 3}
          onChange={(e) => onUpdate({ blurDuration: parseFloat(e.target.value) || 3 })}
          min={0.5}
          max={30}
          step={0.5}
          className="w-full bg-zinc-950 border border-zinc-700/50 rounded px-3 py-1.5 text-sm text-zinc-200 focus:outline-none focus:border-blue-400"
        />
      </div>

      <LanguageAudioSection action={action} label="Narration (optional)" />

      <label className="flex items-center gap-2 cursor-pointer mt-2">
        <input
          type="checkbox"
          checked={action.freeze ?? false}
          onChange={(e) => onUpdate({ freeze: e.target.checked })}
          className="w-3 h-3 rounded border-zinc-700/50 bg-zinc-900 text-violet-500 focus:ring-violet-500 focus:ring-offset-0"
        />
        <span className="text-[10px] text-zinc-400">Freeze video during blur</span>
      </label>

      <div className="text-[10px] text-zinc-600 border-t border-zinc-800/50 pt-2">
        Blurs selected regions to hide sensitive content. Draw multiple regions to blur several areas at once.
      </div>
    </>
  );
}
