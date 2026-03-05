import { forwardRef, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useProjectStore } from "../stores/useProjectStore";
import { assetUrl } from "../lib/fileOps";
import { formatTime } from "../lib/formatTime";
import { ACTION_COLORS, ACTION_LABELS, ACTION_TEXT_COLORS, ACTION_DISPLAY_NAMES } from "../lib/constants";
import { ActionIcon, PlusIcon } from "./ActionIcon";
import type { TimelineAction } from "../types";

/** Range-based action types that support drag-to-select */
const RANGE_ACTIONS: TimelineAction["type"][] = ["spotlight", "blur", "mute", "speed", "callout", "music"];

/** Viewport-aware popup for grouped action markers */
const GroupPopup = forwardRef<
  HTMLDivElement,
  {
    badgeRect: DOMRect;
    group: { actions: TimelineAction[]; ts: number };
    selectedActionId: string | null;
    onSelect: (action: TimelineAction) => void;
  }
>(({ badgeRect, group, selectedActionId, onSelect }, ref) => {
  const innerRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    const popupRect = el.getBoundingClientRect();
    const pad = 8;

    // Horizontal: center on badge, clamp to viewport
    let left = badgeRect.left + badgeRect.width / 2 - popupRect.width / 2;
    left = Math.max(pad, Math.min(left, window.innerWidth - popupRect.width - pad));

    // Vertical: prefer above badge, fall back to below
    let top = badgeRect.top - popupRect.height - 4;
    if (top < pad) {
      top = badgeRect.bottom + 4;
    }

    setPos({ left, top });
  }, [badgeRect]);

  return (
    <div
      ref={(node) => {
        (innerRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
        if (typeof ref === "function") ref(node);
        else if (ref) (ref as React.MutableRefObject<HTMLDivElement | null>).current = node;
      }}
      className="absolute bg-zinc-900 border border-zinc-700/50 rounded-lg shadow-2xl min-w-40 py-1"
      style={{
        left: pos?.left ?? badgeRect.left,
        top: pos?.top ?? badgeRect.top - 100,
        visibility: pos ? "visible" : "hidden",
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="px-3 py-1 text-[9px] text-zinc-500 font-mono border-b border-zinc-700/40">
        {formatTime(group.ts)}
      </div>
      {group.actions.map((action) => (
        <button
          key={action.id}
          className={`flex items-center gap-2 w-full px-3 py-1.5 text-xs text-left hover:bg-zinc-800/70 transition-colors ${
            selectedActionId === action.id ? "bg-zinc-800" : ""
          } ${ACTION_TEXT_COLORS[action.type] || "text-zinc-300"}`}
          onClick={(e) => {
            e.stopPropagation();
            onSelect(action);
          }}
        >
          <span className={`w-3 h-3 rounded-full ${ACTION_COLORS[action.type]} shrink-0`} />
          {ACTION_DISPLAY_NAMES[action.type] || action.type}
        </button>
      ))}
    </div>
  );
});

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
  const [, setMenuPos] = useState<{ x: number; y: number } | null>(null);
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
      setOpenGroupIdx(null);
      setGroupBadgeRect(null);
    },
    [clientXToTime],
  );

  // Use document-level listeners for drag so it continues over the scrollbar
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

  // Group overlapping actions into clusters (within 12px)
  const actionGroups = useMemo(() => {
    const sorted = [...actions].sort((a, b) => a.timestamp - b.timestamp);
    const groups: { actions: typeof actions; left: number; ts: number }[] = [];
    for (const a of sorted) {
      const left = a.timestamp * pxPerSec;
      const existing = groups.find((g) => Math.abs(g.left - left) < 12);
      if (existing) {
        existing.actions.push(a);
      } else {
        groups.push({ actions: [a], left, ts: a.timestamp });
      }
    }
    return groups;
  }, [actions, pxPerSec]);

  const [openGroupIdx, setOpenGroupIdx] = useState<number | null>(null);
  const [groupBadgeRect, setGroupBadgeRect] = useState<DOMRect | null>(null);
  const groupPopupRef = useRef<HTMLDivElement>(null);

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

  // Compute time range for the selected action (if it has a range)
  const selectedActionRange = useMemo(() => {
    if (!selectedActionId) return null;
    const action = actions.find((a) => a.id === selectedActionId);
    if (!action) return null;

    let endTime: number | null = null;
    switch (action.type) {
      case "spotlight": endTime = action.timestamp + (action.spotlightDuration ?? 3); break;
      case "blur": endTime = action.timestamp + (action.blurDuration ?? 3); break;
      case "mute": endTime = action.muteEndTimestamp ?? null; break;
      case "speed": endTime = action.speedEndTimestamp ?? null; break;
      case "skip": endTime = action.skipEndTimestamp ?? null; break;
      case "callout": endTime = action.timestamp + (action.calloutDuration ?? 3); break;
      case "music": endTime = action.musicEndTimestamp ?? null; break;
      case "zoom": endTime = action.timestamp + (action.zoomDuration ?? 1) + (action.zoomHold ?? 2); break;
      default: return null;
    }
    if (!endTime || endTime <= action.timestamp) return null;

    const color = ACTION_COLORS[action.type] || "bg-zinc-500";
    return {
      left: action.timestamp * pxPerSec,
      width: (endTime - action.timestamp) * pxPerSec,
      color,
    };
  }, [selectedActionId, actions, pxPerSec]);

  return (
    <div
      ref={containerRef}
      className="bg-zinc-950 border-t border-zinc-700/40 flex flex-col select-none relative"
      onWheel={handleWheel}
    >
      <style dangerouslySetInnerHTML={{ __html: `
        .timeline-scroll::-webkit-scrollbar { height: 16px !important; }
        .timeline-scroll::-webkit-scrollbar-track { background: #18181b; }
        .timeline-scroll::-webkit-scrollbar-thumb { background: #3f3f46; border-radius: 8px; border: 3px solid #18181b; }
        .timeline-scroll::-webkit-scrollbar-thumb:hover { background: #52525b; }
      `}} />
      {/* Toolbar */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-zinc-800/50">
        <span className="text-[11px] text-zinc-500 font-semibold uppercase tracking-wider">Timeline</span>

        <div className="relative">
          <button
            onClick={() => setShowAddMenu(!showAddMenu)}
            className="flex items-center gap-1.5 px-4 py-1.5 bg-linear-to-r from-violet-600 to-purple-600 hover:from-violet-500 hover:to-purple-500 text-white text-sm font-medium rounded-md shadow-lg shadow-violet-500/25 transition-colors"
          >
            <PlusIcon size={14} />
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

        {/* Show drag selection info */}
        {selectionRange && (
          <span className="text-[10px] text-violet-400 font-mono">
            {formatTime(selectionRange.startTime)} — {formatTime(selectionRange.endTime)}
          </span>
        )}

        <span className="text-[10px] text-zinc-600">
          Drag to select range
        </span>

        <span className="text-xs text-zinc-400 font-mono tabular-nums">
          {formatTime(playheadTime)} / {formatTime(duration)}
        </span>
      </div>

      {/* Scrollable timeline area */}
      <div
        ref={scrollContainerRef}
        className="overflow-x-auto overflow-y-hidden flex-1 timeline-scroll"
        style={{ minHeight: 120 }}
      >
        <div
          ref={timelineInnerRef}
          className="relative"
          style={{ width: totalWidth, minWidth: "100%" }}
          onMouseDown={handleMouseDown}
        >
          {/* Time ruler */}
          <div className="h-5 relative border-b border-zinc-800/50">
            {Array.from({ length: Math.ceil(duration) + 1 }, (_, i) => (
              <div
                key={i}
                className="absolute top-0 h-full border-l border-zinc-700/40"
                style={{ left: i * pxPerSec }}
              >
                {i % Math.max(1, Math.round(5 / zoom)) === 0 && (
                  <span className="text-[9px] text-zinc-500 ml-1">
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
          <div className="relative" style={{ height: 32 }}>
            {actionGroups.map((group, gi) => {
              const isSingle = group.actions.length === 1;
              const hasSelected = group.actions.some((a) => a.id === selectedActionId);

              if (isSingle) {
                const action = group.actions[0];
                return (
                  <button
                    key={action.id}
                    className={`absolute w-5 h-5 rounded-full text-[9px] font-bold text-white flex items-center justify-center shadow cursor-pointer border-2 z-10 ${
                      selectedActionId === action.id
                        ? "border-white scale-125 z-20"
                        : "border-transparent"
                    } ${ACTION_COLORS[action.type]}`}
                    style={{ left: group.left - 10, top: 4 }}
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedAction(action.id);
                      setPlayhead(action.timestamp);
                    }}
                    title={`${ACTION_DISPLAY_NAMES[action.type] || action.type} @ ${formatTime(action.timestamp)}`}
                  >
                    {ACTION_LABELS[action.type]}
                  </button>
                );
              }

              // Grouped badge
              return (
                <div key={`group-${gi}`} className="absolute z-10" style={{ left: group.left - 12, top: 4 }}>
                  <button
                    className={`w-6 h-6 rounded-full text-[9px] font-bold text-white flex items-center justify-center shadow cursor-pointer border-2 bg-zinc-700 ${
                      hasSelected ? "border-white scale-110" : "border-zinc-400"
                    }`}
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (openGroupIdx === gi) {
                        setOpenGroupIdx(null);
                        setGroupBadgeRect(null);
                      } else {
                        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                        setGroupBadgeRect(rect);
                        setOpenGroupIdx(gi);
                      }
                    }}
                    title={`${group.actions.length} actions @ ${formatTime(group.ts)}`}
                  >
                    {group.actions.length}
                  </button>

                  {/* Popup rendered via portal-style fixed overlay below */}
                </div>
              );
            })}
          </div>

          {/* Selected action range highlight */}
          {selectedActionRange && (
            <div
              className={`absolute top-0 bottom-0 opacity-20 pointer-events-none ${selectedActionRange.color}`}
              style={{ left: selectedActionRange.left, width: selectedActionRange.width }}
            />
          )}

          {/* Drag selection highlight */}
          {selectionRange && (
            <div
              className="absolute top-0 bottom-0 bg-violet-500/20 border-l border-r border-violet-400/50 pointer-events-none z-5"
              style={{ left: selectionRange.left, width: selectionRange.width }}
            />
          )}

          {/* Playhead */}
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-red-500 pointer-events-none z-10 shadow-[0_0_8px_rgba(239,68,68,0.5)]"
            style={{ left: playheadTime * pxPerSec }}
          >
            <div className="w-3 h-3 bg-red-500 rounded-full -translate-x-[5px] -translate-y-1 shadow-[0_0_6px_rgba(239,68,68,0.6)]" />
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

      {/* Group actions popup — portaled to body to escape all overflow/z-index issues */}
      {openGroupIdx !== null && groupBadgeRect && actionGroups[openGroupIdx] && createPortal(
        <div
          className="fixed inset-0"
          style={{ zIndex: 9999 }}
          onClick={() => { setOpenGroupIdx(null); setGroupBadgeRect(null); }}
        >
          <GroupPopup
            ref={groupPopupRef}
            badgeRect={groupBadgeRect}
            group={actionGroups[openGroupIdx]}
            selectedActionId={selectedActionId}
            onSelect={(action) => {
              setSelectedAction(action.id);
              setPlayhead(action.timestamp);
              setOpenGroupIdx(null);
              setGroupBadgeRect(null);
            }}
          />
        </div>,
        document.body,
      )}
    </div>
  );
}
