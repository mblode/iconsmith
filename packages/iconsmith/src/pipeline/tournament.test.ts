import { describe, expect, it } from "vitest";

import { run as runDsl } from "../tools/dsl.js";
import type { IconDoc, Part } from "../types.js";
import type { AuditAsk, AuditResult } from "./audit.js";
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

/**
 * The acceptance judge sees only rendered images, so a fixture cannot label
 * its own paints. The script is consumed in the order the tournament asks,
 * which `serial` makes deterministic; anything past the end scores zero.
 */
const judge = (...scripted: readonly AuditResult[]): AuditAsk => {
  const queue = [...scripted];
  return () => Promise.resolve(queue.shift() ?? review(0, 0));
};

/** One judgement for every paint in the tournament. */
const judgeAll =
  (verdict: AuditResult): AuditAsk =>
  () =>
    Promise.resolve(verdict);

/** A house mark, so a fixture drawing is composed rather than invented. */
const BODY: Part = {
  closed: true,
  d: "M3 3H21V21H3Z",
  h: 18,
  icons: ["home"],
  id: "p0001",
  instances: 4,
  name: "home-body",
  nodes: 4,
  sizeRange: [18, 18],
  w: 18,
};

const PARTS: readonly Part[] = [BODY];

const PROGRAM = ["icon home", "finish outlined", "part home-body at 0,0"].join(
  "\n"
);

/** Derived by replaying the program, so the fixture round-trips by
 *  construction rather than by a hand-copied literal that can drift. */
const docOf = (program: string): IconDoc => {
  const replay = runDsl(program, [...PARTS]);
  if (replay.errors.length > 0) {
    throw new Error(
      `fixture program is not valid: ${replay.errors.join("; ")}`
    );
  }
  return replay.canvas.toJSON({ icon: replay.icon, keyline: replay.keyline });
};

const result = (audit: AuditResult, warnings = 0): GenerateResult =>
  ({
    audit,
    clean: true,
    doc: docOf(PROGRAM),
    issues: Array.from({ length: warnings }, (_, index) => ({
      message: `warning ${index}`,
      rule: "centred",
      severity: "warn" as const,
    })),
    program: PROGRAM,
    steps: 2,
    svg: '<svg viewBox="0 0 24 24"></svg>',
    text: "done",
    trace: ["icon", "finish", "part"],
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
      ask: judge(review(10, 10), review(8, 8), review(9, 9), review(9, 9)),
      candidates: [
        {
          generate: () => Promise.resolve(result(review(10, 10))),
          id: "uneven",
          label: "Uneven",
          serial: true,
        },
        {
          generate: () => Promise.resolve(result(review(9, 9))),
          id: "balanced",
          label: "Balanced",
          serial: true,
        },
      ],
      concept: { name: "home" },
      parts: PARTS,
    });

    expect(tournament.winner?.id).toBe("balanced");
    expect(tournament.winner?.paints).toHaveLength(2);
  });

  it("rejects a high-scoring pair when the judge found a real defect", async () => {
    const tournament = await runPairTournament({
      ask: judge(
        review(10, 10),
        review(10, 10, [{ kind: "object", message: "looks like an envelope" }])
      ),
      candidates: [
        {
          generate: () => Promise.resolve(result(review(10, 10))),
          id: "confused",
          label: "Confused",
          serial: true,
        },
      ],
      concept: { name: "home" },
      parts: PARTS,
    });

    expect(tournament.best?.id).toBe("confused");
    expect(tournament.winner).toBeNull();
  });

  it("keeps a failed arm as evidence without losing another winner", async () => {
    const tournament = await runPairTournament({
      ask: judgeAll(review(9, 9)),
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
      parts: PARTS,
    });

    expect(
      tournament.candidates.find((run) => run.id === "claude")?.failure
    ).toContain("executable missing");
    expect(tournament.winner?.id).toBe("agent");
  });

  it("runs a serial harness after the parallel pool and one paint at a time", async () => {
    const events: string[] = [];
    await runPairTournament({
      ask: judgeAll(review(9, 9)),
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
      parts: PARTS,
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
      ask: judgeAll(review(10, 10)),
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
      parts: PARTS,
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
      ask: judgeAll(review(9, 9)),
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
      parts: PARTS,
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
      ask: judgeAll(review(10, 10)),
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
      parts: PARTS,
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
      ask: judgeAll(review(10, 10)),
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
      parts: PARTS,
      stopScore: 9.75,
    });

    expect(attempted).toEqual(["partial-outlined", "partial-filled"]);
    expect(tournament.candidates[0]?.failure).toContain(
      "filled generation failed"
    );
    // Escalation stops, because the pair is incomplete and the next candidate
    // must not start on the assumption that it was free. The ledger stays
    // priced: the outlined paint had already been billed, and the run reports
    // what it actually cost rather than declaring the total unknown.
    expect(tournament.candidates[0]?.partialCosts).toHaveLength(1);
    expect(tournament.budget).toMatchObject({
      actualCalls: 1,
      actualUsd: 0.02,
      exhausted: true,
      overrun: false,
    });
    expect(tournament.winner).toBeNull();
  });

  it("stops escalation when either parallel paint fails", async () => {
    const attempted: string[] = [];
    const tournament = await runPairTournament({
      ask: judgeAll(review(10, 10)),
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
      parts: PARTS,
      stopScore: 9.75,
    });

    expect(attempted).toEqual(["partial-outlined", "partial-filled"]);
    expect(tournament.candidates[0]?.failure).toContain(
      "parallel filled failed"
    );
    // A parallel pair recovers nothing: `Promise.all` rejects before either
    // result is in hand, so there is no billed paint to report. Escalation
    // still stops. The asymmetry with the serial case is real and is the
    // honest reading — a serial arm knows what it finished, a parallel one
    // does not.
    expect(tournament.candidates[0]?.partialCosts).toStrictEqual([]);
    expect(tournament.budget).toMatchObject({
      exhausted: true,
      overrun: false,
    });
    expect(tournament.winner).toBeNull();
  });

  it("does not start an unpriced candidate inside a dollar budget", async () => {
    let called = false;
    const tournament = await runPairTournament({
      ask: judgeAll(review(10, 10)),
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
      parts: PARTS,
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
      parts: PARTS,
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
    ask: judgeAll(review(10, 10)),
    candidates: [
      { generate: () => Promise.resolve(make()), id: "a", label: "A" },
    ],
    concept: { name: "home" },
    parts: PARTS,
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

describe("acceptance is independent, complete, and house-derived", () => {
  it("scores the drawing, not the review the arm brought with it", async () => {
    // The campaign's one accepted pair carried its own `draw-and-review` audit
    // at 10/10 on both paints; the first independent look scored it 9/8 and
    // 9/6. The arm's own verdict is kept as evidence and decides nothing.
    const tournament = await runPairTournament({
      ask: judgeAll(review(4, 4)),
      candidates: [
        {
          generate: () => Promise.resolve(result(review(10, 10))),
          id: "self-graded",
          label: "Self graded",
        },
      ],
      concept: { name: "home" },
      parts: PARTS,
    });

    expect(tournament.winner).toBeNull();
    expect(tournament.best?.paints[0]?.audit.sc).toBe(4);
    expect(tournament.best?.paints[0]?.selfReview?.sc).toBe(10);
  });

  it("refuses a pair whose program does not replay to its own drawing", async () => {
    // A `raw` escape has no DSL word, so `programFromDoc` drops it and the
    // saved `.icon` is a lossy record rather than the source. This is the
    // `filled.icon.partial` the git-pull-request attempt shipped at 10/10.
    const lossy = {
      ...result(review(10, 10)),
      doc: {
        ...docOf(PROGRAM),
        draw: [
          ...docOf(PROGRAM).draw,
          { d: "M3 3L21 21", fillRule: "nonzero", op: "raw" },
        ],
      },
    } as GenerateResult;
    const tournament = await runPairTournament({
      ask: judgeAll(review(10, 10)),
      candidates: [
        { generate: () => Promise.resolve(lossy), id: "lossy", label: "Lossy" },
      ],
      concept: { name: "home" },
      parts: PARTS,
    });

    expect(tournament.best?.paints[0]?.programComplete).toBe(false);
    expect(tournament.winner).toBeNull();
  });

  it("refuses a clean 10/10 drawn from primitives instead of the house", async () => {
    // Every pair in the campaign that scored 10/10 composed; every pair drawn
    // from raw primitives scored 7 or less. `AGENTS.md` makes at least one
    // house mark half of arrival.
    const invented = ["icon home", "finish outlined", "rect 3,3 18x18"].join(
      "\n"
    );
    const scratch = {
      ...result(review(10, 10)),
      doc: docOf(invented),
      program: invented,
      trace: ["icon", "finish", "rect"],
    } as GenerateResult;
    const tournament = await runPairTournament({
      ask: judgeAll(review(10, 10)),
      candidates: [
        {
          generate: () => Promise.resolve(scratch),
          id: "invented",
          label: "Invented",
        },
      ],
      concept: { name: "home" },
      parts: PARTS,
    });

    expect(tournament.best?.paints[0]?.houseDerived).toBe(false);
    expect(tournament.best?.paints[0]?.partOps).toBe(0);
    expect(tournament.winner).toBeNull();
  });

  it("counts an adopted host analog as house-derived", async () => {
    // `construct` places a whole host construction, whose coordinates came
    // from the same place a `part` op's do. Checking only for `part` would
    // reject the arm that produced the campaign's one clean pair.
    const invented = ["icon home", "finish outlined", "rect 3,3 18x18"].join(
      "\n"
    );
    const adopted = {
      ...result(review(10, 10)),
      doc: docOf(invented),
      program: invented,
      trace: ["proposal", "listParts", "construct", "render", "lint"],
    } as GenerateResult;
    const tournament = await runPairTournament({
      ask: judgeAll(review(10, 10)),
      candidates: [
        {
          generate: () => Promise.resolve(adopted),
          id: "adopted",
          label: "Adopted",
        },
      ],
      concept: { name: "home" },
      parts: PARTS,
    });

    expect(tournament.winner?.id).toBe("adopted");
    expect(tournament.winner?.paints[0]?.houseDerived).toBe(true);
  });

  it("never lets part count outrank the score the pair was given", async () => {
    // A `wifi` run named a library compile at 0.4/10 its best pair, over a
    // harness pair at 5.5, because the compile had more `part` ops. Nothing
    // outranks the quality judgement; composition breaks ties inside it.
    const invented = ["icon home", "finish outlined", "rect 3,3 18x18"].join(
      "\n"
    );
    const tournament = await runPairTournament({
      ask: judge(review(2, 2), review(2, 2), review(7, 7), review(7, 7)),
      candidates: [
        {
          generate: () => Promise.resolve(result(review(2, 2))),
          id: "library-compile",
          label: "Existing library",
          serial: true,
        },
        {
          generate: () =>
            Promise.resolve({
              ...result(review(7, 7)),
              doc: docOf(invented),
              program: invented,
              trace: ["icon", "finish", "construct"],
            } as GenerateResult),
          id: "harness",
          label: "Claude harness",
          serial: true,
        },
      ],
      concept: { name: "home" },
      parts: PARTS,
    });

    expect(tournament.best?.id).toBe("harness");
  });

  it("ranks a composed pair above an invented one at the same score", async () => {
    const invented = ["icon home", "finish outlined", "rect 3,3 18x18"].join(
      "\n"
    );
    const tournament = await runPairTournament({
      ask: judgeAll(review(10, 10)),
      candidates: [
        {
          generate: () =>
            Promise.resolve({
              ...result(review(10, 10)),
              doc: docOf(invented),
              program: invented,
              trace: ["icon", "finish", "construct"],
            } as GenerateResult),
          id: "invented",
          label: "Invented",
        },
        {
          generate: () => Promise.resolve(result(review(10, 10))),
          id: "composed",
          label: "Composed",
        },
      ],
      concept: { name: "home" },
      parts: PARTS,
    });

    // `candidates` stays in generation order because it is the evidence
    // ledger; the ranking shows up in who wins.
    expect(tournament.winner?.id).toBe("composed");
    expect(tournament.best?.id).toBe("composed");
  });
});

describe("a short tournament says which kind of short it was", () => {
  it("names every arm the budget refused, not just the first", async () => {
    // The campaign's default budget could reserve `host-analog` and
    // `image-agent` and nothing else, so `gateway-agent` and `claude-harness`
    // never ran — and the record said `stoppedEarly`, which also means "it
    // won". The refused arms are now on the result.
    const arm = (id: string, reserveUsd: number) => ({
      generate: () => Promise.resolve(result(review(9, 9))),
      id,
      label: id,
      reserveCalls: 2,
      reserveUsd,
    });
    const tournament = await runPairTournament({
      ask: judgeAll(review(9, 9)),
      budget: { maxCalls: 10, maxUsd: 0.25 },
      candidates: [
        arm("host-analog", 0.055),
        arm("image-agent", 0.195),
        arm("gateway-agent", 0.35),
        arm("claude-harness", 0.4),
      ],
      concept: { name: "home" },
      parts: PARTS,
      stopScore: 9.75,
    });

    expect(tournament.unaffordable).toEqual([
      "gateway-agent",
      "claude-harness",
    ]);
    expect(tournament.stoppedEarly).toBe(true);
  });

  it("reports nothing unaffordable when a tournament stopped because it won", async () => {
    const tournament = await runPairTournament({
      ask: judgeAll(review(10, 10)),
      budget: { maxCalls: 10, maxUsd: 5 },
      candidates: [
        {
          generate: () => Promise.resolve(result(review(10, 10))),
          id: "library",
          label: "Existing library",
          reserveCalls: 2,
          reserveUsd: 0.055,
        },
        {
          generate: () => Promise.resolve(result(review(10, 10))),
          id: "frontier",
          label: "Frontier",
          reserveCalls: 2,
          reserveUsd: 0.4,
        },
      ],
      concept: { name: "home" },
      parts: PARTS,
      stopScore: 9.75,
    });

    expect(tournament.winner?.id).toBe("library");
    expect(tournament.stoppedEarly).toBe(true);
    expect(tournament.unaffordable).toEqual([]);
  });
});

describe("progress reporting", () => {
  it("reports each phase, with a position in the field", async () => {
    // The tournament sits inside one tool call, so without this a ten-minute
    // run says "running the pipeline" and then nothing at all. `index`/`total`
    // are the point: "arm 2 of 2" is a position, a spinner is a promise.
    const seen: string[] = [];
    const tournament = await runPairTournament({
      ask: judgeAll(review(9, 9)),
      candidates: [
        {
          generate: () => Promise.resolve(result(review(9, 9))),
          id: "first",
          label: "First",
          serial: true,
        },
        {
          generate: () => Promise.resolve(result(review(9, 9))),
          id: "second",
          label: "Second",
          serial: true,
        },
      ],
      concept: { name: "home" },
      onProgress: (event) =>
        seen.push(
          `${event.index}/${event.total} ${event.candidateId} ${event.phase}${
            event.finish ? ` ${event.finish}` : ""
          }`
        ),
      parts: PARTS,
    });

    expect(tournament.candidates).toHaveLength(2);

    // What is guaranteed: an arm opens with `started`, closes with `settled`,
    // and both arms run in order because both are `serial`. A serial arm also
    // paints outlined before filled.
    //
    // What is not: the two audits run under one `Promise.all`, so `reviewed`
    // arrives in whichever order they resolve. Pinning that order made this
    // test fail on the second arm alone, which is the test claiming a promise
    // the tournament never made — the paints are deliberately concurrent.
    const phasesOf = (id: string) =>
      seen.filter((row) => row.includes(id)).map((row) => row.split(" ")[2]);

    expect(phasesOf("first")).toStrictEqual([
      "started",
      "painted",
      "painted",
      "reviewed",
      "reviewed",
      "settled",
    ]);
    expect(phasesOf("second")).toStrictEqual(phasesOf("first"));
    expect(seen.indexOf("1/2 first settled")).toBeLessThan(
      seen.indexOf("2/2 second started")
    );
    expect(
      seen.filter((row) => row.startsWith("1/2 first painted"))
    ).toStrictEqual(["1/2 first painted outlined", "1/2 first painted filled"]);
    expect(
      seen.filter((row) => row.startsWith("2/2 second reviewed")).toSorted()
    ).toStrictEqual([
      "2/2 second reviewed filled",
      "2/2 second reviewed outlined",
    ]);
  });

  it("carries the scores the reader wants to see", async () => {
    const reviewed: { pq?: number; sc?: number }[] = [];
    let settled: { accepted?: boolean; score?: number } | null = null;
    await runPairTournament({
      ask: judgeAll(review(10, 9)),
      candidates: [
        {
          generate: () => Promise.resolve(result(review(10, 9))),
          id: "arm",
          label: "Arm",
          serial: true,
        },
      ],
      concept: { name: "home" },
      onProgress: (event) => {
        if (event.phase === "reviewed") {
          reviewed.push({ pq: event.pq, sc: event.sc });
        }
        if (event.phase === "settled") {
          settled = { accepted: event.accepted, score: event.score };
        }
      },
      parts: PARTS,
    });

    expect(reviewed).toStrictEqual([
      { pq: 9, sc: 10 },
      { pq: 9, sc: 10 },
    ]);
    // `pairScore` is weighted to the weaker paint: floor 9 * 0.7 + mean 9.5 *
    // 0.3, with no chargeable warnings on this fixture.
    expect(settled).toStrictEqual({ accepted: true, score: 9.15 });
  });

  it("does not let a throwing listener lose a paid tournament", async () => {
    // The run has already spent money by the time progress is reported. A
    // renderer that throws must cost a row, never the result.
    const tournament = await runPairTournament({
      ask: judgeAll(review(10, 10)),
      candidates: [
        {
          generate: () => Promise.resolve(result(review(10, 10))),
          id: "arm",
          label: "Arm",
        },
      ],
      concept: { name: "home" },
      onProgress: () => {
        throw new Error("the renderer exploded");
      },
      parts: PARTS,
    });

    expect(tournament.winner?.id).toBe("arm");
  });

  it("settles a progress row when an arm throws", async () => {
    const seen: {
      accepted?: boolean;
      failure?: string;
      phase: string;
      score?: number;
    }[] = [];
    const tournament = await runPairTournament({
      ask: judgeAll(review(10, 10)),
      candidates: [
        {
          generate: () => Promise.reject(new Error("generator unavailable")),
          id: "broken",
          label: "Broken",
        },
      ],
      concept: { name: "home" },
      onProgress: (event) => seen.push(event),
      parts: PARTS,
    });

    expect(tournament.candidates[0]?.failure).toBe("generator unavailable");
    expect(seen).toMatchObject([
      { phase: "started" },
      {
        accepted: false,
        failure: "generator unavailable",
        phase: "settled",
        score: 0,
      },
    ]);
  });
});
