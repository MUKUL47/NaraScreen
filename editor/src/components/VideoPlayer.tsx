import { useRef, useEffect, useCallback, useState } from "react";
import { assetUrl } from "../lib/fileOps";
import { formatTime } from "../lib/formatTime";

interface VideoPlayerProps {
  videoPath: string | null;
  currentTime: number;
  onTimeUpdate: (time: number) => void;
  onDurationChange?: (duration: number) => void;
  /** If true, overlay allows drawing zoom rectangle */
  drawingZoom?: boolean;
  onZoomDrawn?: (rect: [number, number, number, number]) => void;
  /** Show zoom rect overlay */
  zoomRect?: [number, number, number, number] | null;
}

export function VideoPlayer({
  videoPath,
  currentTime,
  onTimeUpdate,
  onDurationChange,
  drawingZoom,
  onZoomDrawn,
  zoomRect,
}: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [drawStart, setDrawStart] = useState<{ x: number; y: number } | null>(null);
  const [drawCurrent, setDrawCurrent] = useState<{ x: number; y: number } | null>(null);
  const seekingRef = useRef(false);

  // Sync video time from external source
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
    setDuration(video.duration);
    onDurationChange?.(video.duration);
  }, [onDurationChange]);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      video.play();
      setIsPlaying(true);
    } else {
      video.pause();
      setIsPlaying(false);
    }
  }, []);

  const seek = useCallback(
    (delta: number) => {
      const video = videoRef.current;
      if (!video) return;
      video.currentTime = Math.max(0, Math.min(duration, video.currentTime + delta));
      onTimeUpdate(video.currentTime);
    },
    [duration, onTimeUpdate],
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

  // Seek bar drag
  const handleSeekBarClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const bar = e.currentTarget;
      const rect = bar.getBoundingClientRect();
      const ratio = (e.clientX - rect.left) / rect.width;
      const time = ratio * duration;
      const video = videoRef.current;
      if (video) {
        video.currentTime = time;
        onTimeUpdate(time);
      }
    },
    [duration, onTimeUpdate],
  );

  // Zoom drawing on video
  const toVideoCoords = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } | null => {
      const video = videoRef.current;
      if (!video) return null;
      const rect = video.getBoundingClientRect();
      const scaleX = video.videoWidth / rect.width;
      const scaleY = video.videoHeight / rect.height;
      return {
        x: Math.round(Math.max(0, (clientX - rect.left) * scaleX)),
        y: Math.round(Math.max(0, (clientY - rect.top) * scaleY)),
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

  return (
    <div className="flex flex-col bg-black rounded overflow-hidden">
      {/* Video container */}
      <div
        ref={containerRef}
        className={`relative flex-1 ${drawingZoom ? "cursor-crosshair" : ""}`}
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
          <div className="w-full h-full flex items-center justify-center text-slate-500">
            No recording loaded
          </div>
        )}

        {/* Zoom rect overlay */}
        {zoomRect && videoRef.current && (
          <div
            className="absolute border-2 border-blue-400 bg-blue-400/10 pointer-events-none"
            style={{
              left: `${(zoomRect[0] / (videoRef.current.videoWidth || 1920)) * 100}%`,
              top: `${(zoomRect[1] / (videoRef.current.videoHeight || 1080)) * 100}%`,
              width: `${(zoomRect[2] / (videoRef.current.videoWidth || 1920)) * 100}%`,
              height: `${(zoomRect[3] / (videoRef.current.videoHeight || 1080)) * 100}%`,
            }}
          />
        )}

        {/* Drawing rect */}
        {drawingRect && videoRef.current && (
          <div
            className="absolute border-2 border-yellow-400 bg-yellow-400/10 pointer-events-none"
            style={{
              left: `${(drawingRect.x / (videoRef.current.videoWidth || 1920)) * 100}%`,
              top: `${(drawingRect.y / (videoRef.current.videoHeight || 1080)) * 100}%`,
              width: `${(drawingRect.w / (videoRef.current.videoWidth || 1920)) * 100}%`,
              height: `${(drawingRect.h / (videoRef.current.videoHeight || 1080)) * 100}%`,
            }}
          />
        )}
      </div>

      {/* Controls */}
      <div className="flex items-center gap-3 px-4 py-1.5 bg-slate-900/90 border-t border-slate-800/50">
        <button
          onClick={togglePlay}
          disabled={!videoSrc}
          className="w-7 h-7 flex items-center justify-center rounded-md bg-slate-800 hover:bg-slate-700 text-white text-xs font-mono disabled:opacity-30 transition-colors"
        >
          {isPlaying ? "||" : "\u25B6"}
        </button>

        <span className="text-[11px] text-slate-400 font-mono tabular-nums w-24">
          {formatTime(currentTime)} / {formatTime(duration)}
        </span>

        {/* Seek bar */}
        <div
          className="flex-1 h-1.5 bg-slate-800 rounded-full cursor-pointer relative group"
          onClick={handleSeekBarClick}
        >
          <div
            className="h-full bg-violet-500 rounded-full transition-all"
            style={{ width: `${duration > 0 ? (currentTime / duration) * 100 : 0}%` }}
          />
          <div
            className="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full shadow opacity-0 group-hover:opacity-100 transition-opacity"
            style={{ left: `${duration > 0 ? (currentTime / duration) * 100 : 0}%` }}
          />
        </div>

        <span className="text-[9px] text-slate-600 hidden lg:inline">
          Space / Arrows
        </span>
      </div>
    </div>
  );
}
