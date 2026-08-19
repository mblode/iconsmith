import { describe, expect, it } from "vitest";

import { formatPanel, median, read } from "./panel.js";

describe("read", () => {
  it("puts reach at 1 when treatment equals the baseline", () => {
    const r = read({
      baseline: 0.6,
      ceiling: 0.9,
      floor: 0.2,
      n: 10,
      treatment: 0.6,
    });
    expect(r.reach).toBe(1);
  });

  it("puts reach at 0 when treatment equals the floor", () => {
    const r = read({
      baseline: 0.6,
      ceiling: 0.9,
      floor: 0.2,
      n: 10,
      treatment: 0.2,
    });
    expect(r.reach).toBe(0);
  });

  it("reports a negative reach rather than clamping it", () => {
    // Below the floor means the pipeline is doing worse than no information at
    // all — the one case a reader most needs to see, and the one clamping hides.
    const r = read({
      baseline: 0.6,
      ceiling: 0.9,
      floor: 0.2,
      n: 10,
      treatment: 0.1,
    });
    expect(r.reach).toBeLessThan(0);
  });

  it("returns null reach for a null treatment rather than 0", () => {
    const r = read({
      baseline: 0.6,
      ceiling: 0.9,
      floor: 0.2,
      n: 10,
      treatment: null,
    });
    expect(r.reach).toBeNull();
  });

  it("returns null reach on a zero-width scale rather than Infinity", () => {
    const r = read({
      baseline: 0.2,
      ceiling: 0.9,
      floor: 0.2,
      n: 10,
      treatment: 0.5,
    });
    expect(r.reach).toBeNull();
  });

  it("flags a treatment near the ceiling as suspect", () => {
    const r = read({
      baseline: 0.6,
      ceiling: 0.9,
      floor: 0.2,
      n: 10,
      treatment: 0.89,
    });
    expect(r.suspect).toContain("leak");
  });

  it("does not flag a treatment at the baseline", () => {
    const r = read({
      baseline: 0.6,
      ceiling: 0.9,
      floor: 0.2,
      n: 10,
      treatment: 0.6,
    });
    expect(r.suspect).toBeNull();
  });
});

describe("median", () => {
  it("averages the middle pair for an even count", () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it("does not mutate its input", () => {
    const xs = [3, 1, 2];
    median(xs);
    expect(xs).toEqual([3, 1, 2]);
  });
});

describe("formatPanel", () => {
  it("renders a null treatment as an em-dash row, not as 0.000", () => {
    const lines = formatPanel(
      "style",
      read({ baseline: 0.6, ceiling: 0.9, floor: 0.2, n: 4, treatment: null }),
      { baseline: "b", ceiling: "c", floor: "f" }
    );
    const treatment = lines.find((l) => l.includes("treatment")) ?? "";
    expect(treatment).not.toContain("0.000");
    expect(treatment).toContain("——");
  });
});
