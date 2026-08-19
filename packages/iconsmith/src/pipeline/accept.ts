/**
 * The two-stage acceptance gate: which slice a candidate is screened on, and
 * which slice is allowed to accept it.
 *
 * `bench.ts` splits the benchmark three ways; this is the thing that makes the
 * split cost something. A split nobody routes through is decoration, and the
 * failure mode it exists to stop is not exotic: it is the default. karpathy's
 * autoresearch accepts on `val_bpb` from one fixed set, with no holdout, no
 * seed replication and no significance test, across on the order of a hundred
 * accept/reject decisions — which is selection on noise by construction rather
 * than by mistake. DSPy documents the same hazard for GEPA in one line:
 * "Using trainset as valset ... makes GEPA overfit prompts to the provided
 * trainset."
 *
 * So there are two stages, and they are asymmetric on purpose.
 *
 * **Stage 1 — the screen, on `feedback`.** Cheap, lenient, and deliberately
 * *not* evidence. The per-icon traces from this slice are what the proposal was
 * written against, so a candidate's score here is optimistically biased: it was
 * tuned on these icons. That bias is exactly what makes the screen valid as a
 * *necessary* condition. A candidate that cannot beat the incumbent on the very
 * icons it was written to fix is not going to beat it on 130 it has never seen,
 * and there is no reason to pay for those 130 to find out. The screen therefore
 * asks only for "not worse", never for "significant" — a strict screen at n=60
 * would throw away real winners, and a false negative here is a change that is
 * never revisited.
 *
 * **Stage 2 — the decision, on `selection`.** The full rule, on a slice whose
 * per-icon traces were never shown to anything that writes proposals. Only a
 * candidate that survived stage 1 pays for it.
 *
 * The saving is the point: a rejected candidate costs 60 generations instead of
 * 190. The guarantee is also the point, and it is the stronger of the two — the
 * number that decides was computed on icons the proposal could not have been
 * fitted to.
 *
 * `sealed` appears nowhere in this file, and that is deliberate. It is not a
 * stage; it is opened once, by a person, after the campaign is over. Anything
 * that could route to it automatically would spend it.
 */
import type { BenchmarkEntry, Split } from "./bench.js";
import { entriesOf } from "./bench.js";
import type { IconScore } from "./eval.js";

/**
 * The shape of a verdict, restated structurally rather than imported.
 *
 * The acceptance rule itself lives in `scripts/loop.ts`, one layer above this
 * one, so importing it here would invert the import graph that
 * `check-boundaries.ts` exists to keep acyclic. Taking the judge as an argument
 * inverts the dependency instead: this file owns *which slice is judged when*,
 * `judge` owns *what a win is*, and neither has to know the other's file.
 */
export interface Verdictish {
  accepted: boolean;
  medianDelta: number;
  reasons: string[];
}

export type Judge<V extends Verdictish> = (
  champion: readonly IconScore[],
  variant: readonly IconScore[],
  noiseFloor: number
) => V;

/** Outcome of the gate, named so a caller cannot mistake a screen-out for a
 *  measured loss. `screened-out` means the candidate never reached the
 *  selection slice, so nothing was measured about it at all. */
export type Stage = "accepted" | "rejected" | "screened-out";

export interface StagedVerdict<V extends Verdictish> {
  accepted: boolean;
  /** The screen. Present always. **Never evidence of improvement** — the
   *  proposal was written against these icons. Report it as a cost decision,
   *  not as a result. */
  screen: V;
  /** The decision. `null` exactly when the screen rejected, which is the case
   *  where no selection generation was paid for. */
  selection: V | null;
  stage: Stage;
  /** Icons generated per arm, so a report can say what the screen saved. */
  spent: number;
}

/** Scores belonging to one split, matched by icon name against the benchmark. */
export const scoresOf = (
  scores: readonly IconScore[],
  entries: readonly BenchmarkEntry[],
  split: Split
): IconScore[] => {
  const slugs = new Set(entriesOf(entries, split).map((e) => e.slug));
  return scores.filter((s) => slugs.has(s.icon));
};

export interface StageOptions<V extends Verdictish> {
  champion: readonly IconScore[];
  /** The committed benchmark's entries, to know which icon is in which split. */
  entries: readonly BenchmarkEntry[];
  judge: Judge<V>;
  /** The measured resolution of the scorer. The decision stage requires a
   *  median delta at least this large; the screen does not. */
  noiseFloor: number;
  variant: readonly IconScore[];
}

/**
 * Screen on `feedback`, decide on `selection`.
 *
 * Both arms are handed in whole and partitioned here rather than run twice by
 * the caller, so the two stages cannot accidentally be given different arms —
 * and so a caller that only ran the feedback slice gets an empty selection
 * stage and an honest `screened-out`, instead of a verdict computed from
 * nothing.
 */
export const twoStage = <V extends Verdictish>({
  champion,
  entries,
  judge,
  noiseFloor,
  variant,
}: StageOptions<V>): StagedVerdict<V> => {
  // The screen runs the same judge at a floor of zero. Not a different rule
  // with its own thresholds to drift out of sync — the same rule, asked a
  // weaker question: "is this not worse?" rather than "is this better by more
  // than the metric can resolve?". Everything else the judge checks (a crashed
  // arm, a fall in lint-clean rate) still bites, because those are reasons to
  // stop regardless of which slice noticed them.
  const screen = judge(
    scoresOf(champion, entries, "feedback"),
    scoresOf(variant, entries, "feedback"),
    0
  );
  const spent = scoresOf(variant, entries, "feedback").length;
  if (!screen.accepted) {
    return {
      accepted: false,
      screen,
      selection: null,
      spent,
      stage: "screened-out",
    };
  }

  const selection = judge(
    scoresOf(champion, entries, "selection"),
    scoresOf(variant, entries, "selection"),
    noiseFloor
  );
  return {
    accepted: selection.accepted,
    screen,
    selection,
    spent: spent + scoresOf(variant, entries, "selection").length,
    stage: selection.accepted ? "accepted" : "rejected",
  };
};

/**
 * One line a person can read, and the only place the screen is allowed to be
 * mentioned next to a number.
 *
 * It says "screened out" rather than quoting the feedback median as a result,
 * because a reader who sees `-0.021` next to a rejection will remember it as a
 * measurement of the candidate. It is not one; it is a measurement on the
 * icons the candidate was written against.
 */
export const formatStaged = <V extends Verdictish>(
  v: StagedVerdict<V>
): string => {
  if (v.stage === "screened-out") {
    return [
      `screened out on the feedback slice after ${v.spent} generations — the selection slice was not paid for.`,
      ...v.screen.reasons.map((r) => `  ${r}`),
      "  (The feedback slice is what the proposal was written against, so this is a cost decision, not a measurement.)",
    ].join("\n");
  }
  const selection = v.selection as V;
  return [
    `${v.stage} on the selection slice, median delta ${selection.medianDelta.toFixed(4)}, after ${v.spent} generations.`,
    ...selection.reasons.map((r) => `  ${r}`),
  ].join("\n");
};
