/**
 * What a run cost, in tokens and in dollars.
 *
 * The rate table is copied into every report rather than looked up when the
 * report is read. A six-month-old report whose dollar figure cannot be
 * reconstructed is a dead report: prices change, intro pricing expires, and a
 * number with no rates beside it cannot be checked, compared or corrected. The
 * table below is the source; `CostReport.rates` is the copy that travels.
 *
 * Rates are USD per million tokens, from the Anthropic price list as of
 * 2026-08-19. Cache multipliers are the standard ones — a 5-minute cache write
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
