/**
 * The system prompt: the house spec and the DSL grammar, in the model's words.
 *
 * The prose lives in `policy.default.json` and is rendered by `policy.ts`, so
 * that a self-improvement loop can add, remove, reword and reorder individual
 * principles and measure the effect. What stays here is everything the policy
 * cannot hold: the `SPEC` numbers, the per-run cohort measurements, and the
 * per-icon brief.
 *
 * Every number is still read out of `SPEC` rather than typed into the prose. A
 * prompt that restates the spec from memory drifts away from the code that
 * enforces it, and the model then spends turns fighting `lint` over rules the
 * prompt told it were different. One source, formatted twice.
 */
import { SPEC } from "../tools/canvas.js";
import type { Spec } from "../tools/canvas.js";
import type { CohortTarget } from "../tools/cohort.js";
import type { Finish, Keyline } from "../types.js";
import { hostConstruction } from "./analog.js";
import type { Reference } from "./licence.js";
import type { Condition, Policy, Tokens } from "./policy.js";
import { DEFAULT_POLICY, renderPolicy } from "./policy.js";
import { steerBrief } from "./recipe.js";

export interface Concept {
  /** Category from the host set, when the concept comes from one. */
  category?: string;
  /** Per-concept art direction; does not change the selected family or judge. */
  guidance?: string;
  /** Icon name, kebab-case: the thing to draw. */
  name: string;
  /**
   * A reference icon to work *from*, not to copy — its geometry is off-spec.
   *
   * `Reference` rather than a raw SVG string: this drawing is pasted verbatim
   * into the per-icon brief, which makes it the most direct route there is from
   * a file on disk to a model's context. A string would accept any of the
   * 23,731 third-party drawings; the branded type accepts only what
   * `asReference` has passed.
   */
  reference?: Reference;
  /** Synonyms and neighbouring senses; they disambiguate the concept. */
  tags?: string[];
}

const list = (o: Record<string, number>): string =>
  Object.entries(o)
    .map(([k, v]) => `${k} = ${v}`)
    .join(", ");

const keylines = (spec: Spec): string =>
  Object.entries(spec.keylines)
    .map(([k, [w, h]]) => `- \`${k}\` — ${w}×${h}`)
    .join("\n");

/** The family a new icon joins, with the extent its members measurably occupy. */
export interface CohortBrief {
  extent: CohortTarget;
  /** Members the icon will be swapped with, for the model's sense of the set. */
  members?: string[];
  name: string;
}

const axis = (t: [number, number] | null, name: string): string =>
  t
    ? `- ${name} spans ${t[0].toFixed(2)}..${t[1].toFixed(2)}.`
    : `- ${name} has no agreed extent in this family; centre it.`;

/** Paint construction rules shared by generated author prompts. */
const OUTLINED_PAINT_RULE =
  "Outlined bodies use centerlines; explicit solid modifiers and named detail roles are allowed when supported by the house family. Author the filled counterpart from its body, structural counters and modifier polarity; it is not always mechanical outline expansion.";

/** Filled authoring retains explicit open-stroke and counter semantics. */
export const FILLED_PAINT_RULE =
  "This run is the solid variant: a shape is its silhouette, interior canvas is `hole`, and open `line` and `arc` strokes expand through the host. Occupy the same visual extent the outline would — preserve structural openings and identifying details; do not flood the bbox. A ring is `circle` then `hole` immediately after; a plus is an evenodd compound or unioned expanded lines; a clock is a disc with hands cut out; a check is a badge with a cutout; a heart is one evenodd compound of lobes, not a disc. Do not volunteer a star from diamonds.";

export interface PromptOptions {
  /** The family the icon joins, when it joins one; enables the `cohort` op. */
  cohort?: CohortBrief | null;
  /**
   * Which paint this run draws. Supplies `{{paintRule}}` so the house
   * stroke sentence is true for this canvas, not a description of the
   * other variant. Default outlined, matching `generate`.
   */
  finish?: Finish;
  /** Forces a keyline instead of letting the model pick. */
  keyline?: Keyline | null;
  /**
   * The design language to render. A variant policy is how an experiment is
   * run: build it from `DEFAULT_POLICY` with `setEnabled`/`replacePrinciple`
   * and pass it here. Defaults to the house policy.
   */
  policy?: Policy;
  /** Whether this run carries a raster proposal; enables the `proposal` op. */
  proposal?: boolean;
  spec?: Spec;
}

/**
 * The system prompt: the house spec and the DSL grammar, in the model's words.
 *
 * The prose is `policy.default.json`; this function supplies the numbers and
 * the run's conditions. Every number is still read out of `SPEC` rather than
 * typed into the prose, for the reason the file header gives — the policy holds
 * `{{stroke}}`, not `2`, so a reworded principle cannot restate the spec wrong.
 */
/**
 * The confirm-only system prompt. Generate uses this when the host analog
 * is already on the canvas and draw tools are withheld — the full policy
 * would spend thousands of tokens teaching a grammar the model cannot
 * use, and that prefix is what blew the OpenRouter prompt-token cap.
 * Numbers still come from `SPEC`.
 */
export const confirmSystemPrompt = (
  opts: Pick<PromptOptions, "finish" | "spec"> = {}
): string => {
  const spec = opts.spec ?? SPEC;
  return [
    `The canvas is ${spec.canvas}×${spec.canvas}. Stroke ${spec.stroke}. Radius ${spec.radius}.`,
    opts.finish === "filled"
      ? "Paint: filled. The analog is already the solid silhouette."
      : "Paint: outlined. The analog is already the centre-line stroke.",
    "Call confirm. Do not invent geometry.",
  ].join("\n");
};

export const systemPrompt = (opts: PromptOptions = {}): string => {
  const spec = opts.spec ?? SPEC;
  const conditions: Condition[] = [];
  const tokens: Tokens = {
    canvas: String(spec.canvas),
    clearance: String(spec.clearance),
    dots: list(spec.dots),
    grid: String(spec.grid),
    keylines: keylines(spec),
    maxElements: String(spec.maxElements),
    minFeature: String(spec.minFeature),
    minGap: String(spec.minGap),
    paintRule:
      opts.finish === "filled" ? FILLED_PAINT_RULE : OUTLINED_PAINT_RULE,
    radius: String(spec.radius),
    radiusTiers: spec.radiusTiers.join(", "),
    size: String(spec.size),
    stroke: String(spec.stroke),
  };
  if (opts.proposal) {
    conditions.push("proposal");
  }
  if (opts.cohort) {
    conditions.push("cohort");
    tokens.cohortName = opts.cohort.name;
    tokens.cohortMembers = opts.cohort.members?.length
      ? `, alongside ${opts.cohort.members.join(", ")}`
      : "";
    tokens.cohortX = axis(opts.cohort.extent.x, "x");
    tokens.cohortY = axis(opts.cohort.extent.y, "y");
  }
  if (opts.keyline) {
    conditions.push("keyline");
    tokens.keyline = opts.keyline;
  }
  return renderPolicy(opts.policy ?? DEFAULT_POLICY, { conditions, tokens });
};

/** The per-icon brief. Deliberately thin: name, paint, senses, and — when
 *  the concept comes from an existing set — the category, which fixes the
 *  sense far more cheaply than tags do ("mouse" in Devices is not "mouse"
 *  in Nature). Paint belongs here: the system prompt used to describe
 *  outlined on a filled run, and the model then spent turns looking for
 *  `line` on a canvas that had deleted it. */
export const conceptPrompt = (
  concept: Concept,
  finish: Finish = "outlined",
  { allowHouseConstruction = true }: { allowHouseConstruction?: boolean } = {}
): string => {
  const host = allowHouseConstruction
    ? hostConstruction(concept.name, finish)
    : null;
  const lines = [`Draw the icon \`${concept.name}\`.`];
  if (host) {
    // The analog is already on the canvas. "Compose from primitives"
    // is how a seeded heart becomes three circles.
    lines.push(finish === "filled" ? "Paint: filled." : "Paint: outlined.");
  } else if (finish === "filled") {
    lines.push(
      "Paint: filled. A shape is its silhouette; interior canvas is `hole`; open `line` and `arc` strokes expand through the host.",
      "Occupy the same visual extent the outline would — preserve structural openings and identifying details; do not flood the bbox.",
      "Compose the named object from `listParts` and primitives. A frame with a centre dot is not the concept."
    );
  } else {
    lines.push(
      "Paint: outlined. Compose the named object from `listParts` and primitives, not a generic frame-and-dot."
    );
  }
  const steer = allowHouseConstruction
    ? steerBrief(concept.name, finish)
    : null;
  if (host) {
    // The analog is already the construction. The recipe paragraph is
    // how a confirm-only prompt blows a prompt-token cap; the title
    // names the family without restating how to draw it.
    lines.push(
      `House construction (${host.id}, ${finish}).`,
      `The canvas already holds the host ${host.id} analog. Call confirm. Do not add, remove, or redraw it.`
    );
  } else if (steer) {
    lines.push(steer);
  }
  if (concept.guidance) {
    lines.push(`Art direction: ${concept.guidance}`);
  }
  if (concept.category) {
    lines.push(`Category: ${concept.category}.`);
  }
  if (concept.tags?.length) {
    lines.push(`It also means: ${concept.tags.join(", ")}.`);
  }
  if (concept.reference) {
    lines.push(
      "",
      "A reference drawing of this concept follows. Take the *composition* from",
      "it — which elements exist and how they sit together — and nothing else.",
      "Its geometry is off-spec and copying its coordinates is not possible",
      "anyway. Do not treat it as a target to match stroke for stroke.",
      "",
      concept.reference.svg
    );
  }
  return lines.join("\n");
};
