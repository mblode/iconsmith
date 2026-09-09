import { createHash } from "node:crypto";

import type { RoleAssignment } from "../src/corpus/concepts.js";
import { reportFamilyClusteredStatistic } from "../src/eval/family-clustered-uncertainty.js";
import {
  FAMILY_CLASSES,
  classifyFamily,
  resolveSemanticFamily,
} from "./family-morphology.js";

export const DEVELOPMENT_FAMILIES = [
  ["cloud", "cloud-upload", "open body and external modifier"],
  ["bell", "bell-pause", "curved body and interrupted rim"],
  ["shield", "shield-check", "curved counter and acute intersections"],
  ["folder", "folder-lock", "asymmetric body and badge clearance"],
  ["clock", "clock-check", "intersecting cutters"],
  ["jellyfish", "jellyfish", "organic continuous contours"],
  ["satellite", "satellite-dish", "curved diagonal construction"],
  ["camera", "camera-sparkle", "nested counters and detail"],
  ["bookmark", "bookmark-play", "concave contour and solid modifier"],
  ["key", "key", "thin connecting features"],
  ["headphones", "headphones", "symmetric curved terminals"],
  ["leaf", "leaf", "asymmetric organic silhouette"],
  ["bicycle", "bicycle", "dense linked circular forms"],
  ["scissors", "scissors", "crossing diagonal bars"],
  ["hand", "hand-heart", "dense organic detail"],
  ["battery", "battery-charging", "wide body and negative modifier"],
  ["umbrella", "umbrella", "curved canopy and narrow stem"],
  ["rocket", "rocket", "diagonal pointed body"],
  ["credit-card", "credit-card-check", "wide body and short gaps"],
  ["hourglass", "hourglass", "narrow waist and enclosed counters"],
].map(([family, concept, challenge]) => ({ challenge, concept, family }));

export interface CatalogPopulationRecord {
  set: string;
  slug: string;
  concepts?: readonly string[];
  tags?: readonly string[];
}

const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");

/** Deterministic development sample for independent AI review. Morphology is derived
 * from catalog names and aliases; it is not presented as geometry evidence. */
export const createCatalogAuditSample = (
  records: readonly CatalogPopulationRecord[],
  catalogRoles: readonly RoleAssignment[],
  seed: string,
  familyCount = 100
) => {
  if (!seed.trim() || familyCount < FAMILY_CLASSES.length) {
    throw new Error("Invalid catalog sample request");
  }
  const familySeen = new Set<string>();
  const catalog = records
    .filter(({ set }) => set === "blode-icons")
    .flatMap((record) => {
      const resolved = resolveSemanticFamily(record.slug, catalogRoles);
      if (
        resolved.source !== "catalog" ||
        resolved.role !== "canonical" ||
        familySeen.has(resolved.key)
      ) {
        return [];
      }
      familySeen.add(resolved.key);
      return [
        {
          concept: resolved.head,
          family: resolved.key,
          morphology: classifyFamily(resolved.head, [
            ...(record.concepts ?? []),
            ...(record.tags ?? []),
          ]),
        },
      ];
    });
  if (new Set(catalog.map(({ family }) => family)).size !== catalog.length) {
    throw new Error("Duplicate catalog family identity");
  }
  const ranked = new Map(
    FAMILY_CLASSES.map((morphology) => [
      morphology,
      catalog
        .filter((entry) => entry.morphology === morphology)
        .toSorted((left, right) =>
          digest(`${seed}\0${left.family}`).localeCompare(
            digest(`${seed}\0${right.family}`)
          )
        ),
    ])
  );
  const families: (typeof catalog)[number][] = [];
  let round = 0;
  while (families.length < familyCount) {
    const before = families.length;
    for (const morphology of FAMILY_CLASSES) {
      const candidate = ranked.get(morphology)?.[round];
      if (candidate && families.length < familyCount) {
        families.push(candidate);
      }
    }
    if (families.length === before) {
      throw new Error("Insufficient catalog families for requested sample");
    }
    round += 1;
  }
  const slots = families.flatMap(({ concept, family, morphology }) =>
    ([16, 24] as const).flatMap((nativeSize) =>
      (["outlined", "filled"] as const).map((finish) => ({
        concept,
        family,
        finish,
        morphology,
        nativeSize,
        slotId: `${family}/${nativeSize}/${finish}`,
      }))
    )
  );
  const body = {
    families,
    familyCount,
    independence: "catalog-semantic-family" as const,
    purpose: "development-blind-audit" as const,
    qualificationEligible: false,
    seed,
    slots,
  };
  return { hash: digest(JSON.stringify(body)), manifest: body };
};

export interface RequestedRateSlot {
  familyId: string;
  slotId: string;
}

/** Descriptive uncertainty for one frozen population/stratum. All requested
 * slots stay in the denominator. Call separately for supplemental audits and
 * sampling strata; this function does not pool unequal-probability samples. */
const validResamplingCount = (count: number) =>
  Number.isInteger(count) && count >= 1000 && count <= 100_000;

export const reportFamilyClusteredRate = (options: {
  observations: readonly { slotId: string; success: boolean | null }[];
  populationId: string;
  requestedSlots: readonly RequestedRateSlot[];
  resamplingCount: number;
  samplingScope:
    | "census"
    | "self-weighting-probability-stratum"
    | "supplemental";
  seed: string;
}) => {
  const { populationId, resamplingCount, samplingScope, seed } = options;
  const slots = [...options.requestedSlots].toSorted((a, b) =>
    a.slotId.localeCompare(b.slotId, "en")
  );
  if (
    !populationId.trim() ||
    !seed.trim() ||
    !validResamplingCount(resamplingCount) ||
    slots.length === 0 ||
    slots.some((row) => !row.slotId.trim() || !row.familyId.trim()) ||
    new Set(slots.map((row) => row.slotId)).size !== slots.length ||
    !["census", "self-weighting-probability-stratum", "supplemental"].includes(
      samplingScope
    )
  ) {
    throw new Error("Invalid frozen rate population or resampling contract");
  }
  const requested = new Set(slots.map((row) => row.slotId));
  const observations = new Map<string, boolean | null>();
  for (const row of options.observations) {
    if (
      !requested.has(row.slotId) ||
      observations.has(row.slotId) ||
      !(row.success === true || row.success === false || row.success === null)
    ) {
      throw new Error("Duplicate, unknown or invalid rate observation");
    }
    observations.set(row.slotId, row.success);
  }
  const families = new Map<string, { requested: number; successes: number }>();
  for (const slot of slots) {
    const cluster = families.get(slot.familyId) ?? {
      requested: 0,
      successes: 0,
    };
    cluster.requested += 1;
    cluster.successes += observations.get(slot.slotId) === true ? 1 : 0;
    families.set(slot.familyId, cluster);
  }
  const clusters = [...families].toSorted(([a], [b]) =>
    a.localeCompare(b, "en")
  );
  const diagnostic = reportFamilyClusteredStatistic({
    clusters: clusters.map(([familyId, row]) => ({ familyId, rows: [row] })),
    evidenceValid: true,
    minimumFamilyCount: 1,
    populationId,
    resamplingCount,
    seed,
    statistic: (rows) => {
      const denominator = rows.reduce((sum, row) => sum + row.requested, 0);
      return rows.reduce((sum, row) => sum + row.successes, 0) / denominator;
    },
  });
  if (!diagnostic.available) {
    throw new Error("Invalid family-clustered rate evidence");
  }
  const successes = clusters.reduce((sum, [, row]) => sum + row.successes, 0);
  const body = {
    empiricalRate: successes / slots.length,
    familyCount: clusters.length,
    interval: {
      level: diagnostic.interval.confidenceLevel,
      lower: diagnostic.interval.lower,
      method: diagnostic.interval.method,
      scope: "descriptive-not-an-acceptance-lower-bound" as const,
      singleFamilyDegenerate: clusters.length === 1,
      upper: diagnostic.interval.upper,
    },
    missing: slots.length - observations.size,
    observationsHash: digest(
      JSON.stringify(
        [...observations].toSorted(([a], [b]) => a.localeCompare(b, "en"))
      )
    ),
    populationId,
    qualificationEligible: false,
    requested: slots.length,
    requestedSlotsHash: digest(JSON.stringify(slots)),
    resamplingCount,
    samplingScope,
    seed,
    successes,
    unresolved: [...observations.values()].filter((value) => value === null)
      .length,
  };
  return { ...body, hash: digest(JSON.stringify(body)) };
};
