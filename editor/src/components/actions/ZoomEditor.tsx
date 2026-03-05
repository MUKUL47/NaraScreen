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

  // Merge legacy single rect into multi-rect array for display
  const rects = action.zoomRects ?? (action.zoomRect ? [action.zoomRect] : []);

  return (
    <>
      <div>
        <label className="block text-xs text-zinc-400 font-medium mb-1">
          Zoom Regions ({rects.length}) — played in sequence
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
              ? "Add Another Zoom"
              : "Draw Zoom Region"}
        </button>
        {rects.length > 0 && (
          <div className="mt-1.5 space-y-1">
            {rects.map((r, i) => {
              const zoomScale = viewport
                ? Math.min(viewport.width / r[2], viewport.height / r[3]).toFixed(1)
                : null;
              return (
                <div key={i} className="flex items-center justify-between bg-zinc-900 rounded px-2 py-1">
                  <span className="text-[10px] text-zinc-400 font-mono">
                    #{i + 1}: {r[0]},{r[1]} {r[2]}x{r[3]}
                    {zoomScale && <span className="text-violet-400 ml-1">{zoomScale}x</span>}
                  </span>
                  <button
                    onClick={() => {
                      const updated = rects.filter((_, idx) => idx !== i);
                      onUpdate({
                        zoomRects: updated.length > 0 ? updated : undefined,
                        zoomRect: undefined,
                      });
                    }}
                    className="text-[10px] text-red-400 hover:text-red-300"
                  >
                    Remove
                  </button>
                </div>
              );
            })}
            <button
              onClick={() => onUpdate({ zoomRects: undefined, zoomRect: undefined })}
              className="text-[10px] text-red-400 hover:text-red-300"
            >
              Clear All
            </button>
          </div>
        )}
      </div>

      <div>
        <label className="block text-xs text-zinc-400 font-medium mb-1">
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
          className="w-full bg-zinc-950 border border-zinc-700/50 rounded px-3 py-1.5 text-sm text-zinc-200 focus:outline-none focus:border-blue-400"
        />
      </div>

      <div>
        <label className="block text-xs text-zinc-400 font-medium mb-1">
          Hold Duration per zoom (seconds)
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
          className="w-full bg-zinc-950 border border-zinc-700/50 rounded px-3 py-1.5 text-sm text-zinc-200 focus:outline-none focus:border-blue-400"
        />
      </div>

      <LanguageAudioSection
        action={action}
        label="Narration (plays during first zoom hold)"
      />

      <div className="text-[10px] text-zinc-600 border-t border-zinc-800/50 pt-2">
        {rects.length <= 1
          ? `Flow: Zoom In (${action.zoomDuration ?? 1}s) → Hold (frozen) → Zoom Out (${action.zoomDuration ?? 1}s)`
          : `Flow: ${rects.map((_, i) => `Zoom ${i + 1}`).join(" → ")} — each: In → Hold → Out (frozen frame)`}
      </div>
    </>
  );
}
