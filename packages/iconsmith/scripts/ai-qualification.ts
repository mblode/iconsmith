const HASH = /^[a-f0-9]{64}$/u;
export interface AiRubricRating {
  craftRating: number;
  criticalDefect: boolean | null;
  familyFit: boolean | null;
  nativeLegibility: boolean | null;
  shipUnchanged: boolean | null;
}
export interface AiReviewerIdentity {
  /** Stable base-model family. Provider aliases, effort and sessions do not
   * create a new independent lineage. */
  baseModelLineage?: string;
  model: string;
  provider: string;
}
interface AiSemanticLabelValidation {
  authority: "independent-ai-semantic-review" | "filename-only";
  meaningProvenanceHash: string;
  recognitionAnswer: string;
  recognitionChoices: readonly string[];
  reviews: readonly {
    artifactHash: string;
    decision: "ambiguous" | "invalid" | "valid";
    meaningProvenanceHash: string;
    reviewEvidenceHash: string;
    reviewer: AiReviewerIdentity;
  }[];
  stimulusHash: string;
}
export interface AiReview extends AiRubricRating {
  blind: true;
  recognitionChoice: string | null;
  reviewer: AiReviewerIdentity;
  stimulusHash: string;
  /** Required when presentation controls deliberately reuse canonical bytes. */
  stimulusId?: string;
}
export interface AiQualificationStimulus {
  author?: AiReviewerIdentity;
  canonicalArtifactHash: string;
  control: "candidate" | "objective-corruption" | "source-baseline";
  hostInjected: boolean;
  id: string;
  presentationOf?: string;
  presentationOrder?: "identical" | "reversed";
  recognitionAnswer: string;
  recognitionChoices: readonly string[];
  semanticLabelValidation?: AiSemanticLabelValidation;
}
export interface AiRubricThresholds {
  sourceAcceptance: number;
  corruptionDefectRecall: number;
  coverage: number;
  craftDelta: number;
  familyFit: number;
  nativeLegibility: number;
  shipUnchanged: number;
}
const DEFAULT_AI_RUBRIC_THRESHOLDS: AiRubricThresholds = {
  corruptionDefectRecall: 0.9,
  coverage: 0.8,
  craftDelta: -0.5,
  familyFit: 0.95,
  nativeLegibility: 0.95,
  shipUnchanged: 0.95,
  sourceAcceptance: 0.95,
};
const reviewerId = ({ model, provider }: AiReviewerIdentity) =>
  `${provider.trim()}/${model.trim()}`;
const rate = (values: readonly boolean[]) =>
  values.filter(Boolean).length / values.length;
const average = (rows: readonly AiRubricRating[]) =>
  rows.reduce((sum, row) => sum + row.craftRating, 0) / rows.length;
const median = (rows: readonly AiRubricRating[]) => {
  const values = rows
    .map(({ craftRating }) => craftRating)
    .toSorted((left, right) => left - right);
  const middle = Math.floor(values.length / 2);
  return values.length % 2
    ? (values[middle] ?? 0)
    : ((values[middle - 1] ?? 0) + (values[middle] ?? 0)) / 2;
};
const validRating = (row: AiRubricRating) =>
  Number.isInteger(row.craftRating) &&
  row.craftRating >= 1 &&
  row.craftRating <= 10 &&
  [
    row.criticalDefect,
    row.familyFit,
    row.nativeLegibility,
    row.shipUnchanged,
  ].every((value) => value === null || typeof value === "boolean");
const completeRating = (row: AiRubricRating) =>
  validRating(row) &&
  [
    row.criticalDefect,
    row.familyFit,
    row.nativeLegibility,
    row.shipUnchanged,
  ].every((value) => typeof value === "boolean");

const semanticLabelIsValidated = (stimulus: AiQualificationStimulus) => {
  const validation = stimulus.semanticLabelValidation;
  if (!validation) {
    return false;
  }
  const reviewers = new Set(
    validation.reviews.map(({ reviewer }) => reviewerId(reviewer))
  );
  return (
    validation.authority === "independent-ai-semantic-review" &&
    HASH.test(validation.meaningProvenanceHash) &&
    validation.stimulusHash === stimulus.canonicalArtifactHash &&
    validation.recognitionAnswer === stimulus.recognitionAnswer &&
    JSON.stringify(validation.recognitionChoices) ===
      JSON.stringify(stimulus.recognitionChoices) &&
    reviewers.size >= 2 &&
    validation.reviews.every(
      ({
        artifactHash,
        decision,
        meaningProvenanceHash,
        reviewEvidenceHash,
        reviewer: { model, provider },
      }) =>
        artifactHash === stimulus.canonicalArtifactHash &&
        decision === "valid" &&
        meaningProvenanceHash === validation.meaningProvenanceHash &&
        HASH.test(reviewEvidenceHash) &&
        model.trim() &&
        provider.trim()
    )
  );
};

export const rateReferencePair = (
  candidate: readonly AiRubricRating[],
  reference: readonly AiRubricRating[],
  thresholds: AiRubricThresholds = DEFAULT_AI_RUBRIC_THRESHOLDS
) => {
  if (
    candidate.length < 2 ||
    candidate.length !== reference.length ||
    [...candidate, ...reference].some((row) => !completeRating(row))
  ) {
    throw new Error("Reference pair needs matched valid independent ratings");
  }
  const metrics = {
    craftDelta: average(candidate) - average(reference),
    familyFit: rate(candidate.map(({ familyFit }) => familyFit === true)),
    nativeLegibility: rate(
      candidate.map(({ nativeLegibility }) => nativeLegibility === true)
    ),
    shipUnchanged: rate(
      candidate.map(({ shipUnchanged }) => shipUnchanged === true)
    ),
  };
  return {
    independentEvidenceVerified: false,
    metrics,
    passes:
      candidate.every(({ criticalDefect }) => !criticalDefect) &&
      median(candidate) >= 9 &&
      metrics.craftDelta >= thresholds.craftDelta &&
      metrics.familyFit >= thresholds.familyFit &&
      metrics.nativeLegibility >= thresholds.nativeLegibility &&
      metrics.shipUnchanged >= thresholds.shipUnchanged,
    qualificationScope: "diagnostic-unidentified-rating-arrays" as const,
  };
};

/** Small control sets report development evidence. Qualification additionally requires
 * 100 canonical stimuli, 20 critical controls and consistent presentation controls. */
// eslint-disable-next-line complexity
export const qualifyAiReviewEnsemble = (
  stimuli: readonly AiQualificationStimulus[],
  reviews: readonly AiReview[],
  thresholds: AiRubricThresholds = DEFAULT_AI_RUBRIC_THRESHOLDS
) => {
  const stimulusById = new Map(stimuli.map((row) => [row.id, row]));
  const canonical = stimuli.filter(
    ({ presentationOf }) => presentationOf === undefined
  );
  const canonicalByHash = new Map(
    canonical.map((stimulus) => [stimulus.canonicalArtifactHash, stimulus])
  );
  if (
    stimulusById.size !== stimuli.length ||
    canonicalByHash.size !== canonical.length ||
    stimuli.some(
      (row) =>
        !row.id.trim() ||
        !HASH.test(row.canonicalArtifactHash) ||
        row.hostInjected !== true ||
        row.recognitionChoices.length < 3 ||
        new Set(row.recognitionChoices).size !==
          row.recognitionChoices.length ||
        !row.recognitionChoices.includes(row.recognitionAnswer) ||
        (row.presentationOf !== undefined &&
          (!HASH.test(row.presentationOf) || !row.presentationOrder))
    )
  ) {
    throw new Error(
      "Invalid or duplicate host-injected qualification stimulus"
    );
  }
  const semanticLabelsValidated = canonical.every(semanticLabelIsValidated);
  for (const presentation of stimuli.filter(
    ({ presentationOf }) => presentationOf !== undefined
  )) {
    const original = canonicalByHash.get(presentation.presentationOf ?? "");
    if (
      !original ||
      original.control !== presentation.control ||
      original.recognitionAnswer !== presentation.recognitionAnswer ||
      JSON.stringify(original.recognitionChoices) !==
        JSON.stringify(presentation.recognitionChoices)
    ) {
      throw new Error(
        "Presentation control is not bound to its canonical stimulus"
      );
    }
  }
  const criticalCount = canonical.filter(
    ({ control }) => control === "objective-corruption"
  ).length;
  if (
    !criticalCount ||
    !canonical.some(({ control }) => control === "source-baseline")
  ) {
    throw new Error(
      "Both objective-corruption and source-baseline controls are required"
    );
  }
  const identities = new Set(
    reviews.map(({ reviewer }) => reviewerId(reviewer))
  );
  if (
    identities.size < 2 ||
    reviews.some(
      (row) =>
        !HASH.test(row.stimulusHash) ||
        row.blind !== true ||
        !row.reviewer.provider.trim() ||
        !row.reviewer.model.trim() ||
        (row.recognitionChoice !== null &&
          !stimuli
            .find(
              (stimulus) =>
                stimulus.canonicalArtifactHash === row.stimulusHash &&
                (row.stimulusId === undefined || stimulus.id === row.stimulusId)
            )
            ?.recognitionChoices.includes(row.recognitionChoice)) ||
        !validRating(row)
    )
  ) {
    throw new Error(
      "At least two valid distinct reviewer identities are required"
    );
  }
  const seen = new Set<string>();
  const resolvedReviews = new Map<AiReview, AiQualificationStimulus>();
  for (const review of reviews) {
    const matches = stimuli.filter(
      (stimulus) =>
        stimulus.canonicalArtifactHash === review.stimulusHash &&
        (review.stimulusId === undefined || stimulus.id === review.stimulusId)
    );
    if (matches.length !== 1) {
      throw new Error(
        "Ambiguous or unexpected AI review stimulus; repeated bytes require stimulusId"
      );
    }
    const stimulus = matches[0] as AiQualificationStimulus;
    const key = `${stimulus.id}/${reviewerId(review.reviewer)}`;
    if (seen.has(key)) {
      throw new Error("Unexpected or duplicate AI review");
    }
    seen.add(key);
    resolvedReviews.set(review, stimulus);
  }
  const outcomes = stimuli.map((stimulus) => {
    const rows = reviews.filter(
      (review) => resolvedReviews.get(review)?.id === stimulus.id
    );
    const rowReviewers = new Set(
      rows.map(({ reviewer }) => reviewerId(reviewer))
    );
    const authorId = stimulus.author ? reviewerId(stimulus.author) : null;
    if (rowReviewers.size < 2) {
      return {
        criticalFlags: 0,
        id: stimulus.id,
        status: "missing" as const,
        stimulus,
      };
    }
    if (authorId && rowReviewers.has(authorId)) {
      throw new Error(`Author cannot judge authored artifact: ${stimulus.id}`);
    }
    const criticalFlags = rows.filter(
      ({ criticalDefect }) => criticalDefect
    ).length;
    const recognitionMatches = rows.map(
      ({ recognitionChoice }) =>
        recognitionChoice === stimulus.recognitionAnswer
    );
    const semanticLabelValidated = semanticLabelIsValidated(stimulus);
    const decisions = new Set(rows.map(({ shipUnchanged }) => shipUnchanged));
    let status: "accepted" | "quarantined" | "rejected" | "uncertain";
    if (rows.some(({ criticalDefect }) => criticalDefect === null)) {
      status = "quarantined";
    } else if (criticalFlags) {
      status = "quarantined";
    } else if (!semanticLabelValidated) {
      status = "uncertain";
    } else if (
      decisions.size > 1 ||
      rows.some(
        ({ familyFit, nativeLegibility, recognitionChoice, shipUnchanged }) =>
          familyFit === null ||
          nativeLegibility === null ||
          recognitionChoice === null ||
          shipUnchanged === null
      )
    ) {
      status = "uncertain";
    } else if (
      rows.every(
        ({ familyFit, nativeLegibility, shipUnchanged }) =>
          familyFit && nativeLegibility && shipUnchanged
      ) &&
      recognitionMatches.every(Boolean) &&
      median(rows) >= 9
    ) {
      status = "accepted";
    } else {
      status = "rejected";
    }
    const decisive =
      status === "accepted" ||
      status === "rejected" ||
      (criticalFlags === rows.length &&
        decisions.size === 1 &&
        decisions.has(false));
    return {
      criticalFlags,
      decisive,
      id: stimulus.id,
      semanticLabelValidated,
      status,
      stimulus,
    };
  });
  const canonicalOutcomes = outcomes.filter(
    ({ stimulus }) => stimulus.presentationOf === undefined
  );
  const critical = canonicalOutcomes.filter(
    ({ stimulus }) => stimulus.control === "objective-corruption"
  );
  const positives = canonicalOutcomes.filter(
    ({ stimulus }) => stimulus.control === "source-baseline"
  );
  const detected = critical.filter(
    ({ criticalFlags }) => criticalFlags > 0
  ).length;
  const approvedPositive = positives.filter(
    ({ status }) => status === "accepted"
  ).length;
  const corruptionDefectRecall = detected / critical.length;
  const sourceAcceptanceRate = approvedPositive / positives.length;
  const corruptAccepted = critical.filter(
    ({ status }) => status === "accepted"
  ).length;
  const assessmentCoverage =
    canonicalOutcomes.filter(({ status }) => status !== "missing").length /
    canonicalOutcomes.length;
  const decisionCoverage =
    canonicalOutcomes.filter(({ decisive }) => decisive).length /
    canonicalOutcomes.length;
  const presentations = stimuli.filter(
    ({ presentationOf }) => presentationOf !== undefined
  );
  const presentationConsistency = presentations.every((presentation) => {
    const originalHash = presentation.presentationOf as string;
    return [...identities].every((identity) => {
      const find = (id: string) =>
        reviews.find(
          (row) =>
            resolvedReviews.get(row)?.id === id &&
            reviewerId(row.reviewer) === identity
        );
      const original = find(canonicalByHash.get(originalHash)?.id ?? "");
      const repeated = find(presentation.id);
      if (!original || !repeated) {
        return false;
      }
      return (
        original.craftRating === repeated.craftRating &&
        original.criticalDefect === repeated.criticalDefect &&
        original.familyFit === repeated.familyFit &&
        original.nativeLegibility === repeated.nativeLegibility &&
        original.recognitionChoice === repeated.recognitionChoice &&
        original.shipUnchanged === repeated.shipUnchanged
      );
    });
  });
  const kinds = new Set(
    stimuli.flatMap(({ presentationOrder }) =>
      presentationOrder ? [presentationOrder] : []
    )
  );
  const controlsPass =
    corruptionDefectRecall >= thresholds.corruptionDefectRecall &&
    sourceAcceptanceRate >= thresholds.sourceAcceptance &&
    corruptAccepted === 0;
  const qualificationPopulationReady =
    canonical.length >= 100 &&
    criticalCount >= 20 &&
    kinds.has("identical") &&
    kinds.has("reversed") &&
    presentationConsistency;
  const candidates = canonicalOutcomes.filter(
    ({ stimulus }) => stimulus.control === "candidate"
  );
  return {
    assessmentCoverage,
    candidates,
    controlsPass,
    corruptAccepted,
    corruptionDefectRecall,
    decisionCoverage,
    generalGeneratedCriticQualified: false,
    labelAuthority: semanticLabelsValidated
      ? ("objective-controls+independent-ai-semantic-review" as const)
      : ("unvalidated-semantic-labels" as const),
    outcomes,
    presentationConsistency,
    qualificationPopulationReady,
    qualificationScope: "host-injected-control-distribution" as const,
    qualified:
      controlsPass &&
      semanticLabelsValidated &&
      qualificationPopulationReady &&
      decisionCoverage >= thresholds.coverage &&
      candidates.length > 0 &&
      candidates.every(({ status }) => status === "accepted"),
    reviewers: [...identities].toSorted(),
    semanticLabelsValidated,
    sourceAcceptanceRate,
  };
};

export interface AiPanelQualificationStimulus {
  artifactHash: string;
  canonical: boolean;
  /** Frozen natural-population identity. Legacy diagnostic/control rows may
   * omit these fields; the provenance wrapper requires them for every
   * canonical natural-generated row. */
  conceptId?: string;
  craftEvidenceHash: string;
  defectClasses: readonly string[];
  familyId?: string;
  generationKind: "natural-generated" | "objective-injected" | "source-control";
  id: string;
  nativeSize: 16 | 24;
  /** Ordered hashes of the exact images inside the reviewer presentation. */
  orderedAttachmentHashes: readonly string[];
  paint: "filled" | "outlined";
  presentationOf?: string;
  presentationOfArtifactHash?: string;
  presentationOrder?: "identical" | "reversed";
  producerEvidenceHash?: string;
  /** Every model lineage that authored or repaired this artifact. Empty is
   * valid only for controls without a model producer. */
  producerLineages: readonly string[];
  recognitionEvidenceHash: string;
  requestedSlotId?: string;
  sealed: true;
  sourceLineageHash?: string;
}

export interface AiCriticPrediction {
  artifactHash: string;
  critic: AiReviewerIdentity;
  decision: "approve" | "reject" | "uncertain";
  sealed: true;
  sealedAt: number;
  stimulusId: string;
}

export interface IndependentAiPanelReview {
  artifactHash: string;
  craftEvidenceHash: string;
  critical: boolean | null;
  decision: "approve" | "reject" | "uncertain";
  panelEvidenceAvailableAt: number;
  recognitionEvidenceHash: string;
  reviewer: AiReviewerIdentity;
  stimulusId: string;
}

export interface AiPanelQualificationThresholds {
  approvalPrecision: number;
  criticalRecall: number;
  decisionCoverage: number;
}

const DEFAULT_AI_PANEL_QUALIFICATION_THRESHOLDS: AiPanelQualificationThresholds =
  {
    approvalPrecision: 0.95,
    criticalRecall: 0.9,
    decisionCoverage: 0.8,
  };

/** Pure agreement measurement over caller-ingested receipts. It does not establish
 * human agreement, objective craft truth, or the provenance of those receipts. */
// eslint-disable-next-line complexity
export const qualifyCriticAgainstIndependentAiPanel = (
  stimuli: readonly AiPanelQualificationStimulus[],
  predictions: readonly AiCriticPrediction[],
  panelReviews: readonly IndependentAiPanelReview[],
  thresholds: AiPanelQualificationThresholds = DEFAULT_AI_PANEL_QUALIFICATION_THRESHOLDS
) => {
  if (
    Object.values(thresholds).some(
      (value) => !Number.isFinite(value) || value < 0 || value > 1
    )
  ) {
    throw new Error("AI panel qualification thresholds must be within 0..1");
  }
  const stimulusById = new Map(stimuli.map((row) => [row.id, row]));
  const canonical = stimuli.filter(({ canonical: isCanonical }) => isCanonical);
  const canonicalArtifactHashes = new Set(
    canonical.map((row) => row.artifactHash)
  );
  if (
    stimulusById.size !== stimuli.length ||
    canonicalArtifactHashes.size !== canonical.length ||
    stimuli.some(
      // Runtime schema validation is intentionally centralized here.
      // eslint-disable-next-line complexity
      (row) =>
        !row.id.trim() ||
        row.sealed !== true ||
        typeof row.canonical !== "boolean" ||
        !["natural-generated", "objective-injected", "source-control"].includes(
          row.generationKind
        ) ||
        ![16, 24].includes(row.nativeSize) ||
        !["filled", "outlined"].includes(row.paint) ||
        !Array.isArray(row.orderedAttachmentHashes) ||
        row.orderedAttachmentHashes.length < 2 ||
        row.orderedAttachmentHashes.some((value) => !HASH.test(value)) ||
        !Array.isArray(row.defectClasses) ||
        new Set(row.defectClasses).size !== row.defectClasses.length ||
        row.defectClasses.some((value) => !value.trim()) ||
        ![
          row.artifactHash,
          row.craftEvidenceHash,
          row.recognitionEvidenceHash,
        ].every((value) => HASH.test(value)) ||
        row.canonical === (row.presentationOf !== undefined) ||
        (row.presentationOrder !== undefined &&
          !["identical", "reversed"].includes(row.presentationOrder)) ||
        (row.presentationOf !== undefined &&
          (!row.presentationOrder ||
            !HASH.test(row.presentationOfArtifactHash ?? "") ||
            row.presentationOf === row.id)) ||
        (row.presentationOf === undefined &&
          row.presentationOfArtifactHash !== undefined)
    )
  ) {
    throw new Error("Invalid, unsealed or duplicate AI panel stimulus");
  }
  for (const control of stimuli.filter(
    ({ canonical: isCanonical }) => !isCanonical
  )) {
    const original = stimulusById.get(control.presentationOf ?? "");
    const expectedAttachments =
      control.presentationOrder === "reversed"
        ? original?.orderedAttachmentHashes.toReversed()
        : original?.orderedAttachmentHashes;
    if (
      !original?.canonical ||
      control.presentationOfArtifactHash !== original.artifactHash ||
      (control.presentationOrder === "reversed" &&
        JSON.stringify(expectedAttachments) ===
          JSON.stringify(original.orderedAttachmentHashes)) ||
      JSON.stringify(control.orderedAttachmentHashes) !==
        JSON.stringify(expectedAttachments) ||
      (control.presentationOrder === "identical" &&
        control.artifactHash !== original.artifactHash)
    ) {
      throw new Error(
        "Presentation control is not bound to canonical evidence"
      );
    }
  }
  const criticIds = new Set(
    predictions.map(({ critic }) => reviewerId(critic))
  );
  if (
    criticIds.size !== 1 ||
    predictions.some(
      (row) =>
        row.sealed !== true ||
        !Number.isFinite(row.sealedAt) ||
        row.sealedAt < 0 ||
        !["approve", "reject", "uncertain"].includes(row.decision) ||
        !row.critic.model.trim() ||
        !row.critic.provider.trim()
    )
  ) {
    throw new Error("One valid sealed critic identity is required");
  }
  const criticId = [...criticIds][0] ?? "";
  const criticLineages = new Set(
    predictions.map(({ critic }) => critic.baseModelLineage?.trim())
  );
  const panelIds = new Set(
    panelReviews.map(({ reviewer }) => reviewerId(reviewer))
  );
  const panelLineages = new Set(
    panelReviews.map(({ reviewer }) => reviewer.baseModelLineage?.trim())
  );
  if (
    criticLineages.size !== 1 ||
    criticLineages.has(undefined) ||
    criticLineages.has("") ||
    panelIds.size !== 2 ||
    panelLineages.size !== 2 ||
    panelLineages.has(undefined) ||
    panelLineages.has("") ||
    panelLineages.has([...criticLineages][0]) ||
    panelIds.has(criticId) ||
    panelReviews.some(
      (row) =>
        !row.reviewer.model.trim() ||
        !row.reviewer.provider.trim() ||
        !Number.isFinite(row.panelEvidenceAvailableAt) ||
        row.panelEvidenceAvailableAt < 0 ||
        !["approve", "reject", "uncertain"].includes(row.decision) ||
        ![true, false, null].includes(row.critical) ||
        (row.decision === "uncertain") !== (row.critical === null) ||
        (row.critical === true && row.decision !== "reject")
    )
  ) {
    throw new Error(
      "Critic and two panel reviewers need three distinct base-model lineages"
    );
  }
  const evaluatorLineages = new Set([...criticLineages, ...panelLineages]);
  if (
    stimuli.some(
      ({ generationKind, producerLineages }) =>
        !Array.isArray(producerLineages) ||
        (generationKind === "natural-generated" &&
          producerLineages.length === 0) ||
        new Set(producerLineages).size !== producerLineages.length ||
        producerLineages.some(
          (lineage) => !lineage.trim() || evaluatorLineages.has(lineage.trim())
        )
    )
  ) {
    throw new Error(
      "Author or repairer lineage overlaps the critic or independent panel"
    );
  }
  const predictionByStimulus = new Map<string, AiCriticPrediction>();
  for (const prediction of predictions) {
    const stimulus = stimulusById.get(prediction.stimulusId);
    if (
      predictionByStimulus.has(prediction.stimulusId) ||
      !stimulus ||
      prediction.artifactHash !== stimulus.artifactHash
    ) {
      throw new Error(
        "Unexpected, duplicate or incorrectly bound critic prediction"
      );
    }
    predictionByStimulus.set(prediction.stimulusId, prediction);
  }
  const panelByStimulus = new Map<string, IndependentAiPanelReview[]>();
  const panelSeen = new Set<string>();
  for (const review of panelReviews) {
    const stimulus = stimulusById.get(review.stimulusId);
    const identity = reviewerId(review.reviewer);
    const key = `${review.stimulusId}/${identity}`;
    if (
      panelSeen.has(key) ||
      !stimulus ||
      review.artifactHash !== stimulus.artifactHash ||
      review.craftEvidenceHash !== stimulus.craftEvidenceHash ||
      review.recognitionEvidenceHash !== stimulus.recognitionEvidenceHash
    ) {
      throw new Error(
        "Unexpected, duplicate or incorrectly bound panel review"
      );
    }
    panelSeen.add(key);
    panelByStimulus.set(review.stimulusId, [
      ...(panelByStimulus.get(review.stimulusId) ?? []),
      review,
    ]);
  }
  const outcomes = stimuli.map((stimulus) => {
    const prediction = predictionByStimulus.get(stimulus.id);
    const panel = panelByStimulus.get(stimulus.id) ?? [];
    const completePanel =
      panel.length === panelIds.size &&
      new Set(panel.map(({ reviewer }) => reviewerId(reviewer))).size ===
        panelIds.size;
    if (
      prediction &&
      panel.some(
        ({ panelEvidenceAvailableAt }) =>
          prediction.sealedAt >= panelEvidenceAvailableAt
      )
    ) {
      throw new Error("Critic prediction was not sealed before panel reveal");
    }
    const decisions = new Set(panel.map(({ decision }) => decision));
    const criticalFlags = new Set(panel.map(({ critical }) => critical));
    const panelResolved =
      completePanel &&
      decisions.size === 1 &&
      !decisions.has("uncertain") &&
      criticalFlags.size === 1 &&
      !criticalFlags.has(null);
    return {
      completePanel,
      criticDecision: prediction?.decision ?? "missing",
      id: stimulus.id,
      panelCritical: panelResolved ? panel[0]?.critical === true : null,
      panelDecision: panelResolved ? (panel[0]?.decision ?? null) : null,
      panelResolved,
      stimulus,
    };
  });
  const canonicalOutcomes = outcomes.filter(
    ({ stimulus }) => stimulus.canonical
  );
  const approvals = canonicalOutcomes.filter(
    ({ criticDecision }) => criticDecision === "approve"
  );
  const critical = canonicalOutcomes.filter(
    ({ panelCritical }) => panelCritical === true
  );
  const approvalPrecision = approvals.length
    ? approvals.filter(({ panelDecision }) => panelDecision === "approve")
        .length / approvals.length
    : 0;
  const criticalRecall = critical.length
    ? critical.filter(({ criticDecision }) => criticDecision === "reject")
        .length / critical.length
    : 0;
  const decisionCoverage =
    canonicalOutcomes.filter(
      ({ criticDecision, panelResolved }) =>
        panelResolved && ["approve", "reject"].includes(criticDecision)
    ).length / canonicalOutcomes.length;
  const controlOutcomes = outcomes.filter(
    ({ stimulus }) => !stimulus.canonical
  );
  const presentationKinds = new Set(
    controlOutcomes.map(({ stimulus }) => stimulus.presentationOrder)
  );
  const presentationConsistency = controlOutcomes.every((control) => {
    const original = outcomes.find(
      ({ id }) => id === control.stimulus.presentationOf
    );
    return (
      original !== undefined &&
      original.criticDecision !== "missing" &&
      control.criticDecision !== "missing" &&
      original.criticDecision === control.criticDecision &&
      original.panelDecision === control.panelDecision &&
      original.panelCritical === control.panelCritical &&
      original.panelResolved &&
      control.panelResolved
    );
  });
  const unresolvedPanelLabels = canonicalOutcomes.filter(
    ({ panelResolved }) => !panelResolved
  ).length;
  const missingPanelRows = outcomes.reduce(
    (count, { id }) =>
      count + panelIds.size - (panelByStimulus.get(id)?.length ?? 0),
    0
  );
  const missingPredictions = outcomes.filter(
    ({ criticDecision }) => criticDecision === "missing"
  ).length;
  const natural = canonicalOutcomes.filter(
    ({ stimulus }) => stimulus.generationKind === "natural-generated"
  );
  const naturalCritical = natural.filter(
    ({ panelCritical }) => panelCritical === true
  );
  const naturalApprovals = natural.filter(
    ({ criticDecision }) => criticDecision === "approve"
  );
  const naturalApprovalPrecision = naturalApprovals.length
    ? naturalApprovals.filter(
        ({ panelDecision }) => panelDecision === "approve"
      ).length / naturalApprovals.length
    : 0;
  const naturalCriticalRecall = naturalCritical.length
    ? naturalCritical.filter(
        ({ criticDecision }) => criticDecision === "reject"
      ).length / naturalCritical.length
    : 0;
  // eslint-disable-next-line unicorn/consistent-function-scoping
  const summarize = (rows: typeof canonicalOutcomes) => {
    const rowCritical = rows.filter(
      ({ panelCritical }) => panelCritical === true
    );
    const rowApprovals = rows.filter(
      ({ criticDecision }) => criticDecision === "approve"
    );
    return {
      approvalPrecision: rowApprovals.length
        ? rowApprovals.filter(
            ({ panelDecision }) => panelDecision === "approve"
          ).length / rowApprovals.length
        : 0,
      approvalPredictionCount: rowApprovals.length,
      count: rows.length,
      criticalCount: rowCritical.length,
      criticalRecall: rowCritical.length
        ? rowCritical.filter(
            ({ criticDecision }) => criticDecision === "reject"
          ).length / rowCritical.length
        : 0,
      decisionCoverage: rows.length
        ? rows.filter(
            ({ criticDecision, panelResolved }) =>
              panelResolved && ["approve", "reject"].includes(criticDecision)
          ).length / rows.length
        : 0,
      unresolvedPanelLabels: rows.filter(({ panelResolved }) => !panelResolved)
        .length,
    };
  };
  const strata = [
    ["outlined", 16],
    ["outlined", 24],
    ["filled", 16],
    ["filled", 24],
  ] as const;
  const naturalStrataReady = strata.every(([paint, nativeSize]) => {
    const rows = natural.filter(
      ({ stimulus }) =>
        stimulus.paint === paint && stimulus.nativeSize === nativeSize
    );
    return (
      rows.length >= 20 &&
      rows.filter(({ panelCritical }) => panelCritical === true).length >= 5 &&
      rows.filter(({ criticDecision }) => criticDecision === "approve")
        .length >= 5
    );
  });
  const perStratum = Object.fromEntries(
    strata.map(([paint, nativeSize]) => {
      const rows = natural.filter(
        ({ stimulus }) =>
          stimulus.paint === paint && stimulus.nativeSize === nativeSize
      );
      return [`${paint}-${nativeSize}`, summarize(rows)];
    })
  );
  const defectClasses = new Set(
    natural.flatMap(({ stimulus }) => stimulus.defectClasses)
  );
  const perDefectClass = Object.fromEntries(
    [...defectClasses]
      .toSorted()
      .map((defectClass) => [
        defectClass,
        summarize(
          natural.filter(({ stimulus }) =>
            stimulus.defectClasses.includes(defectClass)
          )
        ),
      ])
  );
  const populationReady =
    canonical.length >= 100 &&
    natural.length >= 80 &&
    naturalCritical.length >= 20 &&
    naturalApprovals.length >= 20 &&
    naturalStrataReady &&
    missingPanelRows === 0 &&
    missingPredictions === 0 &&
    presentationKinds.has("identical") &&
    presentationKinds.has("reversed") &&
    presentationConsistency;
  return {
    approvalPrecision,
    approvalPredictionCount: approvals.length,
    canonicalCount: canonical.length,
    criticalCount: critical.length,
    criticalRecall,
    decisionCoverage,
    generalGeneratedCriticQualified: false,
    missingPanelRows,
    missingPredictions,
    naturalApprovalPrecision,
    naturalCriticalRecall,
    naturalGeneratedCount: natural.length,
    outcomes,
    panelReviewers: [...panelIds].toSorted(),
    perDefectClass,
    perStratum,
    populationReady,
    presentationConsistency,
    qualificationScope: "agreement-with-independent-ai-panel" as const,
    qualified:
      populationReady &&
      approvalPrecision >= thresholds.approvalPrecision &&
      criticalRecall >= thresholds.criticalRecall &&
      naturalApprovalPrecision >= thresholds.approvalPrecision &&
      naturalCriticalRecall >= thresholds.criticalRecall &&
      decisionCoverage >= thresholds.decisionCoverage,
    unresolvedPanelLabels,
  };
};
