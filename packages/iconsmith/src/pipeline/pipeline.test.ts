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
import {
  BASELINE,
  evaluate,
  evaluateSeeds,
  formatReport,
  median,
  scored,
} from "./eval.js";
import type { EvalIcon } from "./eval.js";
import {
  DEFAULT_MODEL,
  MissingApiKeyError,
  OPENROUTER_INKLING,
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

const envGet = {
  anthropic: (): string | undefined => process.env.ANTHROPIC_API_KEY,
  gateway: (): string | undefined => process.env.AI_GATEWAY_API_KEY,
  oidc: (): string | undefined => process.env.VERCEL_OIDC_TOKEN,
  openrouter: (): string | undefined => process.env.OPENROUTER_API_KEY,
  provider: (): string | undefined => process.env.ICONSMITH_PROVIDER,
};

const envSet = {
  anthropic: (value: string | undefined): void => {
    if (value === undefined) {
      delete process.env.ANTHROPIC_API_KEY;
    } else {
      process.env.ANTHROPIC_API_KEY = value;
    }
  },
  gateway: (value: string | undefined): void => {
    if (value === undefined) {
      delete process.env.AI_GATEWAY_API_KEY;
    } else {
      process.env.AI_GATEWAY_API_KEY = value;
    }
  },
  oidc: (value: string | undefined): void => {
    if (value === undefined) {
      delete process.env.VERCEL_OIDC_TOKEN;
    } else {
      process.env.VERCEL_OIDC_TOKEN = value;
    }
  },
  openrouter: (value: string | undefined): void => {
    if (value === undefined) {
      delete process.env.OPENROUTER_API_KEY;
    } else {
      process.env.OPENROUTER_API_KEY = value;
    }
  },
  provider: (value: string | undefined): void => {
    if (value === undefined) {
      delete process.env.ICONSMITH_PROVIDER;
    } else {
      process.env.ICONSMITH_PROVIDER = value;
    }
  },
};

const withoutGateway = (run: () => void): void => {
  const gw = envGet.gateway();
  const oidc = envGet.oidc();
  const or = envGet.openrouter();
  const provider = envGet.provider();
  process.env.AI_GATEWAY_API_KEY = "";
  process.env.VERCEL_OIDC_TOKEN = "";
  process.env.OPENROUTER_API_KEY = "";
  delete process.env.ICONSMITH_PROVIDER;
  try {
    run();
  } finally {
    envSet.gateway(gw);
    envSet.oidc(oidc);
    envSet.openrouter(or);
    envSet.provider(provider);
  }
};

const modelIdOf = (model: ReturnType<typeof resolveModel>): string =>
  typeof model === "string" ? model : model.modelId;

describe("resolveModel", () => {
  it("fails with one clear line when there is no gateway credential", () => {
    withoutGateway(() => {
      expect(() => resolveModel()).toThrow(MissingApiKeyError);
      expect(() => resolveModel()).toThrow(/No AI Gateway credential found/u);
    });
  });

  /**
   * A namespaced id is a gateway route. Wrapping it in a vendor SDK would pin
   * the call to that vendor and quietly defeat the gateway.
   */
  it("routes a namespaced id through the gateway", () => {
    const model = resolveModel("anthropic/claude-opus-4.5", "test-key");
    expect(modelIdOf(model)).toBe("anthropic/claude-opus-4.5");
  });

  it("namespaces a bare Anthropic id rather than calling Anthropic directly", () => {
    expect(modelIdOf(resolveModel("claude-opus-5", "test-key"))).toBe(
      "anthropic/claude-opus-5"
    );
  });

  it("will not route with an Anthropic key and no gateway credential", () => {
    const anth = envGet.anthropic();
    process.env.ANTHROPIC_API_KEY = "sk-not-a-gateway-key";
    try {
      withoutGateway(() => {
        expect(() => resolveModel("anthropic/claude-opus-4.5")).toThrow(
          MissingApiKeyError
        );
      });
    } finally {
      envSet.anthropic(anth);
    }
  });

  it("accepts VERCEL_OIDC_TOKEN as the gateway credential", () => {
    withoutGateway(() => {
      process.env.VERCEL_OIDC_TOKEN = "oidc-not-a-real-token";
      expect(modelIdOf(resolveModel("google/gemini-3.5-flash"))).toBe(
        "google/gemini-3.5-flash"
      );
    });
  });

  it("fails before any drawing when generate() has no model and no key", async () => {
    const gw = envGet.gateway();
    const oidc = envGet.oidc();
    const or = envGet.openrouter();
    process.env.AI_GATEWAY_API_KEY = "";
    process.env.VERCEL_OIDC_TOKEN = "";
    process.env.OPENROUTER_API_KEY = "";
    try {
      await expect(generate({ name: "folder" })).rejects.toThrow(
        MissingApiKeyError
      );
    } finally {
      envSet.gateway(gw);
      envSet.oidc(oidc);
      envSet.openrouter(or);
    }
  });

  it("uses a model instance without asking for a key", () => {
    const model = scripted([{ text: "hi" }]);
    expect(resolveModel(model)).toBe(model);
  });

  it("defaults to the house model when a key is present", () => {
    const model = resolveModel(undefined, "sk-test-not-a-real-key");
    expect(modelIdOf(model)).toBe(DEFAULT_MODEL);
  });

  it("routes an OpenRouter slug through OpenRouter, not the gateway", () => {
    const model = resolveModel("thinkingmachines/inkling:free", "or-test-key");
    expect(modelIdOf(model)).toBe("thinkingmachines/inkling:free");
    expect(typeof model === "string" ? "string" : model.provider).toBe(
      "openrouter"
    );
  });

  it("strips the openrouter/ routing prefix before the API slug", () => {
    const model = resolveModel(
      "openrouter/thinkingmachines/inkling:free",
      "or-test-key"
    );
    expect(modelIdOf(model)).toBe("thinkingmachines/inkling:free");
  });

  it("fails with an OpenRouter line when that slug has no OpenRouter key", () => {
    withoutGateway(() => {
      expect(() => resolveModel("thinkingmachines/inkling:free")).toThrow(
        MissingApiKeyError
      );
      expect(() => resolveModel("thinkingmachines/inkling:free")).toThrow(
        /OPENROUTER_API_KEY/u
      );
    });
  });

  it("defaults to Inkling when the only credential is OpenRouter", () => {
    withoutGateway(() => {
      process.env.OPENROUTER_API_KEY = "or-test-key";
      const model = resolveModel();
      expect(modelIdOf(model)).toBe(OPENROUTER_INKLING);
      expect(typeof model === "string" ? "string" : model.provider).toBe(
        "openrouter"
      );
    });
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

  it("steers listParts toward the house paint construction the query asked for", async () => {
    const outlined = createTools({ finish: "outlined" });
    const filled = createTools({ finish: "filled" });
    const clock = await outlined.tools.listParts.execute?.(
      { query: "clock" },
      { messages: [], toolCallId: "t1" }
    );
    const plus = await filled.tools.listParts.execute?.(
      { query: "plus-sign" },
      { messages: [], toolCallId: "t2" }
    );
    const other = await outlined.tools.listParts.execute?.(
      { query: "quokka" },
      { messages: [], toolCallId: "t3" }
    );
    expect(clock?.construction).toContain(
      "House construction (clock, outlined)"
    );
    expect(plus?.construction).toContain("House construction (plus, filled)");
    const mark = await outlined.tools.listParts.execute?.(
      { query: "checkmark" },
      { messages: [], toolCallId: "t4" }
    );
    expect(mark?.construction).toContain(
      "House construction (check, outlined)"
    );
    const house = await outlined.tools.listParts.execute?.(
      { query: "home" },
      { messages: [], toolCallId: "t5" }
    );
    expect(house?.construction).toContain(
      "House construction (home, outlined)"
    );
    const star = await outlined.tools.listParts.execute?.(
      { query: "star" },
      { messages: [], toolCallId: "t6" }
    );
    expect(star?.construction).toContain("Do not volunteer a star glyph");
    expect(other?.construction).toBeUndefined();
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

  it("pairs the other paint so a filled disc is not a quiet twin", async () => {
    const result = await generate(
      { name: "ring" },
      {
        finish: "filled",
        model: scripted([
          { input: { cx: 12, cy: 12, r: 8 }, tool: "circle" },
          { text: "A disc." },
        ]),
      }
    );
    expect(result.program).toContain("finish filled");
    expect(result.program).toContain("circle 12,12 r8");
    expect(result.clean).toBe(false);
    expect(result.issues.map((i) => i.rule)).toContain("paint");
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

/**
 * The first real re-baseline produced a spread of 0.672 and it was fiction:
 * one replicate spent the cap, the next scored 6 of 30, and the third never
 * ran and reported treatment 0.000 — which went straight into the spread. A
 * noise floor of 0.672 on a bounded cosine rejects every experiment forever,
 * which is how a loop goes quiet while reporting that nothing beats the
 * champion. It is the errored-generation bug one level up.
 */
describe("evaluateSeeds when the cap runs out", () => {
  const provenance = {
    date: "2026-08-19",
    origin: "original",
    set: "blode-icons",
    usage: "conditioning",
  } as const;

  it("skips a starved replicate and names it, rather than scoring it zero", async () => {
    let calls = 0;
    const report = await evaluateSeeds(
      {
        benchmark: bench("square", "line"),
        generate: (concept) => {
          calls += 1;
          return Promise.resolve({
            clean: true,
            cost: {
              finishReason: "stop",
              ms: 1,
              toolCalls: {},
              usage: {
                cacheReadTokens: 0,
                cacheWriteTokens: 0,
                inputTokens: 5_000_000,
                outputTokens: 5_000_000,
                reasoningTokens: 0,
              },
            },
            doc: { draw: [], icon: concept.name, keyline: null },
            issues: [],
            steps: 1,
            svg: stroked("M6 6H18V18H6Z"),
            text: "",
            trace: [],
          });
        },
        icons: FAKE_SET,
        maxSpendUsd: 0.01,
        model: "anthropic/claude-sonnet-5",
        provenance,
      } as unknown as Parameters<typeof evaluateSeeds>[0],
      [1, 2, 3]
    );

    expect(report.skipped).toEqual([2, 3]);
    expect(report.runs).toHaveLength(1);
    // One measured replicate cannot disagree with itself, and two that never
    // ran cannot disagree with anything.
    expect(report.spread).toBe(0);
    expect(calls).toBeGreaterThan(0);
  });
});

describe("a cap that cannot be enforced", () => {
  it("refuses rather than running unbounded with the flag set", async () => {
    await expect(
      evaluate({
        benchmark: bench("square"),
        generate: () => {
          throw new Error("the cap must refuse before any drawing");
        },
        icons: FAKE_SET,
        maxSpendUsd: 5,
        model: "some-model-nobody-priced",
        provenance: {
          date: "2026-08-19",
          origin: "original",
          set: "blode-icons",
          usage: "conditioning",
        },
      } as unknown as Parameters<typeof evaluate>[0])
    ).rejects.toThrow(/--max-spend cannot be enforced/u);
  });
});
