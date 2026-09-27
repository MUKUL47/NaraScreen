"use strict";
Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
const index = require("./job-W-Szny1w.cjs");
const fs = require("fs");
const path = require("path");
const util = require("util");
const child_process = require("child_process");
const url = require("url");
require("os");
require("crypto");
function _interopNamespaceDefault(e) {
  const n = Object.create(null, { [Symbol.toStringTag]: { value: "Module" } });
  if (e) {
    for (const k in e) {
      if (k !== "default") {
        const d = Object.getOwnPropertyDescriptor(e, k);
        Object.defineProperty(n, k, d.get ? d : {
          enumerable: true,
          get: () => e[k]
        });
      }
    }
  }
  n.default = e;
  return Object.freeze(n);
}
const fs__namespace = /* @__PURE__ */ _interopNamespaceDefault(fs);
const path__namespace = /* @__PURE__ */ _interopNamespaceDefault(path);
const SCOPE_CONTAINERS = [
  "tr",
  "li",
  "[role=row]",
  "[role=listitem]",
  "article",
  "section",
  "form",
  "fieldset",
  "dialog",
  "[role=dialog]",
  "[role=group]"
];
const CONTAINER_TEST = "self::tr or self::li or @role='row' or @role='listitem' or self::article or self::section or self::form or self::fieldset or self::dialog or @role='dialog' or @role='group'";
const NEAREST_CONTAINER_XPATH = `xpath=self::*[ancestor-or-self::*[${CONTAINER_TEST}]]/ancestor-or-self::*[${CONTAINER_TEST}][1] | self::*[not(ancestor-or-self::*[${CONTAINER_TEST}])]/parent::*`;
function scopeLocator(page, within) {
  if (within.css != null) return page.locator(within.css).first();
  if (within.role != null) {
    return page.getByRole(within.role, within.name != null ? { name: within.name } : void 0).first();
  }
  if (within.text != null) {
    return page.getByText(within.text, { exact: true }).filter({ visible: true }).first().locator(NEAREST_CONTAINER_XPATH);
  }
  throw new Error("within needs one of css | text | role");
}
function locateAll(page, sel, opts = {}) {
  const root = sel.within ? scopeLocator(page, sel.within) : page;
  const exact = sel.exact != null ? { exact: sel.exact } : {};
  if (sel.role != null) {
    return root.getByRole(sel.role, {
      ...sel.name != null ? { name: sel.name, ...exact } : {},
      ...opts.includeHidden ? { includeHidden: true } : {}
    });
  }
  if (sel.label != null) return root.getByLabel(sel.label, exact);
  if (sel.text != null) return root.getByText(sel.text, { exact: sel.exact ?? true });
  if (sel.placeholder != null) return root.getByPlaceholder(sel.placeholder, exact);
  if (sel.testId != null) return root.getByTestId(sel.testId);
  if (sel.css != null) return root.locator(sel.css);
  throw new Error(`selector needs one of ${index.SELECTOR_KEYS.join(" | ")}`);
}
function locate(page, sel) {
  return locateAll(page, sel).nth(sel.nth ?? 0);
}
function pickSelector(obj) {
  if (!index.SELECTOR_KEYS.some((k) => obj[k] != null)) return void 0;
  const out2 = {};
  for (const k of [...index.SELECTOR_KEYS, "name", "within", "exact", "nth"]) {
    if (obj[k] != null) out2[k] = obj[k];
  }
  return out2;
}
const q$1 = (s) => JSON.stringify(s);
function describeScope(w) {
  if (w.css != null) return `css=${q$1(w.css)}`;
  if (w.role != null) return `role=${w.role}${w.name != null ? ` name=${q$1(w.name)}` : ""}`;
  return `text=${q$1(w.text ?? "")}`;
}
function describeSelector(sel) {
  let s;
  if (sel.role != null) s = `role=${sel.role}${sel.name != null ? ` name=${q$1(sel.name)}` : ""}`;
  else if (sel.label != null) s = `label=${q$1(sel.label)}`;
  else if (sel.text != null) s = `text=${q$1(sel.text)}`;
  else if (sel.placeholder != null) s = `placeholder=${q$1(sel.placeholder)}`;
  else if (sel.testId != null) s = `testId=${q$1(sel.testId)}`;
  else if (sel.css != null) s = `css=${q$1(sel.css)}`;
  else s = "(no selector)";
  if (sel.exact != null) s += ` exact=${sel.exact}`;
  if (sel.nth != null) s += ` nth=${sel.nth}`;
  if (sel.within) s += ` within ${describeScope(sel.within)}`;
  return s;
}
const ARIA_ROLES = [
  "alert",
  "alertdialog",
  "application",
  "article",
  "banner",
  "blockquote",
  "button",
  "caption",
  "cell",
  "checkbox",
  "code",
  "columnheader",
  "combobox",
  "complementary",
  "contentinfo",
  "definition",
  "deletion",
  "dialog",
  "directory",
  "document",
  "emphasis",
  "feed",
  "figure",
  "form",
  "generic",
  "grid",
  "gridcell",
  "group",
  "heading",
  "img",
  "insertion",
  "link",
  "list",
  "listbox",
  "listitem",
  "log",
  "main",
  "marquee",
  "math",
  "meter",
  "menu",
  "menubar",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "navigation",
  "none",
  "note",
  "option",
  "paragraph",
  "presentation",
  "progressbar",
  "radio",
  "radiogroup",
  "region",
  "row",
  "rowgroup",
  "rowheader",
  "scrollbar",
  "search",
  "searchbox",
  "separator",
  "slider",
  "spinbutton",
  "status",
  "strong",
  "subscript",
  "superscript",
  "switch",
  "tab",
  "table",
  "tablist",
  "tabpanel",
  "term",
  "textbox",
  "time",
  "timer",
  "toolbar",
  "tooltip",
  "tree",
  "treegrid",
  "treeitem"
];
const TARGET_ROLES = /* @__PURE__ */ new Set([
  "button",
  "link",
  "textbox",
  "searchbox",
  "combobox",
  "checkbox",
  "radio",
  "switch",
  "tab",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "option",
  "slider",
  "spinbutton",
  "listbox",
  "heading",
  "dialog",
  "alertdialog",
  "treeitem",
  "banner",
  "navigation",
  "main",
  "complementary",
  "contentinfo",
  "search"
]);
const NAMED_ROLES = /* @__PURE__ */ new Set(["row", "region", "form", "table", "grid", "img", "tabpanel", "radiogroup", "article"]);
const FORM_ROLES = /* @__PURE__ */ new Set(["textbox", "searchbox", "combobox", "checkbox", "radio", "switch", "slider", "spinbutton", "listbox"]);
const SCOPE_ROLES = /* @__PURE__ */ new Set([
  "region",
  "form",
  "navigation",
  "group",
  "radiogroup",
  "tabpanel",
  "menu",
  "listbox",
  "grid",
  "table",
  "row",
  "listitem",
  "article",
  "complementary",
  "banner",
  "contentinfo",
  "search",
  "toolbar",
  "tablist"
]);
const LANDMARKS = /* @__PURE__ */ new Set(["banner", "navigation", "main", "complementary", "contentinfo", "search"]);
const LINE_RE = /^(\s*)- ([a-zA-Z]+)(?: ("(?:[^"\\]|\\.)*"))?((?: \[[^\]]*\])*)(?::(?: (.*))?)?$/;
function parseAiSnapshot(text) {
  const out2 = [];
  const stack = [];
  for (const line of text.split("\n")) {
    const m = LINE_RE.exec(line);
    if (!m) continue;
    const depth = m[1].length;
    const role = m[2];
    let name = "";
    if (m[3]) {
      try {
        name = JSON.parse(m[3]);
      } catch {
        name = m[3].slice(1, -1);
      }
    }
    const attrs = {};
    for (const a of (m[4] ?? "").matchAll(/\[([^\]=]+)(?:=([^\]]*))?\]/g)) attrs[a[1]] = a[2] ?? true;
    while (stack.length && stack[stack.length - 1].depth >= depth) stack.pop();
    const ancestors = stack.map((s) => ({ role: s.role, name: s.name })).reverse();
    stack.push({ depth, role, name });
    if (role === "text" || typeof attrs.ref !== "string") continue;
    let box;
    if (typeof attrs.box === "string") {
      const n = attrs.box.split(",").map(Number);
      if (n.length === 4 && n.every(Number.isFinite)) box = n;
    }
    out2.push({ ref: attrs.ref, role, name, box, attrs, ancestors });
  }
  return out2;
}
function isCandidate(n) {
  if (!/^e\d+$/.test(n.ref)) return false;
  const sized = !!n.box && n.box[2] > 0 && n.box[3] > 0;
  if (n.role === "option") return sized;
  if (TARGET_ROLES.has(n.role)) return true;
  if (NAMED_ROLES.has(n.role)) return n.name.trim() !== "";
  return n.attrs.cursor === "pointer" && sized;
}
function pageFn(src) {
  return new Function(`return (${src});`)();
}
const DOM_INFO = pageFn(`
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
  if (tag === "input" && type === "file") out.fileInput = { accept: el.getAttribute("accept") || undefined, multiple: !!el.multiple };
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
const VISIBLE_BOX = pageFn(`
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
async function measureVisible(loc, timeout = 1e3) {
  const m = await loc.evaluate(VISIBLE_BOX, void 0, { timeout }).catch(() => null);
  if (!m) return null;
  const [x, y, width, height] = m.box;
  const visible = m.vis ? [Math.round(m.vis[0]), Math.round(m.vis[1]), Math.round(m.vis[2]), Math.round(m.vis[3])] : null;
  const whole = !!m.vis && Math.abs(m.vis[2] - width) <= 1 && Math.abs(m.vis[3] - height) <= 1;
  return { box: { x, y, width, height }, visible, whole };
}
const PROBE = pageFn(
  `(els, key) => { const s = window[key] || []; return els.map((e) => s.indexOf(e)); }`
);
async function collectElementsDetailed(page, opts = {}) {
  const limit = Math.max(1, opts.limit ?? 200);
  const snapshot = await page.ariaSnapshot({ mode: "ai", boxes: true, timeout: 15e3 });
  const nodes = parseAiSnapshot(snapshot).filter(isCandidate);
  const sized = (n) => !!n.box && n.box[2] > 0 && n.box[3] > 0;
  const ordered = [...nodes.filter(sized), ...nodes.filter((n) => !sized(n))].slice(0, limit);
  const key = `__narascreen_probe_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  await page.evaluate((k) => {
    window[k] = [];
  }, key);
  try {
    const infos = await mapLimit(ordered, 16, async (n) => {
      try {
        return await page.locator(`aria-ref=${n.ref}`).evaluate(DOM_INFO, { key, containers: SCOPE_CONTAINERS.join(", ") }, { timeout: 2e3 });
      } catch {
        return null;
      }
    });
    const built = await mapLimit(ordered, 12, async (n, i) => {
      const info = infos[i];
      if (!info) return null;
      const best = await bestSelector(page, key, n, info);
      return best ? toElement(n, info, best) : null;
    });
    const elements = built.filter((e) => e !== null);
    elements.push(...await hiddenFileInputs(page, key));
    elements.sort((a, b) => Number(b.visible) - Number(a.visible));
    return { elements, total: nodes.length };
  } finally {
    await page.evaluate((k) => {
      delete window[k];
    }, key).catch(() => {
    });
  }
}
async function collectElements(page, opts = {}) {
  return (await collectElementsDetailed(page, opts)).elements;
}
function toElement(n, info, best) {
  const generic = !TARGET_ROLES.has(n.role) && !NAMED_ROLES.has(n.role);
  const el = {
    role: n.role,
    name: n.name || (generic ? info.text.slice(0, 80) : ""),
    tag: info.tag,
    selector: best.selector,
    matches: best.matches,
    visible: info.visible,
    inViewport: info.inViewport
  };
  if (info.visible) el.rect = info.rect;
  if (info.value != null) el.value = info.value;
  if (info.options) el.options = info.options;
  if (info.checked != null) el.checked = info.checked;
  if (info.disabled) el.disabled = true;
  if (info.fileInput) {
    el.inputType = "file";
    if (info.fileInput.accept) el.accept = info.fileInput.accept;
    el.multiple = info.fileInput.multiple;
  }
  return el;
}
async function hiddenFileInputs(page, key) {
  const all = page.locator("input[type=file]");
  const n = await all.count().catch(() => 0);
  const out2 = [];
  for (let i = 0; i < Math.min(n, 20); i++) {
    const loc = all.nth(i);
    const known = await loc.evaluate((el2, k) => (window[k] ?? []).includes(el2), key).catch(() => true);
    if (known) continue;
    const info = await loc.evaluate(DOM_INFO, { key, containers: SCOPE_CONTAINERS.join(", ") }, { timeout: 2e3 }).catch(() => null);
    if (!info) continue;
    let selector = { css: info.cssPath };
    for (const l of info.labels) {
      const byLabel = page.getByLabel(l, { exact: true });
      if (await byLabel.count().catch(() => 0) === 1 && await byLabel.evaluate((el2, k) => window[k].at(-1) === el2, key).catch(() => false)) {
        selector = { label: l };
        break;
      }
    }
    if (!selector.label && info.testId) selector = { testId: info.testId };
    const el = toElement({ role: "input", name: info.labels[0] ?? "" }, info, { selector, matches: 1 });
    out2.push(el);
  }
  return out2;
}
function shortenName(name) {
  if (name.length <= 60) return name;
  let out2 = "";
  for (const w of name.split(" ")) {
    if ((out2 + " " + w).trim().length > 50) break;
    out2 = (out2 + " " + w).trim();
  }
  return out2 || name.slice(0, 50);
}
async function bestSelector(page, key, n, info) {
  const cache = /* @__PURE__ */ new Map();
  const test = async (sel) => {
    const k = JSON.stringify(sel);
    if (!cache.has(k)) {
      cache.set(
        k,
        await locateAll(page, sel).evaluateAll(PROBE, key).catch(() => null)
      );
    }
    const found = cache.get(k);
    const pos = found ? found.indexOf(info.idx) : -1;
    return found && pos >= 0 ? { sel, count: found.length, pos } : null;
  };
  const done = (h) => ({ selector: h.sel, matches: h.count });
  const generic = !TARGET_ROLES.has(n.role) && !NAMED_ROLES.has(n.role);
  const strong = [];
  const weak = [];
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
  let primary = null;
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
    primary ??= best;
  }
  let narrow = null;
  if (primary) {
    for (const scope of scopeCandidates(n, info)) {
      const h = await test({ ...primary.sel, within: scope });
      if (h?.count === 1) return done(h);
      if (h && h.count < (narrow ?? primary).count) narrow = h;
    }
  }
  for (const sel of weak) {
    const h = await test(sel);
    if (h?.count === 1) return done(h);
    if (h && !primary) primary = h;
  }
  const pick = narrow ?? primary;
  return pick ? { selector: { ...pick.sel, nth: pick.pos }, matches: pick.count } : null;
}
function scopeCandidates(n, info) {
  const out2 = [];
  const dialog = n.ancestors.find((a) => a.role === "dialog" || a.role === "alertdialog");
  if (dialog) out2.push(dialog.name ? { role: dialog.role, name: shortenName(dialog.name) } : { role: dialog.role });
  if (info.containerText) out2.push({ text: info.containerText });
  let named = 0;
  for (const a of n.ancestors) {
    if (named >= 3) break;
    if (a !== dialog && SCOPE_ROLES.has(a.role) && a.name) {
      out2.push({ role: a.role, name: shortenName(a.name) });
      named++;
    }
  }
  const landmark = n.ancestors.find((a) => LANDMARKS.has(a.role) && !a.name);
  if (landmark) out2.push({ role: landmark.role });
  if (info.containerId) out2.push({ css: `#${cssEscapeId(info.containerId)}` });
  const seen = /* @__PURE__ */ new Set();
  return out2.filter((s) => {
    const k = JSON.stringify(s);
    return seen.has(k) ? false : (seen.add(k), true);
  });
}
function cssEscapeId(id) {
  return id.replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`);
}
function similarElements(all, wanted, limit = 8) {
  const needle = wanted.name ?? wanted.label ?? wanted.text ?? wanted.placeholder ?? wanted.testId ?? cssWords(wanted.css ?? "");
  const kinds = wanted.role ? /* @__PURE__ */ new Set([wanted.role]) : wanted.label != null || wanted.placeholder != null ? FORM_ROLES : null;
  const scored = all.map((el, i) => {
    const hay = [el.name, el.selector.label, el.selector.placeholder, el.selector.text, el.selector.testId].filter((s) => !!s);
    const text = needle ? Math.max(0, ...hay.map((h) => textSimilarity(needle, h))) : 0;
    const rank = text + (kinds?.has(el.role) ? 0.2 : 0) + (el.inViewport ? 0.03 : 0);
    return { el, text, rank, i };
  });
  const picked = scored.filter((x) => x.text >= 0.45).sort((a, b) => b.rank - a.rank || a.i - b.i).slice(0, limit);
  if (picked.length < limit && kinds) {
    const have = new Set(picked.map((p) => p.i));
    const pad = scored.filter((x) => !have.has(x.i) && kinds.has(x.el.role) && x.el.visible).sort((a, b) => Number(b.el.inViewport) - Number(a.el.inViewport) || a.i - b.i).slice(0, limit - picked.length);
    picked.push(...pad);
  }
  return picked.map((x) => x.el);
}
function cssWords(css) {
  return css.replace(/[#.[\]=:>~+*"'()^$|-]/g, " ").replace(/\s+/g, " ").trim();
}
function normText(s) {
  return s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}
function textSimilarity(a, b) {
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
    s = Math.max(s, 0.8 * (1 - levenshtein$2(x, y) / Math.max(x.length, y.length)));
  }
  return s;
}
function levenshtein$2(a, b) {
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
function suggestRole(role) {
  let best;
  let bestD = Infinity;
  for (const r of ARIA_ROLES) {
    const d = levenshtein$2(role.toLowerCase(), r);
    if (d < bestD) {
      bestD = d;
      best = r;
    }
  }
  return bestD <= Math.max(2, Math.floor(role.length / 3)) ? best : void 0;
}
async function pageHeadings(page, limit = 20) {
  return page.evaluate((max) => {
    const out2 = [];
    for (const el of Array.from(document.querySelectorAll("h1,h2,h3,h4,h5,h6,[role=heading]"))) {
      if (out2.length >= max) break;
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) continue;
      const text = (el.innerText || "").replace(/\s+/g, " ").trim().slice(0, 120);
      if (!text) continue;
      const tagLevel = /^h([1-6])$/i.exec(el.tagName);
      const level = tagLevel ? Number(tagLevel[1]) : Number(el.getAttribute("aria-level")) || 2;
      out2.push({ level, text });
    }
    return out2;
  }, limit).catch(() => []);
}
async function mapLimit(items, limit, fn) {
  const out2 = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out2[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out2;
}
function loadScript$1(filePath, opts = {}) {
  const abs2 = path__namespace.resolve(filePath);
  if (!fs__namespace.existsSync(abs2) || !fs__namespace.statSync(abs2).isFile()) {
    throw new index.AgentError("SCRIPT_NOT_FOUND", `Script file not found: ${abs2}`, {
      hint: "Pass the path to your *.demo-script.json. Create one with `narascreen init --url <site>`."
    });
  }
  const text = fs__namespace.readFileSync(abs2, "utf-8");
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const pos = /position (\d+)/.exec(msg);
    let where = "";
    if (pos) {
      const before = text.slice(0, Number(pos[1]));
      const line = before.split("\n").length;
      const col = before.length - before.lastIndexOf("\n");
      where = ` (line ${line}, column ${col})`;
    }
    throw new index.AgentError("SCRIPT_INVALID_JSON", `Script is not valid JSON${where}: ${msg}`, {
      hint: "Fix the JSON syntax (trailing commas and comments are not allowed)."
    });
  }
  const dir = path__namespace.dirname(abs2);
  const { script, warnings } = validateScript$1(raw, { dir, env: opts.env });
  return { script, raw, path: abs2, dir, warnings };
}
function validateScript$1(raw, ctx) {
  const resolved = interpolateEnv(raw, ctx.env ?? process.env);
  const issues = checkStructure(resolved);
  if (issues.length) throw invalid(issues);
  const script = index.DemoScriptSchema.parse(resolved);
  const warnings = [];
  const semantic = checkSemantics(script, ctx.dir, warnings);
  semantic.push(...index.checkPlugins(script, resolved, warnings));
  semantic.push(...checkCards(script, ctx.dir, warnings));
  checkPlan(script, warnings);
  if (semantic.length) throw invalid(semantic);
  return { script, warnings };
}
function invalid(issues) {
  const first = issues[0];
  return new index.AgentError(
    "SCRIPT_INVALID",
    `${issues.length} problem${issues.length > 1 ? "s" : ""} in the script. First: ${first.path}: ${first.message}`,
    {
      hint: "Fix every issue listed in details.issues, then run `narascreen validate` again.",
      where: { path: first.path },
      details: { issues }
    }
  );
}
const ENV_RE = /\$\{env:([A-Za-z_][A-Za-z0-9_]*)\}/g;
function interpolateEnv(value, env) {
  const missing = [];
  const walk = (v, p) => {
    if (typeof v === "string") {
      return v.replace(ENV_RE, (_m, name) => {
        const val = env[name];
        if (val == null) {
          missing.push({ name, path: p });
          return "";
        }
        return val;
      });
    }
    if (Array.isArray(v)) return v.map((x, i) => walk(x, `${p}[${i}]`));
    if (v && typeof v === "object") {
      const out22 = {};
      for (const [k, x] of Object.entries(v)) out22[k] = walk(x, p ? `${p}.${k}` : k);
      return out22;
    }
    return v;
  };
  const out2 = walk(value, "");
  if (missing.length) {
    const names = [...new Set(missing.map((m) => m.name))];
    throw new index.AgentError(
      "ENV_VAR_MISSING",
      `Environment variable${names.length > 1 ? "s" : ""} not set: ${names.join(", ")}`,
      {
        hint: `The script references \${env:NAME} placeholders. CLI: export them before running (e.g. ${names[0]}=... narascreen <command> …). HTTP: they come from the environment \`narascreen serve\` was started with — restart it with the variable set.`,
        where: { path: missing[0].path },
        details: { variables: names, usedAt: missing.map((m) => m.path) }
      }
    );
  }
  return out2;
}
const ShellSchema = index.DemoScriptSchema.extend({
  setup: index.array(index.unknown()).optional(),
  steps: index.array(index.BeatSchema.extend({ beat: index.array(index.unknown()).min(1) })).min(1)
});
const ACT_VERBS = index.ActEntrySchema.options.map((o) => o.shape.act.value);
const FX_VERBS = index.FxEntrySchema.options.map((o) => o.shape.fx.value);
const KNOWN_KEYS = collectKeys();
function checkStructure(resolved) {
  const issues = [];
  const top = ShellSchema.safeParse(resolved);
  if (!top.success) issues.push(...zodIssues(top.error, [], resolved));
  const obj = resolved ?? {};
  if (Array.isArray(obj.setup)) {
    obj.setup.forEach((e, i) => issues.push(...checkEntry(e, ["setup", i], true)));
  }
  if (Array.isArray(obj.steps)) {
    obj.steps.forEach((b, si) => {
      const beat = b?.beat;
      if (Array.isArray(beat)) {
        beat.forEach((e, i) => issues.push(...checkEntry(e, ["steps", si, "beat", i], false)));
      }
    });
  }
  return issues;
}
function checkEntry(e, at, actsOnly) {
  const p = fmtPath(at);
  if (!e || typeof e !== "object" || Array.isArray(e)) {
    return [{ path: p, message: 'entry must be an object like {"act": "click", …} or {"fx": "narrate", …}' }];
  }
  const o = e;
  const hasAct = "act" in o;
  const hasFx = "fx" in o;
  if (hasAct && hasFx) return [{ path: p, message: "entry has both `act` and `fx` — split it into two entries" }];
  if (!hasAct && !hasFx) {
    return [{ path: p, message: "entry needs an `act` (browser action) or `fx` (video effect) field" }];
  }
  if (hasFx && actsOnly) {
    return [{ path: p, message: "setup may only contain browser actions (act), not effects (fx) — setup is not recorded" }];
  }
  if (hasAct && !ACT_VERBS.includes(String(o.act))) {
    return [{
      path: `${p}.act`,
      message: `unknown act "${String(o.act)}"`,
      hint: didYouMean$1(String(o.act), ACT_VERBS) ?? `valid acts: ${ACT_VERBS.join(", ")}`
    }];
  }
  if (hasFx && !FX_VERBS.includes(String(o.fx))) {
    return [{
      path: `${p}.fx`,
      message: `unknown fx "${String(o.fx)}"`,
      hint: didYouMean$1(String(o.fx), FX_VERBS) ?? `valid fx: ${FX_VERBS.join(", ")}`
    }];
  }
  const res = (hasAct ? index.ActEntrySchema : index.FxEntrySchema).safeParse(e);
  return res.success ? [] : zodIssues(res.error, at, e);
}
function zodIssues(err, prefix, input) {
  const out2 = [];
  for (const iss of err.issues) {
    const rel = iss.path;
    const p = fmtPath([...prefix, ...rel]);
    if (rel.length && valueAt(input, rel) === void 0 && iss.code !== "unrecognized_keys") {
      out2.push({ path: p, message: `missing required field "${rel[rel.length - 1]}"` });
      continue;
    }
    if (iss.code === "unrecognized_keys") {
      for (const key of iss.keys) {
        out2.push({
          path: p ? `${p}.${key}` : key,
          message: `unknown field "${key}"`,
          hint: didYouMean$1(key, KNOWN_KEYS) ?? "remove it (see `narascreen schema` for allowed fields)"
        });
      }
      continue;
    }
    out2.push({ path: p || "(root)", message: iss.message });
  }
  return out2;
}
function valueAt(root, parts) {
  let v = root;
  for (const k of parts) {
    if (v == null || typeof v !== "object") return void 0;
    v = v[k];
  }
  return v;
}
function fmtPath(parts) {
  return parts.reduce(
    (acc, part) => typeof part === "number" ? `${acc}[${part}]` : acc ? `${acc}.${part}` : part,
    ""
  );
}
function collectKeys() {
  const keys = new Set(Object.keys(index.DemoScriptSchema.shape));
  for (const s of [...index.ActEntrySchema.options, ...index.FxEntrySchema.options]) Object.keys(s.shape).forEach((k) => keys.add(k));
  Object.keys(index.BeatSchema.shape).forEach((k) => keys.add(k));
  Object.keys(index.BUILTIN_DEFAULTS).forEach((k) => keys.add(k));
  ["kokoroEndpoint", "voices", "speed", "width", "height"].forEach((k) => keys.add(k));
  return [...keys];
}
function checkSemantics(script, dir, warnings) {
  const issues = [];
  const langs = script.languages ?? ["en"];
  const video = script.source ? probeSource(script, dir, issues) : null;
  const videoMode = !!script.source;
  if (!videoMode && !script.baseUrl) {
    issues.push({ path: "baseUrl", message: 'missing required field "baseUrl"', hint: "Set the site's origin, or set source.video to edit an existing video instead." });
  }
  if (videoMode) {
    if (script.baseUrl) warnings.push("baseUrl is ignored for video-source scripts.");
    if (script.setup?.length) issues.push({ path: "setup", message: "setup is only for browser scripts (a video-source script records nothing)" });
    if (script.storageState) issues.push({ path: "storageState", message: "storageState is only for browser scripts" });
  }
  if (script.storageState === "__NONE__") {
    delete script.storageState;
    warnings.push(`storageState: "__NONE__" is legacy — just omit storageState.`);
  } else if (script.storageState) {
    const p = resolveFile(script.storageState, dir);
    if (!fs__namespace.existsSync(p)) {
      issues.push({
        path: "storageState",
        message: `file not found: ${p}`,
        hint: "Create it by logging in with Playwright and saving context.storageState(), or log in with `setup` steps instead."
      });
    }
    script.storageState = p;
  }
  if (script.music) {
    script.music.path = resolveExisting(script.music.path, dir, "music.path", issues);
  }
  (script.setup ?? []).forEach((e, i) => checkAct(e, `setup[${i}]`, dir, issues, warnings));
  const ids = script.steps.map((b) => b.id);
  const seen = /* @__PURE__ */ new Map();
  let narrationCount = 0;
  script.steps.forEach((beat, si) => {
    const bp = `steps[${si}]`;
    if (seen.has(beat.id)) {
      issues.push({ path: `${bp}.id`, message: `duplicate step id "${beat.id}" (also steps[${seen.get(beat.id)}])` });
    } else seen.set(beat.id, si);
    if (beat.dwellMs != null && beat.dwellMs > 8e3) {
      warnings.push(`${bp}.dwellMs: ${beat.dwellMs}ms after every entry makes the video drag.`);
    }
    let hasRect = false;
    beat.beat.forEach((entry, i) => {
      const ep = `${bp}.beat[${i}]`;
      if (index.isAct(entry)) {
        if (videoMode) {
          issues.push({ path: ep, message: "video-source scripts contain only effects (fx) — there is no browser to act on" });
          return;
        }
        checkAct(entry, ep, dir, issues, warnings);
        if (index.RECT_ACTS.includes(entry.act) && (countSelectorKeys(entry) > 0 || entry.act === "swipe" && entry.to)) hasRect = true;
        return;
      }
      if (!index.isFx(entry)) return;
      const fx = entry;
      const ctx = { ep, videoMode, video, issues, warnings };
      if (videoMode) checkVideoFx(fx, ctx);
      else checkBrowserFx(fx, ctx);
      if (fx.anchor && fx.anchors) issues.push({ path: ep, message: "use either anchor or anchors, not both" });
      if (fx.rect && fx.rects) issues.push({ path: ep, message: "use either rect or rects, not both" });
      const ownsRect = !!(fx.anchor || fx.anchors || fx.rect || fx.rects || fx.targets);
      if (ownsRect) hasRect = true;
      if (fx.fx === "zoom" && fx.targets) {
        if (fx.anchor || fx.rect || fx.narrate != null || fx.audio != null) {
          issues.push({ path: ep, message: "with `targets`, put anchor/rect/narrate/audio inside each target instead of on the zoom" });
        }
        fx.targets.forEach((t, ti) => {
          const tp = `${ep}.targets[${ti}]`;
          if (videoMode ? !t.rect : !t.anchor) {
            issues.push({ path: tp, message: videoMode ? "each target needs a rect" : "each target needs an anchor" });
          }
          if (t.anchor) checkSelector(t.anchor, `${tp}.anchor`, issues, true);
          if (t.narrate != null || t.audio != null) {
            narrationCount++;
            checkNarration(t, tp, langs, dir, issues, warnings);
          }
        });
      }
      if (index.RECT_FX.includes(fx.fx) && !ownsRect && (videoMode || !hasRect)) {
        issues.push({
          path: ep,
          message: `${fx.fx} needs ${videoMode ? "a rect (or rects)" : "an element to target"}`,
          hint: videoMode ? "Give rect: [x, y, width, height] in source-video pixels (look at `preview --raw` frames)." : "Add an `anchor` selector, or place it right after a click/fill/select/hover/scroll/waitFor in the same step (it then targets that element)."
        });
      }
      if (fx.fx === "callout") {
        const positioned = (fx.style ?? "label") !== "lower-third";
        if (positioned && !ownsRect && (videoMode || !hasRect)) {
          warnings.push(`${ep}: callout has no element to sit next to, so it will be drawn at the top-left. Add an ${videoMode ? "rect" : "anchor"} or use style "lower-third".`);
        }
        if (fx.text && typeof fx.text === "object") checkLangMap(fx.text, `${ep}.text`, langs, true, issues);
        else if (typeof fx.text === "string" && langs.some((l) => l !== "en")) {
          warnings.push(`${ep}: callout text is the same in every language (${langs.join(", ")}). Use a map like {"en": "…", "hi": "…"}.`);
        }
        if (fx.style === "step-counter" && fx.step == null) {
          warnings.push(`${ep}: step-counter callout has no \`step\` number.`);
        }
      }
      if (fx.fx === "arrow" && fx.text && typeof fx.text === "object") checkLangMap(fx.text, `${ep}.text`, langs, true, issues);
      if (fx.duration != null && fx.duration !== "auto" && !index.OVERLAY_FX.includes(fx.fx)) {
        warnings.push(`${ep}: duration has no effect on ${fx.fx}.`);
      }
      if (index.RANGE_FX.includes(fx.fx)) checkRange(fx, ctx, si, ids, beat.beat.slice(i + 1));
      if (fx.fx === "narrate" && fx.narrate == null && fx.audio == null) {
        issues.push({ path: ep, message: "narrate needs `narrate` (text to speak) or `audio` (a recorded file)" });
      }
      if ((fx.fx === "narrate" || fx.fx === "zoom") && (fx.narrate != null || fx.audio != null)) {
        narrationCount++;
        checkNarration(fx, ep, langs, dir, issues, warnings);
      }
    });
  });
  for (const [lang2, voice] of Object.entries(script.tts?.voices ?? {})) {
    checkVoice(voice, lang2, `tts.voices.${lang2}`, warnings);
  }
  if (narrationCount === 0) {
    warnings.push('No narration in any step — the video will have no voiceover. Add {"fx": "narrate", "narrate": "…"} entries.');
  }
  if (script.output?.resolution && script.output.resolution !== "native") {
    const r = index.RESOLUTIONS[script.output.resolution];
    const src = video ?? script.viewport;
    if (Math.abs(r.width / r.height - src.width / src.height) > 0.02) {
      warnings.push(`output.resolution ${script.output.resolution} has a different shape than the ${video ? "source video" : "viewport"} (${src.width}x${src.height}); the video will be letterboxed.`);
    }
  }
  return issues;
}
function probeSource(script, dir, issues) {
  const p = resolveExisting(script.source.video, dir, "source.video", issues);
  script.source.video = p;
  if (!fs__namespace.existsSync(p)) return null;
  const duration = index.probeDuration(p);
  if (!(duration > 0)) {
    issues.push({ path: "source.video", message: `not a readable video: ${p}` });
    return null;
  }
  const { width, height } = index.probeResolution(p);
  script.viewport = { width, height };
  return { width, height, duration };
}
function checkBrowserFx(fx, c) {
  if (fx.at != null) c.issues.push({ path: `${c.ep}.at`, message: "`at` is only for video-source scripts — in browser scripts an effect happens where it sits in the step" });
  if (fx.rect || fx.rects || fx.targets?.some((t) => t.rect)) {
    c.issues.push({ path: c.ep, message: "`rect`/`rects` are only for video-source scripts — use `anchor`/`anchors` (selectors)" });
  }
  if (fx.anchor) checkSelector(fx.anchor, `${c.ep}.anchor`, c.issues, true);
  fx.anchors?.forEach((a, ai) => checkSelector(a, `${c.ep}.anchors[${ai}]`, c.issues, true));
  if (fx.fx === "mute") c.warnings.push(`${c.ep}: browser recordings have no audio, so mute has no effect.`);
}
function checkVideoFx(fx, c) {
  if (fx.anchor || fx.anchors || fx.targets?.some((t) => t.anchor)) {
    c.issues.push({ path: c.ep, message: "anchors are only for browser scripts — use `rect` / `rects` in video-source scripts" });
  }
  if (fx.at == null) {
    c.issues.push({ path: c.ep, message: 'missing required field "at" (seconds into the source video)' });
  } else if (c.video && fx.at >= c.video.duration) {
    c.issues.push({ path: `${c.ep}.at`, message: `at ${fx.at}s is past the end of the source video (${c.video.duration.toFixed(1)}s)` });
  }
  const rects = [fx.rect, ...fx.rects ?? [], ...(fx.targets ?? []).map((t) => t.rect)].filter(Boolean);
  if (c.video) {
    for (const [x, y, w, h] of rects) {
      if (x + w > c.video.width || y + h > c.video.height) {
        c.issues.push({ path: c.ep, message: `rect [${x}, ${y}, ${w}, ${h}] goes outside the ${c.video.width}x${c.video.height} video` });
      }
    }
  }
}
function checkRange(fx, c, stepIndex, ids, rest) {
  if (fx.until != null && fx.seconds != null) {
    c.issues.push({ path: c.ep, message: "use either `until` or `seconds`, not both" });
    return;
  }
  if (c.videoMode) {
    if (fx.until != null) c.issues.push({ path: `${c.ep}.until`, message: "video-source scripts use `seconds` for ranges (there are no browser actions to end at)" });
    else if (fx.seconds == null) c.issues.push({ path: c.ep, message: `${fx.fx} needs \`seconds\` (length of the range) in video-source scripts` });
    return;
  }
  if (fx.seconds != null) return;
  const until = fx.until ?? index.RANGE_DEFAULT_UNTIL[fx.fx];
  if (until === "next-act") {
    if (!rest.some((e) => index.isAct(e))) {
      c.issues.push({
        path: c.ep,
        message: `${fx.fx} ends at the next browser action (until "next-act"), but none follows it in this step`,
        hint: 'Put the action to skip over after it in the same step, or set until: "step-end" / a step id / seconds.'
      });
    }
  } else if (until !== "step-end") {
    const target = ids.indexOf(until);
    if (target < 0) {
      c.issues.push({ path: `${c.ep}.until`, message: `unknown step id "${until}"`, hint: `use "next-act", "step-end" or one of: ${ids.join(", ")}` });
    } else if (target < stepIndex) {
      c.issues.push({ path: `${c.ep}.until`, message: `step "${until}" comes before this one — a range can only end at this or a later step` });
    }
  }
}
function checkAct(e, ep, dir, issues, warnings) {
  const n = countSelectorKeys(e);
  if (e.act === "fill") {
    if (e.value == null && e.text != null && n > 1) {
      e.value = e.text;
      delete e.text;
      warnings.push(`${ep}: fill uses \`text\` as the typed value (legacy). Rename it to \`value\`.`);
    } else if (e.value == null) {
      issues.push({ path: ep, message: "fill needs `value` (the text to type)" });
    }
  }
  if (e.act === "goto") {
    if (!!e.path === !!e.url) issues.push({ path: ep, message: "goto needs exactly one of `path` or `url`" });
  }
  if (index.TARGETED_ACTS.includes(e.act)) {
    checkSelector(e, ep, issues, true);
  } else if (e.act === "press" || e.act === "scroll" || e.act === "swipe") {
    if (countSelectorKeys(e) > 0) checkSelector(e, ep, issues, true);
    else checkSelector(e, ep, issues, false);
    if (e.act === "scroll" && countSelectorKeys(e) === 0 && e.y == null) {
      issues.push({ path: ep, message: "scroll needs a selector (element to bring into view) or `y`" });
    }
  }
  if (e.act === "useSession" && e.storageState) {
    const p = resolveFile(e.storageState, dir);
    if (!fs__namespace.existsSync(p)) issues.push({ path: `${ep}.storageState`, message: `file not found: ${p}` });
    e.storageState = p;
  }
  if (e.act === "swipe" && e.to) checkSelector(e.to, `${ep}.to`, issues, true);
  if (e.act === "upload" && e.files != null) {
    const list = Array.isArray(e.files) ? e.files : [e.files];
    e.files = list.map((f, k) => {
      const abs2 = resolveFile(f, dir);
      if (!fs__namespace.existsSync(abs2)) {
        issues.push({ path: `${ep}.files[${k}]`, message: `file not found: ${abs2}`, hint: "Paths are relative to the script file (inline HTTP scripts: to the workspace — upload it with PUT /v1/files first)." });
      } else if (!fs__namespace.statSync(abs2).isFile()) {
        issues.push({ path: `${ep}.files[${k}]`, message: `not a file: ${abs2}` });
      }
      return abs2;
    });
  }
  if (e.act === "wait" && e.ms != null && e.ms > 1e4) {
    warnings.push(`${ep}: waits ${e.ms}ms on camera — consider a shorter wait.`);
  }
}
function countSelectorKeys(s) {
  return index.SELECTOR_KEYS.filter((k) => s[k] != null).length;
}
function checkSelector(s, p, issues, required) {
  const keys = index.SELECTOR_KEYS.filter((k) => s[k] != null);
  if (keys.length === 0) {
    if (required) {
      issues.push({
        path: p,
        message: `needs a selector: one of ${index.SELECTOR_KEYS.join(" | ")}`,
        hint: "Run `narascreen inspect --url <page>` to get ready-made selectors."
      });
    }
    if (s.name != null) issues.push({ path: `${p}.name`, message: "`name` only works together with `role`" });
    if (s.within || s.exact != null || s.nth != null) {
      issues.push({ path: p, message: "`within`, `exact` and `nth` only work together with a selector" });
    }
    return;
  }
  if (keys.length > 1) {
    issues.push({
      path: p,
      message: `uses ${keys.length} selector keys (${keys.join(", ")}) — use exactly one`,
      hint: "Keep the most specific one; narrow it with `within` or `nth` instead of combining keys."
    });
  }
  if (s.name != null && s.role == null) {
    issues.push({ path: `${p}.name`, message: "`name` only works together with `role`" });
  }
  checkRole(s.role, `${p}.role`, issues);
  checkRole(s.within?.role, `${p}.within.role`, issues);
  const w = s.within;
  if (w) {
    const ways = [w.css, w.text, w.role].filter((x) => x != null).length;
    if (ways !== 1) issues.push({ path: `${p}.within`, message: "within needs exactly one of css | text | role" });
    if (w.name != null && w.role == null) issues.push({ path: `${p}.within.name`, message: "within.name needs within.role" });
  }
}
function checkRole(role, p, issues) {
  if (role == null || ARIA_ROLES.includes(role)) return;
  issues.push({
    path: p,
    message: `unknown ARIA role "${role}"`,
    hint: didYouMean$1(role, [...ARIA_ROLES]) ?? "use a role from `narascreen inspect` output (button, link, textbox, heading, row, dialog, …)"
  });
}
function checkNarration(fx, ep, langs, dir, issues, warnings) {
  const wanted = fx.lang ? [fx.lang] : langs;
  const n = fx.narrate;
  if (typeof n === "string") {
    if (langs.length > 1 && !fx.lang && fx.audio == null) {
      warnings.push(`${ep}: the same narration text will be spoken for every language (${langs.join(", ")}). Use a map like {"en": "…", "hi": "…"}.`);
    }
  } else if (n) {
    checkLangMap(n, `${ep}.narrate`, wanted, fx.audio == null, issues);
  }
  if (typeof fx.audio === "string") {
    fx.audio = resolveExisting(fx.audio, dir, `${ep}.audio`, issues);
    if (langs.length > 1 && !fx.lang) warnings.push(`${ep}: the same audio file is used for every language (${langs.join(", ")}).`);
  } else if (fx.audio) {
    const audio = fx.audio;
    checkLangMap(audio, `${ep}.audio`, wanted, n == null, issues);
    for (const k of Object.keys(audio)) audio[k] = resolveExisting(audio[k], dir, `${ep}.audio.${k}`, issues);
  }
  if (fx.voice) {
    if (fx.audio != null) warnings.push(`${ep}: voice is ignored when audio is given.`);
    else for (const lang2 of wanted) checkVoice(fx.voice, lang2, `${ep}.voice`, warnings);
  }
}
function checkLangMap(map, p, wanted, mustCover, issues) {
  for (const k of Object.keys(map)) {
    if (!index.TTS_LANGUAGES.includes(k)) {
      issues.push({ path: `${p}.${k}`, message: `unknown language "${k}"`, hint: `supported: ${index.TTS_LANGUAGES.join(", ")}` });
    }
  }
  if (!mustCover) return;
  for (const lang2 of wanted) {
    if (map[lang2] == null && map.en == null) {
      issues.push({ path: p, message: `nothing for language "${lang2}" (and no "en" fallback)`, hint: `Add "${lang2}": "…" to the map.` });
    }
  }
}
function checkVoice(voice, lang2, p, warnings) {
  const known = Object.values(index.DEFAULT_VOICES).some((vs) => vs.includes(voice));
  if (!known) {
    warnings.push(`${p}: "${voice}" is not in the voice catalog — run \`narascreen voices\`. It may still work if your Kokoro has it.`);
    return;
  }
  const code = index.LANG_CODES[lang2];
  if (code && voice[0] !== code) {
    warnings.push(`${p}: voice "${voice}" is not a ${lang2} voice (${lang2} voices start with "${code}"); pronunciation will be off.`);
  }
}
function resolveFile(p, dir) {
  return path__namespace.isAbsolute(p) ? p : path__namespace.resolve(dir, p);
}
function resolveExisting(p, dir, at, issues) {
  const abs2 = resolveFile(p, dir);
  if (!fs__namespace.existsSync(abs2)) issues.push({ path: at, message: `file not found: ${abs2}` });
  return abs2;
}
function didYouMean$1(word, options) {
  let best;
  let bestD = Infinity;
  for (const o of options) {
    const d = levenshtein$1(word.toLowerCase(), o.toLowerCase());
    if (d < bestD) {
      bestD = d;
      best = o;
    }
  }
  return best && bestD <= Math.max(2, Math.floor(word.length / 3)) ? `did you mean "${best}"?` : void 0;
}
function levenshtein$1(a, b) {
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
function checkCards(script, dir, warnings) {
  const issues = [];
  const langs = script.languages ?? ["en"];
  for (const which of ["intro", "outro"]) {
    const card = script[which];
    if (!card) continue;
    if (card.logo) {
      card.logo = resolveExisting(card.logo, dir, `${which}.logo`, issues);
      if (!/\.(png|jpe?g|svg|webp)$/i.test(card.logo)) issues.push({ path: `${which}.logo`, message: "logo must be a png, jpg, svg or webp image" });
    }
    for (const k of ["title", "subtitle", "cta", "narrate"]) {
      const v = card[k];
      if (v && typeof v === "object") checkLangMap(v, `${which}.${k}`, langs, true, issues);
      else if (k === "narrate" && typeof v === "string" && langs.some((l) => l !== "en")) {
        warnings.push(`${which}.narrate is the same text in every language (${langs.join(", ")}). Use a map like {"en": "…", "hi": "…"}.`);
      }
    }
  }
  return issues;
}
function checkPlan(script, warnings) {
  const plan = script.plan;
  if (!plan) return;
  const said = (v) => typeof v === "string" ? v : v && typeof v === "object" ? Object.values(v).join(" ") : "";
  for (const term of plan.leaveOut ?? []) {
    const t = term.toLowerCase();
    script.steps.forEach((st, si) => {
      const texts = [st.id, st.label ?? ""];
      for (const e of st.beat) {
        const x = e;
        texts.push(said(x.narrate), said(x.text), x.name ?? "", x.label ?? "", x.path ?? "");
      }
      if (texts.some((s) => s.toLowerCase().includes(t))) {
        warnings.push(`plan.leaveOut says "${term}", but step "${st.id}" (steps[${si}]) mentions it. Drop that part, or update the plan.`);
      }
    });
  }
  if (plan.targetSec) {
    const est = scriptSummary$1(script).estimatedVideoSec;
    if (est > plan.targetSec * 1.25) {
      warnings.push(`The video is estimated at ~${est}s but plan.targetSec is ${plan.targetSec}s. Cut steps or shorten narration (or raise the target).`);
    }
  }
}
function speechSec(chars, speed = 1) {
  return chars > 0 ? (0.2 + chars / 16.8) / speed : 0;
}
const RECORDED_AUDIO_GUESS_SEC = 4;
function scriptSummary$1(script) {
  const d = { ...index.BUILTIN_DEFAULTS, ...script.defaults };
  const speed = script.tts?.speed ?? 1;
  const fxCounts = {};
  let acts = 0;
  let recordMs = 500 + d.dwellMs + 500;
  let narrations = 0;
  let spokenSec = 0;
  let addedSec = 0;
  let unknownRanges = 0;
  const speak = (n, audio) => {
    if (n == null && audio == null) return 0;
    narrations++;
    const sec = audio != null ? RECORDED_AUDIO_GUESS_SEC : speechSec(typeof n === "string" ? n.length : n ? (n.en ?? Object.values(n)[0] ?? "").length : 0, speed);
    spokenSec += sec;
    return sec;
  };
  for (const beat of script.steps) {
    const dwell = beat.dwellMs ?? d.dwellMs;
    for (const e of beat.beat) {
      recordMs += dwell;
      if (index.isAct(e)) {
        acts++;
        if (e.act === "wait") recordMs += e.ms ?? 0;
        if (e.act === "fill") recordMs += (e.value?.length ?? 0) * d.typeDelayMs + d.revealMs;
        if (index.RECT_ACTS.includes(e.act) && e.act !== "waitFor" && e.act !== "press") recordMs += d.revealMs;
        continue;
      }
      const fx = e;
      if (fx.disabled) continue;
      fxCounts[fx.fx] = (fxCounts[fx.fx] ?? 0) + 1;
      if (fx.anchor || fx.anchors?.length || fx.targets?.length) recordMs += d.revealMs;
      if (fx.fx === "narrate") {
        const sec = speak(fx.narrate, fx.audio);
        if (fx.freeze !== false) addedSec += sec;
      } else if (fx.fx === "pause") {
        addedSec += fx.seconds ?? 3;
      } else if (fx.fx === "zoom") {
        const zoomIn = fx.zoomDuration ?? d.zoomDuration;
        const hold = fx.zoomHold ?? d.zoomHold;
        const targets = fx.targets?.length ? fx.targets : [fx];
        targets.forEach((t, k) => {
          const sec = speak(t.narrate, t.audio) || (k === 0 && fx.targets?.length ? speak(fx.narrate, fx.audio) : 0);
          addedSec += 2 * zoomIn + (sec || hold);
        });
      } else if (fx.fx === "skip" || fx.fx === "speed") {
        if (fx.seconds != null) addedSec -= fx.fx === "skip" ? fx.seconds : fx.seconds * (1 - 1 / (fx.factor ?? 2));
        else unknownRanges++;
      }
    }
  }
  const recordingSec = script.source ? index.probeDuration(script.source.video) : recordMs / 1e3;
  for (const card of [script.intro, script.outro]) {
    if (!card) continue;
    const text = typeof card.narrate === "string" ? card.narrate : card.narrate ? card.narrate.en ?? Object.values(card.narrate)[0] ?? "" : "";
    const voice = speechSec(text.length, speed);
    spokenSec += voice;
    addedSec += typeof card.duration === "number" ? card.duration : text ? voice + 1.3 : 3;
  }
  return {
    mode: script.source ? "video" : "browser",
    steps: script.steps.length,
    acts,
    effects: fxCounts,
    narrations,
    languages: script.languages ?? ["en"],
    estimatedRecordingSec: Math.round(recordingSec),
    /** Seconds of speech, talk-over narration included. */
    estimatedNarrationSec: Math.round(spokenSec),
    /** Seconds the renderer adds to the recording (freezes, zooms, pauses, cards; minus known cuts). */
    estimatedAddedSec: Math.round(addedSec),
    estimatedVideoSec: Math.round(Math.max(0, recordingSec + addedSec)),
    note: unknownRanges ? "skip/speed ranges that end at a later act or step shorten the video; not included in the estimate" : void 0
  };
}
const __narascreen_req0 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  loadScript: loadScript$1,
  scriptSummary: scriptSummary$1,
  speechSec,
  validateScript: validateScript$1
}, Symbol.toStringTag, { value: "Module" }));
function initScript$1(opts) {
  const url2 = parseSiteUrl(opts.url);
  const name = opts.name?.trim() || nameFromUrl(url2);
  const cwd = opts.cwd ?? process.cwd();
  const scriptPath = path__namespace.resolve(cwd, opts.out ?? `${fileSafe(name)}.demo-script.json`);
  if (fs__namespace.existsSync(scriptPath) && !opts.force) {
    throw new index.AgentError("USAGE", `File already exists: ${scriptPath}`, {
      hint: "Pass --force to overwrite it, or choose another --out.",
      details: { scriptPath }
    });
  }
  const script = starterScript(url2, name);
  const { warnings } = validateScript$1(structuredClone(script), { dir: path__namespace.dirname(scriptPath) });
  fs__namespace.mkdirSync(path__namespace.dirname(scriptPath), { recursive: true });
  fs__namespace.writeFileSync(scriptPath, JSON.stringify(script, null, 2) + "\n");
  return { scriptPath, script, warnings };
}
function starterScript(url2, name) {
  const site = url2.host.replace(/^www\./, "");
  const startPath = `${url2.pathname || "/"}${url2.search}${url2.hash}`;
  return {
    version: 1,
    scope: name,
    baseUrl: url2.origin,
    viewport: { ...index.DEFAULT_VIEWPORT },
    steps: [
      {
        id: "intro",
        label: "Open the start page",
        note: `Starter step — replace or extend it. Get ready-to-paste selectors for any page with \`narascreen inspect --url ${url2.origin}${startPath}\`.`,
        beat: [
          { act: "goto", path: startPath },
          // The page's main heading is unknown here, so settle with a plain wait
          // instead of a waitFor on an element that may not exist.
          { act: "wait", ms: 1e3 },
          { fx: "callout", text: name, style: "lower-third" },
          { fx: "narrate", narrate: `Welcome! This is a quick tour of ${site}.` }
        ]
      }
    ]
  };
}
function nameFromUrl(url2) {
  return url2.hostname.replace(/^www\./, "") || "demo";
}
function parseSiteUrl(raw) {
  let url2;
  try {
    url2 = new URL(raw);
  } catch {
    throw new index.AgentError("USAGE", `--url is not an absolute URL: ${raw}`, {
      hint: "Pass the full address of the page the demo starts on, e.g. --url https://app.example.com/"
    });
  }
  if (url2.protocol !== "http:" && url2.protocol !== "https:") {
    throw new index.AgentError("USAGE", `--url must be http(s), got ${url2.protocol}`, {
      hint: "Pass the web address of the site, e.g. --url https://app.example.com/"
    });
  }
  return url2;
}
function fileSafe(name) {
  return name.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[-.]+|-+$/g, "") || "demo";
}
const __narascreen_req1 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  initScript: initScript$1,
  nameFromUrl,
  starterScript
}, Symbol.toStringTag, { value: "Module" }));
const CANCEL_GRACE_MS = 5e3;
const MAX_LINE = 16 * 1024;
const MAX_STDOUT = 8 * 1024 * 1024;
const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;
function defaultCliEntry(baseDir = __dirname) {
  const bundled = path__namespace.join(baseDir, "narascreen.cjs");
  if (fs__namespace.existsSync(bundled)) return bundled;
  return path__namespace.join(baseDir, "..", "bin", "narascreen");
}
function isBundled(baseDir = __dirname) {
  return fs__namespace.existsSync(path__namespace.join(baseDir, "narascreen.cjs"));
}
function narascreenVersion(editorDir) {
  const stamped = "1.0.0";
  return stamped;
}
function killTree(child, signal) {
  if (!child.pid) return;
  if (process.platform === "win32") {
    try {
      child_process.spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    } catch {
      child.kill(signal);
    }
    return;
  }
  try {
    process.kill(-child.pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
    }
  }
}
function isAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
function createLineSplitter(onLine, maxLine = MAX_LINE) {
  let partial = "";
  return {
    push(chunk) {
      const lines = (partial + chunk).split("\n");
      partial = lines.pop() ?? "";
      if (partial.length > maxLine) {
        lines.push(partial);
        partial = "";
      }
      for (const line of lines) onLine(line);
    },
    flush() {
      if (partial) onLine(partial);
      partial = "";
    }
  };
}
function parseStderrLine(raw) {
  const line = raw.replace(ANSI_RE, "").trimEnd();
  if (!line.trim()) return null;
  if (line.startsWith("{")) {
    try {
      const ev = JSON.parse(line);
      if (isNaraEvent(ev)) return { kind: "event", event: ev };
    } catch {
    }
  }
  return { kind: "text", line };
}
function isNaraEvent(v) {
  const e = v;
  return isObject(v) && typeof e.message === "string" && ["stage", "step", "log", "warning"].includes(e.type);
}
function parseEnvelope(stdout) {
  const text = stdout.trim();
  if (!text) return void 0;
  const attempt = (s) => {
    try {
      const v = JSON.parse(s);
      return isObject(v) && typeof v.ok === "boolean" && typeof v.command === "string" ? v : void 0;
    } catch {
      return void 0;
    }
  };
  const whole = attempt(text);
  if (whole) return whole;
  const lines = text.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].startsWith("{")) continue;
    const env = attempt(lines.slice(i).join("\n"));
    if (env) return env;
  }
  return void 0;
}
const ENV_NAME_RE = /^[A-Z_][A-Z0-9_]*$/;
const RESERVED_ENV_RE = /^(PATH|HOME|USER|LOGNAME|SHELL|PWD|OLDPWD|TMPDIR|TMP|TEMP|IFS|ENV|BASH_ENV|LANG|LANGUAGE|TZ|DISPLAY|WAYLAND_DISPLAY|NO_COLOR|FORCE_COLOR|(HTTPS?|ALL|NO|FTP)_PROXY|(LC|XDG|NODE|NPM|NARASCREEN|LD|DYLD|PLAYWRIGHT|ELECTRON|KOKORO|FFMPEG|FFPROBE|TSX|UV|SSL|OPENSSL|PYTHON|DBUS|CHROME|CHROMIUM|GTK|QT)(_.*)?)$/;
function isObject(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
const out = (desc) => ({ flag: "--out <path>", name: "out", type: "string", desc });
const headed = { flag: "--headed", name: "headed", type: "boolean", desc: "Show the browser window (default: headless)." };
const lang = {
  flag: "--lang <codes>",
  name: "lang",
  type: "string",
  desc: "Comma-separated languages to produce, e.g. en,hi (default: script.languages or en)."
};
const force = { flag: "--force", name: "force", type: "boolean", desc: "Replace an existing job's recording." };
const resolution = {
  flag: "--resolution <preset>",
  name: "resolution",
  type: "string",
  desc: "native | 480p | 720p | 1080p | 1440p | 4k (overrides script output.resolution; default native)."
};
const quality = {
  flag: "--quality <level>",
  name: "quality",
  type: "string",
  desc: "high | medium | low (overrides script output.quality; default high)."
};
const COMMANDS = [
  {
    name: "help",
    usage: "narascreen help",
    summary: "List commands.",
    flags: [],
    output: "{ commands, docs }",
    heavy: false
  },
  {
    name: "manual",
    usage: "narascreen manual",
    summary: "Print the full manual as Markdown (same content as the /docs page).",
    flags: [],
    output: "Markdown on stdout (not a JSON envelope).",
    heavy: false
  },
  {
    name: "docs",
    usage: "narascreen docs --out docs.html",
    summary: "Write the manual as a standalone HTML page.",
    flags: [out("HTML file to write (required).")],
    output: "{ path }",
    heavy: false
  },
  {
    name: "schema",
    usage: "narascreen schema [--out demo-script.schema.json]",
    summary: "Print the demo-script JSON Schema.",
    flags: [out("Write the schema to this file instead of stdout.")],
    output: "Raw JSON Schema on stdout (not an envelope), or { path } with --out.",
    heavy: false
  },
  {
    name: "doctor",
    usage: "narascreen doctor [--script my.demo-script.json]",
    summary: "Check that ffmpeg, the browser and the speech engine are ready. Run this first.",
    flags: [{ flag: "--script <file>", name: "script", type: "string", desc: "Also check this script's TTS endpoint." }],
    output: "{ ready, checks: [{ id, ok, required, detail, fix? }] }",
    heavy: false
  },
  {
    name: "voices",
    usage: "narascreen voices [--lang hi]",
    summary: "List narration languages and voice ids.",
    flags: [{ flag: "--lang <code>", name: "lang", type: "string", desc: "Only this language." }],
    output: "{ languages: [{ code, label, defaultVoice, voices }] }",
    heavy: false
  },
  {
    name: "init",
    usage: "narascreen init --url https://app.example.com [--out my.demo-script.json] [--name my-demo]",
    summary: "Write a small valid starter script to edit.",
    flags: [
      { flag: "--url <url>", name: "url", type: "string", desc: "Site to record (required)." },
      out("Script file to write (default ./<name>.demo-script.json)."),
      { flag: "--name <name>", name: "name", type: "string", desc: "Demo name / scope (default: from the URL host)." },
      { flag: "--force", name: "force", type: "boolean", desc: "Overwrite an existing file." }
    ],
    output: "{ scriptPath }",
    heavy: false
  },
  {
    name: "inspect",
    usage: "narascreen inspect --url https://app.example.com/page | --script my.demo-script.json [--until <step-id>]",
    summary: "Open a page and list its elements with ready-to-paste selectors, plus a screenshot.",
    flags: [
      { flag: "--url <url>", name: "url", type: "string", desc: "Page to open (absolute, or a path when --script gives baseUrl)." },
      { flag: "--script <file>", name: "script", type: "string", desc: "Use this script's baseUrl/viewport/session and run its setup first." },
      { flag: "--until <step-id>", name: "until", type: "string", desc: "With --script: also run the steps up to and including this one, then inspect." },
      { flag: "--viewport <WxH>", name: "viewport", type: "string", desc: "Browser size, e.g. 1440x900." },
      { flag: "--storage-state <file>", name: "storage-state", type: "string", desc: "Start logged in with this Playwright storageState." },
      { flag: "--full-page", name: "full-page", type: "boolean", desc: "Also save a full-page screenshot." },
      { flag: "--plugin <name>", name: "plugin", type: "string", desc: "Recording plugin to inspect with, e.g. flutter (a Flutter web build as a phone, with its accessibility tree switched on). A --script's own plugins are used otherwise." },
      { flag: "--device <name>", name: "device", type: "string", desc: "With --plugin flutter: the phone to emulate (pixel-7 | pixel-9-pro | galaxy-s24 | small-phone; default pixel-7)." },
      out("Folder for screenshots and the accessibility tree (default ./narascreen-out/inspect/<time>)."),
      headed
    ],
    output: '{ url, title, screenshot, headings, elements: [{ role, name, selector, matches, visible, rect, inputType? }], ariaSnapshotPath } — file inputs are listed even when hidden, with inputType "file"',
    heavy: true
  },
  {
    name: "validate",
    usage: "narascreen validate my.demo-script.json",
    summary: "Check a script against the schema and rules without opening a browser.",
    arg: { name: "script", desc: "The demo-script file.", required: true },
    flags: [],
    output: "{ valid, scriptPath, summary: { steps, effects, narrations, estimatedVideoSec, … } }",
    heavy: false
  },
  {
    name: "check",
    usage: "narascreen check my.demo-script.json [--headed]",
    summary: "Dry-run every browser step (no recording) to prove all selectors work.",
    arg: { name: "script", desc: "The demo-script file.", required: true },
    flags: [
      out("Folder for failure screenshots (default ./narascreen-out/<script-name>)."),
      headed,
      { flag: "--hold", name: "hold", type: "boolean", desc: "With --headed: keep the browser open at the end until Enter is pressed." }
    ],
    output: "{ slots, durationSec }",
    heavy: true
  },
  {
    name: "record",
    usage: "narascreen record my.demo-script.json --out ./jobs/my-demo [--force]",
    summary: "Run the steps in a real browser and record the screen into a job folder (video-source scripts: import the video instead).",
    arg: { name: "script", desc: "The demo-script file.", required: true },
    flags: [out("Job folder (default ./narascreen-out/<script-name>)."), headed, force],
    output: "{ job, recording, durationSec, slots }",
    heavy: true
  },
  {
    name: "produce",
    usage: "narascreen produce ./jobs/my-demo [--script my.demo-script.json] [--lang en,hi]",
    summary: "Generate narration and render the final video(s) from a recorded job. Re-run after text edits — no re-record needed.",
    arg: { name: "job", desc: "The job folder from record/make.", required: true },
    flags: [
      { flag: "--script <file>", name: "script", type: "string", desc: "Script to use (default: the file the job was recorded from, re-read fresh)." },
      lang,
      resolution,
      quality
    ],
    output: "{ job, videos: [{ lang, path, durationSec, narrations, timings, preview }] }",
    heavy: true
  },
  {
    name: "make",
    usage: "narascreen make my.demo-script.json --out ./jobs/my-demo [--lang en,hi]",
    summary: "validate → record → produce → preview in one go. Reuses the recording when only text changed.",
    arg: { name: "script", desc: "The demo-script file.", required: true },
    flags: [
      out("Job folder (default ./narascreen-out/<script-name>)."),
      lang,
      resolution,
      quality,
      headed,
      { ...force, desc: "Always re-record, even if the recording could be reused." }
    ],
    output: "{ job, recorded, videos: [{ lang, path, durationSec, narrations, timings, preview }] }",
    heavy: true
  },
  {
    name: "preview",
    usage: "narascreen preview ./jobs/my-demo [--lang en] [--tiles 12]",
    summary: "Extract frames + a contact sheet from a produced video (or, with --raw, the recording/imported source) so you can check it visually.",
    arg: { name: "job", desc: "The job folder.", required: true },
    flags: [
      { flag: "--lang <code>", name: "lang", type: "string", desc: "Which video (default: first produced)." },
      { flag: "--tiles <n>", name: "tiles", type: "string", desc: "Number of frames (default 12, max 48)." },
      { flag: "--raw", name: "raw", type: "boolean", desc: "Preview the raw recording instead of a produced video — use it to pick `at` times and `rect`s for video-source scripts." }
    ],
    output: "{ video, durationSec, contactSheet, frames: [{ t, path }] }",
    heavy: true
  },
  {
    name: "status",
    usage: "narascreen status ./jobs/my-demo",
    summary: "Show what a job has recorded/produced and the next command to run.",
    arg: { name: "job", desc: "The job folder.", required: true },
    flags: [],
    output: "{ job, scope, record, produce, artifacts }",
    heavy: false
  },
  {
    name: "serve",
    usage: "narascreen serve [--port 4790] [--host 127.0.0.1] [--token <secret>] [--workspace ./narascreen-out] [--keep-cache]",
    summary: "Start the local HTTP server: docs at /docs, runs at /v1/runs, live events over SSE.",
    flags: [
      { flag: "--port <n>", name: "port", type: "string", desc: "Port (default 4790)." },
      { flag: "--host <addr>", name: "host", type: "string", desc: "Bind address (default 127.0.0.1 — local only)." },
      { flag: "--token <secret>", name: "token", type: "string", desc: "Require `Authorization: Bearer <secret>` on /v1 (or set NARASCREEN_TOKEN)." },
      { flag: "--workspace <dir>", name: "workspace", type: "string", desc: "Where scripts and jobs submitted over HTTP are stored (default ./narascreen-out)." },
      { flag: "--concurrency <n>", name: "concurrency", type: "string", desc: "Heavy runs executed at once (default 1)." },
      {
        flag: "--keep-cache",
        name: "keep-cache",
        type: "boolean",
        desc: "Don't clean the workspace cache on start. By default every start deletes run history (runs/), inspect screenshots (inspect/) and each job's narration audio and preview frames; scripts, uploads, recordings and final videos are kept."
      }
    ],
    output: "Prints one envelope { url, docs, cleaned } when listening, then keeps running.",
    heavy: false
  }
];
const GLOBAL_FLAGS = [
  { flag: "--events <text|json>", name: "events", type: "string", desc: "Progress on stderr as text lines (default) or one JSON event per line." },
  { flag: "--quiet", name: "quiet", type: "boolean", desc: "No progress output (text mode)." },
  { flag: "--help", name: "help", type: "boolean", desc: "Same as `narascreen help`." },
  { flag: "--version", name: "version", type: "boolean", desc: "Print the version." }
];
function findCommand(name) {
  return COMMANDS.find((c) => c.name === name);
}
const children = /* @__PURE__ */ new Set();
const POSIX = process.platform !== "win32";
function parallelLanguages() {
  const n = Number(process.env.NARASCREEN_PARALLEL_LANGS ?? 2);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 2;
}
function stopRenderChildren(sig = "SIGTERM") {
  for (const c of children) {
    try {
      if (POSIX && c.pid) process.kill(-c.pid, sig);
      else c.kill(sig);
    } catch {
    }
  }
}
process.on("exit", () => stopRenderChildren("SIGKILL"));
function produceLanguageInChild(jobDir, script, trace, lang2, opts) {
  const entry = childEntry();
  const inputFile = path__namespace.join(jobDir, `.produce-${lang2}-${process.pid}.json`);
  const input = { jobDir, script, trace, lang: lang2, opts, events: index.eventSettings() };
  fs__namespace.writeFileSync(inputFile, JSON.stringify(input));
  return new Promise((resolve, reject) => {
    const child = child_process.spawn(process.execPath, [...entry.args, inputFile], {
      env: { ...process.env, ...entry.env },
      stdio: ["ignore", "pipe", "inherit"],
      detached: POSIX,
      windowsHide: true
    });
    children.add(child);
    let out2 = "";
    child.stdout.on("data", (d) => out2 += d);
    child.on("error", (e) => {
      children.delete(child);
      fs__namespace.rmSync(inputFile, { force: true });
      reject(new index.AgentError("INTERNAL", `Could not start the renderer for [${lang2}]: ${e.message}`));
    });
    child.on("close", (code, signal) => {
      children.delete(child);
      fs__namespace.rmSync(inputFile, { force: true });
      const line = out2.trim().split("\n").pop() ?? "";
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        msg = void 0;
      }
      if (msg?.ok && msg.result) return resolve(msg.result);
      if (msg?.error) {
        const e = msg.error;
        return reject(new index.AgentError(e.code, e.message, { hint: e.hint, where: e.where, details: e.details }));
      }
      reject(new index.AgentError("INTERNAL", `The renderer for [${lang2}] stopped without a result (${signal ?? `exit ${code}`})`, {
        hint: "Re-run the command. Set NARASCREEN_PARALLEL_LANGS=1 to render languages one after another."
      }));
    });
  });
}
function childEntry() {
  const bundled = path__namespace.join(__dirname, "produce-child.cjs");
  if (fs__namespace.existsSync(bundled)) return { args: [bundled], env: {} };
  const editorDir = path__namespace.resolve(__dirname, "..");
  const loader = url.pathToFileURL(path__namespace.join(editorDir, "node_modules", "tsx", "dist", "loader.mjs")).href;
  return {
    args: ["--import", loader, path__namespace.join(__dirname, "produce-child.ts")],
    env: { TSX_TSCONFIG_PATH: path__namespace.join(editorDir, "api", "tsconfig.json") }
  };
}
async function runLimited(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      try {
        results[i] = { status: "fulfilled", value: await fn(items[i]) };
      } catch (e) {
        results[i] = { status: "rejected", reason: e };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
const produceParallel = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  parallelLanguages,
  produceLanguageInChild,
  runLimited,
  stopRenderChildren
}, Symbol.toStringTag, { value: "Module" }));
const EDITOR_DIR = path__namespace.resolve(__dirname, "..");
const BUNDLED = isBundled(__dirname);
const BIN_PATH = BUNDLED ? path__namespace.join(__dirname, "narascreen.cjs") : path__namespace.join(EDITOR_DIR, "bin", "narascreen");
const OUT_ROOT = "narascreen-out";
const realStdoutWrite = process.stdout.write.bind(process.stdout);
let stdoutOpen = false;
function guardStdout() {
  process.stdout.write = function(chunk, encodingOrCb, cb) {
    if (stdoutOpen) return realStdoutWrite(chunk, encodingOrCb, cb);
    const text = typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf-8");
    if (text.trim()) index.emitEvent({ type: "log", message: text.replace(/\s+$/, "") });
    const done = typeof encodingOrCb === "function" ? encodingOrCb : cb;
    if (typeof done === "function") process.nextTick(done);
    return true;
  };
}
guardStdout();
const earlyFlagError = applyGlobalFlagsEarly(process.argv.slice(2));
const { loadScript, scriptSummary, validateScript } = __narascreen_req0;
const { initScript } = __narascreen_req1;
let finished = false;
let currentCommand = "narascreen";
let server;
function finish(env, exit = "natural") {
  if (finished) return;
  finished = true;
  env.warnings = [...new Set(env.warnings)];
  stdoutOpen = true;
  let code;
  try {
    code = index.emit(env);
  } finally {
    stdoutOpen = false;
  }
  scheduleExit(code, exit);
}
function finishRaw(text) {
  if (finished) return;
  finished = true;
  stdoutOpen = true;
  try {
    process.stdout.write(text.endsWith("\n") ? text : text + "\n");
  } finally {
    stdoutOpen = false;
  }
  scheduleExit(0, "natural");
}
function scheduleExit(code, exit) {
  process.exitCode = code;
  if (exit === "stay") return;
  const t = setTimeout(() => process.exit(code), exit === "now" ? 50 : 2e3);
  if (exit === "natural") t.unref();
}
function crash(err) {
  releaseLocks();
  if (!finished) {
    finish(index.failure(currentCommand, err), "now");
    return;
  }
  const e = index.toAgentError(err);
  process.stderr.write(`[narascreen] fatal: ${e.code}: ${e.message}
`);
  process.exit(4);
}
function onSignal(sig) {
  if (server) {
    const s = server;
    server = void 0;
    index.emitEvent({ type: "log", message: `${sig} received — stopping the server` });
    setTimeout(() => process.exit(0), 5e3).unref();
    s.close().then(
      () => process.exit(0),
      () => process.exit(0)
    );
    return;
  }
  stopRenderChildren(sig);
  if (finished) process.exit(process.exitCode ?? 1);
  releaseLocks();
  finish(
    index.failure(
      currentCommand,
      new index.AgentError("INTERNAL", `Interrupted by ${sig} before "${currentCommand}" finished`, {
        hint: "Re-run the command. Finished work (a successful recording, cached narration audio) is reused.",
        details: { signal: sig }
      })
    ),
    "now"
  );
}
async function main(argv) {
  process.stdout.on("error", (e) => {
    if (e.code === "EPIPE") process.exit(process.exitCode ?? 0);
  });
  process.on("uncaughtException", crash);
  process.on("unhandledRejection", crash);
  for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => onSignal(sig));
  let inv;
  try {
    if (earlyFlagError) throw earlyFlagError;
    inv = parseCommandLine(argv);
  } catch (e) {
    const cmd = guessCommandName(argv);
    finish(index.failure(cmd, e, { next: [helpFor(cmd)] }));
    return;
  }
  currentCommand = inv.name;
  const ctx = { cmd: inv.cmd, arg: inv.arg, flags: inv.flags, cwd: process.cwd(), warnings: [], known: {} };
  try {
    const handler = HANDLERS[inv.cmd.name];
    if (!handler) throw new Error(`No handler for command "${inv.cmd.name}"`);
    const out2 = await handler(ctx);
    if (out2.raw != null) {
      finishRaw(out2.raw);
      return;
    }
    finish(index.success(inv.name, out2.result, { warnings: ctx.warnings, next: out2.next ?? [] }), out2.stay ? "stay" : "natural");
  } catch (e) {
    const err = index.toAgentError(e);
    finish(index.failure(inv.name, err, { warnings: ctx.warnings, next: failureNext(ctx, err) }));
  }
}
const HELP_CMD = findCommand("help");
const VERSION_CMD = { name: "version", usage: "narascreen --version", summary: "Print the version.", flags: [], output: "{ version }", heavy: false };
function applyGlobalFlagsEarly(argv) {
  if (argv.includes("--quiet")) index.setQuiet(true);
  const i = argv.findIndex((a) => a === "--events" || a.startsWith("--events="));
  if (i < 0) return void 0;
  const value = argv[i].includes("=") ? argv[i].slice("--events=".length) : argv[i + 1];
  if (value === "json" || value === "text") {
    index.setEventMode(value);
    return void 0;
  }
  return new index.AgentError("USAGE", `--events must be "text" or "json", got ${value == null ? "nothing" : `"${value}"`}`, {
    hint: "Use --events json for one JSON event per stderr line (for programs), or omit it for text."
  });
}
function splitCommand(argv) {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--") break;
    if (a === "--events") {
      i++;
      continue;
    }
    if (a.startsWith("-")) continue;
    return { name: a, rest: [...argv.slice(0, i), ...argv.slice(i + 1)] };
  }
  return { rest: argv };
}
function guessCommandName(argv) {
  return splitCommand(argv).name ?? "narascreen";
}
function parseCommandLine(argv) {
  const { name, rest } = splitCommand(argv);
  if (!name) {
    const flags2 = parseFlags(HELP_CMD, rest, 0).flags;
    if (flags2.version) return { name: "version", cmd: VERSION_CMD, flags: flags2 };
    return { name: "help", cmd: HELP_CMD, flags: flags2 };
  }
  const cmd = findCommand(name);
  if (!cmd) {
    const names = COMMANDS.map((c) => c.name);
    const guess = didYouMean(name, names);
    throw new index.AgentError("USAGE", `Unknown command "${name}"`, {
      hint: `${guess ? `Did you mean "${guess}"? ` : ""}Commands: ${names.join(", ")}. Run \`narascreen help\`.`,
      details: { command: name, commands: names }
    });
  }
  const maxPositionals = cmd.name === "help" ? 1 : cmd.arg ? 1 : 0;
  const { flags, positionals } = parseFlags(cmd, rest, maxPositionals);
  if (flags.version) return { name: "version", cmd: VERSION_CMD, flags };
  if (flags.help) return { name: "help", cmd: HELP_CMD, arg: cmd.name === "help" ? positionals[0] : cmd.name, flags };
  if (cmd.arg?.required && positionals.length === 0) {
    throw new index.AgentError("USAGE", `"${cmd.name}" needs <${cmd.arg.name}> — ${cmd.arg.desc}`, {
      hint: `Usage: ${cmd.usage}`,
      details: { usage: cmd.usage }
    });
  }
  return { name: cmd.name, cmd, arg: positionals[0], flags };
}
function parseFlags(cmd, args, maxPositionals) {
  const options = {};
  for (const f of [...GLOBAL_FLAGS, ...cmd.flags]) options[f.name] = { type: f.type };
  options.help = { type: "boolean", short: "h" };
  let parsed;
  try {
    parsed = util.parseArgs({ args, options, allowPositionals: true, strict: true });
  } catch (e) {
    throw usageFromParseError(cmd, e);
  }
  if (parsed.positionals.length > maxPositionals) {
    const extra = parsed.positionals.slice(maxPositionals);
    throw new index.AgentError("USAGE", `Unexpected argument${extra.length > 1 ? "s" : ""} for "${cmd.name}": ${extra.join(" ")}`, {
      hint: `Usage: ${cmd.usage}`,
      details: { usage: cmd.usage, unexpected: extra }
    });
  }
  return { flags: parsed.values, positionals: parsed.positionals };
}
function usageFromParseError(cmd, e) {
  const msg = e instanceof Error ? e.message : String(e);
  const known = [...cmd.flags, ...GLOBAL_FLAGS].map((f) => `--${f.name}`);
  const unknown = /Unknown option '([^']+)'/.exec(msg)?.[1];
  if (unknown) {
    const guess = didYouMean(unknown.replace(/=.*$/, ""), known);
    return new index.AgentError("USAGE", `Unknown flag ${unknown} for "${cmd.name}"`, {
      hint: `${guess ? `Did you mean ${guess}? ` : ""}Usage: ${cmd.usage}`,
      details: { usage: cmd.usage, flags: cmd.flags.map((f) => f.flag) }
    });
  }
  const flag = /Option '(-[\w-]+|--[\w-]+)/.exec(msg)?.[1] ?? "";
  const message = /argument missing/.test(msg) ? `${flag} needs a value` : /does not take an argument/.test(msg) ? `${flag} is a switch and takes no value` : /ambiguous/.test(msg) ? `${flag} got a value that starts with "-"; write it as ${flag}=<value>` : msg.split(". ")[0];
  return new index.AgentError("USAGE", message, { hint: `Usage: ${cmd.usage}`, details: { usage: cmd.usage } });
}
function helpFor(name) {
  return name !== "help" && findCommand(name) ? cli("help", name) : cli("help");
}
const str = (ctx, name) => {
  const v = ctx.flags[name];
  return typeof v === "string" ? v : void 0;
};
const bool = (ctx, name) => ctx.flags[name] === true;
const abs = (ctx, p) => path__namespace.resolve(ctx.cwd, p);
function requireFlag(ctx, name) {
  const v = str(ctx, name);
  if (v == null || v === "") {
    throw new index.AgentError("USAGE", `"${ctx.cmd.name}" needs --${name}`, {
      hint: `Usage: ${ctx.cmd.usage}`,
      details: { usage: ctx.cmd.usage }
    });
  }
  return v;
}
function usage(ctx, message, hint) {
  return new index.AgentError("USAGE", message, { hint: hint ?? `Usage: ${ctx.cmd.usage}`, details: { usage: ctx.cmd.usage } });
}
function defaultOut(ctx, scriptPath) {
  const base = path__namespace.basename(scriptPath).replace(/\.demo-script\.json$|\.json$/i, "") || "demo";
  return WORKSPACE ? path__namespace.join(WORKSPACE, "jobs", base) : path__namespace.resolve(ctx.cwd, OUT_ROOT, base);
}
function outDir(ctx, loaded) {
  const o = str(ctx, "out");
  return o ? abs(ctx, o) : defaultOut(ctx, loaded.path);
}
function loadForCommand(ctx, file) {
  const p = abs(ctx, file);
  ctx.known.script = p;
  index.stage("validate", `Validating ${p}`);
  const loaded = loadScript(p);
  rememberScript(ctx, loaded.script);
  ctx.warnings.push(...loaded.warnings);
  return loaded;
}
function rememberScript(ctx, script) {
  ctx.known.stepIds = script.steps.map((s) => s.id);
  ctx.known.baseUrl = script.baseUrl;
}
function suggestLang(word, codes) {
  const byName = codes.find((c) => (index.LANG_LABELS[c] ?? "").toLowerCase() === word.toLowerCase());
  return byName ?? didYouMean(word, codes);
}
function parseLangs(ctx, script) {
  const flag = str(ctx, "lang");
  const list = flag != null ? flag.split(",").map((s) => s.trim()).filter(Boolean) : script.languages ?? ["en"];
  if (!list.length) throw usage(ctx, "--lang is empty", "Pass language codes like --lang en or --lang en,hi.");
  for (const l of list) {
    if (!index.TTS_LANGUAGES.includes(l)) {
      const guess = suggestLang(l, index.TTS_LANGUAGES);
      throw usage(ctx, `Unknown language "${l}" in --lang`, `${guess ? `Did you mean "${guess}"? ` : ""}Supported: ${index.TTS_LANGUAGES.join(", ")}.`);
    }
  }
  return [...new Set(list)];
}
function parseOutputFlags(ctx) {
  const out2 = {};
  const r = str(ctx, "resolution");
  if (r != null) {
    const names = ["native", ...Object.keys(index.RESOLUTIONS)];
    if (!names.includes(r)) {
      const guess = didYouMean(r, names);
      throw usage(ctx, `--resolution must be one of ${names.join(", ")}, got "${r}"`, guess ? `Did you mean "${guess}"?` : void 0);
    }
    out2.resolution = r;
  }
  const q2 = str(ctx, "quality");
  if (q2 != null) {
    const levels = Object.keys(index.QUALITY_CRF);
    if (!levels.includes(q2)) {
      const guess = didYouMean(q2, levels);
      throw usage(ctx, `--quality must be one of ${levels.join(", ")}, got "${q2}"`, guess ? `Did you mean "${guess}"?` : void 0);
    }
    out2.quality = q2;
  }
  return out2;
}
function parseIntFlag(ctx, name, def, min, max) {
  const v = str(ctx, name);
  if (v == null) return def;
  if (!/^\d+$/.test(v.trim()) || Number(v) < min || Number(v) > max) {
    throw usage(ctx, `--${name} must be a whole number from ${min} to ${max}, got "${v}"`);
  }
  return Number(v);
}
function parseViewport(ctx, v) {
  if (v == null) return void 0;
  const m = /^(\d+)\s*[x×]\s*(\d+)$/i.exec(v.trim());
  const w = Number(m?.[1]);
  const h = Number(m?.[2]);
  if (!m || w < 320 || w > 3840 || h < 240 || h > 2160) {
    throw usage(ctx, `--viewport must look like 1440x900 (width 320–3840, height 240–2160), got "${v}"`);
  }
  return { width: w, height: h };
}
function stamp(d = /* @__PURE__ */ new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}
const nowIso = () => (/* @__PURE__ */ new Date()).toISOString();
const PROG = resolveProgName();
function resolveProgName() {
  if (BUNDLED) {
    const run = `${q(process.execPath)} ${q(BIN_PATH)}`;
    if (!process.versions.electron) return run;
    return process.platform === "win32" ? `set ELECTRON_RUN_AS_NODE=1&& ${run}` : `ELECTRON_RUN_AS_NODE=1 ${run}`;
  }
  const real = safeRealpath(BIN_PATH);
  if (real) {
    for (const dir of (process.env.PATH ?? "").split(path__namespace.delimiter)) {
      if (dir && safeRealpath(path__namespace.join(dir, "narascreen")) === real) return "narascreen";
    }
  }
  return process.platform === "win32" ? `node ${q(BIN_PATH)}` : q(BIN_PATH);
}
function safeRealpath(p) {
  try {
    return fs__namespace.realpathSync(p);
  } catch {
    return void 0;
  }
}
const HTTP_CALLER = process.env.NARASCREEN_CALLER === "http";
const WORKSPACE = process.env.NARASCREEN_WORKSPACE ? path__namespace.resolve(process.env.NARASCREEN_WORKSPACE) : void 0;
function jobRef(dir) {
  if (!WORKSPACE) return dir;
  const rel = path__namespace.relative(path__namespace.join(WORKSPACE, "jobs"), dir);
  return rel && !rel.startsWith("..") && !path__namespace.isAbsolute(rel) && !rel.includes(path__namespace.sep) ? rel : dir;
}
function httpHint(args) {
  const [command, ...rest] = args;
  const doc = findCommand(command);
  const body = { command };
  const options = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a.startsWith("--")) {
      const name = a.slice(2);
      const type = doc?.flags.find((f) => f.name === name)?.type;
      options[name] = type === "string" ? rest[++i] : true;
    } else if (doc?.arg?.name === "job") body.job = jobRef(path__namespace.resolve(a));
    else if (doc?.arg?.name === "script") body.scriptPath = a;
    else body.arg = a;
  }
  if (typeof options.out === "string" && ["check", "record", "make"].includes(command)) {
    body.job = jobRef(options.out);
    delete options.out;
  }
  switch (command) {
    case "help":
    case "manual":
      return "GET /docs.md";
    case "doctor":
      return "GET /v1/doctor";
    case "voices":
      return "GET /v1/voices";
    case "validate":
      return `POST /v1/validate ${JSON.stringify({ scriptPath: body.scriptPath })}`;
  }
  if (Object.keys(options).length) body.options = options;
  return `POST /v1/runs ${JSON.stringify(body)}`;
}
function q(s) {
  if (/^[\w@%+=:,./-]+$/.test(s)) return s;
  if (process.platform === "win32") return `"${s.replace(/"/g, '\\"')}"`;
  return `'${s.replace(/'/g, `'\\''`)}'`;
}
function cli(...args) {
  if (HTTP_CALLER) return httpHint(args);
  return [PROG, ...args.map(q)].join(" ");
}
function openCmd(file) {
  if (HTTP_CALLER) return `GET /v1/files?path=${encodeURIComponent(file)}`;
  const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? 'start ""' : "xdg-open";
  return `${opener} ${q(file)}`;
}
function failureNext(ctx, e) {
  const { script: s, job: j } = ctx.known;
  const scriptCmd = ctx.cmd.arg?.name === "script" ? ctx.cmd.name : "make";
  switch (e.code) {
    case "USAGE":
      return [helpFor(ctx.cmd.name)];
    case "ENVIRONMENT_NOT_READY": {
      const checks = e.details?.checks ?? [];
      const fixes = checks.filter((c) => !c.ok && c.required && c.fix).map((c) => c.fix);
      return [...new Set(fixes), cli("doctor", ...s ? ["--script", s] : [])];
    }
    case "TTS_UNAVAILABLE":
    case "FFMPEG_MISSING":
    case "BROWSER_MISSING":
      return [cli("doctor", ...s ? ["--script", s] : [])];
    case "SCRIPT_NOT_FOUND":
      return [cli("help", "init")];
    case "SCRIPT_INVALID":
    case "SCRIPT_INVALID_JSON":
    case "ENV_VAR_MISSING":
    case "STORAGE_STATE_NOT_FOUND":
      return s ? [cli("validate", s)] : [];
    case "SELECTOR_NOT_FOUND":
    case "TARGET_NOT_VISIBLE":
    case "WAIT_TIMEOUT":
    case "ACTION_FAILED":
    case "NAVIGATION_FAILED":
      return browserFailureNext(ctx, e);
    case "BEAT_NOT_FOUND":
      return s ? [cli("validate", s)] : [];
    case "JOB_NOT_FOUND":
    case "JOB_NOT_RECORDED":
    case "SCRIPT_STRUCTURE_CHANGED":
      return s && j ? [cli("make", s, "--out", j)] : [];
    case "JOB_EXISTS":
      return s && j ? [cli(scriptCmd, s, "--out", j, "--force")] : [];
    case "JOB_LOCKED":
      return j ? [cli("status", j)] : [];
    case "VIDEO_NOT_FOUND":
      return j ? [cli("produce", j)] : [];
    case "TTS_FAILED":
      return [cli("voices")];
    case "SPOTLIGHT_OVERLAP":
    case "COMPILE_FAILED":
      return s && j ? [cli("produce", j, "--script", s)] : [];
    default:
      return [];
  }
}
function browserFailureNext(ctx, e) {
  const { script: s, stepIds = [] } = ctx.known;
  const pageUrl = typeof e.details?.url === "string" && /^https?:/.test(e.details.url) ? e.details.url : void 0;
  if (!s) return pageUrl ? [cli("inspect", "--url", pageUrl)] : [];
  const out2 = [];
  const idx = e.where?.step ? stepIds.indexOf(e.where.step) : -1;
  if (e.where?.path?.startsWith("setup")) {
    const u = pageUrl ?? ctx.known.baseUrl;
    if (u) out2.push(cli("inspect", "--url", u));
  } else if (idx > 0) {
    out2.push(cli("inspect", "--script", s, "--until", stepIds[idx - 1]));
  } else {
    out2.push(cli("inspect", "--script", s, ...pageUrl ? ["--url", pageUrl] : []));
  }
  out2.push(cli("check", s));
  return out2;
}
const JOB_ENTRY = /^(job\.json|script\.json|trace\.jsonl|recordings|recordings-check|thumbnails|audio|video|preview|failures|logs|\.lock|demo-project(\.[\w-]+)?\.json|job\.json\.tmp-\d+)$/;
function assertUsableJobDir(ctx, dir) {
  if (!fs__namespace.existsSync(dir)) return;
  if (!fs__namespace.statSync(dir).isDirectory()) throw usage(ctx, `--out ${dir} is a file, not a folder`, "Pass a folder path for the job (it will be created).");
  if (index.jobExists(dir)) return;
  const stray = fs__namespace.readdirSync(dir).filter((n) => !JOB_ENTRY.test(n));
  if (stray.length) {
    throw new index.AgentError("USAGE", `${dir} is not empty and is not a NaraScreen job`, {
      hint: "Pass a new or empty folder as --out: NaraScreen owns the job folder and replaces files in it.",
      details: { dir, entries: stray.slice(0, 10) }
    });
  }
}
async function recordJob(ctx, loaded, dir, opts) {
  const job = index.createJob(dir, loaded, { force: opts.force });
  const p = index.jobPaths(dir);
  try {
    const { recording, durationSec, trace } = loaded.script.source ? await importVideo(loaded.script, p.recording) : await recordBrowser(ctx, loaded.script, p, opts.headed);
    index.writeTrace(p.trace, trace);
    const thumbnails = { dir: p.thumbnailsDir, count: await makeThumbnails(ctx, p.root) };
    job.record = { status: "done", at: nowIso(), recordingPath: recording, tracePath: p.trace, durationSec, slots: trace.length };
    index.writeJob(dir, job);
    return { job: p.root, recording, durationSec, slots: trace.length, thumbnails };
  } catch (e) {
    const failed = { status: "failed", at: nowIso(), error: index.toAgentError(e).toJSON(), recordingPath: p.recording, tracePath: p.trace, durationSec: 0, slots: 0 };
    job.record = failed;
    try {
      index.writeJob(dir, job);
    } catch {
    }
    throw e;
  }
}
async function recordBrowser(ctx, script, p, headed2) {
  const { run } = await Promise.resolve().then(() => require("./runner-C-0LtWCn.cjs"));
  const res = await run(script, p.recordingsDir, { headed: headed2, failuresDir: p.failuresDir, log: index.log });
  ctx.warnings.push(...res.warnings);
  const recording = res.recordingPath ?? p.recording;
  if (!fs__namespace.existsSync(recording)) {
    throw new index.AgentError("RECORDING_FAILED", `The browser run finished but no recording was written at ${recording}`, {
      hint: "Retry once. If it repeats, run `narascreen check` to confirm the steps work, then record again."
    });
  }
  return { recording, durationSec: res.durationSec, trace: res.trace };
}
async function importVideo(script, dest) {
  index.stage("record", `Importing ${script.source.video}`);
  const { importSourceVideo, timelineTrace } = await Promise.resolve().then(() => require("./video-source-BYOWIvHU.cjs"));
  const imp = importSourceVideo(script.source.video, dest, index.log);
  return { recording: imp.recordingPath, durationSec: imp.durationSec, trace: timelineTrace(script, imp.durationSec) };
}
async function traceForProduce(dir, script) {
  const p = index.jobPaths(dir);
  if (!script.source) return index.readTrace(p.trace);
  const { timelineTrace } = await Promise.resolve().then(() => require("./video-source-BYOWIvHU.cjs"));
  const job = loadJob(dir);
  const trace = timelineTrace(script, job.record?.durationSec ?? 0);
  index.writeTrace(p.trace, trace);
  if (job.record && job.record.slots !== trace.length) {
    job.record.slots = trace.length;
    index.writeJob(dir, job);
  }
  return trace;
}
async function makeThumbnails(ctx, root) {
  try {
    const { generateFilmstrip } = await Promise.resolve().then(() => require("./job-W-Szny1w.cjs")).then((n) => n.ffmpeg);
    return generateFilmstrip(root);
  } catch (e) {
    const msg = `thumbnails: ${e instanceof Error ? e.message : String(e)} (only the desktop editor's filmstrip is affected)`;
    index.warn(msg);
    ctx.warnings.push(msg);
    return 0;
  }
}
async function produceJob(ctx, dir, script, langs, output) {
  const p = index.jobPaths(dir);
  const trace = await traceForProduce(dir, script);
  const { produceLanguage } = await Promise.resolve().then(() => require("./produce-headless-BjFCgFo3.cjs"));
  const { makePreview } = await Promise.resolve().then(() => require("./preview-CkwlEEda.cjs"));
  const videos = [];
  const done = (lang2, r) => {
    ctx.warnings.push(...r.warnings);
    const previewDir = path__namespace.join(p.previewDir, lang2);
    let preview = null;
    try {
      index.stage("preview", `Making preview frames [${lang2}]`);
      const pv = makePreview(r.videoPath, previewDir);
      preview = { contactSheet: pv.contactSheet, frames: pv.frames };
    } catch (e) {
      const msg = `preview [${lang2}]: ${index.toAgentError(e).message}`;
      index.warn(msg);
      ctx.warnings.push(msg);
    }
    const state = loadJob(dir);
    state.produce[lang2] = { status: "done", at: nowIso(), videoPath: r.videoPath, durationSec: r.durationSec, previewDir };
    index.writeJob(dir, state);
    return {
      lang: lang2,
      path: r.videoPath,
      durationSec: r.durationSec,
      ...r.width && r.height ? { width: r.width, height: r.height } : {},
      narrations: r.narrations,
      ...r.cards ? { cards: r.cards } : {},
      timings: r.timings,
      preview
    };
  };
  const failed = (lang2, e) => {
    const err = index.toAgentError(e);
    try {
      const state = loadJob(dir);
      state.produce[lang2] = { status: "failed", at: nowIso(), error: err.toJSON() };
      index.writeJob(dir, state);
    } catch {
    }
    return err;
  };
  const report = (lang2, err) => !videos.length ? err : new index.AgentError(err.code, `[${lang2}] ${err.message}`, {
    hint: err.hint,
    where: err.where,
    details: {
      ...err.details,
      failedLang: lang2,
      videos: videos.map((v) => ({ lang: v.lang, path: v.path, durationSec: v.durationSec, preview: v.preview }))
    }
  });
  const parallel = Math.min(parallelLanguages(), langs.length);
  if (parallel > 1 || process.env.NARASCREEN_RENDER_CHILD === "1") {
    if (parallel > 1) index.log(`Rendering ${langs.join(", ")} in parallel (${parallel} at a time)`);
    const { produceLanguageInChild: produceLanguageInChild2, runLimited: runLimited2 } = await Promise.resolve().then(() => produceParallel);
    const settled = await runLimited2(langs, parallel, async (lang2) => done(lang2, await produceLanguageInChild2(p.root, script, trace, lang2, { ...output, sessionProject: false })));
    const failures = [];
    settled.forEach((s, i) => s.status === "fulfilled" ? videos.push(s.value) : failures.push({ lang: langs[i], err: failed(langs[i], s.reason) }));
    const last = [...videos].reverse()[0];
    if (last) fs__namespace.copyFileSync(path__namespace.join(p.root, `demo-project.${last.lang}.json`), path__namespace.join(p.root, "demo-project.json"));
    if (failures.length) throw report(failures[0].lang, failures[0].err);
    return videos;
  }
  for (const lang2 of langs) {
    try {
      videos.push(done(lang2, await produceLanguage(p.root, script, trace, lang2, index.log, output)));
    } catch (e) {
      throw report(lang2, failed(lang2, e));
    }
  }
  return videos;
}
function loadJob(dir) {
  try {
    return index.readJob(dir);
  } catch (e) {
    if (e instanceof index.AgentError) throw e;
    const file = index.jobPaths(dir).jobJson;
    throw new index.AgentError("JOB_NOT_FOUND", `The job file ${file} is unreadable: ${e instanceof Error ? e.message : String(e)}`, {
      hint: "The job folder is damaged. Re-record into a new --out (or delete this folder and run make again).",
      details: { jobJson: file }
    });
  }
}
function assertRecorded(job, dir) {
  const p = index.jobPaths(dir);
  if (job.record?.status !== "done") {
    throw new index.AgentError("JOB_NOT_RECORDED", `Job ${p.root} has no successful recording${job.record ? " (the last one failed)" : ""}`, {
      hint: "Record it first: `narascreen make <script> --out <job>` (records, then produces).",
      details: job.record?.error ? { lastError: job.record.error } : void 0
    });
  }
  const recording = job.record.recordingPath || p.recording;
  if (!fs__namespace.existsSync(recording) || !fs__namespace.existsSync(p.trace)) {
    throw new index.AgentError("JOB_NOT_RECORDED", `Job ${p.root} is missing its recording or trace`, {
      hint: "Re-record: `narascreen make <script> --out <job> --force`.",
      details: { recording, trace: p.trace }
    });
  }
}
function scriptForJob(ctx, job, dir) {
  const flag = str(ctx, "script");
  const file = flag ? abs(ctx, flag) : job.scriptPath;
  ctx.known.script = file;
  if (flag || fs__namespace.existsSync(file)) {
    index.stage("validate", `Validating ${file}`);
    const loaded = loadScript(file);
    ctx.warnings.push(...loaded.warnings);
    rememberScript(ctx, loaded.script);
    return { script: loaded.script, scriptPath: loaded.path };
  }
  const saved = index.jobPaths(dir).script;
  if (!fs__namespace.existsSync(saved)) {
    throw new index.AgentError("SCRIPT_NOT_FOUND", `The job's script ${file} no longer exists (and the job has no saved copy)`, {
      hint: "Pass the script explicitly: --script <file>."
    });
  }
  const raw = JSON.parse(fs__namespace.readFileSync(saved, "utf-8"));
  const { script, warnings } = validateScript(raw, { dir: path__namespace.dirname(job.scriptPath) });
  ctx.warnings.push(
    ...warnings,
    `The script file ${file} no longer exists; used the copy saved at record time (${saved}). Pass --script to use another file.`
  );
  rememberScript(ctx, script);
  return { script, scriptPath: file };
}
function afterProduceNext(jobDir, scriptPath, videos) {
  const next = [];
  const first = videos[0];
  if (first?.preview) next.push(openCmd(first.preview.contactSheet));
  if (first) next.push(openCmd(first.path));
  if (first) next.push(cli("preview", jobDir, "--lang", first.lang, "--tiles", "24"));
  next.push(cli("make", scriptPath, "--out", jobDir));
  return next;
}
const HANDLERS = {
  async help(ctx) {
    if (ctx.arg) {
      const topic = findCommand(ctx.arg);
      if (!topic) {
        const guess = didYouMean(ctx.arg, COMMANDS.map((c) => c.name));
        throw usage(ctx, `Unknown command "${ctx.arg}"`, `${guess ? `Did you mean "${guess}"? ` : ""}Run \`narascreen help\` for the list.`);
      }
      return { result: { usage: topic.usage, command: topic, globalFlags: GLOBAL_FLAGS } };
    }
    return {
      result: {
        usage: "narascreen <command> [<arg>] [--flags] — one JSON envelope on stdout; progress on stderr",
        commands: COMMANDS.map((c) => ({ name: c.name, usage: c.usage, summary: c.summary })),
        globalFlags: GLOBAL_FLAGS.map((f) => ({ flag: f.flag, desc: f.desc })),
        docs: "run `narascreen manual`, or open /docs on `narascreen serve`"
      },
      next: [cli("doctor"), cli("manual")]
    };
  },
  async version() {
    return { result: { version: narascreenVersion(), node: process.versions.node } };
  },
  async manual() {
    const { buildManualMarkdown } = await Promise.resolve().then(() => require("./docs-BzNcI6qF.cjs")).then((n) => n.docs);
    return { raw: buildManualMarkdown() };
  },
  async docs(ctx) {
    const out2 = abs(ctx, requireFlag(ctx, "out"));
    const { buildManualMarkdown, renderDocsHtml } = await Promise.resolve().then(() => require("./docs-BzNcI6qF.cjs")).then((n) => n.docs);
    const html = renderDocsHtml(buildManualMarkdown());
    fs__namespace.mkdirSync(path__namespace.dirname(out2), { recursive: true });
    fs__namespace.writeFileSync(out2, html);
    return { result: { path: out2 }, next: [openCmd(out2)] };
  },
  async schema(ctx) {
    const json = JSON.stringify(index.demoScriptJsonSchema(), null, 2) + "\n";
    const o = str(ctx, "out");
    if (!o) return { raw: json };
    const out2 = abs(ctx, o);
    fs__namespace.mkdirSync(path__namespace.dirname(out2), { recursive: true });
    fs__namespace.writeFileSync(out2, json);
    return { result: { path: out2 } };
  },
  async doctor(ctx) {
    let script;
    const s = str(ctx, "script");
    if (s) {
      ctx.known.script = abs(ctx, s);
      script = loadScript(ctx.known.script).script;
    }
    const { runDoctor } = await Promise.resolve().then(() => require("./doctor-CDEqK4zt.cjs"));
    const report = await runDoctor({ script, outDir: WORKSPACE ?? path__namespace.resolve(ctx.cwd, OUT_ROOT) });
    for (const c of report.checks) {
      if (!c.ok && !c.required) ctx.warnings.push(`${c.id}: ${c.detail}${c.fix ? ` — fix: ${c.fix}` : ""}`);
    }
    if (!report.ready) {
      const failed = report.checks.filter((c) => !c.ok && c.required);
      throw new index.AgentError("ENVIRONMENT_NOT_READY", `Not ready: ${failed.map((c) => `${c.id} (${c.detail.split(" — ")[0]})`).join("; ")}`, {
        hint: "Run each failed check's `fix` (also listed in `next`), then run `narascreen doctor` again.",
        details: { checks: report.checks }
      });
    }
    return {
      result: report,
      next: ctx.known.script ? [cli("validate", ctx.known.script)] : [cli("manual")]
    };
  },
  async voices(ctx) {
    const only = str(ctx, "lang");
    const codes = Object.keys(index.LANG_CODES).filter((c) => index.DEFAULT_VOICES[c]?.length);
    if (only != null && !codes.includes(only)) {
      const guess = suggestLang(only, codes);
      throw usage(ctx, `Unknown language "${only}"`, `${guess ? `Did you mean "${guess}"? ` : ""}Supported: ${codes.join(", ")}.`);
    }
    const languages = (only ? [only] : codes).map((code) => ({
      code,
      label: index.LANG_LABELS[code] ?? code,
      defaultVoice: index.DEFAULT_VOICES[code][0],
      voices: index.DEFAULT_VOICES[code]
    }));
    return { result: { languages } };
  },
  async init(ctx) {
    const url2 = requireFlag(ctx, "url");
    const o = str(ctx, "out");
    const res = initScript({ url: url2, out: o ? abs(ctx, o) : void 0, name: str(ctx, "name"), force: bool(ctx, "force"), cwd: ctx.cwd });
    ctx.known.script = res.scriptPath;
    ctx.warnings.push(...res.warnings);
    return {
      result: { scriptPath: res.scriptPath, script: res.script },
      next: [cli("inspect", "--url", new URL(url2).href), cli("validate", res.scriptPath), cli("check", res.scriptPath)]
    };
  },
  async inspect(ctx) {
    const url2 = str(ctx, "url");
    const scriptFlag = str(ctx, "script");
    const until = str(ctx, "until");
    if (!url2 && !scriptFlag) throw usage(ctx, "inspect needs --url <page> or --script <file>");
    if (until && !scriptFlag) throw usage(ctx, "--until only works together with --script", "Add --script <file> so the steps before the page can run.");
    const viewport = parseViewport(ctx, str(ctx, "viewport"));
    let loaded;
    if (scriptFlag) {
      ctx.known.script = abs(ctx, scriptFlag);
      loaded = loadScript(ctx.known.script);
      if (loaded.script.source) {
        throw usage(
          ctx,
          `${loaded.path} edits an existing video — there is no page to inspect`,
          "Use `narascreen preview <job> --raw` to look at a video (frames with timestamps) and pick `at` times and `rect`s."
        );
      }
      ctx.warnings.push(...loaded.warnings);
      rememberScript(ctx, loaded.script);
      if (until && !loaded.script.steps.some((s) => s.id === until)) {
        const ids = loaded.script.steps.map((s) => s.id);
        const guess = didYouMean(until, ids);
        throw new index.AgentError("BEAT_NOT_FOUND", `No step with id "${until}" in ${loaded.path}`, {
          hint: `${guess ? `Did you mean "${guess}"? ` : ""}--until takes a step id from the script.`,
          details: { steps: ids }
        });
      }
    }
    if (url2 && !loaded && !/^https?:\/\//i.test(url2)) {
      throw usage(ctx, `--url must be an absolute http(s) URL (got "${url2}")`, "Pass the full address, or add --script so a path is resolved against its baseUrl.");
    }
    let storageState;
    const ss = str(ctx, "storage-state");
    if (ss) {
      storageState = abs(ctx, ss);
      if (!fs__namespace.existsSync(storageState)) {
        throw new index.AgentError("STORAGE_STATE_NOT_FOUND", `storageState file not found: ${storageState}`, {
          hint: "Pass a Playwright storageState JSON saved after logging in, or use --script with setup steps that log in."
        });
      }
    }
    const plugin = str(ctx, "plugin");
    const device = str(ctx, "device");
    if (plugin && plugin !== "flutter") throw usage(ctx, `Unknown --plugin "${plugin}"`, "Available: flutter.");
    if (device && plugin !== "flutter") throw usage(ctx, "--device needs --plugin flutter");
    if (device && !(device in index.FLUTTER_DEVICES)) {
      throw usage(ctx, `Unknown --device "${device}"`, `One of: ${Object.keys(index.FLUTTER_DEVICES).join(", ")} (a custom size goes in the script: plugins.flutter.device).`);
    }
    const plugins = plugin === "flutter" ? { flutter: { ...loaded?.script.plugins?.flutter, ...device ? { device } : {} } } : void 0;
    const o = str(ctx, "out");
    const out2 = o ? abs(ctx, o) : path__namespace.resolve(ctx.cwd, OUT_ROOT, "inspect", stamp());
    const { inspect } = await Promise.resolve().then(() => require("./inspect-DwK6oPE9.cjs"));
    const res = await inspect({
      url: url2,
      script: loaded?.script,
      untilStep: until,
      outDir: out2,
      viewport,
      storageState,
      plugins,
      headed: bool(ctx, "headed"),
      fullPage: bool(ctx, "full-page"),
      log: index.log
    });
    if (res.truncated) {
      ctx.warnings.push(`Element list truncated to ${res.elements.length} entries; the full accessibility tree is in ${res.ariaSnapshotPath}.`);
    }
    const next = loaded ? [cli("validate", loaded.path), cli("check", loaded.path)] : [cli("init", "--url", res.url || url2, "--out", path__namespace.resolve(ctx.cwd, `${hostName(res.url || url2)}.demo-script.json`))];
    return { result: res, next };
  },
  async validate(ctx) {
    const loaded = loadForCommand(ctx, ctx.arg);
    return {
      result: { valid: true, scriptPath: loaded.path, summary: scriptSummary(loaded.script) },
      next: [cli("check", loaded.path), cli("make", loaded.path, "--out", defaultOut(ctx, loaded.path))]
    };
  },
  async check(ctx) {
    const loaded = loadForCommand(ctx, ctx.arg);
    const out2 = outDir(ctx, loaded);
    ctx.known.job = out2;
    if (loaded.script.source) {
      const { probeDuration } = await Promise.resolve().then(() => require("./job-W-Szny1w.cjs")).then((n) => n.ffmpeg);
      const { timelineTrace } = await Promise.resolve().then(() => require("./video-source-BYOWIvHU.cjs"));
      const durationSec = probeDuration(loaded.script.source.video);
      const slots = timelineTrace(loaded.script, durationSec).length;
      return {
        result: { mode: "video", scriptPath: loaded.path, steps: loaded.script.steps.length, slots, durationSec },
        next: [cli("make", loaded.path, "--out", out2)]
      };
    }
    const hold = bool(ctx, "hold");
    const outExisted = fs__namespace.existsSync(out2);
    const scratch = path__namespace.join(out2, "recordings-check");
    const { run } = await Promise.resolve().then(() => require("./runner-C-0LtWCn.cjs"));
    let res;
    try {
      res = await run(loaded.script, scratch, {
        check: true,
        headed: bool(ctx, "headed") || hold,
        holdOpen: hold,
        failuresDir: index.jobPaths(out2).failuresDir,
        log: index.log
      });
    } finally {
      fs__namespace.rmSync(scratch, { recursive: true, force: true });
      if (!outExisted) removeIfEmpty(out2);
    }
    ctx.warnings.push(...res.warnings);
    return {
      result: { mode: "browser", scriptPath: loaded.path, steps: loaded.script.steps.length, slots: res.trace.length, durationSec: res.durationSec },
      next: [cli("make", loaded.path, "--out", out2)]
    };
  },
  async record(ctx) {
    const loaded = loadForCommand(ctx, ctx.arg);
    const out2 = outDir(ctx, loaded);
    ctx.known.job = out2;
    assertUsableJobDir(ctx, out2);
    const force2 = bool(ctx, "force");
    const res = await locked(out2, () => recordJob(ctx, loaded, out2, { headed: bool(ctx, "headed"), force: force2 }));
    return { result: res, next: [cli("produce", res.job)] };
  },
  async produce(ctx) {
    const output = parseOutputFlags(ctx);
    const dir = abs(ctx, ctx.arg);
    ctx.known.job = dir;
    const job = loadJob(dir);
    ctx.known.script = job.scriptPath;
    assertRecorded(job, dir);
    const { script, scriptPath } = scriptForJob(ctx, job, dir);
    index.assertSameStructure(job, script);
    const langs = parseLangs(ctx, script);
    const videos = await locked(dir, () => produceJob(ctx, dir, script, langs, output));
    const root = index.jobPaths(dir).root;
    return { result: { job: root, videos }, next: afterProduceNext(root, scriptPath, videos) };
  },
  async make(ctx) {
    const loaded = loadForCommand(ctx, ctx.arg);
    const out2 = outDir(ctx, loaded);
    ctx.known.job = out2;
    const langs = parseLangs(ctx, loaded.script);
    const output = parseOutputFlags(ctx);
    assertUsableJobDir(ctx, out2);
    const force2 = bool(ctx, "force");
    return locked(out2, async () => {
      const decision = decideRecording(out2, loaded, force2);
      if (decision.record) {
        if (decision.warning) {
          index.warn(decision.warning);
          ctx.warnings.push(decision.warning);
        } else if (decision.reason) {
          index.log(decision.reason);
        }
        await recordJob(ctx, loaded, out2, { headed: bool(ctx, "headed"), force: index.jobExists(out2) });
      } else {
        const job = loadJob(out2);
        const rec2 = job.record;
        const unchanged = loaded.script.source ? "source video unchanged" : "browser steps unchanged";
        index.log(`Reusing recording ${rec2.recordingPath} — ${unchanged} since ${rec2.at}`);
        job.scriptPath = loaded.path;
        job.scope = loaded.script.scope;
        index.writeJob(out2, job);
      }
      const videos = await produceJob(ctx, out2, loaded.script, langs, output);
      const rec = loadJob(out2).record;
      const recording = { path: rec.recordingPath, durationSec: rec.durationSec, slots: rec.slots };
      const root = index.jobPaths(out2).root;
      return {
        result: { job: root, recorded: decision.record, recording, videos },
        next: afterProduceNext(root, loaded.path, videos)
      };
    });
  },
  async preview(ctx) {
    let tiles = parseIntFlag(ctx, "tiles", 12, 1, 1e4);
    if (tiles > 48) {
      ctx.warnings.push(`--tiles ${tiles} is above the maximum; using 48.`);
      tiles = 48;
    }
    const raw = bool(ctx, "raw");
    if (raw && str(ctx, "lang") != null) {
      throw usage(ctx, "--raw previews the recording itself, so --lang does not apply", "Drop --lang (or drop --raw to preview a produced video).");
    }
    const dir = abs(ctx, ctx.arg);
    ctx.known.job = dir;
    const job = loadJob(dir);
    ctx.known.script = job.scriptPath;
    const p = index.jobPaths(dir);
    const { makePreview } = await Promise.resolve().then(() => require("./preview-CkwlEEda.cjs"));
    if (raw) {
      assertRecorded(job, dir);
      const recording = job.record.recordingPath || p.recording;
      index.stage("preview", "Making preview frames [raw recording]");
      const pv2 = await locked(dir, async () => makePreview(recording, path__namespace.join(p.previewDir, "raw"), { tiles }));
      return { result: { raw: true, ...pv2 }, next: [openCmd(pv2.contactSheet), cli("validate", job.scriptPath)] };
    }
    const produced = Object.keys(job.produce);
    const lang2 = str(ctx, "lang") ?? produced.find((l) => job.produce[l].status === "done") ?? produced[0];
    const video = lang2 ? path__namespace.join(p.videoDir, `final_${lang2}.mp4`) : void 0;
    if (!lang2 || !video || !fs__namespace.existsSync(video)) {
      throw new index.AgentError("VIDEO_NOT_FOUND", lang2 ? `No produced ${lang2} video in ${p.root}` : `No video has been produced in ${p.root} yet`, {
        hint: "Produce it first: `narascreen produce <job>` (add --lang for other languages).",
        details: { lang: lang2 ?? null, produced, expected: video ?? null }
      });
    }
    index.stage("preview", `Making preview frames [${lang2}]`);
    const pv = await locked(dir, async () => makePreview(video, path__namespace.join(p.previewDir, lang2), { tiles }));
    return { result: { lang: lang2, ...pv }, next: [openCmd(pv.contactSheet), openCmd(pv.video)] };
  },
  async status(ctx) {
    const dir = abs(ctx, ctx.arg);
    ctx.known.job = dir;
    const job = loadJob(dir);
    const p = index.jobPaths(dir);
    ctx.known.script = job.scriptPath;
    const lockPid = index.lockHolder(p.root);
    let scriptStructureChanged = null;
    try {
      scriptStructureChanged = index.structureHash(loadScript(job.scriptPath).script) !== job.structureHash;
    } catch {
    }
    const langs = /* @__PURE__ */ new Set([...Object.keys(job.produce), ...listDir(p.videoDir).flatMap((f) => /^final_(.+)\.mp4$/.exec(f)?.[1] ?? [])]);
    const artifacts = {
      script: fileInfo(p.script),
      recording: fileInfo(job.record?.recordingPath || p.recording),
      trace: fileInfo(p.trace),
      thumbnails: { dir: p.thumbnailsDir, count: listDir(p.thumbnailsDir).filter((f) => f.endsWith(".jpg")).length },
      project: fileInfo(path__namespace.join(p.root, "demo-project.json")),
      videos: [...langs].map((lang2) => ({ lang: lang2, ...fileInfo(path__namespace.join(p.videoDir, `final_${lang2}.mp4`)) })),
      previews: [...langs].map((lang2) => ({ lang: lang2, ...fileInfo(path__namespace.join(p.previewDir, lang2, "contact.jpg")) })),
      failures: listDir(p.failuresDir).filter((f) => f.endsWith(".png")).map((f) => path__namespace.join(p.failuresDir, f)),
      logs: listDir(p.logsDir).map((f) => path__namespace.join(p.logsDir, f))
    };
    const next = [];
    const recorded = job.record?.status === "done" && artifacts.recording.exists && artifacts.trace.exists;
    const video = artifacts.videos.find((v) => v.exists);
    if (lockPid) next.push(cli("status", p.root));
    else if (!recorded || scriptStructureChanged) next.push(cli("make", job.scriptPath, "--out", p.root));
    else if (!video) next.push(cli("produce", p.root));
    else next.push(openCmd(video.path), cli("preview", p.root, "--lang", video.lang), cli("make", job.scriptPath, "--out", p.root));
    return {
      result: {
        job: p.root,
        scope: job.scope,
        scriptPath: job.scriptPath,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
        busy: lockPid ? { pid: lockPid } : null,
        scriptStructureChanged,
        record: job.record ?? null,
        produce: job.produce,
        artifacts
      },
      next
    };
  },
  async serve(ctx) {
    const port = parseIntFlag(ctx, "port", 4790, 0, 65535);
    const concurrency = parseIntFlag(ctx, "concurrency", 1, 1, 64);
    const host = str(ctx, "host") ?? "127.0.0.1";
    const token = str(ctx, "token") ?? (process.env.NARASCREEN_TOKEN || void 0);
    const workspace = abs(ctx, str(ctx, "workspace") ?? OUT_ROOT);
    fs__namespace.mkdirSync(workspace, { recursive: true });
    const { startServer } = await Promise.resolve().then(() => require("./docs-BzNcI6qF.cjs")).then((n) => n.__narascreen_req0);
    const srv = await startServer({ port, host, token, workspace, concurrency, keepCache: bool(ctx, "keep-cache") });
    const c = srv.cleaned;
    if (c) {
      index.log(
        `Cleaned the workspace cache: ${c.runs} run record(s), ${c.inspect} inspect folder(s), narration/preview of ${c.jobs} job(s) — ${(c.bytes / 1024 / 1024).toFixed(1)} MB` + (c.skippedLocked.length ? `; skipped ${c.skippedLocked.length} job(s) in use` : "")
      );
    }
    server = srv;
    const next = [`curl -s ${q(`${srv.url}/docs.md`)}`];
    if (!token) next.unshift(`curl -s ${q(`${srv.url}/v1/health`)}`);
    return {
      result: { url: srv.url, docs: `${srv.url}/docs`, workspace, auth: token ? "bearer" : "none", ...c ? { cleaned: c } : {} },
      next,
      stay: true
    };
  }
};
function decideRecording(dir, loaded, force2) {
  if (!index.jobExists(dir)) return { record: true, reason: "New job — recording" };
  if (force2) return { record: true, reason: "--force — re-recording" };
  const job = loadJob(dir);
  try {
    assertRecorded(job, dir);
  } catch {
    return { record: true, reason: job.record?.status === "failed" ? "The previous recording failed — recording again" : "No usable recording yet — recording" };
  }
  try {
    index.assertSameStructure(job, loaded.script);
  } catch (e) {
    const d = e instanceof index.AgentError ? e.details : void 0;
    const parts = [
      d?.changedSteps.length ? `changed: ${d.changedSteps.join(", ")}` : "",
      d?.addedSteps.length ? `added: ${d.addedSteps.join(", ")}` : "",
      d?.removedSteps.length ? `removed: ${d.removedSteps.join(", ")}` : ""
    ].filter(Boolean);
    if (loaded.script.source) {
      return { record: true, warning: "The source video changed since it was imported — re-importing it." };
    }
    const what = parts.length ? `steps ${parts.join("; ")}` : "setup, defaults, baseUrl, viewport or session";
    return {
      record: true,
      warning: `Browser steps changed since the last recording (${what}) — re-recording. Text-only edits (narration, callout text, voices, durations) reuse the recording.`
    };
  }
  return { record: false };
}
const heldLocks = /* @__PURE__ */ new Set();
async function locked(dir, fn) {
  heldLocks.add(dir);
  try {
    return await index.withJobLock(dir, fn);
  } finally {
    heldLocks.delete(dir);
  }
}
function releaseLocks() {
  for (const dir of heldLocks) index.releaseOwnLock(dir);
}
function fileInfo(p) {
  try {
    return { path: p, exists: true, bytes: fs__namespace.statSync(p).size };
  } catch {
    return { path: p, exists: false };
  }
}
function listDir(dir) {
  try {
    return fs__namespace.readdirSync(dir).sort();
  } catch {
    return [];
  }
}
function removeIfEmpty(dir) {
  try {
    if (fs__namespace.readdirSync(dir).length === 0) fs__namespace.rmdirSync(dir);
  } catch {
  }
}
function hostName(url2) {
  try {
    return new URL(url2).hostname.replace(/^www\./, "") || "demo";
  } catch {
    return "demo";
  }
}
function didYouMean(word, options) {
  let best;
  let bestD = Infinity;
  for (const o of options) {
    const d = levenshtein(word.toLowerCase(), o.toLowerCase());
    if (d < bestD) {
      bestD = d;
      best = o;
    }
  }
  return best && bestD <= Math.max(2, Math.floor(word.length / 3)) ? best : void 0;
}
function levenshtein(a, b) {
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
void main(process.argv.slice(2));
exports.ARIA_ROLES = ARIA_ROLES;
exports.CANCEL_GRACE_MS = CANCEL_GRACE_MS;
exports.COMMANDS = COMMANDS;
exports.ENV_NAME_RE = ENV_NAME_RE;
exports.GLOBAL_FLAGS = GLOBAL_FLAGS;
exports.MAX_LINE = MAX_LINE;
exports.MAX_STDOUT = MAX_STDOUT;
exports.RESERVED_ENV_RE = RESERVED_ENV_RE;
exports.collectElements = collectElements;
exports.collectElementsDetailed = collectElementsDetailed;
exports.createLineSplitter = createLineSplitter;
exports.defaultCliEntry = defaultCliEntry;
exports.describeSelector = describeSelector;
exports.findCommand = findCommand;
exports.isAlive = isAlive;
exports.isBundled = isBundled;
exports.killTree = killTree;
exports.loadScript = loadScript$1;
exports.locate = locate;
exports.locateAll = locateAll;
exports.measureVisible = measureVisible;
exports.narascreenVersion = narascreenVersion;
exports.pageHeadings = pageHeadings;
exports.parseEnvelope = parseEnvelope;
exports.parseStderrLine = parseStderrLine;
exports.pickSelector = pickSelector;
exports.scopeLocator = scopeLocator;
exports.scriptSummary = scriptSummary$1;
exports.similarElements = similarElements;
exports.suggestRole = suggestRole;
exports.validateScript = validateScript$1;
