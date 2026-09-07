import { describe, expect, it, vi } from "vitest";

import {
  createReviewBudgetIntent,
  executeFrozenReviewBudget,
} from "./review-budget.js";

const INPUT_HASH = "a".repeat(64);
const RUNNER_HASH = "b".repeat(64);

describe("review budget", () => {
  it("freezes the available per-reviewer cap", () => {
    expect(
      createReviewBudgetIntent({
        deadlineAt: 600_000,
        inputHash: INPUT_HASH,
        minimumReviewerMs: 90_000,
        now: 1,
        requestedReviewerMaxMs: 240_000,
        reviewerCount: 2,
        runnerHash: RUNNER_HASH,
        settlementReserveMs: 10_000,
      }).perReviewerMaxMs
    ).toBe(240_000);
  });

  it("executes with the frozen intent cap", async () => {
    const invoke = vi.fn((cap: number) => Promise.resolve(cap));
    const intent = createReviewBudgetIntent({
      deadlineAt: 240_000,
      inputHash: INPUT_HASH,
      minimumReviewerMs: 90_000,
      now: 1,
      requestedReviewerMaxMs: 180_000,
      reviewerCount: 2,
      runnerHash: RUNNER_HASH,
      settlementReserveMs: 10_000,
    });
    await expect(
      executeFrozenReviewBudget({
        currentInputHash: INPUT_HASH,
        currentRunnerHash: RUNNER_HASH,
        intent,
        invoke,
        now: 1,
      })
    ).resolves.toBe(112_499);
    expect(invoke).toHaveBeenCalledWith(112_499, 240_000);
  });

  it("refuses stale bindings and expired budgets before invocation", () => {
    const invoke = vi.fn(() => Promise.resolve());
    const intent = createReviewBudgetIntent({
      deadlineAt: 230_000,
      inputHash: INPUT_HASH,
      minimumReviewerMs: 90_000,
      now: 1,
      requestedReviewerMaxMs: 180_000,
      reviewerCount: 2,
      runnerHash: RUNNER_HASH,
      settlementReserveMs: 10_000,
    });
    expect(() =>
      executeFrozenReviewBudget({
        currentInputHash: "changed",
        currentRunnerHash: RUNNER_HASH,
        intent,
        invoke,
        now: 1,
      })
    ).toThrow("binding changed");
    expect(() =>
      executeFrozenReviewBudget({
        currentInputHash: INPUT_HASH,
        currentRunnerHash: RUNNER_HASH,
        intent,
        invoke,
        now: 5003,
      })
    ).toThrow("expired");
    expect(invoke).not.toHaveBeenCalled();
  });
});
