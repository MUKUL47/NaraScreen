import { useEffect } from "react";
import { useProjectStore } from "../stores/useProjectStore";
import { nudgeActionRects } from "../lib/actions";
import type { TimelineAction } from "../types";

const ACTION_TYPE_BY_NUMBER: Record<string, TimelineAction["type"]> = {
  "1": "zoom",
  "2": "narrate",
  "3": "spotlight",
  "4": "blur",
  "5": "mute",
  "6": "speed",
  "7": "callout",
  "8": "music",
  "9": "skip",
};

export function useKeyboardShortcuts() {
  const undo = useProjectStore((s) => s.undo);
  const redo = useProjectStore((s) => s.redo);
  const save = useProjectStore((s) => s.save);
  const deleteAction = useProjectStore((s) => s.deleteAction);
  const duplicateAction = useProjectStore((s) => s.duplicateAction);
  const splitAction = useProjectStore((s) => s.splitAction);
  const addAction = useProjectStore((s) => s.addAction);
  const selectedActionId = useProjectStore((s) => s.selectedActionId);
  const playheadTime = useProjectStore((s) => s.playheadTime);
  const setSelectedAction = useProjectStore((s) => s.setSelectedAction);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      )
        return;

      const ctrl = e.ctrlKey || e.metaKey;

      if (ctrl && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
        return;
      }

      if ((ctrl && e.key === "z" && e.shiftKey) || (ctrl && e.key === "y")) {
        e.preventDefault();
        redo();
        return;
      }

      if (ctrl && e.key === "s") {
        e.preventDefault();
        save();
        return;
      }

      // Duplicate selected action: D or Ctrl+D
      if ((e.key === "d" || e.key === "D") && selectedActionId) {
        e.preventDefault();
        duplicateAction(selectedActionId);
        return;
      }

      // Split selected action at playhead: B or Ctrl+B
      if ((e.key === "b" || e.key === "B") && selectedActionId) {
        e.preventDefault();
        splitAction(selectedActionId, playheadTime);
        return;
      }

      // Number keys 1-9: quick-add action at playhead
      if (!ctrl && !e.shiftKey && !e.altKey && ACTION_TYPE_BY_NUMBER[e.key]) {
        e.preventDefault();
        addAction(ACTION_TYPE_BY_NUMBER[e.key], playheadTime);
        return;
      }

      // Alt+Arrow: nudge all rects of the selected action by 1px (Shift = 10px).
      // Clamped to the project's known viewport.
      if (
        e.altKey && !ctrl && selectedActionId &&
        (e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "ArrowUp" || e.key === "ArrowDown")
      ) {
        const state = useProjectStore.getState();
        const action = state.project?.actions.find((a) => a.id === selectedActionId);
        if (!action) return;
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
        const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
        const bounds = state.project?.viewport ?? { width: 1920, height: 1080 };
        const partial = nudgeActionRects(action, dx, dy, bounds);
        if (Object.keys(partial).length === 0) return;
        e.preventDefault();
        state.updateAction(selectedActionId, partial);
        return;
      }

      if ((e.key === "Delete" || e.key === "Backspace") && selectedActionId) {
        e.preventDefault();
        deleteAction(selectedActionId);
        return;
      }

      if (e.key === "Escape") {
        e.preventDefault();
        setSelectedAction(null);
        return;
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [undo, redo, save, deleteAction, duplicateAction, splitAction, addAction, selectedActionId, playheadTime, setSelectedAction]);
}
