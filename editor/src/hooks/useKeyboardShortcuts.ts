import { useEffect } from "react";
import { useProjectStore } from "../stores/useProjectStore";

export function useKeyboardShortcuts() {
  const undo = useProjectStore((s) => s.undo);
  const redo = useProjectStore((s) => s.redo);
  const save = useProjectStore((s) => s.save);
  const deleteAction = useProjectStore((s) => s.deleteAction);
  const selectedActionId = useProjectStore((s) => s.selectedActionId);
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
  }, [undo, redo, save, deleteAction, selectedActionId, setSelectedAction]);
}
