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
      id: `canonical-${index}`,
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
      presentationOf: canonical[21]?.id,
      presentationOfArtifactHash: canonical[21]?.artifactHash,
      presentationOrder: "reversed",
    },
  ];
  const all = [...canonical, ...controls];
  const critic = { model: "critic", provider: "critic-provider" };
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
        { model: "panel-a", provider: "provider-a" },
        { model: "panel-b", provider: "provider-b" },
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
  ).toThrow("distinct from critic");
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
  ).toThrow("distinct from critic");
  fixture = panelFixture();
  fixture.panelReviews[0].decision = "uncertain";
  expect(() =>
    qualifyCriticAgainstIndependentAiPanel(
      fixture.stimuli,
      fixture.predictions,
      fixture.panelReviews
    )
  ).toThrow("distinct from critic");
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
