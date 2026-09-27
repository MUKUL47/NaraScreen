import { useEffect } from "react";
import { executeCommand, findCommandForEvent } from "./registry";
import { isActivationOnControl, isTextEditingCombo, isTypingTarget } from "./keys";

/**
 * Dispatches a keydown to the command registry. Returns true when a command handled it.
 *
 * Skipped (left to the focused element / browser):
 * - events a component already handled (`defaultPrevented`) and IME composition;
 * - plain keys while typing (input, textarea, select, contenteditable, sliders); Mod-combos still
 *   run, except the text-editing ones (Mod+A/C/V/X/Z/Y, Mod+arrows…) which stay with the field;
 * - Space/Enter on a keyboard-focused button, switch, tab, menu item…;
 * - plain keys while a modal <dialog> or a light-dismiss popover (menu, listbox) is open.
 */
export function dispatchKeyEvent(e: KeyboardEvent): boolean {
  if (e.defaultPrevented || e.isComposing || e.key === "Process" || e.key === "Dead") return false;
  const mod = e.ctrlKey || e.metaKey;
  if (isTypingTarget(e.target)) {
    if (!mod || isTextEditingCombo(e)) return false;
  }
  if (isActivationOnControl(e)) return false;
  if (!mod && hasOpenOverlay()) return false;

  const found = findCommandForEvent(e);
  if (!found) return false;
  e.preventDefault();
  if (!found.repeatOk) return true;
  executeCommand(found.cmd);
  return true;
}

function hasOpenOverlay(): boolean {
  try {
    return document.querySelector("dialog:modal, [popover='auto']:popover-open, [popover='']:popover-open") !== null;
  } catch {
    return false;
  }
}

/** Mount once (App). Listens on window for keydown and runs the matching registered command. */
export function useKeymap(): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      dispatchKeyEvent(e);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
