// ─── flutter plugin: record a Flutter web build as an Android phone ──
//
// - Emulates a phone (touch, mobile user agent, CSS size × pixel ratio). Flutter
//   picks its Android look from the user agent. The video is recorded at the
//   phone's real resolution (e.g. 1082×2402); trace boxes are scaled to match.
// - Flutter web draws on a canvas; its accessibility tree (invisible elements
//   with roles and labels over the widgets) is what selectors find. On a phone
//   Flutter only builds it after a tap in the exact centre of its "Enable
//   accessibility" placeholder (how TalkBack taps) — `ready` does that tap; the
//   engine swallows it, so the app never sees it.
// - After a Flutter text field gets focus, the engine swaps in its editing
//   state; the first key typed too early is lost, so typing waits a moment.
// - `swipe`: one-finger touch swipes (lists, carousels), optionally repeated
//   until an element is on screen.

import type { Locator, Page } from "playwright";
import type { ActEntry, DemoScript, FxEntry, Rect } from "../../schema";
import { AgentError } from "../../errors";
import type { NaraPlugin, PluginActApi, PluginPageApi } from "../index";
import { FlutterHealth, looksStuck, treeSummary } from "./health";
import { DEFAULT_FLUTTER_DEVICE, FLUTTER_DEVICES, type FlutterDevice, type FlutterPluginOptions } from "./schema";

const CHROME_VERSION = "140.0.0.0";

export function resolveDevice(opt: FlutterPluginOptions["device"]): FlutterDevice & { model: string } {
  if (opt && typeof opt === "object") return { ...opt, model: "Android Phone" };
  return FLUTTER_DEVICES[opt ?? DEFAULT_FLUTTER_DEVICE];
}

/** Video size for a device: CSS size × pixel ratio, rounded to even numbers (H.264). */
export function videoSizeOf(d: FlutterDevice): { width: number; height: number } {
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
  return { width: even(d.width * d.pixelRatio), height: even(d.height * d.pixelRatio) };
}

export function flutterPlugin(opts: FlutterPluginOptions, baseUrl?: string): NaraPlugin {
  const device = resolveDevice(opts.device);
  const css = { width: device.width, height: device.height };
  const video = videoSizeOf(device);
  const sx = video.width / css.width;
  const sy = video.height / css.height;
  const semantics = opts.semantics !== false;
  // Overlays are sized in video px; a phone video has pixelRatio× more px per
  // UI point, so text, arrows and blur grow by the same factor.
  const k = sx;
  const health = new FlutterHealth(hostOf(baseUrl), opts.allowedHosts);

  return {
    name: "flutter",
    browserViewport: css,
    contextOptions: {
      viewport: css,
      screen: css,
      deviceScaleFactor: device.pixelRatio,
      isMobile: true,
      hasTouch: true,
      userAgent: `Mozilla/5.0 (Linux; Android 14; ${device.model}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME_VERSION} Mobile Safari/537.36`,
    },
    touch: true,
    toVideo: ([x, y, w, h]: Rect): Rect => [Math.round(x * sx), Math.round(y * sy), Math.round(w * sx), Math.round(h * sy)],
    compileScript: (script) => scaleOverlays(script, k),
    adjustActions: (actions) => {
      for (const a of actions) if (a.type === "callout" && a.calloutStyle === "arrow") a.arrowScale = k;
    },
    preflight: (script) => checkFlutterBuild(script.baseUrl),
    attach: (context, page, warn) => health.attach(context, page, warn),
    ready: async (api) => {
      if (health.blocked.length) throw await health.blockedError(api);
      if (semantics) await enableSemantics(api, health);
    },
    finish: async (api) => {
      if (health.blocked.length) throw await health.blockedError(api);
    },
    explainFailure: (err, api) => explainFailure(err, api, health),
    inspectNotes: async (page) => {
      const t = await treeSummary(page);
      if (!looksStuck(t)) return [];
      return [
        `The Flutter app shows almost nothing to select (${t.labels.length ? `only ${t.labels.map((l) => `"${l}"`).join(", ")}` : "no labelled widgets"}, nothing interactive). ` +
          `If this is a splash/loading screen that never goes away, the app is probably awaiting a native-only plugin on web (path_provider, file cookie jars, secure storage, camera, GPS).`,
      ];
    },
    afterFocus: settleTextField,
    runAct: (e, api) => (e.act === "swipe" ? swipe(e, api, css) : Promise.resolve(undefined)),
  };
}

function hostOf(url: string | undefined): string {
  try {
    return url ? new URL(url).host : "";
  } catch {
    return "";
  }
}

// ─── preflight ───────────────────────────────────────────────────────

/** baseUrl must serve a Flutter web build — fail before starting a browser if it plainly doesn't. */
export async function checkFlutterBuild(baseUrl: string | undefined): Promise<void> {
  if (!baseUrl) return;
  let res: Response;
  try {
    res = await fetch(baseUrl, { redirect: "follow", signal: AbortSignal.timeout(10_000) });
  } catch {
    return; // unreachable: the first goto reports it with the usual NAVIGATION_FAILED
  }
  const type = res.headers.get("content-type") ?? "";
  const body = await res.text().catch(() => "");
  if (res.ok && /html/i.test(type) && !/flutter_bootstrap\.js|main\.dart\.js|flutter\.js|_flutter\b/.test(body)) {
    throw new AgentError("FLUTTER_NOT_WEB_BUILD", `baseUrl is not a Flutter web build: ${baseUrl} returned a page without flutter_bootstrap.js / main.dart.js`, {
      hint: "Serve the output of `flutter build web` (e.g. `cd build/web && python3 -m http.server 8080`) and set baseUrl to it — or remove plugins.flutter for a normal website.",
      where: { path: "baseUrl" },
      details: { baseUrl, status: res.status, contentType: type, start: body.slice(0, 300) },
    });
  }
}

// ─── when a step fails ───────────────────────────────────────────────

const EXPLAINABLE = ["SELECTOR_NOT_FOUND", "WAIT_TIMEOUT", "TARGET_NOT_VISIBLE", "ACTION_FAILED"];

/** A selector timed out: was it really the selector, or is the app stuck / semantics off / a host blocked? */
async function explainFailure(err: AgentError, api: PluginPageApi, health: FlutterHealth): Promise<AgentError | undefined> {
  if (!EXPLAINABLE.includes(err.code)) return undefined;
  if (health.blocked.length) return health.blockedError(api);
  const first = await treeSummary(api.page);
  if (!first.flutter) return undefined;
  const cause = { code: err.code, message: err.message, ...(err.details?.screenshot ? { screenshot: err.details.screenshot } : {}) };
  if (first.placeholder) {
    return api.fail("FLUTTER_SEMANTICS_UNAVAILABLE", "Flutter's accessibility tree is off, so no selector can match anything", {
      hint: "The plugin could not switch it on (see details). If the app disables semantics itself, remove that for the web build; otherwise report this with details.",
      details: { cause, tree: first, ...(await health.diagnostics(api.page)) },
    });
  }
  if (!looksStuck(first)) return undefined;
  // Stuck = still the same near-empty screen a moment later.
  await api.page.waitForTimeout(1500);
  const second = await treeSummary(api.page);
  if (!looksStuck(second) || second.labels.join("|") !== first.labels.join("|")) return undefined;
  const snapshot = await api.page.ariaSnapshot({ timeout: 5000 }).catch(() => "");
  return api.fail("FLUTTER_APP_NOT_READY", "the Flutter web build never left its first screen", {
    hint:
      "The app is stuck (usually awaiting a native-only plugin at startup). Native-only plugins (path_provider, file cookie jars, camera, GPS, secure storage) don't work on web — " +
      "add web fallbacks in the app (kIsWeb). details.console / details.pendingRequests / details.unhandledRejections show what it was waiting for.",
    details: { cause, visibleLabels: second.labels, semanticsSnapshot: snapshot.slice(0, 4000), ...(await health.diagnostics(api.page)) },
  });
}

// ─── overlay sizes ───────────────────────────────────────────────────

/** A copy of the script with text/blur sizes (defaults included) multiplied by k. */
function scaleOverlays(script: DemoScript, k: number): DemoScript {
  const copy = JSON.parse(JSON.stringify(script)) as DemoScript;
  const up = (n: number) => Math.round(n * k);
  for (const step of copy.steps) {
    for (const e of step.beat as FxEntry[]) {
      if (!e.fx) continue;
      if (e.fx === "callout") e.fontSize = up(e.fontSize ?? (e.style === "lower-third" ? 36 : 28));
      else if (e.fx === "arrow") e.fontSize = up(e.fontSize ?? 24);
      else if (e.fx === "narrate") e.subtitleSize = up(e.subtitleSize ?? 28);
      else if (e.fx === "blur") e.radius = up(e.radius ?? 20);
      else if (e.fx === "spotlight" && e.padding) e.padding = up(e.padding);
    }
  }
  return copy;
}

// ─── accessibility tree ──────────────────────────────────────────────

interface SemState {
  flutter: boolean;
  enabled: boolean;
  placeholder: { x: number; y: number } | null;
}

// No named inner functions in page code: tsx would wrap them in a __name() helper the page lacks.
async function semState(page: Page): Promise<SemState> {
  return page
    .evaluate(() => {
      const w = window as unknown as Record<string, unknown>;
      const ph = document.querySelector("flt-semantics-placeholder");
      const b = ph ? ph.getBoundingClientRect() : null;
      return {
        flutter: w._flutter !== undefined || !!document.querySelector("flutter-view, flt-glass-pane"),
        enabled: !!document.querySelector("flt-semantics"),
        placeholder: b ? { x: b.left + b.width / 2, y: b.top + b.height / 2 } : null,
      };
    })
    .catch(() => ({ flutter: false, enabled: false, placeholder: null }));
}

/**
 * Make sure Flutter's accessibility tree is on (no-op on non-Flutter pages and
 * once it is on). Flutter resets it on every page load, so this runs before each
 * entry. A synthetic el.click() is ignored: it takes a real pointer event in the
 * placeholder's exact centre. Tried as a touch tap, a mouse click, then a forced
 * click; each is verified (placeholder gone, tree present).
 */
async function enableSemantics(api: PluginPageApi, health: FlutterHealth): Promise<void> {
  const { page } = api;
  let st = await semState(page);
  if (!st.flutter || (st.enabled && !st.placeholder)) return;
  // The engine creates the placeholder once it has started; wait for it (or for an
  // app that turned semantics on itself).
  const deadline = Date.now() + Math.max(api.timeoutMs, 15_000);
  while (!st.placeholder && !st.enabled && Date.now() < deadline) {
    await page.waitForTimeout(150);
    st = await semState(page);
  }
  if (!st.placeholder) return; // on by itself, or the engine never started (explainFailure reports it)
  const attempts: ((p: { x: number; y: number }) => Promise<void>)[] = [
    (p) => page.touchscreen.tap(p.x, p.y),
    (p) => page.mouse.click(p.x, p.y),
    (p) => page.locator("flt-semantics-placeholder").click({ force: true, position: { x: p.x, y: p.y }, timeout: 2000 }),
  ];
  for (const attempt of attempts) {
    st = await semState(page);
    if (!st.placeholder) break;
    await attempt(st.placeholder).catch(() => {});
    // Flutter enables it 300 ms after the tap, then removes the placeholder.
    const until = Date.now() + 2500;
    while (Date.now() < until) {
      await page.waitForTimeout(100);
      st = await semState(page);
      if (st.enabled && !st.placeholder) return;
    }
  }
  st = await semState(page);
  if (st.enabled && !st.placeholder) return;
  throw await api.fail("FLUTTER_SEMANTICS_UNAVAILABLE", "could not switch on Flutter's accessibility tree (tried a tap, a click and a forced click in the placeholder's centre)", {
    hint: "Without it selectors can't see Flutter widgets. If the app turns semantics off itself, remove that for the web build; otherwise report this with details.",
    details: { placeholder: st.placeholder, semanticsNodes: st.enabled, ...(await health.diagnostics(page)) },
  });
}

async function settleTextField(loc: Locator): Promise<void> {
  const flutter = await loc
    .evaluate((el) => el.getAttribute("data-semantics-role") === "text-field" || !!el.closest("flt-semantics-host, flutter-view"))
    .catch(() => false);
  if (flutter) await loc.page().waitForTimeout(300);
}

// ─── swipe ───────────────────────────────────────────────────────────

async function swipe(e: ActEntry, api: PluginActApi, css: { width: number; height: number }): Promise<{ rect?: Rect; focus?: Rect | null }> {
  const { page } = api;
  const sel = pickSelector(e);
  let area = { x: 0, y: 0, width: css.width, height: css.height };
  let rect: Rect | undefined;
  if (sel) {
    const loc = await api.resolve(sel, api.timeoutMs);
    const box = await loc.boundingBox();
    if (box) {
      area = box;
      rect = [box.x, box.y, box.width, box.height].map(Math.round) as Rect;
    }
  }
  const once = () => fingerSwipe(page, area, e.direction!, e.distance ?? 0.6, e.durationMs ?? 400);

  if (!e.to) {
    await once();
    await page.waitForTimeout(500); // let the fling settle before the next entry
    return rect ? { rect, focus: rect } : {};
  }

  const max = e.maxSwipes ?? 10;
  const target = api.locate(e.to);
  const onScreen = async () => {
    if ((await target.count().catch(() => 0)) === 0) return false; // boundingBox() would wait for it
    const b = await target.boundingBox({ timeout: 1000 }).catch(() => null);
    return !!b && b.height > 0 && b.y < css.height && b.y + b.height > 0 && b.x < css.width && b.x + b.width > 0;
  };
  let n = 0;
  while (!(await onScreen())) {
    if (n >= max) {
      throw await api.fail("SELECTOR_NOT_FOUND", `swiped ${direction(e)} ${n} time(s) but the \`to\` element never came on screen`, {
        selector: e.to,
        hint: "Check the direction (up = towards later items), the selector (`inspect` lists what is on screen), or raise maxSwipes.",
        details: { swipes: n },
      });
    }
    await once();
    await page.waitForTimeout(600);
    n++;
  }
  // Centre it (Flutter scrolls its list when the accessibility element is scrolled into view).
  await target.evaluate((el) => el.scrollIntoView({ block: "center", inline: "center" })).catch(() => {});
  await page.waitForTimeout(500);
  const b = await target.boundingBox();
  const focus = b ? ([b.x, b.y, b.width, b.height].map(Math.round) as Rect) : null;
  return { ...(focus ? { rect: focus } : rect ? { rect } : {}), focus };
}

const direction = (e: ActEntry) => e.direction ?? "up";

/** One finger: touchStart → evenly spaced touchMoves → touchEnd, across `area`. */
async function fingerSwipe(
  page: Page,
  area: { x: number; y: number; width: number; height: number },
  dir: "up" | "down" | "left" | "right",
  distance: number,
  durationMs: number,
): Promise<void> {
  const cx = area.x + area.width / 2;
  const cy = area.y + area.height / 2;
  const dx = (area.width * distance) / 2;
  const dy = (area.height * distance) / 2;
  const [x1, y1, x2, y2] =
    dir === "up" ? [cx, cy + dy, cx, cy - dy] :
    dir === "down" ? [cx, cy - dy, cx, cy + dy] :
    dir === "left" ? [cx + dx, cy, cx - dx, cy] :
    [cx - dx, cy, cx + dx, cy];
  const cdp = await page.context().newCDPSession(page);
  try {
    const steps = Math.max(6, Math.round(durationMs / 16));
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: x1, y: y1 }] });
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x1 + (x2 - x1) * t, y: y1 + (y2 - y1) * t }] });
      await page.waitForTimeout(durationMs / steps);
    }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  } finally {
    await cdp.detach().catch(() => {});
  }
}

function pickSelector(e: ActEntry) {
  const keys = ["role", "label", "text", "placeholder", "testId", "css"] as const;
  if (!keys.some((k) => e[k] != null)) return undefined;
  const { role, name, label, text, placeholder, testId, css, within, exact, nth } = e;
  return { role, name, label, text, placeholder, testId, css, within, exact, nth };
}
