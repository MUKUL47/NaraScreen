import { useRef, useEffect, useCallback, useState } from "react";
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
}: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [drawStart, setDrawStart] = useState<{ x: number; y: number } | null>(null);
  const [drawCurrent, setDrawCurrent] = useState<{ x: number; y: number } | null>(null);
  const seekingRef = useRef(false);

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
          e.preventDefault();
          seek(e.shiftKey ? -5 : -1);
          break;
        case "ArrowRight":
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
          const style = videoRectToStyle(overlay.rect);
          const opacity = overlay.selected ? 1 : 0.5;
          return (
            <div
              key={`${overlay.actionId}-${i}`}
              className="absolute cursor-pointer"
              style={{
                ...style,
                border: `2px solid ${overlay.color}`,
                backgroundColor: `${overlay.color}${overlay.selected ? "1a" : "0d"}`,
                opacity,
                borderRadius: "3px",
                pointerEvents: drawingZoom ? "none" : "auto",
              }}
              onClick={(e) => {
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
            </div>
          );
        })}

        {/* Callout text panel previews */}
        {calloutPanels && videoRef.current && calloutPanels.map((panel, i) => {
          const style = videoRectToStyle(panel.rect);
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
              className="absolute border-2 border-yellow-400 bg-yellow-400/10 pointer-events-none"
              style={style}
            />
          );
        })()}
      </div>
    </div>
  );
}
