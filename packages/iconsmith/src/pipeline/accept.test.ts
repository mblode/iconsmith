/**
 * The gate's job is to make the split cost something. These pin the three
 * things that would quietly undo that:
 *
 * 1. A candidate reaching the selection slice without passing the screen —
 *    the saving evaporates.
 * 2. A candidate being *accepted* on the feedback slice — the guarantee
 *    evaporates, because that slice is what the proposal was fitted to.
 * 3. The two stages being handed different arms, or a slice's scores leaking
 *    across the partition.
 */
import { describe, expect, it } from "vitest";

import { formatStaged, scoresOf, twoStage } from "./accept.js";
import type { Verdictish } from "./accept.js";
import type { BenchmarkEntry, Split } from "./bench.js";
import type { IconScore } from "./eval.js";

const entry = (slug: string, split: Split, rank: number): BenchmarkEntry =>
  ({
    closure: [],
    id: `blode-icons/${slug}`,
    rank,
    set: "blode-icons",
    slug,
    split,
    strata: {},
  }) as unknown as BenchmarkEntry;

/** 4 feedback icons, 4 selection, 2 sealed — enough to tell the partition
 *  apart, small enough to read. */
const ENTRIES: BenchmarkEntry[] = [
  ...["f0", "f1", "f2", "f3"].map((s, i) => entry(s, "feedback", i)),
  ...["s0", "s1", "s2", "s3"].map((s, i) => entry(s, "selection", 4 + i)),
  ...["z0", "z1"].map((s, i) => entry(s, "sealed", 8 + i)),
];

const score = (icon: string, value: number): IconScore =>
  ({ clean: true, icon, score: value, status: "ok" }) as unknown as IconScore;

/** Every icon in the file at one value, so a stage that reads the wrong slice
 *  still gets numbers and has to be caught by *which* numbers. */
const arm = (
  feedback: number,
  selection: number,
  sealed = 0.5
): IconScore[] => [
  ...["f0", "f1", "f2", "f3"].map((s) => score(s, feedback)),
  ...["s0", "s1", "s2", "s3"].map((s) => score(s, selection)),
  ...["z0", "z1"].map((s) => score(s, sealed)),
];

interface Fake extends Verdictish {
  floor: number;
  icons: string[];
}

/**
 * A judge that records what it was asked, so the assertions are about routing
 * rather than about statistics. `scripts/loop.ts` owns the real rule and has
 * its own tests; duplicating them here would pin the same thing twice and
 * couple this file to a threshold it does not choose.
 */
const spy = () => {
  const calls: Fake[] = [];
  const judge = (
    champion: readonly IconScore[],
    variant: readonly IconScore[],
    floor: number
  ): Fake => {
    let delta = 0;
    for (const [i, v] of variant.entries()) {
      delta +=
        ((v as unknown as { score: number }).score -
          (champion[i] as unknown as { score: number }).score) /
        variant.length;
    }
    const call: Fake = {
      accepted: delta >= floor && variant.length > 0,
      floor,
      icons: variant.map((v) => v.icon),
      medianDelta: delta,
      reasons:
        delta >= floor ? [] : [`delta ${delta.toFixed(3)} under ${floor}`],
    };
    calls.push(call);
    return call;
  };
  return { calls, judge };
};

describe("the two-stage gate", () => {
  it("screens on feedback and never pays for selection when the screen fails", () => {
    const { calls, judge } = spy();
    const v = twoStage({
      champion: arm(0.5, 0.5),
      entries: ENTRIES,
      judge,
      noiseFloor: 0.03,
      // Worse on the icons it was written against. Nothing else matters.
      variant: arm(0.4, 0.9),
    });
    expect(v.stage).toBe("screened-out");
    expect(v.accepted).toBe(false);
    expect(v.selection).toBeNull();
    // The judge was consulted exactly once, and only about feedback icons.
    expect(calls).toHaveLength(1);
    expect(calls[0].icons).toEqual(["f0", "f1", "f2", "f3"]);
    // Four generations per arm, not ten. That saving is the reason the screen
    // exists at all.
    expect(v.spent).toBe(4);
  });

  /**
   * The screen asks "not worse", the decision asks "better than the noise
   * floor". A candidate that is merely not-worse must survive the screen and
   * then be rejected — if the screen used the strict floor it would throw away
   * real winners at n=60, and a false negative here is a change nobody
   * revisits.
   */
  it("screens leniently and decides strictly", () => {
    const { calls, judge } = spy();
    const v = twoStage({
      champion: arm(0.5, 0.5),
      entries: ENTRIES,
      judge,
      noiseFloor: 0.03,
      variant: arm(0.5, 0.51),
    });
    expect(calls.map((c) => c.floor)).toEqual([0, 0.03]);
    expect(v.stage).toBe("rejected");
    expect(v.accepted).toBe(false);
    // It did reach the selection slice, so it was measured rather than skipped.
    expect(v.selection).not.toBeNull();
    expect(v.spent).toBe(8);
  });

  it("accepts only on the selection slice, and never on the feedback one", () => {
    const { calls, judge } = spy();
    const v = twoStage({
      champion: arm(0.5, 0.5),
      entries: ENTRIES,
      // Flat on feedback, a real gain on selection: the acceptance cannot have
      // come from the slice the proposal was fitted to.
      judge,
      noiseFloor: 0.03,
      variant: arm(0.5, 0.6),
    });
    expect(v.stage).toBe("accepted");
    expect(v.accepted).toBe(true);
    expect(calls[1].icons).toEqual(["s0", "s1", "s2", "s3"]);
  });

  /**
   * The one that would be invisible: sealed icons reaching either stage. It
   * would not change a verdict's shape or its sign, only quietly spend the one
   * number that was never optimised against.
   */
  it("never routes a sealed icon into either stage", () => {
    const { calls, judge } = spy();
    twoStage({
      champion: arm(0.5, 0.5),
      entries: ENTRIES,
      judge,
      noiseFloor: 0.03,
      variant: arm(0.5, 0.6),
    });
    for (const call of calls) {
      expect(call.icons).not.toContain("z0");
      expect(call.icons).not.toContain("z1");
    }
  });

  it("partitions scores by split and ignores icons the benchmark does not name", () => {
    const scores = [...arm(0.5, 0.5), score("not-in-benchmark", 0.9)];
    expect(scoresOf(scores, ENTRIES, "feedback").map((s) => s.icon)).toEqual([
      "f0",
      "f1",
      "f2",
      "f3",
    ]);
    expect(scoresOf(scores, ENTRIES, "sealed").map((s) => s.icon)).toEqual([
      "z0",
      "z1",
    ]);
  });
});

describe("formatStaged", () => {
  /**
   * A reader who sees a feedback median next to the word "rejected" will
   * remember it as a measurement of the candidate. It is not one, so the
   * screen-out line does not print it.
   */
  it("reports a screen-out as a cost decision, without quoting it as a result", () => {
    const { judge } = spy();
    const text = formatStaged(
      twoStage({
        champion: arm(0.5, 0.5),
        entries: ENTRIES,
        judge,
        noiseFloor: 0.03,
        variant: arm(0.4, 0.9),
      })
    );
    expect(text).toMatch(/screened out/u);
    expect(text).toMatch(/not a measurement/u);
    expect(text).not.toMatch(/median delta/u);
  });

  it("quotes the selection median when there is one to quote", () => {
    const { judge } = spy();
    const text = formatStaged(
      twoStage({
        champion: arm(0.5, 0.5),
        entries: ENTRIES,
        judge,
        noiseFloor: 0.03,
        variant: arm(0.5, 0.6),
      })
    );
    expect(text).toMatch(/accepted on the selection slice/u);
    expect(text).toMatch(/median delta 0\.100/u);
  });
});
