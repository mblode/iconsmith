/** Immutable deadline admission for bounded sequential review campaigns. */
const positiveInteger = (value: number, label: string) => {
  if (!(Number.isSafeInteger(value) && value > 0)) {
    throw new Error(`${label} must be a positive integer`);
  }
};

const validateFrozenScheduleClock = (options: {
  deadlineAt: number;
  now: number;
  startedAt: number;
}) => {
  if (
    options.startedAt > options.now ||
    options.startedAt >= options.deadlineAt
  ) {
    throw new Error("Native schedule must retain its original request start");
  }
};

/** The generator consumes the parent's clock; startup never earns more time. */
export const readParentRequestClock = (options: {
  deadlineAt?: string;
  maxWallMs: string;
  now: number;
}) => {
  if (!options.deadlineAt?.trim()) {
    throw new Error("A parent-issued --deadline-at is required");
  }
  const deadlineAt = Number(options.deadlineAt);
  const maxWallMs = Number(options.maxWallMs);
  if (
    !Number.isSafeInteger(options.now) ||
    !Number.isSafeInteger(deadlineAt) ||
    !Number.isSafeInteger(maxWallMs) ||
    maxWallMs <= 0 ||
    maxWallMs > 1_200_000 ||
    deadlineAt <= options.now ||
    deadlineAt - options.now > maxWallMs
  ) {
    throw new Error(
      "Run deadline must be unexpired and parent-bounded within 20 minutes"
    );
  }
  return { deadlineAt, maxWallMs, startedAt: deadlineAt - maxWallMs };
};

/** Admit a stage against the original request deadline without refreshing it. */
export const admitNativeStage = (options: {
  deadlineAt: number;
  now: number;
  maximumMs: number;
  remainingReserveMs: number;
  minimumMs?: number;
  stage: string;
}) => {
  const minimumMs = options.minimumMs ?? 5000;
  for (const [label, value] of Object.entries({
    deadline: options.deadlineAt,
    maximum: options.maximumMs,
    minimum: minimumMs,
  })) {
    positiveInteger(value, label);
  }
  if (
    !Number.isSafeInteger(options.now) ||
    options.now < 0 ||
    !Number.isSafeInteger(options.remainingReserveMs) ||
    options.remainingReserveMs < 0 ||
    !options.stage.trim() ||
    minimumMs > options.maximumMs
  ) {
    throw new Error("Invalid native stage admission bounds");
  }
  const timeoutMs = Math.min(
    options.maximumMs,
    options.deadlineAt - options.now - options.remainingReserveMs
  );
  if (timeoutMs < minimumMs) {
    throw new Error(`Insufficient deadline reserve for ${options.stage}`);
  }
  return {
    deadlineAt: options.deadlineAt,
    stageDeadlineAt: options.now + timeoutMs,
    timeoutMs,
  };
};

/** One production-visible review round; independent rejection does not redraw. */
export const freezeNativeRequestBudget = (options: {
  deadlineAt: number;
  now: number;
  startedAt: number;
  reviewerCount: number;
  maxCompilerRepairs: number;
  maxVisualRepairs: number;
  reviewerMaximumMs: number;
  clarificationMaximumMs: number;
  exportReserveMs: number;
  retrievalCalls?: 0 | 2;
  retrievalMaximumMs?: number;
}) => {
  for (const [label, value] of Object.entries(options)) {
    if (label === "retrievalCalls") {
      if (value !== undefined && value !== 0 && value !== 2) {
        throw new Error("Native retrieval requires zero or exactly two calls");
      }
      continue;
    }
    if (label === "maxCompilerRepairs" || label === "maxVisualRepairs") {
      if (!Number.isSafeInteger(value) || value < 0 || value > 1) {
        throw new Error(
          "Native route supports at most one repair per allowance"
        );
      }
    } else {
      positiveInteger(value, label);
    }
  }
  validateFrozenScheduleClock(options);
  if (
    options.reviewerCount !== 2 ||
    options.reviewerMaximumMs < 5000 ||
    options.clarificationMaximumMs < 5000 ||
    options.exportReserveMs < 5000
  ) {
    throw new Error(
      "Native route requires two reviewers and usable stage reserves"
    );
  }
  const reviewReserveMs =
    options.reviewerCount *
    (options.reviewerMaximumMs + options.clarificationMaximumMs);
  const authorDeadlineAt =
    options.deadlineAt - reviewReserveMs - options.exportReserveMs;
  const maxRetrievalCalls = options.retrievalCalls ?? 0;
  const retrievalMaximumMs = options.retrievalMaximumMs ?? 120_000;
  if (retrievalMaximumMs < 5000) {
    throw new Error("Native retrieval needs a usable stage reserve");
  }
  const retrievalReserveMs = maxRetrievalCalls * retrievalMaximumMs;
  const retrievalDeadlineAt = options.startedAt + retrievalReserveMs;
  // Initial construct, inspection and finalization must each be admissible.
  if (
    retrievalDeadlineAt > authorDeadlineAt ||
    authorDeadlineAt - Math.max(options.now, retrievalDeadlineAt) < 245_000
  ) {
    throw new Error(
      "Insufficient original deadline for author and required review"
    );
  }
  const maxAuthorCalls =
    3 + options.maxCompilerRepairs + 2 * options.maxVisualRepairs;
  const maxReviewCalls = options.reviewerCount * 2;
  return Object.freeze({
    authorDeadlineAt,
    clarificationMaximumMs: options.clarificationMaximumMs,
    deadlineAt: options.deadlineAt,
    exportReserveMs: options.exportReserveMs,
    maxAuthorCalls,
    maxCalls: maxAuthorCalls + maxReviewCalls + maxRetrievalCalls,
    maxCompilerRepairs: options.maxCompilerRepairs,
    maxRetrievalCalls,
    maxReviewCalls,
    maxVisualRepairs: options.maxVisualRepairs,
    retrievalCalls: maxRetrievalCalls,
    retrievalDeadlineAt,
    retrievalMaximumMs,
    retrievalReserveMs,
    reviewReserveMs,
    reviewRounds: 1 as const,
    reviewerCount: options.reviewerCount,
    reviewerMaximumMs: options.reviewerMaximumMs,
    startedAt: options.startedAt,
  });
};

const PRODUCTION_NATIVE_CALL_LIMITS = Object.freeze({
  maxCompilerRepairs: 1,
  maxVisualRepairs: 1,
  reviewerCount: 2,
});
export const productionNativeMaximumCalls = (retrievalCalls: 0 | 2 = 0) =>
  3 +
  PRODUCTION_NATIVE_CALL_LIMITS.maxCompilerRepairs +
  2 * PRODUCTION_NATIVE_CALL_LIMITS.maxVisualRepairs +
  2 * PRODUCTION_NATIVE_CALL_LIMITS.reviewerCount +
  retrievalCalls;

/** Development route policy; changing it changes the frozen tooling identity. */
export const freezeProductionNativeRequestBudget = (options: {
  deadlineAt: number;
  now: number;
  retrievalCalls?: 0 | 2;
  /** The parent-issued request start; callers may not renew it from local time. */
  startedAt: number;
}) =>
  freezeNativeRequestBudget({
    clarificationMaximumMs: 90_000,
    deadlineAt: options.deadlineAt,
    exportReserveMs: 10_000,
    ...PRODUCTION_NATIVE_CALL_LIMITS,
    now: options.now,
    retrievalCalls: options.retrievalCalls,
    reviewerMaximumMs: 90_000,
    startedAt: options.startedAt,
  });
