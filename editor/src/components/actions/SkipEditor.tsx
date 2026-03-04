import type { TimelineAction } from "../../types";
import { formatTime } from "../../lib/formatTime";
import { useProjectStore } from "../../stores/useProjectStore";

interface SkipEditorProps {
  action: TimelineAction;
  onUpdate: (partial: Partial<TimelineAction>) => void;
}

export function SkipEditor({ action, onUpdate }: SkipEditorProps) {
  const duration = useProjectStore((s) => s.project?.recordingDuration ?? 0);

  const skipDuration = (action.skipEndTimestamp ?? action.timestamp + 3) - action.timestamp;

  return (
    <>
      <div>
        <label className="block text-xs text-slate-400 font-medium mb-1">
          Cut End Timestamp (seconds)
        </label>
        <input
          type="number"
          value={action.skipEndTimestamp ?? action.timestamp + 3}
          onChange={(e) =>
            onUpdate({ skipEndTimestamp: parseFloat(e.target.value) || action.timestamp + 3 })
          }
          min={action.timestamp + 0.1}
          max={duration}
          step={0.5}
          className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-blue-400"
        />
      </div>

      <div className="text-xs text-slate-400 bg-red-500/10 border border-red-500/20 rounded p-2">
        Removing {skipDuration.toFixed(1)}s from {formatTime(action.timestamp)} to{" "}
        {formatTime(action.skipEndTimestamp ?? action.timestamp + 3)}
      </div>

      <div className="text-[10px] text-slate-600 border-t border-slate-800 pt-2">
        This section will be completely removed from the final video.
        Use for wrong clicks, loading screens, or mistakes.
      </div>
    </>
  );
}
