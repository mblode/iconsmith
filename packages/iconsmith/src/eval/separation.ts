/**
 * The separation gate — the judge's sanity check, applied to every metric.
 *
 * `judge.ts` discards the judge column when the judge cannot tell a shipped
 * icon from a random one, on the grounds that an instrument which fails the
 * easy question is not a weak signal but noise. **That argument is not specific
 * to the judge.** A style metric whose baseline sits 0.007 above its floor is
 * making the same claim about itself: it cannot tell "another professional
 * set's icon" from "an icon of something else entirely", and a `reach` computed
 * against a 0.007-wide scale multiplies its own sampling noise by 140.
 *
 * So every metric that has a floor sample and a baseline sample is scored the
 * same way, by the **AUC** — the probability that a randomly drawn baseline
 * observation beats a randomly drawn floor one. 0.5 is chance. It is used
 * rather than a t-statistic because it does not assume a distribution and
 * because it is readable: "the baseline beats the floor 54% of the time" needs
 * no further explanation to be damning.
 *
 * This gate is what a measured floor is *for*. Without it, a metric with no
 * signal still produces a confident-looking `reach` on every run, and nothing
 * in the report says the number is made of noise.
 */

/**
 * Probability that a random `a` exceeds a random `b`, ties counted as half.
 *
 * O(n·m) rather than the rank-sum shortcut: the samples here are a few hundred
 * each, and the direct form is the definition rather than a transformation of
 * it, which matters for a number whose whole job is to be checkable.
 */
export const auc = (a: readonly number[], b: readonly number[]): number => {
  if (a.length === 0 || b.length === 0) {
    return 0.5;
  }
  let wins = 0;
  for (const x of a) {
    for (const y of b) {
      if (x > y) {
        wins += 1;
      } else if (x === y) {
        wins += 0.5;
      }
    }
  }
  return wins / (a.length * b.length);
};

/**
 * Below this, the metric's column is discarded rather than reported.
 *
 * 0.65 is roughly Cohen's d = 0.55 — a medium effect. Chosen as the point where
 * a metric can still order two pipelines that differ substantially, and below
 * which it cannot order anything. It is deliberately not 0.5-and-a-bit:
 * "statistically distinguishable given enough samples" is not the same as
 * "usable as a headline", and this panel reports headlines.
 */
export const SEPARATION_THRESHOLD = 0.65;

export interface Separation {
  /** P(baseline > floor). */
  auc: number;
  /** False means: do not report this metric's column. */
  usable: boolean;
  verdict: string;
}

export const separation = (
  name: string,
  baseline: readonly number[],
  floor: readonly number[]
): Separation => {
  const value = auc(baseline, floor);
  const usable = value >= SEPARATION_THRESHOLD;
  return {
    auc: value,
    usable,
    verdict: usable
      ? `${name}: baseline beats floor ${(value * 100).toFixed(0)}% of the time (AUC ${value.toFixed(3)}), above the ${SEPARATION_THRESHOLD} bar.`
      : `${name}: DISCARDED — baseline beats floor only ${(value * 100).toFixed(0)}% of the time (AUC ${value.toFixed(3)}, chance is 50%). The metric cannot separate "another professional set's take" from "an unrelated icon", so a reach computed against this scale would be noise with a decimal point.`,
  };
};
