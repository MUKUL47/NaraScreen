import { useState, useMemo, useCallback, useEffect } from "react";
import { useProjectStore } from "../stores/useProjectStore";
import { ACTION_COLORS, ACTION_DISPLAY_NAMES } from "../lib/constants";
import { getActionEndTime } from "../lib/actions";
import { ActionIcon } from "./ActionIcon";
import { formatTime } from "../lib/formatTime";
import type { TimelineAction } from "../types";

/** Hardcoded export resolutions */
const RESOLUTIONS = [
  { label: "4K (2160p)", width: 3840, height: 2160 },
  { label: "1440p", width: 2560, height: 1440 },
  { label: "1080p (Full HD)", width: 1920, height: 1080 },
  { label: "720p (HD)", width: 1280, height: 720 },
  { label: "480p", width: 854, height: 480 },
] as const;

type Resolution = (typeof RESOLUTIONS)[number];

const QUALITIES = [
  { label: "High", crf: 18, description: "Best quality, larger file" },
  { label: "Medium", crf: 23, description: "Balanced quality & size" },
  { label: "Low", crf: 28, description: "Smaller file, lower quality" },
] as const;

type Quality = (typeof QUALITIES)[number];

export interface ProduceSettings {
  selectedIds: string[];
  resolution: Resolution;
  quality: Quality;
  trim: { start: number; end: number } | null;
}

interface ProduceDialogProps {
  onConfirm: (settings: ProduceSettings) => void;
  onCancel: () => void;
}

function getActionLabel(action: TimelineAction): string {
  if (action.name) return action.name;
  const displayName = ACTION_DISPLAY_NAMES[action.type] || action.type;
  return `${displayName} @ ${formatTime(action.timestamp)}`;
}

/** Very rough estimate of processing time in seconds */
function estimateProcessingTime(
  durationSec: number,
  selectedCount: number,
  resolution: Resolution,
  quality: Quality,
): number {
  const pixelScale = (resolution.width * resolution.height) / (1920 * 1080);
  const qualityMultiplier = quality.crf <= 20 ? 1.5 : quality.crf <= 25 ? 1.0 : 0.7;
  const effectOverhead = 1 + selectedCount * 0.12;
  const baseSec = durationSec * 0.5;
  return Math.ceil(baseSec * pixelScale * qualityMultiplier * effectOverhead);
}

function formatEstimate(seconds: number): string {
  if (seconds < 60) return `~${seconds}s`;
  const min = Math.floor(seconds / 60);
  const sec = seconds % 60;
  return sec > 0 ? `~${min}m ${sec}s` : `~${min}m`;
}

/** Check if an action overlaps with a time range */
function actionOverlaps(action: TimelineAction, start: number, end: number): boolean {
  const actionEnd = getActionEndTime(action);
  return action.timestamp < end && actionEnd > start;
}

export function ProduceDialog({ onConfirm, onCancel }: ProduceDialogProps) {
  const actions = useProjectStore((s) => s.project?.actions ?? []);
  const recordingDuration = useProjectStore((s) => s.project?.recordingDuration ?? 0);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(actions.map((a) => a.id)));
  const [resolutionIdx, setResolutionIdx] = useState(2); // default 1080p
  const [qualityIdx, setQualityIdx] = useState(1); // default Medium

  // Trim state
  const [trimEnabled, setTrimEnabled] = useState(false);
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(recordingDuration);

  const resolution = RESOLUTIONS[resolutionIdx];
  const quality = QUALITIES[qualityIdx];

  // Filter actions based on trim range
  const visibleActions = useMemo(() => {
    if (!trimEnabled) return actions;
    return actions.filter((a) => actionOverlaps(a, trimStart, trimEnd));
  }, [actions, trimEnabled, trimStart, trimEnd]);

  // Group visible actions by type
  const grouped = useMemo(() => {
    const map = new Map<string, TimelineAction[]>();
    for (const a of visibleActions) {
      const list = map.get(a.type) || [];
      list.push(a);
      map.set(a.type, list);
    }
    return map;
  }, [visibleActions]);

  // When trim changes, auto-select only visible actions
  useEffect(() => {
    if (trimEnabled) {
      setSelected(new Set(visibleActions.map((a) => a.id)));
    }
  }, [trimEnabled, trimStart, trimEnd, visibleActions]);

  const toggleAction = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleType = useCallback((type: string) => {
    const typeActions = grouped.get(type);
    if (!typeActions) return;
    setSelected((prev) => {
      const next = new Set(prev);
      const allSelected = typeActions.every((a) => next.has(a.id));
      for (const a of typeActions) {
        if (allSelected) next.delete(a.id);
        else next.add(a.id);
      }
      return next;
    });
  }, [grouped]);

  const selectAll = useCallback(() => {
    setSelected(new Set(visibleActions.map((a) => a.id)));
  }, [visibleActions]);

  const selectNone = useCallback(() => {
    setSelected(new Set());
  }, []);

  const selectedCount = selected.size;
  const trimDuration = trimEnabled ? Math.max(0, trimEnd - trimStart) : recordingDuration;

  const estimate = useMemo(
    () => estimateProcessingTime(trimDuration, selectedCount, resolution, quality),
    [trimDuration, selectedCount, resolution, quality],
  );

  return (
    <div className="fixed inset-0 z-9999 bg-black/70 backdrop-blur-sm flex items-center justify-center" onClick={onCancel}>
      <div
        className="bg-zinc-900 border border-zinc-700/50 rounded-xl w-120 max-h-[80vh] flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-zinc-800/60">
          <h2 className="text-sm font-bold text-zinc-200">Produce Video</h2>
          <p className="text-[11px] text-zinc-500 mt-1">
            Configure export settings, optionally trim, and select effects.
          </p>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-4">
          {/* Trim / Slice */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <h3 className="text-[10px] text-zinc-500 font-semibold uppercase tracking-wider">Trim Video</h3>
              <button
                onClick={() => {
                  setTrimEnabled(!trimEnabled);
                  if (!trimEnabled) {
                    setTrimStart(0);
                    setTrimEnd(recordingDuration);
                  }
                }}
                className={`text-[10px] px-2 py-0.5 rounded-md transition-colors ${
                  trimEnabled
                    ? "bg-violet-600 text-white font-semibold"
                    : "bg-zinc-800/80 text-zinc-500 hover:text-zinc-300"
                }`}
              >
                {trimEnabled ? "On" : "Off"}
              </button>
              {trimEnabled && (
                <span className="text-[10px] text-violet-400 font-mono ml-auto">
                  {formatTime(trimStart)} — {formatTime(trimEnd)} ({formatEstimate(Math.ceil(trimDuration))})
                </span>
              )}
            </div>

            {trimEnabled && (
              <div className="space-y-2 pl-1">
                <div className="flex items-center gap-3">
                  <label className="text-[10px] text-zinc-400 font-semibold w-8">In</label>
                  <input
                    type="range"
                    min={0}
                    max={recordingDuration}
                    step={0.1}
                    value={trimStart}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value);
                      setTrimStart(Math.min(v, trimEnd - 0.5));
                    }}
                    className="flex-1 accent-violet-500 h-1.5"
                  />
                  <input
                    type="number"
                    min={0}
                    max={trimEnd - 0.5}
                    step={0.1}
                    value={trimStart}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value) || 0;
                      setTrimStart(Math.max(0, Math.min(v, trimEnd - 0.5)));
                    }}
                    className="w-16 bg-zinc-800/80 border border-zinc-700/30 rounded px-1.5 py-0.5 text-[10px] text-zinc-200 font-mono text-center"
                  />
                </div>
                <div className="flex items-center gap-3">
                  <label className="text-[10px] text-zinc-400 font-semibold w-8">Out</label>
                  <input
                    type="range"
                    min={0}
                    max={recordingDuration}
                    step={0.1}
                    value={trimEnd}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value);
                      setTrimEnd(Math.max(v, trimStart + 0.5));
                    }}
                    className="flex-1 accent-violet-500 h-1.5"
                  />
                  <input
                    type="number"
                    min={trimStart + 0.5}
                    max={recordingDuration}
                    step={0.1}
                    value={trimEnd}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value) || 0;
                      setTrimEnd(Math.max(trimStart + 0.5, Math.min(v, recordingDuration)));
                    }}
                    className="w-16 bg-zinc-800/80 border border-zinc-700/30 rounded px-1.5 py-0.5 text-[10px] text-zinc-200 font-mono text-center"
                  />
                </div>
                {trimEnabled && visibleActions.length !== actions.length && (
                  <p className="text-[9px] text-zinc-500">
                    Showing {visibleActions.length} of {actions.length} effects within trim range
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="border-t border-zinc-800/30" />

          {/* Export Settings */}
          <div className="space-y-3">
            <h3 className="text-[10px] text-zinc-500 font-semibold uppercase tracking-wider">Export Settings</h3>

            {/* Resolution */}
            <div>
              <label className="block text-[10px] text-zinc-400 font-semibold mb-1.5 uppercase tracking-wider">
                Resolution
              </label>
              <div className="flex flex-wrap gap-1.5">
                {RESOLUTIONS.map((res, i) => (
                  <button
                    key={res.label}
                    onClick={() => setResolutionIdx(i)}
                    className={`px-2.5 py-1.5 text-[11px] rounded-md transition-colors ${
                      i === resolutionIdx
                        ? "bg-emerald-600 text-white font-semibold"
                        : "bg-zinc-800/80 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
                    }`}
                  >
                    {res.label}
                  </button>
                ))}
              </div>
              <span className="text-[10px] text-zinc-600 mt-1 block">
                {resolution.width} x {resolution.height}
              </span>
            </div>

            {/* Quality */}
            <div>
              <label className="block text-[10px] text-zinc-400 font-semibold mb-1.5 uppercase tracking-wider">
                Quality
              </label>
              <div className="flex gap-1.5">
                {QUALITIES.map((q, i) => (
                  <button
                    key={q.label}
                    onClick={() => setQualityIdx(i)}
                    className={`flex-1 px-2.5 py-2 rounded-md transition-colors text-center ${
                      i === qualityIdx
                        ? "bg-emerald-600 text-white font-semibold"
                        : "bg-zinc-800/80 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
                    }`}
                  >
                    <div className="text-[11px] font-semibold">{q.label}</div>
                    <div className="text-[9px] opacity-70 mt-0.5">{q.description}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Estimated time */}
            <div className="flex items-center gap-2 px-3 py-2 bg-zinc-800/40 rounded-lg border border-zinc-700/20">
              <span className="text-[10px] text-zinc-500">Estimated processing time:</span>
              <span className="text-[11px] text-emerald-400 font-mono font-semibold">{formatEstimate(estimate)}</span>
              <span className="text-[9px] text-zinc-600 ml-auto">very rough approximation</span>
            </div>
          </div>

          <div className="border-t border-zinc-800/30" />

          {/* Effects selection */}
          <div className="space-y-3">
            <h3 className="text-[10px] text-zinc-500 font-semibold uppercase tracking-wider">
              Effects to Include
              {trimEnabled && <span className="text-zinc-600 normal-case font-normal ml-1">(within trim range)</span>}
            </h3>

            {Array.from(grouped.entries()).map(([type, typeActions]) => {
              const allSelected = typeActions.every((a) => selected.has(a.id));
              const someSelected = typeActions.some((a) => selected.has(a.id));
              return (
                <div key={type}>
                  <button
                    onClick={() => toggleType(type)}
                    className="flex items-center gap-2 w-full text-left mb-1.5"
                  >
                    <input
                      type="checkbox"
                      checked={allSelected}
                      ref={(el) => { if (el) el.indeterminate = someSelected && !allSelected; }}
                      onChange={() => toggleType(type)}
                      className="accent-violet-500 w-3.5 h-3.5"
                    />
                    <ActionIcon type={type} size={13} className={ACTION_COLORS[type]?.replace("bg-", "text-").replace("-500", "-400") || "text-zinc-400"} />
                    <span className="text-xs font-semibold text-zinc-300 uppercase tracking-wide">
                      {ACTION_DISPLAY_NAMES[type] || type}
                    </span>
                    <span className="text-[10px] text-zinc-600 ml-auto">
                      {typeActions.filter((a) => selected.has(a.id)).length}/{typeActions.length}
                    </span>
                  </button>

                  <div className="ml-5 space-y-0.5">
                    {typeActions.map((action) => {
                      const end = getActionEndTime(action);
                      return (
                        <label
                          key={action.id}
                          className="flex items-center gap-2 px-2 py-1 rounded hover:bg-zinc-800/50 cursor-pointer group"
                        >
                          <input
                            type="checkbox"
                            checked={selected.has(action.id)}
                            onChange={() => toggleAction(action.id)}
                            className="accent-violet-500 w-3 h-3"
                          />
                          <span className="text-[11px] text-zinc-300 flex-1 truncate">
                            {getActionLabel(action)}
                          </span>
                          <span className="text-[10px] text-zinc-600 font-mono tabular-nums">
                            {formatTime(action.timestamp)} - {formatTime(end)}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              );
            })}

            {visibleActions.length === 0 && (
              <p className="text-xs text-zinc-500 text-center py-4">
                {trimEnabled ? "No effects within trim range." : "No actions to produce."}
              </p>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-zinc-800/60 flex items-center gap-2">
          <button
            onClick={selectAll}
            className="text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            Select All
          </button>
          <span className="text-zinc-700">|</span>
          <button
            onClick={selectNone}
            className="text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            Select None
          </button>
          <span className="text-[10px] text-zinc-600 ml-1">
            {selectedCount} selected
          </span>

          <div className="flex-1" />

          <button
            onClick={onCancel}
            className="px-4 py-1.5 text-xs text-zinc-400 hover:text-zinc-200 rounded-md hover:bg-zinc-800 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm({
              selectedIds: Array.from(selected),
              resolution,
              quality,
              trim: trimEnabled ? { start: trimStart, end: trimEnd } : null,
            })}
            disabled={selectedCount === 0}
            className="px-4 py-1.5 text-xs font-medium text-white rounded-md shadow-lg transition-colors disabled:opacity-30 bg-emerald-600 hover:bg-emerald-500 shadow-emerald-500/20"
          >
            Produce ({selectedCount})
          </button>
        </div>
      </div>
    </div>
  );
}
