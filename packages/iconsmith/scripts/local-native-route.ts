/** Canonical contained native author and two-reviewer route for a local style run. */
import path from "node:path";

import { runNativeAstraStructuredAuthor } from "./local-astra-author.js";
import type { NativeAstraAuthorOptions } from "./local-astra-author.js";
import { runNativeClaudeStructuredAuthor } from "./local-claude-author.js";
import type { NativeClaudeAuthorAdapterOptions } from "./local-claude-author.js";
import { reviewImagesWithCodex } from "./local-codex-review.js";
import type { CodexReviewOptions } from "./local-codex-review.js";
import type { NativeCallContainerFactory } from "./local-native-call-factory.js";
import { reviewImages } from "./local-review.js";
import type { ReviewOptions } from "./local-review.js";
import type {
  StructuredAuthorOptions,
  StructuredFinish,
  StructuredHostCheck,
} from "./local-structured-author.js";
import type { freezeProductionNativeRequestBudget } from "./review-budget.js";
import { productionNativeMaximumCalls } from "./review-budget.js";

export type NativeStyleBudget = ReturnType<
  typeof freezeProductionNativeRequestBudget
>;

interface NativeStyleAuthorRequest {
  check: (cwd: string) => Promise<StructuredHostCheck>;
  completionDeadlineAt: number;
  concept: string;
  deadlineAt: number;
  finishes: readonly StructuredFinish[];
  out: string;
  prompt: string;
  referenceImages: Readonly<Record<string, Uint8Array>>;
  runtimeRoot: string;
}

type NativeStyleAuthorReceipt = Awaited<
  ReturnType<typeof runNativeAstraStructuredAuthor>
>;

interface NativeStyleReviewAnswer {
  choice: string;
  evidence: string;
  treatment: string;
}
export interface NativeStyleReviewResult {
  answers: Record<string, NativeStyleReviewAnswer> | null;
  evidenceHashes: Record<string, string>;
  model: string | null;
  reason?: string;
  status: "complete" | "incomplete";
}

export interface NativeStyleReviewRequest {
  deadlineAt: number;
  images: Readonly<Record<string, Uint8Array>>;
  maxStageMs: number;
  nativeCall: {
    ordinal: number;
    parentDeadlineAt: number;
    runtimeCwd: string;
    stageKind: string;
  };
  out: string;
  questions: ReviewOptions["questions"];
}

interface NativeStyleAuthorRoute {
  id: string;
  lineage: string;
  run: (request: NativeStyleAuthorRequest) => Promise<NativeStyleAuthorReceipt>;
}

interface NativeStyleReviewerRoute {
  containerFactory: NativeCallContainerFactory;
  id: string;
  lineage: string;
  model: string;
  run: (request: NativeStyleReviewRequest) => Promise<NativeStyleReviewResult>;
}

export interface NativeStyleRoute {
  author: NativeStyleAuthorRoute;
  /** Frozen with the durable request before container factories are created. */
  budget?: NativeStyleBudget;
  reviewers: readonly [NativeStyleReviewerRoute, NativeStyleReviewerRoute];
  /** Provider-writable directories. This must remain outside run evidence. */
  runtimeRoot: string;
}
const nativeRoutes = new WeakSet<NativeStyleRoute>();

export const assertCanonicalNativeStyleRoute = (route: NativeStyleRoute) => {
  if (!nativeRoutes.has(route)) {
    throw new Error(
      "Native style route must come from the canonical constructor"
    );
  }
};

type AstraConfig = Omit<
  NativeAstraAuthorOptions,
  "concept" | "deadlineAt" | "out" | "referenceImages" | "runtimeRoot"
> & {
  container: NonNullable<NativeAstraAuthorOptions["container"]>;
  containerFactory: NativeCallContainerFactory;
  id: string;
  lineage: string;
};
type ClaudeConfig = Omit<
  NativeClaudeAuthorAdapterOptions,
  "concept" | "deadlineAt" | "out" | "referenceImages" | "runtimeRoot"
> & {
  container: NonNullable<NativeClaudeAuthorAdapterOptions["container"]>;
  containerFactory: NativeCallContainerFactory;
  id: string;
  lineage: string;
};

export type NativeStyleAuthorConfig =
  | ({ provider: "openai-astra" } & AstraConfig)
  | ({ provider: "anthropic-claude" } & ClaudeConfig);

type ClaudeReviewerConfig = Omit<
  ReviewOptions,
  "deadlineAt" | "images" | "maxStageMs" | "nativeCall" | "out" | "questions"
> & {
  containerFactory: NativeCallContainerFactory;
  id: string;
  lineage: string;
  provider: "anthropic-claude";
};
type CodexReviewerConfig = Omit<
  CodexReviewOptions,
  "deadlineAt" | "images" | "maxStageMs" | "nativeCall" | "out" | "questions"
> & {
  containerFactory: NativeCallContainerFactory;
  id: string;
  lineage: string;
  provider: "openai-codex";
};
export type NativeStyleReviewerConfig =
  | ClaudeReviewerConfig
  | CodexReviewerConfig;

const routeName = (value: string, label: string, maximum = 61) => {
  if (!/^[a-z0-9][a-z0-9-]*$/u.test(value) || value.length > maximum) {
    throw new Error(`${label} must be a stable lowercase route name`);
  }
  return value;
};

const authorRoute = (
  config: NativeStyleAuthorConfig
): NativeStyleAuthorRoute => {
  const { id, lineage } = config;
  return {
    id: routeName(id, "Author id"),
    lineage: routeName(lineage, "Author lineage"),
    run: (request) => {
      const shared: Omit<
        StructuredAuthorOptions,
        "construct" | "finalize" | "inspect" | "model"
      > = {
        check: request.check,
        completionDeadlineAt: request.completionDeadlineAt,
        deadlineAt: request.deadlineAt,
        finishes: request.finishes,
        maxCompilerRepairs: 1,
        maxRepairs: 1,
        out: request.out,
        prompt: request.prompt,
      };
      const dynamic = {
        concept: request.concept,
        deadlineAt: request.deadlineAt,
        out: request.out,
        referenceImages: request.referenceImages,
        runtimeRoot: request.runtimeRoot,
      };
      if (config.provider === "openai-astra") {
        const {
          id: _id,
          lineage: _lineage,
          provider: _provider,
          ...adapter
        } = config;
        return runNativeAstraStructuredAuthor({
          ...adapter,
          ...dynamic,
          ...shared,
        });
      }
      const {
        id: _id,
        lineage: _lineage,
        provider: _provider,
        ...adapter
      } = config;
      return runNativeClaudeStructuredAuthor({
        ...adapter,
        ...dynamic,
        ...shared,
      });
    },
  };
};

const reviewerRoute = (
  config: NativeStyleReviewerConfig
): NativeStyleReviewerRoute => {
  const { containerFactory, id, lineage, provider, ...adapter } = config;
  const identity = {
    containerFactory,
    id: routeName(id, "Reviewer id", 38),
    lineage: routeName(lineage, "Reviewer lineage"),
    model: provider === "openai-codex" ? config.model : "claude-opus-5",
  };
  if (!identity.model.trim()) {
    throw new Error("Reviewer model must be explicit");
  }
  return {
    ...identity,
    run: (request) => {
      const nativeCall = {
        ...request.nativeCall,
        containerFactory,
      };
      return provider === "openai-codex"
        ? reviewImagesWithCodex({
            ...(adapter as Omit<
              CodexReviewerConfig,
              "containerFactory" | "id" | "lineage" | "provider"
            >),
            deadlineAt: request.deadlineAt,
            images: request.images,
            maxStageMs: request.maxStageMs,
            model: identity.model,
            nativeCall,
            out: request.out,
            questions: request.questions,
          })
        : reviewImages({
            ...(adapter as Omit<
              ClaudeReviewerConfig,
              "containerFactory" | "id" | "lineage" | "provider"
            >),
            deadlineAt: request.deadlineAt,
            images: request.images,
            maxStageMs: request.maxStageMs,
            nativeCall,
            out: request.out,
            questions: request.questions,
          });
    },
  };
};

export const createNativeStyleRoute = (options: {
  author: NativeStyleAuthorConfig;
  budget: NativeStyleBudget;
  reviewers: readonly [NativeStyleReviewerConfig, NativeStyleReviewerConfig];
  runtimeRoot: string;
}): NativeStyleRoute => {
  if (!path.isAbsolute(options.runtimeRoot)) {
    throw new Error("Native route runtime root must be absolute");
  }
  const author = authorRoute(options.author);
  if (
    ![0, 2].includes(options.budget.maxRetrievalCalls) ||
    options.budget.maxCalls !==
      productionNativeMaximumCalls(options.budget.maxRetrievalCalls) ||
    options.budget.maxAuthorCalls !== 6 ||
    options.budget.maxReviewCalls !== 4 ||
    options.budget.reviewRounds !== 1
  ) {
    throw new Error("Native route requires the frozen production call budget");
  }
  const reviewers = options.reviewers.map(
    reviewerRoute
  ) as unknown as readonly [NativeStyleReviewerRoute, NativeStyleReviewerRoute];
  if (
    reviewers[0].id === reviewers[1].id ||
    reviewers[0].lineage === reviewers[1].lineage ||
    reviewers[0].model === reviewers[1].model ||
    reviewers.some((reviewer) => reviewer.lineage === author.lineage)
  ) {
    throw new Error(
      "Native route requires two independent reviewer lineages excluding the author"
    );
  }
  const route = Object.freeze({
    author: Object.freeze(author),
    budget: options.budget,
    reviewers: Object.freeze(reviewers),
    runtimeRoot: path.resolve(options.runtimeRoot),
  });
  nativeRoutes.add(route);
  return route;
};

/** Explicit unit-test seam. It cannot establish provider or model identity. */
export const createNativeStyleRouteForTest = (options: NativeStyleRoute) => {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("Synthetic native routes are available only to tests");
  }
  const route = Object.freeze({
    ...options,
    author: Object.freeze(options.author),
    reviewers: Object.freeze(options.reviewers),
  });
  if (
    route.reviewers.length !== 2 ||
    route.reviewers[0].id === route.reviewers[1].id ||
    route.reviewers[0].lineage === route.reviewers[1].lineage ||
    route.reviewers.some(
      (reviewer) => reviewer.lineage === route.author.lineage
    )
  ) {
    throw new Error("Synthetic route still requires independent reviewers");
  }
  nativeRoutes.add(route);
  return route;
};
