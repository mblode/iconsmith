/**
 * The four-number discipline, generalised.
 *
 * `pipeline/eval.ts` reports rendered cosine as floor / baseline / treatment /
 * ceiling because a bare score is unreadable. That discipline is not specific
 * to cosine, and cosine on its own is a weak axis: it rewards ink in roughly
 * the right place and is blind to whether the drawing means anything. So every
 * metric in this directory reports the same four numbers, and every one of the
 * four is **measured on this corpus** and written to `bench/calibration.v1.json`
 * with the procedure and the date. A metric whose floor was assumed rather than
 * measured cannot be read at all: 0.62 is excellent against a floor of 0.15 and
 * a failure against a floor of 0.61.
 *
 * The headline is `reach`:
 *
 *     reach = (treatment − floor) / (baseline − floor)
 *
 * 0 is "no information", 1 is "as good as a different professional set's take
 * on this concept". Above 1 is possible and is not automatically success —
 * `pipeline/eval.ts` treats a cosine above 0.95 as evidence of a leak, and the
 * same suspicion applies here.
 *
 * Reach is deliberately *not* clamped. Clamping a negative reach to 0 hides the
 * case a reader most needs to see — a treatment below the floor, which means
 * the pipeline is doing worse than no information at all and something is wired
 * backwards.
 */

/** A metric's four measured numbers plus the treatment being read against
 *  them. Every field is on the metric's own scale; nothing here is normalised,
 *  because normalising is what `reach` is for. */
export interface Panel {
  /** What "a different professional set's take on this concept" scores. The
   *  target: reach 1. */
  baseline: number;
  /** The best attainable score, measured rather than assumed. It is 1 only
   *  where 1 is actually reachable, which for conformance it is not. */
  ceiling: number;
  /** What "no information" scores. */
  floor: number;
  /** How many observations the floor and baseline were measured over. A panel
   *  calibrated on 12 icons is not the same evidence as one calibrated on
   *  2,221, and a reader cannot tell without this. */
  n: number;
  /** What this run scored. Null when the metric could not be computed — no
   *  embeddings on disk, no judge configured — which is a different fact from
   *  scoring 0 and must never be flattened into one. */
  treatment: number | null;
}

export interface PanelReading extends Panel {
  /** `(treatment − floor) / (baseline − floor)`, or null when treatment is
   *  null or the calibration is degenerate. */
  reach: number | null;
  /** Set when the reading should be disbelieved before it is celebrated. */
  suspect: string | null;
}

/** Above this share of the floor-to-ceiling span, disbelieve the run before
 *  believing the pipeline. Matches the 0.95 in `pipeline/eval.ts` in spirit:
 *  it is stated as a share of the measured span rather than an absolute, so it
 *  transfers to metrics whose ceiling is not 1. */
const SUSPICIOUS_SPAN_SHARE = 0.95;

/**
 * Reach, and the suspicion that goes with it.
 *
 * Null rather than 0 when `baseline === floor`: a zero-width scale makes every
 * treatment infinitely far from the baseline, and reporting `Infinity` or 0
 * would both read as answers. It is not an answer, it is a broken calibration.
 */
export const read = (panel: Panel): PanelReading => {
  const { baseline, ceiling, floor, treatment } = panel;
  const span = baseline - floor;
  const reach =
    treatment === null || span === 0 ? null : (treatment - floor) / span;
  const full = ceiling - floor;
  const suspect =
    treatment !== null &&
    full > 0 &&
    (treatment - floor) / full > SUSPICIOUS_SPAN_SHARE
      ? `Treatment ${treatment.toFixed(3)} sits in the top ${((1 - SUSPICIOUS_SPAN_SHARE) * 100).toFixed(0)}% of the measured floor-to-ceiling span (${floor.toFixed(3)}–${ceiling.toFixed(3)}). Suspect a leak before believing the pipeline.`
      : null;
  return { ...panel, reach, suspect };
};

export const median = (xs: readonly number[]): number => {
  if (xs.length === 0) {
    return 0;
  }
  const s = xs.toSorted((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

const bar = (v: number, lo: number, hi: number): string => {
  const t = hi === lo ? 0 : (v - lo) / (hi - lo);
  return "█".repeat(Math.max(0, Math.round(t * 24))).padEnd(24, "·");
};

/** One metric as four rows and a reach line. */
export const formatPanel = (
  name: string,
  reading: PanelReading,
  notes: { baseline: string; ceiling: string; floor: string },
  /** Conformance is a gate, never a headline, so it prints no reach. A reach
   *  on a gate invites exactly the averaging the gate exists to prevent. */
  showReach = true
): string[] => {
  const lo = Math.min(reading.floor, reading.treatment ?? reading.floor);
  const hi = Math.max(reading.ceiling, reading.treatment ?? reading.ceiling);
  const row = (label: string, v: number | null, note: string) =>
    v === null
      ? `    ${label.padEnd(10)}   ——     ${"·".repeat(24)}  ${note}`
      : `    ${label.padEnd(10)} ${v.toFixed(3)}  ${bar(v, lo, hi)}  ${note}`;
  return [
    showReach
      ? `  ${name} — reach ${reading.reach === null ? "n/a" : reading.reach.toFixed(2)} (n=${reading.n})`
      : `  ${name} (n=${reading.n})`,
    row("floor", reading.floor, notes.floor),
    row("baseline", reading.baseline, notes.baseline),
    row("treatment", reading.treatment, "this pipeline"),
    row("ceiling", reading.ceiling, notes.ceiling),
    ...(reading.suspect ? [`    ! ${reading.suspect}`] : []),
  ];
};
