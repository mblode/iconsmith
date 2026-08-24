import { defineConfig } from "oxfmt";
import ultracite from "ultracite/oxfmt";

/**
 * The workbench's records are written, not authored.
 *
 * `backlog.mjs` writes every campaign artifact with `JSON.stringify(_, null, 2)`
 * and oxfmt collapses short arrays onto one line, so the two disagree by
 * construction: every generation run left `npm run check` red on evidence files
 * nobody hand-edits, and the pre-commit hook quietly reformatted them again on
 * the way in. A check that is red after every run is not a signal.
 *
 * `PROGRESS.md` is the sharper case — it says "Do not edit by hand", it is
 * regenerated on every sync, and lefthook globs no markdown, so the hook could
 * never fix what the check kept reporting.
 *
 * The preset already ignores `**\/_generated` and `**\/*.gen.*` for this exact
 * reason; these are the same kind of file under a different name. `README.md`
 * and `model-policy.json` stay formatted, because a person writes those.
 */
export default defineConfig({
  ...ultracite,
  ignorePatterns: [
    ...ultracite.ignorePatterns,
    "**/workbench/*/explorations/**",
    "**/workbench/*/campaign.json",
    "**/workbench/*/PROGRESS.md",
  ],
});
