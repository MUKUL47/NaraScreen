import { createContext, useContext } from "react";

/**
 * The element floating layers (popovers, menus, tooltips) portal into. A modal <dialog> makes
 * everything outside it inert, and auto popovers only nest when they are DOM descendants of their
 * parent popover, so Modal, Drawer and Popover each provide their own element here.
 */
export const LayerContext = createContext<HTMLElement | null>(null);

export function useLayerRoot(): HTMLElement {
  return useContext(LayerContext) ?? document.body;
}
