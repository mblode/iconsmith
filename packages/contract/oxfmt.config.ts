import { defineConfig } from "oxfmt";
import ultracite from "ultracite/oxfmt";

/**
 * `src/campaign.json` is a projection, not source.
 *
 * `apps/web/scripts/campaign-data.mjs` and `scripts/house-data.mjs` write them
 * with `JSON.stringify`; oxfmt would reformat a file no person edits and the
 * next regeneration would undo it. They live here rather than in the web app
 * because the code that reads them does.
 *
 * Markdown is ignored to match `apps/web`, whose formatting rules this code was
 * authored under. `packages/iconsmith` deliberately formats its markdown; the
 * two workspaces differ on purpose and aligning them would reflow prose.
 */
export default defineConfig({
  extends: [ultracite],
  ignorePatterns: ["**/*.md", "**/*.mdx", "src/campaign.json", "src/house-icons.json"],
});
