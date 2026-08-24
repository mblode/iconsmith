import { describe, expect, it } from "vitest";

import type { AuditResult } from "./audit.js";
import type { ApiCost } from "./cost.js";
import type { GenerateResult } from "./generate.js";
import { rankPairCandidates, runPairTournament } from "./tournament.js";

const review = (
  sc: number,
  pq: number,
  findings: AuditResult["findings"] = []
): AuditResult => ({
  findings,
  ok: findings.length === 0 && sc >= 6 && pq >= 6,
  pq,
  reason: findings[0]?.message ?? "competent",
  sc,
  scorable: true,
  stage: findings.length === 0 ? "decide" : "screen",
});

const result = (audit: AuditResult, warnings = 0): GenerateResult =>
  ({
    audit,
    clean: true,
    doc: { draw: [], finish: "outlined", icon: "home", size: 24 },
    issues: Array.from({ length: warnings }, (_, index) => ({
      message: `warning ${index}`,
      rule: "centred",
      severity: "warn" as const,
    })),
    program: "icon home\nfinish outlined",
    steps: 2,
    svg: '<svg viewBox="0 0 24 24"></svg>',
    text: "done",
    trace: ["icon", "finish"],
  }) as GenerateResult;

/** Warnings the program asked for by name. `lint.ts` emits these for a
 *  diagonal the DSL declared `off-axis`, with a message that says "Nothing to
 *  fix", so they must not move a score. */
const declaredResult = (audit: AuditResult, warnings: number): GenerateResult =>
  ({
    ...result(audit),
    issues: Array.from({ length: warnings }, (_, index) => ({
      declared: "off-axis",
      message: `edge ${index} is 38.2 degrees, and the program declared off-axis for it`,
      rule: "off-axis",
      severity: "warn" as const,
    })),
  }) as GenerateResult;

const pricedResult = (usd: number): GenerateResult => {
  const cost: ApiCost = {
    calls: 1,
    generationIds: [],
    model: "test/cheap",
    operation: "icon-generation",
    source: "gateway",
    usage: {
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      inputTokens: 1,
      outputTokens: 1,
      reasoningTokens: 0,
    },
    usd,
  };
  return { ...result(review(10, 10)), apiCosts: [cost] };
};

describe("runPairTournament", () => {
  it("selects the strongest complete pair, not the best single paint", async () => {
    const tournament = await runPairTournament({
      candidates: [
        {
          generate: (finish) =>
            Promise.resolve(
              result(finish === "outlined" ? review(10, 10) : review(8, 8))
            ),
          id: "uneven",
          label: "Uneven",
        },
        {
          generate: () => Promise.resolve(result(review(9, 9))),
          id: "balanced",
          label: "Balanced",
        },
      ],
      concept: { name: "home" },
    });

    expect(tournament.winner?.id).toBe("balanced");
    expect(tournament.winner?.paints).toHaveLength(2);
  });

  it("rejects a high-scoring pair when the judge found a real defect", async () => {
    const tournament = await runPairTournament({
      candidates: [
        {
          generate: (finish) =>
            Promise.resolve(
              result(
                finish === "filled"
                  ? review(10, 10, [
                      { kind: "object", message: "looks like an envelope" },
                    ])
                  : review(10, 10)
              )
            ),
          id: "confused",
          label: "Confused",
        },
      ],
      concept: { name: "home" },
    });

    expect(tournament.best?.id).toBe("confused");
    expect(tournament.winner).toBeNull();
  });

  it("keeps a failed arm as evidence without losing another winner", async () => {
    const tournament = await runPairTournament({
      candidates: [
        {
          generate: () =>
            Promise.reject(new Error("claude executable missing")),
          id: "claude",
          label: "Claude Code",
        },
        {
          generate: () => Promise.resolve(result(review(9, 9))),
          id: "agent",
          label: "Gateway agent",
        },
      ],
      concept: { name: "home" },
    });

    expect(
      tournament.candidates.find((run) => run.id === "claude")?.failure
    ).toContain("executable missing");
    expect(tournament.winner?.id).toBe("agent");
  });

  it("runs a serial harness after the parallel pool and one paint at a time", async () => {
    const events: string[] = [];
    await runPairTournament({
      candidates: [
        {
          generate(finish) {
            events.push(`parallel-${finish}`);
            return Promise.resolve(result(review(9, 9)));
          },
          id: "agent",
          label: "Gateway agent",
        },
        {
          generate(finish) {
            events.push(`serial-${finish}`);
            return Promise.resolve(result(review(9, 9)));
          },
          id: "claude",
          label: "Claude Code",
          serial: true,
        },
      ],
      concept: { name: "home" },
    });

    expect(events).toEqual([
      "parallel-outlined",
      "parallel-filled",
      "serial-outlined",
      "serial-filled",
    ]);
  });

  it("stops paid escalation after a high-confidence accepted pair", async () => {
    const attempted: string[] = [];
    const tournament = await runPairTournament({
      candidates: [
        {
          generate: (finish) => {
            attempted.push(`library-${finish}`);
            return Promise.resolve(result(review(10, 10)));
          },
          id: "library",
          label: "Existing library",
        },
        {
          generate: (finish) => {
            attempted.push(`frontier-${finish}`);
            return Promise.resolve(result(review(10, 10)));
          },
          id: "frontier",
          label: "Frontier model",
        },
      ],
      concept: { name: "home" },
      stopScore: 9.75,
    });

    expect(attempted).toEqual(["library-outlined", "library-filled"]);
    expect(tournament.eligible).toBe(2);
    expect(tournament.stoppedEarly).toBe(true);
    expect(tournament.winner?.id).toBe("library");
  });

  it("reserves a complete pair before starting it and fails closed on budget exhaustion", async () => {
    const attempted: string[] = [];
    const tournament = await runPairTournament({
      budget: { maxCalls: 4, maxUsd: 0.1 },
      candidates: [
        {
          generate: (finish) => {
            attempted.push(`baseline-${finish}`);
            return Promise.resolve(result(review(9, 9)));
          },
          id: "baseline",
          label: "Baseline",
          reserveCalls: 2,
          reserveUsd: 0.05,
        },
        {
          generate: (finish) => {
            attempted.push(`frontier-${finish}`);
            return Promise.resolve(result(review(10, 10)));
          },
          id: "frontier",
          label: "Frontier",
          reserveCalls: 3,
          reserveUsd: 0.06,
        },
      ],
      concept: { name: "home" },
      stopScore: 9.75,
    });

    expect(attempted).toEqual(["baseline-outlined", "baseline-filled"]);
    expect(tournament.best?.id).toBe("baseline");
    expect(tournament.budget).toEqual({
      actualCalls: 0,
      actualUsd: 0,
      exhausted: true,
      maxCalls: 4,
      maxUsd: 0.1,
      overrun: false,
      reservedCalls: 2,
      reservedUsd: 0.05,
    });
    expect(tournament.winner).toBeNull();
  });

  it("fails closed when a candidate exceeds its conservative reservation", async () => {
    const tournament = await runPairTournament({
      budget: { maxCalls: 2, maxUsd: 0.1 },
      candidates: [
        {
          generate: () => Promise.resolve(pricedResult(0.08)),
          id: "underestimated",
          label: "Underestimated",
          reserveCalls: 2,
          reserveUsd: 0.05,
        },
      ],
      concept: { name: "home" },
      stopScore: 9.75,
    });

    expect(tournament.budget).toEqual({
      actualCalls: 2,
      actualUsd: 0.16,
      exhausted: true,
      maxCalls: 2,
      maxUsd: 0.1,
      overrun: true,
      reservedCalls: 2,
      reservedUsd: 0.05,
    });
    expect(tournament.winner).toBeNull();
  });

  it("stops escalation when a serial pair fails after paid work may have completed", async () => {
    const attempted: string[] = [];
    const tournament = await runPairTournament({
      budget: { maxCalls: 4, maxUsd: 0.2 },
      candidates: [
        {
          generate: (finish) => {
            attempted.push(`partial-${finish}`);
            return finish === "outlined"
              ? Promise.resolve(pricedResult(0.02))
              : Promise.reject(new Error("filled generation failed"));
          },
          id: "partial",
          label: "Partial paid pair",
          reserveCalls: 2,
          reserveUsd: 0.05,
          serial: true,
        },
        {
          generate: (finish) => {
            attempted.push(`next-${finish}`);
            return Promise.resolve(pricedResult(0.02));
          },
          id: "next",
          label: "Next candidate",
          reserveCalls: 2,
          reserveUsd: 0.05,
        },
      ],
      concept: { name: "home" },
      stopScore: 9.75,
    });

    expect(attempted).toEqual(["partial-outlined", "partial-filled"]);
    expect(tournament.candidates[0]?.failure).toContain(
      "filled generation failed"
    );
    expect(tournament.budget).toMatchObject({
      actualUsd: null,
      exhausted: true,
      overrun: true,
    });
    expect(tournament.winner).toBeNull();
  });

  it("stops escalation when either parallel paint fails", async () => {
    const attempted: string[] = [];
    const tournament = await runPairTournament({
      budget: { maxCalls: 4, maxUsd: 0.2 },
      candidates: [
        {
          generate: (finish) => {
            attempted.push(`partial-${finish}`);
            return finish === "outlined"
              ? Promise.resolve(pricedResult(0.02))
              : Promise.reject(new Error("parallel filled failed"));
          },
          id: "partial",
          label: "Parallel partial pair",
          reserveCalls: 2,
          reserveUsd: 0.05,
        },
        {
          generate: (finish) => {
            attempted.push(`next-${finish}`);
            return Promise.resolve(pricedResult(0.02));
          },
          id: "next",
          label: "Next candidate",
          reserveCalls: 2,
          reserveUsd: 0.05,
        },
      ],
      concept: { name: "home" },
      stopScore: 9.75,
    });

    expect(attempted).toEqual(["partial-outlined", "partial-filled"]);
    expect(tournament.candidates[0]?.failure).toContain(
      "parallel filled failed"
    );
    expect(tournament.budget).toMatchObject({
      actualUsd: null,
      exhausted: true,
      overrun: true,
    });
    expect(tournament.winner).toBeNull();
  });

  it("does not start an unpriced candidate inside a dollar budget", async () => {
    let called = false;
    const tournament = await runPairTournament({
      budget: { maxCalls: 10, maxUsd: 1 },
      candidates: [
        {
          generate: () => {
            called = true;
            return Promise.resolve(result(review(10, 10)));
          },
          id: "unknown-price",
          label: "Unknown price",
          reserveCalls: 2,
        },
      ],
      concept: { name: "home" },
      stopScore: 9.75,
    });

    expect(called).toBe(false);
    expect(tournament.budget?.exhausted).toBe(true);
    expect(tournament.winner).toBeNull();
  });

  it("fails the budget closed when visual audit output cannot be priced", async () => {
    const unreviewed = { ...result(review(10, 10)), audit: undefined };
    const tournament = await runPairTournament({
      ask: () => Promise.reject(new Error("structured output failed")),
      budget: { maxCalls: 2, maxUsd: 0.1 },
      candidates: [
        {
          generate: () => Promise.resolve(unreviewed),
          id: "candidate",
          label: "Candidate",
          reserveCalls: 2,
          reserveUsd: 0.1,
        },
      ],
      concept: { name: "home" },
      stopScore: 9.75,
    });

    expect(tournament.budget).toMatchObject({
      actualCalls: 2,
      actualUsd: null,
      exhausted: true,
      overrun: true,
    });
    expect(tournament.winner).toBeNull();
  });
});

describe("rankPairCandidates", () => {
  it("uses one pair-sheet verdict to order free candidates before auditing", async () => {
    const candidates = ["modifier", "canonical", "badge"].map((id) => ({
      generate: () => Promise.resolve(result(review(9, 9))),
      id,
      label: id,
    }));
    const ranking = await rankPairCandidates({
      ask: ({ ids }) => {
        expect(ids).toEqual(["modifier", "canonical", "badge"]);
        return Promise.resolve({ order: [2, 2, 1], reason: "canonical" });
      },
      candidates,
      concept: { name: "home" },
    });

    expect(ranking.order).toEqual(["canonical", "modifier", "badge"]);
  });

  it("marks a failed ranking call as unpriced instead of treating it as free", async () => {
    const candidates = ["first", "second"].map((id) => ({
      generate: () => Promise.resolve(result(review(9, 9))),
      id,
      label: id,
    }));
    const ranking = await rankPairCandidates({
      ask: () => Promise.reject(new Error("structured output failed")),
      candidates,
      concept: { name: "home" },
    });

    expect(ranking.cost).toMatchObject({
      calls: 1,
      operation: "candidate-ranking",
      source: "unpriced",
      usd: null,
    });
    expect(ranking.order).toEqual(["first", "second"]);
    expect(ranking.reason).toContain("structured output failed");
  });
});

/** One candidate through a whole tournament, reduced to its pairScore. */
const scoreOf = async (make: () => GenerateResult): Promise<number> => {
  const tournament = await runPairTournament({
    candidates: [
      { generate: () => Promise.resolve(make()), id: "a", label: "A" },
    ],
    concept: { name: "home" },
  });
  return tournament.candidates[0].score;
};

describe("pairScore and declared findings", () => {
  it("does not dock a pair for a diagonal its program declared", async () => {
    // Four declared edges on each of the two paints. Ignoring `declared` would
    // charge 8 x 0.05 and take a clean 10 to 9.6.
    expect(await scoreOf(() => declaredResult(review(10, 10), 4))).toBe(10);
  });

  it("still docks a pair for an undeclared warning", async () => {
    // Same shape as the case above, undeclared: 8 x 0.05.
    expect(await scoreOf(() => result(review(10, 10), 4))).toBe(9.6);
  });

  it("charges an undeclared warning even when a declared one sits beside it", async () => {
    const mixed = {
      ...result(review(10, 10)),
      issues: [
        {
          declared: "off-axis",
          message: "declared",
          rule: "off-axis",
          severity: "warn" as const,
        },
        { message: "off centre", rule: "centred", severity: "warn" as const },
      ],
    } as GenerateResult;
    // One chargeable warning across two paints: 2 x 0.05.
    expect(await scoreOf(() => mixed)).toBe(9.9);
  });
});
