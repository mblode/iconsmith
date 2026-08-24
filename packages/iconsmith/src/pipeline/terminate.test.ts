/**
 * How the loop ends, and what it calls the ending.
 *
 * Two things were wrong at once. The clean-exit condition read two flags that
 * no mutation ever reset, so "the model rendered at some point and its last
 * lint call found nothing" passed for "the finished icon is clean" — and a run
 * that linted early then kept drawing ended on a drawing nobody had seen. And
 * nothing distinguished the exits afterwards: `finishReason` is `tool-calls`
 * for a step cap and for a stop condition alike.
 */
import type { LanguageModelV4GenerateResult } from "@ai-sdk/provider";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";

import { generate } from "./generate.js";

type Turn = { input: unknown; tool: string } | { text: string };

/** A model that plays a fixed sequence of turns, repeating the last one. */
const scripted = (turns: Turn[]): MockLanguageModelV4 => {
  let n = 0;
  return new MockLanguageModelV4({
    doGenerate: (): LanguageModelV4GenerateResult => {
      const turn = turns[Math.min(n, turns.length - 1)];
      n += 1;
      const usage = {
        inputTokens: { cacheRead: 0, cacheWrite: 0, noCache: 1, total: 1 },
        outputTokens: { reasoning: 0, text: 1, total: 1 },
      };
      if ("text" in turn) {
        return {
          content: [{ text: turn.text, type: "text" }],
          finishReason: "stop",
          usage,
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
        usage,
        warnings: [],
      };
    },
  });
};

const square = { h: 18, r: 2, w: 18, x: 3, y: 3 };

describe("the clean exit", () => {
  it("fires when the render and the lint are both of the current drawing", async () => {
    const result = await generate(
      { name: "square" },
      {
        keyline: "square",
        model: scripted([
          { input: square, tool: "rect" },
          { input: {}, tool: "fit" },
          { input: {}, tool: "render" },
          { input: {}, tool: "lint" },
          { input: { cx: 12, cy: 12, r: 2 }, tool: "circle" },
        ]),
      }
    );

    expect(result.trace).toEqual(["rect", "fit", "render", "lint"]);
    expect(result.cost?.outcome).toBe("clean");
    expect(result.clean).toBe(true);
  });

  it("does not fire on a lint taken before the drawing changed", async () => {
    const result = await generate(
      { name: "square" },
      {
        keyline: "square",
        maxSteps: 8,
        model: scripted([
          // Lints clean here, and then keeps drawing. The flag version of this
          // condition ended the run on the `render` — the second circle had
          // gone on afterwards and nothing had looked at it.
          { input: square, tool: "rect" },
          { input: {}, tool: "lint" },
          { input: { cx: 6, cy: 6, r: 1 }, tool: "circle" },
          { input: {}, tool: "render" },
          { input: { cx: 18, cy: 18, r: 1 }, tool: "circle" },
          { text: "done" },
        ]),
      }
    );

    expect(result.trace).toEqual([
      "rect",
      "lint",
      "circle",
      "render",
      "circle",
    ]);
    expect(result.cost?.outcome).not.toBe("clean");
  });

  it("does not fire on a render taken before the drawing changed", async () => {
    const result = await generate(
      { name: "square" },
      {
        keyline: "square",
        maxSteps: 8,
        model: scripted([
          { input: square, tool: "rect" },
          { input: {}, tool: "render" },
          { input: { cx: 6, cy: 6, r: 1 }, tool: "circle" },
          { input: {}, tool: "lint" },
          { input: { cx: 18, cy: 18, r: 1 }, tool: "circle" },
          { text: "done" },
        ]),
      }
    );

    expect(result.trace).toEqual([
      "rect",
      "render",
      "circle",
      "lint",
      "circle",
    ]);
    expect(result.cost?.outcome).not.toBe("clean");
  });
});

describe("outcomes", () => {
  it("converges when two consecutive steps add nothing", async () => {
    const result = await generate(
      { name: "square" },
      {
        keyline: "square",
        maxSteps: 12,
        // Draws once, then looks at it forever without touching it.
        model: scripted([
          { input: square, tool: "rect" },
          { input: {}, tool: "fit" },
          { input: {}, tool: "render" },
          { input: { limit: 1, query: "square" }, tool: "listParts" },
        ]),
      }
    );

    expect(result.cost?.outcome).toBe("converged");
    // Two idle steps, not the twelve it was given.
    expect(result.steps).toBe(4);
  });

  it("keeps working while the model's own lint still reports errors", async () => {
    const result = await generate(
      { name: "tiny" },
      {
        keyline: "square",
        maxSteps: 6,
        // A drawing that lints with errors, then three idle steps. Idleness is
        // not convergence while there is a known error outstanding — the model
        // is meant to get its remaining turns to fix it.
        model: scripted([
          { input: { cx: 5, cy: 5, r: 2 }, tool: "circle" },
          { input: {}, tool: "lint" },
          { input: {}, tool: "render" },
          { input: {}, tool: "render" },
        ]),
      }
    );

    expect(result.steps).toBe(6);
    expect(result.cost?.outcome).toBe("stalled");
  });

  it("calls an empty canvas stalled, not converged", async () => {
    const result = await generate(
      { name: "nothing" },
      { model: scripted([{ text: "I would rather not." }]) }
    );

    expect(result.cost?.outcome).toBe("stalled");
  });

  it("calls the step cap budget when the drawing is sound but unconfirmed", async () => {
    const result = await generate(
      { name: "square" },
      {
        maxSteps: 3,
        // Redraws forever: never idle, never confirmed, and clean at the end.
        model: scripted([{ input: square, tool: "rect" }]),
      }
    );

    expect(result.steps).toBe(3);
    expect(result.clean).toBe(true);
    expect(result.cost?.outcome).toBe("budget");
  });
});

describe("what a run delivers when it ends mid-wipe", () => {
  it("keeps the drawing it rendered instead of shipping the empty canvas", async () => {
    // Two campaign paints ended `render, remove, remove, remove, remove` — the
    // model clearing a composition to start again, and the step cap landing
    // inside the wipe. The blank was delivered, independently audited at
    // SC 0 / PQ 0, and billed for.
    const result = await generate(
      { name: "square" },
      {
        keyline: "square",
        maxSteps: 4,
        model: scripted([
          { input: square, tool: "rect" },
          { input: {}, tool: "fit" },
          { input: {}, tool: "render" },
          { input: { id: "e0" }, tool: "remove" },
        ]),
      }
    );

    expect(result.trace).toEqual(["rect", "fit", "render", "remove"]);
    expect(result.doc.draw).not.toHaveLength(0);
    expect(result.svg).toContain("path");
  });

  it("leaves work in progress alone when the run ends on a drawing", async () => {
    // Only an empty canvas, or one carrying more standing errors than the
    // snapshot, is replaced. A run that kept adding keeps what it added.
    const result = await generate(
      { name: "square" },
      {
        keyline: "square",
        maxSteps: 4,
        model: scripted([
          { input: square, tool: "rect" },
          { input: {}, tool: "fit" },
          { input: {}, tool: "render" },
          { input: { cx: 12, cy: 12, r: 2 }, tool: "circle" },
        ]),
      }
    );

    expect(result.doc.draw).toHaveLength(2);
  });
});
