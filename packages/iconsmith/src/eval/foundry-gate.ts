/** The pilot's advancement rule, separate from the judge it qualifies.
 * Missing items, repeated pairs, unknown spend and exposed holdouts cannot
 * disappear into an average. These are engineering gates, not taste claims. */
export interface InstrumentTrial {
  defect: string;
  pairId: string;
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
    const complete = groups.every(
      (group) =>
        group.length === 2 &&
        new Set(group.map((trial) => trial.order)).size === 2
    );
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
