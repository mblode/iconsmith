import { createHash } from "node:crypto";

import type { RoleAssignment } from "../src/corpus/concepts.js";
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

/** Deterministic development sample for human review. Morphology is derived
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
