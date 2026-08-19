/**
 * The reconstruction eval.
 *
 * Hold out icons a real set already draws, hand the model only the name, the
 * category and the tags, and see how close what it draws lands to what the set
 * actually shipped. The target is never shown; if it were, this would measure
 * copying.
 *
 * **A score on its own says nothing.** 0.69 is either good or terrible
 * depending on what the scale means here, so every run reports four numbers:
 *
 *   floor      a random icon from the set against the target — what "no
 *              information" scores, given that all icons share a canvas, a
 *              stroke width and a lot of white
 *   baseline   0.737, the measured median rendered cosine between two mature
 *              icon sets drawing the same concept. This is the target: it is
 *              what "a different professional set's take on this concept"
 *              scores, and it is the most a reconstruction can honestly aim at
 *   treatment  what this pipeline scored
 *   ceiling    1.0, the target against itself
 *
 * Treatment near the ceiling is not success, it is a bug — most likely the
 * target leaking into the prompt or the two SVGs being the same file.
 *
 * **Two things make the numbers comparable across months**, and both live in
 * `bench.ts`. The sample is a committed benchmark file carrying its ids, so
 * adding an icon to blode-icons cannot change which icons a run holds out. And
 * what is withheld is a *concept closure* rather than a name: the slug, its
 * cohort in both styles, its 30 Central finishes, everything sharing its
 * concept and its filled twin. Excluding the string `folder-open` while
 * leaving eleven folders in the corpus withholds the label and hands over the
 * answer.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import type { LanguageModel } from "ai";

import type { Usage } from "../corpus/record.js";
import type { Calibration } from "../eval/calibration.js";
import { loadCalibration } from "../eval/calibration.js";
import type { GateResult } from "../eval/judge.js";
import type { MetricReport, PanelTreatments } from "../eval/report.js";
import { buildReport, formatMetrics } from "../eval/report.js";
import { cosine, inkVector } from "../tools/render.js";
import type { Part, Provenance } from "../types.js";
import { benchmarkExclusions, redactParts, slice } from "./bench.js";
import type { BenchmarkEntry } from "./bench.js";
import type { Rate, RateTable, TokenUsage } from "./cost.js";
import {
  EMPTY_USAGE,
  RATES,
  addUsage,
  rateFor,
  reachPoints,
  usdOf,
} from "./cost.js";
import { generate, resolveModel } from "./generate.js";
import type { GenerateOptions, GenerateResult } from "./generate.js";
import { asReferences } from "./licence.js";
import type { Reference } from "./licence.js";
import type { Policy } from "./policy.js";
import type { Concept } from "./prompt.js";

/** Median rendered cosine between two mature sets drawing the same concept. */
export const BASELINE = 0.737;
export const CEILING = 1;
/** Above this, disbelieve the run before believing the pipeline. */
const SUSPICIOUS = 0.95;

/**
 * The provenance an eval may condition on.
 *
 * An eval shows the model every icon in the set except the held-out ones, so
 * the set at `dir` is conditioning material, not a baseline — which makes this
 * the entry point that has to state where it came from. `Usage` is the corpus
 * record's own field: of the 18,658 records `corpus build` writes, blode-icons
 * and Central are `conditioning` and the eight third-party sets are
 * `analysis-only`. Narrowing to the one member is what makes handing an
 * analysis-only record to an eval fail to compile rather than fail at runtime.
 */
export interface ConditioningProvenance extends Provenance {
  usage: Extract<Usage, "conditioning">;
}

export interface EvalIcon {
  category?: string;
  icon: string;
  svg: string;
  tags: string[];
}

export interface LoadOptions {
  /** Per-icon metadata: `{ icon, category, tags }`. Default `<dir>/icons-data`. */
  dataDir?: string;
  /** Outline SVGs. Default `<dir>/icons-svg`. */
  svgDir?: string;
}

/** Suffixes that name a drawing in its filled finish. Kept beside the guard
 *  rather than imported from `bench.ts`, because this check must hold for every
 *  icon reaching the model, benchmark or not. */
const FILLED_SUFFIXES = ["-filled", "-fill", "-solid"];

/**
 * Read an icon set laid out as blode-icons is: SVGs beside per-icon metadata.
 * Filled twins are skipped — they are a second rendering of an icon already in
 * the set, not a second icon, and scoring against one measures fill.
 */
export const loadIconSet = (
  dir: string,
  options: LoadOptions = {}
): EvalIcon[] => {
  const svgDir = options.svgDir ?? path.join(dir, "icons-svg");
  const dataDir = options.dataDir ?? path.join(dir, "icons-data");
  const out: EvalIcon[] = [];
  for (const file of readdirSync(svgDir)) {
    if (
      !file.endsWith(".svg") ||
      FILLED_SUFFIXES.some((suffix) => file.endsWith(`${suffix}.svg`))
    ) {
      continue;
    }
    const icon = path.basename(file, ".svg");
    let meta: { category?: string; tags?: string[] } = {};
    try {
      meta = JSON.parse(
        readFileSync(path.join(dataDir, `${icon}.json`), "utf-8")
      );
    } catch {
      // Metadata is optional: an icon with no tags is still a valid target,
      // just a harder one. Dropping it would quietly bias the sample toward
      // well-documented icons.
    }
    out.push({
      category: meta.category,
      icon,
      svg: readFileSync(path.join(svgDir, file), "utf-8"),
      tags: meta.tags ?? [],
    });
  }
  return out.toSorted((a, b) => a.icon.localeCompare(b.icon));
};

/** Modulus of the LCG below: 2^31, which stays exact in a double through the
 *  multiply. */
const LCG_M = 2_147_483_648;

/**
 * Deterministic PRNG. This now picks the floor comparison icon and nothing
 * else — the hold-out sample is a committed file, not a shuffle — and nothing
 * about a floor draw needs statistical quality, only that two runs of one seed
 * agree.
 */
const rng = (seed: number): (() => number) => {
  let s = Math.abs(Math.trunc(seed)) % LCG_M;
  return () => {
    s = (s * 1_103_515_245 + 12_345) % LCG_M;
    return s / LCG_M;
  };
};

export const median = (xs: number[]): number => {
  if (xs.length === 0) {
    return 0;
  }
  const s = xs.toSorted((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

/** What is known about a held-out icon before its generation is attempted, and
 *  all that is still known if the attempt throws. */
export interface IconTarget {
  category?: string;
  /** A random other icon against the target — this icon's share of the floor. */
  floor: number;
  icon: string;
  tags: string[];
}

/** A generation that returned an SVG, and therefore a measurement. */
export interface IconMeasured extends IconTarget {
  /** Lint had no errors. */
  clean: boolean;
  issues: number;
  /** Wall time for this generation, milliseconds. Null when unmeasured. */
  ms: number | null;
  score: number;
  status: "ok";
  /**
   * Why the model stopped, verbatim from the generator. Null when unmeasured.
   *
   * Deliberately an open `string` rather than a union of the reasons the loop
   * happens to emit today. The stop conditions are being reworked to name
   * distinct outcomes, and a union here would turn every new outcome into a
   * change to this type and to `summariseCost`'s tally — which counts by key
   * and so already carries whatever arrives.
   */
  stopReason: string | null;
  steps: number;
  /**
   * The drawing itself, as the generator produced it.
   *
   * Carried rather than discarded because `score` cannot stand in for it. The
   * scorer is a rendered cosine, and `stress-cosine.ts` measured that a dot
   * redrawn two tiers too large scores 0.988 — inside the band a legal 0.25u
   * jitter produces. No threshold on this number resolves element sizing,
   * badge placement or margin, so the blind-spot panel in `eval/blindspot.ts`
   * measures the geometry directly and needs the geometry to measure.
   */
  svg: string;
  toolCalls: Record<string, number>;
  usage: TokenUsage | null;
  /** Null when the model has no published rate, or the generator reported no
   *  usage. Never 0 — 0 reads as free. */
  usd: number | null;
}

/** A generation that threw. It carries no `score`, because there is none: a
 *  rate limit is not a drawing that scored 0. */
export interface IconFailed extends IconTarget {
  error: string;
  status: "error";
}

/**
 * One benchmark entry's outcome.
 *
 * Tagged, and the tag is the whole point. Success and failure used to be
 * independently optional fields with a comment promising `score` was 0 on a
 * throw — which meant a rate limit contributed a perfect 0.0 to the median and
 * nothing in the type system objected. An arm with more failure surface than
 * its control (an extra model call, say) would then lose an A/B on flakiness
 * alone. Now an errored entry cannot be read as a measurement without
 * narrowing first.
 */
export type IconScore = IconMeasured | IconFailed;

/** Narrow to the entries that produced a number. Every aggregate filters
 *  through this; nothing else may. */
export const scored = (s: IconScore): s is IconMeasured => s.status === "ok";

export interface CostReport {
  /** Sum over icons that reported one. */
  msTotal: number;
  msMedian: number;
  /** The rate table used, copied in. A report whose dollar figure cannot be
   *  reconstructed six months later is a dead report. */
  rates: RateTable;
  /** How many icons reported usage at all. Below `n`, every dollar figure
   *  under-reports and the report says so rather than implying a discount. */
  measured: number;
  stopReasons: Record<string, number>;
  toolCalls: Record<string, number>;
  usage: TokenUsage;
  usd: number | null;
  usdPerIcon: number | null;
  /** Dollars per point of the floor-to-baseline scale. Null when reach is at
   *  or below the floor: dividing by a non-positive denominator produces a
   *  number that looks like an answer. */
  usdPerReachPoint: number | null;
}

export interface EvalReport {
  /** Set when a spend cap stopped the run. The scores present are real; the
   *  benchmark they came from is a prefix, so treatment is not comparable to a
   *  complete run. */
  aborted: string | null;
  baseline: number;
  /**
   * Which committed benchmark this ran, and how much of it.
   *
   * `entries` counts the icons that produced a measurement, `errors` the ones
   * whose generation threw, and `requested` what the slice asked for. The three
   * only agree when nothing failed and nothing was capped — and when they
   * disagree, the gap is the thing to read before the treatment.
   */
  benchmark: {
    entries: number;
    errors: number;
    requested: number;
    seed: number;
  };
  ceiling: number;
  cost: CostReport;
  /** Median floor across the sample. */
  floor: number;
  /** Every entry the run reached: the measured ones weakest-first, then the
   *  failed ones. Narrow with `scored` before reading a number off one. */
  icons: IconScore[];
  /** Mean score across the *measured* icons. */
  mean: number;
  model: string;
  /** How many icons produced a measurement. Not the sample size requested —
   *  see `benchmark.errors` for the difference. */
  n: number;
  /** The run seed: it labels the replicate and picks the floor comparisons. It
   *  does not choose the sample — the benchmark file does. */
  seed: number;
  /**
   * The four-axis metric panel, or null when no calibration is on disk.
   *
   * Rendered cosine above is one axis and a weak one: it rewards ink in roughly
   * the right place and is blind to meaning. `src/eval/` adds conformance as a
   * gate, style, semantic legibility and a judge, each against a floor and a
   * ceiling measured on this corpus rather than assumed. Conformance is always
   * computable from a run; the others need embedding sidecars or a judge and
   * report `null` when those are absent.
   */
  metrics: MetricReport | null;
  /** Set when the result is too good to be true. */
  suspect: string | null;
  /**
   * Median score across the measured icons — median, to match how the baseline
   * was measured. Comparing a mean against a median baseline is not a
   * comparison.
   *
   * Errored generations are excluded rather than entered as 0. An arm that
   * makes an extra model call has strictly more failure surface than its
   * control, so folding its throws in as perfect zeros would let infrastructure
   * flakiness alone decide an A/B.
   */
  treatment: number;
}

/** The seam every test reaches through: swap the generator, keep the scoring. */
export type GenerateFn = (
  concept: Concept,
  options: GenerateOptions
) => Promise<GenerateResult>;

export interface EvalOptions {
  /** The committed benchmark's entries. Required: there is no unseeded,
   *  uncommitted sampling path any more, because that is the thing that made
   *  two runs incomparable. */
  benchmark: readonly BenchmarkEntry[];
  concurrency?: number;
  /** The measured metric scales. Defaults to `bench/calibration.v1.json`; pass
   *  `null` to skip the panel entirely. */
  calibration?: Calibration | null;
  /** Root of the icon set, or pass `icons` directly. */
  dir?: string;
  generate?: GenerateFn;
  icons?: EvalIcon[];
  load?: LoadOptions;
  /** Stop the run once spend passes this, rather than discovering the cost
   *  afterwards. */
  maxSpendUsd?: number;
  /** A variant design language for this arm. Omit for the house policy. */
  policy?: Policy;
  maxSteps?: number;
  model?: LanguageModel;
  onIcon?: (score: IconScore) => void;
  parts?: Part[];
  /** The judge's sanity-gate result for the judge that scored this run. Null
   *  means no judge ran, and the column is not reported — a judge column is
   *  only printed after its gate passes. */
  judgeGate?: GateResult | null;
  /** Treatments for the metrics this loop cannot compute itself: style and
   *  semantic need embedding sidecars for the *generated* SVGs, which come from
   *  the same batch stage as the corpus vectors, and the judge costs money. */
  metricTreatments?: Partial<PanelTreatments>;
  /** Where the set at `dir` (or in `icons`) comes from. Required, and checked:
   *  every non-held icon is handed to the model, so a run against someone
   *  else's pack is a licence breach the moment it starts. */
  provenance: ConditioningProvenance;
  rates?: RateTable;
  seed?: number;
  /** Run only the first `slice` entries by rank. The ordering is balanced at
   *  every prefix, so this is a smaller benchmark rather than a biased one. */
  slice?: number;
}

/**
 * Refuse to condition on a filled twin, whatever loaded it.
 *
 * A filled twin is not a cohort sibling, it is the *same drawing* outline
 * expanded — the answer in a different finish. `loadIconSet` filters the same
 * suffix list, so this should be unreachable through that path — but it was
 * not: the loader once matched `-filled.svg` alone while this guard checked
 * three suffixes, and a set carrying `box-2-alt-fill.svg` walked straight
 * through the filter into the guard. Both now read one list. The guard stays
 * because the protection lives in a loader filter, while the record store
 * keys one drawn identity with a rendering per finish. The first reader that
 * walks records rather than files takes the filter with it and leaves the
 * closure as the only guard, and a closure is per-benchmark-entry. This check
 * is not, so it catches any path.
 *
 * A plain `Error`: it is thrown before any generation runs, nothing catches it
 * by type, and the file is already at its one-class budget for
 * `BenchmarkMismatchError`.
 */
export const assertNoFilledTwin = (icons: readonly EvalIcon[]): void => {
  const filled = icons
    .map((i) => i.icon)
    .filter((name) => FILLED_SUFFIXES.some((suffix) => name.endsWith(suffix)));
  if (filled.length === 0) {
    return;
  }
  throw new Error(
    `${filled.length} filled icon(s) reached the conditioning corpus: ` +
      `${filled.slice(0, 5).join(", ")}${filled.length > 5 ? ", …" : ""}. ` +
      "A filled twin is the same drawing outline-expanded, so showing one is " +
      "showing the target in another finish. Condition on outlines only."
  );
};

/** Thrown when the benchmark and the icon set disagree. Loud, because a
 *  benchmark that silently shrinks when an icon is renamed is the failure this
 *  whole file exists to prevent. */
export class BenchmarkMismatchError extends Error {
  constructor(missing: string[]) {
    super(
      `The benchmark names ${missing.length} icon(s) the set does not contain: ` +
        `${missing.slice(0, 10).join(", ")}${missing.length > 10 ? ", …" : ""}. ` +
        "A run against a shrunken sample is not comparable to one against the " +
        "whole file. Rebuild the benchmark with `iconsmith bench` if the " +
        "set really has changed."
    );
    this.name = "BenchmarkMismatchError";
  }
}

/** Fixed-size worker pool. Generations are long and network-bound; running them
 *  one at a time makes a 20-icon eval an afternoon. */
const pool = async <T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R | null>
): Promise<(R | null)[]> => {
  const out: (R | null)[] = Array.from({ length: items.length });
  let cursor = 0;
  // Each worker takes the next index and recurses rather than looping, so the
  // await is not inside a loop; the recursion is one frame per item a single
  // worker handles, and every frame is released at its await.
  const worker = async (): Promise<void> => {
    const i = cursor;
    if (i >= items.length) {
      return;
    }
    cursor += 1;
    out[i] = await fn(items[i], i);
    await worker();
  };
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker)
  );
  return out;
};

const scoreOf = (
  base: IconTarget,
  result: GenerateResult,
  score: number,
  rate: Rate | null
): IconMeasured => ({
  ...base,
  clean: result.clean,
  issues: result.issues.length,
  ms: result.cost?.ms ?? null,
  score,
  status: "ok",
  steps: result.steps,
  stopReason: result.cost?.finishReason ?? null,
  svg: result.svg,
  toolCalls: result.cost?.toolCalls ?? {},
  usage: result.cost?.usage ?? null,
  usd: result.cost && rate ? usdOf(result.cost.usage, rate) : null,
});

/**
 * Refuse a spend cap the run cannot honour.
 *
 * `spent` only moves when a generation can be priced, so a model missing from
 * the rate table would run the whole benchmark with `--max-spend` set and
 * silently ignored. A cap that cannot bind is worse than no cap, because the
 * caller believes they are protected.
 */
const assertCapCanBind = (
  maxSpendUsd: number | undefined,
  rate: Rate | null,
  modelId: string
): void => {
  if (maxSpendUsd !== undefined && rate === null) {
    throw new Error(
      `No price for "${modelId}", so --max-spend cannot be enforced and would be silently ignored. Add it to the rate table in cost.ts, or drop the cap and accept an unbounded run.`
    );
  }
};

/**
 * Cost over the icons that produced a measurement.
 *
 * Errored entries are excluded by the caller and that is deliberate: they spent
 * whatever the failed call spent, but the generator reports no usage for a
 * throw, so counting them would put a zero in `usdPerIcon` and add a phantom to
 * the "reported no usage" warning. The error count is reported separately, on
 * the report itself.
 */
const summariseCost = (
  scores: IconMeasured[],
  rates: RateTable,
  treatment: number,
  floor: number
): CostReport => {
  const measured = scores.filter((s) => s.usage !== null);
  let usage = EMPTY_USAGE;
  for (const s of measured) {
    usage = addUsage(usage, s.usage ?? EMPTY_USAGE);
  }
  const priced = scores.filter((s) => s.usd !== null);
  const usd =
    priced.length === 0 ? null : priced.reduce((a, s) => a + (s.usd ?? 0), 0);
  const times = scores.map((s) => s.ms).filter((m): m is number => m !== null);
  const toolCalls: Record<string, number> = {};
  const stopReasons: Record<string, number> = {};
  for (const s of scores) {
    for (const [name, n] of Object.entries(s.toolCalls)) {
      toolCalls[name] = (toolCalls[name] ?? 0) + n;
    }
    if (s.stopReason !== null) {
      stopReasons[s.stopReason] = (stopReasons[s.stopReason] ?? 0) + 1;
    }
  }
  const points = reachPoints(treatment, floor, BASELINE);
  return {
    measured: measured.length,
    msMedian: median(times),
    msTotal: times.reduce((a, b) => a + b, 0),
    rates,
    stopReasons,
    toolCalls,
    usage,
    usd,
    usdPerIcon:
      usd === null || scores.length === 0 ? null : usd / scores.length,
    usdPerReachPoint: usd === null || points <= 0 ? null : usd / points,
  };
};

export const evaluate = async (options: EvalOptions): Promise<EvalReport> => {
  const {
    benchmark,
    calibration = loadCalibration(),
    concurrency = 2,
    dir,
    generate: gen = generate,
    load,
    maxSpendUsd,
    policy,
    maxSteps,
    model,
    onIcon,
    parts = [],
    provenance,
    rates = RATES,
    seed = 1,
  } = options;

  const all = options.icons ?? (dir ? loadIconSet(dir, load) : []);
  if (all.length === 0) {
    throw new Error("No icons to evaluate: pass `dir` or `icons`.");
  }
  const entries = slice(benchmark, options.slice);
  if (entries.length === 0) {
    throw new Error("The benchmark slice is empty: nothing to evaluate.");
  }
  // Resolved once, before any work: a missing key should fail on the first line
  // of output, not `n` times after the first generation has already run.
  const resolved = resolveModel(model);
  const modelId = typeof resolved === "string" ? resolved : resolved.modelId;
  const rate = rateFor(modelId, rates);
  assertCapCanBind(maxSpendUsd, rate, modelId);

  const byName = new Map(all.map((i) => [i.icon, i]));
  const missing = entries.filter((e) => !byName.has(e.slug)).map((e) => e.slug);
  if (missing.length > 0) {
    throw new BenchmarkMismatchError(missing);
  }
  const held = entries.map((e) => byName.get(e.slug) as EvalIcon);

  // The corpus the model may compare against excludes the whole **concept
  // closure** of every benchmark entry, not just its name. Excluding
  // `folder-open` alone leaves `folder-add`, `folder-cloud` and the rest of a
  // cohort that shares a bounding box to 0.25px, which is most of the answer.
  //
  // It also goes through the licence gate here, which is the only place in a
  // run where the set's provenance is known: `generate` and `compare` take
  // `Reference[]`, and `asReferences` is the sole constructor of one. A
  // mislabelled record throws on this line rather than reaching a contact
  // sheet.
  const excluded = benchmarkExclusions(entries);
  const conditioning = all.filter((i) => !excluded.has(i.icon));
  assertNoFilledTwin(conditioning);
  const corpus: Reference[] = asReferences(
    conditioning.map((i) => ({ name: i.icon, svg: i.svg, tags: i.tags })),
    provenance
  );
  // A part whose only evidence is a withheld icon is that icon's composition
  // under another name. Handing it over would withhold the drawing and supply
  // the decomposition.
  const vocabulary = redactParts(parts, excluded);

  // A second stream, so the floor's choices do not shift when the sample does.
  const floorRandom = rng(seed + 7919);

  // Spend is checked before each generation is dispatched rather than summed
  // at the end: the point of a cap is to not find out afterwards. Workers run
  // concurrently, so up to `concurrency - 1` generations already in flight
  // will still complete and are still counted.
  let spent = 0;
  let aborted: string | null = null;

  const results = await pool(held, concurrency, async (target) => {
    if (maxSpendUsd !== undefined && spent >= maxSpendUsd) {
      aborted ??=
        `Stopped after $${spent.toFixed(2)} of a $${maxSpendUsd.toFixed(2)} cap. ` +
        "The icons scored are real; the sample is a prefix of the benchmark, so " +
        "treatment is not comparable to a complete run.";
      return null;
    }
    // The floor: a random icon that is not the target, scored the same way. It
    // moves with the set, which a hardcoded constant would not. Drawn from the
    // whole set rather than the corpus, so holding out everything still leaves
    // a floor to compare against.
    const others = all.filter((i) => i.icon !== target.icon);
    const other = others[Math.floor(floorRandom() * others.length)];
    const [targetInk, otherInk] = await Promise.all([
      inkVector(target.svg),
      other ? inkVector(other.svg) : Promise.resolve([]),
    ]);
    const base: IconTarget = {
      category: target.category,
      floor: cosine(otherInk, targetInk),
      icon: target.icon,
      tags: target.tags,
    };

    let out: IconScore;
    try {
      const result = await gen(
        {
          category: target.category,
          name: target.icon,
          tags: target.tags,
        },
        { corpus, maxSteps, model: resolved, parts: vocabulary, policy }
      );
      out = scoreOf(
        base,
        result,
        cosine(await inkVector(result.svg), targetInk),
        rate
      );
    } catch (error) {
      out = { ...base, error: (error as Error).message, status: "error" };
    }
    if (scored(out)) {
      spent += out.usd ?? 0;
    }
    onIcon?.(out);
    return out;
  });

  // `attempted` is every entry the pool reached; `scores` is the subset that
  // came back with an SVG. Every number below is computed over `scores`, and
  // the difference between the two lengths is reported rather than averaged in.
  // A generation that threw is a missing measurement, not a measurement of 0:
  // averaging it in lets a flaky arm lose an A/B it never actually lost.
  const attempted = results.filter((s): s is IconScore => s !== null);
  const scores = attempted.filter(scored);
  const failures = attempted.filter((s) => !scored(s));
  const values = scores.map((s) => s.score);
  const treatment = median(values);
  const floor = median(scores.map((s) => s.floor));
  return {
    aborted,
    baseline: BASELINE,
    benchmark: {
      entries: scores.length,
      errors: failures.length,
      requested: entries.length,
      seed,
    },
    ceiling: CEILING,
    cost: summariseCost(scores, rates, treatment, floor),
    floor,
    // Failures sort last: they have no score to rank by, and the head of this
    // list is what a reader goes and looks at.
    icons: [...scores.toSorted((a, b) => a.score - b.score), ...failures],
    mean: values.reduce((a, b) => a + b, 0) / (values.length || 1),
    metrics: calibration
      ? buildReport(
          calibration,
          {
            conformanceGate:
              scores.filter((s) => s.clean).length / (scores.length || 1),
            conformanceStrict:
              scores.filter((s) => s.clean && s.issues === 0).length /
              (scores.length || 1),
            judge: null,
            semantic: null,
            style: null,
            ...options.metricTreatments,
          },
          {
            // The gate's denominator is every icon; the other metrics are read
            // only on the icons that cleared it, because a pipeline scoring
            // well on the three icons that survived is not a good pipeline.
            disqualified: scores.filter((s) => !s.clean).length,
            n: scores.filter((s) => s.clean).length,
          },
          options.judgeGate ?? null
        )
      : null,
    model: modelId,
    n: scores.length,
    seed,
    suspect:
      treatment > SUSPICIOUS
        ? `Treatment ${treatment.toFixed(3)} is above ${SUSPICIOUS} — two mature sets drawing the same concept only reach ${BASELINE}. Suspect the target leaking into the prompt or into the corpus before believing this.`
        : null,
    treatment,
  };
};

const bar = (v: number): string =>
  "█".repeat(Math.round(v * 30)).padEnd(30, "·");

const usdText = (v: number | null): string =>
  v === null ? "unpriced" : `$${v.toFixed(v < 1 ? 4 : 2)}`;

const tokens = (n: number): string =>
  n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : `${Math.round(n / 1000)}k`;

/**
 * The cost block, printed with the rate table it was computed from.
 *
 * The table is not decoration. A dollar figure with no rates beside it cannot
 * be checked or re-derived once prices move, and the whole reason for
 * recording cost is to compare runs months apart.
 */
const costLines = (report: EvalReport): string[] => {
  const { cost } = report;
  const u = cost.usage;
  const lines = [
    "",
    `  cost — ${usdText(cost.usd)} total · ${usdText(cost.usdPerIcon)}/icon · ${
      cost.usdPerReachPoint === null
        ? "no reach"
        : `${usdText(cost.usdPerReachPoint)}/reach point`
    }`,
    `    tokens  in ${tokens(u.inputTokens)} · cache r ${tokens(u.cacheReadTokens)} w ${tokens(u.cacheWriteTokens)} · out ${tokens(u.outputTokens)} (reasoning ${tokens(u.reasoningTokens)})`,
    `    time    ${(cost.msTotal / 1000).toFixed(0)}s total · ${(cost.msMedian / 1000).toFixed(1)}s median`,
  ];
  const calls = Object.entries(cost.toolCalls).toSorted((a, b) => b[1] - a[1]);
  if (calls.length > 0) {
    lines.push(`    tools   ${calls.map(([k, v]) => `${k} ${v}`).join(" · ")}`);
  }
  const stops = Object.entries(cost.stopReasons).toSorted(
    (a, b) => b[1] - a[1]
  );
  if (stops.length > 0) {
    lines.push(`    stopped ${stops.map(([k, v]) => `${k} ${v}`).join(" · ")}`);
  }
  if (cost.measured < report.n) {
    lines.push(
      `    ! ${report.n - cost.measured} of ${report.n} icons reported no usage — every figure above is a floor, not a total.`
    );
  }
  const rate = rateFor(report.model, cost.rates);
  lines.push(
    rate === null
      ? `    rates   no published rate for ${report.model}; dollars cannot be computed.`
      : `    rates   ${report.model} $/Mtok: in ${rate.input.toFixed(2)} · out ${rate.output.toFixed(2)} · cache read ${rate.cacheRead.toFixed(2)} · cache write ${rate.cacheWrite.toFixed(2)}`
  );
  return lines;
};

export const formatReport = (report: EvalReport): string => {
  const row = (label: string, v: number, note: string) =>
    `  ${label.padEnd(10)} ${v.toFixed(3)}  ${bar(v)}  ${note}`;
  const ok = report.icons.filter(scored);
  const clean = ok.filter((i) => i.clean).length;
  const failed = report.icons.filter((i) => !scored(i));
  const lines = [
    `reconstruction eval — ${report.n}/${report.benchmark.requested} benchmark icons${
      failed.length ? `, ${failed.length} errored and excluded` : ""
    }, ${report.model}, run seed ${report.seed}`,
    "",
    row("floor", report.floor, "a random icon against the target"),
    row("baseline", report.baseline, "two mature sets, same concept"),
    row("treatment", report.treatment, "this pipeline (median)"),
    row("ceiling", report.ceiling, "the target against itself"),
    "",
    `  mean ${report.mean.toFixed(3)} · ${clean}/${report.n} lint clean · ${median(ok.map((i) => i.steps)).toFixed(0)} steps median`,
    ...costLines(report),
  ];
  if (report.metrics) {
    lines.push("", formatMetrics(report.metrics));
  }
  if (report.aborted) {
    lines.push("", `  ! ${report.aborted}`);
  }
  if (report.suspect) {
    lines.push("", `  ! ${report.suspect}`);
  }
  if (failed.length) {
    lines.push(
      "",
      `  ${failed.length} failed to generate:`,
      ...failed.map((f) => `    ${f.icon}: ${f.error}`)
    );
  }
  const worst = ok.slice(0, 5);
  if (worst.length) {
    lines.push(
      "",
      "  weakest reconstructions:",
      ...worst.map(
        (i) =>
          `    ${i.score.toFixed(3)}  ${i.icon}${i.clean ? "" : "  (lint errors)"}`
      )
    );
  }
  return lines.join("\n");
};

export interface SpreadReport {
  /**
   * Errored generations across all replicates.
   *
   * None of them are in `treatment` or `spread`, and that is why the total has
   * to be stated: an arm losing eight generations in thirty is telling you
   * something about itself, it just must not tell you by pulling its own
   * median down.
   */
  errors: number;
  /** Every run, in the order the seeds were given. */
  runs: EvalReport[];
  /**
   * Seeds that never started, because the spend cap was already exhausted.
   *
   * Stated rather than inferred from `runs.length`: a spread over two
   * replicates when three were asked for is a different claim from a spread
   * over three, and the reader cannot tell them apart from a number alone.
   */
  skipped: number[];
  /** Total spend across the replicates, or null when unpriced. */
  usd: number | null;
  seeds: number[];
  /** Median of the per-seed treatments — the headline. */
  treatment: number;
  /** Highest per-seed treatment minus the lowest. **No later result is
   *  interpretable without this.** A pipeline change that moves treatment by
   *  less than the spread has moved nothing, and a single run cannot tell you
   *  which side of that line it is on. */
  spread: number;
}

/**
 * Run the same benchmark slice under several run seeds and report the spread.
 *
 * The baseline protocol is n=30 × 3 seeds rather than 120 × 5, which is a
 * budget decision: three replicates of a balanced 30-icon prefix buy the
 * variance estimate, and the variance estimate is the thing that makes every
 * later comparison readable. Runs are sequential on purpose — a shared spend
 * cap cannot be honoured by replicates racing each other.
 */
export const evaluateSeeds = async (
  options: Omit<EvalOptions, "seed">,
  seeds: readonly number[]
): Promise<SpreadReport> => {
  const runs: EvalReport[] = [];
  const skipped: number[] = [];
  let spent = 0;
  // Recursion rather than a loop, so the await is not inside one: replicates
  // must not race, because a shared spend cap cannot be honoured by runs that
  // cannot see each other's spend.
  const runFrom = async (i: number): Promise<void> => {
    if (i >= seeds.length) {
      return;
    }
    const remaining =
      options.maxSpendUsd === undefined
        ? undefined
        : Math.max(0, options.maxSpendUsd - spent);
    // A replicate with nothing left to spend does not draw a smaller sample,
    // it draws none — and then reports treatment 0.000, which is a score only
    // in the sense that a missing run is a bad one. Skip it and say so, rather
    // than emitting a zero that the spread cannot tell from a real result.
    if (remaining !== undefined && remaining <= 0) {
      skipped.push(seeds[i]);
      await runFrom(i + 1);
      return;
    }
    const report = await evaluate({
      ...options,
      maxSpendUsd: remaining,
      seed: seeds[i],
    });
    spent += report.cost.usd ?? 0;
    runs.push(report);
    await runFrom(i + 1);
  };
  await runFrom(0);
  // Only replicates that scored an icon. A run of n=0 has a treatment of
  // 0.000 by construction, and letting it into the spread is how a starved
  // replicate becomes a noise floor that rejects every later experiment.
  const measured = runs.filter((r) => r.n > 0);
  const treatments = measured.map((r) => r.treatment);
  const priced = runs.filter((r) => r.cost.usd !== null);
  return {
    errors: runs.reduce((a, r) => a + r.benchmark.errors, 0),
    runs,
    seeds: [...seeds],
    skipped,
    spread:
      treatments.length === 0
        ? 0
        : Math.max(...treatments) - Math.min(...treatments),
    treatment: median(treatments),
    usd: priced.length === 0 ? null : spent,
  };
};

export const formatSpread = (report: SpreadReport): string =>
  [
    ...report.runs.map(formatReport),
    "",
    `seed-to-seed — treatment ${report.treatment.toFixed(3)} median of ${report.seeds
      .map((s, i) => `${s}:${report.runs[i].treatment.toFixed(3)}`)
      .join(" ")}`,
    `  spread ${report.spread.toFixed(3)} — a later change smaller than this has moved nothing.`,
    ...(report.skipped.length > 0
      ? [
          `  ! ${report.skipped.length} replicate(s) never ran (seed ${report.skipped.join(", ")}) — the cap was gone before they started. The spread above is over ${report.runs.filter((r) => r.n > 0).length}, not ${report.seeds.length}, and is not the number a complete run would give.`,
        ]
      : []),
    `  total ${usdText(report.usd)}`,
    ...(report.errors
      ? [
          `  ! ${report.errors} generation(s) errored across the replicates and are excluded from every number above. A run losing generations is not a run scoring badly; find out which before comparing this against anything.`,
        ]
      : []),
  ].join("\n");
