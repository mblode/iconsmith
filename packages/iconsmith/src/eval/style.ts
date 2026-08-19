import { median } from "./panel.js";
/**
 * Style — does this drawing look like it belongs in the set?
 *
 * DINO ViT-B/8 CLS embeddings, self-supervised and never trained on labels, so
 * what they encode is appearance rather than category. Score = the **median
 * cosine to the k=10 nearest house icons**, which asks "how close is this to
 * the house's own neighbourhood" rather than "how close is this to the house's
 * average", and an average over 2,221 icons of a set that draws arrows and
 * buildings and hearts is not a style.
 *
 * **The concept closure is excluded from the neighbourhood, and that exclusion
 * is the whole reason this is a separate metric.** A generated `folder-open`
 * scored against a house set that still contains `folder-open`, its cohort, its
 * concept siblings and its filled twin does not measure style at all: the
 * nearest neighbours are the answer, and the number is rendered cosine again
 * under a new name. `pipeline/bench.ts` already computes exactly this closure
 * for the corpus the generator sees; the same set is removed here.
 *
 * The three calibration numbers, all measured on this corpus:
 *
 * - **ceiling** — a held-out house icon scored against the rest of the house
 *   set, closure excluded. This is what "genuinely belongs" looks like when the
 *   icon cannot see itself, and it is well under 1.
 * - **baseline** — a *third-party* icon of the same concept scored against the
 *   house set. The honest "another professional set's take" number, and the
 *   `analysis-only` use the licences permit: these icons are measured and
 *   reported on, and never handed to the generator.
 * - **floor** — a third-party icon of an *unrelated* concept scored the same
 *   way. What "no information about this icon" scores, given that every icon
 *   here is a small black line drawing on a 24px canvas and a lot of that
 *   similarity is the medium rather than the set.
 */
import type { Embeddings } from "./vectors.js";
import { dot } from "./vectors.js";

/** Neighbours the median is taken over. 10 is enough that one unusual near-twin
 *  cannot carry the score and small enough that the neighbourhood is still a
 *  neighbourhood rather than the set. */
export const K = 10;

export interface StyleOptions {
  /** Record ids that may not be neighbours: the concept closure. Without this
   *  the metric silently becomes reconstruction. */
  exclude?: ReadonlySet<string>;
  k?: number;
}

/**
 * Median cosine to the k nearest house icons.
 *
 * Null when fewer than `k` candidates survive the exclusion — a median over
 * three neighbours is not the same measurement as a median over ten, and
 * reporting it as though it were is how a calibration stops meaning anything.
 */
export const styleScore = (
  vector: Float32Array,
  house: Embeddings,
  houseIds: readonly string[],
  { exclude, k = K }: StyleOptions = {}
): number | null => {
  const sims: number[] = [];
  for (const id of houseIds) {
    if (exclude?.has(id)) {
      continue;
    }
    const other = house.get(id);
    if (other) {
      sims.push(dot(vector, other));
    }
  }
  if (sims.length < k) {
    return null;
  }
  sims.sort((a, b) => b - a);
  return median(sims.slice(0, k));
};

/** One icon's contribution to a calibration: its id and what it scored. */
export interface StyleSample {
  id: string;
  score: number;
}

export interface StyleCalibrationInput {
  /** Every house record id, in store order. */
  houseIds: readonly string[];
  /** House embeddings, keyed by record id. */
  house: Embeddings;
  k?: number;
}

/**
 * The ceiling: each held-out house icon against the rest of the house set.
 *
 * `closureOf` is injected rather than imported so this stays free of
 * `pipeline/` — the closure is computed there, and a metric module reaching up
 * a layer to get it would invert the import graph the boundary check enforces.
 */
export const styleCeiling = (
  input: StyleCalibrationInput,
  held: readonly string[],
  closureOf: (id: string) => ReadonlySet<string>
): StyleSample[] => {
  const out: StyleSample[] = [];
  for (const id of held) {
    const vector = input.house.get(id);
    if (!vector) {
      continue;
    }
    const score = styleScore(vector, input.house, input.houseIds, {
      exclude: closureOf(id),
      k: input.k,
    });
    if (score !== null) {
      out.push({ id, score });
    }
  }
  return out;
};

/**
 * The baseline and the floor, in one pass over third-party icons.
 *
 * Both are the same measurement — a third-party icon against the house set —
 * differing only in whether the icon draws the same concept as something the
 * house set draws. Splitting them at the call site rather than here would let
 * the two be computed against different neighbourhoods, and then the baseline
 * would not be a scale the floor sits on.
 */
export const styleAgainstHouse = (
  input: StyleCalibrationInput,
  outsiders: readonly { closure: ReadonlySet<string>; id: string }[],
  vectors: Embeddings
): StyleSample[] => {
  const out: StyleSample[] = [];
  for (const outsider of outsiders) {
    const vector = vectors.get(outsider.id);
    if (!vector) {
      continue;
    }
    const score = styleScore(vector, input.house, input.houseIds, {
      exclude: outsider.closure,
      k: input.k,
    });
    if (score !== null) {
      out.push({ id: outsider.id, score });
    }
  }
  return out;
};
