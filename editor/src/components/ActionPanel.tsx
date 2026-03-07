import { useCallback, useMemo } from "react";
import { useProjectStore } from "../stores/useProjectStore";
import { ACTION_TEXT_COLORS, ACTION_DISPLAY_NAMES, ACTION_BG_COLORS } from "../lib/constants";
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
import { BlurEditor } from "./actions/BlurEditor";
import { MuteEditor } from "./actions/MuteEditor";

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
      <div className="w-72 bg-zinc-950 border-l border-zinc-800 p-6 flex items-center justify-center shrink-0">
        <p className="text-zinc-600 text-xs text-center">
          Select an action to edit.
        </p>
      </div>
    );
  }

  const textColor = ACTION_TEXT_COLORS[action.type] || "text-zinc-400";

  return (
    <div className="w-72 bg-zinc-950 border-l border-zinc-800 flex flex-col shrink-0 max-h-full">
      <div className="overflow-y-auto flex-1 p-3 space-y-3">
        {/* Header */}
        <div className="flex items-center justify-between px-2.5 py-2 bg-zinc-900 border border-zinc-800 rounded-md">
          <div className="flex items-center gap-2 min-w-0">
            <ActionIcon type={action.type} size={14} className={textColor} />
            <h2 className={`text-xs font-semibold truncate ${textColor}`}>
              {ACTION_DISPLAY_NAMES[action.type] || action.type}
            </h2>
          </div>
          <button
            onClick={() => deleteAction(action.id)}
            className="flex items-center gap-1 text-[10px] text-red-400/70 hover:text-red-300 px-1.5 py-0.5 rounded-md hover:bg-red-400/10 transition-colors shrink-0"
          >
            <TrashIcon size={11} />
            Delete
          </button>
        </div>

        {/* Name */}
        <div>
          <label className="block text-[10px] text-zinc-500 font-medium mb-1">
            Name
          </label>
          <input
            type="text"
            value={action.name ?? ""}
            onChange={(e) => handleUpdate({ name: e.target.value || undefined })}
            placeholder={`${ACTION_DISPLAY_NAMES[action.type] || action.type} @ ${action.timestamp.toFixed(1)}s`}
            className="w-full bg-zinc-900 border border-zinc-700 rounded-md px-2.5 py-1.5 text-xs text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-500 transition-colors"
          />
        </div>

        {/* Timestamp */}
        <div>
          <label className="block text-[10px] text-zinc-500 font-medium mb-1">
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
            className="w-full bg-zinc-900 border border-zinc-700 rounded-md px-2.5 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-zinc-500 transition-colors"
          />
        </div>

        <div className="border-t border-zinc-800/30" />

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
        {action.type === "blur" && (
          <BlurEditor action={action} onUpdate={handleUpdate} />
        )}
        {action.type === "mute" && (
          <MuteEditor action={action} onUpdate={handleUpdate} />
        )}
      </div>
    </div>
  );
}
