import { expect, test } from "vitest";

import { forecastCampaign } from "./campaign-forecast.js";
import { createCampaignManifest } from "./campaign-manifest.js";

const source = {
  sources: [{ id: "blode-icons", records: 2, treeHash: "a".repeat(64) }],
};
const cohort = createCampaignManifest("development", source, []);
const target = createCampaignManifest("catalog", source, [
  { set: "blode-icons", slug: "bell" },
  { set: "blode-icons", slug: "cloud" },
]);
const rows = () =>
  cohort.manifest.slots.map((slot, index) => ({
    result: {
      actualUsd: 1 as number | null,
      artifactHash: index < 4 ? null : "e".repeat(64),
      elapsedMs: index < 4 ? 1_200_000 : 60_000,
      requestId: `${slot.family}/${slot.nativeSize}`,
      slotId: slot.slotId,
      status:
        index < 4 ? ("deadline-exhausted" as const) : ("accepted" as const),
    },
    routeHash: "d".repeat(64),
    runtimeHash: "b".repeat(64),
    toolingHash: "c".repeat(64),
  }));

test("forecast includes failed-pair resources once and labels ideal concurrency", () => {
  const result = forecastCampaign({
    cohort,
    concurrency: 2,
    observations: rows(),
    target,
  });
  expect(result.measured).toBe(true);
  expect(result.observations).toMatchObject({
    acceptedPairs: 38,
    costPerAcceptedPairUsd: 40 / 38,
    knownUsd: 40,
    meanMs: 117_000,
    terminalPairs: 40,
  });
  expect(result.forecast).toMatchObject({
    actualSchedulingOverheadMeasured: false,
    idealParallelHours: 0.065,
    providerCostUsd: 4,
    serialHours: 0.13,
  });
  expect(result.dispatchAuthorized).toBe(false);
});

test("rejects partial or mixed-identity cohorts and keeps unknown native cost null", () => {
  expect(() =>
    forecastCampaign({
      cohort,
      concurrency: 1,
      observations: rows().slice(0, 2),
      target,
    })
  ).toThrow("incomplete");
  const mixed = rows();
  mixed[0].runtimeHash = "f".repeat(64);
  expect(() =>
    forecastCampaign({ cohort, concurrency: 1, observations: mixed, target })
  ).toThrow("mixed experiment identity");
  const unknown = rows().map((row) => ({
    ...row,
    result: { ...row.result, actualUsd: null },
  }));
  const result = forecastCampaign({
    cohort,
    concurrency: 1,
    observations: unknown,
    target,
  });
  expect(result.measured).toBe(true);
  expect(result.observations.unknownCostRequests).toBe(40);
  expect(result.observations.knownUsd).toBeNull();
  expect(result.forecast.providerCostUsd).toBeNull();
  expect(result.observations.costPerAcceptedPairUsd).toBeNull();
});
