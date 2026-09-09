import { createHash } from "node:crypto";

import {
  FAMILY_CLUSTERED_BOOTSTRAP_CONFIDENCE,
  FAMILY_CLUSTERED_BOOTSTRAP_METHOD,
  reportFamilyClusteredStatistics,
} from "./family-clustered-uncertainty.js";
import type { FamilyClusteredDiagnostic } from "./family-clustered-uncertainty.js";
import { criticQualificationReadyForProduction } from "./foundry-gate.js";
import type {
  ProductionCriticQualificationCapability,
  ProductionCriticQualificationIdentity,
  ProductionCriticReviewRequirement,
} from "./foundry-gate.js";

export const ACCEPTANCE_CONTRACT_VERSION =
  "iconsmith-ai-only-10-draft-v17" as const;

export const DRAFT_ACCEPTANCE_CONTRACT = {
  aggregation: {
    craft: "median-per-output-then-population-median",
    missingEvidence: "failure",
    parity: "paired-reviewer-difference-per-output-then-family",
  },
  calibration: {
    absoluteCraftAnchorMinimum: 9,
    craftScale: {
      maximum: 10,
      minimum: 1,
      nine: "ship-ready-with-only-negligible-optical-reservations",
      ten: "house-exemplary-and-ship-ready-unchanged",
    },
    criticalOrApprovalMayNotChangeOnRepeat: true,
    maximumRepeatCraftDelta: 1,
    rawScoresOnly: true,
    status: "proposed-unvalidated",
  },
  dimensions: {
    craft: { medianMinimum: 9, shipUnchangedMinimumRate: 0.95 },
    delivery: { completePairMinimumRate: 0.95 },
    evaluation: {
      approvalPrecisionMinimum: 0.95,
      criticalRecallMinimum: 0.9,
      decisionCoverageMinimum: 0.8,
      minimumCanonicalStimuli: 100,
      minimumCriticalGeneratedDefects: 20,
      minimumGeneratedApprovals: 20,
      minimumGeneratedApprovalsPerStratum: 5,
      minimumGeneratedCriticalDefectsPerStratum: 5,
      minimumNaturalGeneratedCandidates: 80,
      minimumNaturalGeneratedCandidatesPerStratum: 20,
    },
    generalization: { batches: 2, familiesPerBatch: 20, outputsPerBatch: 80 },
    geometry: { criticalDefectsAllowed: 0, exactReplayRequired: true },
    houseParity: { familyFitMinimumRate: 0.95, medianCraftDeltaMinimum: -0.5 },
    nativeQuality: { minimumRate: 0.95, surfaces: ["light", "dark"] },
    recognition: { minimumRate: 0.95, stratifyBy: ["paint", "nativeSize"] },
    repair: { minimumSuccesses: 16, population: 20 },
  },
  pairing: {
    aggregationUnit: "requested-output-slot",
    nativeSizes: [16, 24],
    paints: ["outlined", "filled"],
    parityMethod: "same-reviewer-paired-difference",
    reviewerDisagreement: "unresolved-is-uncertain",
    selfReviewCountsAsIndependent: false,
  },
  populations: {
    catalog: "all-requested-catalog-slots",
    evaluation: "separately-sealed-independent-ai-panel-stimuli",
    novel: ["novel-batch-a", "novel-batch-b"],
    repair: "separately-sealed-repairable-failures",
  },
  status: "draft-unqualified",
  terminalStates: [
    "accepted",
    "failed",
    "refused",
    "timed-out",
    "uncertain",
    "unstarted",
  ],
  uncertainty: {
    confidenceClaim: "descriptive-family-clustered-interval",
    confidenceLevel: FAMILY_CLUSTERED_BOOTSTRAP_CONFIDENCE,
    method: FAMILY_CLUSTERED_BOOTSTRAP_METHOD,
    methodRequired: true,
    missingIsSuccess: false,
    resamplingCount: 1000,
    resamplingCountRequired: true,
    seedRequired: true,
  },
  version: ACCEPTANCE_CONTRACT_VERSION,
} as const;

export type AcceptanceDimension =
  keyof typeof DRAFT_ACCEPTANCE_CONTRACT.dimensions;
type AcceptanceTerminalState =
  (typeof DRAFT_ACCEPTANCE_CONTRACT.terminalStates)[number];

const STRATA = ["outlined-16", "outlined-24", "filled-16", "filled-24"];
const POPULATIONS = ["catalog", "novel-batch-a", "novel-batch-b"];
export type AcceptancePopulation = (typeof POPULATIONS)[number];
const populationStrata = POPULATIONS.flatMap((population) =>
  STRATA.map((stratum) => `${population}/${stratum}`)
);

export const ACCEPTANCE_GATE_SCOPES: Readonly<
  Record<AcceptanceDimension, readonly string[]>
> = {
  craft: populationStrata,
  delivery: ["catalog", "novel-batch-a", "novel-batch-b"],
  evaluation: ["sealed-critic-population"],
  generalization: ["novel-batch-a", "novel-batch-b"],
  geometry: ["every-output"],
  houseParity: populationStrata,
  nativeQuality: populationStrata,
  recognition: populationStrata,
  repair: ["sealed-repair-population"],
};

type AcceptanceEvidenceDisposition =
  | "not-produced"
  | "production-unknown"
  | "produced-inspected"
  | "produced-not-inspected"
  | "unstarted";

export interface AcceptanceOutputEvidence {
  artifactHash: string | null;
  authorProvenance?: {
    artifactHash: string;
    authorId: string;
    lineage: string;
  } | null;
  canonicalSlotId: string;
  completedAt: number | null;
  conceptId: string;
  craftRatings: readonly number[];
  criticalDefect: boolean | null;
  deliveryArtifactValid: boolean | null;
  deliveryState: "delivered" | "failed" | "refused" | "timed-out" | "unstarted";
  /** Distinguishes absent artifacts and absent inspection from negative judgments. */
  evidenceDisposition: AcceptanceEvidenceDisposition;
  exactReplay: boolean | null;
  familyId: string;
  familyFit: boolean | null;
  houseCraftComparisons: readonly {
    candidateCraft: number;
    presentationProtocolHash: string;
    referenceArtifactHash: string;
    referenceCraft: number;
    reviewerId: string;
  }[];
  nativeLegibility: readonly {
    /** SHA-256 of the exact light/dark presentation image bytes. */
    artifactHash: string;
    legible: boolean | null;
    reviewEvidenceHash?: string;
    reviewerId: string;
    /** Source output whose exact native presentation was rendered. */
    sourceArtifactHash: string;
    surface: "dark" | "light";
  }[];
  nativeSize: 16 | 24;
  originalDeadlineAt: number | null;
  paint: "filled" | "outlined";
  population: AcceptancePopulation;
  recognitionCorrect: boolean | null;
  reviewerAssessments: readonly {
    artifactHash: string;
    craftRating: number;
    criticalDefect: boolean;
    familyFit: boolean;
    recognitionCorrect: boolean | null;
    recognitionAdjudication?: "match" | "mismatch" | "uncertain";
    recognitionChoice?: "described" | "unknown";
    recognitionEvidenceHash?: string;
    /** SHA-256 of the retained canonical review result carrying these labels. */
    reviewEvidenceHash: string;
    reviewerId: string;
    shipUnchanged: boolean;
  }[];
  reviewerProvenance?: readonly {
    artifactHash: string;
    lineage: string;
    reviewEvidenceHash: string;
    reviewerId: string;
  }[];
  requestId: string;
  requestIntentHash: string | null;
  shipUnchanged: boolean | null;
  slotId: string;
  terminalState: AcceptanceTerminalState;
}

export interface AcceptanceExpectedSlot {
  /** The source slot whose computation this request uses. Equal to slotId when
   * the request owns its computation; catalog aliases may bind explicit reuse. */
  canonicalSlotId: string;
  conceptId: string;
  familyId: string;
  nativeSize: 16 | 24;
  /** Frozen absolute request deadline shared by both paint slots. */
  originalDeadlineAt: number | null;
  paint: "filled" | "outlined";
  population: AcceptancePopulation;
  /** Stable requested concept identity. Aliases remain separate requests. */
  requestId: string;
  /** Frozen request intent identity shared by both paint slots. */
  requestIntentHash: string | null;
  slotId: string;
}

export type AcceptanceReviewPopulationPurpose =
  | "catalog-probability-audit"
  | "novel-panel-a"
  | "novel-panel-b"
  | "production-catalog-critic";

/** Frozen identities route evidence to one declared population. They are
 * untrusted expectations: only a separately computed capability may authorize
 * a gate. */
export interface AcceptanceReviewPopulationIdentity {
  instrumentHash: string;
  manifestHash: string;
  populationHash: string;
  purpose: AcceptanceReviewPopulationPurpose;
  requestedDenominator: number;
}

export type AcceptanceIndependentReviewPurpose = Exclude<
  AcceptanceReviewPopulationPurpose,
  "production-catalog-critic"
>;

export interface AcceptanceIndependentPanelReview {
  artifactHash: string;
  completedAt: number;
  craftRating: number;
  criticalDefect: boolean;
  familyFit: boolean;
  lineage: string;
  nativeLegibility: boolean;
  recognitionCorrect: boolean | null;
  reviewEvidenceHash: string;
  reviewerId: string;
  shipUnchanged: boolean;
  startedAt: number;
}

export interface AcceptanceIndependentReviewSlot {
  disposition: "inspected" | "missing" | "uninspected";
  reviews: readonly AcceptanceIndependentPanelReview[];
  slotId: string;
}

export interface AcceptanceIndependentReviewPopulation {
  purpose: AcceptanceIndependentReviewPurpose;
  selectionHash: string;
  selectionSealedAt: number;
  slots: readonly AcceptanceIndependentReviewSlot[];
}

interface AcceptanceIndependentReviewUncertainty {
  craftMedian: FamilyClusteredDiagnostic;
  craftSuccessRate: FamilyClusteredDiagnostic;
  familyFitRate: FamilyClusteredDiagnostic;
  nativeLegibilityRate: FamilyClusteredDiagnostic;
  panelSuccessRate: FamilyClusteredDiagnostic;
  recognitionRate: FamilyClusteredDiagnostic;
  shipRate: FamilyClusteredDiagnostic;
}

export interface AcceptanceIndependentReviewMetric {
  craftMedian: number | null;
  craftObservedCount: number;
  craftSuccesses: number;
  criticalCount: number;
  evidenceValid: boolean;
  familyCount: number;
  familyFitRate: number;
  familyFitSuccesses: number;
  inspectedCount: number;
  missingCount: number;
  nativeLegibilityRate: number;
  nativeLegibilitySuccesses: number;
  panelResolvedCount: number;
  panelSuccesses: number;
  purpose: AcceptanceIndependentReviewPurpose;
  recognitionRate: number;
  recognitionSuccesses: number;
  requestedCount: number;
  scope: string;
  shipRate: number;
  shipSuccesses: number;
  uncertainty: AcceptanceIndependentReviewUncertainty;
  unresolvedCount: number;
  uninspectedCount: number;
}

export interface AcceptanceGateEvidence {
  /** Frozen post-settlement critic evidence identity. Its manifest hash covers
   * the collector-validated instrument, routes, lineage registry and population.
   * This serializable value is only an expectation and must exactly match a
   * live computed capability. */
  computedCriticIdentity?: ProductionCriticQualificationIdentity;
  denominator: number;
  evidencePopulations: readonly AcceptanceReviewPopulationPurpose[];
  dimension: AcceptanceDimension;
  passed: boolean;
  scope: string;
  successes: number;
}

export interface AcceptanceReport {
  /** SHA-256 of the canonical, identity-complete catalog slot array. */
  catalogSlotManifestHash?: string;
  contractVersion: string;
  expectedSlots: readonly AcceptanceExpectedSlot[];
  gates: readonly AcceptanceGateEvidence[];
  independentReviewPopulations: readonly AcceptanceIndependentReviewPopulation[];
  outputs: readonly AcceptanceOutputEvidence[];
  reviewPopulations: readonly AcceptanceReviewPopulationIdentity[];
  uncertainty: {
    confidenceLevel: number;
    method: string;
    resamplingCount: number;
    seed: string;
  };
}

export interface AcceptanceCampaignTerminalExpectation {
  campaignHash: string;
  originalDeadlineAt: number | null;
  planHash: string;
  requestId: string;
  requestIntentHash: string | null;
  route: string;
  runtimeHash: string;
  slotIds: readonly [string, string];
  toolingHash: string;
}

export interface AcceptanceCampaignAuthorEvidence {
  authorId: string;
  authorLineage: string;
  authorModel: string;
  authorReceiptSha256: string;
  completionDeadlineAt: number;
  evidenceReceiptSha256s: readonly string[];
  inspection: Readonly<{
    collectorRequestId: string;
    emittedModel: string;
    emittedSessionId: string;
    intentHash: string;
    lifecycleRequestSha256: string;
    stageDeadlineAt: number;
    traceReceiptSha256: string;
    traceSha256: string;
  }>;
  kind: "parent-replayed-author-inspection-v1";
  nativeRouteHash: string;
  paints: Readonly<
    Record<
      "filled" | "outlined",
      Readonly<{
        programSha256: string;
        proofSha256: string;
        svgSha256: string;
      }>
    >
  >;
  selectedTreeSha256: string;
}

export interface AcceptanceCampaignTerminalReport {
  authorEvidence?: AcceptanceCampaignAuthorEvidence | null;
  authorEvidenceVerified: boolean;
  campaignHash: string;
  deadlineAt: number | null;
  disposition: "produced" | "production-unknown" | "unstarted";
  kind: "iconsmith-verified-campaign-terminal-evidence-report-v1";
  planAuthority: "caller-frozen";
  planHash: string;
  qualificationGranted: false;
  requestId: string;
  requestIntentHash: string | null;
  route: string;
  runtimeHash: string;
  selectedEvidence:
    | Readonly<{ state: "verified-absent" }>
    | Readonly<{
        artifacts?: readonly Readonly<{ name: string; sha256: string }>[];
        filledSha256: string;
        outlinedSha256: string;
        state: "retained-produced";
        treeHash?: string;
      }>;
  slotIds: readonly string[];
  terminalStatus: "delivered" | "incomplete" | "refused" | "unstarted";
  toolingHash: string;
}

export interface AcceptanceCampaignTerminalCapability {
  readonly kind: "iconsmith-acceptance-campaign-terminal-capability-v1";
}

const activeCampaignTerminalCapabilities = new WeakMap<
  AcceptanceCampaignTerminalCapability,
  ReadonlyMap<string, AcceptanceCampaignTerminalReport>
>();
const TERMINAL_HASH = /^[a-f0-9]{64}$/u;
const terminalCanonical = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map(terminalCanonical).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .toSorted(([left], [right]) => left.localeCompare(right))
      .map(
        ([key, entry]) => `${JSON.stringify(key)}:${terminalCanonical(entry)}`
      )
      .join(",")}}`;
  }
  return JSON.stringify(value);
};

const terminalNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

// The parent author envelope deliberately checks every binding independently.
// eslint-disable-next-line complexity
const validCampaignAuthorEvidence = (
  report: AcceptanceCampaignTerminalReport
) => {
  const evidence = report.authorEvidence;
  if (!report.authorEvidenceVerified) {
    return evidence === null || evidence === undefined;
  }
  const retained = report.selectedEvidence;
  if (
    report.disposition !== "produced" ||
    retained.state !== "retained-produced" ||
    !evidence ||
    evidence.kind !== "parent-replayed-author-inspection-v1" ||
    !evidence.inspection ||
    !evidence.paints?.outlined ||
    !evidence.paints.filled ||
    !terminalNonEmptyString(evidence.authorId) ||
    !terminalNonEmptyString(evidence.authorLineage) ||
    !terminalNonEmptyString(evidence.authorModel) ||
    !terminalNonEmptyString(evidence.inspection.collectorRequestId) ||
    !terminalNonEmptyString(evidence.inspection.emittedModel) ||
    evidence.inspection.emittedModel !== evidence.authorModel ||
    !terminalNonEmptyString(evidence.inspection.emittedSessionId) ||
    !Number.isSafeInteger(evidence.completionDeadlineAt) ||
    !Number.isSafeInteger(evidence.inspection.stageDeadlineAt) ||
    evidence.completionDeadlineAt <= 0 ||
    evidence.inspection.stageDeadlineAt <= 0 ||
    !Array.isArray(evidence.evidenceReceiptSha256s) ||
    report.deadlineAt === null ||
    evidence.inspection.stageDeadlineAt > evidence.completionDeadlineAt ||
    evidence.completionDeadlineAt > report.deadlineAt ||
    evidence.selectedTreeSha256 !== retained.treeHash
  ) {
    return false;
  }
  const hashes = [
    evidence.authorReceiptSha256,
    evidence.nativeRouteHash,
    evidence.selectedTreeSha256,
    evidence.inspection.intentHash,
    evidence.inspection.lifecycleRequestSha256,
    evidence.inspection.traceReceiptSha256,
    evidence.inspection.traceSha256,
    ...evidence.evidenceReceiptSha256s,
    ...Object.values(evidence.paints).flatMap(
      ({ programSha256, proofSha256, svgSha256 }) => [
        programSha256,
        proofSha256,
        svgSha256,
      ]
    ),
  ];
  if (
    evidence.evidenceReceiptSha256s.length === 0 ||
    hashes.some((value) => !TERMINAL_HASH.test(value))
  ) {
    return false;
  }
  const artifacts = Array.isArray(retained.artifacts) ? retained.artifacts : [];
  const expectedArtifacts = [
    ["structured-author.json", evidence.authorReceiptSha256],
    ["outlined.icon", evidence.paints.outlined.programSha256],
    ["outlined.proof.png", evidence.paints.outlined.proofSha256],
    ["outlined.svg", evidence.paints.outlined.svgSha256],
    ["filled.icon", evidence.paints.filled.programSha256],
    ["filled.proof.png", evidence.paints.filled.proofSha256],
    ["filled.svg", evidence.paints.filled.svgSha256],
  ] as const;
  return (
    evidence.paints.outlined.svgSha256 === retained.outlinedSha256 &&
    evidence.paints.filled.svgSha256 === retained.filledSha256 &&
    expectedArtifacts.every(
      ([name, sha256]) =>
        artifacts.filter((artifact) => artifact.name === name).length === 1 &&
        artifacts.find((artifact) => artifact.name === name)?.sha256 === sha256
    )
  );
};

// The terminal envelope is an intentionally fail-closed conjunction.
// eslint-disable-next-line complexity
const validCampaignTerminalReport = (
  report: AcceptanceCampaignTerminalReport,
  expected: AcceptanceCampaignTerminalExpectation
) => {
  const retained = report.selectedEvidence;
  const identityMatches =
    report.kind === "iconsmith-verified-campaign-terminal-evidence-report-v1" &&
    validCampaignAuthorEvidence(report) &&
    report.qualificationGranted === false &&
    report.planAuthority === "caller-frozen" &&
    report.planHash === expected.planHash &&
    report.campaignHash === expected.campaignHash &&
    report.requestId === expected.requestId &&
    report.requestIntentHash === expected.requestIntentHash &&
    report.route === expected.route &&
    report.runtimeHash === expected.runtimeHash &&
    report.toolingHash === expected.toolingHash &&
    report.deadlineAt === expected.originalDeadlineAt &&
    terminalCanonical([...report.slotIds].toSorted()) ===
      terminalCanonical([...expected.slotIds].toSorted());
  const terminalMatchesDisposition =
    (report.disposition === "unstarted" &&
      report.terminalStatus === "unstarted" &&
      report.deadlineAt === null &&
      report.requestIntentHash === null &&
      retained.state === "verified-absent") ||
    (report.disposition === "production-unknown" &&
      ["incomplete", "refused"].includes(report.terminalStatus) &&
      report.deadlineAt !== null &&
      TERMINAL_HASH.test(report.requestIntentHash ?? "") &&
      retained.state === "verified-absent") ||
    (report.disposition === "produced" &&
      report.terminalStatus !== "unstarted" &&
      report.deadlineAt !== null &&
      TERMINAL_HASH.test(report.requestIntentHash ?? "") &&
      retained.state === "retained-produced" &&
      TERMINAL_HASH.test(retained.outlinedSha256) &&
      TERMINAL_HASH.test(retained.filledSha256));
  return identityMatches && terminalMatchesDisposition;
};

/** Trusted-code boundary for the scripts wrapper. `compute` must call the
 * process-local campaign reader. Reports are active only in this callback and
 * never become serializable acceptance authority. */
export const withComputedCampaignTerminalEvidence = <T>(
  expectations: readonly AcceptanceCampaignTerminalExpectation[],
  compute: () => readonly AcceptanceCampaignTerminalReport[],
  consume: (capability: AcceptanceCampaignTerminalCapability) => T
): T => {
  const reports = compute();
  const expectedByRequest = new Map(
    expectations.map((expected) => [expected.requestId, expected])
  );
  const reportByRequest = new Map(
    reports.map((report) => [report.requestId, report])
  );
  if (
    expectedByRequest.size !== expectations.length ||
    reportByRequest.size !== reports.length ||
    reports.length !== expectations.length ||
    reports.some((report) => {
      const expected = expectedByRequest.get(report.requestId);
      return !expected || !validCampaignTerminalReport(report, expected);
    })
  ) {
    throw new Error("Campaign terminal evidence binding is invalid");
  }
  const capability = Object.freeze({
    kind: "iconsmith-acceptance-campaign-terminal-capability-v1" as const,
  });
  activeCampaignTerminalCapabilities.set(capability, reportByRequest);
  try {
    return consume(capability);
  } finally {
    activeCampaignTerminalCapabilities.delete(capability);
  }
};

/** Process-local computed dependencies. These capabilities are deliberately
 * separate from the untrusted, serializable acceptance report. */
export interface AcceptanceComputedEvidence {
  campaignTerminals?: AcceptanceCampaignTerminalCapability;
  criticQualification?: ProductionCriticQualificationCapability;
}

const completeRating = (value: number) =>
  Number.isInteger(value) && value >= 1 && value <= 10;
const HASH = /^[a-f0-9]{64}$/u;
const CATALOG_SLOT_COUNT = 8884;
const CATALOG_CONCEPT_COUNT = 2221;
const nonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;
/** Slot-census digest from the frozen catalog campaign manifest. Runtime and
 * deadline assumptions in that older manifest are intentionally out of scope. */
export const FROZEN_CATALOG_SLOT_CENSUS_HASH =
  "34565504c59e0c69f6a05ce6e8357055f121fc83c49e80a4d41d17c2c44e473a";
const digest = (value: string) =>
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
export const hashAcceptanceIndependentReviewSelection = (
  purpose: AcceptanceIndependentReviewPurpose,
  slotIds: readonly string[]
) => digest(canonical({ purpose, slotIds }));

export const hashAcceptanceIndependentReviewEvidence = (
  population: AcceptanceIndependentReviewPopulation
) => digest(canonical(population));

const independentPanelReviewIsValid = (
  review: AcceptanceIndependentPanelReview,
  context: {
    artifactHash: string;
    authorLineage: string | undefined;
    outputCompletedAt: number | null;
    productionEvidenceHashes: ReadonlySet<string>;
    productionReviewerIds: ReadonlySet<string>;
    selectionSealedAt: number;
  }
) =>
  [
    review.artifactHash === context.artifactHash,
    HASH.test(review.reviewEvidenceHash),
    !context.productionReviewerIds.has(review.reviewerId),
    !context.productionEvidenceHashes.has(review.reviewEvidenceHash),
    nonEmptyString(review.reviewerId),
    nonEmptyString(review.lineage),
    review.lineage !== context.authorLineage,
    completeRating(review.craftRating),
    typeof review.criticalDefect === "boolean",
    typeof review.familyFit === "boolean",
    typeof review.nativeLegibility === "boolean",
    [true, false, null].includes(review.recognitionCorrect),
    typeof review.shipUnchanged === "boolean",
    !(review.criticalDefect && review.shipUnchanged),
    Number.isSafeInteger(review.startedAt),
    Number.isSafeInteger(review.completedAt),
    review.startedAt > context.selectionSealedAt,
    context.outputCompletedAt === null ||
      review.startedAt >= context.outputCompletedAt,
    review.completedAt >= review.startedAt,
  ].every(Boolean);

const median = (values: readonly number[]) => {
  const sorted = values.toSorted((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? (sorted[middle] ?? Number.NaN)
    : ((sorted[middle - 1] ?? Number.NaN) + (sorted[middle] ?? Number.NaN)) / 2;
};

const agreedIndependentLabel = (
  reviews: readonly AcceptanceIndependentPanelReview[],
  label:
    | "criticalDefect"
    | "familyFit"
    | "nativeLegibility"
    | "recognitionCorrect"
    | "shipUnchanged"
) => {
  if (reviews.length !== 2) {
    return null;
  }
  const values = reviews.map((review) => review[label]);
  return typeof values[0] === "boolean" && values[0] === values[1]
    ? values[0]
    : null;
};

const independentMetricRate = (successes: number, requestedCount: number) =>
  requestedCount === 0 ? 0 : successes / requestedCount;
const requestedDiagnosticRate = <Row>(
  rows: readonly Row[],
  success: (row: Row) => boolean
) => rows.filter(success).length / rows.length;

const computeIndependentReviewMetrics = (
  population: AcceptanceIndependentReviewPopulation,
  expectedById: ReadonlyMap<string, AcceptanceExpectedSlot>,
  evidenceValid: boolean,
  uncertainty: AcceptanceReport["uncertainty"]
): readonly AcceptanceIndependentReviewMetric[] => {
  const slots = Array.isArray(population.slots)
    ? population.slots.filter(
        (slot): slot is AcceptanceIndependentReviewSlot =>
          slot !== null && typeof slot === "object"
      )
    : [];
  let expectedPopulation: AcceptancePopulation = "novel-batch-b";
  if (population.purpose === "catalog-probability-audit") {
    expectedPopulation = "catalog";
  } else if (population.purpose === "novel-panel-a") {
    expectedPopulation = "novel-batch-a";
  }
  const scopes = [
    expectedPopulation,
    ...STRATA.map((stratum) => `${expectedPopulation}/${stratum}`),
  ];
  return scopes.map((scope) => {
    const scopedSlots = slots.filter(({ slotId }) => {
      const expected = expectedById.get(slotId);
      return (
        expected?.population === expectedPopulation &&
        (scope === expectedPopulation ||
          scope ===
            `${expectedPopulation}/${expected.paint}-${expected.nativeSize}`)
      );
    });
    const decisions = scopedSlots.map((slot) => {
      const reviews = Array.isArray(slot.reviews)
        ? slot.reviews.filter(
            (review): review is AcceptanceIndependentPanelReview =>
              review !== null && typeof review === "object"
          )
        : [];
      const criticalAlleged = reviews.some(
        ({ criticalDefect }) => criticalDefect === true
      );
      const criticalDecision = agreedIndependentLabel(
        reviews,
        "criticalDefect"
      );
      const familyFit = agreedIndependentLabel(reviews, "familyFit");
      const nativeLegibility = agreedIndependentLabel(
        reviews,
        "nativeLegibility"
      );
      const recognition = agreedIndependentLabel(reviews, "recognitionCorrect");
      const ship = agreedIndependentLabel(reviews, "shipUnchanged");
      const outputCraft =
        reviews.length === 2 &&
        reviews.every(({ craftRating }) => completeRating(craftRating))
          ? median(reviews.map(({ craftRating }) => craftRating))
          : null;
      const inspected = slot.disposition === "inspected";
      const resolved =
        inspected &&
        criticalDecision !== null &&
        familyFit !== null &&
        nativeLegibility !== null &&
        recognition !== null &&
        ship !== null &&
        outputCraft !== null;
      const eligibleForSuccess =
        evidenceValid && resolved && criticalDecision === false;
      return {
        criticalAlleged: inspected && criticalAlleged,
        eligibleForSuccess,
        familyFit,
        familyId: expectedById.get(slot.slotId)?.familyId ?? "",
        inspected,
        nativeLegibility,
        outputCraft,
        panelSuccess:
          eligibleForSuccess &&
          familyFit &&
          nativeLegibility &&
          recognition &&
          ship &&
          outputCraft >=
            DRAFT_ACCEPTANCE_CONTRACT.dimensions.craft.medianMinimum,
        recognition,
        resolved,
        ship,
        slot,
      };
    });
    const successful = decisions.filter(
      ({ eligibleForSuccess }) => eligibleForSuccess
    );
    const craftValues = decisions.flatMap(({ outputCraft }) =>
      outputCraft === null ? [] : [outputCraft]
    );
    const craftSuccesses = successful.filter(
      ({ outputCraft, ship }) =>
        ship === true &&
        outputCraft !== null &&
        outputCraft >= DRAFT_ACCEPTANCE_CONTRACT.dimensions.craft.medianMinimum
    ).length;
    const familyFitSuccesses = successful.filter(
      ({ familyFit }) => familyFit === true
    ).length;
    const nativeLegibilitySuccesses = successful.filter(
      ({ nativeLegibility }) => nativeLegibility === true
    ).length;
    const recognitionSuccesses = successful.filter(
      ({ recognition }) => recognition === true
    ).length;
    const shipSuccesses = successful.filter(({ ship }) => ship === true).length;
    const requestedCount = scopedSlots.length;
    const decisionsByFamily = new Map<string, (typeof decisions)[number][]>();
    for (const decision of decisions) {
      const rows = decisionsByFamily.get(decision.familyId) ?? [];
      rows.push(decision);
      decisionsByFamily.set(decision.familyId, rows);
    }
    const clusters = [...decisionsByFamily].map(([familyId, rows]) => ({
      familyId,
      rows,
    }));
    const craftStatistic = (rows: readonly (typeof decisions)[number][]) => {
      const values = rows.flatMap(({ outputCraft }) =>
        outputCraft === null ? [] : [outputCraft]
      );
      return values.length === 0 ? null : median(values);
    };
    const uncertaintyDiagnostics = reportFamilyClusteredStatistics({
      clusters,
      evidenceValid,
      populationId: `${population.purpose}/${scope}`,
      resamplingCount: uncertainty.resamplingCount,
      seed: uncertainty.seed,
      statistics: {
        craftMedian: craftStatistic,
        craftSuccessRate: (rows) =>
          requestedDiagnosticRate(
            rows,
            ({ eligibleForSuccess, outputCraft, ship }) =>
              eligibleForSuccess &&
              ship === true &&
              outputCraft !== null &&
              outputCraft >=
                DRAFT_ACCEPTANCE_CONTRACT.dimensions.craft.medianMinimum
          ),
        familyFitRate: (rows) =>
          requestedDiagnosticRate(rows, ({ eligibleForSuccess, familyFit }) =>
            Boolean(eligibleForSuccess && familyFit === true)
          ),
        nativeLegibilityRate: (rows) =>
          requestedDiagnosticRate(
            rows,
            ({ eligibleForSuccess, nativeLegibility }) =>
              Boolean(eligibleForSuccess && nativeLegibility === true)
          ),
        panelSuccessRate: (rows) =>
          requestedDiagnosticRate(
            rows,
            ({ panelSuccess }) => panelSuccess === true
          ),
        recognitionRate: (rows) =>
          requestedDiagnosticRate(rows, ({ eligibleForSuccess, recognition }) =>
            Boolean(eligibleForSuccess && recognition === true)
          ),
        shipRate: (rows) =>
          requestedDiagnosticRate(rows, ({ eligibleForSuccess, ship }) =>
            Boolean(eligibleForSuccess && ship === true)
          ),
      },
    }) satisfies AcceptanceIndependentReviewUncertainty;
    return {
      craftMedian: craftValues.length === 0 ? null : median(craftValues),
      craftObservedCount: craftValues.length,
      craftSuccesses,
      criticalCount: decisions.filter(({ criticalAlleged }) => criticalAlleged)
        .length,
      evidenceValid,
      familyCount: new Set(
        scopedSlots.flatMap(({ slotId }) => {
          const familyId = expectedById.get(slotId)?.familyId;
          return familyId ? [familyId] : [];
        })
      ).size,
      familyFitRate: independentMetricRate(familyFitSuccesses, requestedCount),
      familyFitSuccesses,
      inspectedCount: decisions.filter(({ inspected }) => inspected).length,
      missingCount: scopedSlots.filter(
        ({ disposition }) => disposition === "missing"
      ).length,
      nativeLegibilityRate: independentMetricRate(
        nativeLegibilitySuccesses,
        requestedCount
      ),
      nativeLegibilitySuccesses,
      panelResolvedCount: decisions.filter(({ resolved }) => resolved).length,
      panelSuccesses: successful.filter(({ panelSuccess }) => panelSuccess)
        .length,
      purpose: population.purpose,
      recognitionRate: independentMetricRate(
        recognitionSuccesses,
        requestedCount
      ),
      recognitionSuccesses,
      requestedCount,
      scope,
      shipRate: independentMetricRate(shipSuccesses, requestedCount),
      shipSuccesses,
      uncertainty: uncertaintyDiagnostics,
      uninspectedCount: scopedSlots.filter(
        ({ disposition }) => disposition === "uninspected"
      ).length,
      unresolvedCount: decisions.filter(
        ({ inspected, resolved }) => inspected && !resolved
      ).length,
    };
  });
};

const houseComparisons = (output: AcceptanceOutputEvidence) =>
  Array.isArray(output.houseCraftComparisons)
    ? output.houseCraftComparisons
    : [];
const nativeObservations = (output: AcceptanceOutputEvidence) =>
  Array.isArray(output.nativeLegibility) ? output.nativeLegibility : [];
const reviewerAssessments = (output: AcceptanceOutputEvidence) =>
  Array.isArray(output.reviewerAssessments)
    ? output.reviewerAssessments.filter(
        (
          assessment
        ): assessment is AcceptanceOutputEvidence["reviewerAssessments"][number] =>
          assessment !== null && typeof assessment === "object"
      )
    : [];
const outputCraftRatings = (output: AcceptanceOutputEvidence) =>
  reviewerAssessments(output).map(({ craftRating }) => craftRating);
const sameRatings = (left: unknown, right: unknown) =>
  Array.isArray(left) &&
  Array.isArray(right) &&
  left.every(
    (rating) => typeof rating === "number" && Number.isFinite(rating)
  ) &&
  right.every(
    (rating) => typeof rating === "number" && Number.isFinite(rating)
  ) &&
  JSON.stringify(left.toSorted((a, b) => a - b)) ===
    JSON.stringify(right.toSorted((a, b) => a - b));
const aggregateReviewerLabel = (
  assessments: ReturnType<typeof reviewerAssessments>,
  label: "criticalDefect" | "familyFit" | "recognitionCorrect" | "shipUnchanged"
) => {
  const values = assessments.map((assessment) => assessment[label]);
  if (label === "criticalDefect" && values.includes(true)) {
    return true;
  }
  const observed = new Set(values);
  return observed.size === 1 ? (values[0] ?? null) : null;
};

const hasNoInspectionEvidence = (output: AcceptanceOutputEvidence) =>
  Array.isArray(output.craftRatings) &&
  output.craftRatings.length === 0 &&
  Array.isArray(output.houseCraftComparisons) &&
  output.houseCraftComparisons.length === 0 &&
  Array.isArray(output.nativeLegibility) &&
  output.nativeLegibility.length === 0 &&
  Array.isArray(output.reviewerAssessments) &&
  output.reviewerAssessments.length === 0 &&
  (output.reviewerProvenance === undefined ||
    output.reviewerProvenance === null ||
    (Array.isArray(output.reviewerProvenance) &&
      output.reviewerProvenance.length === 0)) &&
  output.criticalDefect === null &&
  output.familyFit === null &&
  output.recognitionCorrect === null &&
  output.shipUnchanged === null;
const groupByFamily = (outputs: readonly AcceptanceOutputEvidence[]) => {
  const families = new Map<string, AcceptanceOutputEvidence[]>();
  for (const output of outputs) {
    families.set(output.familyId, [
      ...(families.get(output.familyId) ?? []),
      output,
    ]);
  }
  return [...families.values()];
};

const slotIdentity = ({
  canonicalSlotId,
  conceptId,
  familyId,
  nativeSize,
  originalDeadlineAt,
  paint,
  population,
  requestId,
  requestIntentHash,
  slotId,
}: AcceptanceExpectedSlot | AcceptanceOutputEvidence) =>
  JSON.stringify({
    canonicalSlotId,
    conceptId,
    familyId,
    nativeSize,
    originalDeadlineAt,
    paint,
    population,
    requestId,
    requestIntentHash,
    slotId,
  });

/** Recreates only the immutable slot census from the frozen campaign. */
export const hashAcceptanceCatalogSlotCensus = (
  slots: readonly AcceptanceExpectedSlot[]
) =>
  digest(
    canonical(
      slots
        .filter(({ population }) => population === "catalog")
        .map(({ conceptId, familyId, nativeSize, paint }) => ({
          concept: conceptId,
          family: familyId,
          finish: paint,
          nativeSize,
          slotId: `${familyId}/${conceptId}/${nativeSize}/${paint}`,
        }))
        .toSorted((left, right) => {
          const conceptOrder = left.concept.localeCompare(right.concept);
          if (conceptOrder !== 0) {
            return conceptOrder;
          }
          const sizeOrder = left.nativeSize - right.nativeSize;
          if (sizeOrder !== 0) {
            return sizeOrder;
          }
          if (left.finish === right.finish) {
            return 0;
          }
          return left.finish === "outlined" ? -1 : 1;
        })
    )
  );

const scopeSlots = (
  slots: readonly AcceptanceExpectedSlot[],
  scope: string
) => {
  if (scope === "every-output") {
    return slots;
  }
  const [population, stratum] = scope.split("/");
  if (!POPULATIONS.includes(population ?? "")) {
    return null;
  }
  return slots.filter(
    (slot) =>
      slot.population === population &&
      (stratum === undefined || `${slot.paint}-${slot.nativeSize}` === stratum)
  );
};

// Each disposition has a deliberately complete null/identity conjunction.
// eslint-disable-next-line complexity
const terminalOutputState = (
  report: AcceptanceCampaignTerminalReport,
  output: AcceptanceOutputEvidence
) => {
  const noInspection =
    (output.authorProvenance === null ||
      output.authorProvenance === undefined) &&
    output.completedAt === null &&
    output.deliveryArtifactValid === null &&
    output.exactReplay === null &&
    hasNoInspectionEvidence(output);
  if (report.disposition === "unstarted") {
    return (
      output.evidenceDisposition === "unstarted" &&
      output.artifactHash === null &&
      output.originalDeadlineAt === null &&
      output.requestIntentHash === null &&
      output.terminalState === "unstarted" &&
      output.deliveryState === "unstarted" &&
      noInspection
    );
  }
  if (report.disposition === "production-unknown") {
    const terminalState =
      report.terminalStatus === "refused" ? "refused" : "uncertain";
    const deliveryState =
      report.terminalStatus === "refused" ? "refused" : "failed";
    return (
      output.evidenceDisposition === "production-unknown" &&
      output.artifactHash === null &&
      output.originalDeadlineAt === report.deadlineAt &&
      output.requestIntentHash === report.requestIntentHash &&
      HASH.test(report.requestIntentHash ?? "") &&
      output.terminalState === terminalState &&
      output.deliveryState === deliveryState &&
      noInspection
    );
  }
  if (report.selectedEvidence.state !== "retained-produced") {
    return false;
  }
  const expectedHash =
    output.paint === "outlined"
      ? report.selectedEvidence.outlinedSha256
      : report.selectedEvidence.filledSha256;
  const delivered = report.terminalStatus === "delivered";
  const terminalState =
    report.terminalStatus === "refused" ? "refused" : "uncertain";
  let deliveryState: AcceptanceOutputEvidence["deliveryState"] = "failed";
  if (delivered) {
    deliveryState = "delivered";
  } else if (report.terminalStatus === "refused") {
    deliveryState = "refused";
  }
  const { authorEvidence } = report;
  const authorProvenanceMatches = report.authorEvidenceVerified
    ? authorEvidence !== null &&
      authorEvidence !== undefined &&
      output.authorProvenance?.artifactHash === expectedHash &&
      output.authorProvenance.authorId === authorEvidence.authorId &&
      output.authorProvenance.lineage === authorEvidence.authorLineage
    : output.authorProvenance === null || output.authorProvenance === undefined;
  return (
    output.evidenceDisposition === "produced-not-inspected" &&
    output.artifactHash === expectedHash &&
    output.originalDeadlineAt === report.deadlineAt &&
    output.requestIntentHash === report.requestIntentHash &&
    HASH.test(report.requestIntentHash ?? "") &&
    output.terminalState === terminalState &&
    output.deliveryState === deliveryState &&
    output.deliveryArtifactValid === (delivered ? true : null) &&
    authorProvenanceMatches &&
    output.completedAt === null &&
    output.exactReplay === null &&
    hasNoInspectionEvidence(output)
  );
};

const directSuccess = (
  dimension: AcceptanceDimension,
  output: AcceptanceOutputEvidence
) => {
  if (output.terminalState !== "accepted") {
    return false;
  }
  if (dimension === "craft") {
    return output.shipUnchanged === true;
  }
  if (dimension === "geometry") {
    return output.criticalDefect === false && output.exactReplay === true;
  }
  if (dimension === "houseParity") {
    return output.familyFit === true;
  }
  if (dimension === "nativeQuality") {
    return (
      nativeObservations(output).length === 2 &&
      nativeObservations(output).every(({ legible }) => legible === true)
    );
  }
  if (dimension === "recognition") {
    return output.recognitionCorrect === true;
  }
  return null;
};

const directMinimumRate = (dimension: AcceptanceDimension) => {
  if (dimension === "craft") {
    return DRAFT_ACCEPTANCE_CONTRACT.dimensions.craft.shipUnchangedMinimumRate;
  }
  if (dimension === "geometry") {
    return 1;
  }
  if (dimension === "houseParity") {
    return DRAFT_ACCEPTANCE_CONTRACT.dimensions.houseParity
      .familyFitMinimumRate;
  }
  if (dimension === "nativeQuality") {
    return DRAFT_ACCEPTANCE_CONTRACT.dimensions.nativeQuality.minimumRate;
  }
  if (dimension === "recognition") {
    return DRAFT_ACCEPTANCE_CONTRACT.dimensions.recognition.minimumRate;
  }
  return null;
};

const independentMetricContradictsPass = (
  dimension: AcceptanceDimension,
  metric: AcceptanceIndependentReviewMetric
) => {
  if (!metric.evidenceValid) {
    return true;
  }
  if (dimension === "craft") {
    return (
      metric.shipRate <
        DRAFT_ACCEPTANCE_CONTRACT.dimensions.craft.shipUnchangedMinimumRate ||
      metric.craftMedian === null ||
      metric.craftMedian <
        DRAFT_ACCEPTANCE_CONTRACT.dimensions.craft.medianMinimum
    );
  }
  if (dimension === "houseParity") {
    return (
      metric.familyFitRate <
      DRAFT_ACCEPTANCE_CONTRACT.dimensions.houseParity.familyFitMinimumRate
    );
  }
  if (dimension === "nativeQuality") {
    return (
      metric.nativeLegibilityRate <
      DRAFT_ACCEPTANCE_CONTRACT.dimensions.nativeQuality.minimumRate
    );
  }
  if (dimension === "recognition") {
    return (
      metric.recognitionRate <
      DRAFT_ACCEPTANCE_CONTRACT.dimensions.recognition.minimumRate
    );
  }
  return false;
};

const expectedGateReviewPopulations = (
  dimension: AcceptanceDimension,
  scope: string
): readonly AcceptanceReviewPopulationPurpose[] => {
  if (typeof scope !== "string") {
    return [];
  }
  if (dimension === "evaluation") {
    return ["production-catalog-critic"];
  }
  if (
    scope.startsWith("catalog/") &&
    ["craft", "houseParity", "nativeQuality", "recognition"].includes(dimension)
  ) {
    return ["production-catalog-critic", "catalog-probability-audit"];
  }
  if (
    scope.startsWith("novel-batch-a") &&
    [
      "craft",
      "generalization",
      "houseParity",
      "nativeQuality",
      "recognition",
    ].includes(dimension)
  ) {
    return ["novel-panel-a"];
  }
  if (
    scope.startsWith("novel-batch-b") &&
    [
      "craft",
      "generalization",
      "houseParity",
      "nativeQuality",
      "recognition",
    ].includes(dimension)
  ) {
    return ["novel-panel-b"];
  }
  return [];
};

/** Validates the evidence envelope consumed by the foundry gate. Dimension
 * modules still compute their own metrics; this closes omissions and
 * contradictory terminal claims before any aggregate may qualify. */
// Evidence-envelope validation intentionally checks every independent failure
// mode in one pass so callers receive a complete refusal receipt.
// eslint-disable-next-line complexity
export const validateAcceptanceReport = (
  report: AcceptanceReport,
  computedEvidence: AcceptanceComputedEvidence = {}
) => {
  const reasons: string[] = [];
  const uncertaintyContractValid =
    report.uncertainty?.confidenceLevel ===
      FAMILY_CLUSTERED_BOOTSTRAP_CONFIDENCE &&
    report.uncertainty.method === FAMILY_CLUSTERED_BOOTSTRAP_METHOD &&
    nonEmptyString(report.uncertainty.seed) &&
    report.uncertainty.resamplingCount ===
      DRAFT_ACCEPTANCE_CONTRACT.uncertainty.resamplingCount;
  const uncertainty = uncertaintyContractValid
    ? report.uncertainty
    : {
        confidenceLevel: FAMILY_CLUSTERED_BOOTSTRAP_CONFIDENCE,
        method: FAMILY_CLUSTERED_BOOTSTRAP_METHOD,
        resamplingCount: 1000,
        seed: "invalid-uncertainty-contract",
      };
  const expectedById = new Map(
    report.expectedSlots.map((slot) => [slot.slotId, slot])
  );
  const outputById = new Map(
    report.outputs.map((output) => [output.slotId, output])
  );
  const terminalReports = computedEvidence.campaignTerminals
    ? activeCampaignTerminalCapabilities.get(computedEvidence.campaignTerminals)
    : undefined;
  const terminalRequestIds = new Set<string>();
  if (computedEvidence.campaignTerminals && !terminalReports) {
    reasons.push(
      "Campaign terminal evidence is not active process-local authority"
    );
  }
  if (terminalReports) {
    const terminalSlotIds = new Set<string>();
    for (const [requestId, terminal] of terminalReports) {
      const expected = report.expectedSlots.filter(
        (slot) => slot.requestId === requestId
      );
      const outputs = expected.flatMap((slot) => {
        const output = outputById.get(slot.slotId);
        return output ? [output] : [];
      });
      if (
        expected.length !== 2 ||
        outputs.length !== expected.length ||
        canonical(expected.map(({ slotId }) => slotId).toSorted()) !==
          canonical([...terminal.slotIds].toSorted()) ||
        expected.some(({ slotId }) => terminalSlotIds.has(slotId)) ||
        expected.some(
          ({ originalDeadlineAt }) => originalDeadlineAt !== terminal.deadlineAt
        ) ||
        outputs.some((output) => !terminalOutputState(terminal, output))
      ) {
        reasons.push(
          `Campaign terminal evidence does not match request: ${requestId}`
        );
      }
      for (const { slotId } of expected) {
        terminalSlotIds.add(slotId);
      }
      terminalRequestIds.add(requestId);
    }
  }
  const observed = new Set<string>();
  const expectedReviewPopulations: Readonly<
    Record<AcceptanceReviewPopulationPurpose, number>
  > = {
    "catalog-probability-audit": 400,
    "novel-panel-a": report.expectedSlots.filter(
      ({ population }) => population === "novel-batch-a"
    ).length,
    "novel-panel-b": report.expectedSlots.filter(
      ({ population }) => population === "novel-batch-b"
    ).length,
    "production-catalog-critic": report.expectedSlots.filter(
      ({ population }) => population === "catalog"
    ).length,
  };
  const suppliedReviewPopulationCount = Array.isArray(report.reviewPopulations)
    ? report.reviewPopulations.length
    : -1;
  const reviewPopulationRows = Array.isArray(report.reviewPopulations)
    ? report.reviewPopulations.filter(
        (population): population is AcceptanceReviewPopulationIdentity =>
          population !== null && typeof population === "object"
      )
    : [];
  const reviewPopulations = new Map(
    reviewPopulationRows.map((population) => [population.purpose, population])
  );
  if (
    reviewPopulations.size !== Object.keys(expectedReviewPopulations).length ||
    suppliedReviewPopulationCount !== reviewPopulations.size ||
    Object.entries(expectedReviewPopulations).some(([purpose, denominator]) => {
      const population = reviewPopulations.get(
        purpose as AcceptanceReviewPopulationPurpose
      );
      return (
        !population ||
        population.requestedDenominator !== denominator ||
        !HASH.test(population.instrumentHash) ||
        !HASH.test(population.manifestHash) ||
        !HASH.test(population.populationHash)
      );
    }) ||
    new Set(reviewPopulationRows.map(({ manifestHash }) => manifestHash))
      .size !== reviewPopulationRows.length ||
    new Set(reviewPopulationRows.map(({ populationHash }) => populationHash))
      .size !== report.reviewPopulations?.length
  ) {
    reasons.push(
      "Independent review population identities are invalid or reused"
    );
  }
  const independentRows = Array.isArray(report.independentReviewPopulations)
    ? report.independentReviewPopulations.filter(
        (population): population is AcceptanceIndependentReviewPopulation =>
          population !== null && typeof population === "object"
      )
    : [];
  const independentByPurpose = new Map(
    independentRows.map((population) => [population.purpose, population])
  );
  const independentPurposes: readonly AcceptanceIndependentReviewPurpose[] = [
    "catalog-probability-audit",
    "novel-panel-a",
    "novel-panel-b",
  ];
  const independentEnvelopeValid =
    Array.isArray(report.independentReviewPopulations) &&
    independentRows.length === report.independentReviewPopulations.length &&
    independentByPurpose.size === independentPurposes.length &&
    independentRows.length === independentPurposes.length;
  const invalidIndependentPurposes =
    new Set<AcceptanceIndependentReviewPurpose>();
  if (
    !Array.isArray(report.independentReviewPopulations) ||
    independentRows.length !== report.independentReviewPopulations.length ||
    independentByPurpose.size !== independentPurposes.length ||
    independentRows.length !== independentPurposes.length
  ) {
    reasons.push("Independent review population data is missing or duplicated");
  }
  const productionReviewerIds = new Set(
    report.outputs.flatMap((output) =>
      Array.isArray(output.reviewerAssessments)
        ? output.reviewerAssessments.flatMap((review) =>
            review !== null &&
            typeof review === "object" &&
            nonEmptyString(review.reviewerId)
              ? [review.reviewerId]
              : []
          )
        : []
    )
  );
  const productionEvidenceHashes = new Set(
    report.outputs.flatMap((output) =>
      Array.isArray(output.reviewerAssessments)
        ? output.reviewerAssessments.flatMap((review) =>
            review !== null &&
            typeof review === "object" &&
            nonEmptyString(review.reviewEvidenceHash)
              ? [review.reviewEvidenceHash]
              : []
          )
        : []
    )
  );
  const independentEvidenceHashes = new Set<string>();
  for (const purpose of independentPurposes) {
    const population = independentByPurpose.get(purpose);
    const identity = reviewPopulations.get(purpose);
    if (!population || !identity || !Array.isArray(population.slots)) {
      invalidIndependentPurposes.add(purpose);
      reasons.push(`Independent review population data is invalid: ${purpose}`);
      continue;
    }
    const rawPopulationSlots = population.slots as readonly unknown[];
    const populationSlots = rawPopulationSlots.filter(
      (slot): slot is AcceptanceIndependentReviewSlot =>
        slot !== null && typeof slot === "object"
    );
    if (populationSlots.length !== rawPopulationSlots.length) {
      invalidIndependentPurposes.add(purpose);
      reasons.push(`Independent review population data is invalid: ${purpose}`);
      continue;
    }
    const selectedIds = populationSlots.map(({ slotId }) => slotId);
    const expectedSelectionHash = hashAcceptanceIndependentReviewSelection(
      purpose,
      selectedIds
    );
    const selected = populationSlots
      .map(({ slotId }) => expectedById.get(slotId))
      .filter((slot): slot is AcceptanceExpectedSlot => slot !== undefined);
    let expectedPopulation: AcceptancePopulation = "novel-batch-b";
    if (purpose === "catalog-probability-audit") {
      expectedPopulation = "catalog";
    } else if (purpose === "novel-panel-a") {
      expectedPopulation = "novel-batch-a";
    }
    const familyGroups = new Map<string, AcceptanceExpectedSlot[]>();
    for (const slot of selected) {
      familyGroups.set(slot.familyId, [
        ...(familyGroups.get(slot.familyId) ?? []),
        slot,
      ]);
    }
    const expectedFamilyCount =
      purpose === "catalog-probability-audit" ? 100 : 20;
    const expectedSlotCount = expectedFamilyCount * 4;
    const completeFamilies = [...familyGroups.values()].every(
      (slots) =>
        slots.length === 4 &&
        new Set(slots.map(({ conceptId }) => conceptId)).size === 1 &&
        new Set(slots.map(({ paint, nativeSize }) => `${paint}/${nativeSize}`))
          .size === 4
    );
    if (
      selectedIds.length !== expectedSlotCount ||
      new Set(selectedIds).size !== selectedIds.length ||
      selected.length !== selectedIds.length ||
      selected.some(
        ({ population: candidatePopulation }) =>
          candidatePopulation !== expectedPopulation
      ) ||
      familyGroups.size !== expectedFamilyCount ||
      !completeFamilies ||
      (purpose !== "catalog-probability-audit" &&
        new Set(selectedIds).size !==
          report.expectedSlots.filter(
            ({ population: candidate }) => candidate === expectedPopulation
          ).length) ||
      !Number.isSafeInteger(population.selectionSealedAt) ||
      population.selectionSealedAt <= 0 ||
      population.selectionHash !== expectedSelectionHash ||
      identity.populationHash !== expectedSelectionHash ||
      identity.manifestHash !==
        hashAcceptanceIndependentReviewEvidence(population)
    ) {
      invalidIndependentPurposes.add(purpose);
      reasons.push(`Independent review selection is invalid: ${purpose}`);
    }
    for (const selectedSlot of populationSlots) {
      const expected = expectedById.get(selectedSlot.slotId);
      const output = outputById.get(selectedSlot.slotId);
      const rawReviews = Array.isArray(selectedSlot.reviews)
        ? (selectedSlot.reviews as readonly unknown[])
        : [];
      const reviews = rawReviews.filter(
        (review): review is AcceptanceIndependentPanelReview =>
          review !== null && typeof review === "object"
      );
      const inspected = selectedSlot.disposition === "inspected";
      if (
        !expected ||
        !Array.isArray(selectedSlot.reviews) ||
        reviews.length !== rawReviews.length ||
        !["inspected", "missing", "uninspected"].includes(
          selectedSlot.disposition
        ) ||
        (inspected ? reviews.length !== 2 : reviews.length !== 0) ||
        (selectedSlot.disposition === "missing" &&
          output?.artifactHash !== null) ||
        (selectedSlot.disposition !== "missing" && !output?.artifactHash) ||
        (output?.completedAt !== null &&
          output?.completedAt !== undefined &&
          population.selectionSealedAt >= output.completedAt)
      ) {
        invalidIndependentPurposes.add(purpose);
        reasons.push(
          `Independent review row is invalid: ${purpose}/${selectedSlot.slotId}`
        );
        continue;
      }
      if (!inspected) {
        continue;
      }
      const reviewerIds = new Set(reviews.map(({ reviewerId }) => reviewerId));
      const lineages = new Set(reviews.map(({ lineage }) => lineage));
      let evidenceIsReused = false;
      for (const { reviewEvidenceHash } of reviews) {
        if (independentEvidenceHashes.has(reviewEvidenceHash)) {
          evidenceIsReused = true;
        }
        independentEvidenceHashes.add(reviewEvidenceHash);
      }
      if (
        !output?.artifactHash ||
        reviewerIds.size !== 2 ||
        lineages.size !== 2 ||
        evidenceIsReused ||
        reviews.some(
          (review) =>
            !independentPanelReviewIsValid(review, {
              artifactHash: output.artifactHash ?? "",
              authorLineage: output.authorProvenance?.lineage,
              outputCompletedAt: output.completedAt,
              productionEvidenceHashes,
              productionReviewerIds,
              selectionSealedAt: population.selectionSealedAt,
            })
        )
      ) {
        invalidIndependentPurposes.add(purpose);
        reasons.push(
          `Independent panel evidence is invalid: ${purpose}/${selectedSlot.slotId}`
        );
      }
    }
  }
  const independentReviewMetrics = independentPurposes.flatMap((purpose) => {
    const population = independentByPurpose.get(purpose);
    return population
      ? computeIndependentReviewMetrics(
          population,
          expectedById,
          independentEnvelopeValid &&
            uncertaintyContractValid &&
            !invalidIndependentPurposes.has(purpose),
          uncertainty
        )
      : [];
  });
  const independentMetricByScope = new Map(
    independentReviewMetrics.map((metric) => [metric.scope, metric])
  );
  if (
    report.contractVersion !== ACCEPTANCE_CONTRACT_VERSION ||
    expectedById.size !== report.expectedSlots.length ||
    report.expectedSlots.length === 0 ||
    report.expectedSlots.some(
      (slot) =>
        !nonEmptyString(slot.slotId) ||
        !nonEmptyString(slot.requestId) ||
        !nonEmptyString(slot.conceptId) ||
        !nonEmptyString(slot.familyId) ||
        !nonEmptyString(slot.canonicalSlotId) ||
        !(
          (slot.requestIntentHash === null &&
            slot.originalDeadlineAt === null) ||
          (HASH.test(slot.requestIntentHash ?? "") &&
            Number.isSafeInteger(slot.originalDeadlineAt) &&
            Number(slot.originalDeadlineAt) > 0)
        ) ||
        !POPULATIONS.includes(slot.population) ||
        ![16, 24].includes(slot.nativeSize) ||
        !["filled", "outlined"].includes(slot.paint)
    )
  ) {
    reasons.push("Acceptance contract or expected-slot identity is invalid");
  }
  const catalogSlots = report.expectedSlots.filter(
    ({ population }) => population === "catalog"
  );
  if (
    catalogSlots.length !== CATALOG_SLOT_COUNT ||
    new Set(catalogSlots.map(({ conceptId }) => conceptId)).size !==
      CATALOG_CONCEPT_COUNT
  ) {
    reasons.push(
      "Catalog population must match the frozen 2221-concept, 8884-slot census"
    );
  }
  if (
    report.catalogSlotManifestHash !== FROZEN_CATALOG_SLOT_CENSUS_HASH ||
    hashAcceptanceCatalogSlotCensus(report.expectedSlots) !==
      FROZEN_CATALOG_SLOT_CENSUS_HASH
  ) {
    reasons.push(
      "Catalog slot census identity does not match the frozen manifest"
    );
  }
  for (const slot of report.expectedSlots) {
    const canonicalSlot = expectedById.get(slot.canonicalSlotId);
    if (
      !canonicalSlot ||
      canonicalSlot.canonicalSlotId !== canonicalSlot.slotId ||
      (slot.canonicalSlotId !== slot.slotId &&
        (slot.population !== "catalog" ||
          canonicalSlot.population !== slot.population ||
          canonicalSlot.familyId !== slot.familyId ||
          canonicalSlot.nativeSize !== slot.nativeSize ||
          canonicalSlot.paint !== slot.paint))
    ) {
      reasons.push(`Invalid canonical or reuse slot: ${slot.slotId}`);
    }
  }
  const requests = new Map<string, AcceptanceExpectedSlot[]>();
  for (const slot of report.expectedSlots) {
    const key = `${slot.population}\0${slot.requestId}`;
    requests.set(key, [...(requests.get(key) ?? []), slot]);
  }
  const pairedPaints = new Set<AcceptanceExpectedSlot["paint"]>([
    "outlined",
    "filled",
  ]);
  const requestIntentOwners = new Map<string, string>();
  for (const [requestKey, slots] of requests) {
    const paints = new Set(slots.map(({ paint }) => paint));
    if (
      slots.length !== pairedPaints.size ||
      paints.size !== pairedPaints.size ||
      [...pairedPaints].some((paint) => !paints.has(paint)) ||
      new Set(slots.map(({ familyId }) => familyId)).size !== 1 ||
      new Set(slots.map(({ conceptId }) => conceptId)).size !== 1 ||
      new Set(slots.map(({ nativeSize }) => nativeSize)).size !== 1 ||
      new Set(slots.map(({ originalDeadlineAt }) => originalDeadlineAt))
        .size !== 1 ||
      new Set(slots.map(({ requestIntentHash }) => requestIntentHash)).size !==
        1
    ) {
      reasons.push(
        `Missing or duplicate paired slots: ${slots[0]?.population}/${slots[0]?.requestId}`
      );
    }
    const [requestIntentHash] = slots.map((slot) => slot.requestIntentHash);
    const existingOwner = requestIntentHash
      ? requestIntentOwners.get(requestIntentHash)
      : undefined;
    if (requestIntentHash && existingOwner && existingOwner !== requestKey) {
      reasons.push(`Request intent identity is reused: ${requestKey}`);
    } else if (requestIntentHash) {
      requestIntentOwners.set(requestIntentHash, requestKey);
    }
  }
  const concepts = new Map<string, AcceptanceExpectedSlot[]>();
  for (const slot of report.expectedSlots) {
    const key = `${slot.population}\0${slot.familyId}\0${slot.conceptId}`;
    concepts.set(key, [...(concepts.get(key) ?? []), slot]);
  }
  const conceptStrata = new Set([
    "outlined-16",
    "outlined-24",
    "filled-16",
    "filled-24",
  ]);
  for (const slots of concepts.values()) {
    const combinations = new Set(
      slots.map(({ nativeSize, paint }) => `${paint}-${nativeSize}`)
    );
    const canonicalConcepts = new Set(
      slots.map((slot) => expectedById.get(slot.canonicalSlotId)?.conceptId)
    );
    const reuseKinds = new Set(
      slots.map((slot) => slot.canonicalSlotId === slot.slotId)
    );
    if (
      slots.length !== conceptStrata.size ||
      combinations.size !== conceptStrata.size ||
      [...conceptStrata].some(
        (combination) => !combinations.has(combination)
      ) ||
      canonicalConcepts.size !== 1 ||
      canonicalConcepts.has(undefined) ||
      reuseKinds.size !== 1
    ) {
      reasons.push(
        `Missing or inconsistent concept-size counterparts: ${slots[0]?.population}/${slots[0]?.familyId}/${slots[0]?.conceptId}`
      );
    }
  }
  const novelFamilies = new Map<string, Set<string>>();
  for (const population of ["novel-batch-a", "novel-batch-b"] as const) {
    const slots = report.expectedSlots.filter(
      (slot) => slot.population === population
    );
    const families = new Set(slots.map(({ familyId }) => familyId));
    novelFamilies.set(population, families);
    const familyStrata = new Set(
      slots.map(({ familyId, nativeSize, paint }) =>
        JSON.stringify({ familyId, nativeSize, paint })
      )
    );
    if (
      slots.length !==
        DRAFT_ACCEPTANCE_CONTRACT.dimensions.generalization.outputsPerBatch ||
      families.size !==
        DRAFT_ACCEPTANCE_CONTRACT.dimensions.generalization.familiesPerBatch ||
      familyStrata.size !== slots.length
    ) {
      reasons.push(
        `Novel population must contain 20 families and 80 unique slots: ${population}`
      );
    }
  }
  if (
    [...(novelFamilies.get("novel-batch-a") ?? [])].some((family) =>
      novelFamilies.get("novel-batch-b")?.has(family)
    )
  ) {
    reasons.push("Novel batch families must be disjoint");
  }
  if (!uncertaintyContractValid) {
    reasons.push("Uncertainty method, seed and resampling count are required");
  }
  const parityProtocolHashes = new Set(
    report.outputs
      .filter(
        ({ evidenceDisposition }) =>
          evidenceDisposition === "produced-inspected"
      )
      .flatMap((output) =>
        houseComparisons(output).map(
          ({ presentationProtocolHash }) => presentationProtocolHash
        )
      )
  );
  if (parityProtocolHashes.size > 1) {
    reasons.push("House parity presentation protocol identity is inconsistent");
  }
  for (const output of report.outputs) {
    const expected = expectedById.get(output.slotId);
    if (!expected || observed.has(output.slotId)) {
      reasons.push(`Unexpected or duplicate output slot: ${output.slotId}`);
    } else if (slotIdentity(output) !== slotIdentity(expected)) {
      reasons.push(
        `Output identity does not match expected slot: ${output.slotId}`
      );
    }
    observed.add(output.slotId);
    const nativeEvidence = nativeObservations(output);
    const parityEvidence = houseComparisons(output);
    const assessments = reviewerAssessments(output);
    const assessmentReviewerIds = new Set(
      assessments.map(({ reviewerId }) => reviewerId)
    );
    const assessmentEvidenceHashes = new Set(
      assessments.map(({ reviewEvidenceHash }) => reviewEvidenceHash)
    );
    const nativeSurfaces = new Set(
      nativeEvidence.map(({ surface }) => surface)
    );
    const parityReviewers = new Set(
      parityEvidence.map(({ reviewerId }) => reviewerId)
    );
    const parityReferences = new Set(
      parityEvidence.map(({ referenceArtifactHash }) => referenceArtifactHash)
    );
    const { authorProvenance, reviewerProvenance: outputReviewerProvenance } =
      output;
    const reviewerProvenance = Array.isArray(outputReviewerProvenance)
      ? outputReviewerProvenance
      : [];
    const reviewerIds = new Set(
      reviewerProvenance.map(({ reviewerId }) => reviewerId)
    );
    const reviewerLineages = new Set(
      reviewerProvenance.map(({ lineage }) => lineage)
    );
    const reviewerEvidenceById = new Map(
      reviewerProvenance.map(({ reviewEvidenceHash, reviewerId }) => [
        reviewerId,
        reviewEvidenceHash,
      ])
    );
    const referencedReviewerIds = new Set([
      ...parityEvidence.map(({ reviewerId }) => reviewerId),
      ...nativeEvidence.map(({ reviewerId }) => reviewerId),
      ...assessments.map(({ reviewerId }) => reviewerId),
    ]);
    const baseEvidenceValid =
      DRAFT_ACCEPTANCE_CONTRACT.terminalStates.includes(output.terminalState) &&
      [16, 24].includes(output.nativeSize) &&
      ["filled", "outlined"].includes(output.paint) &&
      ((output.requestIntentHash === null &&
        output.originalDeadlineAt === null) ||
        (HASH.test(output.requestIntentHash ?? "") &&
          Number.isSafeInteger(output.originalDeadlineAt) &&
          Number(output.originalDeadlineAt) > 0)) &&
      ["delivered", "failed", "refused", "timed-out", "unstarted"].includes(
        output.deliveryState
      ) &&
      (output.artifactHash === null || HASH.test(output.artifactHash)) &&
      (output.exactReplay === null ||
        typeof output.exactReplay === "boolean") &&
      (output.completedAt === null ||
        (Number.isSafeInteger(output.completedAt) && output.completedAt > 0));
    if (!baseEvidenceValid) {
      reasons.push(`Missing or invalid acceptance labels: ${output.slotId}`);
    }

    if (output.evidenceDisposition === "not-produced") {
      const terminalMatchesDelivery =
        output.terminalState === output.deliveryState &&
        ["failed", "refused", "timed-out"].includes(output.terminalState);
      if (
        !terminalMatchesDelivery ||
        output.artifactHash !== null ||
        (output.authorProvenance !== undefined &&
          output.authorProvenance !== null) ||
        output.completedAt !== null ||
        output.deliveryArtifactValid !== null ||
        output.exactReplay !== null ||
        !hasNoInspectionEvidence(output)
      ) {
        reasons.push(`Invalid not-produced evidence: ${output.slotId}`);
      }
      if (!terminalRequestIds.has(output.requestId)) {
        reasons.push(
          `Not-produced evidence lacks trusted campaign terminal evidence: ${output.slotId}`
        );
      }
    } else if (
      output.evidenceDisposition === "production-unknown" ||
      output.evidenceDisposition === "unstarted"
    ) {
      if (!terminalRequestIds.has(output.requestId)) {
        reasons.push(
          `Campaign terminal disposition lacks trusted evidence: ${output.slotId}`
        );
      }
    } else if (output.evidenceDisposition === "produced-not-inspected") {
      const terminalAuthorized = terminalRequestIds.has(output.requestId);
      if (
        (!terminalAuthorized && output.terminalState !== "uncertain") ||
        (!terminalAuthorized && output.deliveryState !== "delivered") ||
        (!terminalAuthorized && output.deliveryArtifactValid !== true) ||
        output.artifactHash === null ||
        (!terminalAuthorized && output.completedAt === null) ||
        (!terminalAuthorized && !authorProvenance) ||
        (!terminalAuthorized &&
          authorProvenance?.artifactHash !== output.artifactHash) ||
        (!terminalAuthorized && !nonEmptyString(authorProvenance?.authorId)) ||
        (!terminalAuthorized && !nonEmptyString(authorProvenance?.lineage)) ||
        !hasNoInspectionEvidence(output)
      ) {
        reasons.push(
          `Invalid produced-not-inspected evidence: ${output.slotId}`
        );
      }
    } else if (output.evidenceDisposition === "produced-inspected") {
      if (
        outputCraftRatings(output).length === 0 ||
        outputCraftRatings(output).some((rating) => !completeRating(rating)) ||
        parityEvidence.length === 0 ||
        parityReviewers.size !== parityEvidence.length ||
        parityReferences.size !== 1 ||
        parityEvidence.some(
          ({
            candidateCraft,
            presentationProtocolHash,
            referenceArtifactHash,
            referenceCraft,
            reviewerId,
          }) =>
            !nonEmptyString(reviewerId) ||
            !completeRating(candidateCraft) ||
            !completeRating(referenceCraft) ||
            !HASH.test(referenceArtifactHash) ||
            !HASH.test(presentationProtocolHash)
        ) ||
        nativeEvidence.length !== 2 ||
        nativeSurfaces.size !== 2 ||
        !nativeSurfaces.has("light") ||
        !nativeSurfaces.has("dark") ||
        nativeEvidence.some(
          ({
            artifactHash,
            legible,
            reviewerId,
            sourceArtifactHash,
            surface,
          }) =>
            !nonEmptyString(reviewerId) ||
            !HASH.test(artifactHash) ||
            !HASH.test(sourceArtifactHash) ||
            typeof legible !== "boolean" ||
            !["light", "dark"].includes(surface)
        ) ||
        [
          output.criticalDefect,
          output.deliveryArtifactValid,
          output.familyFit,
          output.recognitionCorrect,
          output.shipUnchanged,
        ].some((label) => label !== null && typeof label !== "boolean")
      ) {
        reasons.push(`Missing or invalid acceptance labels: ${output.slotId}`);
      }
      if (
        !Array.isArray(output.reviewerAssessments) ||
        assessments.length !== output.reviewerAssessments.length ||
        assessments.length < 2 ||
        assessmentReviewerIds.size !== assessments.length ||
        assessmentEvidenceHashes.size !== assessments.length ||
        assessments.some(
          ({
            artifactHash,
            craftRating,
            criticalDefect,
            familyFit,
            recognitionCorrect,
            reviewEvidenceHash,
            reviewerId,
            shipUnchanged,
          }) =>
            artifactHash !== output.artifactHash ||
            !completeRating(craftRating) ||
            (criticalDefect === true && shipUnchanged === true) ||
            !HASH.test(reviewEvidenceHash) ||
            reviewerEvidenceById.get(reviewerId) !== reviewEvidenceHash ||
            !nonEmptyString(reviewerId) ||
            [criticalDefect, familyFit, shipUnchanged].some(
              (label) => typeof label !== "boolean"
            ) ||
            !(
              recognitionCorrect === null ||
              typeof recognitionCorrect === "boolean"
            )
        )
      ) {
        reasons.push(`Invalid reviewer assessment evidence: ${output.slotId}`);
      }
      if (!sameRatings(output.craftRatings, outputCraftRatings(output))) {
        reasons.push(
          `Craft ratings do not match reviewer assessments: ${output.slotId}`
        );
      }
      if (
        output.criticalDefect !==
          aggregateReviewerLabel(assessments, "criticalDefect") ||
        output.familyFit !== aggregateReviewerLabel(assessments, "familyFit") ||
        output.recognitionCorrect !==
          aggregateReviewerLabel(assessments, "recognitionCorrect") ||
        output.shipUnchanged !==
          aggregateReviewerLabel(assessments, "shipUnchanged")
      ) {
        reasons.push(
          `Aggregate reviewer labels do not match assessments: ${output.slotId}`
        );
      }
      if (
        nativeEvidence.some(
          ({ sourceArtifactHash }) => sourceArtifactHash !== output.artifactHash
        )
      ) {
        reasons.push(
          `Native evidence source does not match output: ${output.slotId}`
        );
      }
      if (
        output.artifactHash === null ||
        !authorProvenance ||
        authorProvenance.artifactHash !== output.artifactHash ||
        !nonEmptyString(authorProvenance.authorId) ||
        !nonEmptyString(authorProvenance.lineage) ||
        reviewerProvenance.length < 2 ||
        reviewerProvenance.length !== assessments.length ||
        reviewerIds.size !== reviewerProvenance.length ||
        reviewerLineages.size !== reviewerProvenance.length ||
        reviewerProvenance.some(
          ({ artifactHash, lineage, reviewEvidenceHash, reviewerId }) =>
            artifactHash !== output.artifactHash ||
            !nonEmptyString(lineage) ||
            !HASH.test(reviewEvidenceHash) ||
            !nonEmptyString(reviewerId) ||
            reviewerId === authorProvenance.authorId ||
            lineage === authorProvenance.lineage
        ) ||
        [...referencedReviewerIds].some(
          (reviewerId) => !reviewerIds.has(reviewerId)
        ) ||
        [...reviewerIds].some(
          (reviewerId) => !assessmentReviewerIds.has(reviewerId)
        )
      ) {
        reasons.push(
          `Invalid independent artifact provenance: ${output.slotId}`
        );
      }
    } else {
      reasons.push(`Invalid evidence disposition: ${output.slotId}`);
    }
    if (output.criticalDefect === true && output.shipUnchanged === true) {
      reasons.push(`Critical-defect and ship conflict: ${output.slotId}`);
    }
    if (
      output.terminalState === "accepted" &&
      output.recognitionCorrect !== true
    ) {
      reasons.push(`Accepted recognition conflict: ${output.slotId}`);
    }
    if (
      output.terminalState === "accepted" &&
      (output.criticalDefect !== false || output.shipUnchanged !== true)
    ) {
      reasons.push(
        `Accepted terminal lacks consistent labels: ${output.slotId}`
      );
    }
    if (output.terminalState === "accepted" && output.exactReplay !== true) {
      reasons.push(`Accepted terminal lacks exact replay: ${output.slotId}`);
    }
    if (
      output.terminalState === "accepted" &&
      (nativeEvidence.length !== 2 ||
        !nativeEvidence.every(({ legible }) => legible === true))
    ) {
      reasons.push(
        `Accepted terminal lacks native legibility: ${output.slotId}`
      );
    }
    if (
      output.terminalState === "accepted" &&
      (output.deliveryState !== "delivered" ||
        output.deliveryArtifactValid !== true ||
        output.artifactHash === null ||
        output.completedAt === null ||
        output.originalDeadlineAt === null ||
        output.completedAt >= output.originalDeadlineAt)
    ) {
      reasons.push(`Accepted terminal lacks valid delivery: ${output.slotId}`);
    }
  }
  for (const slotId of expectedById.keys()) {
    if (!observed.has(slotId)) {
      reasons.push(`Missing output slot: ${slotId}`);
    }
  }
  const criticReviewRequirements: ProductionCriticReviewRequirement[] = [];
  for (const output of report.outputs.filter(
    ({ population }) => population === "catalog"
  )) {
    const criticReviewerId =
      computedEvidence.criticQualification?.criticReviewerId;
    const assessment = reviewerAssessments(output).find(
      ({ reviewerId }) => reviewerId === criticReviewerId
    );
    const recognitionEvidenceHash = assessment?.recognitionEvidenceHash;
    const light = nativeObservations(output).find(
      ({ reviewerId, surface }) =>
        reviewerId === criticReviewerId && surface === "light"
    );
    const dark = nativeObservations(output).find(
      ({ reviewerId, surface }) =>
        reviewerId === criticReviewerId && surface === "dark"
    );
    if (
      output.artifactHash &&
      output.authorProvenance &&
      output.requestIntentHash &&
      assessment &&
      assessment.recognitionAdjudication &&
      assessment.recognitionChoice &&
      recognitionEvidenceHash !== undefined &&
      HASH.test(recognitionEvidenceHash) &&
      HASH.test(assessment.reviewEvidenceHash) &&
      light &&
      dark &&
      light.legible === dark.legible &&
      light.reviewEvidenceHash === assessment.reviewEvidenceHash &&
      dark.reviewEvidenceHash === assessment.reviewEvidenceHash &&
      HASH.test(light.artifactHash) &&
      HASH.test(dark.artifactHash)
    ) {
      criticReviewRequirements.push({
        artifactHash: output.artifactHash,
        authorId: output.authorProvenance.authorId,
        authorLineage: output.authorProvenance.lineage,
        conceptId: output.conceptId,
        familyId: output.familyId,
        labels: {
          craftRating: assessment.craftRating,
          criticalDefect: assessment.criticalDefect,
          familyFit: assessment.familyFit,
          nativeLegibility: light.legible === true && dark.legible === true,
          recognitionAdjudication: assessment.recognitionAdjudication,
          recognitionChoice: assessment.recognitionChoice,
          recognitionCorrect: assessment.recognitionCorrect,
          shipUnchanged: assessment.shipUnchanged,
        },
        nativePresentationHashes: [light.artifactHash, dark.artifactHash],
        nativeSize: output.nativeSize,
        paint: output.paint,
        recognitionEvidenceHash,
        requestIntentHash: output.requestIntentHash,
        reviewEvidenceHash: assessment.reviewEvidenceHash,
        reviewerId: assessment.reviewerId,
        slotId: output.slotId,
      });
    }
  }
  const requiredCatalogCriticOutputs = report.outputs.filter(
    ({ population }) => population === "catalog"
  ).length;
  const requiredDimensions = Object.keys(
    DRAFT_ACCEPTANCE_CONTRACT.dimensions
  ) as AcceptanceDimension[];
  const gates = new Map<string, AcceptanceGateEvidence>();
  for (const gate of report.gates) {
    const key = `${gate.dimension}/${gate.scope}`;
    const expectedPopulationPurposes = expectedGateReviewPopulations(
      gate.dimension,
      gate.scope
    );
    const gateEvidencePopulations = Array.isArray(gate.evidencePopulations)
      ? gate.evidencePopulations
      : [];
    if (
      !Array.isArray(gate.evidencePopulations) ||
      gateEvidencePopulations.length !== expectedPopulationPurposes.length ||
      gateEvidencePopulations.some(
        (purpose, index) => purpose !== expectedPopulationPurposes[index]
      )
    ) {
      reasons.push(`Acceptance gate uses the wrong review population: ${key}`);
    }
    const independentMetric = independentMetricByScope.get(gate.scope);
    if (
      gate.passed &&
      independentMetric &&
      independentMetricContradictsPass(gate.dimension, independentMetric)
    ) {
      reasons.push(
        `Acceptance gate pass contradicts independent review evidence: ${key}`
      );
    }
    const productionCriticPopulation = reviewPopulations.get(
      "production-catalog-critic"
    );
    const criticPopulationMatches =
      gate.dimension === "evaluation" &&
      gate.computedCriticIdentity !== undefined &&
      gate.computedCriticIdentity !== null &&
      productionCriticPopulation !== undefined &&
      productionCriticPopulation.instrumentHash ===
        gate.computedCriticIdentity.qualificationVersionHash &&
      productionCriticPopulation.manifestHash ===
        gate.computedCriticIdentity.productionReviewManifestHash &&
      productionCriticPopulation.populationHash ===
        gate.computedCriticIdentity.reviewSetHash;
    const criticIdentityMatches =
      criticPopulationMatches &&
      criticQualificationReadyForProduction(
        computedEvidence.criticQualification,
        gate.computedCriticIdentity,
        criticReviewRequirements.length === requiredCatalogCriticOutputs
          ? criticReviewRequirements
          : undefined
      );
    if (
      !Object.hasOwn(ACCEPTANCE_GATE_SCOPES, gate.dimension) ||
      !ACCEPTANCE_GATE_SCOPES[gate.dimension].includes(gate.scope)
    ) {
      reasons.push(`Unknown acceptance gate: ${key}`);
      continue;
    }
    if (gates.has(key)) {
      reasons.push(`Duplicate acceptance gate: ${key}`);
    }
    gates.set(key, gate);
    if (
      (gate.dimension === "evaluation" && !criticIdentityMatches) ||
      gate.dimension === "repair" ||
      gate.dimension === "generalization"
    ) {
      reasons.push(`Computed sealed evidence is unavailable: ${key}`);
    }
    if (
      gateEvidencePopulations.some(
        (purpose) => purpose !== "production-catalog-critic"
      )
    ) {
      reasons.push(
        `Computed independent review evidence is unavailable: ${key}`
      );
    }
    if (
      !Number.isInteger(gate.denominator) ||
      !Number.isInteger(gate.successes) ||
      gate.denominator <= 0 ||
      gate.successes < 0 ||
      gate.successes > gate.denominator ||
      typeof gate.passed !== "boolean"
    ) {
      reasons.push(`Invalid acceptance gate evidence: ${key}`);
    }
    const scoped = scopeSlots(report.expectedSlots, gate.scope);
    const expectedDenominator =
      gate.dimension === "delivery" && scoped
        ? new Set(scoped.map(({ requestId }) => requestId)).size
        : scoped?.length;
    if (scoped && gate.denominator !== expectedDenominator) {
      reasons.push(
        `Acceptance gate denominator does not match expected slots: ${key}`
      );
    }
    if (scoped && gate.dimension === "delivery") {
      const deliveryRequests = new Map<string, AcceptanceExpectedSlot[]>();
      for (const slot of scoped) {
        deliveryRequests.set(slot.requestId, [
          ...(deliveryRequests.get(slot.requestId) ?? []),
          slot,
        ]);
      }
      const successes = [...deliveryRequests.values()].filter((slots) =>
        slots.every((slot) => {
          const output = outputById.get(slot.slotId);
          return (
            output !== undefined &&
            slotIdentity(output) === slotIdentity(slot) &&
            output.deliveryState === "delivered" &&
            output.deliveryArtifactValid === true &&
            output.artifactHash !== null &&
            HASH.test(output.artifactHash) &&
            output.completedAt !== null &&
            Number.isSafeInteger(output.completedAt) &&
            output.completedAt > 0 &&
            slot.originalDeadlineAt !== null &&
            output.completedAt < slot.originalDeadlineAt
          );
        })
      ).length;
      const passed =
        successes >=
        Math.ceil(
          deliveryRequests.size *
            DRAFT_ACCEPTANCE_CONTRACT.dimensions.delivery
              .completePairMinimumRate
        );
      if (gate.successes !== successes) {
        reasons.push(
          `Acceptance gate successes do not match output evidence: ${key}`
        );
      }
      if (gate.passed !== passed) {
        reasons.push(`Acceptance gate pass contradicts threshold: ${key}`);
      }
    } else if (scoped && gate.dimension !== "delivery") {
      const scopedIds = new Set(scoped.map(({ slotId }) => slotId));
      const direct = report.outputs.filter((output) =>
        scopedIds.has(output.slotId)
      );
      const successLabels = direct.map((output) =>
        directSuccess(gate.dimension, output)
      );
      const derivedSuccesses = successLabels.filter(Boolean).length;
      if (
        successLabels.length === scoped.length &&
        successLabels.every((value) => value !== null) &&
        gate.successes !== derivedSuccesses
      ) {
        reasons.push(
          `Acceptance gate successes do not match output evidence: ${key}`
        );
      }
      const minimumRate = directMinimumRate(gate.dimension);
      const craftMedian =
        gate.dimension === "craft"
          ? median(
              direct
                .filter((output) => outputCraftRatings(output).length > 0)
                .map((output) => median(outputCraftRatings(output)))
            )
          : null;
      const parityFamilyMedian =
        gate.dimension === "houseParity"
          ? median(
              groupByFamily(
                direct.filter((output) => houseComparisons(output).length > 0)
              ).map((familyOutputs) =>
                median(
                  familyOutputs.map((output) =>
                    median(
                      houseComparisons(output).map(
                        ({ candidateCraft, referenceCraft }) =>
                          candidateCraft - referenceCraft
                      )
                    )
                  )
                )
              )
            )
          : null;
      const passed =
        minimumRate === null
          ? null
          : derivedSuccesses >= Math.ceil(scoped.length * minimumRate) &&
            (craftMedian === null ||
              craftMedian >=
                DRAFT_ACCEPTANCE_CONTRACT.dimensions.craft.medianMinimum) &&
            (parityFamilyMedian === null ||
              parityFamilyMedian >=
                DRAFT_ACCEPTANCE_CONTRACT.dimensions.houseParity
                  .medianCraftDeltaMinimum);
      if (passed !== null && gate.passed !== passed) {
        reasons.push(`Acceptance gate pass contradicts threshold: ${key}`);
      }
    }
  }
  for (const dimension of requiredDimensions) {
    for (const scope of ACCEPTANCE_GATE_SCOPES[dimension]) {
      const key = `${dimension}/${scope}`;
      const gate = gates.get(key);
      if (!gate) {
        reasons.push(`Missing acceptance gate: ${key}`);
      } else if (!gate.passed) {
        reasons.push(`Acceptance gate failed: ${key}`);
      }
    }
  }
  return {
    envelopeValid: reasons.length === 0,
    independentReviewMetrics,
    qualification: false as const,
    reasons,
  };
};
