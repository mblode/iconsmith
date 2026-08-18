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
import type { Corpus, CorpusIcon } from "../corpus/load.js";
import { parsePath } from "../geometry/path.js";
import { clusterIcon, elementsOf } from "./modifiers.js";

/** Below this a segment is a join artefact, not a diagonal anyone drew. */
const MIN_LENGTH = 1.5;
/** Degrees off horizontal or vertical before a segment counts as diagonal. A
 *  2px stroke on a 24px canvas makes anything under this read as a wobble in a
 *  straight line rather than as a slant. */
const MIN_OFF_AXIS = 15;
/** Share of the live area's diagonal a segment must span to be a slash: a mark
 *  that crosses the whole icon rather than sitting inside it. */
const SLASH_SPAN = 0.6;
/** The live area is 20×20 inside the 2px safe margin, per Central's own grid. */
const LIVE = 20;
const LIVE_DIAGONAL = Math.SQRT2 * LIVE;
/** Rising and falling lengths within this ratio of each other are a draw. */
const BALANCED = 1.25;
/** Size ratio before two marks count as "different size" for composition. */
const COMPOSITION_RATIO = 1.3;

export type Direction = "balanced" | "falling" | "none" | "rising";

export interface Segment {
  /** Undirected angle in [0, 180). Above 90 rises to the right. */
  angle: number;
  length: number;
}

/** Every straight segment of an icon, with its undirected angle. */
export const straightSegments = (icon: CorpusIcon): Segment[] => {
  const out: Segment[] = [];
  for (const shape of icon.shapes) {
    for (const sp of parsePath(shape.d)) {
      let cur = sp.start;
      for (const s of sp.segs) {
        if (s.t === "L") {
          const dx = s.p[0] - cur[0];
          const dy = s.p[1] - cur[1];
          let angle = (Math.atan2(dy, dx) * 180) / Math.PI;
          if (angle < 0) {
            angle += 180;
          }
          out.push({ angle: angle % 180, length: Math.hypot(dx, dy) });
          cur = [s.p[0], s.p[1]];
        } else if (s.t === "C") {
          cur = [s.p[4], s.p[5]];
        } else {
          cur = [s.p[5], s.p[6]];
        }
      }
    }
  }
  return out;
};

const offAxis = (angle: number): number =>
  Math.min(angle, Math.abs(angle - 90), Math.abs(180 - angle));

export const isDiagonal = (s: Segment): boolean =>
  s.length >= MIN_LENGTH && offAxis(s.angle) >= MIN_OFF_AXIS;

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

export type Quadrant =
  | "bottom-left"
  | "bottom-right"
  | "top-left"
  | "top-right";

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

export interface DirectionCensus {
  /** Icons with a diagonal whose name does not commit it to an axis. */
  arbitrary: { balanced: number; falling: number; rising: number };
  /** Composition check, low confidence. Counts per quadrant the smaller mark
   *  sits in, which says more than the single top-right share. */
  composition: {
    of: number;
    quadrants: Record<Quadrant, number>;
    smallerTopRight: number;
  };
  /** Icons whose family draws the same concept both ways. */
  disagreeing: { family: string; falling: string[]; rising: string[] }[];
  /** Icons with a named axis, which are not evidence either way. */
  named: { falling: number; rising: number };
  /** Every measured icon, for drilling in. */
  icons: IconDirection[];
  /** Icons with no straight diagonal at all. */
  noDiagonal: number;
  /** Icons named as a slash. The clean population. */
  slashesByName: {
    balanced: number;
    falling: number;
    rising: number;
    total: number;
  };
  /** Icons with a live-area-crossing diagonal that are not named as a slash. */
  slashesBySpan: {
    balanced: number;
    falling: number;
    rising: number;
    total: number;
  };
  symbols: number;
}

/** The family key: everything before the first hyphen. */
const familyOf = (icon: string): string => icon.split("-")[0];

const count = (xs: IconDirection[], d: Direction): number =>
  xs.filter((i) => i.direction === d).length;

export interface CensusOptions {
  corpus: Corpus;
  variant?: string;
}

export const HOUSE_VARIANT = "round-outlined-radius-3-stroke-2";

export const census = async (
  options: CensusOptions
): Promise<DirectionCensus> => {
  const { corpus, variant = HOUSE_VARIANT } = options;
  const symbols = corpus.symbols.filter((s) => corpus.has(s, variant));
  const loaded = await Promise.all(
    symbols.map(async (s) => await corpus.load(s, variant))
  );

  const icons = loaded.map((i) => measureIcon(i));
  const compositions = loaded
    .map((i) => measureComposition(i))
    .filter((c): c is Composition => c !== null);

  const withDiagonal = icons.filter((i) => i.direction !== "none");
  const slashes = withDiagonal.filter((i) => i.slashByName);
  const spanning = withDiagonal.filter((i) => !i.slashByName && i.slashBySpan);
  const rest = withDiagonal.filter((i) => !(i.slashByName || i.slashBySpan));
  const named = rest.filter((i) => i.named !== null);
  const arbitrary = rest.filter((i) => i.named === null);

  // A family that draws the same concept both ways, once names that justify an
  // axis are set aside. This is the population where the choice was free.
  const byFamily = new Map<string, IconDirection[]>();
  for (const i of arbitrary) {
    const key = familyOf(i.icon);
    byFamily.set(key, [...(byFamily.get(key) ?? []), i]);
  }
  const disagreeing = [...byFamily]
    .map(([family, members]) => ({
      falling: members
        .filter((m) => m.direction === "falling")
        .map((m) => m.icon),
      family,
      rising: members
        .filter((m) => m.direction === "rising")
        .map((m) => m.icon),
    }))
    .filter((f) => f.rising.length > 0 && f.falling.length > 0)
    .toSorted(
      (a, b) =>
        b.rising.length +
        b.falling.length -
        (a.rising.length + a.falling.length)
    );

  return {
    arbitrary: {
      balanced: count(arbitrary, "balanced"),
      falling: count(arbitrary, "falling"),
      rising: count(arbitrary, "rising"),
    },
    composition: {
      of: compositions.length,
      quadrants: {
        "bottom-left": compositions.filter((c) => c.quadrant === "bottom-left")
          .length,
        "bottom-right": compositions.filter(
          (c) => c.quadrant === "bottom-right"
        ).length,
        "top-left": compositions.filter((c) => c.quadrant === "top-left")
          .length,
        "top-right": compositions.filter((c) => c.quadrant === "top-right")
          .length,
      },
      smallerTopRight: compositions.filter((c) => c.smallerTopRight).length,
    },
    disagreeing,
    icons,
    named: {
      falling: count(named, "falling"),
      rising: count(named, "rising"),
    },
    noDiagonal: icons.filter((i) => i.direction === "none").length,
    slashesByName: {
      balanced: count(slashes, "balanced"),
      falling: count(slashes, "falling"),
      rising: count(slashes, "rising"),
      total: slashes.length,
    },
    slashesBySpan: {
      balanced: count(spanning, "balanced"),
      falling: count(spanning, "falling"),
      rising: count(spanning, "rising"),
      total: spanning.length,
    },
    symbols: symbols.length,
  };
};

const share = (n: number, of: number): string =>
  of === 0 ? "n/a" : `${((100 * n) / of).toFixed(1)}%`;

export const formatCensus = (c: DirectionCensus): string => {
  const arb = c.arbitrary.rising + c.arbitrary.falling + c.arbitrary.balanced;
  const decided = c.arbitrary.rising + c.arbitrary.falling;
  const lines = [
    `directional census — ${c.symbols} symbols, ${c.symbols - c.noDiagonal} with a straight diagonal`,
    "",
    `  ARBITRARY (${arb}) — a diagonal the name does not commit to an axis`,
    `    rising    ${String(c.arbitrary.rising).padStart(4)}  ${share(c.arbitrary.rising, decided)} of decided`,
    `    falling   ${String(c.arbitrary.falling).padStart(4)}  ${share(c.arbitrary.falling, decided)} of decided`,
    `    balanced  ${String(c.arbitrary.balanced).padStart(4)}  both ways within a quarter`,
    "",
    `  NAMED (${c.named.rising + c.named.falling}) — the name states the axis, so not evidence`,
    `    rising    ${String(c.named.rising).padStart(4)}`,
    `    falling   ${String(c.named.falling).padStart(4)}`,
    "",
    `  SLASHES BY NAME (${c.slashesByName.total}) — \`-off\`, \`-slash\`, \`no-*\``,
    `    rising    ${String(c.slashesByName.rising).padStart(4)}`,
    `    falling   ${String(c.slashesByName.falling).padStart(4)}  ${share(c.slashesByName.falling, c.slashesByName.rising + c.slashesByName.falling)} of decided`,
    `    balanced  ${String(c.slashesByName.balanced).padStart(4)}`,
    "",
    `  LONG DIAGONALS not named as a slash (${c.slashesBySpan.total}) — weaker signal`,
    `    rising    ${String(c.slashesBySpan.rising).padStart(4)}`,
    `    falling   ${String(c.slashesBySpan.falling).padStart(4)}  ${share(c.slashesBySpan.falling, c.slashesBySpan.rising + c.slashesBySpan.falling)} of decided`,
    `    balanced  ${String(c.slashesBySpan.balanced).padStart(4)}`,
    "",
    `  COMPOSITION (low confidence) — ${c.composition.of} icons split into two marks of different size`,
    ...(Object.entries(c.composition.quadrants) as [Quadrant, number][])
      .toSorted((a, b) => b[1] - a[1])
      .map(
        ([q, n]) =>
          `    smaller sits ${q.padEnd(13)} ${String(n).padStart(4)}  ${share(n, c.composition.of)}`
      ),
  ];

  if (c.disagreeing.length > 0) {
    lines.push(
      "",
      `  ${c.disagreeing.length} famil(ies) draw the same concept both ways:`
    );
    for (const f of c.disagreeing.slice(0, 12)) {
      lines.push(
        `    ${f.family}: rising ${f.rising.join(", ")} | falling ${f.falling.join(", ")}`
      );
    }
  }
  return lines.join("\n");
};
