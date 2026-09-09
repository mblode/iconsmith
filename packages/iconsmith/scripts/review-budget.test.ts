import { describe, expect, it, vi } from "vitest";

import {
  admitNativeStage,
  createReviewBudgetIntent,
  executeFrozenReviewBudget,
  freezeNativeRequestBudget,
  readParentRequestClock,
} from "./review-budget.js";

const INPUT_HASH = "a".repeat(64);
const RUNNER_HASH = "b".repeat(64);

it("charges cold startup to the parent-issued request clock", () => {
  expect(
    readParentRequestClock({
      deadlineAt: "1200100",
      maxWallMs: "1200000",
      now: 10_100,
    })
  ).toEqual({ deadlineAt: 1_200_100, maxWallMs: 1_200_000, startedAt: 100 });
});

it.each([
  { deadlineAt: undefined, maxWallMs: "1200000", now: 100 },
  { deadlineAt: "100", maxWallMs: "1200000", now: 100 },
  { deadlineAt: "NaN", maxWallMs: "1200000", now: 100 },
  { deadlineAt: "1200101", maxWallMs: "1200000", now: 100 },
  { deadlineAt: "1200100", maxWallMs: "1200001", now: 100 },
  { deadlineAt: "1200100.5", maxWallMs: "1200000", now: 100 },
])("refuses absent, expired or extended child clock %j", (options) => {
  expect(() => readParentRequestClock(options)).toThrow();
});

const requestBudget = {
  clarificationMaximumMs: 90_000,
  deadlineAt: 1_200_001,
  exportReserveMs: 10_000,
  maxCompilerRepairs: 1,
  maxVisualRepairs: 1,
  now: 1,
  reviewerCount: 2,
  reviewerMaximumMs: 90_000,
  startedAt: 1,
};

it("charges automatic retrieval before authoring without borrowing the review reserve", () => {
  const budget = freezeNativeRequestBudget({
    ...requestBudget,
    retrievalCalls: 2,
  });
  expect(budget).toMatchObject({
    authorDeadlineAt: 830_001,
    maxAuthorCalls: 6,
    maxCalls: 12,
    maxRetrievalCalls: 2,
    maxReviewCalls: 4,
    retrievalDeadlineAt: 240_001,
    startedAt: 1,
  });
  expect(() =>
    freezeNativeRequestBudget({
      ...requestBudget,
      deadlineAt: 600_001,
      retrievalCalls: 2,
    })
  ).toThrow("Insufficient original deadline");
  expect(() =>
    freezeNativeRequestBudget({ ...requestBudget, retrievalCalls: 1 as 2 })
  ).toThrow("zero or exactly two");
});

it("reserves both independent reviewers before author dispatch and counts every possible call", () => {
  const budget = freezeNativeRequestBudget(requestBudget);
  expect(budget.authorDeadlineAt).toBe(830_001);
  expect(budget.maxAuthorCalls).toBe(6);
  expect(budget.maxReviewCalls).toBe(4);
  expect(budget.maxCalls).toBe(10);
  expect(Object.isFrozen(budget)).toBe(true);
  expect(
    freezeNativeRequestBudget({ ...requestBudget, now: 100_000 })
  ).toMatchObject({
    authorDeadlineAt: budget.authorDeadlineAt,
    deadlineAt: budget.deadlineAt,
    retrievalDeadlineAt: budget.retrievalDeadlineAt,
    startedAt: budget.startedAt,
  });
});

it("anchors every phase deadline to the original request start across re-entry", () => {
  const first = freezeNativeRequestBudget({
    ...requestBudget,
    retrievalCalls: 2,
  });
  const reentered = freezeNativeRequestBudget({
    ...requestBudget,
    now: 100_001,
    retrievalCalls: 2,
  });
  expect(reentered).toEqual(first);
  expect(reentered.retrievalDeadlineAt).toBe(
    requestBudget.startedAt + reentered.retrievalReserveMs
  );
});

it.each([
  { now: 600_000 },
  { startedAt: 2 },
  { startedAt: 1_200_001 },
  { reviewerCount: 1 },
  { maxVisualRepairs: 2 },
  { maxCompilerRepairs: -1 },
  { exportReserveMs: 1 },
  { reviewerMaximumMs: 1 },
])("refuses an unfunded or unsupported native schedule %j", (change) => {
  expect(() =>
    freezeNativeRequestBudget({ ...requestBudget, ...change })
  ).toThrow();
});

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

it("admits stages without refreshing the original deadline or consuming downstream reserves", () => {
  expect(
    admitNativeStage({
      deadlineAt: 100_000,
      maximumMs: 50_000,
      now: 10_000,
      remainingReserveMs: 60_000,
      stage: "construct",
    })
  ).toEqual({
    deadlineAt: 100_000,
    stageDeadlineAt: 40_000,
    timeoutMs: 30_000,
  });
  expect(() =>
    admitNativeStage({
      deadlineAt: 100_000,
      maximumMs: 50_000,
      now: 35_001,
      remainingReserveMs: 60_000,
      stage: "repair",
    })
  ).toThrow("Insufficient deadline reserve");
});

it.each([0, 1, -1, Number.NaN, Infinity])(
  "refuses inadmissible stage maxima %s before dispatch",
  (maximumMs) => {
    expect(() =>
      admitNativeStage({
        deadlineAt: 100_000,
        maximumMs,
        now: 10_000,
        remainingReserveMs: 0,
        stage: "inspect",
      })
    ).toThrow();
  }
);
