import type { TimelineAction } from "../../types";
import { formatTime } from "../../lib/formatTime";
import { useProjectStore } from "../../stores/useProjectStore";

interface MuteEditorProps {
  action: TimelineAction;
  onUpdate: (partial: Partial<TimelineAction>) => void;
}

export function MuteEditor({ action, onUpdate }: MuteEditorProps) {
  const duration = useProjectStore((s) => s.project?.recordingDuration ?? 0);

  const muteDuration = (action.muteEndTimestamp ?? action.timestamp + 3) - action.timestamp;

  return (
    <>
      <div>
        <label className="block text-xs text-zinc-400 font-medium mb-1">
          Mute End Timestamp (seconds)
        </label>
        <input
          type="number"
          value={action.muteEndTimestamp ?? action.timestamp + 3}
          onChange={(e) =>
            onUpdate({ muteEndTimestamp: parseFloat(e.target.value) || action.timestamp + 3 })
          }
          min={action.timestamp + 0.1}
          max={duration}
          step={0.5}
          className="w-full bg-zinc-950 border border-zinc-700/50 rounded px-3 py-1.5 text-sm text-zinc-200 focus:outline-none focus:border-blue-400"
        />
      </div>

      <div className="text-xs text-zinc-400 bg-rose-500/10 border border-rose-500/20 rounded p-2">
        Muting audio for {muteDuration.toFixed(1)}s from {formatTime(action.timestamp)} to{" "}
        {formatTime(action.muteEndTimestamp ?? action.timestamp + 3)}
      </div>

      <div className="text-[10px] text-zinc-600 border-t border-zinc-800/50 pt-2">
        Audio will be silenced in this range. Video remains unchanged.
        Use for background noise, coughs, or unwanted sounds.
      </div>
    </>
  );
}
