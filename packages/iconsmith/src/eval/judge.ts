/**
 * The judge — VIEScore-style, with a sanity gate it has to pass before its
 * column is printed at all.
 *
 * Two 0–10 sub-scores with written rationale:
 *
 * - **SC, semantic consistency** — does this drawing read as the concept?
 * - **PQ, perceptual quality** — is it a competent icon: clean joins, even
 *   weight, balanced, no artefacts?
 *
 * Combined as **√(SC × PQ)**, not the mean. A 10/0 — a perfectly legible
 * concept drawn as a mess, or an immaculate mark of the wrong thing — is a
 * failure, and the geometric mean says so (0) where the arithmetic mean says 5.
 * That is the whole reason VIEScore uses it and the reason it is used here.
 *
 * Two guards, because an LLM judge is the least trustworthy instrument in the
 * panel and the easiest to believe.
 *
 * 1. **Presentation order is randomised.** A judge shown "candidate, then
 *    reference" learns the position, not the icons. The order is drawn from the
 *    run seed so it is reproducible, and the mapping is kept out of the prompt.
 * 2. **The judge must clear a sanity gate before its column is reported.**
 *    Shown a real shipped icon and a random other icon for the same concept, it
 *    must prefer the real one at least 90% of the time. A judge that cannot do
 *    that is not a weak signal to be discounted; it is noise, and averaging
 *    noise into a headline is worse than having no judge column. Failing the
 *    gate **discards the column**.
 */

/** Slot A or slot B, as the judge sees them. Never "candidate"/"reference". */
export type Slot = "a" | "b";

export interface JudgeScores {
  /** Perceptual quality, 0–10. */
  pq: number;
  /** Why, in the judge's own words. A number with no rationale cannot be
   *  audited, and an unauditable judge is the one that quietly drifts. */
  rationale: string;
  /** Semantic consistency, 0–10. */
  sc: number;
}

/** √(SC × PQ), on the 0–10 scale. Clamped at 0 rather than returning NaN for a
 *  negative score the model should never emit but occasionally does. */
export const viescore = ({ pq, sc }: Pick<JudgeScores, "pq" | "sc">): number =>
  Math.sqrt(Math.max(0, sc) * Math.max(0, pq));

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

/** The per-icon prompt. Deliberately never names which slot is which. */
export const judgePrompt = (concept: string, slot: Slot): string =>
  `Concept: "${concept}".\n\nGrade the icon in slot ${slot.toUpperCase()}. The other slot is shown only for scale and house context; do not grade it, and do not assume either slot is the "real" one.\n\nAnswer as JSON: {"sc": <0-10>, "pq": <0-10>, "rationale": "<one or two sentences>"}`;

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

/**
 * Parse the judge's reply.
 *
 * Tolerant of a fenced block, because models wrap JSON in one about a third of
 * the time and a run thrown away over a code fence is a run paid for twice.
 * Not tolerant of a missing or out-of-range score: a judge that answers `{"sc":
 * "high"}` has not answered, and coercing that to a number invents a
 * measurement.
 */
const inRange = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 10;

export const parseScores = (text: string): JudgeScores | null => {
  const match = /\{[\s\S]*\}/u.exec(text);
  if (!match) {
    return null;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(match[0]);
  } catch {
    return null;
  }
  const obj = raw as { pq?: unknown; rationale?: unknown; sc?: unknown };
  if (!(inRange(obj.sc) && inRange(obj.pq))) {
    return null;
  }
  return {
    pq: obj.pq,
    rationale: typeof obj.rationale === "string" ? obj.rationale : "",
    sc: obj.sc,
  };
};

/** Parse a gate reply into a slot. Null when the judge did not pick one. */
export const parsePick = (text: string): Slot | null => {
  const match = /"pick"\s*:\s*"(?<slot>[AaBb])"/u.exec(text);
  const slot = match?.groups?.slot?.toLowerCase();
  return slot === "a" || slot === "b" ? slot : null;
};
