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

import { completeProgram } from "../tools/dsl.js";
import { sheet } from "../tools/render.js";
import type { Finish, Part } from "../types.js";
import { audit } from "./audit.js";
import type { AuditAsk, AuditResult } from "./audit.js";
import type { ApiCost } from "./cost.js";
import { EMPTY_USAGE, tokenUsageOf, totalUsd } from "./cost.js";
import { gatewayCostTracker, resolveModel } from "./gateway.js";
import type { GenerateResult } from "./generate.js";
import { better } from "./pick.js";
import type { RankedSample } from "./pick.js";
import type { Concept } from "./prompt.js";

export const TOURNAMENT_MINIMUM = 8;

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
export interface TournamentProgress {
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

export type TournamentProgressListener = (event: TournamentProgress) => void;

export interface PairCandidate {
  /** Stable machine id recorded in the Studio transcript. */
  id: string;
  /** Human-readable arm name. */
  label: string;
  generate: (finish: Finish) => Promise<GenerateResult>;
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
export const PAIR_RANK_MODEL = "google/gemini-3.1-flash-lite";

export const gatewayPairRankAsk: PairRankAsk = async ({
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
  if (candidates.length <= 1) {
    return {
      candidates: [...candidates],
      order: candidates.map((candidate) => candidate.id),
      reason: null,
    };
  }
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

export interface TournamentPaint {
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

export interface TournamentRun {
  accepted: boolean;
  /** A failed arm is evidence, not a reason to discard every other arm. */
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
    reservedCalls: number;
    reservedUsd: number;
  } | null;
  candidates: TournamentRun[];
  /** Candidates available before an accuracy gate stopped escalation. */
  eligible: number;
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

const paintAccepted = (
  paint: Omit<TournamentPaint, "accepted">,
  minimumSc: number,
  minimumPq: number
): boolean =>
  paint.result.clean &&
  paint.programComplete &&
  paint.houseDerived &&
  paint.audit.scorable &&
  paint.audit.findings.length === 0 &&
  paint.audit.sc >= minimumSc &&
  paint.audit.pq >= minimumPq;

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
  parts = [],
  references = [],
  stopScore = null,
}: PairTournamentOptions): Promise<PairTournamentResult> => {
  abortSignal?.throwIfAborted();
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
    try {
      const finishes = ["outlined", "filled"] as const;
      if (candidate.serial) {
        for (const finish of finishes) {
          results.push({
            finish,
            // oxlint-disable-next-line eslint/no-await-in-loop -- `serial` explicitly opts this subprocess out of paint fan-out.
            result: await candidate.generate(finish),
          });
          abortSignal?.throwIfAborted();
          report({ ...seat, finish, phase: "painted" });
        }
      } else {
        results.push(
          ...(await Promise.all(
            finishes.map(async (finish) => {
              abortSignal?.throwIfAborted();
              const result = await candidate.generate(finish);
              abortSignal?.throwIfAborted();
              report({ ...seat, finish, phase: "painted" });
              return { finish, result };
            })
          ))
        );
      }
      const paints = await Promise.all(
        results.map(async ({ finish, result }): Promise<TournamentPaint> => {
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
            finish,
            kind: "analog",
            references,
            svg: result.svg,
          });
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
            programComplete: completeProgram(result.doc, result.program, [
              ...parts,
              ...(result.extras ?? []),
            ]),
            result,
            selfReview: result.audit ?? null,
          };
          return {
            ...judged,
            accepted: paintAccepted(judged, minimumSc, minimumPq),
          };
        })
      );
      const accepted = paints.every((paint) => paint.accepted);
      const score = pairScore(paints);
      report({ ...seat, accepted, phase: "settled", score });
      return {
        accepted,
        failure: null,
        id: candidate.id,
        label: candidate.label,
        paints,
        score,
      };
    } catch (error) {
      // Candidate failures are isolated; cancellation is not a candidate
      // failure and must stop the tournament before another arm is started.
      abortSignal?.throwIfAborted();
      const failure = failureMessage(error);
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
        failure,
        id: candidate.id,
        label: candidate.label,
        paints: [],
        partialCosts: results.flatMap(({ result }) => result.apiCosts ?? []),
        score: 0,
      };
    }
  };
  const runs: TournamentRun[] = [];
  let reservedCalls = 0;
  let reservedUsd = 0;
  let actualCalls = 0;
  let actualUsd = 0;
  let hasUnpricedCalls = false;
  let budgetExhausted = false;
  const reserve = (candidate: PairCandidate): boolean => {
    if (!budget) {
      return true;
    }
    const calls = candidate.reserveCalls ?? 0;
    const usd = candidate.reserveUsd;
    if (
      usd === undefined ||
      reservedCalls + calls > budget.maxCalls ||
      reservedUsd + usd > budget.maxUsd
    ) {
      budgetExhausted = true;
      return false;
    }
    reservedCalls += calls;
    reservedUsd += usd;
    return true;
  };
  const recordActual = (run: TournamentRun): void => {
    const costs = [
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
    if (budget && run.failure !== null) {
      budgetExhausted = true;
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
        if (budgetExhausted) {
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
      if (budgetExhausted) {
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
  const ranked = runs.toSorted(compareRuns);
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
    minimum: { pq: minimumPq, sc: minimumSc },
    stoppedEarly: runs.length < candidates.length,
    unaffordable,
    winner: budgetExhausted
      ? null
      : (ranked.find((run) => run.accepted) ?? null),
  };
};
