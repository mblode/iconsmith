/**
 * The sanity gate, and the pairing primitives every paired look shares.
 *
 * This file used to hold a VIEScore-style scorer too — two 0–10 sub-scores
 * combined as √(SC × PQ). It was deleted rather than kept: `judgeIcon` had no
 * caller anywhere in `src/`, `scripts/` or `apps/`, `pipeline/eval.ts` has
 * always passed `judge: null`, and so that column never once printed a number.
 * The live rubric is `pipeline/audit.ts`, which asks the same two questions of
 * a drawing inside the pipeline. Two rubrics, one of them dead, is worse than
 * one.
 *
 * What is left is the half that runs, plus the two pieces any paired
 * presentation needs:
 *
 * 1. **Pairing.** `slotFor` and `pair` lay two renders out in an order drawn
 *    from the run seed. A model shown "candidate, then reference" learns the
 *    position rather than the icons, and a reproducible order means a replicate
 *    is re-runnable instead of adding variance that looks like a change.
 * 2. **The gate.** Shown a real shipped icon and an unrelated one for the same
 *    concept, an instrument must prefer the real one at least 90% of the time.
 *    Below that it is not a weak signal to be discounted; it is noise, and
 *    averaging noise into a headline is worse than having no column at all.
 *    Failing **discards the column**.
 *
 * The gate is the cheaper and more important of the two, and it applies to any
 * model asked to look at an icon — including `AUDIT_MODEL`, which decides what
 * ships and had never been put through it.
 */

/** Slot A or slot B, as the judge sees them. Never "candidate"/"reference". */
export type Slot = "a" | "b";

/**
 * Which slot the candidate occupies, from a seed.
 *
 * Deterministic per (seed, icon): a replicate has to be re-runnable, and a
 * judge whose ordering is drawn fresh each run adds variance that looks like a
 * pipeline change.
 */
export const slotFor = (seed: number, icon: string): Slot => {
  // Modulus 2^31 rather than a shift-based mix: every intermediate stays exact
  // in a double (2^31 × 131 is well under 2^53), which is the same arithmetic
  // `pipeline/bench.ts` uses for its string hash.
  let h = Math.abs(Math.trunc(seed)) % 2_147_483_648;
  for (const point of icon) {
    h = (h * 131 + (point.codePointAt(0) ?? 0)) % 2_147_483_648;
  }
  return h % 2 === 0 ? "a" : "b";
};

export interface Pairing {
  /** Which slot holds the icon under test. */
  candidate: Slot;
  /** The two images, in presentation order. */
  a: Buffer;
  b: Buffer;
}

/** Lay two renders out in a randomised, reproducible order. */
export const pair = (
  candidate: Buffer,
  other: Buffer,
  seed: number,
  icon: string
): Pairing => {
  const slot = slotFor(seed, icon);
  return slot === "a"
    ? { a: candidate, b: other, candidate: "a" }
    : { a: other, b: candidate, candidate: "b" };
};

/**
 * The system prompt. Stated as a rubric with anchors rather than "rate this
 * 0–10": an unanchored scale drifts toward 7 for everything, and a column
 * where every entry is 7 has no variance to read.
 */
export const JUDGE_SYSTEM = `You grade icons for an icon set with a strict house spec: 24×24 canvas, 2px round-capped strokes, geometry on a 0.5 grid, edges at 0/45/90 degrees, a small number of elements.

You give two independent scores from 0 to 10.

SC — semantic consistency. Does the drawing read as the named concept, unlabelled, at 16px?
  10  unmistakable; the first thing anyone would name it is the concept
   7  reads as the concept once you know it; a stranger might say something adjacent
   4  the parts of the concept are present but do not assemble into it
   0  reads as something else, or as nothing

PQ — perceptual quality. Is it a competent icon, ignoring what it depicts?
  10  even stroke weight, clean joins, balanced mass, nothing accidental
   7  sound but with a visible awkwardness: a crowded corner, a lopsided element
   4  legible but crude: uneven weight, collisions, drifting alignment
   0  broken geometry, stray marks, or an empty canvas

Score the two independently. A beautiful drawing of the wrong thing scores high PQ and low SC; a clear concept drawn badly scores the reverse. Do not average them yourself.`;

/** The prompt for the sanity gate: a forced choice, not a score. */
export const GATE_PROMPT = (concept: string): string =>
  `Concept: "${concept}".\n\nOne of these two icons ships in a professional icon set and one does not belong to this concept at all. Which is the professional set's icon for "${concept}"?\n\nAnswer as JSON: {"pick": "A" | "B", "why": "<one sentence>"}`;

export interface GateTrial {
  /** Which slot actually held the real icon. */
  answer: Slot;
  icon: string;
  /** What the judge picked. Null when it failed to answer in the required
   *  shape — counted as a miss, because a judge that cannot answer the easy
   *  question is not usable on the hard one. */
  pick: Slot | null;
}

/** Below this the judge column is discarded, not discounted. */
export const GATE_THRESHOLD = 0.9;

export interface GateResult {
  /** Share of trials the judge got right. */
  accuracy: number;
  n: number;
  /** False means: do not report a judge column at all. */
  passed: boolean;
  /** The sentence a report prints when it does not. */
  verdict: string;
}

/**
 * Score the sanity gate.
 *
 * A judge that cannot separate a shipped icon from an unrelated one at 90% is
 * telling you its scores on the real question are noise. There is no partial
 * credit here on purpose: a "weak but usable" judge is exactly the thing that
 * gets averaged into a headline and quietly moves it.
 */
export const scoreGate = (trials: readonly GateTrial[]): GateResult => {
  if (trials.length === 0) {
    return {
      accuracy: 0,
      n: 0,
      passed: false,
      verdict:
        "The judge ran no sanity trials, so its column is discarded. An ungated " +
        "judge is an unmeasured instrument, and this panel does not report those.",
    };
  }
  const right = trials.filter((t) => t.pick === t.answer).length;
  const accuracy = right / trials.length;
  const passed = accuracy >= GATE_THRESHOLD;
  return {
    accuracy,
    n: trials.length,
    passed,
    verdict: passed
      ? `Judge sanity gate passed: ${right}/${trials.length} (${(accuracy * 100).toFixed(0)}%) preferred the shipped icon over a random one.`
      : `Judge sanity gate FAILED: ${right}/${trials.length} (${(accuracy * 100).toFixed(0)}%), below the ${(GATE_THRESHOLD * 100).toFixed(0)}% floor. The judge column is discarded — it cannot separate a shipped icon from an unrelated one, so its scores on the real question are noise.`,
  };
};

/** Parse a gate reply into a slot. Null when the judge did not pick one. */
export const parsePick = (text: string): Slot | null => {
  const match = /"pick"\s*:\s*"(?<slot>[AaBb])"/u.exec(text);
  const slot = match?.groups?.slot?.toLowerCase();
  return slot === "a" || slot === "b" ? slot : null;
};
