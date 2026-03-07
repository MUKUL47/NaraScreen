import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Toolbar } from "./components/Toolbar";
import { CaptureToolbar } from "./components/CaptureToolbar";
import { VideoPlayer } from "./components/VideoPlayer";
import { Timeline } from "./components/Timeline";
import { Monitor } from "lucide-react";
import { ActionPanel } from "./components/ActionPanel";
import { useProjectStore } from "./stores/useProjectStore";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { ACTION_DISPLAY_NAMES, ACTION_OVERLAY_COLORS } from "./lib/constants";
import { getActionEndTime, getActionRects } from "./lib/actions";
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
  const isProducing = useProjectStore((s) => s.isProducing);
  const loadingMessage = useProjectStore((s) => s.loadingMessage);
  const produceLog = useProjectStore((s) => s.produceLog);
  const cancelProduce = useProjectStore((s) => s.cancelProduce);
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

  // Build labeled overlays: show rects for actions active at current playhead time
  // + always show selected action's rects
  const labeledOverlays = useMemo<LabeledOverlay[]>(() => {
    if (!project) return [];

    const overlays: LabeledOverlay[] = [];

    for (const action of project.actions) {
      const color = ACTION_OVERLAY_COLORS[action.type];
      if (!color) continue;

      const rects = getActionRects(action);
      if (rects.length === 0) continue;

      const isSelected = action.id === selectedActionId;

      // Show if: selected, OR playhead is within this action's time range
      if (!isSelected) {
        const endTime = getActionEndTime(action);
        if (playheadTime < action.timestamp || playheadTime > endTime) continue;
      }

      const label = action.name || `${ACTION_DISPLAY_NAMES[action.type] || action.type} @ ${action.timestamp.toFixed(1)}s`;

      for (const rect of rects) {
        overlays.push({ rect, label, color, selected: isSelected, actionId: action.id });
      }
    }

    return overlays;
  }, [project, selectedActionId, playheadTime]);

  // Callout panels for text preview overlay (only for selected callout action)
  const calloutPanels =
    selectedAction?.type === "callout" && selectedAction.calloutPanels?.length
      ? selectedAction.calloutPanels
      : undefined;

  const handleZoomDrawn = useCallback(
    (rect: [number, number, number, number]) => {
      if (!selectedActionId || !selectedAction) return;
      if (selectedAction.type === "zoom") {
        // Append new zoom target (with empty narration) to zoomTargets
        const existingTargets = selectedAction.zoomTargets?.length
          ? selectedAction.zoomTargets
          : (selectedAction.zoomRects ?? (selectedAction.zoomRect ? [selectedAction.zoomRect] : []))
              .map((r) => ({ rect: r }));
        updateAction(selectedActionId, {
          zoomTargets: [...existingTargets, { rect }],
          zoomRect: undefined,
          zoomRects: undefined,
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

  // Resizable timeline height
  const [timelineHeight, setTimelineHeight] = useState(192); // default h-48 = 192px
  const resizingRef = useRef(false);

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    resizingRef.current = true;
    const startY = e.clientY;
    const startHeight = timelineHeight;

    const onMove = (ev: MouseEvent) => {
      if (!resizingRef.current) return;
      const delta = startY - ev.clientY; // dragging up = more timeline
      const newHeight = Math.max(100, Math.min(600, startHeight + delta));
      setTimelineHeight(newHeight);
    };

    const onUp = () => {
      resizingRef.current = false;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
  }, [timelineHeight]);

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
              <div className="min-h-0" style={{ flex: `1 1 0`, maxHeight: `calc(100% - ${timelineHeight}px)` }}>
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

              {/* Resize handle — tall hit area with visible grip */}
              <div
                className="relative shrink-0 cursor-row-resize group"
                style={{ height: 10 }}
                onMouseDown={handleResizeStart}
              >
                {/* Visible bar */}
                <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-px bg-zinc-700 group-hover:bg-zinc-500 transition-colors" />
              </div>

              {/* Timeline */}
              <div className="shrink-0 overflow-hidden" style={{ height: timelineHeight }}>
                <Timeline />
              </div>
            </div>

            {/* Action panel (right sidebar) */}
            <ActionPanel />
          </>
        ) : (
          /* Welcome screen */
          <div className="flex-1 flex items-center justify-center bg-zinc-950">
            <div className="text-center space-y-3">
              <Monitor size={32} className="text-zinc-600 mx-auto" />
              <h1 className="text-lg font-semibold text-zinc-200">
                NaraScreen
              </h1>
              <p className="text-zinc-500 text-xs">
                Record, annotate, and produce demo videos.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Global loading overlay */}
      {isLoading && (
        <div className="fixed inset-0 z-9999 bg-black/60 flex items-center justify-center">
          <div className="bg-zinc-900 border border-zinc-800 rounded-md px-6 py-5 flex flex-col items-center gap-3 max-w-lg w-full mx-4">
            <div className="w-5 h-5 border-2 border-zinc-400 border-t-transparent rounded-full animate-spin" />
            <span className="text-sm text-zinc-300">{loadingMessage}</span>
            {produceLog && (
              <div className="w-full max-h-48 overflow-auto rounded bg-zinc-950 border border-zinc-800 p-3 mt-1">
                <pre className="text-[11px] font-mono text-zinc-400 whitespace-pre-wrap leading-relaxed">{produceLog}</pre>
                <div ref={loadingLogRef} />
              </div>
            )}
            {isProducing && (
              <button
                onClick={cancelProduce}
                className="mt-2 px-4 py-1.5 text-xs text-red-400 hover:text-white hover:bg-red-600 border border-zinc-700 rounded-md transition-colors"
              >
                Cancel Production
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
