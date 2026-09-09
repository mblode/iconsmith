import { defineConfig } from "tsdown";

export default defineConfig({
  banner: { js: "#!/usr/bin/env node" },
  clean: true,
  dts: false,
  entry: { cli: "src/cli.ts" },
  format: ["esm"],
  outExtensions: () => ({ js: ".js" }),
  sourcemap: true,
  target: "node24",
});
