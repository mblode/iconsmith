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

export interface PilotItem {
  id: string;
  morphology: string;
  split: "development" | "completion" | "novel-family";
  variants: readonly string[];
}

export interface PilotObservation {
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
