import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useProjectStore } from "../stores/useProjectStore";
import { assetUrl } from "../lib/fileOps";
import { formatTime } from "../lib/formatTime";
import { ACTION_BG_COLORS, ACTION_BORDER_COLORS, ACTION_TEXT_COLORS, ACTION_DISPLAY_NAMES } from "../lib/constants";
import { ActionIcon, PlusIcon } from "./ActionIcon";
import { Video } from "lucide-react";
import type { TimelineAction, ActionType } from "../types";

/** Range-based action types that support drag-to-select */
const RANGE_ACTIONS: ActionType[] = ["spotlight", "blur", "mute", "speed", "callout", "music"];

/** Fixed display order for lanes */
const LANE_ORDER: ActionType[] = ["narrate", "zoom", "spotlight", "blur", "mute", "speed", "skip", "callout", "music", "pause"];

/** Compute the end time of an action for pill width */
function getActionEndTime(action: TimelineAction): number {
  switch (action.type) {
    case "spotlight": return action.timestamp + (action.spotlightDuration ?? 3);
    case "blur": return action.timestamp + (action.blurDuration ?? 3);
    case "mute": return action.muteEndTimestamp ?? action.timestamp + 3;
    case "speed": return action.speedEndTimestamp ?? action.timestamp + 5;
    case "skip": return action.skipEndTimestamp ?? action.timestamp + 3;
    case "callout": return action.timestamp + (action.calloutDuration ?? 3);
    case "music": return action.musicEndTimestamp ?? action.timestamp + 10;
    case "zoom": return action.timestamp + (action.zoomDuration ?? 1) + (action.zoomHold ?? 2);
    case "narrate": return action.timestamp + 2;
    case "pause": return action.timestamp + 1;
    default: return action.timestamp + 1;
  }
}

const RULER_H = 24;
const FILMSTRIP_H = 48;
const LANE_H = 28;
const SIDEBAR_W = 44;

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
  const [showAddMenu, setShowAddMenu] = useState(false);

  // Drag-to-select state
  const [dragStart, setDragStart] = useState<number | null>(null);
  const [dragEnd, setDragEnd] = useState<number | null>(null);
  const [showRangeMenu, setShowRangeMenu] = useState(false);
  const [finalRange, setFinalRange] = useState<[number, number] | null>(null);
  const isDragging = useRef(false);
  const timelineInnerRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const duration = project?.recordingDuration ?? 0;
  const pxPerSec = useMemo(() => Math.max(10, containerWidth / Math.max(duration, 1)), [containerWidth, duration]);
  const totalWidth = duration * pxPerSec;

  // Active lanes — only types with at least one action
  const activeLanes = useMemo(() => {
    const types = new Set(actions.map((a) => a.type));
    return LANE_ORDER.filter((t) => types.has(t));
  }, [actions]);

  const totalContentHeight = RULER_H + FILMSTRIP_H + activeLanes.length * LANE_H;

  // Observe container width
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const obs = new ResizeObserver((entries) => {
      setContainerWidth(entries[0].contentRect.width - SIDEBAR_W);
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

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

  // Document-level drag listeners
  useEffect(() => {
    if (dragStart === null) return;

    const onMouseMove = (e: MouseEvent) => {
      const time = clientXToTime(e.clientX);
      if (!isDragging.current && Math.abs(time - dragStart) > 0.3) {
        isDragging.current = true;
      }
      if (isDragging.current) {
        setDragEnd(time);
      }
    };

    const onMouseUp = (e: MouseEvent) => {
      const time = clientXToTime(e.clientX);
      if (isDragging.current && dragEnd !== null) {
        // Freeze the selection range and detach drag listeners
        setDragStart(null);
        setFinalRange([Math.min(dragStart, dragEnd), Math.max(dragStart, dragEnd)]);
        setShowRangeMenu(true);
      } else {
        setPlayhead(time);
        setSelectedAction(null);
        setDragStart(null);
        setDragEnd(null);
      }
      isDragging.current = false;
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };
  }, [dragStart, dragEnd, clientXToTime, setPlayhead, setSelectedAction]);

  // Add range-based action from drag selection
  const handleAddRangeAction = useCallback(
    (type: ActionType) => {
      if (!finalRange) return;
      addAction(type, finalRange[0], finalRange[1]);
      setFinalRange(null);
      setDragEnd(null);
      setShowRangeMenu(false);
    },
    [finalRange, addAction],
  );

  const clearDragSelection = useCallback(() => {
    setDragStart(null);
    setDragEnd(null);
    setFinalRange(null);
    setShowRangeMenu(false);
  }, []);

  // Add action at playhead position
  const handleAddAction = useCallback(
    (type: ActionType) => {
      addAction(type, playheadTime);
      setShowAddMenu(false);
    },
    [addAction, playheadTime],
  );

  // Filmstrip thumb positions (one every 2 seconds)
  const thumbPositions = useMemo(() => {
    return filmstripPaths.map((path, i) => ({
      path,
      left: i * 2 * pxPerSec,
      width: Math.min(80, 2 * pxPerSec),
    }));
  }, [filmstripPaths, pxPerSec]);

  // Drag selection range in pixels (from active drag or frozen final range)
  const selectionRange = useMemo(() => {
    let start: number, end: number;
    if (finalRange) {
      [start, end] = finalRange;
    } else if (dragStart !== null && dragEnd !== null) {
      start = Math.min(dragStart, dragEnd);
      end = Math.max(dragStart, dragEnd);
    } else {
      return null;
    }
    return {
      left: start * pxPerSec,
      width: (end - start) * pxPerSec,
      startTime: start,
      endTime: end,
    };
  }, [dragStart, dragEnd, finalRange, pxPerSec]);

  // Adaptive ruler tick interval
  const tickInterval = useMemo(() => {
    if (pxPerSec >= 100) return 1;
    if (pxPerSec >= 40) return 2;
    if (pxPerSec >= 20) return 5;
    if (pxPerSec >= 10) return 10;
    return 30;
  }, [pxPerSec]);

  const majorTickInterval = useMemo(() => {
    if (tickInterval <= 2) return 5;
    if (tickInterval <= 5) return 10;
    return 30;
  }, [tickInterval]);

  return (
    <div
      ref={containerRef}
      className="bg-zinc-950 border-t border-zinc-700/40 flex flex-col select-none relative h-full"
    >
      <style dangerouslySetInnerHTML={{ __html: `
        .timeline-scroll::-webkit-scrollbar { height: 10px !important; }
        .timeline-scroll::-webkit-scrollbar-track { background: #18181b; }
        .timeline-scroll::-webkit-scrollbar-thumb { background: #3f3f46; border-radius: 5px; border: 2px solid #18181b; }
        .timeline-scroll::-webkit-scrollbar-thumb:hover { background: #52525b; }
      `}} />

      {/* Toolbar */}
      <div className="flex items-center gap-3 px-4 py-1.5 border-b border-zinc-800/50 shrink-0">
        <div className="relative">
          <button
            onClick={() => setShowAddMenu(!showAddMenu)}
            className="flex items-center gap-1.5 px-3 py-1 bg-linear-to-r from-violet-600 to-purple-600 hover:from-violet-500 hover:to-purple-500 text-white text-xs font-medium rounded-md shadow-lg shadow-violet-500/25 transition-colors"
          >
            <PlusIcon size={12} />
            Add Action
          </button>
          {showAddMenu && (
            <div className="absolute bottom-full left-0 mb-1 bg-zinc-900 border border-zinc-700/50 rounded-lg shadow-xl z-20 min-w-[180px] py-1">
              {(["narrate", "zoom", "spotlight", "blur", "mute", "speed", "callout", "music"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => handleAddAction(t)}
                  className={`flex items-center gap-2.5 w-full px-4 py-2 text-sm text-left hover:bg-zinc-800/70 transition-colors ${ACTION_TEXT_COLORS[t] || "text-zinc-300"}`}
                >
                  <ActionIcon type={t} size={14} />
                  {ACTION_DISPLAY_NAMES[t] || t}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex-1" />

        {/* Drag selection info */}
        {selectionRange && (
          <span className="text-[10px] text-violet-400 font-mono">
            {formatTime(selectionRange.startTime)} — {formatTime(selectionRange.endTime)}
          </span>
        )}

        <span className="text-[11px] text-zinc-400 font-mono tabular-nums">
          {formatTime(playheadTime)} / {formatTime(duration)}
        </span>
      </div>

      {/* Main timeline area: sidebar + scrollable content */}
      <div ref={scrollContainerRef} className="flex-1 overflow-auto timeline-scroll">
        <div className="flex">
          {/* Track label sidebar — sticky left */}
          <div className="sticky left-0 z-20 shrink-0 border-r border-zinc-800/50 bg-zinc-950 flex flex-col" style={{ width: SIDEBAR_W }}>
            {/* Ruler spacer — sticky top */}
            <div className="sticky top-0 bg-zinc-950 z-20 border-b border-zinc-800/30 flex items-center justify-center shrink-0" style={{ height: RULER_H }}>
              <span className="text-[8px] text-zinc-600 uppercase tracking-wider font-semibold">Time</span>
            </div>
            {/* Video track label — sticky below ruler */}
            <div className="sticky bg-zinc-950 z-10 border-b border-zinc-800/30 flex items-center justify-center shrink-0" style={{ height: FILMSTRIP_H, top: RULER_H }}>
              <Video size={13} className="text-zinc-500" />
            </div>
            {/* Action lane labels */}
            {activeLanes.map((type) => (
              <div
                key={type}
                className="border-b border-zinc-800/30 flex items-center justify-center shrink-0"
                style={{ height: LANE_H }}
                title={ACTION_DISPLAY_NAMES[type] || type}
              >
                <ActionIcon type={type} size={13} className={ACTION_TEXT_COLORS[type] || "text-zinc-500"} />
              </div>
            ))}
          </div>

          {/* Timeline content */}
          <div
            ref={timelineInnerRef}
            className="relative flex-1 flex flex-col"
            style={{ width: Math.max(totalWidth, containerWidth) }}
            onMouseDown={handleMouseDown}
          >
            {/* ─── Time ruler (sticky top) ─── */}
            <div className="sticky top-0 border-b border-zinc-800/30 bg-zinc-950 z-20 shrink-0" style={{ height: RULER_H }}>
              {Array.from({ length: Math.ceil(duration / tickInterval) + 1 }, (_, i) => {
                const t = i * tickInterval;
                if (t > duration) return null;
                const isMajor = t % majorTickInterval === 0;
                return (
                  <div
                    key={t}
                    className="absolute top-0"
                    style={{ left: t * pxPerSec }}
                  >
                    <div
                      className={isMajor ? "border-l border-zinc-600/50" : "border-l border-zinc-800/60"}
                      style={{ height: isMajor ? RULER_H : RULER_H * 0.5, marginTop: isMajor ? 0 : RULER_H * 0.5 }}
                    />
                    {isMajor && (
                      <span className="absolute top-0.5 left-1 text-[9px] text-zinc-500 whitespace-nowrap">
                        {formatTime(t)}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>

            {/* ─── Filmstrip track (sticky below ruler) ─── */}
            <div
              className="sticky border-b border-zinc-800/30 bg-zinc-950 z-10 shrink-0 overflow-hidden"
              style={{ top: RULER_H, height: FILMSTRIP_H }}
            >
              {thumbPositions.map(({ path, left, width }, i) => (
                <img
                  key={i}
                  src={assetUrl(path)}
                  alt=""
                  className="absolute top-0 h-full object-cover opacity-80 rounded-sm"
                  style={{ left, width }}
                  draggable={false}
                />
              ))}
            </div>

            {/* ─── Action lanes (flow layout) ─── */}
            <div className="relative flex-1">
              {activeLanes.map((laneType, laneIdx) => {
                const laneActions = actions.filter((a) => a.type === laneType);

                return (
                  <div
                    key={laneType}
                    className="relative border-b border-zinc-800/30"
                    style={{ height: LANE_H }}
                  >
                    {laneActions.map((action) => {
                      const left = action.timestamp * pxPerSec;
                      const endTime = getActionEndTime(action);
                      const width = Math.max((endTime - action.timestamp) * pxPerSec, 22);
                      const isSelected = action.id === selectedActionId;

                      return (
                        <button
                          key={action.id}
                          className={`absolute flex items-center gap-1 px-1.5 rounded-md cursor-pointer transition-all overflow-hidden
                            ${ACTION_BG_COLORS[laneType] || "bg-zinc-500/20"}
                            ${isSelected
                              ? `border ${ACTION_BORDER_COLORS[laneType] || "border-zinc-400"} brightness-125 z-20 shadow-sm`
                              : "border border-transparent hover:brightness-110"
                            }`}
                          style={{ left, width, top: 3, height: LANE_H - 6 }}
                          onMouseDown={(e) => e.stopPropagation()}
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedAction(action.id);
                            setPlayhead(action.timestamp);
                          }}
                          title={`${ACTION_DISPLAY_NAMES[laneType] || laneType} @ ${formatTime(action.timestamp)}`}
                        >
                          <ActionIcon
                            type={laneType}
                            size={10}
                            className={`shrink-0 ${ACTION_TEXT_COLORS[laneType] || "text-zinc-400"}`}
                          />
                          {width > 50 && (
                            <span className={`text-[9px] font-medium truncate ${ACTION_TEXT_COLORS[laneType] || "text-zinc-400"}`}>
                              {ACTION_DISPLAY_NAMES[laneType]}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                );
              })}

              {/* ─── Drag selection highlight ─── */}
              {selectionRange && (
                <div
                  className="absolute top-0 bg-violet-500/15 border-l border-r border-violet-400/40 pointer-events-none"
                  style={{ left: selectionRange.left, width: selectionRange.width, height: activeLanes.length * LANE_H }}
                />
              )}
            </div>

            {/* ─── Playhead (spans full height) ─── */}
            <div
              className="absolute top-0 pointer-events-none z-30"
              style={{ left: playheadTime * pxPerSec, height: RULER_H + FILMSTRIP_H + activeLanes.length * LANE_H }}
            >
              {/* Triangle handle */}
              <div
                className="absolute -translate-x-1.25"
                style={{ top: RULER_H - 8 }}
              >
                <svg width="10" height="8" viewBox="0 0 10 8">
                  <polygon points="0,0 10,0 5,8" fill="#ef4444" />
                </svg>
              </div>
              {/* Vertical line */}
              <div
                className="absolute top-0 w-px bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.5)]"
                style={{ left: 0, height: RULER_H + FILMSTRIP_H + activeLanes.length * LANE_H }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Range action menu — fixed center overlay */}
      {showRangeMenu && selectionRange && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={clearDragSelection}>
          <div
            className="bg-zinc-900 border border-zinc-700/50 rounded-xl shadow-2xl min-w-[220px] py-2"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 py-2 text-xs text-zinc-400 border-b border-zinc-700/40 text-center font-mono">
              {formatTime(selectionRange.startTime)} — {formatTime(selectionRange.endTime)}
            </div>
            <div className="py-1">
              {RANGE_ACTIONS.map((t) => (
                <button
                  key={t}
                  onClick={() => handleAddRangeAction(t)}
                  className={`flex items-center gap-3 w-full px-5 py-2.5 text-sm text-left hover:bg-zinc-800/70 transition-colors ${ACTION_TEXT_COLORS[t] || "text-zinc-300"}`}
                >
                  <ActionIcon type={t} size={15} />
                  {ACTION_DISPLAY_NAMES[t] || t}
                </button>
              ))}
            </div>
            <button
              onClick={clearDragSelection}
              className="w-full px-4 py-2 text-[11px] text-zinc-500 hover:text-zinc-300 border-t border-zinc-700/40"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
