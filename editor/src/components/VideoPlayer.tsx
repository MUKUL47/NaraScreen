import { useRef, useEffect, useCallback, useReducer, useState } from "react";
import { useProjectStore } from "../stores/useProjectStore";
import { assetUrl } from "../lib/fileOps";
import type { CalloutPanel, LabeledOverlay } from "../types";

interface VideoPlayerProps {
  videoPath: string | null;
  currentTime: number;
  onTimeUpdate: (time: number) => void;
  onDurationChange?: (duration: number) => void;
  drawingZoom?: boolean;
  onZoomDrawn?: (rect: [number, number, number, number]) => void;
  labeledOverlays?: LabeledOverlay[];
  calloutPanels?: CalloutPanel[];
  onSelectAction?: (actionId: string) => void;
  onMoveRect?: (actionId: string, rectIndex: number, newRect: [number, number, number, number]) => void;
  selectedActionId?: string | null;
}

/** Compute the actual display rect of a video using object-contain within its container */
function getVideoDisplayRect(video: HTMLVideoElement) {
  const containerRect = video.getBoundingClientRect();
  const vw = video.videoWidth || 1920;
  const vh = video.videoHeight || 1080;
  const videoAspect = vw / vh;
  const containerAspect = containerRect.width / containerRect.height;

  let displayW: number, displayH: number, offsetX: number, offsetY: number;

  if (containerAspect > videoAspect) {
    // Letterboxed left/right (pillarbox)
    displayH = containerRect.height;
    displayW = displayH * videoAspect;
    offsetX = (containerRect.width - displayW) / 2;
    offsetY = 0;
  } else {
    // Letterboxed top/bottom
    displayW = containerRect.width;
    displayH = displayW / videoAspect;
    offsetX = 0;
    offsetY = (containerRect.height - displayH) / 2;
  }

  return { displayW, displayH, offsetX, offsetY, vw, vh };
}

export function VideoPlayer({
  videoPath,
  currentTime,
  onTimeUpdate,
  onDurationChange,
  drawingZoom,
  onZoomDrawn,
  labeledOverlays,
  calloutPanels,
  onSelectAction,
  onMoveRect,
  selectedActionId,
}: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [drawStart, setDrawStart] = useState<{ x: number; y: number } | null>(null);
  const [drawCurrent, setDrawCurrent] = useState<{ x: number; y: number } | null>(null);
  const seekingRef = useRef(false);

  // Drag state for existing overlay rects (move OR resize). We hold mutable state in
  // a ref so window-level mousemove handlers always see the latest values without
  // re-binding, and force re-renders via the version counter to redraw the rect.
  type ResizeHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
  const dragRef = useRef<{
    mode: "move" | "resize";
    handle?: ResizeHandle;
    actionId: string;
    rectIndex: number;
    originRect: [number, number, number, number];
    startVideoX: number;
    startVideoY: number;
    currentRect: [number, number, number, number];
    moved: boolean;
  } | null>(null);
  // Set to true when the most recent mouseup ended a drag — suppresses the click that follows.
  const lastDragMovedRef = useRef(false);
  const [, forceRerender] = useReducer((c: number) => c + 1, 0);

  // Store-driven playback
  const isPlaying = useProjectStore((s) => s.isPlaying);
  const setIsPlaying = useProjectStore((s) => s.setIsPlaying);
  const playbackRate = useProjectStore((s) => s.playbackRate);
  const togglePlay = useProjectStore((s) => s.togglePlay);

  // Sync play/pause state from store to video element
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !video.src) return;
    if (isPlaying && video.paused) {
      video.play().catch(() => setIsPlaying(false));
    } else if (!isPlaying && !video.paused) {
      video.pause();
    }
  }, [isPlaying, setIsPlaying]);

  // Sync playback rate from store to video element
  useEffect(() => {
    const video = videoRef.current;
    if (video) video.playbackRate = playbackRate;
  }, [playbackRate]);

  // Sync video time from external source (timeline clicks, etc.)
  useEffect(() => {
    const video = videoRef.current;
    if (!video || seekingRef.current) return;
    if (Math.abs(video.currentTime - currentTime) > 0.3) {
      video.currentTime = currentTime;
    }
  }, [currentTime]);

  const handleTimeUpdate = useCallback(() => {
    const video = videoRef.current;
    if (!video || seekingRef.current) return;
    onTimeUpdate(video.currentTime);
  }, [onTimeUpdate]);

  const handleLoadedMetadata = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    video.playbackRate = playbackRate;
    onDurationChange?.(video.duration);
  }, [onDurationChange, playbackRate]);

  const seek = useCallback(
    (delta: number) => {
      const video = videoRef.current;
      if (!video) return;
      const dur = video.duration || 0;
      video.currentTime = Math.max(0, Math.min(dur, video.currentTime + delta));
      onTimeUpdate(video.currentTime);
    },
    [onTimeUpdate],
  );

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      )
        return;

      switch (e.key) {
        case " ":
          e.preventDefault();
          togglePlay();
          break;
        case "ArrowLeft":
          if (e.altKey) return; // Alt+Arrow is reserved for rect-nudge
          e.preventDefault();
          seek(e.shiftKey ? -5 : -1);
          break;
        case "ArrowRight":
          if (e.altKey) return; // Alt+Arrow is reserved for rect-nudge
          e.preventDefault();
          seek(e.shiftKey ? 5 : 1);
          break;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [togglePlay, seek]);

  // Zoom drawing — convert client coords to video pixel coords (accounting for letterboxing)
  const toVideoCoords = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } | null => {
      const video = videoRef.current;
      if (!video) return null;
      const { displayW, displayH, offsetX, offsetY, vw, vh } = getVideoDisplayRect(video);
      const containerRect = video.getBoundingClientRect();
      const relX = clientX - containerRect.left - offsetX;
      const relY = clientY - containerRect.top - offsetY;
      return {
        x: Math.round(Math.max(0, Math.min(vw, (relX / displayW) * vw))),
        y: Math.round(Math.max(0, Math.min(vh, (relY / displayH) * vh))),
      };
    },
    [],
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (!drawingZoom) return;
      const pt = toVideoCoords(e.clientX, e.clientY);
      if (pt) {
        setDrawStart(pt);
        setDrawCurrent(pt);
      }
    },
    [drawingZoom, toVideoCoords],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!drawStart) return;
      const pt = toVideoCoords(e.clientX, e.clientY);
      if (pt) setDrawCurrent(pt);
    },
    [drawStart, toVideoCoords],
  );

  const handleMouseUp = useCallback(() => {
    if (!drawStart || !drawCurrent) return;
    const x = Math.min(drawStart.x, drawCurrent.x);
    const y = Math.min(drawStart.y, drawCurrent.y);
    const w = Math.abs(drawCurrent.x - drawStart.x);
    const h = Math.abs(drawCurrent.y - drawStart.y);
    setDrawStart(null);
    setDrawCurrent(null);
    if (w > 20 && h > 20) {
      onZoomDrawn?.([x, y, w, h]);
    }
  }, [drawStart, drawCurrent, onZoomDrawn]);

  const drawingRect =
    drawStart && drawCurrent
      ? {
          x: Math.min(drawStart.x, drawCurrent.x),
          y: Math.min(drawStart.y, drawCurrent.y),
          w: Math.abs(drawCurrent.x - drawStart.x),
          h: Math.abs(drawCurrent.y - drawStart.y),
        }
      : null;

  // Begin dragging an existing overlay. Drawing mode takes priority, so this is a no-op then.
  const handleOverlayMouseDown = useCallback(
    (e: React.MouseEvent, overlay: LabeledOverlay) => {
      if (drawingZoom || !onMoveRect) return;
      const pt = toVideoCoords(e.clientX, e.clientY);
      if (!pt) return;
      e.stopPropagation();
      e.preventDefault();
      dragRef.current = {
        mode: "move",
        actionId: overlay.actionId,
        rectIndex: overlay.rectIndex,
        originRect: overlay.rect,
        startVideoX: pt.x,
        startVideoY: pt.y,
        currentRect: overlay.rect,
        moved: false,
      };
      forceRerender();
    },
    [drawingZoom, onMoveRect, toVideoCoords],
  );

  // Begin a resize via a corner/edge handle. Same commit path as move.
  const handleResizeMouseDown = useCallback(
    (e: React.MouseEvent, overlay: LabeledOverlay, handle: ResizeHandle) => {
      if (drawingZoom || !onMoveRect) return;
      const pt = toVideoCoords(e.clientX, e.clientY);
      if (!pt) return;
      e.stopPropagation();
      e.preventDefault();
      dragRef.current = {
        mode: "resize",
        handle,
        actionId: overlay.actionId,
        rectIndex: overlay.rectIndex,
        originRect: overlay.rect,
        startVideoX: pt.x,
        startVideoY: pt.y,
        currentRect: overlay.rect,
        moved: false,
      };
      forceRerender();
    },
    [drawingZoom, onMoveRect, toVideoCoords],
  );

  // Window-level move/up listeners during a drag. Bound once; reads live state via dragRef.
  useEffect(() => {
    const DRAG_THRESHOLD = 2;
    const MIN_SIZE = 10;
    const onMove = (e: MouseEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const pt = toVideoCoords(e.clientX, e.clientY);
      if (!pt) return;
      const dx = pt.x - drag.startVideoX;
      const dy = pt.y - drag.startVideoY;
      if (!drag.moved && (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD)) {
        drag.moved = true;
      }
      const video = videoRef.current;
      const vw = video?.videoWidth || 1920;
      const vh = video?.videoHeight || 1080;
      const [ox, oy, ow, oh] = drag.originRect;
      if (drag.mode === "move") {
        const newX = Math.max(0, Math.min(vw - ow, ox + dx));
        const newY = Math.max(0, Math.min(vh - oh, oy + dy));
        drag.currentRect = [Math.round(newX), Math.round(newY), ow, oh];
      } else {
        // Resize: anchor the opposite edges, move only the dragged corner/edge.
        let nx = ox, ny = oy, nw = ow, nh = oh;
        const h = drag.handle!;
        if (h.includes("w")) {
          const maxLeft = ox + ow - MIN_SIZE;
          nx = Math.max(0, Math.min(maxLeft, ox + dx));
          nw = ow + (ox - nx);
        } else if (h.includes("e")) {
          nw = Math.max(MIN_SIZE, Math.min(vw - ox, ow + dx));
        }
        if (h.includes("n")) {
          const maxTop = oy + oh - MIN_SIZE;
          ny = Math.max(0, Math.min(maxTop, oy + dy));
          nh = oh + (oy - ny);
        } else if (h.includes("s")) {
          nh = Math.max(MIN_SIZE, Math.min(vh - oy, oh + dy));
        }
        drag.currentRect = [Math.round(nx), Math.round(ny), Math.round(nw), Math.round(nh)];
      }
      forceRerender();
    };
    const onUp = () => {
      const drag = dragRef.current;
      if (!drag) return;
      if (drag.moved && onMoveRect) {
        onMoveRect(drag.actionId, drag.rectIndex, drag.currentRect);
      }
      lastDragMovedRef.current = drag.moved;
      if (drag.moved) {
        // Clear after the synchronous click event that follows mouseup, so unrelated
        // future clicks aren't suppressed.
        setTimeout(() => { lastDragMovedRef.current = false; }, 0);
      }
      dragRef.current = null;
      forceRerender();
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [toVideoCoords, onMoveRect]);

  // Esc cancels an in-progress rect drag or draw without committing.
  // Capture-phase so it runs before the global "Esc deselects action" handler.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (dragRef.current) {
        dragRef.current = null;
        lastDragMovedRef.current = false;
        forceRerender();
        e.stopImmediatePropagation();
        e.preventDefault();
        return;
      }
      if (drawStart) {
        setDrawStart(null);
        setDrawCurrent(null);
        e.stopImmediatePropagation();
        e.preventDefault();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [drawStart]);

  // Apply drag overrides to an overlay if this rect is the one being dragged.
  const overlayRectFor = (overlay: LabeledOverlay): [number, number, number, number] => {
    const drag = dragRef.current;
    if (drag && drag.actionId === overlay.actionId && drag.rectIndex === overlay.rectIndex) {
      return drag.currentRect;
    }
    return overlay.rect;
  };

  // Same idea for callout text panels — they render the selected callout's panels.
  const calloutRectAt = (idx: number, original: [number, number, number, number]): [number, number, number, number] => {
    const drag = dragRef.current;
    if (drag && selectedActionId && drag.actionId === selectedActionId && drag.rectIndex === idx) {
      return drag.currentRect;
    }
    return original;
  };

  const videoSrc = videoPath ? assetUrl(videoPath) : null;

  /** Convert video-pixel rect [x,y,w,h] to CSS style positioned within the container,
   *  accounting for object-contain letterboxing. */
  const videoRectToStyle = (rect: [number, number, number, number]) => {
    const video = videoRef.current;
    if (!video) return {};
    const { displayW, displayH, offsetX, offsetY, vw, vh } = getVideoDisplayRect(video);
    return {
      left: offsetX + (rect[0] / vw) * displayW,
      top: offsetY + (rect[1] / vh) * displayH,
      width: (rect[2] / vw) * displayW,
      height: (rect[3] / vh) * displayH,
    };
  };

  return (
    <div className="bg-black overflow-hidden h-full">
      {/* Video container — fills entire space */}
      <div
        ref={containerRef}
        className={`relative w-full h-full ${drawingZoom ? "cursor-crosshair" : ""}`}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        {videoSrc ? (
          <video
            ref={videoRef}
            src={videoSrc}
            className="w-full h-full object-contain"
            onTimeUpdate={handleTimeUpdate}
            onLoadedMetadata={handleLoadedMetadata}
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
            onEnded={() => setIsPlaying(false)}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-zinc-500">
            No recording loaded
          </div>
        )}

        {/* Labeled overlay rects — positioned to match actual video display area */}
        {labeledOverlays && videoRef.current && labeledOverlays.map((overlay, i) => {
          const effectiveRect = overlayRectFor(overlay);
          const style = videoRectToStyle(effectiveRect);
          const opacity = overlay.selected ? 1 : 0.5;
          const isDragging = dragRef.current?.actionId === overlay.actionId && dragRef.current?.rectIndex === overlay.rectIndex;
          return (
            <div
              key={`${overlay.actionId}-${i}`}
              className={`absolute ${drawingZoom ? "cursor-pointer" : "cursor-move"}`}
              style={{
                ...style,
                border: `2px solid ${overlay.color}`,
                backgroundColor: `${overlay.color}${overlay.selected ? "1a" : "0d"}`,
                opacity: isDragging ? 0.85 : opacity,
                borderRadius: "3px",
                pointerEvents: drawingZoom ? "none" : "auto",
              }}
              onMouseDown={(e) => handleOverlayMouseDown(e, overlay)}
              onClick={(e) => {
                if (lastDragMovedRef.current) {
                  lastDragMovedRef.current = false;
                  e.stopPropagation();
                  return;
                }
                e.stopPropagation();
                onSelectAction?.(overlay.actionId);
              }}
            >
              <div
                className="absolute -top-5 left-0 max-w-full truncate px-1 py-0.5 rounded text-white font-medium whitespace-nowrap"
                style={{
                  fontSize: "9px",
                  lineHeight: "12px",
                  backgroundColor: `${overlay.color}cc`,
                  pointerEvents: "none",
                }}
              >
                {overlay.label}
              </div>

              {/* Resize handles — only on the selected overlay; suppressed in draw mode. */}
              {overlay.selected && !drawingZoom && onMoveRect && (() => {
                const HANDLES: { h: ResizeHandle; cursor: string; style: React.CSSProperties }[] = [
                  { h: "nw", cursor: "nwse-resize", style: { left: -4, top: -4 } },
                  { h: "n",  cursor: "ns-resize",   style: { left: "50%", top: -4, transform: "translateX(-50%)" } },
                  { h: "ne", cursor: "nesw-resize", style: { right: -4, top: -4 } },
                  { h: "e",  cursor: "ew-resize",   style: { right: -4, top: "50%", transform: "translateY(-50%)" } },
                  { h: "se", cursor: "nwse-resize", style: { right: -4, bottom: -4 } },
                  { h: "s",  cursor: "ns-resize",   style: { left: "50%", bottom: -4, transform: "translateX(-50%)" } },
                  { h: "sw", cursor: "nesw-resize", style: { left: -4, bottom: -4 } },
                  { h: "w",  cursor: "ew-resize",   style: { left: -4, top: "50%", transform: "translateY(-50%)" } },
                ];
                return HANDLES.map((handle) => (
                  <div
                    key={handle.h}
                    className="absolute"
                    style={{
                      width: 8,
                      height: 8,
                      backgroundColor: overlay.color,
                      border: "1px solid white",
                      borderRadius: 2,
                      cursor: handle.cursor,
                      ...handle.style,
                    }}
                    onMouseDown={(e) => handleResizeMouseDown(e, overlay, handle.h)}
                    onClick={(e) => e.stopPropagation()}
                  />
                ));
              })()}
            </div>
          );
        })}

        {/* Callout text panel previews */}
        {calloutPanels && videoRef.current && calloutPanels.map((panel, i) => {
          const effectiveRect = calloutRectAt(i, panel.rect);
          const style = videoRectToStyle(effectiveRect);
          const { displayW, vw } = videoRef.current ? getVideoDisplayRect(videoRef.current) : { displayW: 1, vw: 1 };
          const scaleRatio = displayW / vw;
          return (
            <div
              key={i}
              className="absolute pointer-events-none flex items-center justify-center overflow-hidden"
              style={{
                ...style,
                border: "2px solid rgba(251, 191, 36, 0.6)",
                backgroundColor: "rgba(0, 0, 0, 0.5)",
                borderRadius: "4px",
              }}
            >
              {panel.text && (
                <span
                  className="text-white font-semibold text-center px-1 leading-tight"
                  style={{
                    fontSize: `${Math.max(8, panel.fontSize * scaleRatio)}px`,
                    wordBreak: "break-word",
                  }}
                >
                  {panel.text}
                </span>
              )}
            </div>
          );
        })}

        {/* Drawing rect */}
        {drawingRect && videoRef.current && (() => {
          const style = videoRectToStyle([drawingRect.x, drawingRect.y, drawingRect.w, drawingRect.h]);
          return (
            <div
              className="absolute border-2 border-yellow-400 bg-yellow-400/10 pointer-events-none flex items-end justify-end"
              style={style}
            >
              <span className="bg-yellow-400 text-black text-[10px] font-mono font-semibold px-1 py-px rounded-sm leading-none mr-0.5 mb-0.5">
                {drawingRect.w}×{drawingRect.h}
              </span>
            </div>
          );
        })()}

        {/* Live WxH readout while moving/resizing an existing rect */}
        {dragRef.current && dragRef.current.moved && videoRef.current && (() => {
          const drag = dragRef.current!;
          const style = videoRectToStyle(drag.currentRect);
          return (
            <div className="absolute pointer-events-none flex items-end justify-end" style={style}>
              <span className="bg-zinc-900/90 text-white text-[10px] font-mono font-semibold px-1 py-px rounded-sm leading-none mr-0.5 mb-0.5">
                {drag.currentRect[0]},{drag.currentRect[1]} • {drag.currentRect[2]}×{drag.currentRect[3]}
              </span>
            </div>
          );
        })()}
      </div>
    </div>
  );
}
