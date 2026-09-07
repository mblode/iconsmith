import { SPEC } from "../src/tools/canvas.js";
/** Bounded offline search over declared DSL parameters. Research arm only. */
import { run } from "../src/tools/dsl.js";

export interface ParameterDomain {
  /** Documents why these values are legal; the search never invents values. */
  constraint: "grid" | "radius-tier";
  name: string;
  values: readonly number[];
}

export interface ParameterEvaluation {
  program: string;
  result: ReturnType<typeof run>;
  signal: AbortSignal;
}

export interface ParameterRunContext {
  options?: Parameters<typeof run>[2];
  parts?: Parameters<typeof run>[1];
}

export interface ParameterSearchResult {
  best: { parameters: Record<string, number>; program: string; score: number };
  considered: number;
  evaluated: number;
  failedEvaluations: number;
  improved: boolean;
  invalid: number;
  timedOut: boolean;
}

const placeholder = /\{\{(?<name>[a-z][a-zA-Z0-9]*)\}\}/gu;

const materialise = (
  template: string,
  parameters: Readonly<Record<string, number>>
) =>
  template.replaceAll(placeholder, (...match) => {
    const { name } = match.at(-1) as { name: string };
    const value = parameters[name];
    if (value === undefined) {
      throw new Error(`Missing parameter: ${name}`);
    }
    return String(value);
  });

const domainIsLegal = (
  domain: ParameterDomain,
  spec: NonNullable<Parameters<typeof run>[2]>["spec"]
) => {
  const selected = spec ?? SPEC;
  const legalRadius = new Set([
    0,
    ...selected.radiusTiers,
    ...selected.fillRadiusTiers,
  ]);
  return domain.values.every((value) =>
    domain.constraint === "radius-tier"
      ? legalRadius.has(value)
      : Number.isFinite(value) &&
        value >= 0 &&
        value <= selected.canvas &&
        Math.abs(value / selected.grid - Math.round(value / selected.grid)) <
          1e-9
  );
};

const evaluateBefore = async (
  evaluate: (input: ParameterEvaluation) => number | Promise<number>,
  program: string,
  result: ReturnType<typeof run>,
  deadline: number,
  now: () => number
) => {
  const remaining = deadline - now();
  if (remaining <= 0) {
    return null;
  }
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve(evaluate({ program, result, signal: controller.signal })),
      // This is cooperative cancellation: the signal marks the deadline, but
      // arbitrary evaluator work is not proven quiescent by this Promise race.
      // eslint-disable-next-line promise/avoid-new
      new Promise<null>((resolve) => {
        timer = setTimeout(() => {
          controller.abort();
          resolve(null);
        }, remaining);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
};

const validateBounds = (maxCandidates: number, maxMs: number) => {
  if (
    !Number.isSafeInteger(maxCandidates) ||
    maxCandidates < 1 ||
    !Number.isFinite(maxMs) ||
    maxMs < 1
  ) {
    throw new Error("Parameter search bounds must be positive");
  }
};

/**
 * Enumerates the supplied domains in declaration order. The original is always
 * evaluated first and remains selected unless a valid candidate scores higher.
 * Evaluators must stop their own work when `signal` aborts. Callers that spawn
 * processes need a separate owned-process containment boundary.
 */
export const searchLocalParameters = async (input: {
  domains: readonly ParameterDomain[];
  evaluate: (input: ParameterEvaluation) => number | Promise<number>;
  maxCandidates: number;
  maxMs: number;
  now?: () => number;
  original: Readonly<Record<string, number>>;
  runContext?: ParameterRunContext;
  template: string;
}): Promise<ParameterSearchResult> => {
  validateBounds(input.maxCandidates, input.maxMs);
  if (/^\s*raw\b/mu.test(input.template)) {
    throw new Error("Parameter search cannot use raw geometry");
  }
  const names = [...input.template.matchAll(placeholder)].map(
    (match) => match.groups?.name ?? ""
  );
  const uniqueNames = new Set(names);
  if (
    uniqueNames.size !== input.domains.length ||
    new Set(input.domains.map(({ name }) => name)).size !== input.domains.length
  ) {
    throw new Error("Every template parameter needs exactly one domain");
  }
  for (const domain of input.domains) {
    if (
      !uniqueNames.has(domain.name) ||
      domain.values.length === 0 ||
      new Set(domain.values).size !== domain.values.length
    ) {
      throw new Error(`Invalid parameter domain: ${domain.name}`);
    }
    if (!domain.values.includes(input.original[domain.name])) {
      throw new Error(`Original value is outside domain: ${domain.name}`);
    }
    if (!domainIsLegal(domain, input.runContext?.options?.spec)) {
      throw new Error(
        `Parameter domain is outside ${domain.constraint}: ${domain.name}`
      );
    }
  }

  const now = input.now ?? Date.now;
  const deadline = now() + input.maxMs;
  const originalProgram = materialise(input.template, input.original);
  const parts = input.runContext?.parts ?? [];
  const options = input.runContext?.options ?? {};
  const originalResult = run(originalProgram, parts, options);
  if (originalResult.errors.length > 0) {
    throw new Error("Original parameter program is invalid");
  }
  const originalScore = await evaluateBefore(
    input.evaluate,
    originalProgram,
    originalResult,
    deadline,
    now
  );
  if (originalScore === null || !Number.isFinite(originalScore)) {
    throw new Error("Original parameter evaluation did not complete");
  }
  let best = {
    parameters: { ...input.original },
    program: originalProgram,
    score: originalScore,
  };
  let evaluated = 1;
  let failedEvaluations = 0;
  let considered = 1;
  let invalid = 0;
  let timedOut = false;

  const visit = async (index: number, values: Record<string, number>) => {
    if (considered >= input.maxCandidates || timedOut) {
      return;
    }
    if (now() >= deadline) {
      timedOut = true;
      return;
    }
    if (index < input.domains.length) {
      const domain = input.domains[index];
      for (const value of domain.values) {
        if (considered >= input.maxCandidates || timedOut) {
          break;
        }
        // Deterministic sequential evaluation is part of the research contract.
        // eslint-disable-next-line no-await-in-loop
        await visit(index + 1, { ...values, [domain.name]: value });
      }
      return;
    }
    if (
      input.domains.every(({ name }) => values[name] === input.original[name])
    ) {
      return;
    }
    considered += 1;
    const program = materialise(input.template, values);
    const result = run(program, parts, options);
    if (result.errors.length > 0) {
      invalid += 1;
      return;
    }
    const score = await evaluateBefore(
      input.evaluate,
      program,
      result,
      deadline,
      now
    );
    if (score === null) {
      failedEvaluations += 1;
      timedOut = true;
      return;
    }
    if (!Number.isFinite(score)) {
      failedEvaluations += 1;
      return;
    }
    evaluated += 1;
    if (score > best.score) {
      best = { parameters: { ...values }, program, score };
    }
  };
  await visit(0, {});
  return {
    best,
    considered,
    evaluated,
    failedEvaluations,
    improved: best.program !== originalProgram,
    invalid,
    timedOut,
  };
};
