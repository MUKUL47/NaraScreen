import type { TimelineAction } from "../types";

/** Compute the end time of an action based on its type and properties */
export function getActionEndTime(action: TimelineAction): number {
  switch (action.type) {
    case "zoom": return action.timestamp + (action.zoomDuration ?? 1) + (action.zoomHold ?? 2);
    case "spotlight": return action.timestamp + (action.spotlightDuration ?? 3);
    case "blur": return action.timestamp + (action.blurDuration ?? 3);
    case "callout": return action.timestamp + (action.calloutDuration ?? 3);
    case "mute": return action.muteEndTimestamp ?? action.timestamp + 3;
    case "speed": return action.speedEndTimestamp ?? action.timestamp + 5;
    case "skip": return action.skipEndTimestamp ?? action.timestamp + 3;
    case "music": return action.musicEndTimestamp ?? action.timestamp + 10;
    case "narrate": return action.timestamp + 2;
    case "pause": return action.timestamp + 1;
    default: return action.timestamp + 1;
  }
}

/** Update the end time of an action — returns the partial to merge */
export function setActionEndTime(action: TimelineAction, newEnd: number): Partial<TimelineAction> {
  const dur = Math.max(0.5, newEnd - action.timestamp);
  switch (action.type) {
    case "spotlight": return { spotlightDuration: dur };
    case "blur": return { blurDuration: dur };
    case "mute": return { muteEndTimestamp: newEnd };
    case "speed": return { speedEndTimestamp: newEnd };
    case "skip": return { skipEndTimestamp: newEnd };
    case "callout": return { calloutDuration: dur };
    case "music": return { musicEndTimestamp: newEnd };
    case "zoom": return { zoomHold: Math.max(0, dur - (action.zoomDuration ?? 1)) };
    default: return {};
  }
}

/** Get the rects associated with an action (for overlay rendering) */
export function getActionRects(action: TimelineAction): [number, number, number, number][] {
  switch (action.type) {
    case "zoom":
      if (action.zoomTargets?.length) return action.zoomTargets.map((t) => t.rect);
      return action.zoomRects ?? (action.zoomRect ? [action.zoomRect] : []);
    case "spotlight": return action.spotlightRects ?? (action.spotlightRect ? [action.spotlightRect] : []);
    case "blur": return action.blurRects ?? [];
    case "callout": return action.calloutPanels?.map((p) => p.rect) ?? [];
    default: return [];
  }
}

/**
 * Return the partial update needed to replace the rect at `index` in the action's rect array.
 * Preserves any per-rect data (zoom target narrations/audio, callout text/fontSize).
 * Also migrates any legacy single-rect fields to their array equivalents.
 */
export function updateActionRect(
  action: TimelineAction,
  index: number,
  newRect: [number, number, number, number],
): Partial<TimelineAction> {
  switch (action.type) {
    case "zoom": {
      if (action.zoomTargets?.length) {
        const next = action.zoomTargets.map((t, i) => (i === index ? { ...t, rect: newRect } : t));
        return { zoomTargets: next, zoomRect: undefined, zoomRects: undefined };
      }
      const legacy = action.zoomRects ?? (action.zoomRect ? [action.zoomRect] : []);
      const targets = legacy.map((r, i) => ({ rect: (i === index ? newRect : r) }));
      return { zoomTargets: targets, zoomRect: undefined, zoomRects: undefined };
    }
    case "spotlight": {
      const arr = action.spotlightRects ?? (action.spotlightRect ? [action.spotlightRect] : []);
      const next = arr.map((r, i) => (i === index ? newRect : r));
      return { spotlightRects: next, spotlightRect: undefined };
    }
    case "blur": {
      const arr = action.blurRects ?? [];
      const next = arr.map((r, i) => (i === index ? newRect : r));
      return { blurRects: next };
    }
    case "callout": {
      const panels = action.calloutPanels ?? [];
      const next = panels.map((p, i) => (i === index ? { ...p, rect: newRect } : p));
      return { calloutPanels: next };
    }
    default:
      return {};
  }
}

/**
 * Return a partial that shifts every rect in the action by (dx, dy), clamped to bounds.
 * Used by Alt+Arrow nudge.
 */
export function nudgeActionRects(
  action: TimelineAction,
  dx: number,
  dy: number,
  bounds: { width: number; height: number },
): Partial<TimelineAction> {
  const shift = (r: [number, number, number, number]): [number, number, number, number] => {
    const nx = Math.max(0, Math.min(bounds.width - r[2], r[0] + dx));
    const ny = Math.max(0, Math.min(bounds.height - r[3], r[1] + dy));
    return [Math.round(nx), Math.round(ny), r[2], r[3]];
  };
  switch (action.type) {
    case "zoom": {
      if (action.zoomTargets?.length) {
        return { zoomTargets: action.zoomTargets.map((t) => ({ ...t, rect: shift(t.rect) })) };
      }
      const legacy = action.zoomRects ?? (action.zoomRect ? [action.zoomRect] : []);
      if (!legacy.length) return {};
      return { zoomTargets: legacy.map((r) => ({ rect: shift(r) })), zoomRect: undefined, zoomRects: undefined };
    }
    case "spotlight": {
      const arr = action.spotlightRects ?? (action.spotlightRect ? [action.spotlightRect] : []);
      if (!arr.length) return {};
      return { spotlightRects: arr.map(shift), spotlightRect: undefined };
    }
    case "blur": {
      const arr = action.blurRects ?? [];
      if (!arr.length) return {};
      return { blurRects: arr.map(shift) };
    }
    case "callout": {
      const panels = action.calloutPanels ?? [];
      if (!panels.length) return {};
      return { calloutPanels: panels.map((p) => ({ ...p, rect: shift(p.rect) })) };
    }
    default:
      return {};
  }
}
