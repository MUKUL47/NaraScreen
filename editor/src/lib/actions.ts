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
