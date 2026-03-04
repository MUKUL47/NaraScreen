import { useState, useEffect, useCallback, useRef } from "react";
import { useProjectStore } from "../stores/useProjectStore";
import { formatTime } from "../lib/formatTime";

export function CaptureToolbar() {
  const isRecording = useProjectStore((s) => s.isRecording);
  const stopScreenCapture = useProjectStore((s) => s.stopScreenCapture);

  const [timer, setTimer] = useState(0);
  const [stopping, setStopping] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Timer
  useEffect(() => {
    if (isRecording) {
      setTimer(0);
      timerRef.current = setInterval(() => setTimer((t) => t + 1), 1000);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isRecording]);

  const handleStop = useCallback(async () => {
    setStopping(true);
    await stopScreenCapture();
    setStopping(false);
  }, [stopScreenCapture]);

  return (
    <div className="h-12 bg-slate-800 border-b border-slate-700 flex items-center px-4 gap-3 shrink-0">
      <span className="text-sm font-semibold text-red-400 mr-2">
        Recording
      </span>

      <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
      <span className="text-sm text-slate-300 font-mono">
        {formatTime(timer)}
      </span>

      <div className="flex-1" />

      <button
        onClick={handleStop}
        disabled={stopping}
        className="px-4 py-1.5 bg-green-600 hover:bg-green-500 disabled:bg-slate-700 text-white text-xs rounded font-medium"
      >
        {stopping ? "Stopping..." : "Stop & Edit"}
      </button>
    </div>
  );
}
