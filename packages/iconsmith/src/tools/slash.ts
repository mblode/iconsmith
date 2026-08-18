/**
 * The slash rule: a slash runs top-left to bottom-right.
 *
 * This is the one directional convention the shipped set already keeps
 * perfectly — 11 of 11 icons named `-off`, `-slash` or `no-*` in the base
 * variant run falling, none run rising. Encoding a rule the set already passes
 * costs nothing today and is the only moment it is free; the alternative is
 * discovering in a year that it decayed to 9 of 14 and arguing about which nine
 * were right.
 *
 * The justification for the rule itself is not legibility — nobody reads
 * direction off a 24px icon. It is that a slash cancels a direction, so it
 * should cut against the direction everything else runs.
 */
import { parsePath } from "../geometry/path.js";
import { directionOf, straightRuns } from "../geometry/segments.js";
import type { Issue } from "../types.js";

/** Names that declare an icon a slash. */
const SLASH_NAME =
  /(?<slash>^no-|-slash$|-off$|-disabled$|-mute$|-muted$|^mute-|^off-)/u;

export const isSlashName = (icon: string): boolean => SLASH_NAME.test(icon);

/** The shape this rule needs: drawn path data with a name to blame. */
export interface SlashTarget {
  elements: { d: string; id: string }[];
}

export interface SlashOptions {
  /** The icon's name. Without it there is nothing to identify a slash by. */
  icon: string;
}

/**
 * Check a slash-named icon's diagonal.
 *
 * Only fires on icons the *name* declares to be slashes. A long diagonal
 * elsewhere is not a slash — measured across the corpus, icons with a
 * live-area-crossing diagonal that are not named as one run 15 rising to 12
 * falling, near enough a coin toss that treating them as slashes would flag
 * half of them at random.
 */
export const slashRule = (
  target: SlashTarget,
  { icon }: SlashOptions
): Issue[] => {
  if (!isSlashName(icon)) {
    return [];
  }
  const runs = straightRuns(target.elements.flatMap((e) => parsePath(e.d)));
  const direction = directionOf(runs);

  if (direction === "rising") {
    return [
      {
        message: `"${icon}" is a slash but its diagonal rises left-to-right. A slash cancels a direction, so it runs the other way: top-left to bottom-right. Mirror it horizontally.`,
        rule: "slash-direction",
        severity: "error",
      },
    ];
  }
  if (direction === "balanced") {
    return [
      {
        message: `"${icon}" is a slash but draws both diagonals about equally, so no direction reads. One of them should dominate, running top-left to bottom-right.`,
        rule: "slash-direction",
        severity: "warn",
      },
    ];
  }
  // "none" is not a violation: a slash drawn as a curve has no straight run to
  // measure, and guessing at one would invent a defect.
  return [];
};
