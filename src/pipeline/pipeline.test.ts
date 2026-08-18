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

import { BASELINE, evaluate, formatReport, holdOut, median } from "./eval.js";
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

describe("resolveModel", () => {
  it("fails with one clear line when there is no key and no model", () => {
    const key = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = "";
    try {
      expect(() => resolveModel()).toThrow(MissingApiKeyError);
      expect(() => resolveModel()).toThrow(/ANTHROPIC_API_KEY is not set/u);
    } finally {
      process.env.ANTHROPIC_API_KEY = key;
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

describe("holdOut", () => {
  it("is reproducible from its seed and never repeats an icon", () => {
    const a = holdOut(FAKE_SET, 3, 7).map((i) => i.icon);
    const b = holdOut(FAKE_SET, 3, 7).map((i) => i.icon);
    expect(a).toEqual(b);
    expect(new Set(a).size).toBe(3);
    expect(holdOut(FAKE_SET, 3, 8).map((i) => i.icon)).not.toEqual(a);
    expect(holdOut(FAKE_SET, 99, 1)).toHaveLength(FAKE_SET.length);
  });
});

describe("evaluate", () => {
  const model = scripted([{ text: "done" }]);

  it("reports four numbers and per-icon scores", async () => {
    const report = await evaluate({
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
      n: 4,
      seed: 3,
    });

    expect(report.n).toBe(4);
    expect(report.baseline).toBe(BASELINE);
    expect(report.ceiling).toBe(1);
    expect(report.icons).toHaveLength(4);
    for (const s of report.icons) {
      expect(s.score).toBeGreaterThan(0);
      expect(s.score).toBeLessThanOrEqual(1);
      expect(s.floor).toBeGreaterThan(0);
    }
    // Sorted weakest first, so the head of the list is what to go and look at.
    expect(report.icons.map((i) => i.score)).toEqual(
      report.icons.map((i) => i.score).toSorted((a, b) => a - b)
    );
    expect(formatReport(report)).toContain("baseline");
  });

  it("flags a suspiciously perfect run instead of celebrating it", async () => {
    const byName = new Map(FAKE_SET.map((i) => [i.icon, i.svg]));
    const report = await evaluate({
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
      n: 3,
      seed: 1,
    });

    expect(report.treatment).toBeGreaterThan(0.99);
    expect(report.suspect).toMatch(/leaking/u);
    expect(formatReport(report)).toContain("!");
  });

  it("records a failed icon as zero rather than failing the run", async () => {
    const report = await evaluate({
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
      n: FAKE_SET.length,
      seed: 1,
    });

    const failed = report.icons.filter((i) => i.error);
    expect(failed).toHaveLength(1);
    expect(failed[0].score).toBe(0);
    expect(formatReport(report)).toContain("model exploded");
  });

  it("keeps the held-out icons out of the comparison corpus", async () => {
    const seen: string[][] = [];
    await evaluate({
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
      n: 2,
      seed: 5,
    });

    const held = new Set(holdOut(FAKE_SET, 2, 5).map((i) => i.icon));
    for (const corpus of seen) {
      expect(corpus.filter((name) => held.has(name))).toEqual([]);
    }
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
