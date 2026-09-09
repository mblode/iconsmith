/**
 * What a failed generation is allowed to do to the numbers: nothing.
 *
 * A generation that throws — a rate limit, a dropped socket, a crash in the
 * drawer — used to land in the results as a fully-formed score of 0.0 and get
 * averaged into the median, the clean rate and the cost. That is not a
 * measurement of a bad icon, it is the absence of a measurement, and the
 * difference decides A/Bs: an arm that makes one more model call than its
 * control has strictly more failure surface, so flakiness alone would depress
 * its median and hand back a confident, wrong null.
 *
 * The whole file is one comparison: a run where some entries throw against a
 * run where those entries were never asked for. Every headline number must
 * agree.
 */
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";

import type { BenchmarkEntry } from "./bench.js";
import {
  evaluate,
  evaluateSeeds,
  formatReport,
  formatSpread,
  median,
  scored,
} from "./eval.js";
import type { EvalIcon, GenerateFn } from "./eval.js";

const svg = (body: string) =>
  `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;
const stroked = (d: string) =>
  svg(`<path d="${d}" stroke="currentColor" stroke-width="2" fill="none"/>`);

const SET: EvalIcon[] = [
  {
    category: "Forms & Shapes",
    icon: "square",
    svg: stroked("M4 4H20V20H4Z"),
    tags: ["box"],
  },
  {
    category: "Forms & Shapes",
    icon: "line",
    svg: stroked("M3 12H21"),
    tags: ["rule"],
  },
  {
    category: "Arrows",
    icon: "arrow-up",
    svg: stroked("M12 20V4M6 10L12 4L18 10"),
    tags: ["north"],
  },
  {
    category: "Forms & Shapes",
    icon: "corner",
    svg: stroked("M5 5V19H19"),
    tags: ["angle"],
  },
  {
    category: "Forms & Shapes",
    icon: "cross",
    svg: stroked("M5 5L19 19M19 5L5 19"),
    tags: ["close"],
  },
];

/** One distinct drawing per icon, so the three surviving scores differ and a
 *  median is actually a choice between them. */
const DRAWN: Record<string, string> = {
  "arrow-up": stroked("M12 19V5M7 10L12 5L17 10"),
  corner: stroked("M6 6V18H18"),
  cross: stroked("M6 6L18 18M18 6L6 18"),
  line: stroked("M4 12H20"),
  square: stroked("M5 5H19V19H5Z"),
};

const entry = (slug: string, rank: number): BenchmarkEntry => ({
  closure: [],
  id: `blode-icons/${slug}`,
  rank,
  set: "blode-icons",
  slug,
  strata: {
    category: "Forms & Shapes",
    cohort: "singleton",
    concept: "none",
    elements: "1-2",
    keyline: "on",
    tags: "1-3",
  },
});

const bench = (...slugs: string[]): BenchmarkEntry[] => slugs.map(entry);

/** `throws` names the icons whose generation blows up; `dirty` the ones that
 *  come back with a lint error. Everything else draws cleanly. */
const generator =
  (throws: string[], dirty: string[] = []): GenerateFn =>
  (concept) => {
    if (throws.includes(concept.name)) {
      return Promise.reject(new Error(`rate limited: ${concept.name}`));
    }
    return Promise.resolve({
      clean: !dirty.includes(concept.name),
      doc: { draw: [], icon: concept.name, keyline: null },
      issues: [],
      steps: 1,
      svg: DRAWN[concept.name],
      text: "",
      trace: [],
    });
  };

const provenance = {
  date: "2026-08-19",
  origin: "original",
  set: "blode-icons",
  usage: "conditioning",
} as const;

/** The two arms of every test below. `flaky` asks for all five and loses two to
 *  thrown generations; `absent` asks only for the three that would have
 *  survived. The reports must agree on every number that is a measurement. */
const arms = async (dirty: string[] = []) => {
  // Never called: every generation here comes from the injected stub. It is
  // present because `evaluate` resolves a model before it runs anything, and
  // resolving one from the environment would make this test need a key.
  const model = new MockLanguageModelV4({
    doGenerate: () => {
      throw new Error("the eval must not reach a real model");
    },
  });
  const shared = { icons: SET, model, provenance, seed: 5 };
  const flaky = await evaluate({
    ...shared,
    benchmark: bench("square", "line", "arrow-up", "corner", "cross"),
    generate: generator(["line", "cross"], dirty),
  });
  const absent = await evaluate({
    ...shared,
    benchmark: bench("square", "arrow-up", "corner"),
    generate: generator([], dirty),
  });
  return { absent, flaky };
};

describe("a thrown generation", () => {
  it("leaves the median where a run without those entries would leave it", async () => {
    const { absent, flaky } = await arms();

    expect(flaky.n).toBe(3);
    expect(absent.n).toBe(3);
    expect(flaky.treatment).toBe(absent.treatment);
    expect(flaky.mean).toBe(absent.mean);

    // And the number it is *not*: the old behaviour put two 0.0s in the sample,
    // which drags the median down to the weakest real reconstruction. If these
    // ever coincide the test has stopped discriminating.
    const values = flaky.icons.filter(scored).map((s) => s.score);
    const polluted = median([...values, 0, 0]);
    expect(polluted).toBeLessThan(flaky.treatment);
  });

  it("is counted and named rather than silently absorbed", async () => {
    const { flaky } = await arms();

    expect(flaky.benchmark).toEqual({
      entries: 3,
      errors: 2,
      requested: 5,
      seed: 5,
    });

    const failed = flaky.icons.filter((i) => !scored(i));
    expect(failed.map((f) => f.icon).toSorted()).toEqual(["cross", "line"]);

    // An entry that threw carries no score at all — not a zero, not an
    // undefined that reads as one.
    for (const f of failed) {
      expect(f).not.toHaveProperty("score");
      expect(f.status).toBe("error");
    }

    const text = formatReport(flaky);
    expect(text).toContain("3/5 benchmark icons, 2 errored and excluded");
    expect(text).toContain("2 failed to generate:");
    expect(text).toContain("rate limited: line");
    expect(text).toContain("rate limited: cross");
  });

  it("stays out of the clean rate, whose denominator is the icons that drew", async () => {
    // One of the three survivors lints dirty: the honest rate is 2/3, and the
    // polluted one would have been 2/5.
    const { absent, flaky } = await arms(["corner"]);

    expect(formatReport(flaky)).toContain("2/3 lint clean");
    expect(flaky.metrics).not.toBeNull();
    expect(flaky.metrics?.conformance.gate.treatment).toBeCloseTo(2 / 3, 10);
    expect(flaky.metrics?.conformance.strict.treatment).toBeCloseTo(2 / 3, 10);
    // The gate's own denominator is every *measured* icon, so the icon that
    // lints dirty is disqualified and the two that threw are not counted at all.
    expect(flaky.metrics?.disqualified).toBe(1);
    expect(flaky.metrics?.n).toBe(2);
    expect(flaky.metrics).toEqual(absent.metrics);
  });

  it("does not appear in the cost report as a free icon", async () => {
    const { absent, flaky } = await arms();

    // The stub reports no usage at all, so what is asserted is the denominator:
    // "n of N reported no usage" must count the icons that ran, not the ones
    // that failed before they could.
    expect(flaky.cost.measured).toBe(absent.cost.measured);
    expect(formatReport(flaky)).toContain("3 of 3 icons reported no usage");
  });
});

/**
 * The panel in `eval/blindspot.ts` gates on element sizing, extent, centring
 * and margin — every one of which rendered cosine provably cannot resolve, and
 * none of which can be recovered from a score. Dropping the drawing on the way
 * out of `evaluate` is therefore not a lost convenience, it is the gate going
 * dark: the loop's first real iteration refused a genuine win because the
 * panel had nothing to look at.
 */
describe("a measured score", () => {
  it("carries the drawing that was scored, so the panel has something to measure", async () => {
    const { flaky } = await arms();
    const measured = flaky.icons.filter(scored);
    expect(measured).toHaveLength(3);
    for (const s of measured) {
      expect(s.svg).toBe(DRAWN[s.icon]);
    }
  });
});

describe("a thrown generation across replicates", () => {
  it("is totalled on the spread report rather than folded into it", async () => {
    const model = new MockLanguageModelV4({
      doGenerate: () => {
        throw new Error("the eval must not reach a real model");
      },
    });
    const report = await evaluateSeeds(
      {
        benchmark: bench("square", "line", "arrow-up", "corner", "cross"),
        generate: generator(["line", "cross"]),
        icons: SET,
        model,
        provenance,
      },
      [1, 2]
    );

    // Two failures per replicate, and the stub draws the same icons every time,
    // so the seeds agree: the spread is the seed-to-seed variance, not the
    // failure rate wearing its clothes.
    expect(report.errors).toBe(4);
    expect(report.spread).toBe(0);
    expect(report.treatment).toBe(report.runs[0].treatment);
    expect(formatSpread(report)).toContain("4 generation(s) errored");
  });
});

describe("acceptance evidence through the evaluator", () => {
  it("retains and validates supplied evidence in the actual metric report", async () => {
    const model = new MockLanguageModelV4({
      doGenerate: () => {
        throw new Error("the eval must not reach a real model");
      },
    });
    const result = await evaluate({
      acceptanceEvidence: {
        contractVersion: "wrong-version",
        expectedSlots: [],
        gates: [],
        outputs: [],
        uncertainty: { method: "", resamplingCount: 0, seed: "" },
      },
      benchmark: bench("square"),
      generate: generator([]),
      icons: SET,
      model,
      provenance,
    });

    expect(result.metrics?.acceptance).toMatchObject({
      contractVersion: "wrong-version",
      envelopeValid: false,
      evidencePresent: true,
      qualification: false,
    });
    expect(result.metrics?.acceptance.reasons).toContain(
      "Acceptance contract or expected-slot identity is invalid"
    );
  });
});
