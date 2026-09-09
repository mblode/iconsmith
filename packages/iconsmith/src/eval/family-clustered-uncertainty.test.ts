import { describe, expect, it } from "vitest";

import {
  reportFamilyClusteredStatistic,
  reportFamilyClusteredStatistics,
} from "./family-clustered-uncertainty.js";

const rate = (rows: readonly boolean[]) =>
  rows.filter(Boolean).length / rows.length;

const options = {
  clusters: [
    { familyId: "a", rows: [true, true, true, true] },
    { familyId: "b", rows: [false] },
  ],
  evidenceValid: true,
  populationId: "population/rate",
  resamplingCount: 1000,
  seed: "seed-v1",
  statistic: rate,
};

describe("family-clustered uncertainty", () => {
  it("is deterministic and resamples complete unequal family clusters", () => {
    const first = reportFamilyClusteredStatistic(options);
    const second = reportFamilyClusteredStatistic({
      ...options,
      clusters: options.clusters.toReversed(),
    });
    expect(first).toEqual(second);
    expect(first.available && first.pointEstimate).toBe(0.8);
    expect(first.available && first.interval.lower).toBe(0);
    expect(first.available && first.interval.upper).toBe(1);
  });

  it("returns bounded all-success intervals", () => {
    const result = reportFamilyClusteredStatistic({
      ...options,
      clusters: [
        { familyId: "a", rows: [true, true] },
        { familyId: "b", rows: [true, true] },
      ],
    });
    expect(result.available && result.interval).toMatchObject({
      lower: 1,
      upper: 1,
    });
  });

  it("is unavailable for invalid or insufficient evidence", () => {
    expect(
      reportFamilyClusteredStatistic({ ...options, evidenceValid: false })
    ).toEqual({
      available: false,
      reason: "invalid-evidence",
    });
    expect(
      reportFamilyClusteredStatistic({
        ...options,
        clusters: [options.clusters[0]],
      })
    ).toEqual({ available: false, reason: "insufficient-families" });
  });
  it("refuses work beyond the bounded resampling budget", () => {
    const result = reportFamilyClusteredStatistic({
      ...options,
      clusters: Array.from({ length: 100 }, (_, index) => ({
        familyId: `family-${index}`,
        rows: [true],
      })),
      resamplingCount: 100_000,
    });
    expect(result).toEqual({
      available: false,
      reason: "resampling-budget-exceeded",
    });
  });

  it("keeps requested-denominator rates available when craft is wholly unobserved", () => {
    const result = reportFamilyClusteredStatistics({
      clusters: [
        { familyId: "a", rows: [{ craft: null, success: false }] },
        { familyId: "b", rows: [{ craft: null, success: false }] },
      ],
      evidenceValid: true,
      populationId: "population/no-craft",
      resamplingCount: 1000,
      seed: "seed-v1",
      statistics: {
        craft: (rows) => {
          const observed = rows.flatMap(({ craft }) =>
            craft === null ? [] : [craft]
          );
          return observed.length === 0
            ? null
            : observed.reduce((sum, value) => sum + value, 0) / observed.length;
        },
        success: (rows) =>
          rows.filter(({ success }) => success).length / rows.length,
      },
    });
    expect(result.craft).toEqual({
      available: false,
      reason: "insufficient-families",
    });
    expect(result.success).toMatchObject({
      available: true,
      interval: { lower: 0, upper: 0 },
      pointEstimate: 0,
    });
  });

  it("keeps rate intervals when a shared draw has no observed craft", () => {
    const result = reportFamilyClusteredStatistics({
      clusters: [
        { familyId: "a", rows: [{ craft: 9, success: true }] },
        { familyId: "b", rows: [{ craft: null, success: false }] },
      ],
      evidenceValid: true,
      populationId: "population/sparse-craft",
      resamplingCount: 1000,
      seed: "seed-v1",
      statistics: {
        craft: (rows) => {
          const observed = rows.flatMap(({ craft }) =>
            craft === null ? [] : [craft]
          );
          return observed.length === 0
            ? null
            : observed.reduce((sum, value) => sum + value, 0) / observed.length;
        },
        success: (rows) =>
          rows.filter(({ success }) => success).length / rows.length,
      },
    });
    expect(result.craft).toEqual({
      available: false,
      reason: "insufficient-families",
    });
    expect(result.success).toMatchObject({
      available: true,
      pointEstimate: 0.5,
    });
  });
});
