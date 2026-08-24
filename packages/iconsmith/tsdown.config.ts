import { defineConfig } from "tsdown";

// `outExtensions` pins .js/.d.ts. tsdown >= 0.22 defaults ESM output to .mjs,
// which would not match the .js paths in package.json's bin, exports and types.
// The package is already "type": "module", so .js is unambiguously ESM here.
const outExtensions = () => ({ dts: ".d.ts", js: ".js" });

export default defineConfig([
  {
    banner: { js: "#!/usr/bin/env node" },
    clean: true,
    entry: { cli: "src/cli.ts" },
    format: ["esm"],
    outExtensions,
    sourcemap: true,
    target: "node24",
  },
  {
    dts: true,
    entry: { index: "src/index.ts", spec: "src/spec.ts" },
    format: ["esm"],
    outExtensions,
    sourcemap: true,
    target: "node24",
  },
]);
