/**
 * The reconstruction benchmark: which icons are held out, and what "held out"
 * has to mean for the number to be worth anything.
 *
 * Two problems this file exists to fix.
 *
 * **1. A name-exact hold-out withholds almost nothing.** Excluding the string
 * `folder-open` from the corpus leaves `folder-add`, `folder-cloud`,
 * `folder-download` and the rest of the cohort in front of the model —
 * drawings that `_cohorts.json` says share a bounding box to 0.25px. The model
 * is then reconstructing a folder having been shown eleven folders. It is not
 * measuring generation, it is measuring interpolation between two neighbours,
 * and it scores accordingly. The fix is `conceptClosure`: exclude the
 * equivalence class, not the string.
 *
 * **2. A seeded shuffle of "whatever loaded" is not a benchmark.** The old
 * `holdOut(items, n, seed)` shuffled the array it was handed, so adding one
 * icon to blode-icons changed which ten came out for seed 1 and two runs a
 * month apart compared different work. The fix is a committed file that
 * carries its ids: **the file is the contract, the seed is only provenance.**
 * `selectBenchmark` is how the file was built and how it can be rebuilt; it is
 * not consulted at eval time.
 *
 * The selection is also deliberately ordered rather than merely chosen. Each
 * entry's rank comes from a greedy pass that always takes the candidate whose
 * strata are furthest behind their population share, so **every prefix is
 * balanced**: the first 6 entries are a smoke run, the first 30 are the
 * baseline sample, and neither is a biased subset of the 120. That matters
 * because the budget decision is n=30 × 3 seeds, not 120 × 5 — the small slice
 * is the path that actually gets run.
 */
import { readFileSync } from "node:fs";

import type { IconRecord, Rendering } from "../corpus/record.js";
import type { Part } from "../types.js";

/** Bump when an entry's meaning changes. A file from an older schema is
 *  refused rather than half-read: a benchmark that silently reinterprets its
 *  own fields is worse than no benchmark. */
export const BENCH_SCHEMA_VERSION = 1;

/** Element count bands. Measured on blode-icons' 2,221 records: 1,503 icons
 *  draw 1–2 shapes, 489 draw 3–4, 229 draw 5 or more. The 5+ band is 10% of
 *  the set and much the hardest to reconstruct, so it has to be sampled
 *  deliberately or a 30-icon run will contain two of them by luck. */
export type ElementBand = "1-2" | "3-4" | "5+";
/** Tag richness. 25 blode icons carry no tags, 695 carry 1–3, 1,501 carry 4+.
 *  Tags are most of what the model is told, so a tagless icon is a different
 *  task, not a harder instance of the same one. */
export type TagBand = "0" | "1-3" | "4+";
/** Whether the slug has swap-compatible siblings. 1,026 cohort labels cover
 *  the set; 692 are singletons and 334 labels cover the remaining 1,529 icons.
 *  A cohort member has a house-standard skeleton to inherit and a singleton
 *  does not, which is a difficulty axis and also decides how much the concept
 *  closure removes. */
export type CohortStatus = "family" | "singleton";
export type ConceptStatus = "blessed" | "none";
/** `Conformance` restated rather than imported: `tools/keyline.ts` owns the
 *  measurement, and this is a committed file's field, which must not change
 *  meaning because a lower layer widened a union. */
export type KeylineBand = "near" | "off" | "on";

export interface Strata {
  category: string;
  cohort: CohortStatus;
  concept: ConceptStatus;
  elements: ElementBand;
  keyline: KeylineBand;
  tags: TagBand;
}

export interface BenchmarkEntry {
  /** Record ids that may not condition a generation of this entry — see
   *  `conceptClosure`. Committed as a snapshot so the file is auditable on its
   *  own; unioned with a freshly measured closure at run time, because
   *  concepts are still landing and a stale snapshot must never *re-admit* an
   *  icon the live corpus now says is related. */
  closure: string[];
  id: string;
  /** Position in the balanced ordering. `--slice n` takes ranks below `n`. */
  rank: number;
  set: string;
  slug: string;
  strata: Strata;
}

export interface Benchmark {
  builtAt: string;
  entries: BenchmarkEntry[];
  /** What the file was selected from. Recorded, not checked: the ids are the
   *  contract, and a corpus that has since grown must not change the run. */
  corpus: { records: number; set: string };
  schema: number;
  /** Provenance of the selection only. Nothing at eval time reads it. */
  seed: number;
  /** Prefix lengths worth running, named. `--slice` takes any number; these
   *  are the three the reports use. */
  slices: Record<string, number>;
}

const outlined = (record: IconRecord): Rendering | undefined =>
  record.renderings.find((r) => r.variant === "outlined") ??
  record.renderings[0];

const elementBand = (shapes: number): ElementBand => {
  if (shapes <= 2) {
    return "1-2";
  }
  return shapes <= 4 ? "3-4" : "5+";
};

const tagBand = (n: number): TagBand => {
  if (n === 0) {
    return "0";
  }
  return n <= 3 ? "1-3" : "4+";
};

/**
 * The suffixes a set may use to name a filled twin as a separate slug.
 *
 * blode-icons does not: `add-image` and `add-image-filled` are one record with
 * two renderings, which is why the corpus holds 2,221 records for 4,357 files.
 * A set that split them would put the answer one filename away, so the twin is
 * closed over by name as well as by record.
 */
const TWIN_SUFFIXES = ["-filled", "-fill", "-solid"] as const;

/** Every slug that names the same drawing in a different finish. */
const twinSlugs = (slug: string): string[] => {
  const out = [slug];
  for (const suffix of TWIN_SUFFIXES) {
    if (slug.endsWith(suffix)) {
      out.push(slug.slice(0, -suffix.length));
    } else {
      out.push(`${slug}${suffix}`);
    }
  }
  return out;
};

/**
 * Every record that must not be shown to a model reconstructing `slug`.
 *
 * The closure is the union of five relations, taken from the seed slug's own
 * records in one round:
 *
 * 1. **The slug itself, in every set.** Central ⊂ blode-icons exactly — same
 *    2,085 slugs, 30 finishes each — so `central/bell` is `blode-icons/bell`
 *    drawn again, and all 30 finishes go with it.
 * 2. **Its cohort, in both styles.** The reason this file exists: cohort mates
 *    share a bounding box to 0.25px, and showing eleven of them is showing the
 *    answer.
 * 3. **Everything sharing a concept with it.** Two slugs answering one UI
 *    intent are two drawings of one idea.
 * 4. **The filled/outlined twin**, by record and by name.
 * 5. **The cohorts and concepts of everything reached by 1 and 4** — a twin or
 *    a Central variant may carry a cohort label the outlined blode record does
 *    not.
 *
 * It is deliberately **one round, not a fixpoint**. A fixpoint would walk from
 * a cohort mate to *its* concept to a third cohort, and on the `arrow` cohort
 * (84 members) that reaches a large share of the set — withholding the
 * vocabulary rather than the answer, which measures a different pipeline than
 * the one that will ship. One round is the relation the acceptance criteria
 * name, and it is what the leakage test asserts.
 *
 * Degrades gracefully by construction: a slug with no concept closes over its
 * cohort, a slug with no cohort closes over its concept, and one with neither
 * closes over its own renderings and its Central variants. Concepts are
 * landing while this runs — 113 of 2,221 blode records carry one today — and
 * each one that lands only widens the closure.
 */
export const conceptClosure = (
  records: readonly IconRecord[],
  slug: string
): Set<string> => {
  const names = new Set(twinSlugs(slug));
  const seeds = records.filter((r) => names.has(r.slug));

  const cohorts = new Set(
    seeds.map((r) => r.cohort).filter((c): c is string => c !== null)
  );
  const concepts = new Set(seeds.flatMap((r) => r.concepts));

  const out = new Set<string>();
  for (const record of records) {
    const related =
      names.has(record.slug) ||
      (record.cohort !== null && cohorts.has(record.cohort)) ||
      record.concepts.some((c) => concepts.has(c));
    if (related) {
      out.add(record.id);
      // The filled twin, named. A store record is one *drawn identity* with a
      // rendering per finish, so `blode-icons/bell` already covers
      // `bell-filled.svg` — but a source directory keys the two as separate
      // files, and a reader that walks files rather than records would see a
      // closure that never mentions the twin. Naming it makes the committed
      // file self-sufficient: the guarantee then survives the eval being
      // pointed at the record store instead of `loadIconSet`, which is the
      // obvious next step and would take the loader's `-filled.svg` filter
      // with it. Emitted only where the record actually ships that finish, so
      // this states a fact rather than a precaution.
      if (record.renderings.some((r) => r.variant === "filled")) {
        out.add(`${record.id}-filled`);
      }
    }
  }
  return out;
};

/**
 * The closure as slugs, which is what an eval can actually filter on.
 *
 * `loadIconSet` reads a directory and knows only filenames, so the exclusion
 * has to be by slug. Collapsing `central/bell` to `bell` is not a loss of
 * precision but the point of it: the same drawing under two set ids must be
 * withheld under both.
 */
export const closureSlugs = (ids: Iterable<string>): Set<string> => {
  const out = new Set<string>();
  for (const id of ids) {
    const slug = id.includes("/") ? id.slice(id.indexOf("/") + 1) : id;
    for (const name of twinSlugs(slug)) {
      out.add(name);
    }
  }
  return out;
};

/** Union of every entry's closure, as slugs. This is the set an eval removes
 *  from the corpus before a single generation starts. */
export const benchmarkExclusions = (
  entries: readonly BenchmarkEntry[]
): Set<string> => {
  const out = new Set<string>();
  for (const entry of entries) {
    for (const slug of closureSlugs([entry.id, ...entry.closure])) {
      out.add(slug);
    }
  }
  return out;
};

/**
 * Re-measure every entry's closure against the corpus as it stands now, and
 * union it with the committed snapshot.
 *
 * Union, never replace. A concept landing on a slug widens the closure and the
 * run gets stricter; a concept being *removed* — or a corpus built without the
 * concepts file — must not narrow it, because that would silently re-admit an
 * icon a previous run was careful to withhold.
 */
export const refreshClosures = (
  entries: readonly BenchmarkEntry[],
  records: readonly IconRecord[]
): BenchmarkEntry[] =>
  entries.map((entry) => ({
    ...entry,
    closure: [
      ...new Set([...entry.closure, ...conceptClosure(records, entry.slug)]),
    ].toSorted(),
  }));

/**
 * Drop the parts a benchmark icon's own drawing produced.
 *
 * A parts vocabulary is extracted by clustering every subpath in the set. If
 * the set includes the held-out icons, a part whose only evidence is
 * `folder-open` is `folder-open`'s composition handed back under another name —
 * the eval would be withholding the drawing and supplying its decomposition.
 *
 * A part used by icons outside the closure is set vocabulary rather than the
 * answer, and is kept: the largest cluster in blode-icons is drawn by 84
 * icons, and dropping it because one benchmark entry uses it would withhold
 * the alphabet. The closure names are still stripped from `icons`, so the
 * model is never told which withheld icon a mark appears in.
 *
 * `commands/eval.ts` also supports extracting the vocabulary from the
 * non-benchmark files directly, which is stricter — a cluster centroid is
 * shaped by every member, including withheld ones. This function is the floor,
 * applied unconditionally so a stale `parts.json` cannot leak.
 */
export const redactParts = (
  parts: readonly Part[],
  excluded: ReadonlySet<string>
): Part[] => {
  const out: Part[] = [];
  for (const part of parts) {
    const kept = part.icons.filter((icon) => !excluded.has(icon));
    if (kept.length === 0) {
      continue;
    }
    out.push({ ...part, icons: kept });
  }
  return out;
};

/** Modulus of the string hash below: 2^31, which keeps every intermediate
 *  exact in a double (2^31 × 131 is well under 2^53). */
const HASH_M = 2_147_483_648;

/**
 * A per-id key in [0,1) that depends on the id and the seed and on nothing
 * else.
 *
 * That independence is the point: it is what makes the selection unaffected by
 * how many icons the set holds and by what order the corpus was read in, which
 * is exactly what the old seeded shuffle got wrong. It only has to spread ids
 * evenly enough to break ties between equally-deserving candidates — the
 * strata deficit below does the real choosing — so a classic multiply-add
 * string hash is enough, and it stays inside integer-exact arithmetic.
 */
const hashKey = (seed: number, id: string): number => {
  let h = (seed * 2_654_435_761) % HASH_M;
  for (let i = 0; i < id.length; i += 1) {
    h = (h * 131 + (id.codePointAt(i) ?? 0)) % HASH_M;
  }
  return h / HASH_M;
};

const AXES = [
  "category",
  "cohort",
  "concept",
  "elements",
  "keyline",
  "tags",
] as const;

interface Deficit {
  rank: number;
  share: Map<string, number>;
  taken: Map<string, number>;
}

/**
 * The candidate whose strata are furthest behind their population share.
 *
 * "Behind" is measured as how many of a bucket the prefix *should* hold by
 * now minus how many it does, summed over the six axes — so an icon that is
 * rare on two axes outranks one that is rare on one. Because the target moves
 * with `rank`, every prefix of the result is balanced, not only the whole
 * file; that is what makes `--slice 6` a smoke run rather than a biased one.
 */
const mostDeserving = (
  pool: ReadonlySet<Candidate>,
  { rank, share, taken }: Deficit
): Candidate | null => {
  let best: Candidate | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const c of pool) {
    let score = 0;
    for (const axis of AXES) {
      const k = `${axis}:${c.strata[axis]}`;
      score += (share.get(k) ?? 0) * (rank + 1) - (taken.get(k) ?? 0);
    }
    // The hash breaks ties, which are common early on: a fixed,
    // corpus-size-independent order over equally-deserving candidates.
    score += c.key * 1e-6;
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best;
};

interface Candidate {
  id: string;
  key: number;
  set: string;
  slug: string;
  strata: Strata;
}

export interface SelectOptions {
  seed?: number;
  /** Which set the benchmark is drawn from. */
  set?: string;
  size?: number;
  /** Named prefixes to record in the file. */
  slices?: Record<string, number>;
}

/**
 * Build a benchmark from a corpus.
 *
 * Run once, committed, and then never consulted again: `evaluate` reads the
 * file. Re-running it on a grown corpus keeps most of the same icons — the
 * per-id hash does not move when the set does — but the file, not this
 * function, is what two runs a month apart have in common.
 */
/**
 * Every drawable record of one set, with its strata measured.
 *
 * Sorted by id rather than left in corpus order: nothing downstream may depend
 * on how the store happened to be walked, which is half of what made the old
 * shuffle unreproducible.
 */
const candidatesOf = (
  records: readonly IconRecord[],
  set: string,
  seed: number
): Candidate[] => {
  const pool = records.filter((r) => r.set === set);
  // Cohort *size*, because "canonical" only means anything against siblings: a
  // label with one member is a singleton however it was derived. 692 of the
  // 1,026 labels over blode-icons are singletons.
  const cohortSize = new Map<string, number>();
  for (const record of pool) {
    if (record.cohort !== null) {
      cohortSize.set(record.cohort, (cohortSize.get(record.cohort) ?? 0) + 1);
    }
  }

  const out: Candidate[] = [];
  for (const record of pool) {
    const rendering = outlined(record);
    if (!rendering) {
      continue;
    }
    const family =
      record.cohort !== null && (cohortSize.get(record.cohort) ?? 0) > 1;
    out.push({
      id: record.id,
      key: hashKey(seed, record.id),
      set: record.set,
      slug: record.slug,
      strata: {
        category: record.category ?? "uncategorised",
        cohort: family ? "family" : "singleton",
        concept: record.concepts.length > 0 ? "blessed" : "none",
        elements: elementBand(rendering.shapes),
        keyline: rendering.keyline.conformance as KeylineBand,
        tags: tagBand(record.tags.length),
      },
    });
  }
  return out.toSorted((a, b) => (a.id < b.id ? -1 : 1));
};

/** Population share of every bucket on every axis — the targets the greedy
 *  pass chases, so the chosen prefix mirrors the set rather than the seed. */
const sharesOf = (candidates: readonly Candidate[]): Map<string, number> => {
  const share = new Map<string, number>();
  for (const axis of AXES) {
    const counts = new Map<string, number>();
    for (const c of candidates) {
      const k = `${axis}:${c.strata[axis]}`;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    for (const [k, n] of counts) {
      share.set(k, n / candidates.length);
    }
  }
  return share;
};

export const selectBenchmark = (
  records: readonly IconRecord[],
  options: SelectOptions = {}
): Benchmark => {
  const {
    seed = 1,
    set = "blode-icons",
    size = 120,
    slices = { baseline: 30, full: 120, smoke: 6 },
  } = options;

  const candidates = candidatesOf(records, set, seed);
  const share = sharesOf(candidates);

  const taken = new Map<string, number>();
  const remaining = new Set(candidates);
  const entries: BenchmarkEntry[] = [];
  const n = Math.min(size, candidates.length);
  for (let rank = 0; rank < n; rank += 1) {
    const best = mostDeserving(remaining, { rank, share, taken });
    if (!best) {
      break;
    }
    remaining.delete(best);
    for (const axis of AXES) {
      const k = `${axis}:${best.strata[axis]}`;
      taken.set(k, (taken.get(k) ?? 0) + 1);
    }
    entries.push({
      closure: [...conceptClosure(records, best.slug)].toSorted(),
      id: best.id,
      rank,
      set: best.set,
      slug: best.slug,
      strata: best.strata,
    });
  }

  return {
    builtAt: new Date().toISOString(),
    corpus: { records: records.length, set },
    entries,
    schema: BENCH_SCHEMA_VERSION,
    seed,
    slices,
  };
};

/** Counts per bucket per axis, for the report and for a test that would
 *  otherwise have to re-derive them. */
export const strataCounts = (
  entries: readonly BenchmarkEntry[]
): Record<string, Record<string, number>> => {
  const out: Record<string, Record<string, number>> = {};
  for (const axis of AXES) {
    const counts: Record<string, number> = {};
    for (const entry of entries) {
      const k = entry.strata[axis];
      counts[k] = (counts[k] ?? 0) + 1;
    }
    out[axis] = counts;
  }
  return out;
};

export class BenchmarkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BenchmarkError";
  }
}

/** Parse a committed benchmark, refusing anything this code cannot read the
 *  way it was written. */
export const parseBenchmark = (
  text: string,
  source = "benchmark"
): Benchmark => {
  let raw: Benchmark;
  try {
    raw = JSON.parse(text) as Benchmark;
  } catch (error) {
    throw new BenchmarkError(
      `${source} is not valid JSON: ${(error as Error).message}`
    );
  }
  if (raw.schema !== BENCH_SCHEMA_VERSION) {
    throw new BenchmarkError(
      `${source} is schema ${raw.schema}, and this build reads schema ${BENCH_SCHEMA_VERSION}. ` +
        "Rebuild it with `iconsmith bench` rather than running against a file whose fields may mean something else."
    );
  }
  if (!Array.isArray(raw.entries) || raw.entries.length === 0) {
    throw new BenchmarkError(`${source} carries no entries.`);
  }
  return raw;
};

export const loadBenchmark = (file: string): Benchmark =>
  parseBenchmark(readFileSync(file, "utf-8"), file);

/** Read a `corpus build` store. One JSON object per line; blank lines are
 *  tolerated because a hand-appended file usually ends in one. */
export const loadRecords = (file: string): IconRecord[] =>
  readFileSync(file, "utf-8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as IconRecord);

/** The first `n` entries by rank — a balanced prefix, not a random subset. */
export const slice = (
  entries: readonly BenchmarkEntry[],
  n?: number
): BenchmarkEntry[] => {
  const ordered = [...entries].toSorted((a, b) => a.rank - b.rank);
  return n === undefined ? ordered : ordered.slice(0, Math.max(0, n));
};
