import { describe, expect, it } from "vitest";

import type { AuditResult } from "./audit.js";
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
});
