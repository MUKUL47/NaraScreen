import { useEffect } from "react";
import { useProjectStore } from "../stores/useProjectStore";
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
