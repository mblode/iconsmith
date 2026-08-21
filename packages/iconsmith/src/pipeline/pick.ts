/**
 * How a best-of-N set is ranked.
 *
 * Shared by the demo and the lab judge so a run cannot "arrive" on a drawing
 * the demo would not have selected. Cosine without `part` picked a
 * pull-request at 0.950 that was the house graph minus the incoming chevron;
 * ranking part ops after the panel and before cosine is the fix. Errors
 * before part count is the next one: a dirty analog with four parts was
 * beating a clean three-ellipse database.
 */
export interface RankedSample {
  cosine: number | null;
  errors: number;
  partsFound: number;
  structural: readonly string[];
}

export const better = (a: RankedSample, b: RankedSample): number =>
  a.structural.length - b.structural.length ||
  a.errors - b.errors ||
  b.partsFound - a.partsFound ||
  (b.cosine ?? 0) - (a.cosine ?? 0);

export const pick = <T extends RankedSample>(samples: readonly T[]): T => {
  const [best] = samples.toSorted(better);
  if (!best) {
    throw new Error("pick() of an empty sample list");
  }
  return best;
};
