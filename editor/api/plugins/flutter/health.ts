// ─── flutter plugin: is the app usable, and is it talking to the right backend? ──
//
// A Flutter web app is one canvas: when it hangs there is no DOM to debug. So
// the plugin keeps what an author needs to find out why — console output (all
// levels), page errors, unhandled promise rejections, requests still pending —
// and turns "timed out on the first waitFor" into a precise error.
//
// It also guards the backend: a release web build has its API URL baked in, so a
// demo can quietly log in to (and write to) production. Requests to hosts other
// than baseUrl's are reported; with `allowedHosts` they are blocked and fail the run.

import type { BrowserContext, Page, Request } from "playwright";
import type { AgentError } from "../../errors";
import type { PluginPageApi } from "../index";

/** Flutter's own font/engine CDNs — never a backend, always allowed. */
export const FLUTTER_CDN_HOSTS = ["fonts.gstatic.com", "fonts.googleapis.com", "www.gstatic.com"];

const LOG_LIMIT = 200;
const REJECTIONS_INIT = `window.__naraRejections = [];
window.addEventListener("unhandledrejection", function (e) {
  try { var r = e.reason; window.__naraRejections.push(String((r && (r.stack || r.message)) || r).slice(0, 500)); } catch (_) {}
});`;

/** What the accessibility tree shows right now. */
export interface TreeSummary {
  flutter: boolean;
  placeholder: boolean;
  nodes: number;
  interactive: number;
  labels: string[];
}

export async function treeSummary(page: Page): Promise<TreeSummary> {
  // No named inner functions in page code: tsx would wrap them in a __name() helper the page lacks.
  return page
    .evaluate(() => {
      const w = window as unknown as Record<string, unknown>;
      const nodes = Array.from(document.querySelectorAll("flt-semantics, flt-semantics-host input, flt-semantics-host textarea"));
      const labels: string[] = [];
      let interactive = 0;
      for (const n of nodes) {
        const role = n.getAttribute("role") || "";
        // Text sits in a span inside the node; nodes that contain other nodes are containers.
        const own = (n.getAttribute("aria-label") || "").trim() || (n.querySelector("flt-semantics") ? "" : (n.textContent || "").trim());
        if (own) labels.push(own.slice(0, 60));
        if (/^(button|textbox|link|tab|checkbox|switch|slider|combobox|menuitem|radio|searchbox)$/.test(role) || n.tagName === "INPUT" || n.tagName === "TEXTAREA") interactive++;
      }
      return {
        flutter: w._flutter !== undefined || !!document.querySelector("flutter-view, flt-glass-pane"),
        placeholder: !!document.querySelector("flt-semantics-placeholder"),
        nodes: nodes.length,
        interactive,
        labels: labels.slice(0, 30),
      };
    })
    .catch(() => ({ flutter: false, placeholder: false, nodes: 0, interactive: 0, labels: [] }));
}

/** Semantics on, but nothing to interact with and at most a few labels: a splash / stuck screen. */
export const looksStuck = (t: TreeSummary) => t.flutter && !t.placeholder && t.interactive === 0 && t.labels.length <= 3;

export class FlutterHealth {
  private console: { type: string; text: string }[] = [];
  private pageErrors: string[] = [];
  private pending = new Map<Request, { url: string; method: string; at: number }>();
  readonly blocked: string[] = [];
  private reportedHosts = new Set<string>();

  constructor(
    private readonly baseHost: string,
    private readonly allowedHosts?: string[],
  ) {}

  /** baseUrl's own host or Flutter's CDNs. */
  private homeHost(url: URL): boolean {
    return url.host === this.baseHost || FLUTTER_CDN_HOSTS.includes(url.hostname);
  }

  hostAllowed(url: URL): boolean {
    if (this.homeHost(url) || !this.allowedHosts) return true;
    return this.allowedHosts.includes(url.host) || this.allowedHosts.includes(url.hostname);
  }

  async attach(context: BrowserContext, page: Page, warn: (m: string) => void): Promise<void> {
    const keep = <T>(list: T[], item: T) => {
      list.push(item);
      if (list.length > LOG_LIMIT) list.shift();
    };
    page.on("console", (m) => {
      // Chromium's own GPU driver chatter is not the app's.
      if (!/GL Driver Message|GPU stall due to/.test(m.text())) keep(this.console, { type: m.type(), text: m.text().slice(0, 500) });
    });
    page.on("pageerror", (e) => keep(this.pageErrors, String(e.stack || e.message).slice(0, 800)));
    page.on("request", (r) => {
      this.pending.set(r, { url: r.url(), method: r.method(), at: Date.now() });
      this.noteHost(r.url(), warn);
    });
    page.on("requestfinished", (r) => this.pending.delete(r));
    page.on("requestfailed", (r) => this.pending.delete(r));
    await context.addInitScript({ content: REJECTIONS_INIT });
    if (this.allowedHosts) {
      await context.route("**/*", (route) => {
        const raw = route.request().url();
        let u: URL;
        try {
          u = new URL(raw);
        } catch {
          return route.continue();
        }
        if (!/^https?:$/.test(u.protocol) || this.hostAllowed(u)) return route.continue();
        this.blocked.push(`${route.request().method()} ${raw}`);
        return route.abort("blockedbyclient");
      });
    }
  }

  /** Without allowedHosts: say once per host that the app talks to another server. */
  private noteHost(raw: string, warn: (m: string) => void) {
    if (this.allowedHosts) return;
    let u: URL;
    try {
      u = new URL(raw);
    } catch {
      return;
    }
    if (!/^https?:$/.test(u.protocol) || this.homeHost(u) || this.reportedHosts.has(u.host)) return;
    this.reportedHosts.add(u.host);
    warn(
      `The Flutter app called ${u.host}, which is not baseUrl's host (${this.baseHost}). If that is a production backend, the demo is ` +
        `logging in to and changing real data. Point the web build at your demo backend, and set plugins.flutter.allowedHosts ` +
        `(e.g. ["${u.host}"] once you know it is safe) to block every other host.`,
    );
  }

  /** Everything an author needs when a canvas app misbehaves. */
  async diagnostics(page: Page): Promise<Record<string, unknown>> {
    const rejections = await page
      .evaluate(() => ((window as unknown as Record<string, unknown>).__naraRejections as string[] | undefined) ?? [])
      .catch(() => [] as string[]);
    const now = Date.now();
    return {
      console: this.console.slice(-100),
      pageErrors: this.pageErrors.slice(-20),
      unhandledRejections: rejections.slice(-20),
      pendingRequests: [...this.pending.values()].map((p) => ({ method: p.method, url: p.url, pendingSec: Math.round((now - p.at) / 100) / 10 })),
      ...(this.blocked.length ? { blockedRequests: this.blocked.slice(0, 50) } : {}),
    };
  }

  async blockedError(api: PluginPageApi): Promise<AgentError> {
    const hosts = [...new Set(this.blocked.map((b) => new URL(b.split(" ")[1]).host))];
    return api.fail("BLOCKED_REQUEST", `the app called ${hosts.join(", ")}, which is not in plugins.flutter.allowedHosts — blocked`, {
      hint:
        "A release web build has its API address baked in (dotenv, --dart-define). Rebuild it against the demo backend, or add the host to allowedHosts if it is safe to use in the demo.",
      details: { blockedRequests: this.blocked.slice(0, 50), allowedHosts: this.allowedHosts, baseUrlHost: this.baseHost },
    });
  }
}
