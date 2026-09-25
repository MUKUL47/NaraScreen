// ─── fixture server: serves the "Acme Tasks" demo app ────────────────
//
// A tiny static file server (node:http only) for the fake SaaS app in this
// folder. Tests start it on an ephemeral port; humans and outside agents can run
// it directly to get a safe, predictable site to record:
//
//   npx tsx api/_tests/fixture-site/serve.ts --port 4780
//   → prints http://127.0.0.1:4780 (sign in with any email + password)
//
// The app uses hash routes (#/login, #/tasks, …), so every page is index.html
// at "/". Only the app's own static files are served; anything else is a 404,
// which also makes `goto` to a bad path fail with a real HTTP error.

import * as fs from "fs";
import * as http from "http";
import * as path from "path";
import type { AddressInfo } from "net";
import { parseArgs } from "util";

const ROOT = __dirname;

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

export interface FixtureServer {
  /** Origin without a trailing slash, e.g. http://127.0.0.1:41234 — use as a script's baseUrl. */
  url: string;
  close(): Promise<void>;
}

export async function startFixtureServer(port = 0, host = "127.0.0.1"): Promise<FixtureServer> {
  const server = http.createServer(handle);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });
  const addr = server.address() as AddressInfo;
  return {
    url: `http://${host}:${addr.port}`,
    close: () =>
      new Promise<void>((resolve) => {
        // Browsers keep connections alive; drop them so close() doesn't hang.
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

function handle(req: http.IncomingMessage, res: http.ServerResponse): void {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { Allow: "GET, HEAD", "Content-Type": "text/plain; charset=utf-8" }).end("Method not allowed\n");
    return;
  }
  const file = resolveFile(req.url ?? "/");
  if (!file) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Not found\n");
    return;
  }
  const body = fs.readFileSync(file);
  res.writeHead(200, {
    "Content-Type": TYPES[path.extname(file)],
    "Content-Length": body.length,
    // Always fresh: tests edit nothing here, but a stale cached app.js during
    // development makes for very confusing recordings.
    "Cache-Control": "no-store",
  });
  res.end(req.method === "HEAD" ? undefined : body);
}

/** Map a request URL to a file in ROOT, or null (unknown, outside ROOT, or not a web asset). */
function resolveFile(url: string): string | null {
  let pathname: string;
  try {
    pathname = decodeURIComponent(new URL(url, "http://x").pathname);
  } catch {
    return null;
  }
  if (pathname === "/" || pathname === "/index.html") pathname = "/index.html";
  const file = path.resolve(ROOT, "." + pathname);
  if (!file.startsWith(ROOT + path.sep)) return null;
  if (!TYPES[path.extname(file)]) return null; // never serve serve.ts or other sources
  return fs.existsSync(file) && fs.statSync(file).isFile() ? file : null;
}

// ─── run directly ────────────────────────────────────────────────────

if (require.main === module) {
  const { values } = parseArgs({
    options: { port: { type: "string", default: "4780" }, host: { type: "string", default: "127.0.0.1" } },
  });
  startFixtureServer(Number(values.port), values.host).then(
    (srv) => {
      process.stdout.write(`${srv.url}\n`);
      process.stderr.write("Acme Tasks is running. Sign in with any email and password. Ctrl+C to stop.\n");
      const stop = () => void srv.close().then(() => process.exit(0));
      process.on("SIGINT", stop);
      process.on("SIGTERM", stop);
    },
    (err: Error) => {
      process.stderr.write(`Could not start the fixture server: ${err.message}\n`);
      process.exit(1);
    },
  );
}
