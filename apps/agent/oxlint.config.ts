import { defineConfig } from "oxlint";
import core from "ultracite/oxlint/core";

/**
 * `tools/*_*.ts` keeps its snake_case names.
 *
 * eve derives a tool's name from its filename, so `generate_icon_pair.ts` IS
 * the tool `generate_icon_pair`. Renaming it to satisfy `unicorn/filename-case`
 * renames the tool the model calls.
 */
export default defineConfig({
  extends: [core],
  ignorePatterns: core.ignorePatterns,
  overrides: [
    {
      files: ["tools/*_*.ts"],
      rules: { "unicorn/filename-case": "off" },
    },
  ],
});
