import { useCallback, useMemo } from "react";
import { useProjectStore } from "../stores/useProjectStore";
import { ACTION_COLORS, ACTION_DISPLAY_NAMES } from "../lib/constants";
import { ActionIcon, TrashIcon } from "./ActionIcon";
import type { TimelineAction } from "../types";
import { PauseEditor } from "./actions/PauseEditor";
import { ZoomEditor } from "./actions/ZoomEditor";
import { NarrateEditor } from "./actions/NarrateEditor";
import { SpotlightEditor } from "./actions/SpotlightEditor";
import { SpeedEditor } from "./actions/SpeedEditor";
import { SkipEditor } from "./actions/SkipEditor";
import { CalloutEditor } from "./actions/CalloutEditor";
import { MusicEditor } from "./actions/MusicEditor";

export function ActionPanel() {
  const project = useProjectStore((s) => s.project);
  const selectedActionId = useProjectStore((s) => s.selectedActionId);
  const updateAction = useProjectStore((s) => s.updateAction);
  const deleteAction = useProjectStore((s) => s.deleteAction);

  const action = useMemo(
    () => project?.actions.find((a) => a.id === selectedActionId) ?? null,
    [project, selectedActionId],
  );

  const handleUpdate = useCallback(
    (partial: Partial<TimelineAction>) => {
      if (!action) return;
      updateAction(action.id, partial);
    },
    [action, updateAction],
  );

  if (!action) {
    return (
      <div className="w-72 bg-slate-900/60 border-l border-slate-700/50 p-6 flex items-center justify-center shrink-0">
        <p className="text-slate-600 text-xs text-center leading-relaxed">
          Select an action on the timeline to edit,
          or click "+ Add Action" to create one.
        </p>
      </div>
    );
  }

  return (
    <div className="w-72 bg-slate-900/60 border-l border-slate-700/50 flex flex-col shrink-0 max-h-full">
      <div className="overflow-y-auto flex-1 p-3 space-y-3">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ActionIcon type={action.type} size={14} className={ACTION_COLORS[action.type]?.replace("bg-", "text-").replace("-500", "-400") || "text-slate-400"} />
            <h2 className="text-xs font-bold text-slate-200 uppercase tracking-wide">
              {ACTION_DISPLAY_NAMES[action.type] || action.type}
            </h2>
            <span className="text-[10px] text-slate-600 font-mono">{action.id}</span>
          </div>
          <button
            onClick={() => deleteAction(action.id)}
            className="flex items-center gap-1 text-[10px] text-red-400/70 hover:text-red-300 px-1.5 py-0.5 rounded hover:bg-red-400/10 transition-colors"
          >
            <TrashIcon size={11} />
            Delete
          </button>
        </div>

        {/* Timestamp */}
        <div>
          <label className="block text-[10px] text-slate-500 font-medium mb-1 uppercase tracking-wider">
            Timestamp (s)
          </label>
          <input
            type="number"
            value={action.timestamp}
            onChange={(e) =>
              handleUpdate({ timestamp: parseFloat(e.target.value) || 0 })
            }
            min={0}
            max={project?.recordingDuration ?? 999}
            step={0.1}
            className="w-full bg-slate-800 border border-slate-700 rounded-md px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500/20"
          />
        </div>

        {/* Type-specific editors */}
        {action.type === "pause" && (
          <PauseEditor action={action} onUpdate={handleUpdate} />
        )}
        {action.type === "zoom" && (
          <ZoomEditor action={action} onUpdate={handleUpdate} />
        )}
        {action.type === "narrate" && (
          <NarrateEditor action={action} />
        )}
        {action.type === "spotlight" && (
          <SpotlightEditor action={action} onUpdate={handleUpdate} />
        )}
        {action.type === "speed" && (
          <SpeedEditor action={action} onUpdate={handleUpdate} />
        )}
        {action.type === "skip" && (
          <SkipEditor action={action} onUpdate={handleUpdate} />
        )}
        {action.type === "callout" && (
          <CalloutEditor action={action} onUpdate={handleUpdate} />
        )}
        {action.type === "music" && (
          <MusicEditor action={action} onUpdate={handleUpdate} />
        )}
      </div>
    </div>
  );
}
