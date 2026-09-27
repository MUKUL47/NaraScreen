"use strict";
const fs = require("fs");
const produceHeadless = require("./produce-headless-BjFCgFo3.cjs");
const index = require("./job-W-Szny1w.cjs");
require("path");
require("child_process");
require("./narration-C9OhKhcT.cjs");
require("crypto");
require("playwright-core");
require("os");
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
async function main() {
  const input = JSON.parse(fs__namespace.readFileSync(process.argv[2], "utf-8"));
  index.setEventMode(input.events.mode);
  index.setQuiet(input.events.quiet);
  for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => process.exit(130));
  try {
    const result = await produceHeadless.produceLanguage(input.jobDir, input.script, input.trace, input.lang, index.log, input.opts);
    process.stdout.write(JSON.stringify({ ok: true, result }) + "\n");
  } catch (e) {
    process.stdout.write(JSON.stringify({ ok: false, error: index.toAgentError(e).toJSON() }) + "\n");
  }
}
main().catch((e) => {
  process.stdout.write(JSON.stringify({ ok: false, error: index.toAgentError(e).toJSON() }) + "\n");
});
