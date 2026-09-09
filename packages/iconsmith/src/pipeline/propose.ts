/**
 * The raster arm: an image model proposes a composition, and words come out.
 *
 * The order of this file is the argument. An image model is called, its output
 * is judged, and then `compose.ts` reads the chosen picture into a `Proposal`
 * — element count, coarse cells, size bands, adjacency, part ids, a blurred
 * thumbnail — and the picture stops being useful to anything downstream. The
 * drawer that receives the proposal is the same drawer as the control arm,
 * calling the same primitives, checked by the same lint.
 *
 * What this arm is *not* is a tracer, and the distinction is not a matter of
 * degree. A vectoriser would turn the sketch into path data, and path data from
 * a model is precisely what `canvas.ts` exists to make unrepresentable. Here
 * the sketch's contribution is bounded by the vocabulary `compose.ts` emits: a
 * proposal can say "three elements, the big one bottom-left, a small round one
 * inside it", and cannot say anything at all about where a node goes.
 *
 * Cost is reported per image because that is how these models bill. The rates
 * are copied in with a date, for the reason `cost.ts` gives: a dollar figure
 * with no rate beside it cannot be checked six months later.
 */
import { generateText } from "ai";

import type { CohortManifest } from "../tools/cohort.js";
import { png } from "../tools/render.js";
import type { Part } from "../types.js";
import { READER_MODEL, compose } from "./compose.js";
import type { Proposal } from "./compose.js";
import type { ApiCost } from "./cost.js";
import { tokenUsageOf } from "./cost.js";
import { critique } from "./critique.js";
import { gatewayCostTracker, resolveModel } from "./gateway.js";
import type { GenerateOptions, GenerateResult } from "./generate.js";
import { generate } from "./generate.js";
import type { Reference } from "./licence.js";
import type { Concept } from "./prompt.js";
import { referenceSet } from "./references.js";

/** Ideation. Cheapest model that takes reference images and returns an image;
 *  the arm generates more than one sketch, so per-image price is what matters
 *  and quality per sketch is the critique's problem. */
const IDEATION_MODEL = "google/gemini-3.1-flash-lite-image";
/** The good one, for a single reference sketch when a run wants one. */

/**
 * USD per generated image, from the Vercel AI Gateway's own model listing,
 * read 2026-08-19. Text tokens on these calls are cents per thousand sketches
 * and are not counted; the image is the bill.
 */
const IMAGE_RATES: Record<string, number> = {
  "google/gemini-2.5-flash-image": 0.039,
  "google/gemini-3-pro-image": 0.1344,
  "google/gemini-3.1-flash-image": 0.067,
  "google/gemini-3.1-flash-lite-image": 0.034,
  "openai/gpt-image-1-mini": 0.011,
  "openai/gpt-image-2": 0.04,
};

/** Sketches from the cheap model when the caller does not say. Two, because a
 *  critique with one candidate is a rubber stamp and the third sketch has not
 *  been shown to be worth its price. */
const DEFAULT_IDEAS = 2;

class ProposalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProposalError";
  }
}

export interface ProposalOptions {
  /** Cancels every paid image, selection, and vision-reader call. */
  abortSignal?: AbortSignal;
  /** Existing icons the proposal is conditioned on. Licensed, because they
   *  reach a model: `references.ts` picks fourteen of them and this module
   *  sends every one to a third-party image endpoint. */
  corpus: readonly Reference[];
  /** Cheap sketches. */
  ideas?: number;
  ideationModel?: string;
  manifest?: CohortManifest;
  /** The vocabulary, for the part shortlist in the composition. */
  parts?: Part[];
  /** Vision model that reads the chosen sketch into words, or null for the
   *  pixel reader alone. See `ComposeOptions.model`. */
  readerModel?: string | null;
  /** One extra sketch from the good model, when a run wants the best available
   *  composition rather than the cheapest. */
  qualityModel?: string | null;
}

/** What one proposal cost and where it came from. The images are here for
 *  inspection and contact sheets outside the pipeline; the `Proposal` is the
 *  only thing that may travel further in. */
export interface ProposalRun {
  chosen: number;
  /** Every image, selection, and vision-reader bill in this proposal. */
  costs?: ApiCost[];
  images: Buffer[];
  models: string[];
  ms: number;
  proposal: Proposal;
  /** The critique's sentence, or null when there was nothing to choose. */
  reason: string | null;
  references: string[];
  /** Null when a model in the run is not in the rate table: no dollar figure is
   *  better than a zero that reads as free. */
  usd: number | null;
}

const brief = (concept: Concept): string =>
  [
    `Sketch a single icon for the concept "${concept.name}".`,
    concept.category ? `Category: ${concept.category}.` : "",
    concept.tags?.length ? `It also means: ${concept.tags.join(", ")}.` : "",
    "",
    "The images above are from the icon set this one joins. Match how they are",
    "composed — how many elements an icon like this has, how large each is",
    "relative to the others, how they sit together — not their subject matter.",
    "",
    "Draw it as pure black outlines on a plain white background, one icon,",
    "centred, filling the frame, even stroke weight, no fills, no shading, no",
    "colour, no text, no label, no drop shadow, no frame or border around it.",
    "Prefer the ordinary reading of the concept and the fewest elements that",
    "carry it. Output only the image.",
  ]
    .filter(Boolean)
    .join("\n");

const sketch = async (
  model: string,
  refs: Buffer[],
  text: string,
  abortSignal?: AbortSignal
): Promise<{ cost: ApiCost; image: Buffer }> => {
  abortSignal?.throwIfAborted();
  const costTracker = gatewayCostTracker();
  const result = await generateText({
    abortSignal,
    messages: [
      {
        content: [
          {
            text: "Reference icons from the set this icon joins:",
            type: "text",
          },
          ...refs.map(
            (data) => ({ data, mediaType: "image/png", type: "file" }) as const
          ),
          { text, type: "text" },
        ],
        role: "user",
      },
    ],
    model: resolveModel(model),
    // Gemini's image models are language models that may answer in either
    // modality; without this they reply with a paragraph describing an icon.
    providerOptions: { google: { responseModalities: ["IMAGE"] } },
  });
  costTracker.record(result.providerMetadata);
  const image = result.files.find((f) => f.mediaType.startsWith("image/"));
  if (!image) {
    throw new ProposalError(
      `${model} returned no image (finish reason: ${result.finishReason}). ` +
        "The arm cannot fall back to drawing from the concept silently — that " +
        "would quietly turn a treatment run into a control run."
    );
  }
  return {
    cost: await costTracker.measure({
      fallbackUsd: IMAGE_RATES[model],
      model,
      operation: "proposal-image",
      usage: tokenUsageOf(result.totalUsage),
    }),
    image: Buffer.from(image.uint8Array),
  };
};

/**
 * Propose a composition for one concept.
 *
 * Every icon shown to the image model came in through `corpus`, which is
 * `Reference[]` — the branded type whose sole constructor is `asReference`. So
 * the eval's held-out filter and the licence gate both apply to this call
 * without this module reimplementing either, and there is no disk read here
 * that could route round them.
 */
export const propose = async (
  concept: Concept,
  options: ProposalOptions
): Promise<ProposalRun> => {
  const {
    abortSignal,
    corpus,
    ideas = DEFAULT_IDEAS,
    ideationModel = IDEATION_MODEL,
    manifest,
    parts = [],
    qualityModel = null,
    readerModel = READER_MODEL,
  } = options;
  abortSignal?.throwIfAborted();
  const startedAt = Date.now();

  const slots = referenceSet(corpus, {
    concept: concept.name,
    manifest,
    tags: concept.tags,
  });
  if (slots.all.length === 0) {
    throw new ProposalError(
      `no reference icons available for "${concept.name}". A proposal drawn ` +
        "with no view of the set is the internet's median icon, which is the " +
        "thing this arm exists to avoid."
    );
  }
  const refs = await Promise.all(slots.all.map((r) => png(r.svg, 96)));
  const text = brief(concept);

  const models = [
    ...Array.from({ length: Math.max(1, ideas) }, () => ideationModel),
    ...(qualityModel ? [qualityModel] : []),
  ];
  const sketches = await Promise.all(
    models.map((m) => sketch(m, refs, text, abortSignal))
  );
  const images = sketches.map((item) => item.image);
  const costs = sketches.map((item) => item.cost);

  const picked =
    images.length === 1
      ? { index: 0, reason: null }
      : await critique(concept, images, refs, { abortSignal });
  if (picked.cost) {
    costs.push(picked.cost);
  }

  const rates = models.map((m) => IMAGE_RATES[m]);
  return {
    chosen: picked.index,
    costs,
    images,
    models,
    ms: Date.now() - startedAt,
    proposal: await compose(images[picked.index], {
      abortSignal,
      model: readerModel,
      onCost: (cost) => costs.push(cost),
      parts,
    }),
    reason: picked.reason,
    references: slots.all.map((r) => r.name),
    usd: rates.some((r) => r === undefined)
      ? null
      : rates.reduce((a, b) => a + b, 0),
  };
};

/** The shape both arms are reached through: `eval.ts`'s `GenerateFn`, written
 *  structurally rather than imported, so the arm does not depend on the eval
 *  module it is measured by. */
export type GenerateLike = (
  concept: Concept,
  options: GenerateOptions
) => Promise<GenerateResult>;

export interface ArmOptions extends Omit<ProposalOptions, "corpus" | "parts"> {
  /** Called with each proposal run, so a caller can bank the spend and keep
   *  the sketches. The arm reports its own cost rather than folding it into
   *  the generation's token bill, which would make the two arms' `usd`
   *  incomparable in exactly the place the comparison happens. */
  onProposal?: (concept: Concept, run: ProposalRun) => void;
  /** Swapped in tests; the real one is `generate`. */
  generate?: GenerateLike;
  /** Swapped in tests; the real one is `propose`. The seam is here rather than
   *  in an env flag so there is no configuration under which a production run
   *  silently proposes nothing. */
  propose?: (
    concept: Concept,
    options: ProposalOptions
  ) => Promise<ProposalRun>;
}

/**
 * The treatment arm as a `GenerateFn`.
 *
 * It takes the corpus and the vocabulary from the options the eval already
 * passes, so the icons conditioning the proposal are exactly the icons the
 * drawer may compare against — the same held-out set, filtered once.
 */
export const proposalArm =
  (options: ArmOptions = {}): GenerateLike =>
  async (concept, generateOptions) => {
    const {
      generate: gen = generate,
      onProposal,
      propose: ask = propose,
      ...rest
    } = options;
    const run = await ask(concept, {
      ...rest,
      abortSignal: generateOptions.abortSignal,
      corpus: generateOptions.corpus ?? [],
      parts: generateOptions.parts,
    });
    onProposal?.(concept, run);
    return await gen(concept, { ...generateOptions, proposal: run.proposal });
  };
