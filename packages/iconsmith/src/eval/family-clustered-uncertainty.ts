import { createHash } from "node:crypto";

export const FAMILY_CLUSTERED_BOOTSTRAP_METHOD =
  "family-cluster-percentile-sha256-counter-v1" as const;
export const FAMILY_CLUSTERED_BOOTSTRAP_CONFIDENCE = 0.95 as const;

export interface FamilyCluster<Row> {
  familyId: string;
  rows: readonly Row[];
}

interface FamilyClusteredInterval {
  confidenceLevel: typeof FAMILY_CLUSTERED_BOOTSTRAP_CONFIDENCE;
  lower: number;
  method: typeof FAMILY_CLUSTERED_BOOTSTRAP_METHOD;
  resamplingCount: number;
  scope: "descriptive-not-an-acceptance-lower-bound";
  seed: string;
  upper: number;
}

export type FamilyClusteredDiagnostic =
  | {
      available: false;
      reason:
        | "invalid-evidence"
        | "insufficient-families"
        | "resampling-budget-exceeded";
    }
  | {
      available: true;
      interval: FamilyClusteredInterval;
      pointEstimate: number;
    };

const MAXIMUM_DRAW_WORK = 1_000_000;
const drawCache = new Map<string, readonly number[]>();
let cachedDrawCount = 0;

const validCount = (count: number) =>
  Number.isInteger(count) && count >= 1000 && count <= 100_000;

const frozenDraws = (
  seed: string,
  populationId: string,
  familyCount: number,
  resamplingCount: number
): readonly number[] | null => {
  const requiredDraws = familyCount * resamplingCount;
  if (
    !Number.isSafeInteger(requiredDraws) ||
    requiredDraws > MAXIMUM_DRAW_WORK
  ) {
    return null;
  }
  const key = `${seed}\0${populationId}\0${familyCount}\0${resamplingCount}`;
  const cached = drawCache.get(key);
  if (cached) {
    return cached;
  }
  let counter = 0;
  const maximum = 0x1_00_00_00_00;
  const limit = maximum - (maximum % familyCount);
  const generated: number[] = [];
  while (generated.length < requiredDraws) {
    const value = createHash("sha256")
      .update(`${seed}\0${populationId}\0${counter}`)
      .digest()
      .readUInt32BE(0);
    counter += 1;
    if (value < limit) {
      generated.push(value % familyCount);
    }
  }
  while (
    cachedDrawCount + generated.length > MAXIMUM_DRAW_WORK &&
    drawCache.size > 0
  ) {
    const oldestKey = drawCache.keys().next().value;
    if (typeof oldestKey !== "string") {
      break;
    }
    cachedDrawCount -= drawCache.get(oldestKey)?.length ?? 0;
    drawCache.delete(oldestKey);
  }
  drawCache.set(key, generated);
  cachedDrawCount += generated.length;
  return generated;
};

const validInput = <Row>(options: {
  clusters: readonly FamilyCluster<Row>[];
  evidenceValid: boolean;
  populationId: string;
  resamplingCount: number;
  seed: string;
  statisticCount: number;
}) =>
  options.evidenceValid &&
  options.populationId.trim().length > 0 &&
  options.seed.trim().length > 0 &&
  validCount(options.resamplingCount) &&
  options.statisticCount > 0 &&
  options.clusters.every(
    ({ familyId, rows }) =>
      familyId.trim().length > 0 && Array.isArray(rows) && rows.length > 0
  ) &&
  new Set(options.clusters.map(({ familyId }) => familyId)).size ===
    options.clusters.length;

/** Deterministic descriptive percentile intervals. One family draw is shared
 * across all statistics, retaining every row in each sampled family. */
export const reportFamilyClusteredStatistics = <
  Row,
  Name extends string,
>(options: {
  clusters: readonly FamilyCluster<Row>[];
  evidenceValid: boolean;
  minimumFamilyCount?: 1 | 2;
  populationId: string;
  resamplingCount: number;
  seed: string;
  statistics: Readonly<Record<Name, (rows: readonly Row[]) => number | null>>;
}): Record<Name, FamilyClusteredDiagnostic> => {
  const { evidenceValid, populationId, resamplingCount, seed } = options;
  const entries = Object.entries(options.statistics) as [
    Name,
    (rows: readonly Row[]) => number | null,
  ][];
  const unavailable = (
    reason:
      | "invalid-evidence"
      | "insufficient-families"
      | "resampling-budget-exceeded"
  ) =>
    Object.fromEntries(
      entries.map(([name]) => [name, { available: false, reason }])
    ) as Record<Name, FamilyClusteredDiagnostic>;
  const clusters = [...options.clusters].toSorted((left, right) =>
    left.familyId.localeCompare(right.familyId, "en")
  );
  if (
    !validInput({
      clusters,
      evidenceValid,
      populationId,
      resamplingCount,
      seed,
      statisticCount: entries.length,
    })
  ) {
    return unavailable("invalid-evidence");
  }
  if (clusters.length < (options.minimumFamilyCount ?? 2)) {
    return unavailable("insufficient-families");
  }
  const draws = frozenDraws(
    seed,
    populationId,
    clusters.length,
    resamplingCount
  );
  if (!draws) {
    return unavailable("resampling-budget-exceeded");
  }
  const allRows = clusters.flatMap(({ rows }) => rows);
  const points = new Map(
    entries.map(([name, statistic]) => [name, statistic(allRows)])
  );
  const insufficient = new Set(
    entries
      .filter(([name]) => {
        const point = points.get(name);
        return point === null || !Number.isFinite(point);
      })
      .map(([name]) => name)
  );
  const estimates = new Map(entries.map(([name]) => [name, [] as number[]]));
  let drawIndex = 0;
  for (let repeat = 0; repeat < resamplingCount; repeat += 1) {
    const rows: Row[] = [];
    for (let remaining = clusters.length; remaining > 0; remaining -= 1) {
      rows.push(...clusters[draws[drawIndex] ?? -1].rows);
      drawIndex += 1;
    }
    for (const [name, statistic] of entries) {
      if (insufficient.has(name)) {
        continue;
      }
      const estimate = statistic(rows);
      if (estimate === null || !Number.isFinite(estimate)) {
        insufficient.add(name);
        estimates.set(name, []);
        continue;
      }
      estimates.get(name)?.push(estimate);
    }
  }
  return Object.fromEntries(
    entries.map(([name]) => {
      if (insufficient.has(name)) {
        return [name, { available: false, reason: "insufficient-families" }];
      }
      const sorted = (estimates.get(name) ?? []).toSorted(
        (left, right) => left - right
      );
      const quantile = (probability: number) => {
        const position = (sorted.length - 1) * probability;
        const low = Math.floor(position);
        const high = Math.ceil(position);
        return sorted[low] + (sorted[high] - sorted[low]) * (position - low);
      };
      return [
        name,
        {
          available: true,
          interval: {
            confidenceLevel: FAMILY_CLUSTERED_BOOTSTRAP_CONFIDENCE,
            lower: quantile((1 - FAMILY_CLUSTERED_BOOTSTRAP_CONFIDENCE) / 2),
            method: FAMILY_CLUSTERED_BOOTSTRAP_METHOD,
            resamplingCount,
            scope: "descriptive-not-an-acceptance-lower-bound",
            seed,
            upper: quantile(
              1 - (1 - FAMILY_CLUSTERED_BOOTSTRAP_CONFIDENCE) / 2
            ),
          },
          pointEstimate: points.get(name) as number,
        },
      ];
    })
  ) as Record<Name, FamilyClusteredDiagnostic>;
};

export const reportFamilyClusteredStatistic = <Row>(options: {
  clusters: readonly FamilyCluster<Row>[];
  evidenceValid: boolean;
  minimumFamilyCount?: 1 | 2;
  populationId: string;
  resamplingCount: number;
  seed: string;
  statistic: (rows: readonly Row[]) => number | null;
}): FamilyClusteredDiagnostic =>
  reportFamilyClusteredStatistics({
    ...options,
    statistics: { value: options.statistic },
  }).value;
