// ─── page-elements: THE definition of what a selector means ──────────
//
// The runner (to act on elements) and `inspect` (to suggest selectors) must agree
// exactly on how a Selector resolves, otherwise a selector copied out of an
// inspect report could hit a different element when the script runs. Both
// import from here. Nothing else in NaraScreen turns a Selector into a Locator.
//
// Semantics (the manual documents the same rules — keep them in sync):
//   role(+name)  → getByRole(role, { name, exact })   name = case-insensitive substring unless exact
//   label        → getByLabel(label, { exact })
//   text         → getByText(text, { exact: exact ?? true })
//   placeholder  → getByPlaceholder(placeholder, { exact })
//   testId       → getByTestId(testId)
//   css          → locator(css)
//   within       → search inside ONE container (see scopeLocator):
//                  css / role(+name) → first match; text → exact visible text, nearest row/card/section
//   nth          → the nth match, 0-based (default 0)
//
// collectElements() lists what an agent could target on the current page and
// builds a selector for each one that is verified — by element identity, not
// by text — to resolve back to that same element through locate().

import type { Locator, Page } from "@playwright/test";
import { SELECTOR_KEYS } from "./schema";
import type { Rect, Scope, Selector } from "./types";

type AriaRole = Parameters<Page["getByRole"]>[0];

// ─── selector → Locator ──────────────────────────────────────────────

/** Containers `within: { text }` climbs to: the nearest of these around the first
 *  VISIBLE element whose whole text is exactly that text (whitespace-normalised,
 *  case-sensitive; the element itself counts), else that element's parent. */
export const SCOPE_CONTAINERS = [
  "tr", "li", "[role=row]", "[role=listitem]", "article", "section",
  "form", "fieldset", "dialog", "[role=dialog]", "[role=group]",
] as const;

// Same list as XPath, so it runs inside Playwright's selector engine (no JS
// handles) and stays a Locator that re-resolves on every use.
const CONTAINER_TEST =
  "self::tr or self::li or @role='row' or @role='listitem' or self::article or self::section or " +
  "self::form or self::fieldset or self::dialog or @role='dialog' or @role='group'";
const NEAREST_CONTAINER_XPATH =
  `xpath=self::*[ancestor-or-self::*[${CONTAINER_TEST}]]/ancestor-or-self::*[${CONTAINER_TEST}][1]` +
  ` | self::*[not(ancestor-or-self::*[${CONTAINER_TEST}])]/parent::*`;

/** The single container a `within` names (always the FIRST match). */
export function scopeLocator(page: Page, within: Scope): Locator {
  if (within.css != null) return page.locator(within.css).first();
  if (within.role != null) {
    return page.getByRole(within.role as AriaRole, within.name != null ? { name: within.name } : undefined).first();
  }
  if (within.text != null) {
    // Exact text of a VISIBLE element, so "Task 1" does not scope to "Task 12"
    // and hidden copies (templates, closed menus) are ignored.
    return page.getByText(within.text, { exact: true }).filter({ visible: true }).first().locator(NEAREST_CONTAINER_XPATH);
  }
  throw new Error("within needs one of css | text | role");
}

/**
 * Every element the selector matches, in document order (use for counting).
 * `includeHidden` only matters for role selectors — getByRole skips hidden
 * elements, so diagnostics use it to tell "hidden" from "absent".
 */
export function locateAll(page: Page, sel: Selector, opts: { includeHidden?: boolean } = {}): Locator {
  const root: Page | Locator = sel.within ? scopeLocator(page, sel.within) : page;
  const exact = sel.exact != null ? { exact: sel.exact } : {};
  if (sel.role != null) {
    return root.getByRole(sel.role as AriaRole, {
      ...(sel.name != null ? { name: sel.name, ...exact } : {}),
      ...(opts.includeHidden ? { includeHidden: true } : {}),
    });
  }
  if (sel.label != null) return root.getByLabel(sel.label, exact);
  if (sel.text != null) return root.getByText(sel.text, { exact: sel.exact ?? true });
  if (sel.placeholder != null) return root.getByPlaceholder(sel.placeholder, exact);
  if (sel.testId != null) return root.getByTestId(sel.testId);
  if (sel.css != null) return root.locator(sel.css);
  throw new Error(`selector needs one of ${SELECTOR_KEYS.join(" | ")}`);
}

/** The one element a selector means: match number `nth` (default 0). */
export function locate(page: Page, sel: Selector): Locator {
  return locateAll(page, sel).nth(sel.nth ?? 0);
}

/** Just the selector fields of an act entry / anchor (undefined if it has none). */
export function pickSelector(obj: Selector): Selector | undefined {
  if (!SELECTOR_KEYS.some((k) => obj[k] != null)) return undefined;
  const out: Selector = {};
  for (const k of [...SELECTOR_KEYS, "name", "within", "exact", "nth"] as const) {
    if (obj[k] != null) (out as Record<string, unknown>)[k] = obj[k];
  }
  return out;
}

const q = (s: string) => JSON.stringify(s);

export function describeScope(w: Scope): string {
  if (w.css != null) return `css=${q(w.css)}`;
  if (w.role != null) return `role=${w.role}${w.name != null ? ` name=${q(w.name)}` : ""}`;
  return `text=${q(w.text ?? "")}`;
}

/** Human text, e.g. `role=button name="Save" within role=dialog name="New task"`. */
export function describeSelector(sel: Selector): string {
  let s: string;
  if (sel.role != null) s = `role=${sel.role}${sel.name != null ? ` name=${q(sel.name)}` : ""}`;
  else if (sel.label != null) s = `label=${q(sel.label)}`;
  else if (sel.text != null) s = `text=${q(sel.text)}`;
  else if (sel.placeholder != null) s = `placeholder=${q(sel.placeholder)}`;
  else if (sel.testId != null) s = `testId=${q(sel.testId)}`;
  else if (sel.css != null) s = `css=${q(sel.css)}`;
  else s = "(no selector)";
  if (sel.exact != null) s += ` exact=${sel.exact}`;
  if (sel.nth != null) s += ` nth=${sel.nth}`;
  if (sel.within) s += ` within ${describeScope(sel.within)}`;
  return s;
}

/** ARIA roles getByRole understands — an unknown role silently matches nothing,
 *  so the runner uses this to say "did you mean …" instead. */
export const ARIA_ROLES = [
  "alert", "alertdialog", "application", "article", "banner", "blockquote", "button", "caption", "cell",
  "checkbox", "code", "columnheader", "combobox", "complementary", "contentinfo", "definition", "deletion",
  "dialog", "directory", "document", "emphasis", "feed", "figure", "form", "generic", "grid", "gridcell",
  "group", "heading", "img", "insertion", "link", "list", "listbox", "listitem", "log", "main", "marquee",
  "math", "meter", "menu", "menubar", "menuitem", "menuitemcheckbox", "menuitemradio", "navigation", "none",
  "note", "option", "paragraph", "presentation", "progressbar", "radio", "radiogroup", "region", "row",
  "rowgroup", "rowheader", "scrollbar", "search", "searchbox", "separator", "slider", "spinbutton", "status",
  "strong", "subscript", "superscript", "switch", "tab", "table", "tablist", "tabpanel", "term", "textbox",
  "time", "timer", "toolbar", "tooltip", "tree", "treegrid", "treeitem",
];

// ─── collectElements: what can an agent target on this page? ────────

export interface InspectElement {
  role: string;
  name: string;
  tag: string;
  /** READY TO PASTE into an act entry / fx anchor. Verified to resolve to this element. */
  selector: Selector;
  /** How many elements `selector` matches without its `nth` (1 = unique). */
  matches: number;
  visible: boolean;
  inViewport: boolean;
  rect?: Rect;
  /** Current value of inputs (never for type=password). */
  value?: string;
  /** <select> option labels. */
  options?: string[];
  checked?: boolean;
  disabled?: boolean;
}

/** Roles listed even without an accessible name. */
const TARGET_ROLES = new Set([
  "button", "link", "textbox", "searchbox", "combobox", "checkbox", "radio", "switch", "tab", "menuitem",
  "menuitemcheckbox", "menuitemradio", "option", "slider", "spinbutton", "listbox", "heading", "dialog",
  "alertdialog", "treeitem", "banner", "navigation", "main", "complementary", "contentinfo", "search",
]);
/** Roles listed only when they have a name (otherwise they are noise). */
const NAMED_ROLES = new Set(["row", "region", "form", "table", "grid", "img", "tabpanel", "radiogroup", "article"]);
/** Roles whose accessible name is the user-visible label of a form control. */
const FORM_ROLES = new Set(["textbox", "searchbox", "combobox", "checkbox", "radio", "switch", "slider", "spinbutton", "listbox"]);
/** Named ancestors that make good `within` containers. */
const SCOPE_ROLES = new Set([
  "region", "form", "navigation", "group", "radiogroup", "tabpanel", "menu", "listbox", "grid", "table",
  "row", "listitem", "article", "complementary", "banner", "contentinfo", "search", "toolbar", "tablist",
]);
const LANDMARKS = new Set(["banner", "navigation", "main", "complementary", "contentinfo", "search"]);

interface SnapNode {
  ref: string;
  role: string;
  name: string;
  box?: Rect;
  attrs: Record<string, string | true>;
  /** Element ancestors, nearest first. */
  ancestors: { role: string; name: string }[];
}

// `- button "Save" [disabled] [ref=e12] [box=10,20,80,24]: value`
const LINE_RE = /^(\s*)- ([a-zA-Z]+)(?: ("(?:[^"\\]|\\.)*"))?((?: \[[^\]]*\])*)(?::(?: (.*))?)?$/;

function parseAiSnapshot(text: string): SnapNode[] {
  const out: SnapNode[] = [];
  const stack: { depth: number; role: string; name: string }[] = [];
  for (const line of text.split("\n")) {
    const m = LINE_RE.exec(line);
    if (!m) continue;
    const depth = m[1].length;
    const role = m[2];
    let name = "";
    if (m[3]) {
      try {
        name = JSON.parse(m[3]) as string;
      } catch {
        name = m[3].slice(1, -1);
      }
    }
    const attrs: Record<string, string | true> = {};
    for (const a of (m[4] ?? "").matchAll(/\[([^\]=]+)(?:=([^\]]*))?\]/g)) attrs[a[1]] = a[2] ?? true;
    while (stack.length && stack[stack.length - 1].depth >= depth) stack.pop();
    const ancestors = stack.map((s) => ({ role: s.role, name: s.name })).reverse();
    stack.push({ depth, role, name });
    if (role === "text" || typeof attrs.ref !== "string") continue;
    let box: Rect | undefined;
    if (typeof attrs.box === "string") {
      const n = attrs.box.split(",").map(Number);
      if (n.length === 4 && n.every(Number.isFinite)) box = n as Rect;
    }
    out.push({ ref: attrs.ref, role, name, box, attrs, ancestors });
  }
  return out;
}

function isCandidate(n: SnapNode): boolean {
  if (!/^e\d+$/.test(n.ref)) return false; // refs inside iframes (f1e2…) can't be targeted by a Selector
  const sized = !!n.box && n.box[2] > 0 && n.box[3] > 0;
  if (n.role === "option") return sized; // native <select> options have no box; custom listbox options do
  if (TARGET_ROLES.has(n.role)) return true;
  if (NAMED_ROLES.has(n.role)) return n.name.trim() !== "";
  // Custom clickable elements (div with onclick + cursor:pointer) — common in real apps.
  return n.attrs.cursor === "pointer" && sized;
}

/** What the page tells us about one element (collected in one round trip). */
interface DomInfo {
  idx: number;
  tag: string;
  visible: boolean;
  inViewport: boolean;
  rect: Rect;
  value?: string;
  options?: string[];
  checked?: boolean;
  disabled?: boolean;
  labels: string[];
  placeholder?: string;
  testId?: string;
  text: string;
  cssPath: string;
  containerText?: string;
  containerId?: string;
}

// Page-side code is compiled at runtime from plain JS source on purpose: tsx
// (esbuild keepNames) wraps named inner functions in a `__name()` helper that
// does not exist inside the browser, so a TS arrow with helpers would throw there.
function pageFn<T>(src: string): T {
  return new Function(`return (${src});`)() as T;
}

const DOM_INFO = pageFn<(el: Element, arg: { key: string; containers: string }) => Omit<DomInfo, "idx"> & { idx: number }>(`
(el, arg) => {
  const store = window[arg.key] || (window[arg.key] = []);
  const idx = store.push(el) - 1;
  const norm = (s) => (s || "").replace(/\\s+/g, " ").trim();
  const generatedId = (id) => !id || /^[:\\d]|:|\\d{3,}|^(radix|headlessui|react|mui|ember|ext-gen|yui)/i.test(id);
  const uniqueId = (id) => { try { return document.querySelectorAll("#" + CSS.escape(id)).length === 1; } catch (e) { return false; } };
  const tag = el.tagName.toLowerCase();
  const r = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  const visible = r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none" &&
    (typeof el.checkVisibility === "function" ? el.checkVisibility() : true);
  const inViewport = visible && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;
  const type = (el.getAttribute("type") || "").toLowerCase();
  const out = {
    idx, tag, visible, inViewport,
    rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
    labels: [], text: "", cssPath: "",
  };
  if (tag === "select") {
    out.options = Array.from(el.options).map((o) => norm(o.label));
    out.value = Array.from(el.selectedOptions).map((o) => norm(o.label)).join(", ");
  } else if (tag === "textarea") {
    out.value = el.value;
  } else if (tag === "input" && !["password", "checkbox", "radio", "file", "hidden", "submit", "button", "reset", "image"].includes(type)) {
    out.value = el.value;
  }
  if (tag === "input" && (type === "checkbox" || type === "radio")) out.checked = !!el.checked;
  else if (el.getAttribute("aria-checked") === "true" || el.getAttribute("aria-checked") === "false") out.checked = el.getAttribute("aria-checked") === "true";
  else if (el.getAttribute("aria-pressed") === "true" || el.getAttribute("aria-pressed") === "false") out.checked = el.getAttribute("aria-pressed") === "true";
  if (el.disabled === true || el.getAttribute("aria-disabled") === "true") out.disabled = true;
  const labels = [];
  if (el.labels) for (const l of Array.from(el.labels)) labels.push(norm(l.innerText || l.textContent));
  if (el.getAttribute("aria-label")) labels.push(norm(el.getAttribute("aria-label")));
  const lb = el.getAttribute("aria-labelledby");
  if (lb) labels.push(norm(lb.split(/\\s+/).map((id) => { const n = document.getElementById(id); return n ? n.textContent : ""; }).join(" ")));
  out.labels = Array.from(new Set(labels.filter((l) => l && l.length <= 80)));
  if (el.getAttribute("placeholder")) out.placeholder = el.getAttribute("placeholder");
  if (el.getAttribute("data-testid")) out.testId = el.getAttribute("data-testid");
  out.text = norm(el.innerText || "").slice(0, 200);

  // CSS path: an id when it is unique and not machine-generated, else tag:nth-of-type steps.
  const parts = [];
  let cur = el;
  while (cur && cur.nodeType === 1 && cur !== document.documentElement) {
    if (cur.id && !generatedId(cur.id) && uniqueId(cur.id)) { parts.unshift("#" + CSS.escape(cur.id)); break; }
    let part = cur.tagName.toLowerCase();
    const parent = cur.parentElement;
    if (parent) {
      const same = Array.from(parent.children).filter((c) => c.tagName === cur.tagName);
      if (same.length > 1) part += ":nth-of-type(" + (same.indexOf(cur) + 1) + ")";
    }
    parts.unshift(part);
    cur = parent;
  }
  out.cssPath = parts.join(" > ");

  // Nearest container (row, card, section, dialog…) and a short text that names it,
  // so an ambiguous element can be scoped with within: { text }.
  const cont = el.parentElement && el.parentElement.closest(arg.containers);
  if (cont) {
    const walker = document.createTreeWalker(cont, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const p = node.parentElement;
      if (!p || el.contains(p) || p.closest("script,style,noscript,template")) continue;
      const t = norm(node.textContent);
      if ((t.match(/[\\p{L}\\p{N}]/gu) || []).length < 2) continue;
      if (typeof p.checkVisibility === "function" && !p.checkVisibility()) continue;
      // within.text matches an element's whole text exactly: only short, whole texts qualify
      if (t.length <= 60 && norm(p.innerText || p.textContent) === t) out.containerText = t;
      break;
    }
    let c = cont;
    while (c && c !== document.body) {
      if (c.id && !generatedId(c.id) && uniqueId(c.id)) { out.containerId = c.id; break; }
      c = c.parentElement;
    }
  }
  return out;
}`);

const VISIBLE_BOX = pageFn<(el: Element) => { box: [number, number, number, number]; vis: [number, number, number, number] | null }>(`
(el) => {
  const r = el.getBoundingClientRect();
  let x0 = Math.max(0, r.left), y0 = Math.max(0, r.top);
  let x1 = Math.min(window.innerWidth, r.right), y1 = Math.min(window.innerHeight, r.bottom);
  const cs0 = getComputedStyle(el);
  let hidden = cs0.visibility === "hidden" || cs0.display === "none" || r.width <= 0 || r.height <= 0;
  // Ancestors that clip (overflow other than visible) hide whatever lies outside them.
  for (let a = el.parentElement; a && a !== document.body && a !== document.documentElement; a = a.parentElement) {
    const cs = getComputedStyle(a);
    if (cs.position === "fixed") break;
    const cx = cs.overflowX !== "visible", cy = cs.overflowY !== "visible";
    if (!cx && !cy) continue;
    const ar = a.getBoundingClientRect();
    if (cx) { x0 = Math.max(x0, ar.left + a.clientLeft); x1 = Math.min(x1, ar.left + a.clientLeft + a.clientWidth); }
    if (cy) { y0 = Math.max(y0, ar.top + a.clientTop); y1 = Math.min(y1, ar.top + a.clientTop + a.clientHeight); }
  }
  const box = [r.left, r.top, r.width, r.height];
  return { box, vis: hidden || x1 - x0 < 1 || y1 - y0 < 1 ? null : [x0, y0, x1 - x0, y1 - y0] };
}`);

export interface VisibleBox {
  /** Full layout box (viewport coordinates, may extend off screen). */
  box: { x: number; y: number; width: number; height: number };
  /** The part actually visible: clipped by the viewport and every scrolling/overflow-hidden ancestor. */
  visible: Rect | null;
  /** True when the whole box is visible (1px slack). */
  whole: boolean;
}

/** Where an element is and how much of it can really be seen (null if detached). */
export async function measureVisible(loc: Locator, timeout = 1000): Promise<VisibleBox | null> {
  const m = await loc.evaluate(VISIBLE_BOX, undefined, { timeout }).catch(() => null);
  if (!m) return null;
  const [x, y, width, height] = m.box;
  const visible: Rect | null = m.vis
    ? [Math.round(m.vis[0]), Math.round(m.vis[1]), Math.round(m.vis[2]), Math.round(m.vis[3])]
    : null;
  const whole = !!m.vis && Math.abs(m.vis[2] - width) <= 1 && Math.abs(m.vis[3] - height) <= 1;
  return { box: { x, y, width, height }, visible, whole };
}

const PROBE = pageFn<(els: Element[], key: string) => number[]>(
  `(els, key) => { const s = window[key] || []; return els.map((e) => s.indexOf(e)); }`,
);

export interface CollectResult {
  elements: InspectElement[];
  /** Targetable elements on the page before `limit` was applied. */
  total: number;
}

/** collectElements + how many there were before the limit (inspect reports truncation). */
export async function collectElementsDetailed(page: Page, opts: { limit?: number } = {}): Promise<CollectResult> {
  const limit = Math.max(1, opts.limit ?? 200);
  const snapshot = await page.ariaSnapshot({ mode: "ai", boxes: true, timeout: 15_000 });
  const nodes = parseAiSnapshot(snapshot).filter(isCandidate);
  const sized = (n: SnapNode) => !!n.box && n.box[2] > 0 && n.box[3] > 0;
  const ordered = [...nodes.filter(sized), ...nodes.filter((n) => !sized(n))].slice(0, limit);

  // Identity store: every element we describe is pushed into a page-global array,
  // so a candidate selector is checked by "does it resolve to THIS element" rather
  // than by comparing names. Removed again at the end.
  const key = `__narascreen_probe_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  await page.evaluate((k) => {
    (window as unknown as Record<string, unknown>)[k] = [];
  }, key);
  try {
    // aria-ref locators are only valid until the next aria snapshot, so resolve them all first.
    const infos = await mapLimit(ordered, 16, async (n) => {
      try {
        return await page
          .locator(`aria-ref=${n.ref}`)
          .evaluate(DOM_INFO, { key, containers: SCOPE_CONTAINERS.join(", ") }, { timeout: 2000 });
      } catch {
        return null; // detached meanwhile — skip it
      }
    });
    const built = await mapLimit(ordered, 12, async (n, i) => {
      const info = infos[i];
      if (!info) return null;
      const best = await bestSelector(page, key, n, info);
      return best ? toElement(n, info, best) : null;
    });
    const elements = built.filter((e): e is InspectElement => e !== null);
    // Visible first (stable: document order within each group).
    elements.sort((a, b) => Number(b.visible) - Number(a.visible));
    return { elements, total: nodes.length };
  } finally {
    await page
      .evaluate((k) => {
        delete (window as unknown as Record<string, unknown>)[k];
      }, key)
      .catch(() => {});
  }
}

/** Interactive + landmark elements with ready-to-paste selectors (visible first, document order). */
export async function collectElements(page: Page, opts: { limit?: number } = {}): Promise<InspectElement[]> {
  return (await collectElementsDetailed(page, opts)).elements;
}

function toElement(n: SnapNode, info: DomInfo, best: { selector: Selector; matches: number }): InspectElement {
  const generic = !TARGET_ROLES.has(n.role) && !NAMED_ROLES.has(n.role);
  const el: InspectElement = {
    role: n.role,
    name: n.name || (generic ? info.text.slice(0, 80) : ""),
    tag: info.tag,
    selector: best.selector,
    matches: best.matches,
    visible: info.visible,
    inViewport: info.inViewport,
  };
  if (info.visible) el.rect = info.rect;
  if (info.value != null) el.value = info.value;
  if (info.options) el.options = info.options;
  if (info.checked != null) el.checked = info.checked;
  if (info.disabled) el.disabled = true;
  return el;
}

// ─── selector building ───────────────────────────────────────────────

interface Hit {
  sel: Selector;
  count: number;
  /** Index of the target among the matches (= the nth to use). */
  pos: number;
}

/** Long accessible names (rows, cards) → a shorter prefix; substring matching still finds them. */
function shortenName(name: string): string {
  if (name.length <= 60) return name;
  let out = "";
  for (const w of name.split(" ")) {
    if ((out + " " + w).trim().length > 50) break;
    out = (out + " " + w).trim();
  }
  return out || name.slice(0, 50);
}

async function bestSelector(
  page: Page,
  key: string,
  n: SnapNode,
  info: DomInfo,
): Promise<{ selector: Selector; matches: number } | null> {
  const cache = new Map<string, number[] | null>();
  const test = async (sel: Selector): Promise<Hit | null> => {
    const k = JSON.stringify(sel);
    if (!cache.has(k)) {
      cache.set(
        k,
        await locateAll(page, sel)
          .evaluateAll(PROBE, key)
          .catch(() => null),
      );
    }
    const found = cache.get(k);
    const pos = found ? found.indexOf(info.idx) : -1;
    return found && pos >= 0 ? { sel, count: found.length, pos } : null;
  };
  const done = (h: Hit) => ({ selector: h.sel, matches: h.count });

  const generic = !TARGET_ROLES.has(n.role) && !NAMED_ROLES.has(n.role);
  const strong: { sel: Selector; canExact: boolean }[] = [];
  const weak: Selector[] = [];
  const shortText = info.text && info.text.length <= 60 ? info.text : "";
  if (!generic && n.name) {
    const short = shortenName(n.name);
    if (short !== n.name) strong.push({ sel: { role: n.role, name: short }, canExact: false });
    strong.push({ sel: { role: n.role, name: n.name }, canExact: true });
  }
  if (FORM_ROLES.has(n.role)) for (const l of info.labels) strong.push({ sel: { label: l }, canExact: true });
  if (info.placeholder) strong.push({ sel: { placeholder: info.placeholder }, canExact: true });
  if (info.testId) strong.push({ sel: { testId: info.testId }, canExact: false });
  if (generic && shortText) strong.push({ sel: { text: shortText }, canExact: false });
  if (!generic && shortText) weak.push({ text: shortText });
  if (!generic && !n.name) weak.push({ role: n.role });
  if (info.cssPath) weak.push({ css: info.cssPath });

  // 1. A strong selector that is unique as-is, or with exact: true.
  let primary: Hit | null = null;
  for (const c of strong) {
    const h = await test(c.sel);
    if (!h) continue;
    if (h.count === 1) return done(h);
    let best = h;
    if (c.canExact) {
      const hx = await test({ ...c.sel, exact: true });
      if (hx?.count === 1) return done(hx);
      if (hx && hx.count < best.count) best = hx;
    }
    primary ??= best; // the most preferred selector that reaches the element
  }
  // 2. The primary selector narrowed to a container (dialog, row, section…).
  let narrow: Hit | null = null;
  if (primary) {
    for (const scope of scopeCandidates(n, info)) {
      const h = await test({ ...primary.sel, within: scope });
      if (h?.count === 1) return done(h);
      if (h && h.count < (narrow ?? primary).count) narrow = h;
    }
  }
  // 3. Weaker unique selectors (visible text, role alone, CSS path).
  for (const sel of weak) {
    const h = await test(sel);
    if (h?.count === 1) return done(h);
    if (h && !primary) primary = h;
  }
  // 4. Ambiguous: pin the position with nth.
  const pick = narrow ?? primary;
  return pick ? { selector: { ...pick.sel, nth: pick.pos }, matches: pick.count } : null;
}

function scopeCandidates(n: SnapNode, info: DomInfo): Scope[] {
  const out: Scope[] = [];
  const dialog = n.ancestors.find((a) => a.role === "dialog" || a.role === "alertdialog");
  if (dialog) out.push(dialog.name ? { role: dialog.role, name: shortenName(dialog.name) } : { role: dialog.role });
  if (info.containerText) out.push({ text: info.containerText });
  let named = 0;
  for (const a of n.ancestors) {
    if (named >= 3) break;
    if (a !== dialog && SCOPE_ROLES.has(a.role) && a.name) {
      out.push({ role: a.role, name: shortenName(a.name) });
      named++;
    }
  }
  const landmark = n.ancestors.find((a) => LANDMARKS.has(a.role) && !a.name);
  if (landmark) out.push({ role: landmark.role });
  if (info.containerId) out.push({ css: `#${cssEscapeId(info.containerId)}` });
  const seen = new Set<string>();
  return out.filter((s) => {
    const k = JSON.stringify(s);
    return seen.has(k) ? false : (seen.add(k), true);
  });
}

function cssEscapeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`);
}

// ─── similarElements: "did you mean" for a selector that failed ──────

/**
 * Elements that look like what `wanted` was after — fuzzy by name, label, text,
 * placeholder and test id, with a bonus for the same role. Padded with elements of
 * the same kind (e.g. other buttons) when few names are similar, so an agent
 * always sees realistic alternatives.
 */
export function similarElements(all: InspectElement[], wanted: Selector, limit = 8): InspectElement[] {
  const needle =
    wanted.name ?? wanted.label ?? wanted.text ?? wanted.placeholder ?? wanted.testId ?? cssWords(wanted.css ?? "");
  const kinds = wanted.role
    ? new Set([wanted.role])
    : wanted.label != null || wanted.placeholder != null
      ? FORM_ROLES
      : null;
  const scored = all.map((el, i) => {
    const hay = [el.name, el.selector.label, el.selector.placeholder, el.selector.text, el.selector.testId]
      .filter((s): s is string => !!s);
    const text = needle ? Math.max(0, ...hay.map((h) => textSimilarity(needle, h))) : 0;
    // Same kind of element ranks higher among similarly named ones.
    const rank = text + (kinds?.has(el.role) ? 0.2 : 0) + (el.inViewport ? 0.03 : 0);
    return { el, text, rank, i };
  });
  // 1. Similar names/labels/texts, best first.
  const picked = scored
    .filter((x) => x.text >= 0.45)
    .sort((a, b) => b.rank - a.rank || a.i - b.i)
    .slice(0, limit);
  // 2. Then other elements of the same kind, on screen first, in page order.
  if (picked.length < limit && kinds) {
    const have = new Set(picked.map((p) => p.i));
    const pad = scored
      .filter((x) => !have.has(x.i) && kinds.has(x.el.role) && x.el.visible)
      .sort((a, b) => Number(b.el.inViewport) - Number(a.el.inViewport) || a.i - b.i)
      .slice(0, limit - picked.length);
    picked.push(...pad);
  }
  return picked.map((x) => x.el);
}

function cssWords(css: string): string {
  return css.replace(/[#.[\]=:>~+*"'()^$|-]/g, " ").replace(/\s+/g, " ").trim();
}

function normText(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

/** 0..1 — exact, containment, shared words, then edit distance. */
export function textSimilarity(a: string, b: string): number {
  const x = normText(a);
  const y = normText(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  let s = 0;
  if (x.includes(y) || y.includes(x)) {
    const [short, long] = x.length < y.length ? [x, y] : [y, x];
    s = 0.6 + 0.35 * (short.length / long.length);
  }
  const wx = new Set(x.split(" "));
  const wy = new Set(y.split(" "));
  const shared = [...wx].filter((w) => wy.has(w)).length;
  if (shared) s = Math.max(s, 0.65 * (shared / Math.max(wx.size, wy.size)) + 0.1);
  if (x.length <= 60 && y.length <= 60) {
    s = Math.max(s, 0.8 * (1 - levenshtein(x, y) / Math.max(x.length, y.length)));
  }
  return s;
}

function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}

/** Closest known ARIA role to a misspelled one (for hints). */
export function suggestRole(role: string): string | undefined {
  let best: string | undefined;
  let bestD = Infinity;
  for (const r of ARIA_ROLES) {
    const d = levenshtein(role.toLowerCase(), r);
    if (d < bestD) {
      bestD = d;
      best = r;
    }
  }
  return bestD <= Math.max(2, Math.floor(role.length / 3)) ? best : undefined;
}

// ─── page summary helpers (inspect + failure reports) ────────────────

/** Visible headings, in document order — a cheap "where am I" for agents. */
export async function pageHeadings(page: Page, limit = 20): Promise<{ level: number; text: string }[]> {
  return page
    .evaluate((max) => {
      const out: { level: number; text: string }[] = [];
      for (const el of Array.from(document.querySelectorAll("h1,h2,h3,h4,h5,h6,[role=heading]"))) {
        if (out.length >= max) break;
        const r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) continue;
        const text = ((el as HTMLElement).innerText || "").replace(/\s+/g, " ").trim().slice(0, 120);
        if (!text) continue;
        const tagLevel = /^h([1-6])$/i.exec(el.tagName);
        const level = tagLevel ? Number(tagLevel[1]) : Number(el.getAttribute("aria-level")) || 2;
        out.push({ level, text });
      }
      return out;
    }, limit)
    .catch(() => []);
}

// ─── utils ───────────────────────────────────────────────────────────

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
