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
 * reason; these are the same kind of file under a different name.
 * `model-policy.json` stays formatted, because a person writes that.
 *
 * `bench/` is the same case a third time, and it is the one that bites during
 * a measurement rather than after one. Every file there is a committed golden
 * artifact written by a script with `JSON.stringify(_, null, 2)` —
 * `judge-gate.ts:131`, `calibrate.ts:146`, `gate.ts` and the `bench` command —
 * so running the judge sanity gate, which is the thing you run to find out
 * whether the judge can be trusted at all, turned `npm run check` red on its
 * own output. A check that goes red when you take a measurement teaches people
 * not to take measurements.
 *
 * `CHANGELOG.md` is the same case again, and it left `npm run check` red on
 * `main`: changesets writes it during `changeset version`, oxfmt disagrees with
 * what it writes, and no hook globs markdown — so every release re-broke the
 * check on a file nobody edits. `apps/web/oxfmt.config.ts` already ignores all
 * markdown for the same reason; this narrows to the generated one rather than
 * giving up on prose, since `README.md` here IS hand-written.
 */
export default defineConfig({
  ...ultracite,
  ignorePatterns: [
    ...ultracite.ignorePatterns,
    "**/workbench/*/explorations/**",
    "**/workbench/*/campaign.json",
    "**/workbench/*/PROGRESS.md",
    "**/bench/*.json",
    "**/bench/*.jsonl",
    "**/CHANGELOG.md",
  ],
});
