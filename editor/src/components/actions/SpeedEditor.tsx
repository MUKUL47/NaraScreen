import type { TimelineAction } from "../../types";
import { formatTime } from "../../lib/formatTime";
import { useProjectStore } from "../../stores/useProjectStore";

interface SpeedEditorProps {
  action: TimelineAction;
  onUpdate: (partial: Partial<TimelineAction>) => void;
}

export function SpeedEditor({ action, onUpdate }: SpeedEditorProps) {
  const duration = useProjectStore((s) => s.project?.recordingDuration ?? 0);

  return (
    <>
      <div>
        <label className="block text-xs text-zinc-400 font-medium mb-1">
          Speed Factor
        </label>
        <select
          value={action.speedFactor ?? 2}
          onChange={(e) => onUpdate({ speedFactor: parseFloat(e.target.value) })}
          className="w-full bg-zinc-950 border border-zinc-700/50 rounded px-3 py-1.5 text-sm text-zinc-200 focus:outline-none focus:border-blue-400"
        >
          <option value={0.25}>0.25x (very slow)</option>
          <option value={0.5}>0.5x (slow motion)</option>
          <option value={1.5}>1.5x</option>
          <option value={2}>2x (fast forward)</option>
          <option value={3}>3x (very fast)</option>
          <option value={4}>4x</option>
        </select>
      </div>

      <div>
        <label className="block text-xs text-zinc-400 font-medium mb-1">
          End Timestamp (seconds)
        </label>
        <input
          type="number"
          value={action.speedEndTimestamp ?? action.timestamp + 5}
          onChange={(e) =>
            onUpdate({ speedEndTimestamp: parseFloat(e.target.value) || action.timestamp + 5 })
          }
          min={action.timestamp + 0.5}
          max={duration}
          step={0.5}
          className="w-full bg-zinc-950 border border-zinc-700/50 rounded px-3 py-1.5 text-sm text-zinc-200 focus:outline-none focus:border-blue-400"
        />
        <div className="text-[10px] text-zinc-500 mt-1">
          Speed change: {formatTime(action.timestamp)} → {formatTime(action.speedEndTimestamp ?? action.timestamp + 5)}
        </div>
      </div>

      <div className="text-[10px] text-zinc-600 border-t border-zinc-800/50 pt-2">
        {(action.speedFactor ?? 2) > 1
          ? `Fast-forwards through this section at ${action.speedFactor ?? 2}x speed.`
          : `Slows down this section to ${action.speedFactor ?? 0.5}x speed.`}
      </div>
    </>
  );
}
