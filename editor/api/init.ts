// ─── init: a starter demo-script for any site ────────────────────────
//
// `narascreen init --url <site>` gives an agent a small script that is VALID as
// written — open the page, a lower-third title, one narration — so the loop
// "edit → validate → check → make" starts from something that already works.
// Knows nothing about the target site: the page's real elements come from
// `narascreen inspect`, which the step's note points to.

import * as fs from "fs";
import * as path from "path";
import { AgentError } from "./errors";
import { DEFAULT_VIEWPORT } from "./schema";
import { validateScript } from "./validate";

export interface InitOptions {
  /** Absolute http(s) URL of the page the demo starts on. */
  url: string;
  /** Script file to write (default <cwd>/<name>.demo-script.json). */
  out?: string;
  /** Demo name / scope (default: the URL's host). */
  name?: string;
  force?: boolean;
  cwd?: string;
}

export interface InitResult {
  scriptPath: string;
  script: Record<string, unknown>;
  warnings: string[];
}

export function initScript(opts: InitOptions): InitResult {
  const url = parseSiteUrl(opts.url);
  const name = opts.name?.trim() || nameFromUrl(url);
  const cwd = opts.cwd ?? process.cwd();
  const scriptPath = path.resolve(cwd, opts.out ?? `${fileSafe(name)}.demo-script.json`);

  if (fs.existsSync(scriptPath) && !opts.force) {
    throw new AgentError("USAGE", `File already exists: ${scriptPath}`, {
      hint: "Pass --force to overwrite it, or choose another --out.",
      details: { scriptPath },
    });
  }

  const script = starterScript(url, name);
  // The starter must pass validation as written — anything else is a NaraScreen bug.
  const { warnings } = validateScript(structuredClone(script), { dir: path.dirname(scriptPath) });

  fs.mkdirSync(path.dirname(scriptPath), { recursive: true });
  fs.writeFileSync(scriptPath, JSON.stringify(script, null, 2) + "\n");
  return { scriptPath, script, warnings };
}

export function starterScript(url: URL, name: string): Record<string, unknown> {
  const site = url.host.replace(/^www\./, "");
  const startPath = `${url.pathname || "/"}${url.search}${url.hash}`;
  return {
    version: 1,
    scope: name,
    baseUrl: url.origin,
    viewport: { ...DEFAULT_VIEWPORT },
    steps: [
      {
        id: "intro",
        label: "Open the start page",
        note:
          "Starter step — replace or extend it. Get ready-to-paste selectors for any page with " +
          `\`narascreen inspect --url ${url.origin}${startPath}\`.`,
        beat: [
          { act: "goto", path: startPath },
          // The page's main heading is unknown here, so settle with a plain wait
          // instead of a waitFor on an element that may not exist.
          { act: "wait", ms: 1000 },
          { fx: "callout", text: name, style: "lower-third" },
          { fx: "narrate", narrate: `Welcome! This is a quick tour of ${site}.` },
        ],
      },
    ],
  };
}

/** Default demo name: the host without "www." or port, e.g. "app.example.com". */
export function nameFromUrl(url: URL): string {
  return url.hostname.replace(/^www\./, "") || "demo";
}

function parseSiteUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new AgentError("USAGE", `--url is not an absolute URL: ${raw}`, {
      hint: "Pass the full address of the page the demo starts on, e.g. --url https://app.example.com/",
    });
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new AgentError("USAGE", `--url must be http(s), got ${url.protocol}`, {
      hint: "Pass the web address of the site, e.g. --url https://app.example.com/",
    });
  }
  return url;
}

function fileSafe(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[-.]+|-+$/g, "") || "demo";
}
