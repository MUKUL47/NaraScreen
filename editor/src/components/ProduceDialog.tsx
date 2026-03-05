import { useState, useMemo, useCallback } from "react";
import { useProjectStore } from "../stores/useProjectStore";
import { ACTION_COLORS, ACTION_DISPLAY_NAMES } from "../lib/constants";
import { ActionIcon } from "./ActionIcon";
import { formatTime } from "../lib/formatTime";
import type { TimelineAction } from "../types";

interface ProduceDialogProps {
  mode: "produce" | "preview";
  onConfirm: (selectedIds: string[]) => void;
  onCancel: () => void;
}

function getActionLabel(action: TimelineAction): string {
  if (action.name) return action.name;
  const displayName = ACTION_DISPLAY_NAMES[action.type] || action.type;
  return `${displayName} @ ${formatTime(action.timestamp)}`;
}

function getActionEndTime(action: TimelineAction): number | null {
  switch (action.type) {
    case "spotlight": return action.timestamp + (action.spotlightDuration ?? 3);
    case "blur": return action.timestamp + (action.blurDuration ?? 3);
    case "callout": return action.timestamp + (action.calloutDuration ?? 3);
    case "mute": return action.muteEndTimestamp ?? null;
    case "speed": return action.speedEndTimestamp ?? null;
    case "skip": return action.skipEndTimestamp ?? null;
    case "music": return action.musicEndTimestamp ?? null;
    case "zoom": return action.timestamp + (action.zoomDuration ?? 1) + (action.zoomHold ?? 2);
    default: return null;
  }
}

export function ProduceDialog({ mode, onConfirm, onCancel }: ProduceDialogProps) {
  const actions = useProjectStore((s) => s.project?.actions ?? []);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(actions.map((a) => a.id)));

  const grouped = useMemo(() => {
    const map = new Map<string, TimelineAction[]>();
    for (const a of actions) {
      const list = map.get(a.type) || [];
      list.push(a);
      map.set(a.type, list);
    }
    return map;
  }, [actions]);

  const toggleAction = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleType = useCallback((type: string) => {
    const typeActions = grouped.get(type);
    if (!typeActions) return;
    setSelected((prev) => {
      const next = new Set(prev);
      const allSelected = typeActions.every((a) => next.has(a.id));
      for (const a of typeActions) {
        if (allSelected) next.delete(a.id);
        else next.add(a.id);
      }
      return next;
    });
  }, [grouped]);

  const selectAll = useCallback(() => {
    setSelected(new Set(actions.map((a) => a.id)));
  }, [actions]);

  const selectNone = useCallback(() => {
    setSelected(new Set());
  }, []);

  const selectedCount = selected.size;

  return (
    <div className="fixed inset-0 z-[9999] bg-black/70 backdrop-blur-sm flex items-center justify-center" onClick={onCancel}>
      <div
        className="bg-zinc-900 border border-zinc-700/50 rounded-xl w-[480px] max-h-[70vh] flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-zinc-800/60">
          <h2 className="text-sm font-bold text-zinc-200">
            {mode === "produce" ? "Produce Video" : "Preview Video"}
          </h2>
          <p className="text-[11px] text-zinc-500 mt-1">
            Select which effects to include. Each selected effect type runs as a separate pass.
          </p>
        </div>

        {/* Action list */}
        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-3">
          {Array.from(grouped.entries()).map(([type, typeActions]) => {
            const allSelected = typeActions.every((a) => selected.has(a.id));
            const someSelected = typeActions.some((a) => selected.has(a.id));
            return (
              <div key={type}>
                {/* Type header */}
                <button
                  onClick={() => toggleType(type)}
                  className="flex items-center gap-2 w-full text-left mb-1.5"
                >
                  <input
                    type="checkbox"
                    checked={allSelected}
                    ref={(el) => { if (el) el.indeterminate = someSelected && !allSelected; }}
                    onChange={() => toggleType(type)}
                    className="accent-violet-500 w-3.5 h-3.5"
                  />
                  <ActionIcon type={type} size={13} className={ACTION_COLORS[type]?.replace("bg-", "text-").replace("-500", "-400") || "text-zinc-400"} />
                  <span className="text-xs font-semibold text-zinc-300 uppercase tracking-wide">
                    {ACTION_DISPLAY_NAMES[type] || type}
                  </span>
                  <span className="text-[10px] text-zinc-600 ml-auto">
                    {typeActions.filter((a) => selected.has(a.id)).length}/{typeActions.length}
                  </span>
                </button>

                {/* Individual actions */}
                <div className="ml-5 space-y-0.5">
                  {typeActions.map((action) => {
                    const end = getActionEndTime(action);
                    return (
                      <label
                        key={action.id}
                        className="flex items-center gap-2 px-2 py-1 rounded hover:bg-zinc-800/50 cursor-pointer group"
                      >
                        <input
                          type="checkbox"
                          checked={selected.has(action.id)}
                          onChange={() => toggleAction(action.id)}
                          className="accent-violet-500 w-3 h-3"
                        />
                        <span className="text-[11px] text-zinc-300 flex-1 truncate">
                          {getActionLabel(action)}
                        </span>
                        <span className="text-[10px] text-zinc-600 font-mono tabular-nums">
                          {formatTime(action.timestamp)}
                          {end != null ? ` - ${formatTime(end)}` : ""}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            );
          })}

          {actions.length === 0 && (
            <p className="text-xs text-zinc-500 text-center py-4">No actions to produce.</p>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-zinc-800/60 flex items-center gap-2">
          <button
            onClick={selectAll}
            className="text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            Select All
          </button>
          <span className="text-zinc-700">|</span>
          <button
            onClick={selectNone}
            className="text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            Select None
          </button>
          <span className="text-[10px] text-zinc-600 ml-1">
            {selectedCount} selected
          </span>

          <div className="flex-1" />

          <button
            onClick={onCancel}
            className="px-4 py-1.5 text-xs text-zinc-400 hover:text-zinc-200 rounded-md hover:bg-zinc-800 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm(Array.from(selected))}
            disabled={selectedCount === 0}
            className={`px-4 py-1.5 text-xs font-medium text-white rounded-md shadow-lg transition-colors disabled:opacity-30 ${
              mode === "produce"
                ? "bg-emerald-600 hover:bg-emerald-500 shadow-emerald-500/20"
                : "bg-blue-600 hover:bg-blue-500 shadow-blue-500/20"
            }`}
          >
            {mode === "produce" ? "Produce" : "Preview"} ({selectedCount})
          </button>
        </div>
      </div>
    </div>
  );
}
