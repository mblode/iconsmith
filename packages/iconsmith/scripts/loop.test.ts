import { describe, expect, it } from "vitest";

import type { IconScore } from "../src/pipeline/eval.js";
import { judge, wilcoxon } from "./loop.js";

const ok = (icon: string, score: number, clean = true): IconScore =>
  ({
    clean,
    floor: 0,
    icon,
    issues: 0,
    ms: 1,
    score,
    status: "ok",
    steps: 1,
    stopReason: "clean",
    tags: [],
    toolCalls: {},
    usage: null,
    usd: null,
  }) as unknown as IconScore;

const arm = (scores: number[], clean = true) =>
  scores.map((s, i) => ok(`i${i}`, s, clean));

/**
 * These pin the rule that decides whether a change to the generator is kept.
 * Every one of them encodes a way a loop talks itself into a win: a gain too
 * small for the metric to resolve, a gain that is not distinguishable from
 * noise, and a gain bought by drawing worse.
 */
describe("the acceptance rule", () => {
  const FLOOR = 0.03;

  it("rejects a gain under the noise floor, however consistent", () => {
    const before = arm([0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5]);
    const after = arm([0.51, 0.51, 0.51, 0.51, 0.51, 0.51, 0.51, 0.51]);
    const v = judge(before, after, FLOOR);
    expect(v.accepted).toBe(false);
    expect(v.reasons.join(" ")).toMatch(/noise floor/u);
  });

  it("rejects a large median that is not significant", () => {
    const before = arm([0.5, 0.5, 0.5]);
    const after = arm([0.9, 0.9, 0.9]);
    const v = judge(before, after, FLOOR);
    expect(v.accepted).toBe(false);
    expect(v.reasons.join(" ")).toMatch(/signed-rank/u);
  });

  it("rejects a real gain bought by a fall in lint-clean rate", () => {
    const before = arm([0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5], true);
    const after = arm([0.7, 0.7, 0.7, 0.7, 0.7, 0.7, 0.7, 0.7], false);
    const v = judge(before, after, FLOOR);
    expect(v.accepted).toBe(false);
    expect(v.reasons.join(" ")).toMatch(/lint-clean/u);
  });

  it("accepts a gain that is large, consistent and clean", () => {
    const before = arm([0.4, 0.45, 0.5, 0.55, 0.6, 0.42, 0.48, 0.52]);
    const after = arm([0.5, 0.55, 0.6, 0.65, 0.7, 0.52, 0.58, 0.62]);
    const v = judge(before, after, FLOOR);
    expect(v.accepted).toBe(true);
    expect(v.medianDelta).toBeCloseTo(0.1, 5);
  });

  it("reports no pairs rather than inventing a verdict", () => {
    const v = judge(arm([0.5]), [ok("other", 0.9)], FLOOR);
    expect(v.accepted).toBe(false);
    expect(v.reasons.join(" ")).toMatch(/no paired icons/u);
  });
});

describe("wilcoxon", () => {
  it("refuses to call significance on a sample too small to have any", () => {
    expect(wilcoxon([0.1, 0.1, 0.1]).p).toBe(1);
  });

  it("drops ties rather than counting them as evidence", () => {
    expect(wilcoxon([0, 0, 0, 0.1]).n).toBe(1);
  });
});
