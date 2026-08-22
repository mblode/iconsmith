/**
 * Scientific A/B of two experts on one concept class.
 *
 * `accept.ts` already states the two-stage rule: screen on the icons a
 * proposal was written against, decide on icons it has never seen. This file
 * is that rule for *experts*, not for policy prose. A treatment that cannot
 * beat the incumbent on the names it was aimed at does not get to spend the
 * hold-out. A treatment that wins the screen still has to win the decision,
 * strictly, and may not buy the win by drawing dirtier.
 *
 * One variable per hypothesis — control expert vs treatment expert, same
 * class. Three changes that win tell you nothing about which one won, and
 * that is as true of a routing table as it is of a prompt.
 *
 * `sealed` is not a stage here either. The caller that opens a final set
 * does it once, by hand, after the campaign.
 *
 * Per-icon ranking is `pick.ts`'s `better`: structural, then errors, then
 * part ops, then cosine. Unknown analog counts as a structural miss. The
 * model does not vote.
 */
import type { GenerateResult } from "./generate.js";
import {
  CONCEPT_CLASSES,
  EXPERT_IDS,
  mixtureSample,
} from "./mixture.js";
import type { ConceptClass, ExpertId } from "./mixture.js";
import { better } from "./pick.js";
import type { Concept } from "./prompt.js";

export interface Hypothesis {
  /** What we claim, in one line, for the ledger. */
  claim: string;
  /** Concept class this A/B is about. Weights for this class move on keep. */
  class: ConceptClass;
  control: ExpertId;
  id: string;
  treatment: ExpertId;
}

export interface ExpertSample {
  clean: boolean;
  concept: string;
  cosine: number | null;
  errors: number;
  expert: ExpertId;
  partsFound: number;
  structural: readonly string[];
  unknown: boolean;
}

export interface Trial {
  concept: string;
  control: ExpertSample;
  treatment: ExpertSample;
  winner: ExpertId | "tie";
}

export interface SliceScore {
  controlErrors: number;
  controlWins: number;
  ties: number;
  treatmentErrors: number;
  treatmentWins: number;
}

export type ExperimentStatus = "discard" | "keep" | "screened-out";

export interface ExperimentVerdict {
  decision: SliceScore | null;
  reasons: string[];
  screen: SliceScore;
  spent: number;
  status: ExperimentStatus;
}

export interface ExperimentReport extends ExperimentVerdict {
  hypothesis: Hypothesis;
  selectionTrials: Trial[];
  screenTrials: Trial[];
}

export const winnerOf = (
  control: ExpertSample,
  treatment: ExpertSample
): ExpertId | "tie" => {
  const cmp = better(treatment, control);
  if (cmp < 0) {
    return treatment.expert;
  }
  if (cmp > 0) {
    return control.expert;
  }
  return "tie";
};

export const scoreSlice = (trials: readonly Trial[]): SliceScore => {
  let controlWins = 0;
  let treatmentWins = 0;
  let ties = 0;
  let controlErrors = 0;
  let treatmentErrors = 0;
  for (const trial of trials) {
    controlErrors += trial.control.errors;
    treatmentErrors += trial.treatment.errors;
    if (trial.winner === "tie") {
      ties += 1;
    } else if (trial.winner === trial.treatment.expert) {
      treatmentWins += 1;
    } else {
      controlWins += 1;
    }
  }
  return {
    controlErrors,
    controlWins,
    ties,
    treatmentErrors,
    treatmentWins,
  };
};

/**
 * Screen asks "not worse". Decision asks "better, and no dirtier".
 *
 * A missing decision slice is a discard, not a keep: one icon cannot both
 * propose and decide.
 */
export const decideExperiment = (
  screen: SliceScore,
  decision: SliceScore | null
): ExperimentVerdict => {
  const reasons: string[] = [];
  const notWorse =
    screen.treatmentWins + screen.ties >= screen.controlWins &&
    screen.treatmentErrors <= screen.controlErrors;
  if (!notWorse) {
    reasons.push(
      `screened out: treatment ${screen.treatmentWins}w/${screen.ties}t/` +
        `${screen.controlWins}l, errors ${screen.treatmentErrors} vs ` +
        `${screen.controlErrors}`
    );
    return {
      decision: null,
      reasons,
      screen,
      spent: screen.controlWins + screen.treatmentWins + screen.ties,
      status: "screened-out",
    };
  }
  reasons.push(
    `screen not worse: treatment ${screen.treatmentWins}w/${screen.ties}t/` +
      `${screen.controlWins}l`
  );
  if (decision === null) {
    reasons.push("no selection slice — a screen cannot decide");
    return {
      decision: null,
      reasons,
      screen,
      spent: screen.controlWins + screen.treatmentWins + screen.ties,
      status: "discard",
    };
  }
  const betterOnHoldout = decision.treatmentWins > decision.controlWins;
  const noDirtier = decision.treatmentErrors <= decision.controlErrors;
  if (betterOnHoldout && noDirtier) {
    reasons.push(
      `selection keep: treatment ${decision.treatmentWins}w/` +
        `${decision.ties}t/${decision.controlWins}l, errors ` +
        `${decision.treatmentErrors} vs ${decision.controlErrors}`
    );
    return {
      decision,
      reasons,
      screen,
      spent:
        screen.controlWins +
        screen.treatmentWins +
        screen.ties +
        decision.controlWins +
        decision.treatmentWins +
        decision.ties,
      status: "keep",
    };
  }
  reasons.push(
    `selection discard: treatment ${decision.treatmentWins}w/` +
      `${decision.ties}t/${decision.controlWins}l, errors ` +
      `${decision.treatmentErrors} vs ${decision.controlErrors}`
  );
  return {
    decision,
    reasons,
    screen,
    spent:
      screen.controlWins +
      screen.treatmentWins +
      screen.ties +
      decision.controlWins +
      decision.treatmentWins +
      decision.ties,
    status: "discard",
  };
};

const trialOf = (
  concept: string,
  controlId: ExpertId,
  treatmentId: ExpertId,
  controlResult: GenerateResult,
  treatmentResult: GenerateResult
): Trial => {
  const control = mixtureSample(controlId, concept, controlResult);
  const treatment = mixtureSample(treatmentId, concept, treatmentResult);
  return {
    concept,
    control,
    treatment,
    winner: winnerOf(control, treatment),
  };
};

export interface RunExperimentOptions {
  draw: (expert: ExpertId, concept: Concept) => Promise<GenerateResult>;
  feedback: readonly string[];
  hypothesis: Hypothesis;
  selection: readonly string[];
}

export const runExperiment = async ({
  draw,
  feedback,
  hypothesis,
  selection,
}: RunExperimentOptions): Promise<ExperimentReport> => {
  const screenTrials: Trial[] = [];
  for (const name of feedback) {
    const concept = { name };
    const [controlResult, treatmentResult] = await Promise.all([
      draw(hypothesis.control, concept),
      draw(hypothesis.treatment, concept),
    ]);
    screenTrials.push(
      trialOf(
        name,
        hypothesis.control,
        hypothesis.treatment,
        controlResult,
        treatmentResult
      )
    );
  }
  const screen = scoreSlice(screenTrials);
  const screened = decideExperiment(screen, null);
  if (screened.status === "screened-out" || selection.length === 0) {
    return {
      ...decideExperiment(screen, null),
      hypothesis,
      screenTrials,
      selectionTrials: [],
    };
  }
  const selectionTrials: Trial[] = [];
  for (const name of selection) {
    const concept = { name };
    const [controlResult, treatmentResult] = await Promise.all([
      draw(hypothesis.control, concept),
      draw(hypothesis.treatment, concept),
    ]);
    selectionTrials.push(
      trialOf(
        name,
        hypothesis.control,
        hypothesis.treatment,
        controlResult,
        treatmentResult
      )
    );
  }
  const verdict = decideExperiment(screen, scoreSlice(selectionTrials));
  return {
    ...verdict,
    hypothesis,
    screenTrials,
    selectionTrials,
  };
};

/**
 * On keep, the treatment becomes the first expert for that class. On any
 * other status the table is unchanged. One class, one reorder — a dump of
 * every weight is not a finding.
 */
export const applyVerdict = (
  weights: Readonly<Record<ConceptClass, readonly ExpertId[]>>,
  hypothesis: Hypothesis,
  status: ExperimentStatus
): Record<ConceptClass, ExpertId[]> => {
  const next = Object.fromEntries(
    CONCEPT_CLASSES.map((id) => [id, [...weights[id]]])
  ) as Record<ConceptClass, ExpertId[]>;
  if (status !== "keep") {
    return next;
  }
  const current = next[hypothesis.class];
  next[hypothesis.class] = [
    hypothesis.treatment,
    ...current.filter((id) => id !== hypothesis.treatment),
  ];
  return next;
};

export const parseExpertId = (value: string): ExpertId => {
  if ((EXPERT_IDS as readonly string[]).includes(value)) {
    return value as ExpertId;
  }
  throw new Error(
    `unknown expert "${value}". One of: ${EXPERT_IDS.join(", ")}.`
  );
};

export const parseConceptClass = (value: string): ConceptClass => {
  if ((CONCEPT_CLASSES as readonly string[]).includes(value)) {
    return value as ConceptClass;
  }
  throw new Error(
    `unknown concept class "${value}". One of: ${CONCEPT_CLASSES.join(", ")}.`
  );
};
