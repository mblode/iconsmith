/**
 * Model calls go through Vercel AI Gateway, or OpenRouter when that is
 * the arm the caller asked for.
 *
 * A namespaced id (`anthropic/claude-opus-5`) is a gateway route. A bare id is
 * treated as Anthropic and namespaced, never wrapped in a vendor SDK — that
 * pin would bill Anthropic directly and skip the gateway. OpenRouter is the
 * other generate arm: `OPENROUTER_API_KEY` plus an OpenRouter slug
 * (`thinkingmachines/inkling:free` or `openrouter/…`). External agent CLIs
 * get the same gateway credential and the compatibility endpoints the
 * gateway documents for Codex and Claude Code.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { createGateway } from "@ai-sdk/gateway";
import type { LanguageModel } from "ai";

import type { ApiCost, TokenUsage, UsageLike } from "./cost.js";
import { addUsage, EMPTY_USAGE, rateFor, tokenUsageOf, usdOf } from "./cost.js";
import {
  DEFAULT_OPENROUTER_MODEL,
  OPENROUTER_INKLING,
  createOpenRouterModel,
  openrouterModelId,
  usesOpenRouter,
} from "./openrouter.js";

export {
  DEFAULT_OPENROUTER_MAX_TOKENS,
  DEFAULT_OPENROUTER_MODEL,
  OPENROUTER_INKLING,
  OPENROUTER_PREFIX,
  OPENROUTER_URL,
  createOpenRouterModel,
  openrouterMaxTokens,
  openrouterModelId,
  usesOpenRouter,
} from "./openrouter.js";

export const DEFAULT_MODEL = "anthropic/claude-opus-5";

/** Codex's Responses-API compatibility surface. Not `/v1`: Codex lists models
 *  from `/codex/v1/models` in a shape the CLI decodes at startup. */
export const CODEX_GATEWAY_URL = "https://ai-gateway.vercel.sh/codex/v1";
/** Claude Code's Anthropic-compatible surface. No `/v1` suffix: the SDK
 *  appends `/v1/messages` itself. */
export const CLAUDE_GATEWAY_URL = "https://ai-gateway.vercel.sh/claude-code";
/** OpenAI-compatible surface, for CLIs that speak that wire protocol. */
export const OPENAI_GATEWAY_URL = "https://ai-gateway.vercel.sh/v1";

/** Thrown, and only thrown, when the caller has given us no way to reach the
 *  chosen provider. The CLI prints `.message` and exits non-zero; there is
 *  nothing in a stack trace here that helps anyone. */
export class MissingApiKeyError extends Error {
  constructor(kind: "gateway" | "openrouter" = "gateway") {
    super(
      kind === "openrouter"
        ? "No OpenRouter credential found. Set OPENROUTER_API_KEY and pass " +
            `an OpenRouter model id (\`${OPENROUTER_INKLING}\`, ` +
            `\`${DEFAULT_OPENROUTER_MODEL}\`, or \`openrouter/…\`).`
        : "No AI Gateway credential found. Set AI_GATEWAY_API_KEY (or " +
            "VERCEL_OIDC_TOKEN) and use a namespaced model id " +
            `(\`${DEFAULT_MODEL}\`). OpenRouter is OPENROUTER_API_KEY plus ` +
            `\`--model ${OPENROUTER_INKLING}\`.`
    );
    this.name = "MissingApiKeyError";
  }
}

const present = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed || undefined;
};

/** The bearer token the gateway will accept, or undefined. An Anthropic key is
 *  not a substitute: it would send the request somewhere the caller did not
 *  ask for. */
export const gatewayToken = (apiKey?: string): string | undefined =>
  present(apiKey) ??
  present(process.env.AI_GATEWAY_API_KEY) ??
  present(process.env.VERCEL_OIDC_TOKEN);

/** The OpenRouter bearer token, or undefined. */
export const openrouterToken = (apiKey?: string): string | undefined =>
  present(apiKey) ?? present(process.env.OPENROUTER_API_KEY);

/** A gateway model id. Bare ids are Anthropic house models; anything already
 *  namespaced is left alone so Google and OpenAI image routes stay put. */
export const gatewayModelId = (id: string): string =>
  id.includes("/") ? id : `anthropic/${id}`;

const agentName = (command: string): string =>
  path.basename(command).replace(/\.exe$/iu, "");

/**
 * Resolve a model, failing early and legibly when the key is missing.
 *
 * A model *instance* is used as given: that is the seam tests reach through,
 * and it is deliberately the only one, so there is no second code path that
 * behaves differently from the real thing.
 *
 * OpenRouter wins when the id is an OpenRouter slug, or when the only
 * credential on the machine is `OPENROUTER_API_KEY` and the caller did not
 * name a model — then the default is billed Inkling (`thinkingmachines/inkling`),
 * not `:free` (allowlisted to listed OpenRouter apps) and not a gateway
 * Anthropic id that this key cannot reach.
 */
export const resolveModel = (
  model?: LanguageModel,
  apiKey?: string
): LanguageModel => {
  if (model && typeof model !== "string") {
    return model;
  }
  const requested = typeof model === "string" ? model : undefined;
  const gwToken = gatewayToken(apiKey);
  const explicitOpenRouter =
    requested !== undefined &&
    (requested.startsWith("openrouter/") ||
      /:[a-z0-9-]+$/iu.test(requested) ||
      present(process.env.ICONSMITH_PROVIDER) === "openrouter");
  const preferOpenRouter =
    requested === undefined
      ? openrouterToken() !== undefined && gwToken === undefined
      : usesOpenRouter(requested);
  const orToken = explicitOpenRouter
    ? openrouterToken(apiKey)
    : openrouterToken();

  if (preferOpenRouter) {
    if (orToken === undefined) {
      throw new MissingApiKeyError("openrouter");
    }
    return createOpenRouterModel({
      apiKey: orToken,
      modelId: openrouterModelId(requested ?? OPENROUTER_INKLING),
    });
  }

  if (!gwToken) {
    throw new MissingApiKeyError();
  }
  const id = gatewayModelId(requested ?? DEFAULT_MODEL);
  return createGateway({ apiKey: gwToken })(id);
};

const generationIdOf = (metadata: unknown): string | null => {
  if (!(metadata && typeof metadata === "object" && "gateway" in metadata)) {
    return null;
  }
  const gatewayMetadata = (metadata as { gateway?: unknown }).gateway;
  if (!(gatewayMetadata && typeof gatewayMetadata === "object")) {
    return null;
  }
  const id = (gatewayMetadata as { generationId?: unknown }).generationId;
  return typeof id === "string" ? id : null;
};

const gatewayUsdOf = (metadata: unknown): number | null => {
  if (!(metadata && typeof metadata === "object" && "gateway" in metadata)) {
    return null;
  }
  const gatewayMetadata = (metadata as { gateway?: unknown }).gateway;
  if (!(gatewayMetadata && typeof gatewayMetadata === "object")) {
    return null;
  }
  const raw = (gatewayMetadata as { cost?: unknown }).cost;
  const parsed = typeof raw === "string" ? Number(raw) : raw;
  return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : null;
};

export interface GatewayCostTracker {
  capture: (event: { providerMetadata?: unknown; usage?: UsageLike }) => void;
  measure: (input: {
    calls?: number;
    fallbackUsd?: number;
    model: string;
    operation: string;
    usage: TokenUsage;
  }) => Promise<ApiCost>;
  /** Cost observed after completed model calls. Gateway metadata wins; the
   * checked-in rate table is the fallback. Null means the model is unpriced. */
  observed: (model: string) => { calls: number; usd: number | null };
  record: (metadata: unknown) => void;
}

/** Capture Gateway generation ids and resolve them to the amount the Gateway
 * actually billed. The rate table or a fixed image price is only a fallback
 * when metadata lookup is unavailable. Cost lookup failure never fails a draw. */
export const gatewayCostTracker = (apiKey?: string): GatewayCostTracker => {
  const generationIds: string[] = [];
  const gatewayCosts: number[] = [];
  const capturedGatewayCosts: (number | null)[] = [];
  let capturedCalls = 0;
  let capturedUsage: TokenUsage = { ...EMPTY_USAGE };
  let capturedUsageCalls = 0;
  const record = (metadata: unknown): void => {
    const id = generationIdOf(metadata);
    if (id && !generationIds.includes(id)) {
      generationIds.push(id);
    }
    const usd = gatewayUsdOf(metadata);
    if (usd !== null) {
      gatewayCosts.push(usd);
    }
  };
  return {
    capture: ({ providerMetadata, usage }) => {
      capturedCalls += 1;
      const measuredUsage = usage ? tokenUsageOf(usage) : null;
      if (
        measuredUsage &&
        Object.values(measuredUsage).some((tokens) => tokens > 0)
      ) {
        capturedUsage = addUsage(capturedUsage, measuredUsage);
        capturedUsageCalls += 1;
      }
      capturedGatewayCosts.push(gatewayUsdOf(providerMetadata));
      record(providerMetadata);
    },
    measure: async ({ calls = 1, fallbackUsd, model, operation, usage }) => {
      const ids = [...generationIds];
      const tokenRate = rateFor(model);
      const hasUsage = Object.values(usage).some((tokens) => tokens > 0);
      const fallback =
        fallbackUsd ?? (tokenRate && hasUsage ? usdOf(usage, tokenRate) : null);
      let fallbackSource: ApiCost["source"] = "unpriced";
      if (fallbackUsd !== undefined) {
        fallbackSource = "fixed";
      } else if (tokenRate && hasUsage) {
        fallbackSource = "rate-table";
      }
      const token = gatewayToken(apiKey);
      const capturedCostsComplete =
        capturedCalls > 0 &&
        capturedGatewayCosts.every((cost): cost is number => cost !== null);
      const recordedCostsComplete =
        capturedCalls === 0 && gatewayCosts.length > 0;
      if (capturedCostsComplete || recordedCostsComplete) {
        const exactCosts = capturedCostsComplete
          ? capturedGatewayCosts
          : gatewayCosts;
        return {
          calls: Math.max(calls, capturedCalls, exactCosts.length, ids.length),
          generationIds: ids,
          model,
          operation,
          source: "gateway" as const,
          usage,
          usd: exactCosts.reduce((sum, cost) => sum + cost, 0),
        };
      }
      const expectedCalls = Math.max(calls, capturedCalls);
      if (token && ids.length === expectedCalls) {
        try {
          const gateway = createGateway({ apiKey: token });
          const generations = await Promise.all(
            ids.map((id) => gateway.getGenerationInfo({ id }))
          );
          return {
            calls: ids.length,
            generationIds: ids,
            model,
            operation,
            source: "gateway" as const,
            usage,
            usd: generations.reduce(
              (sum, generation) => sum + generation.totalCost,
              0
            ),
          };
        } catch {
          // The drawing remains valid and the explicit fallback remains
          // auditable. Cost measurement must not become an availability gate.
        }
      }
      return {
        calls: Math.max(calls, capturedCalls, ids.length),
        generationIds: ids,
        model,
        operation,
        source: fallbackSource,
        usage,
        usd: fallback,
      };
    },
    observed: (model) => {
      if (
        capturedCalls > 0 &&
        capturedGatewayCosts.every((cost): cost is number => cost !== null)
      ) {
        return {
          calls: capturedCalls,
          usd: capturedGatewayCosts.reduce((sum, cost) => sum + cost, 0),
        };
      }
      const tokenRate = rateFor(model);
      return {
        calls: capturedCalls,
        usd:
          tokenRate && capturedUsageCalls === capturedCalls
            ? usdOf(capturedUsage, tokenRate)
            : null,
      };
    },
    record,
  };
};

/** Scratch Codex config: provider vercel, Responses wire, no desktop home. */
const codexConfig = (): string =>
  [
    'model_provider = "vercel"',
    'model = "openai/gpt-5.6-sol"',
    "",
    "[model_providers.vercel]",
    'name = "Vercel AI Gateway"',
    `base_url = "${CODEX_GATEWAY_URL}"`,
    'env_key = "AI_GATEWAY_API_KEY"',
    'wire_api = "responses"',
    "",
  ].join("\n");

/**
 * Point an external agent CLI at the gateway without rewriting `~/.codex` or
 * `~/.claude`. Scratch-local Codex home; Claude Code env vars on the child.
 */
export const applyGatewayEnv = (
  command: string,
  dir: string,
  env: NodeJS.ProcessEnv
): NodeJS.ProcessEnv => {
  const token = gatewayToken();
  const next: NodeJS.ProcessEnv = { ...env };
  if (token) {
    next.AI_GATEWAY_API_KEY = token;
  }
  const agent = agentName(command);
  if (agent === "codex") {
    const home = path.join(dir, ".codex");
    mkdirSync(home, { recursive: true });
    writeFileSync(path.join(home, "config.toml"), codexConfig());
    next.CODEX_HOME = home;
  }
  if (agent === "claude") {
    next.ANTHROPIC_BASE_URL = CLAUDE_GATEWAY_URL;
    next.ANTHROPIC_API_KEY = "";
    if (token) {
      next.ANTHROPIC_AUTH_TOKEN = token;
    }
  }
  if (agent === "gemini") {
    next.OPENAI_BASE_URL = OPENAI_GATEWAY_URL;
    if (token) {
      next.GEMINI_API_KEY = token;
      next.OPENAI_API_KEY = token;
    }
  }
  return next;
};
