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

import { sheet } from "../tools/render.js";
import type { Finish } from "../types.js";
import { audit } from "./audit.js";
import type { AuditAsk, AuditResult } from "./audit.js";
import type { ApiCost } from "./cost.js";
import { EMPTY_USAGE, tokenUsageOf, totalUsd } from "./cost.js";
import { gatewayCostTracker, resolveModel } from "./gateway.js";
import type { GenerateResult } from "./generate.js";
import type { Concept } from "./prompt.js";

export const TOURNAMENT_MINIMUM = 8;

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
  concept,
  ids,
  preview,
}) => {
  const costTracker = gatewayCostTracker();
  const result = await generateObject({
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
  ask = gatewayPairRankAsk,
  candidates,
  concept,
}: {
  ask?: PairRankAsk;
  candidates: readonly PairCandidate[];
  concept: Concept;
}): Promise<PairCandidateRanking> => {
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
  audit: AuditResult;
  finish: Finish;
  result: GenerateResult;
}

export interface TournamentRun {
  accepted: boolean;
  /** A failed arm is evidence, not a reason to discard every other arm. */
  failure: string | null;
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
  stoppedEarly: boolean;
  /** Null means no pair earned delivery. Callers must not silently use best. */
  winner: TournamentRun | null;
}

export interface PairTournamentOptions {
  ask?: AuditAsk;
  budget?: { maxCalls: number; maxUsd: number };
  candidates: readonly PairCandidate[];
  concept: Concept;
  minimumPq?: number;
  minimumSc?: number;
  references?: readonly Buffer[];
  /** Evaluate in declaration order and stop after an accepted pair reaches
   * this score. Null preserves exhaustive parallel evaluation. */
  stopScore?: number | null;
}

const paintAccepted = (
  result: GenerateResult,
  reviewed: AuditResult,
  minimumSc: number,
  minimumPq: number
): boolean =>
  result.clean &&
  reviewed.scorable &&
  reviewed.findings.length === 0 &&
  reviewed.sc >= minimumSc &&
  reviewed.pq >= minimumPq;

const pairScore = (paints: readonly TournamentPaint[]): number => {
  if (paints.length === 0) {
    return 0;
  }
  const qualities = paints.flatMap((paint) => [paint.audit.sc, paint.audit.pq]);
  const floor = Math.min(...qualities);
  const mean =
    qualities.reduce((sum, value) => sum + value, 0) / qualities.length;
  const warnings = paints.reduce(
    (sum, paint) =>
      sum +
      paint.result.issues.filter((issue) => issue.severity === "warn").length,
    0
  );
  return Math.max(
    0,
    Number((floor * 0.7 + mean * 0.3 - Math.min(1, warnings * 0.05)).toFixed(2))
  );
};

const compareRuns = (a: TournamentRun, b: TournamentRun): number =>
  Number(b.accepted) - Number(a.accepted) ||
  b.score - a.score ||
  a.id.localeCompare(b.id);

/**
 * Generate and judge every pair. Candidate arms run independently so a local
 * CLI failure, provider outage, or malformed program cannot erase good work
 * from another arm.
 */
// oxlint-disable-next-line eslint/complexity -- one state machine owns pair generation, quality gates, and pre/post-call budget accounting
export const runPairTournament = async ({
  ask,
  budget,
  candidates,
  concept,
  minimumPq = TOURNAMENT_MINIMUM,
  minimumSc = TOURNAMENT_MINIMUM,
  references = [],
  stopScore = null,
}: PairTournamentOptions): Promise<PairTournamentResult> => {
  const runCandidate = async (
    candidate: PairCandidate
  ): Promise<TournamentRun> => {
    try {
      const finishes = ["outlined", "filled"] as const;
      const results: { finish: Finish; result: GenerateResult }[] = [];
      if (candidate.serial) {
        for (const finish of finishes) {
          results.push({
            finish,
            // oxlint-disable-next-line eslint/no-await-in-loop -- `serial` explicitly opts this subprocess out of paint fan-out.
            result: await candidate.generate(finish),
          });
        }
      } else {
        results.push(
          ...(await Promise.all(
            finishes.map(async (finish) => ({
              finish,
              result: await candidate.generate(finish),
            }))
          ))
        );
      }
      const paints = await Promise.all(
        results.map(async ({ finish, result }): Promise<TournamentPaint> => {
          const reviewed =
            result.audit ??
            (await audit({
              ask,
              concept,
              finish,
              kind: "analog",
              references,
              svg: result.svg,
            }));
          return {
            accepted: paintAccepted(result, reviewed, minimumSc, minimumPq),
            audit: reviewed,
            finish,
            result,
          };
        })
      );
      return {
        accepted: paints.every((paint) => paint.accepted),
        failure: null,
        id: candidate.id,
        label: candidate.label,
        paints,
        score: pairScore(paints),
      };
    } catch (error) {
      return {
        accepted: false,
        failure: failureMessage(error),
        id: candidate.id,
        label: candidate.label,
        paints: [],
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
    const costs = run.paints.flatMap((paint) => [
      ...(paint.result.apiCosts ?? []),
      ...(paint.audit.cost ? [paint.audit.cost] : []),
    ]);
    actualCalls += costs.reduce((sum, cost) => sum + cost.calls, 0);
    const measured = totalUsd(costs);
    if (measured === null) {
      hasUnpricedCalls = true;
    } else {
      actualUsd += measured;
    }
    // A pair-level failure can happen after one paint has already completed
    // and been billed. `runCandidate` intentionally collapses that incomplete
    // pair to failure evidence, so its total is unknowable here. Automatic
    // escalation must stop rather than treating the missing paint ledger as
    // free and starting another candidate.
    if (budget && run.failure !== null) {
      hasUnpricedCalls = true;
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
        // oxlint-disable-next-line eslint/no-await-in-loop -- serial candidates must not overlap the parallel pool or one another.
        runs.push(await runCandidate(candidate));
      }
    }
  } else {
    for (const candidate of candidates) {
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
    winner: budgetExhausted
      ? null
      : (ranked.find((run) => run.accepted) ?? null),
  };
};
