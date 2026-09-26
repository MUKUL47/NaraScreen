// Static server for the Flutter web fixture (build/web), on an ephemeral port.
// Build it first: `flutter build web --release --no-web-resources-cdn` in this folder.
import * as fs from "fs";
import * as http from "http";
import * as path from "path";

export const FLUTTER_FIXTURE_DIR = __dirname;
export const FLUTTER_BUILD_DIR = path.join(__dirname, "build", "web");

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".wasm": "application/wasm",
  ".json": "application/json",
  ".png": "image/png",
  ".otf": "font/otf",
  ".ttf": "font/ttf",
};

export interface FlutterFixtureServer {
  url: string;
  close(): Promise<void>;
}

export async function startFlutterFixture(root = FLUTTER_BUILD_DIR): Promise<FlutterFixtureServer> {
  if (!fs.existsSync(path.join(root, "index.html"))) throw new Error(`No Flutter web build at ${root} — run \`flutter build web\` in ${FLUTTER_FIXTURE_DIR}`);
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent((req.url ?? "/").split("?")[0]);
    let file = path.normalize(path.join(root, rel));
    if (!file.startsWith(root)) {
      res.writeHead(403).end();
      return;
    }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
    if (!fs.existsSync(file)) file = path.join(root, "index.html"); // SPA fallback
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] ?? "application/octet-stream", "Cache-Control": "no-cache" });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/**
 * Build the fixture for the web if the build is missing or older than its source.
 * Returns false when the Flutter SDK is not installed (tests then skip).
 */
export function ensureFlutterBuild(): boolean {
  const { spawnSync } = require("child_process") as typeof import("child_process");
  const index = path.join(FLUTTER_BUILD_DIR, "main.dart.js");
  const sources = [path.join(FLUTTER_FIXTURE_DIR, "lib", "main.dart"), path.join(FLUTTER_FIXTURE_DIR, "pubspec.yaml"), path.join(FLUTTER_FIXTURE_DIR, "web", "index.html")];
  const fresh = fs.existsSync(index) && sources.every((f) => fs.statSync(f).mtimeMs <= fs.statSync(index).mtimeMs);
  if (fresh) return true;
  const probe = spawnSync("flutter", ["--version"], { encoding: "utf-8", timeout: 120_000 });
  if (probe.status !== 0) return false;
  const res = spawnSync("flutter", ["build", "web", "--release", "--no-web-resources-cdn"], { cwd: FLUTTER_FIXTURE_DIR, encoding: "utf-8", timeout: 600_000 });
  if (res.status !== 0) throw new Error(`flutter build web failed:\n${(res.stdout + res.stderr).slice(-2000)}`);
  return true;
}
