/**
 * Semantic fidelity — does the drawing read as the thing it is named after?
 *
 * SigLIP rather than CLIP. CLIP's contrastive softmax is over a batch, so its
 * scores are only comparable within one; SigLIP's pairwise sigmoid loss gives a
 * per-pair score, which is what a fixed 2,201-entry concept bank needs. It also
 * holds up better on sparse black-on-white line art, where CLIP's ImageNet-ish
 * prior has little to grip.
 *
 * **Reported as rank@1, not as a cosine.** A raw image-text cosine of 0.11 is
 * unreadable — SigLIP's scale is arbitrary and shifts with the prompt template.
 * "The correct concept was the top match out of 2,201" is readable by anyone.
 * The margin to the best *wrong* concept comes with it, because rank@1 alone
 * cannot distinguish a confident win from a coin flip.
 *
 * **The ceiling is the real icon's own rank, and it is not 100%.** This is the
 * number the whole metric turns on. The bank has 2,201 concepts and many of
 * them are near-synonyms — `about`→`info`, `academia`→`school` — so the shipped
 * `battery-full` competes against `battery`, `charge`, `power` and `full`. If
 * the real drawing only reaches rank@1 six times in ten, a generated icon at
 * 55% is nearly as legible as the thing it is imitating, and calling that a
 * failure would be measuring SigLIP's vocabulary rather than the pipeline.
 *
 * The floor is a random *other* house icon scored against the same concept —
 * a real, well-drawn icon that simply is not this one, which is what "no
 * information about this concept" looks like on a set where every icon is a
 * competent line drawing.
 */
import type { Embeddings } from "./vectors.js";
import { dot } from "./vectors.js";

/**
 * The concept bank: 2,201 `question → canonical slug` pairs.
 *
 * The key is the UI intent a user would search for and the value is the one
 * icon that answers it. Several concepts map to one slug, so an icon has a
 * *set* of correct answers, not one.
 */
export type ConceptBank = Readonly<Record<string, string>>;

export interface SemanticResult {
  /** Cosine to the best-scoring correct concept. */
  best: number;
  /** The correct concept that scored highest. Null when the icon's slug
   *  answers no concept in the bank — a real state for
   *  a set still growing its concept table, and not the same as ranking last. */
  concept: string | null;
  /** `best − bestWrong`. Negative whenever rank is worse than 1. Signed on
   *  purpose: how badly a wrong concept won is as informative as that one did. */
  margin: number;
  /** 1-based position of the best correct concept among all bank entries. Null
   *  when the slug answers no concept. */
  rank: number | null;
  /** How many concepts the rank is out of, so a rank is readable without
   *  knowing the bank's size. */
  outOf: number;
}

/** Rank the concept bank against one icon's embedding. */
export const semanticRank = (
  image: Float32Array,
  slug: string,
  bank: ConceptBank,
  text: Embeddings
): SemanticResult => {
  const concepts = Object.keys(bank);
  let best = Number.NEGATIVE_INFINITY;
  let bestConcept: string | null = null;
  let bestWrong = Number.NEGATIVE_INFINITY;
  let better = 0;
  let scored = 0;
  // One pass, two accumulators: the best correct score and the count of
  // concepts beating it. Sorting 2,201 scores per icon to read one position out
  // of the array is the same answer for more work, and this runs once per icon
  // per calibration sample.
  const scores: number[] = [];
  for (const concept of concepts) {
    const vector = text.get(concept);
    if (!vector) {
      continue;
    }
    const score = dot(image, vector);
    scores.push(score);
    scored += 1;
    if (bank[concept] === slug) {
      if (score > best) {
        best = score;
        bestConcept = concept;
      }
    } else if (score > bestWrong) {
      bestWrong = score;
    }
  }
  if (bestConcept === null) {
    return { best: 0, concept: null, margin: 0, outOf: scored, rank: null };
  }
  for (const score of scores) {
    if (score > best) {
      better += 1;
    }
  }
  return {
    best,
    concept: bestConcept,
    margin: best - bestWrong,
    outOf: scored,
    rank: better + 1,
  };
};

/** Share of results that reached rank 1. Icons whose slug answers no concept
 *  are dropped, not counted as failures: they are unanswerable questions, and
 *  scoring them 0 would make the rate a measure of concept-table coverage. */
export const rankAt1 = (results: readonly SemanticResult[]): number => {
  const answerable = results.filter((r) => r.rank !== null);
  if (answerable.length === 0) {
    return 0;
  }
  return answerable.filter((r) => r.rank === 1).length / answerable.length;
};

/** Slugs the bank can be asked about at all. Calibration samples are drawn from
 *  here, so a floor and a ceiling are measured over the same questions. */
export const answerableSlugs = (bank: ConceptBank): Set<string> =>
  new Set(Object.values(bank));

/**
 * The prompt template every concept is embedded through.
 *
 * Exported and used by `scripts/embed.py` verbatim. A text sidecar written
 * under one template and read against a calibration measured under another is
 * the failure mode with no symptom: every number stays in range and every one
 * is wrong by an unknown amount.
 */
export const CONCEPT_PROMPT = "a simple black line icon of {}";
