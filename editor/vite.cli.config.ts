// ─── vite.cli.config: the CLI as plain CommonJS for the packaged app ──
//
//   npx vite build --config vite.cli.config.ts      → dist-cli/
//     narascreen.cjs       api/cli.ts        (run: ELECTRON_RUN_AS_NODE=1 <app binary> narascreen.cjs …)
//     produce-child.cjs    api/produce-child.ts (one language of a parallel render)
//     <shared>-<hash>.cjs  lazily loaded engine chunks (runner, renderer, server…)
//     MANUAL.md, docs-assets/  read by api/docs.ts from next to the code
//
// The desktop app has no tsx: in development it runs bin/narascreen (tsx), in a
// packaged build this bundle (shipped outside the asar via extraResources, next
// to its own node_modules/playwright-core). zod and marked are bundled;
// playwright-core stays external (it locates its browsers relative to itself),
// as do electron and the ffmpeg-static/ffprobe-static fallbacks (the packaged
// app uses resources/bin/ffmpeg). Every chunk lands in dist-cli/ itself, because
// the code resolves siblings through __dirname.

import * as fs from "fs";
import * as path from "path";
import { defineConfig, type Plugin } from "vite";

const ROOT = __dirname;
const OUT = path.join(ROOT, "dist-cli");
const VERSION = (JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf-8")) as { version: string }).version;
const EXTERNAL = ["playwright-core", "electron", "ffmpeg-static", "ffprobe-static"];

/** @playwright/test and playwright re-export playwright-core: load that one at runtime. */
function playwrightCore(): Plugin {
  return {
    name: "narascreen:playwright-core",
    enforce: "pre",
    resolveId(id) {
      if (id === "@playwright/test" || id === "playwright") return { id: "playwright-core", external: true };
      return null;
    },
  };
}

/**
 * `require("./validate")` inside the TypeScript sources (cli.ts loads modules
 * behind its stdout guard; docs.ts breaks a cycle with server.ts) → a bundled
 * import. Runs after vite:esbuild has stripped the types; bare requires
 * (require("ffmpeg-static")) stay runtime requires.
 */
function relativeRequires(): Plugin {
  return {
    name: "narascreen:relative-requires",
    enforce: "post",
    transform(code, id) {
      if (id.includes("node_modules") || !/\brequire\(\s*["']\.\.?\//.test(code)) return null;
      const imports: string[] = [];
      const out = code.replace(/\brequire\(\s*(["'])(\.\.?\/[^"']+)\1\s*\)/g, (_m, _q: string, spec: string) => {
        const name = `__narascreen_req${imports.length}`;
        imports.push(`import * as ${name} from ${JSON.stringify(spec)};`);
        return name;
      });
      // A shebang must stay the first line (cli.ts has one; the bundle does not need it).
      return { code: `${imports.join("\n")}\n${out.replace(/^#!.*\n/, "")}`, map: null };
    },
  };
}

/** api/docs.ts reads MANUAL.md and docs-assets/ from __dirname. */
function copyDocs(): Plugin {
  return {
    name: "narascreen:copy-docs",
    apply: "build",
    writeBundle() {
      fs.copyFileSync(path.join(ROOT, "api", "MANUAL.md"), path.join(OUT, "MANUAL.md"));
      fs.cpSync(path.join(ROOT, "api", "docs-assets"), path.join(OUT, "docs-assets"), { recursive: true });
    },
  };
}

export default defineConfig({
  root: ROOT,
  publicDir: false,
  logLevel: "warn",
  plugins: [playwrightCore(), relativeRequires(), copyDocs()],
  define: {
    // narascreenVersion() (api/cli-process.ts): there is no package.json next to the bundle.
    "process.env.NARASCREEN_BUNDLE_VERSION": JSON.stringify(VERSION),
  },
  resolve: { conditions: ["node"] },
  ssr: { noExternal: true, external: EXTERNAL },
  build: {
    ssr: true,
    target: "node20",
    outDir: OUT,
    emptyOutDir: true,
    minify: false,
    sourcemap: false,
    copyPublicDir: false,
    reportCompressedSize: false,
    rollupOptions: {
      input: {
        narascreen: path.join(ROOT, "api", "cli.ts"),
        "produce-child": path.join(ROOT, "api", "produce-child.ts"),
      },
      external: (id) => EXTERNAL.some((e) => id === e || id.startsWith(`${e}/`)),
      onwarn(warning, warn) {
        // zod ships /*#__PURE__*/ hints rollup can't place; harmless.
        if (warning.code === "INVALID_ANNOTATION") return;
        warn(warning);
      },
      output: {
        format: "cjs",
        entryFileNames: "[name].cjs",
        chunkFileNames: "[name]-[hash].cjs",
        exports: "auto",
      },
    },
  },
});
