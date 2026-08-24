/**
 * The judge, wired to a model.
 *
 * Kept apart from `judge.ts` so the rubric, the pairing, the parsing and the
 * sanity gate stay testable with no network and no key. Everything in this file
 * costs money; everything in that one is arithmetic.
 */
import { generateText } from "ai";
import type { LanguageModel } from "ai";

import { png } from "../tools/render.js";
import { GATE_PROMPT, JUDGE_SYSTEM, pair, parsePick } from "./judge.js";
import type { GateTrial } from "./judge.js";

/** The size the judge sees. Larger than the 48px scoring raster on purpose:
 *  this is a legibility question asked of a model with eyes, not a cosine, and
 *  it has nothing to do with the 0.737 baseline `tools/render.ts` is calibrated
 *  against. */
const JUDGE_PX = 192;

const ask = async (
  model: LanguageModel,
  system: string,
  prompt: string,
  images: Buffer[]
): Promise<string> => {
  const { text } = await generateText({
    messages: [
      {
        content: [
          ...images.map((data) => ({
            data,
            mediaType: "image/png" as const,
            type: "file" as const,
          })),
          { text: prompt, type: "text" as const },
        ],
        role: "user",
      },
    ],
    model,
    system,
  });
  return text;
};

export interface GateItem {
  concept: string;
  /** The icon the set actually ships for this concept. */
  real: string;
  /** An icon of some other concept entirely. */
  decoy: string;
  icon: string;
}

/**
 * Run the sanity gate: can the judge tell a shipped icon from an unrelated one?
 *
 * This is the cheapest question in the panel and the one that decides whether
 * the judge column is printed at all. A judge below 90% here is not a weak
 * signal to discount, it is noise, and `scoreGate` discards the column.
 */
export const runGate = async (
  model: LanguageModel,
  items: readonly GateItem[],
  seed: number
): Promise<GateTrial[]> => {
  const trials: GateTrial[] = [];
  // Recursion rather than a loop, so the await is not inside one: the trials
  // are deliberately sequential — this is the only part of the panel that
  // costs money, and a caller watching the spend has to be able to stop it.
  const runFrom = async (i: number): Promise<void> => {
    if (i >= items.length) {
      return;
    }
    const item = items[i];
    const [real, decoy] = await Promise.all([
      png(item.real, JUDGE_PX),
      png(item.decoy, JUDGE_PX),
    ]);
    const laid = pair(real, decoy, seed, item.icon);
    const text = await ask(model, JUDGE_SYSTEM, GATE_PROMPT(item.concept), [
      laid.a,
      laid.b,
    ]);
    trials.push({
      answer: laid.candidate,
      icon: item.icon,
      pick: parsePick(text),
    });
    await runFrom(i + 1);
  };
  await runFrom(0);
  return trials;
};
