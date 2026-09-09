import { createHash } from "node:crypto";

/** The pilot's advancement rule, separate from the judge it qualifies.
 * Missing items, repeated pairs, unknown spend and exposed holdouts cannot
 * disappear into an average. These are engineering gates, not taste claims. */
export interface InstrumentTrial {
  defect: string;
  pairId: string;
  /** SHA-256 of the canonical stimulus content, excluding presentation order
   * and pair labels. The collector must bind this to retained actual evidence. */
  evidenceHash: string;
  order: "forward" | "reverse";
  decision: "correct" | "incorrect" | "abstain";
  controlRejected: boolean | null;
}

export interface ProductionCriticQualificationReceipt {
  agreementMetricsQualified?: boolean;
  criticIdentity?: unknown;
  evidenceManifestHash?: string;
  generalGeneratedCriticQualified: boolean;
  metrics?: unknown;
  metricsHash?: string;
  populationIdentityValidated?: boolean;
  provenanceKind?: string;
  provenanceValidated: boolean;
  qualificationScope: string;
  qualificationVersionHash: string;
  qualified: boolean;
}

export interface ProductionCriticQualificationIdentity {
  readonly criticIdentityHash: string;
  readonly criticReviewerId: string;
  readonly evidenceManifestHash: string;
  readonly metricsHash: string;
  readonly productionReviewManifestHash: string;
  readonly qualificationVersionHash: string;
  readonly reviewSetHash: string;
}

export interface ProductionCriticReviewRequirement {
  readonly artifactHash: string;
  readonly authorId: string;
  readonly authorLineage: string;
  readonly conceptId: string;
  readonly familyId: string;
  readonly nativePresentationHashes: readonly [string, string];
  readonly nativeSize: 16 | 24;
  readonly paint: "filled" | "outlined";
  readonly labels: {
    readonly craftRating: number;
    readonly criticalDefect: boolean;
    readonly familyFit: boolean;
    readonly nativeLegibility: boolean;
    readonly recognitionAdjudication: "match" | "mismatch" | "uncertain";
    readonly recognitionChoice: "described" | "unknown";
    readonly recognitionCorrect: boolean | null;
    readonly shipUnchanged: boolean;
  };
  readonly recognitionEvidenceHash: string;
  readonly reviewEvidenceHash: string;
  readonly reviewerId: string;
  readonly requestIntentHash: string;
  readonly slotId: string;
}

interface ProductionCriticReviewAuthority {
  readonly reviews: readonly ProductionCriticReviewRequirement[];
}

export type ProductionCriticQualificationCapability =
  ProductionCriticQualificationIdentity;

const activeCriticCapabilities = new WeakMap<
  object,
  ProductionCriticReviewAuthority | null
>();
const HASH = /^[a-f0-9]{64}$/u;
const sha256 = (value: string) =>
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
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const immutableSnapshot = <T>(value: T): T => {
  if (value !== null && typeof value === "object") {
    for (const entry of Object.values(value)) {
      immutableSnapshot(entry);
    }
    Object.freeze(value);
  }
  return value;
};
const criticReviewerId = (criticIdentity: unknown) => {
  if (!record(criticIdentity)) {
    return sha256("invalid-critic-identity");
  }
  return sha256(
    canonical({
      actor: criticIdentity.actor,
      instrumentHash: criticIdentity.instrumentHash,
      routeHash: criticIdentity.routeHash,
    })
  );
};

// The receipt is a deliberately explicit fail-closed conjunction.
// eslint-disable-next-line complexity
const verifiedCollectorReceipt = (
  value: unknown
): ProductionCriticQualificationReceipt | null => {
  if (!record(value) || !record(value.metrics)) {
    return null;
  }
  const receipt = value as unknown as ProductionCriticQualificationReceipt;
  const { metrics } = value;
  const metricsHash = sha256(canonical(metrics));
  const { criticIdentity } = value;
  if (
    (value.provenanceKind !== "collector-bound-native-evidence-v1" &&
      value.provenanceKind !== "collector-bound-live-transport-evidence-v2") ||
    value.qualificationScope !== "agreement-with-independent-ai-panel" ||
    value.provenanceValidated !== true ||
    value.populationIdentityValidated !== true ||
    value.agreementMetricsQualified !== true ||
    value.generalGeneratedCriticQualified !== true ||
    value.qualified !== true ||
    metrics.qualified !== true ||
    !record(criticIdentity) ||
    !record(criticIdentity.actor) ||
    !String(criticIdentity.actor.baseModelLineage ?? "").trim() ||
    !String(criticIdentity.actor.model ?? "").trim() ||
    !String(criticIdentity.actor.provider ?? "").trim() ||
    !HASH.test(String(criticIdentity.instrumentHash ?? "")) ||
    !HASH.test(String(criticIdentity.routeHash ?? "")) ||
    criticIdentity.sessionPolicy !== "distinct-production-session-required" ||
    !Array.isArray(criticIdentity.qualificationSessionIds) ||
    !criticIdentity.qualificationSessionIds.length ||
    criticIdentity.qualificationSessionIds.some(
      (sessionId) => typeof sessionId !== "string" || !sessionId.trim()
    ) ||
    new Set(criticIdentity.qualificationSessionIds).size !==
      criticIdentity.qualificationSessionIds.length ||
    metrics.populationReady !== true ||
    metrics.presentationConsistency !== true ||
    metrics.missingPredictions !== 0 ||
    metrics.missingPanelRows !== 0 ||
    !Number.isSafeInteger(metrics.canonicalCount) ||
    Number(metrics.canonicalCount) <= 0 ||
    !Number.isSafeInteger(metrics.unresolvedPanelLabels) ||
    Number(metrics.unresolvedPanelLabels) < 0 ||
    Number(metrics.unresolvedPanelLabels) > Number(metrics.canonicalCount) ||
    typeof metrics.decisionCoverage !== "number" ||
    !Number.isFinite(metrics.decisionCoverage) ||
    metrics.decisionCoverage < 0.8 ||
    metrics.decisionCoverage >
      (Number(metrics.canonicalCount) - Number(metrics.unresolvedPanelLabels)) /
        Number(metrics.canonicalCount) ||
    !HASH.test(String(value.evidenceManifestHash ?? "")) ||
    value.metricsHash !== metricsHash
  ) {
    return null;
  }
  const versionCore = {
    agreementMetricsQualified: value.agreementMetricsQualified,
    criticIdentity,
    evidenceManifestHash: value.evidenceManifestHash,
    generalGeneratedCriticQualified: value.generalGeneratedCriticQualified,
    metricsHash: value.metricsHash,
    populationIdentityValidated: value.populationIdentityValidated,
    provenanceKind: value.provenanceKind,
    provenanceValidated: value.provenanceValidated,
    qualificationScope: value.qualificationScope,
    qualified: value.qualified,
  };
  return value.qualificationVersionHash === sha256(canonical(versionCore))
    ? receipt
    : null;
};

/** This is a trusted-code boundary. `compute` must rerun the collector verifier;
 * serialized reports never enter it. The capability is live only during the
 * synchronous callback and cannot be retained or reconstructed by shape. */
export const withComputedProductionCriticQualification = <T>(
  compute: () => unknown,
  consume: (capability: ProductionCriticQualificationCapability) => T
): T => {
  const receipt = verifiedCollectorReceipt(compute());
  if (!(receipt?.evidenceManifestHash && receipt.metricsHash)) {
    throw new Error("Collector critic qualification receipt is invalid");
  }
  const capability = Object.freeze({
    criticIdentityHash: sha256(canonical(receipt.criticIdentity)),
    criticReviewerId: criticReviewerId(receipt.criticIdentity),
    evidenceManifestHash: receipt.evidenceManifestHash,
    metricsHash: receipt.metricsHash,
    productionReviewManifestHash: sha256("unbound-production-reviews"),
    qualificationVersionHash: receipt.qualificationVersionHash,
    reviewSetHash: sha256("unbound-production-review-set"),
  });
  activeCriticCapabilities.set(capability, null);
  try {
    return consume(capability);
  } finally {
    activeCriticCapabilities.delete(capability);
  }
};

interface ComputedProductionReviewSet {
  authorEvidenceVerified?: boolean;
  kind?: string;
  qualificationManifestSha256?: string;
  reviewManifestSha256?: string;
  reviews?: unknown;
  reviewSetHash?: string;
}

const verifiedProductionReviewSet = (
  value: unknown,
  receipt: ProductionCriticQualificationReceipt
) => {
  if (!record(value)) {
    return null;
  }
  const candidate = value as ComputedProductionReviewSet;
  if (
    candidate.authorEvidenceVerified !== true ||
    candidate.kind !== "verified-production-critic-review-set-v1" ||
    candidate.qualificationManifestSha256 !== receipt.evidenceManifestHash ||
    !HASH.test(candidate.reviewManifestSha256 ?? "") ||
    !Array.isArray(candidate.reviews) ||
    !candidate.reviews.length ||
    candidate.reviewSetHash !== sha256(canonical(candidate.reviews))
  ) {
    return null;
  }
  const reviews = immutableSnapshot(
    structuredClone(candidate.reviews)
  ) as ProductionCriticReviewAuthority["reviews"];
  return Object.freeze({
    ...candidate,
    reviews,
  }) as Required<ComputedProductionReviewSet> & {
    reviews: ProductionCriticReviewAuthority["reviews"];
  };
};

/** Issues authority only after both the sealed qualification and every
 * production critic review are recomputed from collector-owned files. */
export const withComputedProductionCriticReviews = <T>(
  computeQualification: () => unknown,
  computeReviews: (
    qualification: ProductionCriticQualificationReceipt
  ) => unknown,
  consume: (capability: ProductionCriticQualificationCapability) => T
): T => {
  const receipt = verifiedCollectorReceipt(computeQualification());
  if (
    !(
      receipt?.evidenceManifestHash &&
      receipt.metricsHash &&
      receipt.criticIdentity
    )
  ) {
    throw new Error("Collector critic qualification receipt is invalid");
  }
  const reviewSet = verifiedProductionReviewSet(
    computeReviews(receipt),
    receipt
  );
  if (!reviewSet) {
    throw new Error("Collector production critic review set is invalid");
  }
  const capability = Object.freeze({
    criticIdentityHash: sha256(canonical(receipt.criticIdentity)),
    criticReviewerId: criticReviewerId(receipt.criticIdentity),
    evidenceManifestHash: receipt.evidenceManifestHash,
    metricsHash: receipt.metricsHash,
    productionReviewManifestHash: reviewSet.reviewManifestSha256,
    qualificationVersionHash: receipt.qualificationVersionHash,
    reviewSetHash: reviewSet.reviewSetHash,
  });
  activeCriticCapabilities.set(capability, { reviews: reviewSet.reviews });
  try {
    return consume(capability);
  } finally {
    activeCriticCapabilities.delete(capability);
  }
};

/** Serialized receipt fields are never authority. Only a process-local,
 * currently active capability issued around a verified computation can pass. */
export const criticQualificationReadyForProduction = (
  capability: unknown,
  expectedIdentity?: ProductionCriticQualificationIdentity,
  requirements?: readonly ProductionCriticReviewRequirement[]
) => {
  const identityKeys = [
    "criticIdentityHash",
    "criticReviewerId",
    "evidenceManifestHash",
    "metricsHash",
    "productionReviewManifestHash",
    "qualificationVersionHash",
    "reviewSetHash",
  ];
  if (
    !record(capability) ||
    !expectedIdentity ||
    !requirements?.length ||
    canonical(Object.keys(expectedIdentity).toSorted()) !==
      canonical(identityKeys.toSorted()) ||
    !Object.entries(expectedIdentity).every(
      ([key, value]) => HASH.test(value) && capability[key] === value
    )
  ) {
    return false;
  }
  const authority = activeCriticCapabilities.get(capability);
  if (!authority) {
    return false;
  }
  const reviewsBySlot = new Map(
    authority.reviews.map((review) => [review.slotId, review])
  );
  return (
    reviewsBySlot.size === authority.reviews.length &&
    new Set(requirements.map(({ slotId }) => slotId)).size ===
      requirements.length &&
    requirements.length === authority.reviews.length &&
    requirements.every((required) => {
      const review = reviewsBySlot.get(required.slotId);
      return (
        review !== undefined &&
        canonical({
          artifactHash: review.artifactHash,
          authorId: review.authorId,
          authorLineage: review.authorLineage,
          conceptId: review.conceptId,
          familyId: review.familyId,
          labels: review.labels,
          nativePresentationHashes: review.nativePresentationHashes,
          nativeSize: review.nativeSize,
          paint: review.paint,
          recognitionEvidenceHash: review.recognitionEvidenceHash,
          requestIntentHash: review.requestIntentHash,
          reviewEvidenceHash: review.reviewEvidenceHash,
          reviewerId: review.reviewerId,
          slotId: review.slotId,
        }) === canonical(required)
      );
    })
  );
};

export interface PilotItem {
  id: string;
  morphology: string;
  split: "development" | "completion" | "novel-family";
  variants: readonly string[];
}

interface PilotObservation {
  item: string;
  variant: string;
  accepted: boolean;
  newlyGenerated: boolean;
  exactReplay: boolean;
  familyPassed: boolean;
  manualArtworkEdits: number;
  artifactHash: string;
}

/** Wilson 95% interval. Order repetitions are never independent samples. */
const interval = (successes: number, count: number): [number, number] => {
  if (count === 0) {
    return [0, 1];
  }
  const z = 1.96;
  const rate = successes / count;
  const denominator = 1 + z ** 2 / count;
  const centre = (rate + z ** 2 / (2 * count)) / denominator;
  const half =
    (z * Math.sqrt((rate * (1 - rate)) / count + z ** 2 / (4 * count ** 2))) /
    denominator;
  return [centre - half, centre + half];
};

const validHash = (value: string): boolean => /^[a-f0-9]{64}$/u.test(value);

const completePair = (group: readonly InstrumentTrial[]): boolean =>
  group.length === 2 &&
  group.some((trial) => trial.order === "forward") &&
  group.some((trial) => trial.order === "reverse") &&
  group.every(
    (trial) =>
      typeof trial.pairId === "string" &&
      trial.pairId.trim().length > 0 &&
      validHash(trial.evidenceHash) &&
      ["correct", "incorrect", "abstain"].includes(trial.decision) &&
      [true, false, null].includes(trial.controlRejected)
  ) &&
  group[0].evidenceHash === group[1].evidenceHash;

export const qualifyInstrument = (
  required: readonly string[],
  trials: readonly InstrumentTrial[]
) =>
  required.map((defect) => {
    const pairs = new Map<string, InstrumentTrial[]>();
    for (const trial of trials.filter((entry) => entry.defect === defect)) {
      pairs.set(trial.pairId, [...(pairs.get(trial.pairId) ?? []), trial]);
    }
    const groups = [...pairs.values()];
    const complete =
      groups.every(completePair) &&
      new Set(groups.map((group) => group[0].evidenceHash)).size ===
        groups.length;
    const correct = groups.filter((group) =>
      group.every((trial) => trial.decision === "correct")
    ).length;
    // Abstention is not evidence that a control was accepted.
    const falseRejections = groups.filter((group) =>
      group.some((trial) => trial.controlRejected !== false)
    ).length;
    const count = groups.length;
    return {
      correct,
      correctInterval95: interval(correct, count),
      count,
      defect,
      falseRejectionInterval95: interval(falseRejections, count),
      falseRejections,
      passed:
        complete &&
        count >= 20 &&
        correct / count >= 0.9 &&
        falseRejections / count <= 0.1,
    };
  });

export interface PilotEvidence {
  /** Actual total across all attempts and evaluators, including failed calls. */
  actualUsd: number | null;
  ceilingUsd: number;
  /** Manifest and source/alias/family exclusion closure frozen before calls. */
  frozenManifestHash: string;
  observedManifestHash: string;
  holdoutExposed: boolean;
  items: readonly PilotItem[];
  observations: readonly PilotObservation[];
  requiredDefects: readonly string[];
  trials: readonly InstrumentTrial[];
}

const rosterProblems = (items: readonly PilotItem[]): string[] => {
  const reasons: string[] = [];
  const counts = (split: PilotItem["split"]) =>
    items.filter((item) => item.split === split).length;
  if (
    items.length !== 24 ||
    new Set(items.map((item) => item.id)).size !== 24 ||
    counts("development") !== 12 ||
    counts("completion") !== 6 ||
    counts("novel-family") !== 6
  ) {
    reasons.push(
      "The frozen roster must contain 24 distinct concepts: 12 development, 6 completion and 6 novel-family"
    );
  }
  const morphologies = new Set(items.map((item) => item.morphology));
  if (
    morphologies.size !== 6 ||
    [...morphologies].some((morphology) => {
      const group = items.filter((item) => item.morphology === morphology);
      return (
        group.filter((item) => item.split === "development").length !== 2 ||
        group.filter((item) => item.split === "completion").length !== 1 ||
        group.filter((item) => item.split === "novel-family").length !== 1
      );
    })
  ) {
    reasons.push(
      "Each of six morphology groups needs two development, one completion and one novel-family concept"
    );
  }
  if (
    items.some(
      (item) =>
        item.variants.length === 0 ||
        new Set(item.variants).size !== item.variants.length
    )
  ) {
    reasons.push(
      "Every concept needs a nonempty, distinct required-variant list"
    );
  }
  return reasons;
};

/** This function accepts collected evidence, not arbitrary judge scores.
 * Callers must retain the artifacts and trial records that support it. */
const withinBudget = (evidence: PilotEvidence): boolean =>
  Number.isFinite(evidence.ceilingUsd) &&
  evidence.ceilingUsd > 0 &&
  evidence.actualUsd !== null &&
  Number.isFinite(evidence.actualUsd) &&
  evidence.actualUsd >= 0 &&
  evidence.actualUsd <= evidence.ceilingUsd;

const artifactIdentityProblems = (
  observations: readonly PilotObservation[]
): string[] => {
  const reasons: string[] = [];
  const artifactOwners = new Map<string, string>();
  for (const observation of observations) {
    const owner = artifactOwners.get(observation.artifactHash);
    if (owner !== undefined && owner !== observation.item) {
      reasons.push(
        `Artifact reused across concepts: ${owner} and ${observation.item}`
      );
    }
    artifactOwners.set(observation.artifactHash, observation.item);
  }
  return reasons;
};

export const decidePilot = (evidence: PilotEvidence) => {
  const reasons = rosterProblems(evidence.items);
  if (!withinBudget(evidence)) {
    reasons.push("Spend is unknown, invalid or above the declared ceiling");
  }
  if (
    !/^[a-f0-9]{64}$/u.test(evidence.frozenManifestHash) ||
    evidence.observedManifestHash !== evidence.frozenManifestHash ||
    evidence.holdoutExposed
  ) {
    reasons.push("The frozen manifest changed or the holdout was exposed");
  }
  const expected = new Set(
    evidence.items.flatMap((item) =>
      item.variants.map((variant) => JSON.stringify([item.id, variant]))
    )
  );
  const observed = new Set<string>();
  reasons.push(...artifactIdentityProblems(evidence.observations));
  for (const observation of evidence.observations) {
    const key = JSON.stringify([observation.item, observation.variant]);
    if (!expected.has(key) || observed.has(key)) {
      reasons.push(`Unexpected or duplicated observation: ${key}`);
    }
    observed.add(key);
    if (
      !(
        observation.accepted &&
        observation.newlyGenerated &&
        observation.exactReplay &&
        observation.familyPassed &&
        observation.manualArtworkEdits === 0 &&
        /^[a-f0-9]{64}$/u.test(observation.artifactHash)
      )
    ) {
      reasons.push(`Required variant failed: ${key}`);
    }
  }
  for (const key of expected) {
    if (!observed.has(key)) {
      reasons.push(`Missing verdict: ${key}`);
    }
  }
  const instrument = qualifyInstrument(
    evidence.requiredDefects,
    evidence.trials
  );
  if (!instrument.length || instrument.some((entry) => !entry.passed)) {
    reasons.push("Required instrument classes are unqualified");
  }
  return {
    instrument,
    outcome: reasons.length ? ("blocked" as const) : ("pilot-proven" as const),
    reasons,
  };
};

/** Human-anchored classification evidence for the production craft judge.
 * One canonical stimulus is one observation; presentation repeats belong in
 * qualifyInstrument and cannot inflate this sample. Missing labels block. */
export interface CraftJudgeObservation {
  evidenceHash: string;
  human: "approve" | "reject" | null;
  criticalDefect: boolean | null;
  predicted: "approve" | "reject" | "uncertain";
}

export const qualifyCraftJudge = (
  observations: readonly CraftJudgeObservation[],
  controls: ReturnType<typeof qualifyInstrument>
) => {
  const reasons: string[] = [];
  const count = observations.length;
  if (count < 100) {
    reasons.push("At least 100 independent labeled stimuli are required");
  }
  if (
    observations.some((row) => !validHash(row.evidenceHash)) ||
    new Set(observations.map((row) => row.evidenceHash)).size !== count
  ) {
    reasons.push("Invalid or repeated stimulus identity");
  }
  if (
    observations.some(
      (row) =>
        !["approve", "reject"].includes(row.human ?? "") ||
        typeof row.criticalDefect !== "boolean" ||
        !["approve", "reject", "uncertain"].includes(row.predicted) ||
        (row.criticalDefect && row.human !== "reject")
    )
  ) {
    reasons.push("Missing or inconsistent human labels");
  }
  const approved = observations.filter((row) => row.predicted === "approve");
  const correctApprovals = approved.filter(
    (row) => row.human === "approve"
  ).length;
  const critical = observations.filter((row) => row.criticalDefect === true);
  const criticalDetected = critical.filter(
    (row) => row.predicted === "reject"
  ).length;
  const decided = observations.filter(
    (row) => row.predicted !== "uncertain"
  ).length;
  const precision = approved.length ? correctApprovals / approved.length : null;
  const criticalRecall = critical.length
    ? criticalDetected / critical.length
    : null;
  const coverage = count ? decided / count : 0;
  if (approved.length < 20 || precision === null || precision < 0.95) {
    reasons.push(
      "Approval precision below 95 percent or fewer than 20 approvals"
    );
  }
  if (critical.length < 20 || criticalRecall === null || criticalRecall < 0.9) {
    reasons.push(
      "Critical defect recall below 90 percent or fewer than 20 critical examples"
    );
  }
  if (coverage < 0.8) {
    reasons.push("Automatic decision coverage below 80 percent");
  }
  if (
    !["identical-images", "reversed-order"].every((defect) =>
      controls.some(
        (control) =>
          control.defect === defect &&
          control.passed &&
          control.correct === control.count &&
          control.falseRejections === 0
      )
    ) ||
    controls.some((control) => !control.passed)
  ) {
    reasons.push("Order and identical-image controls are unqualified");
  }
  return {
    approved: approved.length,
    correctApprovals,
    count,
    coverage,
    critical: critical.length,
    criticalDetected,
    criticalRecall,
    criticalRecallInterval95: interval(criticalDetected, critical.length),
    precision,
    precisionInterval95: interval(correctApprovals, approved.length),
    qualified: reasons.length === 0,
    reasons,
  };
};

export interface SealedCraftQualification {
  /** Hash of model, prompt, thresholds and image preprocessing frozen before labels. */
  frozenInstrumentHash: string;
  observedInstrumentHash: string;
  /** Canonical hash of the predeclared stimulus roster, independent of labels. */
  frozenRosterHash: string;
  observedRosterHash: string;
  /** True once any test label was available to critic tuning or threshold choice. */
  labelsExposedBeforePrediction: boolean;
  observations: readonly CraftJudgeObservation[];
  controls: ReturnType<typeof qualifyInstrument>;
}

/** Adds the sealing boundary that the metric-only gate cannot infer. A passing
 * score is qualification only when instrument and roster identities were
 * frozen before predictions and human labels were joined. */
export const qualifySealedCraftJudge = (input: SealedCraftQualification) => {
  const result = qualifyCraftJudge(input.observations, input.controls);
  const reasons = [...result.reasons];
  if (
    !validHash(input.frozenInstrumentHash) ||
    input.observedInstrumentHash !== input.frozenInstrumentHash
  ) {
    reasons.push("Craft instrument changed after it was frozen");
  }
  if (
    !validHash(input.frozenRosterHash) ||
    input.observedRosterHash !== input.frozenRosterHash
  ) {
    reasons.push("Sealed stimulus roster changed after it was frozen");
  }
  if (input.labelsExposedBeforePrediction !== false) {
    reasons.push("Human test labels were exposed before critic prediction");
  }
  return { ...result, qualified: reasons.length === 0, reasons };
};
