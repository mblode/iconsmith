/**
 * Twin-pair findings on the product path.
 *
 * `twinPairIssues` lived only in `reach-lab` after it was written, so the
 * agent, analog, mark, glyph, and the missing-house filled fallback never
 * saw an empty tile, a restamped finish, or an extent mismatch. Lab is not
 * the loop. Merge here, on the result the arm returns.
 */
import type { Spec } from "../tools/canvas.js";
import { run as runDsl } from "../tools/dsl.js";
import { twinPairIssues } from "../tools/twin.js";
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

/**
 * Fit scales path bounds, not visual bounds, so two paints that share a
 * visual extent can still land a quarter-pixel apart. A restamped disc
 * misses by a stroke (~2). This is that gap, not a relaxation of the
 * house 0.01 that compile pairs still use.
 */
const FIT_QUANT = 0.35;

export const pairCanvases = (
  issues: readonly Issue[],
  thisFinish: Finish,
  thisCanvas: TwinPaint,
  otherCanvas: TwinPaint
): Issue[] => {
  const outlined = thisFinish === "outlined" ? thisCanvas : otherCanvas;
  const filled = thisFinish === "filled" ? thisCanvas : otherCanvas;
  return mergeIssues(issues, twinPairIssues(outlined, filled, FIT_QUANT));
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
