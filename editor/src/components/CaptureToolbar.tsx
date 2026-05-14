import { useState, useEffect, useCallback, useRef } from "react";
import { useProjectStore } from "../stores/useProjectStore";
import { formatTime } from "../lib/formatTime";

export function CaptureToolbar() {
  const isRecording = useProjectStore((s) => s.isRecording);
  const stopScreenCapture = useProjectStore((s) => s.stopScreenCapture);
  const discardScreenCapture = useProjectStore((s) => s.discardScreenCapture);

  const [timer, setTimer] = useState(0);
  const [busy, setBusy] = useState<"stopping" | "discarding" | null>(null);
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
    setBusy("stopping");
    await stopScreenCapture();
    setBusy(null);
  }, [stopScreenCapture]);

  const handleDiscard = useCallback(async () => {
    if (!confirm("Discard this recording? The session folder will be moved to the trash.")) return;
    setBusy("discarding");
    await discardScreenCapture();
    setBusy(null);
  }, [discardScreenCapture]);

  return (
    <div className="h-12 bg-zinc-900 border-b border-zinc-700/40 flex items-center px-4 gap-3 shrink-0">
      <span className="text-sm font-semibold text-red-400 mr-2">
        Recording
      </span>

      <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
      <span className="text-sm text-zinc-300 font-mono">
        {formatTime(timer)}
      </span>

      <div className="flex-1" />

      <button
        onClick={handleDiscard}
        disabled={busy !== null}
        title="Throw away this recording and return to the welcome screen"
        className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 disabled:bg-zinc-800 disabled:opacity-50 text-red-300 hover:text-red-200 text-xs rounded font-medium"
      >
        {busy === "discarding" ? "Discarding..." : "Discard"}
      </button>

      <button
        onClick={handleStop}
        disabled={busy !== null}
        className="px-4 py-1.5 bg-green-600 hover:bg-green-500 disabled:bg-zinc-800 text-white text-xs rounded font-medium"
      >
        {busy === "stopping" ? "Stopping..." : "Stop & Edit"}
      </button>
    </div>
  );
}
