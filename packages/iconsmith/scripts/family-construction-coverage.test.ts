import { describe, expect, test } from "vitest";

import type { RoleAssignment } from "../src/corpus/concepts.js";
import type {
  SemanticAliasDisposition,
  SemanticDerivativeDisposition,
  SemanticDispositionReviewPacket,
} from "./family-construction-coverage.js";
import {
  annotateConstructionClasses,
  createConstructionCoverage,
  createFamilySourceSupportCensus,
  hashSemanticDispositionReview,
  ingestFamilySemanticDispositions,
} from "./family-construction-coverage.js";

const roles: RoleAssignment[] = [
  { family: "#cloud", head: "cloud", role: "canonical", slug: "cloud" },
  {
    family: "#bicycle",
    head: "bicycle",
    role: "canonical",
    slug: "bicycle",
  },
  {
    family: "#hammer",
    head: "hammer",
    role: "canonical",
    slug: "hammer",
  },
  { family: "#cloud", head: "cloud", role: "state", slug: "cloud-upload" },
];

const sourceHash = "a".repeat(64);

const createCensus = (
  overrides: Partial<Parameters<typeof createFamilySourceSupportCensus>[0]> = {}
) =>
  createFamilySourceSupportCensus({
    admissionRows: [
      { file: "cloud.svg", status: "source-admitted" },
      { file: "cloud-upload.svg", status: "refused" },
    ],
    admissionSourceHash: sourceHash,
    catalogSlugs: ["cloud", "cloud-upload"],
    inventoryRows: [
      {
        concept: "cloud",
        file: "cloud.svg",
        finish: "outlined",
        sha256: "b".repeat(64),
      },
      {
        concept: "cloud-upload",
        file: "cloud-upload.svg",
        finish: "outlined",
        sha256: "c".repeat(64),
      },
    ],
    inventorySourceHash: sourceHash,
    rasterDifferenceThreshold: 0.01,
    replayRows: [
      {
        errors: [
          { meanAbsolutePixelError: 0, size: 16 },
          { meanAbsolutePixelError: 0.02, size: 24 },
        ],
        exactReplay: true,
        file: "cloud.svg",
        sourceVerified: true,
      },
      {
        errors: [
          { meanAbsolutePixelError: 0, size: 16 },
          { meanAbsolutePixelError: 0, size: 24 },
        ],
        exactReplay: true,
        file: "cloud-upload.svg",
        sourceVerified: true,
      },
    ],
    replaySourceHash: sourceHash,
    roles: roles.filter(({ slug }) => ["cloud", "cloud-upload"].includes(slug)),
    ...overrides,
  });

const gitSourceHashes = {
  "git-branches-filled.svg":
    "3d3a89fa10922aa4c9ddd1f932c7835ccd4a2401eafc0f963bb63bd9b69d80c4",
  "git-branches.svg":
    "90d0fa85dcc64dd218388635fe8f80c481f2bc7dbe78dd315efaf4ac8a3e0e03",
  "git-commit-vertical.svg":
    "0b3230899f9dfa85eabaf861f6671c02876546bdbf397c7220b8af3ff7dbe73f",
  "git-filled.svg":
    "70db5d629a7b5b2b7427d99d3b8e625ed47fd7831340a114aeb545ffc7822ca0",
  "git-fork-filled.svg":
    "96094f166135f4cf179a7da9b0314cf52582390733b0a4069625457f1a9e118e",
  "git-fork.svg":
    "9800e299792a8a31c61dae869d45caf6f068ff62803a0ea996bdc5e2d38d5ea1",
  "git-pull-request-filled.svg":
    "6f2df9a5143e722e1115fbe43005fa0379b2e4aec0824a87c03ba3a2c2382f67",
  "git-pull-request.svg":
    "06c9de2311e11e96c9538448634f1474cb604e716241c9190cd766260a5ec1b3",
  "git.svg": "70db5d629a7b5b2b7427d99d3b8e625ed47fd7831340a114aeb545ffc7822ca0",
} as const;

const gitConcepts = [
  "git",
  "git-branches",
  "git-commit-vertical",
  "git-fork",
  "git-pull-request",
] as const;

const gitAliasDisposition = (concept: string): SemanticAliasDisposition => {
  if (concept === "git-fork") {
    return {
      aliases: ["version-control"],
      status: "confirmed-known-aliases",
    };
  }
  return { status: "unresolved-unknown-aliases" };
};

const gitDerivativeDisposition = (
  concept: string
): SemanticDerivativeDisposition => {
  if (concept === "git-branches") {
    return {
      closeWith: ["git-fork"],
      status: "reviewed-within-scope",
    };
  }
  if (concept === "git-fork") {
    return {
      closeWith: ["git-branches"],
      status: "reviewed-within-scope",
    };
  }
  if (concept === "git-commit-vertical") {
    return { status: "unresolved" };
  }
  return { closeWith: [], status: "reviewed-within-scope" };
};

const createGitCensus = () => {
  const inventoryRows = Object.entries(gitSourceHashes).map(
    ([file, sha256]) => {
      const filled = file.endsWith("-filled.svg");
      return {
        concept: file.replace(/-filled\.svg$/u, "").replace(/\.svg$/u, ""),
        file,
        finish: filled ? ("filled" as const) : ("outlined" as const),
        sha256,
      };
    }
  );
  return createFamilySourceSupportCensus({
    admissionRows: inventoryRows.map(({ file }) => ({
      file,
      status: "source-admitted" as const,
    })),
    admissionSourceHash: sourceHash,
    catalogSlugs: [...gitConcepts, "cloud"],
    inventoryRows,
    inventorySourceHash: sourceHash,
    rasterDifferenceThreshold: 0.01,
    replayRows: inventoryRows.map(({ file }) => ({
      errors: [
        { meanAbsolutePixelError: 0, size: 16 as const },
        { meanAbsolutePixelError: 0, size: 24 as const },
      ],
      exactReplay: true,
      file,
      sourceVerified: true,
    })),
    replaySourceHash: sourceHash,
    roles: [
      { family: "#git", head: "git", role: "canonical", slug: "git" },
      ...gitConcepts.slice(1).map((slug) => ({
        family: "#git",
        head: "git",
        role: slug === "git-fork" ? ("canonical" as const) : ("state" as const),
        slug,
      })),
      { family: "#cloud", head: "cloud", role: "canonical", slug: "cloud" },
    ],
  });
};

const createGitReview = (
  census = createGitCensus()
): SemanticDispositionReviewPacket => ({
  aliasDispositions: gitConcepts.map((concept) => ({
    concept,
    disposition: gitAliasDisposition(concept),
  })),
  censusHash: census.hash,
  derivativeDispositions: gitConcepts.map((concept) => ({
    concept,
    disposition: gitDerivativeDisposition(concept),
  })),
  familyDispositions: gitConcepts.map((concept) => ({
    concept,
    family: concept === "git" ? "git" : "git-fork",
    head: concept === "git" ? "git" : "git-fork",
    status: "reviewed-within-scope" as const,
  })),
  independentReview: {
    artifactSha256:
      "9ec58972a1fe22650e7335edb47667dae27801d58f430d5afb58c7aa7119eebe",
    reviewerId: "root-independent-reviewer",
  },
  proposal: {
    artifactSha256:
      "d971ac65f0cf0fac6b59456a3fce3ff6df889d6abe50ac33e6113450e42acc1f",
    reviewerId: "geometry-proposer",
  },
  remainderDisposition: "untouched-unreviewed",
  reviewId: "git-family-development-review-2026-09-08",
  schema: "iconsmith.semantic-disposition-review.v1",
  scope: gitConcepts,
  sourceBindings: gitConcepts.flatMap((concept) =>
    (["outlined", "filled"] as const).map((paint) => {
      const file = `${concept}${paint === "filled" ? "-filled" : ""}.svg`;
      const sha256 = gitSourceHashes[file as keyof typeof gitSourceHashes];
      return {
        concept,
        file: sha256 ? file : null,
        paint,
        sha256: sha256 ?? null,
      };
    })
  ),
  sourceHash: census.report.sourceHash,
});

const envelope = (packet: SemanticDispositionReviewPacket) => ({
  packet,
  packetHash: hashSemanticDispositionReview(packet),
});

describe("construction coverage", () => {
  test("uses explicit metadata for multiple review strata without a default", () => {
    expect(annotateConstructionClasses(["bicycle"])).toEqual([
      { constructionClass: "transport", matchedTokens: ["bicycle"] },
      { constructionClass: "dense", matchedTokens: ["bicycle"] },
    ]);
    expect(annotateConstructionClasses(["cloud"])).toEqual([
      { constructionClass: "organic", matchedTokens: ["cloud"] },
    ]);
    expect(annotateConstructionClasses(["labor pipette"])).toEqual([
      { constructionClass: "tool", matchedTokens: ["pipette"] },
      { constructionClass: "narrow", matchedTokens: ["pipette"] },
    ]);
  });

  test("counts canonical semantic families once and preserves unknown coverage", () => {
    const first = createConstructionCoverage(
      [
        { set: "blode-icons", slug: "cloud" },
        { set: "blode-icons", slug: "cloud-upload" },
        { set: "blode-icons", slug: "bicycle" },
        { set: "blode-icons", slug: "bicycle-filled" },
        { concepts: ["mallet"], set: "blode-icons", slug: "hammer" },
        { set: "other", slug: "train" },
      ],
      roles
    );
    const second = createConstructionCoverage(
      [
        { concepts: ["mallet"], set: "blode-icons", slug: "hammer" },
        { set: "blode-icons", slug: "bicycle" },
        { set: "blode-icons", slug: "cloud-upload" },
        { set: "blode-icons", slug: "cloud" },
      ],
      roles
    );

    expect(first.hash).toBe(second.hash);
    expect(first.report.familyCount).toBe(3);
    expect(first.report.unclassifiedCount).toBe(0);
    expect(first.report.counts).toMatchObject({
      dense: 1,
      tool: 1,
      transport: 1,
    });
    expect(
      first.report.families.find(({ head }) => head === "cloud")
    ).toMatchObject({
      disposition: {
        authority: "catalog-metadata",
        reason: "explicit-construction-token",
        status: "routed",
      },
      status: "metadata-annotated",
    });
  });

  test("records an explicit unresolved disposition when metadata cannot route a row", () => {
    const result = createConstructionCoverage(
      [{ set: "blode-icons", slug: "unknown-form" }],
      [
        {
          family: "#unknown-form",
          head: "unknown-form",
          role: "canonical",
          slug: "unknown-form",
        },
      ]
    );

    expect(result.report.unclassifiedCount).toBe(1);
    expect(result.report.families[0]).toMatchObject({
      disposition: {
        authority: "none",
        reason: "catalog-metadata-insufficient",
        status: "unresolved",
      },
      status: "unresolved-metadata-insufficient",
    });
  });
});

describe("family source support census", () => {
  test("preserves every catalog concept across both paints and native masters", () => {
    const result = createCensus();

    expect(result.report).toMatchObject({
      catalogConceptCount: 2,
      expectedSlotCount: 8,
      inventoryFileCount: 2,
      slotCount: 8,
      summary: {
        admittedSlots: 2,
        admittedSourceFiles: 1,
        missingCatalogRoleConcepts: 0,
        missingSourcePaints: 2,
        missingSourceSlots: 4,
        refusedSlots: 2,
        refusedSourceFiles: 1,
        unresolvedGenerationSlots: 8,
        unresolvedMorphologySlots: 8,
      },
    });
    expect(
      result.report.slots.find(
        ({ concept, master, paint }) =>
          concept === "cloud" && master === 16 && paint === "filled"
      )
    ).toMatchObject({
      admissionDisposition: "not-applicable",
      generationDisposition: "unknown-not-demonstrated",
      reconstructionDisposition: "blocked-missing-source",
      sourceAvailability: "missing-source",
      sourceDisposition: "missing-source",
    });
  });

  test("separates refusal, reference availability and master-specific reconstruction", () => {
    const result = createCensus();
    const refused = result.report.slots.find(
      ({ concept, master, paint }) =>
        concept === "cloud-upload" && master === 16 && paint === "outlined"
    );
    const rasterDifference = result.report.slots.find(
      ({ concept, master, paint }) =>
        concept === "cloud" && master === 24 && paint === "outlined"
    );

    expect(refused).toMatchObject({
      admissionDisposition: "explicitly-refused",
      generationDisposition: "unknown-not-demonstrated",
      reconstructionDisposition: "verified-within-raster-threshold",
      sourceAvailability: "source-present",
      sourceDisposition: "reference-only",
    });
    expect(rasterDifference).toMatchObject({
      admissionDisposition: "admitted",
      reconstructionDisposition: "blocked-raster-difference",
      sourceDisposition: "admitted",
    });
    expect(result.report.familySupport[1]).toMatchObject({
      family: "#cloud",
      master: 24,
      paint: "outlined",
      reconstructionCounts: {
        blockedRasterDifference: 1,
        verifiedWithinRasterThreshold: 1,
      },
    });
  });

  test("keeps a missing catalog role explicit without dropping the concept", () => {
    const result = createCensus({ roles: [roles[0] as RoleAssignment] });
    const unresolved = result.report.slots.find(
      ({ concept, master, paint }) =>
        concept === "cloud-upload" && master === 16 && paint === "outlined"
    );

    expect(result.report.summary.missingCatalogRoleConcepts).toBe(1);
    expect(unresolved).toMatchObject({
      family: "#unresolved/cloud-upload",
      familyHead: null,
      familyIdentityDisposition: "unresolved-missing-catalog-role",
      morphologyDisposition: "unresolved-no-source-image-classification",
      role: null,
    });
  });

  test("rejects duplicate identities and incomplete evidence joins", () => {
    expect(() => createCensus({ catalogSlugs: ["cloud", "cloud"] })).toThrow(
      "Duplicate catalog slug: cloud"
    );
    expect(() =>
      createCensus({
        inventoryRows: [
          {
            concept: "cloud",
            file: "cloud.svg",
            finish: "outlined",
            sha256: "b".repeat(64),
          },
          {
            concept: "cloud",
            file: "cloud-copy.svg",
            finish: "outlined",
            sha256: "c".repeat(64),
          },
        ],
      })
    ).toThrow("Duplicate inventory concept/paint slot: cloud/outlined");
    expect(() =>
      createCensus({
        admissionRows: [{ file: "cloud.svg", status: "source-admitted" }],
      })
    ).toThrow("Missing admission disposition: cloud-upload.svg");
    expect(() =>
      createCensus({
        replayRows: [
          {
            errors: [
              { meanAbsolutePixelError: 0, size: 16 },
              { meanAbsolutePixelError: 0, size: 24 },
            ],
            exactReplay: true,
            file: "cloud.svg",
            sourceVerified: true,
          },
        ],
      })
    ).toThrow("Missing replay disposition: cloud-upload.svg");
    expect(() =>
      createCensus({
        replayRows: [
          {
            errors: [
              { meanAbsolutePixelError: 0, size: 16 },
              { meanAbsolutePixelError: 0.01, size: 16 },
            ],
            exactReplay: true,
            file: "cloud.svg",
            sourceVerified: true,
          },
          {
            errors: [
              { meanAbsolutePixelError: 0, size: 16 },
              { meanAbsolutePixelError: 0, size: 24 },
            ],
            exactReplay: true,
            file: "cloud-upload.svg",
            sourceVerified: true,
          },
        ],
      })
    ).toThrow("Duplicate replay master for cloud.svg: 16");
  });

  test("is deterministic across input order and binds all evidence to one source", () => {
    const first = createCensus();
    const second = createCensus({
      admissionRows: [
        { file: "cloud-upload.svg", status: "refused" as const },
        { file: "cloud.svg", status: "source-admitted" as const },
      ],
      catalogSlugs: ["cloud-upload", "cloud"],
      inventoryRows: [
        {
          concept: "cloud-upload",
          file: "cloud-upload.svg",
          finish: "outlined",
          sha256: "c".repeat(64),
        },
        {
          concept: "cloud",
          file: "cloud.svg",
          finish: "outlined",
          sha256: "b".repeat(64),
        },
      ],
      replayRows: [
        {
          errors: [
            { meanAbsolutePixelError: 0, size: 16 },
            { meanAbsolutePixelError: 0, size: 24 },
          ],
          exactReplay: true,
          file: "cloud-upload.svg",
          sourceVerified: true,
        },
        {
          errors: [
            { meanAbsolutePixelError: 0, size: 16 },
            { meanAbsolutePixelError: 0.02, size: 24 },
          ],
          exactReplay: true,
          file: "cloud.svg",
          sourceVerified: true,
        },
      ],
      roles: roles
        .filter(({ slug }) => ["cloud", "cloud-upload"].includes(slug))
        .toReversed(),
    });

    expect(second.hash).toBe(first.hash);
    expect(() => createCensus({ replaySourceHash: "d".repeat(64) })).toThrow(
      "Inventory, admission and replay source identities differ"
    );
  });
});

describe("content-addressed semantic disposition ingestion", () => {
  test("applies the independently reviewed Git split without changing slot evidence", () => {
    const census = createGitCensus();
    const packet = createGitReview(census);
    const result = ingestFamilySemanticDispositions(census, [envelope(packet)]);

    expect(result.report).toMatchObject({
      baseCensusHash: census.hash,
      slotCount: 24,
      summary: {
        reviewedConcepts: 5,
        reviewedSlots: 20,
        reviewedSlotsWithMissingSource: 2,
        untouchedConcepts: 1,
        untouchedSlots: 4,
      },
    });
    expect(result.report.slots).toHaveLength(census.report.slots.length);
    expect(
      result.report.slots.map(
        ({
          admissionDisposition,
          concept,
          master,
          paint,
          reconstructionDisposition,
        }) => ({
          admissionDisposition,
          concept,
          master,
          paint,
          reconstructionDisposition,
        })
      )
    ).toEqual(
      census.report.slots.map(
        ({
          admissionDisposition,
          concept,
          master,
          paint,
          reconstructionDisposition,
        }) => ({
          admissionDisposition,
          concept,
          master,
          paint,
          reconstructionDisposition,
        })
      )
    );
    expect(
      result.report.slots.find(
        ({ concept, master, paint }) =>
          concept === "git" && master === 16 && paint === "outlined"
      )
    ).toMatchObject({
      aliasSemanticDisposition: { status: "unresolved-unknown-aliases" },
      reviewedFamilyDisposition: {
        family: "git",
        head: "git",
        status: "reviewed-within-scope",
      },
      sourceReviewDisposition: "reviewed-source-bound",
    });
    expect(
      result.report.slots.find(
        ({ concept, master, paint }) =>
          concept === "git-fork" && master === 24 && paint === "filled"
      )
    ).toMatchObject({
      aliasSemanticDisposition: {
        aliases: ["version-control"],
        status: "confirmed-known-aliases",
      },
      derivativeSemanticDisposition: {
        closeWith: ["git-branches"],
        status: "reviewed-within-scope",
      },
      reviewedFamilyDisposition: { family: "git-fork", head: "git-fork" },
    });
  });

  test("retains missing sources and the untouched catalog remainder as unresolved", () => {
    const census = createGitCensus();
    const result = ingestFamilySemanticDispositions(census, [
      envelope(createGitReview(census)),
    ]);
    const missingFilledCommit = result.report.slots.find(
      ({ concept, master, paint }) =>
        concept === "git-commit-vertical" && master === 16 && paint === "filled"
    );
    const untouchedCloud = result.report.slots.find(
      ({ concept, master, paint }) =>
        concept === "cloud" && master === 16 && paint === "outlined"
    );

    expect(missingFilledCommit).toMatchObject({
      admissionDisposition: "not-applicable",
      reconstructionDisposition: "blocked-missing-source",
      sourceAvailability: "missing-source",
      sourceReviewDisposition: "reviewed-missing-source",
    });
    expect(untouchedCloud).toMatchObject({
      aliasSemanticDisposition: { status: "unresolved-not-reviewed" },
      derivativeSemanticDisposition: { status: "unresolved-not-reviewed" },
      reviewedFamilyDisposition: { status: "unresolved-not-reviewed" },
      semanticReviewPacketHash: null,
      sourceReviewDisposition: "unreviewed",
    });
  });

  test("rejects unbound provenance, stale sources and stale packet content", () => {
    const census = createGitCensus();
    const packet = createGitReview(census);
    expect(() =>
      ingestFamilySemanticDispositions(census, [
        {
          packet,
          packetHash: "f".repeat(64),
        },
      ])
    ).toThrow("Semantic review packet hash mismatch");

    const sameReviewer = {
      ...packet,
      independentReview: {
        ...packet.independentReview,
        reviewerId: packet.proposal.reviewerId,
      },
    };
    expect(() =>
      ingestFamilySemanticDispositions(census, [envelope(sameReviewer)])
    ).toThrow("Proposer and independent reviewer must differ");

    const sameArtifact = {
      ...packet,
      independentReview: {
        ...packet.independentReview,
        artifactSha256: packet.proposal.artifactSha256,
      },
    };
    expect(() =>
      ingestFamilySemanticDispositions(census, [envelope(sameArtifact)])
    ).toThrow("Proposal and independent review artifacts must differ");

    const forgedCensus = {
      ...census,
      report: { ...census.report, sourceHash: "f".repeat(64) },
    };
    expect(() =>
      ingestFamilySemanticDispositions(forgedCensus, [envelope(packet)])
    ).toThrow("Family source support census hash mismatch");

    const staleSource = { ...packet, sourceHash: "f".repeat(64) };
    expect(() =>
      ingestFamilySemanticDispositions(census, [envelope(staleSource)])
    ).toThrow("bound to stale sources");

    const staleBinding = {
      ...packet,
      sourceBindings: packet.sourceBindings.map((binding) =>
        binding.concept === "git" && binding.paint === "outlined"
          ? { ...binding, sha256: "f".repeat(64) }
          : binding
      ),
    };
    expect(() =>
      ingestFamilySemanticDispositions(census, [envelope(staleBinding)])
    ).toThrow("source binding is stale: git/outlined");
  });

  test("requires complete scoped family, alias, derivative and source dispositions", () => {
    const census = createGitCensus();
    const packet = createGitReview(census);
    const incompleteAliases = {
      ...packet,
      aliasDispositions: packet.aliasDispositions.slice(1),
    };
    expect(() =>
      ingestFamilySemanticDispositions(census, [envelope(incompleteAliases)])
    ).toThrow("Incomplete alias dispositions for review scope");

    const missingSourceBinding = {
      ...packet,
      sourceBindings: packet.sourceBindings.filter(
        ({ concept, paint }) => !(concept === "git" && paint === "filled")
      ),
    };
    expect(() =>
      ingestFamilySemanticDispositions(census, [envelope(missingSourceBinding)])
    ).toThrow("Incomplete source bindings for review scope");

    const asymmetricDerivative = {
      ...packet,
      derivativeDispositions: packet.derivativeDispositions.map((entry) =>
        entry.concept === "git-fork"
          ? {
              concept: entry.concept,
              disposition: {
                closeWith: [],
                status: "reviewed-within-scope" as const,
              },
            }
          : entry
      ),
    };
    expect(() =>
      ingestFamilySemanticDispositions(census, [envelope(asymmetricDerivative)])
    ).toThrow("Asymmetric close derivative disposition");
  });

  test("hashes canonical review ordering and rejects overlapping incremental scopes", () => {
    const census = createGitCensus();
    const packet = createGitReview(census);
    const reordered = {
      ...packet,
      aliasDispositions: packet.aliasDispositions.toReversed(),
      derivativeDispositions: packet.derivativeDispositions.toReversed(),
      familyDispositions: packet.familyDispositions.toReversed(),
      scope: packet.scope.toReversed(),
      sourceBindings: packet.sourceBindings.toReversed(),
    };
    expect(hashSemanticDispositionReview(reordered)).toBe(
      hashSemanticDispositionReview(packet)
    );
    expect(() =>
      ingestFamilySemanticDispositions(census, [
        envelope(packet),
        envelope(reordered),
      ])
    ).toThrow("Duplicate semantic review id");

    const overlapping = {
      ...packet,
      reviewId: "second-git-review",
    };
    expect(() =>
      ingestFamilySemanticDispositions(
        census,
        [packet, overlapping].map(envelope)
      )
    ).toThrow("Concept appears in multiple semantic reviews: git");
  });
});
