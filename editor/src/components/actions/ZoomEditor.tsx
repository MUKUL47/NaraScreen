import { useState } from "react";
import { useProjectStore } from "../../stores/useProjectStore";
import { LanguageAudioSection } from "./NarrateEditor";
import type { TimelineAction, ZoomTarget } from "../../types";

interface ZoomEditorProps {
  action: TimelineAction;
  onUpdate: (partial: Partial<TimelineAction>) => void;
}

/** Helper: merge legacy zoomRect/zoomRects into modern zoomTargets */
function getZoomTargets(action: TimelineAction): ZoomTarget[] {
  if (action.zoomTargets?.length) return action.zoomTargets;
  if (action.zoomRects?.length) return action.zoomRects.map((rect) => ({ rect }));
  if (action.zoomRect) return [{ rect: action.zoomRect }];
  return [];
}

export function ZoomEditor({ action, onUpdate }: ZoomEditorProps) {
  const drawingZoom = useProjectStore((s) => s.drawingZoom);
  const setDrawingZoom = useProjectStore((s) => s.setDrawingZoom);
  const viewport = useProjectStore((s) => s.project?.viewport);
  const languages = useProjectStore((s) => s.project?.tts?.languages) ?? ["en"];

  const targets = getZoomTargets(action);
  const isMultiZoom = targets.length > 1;

  const updateTarget = (index: number, partial: Partial<ZoomTarget>) => {
    const updated = targets.map((t, i) => (i === index ? { ...t, ...partial } : t));
    onUpdate({ zoomTargets: updated, zoomRect: undefined, zoomRects: undefined });
  };

  const removeTarget = (index: number) => {
    const updated = targets.filter((_, i) => i !== index);
    onUpdate({
      zoomTargets: updated.length > 0 ? updated : undefined,
      zoomRect: undefined,
      zoomRects: undefined,
    });
  };

  return (
    <>
      <div>
        <label className="block text-xs text-zinc-400 font-medium mb-1">
          Zoom Targets ({targets.length}) — played in sequence
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
            : targets.length > 0
              ? "Add Another Zoom"
              : "Draw Zoom Region"}
        </button>
        {targets.length > 0 && (
          <div className="mt-1.5 space-y-2">
            {targets.map((target, i) => (
              <ZoomTargetItem
                key={i}
                index={i}
                target={target}
                viewport={viewport}
                languages={languages}
                showNarration={isMultiZoom}
                onUpdate={(partial) => updateTarget(i, partial)}
                onRemove={() => removeTarget(i)}
              />
            ))}
            <button
              onClick={() =>
                onUpdate({ zoomTargets: undefined, zoomRect: undefined, zoomRects: undefined })
              }
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

      {/* Single zoom: full narration controls at action level (TTS generate, play, voice) */}
      {!isMultiZoom && (
        <LanguageAudioSection
          action={action}
          label="Narration (plays while zoomed)"
        />
      )}

      <div className="text-[10px] text-zinc-600 border-t border-zinc-800/50 pt-2">
        {targets.length <= 1
          ? `Flow: Zoom In (${action.zoomDuration ?? 1}s) → Hold (frozen + narration) → Zoom Out (${action.zoomDuration ?? 1}s)`
          : `Flow: ${targets.map((_, i) => `Zoom ${i + 1}`).join(" → ")} — each: In → Hold (narration) → Out`}
      </div>
    </>
  );
}

/** Individual zoom target: rect info + per-target narration (only shown for multi-zoom) */
function ZoomTargetItem({
  index,
  target,
  viewport,
  languages,
  showNarration,
  onUpdate,
  onRemove,
}: {
  index: number;
  target: ZoomTarget;
  viewport?: { width: number; height: number };
  languages: string[];
  showNarration: boolean;
  onUpdate: (partial: Partial<ZoomTarget>) => void;
  onRemove: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [activeLang, setActiveLang] = useState(languages[0] || "en");

  const r = target.rect;
  const zoomScale = viewport
    ? Math.min(viewport.width / r[2], viewport.height / r[3]).toFixed(1)
    : null;

  const currentLang = languages.includes(activeLang) ? activeLang : languages[0] || "en";
  const narrationText = target.narrations?.[currentLang] ?? "";

  const handleNarrationChange = (value: string) => {
    onUpdate({
      narrations: { ...target.narrations, [currentLang]: value || undefined } as Record<string, string>,
    });
  };

  return (
    <div className="bg-zinc-900 rounded overflow-hidden">
      {/* Header row */}
      <div className="flex items-center justify-between px-2 py-1">
        <button
          onClick={() => showNarration && setExpanded(!expanded)}
          className={`flex items-center gap-1.5 text-[10px] text-zinc-400 font-mono ${showNarration ? "hover:text-zinc-200 cursor-pointer" : "cursor-default"}`}
        >
          {showNarration && <span className="text-[8px]">{expanded ? "\u25BC" : "\u25B6"}</span>}
          #{index + 1}: {r[0]},{r[1]} {r[2]}x{r[3]}
          {zoomScale && <span className="text-violet-400">{zoomScale}x</span>}
          {showNarration && narrationText && <span className="text-emerald-400 ml-1">has narration</span>}
        </button>
        <button
          onClick={onRemove}
          className="text-[10px] text-red-400 hover:text-red-300"
        >
          Remove
        </button>
      </div>

      {/* Expanded: per-target narration input (multi-zoom only) */}
      {showNarration && expanded && (
        <div className="px-2 pb-2 space-y-1.5">
          {languages.length > 1 && (
            <select
              value={currentLang}
              onChange={(e) => setActiveLang(e.target.value)}
              className="w-full bg-zinc-950 border border-zinc-700/50 rounded px-2 py-0.5 text-[10px] text-zinc-300 focus:outline-none focus:border-violet-500"
            >
              {languages.map((lang) => (
                <option key={lang} value={lang}>{lang.toUpperCase()}</option>
              ))}
            </select>
          )}

          <textarea
            value={narrationText}
            onChange={(e) => handleNarrationChange(e.target.value)}
            rows={2}
            placeholder={`Narration for zoom #${index + 1} (${currentLang})...`}
            className="w-full bg-zinc-950 border border-zinc-700/50 rounded px-2 py-1.5 text-[11px] text-zinc-200 focus:outline-none focus:border-blue-400 resize-none"
          />
          <div className="text-[9px] text-zinc-600">
            TTS generated at produce time. Leave empty to skip narration for this zoom.
          </div>
        </div>
      )}
    </div>
  );
}
