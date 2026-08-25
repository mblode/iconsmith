import { defineConfig } from "oxfmt";
import ultracite from "ultracite/oxfmt";

/**
 * `lib/vocabulary.json` and `lib/studio/campaign.json` are projections, not
 * source.
 *
 * `scripts/vocabulary-data.mjs` and `scripts/campaign-data.mjs` write them with
 * `JSON.stringify`; oxfmt would reformat a file no person edits, and the next
 * regeneration would undo it. Re-run the script when the data moves -- that is
 * the whole contract, and the header of each file says so.
 *
 * `house-icons.json` is the same kind of file and is ignored by `apps/agent`,
 * which is where `arsenal.ts` reads it. `ignorePatterns` cannot reach across a
 * workspace: `..` is rejected outright, because patterns resolve within the
 * config file's directory.
 */
export default defineConfig({
  extends: [ultracite],
  ignorePatterns: ["**/*.md", "**/*.mdx", "lib/vocabulary.json", "lib/studio/campaign.json"],
});
