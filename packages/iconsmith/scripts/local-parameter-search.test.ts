import { expect, test } from "vitest";

import { specAt } from "../src/tools/canvas.js";
import type { Part } from "../src/types.js";
import { searchLocalParameters } from "./local-parameter-search.js";

const template = `icon parameter-search
finish filled
rect {{x}},3 {{width}}x18 r2`;

test("enumerates declared domains deterministically and retains the best valid candidate", async () => {
  const seen: string[] = [];
  const result = await searchLocalParameters({
    domains: [
      { constraint: "grid", name: "x", values: [3, 4] },
      { constraint: "grid", name: "width", values: [16, 18] },
    ],
    evaluate: ({ program }) => {
      seen.push(program);
      return program.includes("4,3 18x18") ? 2 : 1;
    },
    maxCandidates: 4,
    maxMs: 1000,
    original: { width: 16, x: 3 },
    template,
  });
  expect(result).toMatchObject({
    considered: 4,
    evaluated: 4,
    failedEvaluations: 0,
    improved: true,
    timedOut: false,
  });
  expect(result.best.parameters).toEqual({ width: 18, x: 4 });
  expect(seen[0]).toContain("3,3 16x18");
});

test("preserves the original when variants are invalid or make no progress", async () => {
  const result = await searchLocalParameters({
    domains: [
      { constraint: "grid", name: "x", values: [3] },
      { constraint: "grid", name: "width", values: [16, 0] },
    ],
    evaluate: () => 1,
    maxCandidates: 3,
    maxMs: 1000,
    original: { width: 16, x: 3 },
    template,
  });
  expect(result.improved).toBe(false);
  expect(result.best.parameters).toEqual({ width: 16, x: 3 });
});

test("honours candidate and deadline bounds and aborts a slow evaluator", async () => {
  const promise = searchLocalParameters({
    domains: [{ constraint: "grid", name: "x", values: [3, 4] }],
    evaluate: ({ signal }) => {
      if (signal.aborted) {
        return -1;
      }
      // The never-settling evaluator exercises host cancellation.
      // eslint-disable-next-line promise/avoid-new
      return new Promise<number>(() => {
        // Deliberately never settles; the host deadline owns cancellation.
      });
    },
    maxCandidates: 2,
    maxMs: 10,
    original: { x: 3 },
    template: "icon timeout\nfinish filled\ncircle {{x}},12 r3",
  });
  await expect(promise).rejects.toThrow("did not complete");
});

test("counts a cooperatively aborted candidate evaluation as failed", async () => {
  let calls = 0;
  let candidateSignal: AbortSignal | undefined;
  const result = await searchLocalParameters({
    domains: [{ constraint: "grid", name: "x", values: [3, 4] }],
    evaluate: ({ signal }) => {
      calls += 1;
      if (calls === 1) {
        return 1;
      }
      candidateSignal = signal;
      // eslint-disable-next-line promise/avoid-new
      return new Promise<number>(() => {
        // The search signals cancellation but cannot prove evaluator quiescence.
      });
    },
    maxCandidates: 2,
    maxMs: 10,
    original: { x: 3 },
    template: "icon timeout-candidate\nfinish filled\ncircle {{x}},12 r3",
  });
  expect(candidateSignal?.aborted).toBe(true);
  expect(result).toMatchObject({
    considered: 2,
    evaluated: 1,
    failedEvaluations: 1,
    improved: false,
    timedOut: true,
  });
});

test("rejects undeclared parameters, out-of-domain originals, and raw geometry", async () => {
  const base = {
    domains: [{ constraint: "grid" as const, name: "x", values: [3] }],
    evaluate: () => 1,
    maxCandidates: 1,
    maxMs: 100,
    original: { x: 3 },
    template: "icon safe\nfinish filled\ncircle {{x}},12 r3",
  };
  await expect(
    searchLocalParameters({
      ...base,
      template: `${base.template}\nrect {{y}},2 2x2`,
    })
  ).rejects.toThrow("exactly one domain");
  await expect(
    searchLocalParameters({ ...base, original: { x: 4 } })
  ).rejects.toThrow("outside domain");
  await expect(
    searchLocalParameters({
      ...base,
      domains: [{ constraint: "radius-tier", name: "x", values: [0.75] }],
      original: { x: 0.75 },
    })
  ).rejects.toThrow("outside radius-tier");
  await expect(
    searchLocalParameters({ ...base, template: "raw M0 0H2V2Z\n{{x}}" })
  ).rejects.toThrow("raw geometry");
});

test("validates and evaluates with pinned parts and the selected optical spec", async () => {
  const part: Part = {
    closed: true,
    d: "M0 0H4V4H0Z",
    h: 4,
    icons: ["source"],
    id: "pinned-body",
    instances: 1,
    name: "pinned-body",
    nodes: 4,
    sizeRange: [4, 4],
    w: 4,
  };
  const seenSizes: number[] = [];
  const result = await searchLocalParameters({
    domains: [{ constraint: "radius-tier", name: "radius", values: [1, 2] }],
    evaluate: ({ program, result: compiled }) => {
      seenSizes.push(compiled.canvas.spec.size);
      return program.endsWith("r2") ? 2 : 1;
    },
    maxCandidates: 2,
    maxMs: 1000,
    original: { radius: 1 },
    runContext: { options: { spec: specAt({ size: 16 }) }, parts: [part] },
    template:
      "icon pinned\nfinish filled\npart pinned-body at 4,4\nrect 8,8 4x4 r{{radius}}",
  });
  expect(result.best.parameters).toEqual({ radius: 2 });
  expect(seenSizes).toEqual([16, 16]);

  await expect(
    searchLocalParameters({
      domains: [
        { constraint: "radius-tier", name: "radius", values: [0.5, 1] },
      ],
      evaluate: () => 1,
      maxCandidates: 2,
      maxMs: 1000,
      original: { radius: 1 },
      runContext: { options: { spec: specAt({ size: 16 }) }, parts: [part] },
      template:
        "icon pinned\nfinish filled\npart pinned-body at 4,4\nrect 8,8 4x4 r{{radius}}",
    })
  ).rejects.toThrow("outside radius-tier");
});

test("rejects unbounded budgets and duplicate domain names before evaluation", async () => {
  let evaluations = 0;
  const base = {
    domains: [
      { constraint: "grid" as const, name: "x", values: [3] },
      { constraint: "grid" as const, name: "width", values: [16] },
    ],
    evaluate: () => {
      evaluations += 1;
      return 1;
    },
    maxCandidates: 2,
    maxMs: 1000,
    original: { width: 16, x: 3 },
    template,
  };
  await Promise.all([
    ...[Number.NaN, Infinity, 1.5].map((maxCandidates) =>
      expect(searchLocalParameters({ ...base, maxCandidates })).rejects.toThrow(
        "bounds"
      )
    ),
    ...[Number.NaN, Infinity].map((maxMs) =>
      expect(searchLocalParameters({ ...base, maxMs })).rejects.toThrow(
        "bounds"
      )
    ),
  ]);
  await expect(
    searchLocalParameters({
      ...base,
      domains: [base.domains[0], base.domains[0]],
    })
  ).rejects.toThrow("exactly one domain");
  await expect(
    searchLocalParameters({
      ...base,
      domains: [
        { constraint: "grid", name: "x", values: [3, 3] },
        base.domains[1],
      ],
    })
  ).rejects.toThrow("Invalid parameter domain: x");
  expect(evaluations).toBe(0);
});

test("classifies non-finite candidate scores without replacing the original", async () => {
  const result = await searchLocalParameters({
    domains: [{ constraint: "grid", name: "x", values: [3, 4, 5] }],
    evaluate: ({ program }) =>
      program.includes("circle 3,12") ? 10 : Number.NaN,
    maxCandidates: 3,
    maxMs: 1000,
    original: { x: 3 },
    template: "icon scores\nfinish filled\ncircle {{x}},12 r3",
  });
  expect(result).toMatchObject({
    considered: 3,
    evaluated: 1,
    failedEvaluations: 2,
    improved: false,
    invalid: 0,
    timedOut: false,
  });
  expect(result.best.parameters).toEqual({ x: 3 });
});

test("stops before compiling invalid candidates after the deadline", async () => {
  let time = 0;
  const result = await searchLocalParameters({
    domains: [
      { constraint: "grid", name: "x", values: [3] },
      { constraint: "grid", name: "width", values: [16, 0] },
    ],
    evaluate: () => {
      time = 100;
      return 1;
    },
    maxCandidates: 10,
    maxMs: 100,
    now: () => time,
    original: { width: 16, x: 3 },
    template,
  });
  expect(result).toMatchObject({
    considered: 1,
    evaluated: 1,
    failedEvaluations: 0,
    improved: false,
    invalid: 0,
    timedOut: true,
  });
});
