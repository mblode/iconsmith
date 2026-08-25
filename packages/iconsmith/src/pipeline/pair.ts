/**
 * Twin-pair findings on the product path.
 *
 * `twinPairIssues` lived only in `reach-lab` after it was written, so the
 * agent, analog, mark, glyph, and the missing-house filled fallback never
 * saw an empty tile, a restamped finish, or an extent mismatch. Lab is not
 * the loop. Merge here, on the result the arm returns — including the
 * generate / harness path `iconsmith new` actually runs.
 */
import type { Spec } from "../tools/canvas.js";
import { run as runDsl } from "../tools/dsl.js";
import { adaptProgram, twinPairIssues } from "../tools/twin.js";
import type { TwinPaint } from "../tools/twin.js";
import type { Finish, Issue, Part } from "../types.js";

export const mergeIssues = (
  base: readonly Issue[],
  extra: readonly Issue[]
): Issue[] => {
  const seen = new Set(
    base.map((issue) => `${issue.severity}\0${issue.rule}\0${issue.message}`)
  );
  const out = [...base];
  for (const issue of extra) {
    const key = `${issue.severity}\0${issue.rule}\0${issue.message}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(issue);
  }
  return out;
};

export const pairCanvases = (
  issues: readonly Issue[],
  thisFinish: Finish,
  thisCanvas: TwinPaint,
  otherCanvas: TwinPaint
): Issue[] => {
  const outlined = thisFinish === "outlined" ? thisCanvas : otherCanvas;
  const filled = thisFinish === "filled" ? thisCanvas : otherCanvas;
  return mergeIssues(issues, twinPairIssues(outlined, filled));
};

export const pairPrograms = (
  issues: readonly Issue[],
  thisFinish: Finish,
  thisSource: string,
  otherSource: string,
  parts: readonly Part[] = [],
  spec?: Spec
): Issue[] => {
  const opts = spec ? { spec } : {};
  const here = runDsl(thisSource, [...parts], opts);
  const there = runDsl(otherSource, [...parts], opts);
  return pairCanvases(issues, thisFinish, here.canvas, there.canvas);
};

/**
 * House outlined and filled occupy different extents for these families
 * (check tick vs disc; chevron stroke vs thick `>`; arrow shaft+head
 * vs fat arrow). Extent stays a finding so a restamp is still visible,
 * but it is a warn — matching house construction is the twin, and the
 * house files themselves fail the error gate.
 */
const HOUSE_DIVERGENT = new Set(["arrow", "check", "chevron"]);

/** True when house outlined and filled are different constructions. */
export const paintsDiverge = (id: string): boolean => HOUSE_DIVERGENT.has(id);

/** Extent stays a finding, at the tier a human arbitrates rather than one that blocks. */
const demoteExtent = (issues: readonly Issue[]): Issue[] =>
  issues.map((issue) =>
    issue.rule === "extent" && issue.severity === "error"
      ? { ...issue, severity: "warn" as const }
      : issue
  );

const softenExtent = (issues: readonly Issue[], family: string): Issue[] =>
  paintsDiverge(family) ? demoteExtent(issues) : [...issues];

/** Pair two analog paints, warning — not erroring — on a house-divergent extent. */
export const pairFamily = (
  issues: readonly Issue[],
  thisFinish: Finish,
  thisSource: string,
  otherSource: string,
  family: string,
  parts: readonly Part[] = [],
  spec?: Spec
): Issue[] =>
  softenExtent(
    pairPrograms(issues, thisFinish, thisSource, otherSource, parts, spec),
    family
  );

/**
 * Pair this paint with the other finish derived from the same program.
 *
 * Generate and harness draw one paint. The counterpart is `adaptProgram`,
 * not a second model call — the model never emits a coordinate, and a
 * restamped disc is a failed twin even when this paint lints clean.
 *
 * Extent is a warn here. Against a machine-derived twin it is not evidence of
 * a bad drawing, and it catches neither fault its own message names: a
 * flood-fill *passes* it, because the derived twin floods too and the two
 * extents agree; a restamped ring is caught by `restampIssues`; and a partial
 * arc can never pass it, because `filledArcPath` deliberately omits the cap
 * discs that `visualSize` adds to all four sides. What it did instead was
 * stop icons shipping: 17 of 27 error-severity findings in a post-fix eval
 * run, and an error makes `result.clean` false, which fails `paintAccepted`'s
 * structural gate before the judge is ever called. Of 42 paints, 11 carried
 * extent as their sole error.
 *
 * The cost is paid on purpose and the next reader has to know it:
 * `harness.ts` filters the repair prompt to `severity === "error"`, so a
 * demoted extent no longer reaches the model and extent stops being
 * self-correcting. It stays in `issues` and on the card, for a human.
 */
export const pairAdapted = (
  issues: readonly Issue[],
  finish: Finish,
  source: string,
  parts: readonly Part[] = [],
  spec?: Spec
): Issue[] => {
  if (source.trim() === "") {
    return [...issues];
  }
  const other = finish === "filled" ? "outlined" : "filled";
  return demoteExtent(
    pairPrograms(
      issues,
      finish,
      source,
      adaptProgram(source, other, spec),
      parts,
      spec
    )
  );
};
