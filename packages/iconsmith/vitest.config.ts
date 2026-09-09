import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, "**/.staging/**"],
    // Raster and full-population controls contend for CPU on shared CI runners.
    maxWorkers: process.env.CI ? 1 : 4,
  },
});
