import { useCallback } from "react";
import { useProjectStore } from "../../stores/useProjectStore";
import { formatTime } from "../../lib/formatTime";
import type { TimelineAction } from "../../types";

const api = window.electronAPI;

interface MusicEditorProps {
  action: TimelineAction;
  onUpdate: (partial: Partial<TimelineAction>) => void;
}

export function MusicEditor({ action, onUpdate }: MusicEditorProps) {
  const duration = useProjectStore((s) => s.project?.recordingDuration ?? 0);

  const handlePickFile = useCallback(async () => {
    const result = await api.saveFile({
      title: "Select Audio File",
      filters: [
        { name: "Audio", extensions: ["mp3", "wav", "ogg", "m4a", "aac"] },
      ],
    });
    if (result) {
      onUpdate({ musicPath: result });
    }
  }, [onUpdate]);

  return (
    <>
      <div>
        <label className="block text-xs text-slate-400 font-medium mb-1">
          Audio File
        </label>
        {action.musicPath ? (
          <div className="flex items-center gap-2">
            <span className="flex-1 text-xs text-slate-300 truncate" title={action.musicPath}>
              {action.musicPath.split("/").pop()}
            </span>
            <button
              onClick={handlePickFile}
              className="px-2 py-1 bg-slate-700 hover:bg-slate-600 text-white text-[10px] rounded"
            >
              Change
            </button>
            <button
              onClick={() => onUpdate({ musicPath: undefined })}
              className="px-2 py-1 text-red-400 hover:text-red-300 text-[10px]"
            >
              Remove
            </button>
          </div>
        ) : (
          <button
            onClick={handlePickFile}
            className="w-full px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs rounded"
          >
            Select Audio File...
          </button>
        )}
      </div>

      <div>
        <label className="block text-xs text-slate-400 font-medium mb-1">
          Volume ({((action.musicVolume ?? 0.5) * 100).toFixed(0)}%)
        </label>
        <input
          type="range"
          min={0}
          max={100}
          value={(action.musicVolume ?? 0.5) * 100}
          onChange={(e) => onUpdate({ musicVolume: parseInt(e.target.value) / 100 })}
          className="w-full"
        />
      </div>

      <div>
        <label className="block text-xs text-slate-400 font-medium mb-1">
          Duck to ({((action.musicDuckTo ?? 0.2) * 100).toFixed(0)}%) during narration
        </label>
        <input
          type="range"
          min={0}
          max={100}
          value={(action.musicDuckTo ?? 0.2) * 100}
          onChange={(e) => onUpdate({ musicDuckTo: parseInt(e.target.value) / 100 })}
          className="w-full"
        />
        <div className="flex justify-between text-[10px] text-slate-500">
          <span>Muted</span>
          <span>Full volume</span>
        </div>
      </div>

      <div>
        <label className="block text-xs text-slate-400 font-medium mb-1">
          End Timestamp (seconds)
        </label>
        <input
          type="number"
          value={action.musicEndTimestamp ?? duration}
          onChange={(e) =>
            onUpdate({ musicEndTimestamp: parseFloat(e.target.value) || duration })
          }
          min={action.timestamp}
          max={duration}
          step={1}
          className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-blue-400"
        />
        <div className="text-[10px] text-slate-500 mt-1">
          Music plays: {formatTime(action.timestamp)} → {formatTime(action.musicEndTimestamp ?? duration)}
        </div>
      </div>

      <div className="text-[10px] text-slate-600 border-t border-slate-800 pt-2">
        Background music with auto-ducking: volume drops during narration segments
        and rises back up during silent parts.
      </div>
    </>
  );
}
