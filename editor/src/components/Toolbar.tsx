import { useCallback, useState, useEffect, useRef } from "react";
import { useProjectStore } from "../stores/useProjectStore";
import { pickSessionDir, defaultRecordingName, defaultRecordingParentDir } from "../lib/fileOps";
import { OpenIcon, SaveIcon, ProduceIcon, VersionsIcon } from "./ActionIcon";
import { Monitor, Mic, MicOff, Terminal, X, FileVideo, Undo2, Redo2 } from "lucide-react";
import { ProduceDialog, type ProduceSettings } from "./ProduceDialog";

export function Toolbar() {
  const sessionDir = useProjectStore((s) => s.sessionDir);
  const project = useProjectStore((s) => s.project);
  const isDirty = useProjectStore((s) => s.isDirty);
  const isProducing = useProjectStore((s) => s.isProducing);
  const isLoading = useProjectStore((s) => s.isLoading);
  const captureMode = useProjectStore((s) => s.captureMode);
  const openSession = useProjectStore((s) => s.openSession);
  const save = useProjectStore((s) => s.save);
  const startScreenCapture = useProjectStore((s) => s.startScreenCapture);
  const importVideo = useProjectStore((s) => s.importVideo);
  const produce = useProjectStore((s) => s.produce);
  const appendProduceLog = useProjectStore((s) => s.appendProduceLog);
  const produceLog = useProjectStore((s) => s.produceLog);
  const undo = useProjectStore((s) => s.undo);
  const redo = useProjectStore((s) => s.redo);
  const canUndo = useProjectStore((s) => s._actionsHistory.length > 0);
  const canRedo = useProjectStore((s) => s._actionsFuture.length > 0);

  const [showLog, setShowLog] = useState(false);
  const [showVersions, setShowVersions] = useState(false);
  const [showProduceDialog, setShowProduceDialog] = useState(false);
  const [versions, setVersions] = useState<{ name: string; path: string; size: number; created: string }[]>([]);
  const [showScreenPicker, setShowScreenPicker] = useState(false);
  const [screens, setScreens] = useState<{ id: string; name: string; x: number; y: number; width: number; height: number }[]>([]);
  const [showNamePrompt, setShowNamePrompt] = useState(false);
  const [pendingDisplayId, setPendingDisplayId] = useState<string | undefined>(undefined);
  const [recordingName, setRecordingName] = useState("");
  const [recordingParentDir, setRecordingParentDir] = useState("");
  const recordingNameInputRef = useRef<HTMLInputElement>(null);
  const [kokoroStatus, setKokoroStatus] = useState<"checking" | "connected" | "disconnected">("checking");
  const [showKokoroBanner, setShowKokoroBanner] = useState(false);
  const logEndRef = useRef<HTMLDivElement>(null);

  // Check Kokoro TTS connection on mount
  useEffect(() => {
    const endpoint = project?.tts?.kokoroEndpoint || "http://localhost:8880/v1/audio/speech";
    const baseUrl = endpoint.replace(/\/v1\/audio\/speech$/, "");
    fetch(`${baseUrl}/v1/models`, { signal: AbortSignal.timeout(3000) })
      .then((r) => {
        if (r.ok) {
          setKokoroStatus("connected");
          setShowKokoroBanner(false);
        } else {
          setKokoroStatus("disconnected");
          setShowKokoroBanner(true);
        }
      })
      .catch(() => {
        setKokoroStatus("disconnected");
        setShowKokoroBanner(true);
      });
  }, [project?.tts?.kokoroEndpoint]);

  // Listen for produce progress events
  useEffect(() => {
    window.electronAPI.onProduceProgress((msg: string) => {
      appendProduceLog(msg);
    });
    return () => {
      window.electronAPI.removeAllListeners("produce-progress");
    };
  }, [appendProduceLog]);

  // Auto-scroll log to bottom
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [produceLog]);

  const handleOpen = useCallback(async () => {
    try {
      const dir = await pickSessionDir();
      if (dir) await openSession(dir);
    } catch (err) {
      alert(`Failed to open project: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [openSession]);

  const handleSave = useCallback(async () => {
    try {
      await save();
    } catch (err) {
      alert(`Failed to save project: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [save]);

  const handleProduce = useCallback(() => {
    setShowProduceDialog(true);
  }, []);

  const handleProduceConfirm = useCallback(async (settings: ProduceSettings) => {
    setShowProduceDialog(false);
    setShowLog(true);
    setShowVersions(false);
    await produce(settings.selectedIds, { width: settings.resolution.width, height: settings.resolution.height }, settings.quality.crf, settings.trim);
    if (sessionDir) {
      const v = await window.electronAPI.listVersions(sessionDir);
      setVersions(v);
    }
  }, [produce, sessionDir]);

  const openNamePrompt = useCallback(async (displayId?: string) => {
    const cached = (await window.electronAPI.cacheGet("lastRecordingParentDir")) as string | null;
    let parent = cached ?? null;
    if (parent && !(await window.electronAPI.exists(parent))) {
      parent = null;
    }
    if (!parent) parent = await defaultRecordingParentDir();
    setPendingDisplayId(displayId);
    setRecordingName(defaultRecordingName());
    setRecordingParentDir(parent);
    setShowNamePrompt(true);
  }, []);

  const handleRecordScreen = useCallback(async () => {
    const sources = await window.electronAPI.getScreenSources();
    if (sources.length === 1) {
      await openNamePrompt(sources[0].id);
    } else {
      setScreens(sources);
      setShowScreenPicker(true);
    }
  }, [openNamePrompt]);

  const handlePickScreen = useCallback(async (displayId: string) => {
    setShowScreenPicker(false);
    await openNamePrompt(displayId);
  }, [openNamePrompt]);

  const handleChangeRecordingDir = useCallback(async () => {
    const dir = await window.electronAPI.pickSaveDirectory(recordingParentDir);
    if (dir) setRecordingParentDir(dir);
  }, [recordingParentDir]);

  const handleConfirmRecording = useCallback(async () => {
    setShowNamePrompt(false);
    await window.electronAPI.cacheSet("lastRecordingParentDir", recordingParentDir);
    await startScreenCapture(pendingDisplayId, {
      parentDir: recordingParentDir,
      name: recordingName.trim(),
    });
  }, [pendingDisplayId, recordingName, recordingParentDir, startScreenCapture]);

  const handleCancelRecording = useCallback(() => {
    setShowNamePrompt(false);
    setPendingDisplayId(undefined);
  }, []);

  // Auto-focus + select the name input when the modal opens
  useEffect(() => {
    if (showNamePrompt) {
      const t = setTimeout(() => recordingNameInputRef.current?.select(), 0);
      return () => clearTimeout(t);
    }
  }, [showNamePrompt]);

  // Esc closes the screen picker dropdown
  useEffect(() => {
    if (!showScreenPicker) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowScreenPicker(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showScreenPicker]);

  const handleShowVersions = useCallback(async () => {
    if (!sessionDir) return;
    const v = await window.electronAPI.listVersions(sessionDir);
    setVersions(v);
    setShowVersions((prev) => !prev);
    setShowLog(false);
  }, [sessionDir]);

  const handleOpenVersion = useCallback(async (filePath: string) => {
    try {
      await window.electronAPI.openVersion(filePath);
    } catch (err) {
      alert(`Could not open version: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, []);

  const handleShowInFolder = useCallback(async (filePath: string) => {
    try {
      await window.electronAPI.showInFolder(filePath);
    } catch (err) {
      alert(`Could not show in folder: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, []);

  // Don't render during capture mode
  if (captureMode) return null;

  const actionCount = project?.actions.length ?? 0;

  return (
    <div className="relative shrink-0">
      <div className="h-11 bg-zinc-950 border-b border-zinc-800 flex items-center px-4 gap-2 relative z-50">
        <span className="text-sm font-semibold text-zinc-200 mr-3">
          NaraScreen
        </span>

        <div className="w-px h-5 bg-zinc-800" />

        {/* Record Screen */}
        <div className="relative ml-2">
          <button
            onClick={handleRecordScreen}
            disabled={isLoading}
            title="Start a new screen recording"
            className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600 hover:bg-red-500 disabled:opacity-30 disabled:pointer-events-none text-white text-xs font-medium rounded-md transition-colors"
          >
            <Monitor size={13} />
            Record Screen
          </button>
          {showScreenPicker && (
            <div className="absolute top-full left-0 mt-1 bg-zinc-900 border border-zinc-700 rounded-md shadow-sm z-100 min-w-48">
              <div className="px-3 py-2 text-xs text-zinc-400 border-b border-zinc-700/40 font-medium">
                Pick a display
              </div>
              {screens.map((s) => (
                <button
                  key={s.id}
                  onClick={() => handlePickScreen(s.id)}
                  className="block w-full px-4 py-2 text-xs text-left text-zinc-200 hover:bg-zinc-800 transition-colors"
                >
                  {s.name}
                  <span className="text-zinc-500 ml-2">({s.x},{s.y})</span>
                </button>
              ))}
              <button
                onClick={() => setShowScreenPicker(false)}
                className="block w-full px-4 py-1.5 text-xs text-zinc-500 hover:text-zinc-300 border-t border-zinc-700/40"
              >
                Cancel
              </button>
            </div>
          )}
        </div>

        <button
          onClick={handleOpen}
          disabled={isLoading}
          title="Open an existing project folder"
          className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-30 disabled:pointer-events-none text-zinc-300 text-xs rounded-md transition-colors"
        >
          <OpenIcon size={13} />
          Open
        </button>

        <button
          onClick={importVideo}
          disabled={isLoading}
          title="Import an existing video file"
          className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-30 disabled:pointer-events-none text-zinc-300 text-xs rounded-md transition-colors"
        >
          <FileVideo size={13} />
          Import Video
        </button>

        <div className="w-px h-5 bg-zinc-800" />

        <button
          onClick={handleSave}
          disabled={!sessionDir || isLoading}
          title={isDirty ? "Unsaved changes — Save (Ctrl+S)" : "Save project (Ctrl+S)"}
          className={`flex items-center gap-1.5 px-3 py-1.5 disabled:opacity-30 disabled:pointer-events-none text-xs rounded-md transition-colors ${
            isDirty
              ? "bg-amber-600 hover:bg-amber-500 text-white font-medium"
              : "bg-zinc-800 hover:bg-zinc-700 text-white"
          }`}
        >
          <SaveIcon size={13} />
          {isDirty ? "Save •" : "Save"}
        </button>

        <button
          onClick={undo}
          disabled={!canUndo}
          title="Undo (Ctrl+Z)"
          className="p-1.5 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-30 disabled:pointer-events-none text-zinc-300 rounded-md transition-colors"
        >
          <Undo2 size={13} />
        </button>
        <button
          onClick={redo}
          disabled={!canRedo}
          title="Redo (Ctrl+Shift+Z)"
          className="p-1.5 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-30 disabled:pointer-events-none text-zinc-300 rounded-md transition-colors"
        >
          <Redo2 size={13} />
        </button>

        <div className="w-px h-5 bg-zinc-800" />

        <button
          onClick={handleProduce}
          disabled={!sessionDir || actionCount === 0 || isProducing || isLoading}
          title="Render the final video"
          className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-30 disabled:pointer-events-none text-white text-xs font-medium rounded-md transition-colors"
        >
          <ProduceIcon size={13} />
          {isProducing ? "Producing..." : "Produce"}
        </button>

        <button
          onClick={handleShowVersions}
          disabled={!sessionDir}
          title="Show produced versions"
          className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-30 disabled:pointer-events-none text-zinc-300 text-xs rounded-md transition-colors"
        >
          <VersionsIcon size={13} />
          Versions{versions.length > 0 ? ` (${versions.length})` : ""}
        </button>

        <div className="flex-1" />

        {sessionDir && (
          <span
            className="text-[11px] text-zinc-300 font-semibold truncate max-w-60"
            title={sessionDir}
          >
            {sessionDir}
          </span>
        )}

        {actionCount > 0 && (
          <span className="text-[10px] text-zinc-500 font-medium">
            {actionCount} action{actionCount !== 1 ? "s" : ""}
          </span>
        )}

        {produceLog && (
          <button
            onClick={() => { setShowLog(!showLog); setShowVersions(false); }}
            className="flex items-center gap-1 text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            <Terminal size={11} />
            {showLog ? "Hide Log" : "Log"}
          </button>
        )}

        {/* Kokoro TTS status */}
        <span
          className={`flex items-center gap-1 text-[10px] ${kokoroStatus === "connected" ? "text-emerald-500" : kokoroStatus === "disconnected" ? "text-amber-500" : "text-zinc-600"}`}
          title={kokoroStatus === "connected" ? "Voice Engine: Connected" : kokoroStatus === "disconnected" ? "Voice Engine: Not detected" : "Checking..."}
        >
          {kokoroStatus === "connected" ? <Mic size={11} /> : kokoroStatus === "disconnected" ? <MicOff size={11} /> : <Mic size={11} />}
          {kokoroStatus === "connected" ? "Voice" : kokoroStatus === "disconnected" ? "No Voice" : "..."}
        </span>
      </div>

      {/* Kokoro not detected banner */}
      {showKokoroBanner && (
        <div className="bg-amber-900/40 border-b border-amber-700/50 px-4 py-2 flex items-center gap-3">
          <span className="text-xs text-amber-300">
            Voice Engine not detected. Start it with:
          </span>
          <code className="text-[10px] text-amber-200 bg-amber-950/50 px-2 py-0.5 rounded font-mono">
            docker run -d -p 8880:8880 ghcr.io/remsky/kokoro-fastapi-cpu:latest
          </code>
          <button
            onClick={() => navigator.clipboard.writeText("docker run -d --name kokoro -p 8880:8880 ghcr.io/remsky/kokoro-fastapi-cpu:latest")}
            className="text-[10px] text-amber-400 hover:text-amber-300 transition-colors"
          >
            Copy
          </button>
          <button
            onClick={() => setShowKokoroBanner(false)}
            className="ml-auto text-amber-600 hover:text-amber-400 transition-colors"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* Production log — overlay, doesn't push content */}
      {showLog && produceLog && (
        <div className="absolute left-0 right-0 top-full z-30 max-h-48 bg-zinc-950 border-b border-zinc-800 overflow-auto p-3 font-mono text-xs text-zinc-400">
          <pre className="whitespace-pre-wrap">{produceLog}</pre>
          <div ref={logEndRef} />
        </div>
      )}

      {/* Produce dialog */}
      {showProduceDialog && (
        <ProduceDialog
          onConfirm={handleProduceConfirm}
          onCancel={() => setShowProduceDialog(false)}
        />
      )}

      {/* Name your recording dialog */}
      {showNamePrompt && (
        <div
          className="fixed inset-0 z-9999 bg-black/60 flex items-center justify-center"
          onClick={handleCancelRecording}
          onKeyDown={(e) => { if (e.key === "Escape") handleCancelRecording(); }}
        >
          <div
            className="bg-zinc-900 border border-zinc-800 rounded-md w-md max-w-[90vw] shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-zinc-800">
              <h2 className="text-sm font-semibold text-zinc-200">Name your recording</h2>
              <p className="text-[11px] text-zinc-500 mt-1">
                Pick a name for this session folder. Leave the default to use a timestamp.
              </p>
            </div>
            <div className="px-5 py-4 space-y-3">
              <div>
                <label className="block text-[11px] text-zinc-400 mb-1">Recording name</label>
                <input
                  ref={recordingNameInputRef}
                  type="text"
                  value={recordingName}
                  onChange={(e) => setRecordingName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleConfirmRecording();
                    else if (e.key === "Escape") handleCancelRecording();
                  }}
                  className="w-full px-2.5 py-1.5 bg-zinc-950 border border-zinc-700 rounded text-xs text-zinc-200 focus:outline-none focus:border-zinc-500"
                />
              </div>
              <div>
                <label className="block text-[11px] text-zinc-400 mb-1">Save in</label>
                <div className="flex items-center gap-2">
                  <span
                    className="flex-1 truncate px-2.5 py-1.5 bg-zinc-950 border border-zinc-800 rounded text-[11px] text-zinc-400 font-mono"
                    title={recordingParentDir}
                  >
                    {recordingParentDir}
                  </span>
                  <button
                    onClick={handleChangeRecordingDir}
                    className="px-2.5 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-[11px] rounded"
                  >
                    Change…
                  </button>
                </div>
              </div>
            </div>
            <div className="px-5 py-3 border-t border-zinc-800 flex justify-end gap-2">
              <button
                onClick={handleCancelRecording}
                className="px-3 py-1.5 text-zinc-400 hover:text-zinc-200 text-xs rounded"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmRecording}
                disabled={!recordingParentDir}
                className="px-3 py-1.5 bg-red-600 hover:bg-red-500 disabled:opacity-30 disabled:pointer-events-none text-white text-xs font-medium rounded"
              >
                Start Recording
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Versions — overlay, doesn't push content */}
      {showVersions && (
        <div className="absolute left-0 right-0 top-full z-30 max-h-48 bg-zinc-950 border-b border-zinc-800 overflow-auto p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-zinc-300">Produced Versions</span>
            <button
              onClick={() => setShowVersions(false)}
              className="text-xs text-zinc-500 hover:text-zinc-300"
            >
              Close
            </button>
          </div>
          {versions.length === 0 ? (
            <p className="text-xs text-zinc-500">No versions produced yet.</p>
          ) : (
            <div className="space-y-1">
              {versions.map((v) => (
                <div
                  key={v.name}
                  className="flex items-center justify-between px-3 py-2 bg-zinc-900 rounded hover:bg-zinc-800"
                >
                  <div>
                    <span className="text-xs text-zinc-200 font-mono">{v.name}</span>
                    <span className="text-[10px] text-zinc-500 ml-2">
                      {(v.size / 1024 / 1024).toFixed(1)} MB
                    </span>
                    <span className="text-[10px] text-zinc-500 ml-2">
                      {new Date(v.created).toLocaleString()}
                    </span>
                  </div>
                  <div className="flex gap-1">
                    <button
                      onClick={() => handleOpenVersion(v.path)}
                      className="px-2 py-1 bg-blue-600 hover:bg-blue-500 text-white text-[10px] rounded"
                    >
                      Open
                    </button>
                    <button
                      onClick={() => handleShowInFolder(v.path)}
                      className="px-2 py-1 bg-zinc-700 hover:bg-zinc-600 text-white text-[10px] rounded"
                    >
                      Show in Folder
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
