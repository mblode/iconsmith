/** Immutable deadline admission for bounded sequential review campaigns. */
export interface ReviewBudgetIntent {
  deadlineAt: number;
  inputHash: string;
  perReviewerMaxMs: number;
  reviewerCount: number;
  runnerHash: string;
  settlementReserveMs: number;
}
const HASH = /^[a-f0-9]{64}$/u;

const positiveInteger = (value: number, label: string) => {
  if (!(Number.isSafeInteger(value) && value > 0)) {
    throw new Error(`${label} must be a positive integer`);
  }
};

export const createReviewBudgetIntent = (options: {
  admissionMarginMs?: number;
  deadlineAt: number;
  inputHash: string;
  minimumReviewerMs: number;
  now: number;
  requestedReviewerMaxMs: number;
  reviewerCount: number;
  runnerHash: string;
  settlementReserveMs: number;
}): ReviewBudgetIntent => {
  const admissionMarginMs = options.admissionMarginMs ?? 5000;
  positiveInteger(options.deadlineAt, "Deadline");
  positiveInteger(options.now, "Current time");
  positiveInteger(options.reviewerCount, "Reviewer count");
  positiveInteger(options.requestedReviewerMaxMs, "Reviewer maximum");
  positiveInteger(options.minimumReviewerMs, "Reviewer minimum");
  positiveInteger(options.settlementReserveMs, "Settlement reserve");
  positiveInteger(admissionMarginMs, "Admission margin");
  if (
    options.minimumReviewerMs > options.requestedReviewerMaxMs ||
    !HASH.test(options.inputHash) ||
    !HASH.test(options.runnerHash)
  ) {
    throw new Error("Invalid review budget intent identity or bounds");
  }
  const available =
    options.deadlineAt -
    options.now -
    options.settlementReserveMs -
    admissionMarginMs;
  const perReviewerMaxMs = Math.min(
    options.requestedReviewerMaxMs,
    Math.floor(available / options.reviewerCount)
  );
  if (perReviewerMaxMs < options.minimumReviewerMs) {
    throw new Error("Insufficient review deadline budget");
  }
  return {
    deadlineAt: options.deadlineAt,
    inputHash: options.inputHash,
    perReviewerMaxMs,
    reviewerCount: options.reviewerCount,
    runnerHash: options.runnerHash,
    settlementReserveMs: options.settlementReserveMs,
  };
};

export const executeFrozenReviewBudget = <T>(options: {
  currentInputHash: string;
  currentRunnerHash: string;
  intent: ReviewBudgetIntent;
  invoke: (perReviewerMaxMs: number, deadlineAt: number) => Promise<T>;
  now: number;
}): Promise<T> => {
  const { intent } = options;
  if (
    !Number.isSafeInteger(intent.deadlineAt) ||
    !Number.isSafeInteger(options.now) ||
    !HASH.test(intent.inputHash) ||
    !HASH.test(intent.runnerHash) ||
    intent.inputHash !== options.currentInputHash ||
    intent.runnerHash !== options.currentRunnerHash
  ) {
    throw new Error("Review budget intent binding changed");
  }
  positiveInteger(intent.perReviewerMaxMs, "Frozen reviewer maximum");
  positiveInteger(intent.reviewerCount, "Frozen reviewer count");
  positiveInteger(intent.settlementReserveMs, "Frozen settlement reserve");
  if (
    options.now +
      intent.perReviewerMaxMs * intent.reviewerCount +
      intent.settlementReserveMs >
    intent.deadlineAt
  ) {
    throw new Error("Frozen review deadline budget expired");
  }
  return options.invoke(intent.perReviewerMaxMs, intent.deadlineAt);
};
