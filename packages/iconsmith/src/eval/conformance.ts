/**
 * Conformance — a **gate**, never a score.
 *
 * Lint measures whether an icon obeys the house spec. It is the one axis here
 * that is trivially gameable: a centred rounded rect on the `square` keyline
 * lints perfectly clean and means nothing. Averaging it into a headline would
 * therefore reward drawing nothing, which is the opposite of what the panel is
 * for. So conformance is read first and separately: an icon with a lint
 * **error** is disqualified, and its style, semantic and judge numbers are not
 * reported at all rather than reported and discounted.
 *
 * Two rates, because they answer different questions and only one of them
 * discriminates.
 *
 * - **`gate`** — no `error`-severity issue. This is the disqualifier, and it
 *   barely separates anybody: measured on the store, blode-icons passes 96.6%
 *   and Tabler passes 99.98%. That is by design. Errors are contradictions
 *   (`empty`, `bleed`, a *claimed* keyline missed, a cohort broken), not
 *   opinions, and a professional set does not ship contradictions.
 * - **`strict`** — no issue of any severity. This is where the house spec
 *   actually lives: blode-icons 33.8%, and the best third-party stroke pack
 *   22.3%. **That gap is the evidence the spec is non-trivial rather than
 *   universal.** A spec every professional set already satisfies is not a spec.
 *
 * Neither rate has a ceiling of 1, and that is the point of measuring them.
 * The shipped set fails its own strict reading two times in three. Holding a
 * generator to 1.0 would hold it to a standard the set it is imitating does not
 * meet.
 *
 * **Fill sets cannot contribute to the floor.** Phosphor, Radix and Remix ship
 * outline-expanded fills: measured on the store they report 0 straight edges
 * and therefore 0 off-axis edges across 3,533 icons, so the `off-axis` rule —
 * one of the four the strict reading turns on — is structurally silent for
 * them. Their strict rates (11.2%, 9.0%, 11.1%) look like conformance evidence
 * and are a rendering fact. `STROKE_PACKS` names the packs a stroke floor may
 * be drawn from; the rest are reported with an explicit reason rather than
 * averaged in.
 */
import type { Issue } from "../types.js";

/**
 * A rendering as the conformance rate reads it. Structurally a subset of
 * `corpus/record.ts`'s `Rendering["lint"]` plus the variant it was measured on
 * — restated rather than imported so this module works on any source of lint
 * counts, including a freshly generated icon that has no record.
 */
export interface LintCounts {
  errors: number;
  warnings: number;
}

/** Did this icon clear the gate? Nothing downstream may read a disqualified
 *  icon's other metrics. */
export const passesGate = (lint: LintCounts): boolean => lint.errors === 0;

/** Did it satisfy the house spec outright? */
export const passesStrict = (lint: LintCounts): boolean =>
  lint.errors === 0 && lint.warnings === 0;

/** `lint()` output reduced to the counts both rates read. */
export const countIssues = (issues: readonly Issue[]): LintCounts => ({
  errors: issues.filter((i) => i.severity === "error").length,
  warnings: issues.filter((i) => i.severity === "warn").length,
});

/**
 * Which rendering of each set is the one a stroke house spec may be compared
 * against, and whether comparing at all is meaningful.
 *
 * `stroke: false` is not a judgement about the pack. Phosphor's `regular`
 * weight is a beautiful stroke *design*; the files ship it as an expanded
 * outline, and an expanded outline has no edges to be off-axis. The variant is
 * still named so the fill sets can be reported — they belong in the report,
 * just not in the average.
 */
export interface PackVariant {
  /** Why this pack is or is not stroke-comparable, in the report's own words. */
  reason: string;
  /** May this pack contribute to a stroke-based floor? */
  stroke: boolean;
  /** The rendering variant to read. One per set: reading all 30 of Central's
   *  would weight Central 30× and measure stroke width, not conformance. */
  variant: string;
}

/** Measured on the 18,658-record store, 2026-08-19. Edge counts are the
 *  evidence: a pack reporting 0 straight edges across its whole set is
 *  outline-expanded, whatever its weights are called. */
export const PACK_VARIANTS: Record<string, PackVariant> = {
  "blode-icons": {
    reason: "the house set",
    stroke: true,
    variant: "outlined",
  },
  central: {
    reason: "the house variant blode-icons is drawn in",
    stroke: true,
    variant: "round-outlined-radius-3-stroke-2",
  },
  heroicons: {
    reason: "1,903 straight edges",
    stroke: true,
    variant: "outline",
  },
  iconoir: { reason: "9,311 straight edges", stroke: true, variant: "regular" },
  lucide: { reason: "11,123 straight edges", stroke: true, variant: "regular" },
  "lucide-static": {
    reason:
      "the same set as `lucide` from npm; measured, reported, and kept out of the pooled floor so Lucide is not counted twice",
    stroke: false,
    variant: "regular",
  },
  phosphor: {
    reason: "0 straight edges in 1,512 icons — outline-expanded fills",
    stroke: false,
    variant: "regular",
  },
  radix: {
    reason: "0 straight edges in 332 icons — outline-expanded fills",
    stroke: false,
    variant: "regular",
  },
  remix: {
    reason: "0 straight edges in 1,689 icons — outline-expanded fills",
    stroke: false,
    variant: "line",
  },
  tabler: { reason: "30,889 straight edges", stroke: true, variant: "outline" },
};

/** The house set, whose own pass rate is the ceiling. */
const HOUSE_SET = "blode-icons";

export interface PackRates {
  /** No error-severity issue. */
  gate: number;
  /** May this pack stand for "somebody else's practice"? False for the house
   *  set and for Central — blode-icons is ~96% Central-derived, so a Central
   *  rate is the house set's own practice wearing a different name, and using
   *  it as a third-party baseline would make the spec look universal. Read
   *  from the record's own `usage`, which the source registry wrote. */
  thirdParty: boolean;
  n: number;
  set: string;
  /** Why this pack is or is not in the pooled floor. */
  reason: string;
  /** No issue of any severity. */
  strict: number;
  stroke: boolean;
}

/** The minimum a rate needs to be worth quoting. Below this a pack's rate is
 *  one or two icons wide and moves by 10 points when one is redrawn. */
const MIN_SAMPLE = 50;

/** Just enough of a store record for a conformance rate. */
export interface ConformanceRecord {
  provenance: { set: string; usage: string };
  renderings: readonly { lint: LintCounts; variant: string }[];
}

/**
 * Pass rates per pack, one rendering per icon.
 *
 * Packs with no entry in `PACK_VARIANTS` are skipped rather than guessed at: a
 * variant chosen by heuristic would silently compare a fill against a stroke
 * spec, which is the mistake this whole module is arranged to prevent.
 */
export const packRates = (
  records: readonly ConformanceRecord[]
): PackRates[] => {
  const acc = new Map<
    string,
    { gate: number; n: number; strict: number; usage: string }
  >();
  for (const record of records) {
    const { set } = record.provenance;
    const pack = PACK_VARIANTS[set];
    if (!pack) {
      continue;
    }
    for (const rendering of record.renderings) {
      if (rendering.variant !== pack.variant) {
        continue;
      }
      const a = acc.get(set) ?? {
        gate: 0,
        n: 0,
        strict: 0,
        usage: record.provenance.usage,
      };
      a.n += 1;
      if (passesGate(rendering.lint)) {
        a.gate += 1;
      }
      if (passesStrict(rendering.lint)) {
        a.strict += 1;
      }
      acc.set(set, a);
    }
  }
  return [...acc]
    .filter(([, a]) => a.n >= MIN_SAMPLE)
    .map(([set, a]) => ({
      gate: a.gate / a.n,
      n: a.n,
      reason: PACK_VARIANTS[set].reason,
      set,
      strict: a.strict / a.n,
      stroke: PACK_VARIANTS[set].stroke,
      thirdParty: a.usage === "analysis-only",
    }))
    .toSorted((x, y) => x.set.localeCompare(y.set));
};

export interface ConformanceCalibration {
  /** Every pack measured, fill sets included, so the exclusion is auditable
   *  rather than invisible. */
  packs: PackRates[];
  /** The pooled third-party stroke rate: what "no house spec" scores. */
  floor: { gate: number; n: number; sets: string[]; strict: number };
  /** The best single third-party stroke pack: what "another professional set"
   *  scores. Best, not mean — the baseline is the standard to reach, and a
   *  mean over packs of unequal quality is not a standard. */
  baseline: { gate: number; set: string; strict: number };
  /** The house set's own rate. Not 1, and that is the finding. */
  ceiling: { gate: number; n: number; set: string; strict: number };
  /** Named here rather than left implicit: these are the packs whose geometry
   *  cannot answer a stroke question. */
  excluded: { reason: string; set: string }[];
}

/** Thrown when there is nothing honest to calibrate against. */
export class ConformanceCalibrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConformanceCalibrationError";
  }
}

/**
 * Floor, baseline and ceiling for conformance, measured from a store.
 *
 * The floor pools third-party stroke packs by icon rather than averaging their
 * rates: Heroicons ships 324 icons and Tabler 5,093, and a mean of the two
 * rates would give Heroicons sixteen times its weight in a number that claims
 * to describe "third-party practice".
 */
export const calibrateConformance = (
  records: readonly ConformanceRecord[]
): ConformanceCalibration => {
  const packs = packRates(records);
  const house = packs.find((p) => p.set === HOUSE_SET);
  if (!house) {
    throw new ConformanceCalibrationError(
      `The store holds no ${HOUSE_SET} records, so conformance has no ceiling. ` +
        "Without a ceiling every rate below is unreadable: a generator at 0.30 is " +
        "either near the shipped set's own practice or half of it. Rebuild with " +
        "`iconsmith corpus build`."
    );
  }
  const third = packs.filter((p) => p.stroke && p.thirdParty);
  if (third.length === 0) {
    throw new ConformanceCalibrationError(
      "No third-party stroke pack in the store, so conformance has no floor. " +
        "Fill sets cannot supply one: they report no off-axis edges at all, so " +
        "their rate measures a rendering choice rather than the house spec."
    );
  }
  let n = 0;
  let [best] = third;
  for (const pack of third) {
    n += pack.n;
    if (pack.strict > best.strict) {
      best = pack;
    }
  }
  let gateSum = 0;
  let strictSum = 0;
  for (const pack of third) {
    gateSum += pack.gate * pack.n;
    strictSum += pack.strict * pack.n;
  }
  return {
    baseline: { gate: best.gate, set: best.set, strict: best.strict },
    ceiling: {
      gate: house.gate,
      n: house.n,
      set: house.set,
      strict: house.strict,
    },
    excluded: packs
      .filter((p) => !p.stroke)
      .map((p) => ({ reason: p.reason, set: p.set })),
    floor: {
      gate: gateSum / n,
      n,
      sets: third.map((p) => p.set),
      strict: strictSum / n,
    },
    packs,
  };
};
