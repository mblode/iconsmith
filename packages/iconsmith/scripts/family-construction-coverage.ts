import { createHash } from "node:crypto";

import type { RoleAssignment } from "../src/corpus/concepts.js";
import { resolveSemanticFamily } from "./family-morphology.js";

export const CONSTRUCTION_CLASSES = [
  "organic",
  "container",
  "tool",
  "transport",
  "symbol",
  "dense",
  "narrow",
  "asymmetric",
] as const;
export type ConstructionClass = (typeof CONSTRUCTION_CLASSES)[number];

export interface ConstructionCatalogRecord {
  concepts?: readonly string[];
  set: string;
  slug: string;
  tags?: readonly string[];
}

const FAMILY_SUPPORT_PAINTS = ["outlined", "filled"] as const;
type FamilySupportPaint = (typeof FAMILY_SUPPORT_PAINTS)[number];
const FAMILY_SUPPORT_MASTERS = [16, 24] as const;
type FamilySupportMaster = (typeof FAMILY_SUPPORT_MASTERS)[number];

export interface FamilySupportInventoryRecord {
  concept: string;
  file: string;
  finish: FamilySupportPaint;
  sha256: string;
}

export interface FamilySupportAdmissionRecord {
  file: string;
  status: "refused" | "source-admitted";
}

export interface FamilySupportReplayRecord {
  errors: readonly {
    meanAbsolutePixelError: number;
    size: FamilySupportMaster;
  }[];
  exactReplay: boolean;
  file: string;
  sourceVerified: boolean;
}

export interface FamilySupportCensusInput {
  admissionRows: readonly FamilySupportAdmissionRecord[];
  admissionSourceHash: string;
  catalogSlugs: readonly string[];
  inventoryRows: readonly FamilySupportInventoryRecord[];
  inventorySourceHash: string;
  rasterDifferenceThreshold: number;
  replayRows: readonly FamilySupportReplayRecord[];
  replaySourceHash: string;
  roles: readonly RoleAssignment[];
}

interface SemanticDispositionSourceBinding {
  concept: string;
  file: string | null;
  paint: FamilySupportPaint;
  sha256: string | null;
}

export type SemanticAliasDisposition =
  | {
      aliases: readonly string[];
      status: "confirmed-known-aliases";
    }
  | {
      status: "unresolved-unknown-aliases";
    };

export type SemanticDerivativeDisposition =
  | {
      closeWith: readonly string[];
      status: "reviewed-within-scope";
    }
  | {
      status: "unresolved";
    };

export interface SemanticDispositionReviewPacket {
  aliasDispositions: readonly {
    concept: string;
    disposition: SemanticAliasDisposition;
  }[];
  censusHash: string;
  derivativeDispositions: readonly {
    concept: string;
    disposition: SemanticDerivativeDisposition;
  }[];
  familyDispositions: readonly {
    concept: string;
    family: string;
    head: string;
    status: "reviewed-within-scope";
  }[];
  independentReview: {
    artifactSha256: string;
    reviewerId: string;
  };
  proposal: {
    artifactSha256: string;
    reviewerId: string;
  };
  remainderDisposition: "untouched-unreviewed";
  reviewId: string;
  schema: "iconsmith.semantic-disposition-review.v1";
  scope: readonly string[];
  sourceBindings: readonly SemanticDispositionSourceBinding[];
  sourceHash: string;
}

export interface SemanticDispositionReviewEnvelope {
  packet: SemanticDispositionReviewPacket;
  packetHash: string;
}

type ConstructionDisposition =
  | {
      authority: "catalog-metadata";
      reason: "explicit-construction-token";
      status: "routed";
    }
  | {
      authority: "none";
      reason: "catalog-metadata-insufficient";
      status: "unresolved";
    };

const RULES: Readonly<Record<ConstructionClass, readonly string[]>> = {
  asymmetric: ["leaf", "rocket", "umbrella", "key", "flag", "feather"],
  container: [
    "archive",
    "bag",
    "basket",
    "bookmark",
    "box",
    "bubble",
    "case",
    "card",
    "drawer",
    "file",
    "folder",
    "inbox",
    "package",
    "shield",
    "trash",
    "window",
    "wallet",
  ],
  dense: [
    "atom",
    "bicycle",
    "circuit",
    "fingerprint",
    "grid",
    "network",
    "qr",
    "scissors",
  ],
  narrow: [
    "anchor",
    "chain",
    "key",
    "needle",
    "paperclip",
    "pin",
    "pipette",
    "thermometer",
    "umbrella",
    "wand",
  ],
  organic: [
    "animal",
    "apple",
    "bird",
    "cloud",
    "flower",
    "hand",
    "heart",
    "jellyfish",
    "leaf",
    "plant",
    "tree",
  ],
  symbol: [
    "arrow",
    "check",
    "chevron",
    "cross",
    "minus",
    "pause",
    "play",
    "plus",
    "sparkle",
    "star",
    "x",
  ],
  tool: [
    "axe",
    "anvil",
    "brush",
    "eyedropper",
    "hammer",
    "pen",
    "pencil",
    "pipette",
    "ruler",
    "scissors",
    "screwdriver",
    "shovel",
    "tube",
    "vial",
    "wrench",
  ],
  transport: [
    "airplane",
    "bicycle",
    "bike",
    "boat",
    "bus",
    "car",
    "rocket",
    "rideshare",
    "scooter",
    "ship",
    "skate",
    "taxi",
    "train",
    "tram",
    "truck",
  ],
};

const words = (values: readonly string[]) =>
  new Set(values.flatMap((value) => value.toLowerCase().split(/[^a-z0-9]+/u)));

/** Metadata routing only. A match does not assert that the drawing has the geometry. */
export const annotateConstructionClasses = (values: readonly string[]) => {
  const exposed = words(values);
  return CONSTRUCTION_CLASSES.flatMap((constructionClass) => {
    const matchedTokens = RULES[constructionClass].filter((token) =>
      exposed.has(token)
    );
    return matchedTokens.length ? [{ constructionClass, matchedTokens }] : [];
  });
};

const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");

export const createConstructionCoverage = (
  records: readonly ConstructionCatalogRecord[],
  catalogRoles: readonly RoleAssignment[]
) => {
  const slugs = new Set(records.map(({ slug }) => slug));
  const normalized = new Map<string, ConstructionCatalogRecord>();
  for (const record of records) {
    const base = record.slug.replace(/-filled$/u, "");
    const slug = base !== record.slug && slugs.has(base) ? base : record.slug;
    const prior = normalized.get(slug);
    normalized.set(slug, {
      concepts: [...(prior?.concepts ?? []), ...(record.concepts ?? [])],
      set: record.set,
      slug,
      tags: [...(prior?.tags ?? []), ...(record.tags ?? [])],
    });
  }
  const seen = new Set<string>();
  const families = [...normalized.values()]
    .filter(({ set }) => set === "blode-icons")
    .flatMap((record) => {
      const family = resolveSemanticFamily(record.slug, catalogRoles);
      if (
        family.source !== "catalog" ||
        family.role !== "canonical" ||
        seen.has(family.key)
      ) {
        return [];
      }
      seen.add(family.key);
      const exposure = [
        record.slug,
        ...(record.concepts ?? []),
        ...(record.tags ?? []),
      ].toSorted();
      const annotations = annotateConstructionClasses(exposure);
      const disposition: ConstructionDisposition = annotations.length
        ? {
            authority: "catalog-metadata",
            reason: "explicit-construction-token",
            status: "routed",
          }
        : {
            authority: "none",
            reason: "catalog-metadata-insufficient",
            status: "unresolved",
          };
      return [
        {
          annotations,
          disposition,
          exposure,
          family: family.key,
          head: family.head,
          status: annotations.length
            ? "metadata-annotated"
            : "unresolved-metadata-insufficient",
        } as const,
      ];
    })
    .toSorted((left, right) => left.family.localeCompare(right.family));
  const counts = Object.fromEntries(
    CONSTRUCTION_CLASSES.map((constructionClass) => [
      constructionClass,
      families.filter(({ annotations }) =>
        annotations.some((item) => item.constructionClass === constructionClass)
      ).length,
    ])
  ) as Record<ConstructionClass, number>;
  const body = {
    annotationAuthority: "catalog-token-routing-only" as const,
    classes: CONSTRUCTION_CLASSES,
    counts,
    families,
    familyCount: families.length,
    unclassifiedCount: families.filter(
      ({ disposition }) => disposition.status === "unresolved"
    ).length,
    warnings: [
      "Annotations derive from explicit catalog words; they are not visual geometry labels.",
      "familyCount is the catalog role resolver's canonical-row denominator; it is not an independent semantic-family count and can retain filled or modifier siblings.",
      "Unresolved families carry an explicit metadata-insufficient disposition rather than inheriting a default class.",
      "Dense, narrow and asymmetric annotations identify review strata, not verified contour properties.",
    ],
  };
  return { hash: hash(JSON.stringify(body)), report: body };
};

const requireUnique = <T>(
  values: readonly T[],
  identity: (value: T) => string,
  label: string
) => {
  const found = new Map<string, T>();
  for (const value of values) {
    const key = identity(value);
    if (found.has(key)) {
      throw new Error(`Duplicate ${label}: ${key}`);
    }
    found.set(key, value);
  }
  return found;
};

const requireSourceIdentity = (input: FamilySupportCensusInput) => {
  const identities = [
    input.inventorySourceHash,
    input.admissionSourceHash,
    input.replaySourceHash,
  ];
  if (identities.some((identity) => !/^[a-f0-9]{64}$/u.test(identity))) {
    throw new Error("Source identities must be lowercase SHA-256 hashes");
  }
  if (new Set(identities).size !== 1) {
    throw new Error("Inventory, admission and replay source identities differ");
  }
  if (
    !Number.isFinite(input.rasterDifferenceThreshold) ||
    input.rasterDifferenceThreshold < 0
  ) {
    throw new Error(
      "Raster difference threshold must be a non-negative number"
    );
  }
  return identities[0] as string;
};

/**
 * Accounts for source evidence without inferring morphology or generation
 * quality. Every catalog filename concept receives both paint and both native
 * master slots, including slots for which no source file exists.
 */
const collectFamilySupportEvidence = (input: FamilySupportCensusInput) => {
  const catalog = requireUnique(
    input.catalogSlugs,
    (slug) => slug,
    "catalog slug"
  );
  const roles = requireUnique(input.roles, ({ slug }) => slug, "catalog role");
  const inventory = requireUnique(
    input.inventoryRows,
    ({ file }) => file,
    "inventory file"
  );
  requireUnique(
    input.inventoryRows,
    ({ concept, finish }) => `${concept}/${finish}`,
    "inventory concept/paint slot"
  );
  const admissions = requireUnique(
    input.admissionRows,
    ({ file }) => file,
    "admission file"
  );
  const replays = requireUnique(
    input.replayRows,
    ({ file }) => file,
    "replay file"
  );

  for (const record of input.inventoryRows) {
    if (!catalog.has(record.concept)) {
      throw new Error(
        `Inventory concept is absent from catalog: ${record.concept}`
      );
    }
    if (!/^[a-f0-9]{64}$/u.test(record.sha256)) {
      throw new Error(`Inventory file has invalid SHA-256: ${record.file}`);
    }
    if (!FAMILY_SUPPORT_PAINTS.includes(record.finish)) {
      throw new Error(`Inventory file has invalid paint: ${record.file}`);
    }
    if (!admissions.has(record.file)) {
      throw new Error(`Missing admission disposition: ${record.file}`);
    }
    if (!replays.has(record.file)) {
      throw new Error(`Missing replay disposition: ${record.file}`);
    }
  }
  for (const file of admissions.keys()) {
    if (!inventory.has(file)) {
      throw new Error(`Admission file is absent from inventory: ${file}`);
    }
  }
  for (const admission of input.admissionRows) {
    if (!["refused", "source-admitted"].includes(admission.status)) {
      throw new Error(`Admission file has invalid status: ${admission.file}`);
    }
  }
  for (const file of replays.keys()) {
    if (!inventory.has(file)) {
      throw new Error(`Replay file is absent from inventory: ${file}`);
    }
  }
  for (const replay of input.replayRows) {
    requireUnique(
      replay.errors,
      ({ size }) => String(size),
      `replay master for ${replay.file}`
    );
    for (const error of replay.errors) {
      if (
        !FAMILY_SUPPORT_MASTERS.includes(error.size) ||
        !Number.isFinite(error.meanAbsolutePixelError) ||
        error.meanAbsolutePixelError < 0
      ) {
        throw new Error(`Replay file has invalid measurement: ${replay.file}`);
      }
    }
  }
  for (const role of input.roles) {
    if (!catalog.has(role.slug)) {
      throw new Error(`Catalog role is absent from catalog: ${role.slug}`);
    }
  }
  const byConceptPaint = new Map(
    input.inventoryRows.map((record) => [
      `${record.concept}/${record.finish}`,
      record,
    ])
  );
  return { admissions, byConceptPaint, catalog, inventory, replays, roles };
};

const reconstructionDispositionOf = (
  source: FamilySupportInventoryRecord | undefined,
  replay: FamilySupportReplayRecord | undefined,
  rasterError: number | undefined,
  threshold: number
) => {
  if (!source) {
    return "blocked-missing-source" as const;
  }
  if (!replay?.sourceVerified) {
    return "unknown-source-identity-unverified" as const;
  }
  if (!replay.exactReplay) {
    return "blocked-replay-failure" as const;
  }
  if ((rasterError ?? Number.POSITIVE_INFINITY) > threshold) {
    return "blocked-raster-difference" as const;
  }
  return "verified-within-raster-threshold" as const;
};

const sourceDispositionsOf = (
  source: FamilySupportInventoryRecord | undefined,
  admission: FamilySupportAdmissionRecord | undefined
) => {
  if (!source) {
    return {
      admissionDisposition: "not-applicable" as const,
      sourceDisposition: "missing-source" as const,
    };
  }
  if (admission?.status === "source-admitted") {
    return {
      admissionDisposition: "admitted" as const,
      sourceDisposition: "admitted" as const,
    };
  }
  return {
    admissionDisposition: "explicitly-refused" as const,
    sourceDisposition: "reference-only" as const,
  };
};

const familyAvailabilityOf = (present: number, total: number) => {
  if (present === 0) {
    return "none" as const;
  }
  if (present === total) {
    return "complete" as const;
  }
  return "partial" as const;
};

const reconstructionCountsOf = (
  slots: readonly { reconstructionDisposition: string }[]
) => ({
  blockedMissingSource: slots.filter(
    ({ reconstructionDisposition }) =>
      reconstructionDisposition === "blocked-missing-source"
  ).length,
  blockedRasterDifference: slots.filter(
    ({ reconstructionDisposition }) =>
      reconstructionDisposition === "blocked-raster-difference"
  ).length,
  blockedReplayFailure: slots.filter(
    ({ reconstructionDisposition }) =>
      reconstructionDisposition === "blocked-replay-failure"
  ).length,
  unknownSourceIdentity: slots.filter(
    ({ reconstructionDisposition }) =>
      reconstructionDisposition === "unknown-source-identity-unverified"
  ).length,
  verifiedWithinRasterThreshold: slots.filter(
    ({ reconstructionDisposition }) =>
      reconstructionDisposition === "verified-within-raster-threshold"
  ).length,
});

export const createFamilySourceSupportCensus = (
  input: FamilySupportCensusInput
) => {
  const sourceHash = requireSourceIdentity(input);
  const { admissions, byConceptPaint, catalog, inventory, replays, roles } =
    collectFamilySupportEvidence(input);
  const slots = [...catalog.keys()].toSorted().flatMap((concept) => {
    const role = roles.get(concept);
    const family = role?.family ?? `#unresolved/${concept}`;
    return FAMILY_SUPPORT_PAINTS.flatMap((paint) => {
      const source = byConceptPaint.get(`${concept}/${paint}`);
      const admission = source ? admissions.get(source.file) : undefined;
      const replay = source ? replays.get(source.file) : undefined;
      return FAMILY_SUPPORT_MASTERS.map((master) => {
        const error = replay?.errors.find(({ size }) => size === master);
        if (replay && !error) {
          throw new Error(
            `Missing ${master}px replay measurement: ${replay.file}`
          );
        }
        const dispositions = sourceDispositionsOf(source, admission);
        return {
          admissionDisposition: dispositions.admissionDisposition,
          concept,
          family,
          familyHead: role?.head ?? null,
          familyIdentityDisposition: role
            ? ("catalog-role" as const)
            : ("unresolved-missing-catalog-role" as const),
          generationDisposition: "unknown-not-demonstrated" as const,
          master,
          morphologyDisposition:
            "unresolved-no-source-image-classification" as const,
          paint,
          rasterError: error?.meanAbsolutePixelError ?? null,
          reconstructionDisposition: reconstructionDispositionOf(
            source,
            replay,
            error?.meanAbsolutePixelError,
            input.rasterDifferenceThreshold
          ),
          role: role?.role ?? null,
          sourceAvailability: source
            ? ("source-present" as const)
            : ("missing-source" as const),
          sourceDisposition: dispositions.sourceDisposition,
          sourceFile: source?.file ?? null,
          sourceFileHash: source?.sha256 ?? null,
        };
      });
    });
  });

  const familyKeys = [...new Set(slots.map(({ family }) => family))].toSorted();
  const familySupport = familyKeys.flatMap((family) =>
    FAMILY_SUPPORT_PAINTS.flatMap((paint) =>
      FAMILY_SUPPORT_MASTERS.map((master) => {
        const members = slots.filter(
          (slot) =>
            slot.family === family &&
            slot.paint === paint &&
            slot.master === master
        );
        const present = members.filter(
          ({ sourceAvailability }) => sourceAvailability === "source-present"
        ).length;
        const admitted = members.filter(
          ({ admissionDisposition }) => admissionDisposition === "admitted"
        ).length;
        const refused = members.filter(
          ({ admissionDisposition }) =>
            admissionDisposition === "explicitly-refused"
        ).length;
        return {
          admittedSourceCount: admitted,
          conceptCount: members.length,
          family,
          generationDisposition: "unknown-not-demonstrated" as const,
          master,
          missingSourceCount: members.length - present,
          morphologyDisposition:
            "unresolved-no-source-image-classification" as const,
          paint,
          reconstructionCounts: reconstructionCountsOf(members),
          refusedSourceCount: refused,
          sourceAvailability: familyAvailabilityOf(present, members.length),
        };
      })
    )
  );

  const body = {
    catalogConceptCount: catalog.size,
    expectedSlotCount:
      catalog.size *
      FAMILY_SUPPORT_PAINTS.length *
      FAMILY_SUPPORT_MASTERS.length,
    familyCount: familyKeys.length,
    familySupport,
    inventoryFileCount: inventory.size,
    rasterDifferenceThreshold: input.rasterDifferenceThreshold,
    slotCount: slots.length,
    slots,
    sourceHash,
    summary: {
      admittedSlots: slots.filter(
        ({ admissionDisposition }) => admissionDisposition === "admitted"
      ).length,
      admittedSourceFiles: input.admissionRows.filter(
        ({ status }) => status === "source-admitted"
      ).length,
      missingCatalogRoleConcepts: new Set(
        slots
          .filter(
            ({ familyIdentityDisposition }) =>
              familyIdentityDisposition === "unresolved-missing-catalog-role"
          )
          .map(({ concept }) => concept)
      ).size,
      missingSourcePaints:
        catalog.size * FAMILY_SUPPORT_PAINTS.length - inventory.size,
      missingSourceSlots: slots.filter(
        ({ sourceAvailability }) => sourceAvailability === "missing-source"
      ).length,
      reconstructionCounts: reconstructionCountsOf(slots),
      refusedSlots: slots.filter(
        ({ admissionDisposition }) =>
          admissionDisposition === "explicitly-refused"
      ).length,
      refusedSourceFiles: input.admissionRows.filter(
        ({ status }) => status === "refused"
      ).length,
      unresolvedGenerationSlots: slots.length,
      unresolvedMorphologySlots: slots.length,
    },
    warnings: [
      "Catalog roles are source metadata; they do not classify visible morphology.",
      "A refused source remains available as a visual reference and does not prove generation is blocked.",
      "Generation capability is unknown-not-demonstrated for every slot and family aggregate in this source-only census.",
      "Raster-threshold reconstruction is master-specific source fidelity evidence, not visual or generation qualification.",
    ],
  };
  return { hash: hash(JSON.stringify(body)), report: body };
};

const isSha256 = (value: string) => /^[a-f0-9]{64}$/u.test(value);

const canonicalJson = (value: unknown) =>
  JSON.stringify(value, (_key, child: unknown) => {
    if (!(child && typeof child === "object") || Array.isArray(child)) {
      return child;
    }
    return Object.fromEntries(
      Object.entries(child).toSorted(([left], [right]) =>
        left.localeCompare(right)
      )
    );
  });

const canonicalSemanticReviewPacket = (
  packet: SemanticDispositionReviewPacket
): SemanticDispositionReviewPacket => ({
  ...packet,
  aliasDispositions: packet.aliasDispositions
    .map((entry) => ({
      ...entry,
      disposition:
        entry.disposition.status === "confirmed-known-aliases"
          ? {
              aliases: [...entry.disposition.aliases].toSorted(),
              status: entry.disposition.status,
            }
          : entry.disposition,
    }))
    .toSorted((left, right) => left.concept.localeCompare(right.concept)),
  derivativeDispositions: packet.derivativeDispositions
    .map((entry) => ({
      ...entry,
      disposition:
        entry.disposition.status === "reviewed-within-scope"
          ? {
              closeWith: [...entry.disposition.closeWith].toSorted(),
              status: entry.disposition.status,
            }
          : entry.disposition,
    }))
    .toSorted((left, right) => left.concept.localeCompare(right.concept)),
  familyDispositions: [...packet.familyDispositions].toSorted((left, right) =>
    left.concept.localeCompare(right.concept)
  ),
  scope: [...packet.scope].toSorted(),
  sourceBindings: [...packet.sourceBindings].toSorted((left, right) =>
    `${left.concept}/${left.paint}`.localeCompare(
      `${right.concept}/${right.paint}`
    )
  ),
});

/** The identity covers the canonical packet and both bound review artifacts. */
export const hashSemanticDispositionReview = (
  packet: SemanticDispositionReviewPacket
) => hash(canonicalJson(canonicalSemanticReviewPacket(packet)));

type FamilySupportCensus = ReturnType<typeof createFamilySourceSupportCensus>;

const validateReviewProvenance = (
  envelope: SemanticDispositionReviewEnvelope,
  census: FamilySupportCensus
) => {
  const { packet, packetHash } = envelope;
  if (hash(JSON.stringify(census.report)) !== census.hash) {
    throw new Error("Family source support census hash mismatch");
  }
  if (packet.schema !== "iconsmith.semantic-disposition-review.v1") {
    throw new Error(`Unsupported semantic review schema: ${packet.schema}`);
  }
  if (!(packet.reviewId.trim() && packet.proposal.reviewerId.trim())) {
    throw new Error("Semantic review identity and proposer are required");
  }
  if (!packet.independentReview.reviewerId.trim()) {
    throw new Error(`Independent reviewer is required: ${packet.reviewId}`);
  }
  if (packet.proposal.reviewerId === packet.independentReview.reviewerId) {
    throw new Error(
      `Proposer and independent reviewer must differ: ${packet.reviewId}`
    );
  }
  if (
    packet.proposal.artifactSha256 === packet.independentReview.artifactSha256
  ) {
    throw new Error(
      `Proposal and independent review artifacts must differ: ${packet.reviewId}`
    );
  }
  for (const [label, value] of [
    ["packet", packetHash],
    ["proposal artifact", packet.proposal.artifactSha256],
    ["independent review artifact", packet.independentReview.artifactSha256],
  ] as const) {
    if (!isSha256(value)) {
      throw new Error(`Invalid ${label} SHA-256: ${packet.reviewId}`);
    }
  }
  if (hashSemanticDispositionReview(packet) !== packetHash) {
    throw new Error(`Semantic review packet hash mismatch: ${packet.reviewId}`);
  }
  if (packet.censusHash !== census.hash) {
    throw new Error(
      `Semantic review is bound to a stale census: ${packet.reviewId}`
    );
  }
  if (packet.sourceHash !== census.report.sourceHash) {
    throw new Error(
      `Semantic review is bound to stale sources: ${packet.reviewId}`
    );
  }
  if (packet.remainderDisposition !== "untouched-unreviewed") {
    throw new Error(
      `Semantic review must preserve an explicit untouched remainder: ${packet.reviewId}`
    );
  }
};

const validateReviewDispositionShapes = (
  packet: SemanticDispositionReviewPacket
) => {
  for (const disposition of packet.familyDispositions) {
    if (
      disposition.status !== "reviewed-within-scope" ||
      !disposition.concept ||
      !disposition.family ||
      !disposition.head
    ) {
      throw new Error(
        `Invalid reviewed family disposition: ${packet.reviewId}`
      );
    }
  }
  for (const { concept, disposition } of packet.aliasDispositions) {
    if (
      disposition.status !== "confirmed-known-aliases" &&
      disposition.status !== "unresolved-unknown-aliases"
    ) {
      throw new Error(`Invalid alias disposition: ${concept}`);
    }
    if (
      disposition.status === "confirmed-known-aliases" &&
      !Array.isArray(disposition.aliases)
    ) {
      throw new Error(`Invalid alias list: ${concept}`);
    }
  }
  for (const { concept, disposition } of packet.derivativeDispositions) {
    if (
      disposition.status !== "reviewed-within-scope" &&
      disposition.status !== "unresolved"
    ) {
      throw new Error(`Invalid derivative disposition: ${concept}`);
    }
    if (
      disposition.status === "reviewed-within-scope" &&
      !Array.isArray(disposition.closeWith)
    ) {
      throw new Error(`Invalid close derivative list: ${concept}`);
    }
  }
  for (const binding of packet.sourceBindings) {
    if (!FAMILY_SUPPORT_PAINTS.includes(binding.paint)) {
      throw new Error(
        `Invalid semantic review source paint: ${binding.concept}/${binding.paint}`
      );
    }
  }
};

const requireCompleteScopedDispositions = <T extends { concept: string }>(
  values: readonly T[],
  scope: ReadonlyMap<string, string>,
  label: string,
  reviewId: string
) => {
  const dispositions = requireUnique(
    values,
    ({ concept }) => concept,
    `reviewed ${label} concept`
  );
  if (dispositions.size !== scope.size) {
    throw new Error(
      `Incomplete ${label} dispositions for review scope: ${reviewId}`
    );
  }
  for (const concept of dispositions.keys()) {
    if (!scope.has(concept)) {
      throw new Error(
        `${label} disposition is outside review scope: ${concept}`
      );
    }
  }
  return dispositions;
};

const validateReviewSourceBindings = (
  packet: SemanticDispositionReviewPacket,
  census: FamilySupportCensus,
  scope: ReadonlyMap<string, string>
) => {
  const bindings = requireUnique(
    packet.sourceBindings,
    ({ concept, paint }) => `${concept}/${paint}`,
    "semantic review source binding"
  );
  if (bindings.size !== scope.size * FAMILY_SUPPORT_PAINTS.length) {
    throw new Error(
      `Incomplete source bindings for review scope: ${packet.reviewId}`
    );
  }
  for (const concept of scope.keys()) {
    for (const paint of FAMILY_SUPPORT_PAINTS) {
      const key = `${concept}/${paint}`;
      const binding = bindings.get(key);
      if (!binding) {
        throw new Error(`Missing semantic review source binding: ${key}`);
      }
      if (
        (binding.file === null) !== (binding.sha256 === null) ||
        (binding.sha256 !== null && !isSha256(binding.sha256))
      ) {
        throw new Error(`Invalid semantic review source binding: ${key}`);
      }
      const sourceIdentities = new Set(
        census.report.slots
          .filter((slot) => slot.concept === concept && slot.paint === paint)
          .map(({ sourceFile, sourceFileHash }) =>
            JSON.stringify([sourceFile, sourceFileHash])
          )
      );
      if (sourceIdentities.size !== 1) {
        throw new Error(`Census source identity differs by master: ${key}`);
      }
      if (
        !sourceIdentities.has(JSON.stringify([binding.file, binding.sha256]))
      ) {
        throw new Error(`Semantic review source binding is stale: ${key}`);
      }
    }
  }
};

const validateReviewedFamilies = (packet: SemanticDispositionReviewPacket) => {
  const familyGroups = new Map<
    string,
    (typeof packet.familyDispositions)[number][]
  >();
  for (const disposition of packet.familyDispositions) {
    const members = familyGroups.get(disposition.family) ?? [];
    members.push(disposition);
    familyGroups.set(disposition.family, members);
  }
  for (const [family, members] of familyGroups) {
    const heads = new Set(members.map(({ head }) => head));
    if (
      heads.size !== 1 ||
      !members.some(({ concept }) => heads.has(concept))
    ) {
      throw new Error(`Reviewed family has an invalid head: ${family}`);
    }
  }
};

const validateReviewedAliases = (packet: SemanticDispositionReviewPacket) => {
  const aliasOwners = new Map<string, string>();
  for (const { concept, disposition } of packet.aliasDispositions) {
    if (disposition.status !== "confirmed-known-aliases") {
      continue;
    }
    if (disposition.aliases.length === 0) {
      throw new Error(`Confirmed alias disposition is empty: ${concept}`);
    }
    for (const alias of disposition.aliases) {
      if (!alias || aliasOwners.has(alias)) {
        throw new Error(`Duplicate or empty reviewed alias: ${alias}`);
      }
      aliasOwners.set(alias, concept);
    }
  }
};

const validateReviewedDerivatives = (
  packet: SemanticDispositionReviewPacket,
  derivatives: ReadonlyMap<
    string,
    SemanticDispositionReviewPacket["derivativeDispositions"][number]
  >,
  scope: ReadonlyMap<string, string>
) => {
  for (const { concept, disposition } of packet.derivativeDispositions) {
    if (disposition.status !== "reviewed-within-scope") {
      continue;
    }
    const closeWith = requireUnique(
      disposition.closeWith,
      (member) => member,
      `close derivative for ${concept}`
    );
    for (const member of closeWith.keys()) {
      if (member === concept || !scope.has(member)) {
        throw new Error(
          `Invalid close derivative member: ${concept}/${member}`
        );
      }
      const reverse = derivatives.get(member)?.disposition;
      if (
        reverse?.status !== "reviewed-within-scope" ||
        !reverse.closeWith.includes(concept)
      ) {
        throw new Error(
          `Asymmetric close derivative disposition: ${concept}/${member}`
        );
      }
    }
  }
};

const validateSemanticReviewScope = (
  envelope: SemanticDispositionReviewEnvelope,
  census: FamilySupportCensus
) => {
  const { packet } = envelope;
  validateReviewDispositionShapes(packet);
  const catalogConcepts = new Set(
    census.report.slots.map(({ concept }) => concept)
  );
  const scope = requireUnique(
    packet.scope,
    (concept) => concept,
    "review scope concept"
  );
  if (scope.size === 0) {
    throw new Error(`Semantic review scope is empty: ${packet.reviewId}`);
  }
  for (const concept of scope.keys()) {
    if (!catalogConcepts.has(concept)) {
      throw new Error(
        `Semantic review concept is absent from census: ${concept}`
      );
    }
  }
  const families = requireCompleteScopedDispositions(
    packet.familyDispositions,
    scope,
    "family",
    packet.reviewId
  );
  const aliases = requireCompleteScopedDispositions(
    packet.aliasDispositions,
    scope,
    "alias",
    packet.reviewId
  );
  const derivatives = requireCompleteScopedDispositions(
    packet.derivativeDispositions,
    scope,
    "derivative",
    packet.reviewId
  );
  validateReviewSourceBindings(packet, census, scope);
  validateReviewedFamilies(packet);
  validateReviewedAliases(packet);
  validateReviewedDerivatives(packet, derivatives, scope);
  return { aliases, derivatives, families, scope };
};

/**
 * Applies independently reviewed, content-addressed semantic dispositions to a
 * bounded census scope. Base source, admission and replay evidence is retained
 * byte-for-byte; concepts outside every declared scope remain explicit.
 */
export const ingestFamilySemanticDispositions = (
  census: FamilySupportCensus,
  envelopes: readonly SemanticDispositionReviewEnvelope[]
) => {
  requireUnique(
    envelopes,
    ({ packet }) => packet.reviewId,
    "semantic review id"
  );
  requireUnique(
    envelopes,
    ({ packetHash }) => packetHash,
    "semantic review packet hash"
  );
  const reviewed = new Map<
    string,
    ReturnType<typeof validateSemanticReviewScope> & {
      envelope: SemanticDispositionReviewEnvelope;
    }
  >();
  for (const envelope of envelopes) {
    validateReviewProvenance(envelope, census);
    const validated = validateSemanticReviewScope(envelope, census);
    for (const concept of validated.scope.keys()) {
      if (reviewed.has(concept)) {
        throw new Error(
          `Concept appears in multiple semantic reviews: ${concept}`
        );
      }
      reviewed.set(concept, { ...validated, envelope });
    }
  }

  const slots = census.report.slots.map((slot) => {
    const review = reviewed.get(slot.concept);
    if (!review) {
      return {
        ...slot,
        aliasSemanticDisposition: {
          status: "unresolved-not-reviewed" as const,
        },
        derivativeSemanticDisposition: {
          status: "unresolved-not-reviewed" as const,
        },
        reviewedFamilyDisposition: {
          status: "unresolved-not-reviewed" as const,
        },
        semanticReviewPacketHash: null,
        sourceReviewDisposition: "unreviewed" as const,
      };
    }
    const family = review.families.get(slot.concept);
    const alias = review.aliases.get(slot.concept);
    const derivative = review.derivatives.get(slot.concept);
    if (!(family && alias && derivative)) {
      throw new Error(
        `Validated semantic review lookup failed: ${slot.concept}`
      );
    }
    return {
      ...slot,
      aliasSemanticDisposition: alias.disposition,
      derivativeSemanticDisposition: derivative.disposition,
      reviewedFamilyDisposition: {
        family: family.family,
        head: family.head,
        status: family.status,
      },
      semanticReviewPacketHash: review.envelope.packetHash,
      sourceReviewDisposition:
        slot.sourceAvailability === "missing-source"
          ? ("reviewed-missing-source" as const)
          : ("reviewed-source-bound" as const),
    };
  });
  if (slots.length !== census.report.slots.length) {
    throw new Error("Semantic review changed the census slot denominator");
  }
  const body = {
    baseCensusHash: census.hash,
    reviewCount: envelopes.length,
    reviewPacketHashes: envelopes
      .map(({ packetHash }) => packetHash)
      .toSorted(),
    reviews: envelopes
      .map(({ packet, packetHash }) => ({
        independentReview: packet.independentReview,
        packetHash,
        proposal: packet.proposal,
        reviewId: packet.reviewId,
        scope: [...packet.scope].toSorted(),
      }))
      .toSorted((left, right) => left.reviewId.localeCompare(right.reviewId)),
    slotCount: slots.length,
    slots,
    sourceHash: census.report.sourceHash,
    summary: {
      reviewedConcepts: reviewed.size,
      reviewedSlots: slots.filter(
        ({ sourceReviewDisposition }) =>
          sourceReviewDisposition !== "unreviewed"
      ).length,
      reviewedSlotsWithMissingSource: slots.filter(
        ({ sourceReviewDisposition }) =>
          sourceReviewDisposition === "reviewed-missing-source"
      ).length,
      untouchedConcepts: census.report.catalogConceptCount - reviewed.size,
      untouchedSlots: slots.filter(
        ({ sourceReviewDisposition }) =>
          sourceReviewDisposition === "unreviewed"
      ).length,
    },
    warnings: [
      "Reviewed family and derivative dispositions apply only within each declared scope.",
      "An alias remains unknown unless the bound review confirms that exact alias; unreviewed concepts are never inferred from family membership.",
      "A reviewed concept can retain missing source slots; semantic review does not create source availability, admission or reconstruction evidence.",
      "This incremental overlay does not claim completion of the catalog census or visual qualification.",
    ],
  };
  return { hash: hash(JSON.stringify(body)), report: body };
};
