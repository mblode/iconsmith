/**
 * House paint recipes: how outlined and filled actually differ.
 *
 * Measured from the 20-set (heart, star, home, bell, check, plus-large,
 * clock, lock, …). A recipe names a construction, not a glyph to volunteer
 * for an unasked name — `recipeFor` only fires when a content token of the
 * query is the recipe. Analog resolves that id to a family in both paints
 * (`checkmark` draws the house check; `home` draws the pentagon; `heart`
 * draws the lobes). `star` and host glyphs stay unknown.
 *
 * The model never emits a coordinate. These sentences steer `listParts`,
 * the per-icon brief, and the skill toward the programs compile already
 * reads off house files: evenodd compounds, hole-immediately-after-ring,
 * open strokes vs a solid plus, clock disc+hands, check badge+cutout,
 * heart lobes. `star` stays a holdout — analog must not volunteer a
 * diamond or a chevron for that name.
 */
import type { Finish } from "../types.js";
import { tokens } from "./search.js";

export interface PaintRecipe {
  readonly filled: string;
  readonly id: string;
  readonly outlined: string;
  readonly tokens: readonly string[];
}

export const PAINT_RECIPES: readonly PaintRecipe[] = [
  {
    filled:
      "one evenodd plus, or two 2-wide rects on the same centre-lines, each bar half a stroke past both endpoints. Not two `line`s, and not a flood of the bbox.",
    id: "plus",
    outlined:
      "two open strokes crossing at the centre (or four from the hub). Not a box.",
    tokens: ["plus"],
  },
  {
    filled:
      "a solid disc with the hands cut out (evenodd). Draw `hole` immediately after the disc — hands on top of a filled face bury, and a ring restamped as a disc is not a clock.",
    id: "clock",
    outlined:
      "a ring (`circle`) plus hands as a polyline from the centre. Not a bare disc.",
    tokens: ["clock"],
  },
  {
    filled:
      "a badge disc with the tick cut out (evenodd). Not a thick tick, and not a tick drawn on top of a disc.",
    id: "check",
    outlined: "an open tick stroke. Not a badge.",
    tokens: ["check", "tick", "checkmark"],
  },
  {
    filled:
      "`circle` then `hole circle` immediately after. A mark between them ships a solid disc; `fit` to the same keyline does not hide a missing knockout.",
    id: "ring",
    outlined: "a `circle` (centre-line hoop).",
    tokens: ["ring"],
  },
  {
    filled:
      "one evenodd compound: body, shackle hole, keyhole. Knock each hole immediately after the solid it cuts.",
    id: "lock",
    outlined:
      "shackle, body, and a keyhole mark as separate strokes — not one slab.",
    tokens: ["lock"],
  },
  {
    filled:
      "one evenodd pentagon: peaked roof sitting on the body. Not a frame-and-dot, not a diamond through the walls, and not a door nobody asked for.",
    id: "home",
    outlined:
      "one closed pentagon — roof peak and walls as the outer stroke. Not a box, and not a roof drawn through the body.",
    tokens: ["home"],
  },
  {
    filled:
      "one evenodd compound of two lobes and a point. Not a disc, and not three circles restamped as solids.",
    id: "heart",
    outlined:
      "two lobes and a point as one silhouette (house compile is one evenodd compound). Not three circles.",
    tokens: ["heart"],
  },
];

/**
 * Names analog must not volunteer a glyph for. A diamond is a compass
 * needle; a chevron or four diamonds is not the house star.
 */
const HOLDOUTS: Readonly<Record<string, string>> = {
  star: "Do not volunteer a star glyph. A diamond is a compass needle; a chevron or four diamonds is not the house star.",
};

const recipeTokens = (query: string): string[] =>
  tokens(query).filter((t) => t.length > 0 && !/^\d+$/u.test(t));

/** The recipe a query asked for, or null. Two recipe tokens stay null. */
export const recipeFor = (query: string): PaintRecipe | null => {
  const want = recipeTokens(query);
  const found: PaintRecipe[] = [];
  for (const recipe of PAINT_RECIPES) {
    if (want.some((token) => recipe.tokens.includes(token))) {
      found.push(recipe);
    }
  }
  return found.length === 1 ? (found[0] ?? null) : null;
};

/** One sentence for the paint this run is drawing. */
export const recipeBrief = (
  query: string,
  finish: Finish = "outlined"
): string | null => {
  const recipe = recipeFor(query);
  if (!recipe) {
    return null;
  }
  const how = finish === "filled" ? recipe.filled : recipe.outlined;
  return `House construction (${recipe.id}, ${finish}): ${how}`;
};

/** A holdout the query asked for, or null. Two content tokens stay null. */
export const holdoutBrief = (query: string): string | null => {
  const want = recipeTokens(query);
  if (want.length !== 1) {
    return null;
  }
  return HOLDOUTS[want[0] ?? ""] ?? null;
};

/** Recipe or holdout for this query — what `listParts` and the brief share. */
export const steerBrief = (
  query: string,
  finish: Finish = "outlined"
): string | null => recipeBrief(query, finish) ?? holdoutBrief(query);
