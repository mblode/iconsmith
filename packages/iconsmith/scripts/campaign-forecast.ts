/** Resource estimates from a complete frozen cohort, never from deadline ceilings. */
import { createHash } from "node:crypto";

import { reportCampaign } from "./campaign-manifest.js";
import type {
  CampaignResult,
  createCampaignManifest,
} from "./campaign-manifest.js";

type Campaign = ReturnType<typeof createCampaignManifest>;
interface ForecastRequestTelemetry {
  /** Mutually exclusive wall-time buckets; their sum must equal elapsedMs. */
  stageMs: {
    author: number;
    export: number;
    inspection: number;
    other: number;
    queue: number;
    repair: number;
    retrieval: number;
    review: number;
    startup: number;
  };
  nativeCalls: number;
  nativeInputTokens: number | null;
  nativeOutputTokens: number | null;
  diskBytes: number;
  retrievalTemperature: "cold" | "warm" | "none";
  observedConcurrency: number;
}

export interface ForecastObservation {
  result: CampaignResult;
  telemetry: ForecastRequestTelemetry;
  runtimeHash: string;
  toolingHash: string;
  routeHash: string;
}

const percentile = (values: readonly number[], fraction: number) => {
  const sorted = values.toSorted((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
};

const STAGES = [
  "author",
  "export",
  "inspection",
  "other",
  "queue",
  "repair",
  "retrieval",
  "review",
  "startup",
] as const;

const validateTelemetry = (row: ForecastObservation) => {
  const t = row.telemetry;
  if (
    !t ||
    !t.stageMs ||
    Object.keys(t.stageMs).toSorted().join("/") !==
      [...STAGES].toSorted().join("/")
  ) {
    throw new Error("Forecast requires complete request stage telemetry");
  }
  const values = STAGES.map((stage) => t.stageMs[stage]);
  if (
    values.some((value) => !Number.isFinite(value) || value < 0) ||
    values.reduce((sum, value) => sum + value, 0) !== row.result.elapsedMs
  ) {
    throw new Error(
      "Forecast stage timing does not reconcile with request elapsedMs"
    );
  }
  for (const value of [t.nativeCalls, t.diskBytes, t.observedConcurrency]) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error("Invalid forecast call, disk or concurrency telemetry");
    }
  }
  if (
    t.observedConcurrency < 1 ||
    !["cold", "warm", "none"].includes(t.retrievalTemperature)
  ) {
    throw new Error("Invalid forecast retrieval or concurrency observation");
  }
  for (const value of [t.nativeInputTokens, t.nativeOutputTokens]) {
    if (value !== null && (!Number.isSafeInteger(value) || value < 0)) {
      throw new Error("Unknown token usage must be explicit null");
    }
  }
  return JSON.stringify([
    values,
    t.nativeCalls,
    t.nativeInputTokens,
    t.nativeOutputTokens,
    t.diskBytes,
    t.retrievalTemperature,
    t.observedConcurrency,
  ]);
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
  for (const rows of pairs.values()) {
    if (new Set(rows.map(validateTelemetry)).size !== 1) {
      throw new Error("Paint pair has mismatched request telemetry");
    }
  }
  const requestObservations = [...pairs.values()].map((rows) => rows[0]);
  const requests = requestObservations.map(({ result }) => result);
  const telemetry = requestObservations.map(({ telemetry: value }) => value);
  const stageTotalsMs = Object.fromEntries(
    STAGES.map((stage) => [
      stage,
      telemetry.reduce((sum, value) => sum + value.stageMs[stage], 0),
    ])
  );
  const tokenTotal = (key: "nativeInputTokens" | "nativeOutputTokens") =>
    telemetry.some((value) => value[key] === null)
      ? null
      : telemetry.reduce((sum, value) => sum + (value[key] ?? 0), 0);
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
      acceptedPairYield: acceptedPairs / terminalPairs,
      acceptedPairs,
      costPerAcceptedPairUsd:
        costKnown && acceptedPairs ? receiptedUsd / acceptedPairs : null,
      diskBytes: telemetry.reduce((sum, value) => sum + value.diskBytes, 0),
      expectedPairs: cohort.resources.pairRequests,
      knownUsd: costKnown ? receiptedUsd : null,
      meanMs,
      missingSlots: report.missing,
      nativeCalls: telemetry.reduce((sum, value) => sum + value.nativeCalls, 0),
      nativeInputTokens: tokenTotal("nativeInputTokens"),
      nativeOutputTokens: tokenTotal("nativeOutputTokens"),
      observedConcurrency: [
        ...new Set(telemetry.map((value) => value.observedConcurrency)),
      ].toSorted((a, b) => a - b),
      p50Ms: measured ? percentile(times, 0.5) : null,
      p95Ms: measured ? percentile(times, 0.95) : null,
      retrieval: Object.fromEntries(
        (["cold", "warm", "none"] as const).map((temperature) => {
          const selected = telemetry.filter(
            (value) => value.retrievalTemperature === temperature
          );
          return [
            temperature,
            {
              requests: selected.length,
              totalMs: selected.reduce(
                (sum, value) => sum + value.stageMs.retrieval,
                0
              ),
            },
          ];
        })
      ),
      stageTotalsMs,
      terminalPairs,
      unknownCostRequests,
      unknownTokenRequests: telemetry.filter(
        (value) =>
          value.nativeInputTokens === null || value.nativeOutputTokens === null
      ).length,
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
