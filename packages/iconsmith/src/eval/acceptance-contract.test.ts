import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  ACCEPTANCE_CONTRACT_VERSION,
  ACCEPTANCE_GATE_SCOPES,
  DRAFT_ACCEPTANCE_CONTRACT,
  FROZEN_CATALOG_SLOT_CENSUS_HASH,
  hashAcceptanceCatalogSlotCensus,
  hashAcceptanceIndependentReviewEvidence,
  hashAcceptanceIndependentReviewSelection,
  validateAcceptanceReport,
  withComputedCampaignTerminalEvidence,
} from "./acceptance-contract.js";
import type {
  AcceptanceCampaignAuthorEvidence,
  AcceptanceCampaignTerminalExpectation,
  AcceptanceCampaignTerminalReport,
  AcceptanceDimension,
  AcceptanceExpectedSlot,
  AcceptanceIndependentReviewPopulation,
  AcceptanceOutputEvidence,
  AcceptancePopulation,
  AcceptanceReport,
} from "./acceptance-contract.js";
import { withComputedProductionCriticQualification } from "./foundry-gate.js";

const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .toSorted(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
};
const collectorReceipt = () => {
  const metrics = {
    canonicalCount: 100,
    decisionCoverage: 1,
    missingPanelRows: 0,
    missingPredictions: 0,
    populationReady: true,
    presentationConsistency: true,
    qualified: true,
    unresolvedPanelLabels: 0,
  };
  const metricsHash = hash(canonical(metrics));
  const criticIdentity = {
    actor: {
      baseModelLineage: "critic-lineage",
      model: "critic-model",
      provider: "openai-codex",
    },
    instrumentHash: hash("critic-instrument"),
    qualificationSessionIds: ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"],
    routeHash: hash("critic-route"),
    sessionPolicy: "distinct-production-session-required",
  };
  const core = {
    agreementMetricsQualified: true,
    criticIdentity,
    evidenceManifestHash: hash("collector-manifest"),
    generalGeneratedCriticQualified: true,
    metricsHash,
    populationIdentityValidated: true,
    provenanceKind: "collector-bound-native-evidence-v1",
    provenanceValidated: true,
    qualificationScope: "agreement-with-independent-ai-panel",
    qualified: true,
  };
  return {
    ...core,
    metrics,
    qualificationVersionHash: hash(canonical(core)),
  };
};
const collectorIdentity = () => {
  const receipt = collectorReceipt();
  return {
    criticIdentityHash: hash(canonical(receipt.criticIdentity)),
    criticReviewerId: hash(
      canonical({
        actor: receipt.criticIdentity.actor,
        instrumentHash: receipt.criticIdentity.instrumentHash,
        routeHash: receipt.criticIdentity.routeHash,
      })
    ),
    evidenceManifestHash: receipt.evidenceManifestHash,
    metricsHash: receipt.metricsHash,
    productionReviewManifestHash: hash("unbound-production-reviews"),
    qualificationVersionHash: receipt.qualificationVersionHash,
    reviewSetHash: hash("unbound-production-review-set"),
  };
};

const quartet = (
  population: AcceptancePopulation,
  conceptId: string,
  familyId = conceptId
): AcceptanceExpectedSlot[] =>
  ([16, 24] as const).flatMap((nativeSize) =>
    (["outlined", "filled"] as const).map((paint) => {
      const requestId = `${conceptId}/${nativeSize}`;
      const slotId = `${population}/${requestId}/${paint}`;
      return {
        canonicalSlotId: slotId,
        conceptId,
        familyId,
        nativeSize,
        originalDeadlineAt: 2_000_000,
        paint,
        population,
        requestId,
        requestIntentHash: hash(`${population}/${requestId}`),
        slotId,
      };
    })
  );

const frozenCatalog = JSON.parse(
  readFileSync(
    new URL(
      "../../../../docs/log/quality-catalog-campaign-manifest-2026-09-07.json",
      import.meta.url
    ),
    "utf-8"
  )
) as {
  manifest: {
    slots: readonly {
      concept: string;
      family: string;
      finish: "filled" | "outlined";
      nativeSize: 16 | 24;
      slotId: string;
    }[];
  };
};

const catalogSlots = (): AcceptanceExpectedSlot[] => {
  const slots = frozenCatalog.manifest.slots.map(
    ({ concept, family, finish, nativeSize, slotId }) => {
      const requestId = `${family}/${concept}/${nativeSize}`;
      return {
        canonicalSlotId: `catalog/${slotId}`,
        conceptId: concept,
        familyId: family,
        nativeSize,
        originalDeadlineAt: 2_000_000,
        paint: finish,
        population: "catalog",
        requestId,
        requestIntentHash: hash(`catalog/${requestId}`),
        slotId: `catalog/${slotId}`,
      };
    }
  );
  return [
    ...slots.filter(({ conceptId }) => conceptId === "add-image"),
    ...slots.filter(({ conceptId }) => conceptId !== "add-image"),
  ];
};

const expectedSlots = () => [
  ...catalogSlots(),
  ...Array.from({ length: 20 }, (_, index) =>
    quartet("novel-batch-a", `novel-a-${index + 1}`)
  ).flat(),
  ...Array.from({ length: 20 }, (_, index) =>
    quartet("novel-batch-b", `novel-b-${index + 1}`)
  ).flat(),
];

const output = (slot: AcceptanceExpectedSlot): AcceptanceOutputEvidence => {
  const artifactHash = hash(`artifact/${slot.slotId}`);
  return {
    ...slot,
    artifactHash,
    authorProvenance: {
      artifactHash,
      authorId: "author-a",
      lineage: "author-lineage",
    },
    completedAt: slot.originalDeadlineAt - 1,
    craftRatings: [9, 10],
    criticalDefect: false,
    deliveryArtifactValid: true,
    deliveryState: "delivered",
    evidenceDisposition: "produced-inspected",
    exactReplay: true,
    familyFit: true,
    houseCraftComparisons: [
      {
        candidateCraft: 9,
        presentationProtocolHash: hash("house-parity-protocol-v1"),
        referenceArtifactHash: hash(`house-reference/${slot.familyId}`),
        referenceCraft: 9,
        reviewerId: "parity-reviewer-a",
      },
      {
        candidateCraft: 10,
        presentationProtocolHash: hash("house-parity-protocol-v1"),
        referenceArtifactHash: hash(`house-reference/${slot.familyId}`),
        referenceCraft: 10,
        reviewerId: "parity-reviewer-b",
      },
    ],
    nativeLegibility: (["light", "dark"] as const).map((surface, index) => ({
      artifactHash: hash(`native/${slot.slotId}/${surface}`),
      legible: true,
      reviewerId: `parity-reviewer-${index === 0 ? "a" : "b"}`,
      sourceArtifactHash: artifactHash,
      surface,
    })),
    recognitionCorrect: true,
    reviewerAssessments: [
      {
        artifactHash,
        craftRating: 9,
        criticalDefect: false,
        familyFit: true,
        recognitionCorrect: true,
        reviewEvidenceHash: hash(`review/${slot.slotId}/a`),
        reviewerId: "parity-reviewer-a",
        shipUnchanged: true,
      },
      {
        artifactHash,
        craftRating: 10,
        criticalDefect: false,
        familyFit: true,
        recognitionCorrect: true,
        reviewEvidenceHash: hash(`review/${slot.slotId}/b`),
        reviewerId: "parity-reviewer-b",
        shipUnchanged: true,
      },
    ],
    reviewerProvenance: [
      {
        artifactHash,
        lineage: "reviewer-lineage-a",
        reviewEvidenceHash: hash(`review/${slot.slotId}/a`),
        reviewerId: "parity-reviewer-a",
      },
      {
        artifactHash,
        lineage: "reviewer-lineage-b",
        reviewEvidenceHash: hash(`review/${slot.slotId}/b`),
        reviewerId: "parity-reviewer-b",
      },
    ],
    shipUnchanged: true,
    terminalState: "accepted",
  };
};

const scopedSlots = (
  slots: readonly AcceptanceExpectedSlot[],
  scope: string
) => {
  if (scope === "every-output") {
    return slots;
  }
  const [population, stratum] = scope.split("/");
  return slots.filter(
    (slot) =>
      slot.population === population &&
      (stratum === undefined || `${slot.paint}-${slot.nativeSize}` === stratum)
  );
};

const fixtureGateReviewPopulations = (dimension: string, scope: string) => {
  if (dimension === "evaluation") {
    return ["production-catalog-critic"] as const;
  }
  if (
    scope.startsWith("catalog/") &&
    ["craft", "houseParity", "nativeQuality", "recognition"].includes(dimension)
  ) {
    return ["production-catalog-critic", "catalog-probability-audit"] as const;
  }
  if (scope.startsWith("novel-batch-a")) {
    return ["novel-panel-a"] as const;
  }
  if (scope.startsWith("novel-batch-b")) {
    return ["novel-panel-b"] as const;
  }
  return [];
};

const fixtureReviewPopulationDenominator = (
  purpose: string,
  slots: readonly AcceptanceExpectedSlot[]
) => {
  if (purpose === "catalog-probability-audit") {
    return 400;
  }
  if (purpose === "production-catalog-critic") {
    return slots.filter(({ population }) => population === "catalog").length;
  }
  const population =
    purpose === "novel-panel-a" ? "novel-batch-a" : "novel-batch-b";
  return slots.filter((slot) => slot.population === population).length;
};

const independentReviewPopulations = (
  slots: readonly AcceptanceExpectedSlot[],
  outputs: readonly AcceptanceOutputEvidence[]
): AcceptanceIndependentReviewPopulation[] => {
  const outputById = new Map(
    outputs.map((candidate) => [candidate.slotId, candidate])
  );
  const catalogConceptByFamily = new Map<string, string>();
  for (const slot of slots.filter(
    ({ population }) => population === "catalog"
  )) {
    if (
      catalogConceptByFamily.size >= 100 &&
      !catalogConceptByFamily.has(slot.familyId)
    ) {
      continue;
    }
    if (!catalogConceptByFamily.has(slot.familyId)) {
      catalogConceptByFamily.set(slot.familyId, slot.conceptId);
    }
  }
  const selectedByPurpose = {
    "catalog-probability-audit": slots.filter(
      (slot) =>
        slot.population === "catalog" &&
        catalogConceptByFamily.get(slot.familyId) === slot.conceptId
    ),
    "novel-panel-a": slots.filter(
      ({ population }) => population === "novel-batch-a"
    ),
    "novel-panel-b": slots.filter(
      ({ population }) => population === "novel-batch-b"
    ),
  } as const;
  return Object.entries(selectedByPurpose).map(([purpose, selected]) => {
    const typedPurpose =
      purpose as AcceptanceIndependentReviewPopulation["purpose"];
    const selectionSealedAt = 1_000_000;
    return {
      purpose: typedPurpose,
      selectionHash: hashAcceptanceIndependentReviewSelection(
        typedPurpose,
        selected.map(({ slotId }) => slotId)
      ),
      selectionSealedAt,
      slots: selected.map(({ slotId }) => {
        const artifactHash = outputById.get(slotId)?.artifactHash;
        if (!artifactHash) {
          throw new Error(`Missing independent fixture artifact: ${slotId}`);
        }
        return {
          disposition: "inspected" as const,
          reviews: ["audit-panel-a", "audit-panel-b"].map(
            (reviewerId, reviewerIndex) => ({
              artifactHash,
              completedAt: 2_000_020 + reviewerIndex,
              craftRating: 9,
              criticalDefect: false,
              familyFit: true,
              lineage: `independent-lineage-${reviewerIndex}`,
              nativeLegibility: true,
              recognitionCorrect: true,
              reviewEvidenceHash: hash(
                `independent/${purpose}/${slotId}/${reviewerId}`
              ),
              reviewerId,
              shipUnchanged: true,
              startedAt: 2_000_010 + reviewerIndex,
            })
          ),
          slotId,
        };
      }),
    };
  });
};

const report = (): AcceptanceReport => {
  const slots = expectedSlots();
  const outputs = slots.map(output);
  const independentPopulations = independentReviewPopulations(slots, outputs);
  return {
    catalogSlotManifestHash: FROZEN_CATALOG_SLOT_CENSUS_HASH,
    contractVersion: ACCEPTANCE_CONTRACT_VERSION,
    expectedSlots: slots,
    gates: Object.entries(ACCEPTANCE_GATE_SCOPES).flatMap(
      ([dimension, scopes]) =>
        scopes.map((scope) => {
          const scoped = scopedSlots(slots, scope);
          const denominator =
            dimension === "delivery"
              ? new Set(scoped.map(({ requestId }) => requestId)).size
              : scoped.length || 1;
          const evidencePopulations = fixtureGateReviewPopulations(
            dimension,
            scope
          );
          return {
            ...(dimension === "evaluation"
              ? { computedCriticIdentity: collectorIdentity() }
              : {}),
            denominator,
            dimension: dimension as AcceptanceDimension,
            evidencePopulations,
            passed: true,
            scope,
            successes: denominator,
          };
        })
    ),
    independentReviewPopulations: independentPopulations,
    outputs,
    reviewPopulations: [
      "production-catalog-critic",
      "catalog-probability-audit",
      "novel-panel-a",
      "novel-panel-b",
    ].map((purpose) => {
      const independentPopulation = independentPopulations.find(
        (entry) => entry.purpose === purpose
      );
      if (purpose !== "production-catalog-critic" && !independentPopulation) {
        throw new Error(`Missing independent population fixture: ${purpose}`);
      }
      return {
        instrumentHash:
          purpose === "production-catalog-critic"
            ? collectorIdentity().qualificationVersionHash
            : hash(`instrument/${purpose}`),
        manifestHash:
          purpose === "production-catalog-critic"
            ? collectorIdentity().productionReviewManifestHash
            : hashAcceptanceIndependentReviewEvidence(independentPopulation),
        populationHash:
          purpose === "production-catalog-critic"
            ? collectorIdentity().reviewSetHash
            : independentPopulation.selectionHash,
        purpose: purpose as
          | "catalog-probability-audit"
          | "novel-panel-a"
          | "novel-panel-b"
          | "production-catalog-critic",
        requestedDenominator: fixtureReviewPopulationDenominator(
          purpose,
          slots
        ),
      };
    }),
    uncertainty: {
      confidenceLevel: 0.95,
      method: "family-cluster-percentile-sha256-counter-v1",
      resamplingCount: 1000,
      seed: "seed-1",
    },
  };
};

const terminalBinding = (
  candidate: AcceptanceReport,
  requestId: string,
  overrides: Partial<AcceptanceCampaignTerminalReport> = {}
) => {
  const slots = candidate.expectedSlots.filter(
    (slot) => slot.requestId === requestId
  );
  if (slots.length !== 2) {
    throw new Error("Terminal fixture requires one paired request");
  }
  const expectation = {
    campaignHash: hash("campaign"),
    originalDeadlineAt: slots[0]?.originalDeadlineAt ?? null,
    planHash: hash("plan"),
    requestId,
    requestIntentHash: slots[0]?.requestIntentHash ?? null,
    route: "native-route",
    runtimeHash: hash("runtime"),
    slotIds: [slots[0]?.slotId ?? "", slots[1]?.slotId ?? ""],
    toolingHash: hash("tooling"),
  } satisfies AcceptanceCampaignTerminalExpectation;
  const byPaint = new Map(
    slots.map((slot) => [
      slot.paint,
      candidate.outputs.find((row) => row.slotId === slot.slotId),
    ])
  );
  const terminal = {
    authorEvidenceVerified: false,
    campaignHash: expectation.campaignHash,
    deadlineAt: expectation.originalDeadlineAt,
    disposition: "produced",
    kind: "iconsmith-verified-campaign-terminal-evidence-report-v1",
    planAuthority: "caller-frozen",
    planHash: expectation.planHash,
    qualificationGranted: false,
    requestId,
    requestIntentHash: expectation.requestIntentHash,
    route: expectation.route,
    runtimeHash: expectation.runtimeHash,
    selectedEvidence: {
      filledSha256: byPaint.get("filled")?.artifactHash ?? "",
      outlinedSha256: byPaint.get("outlined")?.artifactHash ?? "",
      state: "retained-produced",
    },
    slotIds: expectation.slotIds,
    terminalStatus: "incomplete",
    toolingHash: expectation.toolingHash,
    ...overrides,
  } satisfies AcceptanceCampaignTerminalReport;
  return { expectation, terminal };
};

const verifiedAuthorTerminal = (
  terminal: AcceptanceCampaignTerminalReport
): Partial<AcceptanceCampaignTerminalReport> => {
  if (
    terminal.selectedEvidence.state !== "retained-produced" ||
    terminal.deadlineAt === null
  ) {
    throw new Error("Verified author fixture requires produced evidence");
  }
  const paints = {
    filled: {
      programSha256: hash("filled-program"),
      proofSha256: hash("filled-proof"),
      svgSha256: terminal.selectedEvidence.filledSha256,
    },
    outlined: {
      programSha256: hash("outlined-program"),
      proofSha256: hash("outlined-proof"),
      svgSha256: terminal.selectedEvidence.outlinedSha256,
    },
  } as const;
  const artifacts = (Object.keys(paints) as (keyof typeof paints)[]).flatMap(
    (paint) => [
      { name: `${paint}.icon`, sha256: paints[paint].programSha256 },
      { name: `${paint}.proof.png`, sha256: paints[paint].proofSha256 },
      { name: `${paint}.svg`, sha256: paints[paint].svgSha256 },
    ]
  );
  const selectedTreeSha256 = hash("selected-tree");
  const authorReceiptSha256 = hash("structured-author-receipt");
  artifacts.push({
    name: "structured-author.json",
    sha256: authorReceiptSha256,
  });
  const authorEvidence: AcceptanceCampaignAuthorEvidence = {
    authorId: "codex:gpt-6-astra",
    authorLineage: "gpt-6-astra",
    authorModel: "gpt-6-astra",
    authorReceiptSha256,
    completionDeadlineAt: terminal.deadlineAt - 1,
    evidenceReceiptSha256s: [
      hash("construct"),
      hash("inspect"),
      hash("finalize"),
    ],
    inspection: {
      collectorRequestId: "collector-inspection",
      emittedModel: "gpt-6-astra",
      emittedSessionId: "session-inspection",
      intentHash: hash("inspection-intent"),
      lifecycleRequestSha256: hash("inspection-lifecycle"),
      stageDeadlineAt: terminal.deadlineAt - 2,
      traceReceiptSha256: hash("inspection-trace-receipt"),
      traceSha256: hash("inspection-trace"),
    },
    kind: "parent-replayed-author-inspection-v1",
    nativeRouteHash: hash("native-route"),
    paints,
    selectedTreeSha256,
  };
  return {
    authorEvidence,
    authorEvidenceVerified: true,
    selectedEvidence: {
      ...terminal.selectedEvidence,
      artifacts,
      treeHash: selectedTreeSha256,
    },
  };
};

const resealIndependentPopulation = (
  candidate: AcceptanceReport,
  population: AcceptanceIndependentReviewPopulation
) => {
  population.selectionHash = hashAcceptanceIndependentReviewSelection(
    population.purpose,
    population.slots.map(({ slotId }) => slotId)
  );
  const identity = candidate.reviewPopulations.find(
    ({ purpose }) => purpose === population.purpose
  );
  if (!identity) {
    throw new Error(`Missing population identity: ${population.purpose}`);
  }
  identity.populationHash = population.selectionHash;
  identity.manifestHash = hashAcceptanceIndependentReviewEvidence(population);
};

const independentMetric = (candidate: AcceptanceReport, scope: string) => {
  const metric = validateAcceptanceReport(
    candidate
  ).independentReviewMetrics.find((entry) => entry.scope === scope);
  if (!metric) {
    throw new Error(`Missing independent metric: ${scope}`);
  }
  return metric;
};

describe("draft AI-only acceptance contract", () => {
  it("validates separate 100-family catalog and 20-family novel selections", () => {
    const candidate = report();
    const catalog = candidate.independentReviewPopulations.find(
      ({ purpose }) => purpose === "catalog-probability-audit"
    );
    expect(catalog?.slots).toHaveLength(400);
    expect(
      new Set(
        catalog?.slots.map(
          ({ slotId }) =>
            candidate.expectedSlots.find((slot) => slot.slotId === slotId)
              ?.familyId
        )
      ).size
    ).toBe(100);
    expect(validateAcceptanceReport(candidate).reasons).not.toContain(
      "Independent review selection is invalid: catalog-probability-audit"
    );
  });

  it("rejects duplicate-family selection and a missing paint slot", () => {
    const candidate = report();
    const catalog = candidate.independentReviewPopulations.find(
      ({ purpose }) => purpose === "catalog-probability-audit"
    );
    if (!catalog) {
      throw new Error("Missing catalog audit fixture");
    }
    const [replacement] = catalog.slots.slice(4);
    if (!replacement) {
      throw new Error("Missing replacement fixture");
    }
    catalog.slots = [...catalog.slots.slice(0, 399), replacement];
    catalog.selectionHash = hashAcceptanceIndependentReviewSelection(
      catalog.purpose,
      catalog.slots.map(({ slotId }) => slotId)
    );
    expect(validateAcceptanceReport(candidate).reasons).toContain(
      "Independent review selection is invalid: catalog-probability-audit"
    );
  });

  it("rejects a catalog slot swapped into a novel panel", () => {
    const candidate = report();
    const novel = candidate.independentReviewPopulations.find(
      ({ purpose }) => purpose === "novel-panel-a"
    );
    const catalog = candidate.independentReviewPopulations.find(
      ({ purpose }) => purpose === "catalog-probability-audit"
    );
    if (!(novel && catalog?.slots[0])) {
      throw new Error("Missing audit fixtures");
    }
    novel.slots = [catalog.slots[0], ...novel.slots.slice(1)];
    novel.selectionHash = hashAcceptanceIndependentReviewSelection(
      novel.purpose,
      novel.slots.map(({ slotId }) => slotId)
    );
    expect(validateAcceptanceReport(candidate).reasons).toContain(
      "Independent review selection is invalid: novel-panel-a"
    );
  });

  it("rejects production critic evidence substituted into an audit row", () => {
    const candidate = report();
    const audit =
      candidate.independentReviewPopulations[0]?.slots[0]?.reviews[0];
    const production = candidate.outputs[0]?.reviewerAssessments[0];
    if (!(audit && production)) {
      throw new Error("Missing review fixtures");
    }
    Object.assign(audit, {
      reviewEvidenceHash: production.reviewEvidenceHash,
      reviewerId: production.reviewerId,
    });
    expect(validateAcceptanceReport(candidate).reasons).toContain(
      `Independent panel evidence is invalid: catalog-probability-audit/${candidate.independentReviewPopulations[0]?.slots[0]?.slotId}`
    );
  });

  it("fails closed for malformed independent slot and review rows", () => {
    const malformedSlot = report();
    const [slotPopulation] = malformedSlot.independentReviewPopulations;
    if (!slotPopulation) {
      throw new Error("Missing audit population fixture");
    }
    slotPopulation.slots = [
      null,
      ...slotPopulation.slots.slice(1),
    ] as unknown as typeof slotPopulation.slots;
    expect(() => validateAcceptanceReport(malformedSlot)).not.toThrow();
    expect(validateAcceptanceReport(malformedSlot).reasons).toContain(
      "Independent review population data is invalid: catalog-probability-audit"
    );

    const malformedReview = report();
    const reviewSlot =
      malformedReview.independentReviewPopulations[0]?.slots[0];
    if (!reviewSlot) {
      throw new Error("Missing audit review fixture");
    }
    reviewSlot.reviews = [
      null,
      ...reviewSlot.reviews.slice(1),
    ] as unknown as typeof reviewSlot.reviews;
    expect(() => validateAcceptanceReport(malformedReview)).not.toThrow();
    expect(validateAcceptanceReport(malformedReview).reasons).toContain(
      `Independent review row is invalid: catalog-probability-audit/${reviewSlot.slotId}`
    );
  });

  it("fails closed for a null production critic row without throwing", () => {
    const candidate = report();
    const [selectedOutput] = candidate.outputs;
    if (!selectedOutput) {
      throw new Error("Missing production review fixture");
    }
    selectedOutput.reviewerAssessments = [
      null,
      ...selectedOutput.reviewerAssessments,
    ] as unknown as typeof selectedOutput.reviewerAssessments;
    expect(() => validateAcceptanceReport(candidate)).not.toThrow();
    expect(validateAcceptanceReport(candidate).reasons).toContain(
      `Invalid reviewer assessment evidence: ${selectedOutput.slotId}`
    );
  });

  it("requires an explicit review array for uninspected evidence", () => {
    const candidate = report();
    const selected = candidate.independentReviewPopulations[0]?.slots[0];
    if (!selected) {
      throw new Error("Missing audit slot fixture");
    }
    selected.disposition = "uninspected";
    delete (selected as Partial<typeof selected>).reviews;
    expect(validateAcceptanceReport(candidate).reasons).toContain(
      `Independent review row is invalid: catalog-probability-audit/${selected.slotId}`
    );
  });

  it("rejects contradictory critical and ship labels", () => {
    const candidate = report();
    const selected = candidate.independentReviewPopulations[0]?.slots[0];
    const [review] = selected?.reviews ?? [];
    if (!(selected && review)) {
      throw new Error("Missing audit review fixture");
    }
    review.criticalDefect = true;
    review.shipUnchanged = true;
    expect(validateAcceptanceReport(candidate).reasons).toContain(
      `Independent panel evidence is invalid: catalog-probability-audit/${selected.slotId}`
    );
  });

  it("rejects an independent reviewer from the artifact author lineage", () => {
    const candidate = report();
    const selected = candidate.independentReviewPopulations[0]?.slots[0];
    const [review] = selected?.reviews ?? [];
    const selectedOutput = candidate.outputs.find(
      ({ slotId }) => slotId === selected?.slotId
    );
    if (!(selected && review && selectedOutput?.authorProvenance)) {
      throw new Error("Missing author-lineage fixture");
    }
    review.lineage = selectedOutput.authorProvenance.lineage;
    expect(validateAcceptanceReport(candidate).reasons).toContain(
      `Independent panel evidence is invalid: catalog-probability-audit/${selected.slotId}`
    );
  });

  it("rejects reused independent panel evidence bytes", () => {
    const candidate = report();
    const [first, second] =
      candidate.independentReviewPopulations[0]?.slots ?? [];
    const [firstReview] = first?.reviews ?? [];
    const [secondReview] = second?.reviews ?? [];
    if (!(second && firstReview && secondReview)) {
      throw new Error("Missing independent evidence fixtures");
    }
    secondReview.reviewEvidenceHash = firstReview.reviewEvidenceHash;
    expect(validateAcceptanceReport(candidate).reasons).toContain(
      `Independent panel evidence is invalid: catalog-probability-audit/${second.slotId}`
    );
  });

  it("rejects a selection sealed after independent review began", () => {
    const candidate = report();
    const novel = candidate.independentReviewPopulations.find(
      ({ purpose }) => purpose === "novel-panel-b"
    );
    if (!novel) {
      throw new Error("Missing novel fixture");
    }
    const [selected] = novel.slots;
    const [review] = selected?.reviews ?? [];
    if (!(selected && review)) {
      throw new Error("Missing selected review fixture");
    }
    novel.selectionSealedAt = review.startedAt + 1;
    expect(validateAcceptanceReport(candidate).reasons).toContain(
      `Independent review row is invalid: novel-panel-b/${selected.slotId}`
    );
  });

  it("rejects a selection sealed after the selected output was produced", () => {
    const candidate = report();
    const novel = candidate.independentReviewPopulations.find(
      ({ purpose }) => purpose === "novel-panel-a"
    );
    if (!novel) {
      throw new Error("Missing novel fixture");
    }
    const [selected] = novel.slots;
    const selectedOutput = candidate.outputs.find(
      ({ slotId }) => slotId === selected?.slotId
    );
    if (!(selected && selectedOutput?.completedAt)) {
      throw new Error("Missing selected output fixture");
    }
    novel.selectionSealedAt = selectedOutput.completedAt + 1;
    expect(validateAcceptanceReport(candidate).reasons).toContain(
      `Independent review row is invalid: novel-panel-a/${selected.slotId}`
    );
  });

  it("retains missing selected slots without fabricating panel reviews", () => {
    const candidate = report();
    const novel = candidate.independentReviewPopulations.find(
      ({ purpose }) => purpose === "novel-panel-a"
    );
    if (!novel) {
      throw new Error("Missing novel fixture");
    }
    const [selected] = novel.slots;
    if (!selected) {
      throw new Error("Missing selected slot fixture");
    }
    const selectedOutput = candidate.outputs.find(
      ({ slotId }) => slotId === selected.slotId
    );
    if (!selectedOutput) {
      throw new Error("Missing selected output fixture");
    }
    selectedOutput.artifactHash = null;
    selectedOutput.evidenceDisposition = "not-produced";
    selectedOutput.terminalState = "failed";
    selected.disposition = "missing";
    selected.reviews = [];
    expect(validateAcceptanceReport(candidate).reasons).not.toContain(
      `Independent review row is invalid: novel-panel-a/${selected.slotId}`
    );
  });

  it("computes the 19-of-20 threshold per novel paint and master stratum", () => {
    const candidate = report();
    const novel = candidate.independentReviewPopulations.find(
      ({ purpose }) => purpose === "novel-panel-a"
    );
    if (!novel) {
      throw new Error("Missing novel panel fixture");
    }
    const stratum = novel.slots.filter(({ slotId }) => {
      const expected = candidate.expectedSlots.find(
        (slot) => slot.slotId === slotId
      );
      return expected?.paint === "outlined" && expected.nativeSize === 16;
    });
    expect(stratum).toHaveLength(20);
    for (const review of stratum[0]?.reviews ?? []) {
      review.recognitionCorrect = false;
    }
    resealIndependentPopulation(candidate, novel);
    const passing = validateAcceptanceReport(candidate);
    expect(
      passing.independentReviewMetrics.find(
        ({ scope }) => scope === "novel-batch-a/outlined-16"
      )
    ).toMatchObject({
      recognitionRate: 0.95,
      recognitionSuccesses: 19,
      requestedCount: 20,
    });
    expect(passing.reasons).not.toContain(
      "Acceptance gate pass contradicts independent review evidence: recognition/novel-batch-a/outlined-16"
    );

    for (const review of stratum[1]?.reviews ?? []) {
      review.recognitionCorrect = false;
    }
    resealIndependentPopulation(candidate, novel);
    const failing = validateAcceptanceReport(candidate);
    expect(
      failing.independentReviewMetrics.find(
        ({ scope }) => scope === "novel-batch-a/outlined-16"
      )
    ).toMatchObject({
      recognitionRate: 0.9,
      recognitionSuccesses: 18,
      requestedCount: 20,
    });
    expect(failing.reasons).toContain(
      "Acceptance gate pass contradicts independent review evidence: recognition/novel-batch-a/outlined-16"
    );
  });

  it("computes the 95-of-100 catalog ship threshold from the requested stratum", () => {
    const candidate = report();
    const audit = candidate.independentReviewPopulations.find(
      ({ purpose }) => purpose === "catalog-probability-audit"
    );
    if (!audit) {
      throw new Error("Missing catalog audit fixture");
    }
    const stratum = audit.slots.filter(({ slotId }) => {
      const expected = candidate.expectedSlots.find(
        (slot) => slot.slotId === slotId
      );
      return expected?.paint === "outlined" && expected.nativeSize === 16;
    });
    expect(stratum).toHaveLength(100);
    for (const selected of stratum.slice(0, 5)) {
      for (const review of selected.reviews) {
        review.shipUnchanged = false;
      }
    }
    resealIndependentPopulation(candidate, audit);
    const passing = validateAcceptanceReport(candidate);
    const metric = passing.independentReviewMetrics.find(
      ({ scope }) => scope === "catalog/outlined-16"
    );
    expect(metric).toMatchObject({
      requestedCount: 100,
      shipRate: 0.95,
      shipSuccesses: 95,
    });
    if (!metric) {
      throw new Error("Missing catalog independent metric");
    }
    const shipInterval = metric.uncertainty.shipRate;
    expect(shipInterval.available && shipInterval.interval.lower).toBeLessThan(
      0.95
    );
    expect(passing.reasons).not.toContain(
      "Acceptance gate pass contradicts independent review evidence: craft/catalog/outlined-16"
    );

    for (const review of stratum[5]?.reviews ?? []) {
      review.shipUnchanged = false;
    }
    resealIndependentPopulation(candidate, audit);
    const failing = validateAcceptanceReport(candidate);
    expect(
      failing.independentReviewMetrics.find(
        ({ scope }) => scope === "catalog/outlined-16"
      )
    ).toMatchObject({
      shipRate: 0.94,
      shipSuccesses: 94,
    });
    expect(failing.reasons).toContain(
      "Acceptance gate pass contradicts independent review evidence: craft/catalog/outlined-16"
    );
  });

  it("retains missing and unresolved rows in requested metric denominators", () => {
    const candidate = report();
    const novel = candidate.independentReviewPopulations.find(
      ({ purpose }) => purpose === "novel-panel-b"
    );
    if (!novel) {
      throw new Error("Missing novel panel fixture");
    }
    const stratum = novel.slots.filter(({ slotId }) => {
      const expected = candidate.expectedSlots.find(
        (slot) => slot.slotId === slotId
      );
      return expected?.paint === "filled" && expected.nativeSize === 24;
    });
    const [missing, unresolved] = stratum;
    const missingOutput = candidate.outputs.find(
      ({ slotId }) => slotId === missing?.slotId
    );
    if (!(missing && unresolved && missingOutput)) {
      throw new Error("Missing selected evidence fixtures");
    }
    missing.disposition = "missing";
    missing.reviews = [];
    missingOutput.artifactHash = null;
    missingOutput.completedAt = null;
    for (const [index, review] of unresolved.reviews.entries()) {
      review.recognitionCorrect = index === 0;
    }
    resealIndependentPopulation(candidate, novel);
    expect(
      independentMetric(candidate, "novel-batch-b/filled-24")
    ).toMatchObject({
      craftObservedCount: 19,
      inspectedCount: 19,
      missingCount: 1,
      panelResolvedCount: 18,
      recognitionRate: 0.9,
      recognitionSuccesses: 18,
      requestedCount: 20,
      unresolvedCount: 1,
    });
    const metric = independentMetric(candidate, "novel-batch-b/filled-24");
    expect(metric.uncertainty.recognitionRate).toMatchObject({
      available: true,
      pointEstimate: 0.9,
    });
    expect(metric.uncertainty.craftMedian).toMatchObject({
      available: true,
      pointEstimate: 9,
    });
  });

  it("aggregates craft per output before taking the population median", () => {
    const candidate = report();
    const novel = candidate.independentReviewPopulations.find(
      ({ purpose }) => purpose === "novel-panel-a"
    );
    if (!novel) {
      throw new Error("Missing novel panel fixture");
    }
    const stratum = novel.slots.filter(({ slotId }) => {
      const expected = candidate.expectedSlots.find(
        (slot) => slot.slotId === slotId
      );
      return expected?.paint === "filled" && expected.nativeSize === 16;
    });
    for (const [index, selected] of stratum.entries()) {
      const ratings = index < 10 ? [1, 10] : [8, 8];
      for (const [reviewIndex, review] of selected.reviews.entries()) {
        review.craftRating = ratings[reviewIndex] ?? 0;
      }
    }
    resealIndependentPopulation(candidate, novel);
    expect(
      independentMetric(candidate, "novel-batch-a/filled-16")
    ).toMatchObject({
      craftMedian: 6.75,
      craftObservedCount: 20,
      requestedCount: 20,
    });
  });

  it("publishes bounded descriptive intervals without turning them into gates", () => {
    const candidate = report();
    const metric = independentMetric(candidate, "novel-batch-a/outlined-16");
    expect(metric.uncertainty.panelSuccessRate).toMatchObject({
      available: true,
      interval: {
        confidenceLevel: 0.95,
        lower: 1,
        method: "family-cluster-percentile-sha256-counter-v1",
        scope: "descriptive-not-an-acceptance-lower-bound",
        upper: 1,
      },
      pointEstimate: 1,
    });
  });

  it("quarantines any critical allegation from panel success", () => {
    const candidate = report();
    const novel = candidate.independentReviewPopulations.find(
      ({ purpose }) => purpose === "novel-panel-b"
    );
    const selected = novel?.slots[0];
    if (!(novel && selected)) {
      throw new Error("Missing novel panel fixture");
    }
    for (const review of selected.reviews) {
      review.criticalDefect = true;
      review.shipUnchanged = false;
    }
    resealIndependentPopulation(candidate, novel);
    const metric = independentMetric(candidate, "novel-batch-b");
    expect(metric).toMatchObject({
      craftSuccesses: 79,
      criticalCount: 1,
      familyFitSuccesses: 79,
      nativeLegibilitySuccesses: 79,
      panelResolvedCount: 80,
      panelSuccesses: 79,
      recognitionSuccesses: 79,
      requestedCount: 80,
      shipSuccesses: 79,
      unresolvedCount: 0,
    });
    expect(
      metric.panelResolvedCount +
        metric.unresolvedCount +
        metric.missingCount +
        metric.uninspectedCount
    ).toBe(metric.requestedCount);
  });

  it("marks a critical disagreement unresolved without hiding the allegation", () => {
    const candidate = report();
    const novel = candidate.independentReviewPopulations.find(
      ({ purpose }) => purpose === "novel-panel-b"
    );
    const selected = novel?.slots[0];
    const [firstReview] = selected?.reviews ?? [];
    if (!(novel && selected && firstReview)) {
      throw new Error("Missing novel panel fixture");
    }
    firstReview.criticalDefect = true;
    firstReview.shipUnchanged = false;
    resealIndependentPopulation(candidate, novel);
    expect(independentMetric(candidate, "novel-batch-b")).toMatchObject({
      criticalCount: 1,
      inspectedCount: 80,
      panelResolvedCount: 79,
      panelSuccesses: 79,
      recognitionSuccesses: 79,
      requestedCount: 80,
      unresolvedCount: 1,
    });
  });

  it("suppresses every success numerator when independent evidence is invalid", () => {
    const candidate = report();
    const novel = candidate.independentReviewPopulations.find(
      ({ purpose }) => purpose === "novel-panel-a"
    );
    const selected = novel?.slots[0];
    const [review] = selected?.reviews ?? [];
    if (!(novel && selected && review)) {
      throw new Error("Missing novel panel fixture");
    }
    review.criticalDefect = true;
    review.shipUnchanged = true;
    resealIndependentPopulation(candidate, novel);
    expect(independentMetric(candidate, "novel-batch-a")).toMatchObject({
      craftObservedCount: 80,
      craftSuccesses: 0,
      evidenceValid: false,
      familyFitSuccesses: 0,
      nativeLegibilitySuccesses: 0,
      panelSuccesses: 0,
      recognitionSuccesses: 0,
      shipSuccesses: 0,
    });
    expect(
      independentMetric(candidate, "novel-batch-a").uncertainty.shipRate
    ).toEqual({ available: false, reason: "invalid-evidence" });
  });

  it("does not let an aggregate rate hide a failing independent stratum", () => {
    const candidate = report();
    const novel = candidate.independentReviewPopulations.find(
      ({ purpose }) => purpose === "novel-panel-a"
    );
    if (!novel) {
      throw new Error("Missing novel panel fixture");
    }
    const failingStratum = novel.slots.filter(({ slotId }) => {
      const expected = candidate.expectedSlots.find(
        (slot) => slot.slotId === slotId
      );
      return expected?.paint === "outlined" && expected.nativeSize === 16;
    });
    for (const selected of failingStratum.slice(0, 2)) {
      for (const review of selected.reviews) {
        review.nativeLegibility = false;
      }
    }
    resealIndependentPopulation(candidate, novel);
    expect(independentMetric(candidate, "novel-batch-a")).toMatchObject({
      nativeLegibilityRate: 0.975,
      nativeLegibilitySuccesses: 78,
      requestedCount: 80,
    });
    expect(
      independentMetric(candidate, "novel-batch-a/outlined-16")
    ).toMatchObject({
      nativeLegibilityRate: 0.9,
      nativeLegibilitySuccesses: 18,
      requestedCount: 20,
    });
    expect(validateAcceptanceReport(candidate).reasons).toContain(
      "Acceptance gate pass contradicts independent review evidence: nativeQuality/novel-batch-a/outlined-16"
    );
  });

  it("computes identical independent metrics regardless of row or reviewer order", () => {
    const candidate = report();
    const novel = candidate.independentReviewPopulations.find(
      ({ purpose }) => purpose === "novel-panel-b"
    );
    if (!novel) {
      throw new Error("Missing novel panel fixture");
    }
    const before = independentMetric(candidate, "novel-batch-b/outlined-24");
    novel.slots = novel.slots
      .toReversed()
      .map((slot) => ({ ...slot, reviews: slot.reviews.toReversed() }));
    resealIndependentPopulation(candidate, novel);
    const after = independentMetric(candidate, "novel-batch-b/outlined-24");
    expect(after).toEqual(before);
  });

  it("keeps critic, probability-audit, and novel-panel populations distinct", () => {
    const candidate = report();
    const catalogGate = candidate.gates.find(
      ({ dimension, scope }) =>
        dimension === "recognition" && scope === "catalog/outlined-16"
    );
    if (!catalogGate) {
      throw new Error("Missing catalog recognition gate");
    }
    expect(catalogGate.evidencePopulations).toEqual([
      "production-catalog-critic",
      "catalog-probability-audit",
    ]);
    expect(validateAcceptanceReport(candidate).reasons).toContain(
      "Computed independent review evidence is unavailable: recognition/catalog/outlined-16"
    );
  });

  it("makes uncertainty unavailable when its frozen method contract is invalid", () => {
    const candidate = report();
    candidate.uncertainty.method = "slot-bootstrap";
    const result = validateAcceptanceReport(candidate);
    expect(result.reasons).toContain(
      "Uncertainty method, seed and resampling count are required"
    );
    expect(
      result.independentReviewMetrics.every((metric) =>
        Object.values(metric.uncertainty).every(
          (diagnostic) => !diagnostic.available
        )
      )
    ).toBe(true);
  });

  it("fails closed instead of throwing when a gate omits its population routing", () => {
    const candidate = report();
    const [gate] = candidate.gates;
    if (!gate) {
      throw new Error("Missing gate fixture");
    }
    delete (gate as Partial<typeof gate>).evidencePopulations;
    expect(() => validateAcceptanceReport(candidate)).not.toThrow();
    expect(validateAcceptanceReport(candidate).reasons).toContain(
      `Acceptance gate uses the wrong review population: ${gate.dimension}/${gate.scope}`
    );
  });

  it.each([undefined, null, "catalog-probability-audit"])(
    "fails closed for malformed gate population routing: %s",
    (evidencePopulations) => {
      const candidate = report();
      const [gate] = candidate.gates;
      if (!gate) {
        throw new Error("Missing gate fixture");
      }
      Object.assign(gate, { evidencePopulations });
      expect(() => validateAcceptanceReport(candidate)).not.toThrow();
      expect(validateAcceptanceReport(candidate).reasons).toContain(
        `Acceptance gate uses the wrong review population: ${gate.dimension}/${gate.scope}`
      );
    }
  );

  it("requires an evidence population array even for gates with no review population", () => {
    const candidate = report();
    const gate = candidate.gates.find(
      ({ dimension }) => dimension === "geometry"
    );
    if (!gate) {
      throw new Error("Missing geometry gate");
    }
    delete (gate as Partial<typeof gate>).evidencePopulations;
    expect(validateAcceptanceReport(candidate).reasons).toContain(
      "Acceptance gate uses the wrong review population: geometry/every-output"
    );
  });

  it("fails closed when critic identity and production population are both malformed", () => {
    const candidate = report();
    candidate.reviewPopulations = candidate.reviewPopulations.filter(
      ({ purpose }) => purpose !== "production-catalog-critic"
    );
    const gate = candidate.gates.find(
      ({ dimension }) => dimension === "evaluation"
    );
    if (!gate) {
      throw new Error("Missing evaluation gate");
    }
    gate.computedCriticIdentity = {} as typeof gate.computedCriticIdentity;
    expect(() => validateAcceptanceReport(candidate)).not.toThrow();
    expect(validateAcceptanceReport(candidate).reasons).toContain(
      "Computed sealed evidence is unavailable: evaluation/sealed-critic-population"
    );
  });

  it("fails closed for null population rows and malformed gate scopes", () => {
    const candidate = report();
    candidate.reviewPopulations = [
      ...candidate.reviewPopulations,
      null,
    ] as unknown as AcceptanceReport["reviewPopulations"];
    const [gate] = candidate.gates;
    if (!gate) {
      throw new Error("Missing gate fixture");
    }
    Object.assign(gate, { scope: null });
    expect(() => validateAcceptanceReport(candidate)).not.toThrow();
    expect(validateAcceptanceReport(candidate).reasons).toEqual(
      expect.arrayContaining([
        "Independent review population identities are invalid or reused",
        "Unknown acceptance gate: craft/null",
      ])
    );
  });

  it("rejects malformed review population purpose and hash fields", () => {
    const candidate = report();
    const [population] = candidate.reviewPopulations;
    if (!population) {
      throw new Error("Missing population fixture");
    }
    Object.assign(population, {
      instrumentHash: null,
      manifestHash: 7,
      populationHash: {},
      purpose: "novel-panel-c",
    });
    expect(() => validateAcceptanceReport(candidate)).not.toThrow();
    expect(validateAcceptanceReport(candidate).reasons).toContain(
      "Independent review population identities are invalid or reused"
    );
  });

  it("binds the production critic population to the computed critic identity", () => {
    const candidate = report();
    const population = candidate.reviewPopulations.find(
      ({ purpose }) => purpose === "production-catalog-critic"
    );
    if (!population) {
      throw new Error("Missing production critic population fixture");
    }
    population.populationHash = hash("unrelated-production-review-set");
    withComputedProductionCriticQualification(
      collectorReceipt,
      (capability) => {
        expect(
          validateAcceptanceReport(candidate, {
            criticQualification: capability,
          }).reasons
        ).toContain(
          "Computed sealed evidence is unavailable: evaluation/sealed-critic-population"
        );
      }
    );
  });

  it("rejects critic evidence substituted for the catalog probability audit", () => {
    const candidate = report();
    const critic = candidate.reviewPopulations.find(
      ({ purpose }) => purpose === "production-catalog-critic"
    );
    const audit = candidate.reviewPopulations.find(
      ({ purpose }) => purpose === "catalog-probability-audit"
    );
    if (!(critic && audit)) {
      throw new Error("Missing review population fixtures");
    }
    audit.manifestHash = critic.manifestHash;
    audit.populationHash = critic.populationHash;
    expect(validateAcceptanceReport(candidate).reasons).toContain(
      "Independent review population identities are invalid or reused"
    );
  });

  it("rejects a novel panel substituted across batches", () => {
    const candidate = report();
    const gate = candidate.gates.find(
      ({ dimension, scope }) =>
        dimension === "generalization" && scope === "novel-batch-b"
    );
    if (!gate) {
      throw new Error("Missing novel B gate");
    }
    gate.evidencePopulations = ["novel-panel-a"];
    expect(validateAcceptanceReport(candidate).reasons).toContain(
      "Acceptance gate uses the wrong review population: generalization/novel-batch-b"
    );
  });

  it("rejects audit and novel population denominator dilution", () => {
    const candidate = report();
    const audit = candidate.reviewPopulations.find(
      ({ purpose }) => purpose === "catalog-probability-audit"
    );
    const novel = candidate.reviewPopulations.find(
      ({ purpose }) => purpose === "novel-panel-a"
    );
    if (!(audit && novel)) {
      throw new Error("Missing review population fixtures");
    }
    audit.requestedDenominator = 399;
    novel.requestedDenominator = 79;
    expect(validateAcceptanceReport(candidate).reasons).toContain(
      "Independent review population identities are invalid or reused"
    );
  });
  it("counts delivery denominators as concept-size pair requests", () => {
    const candidate = report();
    const gate = candidate.gates.find(
      (entry) =>
        entry.dimension === "delivery" && entry.scope === "novel-batch-a"
    );
    if (!gate) {
      throw new Error("Missing fixture delivery gate");
    }
    expect(gate.denominator).toBe(40);
    gate.denominator = 80;
    gate.successes = 80;
    expect(validateAcceptanceReport(candidate).envelopeValid).toBe(false);
  });
  it.each(["failed", "refused", "timed-out"] as const)(
    "retains an honest %s not-produced row in the requested denominator",
    (terminalState) => {
      const candidate = report();
      const [first] = candidate.outputs;
      if (!first) {
        throw new Error("Missing fixture output");
      }
      Object.assign(first, {
        artifactHash: null,
        authorProvenance: null,
        completedAt: null,
        craftRatings: [],
        criticalDefect: null,
        deliveryArtifactValid: null,
        deliveryState: terminalState,
        evidenceDisposition: "not-produced",
        exactReplay: null,
        familyFit: null,
        houseCraftComparisons: [],
        nativeLegibility: [],
        recognitionCorrect: null,
        reviewerAssessments: [],
        reviewerProvenance: [],
        shipUnchanged: null,
        terminalState,
      });
      const result = validateAcceptanceReport(candidate);
      expect(candidate.expectedSlots).toHaveLength(candidate.outputs.length);
      expect(result.reasons).not.toContain(
        `Invalid not-produced evidence: ${first.slotId}`
      );
      expect(result.reasons).not.toContain(
        `Missing output slot: ${first.slotId}`
      );
      expect(result.reasons).toContain(
        "Acceptance gate successes do not match output evidence: geometry/every-output"
      );
    }
  );

  it("binds retained incomplete bytes to both requested slots without inventing inspection", () => {
    const candidate = report();
    const requestId = candidate.expectedSlots[0]?.requestId ?? "";
    const binding = terminalBinding(candidate, requestId);
    const rows = candidate.outputs.filter((row) => row.requestId === requestId);
    for (const row of rows) {
      Object.assign(row, {
        authorProvenance: null,
        completedAt: null,
        craftRatings: [],
        criticalDefect: null,
        deliveryArtifactValid: null,
        deliveryState: "failed",
        evidenceDisposition: "produced-not-inspected",
        exactReplay: null,
        familyFit: null,
        houseCraftComparisons: [],
        nativeLegibility: [],
        recognitionCorrect: null,
        reviewerAssessments: [],
        reviewerProvenance: [],
        shipUnchanged: null,
        terminalState: "uncertain",
      });
    }
    const result = withComputedCampaignTerminalEvidence(
      [binding.expectation],
      () => [binding.terminal],
      (campaignTerminals) =>
        validateAcceptanceReport(candidate, { campaignTerminals })
    );
    expect(rows).toHaveLength(2);
    expect(result.reasons).not.toContain(
      `Campaign terminal evidence does not match request: ${requestId}`
    );
    expect(result.reasons).not.toContain(
      `Invalid produced-not-inspected evidence: ${rows[0]?.slotId}`
    );
  });

  it("binds replayed parent author evidence to both exact selected paints", () => {
    const candidate = report();
    const requestId = candidate.expectedSlots[0]?.requestId ?? "";
    const base = terminalBinding(candidate, requestId);
    const binding = terminalBinding(
      candidate,
      requestId,
      verifiedAuthorTerminal(base.terminal)
    );
    const { authorEvidence } = binding.terminal;
    const rows = candidate.outputs.filter((row) => row.requestId === requestId);
    if (!authorEvidence) {
      throw new Error("Missing verified author fixture");
    }
    for (const row of rows) {
      Object.assign(row, {
        authorProvenance: {
          artifactHash: row.artifactHash,
          authorId: authorEvidence.authorId,
          lineage: authorEvidence.authorLineage,
        },
        completedAt: null,
        craftRatings: [],
        criticalDefect: null,
        deliveryArtifactValid: null,
        deliveryState: "failed",
        evidenceDisposition: "produced-not-inspected",
        exactReplay: null,
        familyFit: null,
        houseCraftComparisons: [],
        nativeLegibility: [],
        recognitionCorrect: null,
        reviewerAssessments: [],
        reviewerProvenance: [],
        shipUnchanged: null,
        terminalState: "uncertain",
      });
    }
    const result = withComputedCampaignTerminalEvidence(
      [binding.expectation],
      () => [binding.terminal],
      (campaignTerminals) =>
        validateAcceptanceReport(candidate, { campaignTerminals })
    );
    expect(result.reasons).not.toContain(
      `Campaign terminal evidence does not match request: ${requestId}`
    );
    expect(result.reasons).not.toContain(
      `Invalid produced-not-inspected evidence: ${rows[0]?.slotId}`
    );
  });

  it("rejects verified author evidence with changed selected lineage bindings", () => {
    const candidate = report();
    const requestId = candidate.expectedSlots[0]?.requestId ?? "";
    const base = terminalBinding(candidate, requestId);
    const verified = verifiedAuthorTerminal(base.terminal);
    for (const mutate of [
      (terminal: AcceptanceCampaignTerminalReport) => {
        if (terminal.authorEvidence) {
          Object.assign(terminal.authorEvidence, {
            selectedTreeSha256: hash("wrong-tree"),
          });
        }
      },
      (terminal: AcceptanceCampaignTerminalReport) => {
        if (terminal.authorEvidence) {
          Object.assign(terminal.authorEvidence.paints.outlined, {
            programSha256: hash("wrong-program"),
          });
        }
      },
      (terminal: AcceptanceCampaignTerminalReport) => {
        if (terminal.authorEvidence) {
          Object.assign(terminal.authorEvidence.paints.filled, {
            proofSha256: hash("wrong-proof"),
          });
        }
      },
      (terminal: AcceptanceCampaignTerminalReport) => {
        if (terminal.authorEvidence) {
          Object.assign(terminal.authorEvidence.inspection, {
            stageDeadlineAt: terminal.authorEvidence.completionDeadlineAt + 1,
          });
        }
      },
      (terminal: AcceptanceCampaignTerminalReport) => {
        if (terminal.authorEvidence) {
          Object.assign(terminal.authorEvidence.inspection, {
            emittedModel: "different-model",
          });
        }
      },
      (terminal: AcceptanceCampaignTerminalReport) => {
        if (
          terminal.selectedEvidence.state === "retained-produced" &&
          terminal.selectedEvidence.artifacts
        ) {
          Object.assign(terminal.selectedEvidence, {
            artifacts: [
              ...terminal.selectedEvidence.artifacts,
              { name: "outlined.icon", sha256: hash("duplicate-program") },
            ],
          });
        }
      },
    ]) {
      const terminal = structuredClone(
        terminalBinding(candidate, requestId, verified).terminal
      );
      mutate(terminal);
      expect(() =>
        withComputedCampaignTerminalEvidence(
          [base.expectation],
          () => [terminal],
          () => null
        )
      ).toThrow("Campaign terminal evidence binding is invalid");
    }
  });

  it("rejects false author verification carrying evidence and exact output identity drift", () => {
    const candidate = report();
    const requestId = candidate.expectedSlots[0]?.requestId ?? "";
    const base = terminalBinding(candidate, requestId);
    const verified = terminalBinding(
      candidate,
      requestId,
      verifiedAuthorTerminal(base.terminal)
    );
    const falseWithEvidence = {
      ...verified.terminal,
      authorEvidenceVerified: false,
    } satisfies AcceptanceCampaignTerminalReport;
    expect(() =>
      withComputedCampaignTerminalEvidence(
        [verified.expectation],
        () => [falseWithEvidence],
        () => null
      )
    ).toThrow("Campaign terminal evidence binding is invalid");

    const { authorEvidence } = verified.terminal;
    const rows = candidate.outputs.filter((row) => row.requestId === requestId);
    if (!authorEvidence) {
      throw new Error("Missing verified author fixture");
    }
    for (const row of rows) {
      Object.assign(row, {
        authorProvenance: {
          artifactHash: row.artifactHash,
          authorId: `${authorEvidence.authorId}-wrong`,
          lineage: authorEvidence.authorLineage,
        },
        completedAt: null,
        craftRatings: [],
        criticalDefect: null,
        deliveryArtifactValid: null,
        deliveryState: "failed",
        evidenceDisposition: "produced-not-inspected",
        exactReplay: null,
        familyFit: null,
        houseCraftComparisons: [],
        nativeLegibility: [],
        recognitionCorrect: null,
        reviewerAssessments: [],
        reviewerProvenance: [],
        shipUnchanged: null,
        terminalState: "uncertain",
      });
    }
    const result = withComputedCampaignTerminalEvidence(
      [verified.expectation],
      () => [verified.terminal],
      (campaignTerminals) =>
        validateAcceptanceReport(candidate, { campaignTerminals })
    );
    expect(result.reasons).toContain(
      `Campaign terminal evidence does not match request: ${requestId}`
    );
  });

  it("retains an unstarted pair with null intent and deadline in every denominator", () => {
    const candidate = report();
    const requestId = candidate.expectedSlots[0]?.requestId ?? "";
    const slots = candidate.expectedSlots.filter(
      (slot) => slot.requestId === requestId
    );
    for (const slot of slots) {
      slot.originalDeadlineAt = null;
      slot.requestIntentHash = null;
      const row = candidate.outputs.find(
        ({ slotId }) => slotId === slot.slotId
      );
      if (!row) {
        throw new Error("Missing terminal fixture output");
      }
      Object.assign(row, {
        artifactHash: null,
        authorProvenance: null,
        completedAt: null,
        craftRatings: [],
        criticalDefect: null,
        deliveryArtifactValid: null,
        deliveryState: "unstarted",
        evidenceDisposition: "unstarted",
        exactReplay: null,
        familyFit: null,
        houseCraftComparisons: [],
        nativeLegibility: [],
        originalDeadlineAt: null,
        recognitionCorrect: null,
        requestIntentHash: null,
        reviewerAssessments: [],
        reviewerProvenance: [],
        shipUnchanged: null,
        terminalState: "unstarted",
      });
    }
    const binding = terminalBinding(candidate, requestId, {
      deadlineAt: null,
      disposition: "unstarted",
      requestIntentHash: null,
      selectedEvidence: { state: "verified-absent" },
      terminalStatus: "unstarted",
    });
    const result = withComputedCampaignTerminalEvidence(
      [binding.expectation],
      () => [binding.terminal],
      (campaignTerminals) =>
        validateAcceptanceReport(candidate, { campaignTerminals })
    );
    expect(candidate.outputs).toHaveLength(candidate.expectedSlots.length);
    expect(result.reasons).not.toContain(
      `Campaign terminal evidence does not match request: ${requestId}`
    );
    expect(
      candidate.gates.find(
        ({ dimension, scope }) =>
          dimension === "recognition" && scope === "catalog/outlined-16"
      )?.denominator
    ).toBe(2221);
  });

  it("rejects a wrong but valid selected hash and an escaped capability", () => {
    const candidate = report();
    const requestId = candidate.expectedSlots[0]?.requestId ?? "";
    const binding = terminalBinding(candidate, requestId);
    const outlined = candidate.outputs.find(
      (row) => row.requestId === requestId && row.paint === "outlined"
    );
    if (!outlined) {
      throw new Error("Missing terminal fixture output");
    }
    outlined.artifactHash = hash("wrong-selected-output");
    let escaped: Parameters<
      typeof validateAcceptanceReport
    >[1]["campaignTerminals"];
    const active = withComputedCampaignTerminalEvidence(
      [binding.expectation],
      () => [binding.terminal],
      (campaignTerminals) => {
        escaped = campaignTerminals;
        return validateAcceptanceReport(candidate, { campaignTerminals });
      }
    );
    expect(active.reasons).toContain(
      `Campaign terminal evidence does not match request: ${requestId}`
    );
    expect(
      validateAcceptanceReport(candidate, { campaignTerminals: escaped })
        .reasons
    ).toContain(
      "Campaign terminal evidence is not active process-local authority"
    );
  });

  it("keeps refused production unknown and rejects a different valid intent hash", () => {
    const candidate = report();
    const requestId = candidate.expectedSlots[0]?.requestId ?? "";
    const binding = terminalBinding(candidate, requestId, {
      disposition: "production-unknown",
      selectedEvidence: { state: "verified-absent" },
      terminalStatus: "refused",
    });
    const rows = candidate.outputs.filter((row) => row.requestId === requestId);
    for (const row of rows) {
      Object.assign(row, {
        artifactHash: null,
        authorProvenance: null,
        completedAt: null,
        craftRatings: [],
        criticalDefect: null,
        deliveryArtifactValid: null,
        deliveryState: "refused",
        evidenceDisposition: "production-unknown",
        exactReplay: null,
        familyFit: null,
        houseCraftComparisons: [],
        nativeLegibility: [],
        recognitionCorrect: null,
        reviewerAssessments: [],
        reviewerProvenance: [],
        shipUnchanged: null,
        terminalState: "refused",
      });
    }
    const [first] = rows;
    if (!first) {
      throw new Error("Missing terminal fixture output");
    }
    first.requestIntentHash = hash("different-valid-intent");
    const result = withComputedCampaignTerminalEvidence(
      [binding.expectation],
      () => [binding.terminal],
      (campaignTerminals) =>
        validateAcceptanceReport(candidate, { campaignTerminals })
    );
    expect(rows).toHaveLength(2);
    expect(result.reasons).toContain(
      `Campaign terminal evidence does not match request: ${requestId}`
    );
    expect(result.reasons).not.toContain(
      `Campaign terminal disposition lacks trusted evidence: ${rows[1]?.slotId}`
    );
  });

  it("retains a delivered but uninspected artifact without fabricating reviews", () => {
    const candidate = report();
    const [first] = candidate.outputs;
    if (!first) {
      throw new Error("Missing fixture output");
    }
    Object.assign(first, {
      craftRatings: [],
      criticalDefect: null,
      evidenceDisposition: "produced-not-inspected",
      familyFit: null,
      houseCraftComparisons: [],
      nativeLegibility: [],
      recognitionCorrect: null,
      reviewerAssessments: [],
      reviewerProvenance: [],
      shipUnchanged: null,
      terminalState: "uncertain",
    });
    const result = validateAcceptanceReport(candidate);
    expect(candidate.expectedSlots).toHaveLength(candidate.outputs.length);
    expect(result.reasons).not.toContain(
      `Invalid produced-not-inspected evidence: ${first.slotId}`
    );
    expect(result.reasons).not.toContain(
      `Invalid reviewer assessment evidence: ${first.slotId}`
    );
    expect(result.reasons).not.toContain(
      `Invalid independent artifact provenance: ${first.slotId}`
    );
    expect(result.reasons).toContain(
      "Acceptance gate successes do not match output evidence: geometry/every-output"
    );
  });

  it("refuses to disguise an accepted artifact as uninspected", () => {
    const candidate = report();
    const [first] = candidate.outputs;
    if (!first) {
      throw new Error("Missing fixture output");
    }
    Object.assign(first, {
      craftRatings: [],
      criticalDefect: null,
      evidenceDisposition: "produced-not-inspected",
      familyFit: null,
      houseCraftComparisons: [],
      nativeLegibility: [],
      recognitionCorrect: null,
      reviewerAssessments: [],
      reviewerProvenance: [],
      shipUnchanged: null,
    });
    expect(validateAcceptanceReport(candidate).reasons).toContain(
      `Invalid produced-not-inspected evidence: ${first.slotId}`
    );
  });

  it("quarantines any critical allegation even when reviewers disagree", () => {
    const candidate = report();
    const [first] = candidate.outputs;
    if (!first?.reviewerAssessments[0]) {
      throw new Error("Missing fixture reviewer assessment");
    }
    first.reviewerAssessments[0].criticalDefect = true;
    first.criticalDefect = true;
    first.shipUnchanged = false;
    first.reviewerAssessments = first.reviewerAssessments.map((assessment) => ({
      ...assessment,
      shipUnchanged: false,
    }));
    first.terminalState = "uncertain";
    const result = validateAcceptanceReport(candidate);
    expect(result.reasons).not.toContain(
      `Aggregate reviewer labels do not match assessments: ${first.slotId}`
    );
    expect(result.reasons).not.toContain(
      `Critical-defect and ship conflict: ${first.slotId}`
    );

    first.criticalDefect = false;
    expect(validateAcceptanceReport(candidate).reasons).toContain(
      `Aggregate reviewer labels do not match assessments: ${first.slotId}`
    );
  });

  it("preserves null aggregate labels when inspected reviewers disagree", () => {
    const candidate = report();
    const [first] = candidate.outputs;
    if (!first?.reviewerAssessments[0]) {
      throw new Error("Missing fixture reviewer assessment");
    }
    first.reviewerAssessments[0] = {
      ...first.reviewerAssessments[0],
      familyFit: false,
      recognitionCorrect: null,
      shipUnchanged: false,
    };
    first.familyFit = null;
    first.recognitionCorrect = null;
    first.shipUnchanged = null;
    first.terminalState = "uncertain";
    const result = validateAcceptanceReport(candidate);
    expect(result.reasons).not.toContain(
      `Missing or invalid acceptance labels: ${first.slotId}`
    );
    expect(result.reasons).not.toContain(
      `Aggregate reviewer labels do not match assessments: ${first.slotId}`
    );
    expect(result.qualification).toBe(false);
  });

  it.each(["failed", "refused", "timed-out", "uncertain"] as const)(
    "does not count %s outputs as successes despite positive diagnostic labels",
    (terminalState) => {
      const candidate = report();
      const [first] = candidate.outputs;
      if (!first) {
        throw new Error("Missing fixture output");
      }
      first.terminalState = terminalState;
      const result = validateAcceptanceReport(candidate);
      expect(result.envelopeValid).toBe(false);
      expect(
        result.reasons.some((reason) =>
          reason.includes("successes do not match")
        )
      ).toBe(true);
      expect(result.qualification).toBe(false);
    }
  );
  it("records proposed score anchors, pairing and evaluation population", () => {
    expect(DRAFT_ACCEPTANCE_CONTRACT).toMatchObject({
      calibration: {
        craftScale: { maximum: 10, minimum: 1 },
        rawScoresOnly: true,
        status: "proposed-unvalidated",
      },
      pairing: {
        nativeSizes: [16, 24],
        paints: ["outlined", "filled"],
        selfReviewCountsAsIndependent: false,
      },
      status: "draft-unqualified",
    });
  });

  it("keeps a complete identity-bound population unqualified without computed sealed evidence", () => {
    const result = validateAcceptanceReport(report());
    expect(result.envelopeValid).toBe(false);
    expect(result.qualification).toBe(false);
    expect(result.reasons).toEqual(
      expect.arrayContaining([
        "Computed sealed evidence is unavailable: evaluation/sealed-critic-population",
        "Computed sealed evidence is unavailable: generalization/novel-batch-a",
        "Computed sealed evidence is unavailable: generalization/novel-batch-b",
        "Computed sealed evidence is unavailable: repair/sealed-repair-population",
      ])
    );
  });

  it("keeps qualification-only critic identity unavailable for production review", () => {
    withComputedProductionCriticQualification(
      collectorReceipt,
      (capability) => {
        const result = validateAcceptanceReport(report(), {
          criticQualification: capability,
        });
        expect(result.reasons).toContain(
          "Computed sealed evidence is unavailable: evaluation/sealed-critic-population"
        );
        expect(result.reasons).toEqual(
          expect.arrayContaining([
            "Computed sealed evidence is unavailable: generalization/novel-batch-a",
            "Computed sealed evidence is unavailable: generalization/novel-batch-b",
            "Computed sealed evidence is unavailable: repair/sealed-repair-population",
          ])
        );
        expect(result.qualification).toBe(false);
      }
    );
  });

  it.each([
    ["instrument version", "qualificationVersionHash"],
    ["metrics", "metricsHash"],
    ["route or population manifest", "evidenceManifestHash"],
  ] as const)(
    "does not graft a qualified critic onto a different %s identity",
    (_name, field) => {
      const candidate = report();
      const gate = candidate.gates.find(
        ({ dimension }) => dimension === "evaluation"
      );
      if (!gate?.computedCriticIdentity) {
        throw new Error("Missing evaluation critic identity fixture");
      }
      gate.computedCriticIdentity = {
        ...gate.computedCriticIdentity,
        [field]: hash(`unrelated-${field}`),
      };
      withComputedProductionCriticQualification(
        collectorReceipt,
        (capability) => {
          expect(
            validateAcceptanceReport(candidate, {
              criticQualification: capability,
            }).reasons
          ).toContain(
            "Computed sealed evidence is unavailable: evaluation/sealed-critic-population"
          );
        }
      );
    }
  );

  it("ignores a fully self-consistent serialized critic receipt embedded in the report", () => {
    const forged = Object.assign(report(), {
      computedEvidence: {
        criticQualification: collectorReceipt(),
      },
    });
    expect(validateAcceptanceReport(forged).reasons).toContain(
      "Computed sealed evidence is unavailable: evaluation/sealed-critic-population"
    );
  });

  it("binds catalog evidence to the frozen exact 8884-slot census", () => {
    const candidate = report();
    expect(hashAcceptanceCatalogSlotCensus(candidate.expectedSlots)).toBe(
      FROZEN_CATALOG_SLOT_CENSUS_HASH
    );

    candidate.expectedSlots = candidate.expectedSlots.map((slot) =>
      slot.population === "catalog" && slot.conceptId === "add-image"
        ? {
            ...slot,
            canonicalSlotId: slot.canonicalSlotId.replace(
              "add-image/add-image",
              "add-image-substitution/add-image-substitution"
            ),
            conceptId: "add-image-substitution",
            familyId: "add-image-substitution",
            requestId: slot.requestId.replace(
              "add-image/add-image",
              "add-image-substitution/add-image-substitution"
            ),
            requestIntentHash: hash(`substituted/${slot.requestId}`),
            slotId: slot.slotId.replace(
              "add-image/add-image",
              "add-image-substitution/add-image-substitution"
            ),
          }
        : slot
    );
    candidate.outputs = candidate.expectedSlots.map(output);
    candidate.catalogSlotManifestHash = hashAcceptanceCatalogSlotCensus(
      candidate.expectedSlots
    );
    expect(validateAcceptanceReport(candidate).reasons).toContain(
      "Catalog slot census identity does not match the frozen manifest"
    );
  });

  it("rejects an underfilled catalog even when the caller rehashes it", () => {
    const candidate = report();
    candidate.expectedSlots = candidate.expectedSlots.filter(
      ({ conceptId }) => conceptId !== "add-image"
    );
    candidate.outputs = candidate.outputs.filter(
      ({ conceptId }) => conceptId !== "add-image"
    );
    candidate.catalogSlotManifestHash = hashAcceptanceCatalogSlotCensus(
      candidate.expectedSlots
    );
    expect(validateAcceptanceReport(candidate).reasons).toEqual(
      expect.arrayContaining([
        "Catalog population must match the frozen 2221-concept, 8884-slot census",
        "Catalog slot census identity does not match the frozen manifest",
      ])
    );
  });

  it("rejects caller-true critic, repair and generalization claims without computed receipts", () => {
    const result = validateAcceptanceReport(report());
    expect(result.reasons).toEqual(
      expect.arrayContaining([
        "Computed sealed evidence is unavailable: evaluation/sealed-critic-population",
        "Computed sealed evidence is unavailable: repair/sealed-repair-population",
        "Computed sealed evidence is unavailable: generalization/novel-batch-a",
        "Computed sealed evidence is unavailable: generalization/novel-batch-b",
      ])
    );
    expect(result.envelopeValid).toBe(false);
  });

  it("rejects an author and reviewer that share an artifact lineage", () => {
    const candidate = report();
    const [target] = candidate.outputs;
    if (!(target?.authorProvenance && target.reviewerProvenance?.[0])) {
      throw new Error("Missing provenance fixture");
    }
    target.reviewerProvenance[0].lineage = target.authorProvenance.lineage;
    expect(validateAcceptanceReport(candidate).reasons).toContain(
      `Invalid independent artifact provenance: ${target.slotId}`
    );
  });

  it("rejects reviewer provenance for another artifact or an unbound reviewer", () => {
    const candidate = report();
    const [target] = candidate.outputs;
    if (!target?.reviewerProvenance?.[0]) {
      throw new Error("Missing provenance fixture");
    }
    target.reviewerProvenance[0].artifactHash = hash("other-artifact");
    target.houseCraftComparisons = target.houseCraftComparisons.map(
      (comparison, index) =>
        index === 0
          ? { ...comparison, reviewerId: "unbound-reviewer" }
          : comparison
    );
    expect(validateAcceptanceReport(candidate).reasons).toContain(
      `Invalid independent artifact provenance: ${target.slotId}`
    );
  });

  it("rejects an output whose identity differs from its expected slot", () => {
    const mismatched = report();
    mismatched.outputs[0] = {
      ...mismatched.outputs[0],
      familyId: "substituted-family",
    };
    expect(validateAcceptanceReport(mismatched).reasons).toContain(
      "Output identity does not match expected slot: catalog/add-image/add-image/16/outlined"
    );
  });

  it("rejects duplicate family-paint-size identities in a novel batch", () => {
    const duplicated = report();
    duplicated.expectedSlots = duplicated.expectedSlots.map((slot) =>
      slot.slotId === "novel-batch-a/novel-a-2/16/outlined"
        ? { ...slot, familyId: "novel-a-1" }
        : slot
    );
    expect(validateAcceptanceReport(duplicated).reasons).toContain(
      "Novel population must contain 20 families and 80 unique slots: novel-batch-a"
    );
  });

  it("rejects missing paint-size counterparts", () => {
    const missing = report();
    missing.expectedSlots = missing.expectedSlots.filter(
      ({ slotId }) => slotId !== "catalog/add-image/add-image/24/filled"
    );
    missing.outputs = missing.outputs.filter(
      ({ slotId }) => slotId !== "catalog/add-image/add-image/24/filled"
    );
    expect(validateAcceptanceReport(missing).reasons).toEqual(
      expect.arrayContaining([
        "Missing or duplicate paired slots: catalog/add-image/add-image/24",
        "Missing or inconsistent concept-size counterparts: catalog/add-image/add-image",
      ])
    );
  });

  it("rejects a request identity reused across native sizes", () => {
    const mixed = report();
    mixed.expectedSlots = mixed.expectedSlots.map((slot) =>
      slot.population === "catalog" &&
      slot.conceptId === "add-image" &&
      slot.nativeSize === 24
        ? { ...slot, requestId: "add-image/add-image/16" }
        : slot
    );
    expect(validateAcceptanceReport(mixed).reasons).toContain(
      "Missing or duplicate paired slots: catalog/add-image/add-image/16"
    );
  });

  it("rejects partial alias reuse across concept-size counterparts", () => {
    const partial = report();
    const aliasSlots = quartet(
      "catalog",
      "directory-lock",
      "folder-family"
    ).map((slot, index) => ({
      ...slot,
      canonicalSlotId:
        index === 0
          ? slot.slotId
          : `catalog/add-image/add-image/${slot.nativeSize}/${slot.paint}`,
    }));
    partial.expectedSlots = [...partial.expectedSlots, ...aliasSlots];
    partial.outputs = [...partial.outputs, ...aliasSlots.map(output)];
    expect(validateAcceptanceReport(partial).reasons).toContain(
      "Missing or inconsistent concept-size counterparts: catalog/folder-family/directory-lock"
    );
  });

  it("rejects an underfilled novel population", () => {
    const underfilled = report();
    underfilled.expectedSlots = underfilled.expectedSlots.filter(
      ({ conceptId }) => conceptId !== "novel-a-20"
    );
    underfilled.outputs = underfilled.outputs.filter(
      ({ conceptId }) => conceptId !== "novel-a-20"
    );
    expect(validateAcceptanceReport(underfilled).reasons).toContain(
      "Novel population must contain 20 families and 80 unique slots: novel-batch-a"
    );
  });

  it("rejects a novel population with more than 20 families and 80 slots", () => {
    const overfilled = report();
    const extra = quartet("novel-batch-b", "novel-b-21");
    overfilled.expectedSlots = [...overfilled.expectedSlots, ...extra];
    overfilled.outputs = [...overfilled.outputs, ...extra.map(output)];
    expect(validateAcceptanceReport(overfilled).reasons).toContain(
      "Novel population must contain 20 families and 80 unique slots: novel-batch-b"
    );
  });

  it("rejects overlapping novel family populations", () => {
    const overlapping = report();
    overlapping.expectedSlots = overlapping.expectedSlots.map((slot) =>
      slot.population === "novel-batch-b" && slot.conceptId === "novel-b-1"
        ? { ...slot, familyId: "novel-a-1" }
        : slot
    );
    expect(validateAcceptanceReport(overlapping).reasons).toContain(
      "Novel batch families must be disjoint"
    );
  });

  it("keeps catalog aliases as distinct slots with explicit reuse", () => {
    const aliases = report();
    const aliasSlots = quartet(
      "catalog",
      "directory-lock",
      "folder-family"
    ).map((slot) => ({
      ...slot,
      canonicalSlotId: `catalog/add-image/add-image/${slot.nativeSize}/${slot.paint}`,
    }));
    aliases.expectedSlots = [...aliases.expectedSlots, ...aliasSlots];
    aliases.outputs = [...aliases.outputs, ...aliasSlots.map(output)];
    for (const gate of aliases.gates) {
      const scoped = scopedSlots(aliases.expectedSlots, gate.scope);
      const count =
        gate.dimension === "delivery"
          ? new Set(scoped.map(({ requestId }) => requestId)).size
          : scoped.length;
      if (count > 0) {
        gate.denominator = count;
        gate.successes = count;
      }
    }
    expect(validateAcceptanceReport(aliases)).toMatchObject({
      envelopeValid: false,
      qualification: false,
    });
  });

  it("rejects a gate denominator that dilutes its expected stratum", () => {
    const diluted = report();
    const gate = diluted.gates.find(
      ({ dimension, scope }) =>
        dimension === "recognition" && scope === "novel-batch-a/outlined-16"
    );
    if (!gate) {
      throw new Error("missing fixture gate");
    }
    gate.denominator += 1;
    gate.successes += 1;
    expect(validateAcceptanceReport(diluted).reasons).toContain(
      "Acceptance gate denominator does not match expected slots: recognition/novel-batch-a/outlined-16"
    );
  });

  it("rejects a passing boolean when successes contradict output evidence", () => {
    const forged = report();
    const targets = forged.outputs.filter(
      ({ nativeSize, paint, population }) =>
        population === "novel-batch-a" &&
        paint === "outlined" &&
        nativeSize === 16
    );
    for (const target of targets.slice(0, 2)) {
      target.recognitionCorrect = false;
    }
    const gate = forged.gates.find(
      ({ dimension, scope }) =>
        dimension === "recognition" && scope === "novel-batch-a/outlined-16"
    );
    if (!gate) {
      throw new Error("missing fixture gate");
    }
    gate.successes = 18;
    expect(validateAcceptanceReport(forged).reasons).toContain(
      "Acceptance gate pass contradicts threshold: recognition/novel-batch-a/outlined-16"
    );
  });

  it("rejects anonymous craft votes that are absent from reviewer evidence", () => {
    const candidate = report();
    const [target] = candidate.outputs;
    if (!target) {
      throw new Error("Missing reviewer-assessment fixture output");
    }
    target.craftRatings = [10, 10, 10, 10];
    expect(validateAcceptanceReport(candidate).reasons).toContain(
      "Craft ratings do not match reviewer assessments: catalog/add-image/add-image/16/outlined"
    );
  });

  it.each([undefined, null, "9,10", { 0: 9, 1: 10 }])(
    "rejects malformed craft ratings without throwing: %j",
    (craftRatings) => {
      const candidate = report();
      const [target] = candidate.outputs;
      if (!target) {
        throw new Error("Missing reviewer-assessment fixture output");
      }
      (target as { craftRatings: unknown }).craftRatings = craftRatings;
      const validation = validateAcceptanceReport(candidate);
      expect(validation.reasons).toContain(
        "Craft ratings do not match reviewer assessments: catalog/add-image/add-image/16/outlined"
      );
    }
  );

  it("rejects aggregate labels that contradict reviewer assessments", () => {
    const candidate = report();
    const [target] = candidate.outputs;
    if (!target?.reviewerAssessments[0]) {
      throw new Error("Missing reviewer-assessment fixture output");
    }
    target.reviewerAssessments[0].recognitionCorrect = false;
    expect(validateAcceptanceReport(candidate).reasons).toContain(
      "Aggregate reviewer labels do not match assessments: catalog/add-image/add-image/16/outlined"
    );
  });

  it("rejects copied reviewer identities and result evidence", () => {
    const candidate = report();
    const [target] = candidate.outputs;
    const [first, second] = target?.reviewerAssessments ?? [];
    if (!(target && first && second)) {
      throw new Error("Missing reviewer-assessment fixture output");
    }
    target.reviewerAssessments = [
      first,
      {
        ...second,
        reviewEvidenceHash: first.reviewEvidenceHash,
        reviewerId: first.reviewerId,
      },
    ];
    expect(validateAcceptanceReport(candidate).reasons).toContain(
      "Invalid reviewer assessment evidence: catalog/add-image/add-image/16/outlined"
    );
  });

  it.each(["artifact", "receipt"] as const)(
    "rejects reviewer assessment %s substitution",
    (field) => {
      const candidate = report();
      const [target] = candidate.outputs;
      const [first, second] = target?.reviewerAssessments ?? [];
      if (!(target && first && second)) {
        throw new Error("Missing reviewer-assessment fixture output");
      }
      target.reviewerAssessments = [
        {
          ...first,
          ...(field === "artifact"
            ? { artifactHash: hash("other-artifact") }
            : { reviewEvidenceHash: hash("different-review-result") }),
        },
        second,
      ];
      expect(validateAcceptanceReport(candidate).reasons).toContain(
        "Invalid reviewer assessment evidence: catalog/add-image/add-image/16/outlined"
      );
    }
  );

  it("computes paired reviewer craft differences before the family median", () => {
    const candidate = report();
    const aliases = ["directory-lock", "archive-lock"].flatMap((conceptId) =>
      quartet("catalog", conceptId, "folder-family").map((slot) => ({
        ...slot,
        canonicalSlotId: `catalog/add-image/add-image/${slot.nativeSize}/${slot.paint}`,
      }))
    );
    const otherFamily = quartet("catalog", "cloud-upload", "cloud-family");
    candidate.expectedSlots = [
      ...candidate.expectedSlots,
      ...aliases,
      ...otherFamily,
    ];
    candidate.outputs = [
      ...candidate.outputs,
      ...aliases.map(output),
      ...otherFamily.map(output),
    ];
    for (const item of candidate.outputs.filter(
      ({ population }) => population === "catalog"
    )) {
      const delta = item.familyId === "folder-family" ? -1 : 1;
      item.houseCraftComparisons = item.houseCraftComparisons.map(
        (comparison) => ({
          ...comparison,
          candidateCraft:
            item.familyId === "folder-family"
              ? comparison.referenceCraft + delta
              : 10,
          referenceCraft:
            item.familyId === "folder-family" ? comparison.referenceCraft : 9,
        })
      );
    }
    for (const gate of candidate.gates) {
      const scoped = scopedSlots(candidate.expectedSlots, gate.scope);
      const count =
        gate.dimension === "delivery"
          ? new Set(scoped.map(({ requestId }) => requestId)).size
          : scoped.length;
      if (count > 0) {
        gate.denominator = count;
        gate.successes = count;
      }
    }
    expect(validateAcceptanceReport(candidate)).toMatchObject({
      envelopeValid: false,
      qualification: false,
    });
  });

  it("rejects caller-true house parity when the family craft median is low", () => {
    const candidate = report();
    for (const item of candidate.outputs.filter(
      ({ population }) => population === "novel-batch-a"
    )) {
      item.houseCraftComparisons = item.houseCraftComparisons.map(
        (comparison, index) => ({
          ...comparison,
          candidateCraft: index === 0 ? 8 : 9,
          referenceCraft: index === 0 ? 10 : 9,
        })
      );
    }
    expect(validateAcceptanceReport(candidate).reasons).toContain(
      "Acceptance gate pass contradicts threshold: houseParity/novel-batch-a/outlined-16"
    );
  });

  it("rejects duplicated or missing paired-reviewer craft evidence", () => {
    const candidate = report();
    const [first, second] = candidate.outputs[0]?.houseCraftComparisons ?? [];
    if (!(first && second && candidate.outputs[0])) {
      throw new Error("Missing paired-reviewer fixture evidence");
    }
    candidate.outputs[0].houseCraftComparisons = [
      first,
      { ...second, reviewerId: first.reviewerId },
    ];
    expect(validateAcceptanceReport(candidate).reasons).toContain(
      "Missing or invalid acceptance labels: catalog/add-image/add-image/16/outlined"
    );

    const missing = report();
    if (!missing.outputs[0]) {
      throw new Error("Missing paired-reviewer fixture output");
    }
    missing.outputs[0].houseCraftComparisons = [];
    expect(validateAcceptanceReport(missing).reasons).toContain(
      "Missing or invalid acceptance labels: catalog/add-image/add-image/16/outlined"
    );
  });

  it("rejects parity reviewers shown different references or protocols", () => {
    const candidate = report();
    const [target] = candidate.outputs;
    if (!target) {
      throw new Error("Missing house parity identity fixture output");
    }
    target.houseCraftComparisons = target.houseCraftComparisons.map(
      (comparison, index) =>
        index === 0
          ? comparison
          : {
              ...comparison,
              presentationProtocolHash: hash("changed-parity-protocol"),
              referenceArtifactHash: hash("different-house-reference"),
            }
    );
    expect(validateAcceptanceReport(candidate).reasons).toEqual(
      expect.arrayContaining([
        "House parity presentation protocol identity is inconsistent",
        "Missing or invalid acceptance labels: catalog/add-image/add-image/16/outlined",
      ])
    );
  });

  it.each(["missing", "illegible"] as const)(
    "requires independent light and dark native evidence: %s dark surface",
    (failure) => {
      const candidate = report();
      const [target] = candidate.outputs;
      if (!target) {
        throw new Error("Missing native-surface fixture output");
      }
      target.nativeLegibility =
        failure === "missing"
          ? target.nativeLegibility.filter(({ surface }) => surface === "light")
          : target.nativeLegibility.map((observation) =>
              observation.surface === "dark"
                ? { ...observation, legible: false }
                : observation
            );
      const { reasons } = validateAcceptanceReport(candidate);
      expect(reasons).toEqual(
        expect.arrayContaining([
          "Acceptance gate successes do not match output evidence: nativeQuality/catalog/outlined-16",
        ])
      );
      expect(
        reasons.includes(
          "Missing or invalid acceptance labels: catalog/add-image/add-image/16/outlined"
        )
      ).toBe(failure === "missing");
    }
  );

  it.each(["light", "dark", "both"] as const)(
    "rejects native observations copied from another artifact: %s",
    (surface) => {
      const candidate = report();
      const [target] = candidate.outputs;
      if (!target) {
        throw new Error("Missing native-artifact fixture output");
      }
      target.nativeLegibility = target.nativeLegibility.map((observation) =>
        surface === "both" || observation.surface === surface
          ? { ...observation, sourceArtifactHash: hash("different-artifact") }
          : observation
      );
      expect(validateAcceptanceReport(candidate).reasons).toContain(
        "Native evidence source does not match output: catalog/add-image/add-image/16/outlined"
      );
    }
  );

  it.each([false, null] as const)(
    "requires exact replay for every accepted output: %s",
    (exactReplay) => {
      const candidate = report();
      const target = candidate.outputs.find(
        ({ slotId }) => slotId === "novel-batch-b/novel-b-1/24/filled"
      );
      if (!target) {
        throw new Error("Missing exact-replay fixture output");
      }
      target.exactReplay = exactReplay;
      expect(validateAcceptanceReport(candidate).reasons).toEqual(
        expect.arrayContaining([
          "Accepted terminal lacks exact replay: novel-batch-b/novel-b-1/24/filled",
          "Acceptance gate successes do not match output evidence: geometry/every-output",
          "Acceptance gate pass contradicts threshold: geometry/every-output",
        ])
      );
    }
  );

  it("does not let a pooled mean hide a low output-median population median", () => {
    const forged = report();
    const scoped = forged.outputs.filter(
      (candidate) =>
        candidate.population === "novel-batch-a" &&
        candidate.paint === "outlined" &&
        candidate.nativeSize === 16
    );
    for (const [index, candidate] of scoped.entries()) {
      candidate.craftRatings =
        index < 11 ? [8] : [10, 10, 10, 10, 10, 10, 10, 10, 10, 10];
      const assessmentTemplates = candidate.reviewerAssessments;
      candidate.reviewerAssessments = candidate.craftRatings.map(
        (craftRating, reviewerIndex) => {
          const template =
            assessmentTemplates[reviewerIndex % assessmentTemplates.length];
          if (!template) {
            throw new Error("Missing pooled-score assessment template");
          }
          return {
            ...template,
            craftRating,
            reviewEvidenceHash: hash(
              `pooled/${candidate.slotId}/${reviewerIndex}`
            ),
            reviewerId: `pooled-reviewer-${reviewerIndex}`,
          };
        }
      );
      candidate.reviewerProvenance = candidate.reviewerAssessments.map(
        ({ artifactHash, reviewEvidenceHash, reviewerId }, reviewerIndex) => ({
          artifactHash,
          lineage: `pooled-lineage-${reviewerIndex}`,
          reviewEvidenceHash,
          reviewerId,
        })
      );
    }
    const pooledMean =
      scoped
        .flatMap(({ craftRatings }) => craftRatings)
        .reduce((sum, rating) => sum + rating, 0) /
      scoped.flatMap(({ craftRatings }) => craftRatings).length;
    expect(pooledMean).toBeGreaterThan(9);
    expect(validateAcceptanceReport(forged).reasons).toContain(
      "Acceptance gate pass contradicts threshold: craft/novel-batch-a/outlined-16"
    );
  });

  it.each(["failed", "missing"] as const)(
    "does not count a pair with one %s paint as delivered",
    (failure) => {
      const candidate = report();
      const targetSlotId = "novel-batch-a/novel-a-1/16/filled";
      if (failure === "missing") {
        candidate.outputs = candidate.outputs.filter(
          ({ slotId }) => slotId !== targetSlotId
        );
      } else {
        const target = candidate.outputs.find(
          ({ slotId }) => slotId === targetSlotId
        );
        if (!target) {
          throw new Error("Missing delivery failure fixture output");
        }
        target.artifactHash = null;
        target.completedAt = null;
        target.deliveryArtifactValid = false;
        target.deliveryState = "failed";
        target.terminalState = "failed";
      }
      expect(validateAcceptanceReport(candidate).reasons).toContain(
        "Acceptance gate successes do not match output evidence: delivery/novel-batch-a"
      );
    }
  );

  it("does not count a paint completed at its original deadline", () => {
    const candidate = report();
    const target = candidate.outputs.find(
      ({ slotId }) => slotId === "novel-batch-b/novel-b-1/24/outlined"
    );
    if (!target) {
      throw new Error("Missing late delivery fixture output");
    }
    target.completedAt = target.originalDeadlineAt;
    expect(validateAcceptanceReport(candidate).reasons).toEqual(
      expect.arrayContaining([
        "Accepted terminal lacks valid delivery: novel-batch-b/novel-b-1/24/outlined",
        "Acceptance gate successes do not match output evidence: delivery/novel-batch-b",
      ])
    );
  });

  it("rejects a rehashed request identity despite caller-true delivery gates", () => {
    const candidate = report();
    const target = candidate.outputs.find(
      ({ slotId }) => slotId === "novel-batch-a/novel-a-2/24/filled"
    );
    if (!target) {
      throw new Error("Missing rehashed delivery fixture output");
    }
    target.requestIntentHash = hash("rewritten-after-the-deadline");
    expect(validateAcceptanceReport(candidate).reasons).toEqual(
      expect.arrayContaining([
        "Output identity does not match expected slot: novel-batch-a/novel-a-2/24/filled",
        "Acceptance gate successes do not match output evidence: delivery/novel-batch-a",
      ])
    );
  });

  it("rejects one request intent identity reused by another request", () => {
    const candidate = report();
    const source = candidate.expectedSlots.find(
      ({ requestId, population }) =>
        population === "novel-batch-a" && requestId === "novel-a-1/16"
    );
    if (!source) {
      throw new Error("Missing request intent fixture source");
    }
    candidate.expectedSlots = candidate.expectedSlots.map((slot) =>
      slot.population === "novel-batch-a" && slot.requestId === "novel-a-2/16"
        ? { ...slot, requestIntentHash: source.requestIntentHash }
        : slot
    );
    expect(validateAcceptanceReport(candidate).reasons).toContain(
      "Request intent identity is reused: novel-batch-a\u0000novel-a-2/16"
    );
  });

  it.each([
    ["recognition", "repair-population"],
    ["invented", "catalog/outlined-16"],
    ["toString", "catalog/outlined-16"],
  ])("rejects an extra unregistered gate %s/%s", (dimension, scope) => {
    const candidate = report();
    candidate.gates.push({
      ...candidate.gates[0],
      dimension: dimension as AcceptanceDimension,
      scope,
    });
    const result = validateAcceptanceReport(candidate);
    expect(result.envelopeValid).toBe(false);
    expect(result.reasons).toContain(
      `Unknown acceptance gate: ${dimension}/${scope}`
    );
  });

  it("fails closed for missing labels, outputs and dimensions", () => {
    const missing = report();
    missing.outputs[0] = { ...missing.outputs[0], familyFit: null };
    missing.outputs = missing.outputs.slice(0, -1);
    missing.gates = missing.gates.filter(
      ({ dimension, scope }) =>
        !(dimension === "recognition" && scope === "catalog/outlined-16")
    );
    expect(validateAcceptanceReport(missing).reasons).toEqual(
      expect.arrayContaining([
        "Aggregate reviewer labels do not match assessments: catalog/add-image/add-image/16/outlined",
        "Missing output slot: novel-batch-b/novel-b-20/24/filled",
        "Missing acceptance gate: recognition/catalog/outlined-16",
      ])
    );
  });

  it("rejects an empty population and incomplete uncertainty recipe", () => {
    const empty = report();
    empty.expectedSlots = [];
    empty.outputs = [];
    empty.uncertainty = { method: "", resamplingCount: 0, seed: "" };
    expect(validateAcceptanceReport(empty)).toMatchObject({
      envelopeValid: false,
      qualification: false,
    });
  });

  it("rejects critical-defect and ship-unchanged conflicts", () => {
    const conflicted = report();
    conflicted.outputs[0] = {
      ...conflicted.outputs[0],
      criticalDefect: true,
    };
    expect(validateAcceptanceReport(conflicted).reasons).toContain(
      "Critical-defect and ship conflict: catalog/add-image/add-image/16/outlined"
    );
  });

  it("rejects an accepted output that the blind reviewer did not recognize", () => {
    const conflicted = report();
    const target = conflicted.outputs.find(
      ({ slotId }) => slotId === "novel-batch-a/novel-a-1/16/outlined"
    );
    if (!target) {
      throw new Error("Missing recognition-conflict fixture output");
    }
    target.recognitionCorrect = false;
    const gate = conflicted.gates.find(
      ({ dimension, scope }) =>
        dimension === "recognition" && scope === "novel-batch-a/outlined-16"
    );
    if (!gate) {
      throw new Error("Missing recognition-conflict fixture gate");
    }
    gate.successes = 19;
    expect(validateAcceptanceReport(conflicted).reasons).toContain(
      "Accepted recognition conflict: novel-batch-a/novel-a-1/16/outlined"
    );
  });
});

describe("honest evidence boundary regressions", () => {
  const makeNotProduced = () => {
    const candidate = report();
    const [first] = candidate.outputs;
    if (!first) {
      throw new Error("missing output");
    }
    Object.assign(first, {
      artifactHash: null,
      authorProvenance: null,
      completedAt: null,
      craftRatings: [],
      criticalDefect: null,
      deliveryArtifactValid: null,
      deliveryState: "failed",
      evidenceDisposition: "not-produced",
      exactReplay: null,
      familyFit: null,
      houseCraftComparisons: [],
      nativeLegibility: [],
      recognitionCorrect: null,
      reviewerAssessments: [],
      reviewerProvenance: [],
      shipUnchanged: null,
      terminalState: "failed",
    });
    return { candidate, first };
  };

  it.each([
    "houseCraftComparisons",
    "nativeLegibility",
    "reviewerAssessments",
  ] as const)(
    "refuses malformed %s instead of normalizing it away",
    (field) => {
      const { candidate, first } = makeNotProduced();
      (first as unknown as Record<string, unknown>)[field] = {};
      const result = validateAcceptanceReport(candidate);
      expect(result.reasons).toContain(
        `Invalid not-produced evidence: ${first.slotId}`
      );
    }
  );

  it("rejects a nonempty malformed craft array", () => {
    const { candidate, first } = makeNotProduced();
    (first as unknown as Record<string, unknown>).craftRatings = [{}];
    expect(validateAcceptanceReport(candidate).reasons).toContain(
      `Invalid not-produced evidence: ${first.slotId}`
    );
  });

  it("returns a refusal for malformed author identity", () => {
    const candidate = report();
    const [first] = candidate.outputs;
    if (!first) {
      throw new Error("missing output");
    }
    Object.assign(first, {
      authorProvenance: {
        artifactHash: first.artifactHash,
        authorId: 7,
        lineage: "author",
      },
      craftRatings: [],
      criticalDefect: null,
      evidenceDisposition: "produced-not-inspected",
      exactReplay: null,
      familyFit: null,
      houseCraftComparisons: [],
      nativeLegibility: [],
      recognitionCorrect: null,
      reviewerAssessments: [],
      reviewerProvenance: [],
      shipUnchanged: null,
      terminalState: "uncertain",
    });
    expect(validateAcceptanceReport(candidate).reasons).toContain(
      `Invalid produced-not-inspected evidence: ${first.slotId}`
    );
  });

  it("returns a refusal for malformed reviewer identity", () => {
    const candidate = report();
    const [first] = candidate.outputs;
    if (!first) {
      throw new Error("missing output");
    }
    (
      first.reviewerAssessments[0] as unknown as Record<string, unknown>
    ).reviewerId = 7;
    expect(validateAcceptanceReport(candidate).reasons).toContain(
      `Invalid reviewer assessment evidence: ${first.slotId}`
    );
  });

  it("keeps observed craft and parity medians independent of missing-row order", () => {
    const { candidate, first } = makeNotProduced();
    const stratum = candidate.outputs.filter(
      ({ nativeSize, paint, population }) =>
        population === "catalog" && nativeSize === 16 && paint === "outlined"
    );
    const middle = stratum[Math.floor(stratum.length / 2)];
    if (!middle) {
      throw new Error("missing median output");
    }
    const middleIndex = candidate.outputs.indexOf(middle);
    candidate.outputs[0] = middle;
    candidate.outputs[middleIndex] = first;
    for (const gate of candidate.gates) {
      const includesFirst = scopedSlots(
        candidate.expectedSlots,
        gate.scope
      ).some(({ slotId }) => slotId === first.slotId);
      if (
        includesFirst &&
        [
          "craft",
          "delivery",
          "geometry",
          "houseParity",
          "nativeQuality",
          "recognition",
        ].includes(gate.dimension)
      ) {
        gate.successes -= 1;
      }
    }
    const result = validateAcceptanceReport(candidate);
    expect(result.reasons).not.toContain(
      "Acceptance gate pass contradicts threshold: craft/catalog/outlined-16"
    );
    expect(result.reasons).not.toContain(
      "Acceptance gate pass contradicts threshold: houseParity/catalog/outlined-16"
    );
    candidate.outputs.reverse();
    const reversed = validateAcceptanceReport(candidate);
    expect(reversed.reasons).not.toContain(
      "Acceptance gate pass contradicts threshold: craft/catalog/outlined-16"
    );
    expect(reversed.reasons).not.toContain(
      "Acceptance gate pass contradicts threshold: houseParity/catalog/outlined-16"
    );
    expect(result.reasons).not.toContain(
      "Acceptance gate pass contradicts threshold: nativeQuality/catalog/outlined-16"
    );
  });

  it("keeps any-critical disagreement quarantined and rejects a same-row ship conflict", () => {
    const candidate = report();
    const [first] = candidate.outputs;
    if (!first) {
      throw new Error("missing output");
    }
    first.terminalState = "uncertain";
    const [firstReviewer, secondReviewer] = first.reviewerAssessments;
    if (!firstReviewer || !secondReviewer) {
      throw new Error("Missing reviewers");
    }
    firstReviewer.criticalDefect = true;
    firstReviewer.shipUnchanged = true;
    secondReviewer.shipUnchanged = false;
    first.criticalDefect = true;
    first.shipUnchanged = null;
    let result = validateAcceptanceReport(candidate);
    expect(result.reasons).toContain(
      `Invalid reviewer assessment evidence: ${first.slotId}`
    );
    expect(result.reasons).not.toContain(
      `Aggregate reviewer labels do not match assessments: ${first.slotId}`
    );
    secondReviewer.shipUnchanged = true;
    first.shipUnchanged = true;
    result = validateAcceptanceReport(candidate);
    expect(result.reasons).toContain(
      `Critical-defect and ship conflict: ${first.slotId}`
    );
  });
});
