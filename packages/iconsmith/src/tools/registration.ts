/**
 * Scoring at best alignment, rather than at the position the ink happens to sit.
 *
 * `render.ts`'s `similarity` compares two rasters pixel for pixel, which makes
 * *where the icon sits on the canvas* part of what it measures. The stress test
 * (`scripts/stress-cosine.ts`) caught what that costs: sliding a whole icon one
 * unit sideways — a change no viewer could name — scored 0.882, **below**
 * deleting an element outright at 0.897. That is an inversion, and it is the
 * cheapest exploit on the board: an optimiser handed a rollout budget finds
 * "translate everything by one unit" before it finds anything about drawing.
 *
 * So the score is taken at the best of a small window of whole-pixel offsets
 * instead. The window is the entire design: it must be wide enough to absorb a
 * registration difference and narrow enough that a misplaced *element* still
 * reads as misplaced. See `WINDOW`.
 */
import { inkVector } from "./render.js";

/**
 * How far, in raster pixels, one icon may be slid over the other.
 *
 * The scoring raster is 48px across a 24-unit canvas, so 1 unit is 2px and this
 * window is exactly ±1 unit — the whole-icon translation the stress test
 * exposed, and no more. It is set from the perturbation it must forgive rather
 * than tuned for the headline: at ±3px `move-element` starts to be forgiven
 * too, and forgiving a misplaced element is the failure mode this is supposed
 * to avoid, not a better score.
 */
export const WINDOW = 2;

/** The raster is square, and `inkVector` is the only thing that fills it. */
const sideOf = (ink: readonly number[]): number => {
  const side = Math.round(Math.sqrt(ink.length));
  if (side * side !== ink.length) {
    throw new Error(
      `registration: expected a square raster, got ${ink.length} pixels`
    );
  }
  return side;
};

/**
 * Cosine of `a` against `b` slid by (dx, dy) pixels.
 *
 * Ink pushed off the edge is dropped and the space it left is white, which is
 * what a translation of a real icon does — the alternative, wrapping, would let
 * a mark leave one side of the canvas and be scored against the other.
 */
export const shiftedCosine = (
  a: readonly number[],
  b: readonly number[],
  dx: number,
  dy: number
): number => {
  const side = sideOf(a);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let y = 0; y < side; y += 1) {
    const sy = y + dy;
    for (let x = 0; x < side; x += 1) {
      const sx = x + dx;
      const av = a[y * side + x];
      const bv =
        sx >= 0 && sx < side && sy >= 0 && sy < side ? b[sy * side + sx] : 0;
      dot += av * bv;
      na += av * av;
      nb += bv * bv;
    }
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
};

/**
 * The best cosine over a window of whole-pixel offsets — the registered score.
 *
 * Whole pixels rather than sub-pixel offsets: on the 48px raster a pixel is
 * half a canvas unit, which is finer than the 0.25 grid tolerance the blur
 * already forgives, so interpolating between them would buy resolution the
 * metric does not have and cost a bilinear resample per offset.
 */
export const registeredCosine = (
  a: readonly number[],
  b: readonly number[],
  window = WINDOW
): number => {
  let best = 0;
  for (let dy = -window; dy <= window; dy += 1) {
    for (let dx = -window; dx <= window; dx += 1) {
      best = Math.max(best, shiftedCosine(a, b, dx, dy));
    }
  }
  return best;
};

/** Ink centre of mass, in pixels. Zero ink has no centre; the caller checks. */
const centroid = (ink: readonly number[]): [number, number] | null => {
  const side = sideOf(ink);
  let sum = 0;
  let sx = 0;
  let sy = 0;
  for (let y = 0; y < side; y += 1) {
    for (let x = 0; x < side; x += 1) {
      const v = ink[y * side + x];
      sum += v;
      sx += v * x;
      sy += v * y;
    }
  }
  return sum > 0 ? [sx / sum, sy / sum] : null;
};

/**
 * Cosine after aligning the two ink centres of mass.
 *
 * The cheaper candidate, kept because it is what the bake-off in
 * `scripts/stress-registration.ts` measured `registeredCosine` against, and
 * because the comparison is the evidence for the window. It is **not** the
 * shipped score: an icon's centre of mass moves when an element is deleted or
 * moved, so aligning to it hands the breaking family the same free correction
 * it hands the preserving one.
 */
export const centroidCosine = (
  a: readonly number[],
  b: readonly number[]
): number => {
  const [ca, cb] = [centroid(a), centroid(b)];
  if (!(ca && cb)) {
    return shiftedCosine(a, b, 0, 0);
  }
  return shiftedCosine(
    a,
    b,
    Math.round(cb[0] - ca[0]),
    Math.round(cb[1] - ca[1])
  );
};

/**
 * Rendered similarity of two SVGs, scored at best alignment.
 *
 * Reads on a different scale from `render.ts`'s `similarity`: every pair scores
 * at least as high, so the 0.737 cross-set baseline and anything calibrated
 * against it must be re-measured before the two are compared.
 */
export const registeredSimilarity = async (
  x: string,
  y: string
): Promise<number> => registeredCosine(await inkVector(x), await inkVector(y));

/** Both scores for one pair: the committed one and the registered one. */
export interface BothScores {
  /** `render.ts`'s cosine at fixed position — the scale 0.737 was measured on. */
  plain: number;
  /** The same pair at best alignment, on the re-baselined scale. */
  registered: number;
}

/**
 * Score a pair both ways, from one pair of rasters.
 *
 * For the transition: a run that records only the new number cannot be compared
 * against a run that recorded only the old one, and re-deriving either after
 * the fact means re-rendering everything. Recording both costs one extra pass
 * of arithmetic over rasters that had to be made anyway — the rendering is the
 * expensive half, and calling `similarity` and `registeredSimilarity` in turn
 * would do it four times instead of twice.
 *
 * The gap between the two is itself the diagnostic the loop needs: a candidate
 * whose `plain` gain does not survive in `registered` won by sliding, which is
 * the 0.416 direction, and should be rejected rather than banked.
 */
export const bothScores = async (x: string, y: string): Promise<BothScores> => {
  const [a, b] = await Promise.all([inkVector(x), inkVector(y)]);
  return {
    plain: shiftedCosine(a, b, 0, 0),
    registered: registeredCosine(a, b),
  };
};
