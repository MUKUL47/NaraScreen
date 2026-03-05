import { useCallback, useEffect, useMemo, useRef } from "react";
import { Toolbar } from "./components/Toolbar";
import { CaptureToolbar } from "./components/CaptureToolbar";
import { VideoPlayer } from "./components/VideoPlayer";
import { Timeline } from "./components/Timeline";
import { Monitor } from "lucide-react";
import { ActionPanel } from "./components/ActionPanel";
import { useProjectStore } from "./stores/useProjectStore";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { ACTION_DISPLAY_NAMES, ACTION_OVERLAY_COLORS } from "./lib/constants";
import type { LabeledOverlay } from "./types";

function App() {
  useKeyboardShortcuts();
  const sessionDir = useProjectStore((s) => s.sessionDir);
  const openSession = useProjectStore((s) => s.openSession);

  // Auto-restore last opened session on launch
  useEffect(() => {
    (async () => {
      const lastDir = await window.electronAPI.cacheGet("lastSessionDir") as string | null;
      if (lastDir) {
        const exists = await window.electronAPI.exists(lastDir + "/demo-project.json");
        if (exists) {
          await openSession(lastDir);
        }
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const project = useProjectStore((s) => s.project);
  const captureMode = useProjectStore((s) => s.captureMode);
  const playheadTime = useProjectStore((s) => s.playheadTime);
  const setPlayhead = useProjectStore((s) => s.setPlayhead);
  const isLoading = useProjectStore((s) => s.isLoading);
  const loadingMessage = useProjectStore((s) => s.loadingMessage);
  const produceLog = useProjectStore((s) => s.produceLog);
  const loadingLogRef = useRef<HTMLDivElement>(null);

  // Auto-scroll loading log to bottom
  useEffect(() => {
    loadingLogRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [produceLog]);
  const drawingZoom = useProjectStore((s) => s.drawingZoom);
  const setDrawingZoom = useProjectStore((s) => s.setDrawingZoom);
  const selectedActionId = useProjectStore((s) => s.selectedActionId);
  const updateAction = useProjectStore((s) => s.updateAction);

  // Find overlay rect for currently selected action (zoom, spotlight, or callout)
  const selectedAction = project?.actions.find(
    (a) => a.id === selectedActionId,
  );
  const zoomRect = null; // no longer used — all rects shown via labeledOverlays

  // Build labeled overlays from ALL rect-based actions (zoom, spotlight, blur, callout)
  const labeledOverlays = useMemo<LabeledOverlay[]>(() => {
    if (!project) return [];
    const overlays: LabeledOverlay[] = [];

    for (const action of project.actions) {
      const isSelected = action.id === selectedActionId;
      const color = ACTION_OVERLAY_COLORS[action.type];
      if (!color) continue;

      const label = action.name || `${ACTION_DISPLAY_NAMES[action.type] || action.type} @ ${action.timestamp.toFixed(1)}s`;

      const getRects = (): [number, number, number, number][] => {
        switch (action.type) {
          case "zoom":
            return action.zoomRects ?? (action.zoomRect ? [action.zoomRect] : []);
          case "spotlight":
            return action.spotlightRects ?? (action.spotlightRect ? [action.spotlightRect] : []);
          case "blur":
            return action.blurRects ?? [];
          case "callout":
            return action.calloutPanels?.map((p) => p.rect) ?? [];
          default:
            return [];
        }
      };

      for (const rect of getRects()) {
        overlays.push({ rect, label, color, selected: isSelected, actionId: action.id });
      }
    }

    return overlays;
  }, [project, selectedActionId]);

  // Callout panels for text preview overlay (only for selected callout action)
  const calloutPanels =
    selectedAction?.type === "callout" && selectedAction.calloutPanels?.length
      ? selectedAction.calloutPanels
      : undefined;

  const handleZoomDrawn = useCallback(
    (rect: [number, number, number, number]) => {
      if (!selectedActionId || !selectedAction) return;
      if (selectedAction.type === "zoom") {
        // Append new rect to existing zoom rects
        const existing = selectedAction.zoomRects ?? (selectedAction.zoomRect ? [selectedAction.zoomRect] : []);
        updateAction(selectedActionId, {
          zoomRects: [...existing, rect],
          zoomRect: undefined,
        });
        // Stay in drawing mode so user can add more zoom targets
        return;
      } else if (selectedAction.type === "spotlight") {
        // Append new rect to existing spotlight rects
        const existing = selectedAction.spotlightRects ?? (selectedAction.spotlightRect ? [selectedAction.spotlightRect] : []);
        updateAction(selectedActionId, {
          spotlightRects: [...existing, rect],
          spotlightRect: undefined,
        });
        // Stay in drawing mode so user can add more rects
        return;
      } else if (selectedAction.type === "blur") {
        // Append new rect to existing blur rects
        const existing = selectedAction.blurRects ?? [];
        updateAction(selectedActionId, { blurRects: [...existing, rect] });
        // Stay in drawing mode so user can add more rects
        return;
      } else if (selectedAction.type === "callout") {
        // Append new text panel to calloutPanels
        const existing = selectedAction.calloutPanels ?? [];
        updateAction(selectedActionId, {
          calloutPanels: [...existing, { text: "", rect, fontSize: 24 }],
        });
        // Stay in drawing mode so user can add more panels
        return;
      }
      setDrawingZoom(false);
    },
    [selectedActionId, selectedAction, updateAction, setDrawingZoom],
  );

  const handleDurationChange = useCallback(
    (duration: number) => {
      if (project && project.recordingDuration === 0) {
        // Update duration if not set
        useProjectStore.setState((s) => ({
          project: s.project ? { ...s.project, recordingDuration: duration } : null,
        }));
      }
    },
    [project],
  );

  return (
    <div className="h-full flex flex-col">
      {captureMode ? <CaptureToolbar /> : <Toolbar />}

      <div className="flex-1 flex overflow-hidden">
        {captureMode ? (
          /* Capture Mode: instructions while recording */
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center space-y-4">
              <h1 className="text-2xl font-bold text-zinc-300">
                Recording...
              </h1>
              <p className="text-zinc-500 text-sm max-w-md">
                Navigate the target website in the capture window.
                Click "Stop & Edit" when finished.
              </p>
              <p className="text-zinc-600 text-xs">
                Your screen is being recorded. Click "Stop & Edit" when done.
              </p>
            </div>
          </div>
        ) : sessionDir && project ? (
          /* Editor Mode: VideoPlayer + ActionPanel */
          <>
            <div className="flex-1 flex flex-col overflow-hidden">
              {/* Video player */}
              <div className="flex-1 min-h-0">
                <VideoPlayer
                  videoPath={project.recordingPath}
                  currentTime={playheadTime}
                  onTimeUpdate={setPlayhead}
                  onDurationChange={handleDurationChange}
                  drawingZoom={drawingZoom}
                  onZoomDrawn={handleZoomDrawn}
                  labeledOverlays={labeledOverlays}
                  calloutPanels={calloutPanels}
                  onSelectAction={useProjectStore.getState().setSelectedAction}
                />
              </div>

              {/* Timeline */}
              <div className="h-48 shrink-0">
                <Timeline />
              </div>
            </div>

            {/* Action panel (right sidebar) */}
            <ActionPanel />
          </>
        ) : (
          /* Welcome screen */
          <div className="flex-1 flex items-center justify-center bg-linear-to-b from-zinc-950 via-zinc-900 to-zinc-950">
            <div className="text-center space-y-4">
              <div className="flex justify-center">
                <Monitor size={48} className="text-zinc-600" />
              </div>
              <h1 className="text-3xl font-bold text-zinc-100 tracking-tight">
                NaraScreen
              </h1>
              <p className="text-zinc-500 text-sm max-w-sm leading-relaxed">
                Record your screen, add narration, zooms, and effects — then produce polished demo videos.
              </p>
              <p className="text-zinc-600 text-xs pt-2">
                Click <span className="text-red-400 font-medium">Record Screen</span> to begin
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Global loading overlay */}
      {isLoading && (
        <div className="fixed inset-0 z-[9999] bg-black/60 backdrop-blur-sm flex items-center justify-center">
          <div className="bg-zinc-900 border border-zinc-700/50 rounded-xl px-8 py-6 flex flex-col items-center gap-3 shadow-2xl max-w-lg w-full mx-4">
            <div className="w-8 h-8 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
            <span className="text-sm text-zinc-300 font-medium">{loadingMessage}</span>
            {produceLog && (
              <div className="w-full max-h-48 overflow-auto rounded-lg bg-black/60 border border-zinc-800/50 p-3 mt-1">
                <pre className="text-[11px] font-mono text-green-400/80 whitespace-pre-wrap leading-relaxed">{produceLog}</pre>
                <div ref={loadingLogRef} />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
