import { defineConfig } from "oxfmt";
import ultracite from "ultracite/oxfmt";

/**
 * `lib/house-icons.json` is a projection, not source.
 *
 * `apps/web/scripts/house-data.mjs` writes it with `JSON.stringify`; oxfmt
 * would reformat a file no person edits and the next regeneration would undo
 * it. It lives here rather than in the web app because `arsenal.ts` reads it.
 *
 * Markdown is ignored to match `apps/web`, which this code was authored under.
 * `instructions.md` is the agent's prompt: reflowing it edits input.
 */
export default defineConfig({
  extends: [ultracite],
  ignorePatterns: ["**/*.md", "**/*.mdx", "lib/house-icons.json"],
});
