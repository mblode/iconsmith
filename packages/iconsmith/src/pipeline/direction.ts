/**
 * Directional consistency: does the set agree on which way a diagonal runs?
 *
 * The rule under test is the article's most distinctive: a pointer runs
 * bottom-left to top-right, so everything that could go either way runs that
 * way too, and a slash runs the other way because it cancels a direction. Its
 * own justification is that nobody reads it off the screen — which makes it a
 * claim about set-level coherence, settleable by counting and not by looking.
 *
 * **What is measured.** A diagonal's *axis*, not its arrowhead. The angle is
 * taken undirected, in [0°, 180°), so it does not depend on which end of the
 * line the path happened to start from. In SVG coordinates y grows downward, so
 * an angle above 90° rises to the right and one below 90° falls to the right.
 *
 * That choice does the work the brief asks for. `arrow-up-right` and
 * `arrow-down-left` are the same line with the arrowhead at opposite ends, so
 * both measure as rising and neither is flagged against the other. Only a
 * genuinely different orientation registers as a difference, which is the
 * population where direction was arbitrary.
 *
 * **What is not measured.** Only straight segments count. A diagonal drawn as a
 * curve — a swoosh, an arc — is invisible here, and a circle would otherwise
 * contribute equal rising and falling length and drown the signal. Icons whose
 * only diagonal is curved are reported as having none rather than guessed at.
 */
import type { CorpusIcon } from "../corpus/load.js";
import { parsePath } from "../geometry/path.js";
import type { Direction, Run } from "../geometry/segments.js";
import { isDiagonal, straightRuns } from "../geometry/segments.js";
import { clusterIcon, elementsOf } from "./modifiers.js";

export type { Direction } from "../geometry/segments.js";
export { isDiagonal } from "../geometry/segments.js";

/** Share of the live area's diagonal a segment must span to be a slash: a mark
 *  that crosses the whole icon rather than sitting inside it. */
const SLASH_SPAN = 0.6;
/** The live area is 20x20 inside the 2px safe margin, per Central's own grid. */
const LIVE = 20;
const LIVE_DIAGONAL = Math.SQRT2 * LIVE;
/** Rising and falling lengths within this ratio of each other are a draw. */
const BALANCED = 1.25;
/** Size ratio before two marks count as "different size" for composition. */
const COMPOSITION_RATIO = 1.3;

export type Segment = Run;

/** Every straight segment of an icon, with its undirected angle. */
export const straightSegments = (icon: CorpusIcon): Segment[] =>
  straightRuns(icon.shapes.flatMap((shape) => parsePath(shape.d)));

export interface IconDirection {
  /** Total length of falling diagonal (top-left → bottom-right). */
  falling: number;
  /** Which way the icon reads overall. */
  direction: Direction;
  icon: string;
  /** Longest single diagonal segment. */
  longest: number;
  /** The name states a diagonal direction, so its axis is not arbitrary. */
  named: Direction | null;
  /** Total length of rising diagonal (bottom-left → top-right). */
  rising: number;
  /** Named as a slash: `-off`, `-slash`, `no-*`. Unambiguous. */
  slashByName: boolean;
  /** Has a diagonal crossing most of the live area. A weaker signal — a long
   *  diagonal is not always a slash — so it is kept apart from the name test. */
  slashBySpan: boolean;
}

/** `arrow-up-right` and `arrow-down-left` name the same axis. */
const RISING_NAMES = [
  ["up", "right"],
  ["down", "left"],
  ["top", "right"],
  ["bottom", "left"],
];
const FALLING_NAMES = [
  ["up", "left"],
  ["down", "right"],
  ["top", "left"],
  ["bottom", "right"],
];

const hasPair = (tokens: string[], pairs: string[][]): boolean =>
  pairs.some(([a, b]) => {
    const i = tokens.indexOf(a);
    return i !== -1 && tokens[i + 1] === b;
  });

/**
 * The axis an icon's *name* commits it to, if any.
 *
 * Only adjacent tokens count: `arrow-up-right` names an axis, `arrow-up` beside
 * a `right` three tokens away does not. Icons with a named axis are excluded
 * from the arbitrary population — a set needs both `arrow-up-right` and
 * `arrow-up-left`, and reporting them as a disagreement would be noise.
 */
export const namedAxis = (icon: string): Direction | null => {
  const tokens = icon.split("-");
  if (hasPair(tokens, RISING_NAMES)) {
    return "rising";
  }
  return hasPair(tokens, FALLING_NAMES) ? "falling" : null;
};

const SLASH_NAME =
  /(?<slash>^no-|-slash$|-off$|-disabled$|-mute$|-muted$|^mute-|^off-)/u;

export const measureIcon = (icon: CorpusIcon): IconDirection => {
  const diagonals = straightSegments(icon).filter((s) => isDiagonal(s));
  let rising = 0;
  let falling = 0;
  let longest = 0;
  for (const s of diagonals) {
    if (s.angle > 90) {
      rising += s.length;
    } else {
      falling += s.length;
    }
    longest = Math.max(longest, s.length);
  }

  let direction: Direction = "none";
  if (rising > 0 || falling > 0) {
    const hi = Math.max(rising, falling);
    const lo = Math.min(rising, falling);
    if (lo > 0 && hi / lo <= BALANCED) {
      direction = "balanced";
    } else {
      direction = rising > falling ? "rising" : "falling";
    }
  }

  return {
    direction,
    falling,
    icon: icon.symbol,
    longest,
    named: namedAxis(icon.symbol),
    rising,
    slashByName: SLASH_NAME.test(icon.symbol),
    slashBySpan: longest >= SLASH_SPAN * LIVE_DIAGONAL,
  };
};

type Quadrant = "bottom-left" | "bottom-right" | "top-left" | "top-right";

export interface Composition {
  icon: string;
  /** Where the smaller mark sits relative to the larger. */
  quadrant: Quadrant;
  /** The smaller mark sits up and to the right of the larger one. */
  smallerTopRight: boolean;
}

/**
 * Where the smaller of two marks sits relative to the larger.
 *
 * Reported separately and with low confidence, deliberately. "Two elements of
 * different size" is a description of a drawing, not of geometry: an icon with
 * a body and a badge matches it, and so does one whose base happens to be drawn
 * in two pieces. Only icons that split cleanly into exactly two marks of
 * clearly different size are counted, which is a narrow and slightly arbitrary
 * subset of what the rule is about.
 */
export const measureComposition = (icon: CorpusIcon): Composition | null => {
  const clusters = clusterIcon(elementsOf(icon));
  if (clusters.length !== 2) {
    return null;
  }
  const [small, large] = clusters;
  const smallSpan = Math.max(small.extent.w, small.extent.h);
  const largeSpan = Math.max(large.extent.w, large.extent.h);
  if (largeSpan / smallSpan < COMPOSITION_RATIO) {
    return null;
  }
  // Up is a smaller y; right is a larger x.
  const right = small.centre[0] > large.centre[0];
  const top = small.centre[1] < large.centre[1];
  return {
    icon: icon.symbol,
    quadrant: `${top ? "top" : "bottom"}-${right ? "right" : "left"}`,
    smallerTopRight: right && top,
  };
};
