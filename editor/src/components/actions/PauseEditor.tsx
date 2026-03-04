import { useCallback } from "react";
import type { TimelineAction } from "../../types";

interface PauseEditorProps {
  action: TimelineAction;
  onUpdate: (partial: Partial<TimelineAction>) => void;
}

export function PauseEditor({ action, onUpdate }: PauseEditorProps) {
  const handleResumeChange = useCallback(
    (val: string) => {
      if (val === "custom") {
        onUpdate({ resumeAfter: 3 });
      } else {
        onUpdate({ resumeAfter: val as "narration" | "zoom" });
      }
    },
    [onUpdate],
  );

  return (
    <div>
      <label className="block text-xs text-slate-400 font-medium mb-1">
        Resume after
      </label>
      <select
        value={
          typeof action.resumeAfter === "number"
            ? "custom"
            : action.resumeAfter || "narration"
        }
        onChange={(e) => handleResumeChange(e.target.value)}
        className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-blue-400"
      >
        <option value="narration">After narration ends</option>
        <option value="zoom">After zoom completes</option>
        <option value="custom">Custom duration</option>
      </select>

      {typeof action.resumeAfter === "number" && (
        <input
          type="number"
          value={action.resumeAfter}
          onChange={(e) =>
            onUpdate({ resumeAfter: parseFloat(e.target.value) || 1 })
          }
          min={0.5}
          step={0.5}
          placeholder="Duration (seconds)"
          className="w-full mt-2 bg-slate-900 border border-slate-600 rounded px-3 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-blue-400"
        />
      )}
    </div>
  );
}
