import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useProjectStore } from "../stores/useProjectStore";
import { assetUrl } from "../lib/fileOps";
import { formatTime } from "../lib/formatTime";
import { ACTION_COLORS, ACTION_LABELS, ACTION_TEXT_COLORS, ACTION_DISPLAY_NAMES } from "../lib/constants";
import { ActionIcon, PlusIcon } from "./ActionIcon";
import type { TimelineAction } from "../types";

/** Range-based action types that support drag-to-select */
const RANGE_ACTIONS: TimelineAction["type"][] = ["spotlight", "speed", "callout", "music"];

export function Timeline() {
  const project = useProjectStore((s) => s.project);
  const actions = useProjectStore((s) => s.project?.actions ?? []);
  const filmstripPaths = useProjectStore((s) => s.filmstripPaths);
  const playheadTime = useProjectStore((s) => s.playheadTime);
  const selectedActionId = useProjectStore((s) => s.selectedActionId);
  const setPlayhead = useProjectStore((s) => s.setPlayhead);
  const setSelectedAction = useProjectStore((s) => s.setSelectedAction);
  const addAction = useProjectStore((s) => s.addAction);

  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(800);
  const [zoom, setZoom] = useState(1);
  const [showAddMenu, setShowAddMenu] = useState(false);

  // Drag-to-select state
  const [dragStart, setDragStart] = useState<number | null>(null);
  const [dragEnd, setDragEnd] = useState<number | null>(null);
  const [showRangeMenu, setShowRangeMenu] = useState(false);
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  const isDragging = useRef(false);
  const timelineInnerRef = useRef<HTMLDivElement>(null);

  const duration = project?.recordingDuration ?? 0;
  const pxPerSec = useMemo(() => Math.max(10, (containerWidth / Math.max(duration, 1)) * zoom), [containerWidth, duration, zoom]);
  const totalWidth = duration * pxPerSec;

  // Observe container width
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver((entries) => {
      setContainerWidth(entries[0].contentRect.width);
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Convert clientX to time
  const clientXToTime = useCallback(
    (clientX: number) => {
      const inner = timelineInnerRef.current;
      if (!inner) return 0;
      const rect = inner.getBoundingClientRect();
      const x = clientX - rect.left;
      return Math.max(0, Math.min(duration, x / pxPerSec));
    },
    [pxPerSec, duration],
  );

  // Mouse down — start potential drag
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      const time = clientXToTime(e.clientX);
      setDragStart(time);
      setDragEnd(null);
      setShowRangeMenu(false);
      isDragging.current = false;
    },
    [clientXToTime],
  );

  // Mouse move — extend drag
  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (dragStart === null) return;
      const time = clientXToTime(e.clientX);
      if (!isDragging.current && Math.abs(time - dragStart) > 0.3) {
        isDragging.current = true;
      }
      if (isDragging.current) {
        setDragEnd(time);
      }
    },
    [dragStart, clientXToTime],
  );

  // Mouse up — finish drag or simple click
  const handleMouseUp = useCallback(
    (e: React.MouseEvent) => {
      if (dragStart === null) return;
      const time = clientXToTime(e.clientX);

      if (isDragging.current && dragEnd !== null) {
        // Drag completed — show range action menu at mouse position relative to outer container
        const containerRect = containerRef.current?.getBoundingClientRect();
        if (containerRect) {
          setMenuPos({
            x: e.clientX - containerRect.left,
            y: 4,
          });
        }
        setShowRangeMenu(true);
      } else {
        // Simple click — seek playhead
        setPlayhead(time);
        setSelectedAction(null);
        setDragStart(null);
        setDragEnd(null);
      }
      isDragging.current = false;
    },
    [dragStart, dragEnd, clientXToTime, setPlayhead, setSelectedAction],
  );

  // Add range-based action from drag selection
  const handleAddRangeAction = useCallback(
    (type: TimelineAction["type"]) => {
      if (dragStart === null || dragEnd === null) return;
      const start = Math.min(dragStart, dragEnd);
      const end = Math.max(dragStart, dragEnd);
      addAction(type, start, end);
      setDragStart(null);
      setDragEnd(null);
      setShowRangeMenu(false);
      setMenuPos(null);
    },
    [dragStart, dragEnd, addAction],
  );

  const clearDragSelection = useCallback(() => {
    setDragStart(null);
    setDragEnd(null);
    setShowRangeMenu(false);
    setMenuPos(null);
  }, []);

  // Zoom with scroll wheel
  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const delta = e.deltaY > 0 ? 0.9 : 1.1;
        setZoom((z) => Math.max(0.1, Math.min(10, z * delta)));
      }
    },
    [],
  );

  // Add action at playhead position
  const handleAddAction = useCallback(
    (type: TimelineAction["type"]) => {
      addAction(type, playheadTime);
      setShowAddMenu(false);
    },
    [addAction, playheadTime],
  );

  // Action marker positions
  const actionPositions = useMemo(() => {
    return actions.map((a) => ({
      action: a,
      left: a.timestamp * pxPerSec,
    }));
  }, [actions, pxPerSec]);

  // Filmstrip thumb positions (one every 2 seconds)
  const thumbWidth = 80;
  const thumbPositions = useMemo(() => {
    return filmstripPaths.map((path, i) => ({
      path,
      left: i * 2 * pxPerSec,
      width: Math.min(thumbWidth, 2 * pxPerSec),
    }));
  }, [filmstripPaths, pxPerSec]);

  // Drag selection range in pixels
  const selectionRange = useMemo(() => {
    if (dragStart === null || dragEnd === null) return null;
    const start = Math.min(dragStart, dragEnd);
    const end = Math.max(dragStart, dragEnd);
    return {
      left: start * pxPerSec,
      width: (end - start) * pxPerSec,
      startTime: start,
      endTime: end,
    };
  }, [dragStart, dragEnd, pxPerSec]);

  return (
    <div
      ref={containerRef}
      className="bg-slate-900 border-t border-slate-700 flex flex-col select-none relative"
      onWheel={handleWheel}
    >
      {/* Toolbar */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-slate-800">
        <span className="text-[11px] text-slate-500 font-semibold uppercase tracking-wider">Timeline</span>

        <div className="relative">
          <button
            onClick={() => setShowAddMenu(!showAddMenu)}
            className="flex items-center gap-1.5 px-4 py-1.5 bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium rounded-md shadow-sm transition-colors"
          >
            <PlusIcon size={14} />
            Add Action
          </button>
          {showAddMenu && (
            <div className="absolute bottom-full left-0 mb-1 bg-slate-800 border border-slate-600 rounded-lg shadow-xl z-20 min-w-[180px] py-1">
              {(["narrate", "zoom", "spotlight", "speed", "callout", "music"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => handleAddAction(t)}
                  className={`flex items-center gap-2.5 w-full px-4 py-2 text-sm text-left hover:bg-slate-700/70 transition-colors ${ACTION_TEXT_COLORS[t] || "text-slate-300"}`}
                >
                  <ActionIcon type={t} size={14} />
                  {ACTION_DISPLAY_NAMES[t] || t}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex-1" />

        {/* Show drag selection info */}
        {selectionRange && (
          <span className="text-[10px] text-violet-400 font-mono">
            {formatTime(selectionRange.startTime)} — {formatTime(selectionRange.endTime)}
          </span>
        )}

        <span className="text-[10px] text-slate-600">
          Drag to select range
        </span>

        <span className="text-xs text-slate-400 font-mono tabular-nums">
          {formatTime(playheadTime)} / {formatTime(duration)}
        </span>
      </div>

      {/* Scrollable timeline area */}
      <div
        ref={scrollContainerRef}
        className="overflow-x-auto overflow-y-hidden flex-1"
        style={{ minHeight: 120 }}
      >
        <div
          ref={timelineInnerRef}
          className="relative"
          style={{ width: totalWidth, minWidth: "100%" }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={() => {
            if (isDragging.current) {
              isDragging.current = false;
              if (dragEnd !== null) setShowRangeMenu(true);
            }
          }}
        >
          {/* Time ruler */}
          <div className="h-5 relative border-b border-slate-800">
            {Array.from({ length: Math.ceil(duration) + 1 }, (_, i) => (
              <div
                key={i}
                className="absolute top-0 h-full border-l border-slate-700"
                style={{ left: i * pxPerSec }}
              >
                {i % Math.max(1, Math.round(5 / zoom)) === 0 && (
                  <span className="text-[9px] text-slate-500 ml-1">
                    {formatTime(i)}
                  </span>
                )}
              </div>
            ))}
          </div>

          {/* Filmstrip row */}
          <div className="h-12 relative overflow-hidden">
            {thumbPositions.map(({ path, left, width }, i) => (
              <img
                key={i}
                src={assetUrl(path)}
                alt=""
                className="absolute top-0 h-12 object-cover opacity-60"
                style={{ left, width }}
                draggable={false}
              />
            ))}
          </div>

          {/* Action markers row */}
          <div className="h-8 relative">
            {actionPositions.map(({ action, left }) => (
              <button
                key={action.id}
                className={`absolute top-1 w-5 h-5 rounded-full text-[9px] font-bold text-white flex items-center justify-center shadow cursor-pointer border-2 ${
                  selectedActionId === action.id
                    ? "border-white scale-125"
                    : "border-transparent"
                } ${ACTION_COLORS[action.type]}`}
                style={{ left: left - 10 }}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedAction(action.id);
                  setPlayhead(action.timestamp);
                }}
                title={`${action.type} @ ${formatTime(action.timestamp)}`}
              >
                {ACTION_LABELS[action.type]}
              </button>
            ))}
          </div>

          {/* Drag selection highlight */}
          {selectionRange && (
            <div
              className="absolute top-0 bottom-0 bg-violet-500/20 border-l border-r border-violet-400/50 pointer-events-none z-5"
              style={{ left: selectionRange.left, width: selectionRange.width }}
            />
          )}

          {/* Playhead */}
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-red-500 pointer-events-none z-10"
            style={{ left: playheadTime * pxPerSec }}
          >
            <div className="w-3 h-3 bg-red-500 rounded-full -translate-x-[5px] -translate-y-1" />
          </div>
        </div>
      </div>

      {/* Range action menu — fixed center overlay */}
      {showRangeMenu && selectionRange && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={clearDragSelection}>
          <div
            className="bg-slate-800 border border-slate-600 rounded-xl shadow-2xl min-w-[220px] py-2"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 py-2 text-xs text-slate-400 border-b border-slate-700 text-center font-mono">
              {formatTime(selectionRange.startTime)} — {formatTime(selectionRange.endTime)}
            </div>
            <div className="py-1">
              {RANGE_ACTIONS.map((t) => (
                <button
                  key={t}
                  onClick={() => handleAddRangeAction(t)}
                  className={`flex items-center gap-3 w-full px-5 py-2.5 text-sm text-left hover:bg-slate-700/70 transition-colors ${ACTION_TEXT_COLORS[t] || "text-slate-300"}`}
                >
                  <ActionIcon type={t} size={15} />
                  {ACTION_DISPLAY_NAMES[t] || t}
                </button>
              ))}
            </div>
            <button
              onClick={clearDragSelection}
              className="w-full px-4 py-2 text-[11px] text-slate-500 hover:text-slate-300 border-t border-slate-700"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
