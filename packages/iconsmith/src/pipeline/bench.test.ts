/**
 * The two properties that make an eval number worth keeping.
 *
 * 1. **What is withheld is the concept closure, not the name.** The leakage
 *    test below runs the *committed* benchmark through `evaluate` and asserts
 *    that no member of any entry's closure reaches the `Reference[]` handed to
 *    `generate`. It runs on the committed file alone — no corpus, no icon
 *    directory — so it is the same assertion in CI as on a machine with the
 *    18,658-record store.
 * 2. **The sample is the file.** Growing the icon set cannot change which
 *    icons a run holds out, because nothing in the run path samples anything.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";

import type { IconRecord, Rendering } from "../corpus/record.js";
import type { Part } from "../types.js";
import {
  BENCH_SCHEMA_VERSION,
  BENCH_SIZE,
  BenchmarkError,
  benchmarkExclusions,
  closureSlugs,
  conceptClosure,
  dealSplits,
  entriesOf,
  loadRecords,
  parseBenchmark,
  redactParts,
  refreshClosures,
  selectBenchmark,
  slice,
  SPLIT_SIZES,
  SPLITS,
  strataCounts,
} from "./bench.js";
import type { Benchmark, BenchmarkEntry, Split } from "./bench.js";
import { RATES, rateFor, reachPoints, usdOf } from "./cost.js";
import { assertNoFilledTwin, evaluate, evaluateSeeds } from "./eval.js";
import type { EvalIcon } from "./eval.js";

const FILLED = ["-filled", "-fill", "-solid"];

const BENCH_FILE = path.join(process.cwd(), "bench", "reconstruction.json");
const CORPUS_FILE = path.join(process.cwd(), ".corpus", "icons.jsonl");

const benchmark: Benchmark = parseBenchmark(
  readFileSync(BENCH_FILE, "utf-8"),
  BENCH_FILE
);

/** The generator is stubbed in every test here, so the model is only ever
 *  resolved and named. The id has to be a real one: it is what the rate table
 *  is looked up by. */
const model = new MockLanguageModelV4({ modelId: "claude-opus-5" });

const svg = (d: string) =>
  `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="${d}" stroke="currentColor" stroke-width="2" fill="none"/></svg>`;

/** `marks` sets `subpaths`, which is what the `elements` axis bands on.
 *  `shapes` is set to the same number only so the fixture stays readable — the
 *  selection does not look at it, and on the real set the two disagree wildly
 *  (median 1 shape against median 4 subpaths). */
const rendering = (marks: number): Rendering =>
  ({
    keyline: { conformance: "on" },
    shapes: marks,
    subpaths: marks,
    variant: "outlined",
  }) as Rendering;

/** blode-icons ships each icon twice: 2,221 records over 4,357 files. A record
 *  with this second rendering is one whose filled twin exists on disk. */
const withFilled = (marks: number): Rendering[] => [
  rendering(marks),
  {
    keyline: { conformance: "on" },
    shapes: marks,
    subpaths: marks,
    variant: "filled",
  } as Rendering,
];

const record = (id: string, extra: Partial<IconRecord> = {}): IconRecord =>
  ({
    category: "Things",
    cohort: null,
    concepts: [],
    id,
    renderings: [rendering(2)],
    set: id.slice(0, id.indexOf("/")),
    slug: id.slice(id.indexOf("/") + 1),
    tags: ["a", "b"],
    ...extra,
  }) as IconRecord;

describe("conceptClosure", () => {
  /**
   * The failure this replaced: holding out `folder-open` while leaving
   * `folder-add`, `folder-cloud` and `folder-download` in the corpus — a cohort
   * the manifest says shares a bounding box to 0.25px.
   */
  const records = [
    record("blode-icons/folder-open", {
      cohort: "folder",
      renderings: withFilled(2),
    }),
    record("blode-icons/folder-add", {
      cohort: "folder",
      renderings: withFilled(2),
    }),
    record("blode-icons/folder-cloud", { cohort: "folder" }),
    record("central/folder-open", { cohort: "folder" }),
    record("blode-icons/folder-open-filled", { cohort: "folder" }),
    record("blode-icons/directory", { concepts: ["file-container"] }),
    record("blode-icons/arrow-up", { cohort: "arrow" }),
  ];

  it("takes the cohort, both sets and the filled twin", () => {
    const out = conceptClosure(records, "folder-open");
    expect(out).toContain("blode-icons/folder-add");
    expect(out).toContain("blode-icons/folder-cloud");
    expect(out).toContain("central/folder-open");
    expect(out).toContain("blode-icons/folder-open-filled");
    // Named, not merely implied. A store record is one drawn identity with a
    // rendering per finish, so the twin has no id of its own — but a reader
    // that walks files sees two, and the committed file has to be readable by
    // both. Only where the record actually ships that finish.
    expect(out).toContain("blode-icons/folder-add-filled");
    // A different cohort is a different idea and stays in the corpus: the
    // exclusion has to be surgical, or the eval measures a model shown
    // nothing.
    expect(out).not.toContain("blode-icons/arrow-up");
  });

  it("takes everything sharing a concept", () => {
    const withConcept = records.map((r) =>
      r.id === "blode-icons/folder-open"
        ? { ...r, concepts: ["file-container"] }
        : r
    );
    expect(conceptClosure(withConcept, "folder-open")).toContain(
      "blode-icons/directory"
    );
  });

  /** Concepts are landing while this ships — 113 of 2,221 blode records carry
   *  one — so the cohort half has to work with the concept half absent, and
   *  the concept half with the cohort absent. */
  it("degrades gracefully when a slug has no cohort, no concept, or neither", () => {
    const bare = [
      record("blode-icons/lone"),
      record("central/lone"),
      record("blode-icons/other", { cohort: "folder" }),
    ];
    const out = conceptClosure(bare, "lone");
    expect([...out].toSorted()).toEqual(["blode-icons/lone", "central/lone"]);

    const conceptOnly = [
      record("blode-icons/a", { concepts: ["x"] }),
      record("blode-icons/b", { concepts: ["x"] }),
    ];
    expect(conceptClosure(conceptOnly, "a")).toContain("blode-icons/b");

    expect(conceptClosure([], "missing").size).toBe(0);
  });
});

describe("assertNoFilledTwin", () => {
  /**
   * Defence in depth, and deliberately redundant. `loadIconSet` already skips
   * `-filled.svg`, so nothing reaches this guard on today's path — but that
   * protection is a loader filter, and the record store keys one identity with
   * a rendering per finish. The first reader that walks records instead of
   * files loses the filter, and a per-entry closure would be the only thing
   * left. This check is not per-entry.
   */
  it("refuses a filled icon whatever loaded it", () => {
    expect(() =>
      assertNoFilledTwin([
        { icon: "bell", svg: "", tags: [] },
        { icon: "bell-filled", svg: "", tags: [] },
      ])
    ).toThrow(/outline-expanded/u);
    expect(() =>
      assertNoFilledTwin([{ icon: "bell", svg: "", tags: [] }])
    ).not.toThrow();
  });
});

describe("closureSlugs", () => {
  it("collapses the set prefix and names the finish variants", () => {
    const out = closureSlugs(["central/bell", "blode-icons/bell"]);
    expect(out).toContain("bell");
    expect(out).toContain("bell-filled");
    // Central ⊂ blode-icons exactly — same slugs, 30 finishes each — so a
    // Central id and a blode id name the same drawing and must exclude it in
    // both directions.
    expect(closureSlugs(["blode-icons/bell-filled"])).toContain("bell");
  });
});

describe("redactParts", () => {
  const parts = [
    { icons: ["bell", "bell-slash"], id: "p1" },
    { icons: ["bell", "arrow-up", "chevron"], id: "p2" },
  ] as Part[];

  it("drops a part whose only evidence is withheld, and keeps set vocabulary", () => {
    const out = redactParts(parts, new Set(["bell", "bell-slash"]));
    expect(out.map((p) => p.id)).toEqual(["p2"]);
    // The mark survives because 2 of its 3 icons are outside the closure, but
    // the model is never told it appears in the withheld one.
    expect(out[0].icons).toEqual(["arrow-up", "chevron"]);
  });
});

describe("parseBenchmark", () => {
  it("refuses a file written by a different schema rather than half-reading it", () => {
    expect(() =>
      parseBenchmark(
        JSON.stringify({ entries: [{}], schema: BENCH_SCHEMA_VERSION + 1 })
      )
    ).toThrow(BenchmarkError);
    expect(() => parseBenchmark("{")).toThrow(BenchmarkError);
    expect(() =>
      parseBenchmark(
        JSON.stringify({ entries: [], schema: BENCH_SCHEMA_VERSION })
      )
    ).toThrow(/no entries/u);
  });
});

describe("refreshClosures", () => {
  it("only ever widens a committed closure", () => {
    const entries = [
      { ...benchmark.entries[0], closure: ["blode-icons/committed-only"] },
    ];
    // A corpus that knows nothing about this slug must not be able to drop the
    // committed member: a concept being removed, or a store built without the
    // concepts file, would otherwise silently re-admit an icon an earlier run
    // was careful to withhold.
    const out = refreshClosures(entries, []);
    expect(out[0].closure).toContain("blode-icons/committed-only");
  });
});

describe("selectBenchmark", () => {
  const pool = Array.from({ length: 40 }, (_, i) =>
    record(`blode-icons/icon-${i}`, {
      cohort: i % 3 === 0 ? "family" : null,
      concepts: i % 7 === 0 ? ["c"] : [],
      renderings: [rendering((i % 6) + 1)],
    })
  );

  it("does not depend on the order the corpus was read in", () => {
    const before = selectBenchmark(pool, { size: 10 });
    // The bug this replaced: `holdOut` shuffled whatever array had been
    // loaded, so directory order was part of the answer. Every candidate's key
    // is now a hash of its id, so reversing the input changes nothing.
    const reversed = selectBenchmark([...pool].toReversed(), { size: 10 });
    expect(reversed.entries.map((e) => e.id)).toEqual(
      before.entries.map((e) => e.id)
    );
    expect(
      selectBenchmark(pool, { size: 10 }).entries.map((e) => e.id)
    ).toEqual(before.entries.map((e) => e.id));
    // A different seed is a different sample, or the seed is decoration.
    expect(
      selectBenchmark(pool, { seed: 2, size: 10 }).entries.map((e) => e.id)
    ).not.toEqual(before.entries.map((e) => e.id));
  });

  /**
   * Growing the set *does* move this function's output — the strata shares it
   * chases are shares of the population, so a genuinely different population
   * deserves a different sample. That is exactly why the selection is run once
   * and committed: the run path reads the file and never calls this. The
   * property "adding an icon does not change what a run holds out" is asserted
   * against `evaluate` in the leakage suite below.
   */

  it("balances every prefix, not just the whole file", () => {
    const full = selectBenchmark(pool, { size: 20 });
    const head = strataCounts(slice(full.entries, 6));
    // Six entries cannot cover 38 categories, but they must not all be the
    // same element band — that is the property `--slice` depends on.
    expect(Object.keys(head.elements).length).toBeGreaterThan(1);
  });

  /**
   * The composition bug, pinned. blode-icons merges its geometry into one or
   * two `<path>` elements whatever the drawing contains, so banding on
   * `shapes` put two thirds of the old benchmark in `1-2` and left no room for
   * a composition strategy to show anything. The marks are the subpaths.
   */
  it("bands composition on subpaths, not on SVG elements", () => {
    const dense = record("blode-icons/dense", {
      renderings: [
        {
          keyline: { conformance: "on" },
          shapes: 1,
          subpaths: 7,
          variant: "outlined",
        } as Rendering,
      ],
    });
    const [entry] = selectBenchmark([dense], { size: 1 }).entries;
    expect(entry.strata.elements).toBe("5+");
  });

  /**
   * Two blode records are outline drawings whose slugs end in a finish suffix
   * (`box-2-alt-fill`, `circle-half-fill`). The eval's filled-twin guard is a
   * name test, so such a slug cannot be a target — it throws before a single
   * generation runs.
   */
  it("never makes a target of a slug that reads as a finish variant", () => {
    const chosen = selectBenchmark(
      [record("blode-icons/box-2-alt-fill"), record("blode-icons/box-2-alt")],
      { size: 2 }
    );
    expect(chosen.entries.map((e) => e.slug)).toEqual(["box-2-alt"]);
  });
});

describe("the committed benchmark", () => {
  it("is a complete, uniquely ranked file", () => {
    const ranks = benchmark.entries.map((e) => e.rank);
    expect(new Set(ranks).size).toBe(benchmark.entries.length);
    expect(Math.min(...ranks)).toBe(0);
    expect(Math.max(...ranks)).toBe(benchmark.entries.length - 1);
    expect(benchmark.entries.every((e) => e.closure.includes(e.id))).toBe(true);
  });

  it("covers every stratum the sample is meant to span", () => {
    const counts = strataCounts(benchmark.entries);
    for (const band of ["1-2", "3-4", "5+"]) {
      expect(counts.elements[band]).toBeGreaterThan(0);
    }
    for (const band of ["on", "near", "off"]) {
      expect(counts.keyline[band]).toBeGreaterThan(0);
    }
    expect(counts.cohort.family).toBeGreaterThan(0);
    expect(counts.cohort.singleton).toBeGreaterThan(0);
    // `blessed` must not be empty: an eval that never draws a blessed icon
    // cannot say whether a concept helps.
    expect(counts.concept.blessed).toBeGreaterThan(0);
    expect(Object.keys(counts.category).length).toBeGreaterThan(10);
  });
});

/**
 * The three splits, and the single failure that would make all of this
 * theatre.
 *
 * An entry in two splits means the slice a proposal is written from is also
 * the slice that judges it — the exact overfit the split exists to prevent —
 * and it is invisible in every number a loop prints, because both slices still
 * come out the right size and the scores still look like scores. So it is
 * asserted here, on the committed file, rather than trusted to the code that
 * wrote it.
 */
describe("the three splits", () => {
  const bySplit = Object.fromEntries(
    SPLITS.map((s) => [s, entriesOf(benchmark.entries, s)])
  ) as Record<Split, BenchmarkEntry[]>;

  it("are disjoint, and together are the whole file", () => {
    for (const a of SPLITS) {
      for (const b of SPLITS) {
        if (a === b) {
          continue;
        }
        const other = new Set(bySplit[b].map((e) => e.id));
        for (const entry of bySplit[a]) {
          expect(other.has(entry.id)).toBe(false);
        }
      }
    }
    // Disjoint by *slug* as well as by id. The same drawing under two set ids
    // is the same answer, and the closure logic already treats it that way.
    const slugs = SPLITS.flatMap((s) => bySplit[s].map((e) => e.slug));
    expect(new Set(slugs).size).toBe(slugs.length);
    let counted = 0;
    for (const split of SPLITS) {
      counted += bySplit[split].length;
    }
    expect(counted).toBe(benchmark.entries.length);
  });

  it("are the sizes the file claims, and the sizes the power argument asked for", () => {
    for (const split of SPLITS) {
      expect(bySplit[split].length).toBe(benchmark.splits[split]);
    }
    expect(benchmark.splits).toEqual(SPLIT_SIZES);
    expect(benchmark.entries.length).toBe(BENCH_SIZE);
  });

  /**
   * The reason ranks are grouped rather than interleaved: `--slice 30` is a
   * dev instrument, and if rank 29 could land in `sealed` then the cheapest,
   * most-run command in the project would quietly spend the one number that
   * was never optimised against.
   */
  it("occupy contiguous rank ranges, feedback first", () => {
    let next = 0;
    for (const split of SPLITS) {
      for (const entry of bySplit[split]) {
        expect(entry.rank).toBe(next);
        next += 1;
      }
    }
    for (const name of Object.values(benchmark.slices)) {
      expect(name).toBeLessThanOrEqual(benchmark.splits.feedback);
    }
  });

  /**
   * Each split has to be able to answer the same questions, or a result on
   * `selection` cannot be confirmed on `sealed`: a sealed slice with no 5+
   * icons would silently exempt every composition change from confirmation.
   */
  it("each span every band the whole file spans", () => {
    for (const split of SPLITS) {
      const counts = strataCounts(bySplit[split]);
      for (const band of ["1-2", "3-4", "5+"]) {
        expect(counts.elements[band]).toBeGreaterThan(0);
      }
      for (const band of ["on", "near", "off"]) {
        expect(counts.keyline[band]).toBeGreaterThan(0);
      }
      expect(counts.cohort.family).toBeGreaterThan(0);
      expect(counts.cohort.singleton).toBeGreaterThan(0);
      expect(counts.concept.blessed).toBeGreaterThan(0);
      expect(Object.keys(counts.category).length).toBeGreaterThan(10);
    }
  });

  /**
   * The old benchmark put 81 of 120 entries in the `1-2` band, because it
   * banded on `shapes` — SVG elements — where the median blode record is 1.
   * Composition strategies are the main thing a loop proposes, and they could
   * not show an effect on two thirds of the set. Banding on subpaths, the
   * marks actually being placed, this holds without any reweighting.
   */
  it("is mostly multi-mark, in every split", () => {
    for (const split of [...SPLITS, null]) {
      const entries = split === null ? benchmark.entries : bySplit[split];
      const multi = entries.filter((e) => e.strata.elements !== "1-2").length;
      expect(multi / entries.length).toBeGreaterThan(0.6);
    }
  });
});

describe("parseBenchmark rejects a broken split", () => {
  const file = (entries: BenchmarkEntry[]) =>
    JSON.stringify({ ...benchmark, entries });

  it("refuses an entry that appears in two splits", () => {
    const [first, second] = benchmark.entries;
    expect(() =>
      parseBenchmark(file([first, { ...second, id: first.id }]))
    ).toThrow(BenchmarkError);
    expect(() =>
      parseBenchmark(file([first, { ...second, id: first.id }]))
    ).toThrow(/both the/u);
  });

  it("refuses a split name it cannot honour", () => {
    const [first] = benchmark.entries;
    expect(() =>
      parseBenchmark(file([{ ...first, split: "train" as unknown as Split }]))
    ).toThrow(BenchmarkError);
  });
});

describe("dealSplits", () => {
  /**
   * Spread, not sliced. A contiguous tail would hand `sealed` whatever strata
   * the greedy pass was still owing when it ran out of budget, which is the
   * one way a balanced ordering can still produce an unbalanced holdout.
   */
  it("spreads each split across the ordering rather than taking a block", () => {
    const ordered = Array.from({ length: 60 }, (_, i) => i);
    const dealt = dealSplits(ordered, {
      feedback: 20,
      sealed: 20,
      selection: 20,
    });
    for (const split of SPLITS) {
      const picked = dealt
        .filter((d) => d.split === split)
        .map((d) => d.item)
        .toSorted((a, b) => a - b);
      expect(picked.length).toBe(20);
      // Every third position, give or take: a block would have span 19.
      expect(picked.at(-1) - picked[0]).toBeGreaterThan(50);
    }
    // Every input lands in exactly one split.
    expect(new Set(dealt.map((d) => d.item)).size).toBe(60);
  });

  it("scales the splits down proportionally when there is less to deal", () => {
    const dealt = dealSplits(
      Array.from({ length: 25 }, (_, i) => i),
      { feedback: 60, sealed: 60, selection: 130 }
    );
    const n = (split: Split) => dealt.filter((d) => d.split === split).length;
    expect(n("selection")).toBeGreaterThan(n("feedback"));
    expect(n("feedback") + n("selection") + n("sealed")).toBe(25);
  });
});

/**
 * Every slug named anywhere in the benchmark, as an icon the eval can load.
 *
 * Built from the committed file, so this runs with no corpus and no icon
 * directory. Filled names are dropped to mirror `loadIconSet`, which skips
 * `-filled.svg`: an outline set is what a real run hands over, and feeding
 * filled twins in would only re-test `assertNoFilledTwin`, which has its own
 * test below.
 */
const universe = (): EvalIcon[] => {
  const slugs = new Set<string>();
  for (const entry of benchmark.entries) {
    for (const slug of closureSlugs([entry.id, ...entry.closure])) {
      if (!FILLED.some((suffix) => slug.endsWith(suffix))) {
        slugs.add(slug);
      }
    }
  }
  // Filler that is in no closure, so the corpus handed to the model is never
  // empty and the assertion below is not vacuous.
  for (let i = 0; i < 50; i += 1) {
    slugs.add(`filler-${i}`);
  }
  return [...slugs].toSorted().map((icon) => ({
    category: "Things",
    icon,
    svg: svg("M6 6H18V18H6Z"),
    tags: ["t"],
  }));
};

describe("no member of a benchmark entry's concept closure reaches the model", () => {
  it("holds for every entry in the committed benchmark", async () => {
    const icons = universe();
    const seen = new Map<string, string[]>();
    const report = await evaluate({
      benchmark: benchmark.entries,
      concurrency: 8,
      generate: (concept, options) => {
        seen.set(
          concept.name,
          (options.corpus ?? []).map((c) => c.name)
        );
        return Promise.resolve({
          clean: true,
          doc: { draw: [], icon: concept.name, keyline: null },
          issues: [],
          steps: 1,
          svg: svg("M4 4H20V20H4Z"),
          text: "",
          trace: [],
        });
      },
      icons,
      model,
      provenance: {
        date: "2026-08-19",
        origin: "original",
        set: "blode-icons",
        usage: "conditioning",
      },
    });

    expect(report.n).toBe(benchmark.entries.length);
    expect(seen.size).toBe(benchmark.entries.length);
    for (const entry of benchmark.entries) {
      const corpus = new Set(seen.get(entry.slug));
      expect(corpus.size).toBeGreaterThan(0);
      const leaked = [...closureSlugs([entry.id, ...entry.closure])].filter(
        (slug) => corpus.has(slug)
      );
      expect({ entry: entry.slug, leaked }).toEqual({
        entry: entry.slug,
        leaked: [],
      });
    }
  }, 30_000);

  it("holds out the same icons however large the set gets", async () => {
    const held: string[][] = [];
    const run = async (extra: number) => {
      const icons = [
        ...universe(),
        ...Array.from({ length: extra }, (_, i) => ({
          category: "Things",
          icon: `added-${i}`,
          svg: svg("M6 6H18V18H6Z"),
          tags: [],
        })),
      ];
      const names: string[] = [];
      await evaluate({
        benchmark: slice(benchmark.entries, 8),
        concurrency: 8,
        generate: (concept) => {
          names.push(concept.name);
          return Promise.resolve({
            clean: true,
            doc: { draw: [], icon: concept.name, keyline: null },
            issues: [],
            steps: 1,
            svg: svg("M4 4H20V20H4Z"),
            text: "",
            trace: [],
          });
        },
        icons,
        model,
        provenance: {
          date: "2026-08-19",
          origin: "original",
          set: "blode-icons",
          usage: "conditioning",
        },
      });
      held.push(names.toSorted());
    };
    await run(0);
    await run(500);
    expect(held[0]).toEqual(held[1]);
  });
});

describe("cost", () => {
  it("prices a gateway route the same as the bare id", () => {
    expect(rateFor("anthropic/claude-opus-5")).toEqual(RATES["claude-opus-5"]);
    expect(rateFor("some-model-nobody-published")).toBeNull();
  });

  it("charges cache reads and writes at their own rates", () => {
    const rate = RATES["claude-opus-5"];
    const usd = usdOf(
      {
        cacheReadTokens: 1_000_000,
        cacheWriteTokens: 1_000_000,
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
        reasoningTokens: 500_000,
      },
      rate
    );
    // 5 input + 0.5 cache read + 6.25 cache write + 25 output. Reasoning
    // tokens are already inside `outputTokens` and are not charged twice.
    expect(usd).toBeCloseTo(36.75, 6);
  });

  it("measures reach against the floor-to-baseline span, not raw cosine", () => {
    expect(reachPoints(0.737, 0.4, 0.737)).toBeCloseTo(100);
    expect(reachPoints(0.4, 0.4, 0.737)).toBeCloseTo(0);
    expect(reachPoints(0.5685, 0.4, 0.737)).toBeCloseTo(50);
  });

  it("reports tokens, wall time, tool calls by name and the stop reason", async () => {
    const report = await evaluate({
      benchmark: slice(benchmark.entries, 2),
      generate: (concept) =>
        Promise.resolve({
          clean: true,
          cost: {
            finishReason: "stop",
            ms: 1000,
            toolCalls: { lint: 1, rect: 2 },
            usage: {
              cacheReadTokens: 200_000,
              cacheWriteTokens: 0,
              inputTokens: 10_000,
              outputTokens: 2000,
              reasoningTokens: 500,
            },
          },
          doc: { draw: [], icon: concept.name, keyline: null },
          issues: [],
          steps: 3,
          svg: svg("M4 4H20V20H4Z"),
          text: "",
          trace: [],
        }),
      icons: universe(),
      model,
      provenance: {
        date: "2026-08-19",
        origin: "original",
        set: "blode-icons",
        usage: "conditioning",
      },
    });

    expect(report.cost.usage.inputTokens).toBe(20_000);
    expect(report.cost.usage.cacheReadTokens).toBe(400_000);
    expect(report.cost.toolCalls).toEqual({ lint: 2, rect: 4 });
    expect(report.cost.stopReasons).toEqual({ stop: 2 });
    expect(report.cost.msTotal).toBe(2000);
    expect(report.cost.measured).toBe(2);
    // Two icons at $5/Mtok in, $0.50/Mtok cache read, $25/Mtok out.
    expect(report.cost.usd).toBeCloseTo(2 * (0.05 + 0.1 + 0.05), 6);
    // The table travels with the number, so the figure can be re-derived when
    // prices move.
    expect(report.cost.rates["claude-opus-5"]).toEqual(RATES["claude-opus-5"]);
  });

  it("aborts on the spend cap instead of discovering the cost afterwards", async () => {
    const report = await evaluate({
      benchmark: slice(benchmark.entries, 20),
      // Serial, so the cap is checked before each generation and at most the
      // one in flight can overrun it.
      concurrency: 1,
      generate: (concept) =>
        Promise.resolve({
          clean: true,
          cost: {
            finishReason: "stop",
            ms: 10,
            toolCalls: {},
            usage: {
              cacheReadTokens: 0,
              cacheWriteTokens: 0,
              inputTokens: 0,
              // $0.25 an icon at $25/Mtok output.
              outputTokens: 10_000,
              reasoningTokens: 0,
            },
          },
          doc: { draw: [], icon: concept.name, keyline: null },
          issues: [],
          steps: 1,
          svg: svg("M4 4H20V20H4Z"),
          text: "",
          trace: [],
        }),
      icons: universe(),
      maxSpendUsd: 1,
      model,
      provenance: {
        date: "2026-08-19",
        origin: "original",
        set: "blode-icons",
        usage: "conditioning",
      },
    });

    expect(report.n).toBe(4);
    expect(report.benchmark.requested).toBe(20);
    expect(report.aborted).toMatch(/cap/u);
    expect(report.cost.usd).toBeCloseTo(1, 6);
  });
});

/**
 * The committed closures against the corpus as it stands. Gated on the store
 * because it is gitignored: this asserts the snapshot has not gone stale, and
 * the leakage test above holds without it.
 */
describe.skipIf(!existsSync(CORPUS_FILE))(
  "committed closures vs the live corpus",
  () => {
    it("is a subset of what the corpus says today", () => {
      const records = loadRecords(CORPUS_FILE);
      const refreshed = refreshClosures(benchmark.entries, records);
      for (const [i, entry] of benchmark.entries.entries()) {
        const live = new Set(refreshed[i].closure);
        const dropped = entry.closure.filter((id) => !live.has(id));
        // A committed member the corpus no longer relates is not an error —
        // `refreshClosures` unions rather than replaces, so the run still
        // withholds it — but it means the file is drifting and should be
        // rebuilt.
        expect({ dropped, entry: entry.slug }).toEqual({
          dropped: [],
          entry: entry.slug,
        });
      }
    });

    it("excludes a workable share of the set, not most of it", () => {
      const records = loadRecords(CORPUS_FILE);
      const blode = new Set(
        records.filter((r) => r.set === "blode-icons").map((r) => r.slug)
      );
      const excluded = benchmarkExclusions(slice(benchmark.entries, 30));
      const hit = [...excluded].filter((s) => blode.has(s));
      // Measured: the 30-icon baseline slice withholds 261 of 2,221 blode icons
      // and leaves 1,960 in the corpus. A closure that took most of the set
      // would be measuring a model shown nothing rather than a model reasoning
      // from a set.
      expect(hit.length).toBeLessThan(blode.size * 0.25);
    });
  }
);

describe("evaluateSeeds", () => {
  /** The number without which no later result is interpretable: a pipeline
   *  change that moves treatment by less than the seed-to-seed spread has
   *  moved nothing, and one run cannot say which side of that line it is on. */
  it("records the seed-to-seed spread across replicates", async () => {
    const report = await evaluateSeeds(
      {
        benchmark: slice(benchmark.entries, 3),
        generate: (concept) =>
          Promise.resolve({
            clean: true,
            doc: { draw: [], icon: concept.name, keyline: null },
            issues: [],
            steps: 1,
            svg: svg("M4 4H20V20H4Z"),
            text: "",
            trace: [],
          }),
        icons: universe(),
        model,
        provenance: {
          date: "2026-08-19",
          origin: "original",
          set: "blode-icons",
          usage: "conditioning",
        },
      },
      [1, 2, 3]
    );

    expect(report.runs).toHaveLength(3);
    expect(report.seeds).toEqual([1, 2, 3]);
    // The stub draws the same square every time, so the treatments agree and
    // the spread is 0. What is asserted is that the spread is computed and
    // reported at all — a real run's value is the point of the protocol.
    expect(report.spread).toBe(0);
    expect(report.treatment).toBeCloseTo(report.runs[0].treatment, 10);
  });
});
