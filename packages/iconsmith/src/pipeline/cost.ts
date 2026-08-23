/**
 * What a run cost, in tokens and in dollars.
 *
 * The rate table is copied into every report rather than looked up when the
 * report is read. A six-month-old report whose dollar figure cannot be
 * reconstructed is a dead report: prices change, intro pricing expires, and a
 * number with no rates beside it cannot be checked, compared or corrected. The
 * table below is the source; `CostReport.rates` is the copy that travels.
 *
 * Rates are USD per million tokens, from the provider and Vercel Gateway model
 * lists as of 2026-08-23. Cache multipliers are the standard ones — a 5-minute cache write
 * is 1.25× the input rate and a read is 0.1× — applied here rather than left
 * implicit, so the arithmetic in a report is visible without knowing the
 * convention.
 */

export interface Rate {
  cacheRead: number;
  cacheWrite: number;
  input: number;
  output: number;
}

export type RateTable = Record<string, Rate>;

const rate = (input: number, output: number): Rate => ({
  cacheRead: input * 0.1,
  cacheWrite: input * 1.25,
  input,
  output,
});

/** USD per million tokens. Sonnet 5's $2/$10 introductory pricing runs through
 *  2026-08-31; the standard $3/$15 is used here so a report does not quietly
 *  become wrong on 1 September. */
export const RATES: RateTable = {
  "claude-fable-5": rate(10, 50),
  "claude-haiku-4-5": rate(1, 5),
  "claude-opus-4-6": rate(5, 25),
  "claude-opus-4-7": rate(5, 25),
  "claude-opus-4-8": rate(5, 25),
  "claude-opus-5": rate(5, 25),
  "claude-sonnet-4-6": rate(3, 15),
  "claude-sonnet-5": rate(3, 15),
  "gemini-3.1-flash-lite": {
    cacheRead: 0.03,
    cacheWrite: 0,
    input: 0.25,
    output: 1.5,
  },
  "gemini-3.5-flash": {
    cacheRead: 0.15,
    cacheWrite: 0,
    input: 1.5,
    output: 9,
  },
  "gemini-3.5-flash-lite": {
    cacheRead: 0.03,
    cacheWrite: 0,
    input: 0.3,
    output: 2.5,
  },
};

/**
 * The rate for a model id, or null when the id is not in the table.
 *
 * Null rather than a guess: an unpriced model must make the report say "no
 * dollar figure" rather than report zero, which reads as free. A gateway route
 * (`anthropic/claude-opus-5`) is the same model as the bare id, so the
 * namespace is stripped.
 */
export const rateFor = (
  model: string,
  rates: RateTable = RATES
): Rate | null => {
  const bare = model.includes("/")
    ? model.slice(model.lastIndexOf("/") + 1)
    : model;
  return rates[bare] ?? rates[model] ?? null;
};

/** Token counts for one generation, in the shape the AI SDK reports them. */
export interface TokenUsage {
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** Uncached input tokens. Cache reads and writes are counted separately and
   *  are *not* included here, so the three sum to the billed input. */
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
}

/** One externally billed operation. `usd: null` means the provider did not
 * expose a bill and the local rate table had no honest fallback. */
export interface ApiCost {
  calls: number;
  generationIds: string[];
  model: string;
  operation: string;
  source: "fixed" | "gateway" | "rate-table" | "unpriced";
  usage: TokenUsage;
  usd: number | null;
}

/** The subset of AI SDK usage consumed here. Kept structural so this module
 * remains usable by the CLI and benchmark without importing the SDK. */
export interface UsageLike {
  inputTokenDetails?: {
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
    noCacheTokens?: number;
  };
  inputTokens?: number;
  outputTokenDetails?: { reasoningTokens?: number };
  outputTokens?: number;
}

export const EMPTY_USAGE: TokenUsage = {
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  inputTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
};

export const addUsage = (a: TokenUsage, b: TokenUsage): TokenUsage => ({
  cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
  cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
  inputTokens: a.inputTokens + b.inputTokens,
  outputTokens: a.outputTokens + b.outputTokens,
  reasoningTokens: a.reasoningTokens + b.reasoningTokens,
});

export const tokenUsageOf = (usage: UsageLike): TokenUsage => ({
  cacheReadTokens: usage.inputTokenDetails?.cacheReadTokens ?? 0,
  cacheWriteTokens: usage.inputTokenDetails?.cacheWriteTokens ?? 0,
  inputTokens: usage.inputTokenDetails?.noCacheTokens ?? usage.inputTokens ?? 0,
  outputTokens: usage.outputTokens ?? 0,
  reasoningTokens: usage.outputTokenDetails?.reasoningTokens ?? 0,
});

/** Null propagates: an unpriced call makes the total unknown, never free. */
export const totalUsd = (costs: readonly ApiCost[]): number | null =>
  costs.some((cost) => cost.usd === null)
    ? null
    : costs.reduce((sum, cost) => sum + (cost.usd ?? 0), 0);

const PER_MILLION = 1e6;

/**
 * Dollars for one usage record. Reasoning tokens are billed as output tokens
 * and the SDK already counts them inside `outputTokens`, so they are reported
 * but not charged twice.
 */
export const usdOf = (usage: TokenUsage, r: Rate): number =>
  (usage.inputTokens * r.input +
    usage.cacheReadTokens * r.cacheRead +
    usage.cacheWriteTokens * r.cacheWrite +
    usage.outputTokens * r.output) /
  PER_MILLION;

/**
 * Reach: where the treatment sits on the floor-to-baseline scale, in points.
 *
 * 0 points is a random icon from the set; 100 points is 0.737, the measured
 * median rendered cosine between two mature sets drawing the same concept. The
 * denominator is the interesting part — dollars per point of raw cosine would
 * be dominated by the shared white canvas every icon has for free, and would
 * make a pipeline that draws nothing look cheap and effective.
 */
export const reachPoints = (
  treatment: number,
  floor: number,
  baseline: number
): number => {
  const span = baseline - floor;
  return span <= 0 ? 0 : ((treatment - floor) / span) * 100;
};
