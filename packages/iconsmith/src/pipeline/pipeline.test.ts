import type {
  LanguageModelV4CallOptions,
  LanguageModelV4GenerateResult,
} from "@ai-sdk/provider";
import { MockLanguageModelV4 } from "ai/test";
/**
 * The pipeline, exercised without a network.
 *
 * A model is a function from a conversation to tool calls, so a scripted one is
 * enough to test everything around it: the tool wrappers, the stop conditions,
 * the document that falls out, and the whole eval. What these tests cannot
 * check is whether the real model draws a good folder — which is what the eval
 * itself is for.
 */
import { describe, expect, it } from "vitest";

import type { BenchmarkEntry } from "./bench.js";
import { BASELINE, evaluate, formatReport, median, scored } from "./eval.js";
import type { EvalIcon } from "./eval.js";
import {
  DEFAULT_MODEL,
  MissingApiKeyError,
  generate,
  resolveModel,
} from "./generate.js";
import { createTools } from "./tools.js";

const USAGE = {
  inputTokens: { cacheRead: 0, cacheWrite: 0, noCache: 1, total: 1 },
  outputTokens: { reasoning: 0, text: 1, total: 1 },
};

type Turn = { input: unknown; tool: string } | { text: string };

/** A model that plays a fixed sequence of turns, then stops. */
const scripted = (turns: Turn[]): MockLanguageModelV4 => {
  let n = 0;
  return new MockLanguageModelV4({
    doGenerate: (): LanguageModelV4GenerateResult => {
      const turn = turns[Math.min(n, turns.length - 1)];
      n += 1;
      if ("text" in turn) {
        return {
          content: [{ text: turn.text, type: "text" }],
          finishReason: "stop",
          usage: USAGE,
          warnings: [],
        };
      }
      return {
        content: [
          {
            input: JSON.stringify(turn.input),
            toolCallId: `call-${n}`,
            toolName: turn.tool,
            type: "tool-call",
          },
        ],
        finishReason: "tool-calls",
        usage: USAGE,
        warnings: [],
      };
    },
  });
};

const square = { h: 18, r: 2, w: 18, x: 3, y: 3 };

/** Minimal stand-in icons: distinct enough that no two score alike. */
const svg = (body: string) =>
  `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;
const stroked = (d: string) =>
  svg(`<path d="${d}" stroke="currentColor" stroke-width="2" fill="none"/>`);

const FAKE_SET: EvalIcon[] = [
  {
    category: "Forms & Shapes",
    icon: "square",
    svg: stroked("M4 4H20V20H4Z"),
    tags: ["box"],
  },
  {
    category: "Forms & Shapes",
    icon: "line",
    svg: stroked("M3 12H21"),
    tags: ["rule"],
  },
  {
    category: "Arrows",
    icon: "arrow-up",
    svg: stroked("M12 20V4M6 10L12 4L18 10"),
    tags: ["north"],
  },
  {
    category: "Forms & Shapes",
    icon: "corner",
    svg: stroked("M5 5V19H19"),
    tags: ["angle"],
  },
  {
    category: "Forms & Shapes",
    icon: "cross",
    svg: stroked("M5 5L19 19M19 5L5 19"),
    tags: ["close"],
  },
];

/**
 * A benchmark entry for a fake icon. `closure` is what the eval must withhold
 * *beyond* the entry itself; a real one comes from `conceptClosure` against the
 * corpus, and the tests that care about that live in `bench.test.ts`.
 */
const entry = (slug: string, closure: string[] = []): BenchmarkEntry => ({
  closure: closure.map((c) => `blode-icons/${c}`),
  id: `blode-icons/${slug}`,
  rank: 0,
  set: "blode-icons",
  slug,
  strata: {
    category: "Forms & Shapes",
    cohort: "singleton",
    concept: "none",
    elements: "1-2",
    keyline: "on",
    tags: "1-3",
  },
});

const bench = (...slugs: string[]): BenchmarkEntry[] =>
  slugs.map((slug, rank) => ({ ...entry(slug), rank }));

describe("resolveModel", () => {
  it("fails with one clear line when there is no key and no model", () => {
    const key = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = "";
    try {
      expect(() => resolveModel()).toThrow(MissingApiKeyError);
      expect(() => resolveModel()).toThrow(/No model credential found/u);
    } finally {
      process.env.ANTHROPIC_API_KEY = key;
    }
  });

  /**
   * A namespaced id is a gateway route, and the AI SDK resolves a bare string
   * through its global provider. Returning the id *unchanged* is what sends it
   * there — wrapping it in `anthropic()` would pin it to one vendor and quietly
   * defeat the gateway, which is the failure these two tests exist to catch.
   */
  it("passes a namespaced id straight through to the gateway", () => {
    const key = process.env.AI_GATEWAY_API_KEY;
    process.env.AI_GATEWAY_API_KEY = "test-key";
    try {
      expect(resolveModel("anthropic/claude-opus-4.5")).toBe(
        "anthropic/claude-opus-4.5"
      );
    } finally {
      process.env.AI_GATEWAY_API_KEY = key;
    }
  });

  it("will not route a namespaced id with no gateway key", () => {
    const gw = process.env.AI_GATEWAY_API_KEY;
    const anth = process.env.ANTHROPIC_API_KEY;
    process.env.AI_GATEWAY_API_KEY = "";
    // An Anthropic key must not stand in for a gateway key: the request would
    // go somewhere the caller did not ask for.
    process.env.ANTHROPIC_API_KEY = "sk-not-a-gateway-key";
    try {
      expect(() => resolveModel("anthropic/claude-opus-4.5")).toThrow(
        MissingApiKeyError
      );
    } finally {
      process.env.AI_GATEWAY_API_KEY = gw;
      process.env.ANTHROPIC_API_KEY = anth;
    }
  });

  it("fails before any drawing when generate() has no model and no key", async () => {
    const key = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = "";
    try {
      await expect(generate({ name: "folder" })).rejects.toThrow(
        MissingApiKeyError
      );
    } finally {
      process.env.ANTHROPIC_API_KEY = key;
    }
  });

  it("uses a model instance without asking for a key", () => {
    const model = scripted([{ text: "hi" }]);
    expect(resolveModel(model)).toBe(model);
  });

  it("defaults to the house model when a key is present", () => {
    const model = resolveModel(undefined, "sk-test-not-a-real-key");
    expect(typeof model === "string" ? model : model.modelId).toBe(
      DEFAULT_MODEL
    );
  });
});

describe("tools", () => {
  it("reports what the canvas drew, not what was asked for", async () => {
    const { tools } = createTools();
    // 3.1 is off-grid and r=1.7 is off-tier; both are corrected on the way in.
    const out = await tools.rect.execute?.(
      { h: 18, r: 1.7, w: 18, x: 3.1, y: 3 },
      { messages: [], toolCallId: "t1" }
    );
    expect(out?.placed?.x).toBe(3);
    expect(out?.elements).toBe(1);
  });

  it("refuses a part that is not in the vocabulary", () => {
    const { tools } = createTools();
    expect(() =>
      tools.part.execute?.(
        { id: "nope", x: 4, y: 4 },
        { messages: [], toolCallId: "t1" }
      )
    ).toThrow(/unknown part/u);
  });
});

describe("generate", () => {
  it("draws, renders, lints and returns a document", async () => {
    const result = await generate(
      { name: "square", tags: ["box"] },
      {
        keyline: "square",
        model: scripted([
          { input: square, tool: "rect" },
          { input: { keyline: "square" }, tool: "fit" },
          { input: {}, tool: "render" },
          { input: { keyline: "square" }, tool: "lint" },
          { text: "A rounded square." },
        ]),
      }
    );

    expect(result.clean).toBe(true);
    expect(result.doc.draw).toHaveLength(1);
    expect(result.doc.draw[0].op).toBe("rect");
    expect(result.doc.icon).toBe("square");
    expect(result.svg).toContain("<path");
    expect(result.trace).toEqual(["rect", "fit", "render", "lint"]);
  });

  it("hands the render back as an image the model can actually see", async () => {
    const model = scripted([
      { input: square, tool: "rect" },
      { input: {}, tool: "render" },
      { text: "seen" },
    ]);
    await generate({ name: "square" }, { model });

    // The turn after the render: whatever the provider is given here is what
    // the model looks at. A JSON blob of base64 would type-check and score
    // fine, and the model would be drawing blind.
    const after = model.doGenerateCalls.at(-1) as LanguageModelV4CallOptions;
    const parts = after.prompt
      .flatMap((m) => (Array.isArray(m.content) ? m.content : []))
      .filter((c) => c.type === "tool-result")
      .flatMap((c) => (c.output.type === "content" ? c.output.value : []));
    expect(
      parts.some((v) => v.type === "file" && v.mediaType === "image/png")
    ).toBe(true);
  });

  it("stops on the step budget when the model never converges", async () => {
    const result = await generate(
      { name: "loop" },
      {
        // A declared keyline is what makes a wrong extent an error rather than
        // a warning; `centred` is only a warning now that cohort alignment,
        // not the canvas centre, decides where a family sits.
        keyline: "square",
        maxSteps: 3,
        // Draws a small off-centre circle forever and never lints: nothing can
        // end this but the budget.
        model: scripted([{ input: { cx: 5, cy: 5, r: 2 }, tool: "circle" }]),
      }
    );

    expect(result.steps).toBe(3);
    expect(result.clean).toBe(false);
    expect(result.issues.map((i) => i.rule)).toContain("keyline");
    expect(result.issues.map((i) => i.rule)).toContain("centred");
  });

  it("returns an empty-canvas error rather than throwing when nothing is drawn", async () => {
    const result = await generate(
      { name: "nothing" },
      { model: scripted([{ text: "I would rather not." }]) }
    );

    expect(result.doc.draw).toEqual([]);
    expect(result.clean).toBe(false);
    expect(result.issues[0].rule).toBe("empty");
    expect(result.text).toBe("I would rather not.");
  });

  it("puts the concept, but never the answer, in the prompt", async () => {
    const model = scripted([{ text: "done" }]);
    await generate(
      { category: "Arrows", name: "arrow-up", tags: ["north", "up"] },
      { model }
    );

    const call = model.doGenerateCalls[0] as LanguageModelV4CallOptions;
    const text = JSON.stringify(call.prompt);
    expect(text).toContain("arrow-up");
    expect(text).toContain("Arrows");
    expect(text).toContain("north");
    expect(text).toContain("24×24");
  });
});

describe("evaluate", () => {
  const model = scripted([{ text: "done" }]);
  /** The set under test stands in for blode-icons: an eval shows the model
   *  every icon it does not hold out, so it only runs on a house set. */
  const provenance = {
    date: "2026-08-19",
    origin: "original",
    set: "blode-icons",
    usage: "conditioning",
  } as const;

  it("reports four numbers and per-icon scores", async () => {
    const report = await evaluate({
      benchmark: bench("square", "line", "arrow-up", "corner"),
      generate: (concept) =>
        Promise.resolve({
          clean: true,
          doc: { draw: [], icon: concept.name, keyline: null },
          issues: [],
          steps: 4,
          svg: stroked("M6 6H18V18H6Z"),
          text: "",
          trace: [],
        }),
      icons: FAKE_SET,
      model,
      provenance,
      seed: 3,
    });

    expect(report.n).toBe(4);
    expect(report.baseline).toBe(BASELINE);
    expect(report.ceiling).toBe(1);
    expect(report.icons).toHaveLength(4);
    for (const s of report.icons.filter(scored)) {
      expect(s.score).toBeGreaterThan(0);
      expect(s.score).toBeLessThanOrEqual(1);
      expect(s.floor).toBeGreaterThan(0);
    }
    // Sorted weakest first, so the head of the list is what to go and look at.
    const values = report.icons.filter(scored).map((i) => i.score);
    expect(values).toEqual(values.toSorted((a, b) => a - b));
    expect(formatReport(report)).toContain("baseline");
  });

  it("flags a suspiciously perfect run instead of celebrating it", async () => {
    const byName = new Map(FAKE_SET.map((i) => [i.icon, i.svg]));
    const report = await evaluate({
      benchmark: bench("square", "line", "arrow-up"),
      // The bug this guards against: the target reaching the generator.
      generate: (concept) =>
        Promise.resolve({
          clean: true,
          doc: { draw: [], icon: concept.name, keyline: null },
          issues: [],
          steps: 1,
          svg: byName.get(concept.name) ?? "",
          text: "",
          trace: [],
        }),
      icons: FAKE_SET,
      model,
      provenance,
      seed: 1,
    });

    expect(report.treatment).toBeGreaterThan(0.99);
    expect(report.suspect).toMatch(/leaking/u);
    expect(formatReport(report)).toContain("!");
  });

  it("records a failed icon as an error, not as a zero, and runs on", async () => {
    const report = await evaluate({
      benchmark: bench(...FAKE_SET.map((i) => i.icon)),
      generate: (concept) => {
        if (concept.name === FAKE_SET[0].icon) {
          return Promise.reject(new Error("model exploded"));
        }
        return Promise.resolve({
          clean: true,
          doc: { draw: [], icon: concept.name, keyline: null },
          issues: [],
          steps: 1,
          svg: stroked("M6 6H18V18H6Z"),
          text: "",
          trace: [],
        });
      },
      icons: FAKE_SET,
      model,
      provenance,
      seed: 1,
    });

    // The original property, and the reason the catch exists: one generation
    // blowing up does not take the run with it. Every other icon still drew and
    // still scored.
    const ok = report.icons.filter(scored);
    expect(ok).toHaveLength(FAKE_SET.length - 1);
    expect(report.n).toBe(FAKE_SET.length - 1);
    for (const s of ok) {
      expect(s.score).toBeGreaterThan(0);
    }

    // What this test used to assert was that the failure landed as a score of
    // 0. It does not: it carries no score at all, it is counted separately, and
    // it is not in the median. A 0 there is a measurement of a bad icon, and a
    // model that threw drew no icon to measure.
    const failed = report.icons.filter((i) => !scored(i));
    expect(failed).toHaveLength(1);
    expect(failed[0]).not.toHaveProperty("score");
    expect(failed[0].icon).toBe(FAKE_SET[0].icon);
    expect(report.benchmark.errors).toBe(1);
    expect(report.treatment).toBe(median(ok.map((s) => s.score)));

    // Still named in the report, as it always was: excluded from the numbers is
    // not hidden from the reader.
    expect(formatReport(report)).toContain("model exploded");
  });

  it("keeps the held-out icons out of the comparison corpus", async () => {
    const seen: string[][] = [];
    await evaluate({
      // `square` is held out and `cross` is in its closure — a stand-in for
      // the cohort mate that a name-exact hold-out used to leave in front of
      // the model. Both must be gone from every corpus handed to `generate`,
      // including the one for the *other* held-out icon.
      benchmark: [entry("square", ["cross"]), entry("line")],
      generate: (_concept, options) => {
        seen.push((options.corpus ?? []).map((c) => c.name));
        return Promise.resolve({
          clean: true,
          doc: { draw: [], icon: null, keyline: null },
          issues: [],
          steps: 1,
          svg: stroked("M6 6H18V18H6Z"),
          text: "",
          trace: [],
        });
      },
      icons: FAKE_SET,
      model,
      provenance,
      seed: 5,
    });

    expect(seen).toHaveLength(2);
    for (const corpus of seen) {
      expect(corpus).not.toContain("square");
      expect(corpus).not.toContain("cross");
      expect(corpus).not.toContain("line");
      // What is left is still a corpus, not an empty list — the exclusion has
      // to be surgical or the eval measures a model shown nothing.
      expect(corpus).toContain("arrow-up");
    }
  });

  it("refuses to run against a set that may not condition a generation", async () => {
    // The runtime half of the gate. The compile-time half is in
    // licence.test-d.ts; this covers the provenance that arrives as JSON or as
    // a CLI flag, where the union is a claim rather than a guarantee.
    await expect(
      evaluate({
        benchmark: bench("square"),
        icons: FAKE_SET,
        model,
        provenance: { ...provenance, set: "lucide" },
        seed: 1,
      })
    ).rejects.toThrow(/lucide/u);
  });
});

describe("median", () => {
  it("matches how the baseline was measured", () => {
    expect(median([])).toBe(0);
    expect(median([0.5])).toBe(0.5);
    expect(median([0.2, 0.8])).toBeCloseTo(0.5);
    expect(median([0.9, 0.1, 0.5])).toBe(0.5);
  });
});
