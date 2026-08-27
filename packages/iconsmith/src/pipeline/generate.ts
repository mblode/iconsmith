/**
 * The loop.
 *
 * A concept goes in; a drawn, linted `IconDoc` comes out. A known family
 * is the host analog — the model never sees that canvas, because it
 * cannot invent geometry the analog already placed. Unknown names hire
 * the model: it works by calling primitives and looking at renders of
 * what it has made, which is the only part of this that resembles how
 * the icons were drawn by hand. Nothing it emits reaches the document
 * without passing through `Canvas`, so a bad turn costs a step, never a
 * spec violation.
 */
import { readFileSync } from "node:fs";

import { generateText, stepCountIs } from "ai";
import type { LanguageModel, ModelMessage, StopCondition, ToolSet } from "ai";

import type { Canvas, Spec } from "../tools/canvas.js";
import { lint } from "../tools/lint.js";
import { programFromDoc } from "../tools/twin.js";
import type { Finish, IconDoc, Issue, Keyline, Part } from "../types.js";
import { adoptHost, hostConstruction } from "./analog.js";
import type { AuditAsk, AuditResult } from "./audit.js";
import type { Proposal } from "./compose.js";
import type { ApiCost, TokenUsage } from "./cost.js";
import { tokenUsageOf } from "./cost.js";
import { gatewayCostTracker, resolveModel } from "./gateway.js";
import type { DrawKind, MarkTwin } from "./kind.js";
import type { Reference } from "./licence.js";
import { pairAdapted, pairFamily } from "./pair.js";
import type { Policy } from "./policy.js";
import { conceptPrompt, systemPrompt } from "./prompt.js";
import type { CohortBrief, Concept } from "./prompt.js";
import type { Aliases, PartHint } from "./search.js";
import type { SelectKind } from "./select.js";
import { createTools } from "./tools.js";
import type { ToolState } from "./tools.js";

export {
  DEFAULT_MODEL,
  DEFAULT_OPENROUTER_MODEL,
  MissingApiKeyError,
  OPENROUTER_INKLING,
  gatewayModelId,
  openrouterModelId,
  resolveModel,
  usesOpenRouter,
} from "./gateway.js";

export type { Concept } from "./prompt.js";
export type { Reference } from "./licence.js";

/**
 * Anthropic bills a cached prefix read at a tenth of a fresh read. This loop is
 * an extreme case for that: the tool schemas and system prompt are re-sent on
 * every step, and each `render` or `compare` call parks a PNG in the history
 * that every later step carries. Measured on one uncached `git-fork` run: 20
 * steps, 134,734 input tokens against 2,364 output.
 *
 * Two breakpoints, which is well inside Anthropic's limit of four. The first
 * sits on the opening user message, so the tools and system prompt behind it
 * are written once and read back on every subsequent step. The second rolls to
 * the newest message each step, so the turns already taken -- images included
 * -- are read from cache rather than re-billed.
 */
const EPHEMERAL = {
  anthropic: { cacheControl: { type: "ephemeral" } },
} as const;

export const withCacheBreakpoints = (
  messages: ModelMessage[]
): ModelMessage[] => {
  if (messages.length === 0) {
    return messages;
  }
  const marked = messages.map((m) => ({ ...m }) as ModelMessage);
  const last = marked.length - 1;
  for (const i of new Set([0, last])) {
    marked[i] = {
      ...marked[i],
      providerOptions: { ...marked[i].providerOptions, ...EPHEMERAL },
    } as ModelMessage;
  }
  return marked;
};

/** Enough turns for a search, a dozen primitives, three looks and a fix. Past
 *  this the model is polishing, and polishing is where it drifts. */
export const DEFAULT_MAX_STEPS = 24;
/** Budgeted runs must bound the cost of the one response that can cross the
 * observed-dollar threshold. This is deliberately lower than the SDK's model
 * default while leaving enough room for a primitive call and a short reason. */
export const BUDGETED_MAX_OUTPUT_TOKENS = 4096;

const throwIfAborted = (signal?: AbortSignal): void => {
  signal?.throwIfAborted();
};

/** Who draws a name the house has no file for. See `GenerateOptions.unkeyed`. */
export type Unkeyed =
  | "agent"
  | "analog"
  | "glyph"
  | "harness"
  | "mixture"
  | "program";

export interface GenerateOptions {
  /** Cancels an in-flight model call when the owning turn is stopped. */
  abortSignal?: AbortSignal;
  /**
   * The design language to draw under. A variant is how an experiment is run:
   * build it from `DEFAULT_POLICY`, pass it here, and the only difference
   * between two arms is the prose the model was given.
   */
  policy?: Policy;

  /**
   * The words each source icon also answers to, from `corpus/aliases.ts`.
   *
   * Passed through to `createTools`, so `listParts` and SELECT's shortlist
   * search the same widened surface — the property `search.ts` exists to
   * protect. Empty by default; `commands/` loads the table.
   */
  aliases?: Aliases;

  apiKey?: string;
  /**
   * The family this icon joins, when the caller has measured one.
   *
   * One option, two effects, deliberately: it writes the `COHORT` block into
   * the prompt *and* puts the `cohort` op in the tool set. They were separable
   * until now, and the separation was a bug — the prompt described an op the
   * model had no way to call.
   */
  cohort?: CohortBrief | null;
  /** Existing icons the model can hold the draft up against. Licensed, because
   *  they reach the model: see `ToolsOptions.corpus`. */
  corpus?: Reference[];
  /**
   * A SELECT shortlist already chosen by the caller. When set, the harness arm
   * puts these hints in the brief instead of searching. The built-in loop
   * ignores it — it has `listParts`. Undefined means "search"; an empty array
   * is a real island (no suggested marks).
   */
  hints?: PartHint[];
  keyline?: Keyline | null;
  maxSteps?: number;
  /** Stop after the first completed model call that reaches this observed
   * Gateway spend. A single in-flight call can cross the threshold. Unpriced
   * calls stop immediately after their first response rather than run blind. */
  maxUsd?: number;
  /**
   * A model instance, or a provider model id (`anthropic/claude-opus-5`,
   * `thinkingmachines/inkling:free`). A bare id is namespaced as Anthropic
   * and sent to the gateway. An OpenRouter slug (`openrouter/…`, a `:free`
   * variant, or `thinkingmachines/…` when `OPENROUTER_API_KEY` is set) is
   * the other generate arm. Passing an instance is how tests run this loop
   * with no network.
   */
  model?: LanguageModel;
  parts?: Part[];
  /**
   * Which SELECT policy built `hints` when the caller did not pass them.
   * Default `auto` — slug then tag fallback, the current hill — so existing
   * arms do not change. N=5 demo passes an island kind instead.
   */
  select?: SelectKind;
  /**
   * House path `d` strings to compile onto the vocabulary.
   *
   * Keyed reconstruction: `compileArm` / `ROUTES.compile` match each subpath
   * to a part and place it. The compiler emits the placement; the model never
   * does. Undefined means the run is not keyed.
   */
  targetPaths?: readonly string[];
  /**
   * A Central kin of an unkeyed name, for analog replay. `analogOf` is the
   * house slug (`cookies` when drawing `cookie`); `analogPaths` are that
   * file's `d` strings. The compiler places them; the model never does.
   * Third-party packs do not belong here.
   */
  analogOf?: string;
  analogPaths?: readonly string[];
  /**
   * A composition read out of a raster proposal by `compose.ts`.
   *
   * Words only — element count, coarse cells, size bands, adjacency, part ids,
   * a blurred thumbnail. There is no shape this option could take that carries
   * geometry, which is why the raster arm needs no new escape in the canvas.
   */
  proposal?: Proposal | null;
  renderSize?: number;
  /**
   * Host look. When set, DRAW may screenshot and (for marks) apply one catalog
   * repair. Agent routes record the look at CHECK; the harness arm still
   * re-spawns once on a decide fail.
   */
  ask?: AuditAsk;
  lookKind?: DrawKind;
  lookReferences?: readonly Buffer[];
  lookTwin?: MarkTwin;
  /**
   * Skip host DRAW (compile / mark / splice / analog) and hire the
   * tool-calling loop. `iconsmith new --agent`. This flag also redraws a
   * house file. The product default for an unkeyed name is `mixture`.
   */
  forceAgent?: boolean;
  /**
   * What to do with an unkeyed name. Default `analog` keeps labs and tests on
   * the host constructions. `iconsmith new` defaults to `mixture` — cheap
   * host arms first, gateway / OpenRouter only if they fail. `harness` is
   * a coding-agent CLI. `glyph` asks for a host construction from
   * `glyphs.ts`, for the handful of names that have one — it has to be
   * asked for, so that a caller who wanted a generator never quietly gets
   * the house answer instead. `--agent` is `forceAgent` and redraws a
   * house file too.
   */
  unkeyed?: Unkeyed;
  /** CLI for `unkeyed: "harness"`. Default `claude`. */
  harnessCommand?: string;
  /**
   * Which paint to draw. Keyed compile uses this to pick the house file and
   * stamp `finish` — a filled house file is compiled as filled, not adapted
   * from the outline. Analog families write each paint; generate draws one
   * and pairs the other via `adaptProgram`. Default outlined.
   */
  finish?: Finish;
  /**
   * Stroke, family radius, optical size. Defaults to the house 24px / stroke 2
   * / radius 3 cut. 16px drops hairline corners and terminal dots.
   */
  spec?: Spec;
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
  /**
   * The SDK's own reason, and it does not distinguish this loop's exits: a step
   * that made tool calls reports `tool-calls` whether the run then hit the step
   * cap or one of our stop conditions fired (`ai` exits its do/while on the
   * stop condition *after* such a step, and reports the last step's reason).
   * `outcome` is the field that says which. `length` here means a step ran out
   * of output tokens, which is a different problem again.
   */
  finishReason: string;
  /** Which of the four terminal states the loop ended in. `budget` or `stalled`
   *  across a whole benchmark means the scores are measuring the cap, not the
   *  model. */
  outcome: Outcome;
  /** Wall time for the whole loop, milliseconds. Not CPU: most of it is the
   *  network, which is what an operator waiting on a run is paying for. */
  ms: number;
  /** Tool calls by name, so "it spent 18 steps" can be read as "it rendered
   *  nine times and drew twice". */
  toolCalls: Record<string, number>;
  usage: TokenUsage;
}

export interface GenerateResult {
  /** Individually billed model operations used to produce this drawing. */
  apiCosts?: ApiCost[];
  /** No lint errors. Warnings do not block. */
  clean: boolean;
  /** Tokens, wall time, tool-call mix and stop reason. Absent when the
   *  generator is a stub. */
  cost?: GenerateCost;
  /** The brief the agent was given. Present on the harness arm so a demo can
   *  keep it after scratch is deleted. */
  brief?: string;
  doc: IconDoc;
  issues: Issue[];
  /** Combined stdout/stderr of an external agent. Absent on the built-in loop,
   *  whose thinking is `trace`. */
  log?: string;
  /** The `.icon` source, when the generator is a program rather than a canvas. */
  program?: string;
  /** Local house parts parked by compile, so a viewer can replay `part slug-0`. */
  extras?: Part[];
  /** Host look at the drawing, when the harness ran with an `ask`. */
  audit?: AuditResult;
  /** The model's closing sentence about what it drew. */
  text: string;
  /** Tool calls made, in order — the trace of how the icon was arrived at. */
  trace: string[];
  steps: number;
  svg: string;
}

/** Read a `parts.json` written by `writeParts`. */
export const loadParts = (file: string): Part[] => {
  const data = JSON.parse(readFileSync(file, "utf-8")) as { parts?: Part[] };
  return data.parts ?? [];
};

/** How many consecutive steps may add nothing before the loop calls it done.
 *  Two, not one: a render and a lint over an unchanged drawing are the normal
 *  way a model confirms it has finished, and neither draws. */
const IDLE_LIMIT = 2;

/** Why the loop stopped. Four states, because "it ended" has been standing in
 *  for four different things, three of which are not success. */
export type Outcome =
  /** The step cap cut a run off mid-work. It leaves a drawing with no errors
   *  in it, but one nothing confirmed. */
  | "budget"
  /** The model rendered the current drawing, linted the current drawing, and
   *  the lint was clean. The only outcome that is a claim about quality. */
  | "clean"
  /** The model stopped adding: {@link IDLE_LIMIT} consecutive steps left the
   *  canvas unchanged, or it closed with a sentence rather than a tool call.
   *  The composition is as finished as this model is going to make it. */
  | "converged"
  /** Ended with nothing usable: an empty canvas, or errors still standing in
   *  the closing lint. */
  | "stalled";

/** Written by the stop conditions, read once the loop has ended. A condition
 *  cannot report *which* condition fired — the SDK's `finishReason` is
 *  `tool-calls` either way — so it records that itself. */
interface Termination {
  clean: boolean;
  converged: boolean;
  /** Consecutive steps over an unchanged canvas. */
  idle: number;
  /** Canvas version as of the previous step. */
  version: number;
}

/**
 * Stop as soon as the model has looked at *this* drawing and linted *this*
 * drawing clean.
 *
 * The render half is not redundant. Lint checks the spec, not the drawing: a
 * centred rectangle of the right size lints perfectly and is not an icon of
 * anything. Requiring that the model has seen its own work is the cheapest
 * available proxy for "it checked".
 *
 * Both halves are versioned against the canvas, which is the whole fix. Read as
 * flags — "it rendered at some point, and the last lint call found nothing" —
 * the condition fires on a model that renders, lints clean, and then redraws
 * the icon: it ends the run on a drawing nobody has looked at. Measured on
 * eight runs, seven ended here early.
 */
const drawnAndClean =
  <T extends ToolSet>(
    canvas: Canvas,
    state: ToolState,
    end: Termination
  ): StopCondition<T> =>
  () => {
    const v = canvas.version;
    const done =
      state.renderedAt === v &&
      state.lintedAt === v &&
      state.issues !== null &&
      state.issues.every((i) => i.severity !== "error");
    if (done) {
      end.clean = true;
    }
    return done;
  };

/**
 * Stop when the model has stopped adding anything.
 *
 * Waiting for a positive "clean" signal means a model that is finished but will
 * not say so burns the rest of the budget polishing, which is where drift comes
 * from. Terminating on the absence of change is the published alternative
 * (Render-in-the-Loop, arXiv:2604.20730, ends a composition after K steps whose
 * canvas delta is below eps; Semantic Early-Stopping, arXiv:2606.27009, reports
 * a judge-free cutoff at quality parity), and the canvas version is that delta
 * signal for free — nothing needs re-rasterising to ask whether anything moved.
 *
 * Two guards keep it from cutting off work in progress. An empty canvas is not
 * a converged one, and neither is a drawing whose own last lint reported errors
 * the model has not fixed yet; both run on to the budget and report `stalled`.
 */
const noProgress =
  <T extends ToolSet>(
    canvas: Canvas,
    state: ToolState,
    end: Termination
  ): StopCondition<T> =>
  () => {
    const v = canvas.version;
    if (v === end.version) {
      end.idle += 1;
    } else {
      end.version = v;
      end.idle = 0;
    }
    const outstanding =
      state.lintedAt === v &&
      (state.issues?.some((i) => i.severity === "error") ?? false);
    const done =
      end.idle >= IDLE_LIMIT && canvas.elements.length > 0 && !outstanding;
    if (done) {
      end.converged = true;
    }
    return done;
  };

/**
 * Name the outcome from what the stop conditions recorded, what the closing
 * lint found, and how the SDK's own loop ended.
 *
 * Order is the argument. `clean` is the only outcome that is a claim about the
 * icon, so it is asked first. Then the drawing itself: an empty canvas or a
 * standing error is `stalled` however the run ended, because a run cannot
 * converge on nothing. Convergence covers both ways of adding nothing further
 * — the idle detector, and the model closing with a sentence instead of a tool
 * call, which is the same statement made explicitly. What is left is `budget`:
 * the run was still working when the cap cut it off.
 */
const outcomeOf = (
  end: Termination,
  finishReason: string,
  elements: number,
  issues: Issue[]
): Outcome => {
  if (end.clean) {
    return "clean";
  }
  if (elements === 0 || issues.some((i) => i.severity === "error")) {
    return "stalled";
  }
  if (end.converged || finishReason === "stop") {
    return "converged";
  }
  return "budget";
};

const programOf = (
  name: string,
  finish: Finish,
  doc: IconDoc,
  useHost: boolean
): string =>
  (useHost ? hostConstruction(name, finish)?.source : undefined) ??
  programFromDoc(doc);

const pairGenerate = (
  issues: readonly Issue[],
  name: string,
  finish: Finish,
  program: string,
  parts: readonly Part[],
  spec: Spec | undefined,
  useHost: boolean
): Issue[] => {
  const other = useHost
    ? hostConstruction(name, finish === "filled" ? "outlined" : "filled")
    : null;
  if (other !== null) {
    return pairFamily(
      issues,
      finish,
      program,
      other.source,
      other.id,
      parts,
      spec
    );
  }
  return pairAdapted(issues, finish, program, parts, spec);
};

const seedHost = (
  canvas: Canvas,
  state: ToolState,
  name: string,
  finish: Finish,
  parts: readonly Part[],
  spec?: Spec
): void => {
  if (hostConstruction(name, finish) === null) {
    return;
  }
  adoptHost(canvas, name, finish, parts, spec);
  state.constructed = true;
};

/**
 * Deliver the best drawing the run looked at, not wherever the step cap landed.
 *
 * The loop ends on whichever step exhausted the budget, and the campaign's
 * traces show what that costs: two paints ended `render, remove, remove,
 * remove, remove` — the model wiping a composition to start over — and the
 * blank canvas was delivered, independently audited at SC 0 / PQ 0, and
 * billed. A wipe the run never finished is not the model's answer.
 *
 * Restoring is the same move `adoptHost` makes: clear, then push the elements
 * back. Only two cases take the snapshot — an empty canvas, and a canvas
 * carrying more standing errors than the snapshot did — so a run that ended on
 * work in progress keeps it.
 */
const restoreBest = (
  canvas: Canvas,
  state: ToolState,
  keyline: Keyline | null
): void => {
  const { best } = state;
  if (!best) {
    return;
  }
  const errors = lint(canvas, { keyline }).filter(
    (issue) => issue.severity === "error"
  ).length;
  if (canvas.elements.length > 0 && errors <= best.errors) {
    return;
  }
  canvas.clear();
  canvas.elements.push(...best.elements.map((el) => structuredClone(el)));
};

const ZERO_USAGE = {
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  inputTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
} as const;

const resultOf = (
  canvas: Canvas,
  concept: Concept,
  finish: Finish,
  parts: readonly Part[],
  spec: Spec | undefined,
  keyline: Keyline | null,
  extras: {
    apiCosts?: ApiCost[];
    finishReason: string;
    ms: number;
    outcome: (issues: Issue[]) => Outcome;
    steps: number;
    text: string;
    toolCalls: Record<string, number>;
    trace: string[];
    usage: GenerateCost["usage"];
    useHost: boolean;
  }
): GenerateResult => {
  const doc = canvas.toJSON({ icon: concept.name, keyline });
  // A seeded host already has a program. `programFromDoc` drops filled
  // diagonal bars (`raw`), so pairing a paper-plane fill looked empty
  // even though the canvas held the analog. Pair the two analog paints,
  // not an adapt of the lossy round-trip.
  const program = programOf(concept.name, finish, doc, extras.useHost);
  const issues = pairGenerate(
    lint(canvas, { keyline }),
    concept.name,
    finish,
    program,
    parts,
    spec,
    extras.useHost
  );
  return {
    apiCosts: extras.apiCosts,
    clean: issues.every((i) => i.severity !== "error"),
    cost: {
      finishReason: extras.finishReason,
      ms: extras.ms,
      outcome: extras.outcome(issues),
      toolCalls: extras.toolCalls,
      usage: extras.usage,
    },
    doc,
    issues,
    program,
    steps: extras.steps,
    svg: canvas.toSVG(),
    text: extras.text,
    trace: extras.trace,
  };
};

const fromHost = (
  canvas: Canvas,
  concept: Concept,
  finish: Finish,
  parts: readonly Part[],
  spec: Spec | undefined,
  keyline: Keyline | null,
  host: { id: string },
  startedAt: number
): GenerateResult =>
  resultOf(canvas, concept, finish, parts, spec, keyline, {
    finishReason: "stop",
    ms: Date.now() - startedAt,
    outcome: (issues) =>
      issues.every((i) => i.severity !== "error") ? "clean" : "stalled",
    steps: 0,
    text: `host ${host.id} ${concept.name}`,
    toolCalls: {},
    trace: [],
    usage: { ...ZERO_USAGE },
    useHost: true,
  });

const fromModel = async (
  canvas: Canvas,
  concept: Concept,
  finish: Finish,
  parts: readonly Part[],
  spec: Spec | undefined,
  keyline: Keyline | null,
  state: ToolState,
  opts: {
    abortSignal: GenerateOptions["abortSignal"];
    apiKey?: string;
    cohort: GenerateOptions["cohort"];
    forceAgent: boolean;
    maxSteps: number;
    maxUsd: number | undefined;
    model: GenerateOptions["model"];
    policy: GenerateOptions["policy"];
    proposal: GenerateOptions["proposal"];
    startedAt: number;
    tools: ReturnType<typeof createTools>["tools"];
  }
): Promise<GenerateResult> => {
  const resolved = resolveModel(opts.model, opts.apiKey);
  const costTracker = gatewayCostTracker(opts.apiKey);
  let modelId: string;
  if (typeof opts.model === "string") {
    modelId = opts.model;
  } else if (typeof resolved === "string") {
    modelId = resolved;
  } else {
    ({ modelId } = resolved);
  }
  const end: Termination = {
    clean: false,
    converged: false,
    idle: 0,
    version: canvas.version,
  };
  const result = await generateText({
    abortSignal: opts.abortSignal,
    maxOutputTokens:
      opts.maxUsd === undefined ? undefined : BUDGETED_MAX_OUTPUT_TOKENS,
    maxRetries: opts.maxUsd === undefined ? undefined : 0,
    model: resolved,
    onLanguageModelCallEnd: costTracker.capture,
    prepareStep: ({ messages: stepMessages }) => ({
      messages: withCacheBreakpoints(stepMessages),
    }),
    prompt: conceptPrompt(concept, finish),
    stopWhen: [
      stepCountIs(opts.maxSteps),
      () => {
        if (opts.maxUsd === undefined) {
          return false;
        }
        const observed = costTracker.observed(modelId);
        return (
          observed.calls > 0 &&
          (observed.usd === null || observed.usd >= opts.maxUsd)
        );
      },
      drawnAndClean(canvas, state, end),
      noProgress(canvas, state, end),
    ],
    system: systemPrompt({
      cohort: opts.cohort,
      finish,
      keyline,
      policy: opts.policy,
      proposal: opts.proposal !== null,
      spec,
    }),
    tools: opts.tools,
  });
  const usage = result.totalUsage;
  const measuredUsage = tokenUsageOf(usage);
  const apiCost = await costTracker.measure({
    calls: result.steps.length,
    model: modelId,
    operation: "icon-generation",
    usage: measuredUsage,
  });
  const toolCalls: Record<string, number> = {};
  for (const name of state.calls) {
    toolCalls[name] = (toolCalls[name] ?? 0) + 1;
  }
  restoreBest(canvas, state, keyline);
  return resultOf(canvas, concept, finish, parts, spec, keyline, {
    apiCosts: [apiCost],
    // `totalUsage` is the sum across every step, which is the number that gets
    // billed; `usage` alone would report the last step only. Each field is
    // `number | undefined` — a provider that does not break out cache reads
    // leaves them undefined, and 0 is the honest reading of "this provider
    // reported none".
    finishReason: result.finishReason,
    ms: Date.now() - opts.startedAt,
    outcome: (issues) =>
      outcomeOf(end, result.finishReason, canvas.elements.length, issues),
    steps: result.steps.length,
    text: result.text,
    toolCalls,
    trace: state.calls,
    usage: measuredUsage,
    useHost: !opts.forceAgent,
  });
};

export const generate = async (
  concept: Concept,
  options: GenerateOptions = {}
): Promise<GenerateResult> => {
  const {
    abortSignal,
    aliases = new Map(),
    apiKey,
    cohort = null,
    corpus = [],
    finish = "outlined",
    keyline = null,
    maxSteps = DEFAULT_MAX_STEPS,
    maxUsd,
    model,
    parts = [],
    policy,
    proposal = null,
    renderSize,
    spec,
  } = options;

  throwIfAborted(abortSignal);

  if (!Number.isInteger(maxSteps) || maxSteps < 1) {
    throw new RangeError("maxSteps must be a positive integer");
  }
  if (maxUsd !== undefined && (!Number.isFinite(maxUsd) || maxUsd <= 0)) {
    throw new RangeError("maxUsd must be a finite positive number");
  }

  // `forceAgent` is an explicit request for a fresh drawing. It used to be
  // consumed by `reach()` and then lost here, so a known host construction
  // (home, heart, lock…) still short-circuited before the model ran. That made
  // an agent tournament compare the same host drawing under several labels.
  const host = options.forceAgent
    ? null
    : hostConstruction(concept.name, finish);
  const hostLocked = host !== null;
  const { canvas, state, tools } = createTools({
    aliases,
    cohort: cohort?.extent ?? null,
    corpus,
    finish,
    hostLocked,
    keyline,
    maxPartSearches: 2,
    parts,
    proposal,
    renderSize,
    spec,
  });
  if (host !== null) {
    seedHost(canvas, state, concept.name, finish, parts, spec);
  }

  const startedAt = Date.now();
  // A known family is already the house analog. Hiring a model to call
  // `confirm` on a canvas it cannot edit only burns tokens — and when
  // the prompt-token cap is exhausted, it fails a drawing that was
  // already done. Return the host. The model path stays for unknowns.
  if (host !== null) {
    return fromHost(
      canvas,
      concept,
      finish,
      parts,
      spec,
      keyline,
      host,
      startedAt
    );
  }

  return await fromModel(canvas, concept, finish, parts, spec, keyline, state, {
    abortSignal,
    apiKey,
    cohort,
    forceAgent: options.forceAgent === true,
    maxSteps,
    maxUsd,
    model,
    policy,
    proposal,
    startedAt,
    tools,
  });
};
