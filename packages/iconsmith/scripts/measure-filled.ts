/**
 * What does the filled set actually draw?
 *
 * `round-filled-radius-3-stroke-2` holds the same 2,085 concepts as the house
 * variant, drawn as solids instead of strokes. Every constant the drawer obeys
 * — the 2-unit clearance, the six keylines, the 1-unit minimum gap, the four
 * radius tiers — was measured off the outlined set, and a solid is not a stroke
 * with the stroke turned off. Two things change at once:
 *
 *   1. **The extent is the geometry.** An outlined icon's visual extent is its
 *      path bbox plus one stroke; a filled icon's is the bbox itself. So the
 *      same drawing, filled, reaches further with the same coordinates, and
 *      every keyline measured against the stroked set is measured against a
 *      different quantity.
 *   2. **White is subtracted, not left.** A stroked icon leaves its counters as
 *      untouched canvas, which is why `minGap` can be a rule about the distance
 *      between two centre-lines. A filled icon cuts them out of a solid, and the
 *      thing that has to stay legible is the ring of ink *around* the hole.
 *
 * Nothing here is a rule. This module measures, prints distributions, and says
 * where the set does not agree with itself; `bench/filled-language.v1.json` is
 * the output and the prose in it is the finding. The measurements reuse
 * `geometry/path.ts`, `parts/shape.ts` and `corpus/measure.ts` rather than
 * restating them, on the same principle as `corpus/record.ts`: a second
 * implementation is how two parts of this repo start disagreeing about one icon.
 *
 * Usage:
 *
 *     npx tsx scripts/measure-filled.ts [bench/filled-language.v1.json]
 *     npm run fix        # the formatter collapses short arrays; this file
 *                        # is written by JSON.stringify, which does not
 */
import { writeFileSync } from "node:fs";

import { HOUSE_VARIANT, loadCorpus, parseIconSvg } from "../src/corpus/load.js";
import { circleRadius, cornerRadii, summarise } from "../src/corpus/measure.js";
import { bbox, parsePath } from "../src/geometry/path.js";
import { flatten } from "../src/parts/shape.js";
import { SPEC } from "../src/tools/canvas.js";
import type { Box, Subpath } from "../src/types.js";

/** The filled twin of the house variant: same 2,085 concepts, same corner tier
 *  and nominal stroke, drawn as solids. */
export const FILLED_VARIANT = "round-filled-radius-3-stroke-2";

/** Segments per curve when flattening for containment and area. Coarser than
 *  fingerprinting needs — a hole only has to be located, not matched. */
const FLATTEN_STEPS = 16;
/** Share of a subpath's vertices that must fall inside another before it counts
 *  as contained. A hole that shares a boundary point with its parent would fail
 *  an all-vertices test; a majority vote does not care. */
const CONTAINMENT_SHARE = 0.6;
/** Below this area a subpath is a rounding artefact, not a drawn shape. */
const MIN_SUBPATH_AREA = 0.01;
/** Rendered size the legibility question is asked at, and the canvas it is
 *  asked about. A 24-unit drawing at 16px scales every distance by 2/3. */
const SMALL_PX = 16;
const UNITS_TO_SMALL_PX = SMALL_PX / SPEC.canvas;
/** A knockout narrower than this many device pixels at 16px has no clear pixel
 *  down its middle once antialiasing has taken a half-pixel off each edge. */
const LEGIBLE_PX = 1;
/** Bucket width for the joint extent histogram, in canvas units. */
const EXTENT_BUCKET = 0.5;
/** How close an extent must come to a keyline, on its worse axis, to count as
 *  conforming. Matches the ±0.5 window `SPEC.keylines` was counted at. */
const KEYLINE_TOLERANCE = 0.5;
/** Share of its own bounding box a cornered, axis-aligned shape must cover
 *  before it counts as a rectangle. A rounded rect of radius 8 in a 20-unit
 *  box covers 0.863; a disc covers 0.785. */
const RECT_FILL = 0.85;
/** How far a straight segment may drift off an axis and still be one, in
 *  units. The grid is 0.25, so anything under it is float noise. */
const AXIS_EPS = 0.01;
/** Radius tier match tolerance, in units. */
const TIER_TOLERANCE = 0.125;
/** How many icons the divergence list reports. */
const TOP_N = 12;
/** Below this clear distance two solids are meeting, not spaced. Matches
 *  `corpus/measure.ts`'s own touching threshold. */
const TOUCHING = 0.01;
/** Largest solid disc still read as a dot rather than a drawn circle. One tier
 *  above `SPEC.dots`'s largest (4), so a 4 is inside the window and a 6-unit
 *  badge is not. */
const DOT_CEILING = 5;

type Point = [number, number];

/** One `<path>`/`<circle>`/`<rect>` element, with the two attributes that
 *  decide how its subpaths combine. */
export interface FilledElement {
  d: string;
  /** `evenodd` or `nonzero` — what turns a nested subpath into a hole. */
  fillRule: "evenodd" | "nonzero";
  hasStroke: boolean;
  /** 0 for a filled shape. Load-bearing: visual extent is the path bbox plus
   *  *this element's own* stroke, half per side, and seven icons in this
   *  variant still carry one. */
  strokeWidth: number;
}

/**
 * What a subpath is, in the vocabulary the drawer already has.
 *
 * `circle` and `rect` are the two primitives `canvas.ts` can emit; `other` is
 * everything a generator would have to reach for `raw()` to draw. The split is
 * the answer to "what can the current primitives express", so it is measured
 * rather than guessed.
 */
export type ShapeClass = "disc" | "other" | "rect";

/** One subpath, placed in the nesting tree its element's fill rule implies. */
export interface SubpathFacts {
  area: number;
  box: Box;
  /** How many other subpaths of the same element contain this one. */
  depth: number;
  /** Which element it was drawn in, so a hole crossing an element boundary is
   *  visible as such. */
  element: number;
  /** Odd depth under `evenodd`; opposite winding to its parent under
   *  `nonzero`. Both are knockouts, and the set uses both. */
  hole: boolean;
  /** Index of the innermost subpath containing this one, within the icon. */
  parent: number | null;
  poly: Point[];
  /** The fill rule of the element this subpath was drawn in. */
  rule: "evenodd" | "nonzero";
  shape: ShapeClass;
  /** +1 anticlockwise, -1 clockwise, in the y-down frame the file is drawn in. */
  winding: number;
}

export interface IconFacts {
  /** Visual extent centre. 12,12 is perfectly centred. */
  centre: [number, number];
  elements: number;
  evenodd: number;
  extent: Box;
  /** Smallest distance from the extent to a canvas edge. */
  margin: number;
  /** Knockouts, whatever construction produced them. */
  holes: SubpathFacts[];
  /** Subpaths wholly inside a solid drawn by another element. The fill rule
   *  cannot reach across elements, and both paint `currentColor`, so these add
   *  no ink: they are geometry that draws nothing. */
  buriedShapes: number;
  solids: SubpathFacts[];
  stroked: number;
  subpaths: SubpathFacts[];
  symbol: string;
}

const ELEMENT = /<(?<tag>path|circle|ellipse|rect|line)\b[^>]*>/gu;
const ATTR = /(?<name>[a-zA-Z-]+)\s*=\s*"(?<value>[^"]*)"/gu;

/**
 * The drawable elements of an icon, with their fill rule.
 *
 * Geometry comes from `parseIconSvg`, which converts `<circle>`, `<rect>`,
 * `<ellipse>` and `<line>` to path data — about 7% of shapes in this set are
 * one of those, and reading only `<path d>` drops them, which shows up as an
 * icon that appears to draw nothing at all. This adds the one attribute that
 * loader has no reason to keep and that is the whole subject here: `fill-rule`.
 *
 * The two scans are zipped by position and checked against each other rather
 * than trusted to agree. A mismatch throws: pairing element 3's fill rule with
 * element 4's geometry would invent knockouts.
 */
export const parseFilledElements = (svg: string): FilledElement[] => {
  const attributes: Record<string, string>[] = [];
  for (const el of svg.matchAll(ELEMENT)) {
    const attrs: Record<string, string> = {};
    for (const a of el[0].matchAll(ATTR)) {
      const g = a.groups;
      if (g) {
        attrs[g.name] = g.value;
      }
    }
    // `parseIconSvg` drops an element that yields no geometry, which for the
    // five tags it knows means a `<path>` with no `d`. Drop the same ones.
    if (el.groups?.tag === "path" && !attrs.d) {
      continue;
    }
    attributes.push(attrs);
  }
  const shapes = parseIconSvg(svg);
  if (shapes.length !== attributes.length) {
    throw new Error(
      `Element scan disagrees with parseIconSvg: ${attributes.length} elements against ${shapes.length} shapes. The two are zipped by position, so this would attach one element's fill rule to another's geometry.`
    );
  }
  return shapes.map((shape, i) => ({
    d: shape.d,
    fillRule: attributes[i]["fill-rule"] === "evenodd" ? "evenodd" : "nonzero",
    hasStroke: shape.strokeWidth > 0,
    strokeWidth: shape.strokeWidth,
  }));
};

/** Shoelace area, signed. Positive is anticlockwise in a y-up frame, which is
 *  clockwise on screen; only the sign's *agreement* between two subpaths is
 *  used, so the convention does not have to be argued about. */
const signedArea = (poly: Point[]): number => {
  let sum = 0;
  for (let i = 0; i < poly.length; i += 1) {
    const [x0, y0] = poly[i];
    const [x1, y1] = poly[(i + 1) % poly.length];
    sum += x0 * y1 - x1 * y0;
  }
  return sum / 2;
};

const inside = (p: Point, poly: Point[]): boolean => {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (
      yi > p[1] !== yj > p[1] &&
      p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi
    ) {
      hit = !hit;
    }
  }
  return hit;
};

/** Is `a` drawn within `b`? A majority vote over `a`'s vertices, so a shared
 *  boundary point does not decide it. */
const contains = (
  b: Point[],
  a: Point[],
  vote = CONTAINMENT_SHARE
): boolean => {
  let n = 0;
  for (const p of a) {
    if (inside(p, b)) {
      n += 1;
    }
  }
  return n / a.length >= vote;
};

const boxOf = (sp: Subpath): Box => bbox([sp]);

const centreOf = (b: Box): Point => [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2];

/** Nearest approach between two polylines, sampled at their vertices. The clear
 *  distance between two solids, and the ring of ink left around a hole. */
const nearestApproach = (a: Point[], b: Point[]): number => {
  let best = Number.POSITIVE_INFINITY;
  for (const p of a) {
    for (const q of b) {
      const d = Math.hypot(p[0] - q[0], p[1] - q[1]);
      if (d < best) {
        best = d;
      }
    }
  }
  return best;
};

const unionBox = (boxes: Box[]): Box => {
  const x0 = Math.min(...boxes.map((b) => b.x0));
  const y0 = Math.min(...boxes.map((b) => b.y0));
  const x1 = Math.max(...boxes.map((b) => b.x1));
  const y1 = Math.max(...boxes.map((b) => b.y1));
  return { h: y1 - y0, w: x1 - x0, x0, x1, y0, y1 };
};

/**
 * Visual extent: each element's own path bbox grown by half of *its own*
 * stroke on every side, then unioned.
 *
 * The same rule `tools/keyline.ts` uses, restated here only because that one
 * takes flattened `Piece`s and this one takes elements. It applies to the
 * filled set too: seven of its icons still carry a stroke, and measuring their
 * bare bbox is what made `people-voice` look 9 units smaller than its outlined
 * twin when the two are in fact the same size.
 */
const visualExtent = (elements: FilledElement[], symbol: string): Box => {
  const boxes = elements.map((e) => {
    const b = bbox(parsePath(e.d, { source: `${symbol}.svg` }));
    const half = e.strokeWidth / 2;
    return {
      h: b.h + e.strokeWidth,
      w: b.w + e.strokeWidth,
      x0: b.x0 - half,
      x1: b.x1 + half,
      y0: b.y0 - half,
      y1: b.y1 + half,
    };
  });
  return boxes.length
    ? unionBox(boxes)
    : { h: 0, w: 0, x0: 0, x1: 0, y0: 0, y1: 0 };
};

/** Straight, and along an axis, within the grid tolerance. */
const axisAligned = (from: Point, to: Point): boolean =>
  Math.abs(from[0] - to[0]) <= AXIS_EPS ||
  Math.abs(from[1] - to[1]) <= AXIS_EPS;

/**
 * Which primitive would have drawn this subpath's ink.
 *
 * Judged on the shape, not on the construction. Central draws a rounded square
 * with three cubics per corner rather than the single quadrant `canvas.rect`
 * emits, and calling that "not a rect" would answer a question about Central's
 * exporter instead of the one being asked, which is what the drawer would have
 * to reach for `raw()` to produce.
 *
 *   `disc`  — `circleRadius`'s own roundness test, unchanged.
 *   `rect`  — every straight run axis-aligned, and the shape fills its own
 *             bounding box: a rounded rectangle of radius 8 in a 20-unit box
 *             still covers 86% of it, and nothing else convex-and-cornered
 *             comes close.
 *   `other` — everything else, and the share of `other` is the measure of how
 *             much of this set the current primitives cannot draw.
 */
export const classify = (sp: Subpath): ShapeClass => {
  if (circleRadius(sp) !== null) {
    return "disc";
  }
  const b = bbox([sp]);
  if (b.w <= 0 || b.h <= 0) {
    return "other";
  }
  let at: Point = sp.start;
  for (const seg of sp.segs) {
    if (seg.t === "L") {
      const to: Point = [seg.p[0], seg.p[1]];
      if (!axisAligned(at, to)) {
        return "other";
      }
      at = to;
    } else if (seg.t === "C") {
      at = [seg.p[4], seg.p[5]];
    } else {
      return "other";
    }
  }
  const filled = Math.abs(signedArea(flatten(sp, FLATTEN_STEPS))) / (b.w * b.h);
  return filled >= RECT_FILL ? "rect" : "other";
};

/**
 * Place every subpath of an icon in the nesting tree its element's fill rule
 * implies, and mark the knockouts.
 *
 * Both constructions are counted, because the set ships both. Under `evenodd` a
 * subpath at odd nesting depth is a hole regardless of which way it is drawn.
 * Under `nonzero` it is a hole only when it winds against the shape it sits in,
 * which is the construction a designer gets from a boolean subtract rather than
 * from setting the attribute.
 */
export const analyseIcon = (symbol: string, svg: string): IconFacts => {
  const elements = parseFilledElements(svg);
  const facts: SubpathFacts[] = [];
  for (const [index, el] of elements.entries()) {
    const subpaths = parsePath(el.d, { source: `${symbol}.svg` });
    const local: SubpathFacts[] = subpaths.map((sp) => {
      const poly = flatten(sp, FLATTEN_STEPS);
      const signed = signedArea(poly);
      return {
        area: Math.abs(signed),
        box: boxOf(sp),
        depth: 0,
        element: index,
        hole: false,
        parent: null,
        poly,
        rule: el.fillRule,
        shape: classify(sp),
        winding: Math.sign(signed),
      };
    });
    const kept = local.filter((s) => s.area >= MIN_SUBPATH_AREA);
    for (const a of kept) {
      let smallest: SubpathFacts | null = null;
      for (const b of kept) {
        if (b === a || b.area <= a.area || !contains(b.poly, a.poly)) {
          continue;
        }
        a.depth += 1;
        if (!smallest || b.area < smallest.area) {
          smallest = b;
        }
      }
      a.parent = smallest ? facts.length + kept.indexOf(smallest) : null;
      a.hole =
        smallest !== null &&
        (el.fillRule === "evenodd"
          ? a.depth % 2 === 1
          : a.winding !== smallest.winding);
    }
    facts.push(...kept);
  }
  const extent = visualExtent(elements, symbol);
  // A whole subpath sitting inside a solid drawn by a *different* element. SVG
  // cannot knock that out — the fill rule works within one element — and both
  // carry `fill="currentColor"`, so the inner shape paints nothing at all.
  // Counted with every vertex inside rather than a majority, because the claim
  // being made is "invisible", not "overlapping".
  let buriedShapes = 0;
  for (const a of facts) {
    for (const b of facts) {
      if (
        b.element !== a.element &&
        b.area > a.area &&
        !b.hole &&
        contains(b.poly, a.poly, 1)
      ) {
        buriedShapes += 1;
        break;
      }
    }
  }
  return {
    buriedShapes,
    centre: centreOf(extent),
    elements: elements.length,
    evenodd: elements.filter((e) => e.fillRule === "evenodd").length,
    extent,
    holes: facts.filter((f) => f.hole),
    margin: Math.min(
      extent.x0,
      extent.y0,
      SPEC.canvas - extent.x1,
      SPEC.canvas - extent.y1
    ),
    solids: facts.filter((f) => !f.hole),
    stroked: elements.filter((e) => e.hasStroke).length,
    subpaths: facts,
    symbol,
  };
};

/** Joint (w,h) extents, bucketed, commonest first. The filled answer to
 *  `SPEC.keylines`, which was counted the same way on the stroked set. */
export const jointModes = (
  extents: { h: number; w: number }[],
  bucket = EXTENT_BUCKET
): { count: number; h: number; w: number }[] => {
  const round = (v: number) => Math.round(v / bucket) * bucket;
  const tally = new Map<string, { count: number; h: number; w: number }>();
  for (const e of extents) {
    const w = round(e.w);
    const h = round(e.h);
    const key = `${w}x${h}`;
    const seen = tally.get(key);
    if (seen) {
      seen.count += 1;
    } else {
      tally.set(key, { count: 1, h, w });
    }
  }
  return [...tally.values()].toSorted((a, b) => b.count - a.count);
};

/** Share of extents within `tolerance` of some keyline, on the worse axis. */
export const conformance = (
  extents: { h: number; w: number }[],
  keylines: readonly (readonly [number, number])[],
  tolerance = KEYLINE_TOLERANCE
): number => {
  let hit = 0;
  for (const e of extents) {
    const near = keylines.some(
      ([kw, kh]) =>
        Math.max(Math.abs(e.w - kw), Math.abs(e.h - kh)) <= tolerance
    );
    if (near) {
      hit += 1;
    }
  }
  return extents.length ? hit / extents.length : 0;
};

/** Share of subpaths the drawer could already have emitted, and the share it
 *  could not. Counted over subpaths, since a subpath is what a primitive
 *  emits. */
const classMix = (classes: ShapeClass[]) => {
  const rate = (c: ShapeClass) =>
    classes.length
      ? Number(
          (classes.filter((v) => v === c).length / classes.length).toFixed(3)
        )
      : 0;
  return {
    disc: rate("disc"),
    n: classes.length,
    other: rate("other"),
    rect: rate("rect"),
  };
};

const share = (values: number[], predicate: (v: number) => boolean): number =>
  values.length ? values.filter(predicate).length / values.length : 0;

const round = (v: number, dp = 3): number => Number(v.toFixed(dp));

const roundDist = (d: ReturnType<typeof summarise>) => ({
  max: round(d.max),
  median: round(d.median),
  min: round(d.min),
  n: d.n,
  p10: round(d.p10),
  p25: round(d.p25),
  p75: round(d.p75),
  p90: round(d.p90),
});

interface Pair {
  /** The file wraps its shapes in a `<g clip-path>`. Nothing here applies the
   *  clip, so a clipped icon's measured extent is the unclipped geometry and is
   *  an overstatement. Counted so the overstatement has a size. */
  clipped: boolean;
  filled: IconFacts;
  outlinedElements: number;
  outlinedExtent: Box;
  outlinedMargin: number;
  outlinedShapes: ShapeClass[];
  outlinedSubpaths: number;
}

/** How often a value appears once bucketed, commonest first. Radii, hole sizes
 *  and dot diameters are tier systems, and a percentile hides a tier. */
const tierModes = (
  values: number[],
  bucket: number,
  top = 8
): { count: number; value: number }[] => {
  const tally = new Map<number, number>();
  for (const v of values) {
    const k = Math.round(v / bucket) * bucket;
    tally.set(k, (tally.get(k) ?? 0) + 1);
  }
  return [...tally.entries()]
    .toSorted((a, b) => b[1] - a[1])
    .slice(0, top)
    .map(([value, count]) => ({ count, value: round(value) }));
};

const outlinedFacts = (svg: string, symbol: string) => {
  const elements = parseFilledElements(svg);
  const subpaths = elements.flatMap((e) =>
    parsePath(e.d, { source: `${symbol}.svg` })
  );
  const extent = visualExtent(elements, symbol);
  return {
    classes: subpaths.map(classify),
    elements: elements.length,
    extent,
    margin: Math.min(
      extent.x0,
      extent.y0,
      SPEC.canvas - extent.x1,
      SPEC.canvas - extent.y1
    ),
    subpaths: subpaths.length,
  };
};

const collect = async (root: string) => {
  const corpus = await loadCorpus(root);
  const pairs: Pair[] = [];
  for (const symbol of corpus.symbols) {
    if (
      !(corpus.has(symbol, FILLED_VARIANT) && corpus.has(symbol, HOUSE_VARIANT))
    ) {
      continue;
    }
    // One icon at a time: the set is 2,085 pairs, and reading them all at once
    // opens 4,170 files.
    // oxlint-disable-next-line no-await-in-loop
    const [filledSvg, outlinedSvg] = await Promise.all([
      corpus.svg(symbol, FILLED_VARIANT),
      corpus.svg(symbol, HOUSE_VARIANT),
    ]);
    const o = outlinedFacts(outlinedSvg, symbol);
    pairs.push({
      clipped:
        filledSvg.includes("clip-path") || outlinedSvg.includes("clip-path"),
      filled: analyseIcon(symbol, filledSvg),
      outlinedElements: o.elements,
      outlinedExtent: o.extent,
      outlinedMargin: o.margin,
      outlinedShapes: o.classes,
      outlinedSubpaths: o.subpaths,
    });
  }
  return pairs;
};

/** The longer side of an extent: which keyline family it belongs to is a
 *  question about its largest dimension. */
const longest = (b: Box) => Math.max(b.w, b.h);

const extentReport = (pairs: Pair[]) => {
  const extents = pairs.map((p) => p.filled.extent);
  const modes = jointModes(extents);
  const outlinedModes = jointModes(pairs.map((p) => p.outlinedExtent));
  const deltas = pairs.map(
    (p) => longest(p.filled.extent) - longest(p.outlinedExtent)
  );
  // Named, because the median delta of 0 is the finding and the tails are
  // where it fails. A filled twin that is smaller has dropped a shape; one
  // that is larger has grown a solid where the outline had a gap.
  const ranked = pairs
    .map((p, i) => ({ delta: round(deltas[i]), symbol: p.filled.symbol }))
    .toSorted((a, b) => a.delta - b.delta);
  const margins = pairs.map((p) => p.filled.margin);
  const house = Object.values(SPEC.keylines);
  const derived = modes.slice(0, 6).map((m) => [m.w, m.h] as const);
  return {
    centre: {
      offX: roundDist(summarise(pairs.map((p) => p.filled.centre[0] - 12))),
      offY: roundDist(summarise(pairs.map((p) => p.filled.centre[1] - 12))),
    },
    conformanceToDerived: round(conformance(extents, derived)),
    conformanceToHouseKeylines: round(conformance(extents, house)),
    // Objects rather than [w, h] pairs: the repo formatter collapses a short
    // array onto one line, and this file is regenerated by a script, so a
    // shape the formatter would rewrite makes every re-run dirty the tree.
    derivedKeylines: derived.map(([w, h]) => ({ h, w })),
    extentDeltaVsOutlined: roundDist(summarise(deltas)),
    grewMost: ranked.toReversed().slice(0, TOP_N),
    height: roundDist(summarise(extents.map((e) => e.h))),
    identicalExtentShare: round(share(deltas, (d) => Math.abs(d) <= 0.01)),
    margin: roundDist(summarise(margins)),
    marginAtOrBelow0: round(share(margins, (m) => m <= 0.0001)),
    marginAtOrBelow1: round(share(margins, (m) => m <= 1.0001)),
    outlinedMargin: roundDist(summarise(pairs.map((p) => p.outlinedMargin))),
    outlinedTopModes: outlinedModes.slice(0, 8),
    shrunkMost: ranked.slice(0, TOP_N),
    topModes: modes.slice(0, 12),
    width: roundDist(summarise(extents.map((e) => e.w))),
  };
};

const knockoutReport = (pairs: Pair[]) => {
  const withHoles = pairs.filter((p) => p.filled.holes.length > 0);
  const ratios: number[] = [];
  const rings: number[] = [];
  const offsets: number[] = [];
  for (const p of pairs) {
    for (const h of p.filled.holes) {
      const parent = h.parent === null ? null : p.filled.subpaths[h.parent];
      if (!parent) {
        continue;
      }
      ratios.push(h.area / parent.area);
      rings.push(nearestApproach(h.poly, parent.poly));
      const hc = centreOf(h.box);
      const pc = centreOf(parent.box);
      offsets.push(
        Math.hypot(hc[0] - pc[0], hc[1] - pc[1]) /
          Math.max(parent.box.w, parent.box.h)
      );
    }
  }
  const perIcon = withHoles.map((p) => p.filled.holes.length);
  const holeSizes: number[] = [];
  let roundHoles = 0;
  const nested: string[] = [];
  const crossElement: string[] = [];
  for (const p of pairs) {
    for (const h of p.filled.holes) {
      holeSizes.push(Math.max(h.box.w, h.box.h));
      if (
        h.box.w > 0 &&
        Math.abs(h.box.w - h.box.h) / Math.max(h.box.w, h.box.h) <= 0.05
      ) {
        roundHoles += 1;
      }
    }
    if (p.filled.holes.some((h) => h.depth > 1)) {
      nested.push(p.filled.symbol);
    }
    if (p.filled.buriedShapes > 0) {
      crossElement.push(p.filled.symbol);
    }
  }
  return {
    buriedShapeExamples: crossElement.slice(0, TOP_N),
    buriedShapeIcons: crossElement.length,
    buriedShapes: pairs.reduce((n, p) => n + p.filled.buriedShapes, 0),
    concentricShare: round(share(offsets, (o) => o <= 0.05)),
    holeAreaShareOfParent: roundDist(summarise(ratios)),
    holeSizeModes: tierModes(holeSizes, 0.5),
    holesPerIconWhenPresent: roundDist(summarise(perIcon)),
    // Which rule the knockout was declared under, and — separately — how many
    // would still be holes if the rule were switched. A counter-wound subpath
    // knocks out under either rule; a co-wound one only under `evenodd`, and
    // those are the ones a generator cannot get from a boolean subtract.
    holesThatNeedEvenodd: pairs.reduce(
      (n, p) =>
        n +
        p.filled.holes.filter(
          (h) => p.filled.subpaths[h.parent ?? 0]?.winding === h.winding
        ).length,
      0
    ),
    holesUnderEvenoddElements: pairs.reduce(
      (n, p) => n + p.filled.holes.filter((h) => h.rule === "evenodd").length,
      0
    ),
    holesUnderNonzeroElements: pairs.reduce(
      (n, p) => n + p.filled.holes.filter((h) => h.rule === "nonzero").length,
      0
    ),
    iconsWithHoles: withHoles.length,
    iconsWithNestedHoles: pairs.filter((p) =>
      p.filled.holes.some((h) => h.depth > 1)
    ).length,
    mostHoles: withHoles
      .map((p) => ({ holes: p.filled.holes.length, symbol: p.filled.symbol }))
      .toSorted((a, b) => b.holes - a.holes)
      .slice(0, TOP_N),
    nestedExamples: nested,
    offsetFromParentCentre: roundDist(summarise(offsets)),
    ringWidth: roundDist(summarise(rings)),
    ringsBelow1Unit: round(share(rings, (r) => r < 1)),
    squareBoundedHoleShare: round(roundHoles / Math.max(1, holeSizes.length)),
    totalHoles: ratios.length,
  };
};

const featureReport = (pairs: Pair[]) => {
  const solidMin: number[] = [];
  const holeMin: number[] = [];
  const holeNames: { size: number; symbol: string }[] = [];
  for (const p of pairs) {
    for (const s of p.filled.solids) {
      solidMin.push(Math.min(s.box.w, s.box.h));
    }
    for (const h of p.filled.holes) {
      const m = Math.min(h.box.w, h.box.h);
      holeMin.push(m);
      holeNames.push({ size: round(m), symbol: p.filled.symbol });
    }
  }
  // What replaces the outlined set's 1-unit minimum gap: the clear distance
  // between two solids that are meant to be separate. Measured between
  // top-level solids only — a hole's distance to its own parent is the ring,
  // measured separately — and reported both with and without the pairs that
  // touch, since a filled set butts shapes together on purpose.
  const separations: number[] = [];
  for (const p of pairs) {
    const tops = p.filled.solids.filter((s) => s.depth === 0);
    for (let i = 0; i < tops.length; i += 1) {
      for (let j = i + 1; j < tops.length; j += 1) {
        separations.push(nearestApproach(tops[i].poly, tops[j].poly));
      }
    }
  }
  const apart = separations.filter((d) => d > TOUCHING);
  // Solid discs small enough to read as a dot. In a filled icon a dot is a
  // drawn circle rather than a capped segment, so the tier question is whether
  // the diameters still land on `SPEC.dots`.
  const dots: number[] = [];
  for (const p of pairs) {
    for (const s of p.filled.solids) {
      const d = Math.max(s.box.w, s.box.h);
      if (
        d <= DOT_CEILING &&
        s.box.w > 0 &&
        Math.abs(s.box.w - s.box.h) / d <= 0.05
      ) {
        dots.push(d);
      }
    }
  }
  const px = (u: number) => u * UNITS_TO_SMALL_PX;
  return {
    dotDiameter: roundDist(summarise(dots)),
    dotModes: tierModes(dots, 0.25),
    dotsOnHouseTiers: round(
      share(dots, (d) =>
        Object.values(SPEC.dots).some((t) => Math.abs(t - d) <= 0.125)
      )
    ),
    holeMinDimension: roundDist(summarise(holeMin)),
    holeSizeModesQuarter: tierModes(holeMin, 0.25),
    holesBelowLegibleAt16px: round(share(holeMin, (m) => px(m) < LEGIBLE_PX)),
    legibleAt16pxRequiresUnits: round(LEGIBLE_PX / UNITS_TO_SMALL_PX),
    separationBelow1UnitWhenApart: round(share(apart, (d) => d < 1)),
    separationWhenApart: roundDist(summarise(apart)),
    smallestHoles: holeNames
      .toSorted((a, b) => a.size - b.size)
      .slice(0, TOP_N),
    solidMinDimension: roundDist(summarise(solidMin)),
    solidPairs: separations.length,
    solidPairsTouching: round(share(separations, (d) => d <= TOUCHING)),
    solidSizeModes: tierModes(solidMin, 0.5),
    solidsBelowLegibleAt16px: round(share(solidMin, (m) => px(m) < LEGIBLE_PX)),
  };
};

const compositionReport = (pairs: Pair[]) => {
  const filledSub = pairs.map((p) => p.filled.subpaths.length);
  const filledEl = pairs.map((p) => p.filled.elements);
  const outlinedEl = pairs.map((p) => p.outlinedElements);
  const outlinedSub = pairs.map((p) => p.outlinedSubpaths);
  return {
    fewerSubpathsThanOutlined: round(
      share(
        pairs.map((p) => p.filled.subpaths.length - p.outlinedSubpaths),
        (d) => d < 0
      )
    ),
    filledElements: roundDist(summarise(filledEl)),
    filledSolids: roundDist(
      summarise(pairs.map((p) => p.filled.solids.length))
    ),
    filledSubpaths: roundDist(summarise(filledSub)),
    moreSubpathsThanOutlined: round(
      share(
        pairs.map((p) => p.filled.subpaths.length - p.outlinedSubpaths),
        (d) => d > 0
      )
    ),
    oneElementShare: round(share(filledEl, (n) => n === 1)),
    outlinedElements: roundDist(summarise(outlinedEl)),
    outlinedSubpaths: roundDist(summarise(outlinedSub)),
    // What the current primitives could and could not have drawn. Counted over
    // subpaths, since a subpath is the unit a primitive emits.
    shapeMix: {
      filledHoles: classMix(
        pairs.flatMap((p) => p.filled.holes.map((h) => h.shape))
      ),
      filledSolids: classMix(
        pairs.flatMap((p) => p.filled.solids.map((f) => f.shape))
      ),
      outlinedSubpaths: classMix(pairs.flatMap((p) => p.outlinedShapes)),
    },
    subpathDelta: roundDist(
      summarise(pairs.map((p) => p.filled.subpaths.length - p.outlinedSubpaths))
    ),
  };
};

/** Measured radii, bucketed to the quarter unit, commonest first. */
const tally = (rs: number[]) =>
  tierModes(rs, 0.25, 10).map(({ count, value }) => ({ count, r: value }));

const radiusReport = async (root: string, pairs: Pair[]) => {
  const corpus = await loadCorpus(root);
  const gather = async (variant: string) => {
    const radii: number[] = [];
    for (const p of pairs) {
      // oxlint-disable-next-line no-await-in-loop -- one icon at a time, as above
      const svg = await corpus.svg(p.filled.symbol, variant);
      const subpaths = parseFilledElements(svg).flatMap((e) =>
        parsePath(e.d, { source: p.filled.symbol })
      );
      radii.push(...cornerRadii(subpaths).map((c) => c.r));
    }
    return radii;
  };
  const filled = await gather(FILLED_VARIANT);
  const outlined = await gather(HOUSE_VARIANT);
  const onTier = (rs: number[]) =>
    round(
      share(rs, (r) =>
        SPEC.radiusTiers.some((t) => Math.abs(t - r) <= TIER_TOLERANCE)
      )
    );
  // Candidate tier sets, scored the way `SPEC.radiusTiers` was scored: share of
  // measured corner radii within 0.125 of some tier. `houseTiers + 1` is the
  // hypothesis the geometry suggests — an outlined corner is a centre-line, and
  // the filled shape is its outer edge, half a stroke further out on each side.
  const candidates: Record<string, number[]> = {
    "[0.5,1,2,2.5,3,4]": [0.5, 1, 2, 2.5, 3, 4],
    "[0.5,1,2,3,4]": [0.5, 1, 2, 3, 4],
    "[0.5,1,2,4]": [0.5, 1, 2, 4],
    "[1,2,3,4]": [1, 2, 3, 4],
    "house [0.5,1,2,3]": [...SPEC.radiusTiers],
    "houseShifted [1.5,2,3,4]": SPEC.radiusTiers.map((t) => t + 1),
  };
  const scored = Object.entries(candidates).map(([name, tiers]) => ({
    filled: round(
      share(filled, (r) => tiers.some((t) => Math.abs(t - r) <= TIER_TOLERANCE))
    ),
    outlined: round(
      share(outlined, (r) =>
        tiers.some((t) => Math.abs(t - r) <= TIER_TOLERANCE)
      )
    ),
    tiers: name,
  }));
  return {
    candidateTierSets: scored.toSorted((a, b) => b.filled - a.filled),
    filled: roundDist(summarise(filled)),
    filledOnTier: onTier(filled),
    filledTopRadii: tally(filled),
    outlined: roundDist(summarise(outlined)),
    outlinedOnTier: onTier(outlined),
    outlinedTopRadii: tally(outlined),
  };
};

const divergenceReport = (pairs: Pair[]) =>
  pairs
    .map((p) => ({
      elementDelta: p.filled.elements - p.outlinedElements,
      extentDelta: round(
        Math.max(p.filled.extent.w, p.filled.extent.h) -
          Math.max(p.outlinedExtent.w, p.outlinedExtent.h)
      ),
      holes: p.filled.holes.length,
      score:
        Math.abs(p.filled.subpaths.length - p.outlinedSubpaths) +
        2 *
          Math.abs(
            Math.max(p.filled.extent.w, p.filled.extent.h) -
              Math.max(p.outlinedExtent.w, p.outlinedExtent.h)
          ),
      subpathDelta: p.filled.subpaths.length - p.outlinedSubpaths,
      symbol: p.filled.symbol,
    }))
    .toSorted((a, b) => b.score - a.score)
    .slice(0, TOP_N)
    .map((row) => ({
      elementDelta: row.elementDelta,
      extentDelta: row.extentDelta,
      holes: row.holes,
      subpathDelta: row.subpathDelta,
      symbol: row.symbol,
    }));

const PROCEDURE =
  "Every symbol present in both `round-filled-radius-3-stroke-2` and the house variant `round-outlined-radius-3-stroke-2` (n=2,085), measured from the shipped SVG. Geometry comes from `corpus/load.ts`'s `parseIconSvg` (which converts `<circle>`, `<rect>`, `<ellipse>` and `<line>` to path data) and `geometry/path.ts`'s parser and bbox; corner radii from `corpus/measure.ts`'s `cornerRadii`, unchanged, which is what makes the outlined number here reproduce the 78.4% already in `SPEC.radiusTiers`. Visual extent is each element's own path bbox grown by half of *its own* stroke — 0 for a filled shape, 2 for the seven filled icons that still carry a stroke — so filled and outlined are compared as the same quantity rather than as bbox against bbox. Subpaths are flattened at 16 segments per curve; containment is a ray-crossing test with a 60% vertex vote, and a subpath is a knockout when it sits inside another of the same element and either the element declares `fill-rule=\"evenodd\"` and its nesting depth is odd, or the element is `nonzero` and it winds against its parent. Ring width and solid separation are nearest approach between flattened outlines. Nothing applies `clip-path`, so the 12 clipped icons' extents are the unclipped geometry.";

/**
 * The gap between what this set draws and what `canvas.ts` can emit.
 *
 * Written as data rather than prose because each line is a decision someone
 * has to take, and each carries the number that forces it. Kept in the report
 * so the list and the measurements it rests on cannot drift apart.
 */
const PRIMITIVE_GAPS = [
  {
    evidence:
      '1,807 knockouts across 932 of 2,085 icons (44.7%). 1,715 are drawn in an element that declares `fill-rule="evenodd"`, 92 in a default `nonzero` element where the subpath winds against its parent. 486 of the 1,807 are wound the *same* way as their parent and so exist only because of `evenodd` — a boolean subtract, which reverses the winding, would not have produced them. None is a separate path element: the fill rule does not reach across elements, and every element paints currentColor.',
    missing: "a subtract op: a shape declared as a hole in a named solid",
    note: "`canvas.ts` emits one subpath per primitive and the DSL has no way to say that one shape cuts another. This is the single largest gap: without it 45% of the set is undrawable.",
  },
  {
    evidence:
      "63.1% of filled solids and 53.9% of holes are neither a disc nor an axis-aligned rounded rect (n=4,717 and 1,807). The outlined set is worse at 76.4%, so this is not a filled-only problem — but a filled icon's silhouette IS the icon, where an outlined one can be assembled from strokes.",
    missing: "a closed filled region that is not a rect or a circle",
    note: "`line` draws an open polyline that is stroked; there is no op that closes a run of points into a filled region, and no curved-edge primitive at all.",
  },
  {
    evidence:
      "The commonest filled corner radius is 4 (2,640 of 7,018 corners, 37.6%), which `SPEC.radiusTiers` does not contain: an outlined corner is a centre-line at 3 and the filled shape is its outer edge, half a stroke further out. On the house tiers only 43.4% of filled corners land; on [0.5, 1, 2, 3, 4] it is 81.1%, against 83.0% for the outlined set on the same set.",
    missing: "a radius tier at 4",
    note: "`tierRadius` snaps to the nearest tier, so every 4-unit corner in a filled icon is currently drawn at 3.",
  },
  {
    evidence:
      "2,078 of 2,085 filled icons carry no stroke at all; 7 mix a stroke in (currency-pesos, folders-2, judge-gavel, loading-circle, microphone-sparkle, people-voice, user-remove-right).",
    missing: "a finish on the icon, and a per-shape override of it",
    note: "The DSL has no word for filled versus stroked. Whatever the drawer emits is stroked, and `lint.ts`'s gap and extent rules read the stroke, so the finish has to be a declared property rather than an attribute swapped at serialisation.",
  },
  {
    evidence:
      "19.4% of knockouts are concentric with their parent within 5% of its size (351 of 1,807), and 22.3% of holes are discs.",
    missing: "a ring: a disc with a concentric disc removed",
    note: "Expressible once a subtract op exists, but common enough to deserve its own word — a `ring` would be one line where a subtract is three.",
  },
  {
    evidence:
      "559 solid discs at or under 5 units. Modes at 2.0 (123), 4.0 (119), 3.0 (65) and 5.0 (45); only 58.9% land within 0.125 of a `SPEC.dots` tier, against a tier system built on the outlined set where a dot is a capped segment.",
    missing:
      "a dot tier at 5, or an acknowledgement that filled dots are not tiered",
    note: "The set is not consistent here. 41% of filled dots are off every existing tier and the residue does not form one clean fifth mode.",
  },
] as const;

const verdictOf = (report: {
  composition: { shapeMix: { filledSolids: { other: number } } };
  extent: { identicalExtentShare: number };
  knockouts: { buriedShapeIcons: number; iconsWithHoles: number };
  radii: { filledOnTier: number };
}): string =>
  [
    `The filled twin occupies the same visual extent as the outlined one in ${Math.round(report.extent.identicalExtentShare * 100)}% of pairs, to within 0.01 units, so the keylines, the 2-unit clearance and the centring rules carry over unchanged and the "filled icons run larger" reading is an artefact of comparing a filled bbox against an outlined path bbox rather than against its visual extent.`,
    `What does not carry over is everything about interior white: ${report.knockouts.iconsWithHoles} of 2,085 icons knock a hole out of a solid, and no primitive can express that.`,
    `Corner radii move: only ${Math.round(report.radii.filledOnTier * 100)}% of filled corners land on the house tiers, because the dominant corner is the outlined tier plus half a stroke.`,
    `${Math.round(report.composition.shapeMix.filledSolids.other * 100)}% of filled solids are neither a disc nor an axis-aligned rounded rect, so a generator restricted to rect/circle/line/dot/part reaches a minority of this set however the knockout question is answered.`,
    `${report.knockouts.buriedShapeIcons} icons ship a solid buried inside another solid of a different element, where the fill rule cannot reach it and both paint currentColor — geometry that draws nothing. That is the set being inconsistent, not a rule to copy.`,
  ].join(" ");

const main = async (): Promise<void> => {
  const out = process.argv[2] ?? "bench/filled-language.v1.json";
  const root = process.env.CORPUS_ROOT ?? "corpus";
  const pairs = await collect(root);
  const strokedIcons = pairs.filter((p) => p.filled.stroked > 0);
  const evenoddIcons = pairs.filter((p) => p.filled.evenodd > 0);
  const report = {
    builtAt: new Date().toISOString(),
    composition: compositionReport(pairs),
    construction: {
      clippedIcons: pairs.filter((p) => p.clipped).length,
      evenoddIcons: evenoddIcons.length,
      evenoddShare: round(evenoddIcons.length / pairs.length),
      strokedIcons: strokedIcons.length,
      strokedSymbols: strokedIcons.map((p) => p.filled.symbol),
    },
    extent: extentReport(pairs),
    features: featureReport(pairs),
    knockouts: knockoutReport(pairs),
    pairsWithBiggestDivergence: divergenceReport(pairs),
    primitiveGaps: PRIMITIVE_GAPS,
    procedure: PROCEDURE,
    radii: await radiusReport(root, pairs),
    sample: {
      n: pairs.length,
      outlinedVariant: HOUSE_VARIANT,
      variant: FILLED_VARIANT,
    },
  };
  writeFileSync(
    out,
    `${JSON.stringify({ ...report, verdict: verdictOf(report) }, null, 2)}\n`
  );
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.stderr.write(`\nwritten to ${out}\n`);
};

if (process.argv[1]?.endsWith("measure-filled.ts")) {
  await main();
}
