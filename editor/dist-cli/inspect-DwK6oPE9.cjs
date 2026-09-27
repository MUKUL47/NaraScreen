"use strict";
Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
const index = require("./job-W-Szny1w.cjs");
const fs = require("fs");
const path = require("path");
const narascreen = require("./narascreen.cjs");
const runner = require("./runner-C-0LtWCn.cjs");
require("child_process");
require("os");
require("crypto");
require("util");
require("url");
require("playwright-core");
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
const ELEMENT_LIMIT = 200;
async function inspect(opts) {
  const outDir = path__namespace.resolve(opts.outDir);
  const log = opts.log ?? index.log;
  const failuresDir = path__namespace.join(outDir, "failures");
  if (!opts.url && !opts.script) {
    throw new index.AgentError("USAGE", "inspect needs --url <page> or --script <file>", {
      hint: "e.g. `narascreen inspect --url https://app.example.com/settings`, or `--script my.demo-script.json --until <step-id>`."
    });
  }
  if (opts.untilStep && !opts.script) {
    throw new index.AgentError("USAGE", "--until needs --script (it names a step of that script)", {
      hint: "Add --script <file>, or drop --until and pass --url."
    });
  }
  if (opts.viewport) checkViewport(opts.viewport);
  const script = scriptFor(opts);
  const target = opts.url ? resolveUrl(opts.url, opts.script ? script.baseUrl : void 0) : void 0;
  const runScript = { ...script, steps: opts.untilStep ? script.steps : [] };
  const baseUrl = script.baseUrl ?? "";
  let result;
  const ran = await runner.run(runScript, outDir, {
    check: true,
    headed: opts.headed,
    untilStep: opts.untilStep,
    failuresDir,
    log,
    onPage: async (page, prepare) => {
      if (target) {
        index.stage("inspect", `Inspecting ${target}`);
        await runner.gotoPage(page, target, { baseUrl, failuresDir });
      } else {
        if (page.url() === "about:blank") await runner.gotoPage(page, baseUrl, { baseUrl, failuresDir });
        index.stage("inspect", `Inspecting ${page.url()}`);
      }
      await settle(page);
      await prepare();
      result = await capture(page, outDir, !!opts.fullPage, index.pluginsFor(script).find((p) => p.browserViewport)?.browserViewport ?? script.viewport, log);
    }
  });
  if (!result) throw new index.AgentError("INTERNAL", "inspect finished without capturing the page");
  return { ...result, warnings: ran.warnings };
}
function scriptFor(opts) {
  const storageState = opts.storageState ? path__namespace.resolve(opts.storageState) : void 0;
  if (opts.script) {
    return {
      ...opts.script,
      viewport: opts.viewport ?? opts.script.viewport ?? index.DEFAULT_VIEWPORT,
      storageState: storageState ?? opts.script.storageState,
      ...opts.plugins ? { plugins: opts.plugins } : {}
    };
  }
  const url = resolveUrl(opts.url, void 0);
  return {
    version: 1,
    scope: "inspect",
    baseUrl: new URL(url).origin,
    viewport: opts.viewport ?? index.DEFAULT_VIEWPORT,
    ...storageState ? { storageState } : {},
    ...opts.plugins ? { plugins: opts.plugins } : {},
    steps: []
  };
}
function resolveUrl(url, baseUrl) {
  const absolute = /^[a-z][a-z0-9+.-]*:/i.test(url);
  if (!absolute && !baseUrl) {
    throw new index.AgentError("USAGE", `--url must be an absolute URL (got "${url}")`, {
      hint: "Pass a full URL like https://app.example.com/page, or add --script so a path is resolved against its baseUrl."
    });
  }
  try {
    return new URL(url, baseUrl).href;
  } catch {
    throw new index.AgentError("USAGE", `Not a valid URL: "${url}"`, { hint: "Pass a full URL like https://app.example.com/page." });
  }
}
function checkViewport(v) {
  const ok = (n, min, max) => Number.isInteger(n) && n >= min && n <= max;
  if (!ok(v.width, 320, 3840) || !ok(v.height, 240, 2160)) {
    throw new index.AgentError("USAGE", `Invalid viewport ${v.width}x${v.height}`, {
      hint: "Use WIDTHxHEIGHT within 320..3840 x 240..2160, e.g. --viewport 1440x900."
    });
  }
}
async function settle(page) {
  await page.waitForLoadState("load", { timeout: 1e4 }).catch(() => {
  });
  await page.waitForLoadState("networkidle", { timeout: 3e3 }).catch(() => {
  });
  await new Promise((r) => setTimeout(r, 300));
}
async function capture(page, outDir, fullPage, viewport, log) {
  fs__namespace.mkdirSync(outDir, { recursive: true });
  const screenshot = path__namespace.join(outDir, "screenshot.png");
  await page.screenshot({ path: screenshot, scale: "css" });
  let fullPageScreenshot;
  if (fullPage) {
    fullPageScreenshot = path__namespace.join(outDir, "fullpage.png");
    await page.screenshot({ path: fullPageScreenshot, fullPage: true, scale: "css" });
  }
  const { elements, total } = await narascreen.collectElementsDetailed(page, { limit: ELEMENT_LIMIT });
  const aria = await page.locator("body").ariaSnapshot({ timeout: 15e3 }).catch((err) => `(accessibility snapshot failed: ${err instanceof Error ? err.message.split("\n")[0] : err})`);
  const ariaSnapshotPath = path__namespace.join(outDir, "aria.txt");
  fs__namespace.writeFileSync(ariaSnapshotPath, aria.endsWith("\n") ? aria : aria + "\n");
  fs__namespace.writeFileSync(path__namespace.join(outDir, "elements.json"), JSON.stringify(elements, null, 2) + "\n");
  const headings = await narascreen.pageHeadings(page, 40);
  const visible = elements.filter((e) => e.visible).length;
  const truncated = total > ELEMENT_LIMIT;
  log(
    `${elements.length} elements (${visible} visible)${truncated ? `, ${total - ELEMENT_LIMIT} more not listed` : ""}, ${headings.length} headings → ${outDir}`
  );
  return {
    url: page.url(),
    title: await page.title().catch(() => ""),
    viewport: page.viewportSize() ?? viewport,
    screenshot,
    ...fullPageScreenshot ? { fullPageScreenshot } : {},
    headings,
    elements,
    ariaSnapshotPath,
    truncated
  };
}
exports.inspect = inspect;
