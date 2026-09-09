import { expect, test } from "vitest";

import {
  qualifyCriticAgainstIndependentAiPanel,
  qualifyAiReviewEnsemble,
  rateReferencePair,
} from "./ai-qualification.js";
import type {
  AiCriticPrediction,
  AiPanelQualificationStimulus,
  AiQualificationStimulus,
  AiReview,
  IndependentAiPanelReview,
} from "./ai-qualification.js";

const semanticValidation = (
  canonicalArtifactHash: string,
  recognitionAnswer: string,
  recognitionChoices: readonly string[]
) => ({
  authority: "independent-ai-semantic-review" as const,
  meaningProvenanceHash: "b".repeat(64),
  recognitionAnswer,
  recognitionChoices,
  reviews: [
    {
      artifactHash: canonicalArtifactHash,
      decision: "valid" as const,
      meaningProvenanceHash: "b".repeat(64),
      reviewEvidenceHash: "c".repeat(64),
      reviewer: { model: "semantic-1", provider: "provider-a" },
    },
    {
      artifactHash: canonicalArtifactHash,
      decision: "valid" as const,
      meaningProvenanceHash: "b".repeat(64),
      reviewEvidenceHash: "d".repeat(64),
      reviewer: { model: "semantic-2", provider: "provider-b" },
    },
  ],
  stimulusHash: canonicalArtifactHash,
});

const stimuli: AiQualificationStimulus[] = [
  {
    canonicalArtifactHash: "1".repeat(64),
    control: "objective-corruption",
    hostInjected: true,
    id: "broken-counter",
    recognitionAnswer: "folder",
    recognitionChoices: ["folder", "bell", "cloud"],
    semanticLabelValidation: semanticValidation("1".repeat(64), "folder", [
      "folder",
      "bell",
      "cloud",
    ]),
  },
  {
    canonicalArtifactHash: "2".repeat(64),
    control: "source-baseline",
    hostInjected: true,
    id: "source-baseline",
    recognitionAnswer: "bell",
    recognitionChoices: ["folder", "bell", "cloud"],
    semanticLabelValidation: semanticValidation("2".repeat(64), "bell", [
      "folder",
      "bell",
      "cloud",
    ]),
  },
  {
    author: { model: "author", provider: "provider-a" },
    canonicalArtifactHash: "3".repeat(64),
    control: "candidate",
    hostInjected: true,
    id: "candidate",
    recognitionAnswer: "cloud",
    recognitionChoices: ["folder", "bell", "cloud"],
    semanticLabelValidation: semanticValidation("3".repeat(64), "cloud", [
      "folder",
      "bell",
      "cloud",
    ]),
  },
];

const reviews = (candidateShip = true): AiReview[] =>
  stimuli.flatMap((stimulus) =>
    [
      { model: "reviewer-1", provider: "provider-a" },
      { model: "reviewer-2", provider: "provider-b" },
    ].map((reviewer) => ({
      blind: true as const,
      craftRating: stimulus.control === "objective-corruption" ? 2 : 9,
      criticalDefect: stimulus.control === "objective-corruption",
      familyFit: stimulus.control !== "objective-corruption",
      nativeLegibility: stimulus.control !== "objective-corruption",
      recognitionChoice: stimulus.recognitionAnswer,
      reviewer,
      shipUnchanged:
        stimulus.control === "candidate"
          ? candidateShip
          : stimulus.control === "source-baseline",
      stimulusHash: stimulus.canonicalArtifactHash,
      stimulusId: stimulus.id,
    }))
  );

const panelHash = (value: number) => value.toString(16).padStart(64, "0");

const validationFor = (stimulus: AiQualificationStimulus) => {
  if (!stimulus.semanticLabelValidation) {
    throw new Error("Missing semantic validation fixture");
  }
  return stimulus.semanticLabelValidation;
};

test("qualifies only independent consensus that clears objective controls", () => {
  const result = qualifyAiReviewEnsemble(stimuli, reviews());
  expect(result).toMatchObject({
    corruptionDefectRecall: 1,
    generalGeneratedCriticQualified: false,
    labelAuthority: "objective-controls+independent-ai-semantic-review",
    qualificationPopulationReady: false,
    qualificationScope: "host-injected-control-distribution",
    qualified: false,
    sourceAcceptanceRate: 1,
  });
  expect(result.candidates[0].status).toBe("accepted");
});

test("quarantines any critical flag and keeps reviewer disagreement uncertain", () => {
  const flagged = reviews();
  const flaggedCandidate = flagged.at(-1);
  if (!flaggedCandidate) {
    throw new Error("Missing test review");
  }
  flaggedCandidate.criticalDefect = true;
  expect(qualifyAiReviewEnsemble(stimuli, flagged)).toMatchObject({
    qualified: false,
  });
  const disagreed = reviews();
  const disagreedCandidate = disagreed.at(-1);
  if (!disagreedCandidate) {
    throw new Error("Missing test review");
  }
  disagreedCandidate.shipUnchanged = false;
  const result = qualifyAiReviewEnsemble(stimuli, disagreed);
  expect(result.candidates[0].status).toBe("uncertain");
  expect(result.qualified).toBe(false);
});

test("cannot accept false rubric keys or a craft median below nine", () => {
  const failedRecognition = reviews();
  for (const row of failedRecognition.filter(
    ({ stimulusHash }) => stimulusHash === "3".repeat(64)
  )) {
    row.recognitionChoice = "bell";
  }
  expect(
    qualifyAiReviewEnsemble(stimuli, failedRecognition).candidates[0].status
  ).toBe("rejected");
  const lowCraft = reviews();
  for (const row of lowCraft.filter(
    ({ stimulusHash }) => stimulusHash === "3".repeat(64)
  )) {
    row.craftRating = 8;
  }
  expect(qualifyAiReviewEnsemble(stimuli, lowCraft).candidates[0].status).toBe(
    "rejected"
  );
});

test("keeps filename-only or incorrectly bound semantic labels diagnostic", () => {
  const filenameOnly = stimuli.map((stimulus) => ({ ...stimulus }));
  filenameOnly[2] = {
    ...filenameOnly[2],
    semanticLabelValidation: {
      ...validationFor(filenameOnly[2]),
      authority: "filename-only",
    },
  };
  const filenameResult = qualifyAiReviewEnsemble(filenameOnly, reviews());
  expect(filenameResult.semanticLabelsValidated).toBe(false);
  expect(filenameResult.labelAuthority).toBe("unvalidated-semantic-labels");
  expect(filenameResult.candidates[0].status).toBe("uncertain");
  expect(filenameResult.qualified).toBe(false);

  const wrongHash = stimuli.map((stimulus) => ({ ...stimulus }));
  wrongHash[2] = {
    ...wrongHash[2],
    semanticLabelValidation: {
      ...validationFor(wrongHash[2]),
      stimulusHash: "f".repeat(64),
    },
  };
  expect(
    qualifyAiReviewEnsemble(wrongHash, reviews()).candidates[0].status
  ).toBe("uncertain");
});

test("requires two independent semantic reviewers and exact choices", () => {
  const invalid = stimuli.map((stimulus) => ({ ...stimulus }));
  invalid[2] = {
    ...invalid[2],
    semanticLabelValidation: {
      ...validationFor(invalid[2]),
      recognitionChoices: ["cloud", "folder", "bell"],
      reviews: validationFor(invalid[2]).reviews.map((review) => ({
        ...review,
        reviewer: { model: "same", provider: "same" },
      })),
    },
  };
  const result = qualifyAiReviewEnsemble(invalid, reviews());
  expect(result.semanticLabelsValidated).toBe(false);
  expect(result.qualified).toBe(false);

  const ambiguous = stimuli.map((stimulus) => ({ ...stimulus }));
  const validation = validationFor(ambiguous[2]);
  ambiguous[2] = {
    ...ambiguous[2],
    semanticLabelValidation: {
      ...validation,
      reviews: validation.reviews.map((review, index) => ({
        ...review,
        decision: index === 0 ? ("ambiguous" as const) : review.decision,
      })),
    },
  };
  expect(
    qualifyAiReviewEnsemble(ambiguous, reviews()).candidates[0].status
  ).toBe("uncertain");
});

test("rejects unblinded, duplicate, or single-reviewer evidence", () => {
  expect(() =>
    qualifyAiReviewEnsemble(
      stimuli,
      reviews().map((row) => ({
        ...row,
        reviewer: { model: "same", provider: "same" },
      }))
    )
  ).toThrow("two valid distinct");
  expect(() =>
    qualifyAiReviewEnsemble(stimuli, [
      ...reviews(),
      { ...reviews()[0], blind: false as true },
    ])
  ).toThrow();
});

test("rejects an author among multiple host-control judges", () => {
  const authorAmongJudges = reviews();
  const authoredReview = authorAmongJudges.find(
    ({ stimulusId }) => stimulusId === "candidate"
  );
  if (!authoredReview) {
    throw new Error("Missing authored review fixture");
  }
  authoredReview.reviewer = { model: "author", provider: "provider-a" };
  expect(() => qualifyAiReviewEnsemble(stimuli, authorAmongJudges)).toThrow(
    "Author cannot judge authored artifact"
  );
});

test("rates candidate against a matched reference on every rubric threshold", () => {
  const candidate = reviews()
    .filter(({ stimulusHash }) => stimulusHash === "3".repeat(64))
    .map(
      ({ reviewer: _reviewer, stimulusHash: _hash, blind: _blind, ...row }) =>
        row
    );
  expect(rateReferencePair(candidate, candidate)).toMatchObject({
    metrics: { craftDelta: 0 },
    passes: true,
  });
  expect(
    rateReferencePair(
      candidate.map((row) => ({ ...row, craftRating: 1 })),
      candidate
    ).passes
  ).toBe(false);
});

test("sorts craft ratings numerically and preserves abstention uncertainty", () => {
  const rows = [2, 9, 10].map((craftRating) => ({
    craftRating,
    criticalDefect: false,
    familyFit: true,
    nativeLegibility: true,
    shipUnchanged: true,
  }));
  expect(rateReferencePair(rows, rows).passes).toBe(true);
  const abstained = reviews();
  const candidate = abstained.at(-1);
  if (!candidate) {
    throw new Error("Missing candidate review");
  }
  candidate.nativeLegibility = null;
  expect(qualifyAiReviewEnsemble(stimuli, abstained).candidates[0].status).toBe(
    "uncertain"
  );
  const criticalAbstention = reviews();
  criticalAbstention[0].criticalDefect = null;
  expect(
    qualifyAiReviewEnsemble(stimuli, criticalAbstention).outcomes[0].status
  ).toBe("quarantined");
});

test("checks repeated presentations per reviewer outside the denominator", () => {
  const original = stimuli.find(({ control }) => control === "candidate");
  if (!original) {
    throw new Error("Missing candidate stimulus");
  }
  const presentations: AiQualificationStimulus[] = [
    {
      ...original,
      id: "candidate-identical",
      presentationOf: original.canonicalArtifactHash,
      presentationOrder: "identical",
    },
    {
      ...original,
      id: "candidate-reversed",
      presentationOf: original.canonicalArtifactHash,
      presentationOrder: "reversed",
    },
  ];
  const repeated = presentations.flatMap((presentation) =>
    reviews()
      .filter(
        ({ stimulusHash }) => stimulusHash === original.canonicalArtifactHash
      )
      .map((review) => ({
        ...review,
        stimulusHash: presentation.canonicalArtifactHash,
        stimulusId: presentation.id,
      }))
  );
  const consistent = qualifyAiReviewEnsemble(
    [...stimuli, ...presentations],
    [...reviews(), ...repeated]
  );
  expect(consistent.presentationConsistency).toBe(true);
  expect(consistent.outcomes).toHaveLength(5);
  expect(consistent.assessmentCoverage).toBe(1);
  expect(
    consistent.outcomes.filter(({ stimulus }) => !stimulus.presentationOf)
  ).toHaveLength(3);
  repeated[0].craftRating = 8;
  expect(
    qualifyAiReviewEnsemble(
      [...stimuli, ...presentations],
      [...reviews(), ...repeated]
    ).presentationConsistency
  ).toBe(false);
});

const panelFixture = () => {
  const canonical: AiPanelQualificationStimulus[] = Array.from(
    { length: 100 },
    (_, index) => ({
      artifactHash: panelHash(index + 1),
      canonical: true,
      craftEvidenceHash: panelHash(index + 201),
      defectClasses: index < 20 ? ["blocked-counter"] : [],
      generationKind: "natural-generated",
      id: `canonical-${index}`,
      nativeSize: index % 2 === 0 ? 16 : 24,
      orderedAttachmentHashes: [panelHash(index + 1), panelHash(index + 3001)],
      paint: index % 4 < 2 ? "outlined" : "filled",
      producerLineages: ["author-lineage"],
      recognitionEvidenceHash: panelHash(index + 401),
      sealed: true as const,
    })
  );
  const controls: AiPanelQualificationStimulus[] = [
    {
      ...canonical[20],
      canonical: false,
      id: "identical-control",
      presentationOf: canonical[20]?.id,
      presentationOfArtifactHash: canonical[20]?.artifactHash,
      presentationOrder: "identical",
    },
    {
      ...canonical[21],
      canonical: false,
      id: "reversed-control",
      orderedAttachmentHashes:
        canonical[21]?.orderedAttachmentHashes.toReversed() ?? [],
      presentationOf: canonical[21]?.id,
      presentationOfArtifactHash: canonical[21]?.artifactHash,
      presentationOrder: "reversed",
    },
  ];
  const all = [...canonical, ...controls];
  const critic = {
    baseModelLineage: "critic-lineage",
    model: "critic",
    provider: "critic-provider",
  };
  const predictions: AiCriticPrediction[] = all.map((stimulus, index) => ({
    artifactHash: stimulus.artifactHash,
    critic,
    decision: index < 20 ? "reject" : "approve",
    sealed: true,
    sealedAt: 1,
    stimulusId: stimulus.id,
  }));
  const panelReviews: IndependentAiPanelReview[] = all.flatMap(
    (stimulus, index) =>
      [
        {
          baseModelLineage: "panel-lineage-a",
          model: "panel-a",
          provider: "provider-a",
        },
        {
          baseModelLineage: "panel-lineage-b",
          model: "panel-b",
          provider: "provider-b",
        },
      ].map((reviewer) => ({
        artifactHash: stimulus.artifactHash,
        craftEvidenceHash: stimulus.craftEvidenceHash,
        critical: index < 20,
        decision: index < 20 ? ("reject" as const) : ("approve" as const),
        panelEvidenceAvailableAt: 2,
        recognitionEvidenceHash: stimulus.recognitionEvidenceHash,
        reviewer,
        stimulusId: stimulus.id,
      }))
  );
  return { panelReviews, predictions, stimuli: all };
};

test("qualifies critic agreement with a sealed independent AI panel only", () => {
  const fixture = panelFixture();
  expect(
    qualifyCriticAgainstIndependentAiPanel(
      fixture.stimuli,
      fixture.predictions,
      fixture.panelReviews
    )
  ).toMatchObject({
    approvalPrecision: 1,
    canonicalCount: 100,
    criticalCount: 20,
    criticalRecall: 1,
    decisionCoverage: 1,
    generalGeneratedCriticQualified: false,
    populationReady: true,
    presentationConsistency: true,
    qualificationScope: "agreement-with-independent-ai-panel",
    qualified: true,
  });
});

test("rejects too-small, unsealed, leaked, same-reviewer, and duplicate evidence", () => {
  const make = panelFixture;
  let fixture = make();
  expect(
    qualifyCriticAgainstIndependentAiPanel(
      fixture.stimuli.slice(0, 50),
      fixture.predictions.slice(0, 50),
      fixture.panelReviews.filter(({ stimulusId }) =>
        fixture.stimuli.slice(0, 50).some(({ id }) => id === stimulusId)
      )
    ).qualified
  ).toBe(false);
  fixture = make();
  fixture.stimuli[0] = { ...fixture.stimuli[0], sealed: false as true };
  expect(() =>
    qualifyCriticAgainstIndependentAiPanel(
      fixture.stimuli,
      fixture.predictions,
      fixture.panelReviews
    )
  ).toThrow("unsealed");
  fixture = make();
  fixture.predictions[0].sealedAt = 2;
  expect(() =>
    qualifyCriticAgainstIndependentAiPanel(
      fixture.stimuli,
      fixture.predictions,
      fixture.panelReviews
    )
  ).toThrow("before panel reveal");
  fixture = make();
  fixture.panelReviews[0].reviewer = fixture.predictions[0].critic;
  expect(() =>
    qualifyCriticAgainstIndependentAiPanel(
      fixture.stimuli,
      fixture.predictions,
      fixture.panelReviews
    )
  ).toThrow("base-model lineages");
  fixture = make();
  fixture.predictions.push({ ...fixture.predictions[0] });
  expect(() =>
    qualifyCriticAgainstIndependentAiPanel(
      fixture.stimuli,
      fixture.predictions,
      fixture.panelReviews
    )
  ).toThrow("duplicate");
});

test("rejects duplicate canonical artifacts while permitting exact-byte presentations", () => {
  const fixture = panelFixture();
  expect(
    qualifyCriticAgainstIndependentAiPanel(
      fixture.stimuli,
      fixture.predictions,
      fixture.panelReviews
    )
  ).toMatchObject({ canonicalCount: 100, populationReady: true });
  fixture.stimuli[1].artifactHash = fixture.stimuli[0].artifactHash;
  expect(() =>
    qualifyCriticAgainstIndependentAiPanel(
      fixture.stimuli,
      fixture.predictions,
      fixture.panelReviews
    )
  ).toThrow("duplicate");
});

test("binds identical and reversed controls to exact ordered attachments", () => {
  let fixture = panelFixture();
  const identical = fixture.stimuli.find(
    ({ id }) => id === "identical-control"
  );
  if (!identical) {
    throw new Error("Missing identical control");
  }
  identical.artifactHash = panelHash(9001);
  expect(() =>
    qualifyCriticAgainstIndependentAiPanel(
      fixture.stimuli,
      fixture.predictions,
      fixture.panelReviews
    )
  ).toThrow("Presentation control");

  fixture = panelFixture();
  const reversed = fixture.stimuli.find(({ id }) => id === "reversed-control");
  if (!reversed) {
    throw new Error("Missing reversed control");
  }
  reversed.orderedAttachmentHashes = [
    ...(fixture.stimuli[21]?.orderedAttachmentHashes ?? []),
  ];
  expect(() =>
    qualifyCriticAgainstIndependentAiPanel(
      fixture.stimuli,
      fixture.predictions,
      fixture.panelReviews
    )
  ).toThrow("Presentation control");

  fixture = panelFixture();
  fixture.stimuli[21].orderedAttachmentHashes = [panelHash(22), panelHash(22)];
  const vacuousReverse = fixture.stimuli.find(
    ({ id }) => id === "reversed-control"
  );
  if (!vacuousReverse) {
    throw new Error("Missing reverse control");
  }
  vacuousReverse.orderedAttachmentHashes = [panelHash(22), panelHash(22)];
  expect(() =>
    qualifyCriticAgainstIndependentAiPanel(
      fixture.stimuli,
      fixture.predictions,
      fixture.panelReviews
    )
  ).toThrow("Presentation control");
});

test.each([
  ["always approve", "approve", 0, 0.8],
  ["always reject", "reject", 1, 0],
  ["always uncertain", "uncertain", 0, 0],
] as const)("does not qualify %s", (_name, decision, recall, precision) => {
  const fixture = panelFixture();
  for (const prediction of fixture.predictions) {
    prediction.decision = decision;
  }
  const result = qualifyCriticAgainstIndependentAiPanel(
    fixture.stimuli,
    fixture.predictions,
    fixture.panelReviews
  );
  expect(result.criticalRecall).toBe(recall);
  expect(result.approvalPrecision).toBe(precision);
  expect(result.qualified).toBe(false);
});

test("keeps uncertain or disagreed panel labels in the readiness denominator", () => {
  const fixture = panelFixture();
  fixture.panelReviews[0].decision = "uncertain";
  fixture.panelReviews[0].critical = null;
  const result = qualifyCriticAgainstIndependentAiPanel(
    fixture.stimuli,
    fixture.predictions,
    fixture.panelReviews
  );
  expect(result.unresolvedPanelLabels).toBe(1);
  expect(result.canonicalCount).toBe(100);
  expect(result.populationReady).toBe(false);
  expect(result.qualified).toBe(false);
});

test("requires at least twenty critic approval predictions", () => {
  const fixture = panelFixture();
  let keptApproval = false;
  for (const prediction of fixture.predictions) {
    if (prediction.decision === "approve" && !keptApproval) {
      keptApproval = true;
    } else if (prediction.decision === "approve") {
      prediction.decision = "reject";
    }
  }
  const result = qualifyCriticAgainstIndependentAiPanel(
    fixture.stimuli,
    fixture.predictions,
    fixture.panelReviews
  );
  expect(result.approvalPredictionCount).toBe(1);
  expect(result.approvalPrecision).toBe(1);
  expect(result.populationReady).toBe(false);
  expect(result.qualified).toBe(false);
});

test.each([
  [
    "prediction decision",
    (fixture: ReturnType<typeof panelFixture>) => {
      fixture.predictions[0].decision = "invalid" as "approve";
    },
  ],
  [
    "panel decision",
    (fixture: ReturnType<typeof panelFixture>) => {
      fixture.panelReviews[0].decision = "invalid" as "approve";
    },
  ],
  [
    "panel critical",
    (fixture: ReturnType<typeof panelFixture>) => {
      fixture.panelReviews[0].critical = "yes" as unknown as boolean;
    },
  ],
  [
    "canonical flag",
    (fixture: ReturnType<typeof panelFixture>) => {
      fixture.stimuli[0].canonical = "yes" as unknown as boolean;
    },
  ],
  [
    "presentation order",
    (fixture: ReturnType<typeof panelFixture>) => {
      const stimulus = fixture.stimuli.at(-1);
      if (!stimulus) {
        throw new Error("Missing presentation control");
      }
      stimulus.presentationOrder = "rotated" as "reversed";
    },
  ],
] as const)("rejects malformed runtime %s", (_name, mutate) => {
  const fixture = panelFixture();
  mutate(fixture);
  expect(() =>
    qualifyCriticAgainstIndependentAiPanel(
      fixture.stimuli,
      fixture.predictions,
      fixture.panelReviews
    )
  ).toThrow();
});

test("rejects contradictory panel semantics and invalid thresholds", () => {
  let fixture = panelFixture();
  fixture.panelReviews[40].critical = true;
  expect(() =>
    qualifyCriticAgainstIndependentAiPanel(
      fixture.stimuli,
      fixture.predictions,
      fixture.panelReviews
    )
  ).toThrow("base-model lineages");
  fixture = panelFixture();
  fixture.panelReviews[0].decision = "uncertain";
  expect(() =>
    qualifyCriticAgainstIndependentAiPanel(
      fixture.stimuli,
      fixture.predictions,
      fixture.panelReviews
    )
  ).toThrow("base-model lineages");
  fixture = panelFixture();
  expect(() =>
    qualifyCriticAgainstIndependentAiPanel(
      fixture.stimuli,
      fixture.predictions,
      fixture.panelReviews,
      {
        approvalPrecision: Number.NaN,
        criticalRecall: 0.9,
        decisionCoverage: 0.8,
      }
    )
  ).toThrow("thresholds");
});

test("requires actual critic decisions on presentation controls", () => {
  const fixture = panelFixture();
  fixture.predictions = fixture.predictions.filter(
    ({ stimulusId }) => !stimulusId.endsWith("-control")
  );
  const result = qualifyCriticAgainstIndependentAiPanel(
    fixture.stimuli,
    fixture.predictions,
    fixture.panelReviews
  );
  expect(result.presentationConsistency).toBe(false);
  expect(result.qualified).toBe(false);
});

test("requires explicit independent lineages beyond provider and model aliases", () => {
  let fixture = panelFixture();
  for (const review of fixture.panelReviews) {
    review.reviewer.baseModelLineage = "shared-panel-lineage";
  }
  expect(() =>
    qualifyCriticAgainstIndependentAiPanel(
      fixture.stimuli,
      fixture.predictions,
      fixture.panelReviews
    )
  ).toThrow("base-model lineages");

  fixture = panelFixture();
  fixture.predictions[0].critic.baseModelLineage = undefined;
  expect(() =>
    qualifyCriticAgainstIndependentAiPanel(
      fixture.stimuli,
      fixture.predictions,
      fixture.panelReviews
    )
  ).toThrow("base-model lineages");
});

test("excludes every author and repairer lineage for each artifact", () => {
  const fixture = panelFixture();
  fixture.stimuli[0].producerLineages = ["author-lineage", "panel-lineage-a"];
  expect(() =>
    qualifyCriticAgainstIndependentAiPanel(
      fixture.stimuli,
      fixture.predictions,
      fixture.panelReviews
    )
  ).toThrow("Author or repairer lineage overlaps");
});

test("requires natural generated producers and balanced qualification strata", () => {
  let fixture = panelFixture();
  fixture.stimuli[0].producerLineages = [];
  expect(() =>
    qualifyCriticAgainstIndependentAiPanel(
      fixture.stimuli,
      fixture.predictions,
      fixture.panelReviews
    )
  ).toThrow("Author or repairer lineage overlaps");

  fixture = panelFixture();
  for (const stimulus of fixture.stimuli) {
    stimulus.paint = "outlined";
    stimulus.nativeSize = 16;
  }
  expect(
    qualifyCriticAgainstIndependentAiPanel(
      fixture.stimuli,
      fixture.predictions,
      fixture.panelReviews
    )
  ).toMatchObject({ populationReady: false, qualified: false });
});

test("does not let source positives or injected defects dilute generated failures", () => {
  const fixture = panelFixture();
  for (let index = 0; index < 20; index += 1) {
    fixture.stimuli[index].generationKind = "objective-injected";
  }
  for (let index = 20; index < 40; index += 1) {
    for (const review of fixture.panelReviews.filter(
      ({ stimulusId }) => stimulusId === `canonical-${index}`
    )) {
      review.critical = true;
      review.decision = "reject";
    }
  }
  for (const review of fixture.panelReviews.filter(({ stimulusId }) =>
    ["identical-control", "reversed-control"].includes(stimulusId)
  )) {
    review.critical = true;
    review.decision = "reject";
  }
  const appendControls = (
    count: number,
    generationKind: "objective-injected" | "source-control",
    critical: boolean,
    offset: number
  ) => {
    for (let index = 0; index < count; index += 1) {
      const id = `${generationKind}-${index}`;
      const stimulus: AiPanelQualificationStimulus = {
        artifactHash: panelHash(offset + index),
        canonical: true,
        craftEvidenceHash: panelHash(offset + 1000 + index),
        defectClasses: critical ? ["objective-corruption"] : [],
        generationKind,
        id,
        nativeSize: index % 2 === 0 ? 16 : 24,
        orderedAttachmentHashes: [
          panelHash(offset + index),
          panelHash(offset + 3000 + index),
        ],
        paint: index % 4 < 2 ? "outlined" : "filled",
        producerLineages: [],
        recognitionEvidenceHash: panelHash(offset + 2000 + index),
        sealed: true,
      };
      fixture.stimuli.push(stimulus);
      fixture.predictions.push({
        artifactHash: stimulus.artifactHash,
        critic: fixture.predictions[0].critic,
        decision: critical ? "reject" : "approve",
        sealed: true,
        sealedAt: 1,
        stimulusId: id,
      });
      for (const reviewer of [
        fixture.panelReviews[0].reviewer,
        fixture.panelReviews[1].reviewer,
      ]) {
        fixture.panelReviews.push({
          artifactHash: stimulus.artifactHash,
          craftEvidenceHash: stimulus.craftEvidenceHash,
          critical,
          decision: critical ? "reject" : "approve",
          panelEvidenceAvailableAt: 2,
          recognitionEvidenceHash: stimulus.recognitionEvidenceHash,
          reviewer,
          stimulusId: id,
        });
      }
    }
  };
  appendControls(180, "objective-injected", true, 10_000);
  appendControls(320, "source-control", false, 20_000);
  const result = qualifyCriticAgainstIndependentAiPanel(
    fixture.stimuli,
    fixture.predictions,
    fixture.panelReviews
  );
  expect(result).toMatchObject({
    approvalPrecision: 0.95,
    criticalRecall: 200 / 220,
    naturalApprovalPrecision: 0.75,
    naturalCriticalRecall: 0,
    populationReady: true,
    qualified: false,
  });
});

test("preserves intentional attachment multiplicity without inflating stimuli", () => {
  const fixture = panelFixture();
  const control = fixture.stimuli.find(({ id }) => id === "identical-control");
  const original = fixture.stimuli.find(
    ({ id }) => id === control?.presentationOf
  );
  if (!control || !original) {
    throw new Error("Missing fixture control");
  }
  original.orderedAttachmentHashes = [panelHash(8100), panelHash(8100)];
  control.orderedAttachmentHashes = [...original.orderedAttachmentHashes];
  expect(() =>
    qualifyCriticAgainstIndependentAiPanel(
      fixture.stimuli,
      fixture.predictions,
      fixture.panelReviews
    )
  ).not.toThrow();
  control.orderedAttachmentHashes = [panelHash(8100)];
  expect(() =>
    qualifyCriticAgainstIndependentAiPanel(
      fixture.stimuli,
      fixture.predictions,
      fixture.panelReviews
    )
  ).toThrow();
});

test.each([
  [20, 0.8, true],
  [21, 0.79, false],
] as const)(
  "retains %i explicit uncertain outcomes at coverage %f",
  (count, coverage, qualified) => {
    const fixture = panelFixture();
    const uncertain = new Set(
      fixture.stimuli
        .filter(({ canonical }) => canonical)
        .slice(-count)
        .map(({ id }) => id)
    );
    for (const prediction of fixture.predictions) {
      if (uncertain.has(prediction.stimulusId)) {
        prediction.decision = "uncertain";
      }
    }
    for (const review of fixture.panelReviews) {
      if (uncertain.has(review.stimulusId)) {
        review.decision = "uncertain";
        review.critical = null;
      }
    }
    expect(
      qualifyCriticAgainstIndependentAiPanel(
        fixture.stimuli,
        fixture.predictions,
        fixture.panelReviews
      )
    ).toMatchObject({
      approvalPrecision: 1,
      criticalRecall: 1,
      decisionCoverage: coverage,
      missingPanelRows: 0,
      missingPredictions: 0,
      populationReady: true,
      qualified,
      unresolvedPanelLabels: count,
    });
  }
);

test("unresolved panel approvals reduce coverage and remain failed approval predictions", () => {
  const fixture = panelFixture();
  for (const review of fixture.panelReviews) {
    if (review.stimulusId === "canonical-99") {
      review.decision = "uncertain";
      review.critical = null;
    }
  }
  const result = qualifyCriticAgainstIndependentAiPanel(
    fixture.stimuli,
    fixture.predictions,
    fixture.panelReviews
  );
  expect(result).toMatchObject({
    approvalPrecision: 79 / 80,
    approvalPredictionCount: 80,
    decisionCoverage: 0.99,
    populationReady: true,
    unresolvedPanelLabels: 1,
  });
  expect(result.perStratum["filled-24"]?.decisionCoverage).toBe(24 / 25);
});

test.each(["critic", "panel"] as const)(
  "missing %s evidence is not an explicit uncertain outcome",
  (missing) => {
    const fixture = panelFixture();
    if (missing === "critic") {
      fixture.predictions = fixture.predictions.filter(
        ({ stimulusId }) => stimulusId !== "canonical-99"
      );
    } else {
      fixture.panelReviews.pop();
    }
    expect(
      qualifyCriticAgainstIndependentAiPanel(
        fixture.stimuli,
        fixture.predictions,
        fixture.panelReviews
      )
    ).toMatchObject({
      missingPanelRows: missing === "panel" ? 1 : 0,
      missingPredictions: missing === "critic" ? 1 : 0,
      populationReady: false,
      qualified: false,
    });
  }
);
