import { expect, test } from "vitest";

import { FAMILY_CLASSES } from "./family-morphology.js";
import {
  createCatalogAuditSample,
  reportFamilyClusteredRate,
} from "./quality-population.js";

test("selects one canonical per resolved family across morphology strata", () => {
  const tokens = ["folder", "wheel", "upload", "leaf", "bell", "symbol"];
  const records = tokens.flatMap((token) =>
    Array.from({ length: 20 }, (_, index) => ({
      set: "blode-icons",
      slug: `${token}-${index + 1}`,
    }))
  );
  const roles = records.map(({ slug }) => ({
    family: `family:${slug}`,
    head: slug,
    role: "canonical" as const,
    slug,
  }));
  const first = createCatalogAuditSample(records, roles, "catalog-audit-v1");
  expect(first).toEqual(
    createCatalogAuditSample(records, roles, "catalog-audit-v1")
  );
  expect(first.manifest).toMatchObject({
    familyCount: 100,
    independence: "catalog-semantic-family",
    purpose: "development-blind-audit",
    qualificationEligible: false,
  });
  expect(first.manifest.slots).toHaveLength(400);
  expect(
    new Set(first.manifest.families.map(({ family }) => family)).size
  ).toBe(100);
  expect(
    FAMILY_CLASSES.every((morphology) =>
      first.manifest.families.some((row) => row.morphology === morphology)
    )
  ).toBe(true);
});

const clusteredFixture = () => ({
  observations: [
    { slotId: "a/16", success: true },
    { slotId: "a/24", success: true },
    { slotId: "b/16", success: false },
    { slotId: "b/24", success: null },
  ],
  populationId: "novel-a/outlined",
  requestedSlots: [
    { familyId: "a", slotId: "a/16" },
    { familyId: "a", slotId: "a/24" },
    { familyId: "b", slotId: "b/16" },
    { familyId: "b", slotId: "b/24" },
    { familyId: "c", slotId: "c/16" },
    { familyId: "c", slotId: "c/24" },
  ],
  resamplingCount: 1000,
  samplingScope: "self-weighting-probability-stratum" as const,
  seed: "frozen-test-v1",
});

test("clustered rate retains missing and unresolved slots and is order invariant", () => {
  const input = clusteredFixture();
  const result = reportFamilyClusteredRate(input);
  expect(result).toMatchObject({
    empiricalRate: 1 / 3,
    familyCount: 3,
    missing: 2,
    qualificationEligible: false,
    requested: 6,
    successes: 2,
    unresolved: 1,
  });
  expect(result).toEqual(
    reportFamilyClusteredRate({
      ...input,
      observations: [...input.observations].toReversed(),
      requestedSlots: [...input.requestedSlots].toReversed(),
    })
  );
  // With three whole-family draws the distribution includes zero and all
  // successful families. Independent slot draws would narrow this interval.
  expect(result.interval.lower).toBe(0);
  expect(result.interval.upper).toBe(1);
});

test("clustered rate refuses denominator and observation corruption", () => {
  const input = clusteredFixture();
  expect(() =>
    reportFamilyClusteredRate({
      ...input,
      requestedSlots: [...input.requestedSlots, input.requestedSlots[0]],
    })
  ).toThrow("Invalid frozen");
  expect(() =>
    reportFamilyClusteredRate({
      ...input,
      observations: [...input.observations, input.observations[0]],
    })
  ).toThrow("Duplicate");
  expect(() =>
    reportFamilyClusteredRate({
      ...input,
      observations: [{ slotId: "not-requested", success: true }],
    })
  ).toThrow("unknown");
  expect(() => reportFamilyClusteredRate({ ...input, seed: "" })).toThrow();
  expect(() =>
    reportFamilyClusteredRate({ ...input, resamplingCount: 999 })
  ).toThrow();
});

test("one family reports a degenerate descriptive interval, never qualification", () => {
  const result = reportFamilyClusteredRate({
    ...clusteredFixture(),
    observations: [{ slotId: "a/16", success: true }],
    requestedSlots: [
      { familyId: "a", slotId: "a/16" },
      { familyId: "a", slotId: "a/24" },
    ],
    samplingScope: "supplemental",
  });
  expect(result.interval).toMatchObject({
    lower: 0.5,
    singleFamilyDegenerate: true,
    upper: 0.5,
  });
  expect(result.qualificationEligible).toBe(false);
});
