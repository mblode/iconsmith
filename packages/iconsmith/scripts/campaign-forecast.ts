/** Resource estimates from a complete frozen cohort, never from deadline ceilings. */
import { createHash } from "node:crypto";

import { reportCampaign } from "./campaign-manifest.js";
import type {
  CampaignResult,
  createCampaignManifest,
} from "./campaign-manifest.js";

type Campaign = ReturnType<typeof createCampaignManifest>;
export interface ForecastObservation {
  result: CampaignResult;
  runtimeHash: string;
  toolingHash: string;
  routeHash: string;
}

const percentile = (values: readonly number[], fraction: number) => {
  const sorted = values.toSorted((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
};

/** A planning estimate is not permission to dispatch or a quality qualification. */
// eslint-disable-next-line complexity
export const forecastCampaign = (options: {
  cohort: Campaign;
  target: Campaign;
  observations: readonly ForecastObservation[];
  concurrency: number;
}) => {
  const { cohort, target, observations, concurrency } = options;
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) {
    throw new Error("Forecast concurrency must be a positive integer");
  }
  if (cohort.manifest.kind !== "development") {
    throw new Error("Forecast requires the declared development cohort");
  }
  reportCampaign(target, []);
  const report = reportCampaign(
    cohort,
    observations.map(({ result }) => result)
  );
  if (!report.coverageComplete) {
    throw new Error("Development forecast cohort is incomplete");
  }
  const identities = new Set(
    observations.map(({ runtimeHash, toolingHash, routeHash }) => {
      if (
        [runtimeHash, toolingHash, routeHash].some(
          (hash) => !/^[a-f0-9]{64}$/u.test(hash)
        )
      ) {
        throw new Error("Missing frozen runtime, tooling or route identity");
      }
      return `${runtimeHash}/${toolingHash}/${routeHash}`;
    })
  );
  if (identities.size !== 1) {
    throw new Error("Development forecast has mixed experiment identity");
  }
  const pairs = new Map<string, ForecastObservation[]>();
  for (const observation of observations) {
    const rows = pairs.get(observation.result.requestId) ?? [];
    rows.push(observation);
    pairs.set(observation.result.requestId, rows);
  }
  if ([...pairs.values()].some((rows) => rows.length !== 2)) {
    throw new Error("Development forecast has an incomplete paint pair");
  }
  const requests = [...pairs.values()].map((rows) => rows[0].result);
  const times = requests.flatMap(({ elapsedMs }) =>
    elapsedMs === null ? [] : [elapsedMs]
  );
  if (times.length !== requests.length || !times.length) {
    throw new Error("Development forecast lacks measured request timing");
  }
  const acceptedPairs = [...pairs.values()].filter(
    (rows) =>
      rows.length === 2 &&
      rows.every(({ result }) => result.status === "accepted")
  ).length;
  const terminalPairs = pairs.size;
  const measured = true;
  const totalMs = times.reduce((sum, value) => sum + value, 0);
  const meanMs = measured ? totalMs / terminalPairs : null;
  const serialHours =
    meanMs === null
      ? null
      : (meanMs * target.resources.pairRequests) / 3_600_000;
  const receiptedUsd = requests.reduce(
    (sum, row) => sum + (row.actualUsd ?? 0),
    0
  );
  const unknownCostRequests = requests.filter(
    ({ actualUsd }) => actualUsd === null
  ).length;
  const costKnown = measured && unknownCostRequests === 0;
  const result = {
    assumptions: [
      "All failed requests contribute time and cost; no successful-only extrapolation.",
      "Observed development request mix is assumed representative of the target catalog.",
      "Ideal parallel hours exclude contention, throttling, queueing and subscription resets.",
      "Native subscription dollars remain unknown unless explicitly receipted.",
      "Acceptance yield and critic qualification must be checked separately before dispatch.",
    ],
    authority: "measured-resource-planning-only",
    cohortHash: cohort.hash,
    dispatchAuthorized: false,
    forecast: {
      actualSchedulingOverheadMeasured: false,
      concurrency,
      idealParallelHours:
        serialHours === null ? null : serialHours / concurrency,
      pairRequests: target.resources.pairRequests,
      providerCostUsd: costKnown
        ? (receiptedUsd / terminalPairs) * target.resources.pairRequests
        : null,
      serialHours,
    },
    identity: identities.size === 1 ? [...identities][0] : null,
    measured,
    observations: {
      acceptedPairs,
      costPerAcceptedPairUsd:
        costKnown && acceptedPairs ? receiptedUsd / acceptedPairs : null,
      expectedPairs: cohort.resources.pairRequests,
      knownUsd: costKnown ? receiptedUsd : null,
      meanMs,
      missingSlots: report.missing,
      p50Ms: measured ? percentile(times, 0.5) : null,
      p95Ms: measured ? percentile(times, 0.95) : null,
      terminalPairs,
      unknownCostRequests,
    },
    qualified: false,
    reasons: [],
    targetHash: target.hash,
  };
  return {
    ...result,
    evidenceHash: createHash("sha256")
      .update(JSON.stringify({ observations, result }))
      .digest("hex"),
  };
};
