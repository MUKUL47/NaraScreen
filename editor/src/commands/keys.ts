/**
 * Key-spec parsing, matching and display for the command registry, Kbd and tooltips.
 *
 * A spec is `[Mod+][Ctrl+][Cmd+][Alt+][Shift+]<key>`, e.g. "Mod+S", "Shift+Z", "1", "?", "Space",
 * "ArrowLeft", "Alt+[", "Mod+\\", "F1". `Mod` is ⌘ on macOS and Ctrl elsewhere (either one is
 * accepted when matching, as the old handler did). Letters are case-insensitive; Shift must match
 * for letters, digits and named keys, and is ignored for symbol keys unless the spec names it
 * ("?" is typed with Shift on most layouts).
 */

export const isMac: boolean =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent);

export interface ParsedKey {
  mod: boolean;
  ctrl: boolean;
  meta: boolean;
  alt: boolean;
  shift: boolean;
  /** Normalised key: lowercase letter, digit, symbol, or a named key ("ArrowLeft", "Space", "F1"…). */
  key: string;
}

const KEY_ALIASES: Record<string, string> = {
  esc: "Escape",
  escape: "Escape",
  del: "Delete",
  delete: "Delete",
  backspace: "Backspace",
  space: "Space",
  spacebar: "Space",
  " ": "Space",
  enter: "Enter",
  return: "Enter",
  tab: "Tab",
  left: "ArrowLeft",
  right: "ArrowRight",
  up: "ArrowUp",
  down: "ArrowDown",
  arrowleft: "ArrowLeft",
  arrowright: "ArrowRight",
  arrowup: "ArrowUp",
  arrowdown: "ArrowDown",
  home: "Home",
  end: "End",
  pageup: "PageUp",
  pagedown: "PageDown",
  plus: "+",
  minus: "-",
};

/** Normalises a key name from a spec or from `KeyboardEvent.key`. */
export function normalizeKey(k: string): string {
  if (k.length === 1) return /[A-Z]/.test(k) ? k.toLowerCase() : KEY_ALIASES[k] ?? k;
  const lower = k.toLowerCase();
  if (KEY_ALIASES[lower]) return KEY_ALIASES[lower];
  if (/^f\d{1,2}$/.test(lower)) return lower.toUpperCase();
  return k;
}

const parseCache = new Map<string, ParsedKey>();

export function parseKey(spec: string): ParsedKey {
  const cached = parseCache.get(spec);
  if (cached) return cached;
  const parts = spec === "+" ? ["+"] : spec.split(/\+(?!$)/);
  const out: ParsedKey = { mod: false, ctrl: false, meta: false, alt: false, shift: false, key: "" };
  parts.forEach((raw, i) => {
    const p = raw.trim();
    const lower = p.toLowerCase();
    if (i < parts.length - 1) {
      if (lower === "mod") out.mod = true;
      else if (lower === "ctrl" || lower === "control") out.ctrl = true;
      else if (lower === "cmd" || lower === "meta" || lower === "command") out.meta = true;
      else if (lower === "alt" || lower === "option" || lower === "opt") out.alt = true;
      else if (lower === "shift") out.shift = true;
    } else {
      out.key = normalizeKey(p || raw);
    }
  });
  parseCache.set(spec, out);
  return out;
}

const SYMBOL_CODES: Record<string, string> = {
  ",": "Comma", ".": "Period", "/": "Slash", "?": "Slash", ";": "Semicolon", "'": "Quote",
  "[": "BracketLeft", "]": "BracketRight", "\\": "Backslash", "-": "Minus", "=": "Equal", "+": "Equal",
  "`": "Backquote",
};

const isLetter = (k: string) => /^[a-z]$/.test(k);
const isDigit = (k: string) => /^[0-9]$/.test(k);
const isSymbol = (k: string) => k.length === 1 && !isLetter(k) && !isDigit(k);

function codeMatches(code: string, key: string): boolean {
  if (isLetter(key)) return code === `Key${key.toUpperCase()}`;
  if (isDigit(key)) return code === `Digit${key}` || code === `Numpad${key}`;
  return SYMBOL_CODES[key] !== undefined && SYMBOL_CODES[key] === code;
}

/** True when the event is exactly this key spec. */
export function matchKey(p: ParsedKey, e: KeyboardEvent): boolean {
  const wantsCtrlOrMeta = p.mod || p.ctrl || p.meta;
  if (p.mod) {
    if (!(e.ctrlKey || e.metaKey)) return false;
  } else {
    if (p.ctrl !== e.ctrlKey) return false;
    if (p.meta !== e.metaKey) return false;
  }
  if (!wantsCtrlOrMeta && (e.ctrlKey || e.metaKey)) return false;
  if (p.alt !== e.altKey) return false;
  if (!(isSymbol(p.key) && !p.shift) && p.shift !== e.shiftKey) return false;

  const k = normalizeKey(e.key);
  if (k === p.key) return true;
  // Physical-key fallback: non-Latin layouts (Hindi, Russian…), macOS Option-modified characters,
  // and Shift+digit (which types a symbol on most layouts).
  const asciiKey = k.length === 1 && k.charCodeAt(0) < 128;
  if (!asciiKey || e.altKey || (isDigit(p.key) && e.shiftKey)) return codeMatches(e.code, p.key);
  return false;
}

/** Keys whose auto-repeat is useful by default (seek, nudge, zoom). Others ignore repeats. */
export function repeatsByDefault(p: ParsedKey): boolean {
  return p.key.startsWith("Arrow") || p.key === "," || p.key === "." || p.key === "=" || p.key === "-" || p.key === "+";
}

// ── Display ──

const MAC_MODS = { ctrl: "⌃", alt: "⌥", shift: "⇧", meta: "⌘" };

const KEY_LABELS: Record<string, string> = {
  ArrowLeft: "←", ArrowRight: "→", ArrowUp: "↑", ArrowDown: "↓",
  Escape: "Esc", Delete: "Del", Space: "Space", PageUp: "PgUp", PageDown: "PgDn",
};
const MAC_KEY_LABELS: Record<string, string> = { Enter: "↩", Backspace: "⌫", Delete: "⌦", Tab: "⇥" };

function keyLabel(key: string): string {
  if (isMac && MAC_KEY_LABELS[key]) return MAC_KEY_LABELS[key];
  if (KEY_LABELS[key]) return KEY_LABELS[key];
  return key.length === 1 ? key.toUpperCase() : key;
}

/** The parts of a shortcut for key caps: ["Ctrl", "Shift", "Z"] or ["⇧", "⌘", "Z"] on macOS. */
export function shortcutParts(spec: string): string[] {
  const p = parseKey(spec);
  const parts: string[] = [];
  if (isMac) {
    if (p.ctrl) parts.push(MAC_MODS.ctrl);
    if (p.alt) parts.push(MAC_MODS.alt);
    if (p.shift) parts.push(MAC_MODS.shift);
    if (p.mod || p.meta) parts.push(MAC_MODS.meta);
  } else {
    if (p.mod || p.ctrl) parts.push("Ctrl");
    if (p.meta) parts.push("Win");
    if (p.alt) parts.push("Alt");
    if (p.shift) parts.push("Shift");
  }
  parts.push(keyLabel(p.key));
  return parts;
}

/** One-line label: "Ctrl+Shift+Z" (Windows/Linux) or "⇧⌘Z" (macOS). */
export function formatShortcut(spec: string): string {
  return shortcutParts(spec).join(isMac ? "" : "+");
}

// ── Focus context ──

const TEXT_INPUT_TYPES = new Set([
  "text", "search", "email", "url", "tel", "password", "number", "date", "time", "datetime-local",
  "month", "week", "range", "",
]);

/** True for elements where plain keys belong to the element (typing, sliders, selects). */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  if (target instanceof HTMLInputElement) return TEXT_INPUT_TYPES.has(target.type);
  if (target.isContentEditable) return true;
  const role = target.getAttribute("role");
  return role === "textbox" || role === "combobox" || role === "spinbutton" || role === "slider";
}

/** Mod-combos that edit text; inside a typing target they stay with the field. */
export function isTextEditingCombo(e: KeyboardEvent): boolean {
  if (!(e.ctrlKey || e.metaKey)) return false;
  const k = normalizeKey(e.key);
  if (["a", "c", "v", "x", "z", "y"].includes(k)) return true;
  return ["Backspace", "Delete", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(k);
}

/** Space/Enter on a keyboard-focused button-like control activate that control, not a shortcut. */
export function isActivationOnControl(e: KeyboardEvent): boolean {
  const k = normalizeKey(e.key);
  if (k !== "Space" && k !== "Enter") return false;
  const t = e.target;
  if (!(t instanceof HTMLElement)) return false;
  const control =
    t instanceof HTMLButtonElement ||
    (t instanceof HTMLAnchorElement && t.hasAttribute("href")) ||
    (t instanceof HTMLInputElement && ["checkbox", "radio", "button", "submit", "reset", "color", "file"].includes(t.type)) ||
    t.tagName === "SUMMARY" ||
    /^(button|checkbox|radio|switch|tab|menuitem|menuitemcheckbox|menuitemradio|option|link|treeitem|gridcell)$/.test(
      t.getAttribute("role") ?? "",
    );
  if (!control) return false;
  // A control focused by a mouse click (no focus ring) lets Space keep its editor meaning (play).
  return k === "Enter" || t.matches(":focus-visible");
}
