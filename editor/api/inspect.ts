// ─── inspect: show an agent what is on a page, with selectors it can paste ─
//
// An agent writing a script for a site it has never seen needs three things:
// a screenshot, the headings (where am I?), and every element it could act on
// with a selector that is GUARANTEED to work in a script. Elements come from
// page-elements.ts — the module the runner resolves selectors with — and each
// selector is verified against the live element, so pasting it into an act entry
// or fx anchor hits exactly that element.
//
// With a script, inspect reuses the runner (check mode): same browser settings,
// same session, `setup` first (e.g. log in), then the steps up to --until. That
// makes pages behind a login or a few clicks inspectable, in the exact state the
// recording will see them.
//
// Output folder: screenshot.png, fullpage.png (--full-page), aria.txt (the full
// accessibility tree), elements.json (the same list as the result).

import { pluginsFor } from "./plugins";
import * as fs from "fs";
import * as path from "path";
import type { Page } from "@playwright/test";
import { AgentError } from "./errors";
import { log as defaultLog, stage, type Log } from "./output";
import { collectElementsDetailed, pageHeadings, type InspectElement } from "./page-elements";
import { gotoPage, run } from "./runner";
import { DEFAULT_VIEWPORT, type DemoScript } from "./schema";

export interface InspectOptions {
  /** Absolute URL, or a path resolved against script.baseUrl. */
  url?: string;
  /** Use its baseUrl/viewport/storageState; run setup, and steps through untilStep (check mode). */
  script?: DemoScript;
  untilStep?: string;
  /** screenshot.png, fullpage.png, aria.txt, elements.json */
  outDir: string;
  viewport?: { width: number; height: number };
  storageState?: string;
  /** Recording plugins (e.g. from --plugin flutter); override the script's. */
  plugins?: DemoScript["plugins"];
  headed?: boolean;
  fullPage?: boolean;
  log?: Log;
}

export interface InspectResult {
  url: string;
  title: string;
  viewport: { width: number; height: number };
  screenshot: string;
  fullPageScreenshot?: string;
  headings: { level: number; text: string }[];
  elements: InspectElement[];
  /** Full accessibility tree as text. */
  ariaSnapshotPath: string;
  /** More elements exist than were listed (see aria.txt for everything). */
  truncated: boolean;
  /** Non-fatal problems met while running setup/steps (e.g. ambiguous selectors). */
  warnings: string[];
}

const ELEMENT_LIMIT = 200;

export async function inspect(opts: InspectOptions): Promise<InspectResult> {
  const outDir = path.resolve(opts.outDir);
  const log = opts.log ?? defaultLog;
  const failuresDir = path.join(outDir, "failures");
  if (!opts.url && !opts.script) {
    throw new AgentError("USAGE", "inspect needs --url <page> or --script <file>", {
      hint: "e.g. `narascreen inspect --url https://app.example.com/settings`, or `--script my.demo-script.json --until <step-id>`.",
    });
  }
  if (opts.untilStep && !opts.script) {
    throw new AgentError("USAGE", "--until needs --script (it names a step of that script)", {
      hint: "Add --script <file>, or drop --until and pass --url.",
    });
  }
  if (opts.viewport) checkViewport(opts.viewport);

  const script = scriptFor(opts);
  const target = opts.url ? resolveUrl(opts.url, opts.script ? script.baseUrl : undefined) : undefined;
  // Without --until only `setup` runs; the steps are replayed only up to that id.
  const runScript: DemoScript = { ...script, steps: opts.untilStep ? script.steps : [] };

  // scriptFor() guarantees a baseUrl for --url; a script without one fails in run().
  const baseUrl = script.baseUrl ?? "";
  let result: Omit<InspectResult, "warnings"> | undefined;
  const ran = await run(runScript, outDir, {
    check: true,
    headed: opts.headed,
    untilStep: opts.untilStep,
    failuresDir,
    log,
    onPage: async (page, prepare) => {
      if (target) {
        stage("inspect", `Inspecting ${target}`);
        await gotoPage(page, target, { baseUrl, failuresDir });
      } else {
        if (page.url() === "about:blank") await gotoPage(page, baseUrl, { baseUrl, failuresDir });
        stage("inspect", `Inspecting ${page.url()}`);
      }
      await settle(page);
      await prepare();
      result = await capture(page, outDir, !!opts.fullPage, pluginsFor(script).find((p) => p.browserViewport)?.browserViewport ?? script.viewport, log);
    },
  });
  if (!result) throw new AgentError("INTERNAL", "inspect finished without capturing the page");
  return { ...result, warnings: ran.warnings };
}

/** The script inspect runs: the given one (with overrides) or a bare one for --url. */
function scriptFor(opts: InspectOptions): DemoScript {
  const storageState = opts.storageState ? path.resolve(opts.storageState) : undefined;
  if (opts.script) {
    return {
      ...opts.script,
      viewport: opts.viewport ?? opts.script.viewport ?? DEFAULT_VIEWPORT,
      storageState: storageState ?? opts.script.storageState,
      ...(opts.plugins ? { plugins: opts.plugins } : {}),
    };
  }
  const url = resolveUrl(opts.url!, undefined);
  return {
    version: 1,
    scope: "inspect",
    baseUrl: new URL(url).origin,
    viewport: opts.viewport ?? DEFAULT_VIEWPORT,
    ...(storageState ? { storageState } : {}),
    ...(opts.plugins ? { plugins: opts.plugins } : {}),
    steps: [],
  };
}

function resolveUrl(url: string, baseUrl: string | undefined): string {
  const absolute = /^[a-z][a-z0-9+.-]*:/i.test(url);
  if (!absolute && !baseUrl) {
    throw new AgentError("USAGE", `--url must be an absolute URL (got "${url}")`, {
      hint: "Pass a full URL like https://app.example.com/page, or add --script so a path is resolved against its baseUrl.",
    });
  }
  try {
    return new URL(url, baseUrl).href;
  } catch {
    throw new AgentError("USAGE", `Not a valid URL: "${url}"`, { hint: "Pass a full URL like https://app.example.com/page." });
  }
}

function checkViewport(v: { width: number; height: number }): void {
  const ok = (n: number, min: number, max: number) => Number.isInteger(n) && n >= min && n <= max;
  if (!ok(v.width, 320, 3840) || !ok(v.height, 240, 2160)) {
    throw new AgentError("USAGE", `Invalid viewport ${v.width}x${v.height}`, {
      hint: "Use WIDTHxHEIGHT within 320..3840 x 240..2160, e.g. --viewport 1440x900.",
    });
  }
}

/** Give client-rendered pages a moment to finish rendering and animating. */
async function settle(page: Page): Promise<void> {
  await page.waitForLoadState("load", { timeout: 10_000 }).catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 3_000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 300));
}

async function capture(
  page: Page,
  outDir: string,
  fullPage: boolean,
  viewport: { width: number; height: number },
  log: Log,
): Promise<Omit<InspectResult, "warnings">> {
  fs.mkdirSync(outDir, { recursive: true });
  const screenshot = path.join(outDir, "screenshot.png");
  await page.screenshot({ path: screenshot, scale: "css" });
  let fullPageScreenshot: string | undefined;
  if (fullPage) {
    fullPageScreenshot = path.join(outDir, "fullpage.png");
    await page.screenshot({ path: fullPageScreenshot, fullPage: true, scale: "css" });
  }

  const { elements, total } = await collectElementsDetailed(page, { limit: ELEMENT_LIMIT });
  // After collectElements: a default-mode snapshot invalidates the refs it uses.
  const aria = await page
    .locator("body")
    .ariaSnapshot({ timeout: 15_000 })
    .catch((err) => `(accessibility snapshot failed: ${err instanceof Error ? err.message.split("\n")[0] : err})`);
  const ariaSnapshotPath = path.join(outDir, "aria.txt");
  fs.writeFileSync(ariaSnapshotPath, aria.endsWith("\n") ? aria : aria + "\n");
  fs.writeFileSync(path.join(outDir, "elements.json"), JSON.stringify(elements, null, 2) + "\n");

  const headings = await pageHeadings(page, 40);
  const visible = elements.filter((e) => e.visible).length;
  const truncated = total > ELEMENT_LIMIT;
  log(
    `${elements.length} elements (${visible} visible)${truncated ? `, ${total - ELEMENT_LIMIT} more not listed` : ""}, ` +
      `${headings.length} headings → ${outDir}`,
  );
  return {
    url: page.url(),
    title: await page.title().catch(() => ""),
    viewport: page.viewportSize() ?? viewport,
    screenshot,
    ...(fullPageScreenshot ? { fullPageScreenshot } : {}),
    headings,
    elements,
    ariaSnapshotPath,
    truncated,
  };
}
