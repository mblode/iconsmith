import { defineConfig } from "oxfmt";
import ultracite from "ultracite/oxfmt";

/**
 * `lib/campaign.json` and `lib/vocabulary.json` are projections, not source.
 *
 * `scripts/campaign-data.mjs` and `scripts/vocabulary-data.mjs` write them with
 * `JSON.stringify(_, null, 2)`; oxfmt collapses short arrays onto one line. So
 * regenerating either one turned `npm run check` red until something reformatted
 * a file no person edits, and the next regeneration undid it. Re-run the script
 * when the data moves — that is the whole contract, and the header of each file
 * says so.
 */
export default defineConfig({
  extends: [ultracite],
  ignorePatterns: ["**/*.md", "**/*.mdx", "lib/campaign.json", "lib/vocabulary.json"],
});
