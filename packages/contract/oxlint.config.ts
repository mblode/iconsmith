import { defineConfig } from "oxlint";
import core from "ultracite/oxlint/core";
import react from "ultracite/oxlint/react";

/** React stays in the preset: `store.ts` and `threads.ts` hold types the
 *  Studio's components consume, so the rules that police them apply here. */
export default defineConfig({
  extends: [core, react],
  ignorePatterns: core.ignorePatterns,
});
