/**
 * Which sketch to read.
 *
 * Image models are cheap and inconsistent: two sketches of the same concept
 * routinely differ in how many elements they use, which is the one thing the
 * proposal is actually carrying. Picking between them costs a fraction of a
 * cent on a text model and is the difference between conditioning the drawer
 * on a composition and conditioning it on a coin flip.
 *
 * It judges *composition*, not drawing quality, because composition is all
 * that survives `compose.ts`. A sketch with beautiful strokes and five
 * elements where the set would use two is the worse proposal, and a critique
 * that rewarded the strokes would be optimising something this pipeline throws
 * away.
 *
 * A failed critique is not fatal: the first sketch is used and the reason says
 * why. Losing the arm entirely because a judge timed out would turn a
 * treatment run into a control run without saying so, which is the one failure
 * mode that corrupts the comparison rather than just costing an icon.
 */
import { generateObject } from "ai";
import { z } from "zod";

import type { ApiCost } from "./cost.js";
import { tokenUsageOf } from "./cost.js";
import { gatewayCostTracker, resolveModel } from "./gateway.js";
import type { Concept } from "./prompt.js";

/** A small text model with vision. The judgement is "which of these two has
 *  the element count and arrangement of the set beside it", which does not
 *  need a frontier model and would not be improved by one. */
export const CRITIQUE_MODEL = "google/gemini-3.5-flash";

export interface Verdict {
  cost?: ApiCost;
  index: number;
  reason: string | null;
}

const schema = z.object({
  choice: z
    .number()
    .int()
    .describe("1-based index of the sketch with the better composition"),
  reason: z.string().describe("one sentence, about composition"),
});

export interface CritiqueOptions {
  model?: string;
}

/**
 * Pick the sketch whose composition best fits the set.
 *
 * `references` are the same reference PNGs the sketches were drawn against, so
 * the judge is asked the question the sketches were set: does this look like it
 * was composed by whoever composed those.
 */
export const critique = async (
  concept: Concept,
  images: readonly Buffer[],
  references: readonly Buffer[],
  { model = CRITIQUE_MODEL }: CritiqueOptions = {}
): Promise<Verdict> => {
  if (images.length <= 1) {
    return { index: 0, reason: null };
  }
  try {
    const costTracker = gatewayCostTracker();
    const result = await generateObject({
      messages: [
        {
          content: [
            {
              text: "Icons from an established set, for the house style:",
              type: "text",
            },
            ...references.map(
              (data) =>
                ({ data, mediaType: "image/png", type: "file" }) as const
            ),
            {
              text: `Candidate sketches for "${concept.name}", in order:`,
              type: "text",
            },
            ...images.map(
              (data) =>
                ({ data, mediaType: "image/png", type: "file" }) as const
            ),
            {
              text:
                "Which candidate is composed most like the set above? Judge " +
                "composition only: how many distinct elements it uses, whether " +
                "that is how many an icon of this concept needs, their relative " +
                "sizes, and how they sit together. Ignore stroke quality, " +
                "smoothness and finish entirely — none of it is kept. Fewer " +
                "elements win ties.",
              type: "text",
            },
          ],
          role: "user",
        },
      ],
      model: resolveModel(model),
      schema,
    });
    costTracker.record(result.providerMetadata);
    const index =
      Math.min(Math.max(result.object.choice, 1), images.length) - 1;
    return {
      cost: await costTracker.measure({
        model,
        operation: "proposal-selection",
        usage: tokenUsageOf(result.usage),
      }),
      index,
      reason: result.object.reason,
    };
  } catch (error) {
    return {
      index: 0,
      reason: `critique failed (${(error as Error).message}); used the first sketch`,
    };
  }
};
