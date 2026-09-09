/**
 * Best-of-N selection over complete outlined/filled pairs.
 *
 * A lint-clean drawing is only syntactically valid. It says nothing about
 * whether the object reads or whether the filled twin is competent. This
 * module is the quality gate after every drawing arm: render both paints,
 * review both with the same vision judge and references, reject weak pairs,
 * then select on the weakest paint rather than hiding one bad twin behind a
 * strong average.
 *
 * Candidate generation stays injected. The built-in tool loop, host analog,
 * image-guided arm, and external harness already share `GenerateResult`; a
 * second generation abstraction here would only duplicate them.
 */
import { generateObject } from "ai";
import { z } from "zod";

import { completeProgram, run as runDsl } from "../tools/dsl.js";
import { lint } from "../tools/lint.js";
import { png, sheet } from "../tools/render.js";
import { adaptProgram } from "../tools/twin.js";
import type { Finish, Issue, Part } from "../types.js";
import { audit } from "./audit.js";
import type { AuditAsk, AuditResult } from "./audit.js";
import type { ApiCost } from "./cost.js";
import { EMPTY_USAGE, tokenUsageOf, totalUsd } from "./cost.js";
import { isDeclined } from "./decline.js";
import { gatewayCostTracker, resolveModel } from "./gateway.js";
import type { GenerateResult } from "./generate.js";
import { pairPrograms } from "./pair.js";
import { better } from "./pick.js";
import type { RankedSample } from "./pick.js";
import type { Concept } from "./prompt.js";
import { assertStyle, compileStyle, styleParts } from "./style.js";
import type { StyleSelection } from "./style.js";

/**
 * The acceptance floor for both SC and PQ.
 *
 * **Asserted, not measured, and known to be inert.** Every other constant in
 * this codebase quotes its corpus measurement — `minGap` cites n=1306 median
 * 2.00, `radiusTiers` cites 78.4% of 6,188 corner arcs, `off-axis` cites 480 of
 * 1,640 icons. This one arrived as a bare literal alongside the tournament and
 * has never moved, including when `AUDIT_MODEL` changed underneath it.
 *
 * Measured over the 42 audited paints on disk, the count passing
 * `sc >= m && pq >= m` is 11 at m=6, 11 at m=7, 11 at m=8 and 11 at m=9 — the
 * judge answers 0-1 or 10 and almost nothing between, so **no value in [6, 9]
 * changes a single decision.** Do not tune it: the gate is not what is wrong.
 * Restore the anchored rubric (`eval/judge.ts` carries one with no caller), put
 * `AUDIT_MODEL` through the 90% sanity gate it has never taken, then re-derive
 * this from the measured distribution and write it to `bench/` like the rest.
 */
const TOURNAMENT_MINIMUM = 8;

/**
 * Look at a paint the structural gate has already refused.
 *
 * Off by default: the look cannot change the outcome, so buying it is buying
 * nothing. On, it is the diagnostic that made the provenance veto visible in
 * the first place — a primitive-drawn paint scoring 10/10 and being discarded
 * is the evidence, and without it the next person to hit this has no way to see
 * it. Set `ICONSMITH_AUDIT_VETOED=1` when measuring the gate rather than using
 * it.
 */
const auditVetoed = process.env.ICONSMITH_AUDIT_VETOED === "1";

/**
 * Where a tournament has got to, while it is still running.
 *
 * The whole tournament sits inside one tool call, so a ten-minute run used to
 * emit a handful of coarse events and then nothing: the transcript showed
 * "running the pipeline" and went quiet while up to eight arms drew, painted
 * and were audited. Every fact here was already known at the moment it
 * happened — `runCandidate` has the candidate, the finish, the audit's scores
 * and the pair score — and simply had nowhere to go.
 *
 * `index` and `total` are what let a reader place themselves: "arm 3 of 8" is
 * a position, where a spinner is only a promise that something is happening.
 */
interface TournamentProgress {
  /** Present on `settled`. */
  readonly accepted?: boolean;
  readonly candidateId: string;
  /** Present on `settled` when the arm could not produce a complete pair. */
  readonly failure?: string;
  /** Present on `painted` and `reviewed`. */
  readonly finish?: Finish;
  /** 1-based, among the arms actually started, in start order. */
  readonly index: number;
  readonly label: string;
  readonly phase: "painted" | "reviewed" | "settled" | "started";
  /** Present on `reviewed` — the independent audit's perceptual score. */
  readonly pq?: number;
  /** Present on `reviewed` — the independent audit's semantic score. */
  readonly sc?: number;
  /** Present on `settled` — the pair score, weighted to the weaker paint. */
  readonly score?: number;
  /** How many arms were offered. */
  readonly total: number;
}

type TournamentProgressListener = (event: TournamentProgress) => void;

export interface PairCandidate {
  /** Stable machine id recorded in the Studio transcript. */
  id: string;
  /** Human-readable arm name. */
  label: string;
  generate: (finish: Finish, style?: StyleSelection) => Promise<GenerateResult>;
  /** Conservative paid-call reservation used before an automatic run starts
   * this complete pair. A failed arm does not refund it. */
  reserveCalls?: number;
  /** Conservative USD reservation. Gateway reports exact cost after a call,
   * so automatic runs fail closed when a whole pair does not fit. */
  reserveUsd?: number;
  /** Resource-heavy subprocess arms run after the parallel pool, one paint at
   *  a time. This prevents a local coding harness from competing with a full
   *  image/model fan-out for process handles while preserving its evidence. */
  serial?: boolean;
}

export interface PairCandidateRanking {
  candidates: PairCandidate[];
  cost?: ApiCost;
  order: string[];
  reason: string | null;
}

export type PairRankAsk = (input: {
  abortSignal?: AbortSignal;
  concept: Concept;
  ids: readonly string[];
  preview: Buffer;
}) => Promise<{ cost?: ApiCost; order: number[]; reason: string }>;

const failureMessage = (error: unknown): string =>
  error instanceof Error
    ? error.message
    : "candidate failed without an error message";

const rankSchema = z.object({
  order: z
    .array(z.number().int())
    .describe("Best-to-worst 1-based row numbers, with every row once"),
  reason: z.string().describe("One sentence explaining the first choice"),
});

/** Ranking ten already-rendered rows is a coarse selection task. The stronger
 * audit model still independently accepts or rejects both winner paints. */
const PAIR_RANK_MODEL = "google/gemini-3.1-flash-lite";

const gatewayPairRankAsk: PairRankAsk = async ({
  abortSignal,
  concept,
  ids,
  preview,
}) => {
  const costTracker = gatewayCostTracker();
  const result = await generateObject({
    abortSignal,
    messages: [
      {
        content: [
          {
            text:
              `Rank these candidate pairs for the ordinary reading of the icon ` +
              `concept "${concept.name}". Each row is one candidate: outlined ` +
              `on the left, filled on the right. Rows in order: ${ids
                .map((id, index) => `${index + 1}=${id}`)
                .join(
                  ", "
                )}. Prefer immediate object recognition, a canonical ` +
              `silhouette, competent small-icon construction, and a filled twin ` +
              `that still reads. Reject badges, modifiers, and special variants ` +
              `that change the ordinary meaning. Return every row once, best first.`,
            type: "text",
          },
          { data: preview, mediaType: "image/png", type: "file" },
        ],
        role: "user",
      },
    ],
    model: resolveModel(PAIR_RANK_MODEL),
    schema: rankSchema,
  });
  costTracker.record(result.providerMetadata);
  return {
    cost: await costTracker.measure({
      model: PAIR_RANK_MODEL,
      operation: "candidate-ranking",
      usage: tokenUsageOf(result.usage),
    }),
    order: result.object.order,
    reason: result.object.reason,
  };
};

/** Rank deterministic candidate pairs with one contact-sheet judgement. This
 * is selection, not acceptance: the winner still goes through both independent
 * per-paint audits in `runPairTournament`. */
export const rankPairCandidates = async ({
  abortSignal,
  ask = gatewayPairRankAsk,
  candidates,
  concept,
}: {
  abortSignal?: AbortSignal;
  ask?: PairRankAsk;
  candidates: readonly PairCandidate[];
  concept: Concept;
}): Promise<PairCandidateRanking> => {
  abortSignal?.throwIfAborted();
  if (candidates.length === 0) {
    return { candidates: [], order: [], reason: null };
  }
  /**
   * One candidate is still asked about, and this used to short-circuit here.
   *
   * The prompt does two jobs. Ordering needs at least two candidates and is a
   * pure cost optimisation. The other job is a semantic filter — "Reject
   * badges, modifiers, and special variants that change the ordinary meaning"
   * — and it is needed MOST when there is a single candidate, because a lone
   * near-name match is exactly the case where the tournament will accept it and
   * stop. Skipping the call to save ordering also silently switched the filter
   * off, and the ranker call is the cheapest in the run.
   */
  try {
    const pairs = await Promise.all(
      candidates.map((candidate) =>
        Promise.all([
          candidate.generate("outlined"),
          candidate.generate("filled"),
        ])
      )
    );
    const preview = await sheet(
      pairs.flatMap((pair) => pair.map((result) => result.svg)),
      { cols: 2, size: 96 }
    );
    const ranked = await ask({
      abortSignal,
      concept,
      ids: candidates.map((candidate) => candidate.id),
      preview,
    });
    const requested = ranked.order
      .map((index) => index - 1)
      .filter(
        (index, position, all) =>
          index >= 0 &&
          index < candidates.length &&
          all.indexOf(index) === position
      );
    const missing = candidates
      .map((_, index) => index)
      .filter((index) => !requested.includes(index));
    const order = [...requested, ...missing];
    const sorted = order.map((index) => candidates[index]);
    return {
      candidates: sorted,
      cost: ranked.cost,
      order: sorted.map((candidate) => candidate.id),
      reason: ranked.reason,
    };
  } catch (error) {
    // A failed ranker falls back to library order. A cancelled turn must not:
    // it is a request to stop all later paid work.
    abortSignal?.throwIfAborted();
    return {
      candidates: [...candidates],
      cost: {
        calls: 1,
        generationIds: [],
        model: PAIR_RANK_MODEL,
        operation: "candidate-ranking",
        source: "unpriced",
        usage: { ...EMPTY_USAGE },
        usd: null,
      },
      order: candidates.map((candidate) => candidate.id),
      reason: `candidate ranking failed (${failureMessage(error)}); kept library order`,
    };
  }
};

interface TournamentPaint {
  /** Explicit revision acceptance does not use part count as provenance. */
  styleEligible?: boolean;
  accepted: boolean;
  /** The acceptance review. Always a fresh look, never the arm's own. */
  audit: AuditResult;
  finish: Finish;
  /** The drawing came from the house — a `part` op, or an adopted analog —
   *  rather than from geometry the model invented. `AGENTS.md` makes this half
   *  of arrival, and the campaign's ledger agrees: every pair that scored 10/10
   *  composed, and every pair drawn from raw primitives scored 7 or less. */
  houseDerived: boolean;
  /** `part` ops in the delivered document. Ranks a pair once it is accepted. */
  partOps: number;
  /** The program replays to exactly this document, so the `.icon` source is
   *  the drawing rather than a lossy record of it. */
  programComplete: boolean;
  result: GenerateResult;
  /** The arm's own review, when it supplied one. Kept as evidence — an arm
   *  that grades itself is a witness, not a judge. */
  selfReview: AuditResult | null;
}

interface TournamentRun {
  /** Checks on the two delivered paints together, under the selected spec. */
  pairIssues?: Issue[];
  /** All original generation and review bills, including replaced twins. */
  costs?: ApiCost[];
  accepted: boolean;
  /** A failed arm is evidence, not a reason to discard every other arm. */
  /** The arm had no answer for this concept, rather than breaking. It is still
   *  a failed arm with a reason; it just does not stop the ones behind it. */
  declined?: boolean;
  failure: string | null;
  /** What a failed pair had already been billed for before it threw. Kept so
   *  one arm's collapse does not make the whole tournament's ledger unknown. */
  partialCosts?: ApiCost[];
  id: string;
  label: string;
  paints: TournamentPaint[];
  /** 0–10, weighted toward the weaker of the two paints. */
  score: number;
}

export interface PairTournamentResult {
  /** Best generated pair even when it missed the acceptance gate. */
  best: TournamentRun | null;
  budget: {
    actualCalls: number;
    actualUsd: number | null;
    exhausted: boolean;
    maxCalls: number;
    maxUsd: number;
    overrun: boolean;
    /** Everything the run set aside, arm by arm, as it started them. A record
     *  of the estimates and not a live balance: each arm's share is released
     *  against its real bill the moment that bill arrives, which is what the
     *  next arm is admitted against. Read beside `actualUsd` to see how
     *  conservative the reservations were. */
    reservedCalls: number;
    reservedUsd: number;
  } | null;
  candidates: TournamentRun[];
  /** Candidates available before an accuracy gate stopped escalation. */
  eligible: number;
  /**
   * An arm threw, which stopped the escalation.
   *
   * Read beside `unaffordable` and `budget.exhausted`, these three now say
   * which kind of short a short tournament was: an arm broke, the budget could
   * not seat the next arm, or the measured ledger went over. They used to be
   * one flag, so a crash was reported to the user as an exhausted budget.
   */
  haltedByFailure: boolean;
  minimum: { pq: number; sc: number };
  /** True when fewer arms ran than were offered — for either reason. Read it
   *  beside `unaffordable`: a tournament that stopped because it won and one
   *  that stopped because it ran out of money look identical here, and the
   *  campaign recorded three runs as `stoppedEarly` that had simply been
   *  refused their two strongest arms. */
  stoppedEarly: boolean;
  /** Arms the budget refused before they drew anything. Empty when every
   *  offered arm was affordable, so a short tournament always says which
   *  kind of short it was. */
  unaffordable: string[];
  /** Null means no pair earned delivery. Callers must not silently use best. */
  winner: TournamentRun | null;
}

export interface PairTournamentOptions {
  style?: StyleSelection;
  /** Cancels generation and independent audits for the owning turn. */
  abortSignal?: AbortSignal;
  ask?: AuditAsk;
  budget?: { maxCalls: number; maxUsd: number };
  candidates: readonly PairCandidate[];
  concept: Concept;
  minimumPq?: number;
  minimumSc?: number;
  /**
   * Told where the tournament has got to, as it gets there.
   *
   * Telemetry, so a throwing listener is swallowed rather than allowed to fail
   * a paid tournament: a run that has already spent real money must not be
   * lost because something downstream wanted to render a row.
   */
  onProgress?: TournamentProgressListener;
  /** The vocabulary a delivered program is replayed against when checking
   *  that it reproduces its own document. A program naming a part this list
   *  does not hold cannot round-trip, so an incomplete list reads as lossy. */
  parts?: readonly Part[];
  references?: readonly Buffer[];
  /** Evaluate in declaration order and stop after an accepted pair reaches
   * this score. Null preserves exhaustive parallel evaluation. */
  stopScore?: number | null;
}

/** `part` ops in the delivered document. */
const partOpsOf = (result: GenerateResult): number =>
  result.doc.draw.filter((op) => op.op === "part").length;

/**
 * Did the house draw this, or did the model?
 *
 * A `part` op places an extracted shape. `construct` adopts a whole host
 * analog, whose coordinates came from the same place — so it counts, and
 * checking only for `part` ops would reject the arm that produced the
 * campaign's one clean pair.
 */
const houseDerivedBy = (result: GenerateResult): boolean =>
  partOpsOf(result) > 0 || result.trace.includes("construct");

/**
 * The structural half of acceptance: everything decidable from the drawing
 * itself, with no model call.
 *
 * `paintAccepted` ANDs these three ahead of every audit term, and JavaScript's
 * `&&` short-circuits, so when one of them is false the audit's scores are read
 * by nothing. Computing them first is what lets the caller skip a paid look
 * that cannot change the outcome — and, more importantly, lets the refusal say
 * *provenance* rather than *quality*, which is what a user was previously told.
 */
const structurallyEligible = (
  result: GenerateResult,
  programComplete: boolean,
  styleEligible?: boolean
): boolean =>
  result.clean && programComplete && (styleEligible ?? houseDerivedBy(result));

const belongsToStyle = (
  result: GenerateResult,
  style: StyleSelection,
  finish: Finish
): boolean => {
  try {
    styleParts(style, result.extras);
    if (result.styleKey !== style.key || !result.program) {
      return false;
    }
    const compiled = compileStyle(style, result.program);
    const replay = runDsl(result.program, [...style.parts], {
      spec: style.spec,
    });
    return (
      compiled.svg === result.svg &&
      compiled.finish === finish &&
      !lint(replay.canvas, { keyline: replay.keyline }).some(
        (issue) => issue.severity === "error"
      )
    );
  } catch {
    return false;
  }
};

/**
 * Why a paint was refused before anyone looked at it.
 *
 * Recorded as an unscorable audit rather than a zero, because a zero is a
 * judgement and this is the absence of one. `scorable: false` is already the
 * shape the rest of the pipeline reads for "no opinion available", and
 * `eval/panel.ts` makes the same distinction one level up: null is not 0.
 */
const vetoedAudit = (
  result: GenerateResult,
  programComplete: boolean,
  styleEligible?: boolean
): AuditResult => {
  const reasons: string[] = [];
  if (!result.clean) {
    reasons.push("the drawing has a lint error");
  }
  if (!programComplete) {
    reasons.push("its program does not replay to the delivered document");
  }
  if (styleEligible === false) {
    reasons.push(
      "its style identity, dependencies, compiled SVG or structural review did not match the pinned revision"
    );
  } else if (styleEligible === undefined && !houseDerivedBy(result)) {
    reasons.push(
      "it places no part and adopts no analog, so the house did not draw it"
    );
  }
  return {
    findings: [],
    ok: false,
    pq: 0,
    reason: `Not looked at: ${reasons.join("; ")}. This is a provenance refusal, not a quality one.`,
    sc: 0,
    scorable: false,
    stage: "screen",
  };
};

const paintAccepted = (
  paint: Omit<TournamentPaint, "accepted">,
  minimumSc: number,
  minimumPq: number
): boolean =>
  paint.result.clean &&
  paint.programComplete &&
  (paint.styleEligible ?? paint.houseDerived) &&
  paint.audit.scorable &&
  paint.audit.findings.length === 0 &&
  paint.audit.sc >= minimumSc &&
  paint.audit.pq >= minimumPq;

/**
 * Derive the other paint from the one that worked, rather than discard both.
 *
 * The tournament asks each arm for two INDEPENDENT drawings and then requires
 * them to be a coherent pair. `tools/twin.ts` exists because that is not how a
 * pair is meant to be made — "one skeleton, two paints" — and the measured cost
 * of the independent version is large. On concept `write-2`, four arms produced
 * an outlined pencil at SC 10 / PQ 10, another outlined pencil at 10 / 9.5, and
 * a filled pen at 10 / 9; every one of them sat in a candidate whose OTHER
 * paint scored 5 or 6, so the run delivered nothing and told the user to try a
 * more specific noun.
 *
 * `adaptProgram` re-derives the counterpart from the accepted paint's own
 * program, so the rescued twin shares the skeleton by construction — which is
 * both the house rule and the reason the two occupy one visual extent in 94% of
 * the set's pairs. That is a stronger guarantee than the arm's second attempt
 * ever had.
 *
 * Deliberately narrow. It only runs when exactly one paint of a pair was
 * accepted, it never replaces an accepted paint, and the derived twin faces the
 * identical gate — structural terms first, then the same judge. A pair that
 * still fails is still refused; nothing here lowers the bar.
 */
const rescueTwin = async ({
  abortSignal,
  ask,
  concept,
  minimumPq,
  minimumSc,
  onAudit,
  parts,
  references,
  style,
  strong,
  weak,
}: {
  abortSignal?: AbortSignal;
  ask?: AuditAsk;
  concept: Concept;
  minimumPq: number;
  minimumSc: number;
  onAudit: (result: AuditResult) => void;
  parts: readonly Part[];
  references: readonly Buffer[];
  style?: StyleSelection;
  strong: TournamentPaint;
  weak: TournamentPaint;
}): Promise<TournamentPaint | null> => {
  const source = strong.result.program;
  if (!source) {
    return null;
  }
  let derived: ReturnType<typeof runDsl>;
  let program: string;
  try {
    program = adaptProgram(source, weak.finish, style?.spec);
    derived = runDsl(program, [...parts], { spec: style?.spec });
  } catch {
    // A skeleton that will not re-derive is not a failure worth reporting: the
    // pair is refused either way, and the arm's own paint is already recorded.
    return null;
  }
  if (derived.errors.length > 0) {
    return null;
  }
  const issues = lint(derived.canvas, { keyline: derived.keyline });
  if (issues.some((issue) => issue.severity === "error")) {
    return null;
  }
  const doc = derived.canvas.toJSON({
    icon: derived.icon ?? concept.name,
    keyline: derived.keyline,
  });
  const result: GenerateResult = {
    ...strong.result,
    clean: true,
    doc,
    issues,
    program,
    svg: derived.canvas.toSVG(),
    trace: [...strong.result.trace, "twin"],
  };
  const programComplete = completeProgram(
    doc,
    program,
    [...parts, ...(result.extras ?? [])],
    { spec: style?.spec }
  );
  const styleEligible = style
    ? belongsToStyle(result, style, weak.finish)
    : undefined;
  if (!structurallyEligible(result, programComplete, styleEligible)) {
    return null;
  }
  const reviewed = await audit({
    abortSignal,
    ask,
    concept,
    context: style
      ? {
          nativeSize: style.spec.size,
          rubric: style.revision.definition.rubric,
        }
      : undefined,
    finish: weak.finish,
    kind: "analog",
    references,
    svg: result.svg,
  });
  onAudit(reviewed);
  const judged = {
    audit: reviewed,
    finish: weak.finish,
    houseDerived: houseDerivedBy(result),
    partOps: partOpsOf(result),
    programComplete,
    result,
    selfReview: null,
    styleEligible,
  };
  return { ...judged, accepted: paintAccepted(judged, minimumSc, minimumPq) };
};

const pairScore = (paints: readonly TournamentPaint[]): number => {
  if (paints.length === 0) {
    return 0;
  }
  const qualities = paints.flatMap((paint) => [paint.audit.sc, paint.audit.pq]);
  const floor = Math.min(...qualities);
  const mean =
    qualities.reduce((sum, value) => sum + value, 0) / qualities.length;
  // `declared` is excluded, and the exclusion is the whole point. `types.ts`
  // defines the field as the difference between "an undeclared finding asks for
  // a fix" and "a declared one asks a reviewer to agree", and `lint.ts` emits a
  // declared off-axis warn whose own message reads "Nothing to fix". Charging
  // both the same price taxes the house's own habit: off-axis edges are 29.3%
  // of the set's stroked icons, the rule is calibrated to fire at that rate on
  // purpose, and it fires per edge — so a faithful diagonal drawing loses to an
  // axis-only one on a penalty neither of them can answer.
  const warnings = paints.reduce(
    (sum, paint) =>
      sum +
      paint.result.issues.filter(
        (issue) => issue.severity === "warn" && !issue.declared
      ).length,
    0
  );
  return Math.max(
    0,
    Number((floor * 0.7 + mean * 0.3 - Math.min(1, warnings * 0.05)).toFixed(2))
  );
};

/**
 * Accepted first, then the pair score, then the house's own ranking.
 *
 * `pick.ts` is the one place that ranking lives, and it exists because cosine
 * alone once selected a pull-request that was the house graph minus its
 * incoming chevron. It orders structural failures, then errors, then part
 * count, then cosine — and cosine sits last there because on its own it was
 * the misleading signal.
 *
 * `score` is not cosine. It is the weakest of the four SC/PQ numbers two
 * independent audits gave the pair, so it is the quality judgement the whole
 * tournament exists to make, and nothing may outrank it. Ranking part count
 * above it put a `wifi` run's best pair at 0.4/10 — a library compile with
 * plenty of `part` ops and nothing recognisable — ahead of a harness pair at
 * 5.5. Composition breaks ties between pairs judged equally good; it does not
 * decide which pair is good.
 */
const rankedOf = (run: TournamentRun): RankedSample => ({
  cosine: null,
  errors: run.paints.reduce(
    (sum, paint) =>
      sum +
      paint.result.issues.filter((issue) => issue.severity === "error").length,
    0
  ),
  partsFound: run.paints.reduce((sum, paint) => sum + paint.partOps, 0),
  structural: run.paints.flatMap((paint) =>
    paint.programComplete ? [] : [`${paint.finish} program is lossy`]
  ),
});

const compareRuns = (a: TournamentRun, b: TournamentRun): number =>
  Number(b.accepted) - Number(a.accepted) ||
  b.score - a.score ||
  better(rankedOf(a), rankedOf(b)) ||
  a.id.localeCompare(b.id);

/**
 * Generate and judge every pair. Candidate arms run independently so a local
 * CLI failure, provider outage, or malformed program cannot erase good work
 * from another arm.
 */
// oxlint-disable-next-line eslint/complexity -- one state machine owns pair generation, quality gates, and pre/post-call budget accounting
export const runPairTournament = async ({
  abortSignal,
  ask,
  budget,
  candidates,
  concept,
  minimumPq = TOURNAMENT_MINIMUM,
  minimumSc = TOURNAMENT_MINIMUM,
  onProgress,
  parts: legacyParts = [],
  references: legacyReferences = [],
  style,
  stopScore = null,
}: PairTournamentOptions): Promise<PairTournamentResult> => {
  abortSignal?.throwIfAborted();
  if (style) {
    assertStyle(style);
    if (legacyParts.length || legacyReferences.length) {
      throw new Error("A pinned style owns tournament parts and references");
    }
  }
  const parts = style?.parts ?? legacyParts;
  const references = style
    ? await Promise.all(
        style.references.map((ref) => png(ref.svg, style.spec.size))
      )
    : legacyReferences;
  // Arms are numbered in the order they actually start. The exhaustive branch
  // runs the non-serial pool concurrently, so "start order" there is the order
  // they were handed out, not a claim about who finishes first — which is the
  // honest reading, and the only one available without serialising work that is
  // deliberately parallel.
  let armsStarted = 0;
  const total = candidates.length;
  const report = (event: TournamentProgress): void => {
    if (!onProgress) {
      return;
    }
    try {
      onProgress(event);
    } catch {
      // A listener is telemetry. A tournament that has already spent money must
      // not be lost because a renderer threw.
    }
  };

  const runCandidate = async (
    candidate: PairCandidate
  ): Promise<TournamentRun> => {
    abortSignal?.throwIfAborted();
    armsStarted += 1;
    const index = armsStarted;
    const seat = {
      candidateId: candidate.id,
      index,
      label: candidate.label,
      total,
    };
    report({ ...seat, phase: "started" });
    const results: { finish: Finish; result: GenerateResult }[] = [];
    const reviewCosts: ApiCost[] = [];
    const onAudit = (reviewed: AuditResult): void => {
      if (reviewed.cost) {
        reviewCosts.push(reviewed.cost);
      }
    };
    try {
      const finishes = ["outlined", "filled"] as const;
      if (candidate.serial) {
        for (const finish of finishes) {
          results.push({
            finish,
            // oxlint-disable-next-line eslint/no-await-in-loop -- `serial` explicitly opts this subprocess out of paint fan-out.
            result: await candidate.generate(finish, style),
          });
          abortSignal?.throwIfAborted();
          report({ ...seat, finish, phase: "painted" });
        }
      } else {
        results.push(
          ...(await Promise.all(
            finishes.map(async (finish) => {
              abortSignal?.throwIfAborted();
              const result = await candidate.generate(finish, style);
              abortSignal?.throwIfAborted();
              report({ ...seat, finish, phase: "painted" });
              return { finish, result };
            })
          ))
        );
      }
      const paints = await Promise.all(
        results.map(async ({ finish, result }): Promise<TournamentPaint> => {
          const styleEligible = style
            ? belongsToStyle(result, style, finish)
            : undefined;
          const programComplete = completeProgram(
            result.doc,
            result.program,
            [...parts, ...(result.extras ?? [])],
            { spec: style?.spec }
          );
          /**
           * Decide the structural half first, and do not buy a look the gate
           * will discard.
           *
           * Measured before this branch existed: a concept whose references
           * yield no usable part left every generative paint at zero `part`
           * ops, so `houseDerived` was false and `paintAccepted` returned false
           * at its third term — after two `visual-audit` calls per pair had
           * already been billed, and after scores of 10/10 had been recorded
           * that nothing would read.
           *
           * `auditVetoed` keeps the look for telemetry, because that discarded
           * 10/10 is the only reason the veto was ever visible.
           */
          if (
            !(
              auditVetoed ||
              structurallyEligible(result, programComplete, styleEligible)
            )
          ) {
            const refused = vetoedAudit(result, programComplete, styleEligible);
            report({
              ...seat,
              finish,
              phase: "reviewed",
              pq: refused.pq,
              sc: refused.sc,
            });
            const judged = {
              audit: refused,
              finish,
              houseDerived: houseDerivedBy(result),
              partOps: partOpsOf(result),
              programComplete,
              result,
              selfReview: result.audit ?? null,
              styleEligible,
            };
            return { ...judged, accepted: false };
          }
          // Always a fresh look. An arm that reviews its own drawing is a
          // witness, not a judge: the campaign's one accepted pair carried
          // `mode: "draw-and-review"` at 10/10 on both paints, and the first
          // independent reviewer scored the same pair 9/8 and 9/6 — below the
          // floor it had already cleared. The arm's own audit is kept beside
          // this one as evidence, and still drives that arm's repair loop.
          const reviewed = await audit({
            abortSignal,
            ask,
            concept,
            context: style
              ? {
                  nativeSize: style.spec.size,
                  rubric: style.revision.definition.rubric,
                }
              : undefined,
            finish,
            kind: "analog",
            references,
            svg: result.svg,
          });
          onAudit(reviewed);
          report({
            ...seat,
            finish,
            phase: "reviewed",
            pq: reviewed.pq,
            sc: reviewed.sc,
          });
          const judged = {
            audit: reviewed,
            finish,
            houseDerived: houseDerivedBy(result),
            partOps: partOpsOf(result),
            programComplete,
            result,
            selfReview: result.audit ?? null,
            styleEligible,
          };
          return {
            ...judged,
            accepted: paintAccepted(judged, minimumSc, minimumPq),
          };
        })
      );
      /**
       * One paint short is the common way a pair fails, and throwing the good
       * one away with it is what produced "I rejected every candidate" on runs
       * that had just drawn a house-quality icon. Derive the twin from the
       * skeleton that worked and give it the same gate.
       */
      const rescued = await (async (): Promise<TournamentPaint[]> => {
        const strong = paints.filter((paint) => paint.accepted);
        const weak = paints.filter((paint) => !paint.accepted);
        if (strong.length !== 1 || weak.length !== 1) {
          return paints;
        }
        const [strongPaint] = strong;
        const [weakPaint] = weak;
        if (!(strongPaint && weakPaint)) {
          return paints;
        }
        const twin = await rescueTwin({
          abortSignal,
          ask,
          concept,
          minimumPq,
          minimumSc,
          onAudit,
          parts,
          references,
          strong: strongPaint,
          style,
          weak: weakPaint,
        });
        if (!twin?.accepted) {
          return paints;
        }
        report({
          ...seat,
          finish: twin.finish,
          phase: "reviewed",
          pq: twin.audit.pq,
          sc: twin.audit.sc,
        });
        // Order is the caller's contract elsewhere, so the rescued paint takes
        // the failed one's place rather than being appended.
        return paints.map((paint) => (paint === weakPaint ? twin : paint));
      })();
      const outline = rescued.find((paint) => paint.finish === "outlined");
      const fill = rescued.find((paint) => paint.finish === "filled");
      const pairIssues =
        style && outline?.styleEligible && fill?.styleEligible
          ? pairPrograms(
              [],
              "outlined",
              outline.result.program ?? "",
              fill.result.program ?? "",
              style.parts,
              style.spec
            )
          : [];
      const accepted =
        rescued.every((paint) => paint.accepted) &&
        !pairIssues.some((issue) => issue.severity === "error");
      const score = pairScore(rescued);
      report({ ...seat, accepted, phase: "settled", score });
      return {
        accepted,
        costs: [
          ...results.flatMap(({ result }) => result.apiCosts ?? []),
          ...reviewCosts,
        ],
        declined: false,
        failure: null,
        id: candidate.id,
        label: candidate.label,
        paints: rescued,
        ...(style ? { pairIssues } : {}),
        score,
      };
    } catch (error) {
      // Candidate failures are isolated; cancellation is not a candidate
      // failure and must stop the tournament before another arm is started.
      abortSignal?.throwIfAborted();
      const failure = failureMessage(error);
      const declined = isDeclined(error);
      if (style && !declined && results.length < 2) {
        // A failed provider call may have been billed before it produced a
        // GenerateResult. Unknown spend must not look like a free attempt.
        reviewCosts.push({
          calls: 1,
          generationIds: [],
          model: "unknown",
          operation: "failed-style-attempt",
          source: "unpriced",
          usage: { ...EMPTY_USAGE },
          usd: null,
        });
      }
      report({
        ...seat,
        accepted: false,
        failure,
        phase: "settled",
        score: 0,
      });
      // Whatever this pair had already been billed for, before it threw. A
      // `claude-harness` client-side timeout that drew nothing and cost
      // nothing used to mark the entire tournament's ledger unknown, which
      // voided a fully priced $0.43 run and threw away another arm's 10/9
      // outlined paint. Escalation still stops — the pair is incomplete — but
      // an unfinished arm no longer makes the finished ones unpayable.
      return {
        accepted: false,
        declined,
        failure,
        id: candidate.id,
        label: candidate.label,
        paints: [],
        partialCosts: [
          ...results.flatMap(({ result }) => result.apiCosts ?? []),
          ...reviewCosts,
        ],
        score: 0,
      };
    }
  };
  const runs: TournamentRun[] = [];
  let reservedCalls = 0;
  let reservedUsd = 0;
  let actualCalls = 0;
  let actualUsd = 0;
  /**
   * What the arm in flight has reserved and not yet been billed for.
   *
   * The reserve check used to add every arm's estimate to a running total that
   * nothing ever subtracted, so the prefix was monotone in ESTIMATES and later
   * arms were refused against money nobody spent.
   *
   * Measured on the Studio field: a `library-*` arm is `compileArm()` —
   * deterministic, zero model calls — plus its two acceptance audits, so it
   * bills $0.0144 against the $0.055 it reserves. That is a 3.8x over-reserve,
   * $0.041 of ghost per arm, and it is worst on the arms that cost least
   * because they draw from the set rather than from a model. In CALLS the same
   * arm is honest — it reserves 2 and makes 2 — so the phantom there is the
   * generative arms' unspent steps, which reserve for `maxSteps` and stop on
   * `drawnAndClean` well before it.
   *
   * What motivated the change: with the memoised image proposal reserved by
   * BOTH arms that can trigger it, the four fixed arms held $1.60 of the $2
   * ceiling, and a monotone prefix refused `claude-harness` as soon as
   * 0.055L + 1.60 > 2 — from the eighth library arm. L >= 8 is reached by 42
   * concept names, and they are the most ordinary in the set: folder(18)
   * layout(18) people(17) calendar(16) circle(16) cloud(16) file(15) page(15)
   * car(14) text(14) user(12) home(10) settings(10) code(8) video(8) and 27
   * more. At L=18 those arms reserve $0.99 to spend $0.26: $0.73 of ghost, 36%
   * of the ceiling, more than the $0.70 that refused arm needed.
   *
   * The cutoff has since moved and the fault has not. Charging the proposal
   * once, to `image-agent`, took the fixed arms to $1.30 and 67 calls, so the
   * dollars now seat twelve library arms and the CALL ceiling binds first:
   * 2L + 59 calls stand reserved before the harness against a ceiling of 89
   * (the 90-call default less the ranker's one call), which refuses it from
   * L = 12. Eleven of those 42 names still reach that — folder, layout,
   * people, calendar, circle, cloud, file, page, car, text, user. Released
   * against the real bill the pre-harness prefix is about 65 calls and $0.65,
   * and the arm is admitted; it is refused only when the arms ahead of it
   * genuinely spent what they held.
   *
   * Both budgeted loops are strictly sequential — reserve, await the pair,
   * record — so at most one reserve is ever outstanding, and this is it.
   */
  let pendingCalls = 0;
  let pendingUsd = 0;
  let hasUnpricedCalls = false;
  let budgetExhausted = false;
  /**
   * An arm threw. Distinct from `budgetExhausted`, and it used to be the same
   * flag.
   *
   * A crash stops further escalation, because spending more after something
   * broke is rarely what the caller wants. It is NOT a budget condition, and
   * conflating the two told a user "The automatic cost budget was exhausted...
   * rerun it with an explicit larger per-icon budget" after a run had spent 22%
   * of its budget — advice that cannot work, because a bigger budget does not
   * fix an arm that threw, and rerunning reproduces the crash at double the
   * cost. Worse, the shared flag also nulled the winner, so a pair that had
   * ALREADY been accepted was discarded because a later arm fell over.
   */
  let haltedByFailure = false;
  const reserve = (candidate: PairCandidate): boolean => {
    if (!budget) {
      return true;
    }
    const calls = candidate.reserveCalls ?? 0;
    const usd = candidate.reserveUsd;
    // Spent plus outstanding, not every estimate ever made. `reservedCalls` /
    // `reservedUsd` stay cumulative because they are the run's record of what
    // it set aside; what an arm is admitted against is the money that is
    // actually gone or actually committed.
    if (
      usd === undefined ||
      actualCalls + pendingCalls + calls > budget.maxCalls ||
      actualUsd + pendingUsd + usd > budget.maxUsd
    ) {
      budgetExhausted = true;
      return false;
    }
    reservedCalls += calls;
    reservedUsd += usd;
    pendingCalls = calls;
    pendingUsd = usd;
    return true;
  };
  const recordActual = (run: TournamentRun): void => {
    const costs = run.costs ?? [
      ...run.paints.flatMap((paint) => [
        ...(paint.result.apiCosts ?? []),
        ...(paint.audit.cost ? [paint.audit.cost] : []),
      ]),
      ...(run.partialCosts ?? []),
    ];
    actualCalls += costs.reduce((sum, cost) => sum + cost.calls, 0);
    const measured = totalUsd(costs);
    if (measured === null) {
      hasUnpricedCalls = true;
    } else {
      actualUsd += measured;
    }
    /**
     * Release what this arm reserved, now that what it really cost is in.
     *
     * A FAILED arm is released too, and deliberately. Its `partialCosts` are
     * in `costs` above, so whatever it was billed for before it threw is
     * already on the ledger and the estimate has nothing left to stand for. A
     * crash halts the escalation anyway, but a DECLINE does not — an arm with
     * no answer for this concept draws nothing, is billed nothing and lets the
     * arms behind it run, so holding its reserve would charge them for work
     * that never happened.
     *
     * An UNKNOWN actual is the one case that keeps its dollars reserved.
     * `totalUsd` returns null when any record is unpriced, and releasing a
     * reserve against an unknown bill is the only move here that could make
     * the budget look FREER than it is — the estimate is then the best figure
     * available for money that was certainly spent. In practice the loop stops
     * on the same tick, because `hasUnpricedCalls` exhausts the budget at the
     * end of this same call; the reserve is held anyway so this rule does not
     * depend on that one staying true. Calls are released either way: every record
     * carries its own `calls`, so the count is never the unknown.
     */
    pendingCalls = 0;
    if (measured !== null) {
      pendingUsd = 0;
    }
    // A pair-level failure can happen after one paint has already completed
    // and been billed, so escalation stops: the pair is incomplete and the
    // next candidate must not start on the assumption that it was free.
    //
    // What it must not do is mark the ledger unknown. `runCandidate` now hands
    // back what the failed pair had already been billed for, so the total is
    // still the total. Treating a failure as unpriced meant one arm's
    // client-side timeout — no paints drawn, nothing billed — set
    // `totalUsd: null`, and `exceedsCostBudget` fails closed on an unknown
    // cost, so a fully priced run was refused and another arm's accepted-grade
    // outlined paint went in the bin with it.
    // A decline is not a crash. `run.declined` is set by an arm that had no
    // answer for this concept, which says nothing about whether the next arm
    // does — halting on it stopped `webhooks` at arm 1 of 4 and skipped the
    // three arms that could have drawn it.
    if (budget && run.failure !== null && !run.declined) {
      haltedByFailure = true;
    }
    if (
      budget &&
      (actualCalls > budget.maxCalls ||
        hasUnpricedCalls ||
        actualUsd > budget.maxUsd)
    ) {
      budgetExhausted = true;
    }
  };
  if (stopScore === null) {
    if (budget) {
      for (const candidate of candidates) {
        abortSignal?.throwIfAborted();
        if (!reserve(candidate)) {
          break;
        }
        // oxlint-disable-next-line eslint/no-await-in-loop -- a budget is reserved pair by pair before paid work starts.
        const run = await runCandidate(candidate);
        runs.push(run);
        recordActual(run);
        if (budgetExhausted || haltedByFailure) {
          break;
        }
      }
    } else {
      const parallel = candidates.filter((candidate) => !candidate.serial);
      const serial = candidates.filter((candidate) => candidate.serial);
      runs.push(...(await Promise.all(parallel.map(runCandidate))));
      for (const candidate of serial) {
        abortSignal?.throwIfAborted();
        // oxlint-disable-next-line eslint/no-await-in-loop -- serial candidates must not overlap the parallel pool or one another.
        runs.push(await runCandidate(candidate));
      }
    }
  } else {
    for (const candidate of candidates) {
      abortSignal?.throwIfAborted();
      if (!reserve(candidate)) {
        break;
      }
      // oxlint-disable-next-line eslint/no-await-in-loop -- accuracy-gated escalation is intentionally sequential so later paid arms remain uncalled.
      const run = await runCandidate(candidate);
      runs.push(run);
      recordActual(run);
      if (budgetExhausted || haltedByFailure) {
        break;
      }
      if (run.accepted && run.score >= stopScore) {
        break;
      }
    }
  }
  // Everything still unrun once the budget has failed closed. The reserve
  // loop breaks on the first arm it cannot afford, so naming only that one
  // would under-report: the arms behind it were refused just as surely.
  const started = new Set(runs.map((run) => run.id));
  const unaffordable = budgetExhausted
    ? candidates
        .filter((candidate) => !started.has(candidate.id))
        .map((candidate) => candidate.id)
    : [];
  const ranked = runs.toSorted(
    style
      ? (a, b) =>
          Number(b.accepted) - Number(a.accepted) ||
          b.score - a.score ||
          a.id.localeCompare(b.id)
      : compareRuns
  );
  const best = ranked.find((run) => run.paints.length > 0) ?? null;
  return {
    best,
    budget: budget
      ? {
          actualCalls,
          actualUsd: hasUnpricedCalls ? null : actualUsd,
          exhausted: budgetExhausted,
          maxCalls: budget.maxCalls,
          maxUsd: budget.maxUsd,
          overrun:
            actualCalls > budget.maxCalls ||
            hasUnpricedCalls ||
            actualUsd > budget.maxUsd,
          reservedCalls,
          reservedUsd,
        }
      : null,
    candidates: runs,
    eligible: candidates.length,
    /** An arm threw and stopped the escalation. Not a budget condition. */
    haltedByFailure,
    minimum: { pq: minimumPq, sc: minimumSc },
    stoppedEarly: runs.length < candidates.length,
    unaffordable,
    /**
     * Only a real budget condition discards an accepted pair, and it does so
     * because the ledger is over or unknown and `exceedsCostBudget` fails
     * closed. A crash in a LATER arm says nothing about a pair that already
     * cleared every gate, so it no longer throws that pair away.
     */
    winner: budgetExhausted
      ? null
      : (ranked.find((run) => run.accepted) ?? null),
  };
};
