import { defineConfig } from "oxfmt";
import ultracite from "ultracite/oxfmt";

/**
 * `lib/campaign.json` and `lib/vocabulary.json` are projections, not source.
 *
 * `scripts/campaign-data.mjs`, `scripts/vocabulary-data.mjs`, and
 * `scripts/house-data.mjs` write them with `JSON.stringify`; oxfmt would
 * reformat a file no person edits, and the next regeneration would undo it.
 * Re-run the script when the data moves — that is the whole contract, and the
 * header of each file says so.
 */
export default defineConfig({
  extends: [ultracite],
  ignorePatterns: [
    "**/*.md",
    "**/*.mdx",
    "lib/campaign.json",
    "lib/vocabulary.json",
    "lib/studio/house-icons.json",
  ],
});
