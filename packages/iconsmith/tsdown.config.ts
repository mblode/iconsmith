import { readFileSync, writeFileSync } from "node:fs";

import { defineConfig } from "tsdown";

// The research harness's inline fallback is generated from the author reference.
const drawing = readFileSync(
  new URL("references/drawing.md", import.meta.url),
  "utf-8"
);
const inlinePath = new URL("src/pipeline/skill.json", import.meta.url);
const inline = `${JSON.stringify({ lines: drawing.split("\n") }, null, 2)}\n`;
if (readFileSync(inlinePath, "utf-8") !== inline) {
  writeFileSync(inlinePath, inline);
}

export default defineConfig([
  {
    banner: { js: "#!/usr/bin/env node" },
    clean: true,
    deps: { neverBundle: ["@ai-sdk/gateway", "@ai-sdk/provider", "ai", "run"] },
    dts: false,
    entry: { cli: "src/cli.ts" },
    format: ["esm"],
    outExtensions: () => ({ js: ".js" }),
    sourcemap: true,
    target: "node24",
  },
  {
    banner: { js: "#!/usr/bin/env node" },
    clean: true,
    copy: [{ from: "../../examples/starter/revision.json", to: "dist-agent" }],
    dts: false,
    entry: { cli: "scripts/agent-cli.ts" },
    format: ["esm"],
    outDir: "dist-agent",
    outExtensions: () => ({ js: ".js" }),
    sourcemap: false,
    target: "node24",
  },
]);
