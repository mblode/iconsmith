/**
 * The loop.
 *
 * A concept goes in; a drawn, linted `IconDoc` comes out. The model works by
 * calling primitives and looking at renders of what it has made, which is the
 * only part of this that resembles how the icons were drawn by hand. Nothing it
 * emits reaches the document without passing through `Canvas`, so a bad turn
 * costs a step, never a spec violation.
 */
import { readFileSync } from "node:fs";

import { anthropic, createAnthropic } from "@ai-sdk/anthropic";
import { generateText, stepCountIs } from "ai";
import type { LanguageModel, StopCondition, ToolSet } from "ai";

import { lint } from "../tools/lint.js";
import type { IconDoc, Issue, Keyline, Part } from "../types.js";
import type { TokenUsage } from "./cost.js";
import type { Reference } from "./licence.js";
import { conceptPrompt, systemPrompt } from "./prompt.js";
import type { Concept } from "./prompt.js";
import { createTools } from "./tools.js";
import type { ToolState } from "./tools.js";

export type { Concept } from "./prompt.js";
export type { Reference } from "./licence.js";

export const DEFAULT_MODEL = "claude-opus-5";
/** Enough turns for a search, a dozen primitives, three looks and a fix. Past
 *  this the model is polishing, and polishing is where it drifts. */
export const DEFAULT_MAX_STEPS = 24;

/** Thrown, and only thrown, when the caller has given us no way to reach a
 *  model. The CLI prints `.message` and exits non-zero; there is nothing in a
 *  stack trace here that helps anyone. */
export class MissingApiKeyError extends Error {
  constructor() {
    super(
      "No model credential found. Set AI_GATEWAY_API_KEY and use a namespaced " +
        "model id (`anthropic/claude-opus-4.5`), or set ANTHROPIC_API_KEY for a " +
        "bare id, or pass a model instance to generate()."
    );
    this.name = "MissingApiKeyError";
  }
}

export interface GenerateOptions {
  apiKey?: string;
  /** Existing icons the model can hold the draft up against. Licensed, because
   *  they reach the model: see `ToolsOptions.corpus`. */
  corpus?: Reference[];
  keyline?: Keyline | null;
  maxSteps?: number;
  /**
   * A model instance, or a model id. Anything that is not an object is treated
   * as an Anthropic model id and needs a key; passing an instance is how tests
   * run this loop with no network.
   */
  model?: LanguageModel;
  parts?: Part[];
  renderSize?: number;
}

/**
 * What one generation consumed.
 *
 * Optional on `GenerateResult` because the seam every eval arm reaches through
 * is a plain `GenerateFn`, and a stub generator has no model behind it to
 * report. Absent means "not measured", never "free" — the eval report says so
 * rather than summing zeros into a dollar figure.
 */
export interface GenerateCost {
  /** Why the model stopped: `stop` when the run's own condition fired,
   *  otherwise the SDK's reason. `length` or `tool-calls` on a whole benchmark
   *  means the step cap is binding and the scores measure the cap. */
  finishReason: string;
  /** Wall time for the whole loop, milliseconds. Not CPU: most of it is the
   *  network, which is what an operator waiting on a run is paying for. */
  ms: number;
  /** Tool calls by name, so "it spent 18 steps" can be read as "it rendered
   *  nine times and drew twice". */
  toolCalls: Record<string, number>;
  usage: TokenUsage;
}

export interface GenerateResult {
  /** No lint errors. Warnings do not block. */
  clean: boolean;
  /** Tokens, wall time, tool-call mix and stop reason. Absent when the
   *  generator is a stub. */
  cost?: GenerateCost;
  doc: IconDoc;
  issues: Issue[];
  /** The model's closing sentence about what it drew. */
  text: string;
  /** Tool calls made, in order — the trace of how the icon was arrived at. */
  trace: string[];
  steps: number;
  svg: string;
}

/**
 * Resolve a model, failing early and legibly when the key is missing.
 *
 * A model *instance* is used as given: that is the seam tests reach through,
 * and it is deliberately the only one, so there is no second code path that
 * behaves differently from the real thing.
 */
export const resolveModel = (
  model?: LanguageModel,
  apiKey?: string
): LanguageModel => {
  if (model && typeof model !== "string") {
    return model;
  }
  const id = model ?? DEFAULT_MODEL;

  // A namespaced id (`anthropic/claude-opus-4.5`) is a Vercel AI Gateway route,
  // and the AI SDK resolves a bare string through its global provider, which is
  // the gateway. Returning the id unchanged is what routes it there; wrapping it
  // in a provider would pin it to that vendor and defeat the gateway.
  if (id.includes("/")) {
    if (!(apiKey ?? process.env.AI_GATEWAY_API_KEY)) {
      throw new MissingApiKeyError();
    }
    return id;
  }

  const key = apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!key) {
    throw new MissingApiKeyError();
  }
  return apiKey ? createAnthropic({ apiKey })(id) : anthropic(id);
};

/** Read a `parts.json` written by `writeParts`. */
export const loadParts = (file: string): Part[] => {
  const data = JSON.parse(readFileSync(file, "utf-8")) as { parts?: Part[] };
  return data.parts ?? [];
};

/**
 * Stop as soon as the model has both looked at a render and seen a clean lint.
 *
 * The render half is not redundant. Lint checks the spec, not the drawing: a
 * centred rectangle of the right size lints perfectly and is not an icon of
 * anything. Requiring that the model has seen its own work at least once is the
 * cheapest available proxy for "it checked".
 */
const drawnAndClean =
  <T extends ToolSet>(state: ToolState): StopCondition<T> =>
  () =>
    state.rendered &&
    state.issues !== null &&
    state.issues.every((i) => i.severity !== "error");

export const generate = async (
  concept: Concept,
  options: GenerateOptions = {}
): Promise<GenerateResult> => {
  const {
    apiKey,
    corpus = [],
    keyline = null,
    maxSteps = DEFAULT_MAX_STEPS,
    model,
    parts = [],
    renderSize,
  } = options;

  const resolved = resolveModel(model, apiKey);
  const { canvas, state, tools } = createTools({
    corpus,
    keyline,
    parts,
    renderSize,
  });

  const startedAt = Date.now();
  const result = await generateText({
    model: resolved,
    prompt: conceptPrompt(concept),
    stopWhen: [stepCountIs(maxSteps), drawnAndClean(state)],
    system: systemPrompt({ keyline }),
    tools,
  });
  const ms = Date.now() - startedAt;

  // Linted here rather than trusting the model's last `lint` call: it may have
  // drawn after checking, and this is the number that gets reported.
  const issues = lint(canvas, { keyline });
  const usage = result.totalUsage;
  const toolCalls: Record<string, number> = {};
  for (const name of state.calls) {
    toolCalls[name] = (toolCalls[name] ?? 0) + 1;
  }
  return {
    clean: issues.every((i) => i.severity !== "error"),
    // `totalUsage` is the sum across every step, which is the number that gets
    // billed; `usage` alone would report the last step only. Each field is
    // `number | undefined` — a provider that does not break out cache reads
    // leaves them undefined, and 0 is the honest reading of "this provider
    // reported none".
    cost: {
      finishReason: result.finishReason,
      ms,
      toolCalls,
      usage: {
        cacheReadTokens: usage.inputTokenDetails.cacheReadTokens ?? 0,
        cacheWriteTokens: usage.inputTokenDetails.cacheWriteTokens ?? 0,
        inputTokens:
          usage.inputTokenDetails.noCacheTokens ?? usage.inputTokens ?? 0,
        outputTokens: usage.outputTokens ?? 0,
        reasoningTokens: usage.outputTokenDetails.reasoningTokens ?? 0,
      },
    },
    doc: canvas.toJSON({ icon: concept.name, keyline }),
    issues,
    steps: result.steps.length,
    svg: canvas.toSVG(),
    text: result.text,
    trace: state.calls,
  };
};
