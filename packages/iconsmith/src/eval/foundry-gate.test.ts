import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  criticQualificationReadyForProduction,
  decidePilot,
  qualifyCraftJudge,
  qualifyInstrument,
  qualifySealedCraftJudge,
  withComputedProductionCriticQualification,
  withComputedProductionCriticReviews,
} from "./foundry-gate.js";
import type {
  InstrumentTrial,
  PilotEvidence,
  PilotItem,
} from "./foundry-gate.js";

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
const collectorReceipt = (
  overrides: Record<string, unknown> = {},
  provenanceKind = "collector-bound-native-evidence-v1"
) => {
  const metrics = {
    canonicalCount: 100,
    decisionCoverage: 1,
    missingPanelRows: 0,
    missingPredictions: 0,
    populationReady: true,
    presentationConsistency: true,
    qualified: true,
    unresolvedPanelLabels: 0,
    ...overrides,
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
    provenanceKind,
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
const rawLabels = {
  craftRating: 9,
  criticalDefect: false,
  familyFit: true,
  nativeLegibility: true,
  recognitionAdjudication: "match" as const,
  recognitionChoice: "described" as const,
  recognitionCorrect: true,
  shipUnchanged: true,
};

const trials = (): InstrumentTrial[] =>
  Array.from({ length: 20 }, (_, index) =>
    (["forward", "reverse"] as const).map((order) => ({
      controlRejected: false,
      decision: "correct" as const,
      defect: "blocked-counter",
      evidenceHash: hash(`stimulus-${index}`),
      order,
      pairId: `pair-${index}`,
    }))
  ).flat();
const evidence = (): PilotEvidence => {
  const items: PilotItem[] = Array.from({ length: 6 }, (_, index) =>
    (["development", "development", "completion", "novel-family"] as const).map(
      (split, variant) => ({
        id: `item-${index}-${variant}`,
        morphology: `group-${index}`,
        split,
        variants: ["16-outline", "24-outline"],
      })
    )
  ).flat();
  return {
    actualUsd: 5,
    ceilingUsd: 10,
    frozenManifestHash: "a".repeat(64),
    holdoutExposed: false,
    items,
    observations: items.flatMap((item) =>
      item.variants.map((variant) => ({
        accepted: true,
        artifactHash: hash(`${item.id}/${variant}`),
        exactReplay: true,
        familyPassed: true,
        item: item.id,
        manualArtworkEdits: 0,
        newlyGenerated: true,
        variant,
      }))
    ),
    observedManifestHash: "a".repeat(64),
    requiredDefects: ["blocked-counter"],
    trials: trials(),
  };
};

describe("foundry advancement", () => {
  it("never promotes the host-control ensemble into production qualification", () => {
    const common = {
      evidenceManifestHash: hash("manifest"),
      generalGeneratedCriticQualified: true,
      metricsHash: hash("metrics"),
      provenanceKind: "verified-file-evidence-v1" as const,
      provenanceValidated: true,
      qualificationVersionHash: hash("qualification-v1"),
      qualified: true,
    };
    expect(
      criticQualificationReadyForProduction({
        ...common,
        qualificationScope: "host-injected-control-distribution",
      })
    ).toBe(false);
    expect(
      criticQualificationReadyForProduction({
        ...common,
        qualificationScope: "agreement-with-independent-ai-panel",
      })
    ).toBe(false);
  });
  it.each([
    "collector-bound-native-evidence-v1",
    "collector-bound-live-transport-evidence-v2",
  ])(
    "does not authorize production reviews from %s qualification alone",
    (kind) => {
      const receipt = collectorReceipt({}, kind);
      expect(criticQualificationReadyForProduction(receipt)).toBe(false);
      let retained: unknown;
      withComputedProductionCriticQualification(
        () => receipt,
        (capability) => {
          retained = capability;
          expect(
            criticQualificationReadyForProduction(capability, capability)
          ).toBe(false);
          expect(
            criticQualificationReadyForProduction(structuredClone(capability))
          ).toBe(false);
        }
      );
      expect(criticQualificationReadyForProduction(retained)).toBe(false);
    }
  );
  it("accepts exact review authority only from a trusted verifier callback", () => {
    const receipt = collectorReceipt();
    const requirement = {
      artifactHash: hash("artifact"),
      authorId: "author-1",
      authorLineage: "author-lineage",
      conceptId: "heart",
      familyId: "heart",
      labels: rawLabels,
      nativePresentationHashes: [hash("light"), hash("dark")] as const,
      nativeSize: 16 as const,
      paint: "outlined" as const,
      recognitionEvidenceHash: hash("recognition"),
      requestIntentHash: hash("author-request"),
      reviewEvidenceHash: hash("review"),
      reviewerId: hash("critic-reviewer"),
      slotId: "heart/outlined/16",
    };
    const reviews = [
      {
        ...requirement,
      },
    ];
    const reviewSet = {
      authorEvidenceVerified: true,
      kind: "verified-production-critic-review-set-v1",
      qualificationManifestSha256: receipt.evidenceManifestHash,
      reviewManifestSha256: hash("production-reviews"),
      reviewSetHash: hash(canonical(reviews)),
      reviews,
    };
    let retained: unknown;
    withComputedProductionCriticReviews(
      () => receipt,
      () => reviewSet,
      (capability) => {
        retained = capability;
        expect(
          criticQualificationReadyForProduction(capability, capability, [
            requirement,
          ])
        ).toBe(true);
        expect(
          criticQualificationReadyForProduction(capability, {} as never, [
            requirement,
          ])
        ).toBe(false);
        expect(
          criticQualificationReadyForProduction(
            capability,
            { criticIdentityHash: capability.criticIdentityHash } as never,
            [requirement]
          )
        ).toBe(false);
        reviews[0].labels = { ...reviews[0].labels, craftRating: 1 };
        reviews[0].paint = "filled";
        reviews.push({ ...reviews[0], slotId: "retained-reference-injection" });
        reviewSet.reviews = [];
        reviewSet.reviewSetHash = hash("retained-reference-mutation");
        expect(
          criticQualificationReadyForProduction(capability, capability, [
            requirement,
          ])
        ).toBe(true);
        expect(
          criticQualificationReadyForProduction(capability, capability, [
            { ...requirement, paint: "filled" },
          ])
        ).toBe(false);
        expect(
          criticQualificationReadyForProduction(
            structuredClone(capability),
            capability,
            [requirement]
          )
        ).toBe(false);
      }
    );
    expect(
      criticQualificationReadyForProduction(retained, retained as never, [
        requirement,
      ])
    ).toBe(false);
  });
  it("rejects repeated requested slots concealing another reviewed slot", () => {
    const receipt = collectorReceipt();
    const requirements = ["heart", "star"].map((conceptId) => ({
      artifactHash: hash(conceptId),
      authorId: "author-1",
      authorLineage: "author-lineage",
      conceptId,
      familyId: conceptId,
      labels: rawLabels,
      nativePresentationHashes: [
        hash(`${conceptId}-light`),
        hash(`${conceptId}-dark`),
      ] as const,
      nativeSize: 16 as const,
      paint: "outlined" as const,
      recognitionEvidenceHash: hash(`${conceptId}-recognition`),
      requestIntentHash: hash(`${conceptId}-request`),
      reviewEvidenceHash: hash(`${conceptId}-review`),
      reviewerId: hash("critic-reviewer"),
      slotId: `${conceptId}/outlined/16`,
    }));
    const reviews = requirements.map((requirement) => ({
      ...requirement,
    }));
    withComputedProductionCriticReviews(
      () => receipt,
      () => ({
        authorEvidenceVerified: true,
        kind: "verified-production-critic-review-set-v1",
        qualificationManifestSha256: receipt.evidenceManifestHash,
        reviewManifestSha256: hash("two-production-reviews"),
        reviewSetHash: hash(canonical(reviews)),
        reviews,
      }),
      (capability) => {
        expect(
          criticQualificationReadyForProduction(
            capability,
            capability,
            requirements
          )
        ).toBe(true);
        expect(
          criticQualificationReadyForProduction(capability, capability, [
            requirements[0],
            requirements[0],
          ])
        ).toBe(false);
      }
    );
  });
  it("binds raw low and rejected labels without imposing per-row thresholds", () => {
    const receipt = collectorReceipt();
    const requirement = {
      artifactHash: hash("low-artifact"),
      authorId: "author-1",
      authorLineage: "author-lineage",
      conceptId: "heart",
      familyId: "heart",
      labels: {
        ...rawLabels,
        craftRating: 8,
        criticalDefect: true,
        shipUnchanged: false,
      },
      nativePresentationHashes: [hash("low-light"), hash("low-dark")] as const,
      nativeSize: 16 as const,
      paint: "outlined" as const,
      recognitionEvidenceHash: hash("low-recognition"),
      requestIntentHash: hash("low-request"),
      reviewEvidenceHash: hash("low-review"),
      reviewerId: hash("critic-reviewer"),
      slotId: "heart/outlined/16",
    };
    withComputedProductionCriticReviews(
      () => receipt,
      () => ({
        authorEvidenceVerified: true,
        kind: "verified-production-critic-review-set-v1",
        qualificationManifestSha256: receipt.evidenceManifestHash,
        reviewManifestSha256: hash("low-production-reviews"),
        reviewSetHash: hash(canonical([requirement])),
        reviews: [requirement],
      }),
      (capability) => {
        expect(
          criticQualificationReadyForProduction(capability, capability, [
            requirement,
          ])
        ).toBe(true);
        expect(
          criticQualificationReadyForProduction(capability, capability, [
            {
              ...requirement,
              labels: { ...requirement.labels, craftRating: 9 },
            },
          ])
        ).toBe(false);
      }
    );
  });
  it("does not let a claimed recognition success replace an uncertain raw result", () => {
    const receipt = collectorReceipt();
    const actual = {
      artifactHash: hash("uncertain-artifact"),
      authorId: "author-1",
      authorLineage: "author-lineage",
      conceptId: "heart",
      familyId: "heart",
      labels: {
        ...rawLabels,
        recognitionAdjudication: "uncertain" as const,
        recognitionCorrect: null,
      },
      nativePresentationHashes: [
        hash("uncertain-light"),
        hash("uncertain-dark"),
      ] as const,
      nativeSize: 16 as const,
      paint: "outlined" as const,
      recognitionEvidenceHash: hash("uncertain-recognition"),
      requestIntentHash: hash("uncertain-request"),
      reviewEvidenceHash: hash("uncertain-review"),
      reviewerId: hash("critic-reviewer"),
      slotId: "heart/outlined/16",
    };
    withComputedProductionCriticReviews(
      () => receipt,
      () => ({
        authorEvidenceVerified: true,
        kind: "verified-production-critic-review-set-v1",
        qualificationManifestSha256: receipt.evidenceManifestHash,
        reviewManifestSha256: hash("uncertain-production-reviews"),
        reviewSetHash: hash(canonical([actual])),
        reviews: [actual],
      }),
      (capability) => {
        expect(
          criticQualificationReadyForProduction(capability, capability, [
            {
              ...actual,
              labels: { ...actual.labels, recognitionCorrect: true },
            },
          ])
        ).toBe(false);
      }
    );
  });
  it("refuses a review set whose author evidence is not authenticated", () => {
    const receipt = collectorReceipt();
    const reviews = [
      {
        artifactHash: hash("artifact"),
        authorId: "claimed-author",
        authorLineage: "claimed-lineage",
        conceptId: "heart",
        craftRating: 10,
        criticalDefect: false,
        familyFit: true,
        familyId: "heart",
        nativeLegibility: true,
        nativePresentationHashes: [hash("light"), hash("dark")],
        nativeSize: 16,
        paint: "outlined",
        requestIntentHash: hash("claimed-request"),
        shipUnchanged: true,
        slotId: "heart/outlined/16",
      },
    ];
    expect(() =>
      withComputedProductionCriticReviews(
        () => receipt,
        () => ({
          authorEvidenceVerified: false,
          kind: "verified-production-critic-review-set-v1",
          qualificationManifestSha256: receipt.evidenceManifestHash,
          reviewManifestSha256: hash("production-reviews"),
          reviewSetHash: hash(canonical(reviews)),
          reviews,
        }),
        () => {}
      )
    ).toThrow(/production critic review set is invalid/iu);
  });
  it("revokes authority before an asynchronous consumer resumes", async () => {
    let authorityAfterYield = true;
    const retained = await withComputedProductionCriticQualification(
      collectorReceipt,
      async (capability) => {
        await Promise.resolve();
        authorityAfterYield = criticQualificationReadyForProduction(
          capability,
          capability
        );
        return capability;
      }
    );
    expect(authorityAfterYield).toBe(false);
    expect(criticQualificationReadyForProduction(retained)).toBe(false);
  });
  it.each([
    ["missing metrics", () => ({ ...collectorReceipt(), metrics: undefined })],
    [
      "stale metric hash",
      () => ({ ...collectorReceipt(), metricsHash: hash("stale") }),
    ],
    [
      "forged version hash",
      () => ({
        ...collectorReceipt(),
        qualificationVersionHash: hash("forged"),
      }),
    ],
    [
      "legacy provenance kind",
      () => ({
        ...collectorReceipt(),
        provenanceKind: "verified-file-evidence-v1",
      }),
    ],
  ])("refuses %s before issuing a capability", (_name, build) => {
    expect(() =>
      withComputedProductionCriticQualification(build, () => {})
    ).toThrow(/receipt is invalid/iu);
  });
  it("requires all concepts, variants and instrument classes", () => {
    expect(decidePilot(evidence()).outcome).toBe("pilot-proven");
    const missing = evidence();
    missing.observations = missing.observations.slice(1);
    expect(decidePilot(missing).outcome).toBe("blocked");
    expect(
      decidePilot({ ...evidence(), requiredDefects: ["unmeasured"] }).outcome
    ).toBe("blocked");
  });
  it("does not count reversed or repeated trials as distinct pairs", () => {
    expect(
      qualifyInstrument(["blocked-counter"], trials().slice(0, 38))[0].passed
    ).toBe(false);
    const repeated = [...trials(), ...trials()];
    expect(qualifyInstrument(["blocked-counter"], repeated)[0].passed).toBe(
      false
    );
    expect(qualifyInstrument(["blocked-counter"], repeated)[0].count).toBe(20);
  });
  it("counts abstention and reversed-order failure, reporting uncertainty", () => {
    const dataset = trials().map((trial, index) =>
      index < 6 ? { ...trial, decision: "abstain" as const } : trial
    );
    const [result] = qualifyInstrument(["blocked-counter"], dataset);
    expect(result.correct).toBe(17);
    expect(result.passed).toBe(false);
    expect(result.correctInterval95[0]).toBeLessThan(0.85);
  });
  it("blocks unknown spend, exposed holdouts and failed family checks", () => {
    expect(decidePilot({ ...evidence(), actualUsd: null }).outcome).toBe(
      "blocked"
    );
    expect(decidePilot({ ...evidence(), actualUsd: 11 }).outcome).toBe(
      "blocked"
    );
    expect(decidePilot({ ...evidence(), holdoutExposed: true }).outcome).toBe(
      "blocked"
    );
    const failed = evidence();
    failed.observations = failed.observations.map((entry, index) =>
      index === 0 ? { ...entry, familyPassed: false } : entry
    );
    expect(decidePilot(failed).outcome).toBe("blocked");
  });
  it("cannot pass by dropping a failed concept or returning a reconstruction", () => {
    expect(
      decidePilot({ ...evidence(), items: evidence().items.slice(1) }).outcome
    ).toBe("blocked");
    const copied = evidence();
    copied.observations = copied.observations.map((entry) => ({
      ...entry,
      newlyGenerated: false,
    }));
    expect(decidePilot(copied).outcome).toBe("blocked");
  });
});

describe("evidence identity", () => {
  it("rejects the same artifact credited to different concepts", () => {
    const copied = evidence();
    copied.observations = copied.observations.map((entry) => ({
      ...entry,
      artifactHash: hash("one-icon"),
    }));
    expect(decidePilot(copied).outcome).toBe("blocked");
  });
  it("permits identical geometry across variants of one concept", () => {
    const same = evidence();
    same.observations = same.observations.map((entry) => ({
      ...entry,
      artifactHash: hash(entry.item),
    }));
    expect(decidePilot(same).outcome).toBe("pilot-proven");
  });
  it("requires actual forward and reverse orders at the JSON boundary", () => {
    const invalid = trials().map((trial) => ({
      ...trial,
      order: trial.order === "forward" ? "front" : "back",
    }));
    expect(
      qualifyInstrument(["blocked-counter"], invalid as InstrumentTrial[])[0]
        .passed
    ).toBe(false);
  });
  it("rejects repeated stimuli renamed as different pairs", () => {
    const copied = trials().map((trial) => ({
      ...trial,
      evidenceHash: hash("one-pair"),
    }));
    expect(qualifyInstrument(["blocked-counter"], copied)[0].passed).toBe(
      false
    );
  });
  it("requires both orders to bind to the same valid stimulus hash", () => {
    for (const evidenceHash of ["", "not-a-hash", hash("different-stimulus")]) {
      const changed = trials().map((trial, index) =>
        index === 0 ? { ...trial, evidenceHash } : trial
      );
      expect(qualifyInstrument(["blocked-counter"], changed)[0].passed).toBe(
        false
      );
    }
  });
});

describe("human-anchored craft judge", () => {
  const rows = Array.from({ length: 100 }, (_, i) => ({
    criticalDefect: i >= 60,
    evidenceHash: i.toString(16).padStart(64, "0"),
    human: i < 60 ? ("approve" as const) : ("reject" as const),
    predicted: i < 60 ? ("approve" as const) : ("reject" as const),
  }));
  const controls = ["identical-images", "reversed-order"].map((defect) => ({
    correct: 20,
    correctInterval95: [0, 1] as [number, number],
    count: 20,
    defect,
    falseRejectionInterval95: [0, 1] as [number, number],
    falseRejections: 0,
    passed: true,
  }));
  it("reports denominators and qualifies only a labeled controlled sample", () => {
    expect(qualifyCraftJudge(rows, controls)).toMatchObject({
      count: 100,
      coverage: 1,
      criticalRecall: 1,
      precision: 1,
      qualified: true,
    });
    expect(qualifyCraftJudge(rows, []).qualified).toBe(false);
    expect(qualifyCraftJudge(rows, controls.slice(0, 1)).qualified).toBe(false);
    expect(
      qualifyCraftJudge(
        rows,
        controls.map((control) => ({ ...control, correct: 19 }))
      ).qualified
    ).toBe(false);
    expect(
      qualifyCraftJudge(
        rows.map((row) => ({
          ...row,
          predicted: "invalid",
        })) as unknown as Parameters<typeof qualifyCraftJudge>[0],
        controls
      ).qualified
    ).toBe(false);
    expect(
      qualifyCraftJudge(
        rows.map((row) => ({ ...row, human: null })),
        controls
      ).qualified
    ).toBe(false);
  });
  it("abstention, duplicate stimuli and false approvals cannot hide in an average", () => {
    expect(
      qualifyCraftJudge(
        rows.map((row) => ({ ...row, predicted: "uncertain" })),
        controls
      ).qualified
    ).toBe(false);
    expect(
      qualifyCraftJudge(
        rows.map((row) => ({ ...row, evidenceHash: "0".repeat(64) })),
        controls
      ).qualified
    ).toBe(false);
    const bad = rows.map((row, i) =>
      i >= 60 && i < 65 ? { ...row, predicted: "approve" as const } : row
    );
    expect(qualifyCraftJudge(bad, controls)).toMatchObject({
      approved: 65,
      criticalDetected: 35,
      qualified: false,
    });
  });
  it("binds qualification to the frozen critic and unseen roster", () => {
    const sealed = {
      controls,
      frozenInstrumentHash: hash("critic-v1"),
      frozenRosterHash: hash("roster-v1"),
      labelsExposedBeforePrediction: false,
      observations: rows,
      observedInstrumentHash: hash("critic-v1"),
      observedRosterHash: hash("roster-v1"),
    };
    expect(qualifySealedCraftJudge(sealed).qualified).toBe(true);
    expect(
      qualifySealedCraftJudge({
        ...sealed,
        observedInstrumentHash: hash("critic-v2"),
      }).qualified
    ).toBe(false);
    expect(
      qualifySealedCraftJudge({
        ...sealed,
        labelsExposedBeforePrediction: true,
      }).qualified
    ).toBe(false);
    expect(
      qualifySealedCraftJudge({
        ...sealed,
        labelsExposedBeforePrediction: undefined,
      } as unknown as Parameters<typeof qualifySealedCraftJudge>[0]).qualified
    ).toBe(false);
  });
});

it("allows explicit panel uncertainty at scoreable coverage but refuses missing roster evidence", () => {
  expect(() =>
    withComputedProductionCriticQualification(
      () =>
        collectorReceipt({ decisionCoverage: 0.8, unresolvedPanelLabels: 20 }),
      () => {}
    )
  ).not.toThrow();
  for (const overrides of [
    { canonicalCount: undefined },
    { canonicalCount: 0 },
    { unresolvedPanelLabels: 101 },
    { decisionCoverage: 0.81, unresolvedPanelLabels: 20 },
    { unresolvedPanelLabels: undefined },
    { unresolvedPanelLabels: "20" },
    { unresolvedPanelLabels: -1 },
    { missingPanelRows: undefined },
    { missingPanelRows: 1 },
    { missingPredictions: 1 },
    { decisionCoverage: 0.79, unresolvedPanelLabels: 21 },
    { decisionCoverage: Number.NaN },
  ]) {
    expect(() =>
      withComputedProductionCriticQualification(
        () => collectorReceipt(overrides),
        () => {}
      )
    ).toThrow(/receipt is invalid/iu);
  }
});
