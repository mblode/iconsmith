/**
 * What the corpus actually does, as distributions.
 *
 * Every number the house spec asserts — minimum gap, keyline extents, radius
 * tiers, dot sizes, the grid — is a claim about geometry that can be checked
 * against 2,085 icons that a working design system already shipped. This module
 * makes the check, and `SPEC` in `tools/canvas.ts` quotes the results.
 *
 * Two method rules, both of which have produced wrong answers when ignored:
 *
 * - **Visual extent = path bbox + stroke width, half per side.** Comparing a
 *   stroked bbox to a filled one measures a rendering fact, not a design fact.
 * - **Ink gap = centre-line distance − stroke width.** Measured between
 *   separate `<path>` elements only. Subpaths inside one element are compound
 *   geometry (holes, shapes drawn to touch) and pile up at zero, which drags
 *   any low percentile down to a number about compounding rather than spacing.
 *   Read the median.
 */
import { bbox, parsePath } from "../geometry/path.js";
import { flatten } from "../parts/shape.js";
import type { Box, Subpath } from "../types.js";
import type { Corpus, CorpusIcon, CorpusShape } from "./load.js";
import { sampleSymbols } from "./load.js";

/** Segments per curve when flattening. A gap only needs resolving to a
 *  fraction of a pixel, so this is coarser than fingerprinting wants. */
const FLATTEN_STEPS = 8;
/** Circular arc → cubic handle ratio at 90°, for reference; the general form
 *  `(4/3)·tan(θ/4)` is what the radius estimator uses. */
const K90 = 0.5523;
/** Two handles within this fraction of each other imply a symmetric arc. */
const HANDLE_TOLERANCE = 0.12;
/** Turn angles outside this range are not corner arcs worth measuring. */
const MIN_TURN_DEG = 20;
const MAX_TURN_DEG = 170;
/** Radii outside this are parse noise or whole circles mislabelled. */
const MIN_RADIUS = 0.1;
const MAX_RADIUS = 12;
/** A closed subpath is circular when every flattened point sits this close to
 *  the mean radius. */
const ROUNDNESS_TOLERANCE = 0.05;
/** Visual diameter at or under which a circle reads as a dot, not a shape. */
const DOT_MAX_DIAMETER = 6;
/** Total path length below which a stroked shape draws no line, only its caps:
 *  Central's idiom for a dot is `M12 8V8.01` with a round cap, where the stroke
 *  width is the dot's diameter. */
const DEGENERATE_LENGTH = 0.25;
const EPS = 1e-6;
/** The corpus draws on a 24×24 viewBox throughout. */
const CANVAS = 24;
/** At or below this an ink gap is two shapes meeting, not a gap. */
const TOUCHING = 0.01;

export interface Distribution {
  max: number;
  mean: number;
  median: number;
  min: number;
  n: number;
  p10: number;
  p25: number;
  p5: number;
  p75: number;
  p90: number;
  p95: number;
}

const percentile = (sorted: number[], p: number): number => {
  const i = (sorted.length - 1) * p;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
};

export const summarise = (values: number[]): Distribution => {
  // Non-finite values are dropped rather than propagated: one NaN in the input
  // corrupts the sort, and the percentiles then come out non-monotonic.
  const s = values.filter((v) => Number.isFinite(v)).toSorted((a, b) => a - b);
  const n = s.length;
  if (n === 0) {
    return {
      max: Number.NaN,
      mean: Number.NaN,
      median: Number.NaN,
      min: Number.NaN,
      n: 0,
      p10: Number.NaN,
      p25: Number.NaN,
      p5: Number.NaN,
      p75: Number.NaN,
      p90: Number.NaN,
      p95: Number.NaN,
    };
  }
  return {
    max: s[n - 1],
    mean: s.reduce((a, b) => a + b, 0) / n,
    median: percentile(s, 0.5),
    min: s[0],
    n,
    p10: percentile(s, 0.1),
    p25: percentile(s, 0.25),
    p5: percentile(s, 0.05),
    p75: percentile(s, 0.75),
    p90: percentile(s, 0.9),
    p95: percentile(s, 0.95),
  };
};

/** How often a value appears, commonest first. For radii and stroke widths the
 *  distribution is a tier system, and a percentile hides tiers. */
export const histogram = (
  values: number[],
  bucket = 0.25
): [number, number][] => {
  const counts = new Map<number, number>();
  for (const v of values) {
    const k = Math.round(v / bucket) * bucket;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...counts.entries()].toSorted((a, b) => b[1] - a[1]);
};

const dist = (a: [number, number], b: [number, number]) =>
  Math.hypot(a[0] - b[0], a[1] - b[1]);

const anchors = (sp: Subpath): [number, number][] => {
  const out: [number, number][] = [[...sp.start] as [number, number]];
  for (const seg of sp.segs) {
    if (seg.t === "C") {
      out.push([seg.p[4], seg.p[5]]);
    } else if (seg.t === "A") {
      out.push([seg.p[5], seg.p[6]]);
    } else {
      out.push([seg.p[0], seg.p[1]]);
    }
  }
  return out;
};

export interface Corner {
  r: number;
  /** Longest side of the subpath the corner belongs to, so a radius can be
   *  read against the size of the shape it is rounding. */
  size: number;
}

/** Anchor points whose position is a design decision rather than a consequence
 *  of a curve: subpath starts and the ends of straight segments. A cubic's
 *  endpoint sits wherever the arc it belongs to puts it, so including those
 *  would measure curve maths, not grid discipline. */
const gridAnchors = (sp: Subpath): [number, number][] => {
  const out: [number, number][] = [[...sp.start] as [number, number]];
  for (const seg of sp.segs) {
    if (seg.t === "L") {
      out.push([seg.p[0], seg.p[1]]);
    }
  }
  return out;
};

/**
 * Radii of rounded corners: a cubic flanked by straight segments, with its two
 * handles within `HANDLE_TOLERANCE` of each other. Symmetric handles mean a
 * circular arc, and for a turn of θ the handle length is `r·(4/3)·tan(θ/4)`.
 * Curves not flanked by lines are excluded — a circle is not a corner.
 */
export const cornerRadii = (subpaths: Subpath[]): Corner[] => {
  const out: Corner[] = [];
  for (const sp of subpaths) {
    const b = bbox([sp]);
    const size = Math.max(b.w, b.h);
    const pts = anchors(sp);
    for (let i = 0; i < sp.segs.length; i += 1) {
      const seg = sp.segs[i];
      if (seg.t !== "C") {
        continue;
      }
      const prev = sp.segs[i - 1] ?? (sp.closed ? sp.segs.at(-1) : undefined);
      const next = sp.segs[i + 1] ?? (sp.closed ? sp.segs[0] : undefined);
      if (prev?.t !== "L" || next?.t !== "L") {
        continue;
      }
      const p0 = pts[i];
      const [c1x, c1y, c2x, c2y, p3x, p3y] = seg.p;
      const h1 = dist(p0, [c1x, c1y]);
      const h2 = dist([p3x, p3y], [c2x, c2y]);
      const big = Math.max(h1, h2);
      if (big < EPS || Math.abs(h1 - h2) / big > HANDLE_TOLERANCE) {
        continue;
      }
      const a1 = Math.atan2(c1y - p0[1], c1x - p0[0]);
      const a2 = Math.atan2(p3y - c2y, p3x - c2x);
      let turn = Math.abs(((a2 - a1) * 180) / Math.PI) % 360;
      if (turn > 180) {
        turn = 360 - turn;
      }
      if (turn < MIN_TURN_DEG || turn > MAX_TURN_DEG) {
        continue;
      }
      const r =
        (h1 + h2) / 2 / ((4 / 3) * Math.tan((turn * Math.PI) / 180 / 4));
      if (r >= MIN_RADIUS && r <= MAX_RADIUS) {
        out.push({ r, size });
      }
    }
  }
  return out;
};

/** Radius of a closed subpath that is a circle, or null when it is not one.
 *  The centre comes from the bounding box, not the mean of sampled points: a
 *  flattened closed path repeats its start point, and that one duplicate pulls
 *  a centroid far enough off to fail a 5% roundness test on a real circle. */
export const circleRadius = (sp: Subpath): number | null => {
  if (!sp.closed) {
    return null;
  }
  const poly = flatten(sp, FLATTEN_STEPS);
  if (poly.length < 8) {
    return null;
  }
  const b = bbox([sp]);
  if (
    b.w < EPS ||
    Math.abs(b.w - b.h) / Math.max(b.w, b.h) > ROUNDNESS_TOLERANCE
  ) {
    return null;
  }
  const cx = (b.x0 + b.x1) / 2;
  const cy = (b.y0 + b.y1) / 2;
  const mean = (b.w + b.h) / 4;
  const off =
    Math.max(
      ...poly.map((q) => Math.abs(Math.hypot(q[0] - cx, q[1] - cy) - mean))
    ) / mean;
  return off <= ROUNDNESS_TOLERANCE ? mean : null;
};

/** Visual extent: the path bbox inflated by half the stroke on every side. */
/** Total polyline length of a shape, used to spot degenerate dot segments. */
const pathLength = (subpaths: Subpath[]): number => {
  let total = 0;
  for (const sp of subpaths) {
    const poly = flatten(sp, FLATTEN_STEPS);
    for (let i = 1; i < poly.length; i += 1) {
      total += dist(poly[i - 1], poly[i]);
    }
  }
  return total;
};

export const visualExtent = (
  shapes: CorpusShape[]
): { box: Box; h: number; w: number } => {
  const all = shapes.flatMap((s) => parsePath(s.d));
  const b = bbox(all);
  const sw = Math.max(0, ...shapes.map((s) => s.strokeWidth));
  return {
    box: {
      h: b.h + sw,
      w: b.w + sw,
      x0: b.x0 - sw / 2,
      x1: b.x1 + sw / 2,
      y0: b.y0 - sw / 2,
      y1: b.y1 + sw / 2,
    },
    h: b.h + sw,
    w: b.w + sw,
  };
};

export interface IconMeasurement {
  /** Centre of the visual extent. */
  centre: [number, number];
  corners: Corner[];
  /** Visual diameters of circles small enough to read as dots. */
  dots: number[];
  /** Ink gaps between every pair of separate `<path>` elements. */
  gaps: number[];
  h: number;
  /** Smallest distance from the visual extent to a canvas edge. */
  margin: number;
  /** Fraction of design anchors landing on the 0.25 grid. */
  onGrid: number;
  /** Fraction landing on whole and half pixels. */
  onHalf: number;
  radii: number[];
  strokes: number[];
  symbol: string;
  /** Smallest ink gap in this icon, overlaps included, or null when it has
   *  fewer than two elements that both draw something. */
  tightestGap: number | null;
  /** Smallest ink gap between two shapes that are actually apart. A negative
   *  or zero gap means the shapes overlap or touch, which is construction —
   *  a badge on a card, a cross through a shape — not spacing, and no minimum
   *  gap rule should have an opinion about it. This is the value a `minGap`
   *  is calibrated and tested against. */
  tightestSeparated: number | null;
  w: number;
}

export const measureIcon = (icon: CorpusIcon): IconMeasurement => {
  const parsed = icon.shapes.map((s) => ({
    shape: s,
    subpaths: parsePath(s.d),
  }));
  const drawn = parsed.filter((p) => p.subpaths.length > 0);
  const { box, h, w } = visualExtent(icon.shapes);

  const gaps: number[] = [];
  const polys = drawn.map((p) => ({
    poly: p.subpaths.flatMap((sp) => flatten(sp, FLATTEN_STEPS)),
    sw: p.shape.strokeWidth,
  }));
  for (let i = 0; i < polys.length; i += 1) {
    for (let j = i + 1; j < polys.length; j += 1) {
      let min = Number.POSITIVE_INFINITY;
      for (const a of polys[i].poly) {
        for (const b of polys[j].poly) {
          const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
          if (d < min) {
            min = d;
          }
        }
      }
      // Centre-line distance minus one stroke width: half of each shape's
      // stroke lies in the space between them.
      gaps.push(min - (polys[i].sw + polys[j].sw) / 2);
    }
  }

  const corners: Corner[] = [];
  const dots: number[] = [];
  let onGrid = 0;
  let onHalf = 0;
  let total = 0;
  for (const { shape, subpaths } of drawn) {
    corners.push(...cornerRadii(subpaths));
    if (
      shape.strokeWidth > 0 &&
      shape.cap === "round" &&
      pathLength(subpaths) < DEGENERATE_LENGTH
    ) {
      // A round cap on a zero-length segment is a disc of exactly the stroke
      // width. This, not a small `<circle>`, is how the corpus draws dots.
      dots.push(shape.strokeWidth);
    }
    for (const sp of subpaths) {
      const r = circleRadius(sp);
      if (r !== null) {
        const diameter = 2 * r + shape.strokeWidth;
        if (diameter <= DOT_MAX_DIAMETER) {
          dots.push(diameter);
        }
      }
      for (const [x, y] of gridAnchors(sp)) {
        for (const v of [x, y]) {
          total += 1;
          onGrid += Number(Math.abs(v * 4 - Math.round(v * 4)) < EPS);
          onHalf += Number(Math.abs(v * 2 - Math.round(v * 2)) < EPS);
        }
      }
    }
  }

  const separated = gaps.filter((g) => g > TOUCHING);

  return {
    centre: [(box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2],
    corners,
    dots,
    gaps,
    h,
    margin: Math.min(box.x0, box.y0, CANVAS - box.x1, CANVAS - box.y1),
    onGrid: total === 0 ? 1 : onGrid / total,
    onHalf: total === 0 ? 1 : onHalf / total,
    radii: corners.map((c) => c.r),
    strokes: icon.shapes
      .filter((s) => s.strokeWidth > 0)
      .map((s) => s.strokeWidth),
    symbol: icon.symbol,
    tightestGap: gaps.length === 0 ? null : Math.min(...gaps),
    tightestSeparated: separated.length === 0 ? null : Math.min(...separated),
    w,
  };
};

export interface VariantMeasurement {
  centreX: Distribution;
  centreY: Distribution;
  dots: Distribution;
  extentH: Distribution;
  extentMax: Distribution;
  extentW: Distribution;
  /** Every pairwise ink gap in the sample. */
  gaps: Distribution;
  icons: IconMeasurement[];
  margin: Distribution;
  onGrid: Distribution;
  onHalf: Distribution;
  radii: Distribution;
  strokes: Distribution;
  symbols: number;
  /** One value per icon: its own tightest ink gap, overlaps included. */
  tightestGaps: Distribution;
  /** One value per icon: its tightest gap between shapes that are apart. This
   *  is the distribution a `minGap` is calibrated against. */
  tightestSeparated: Distribution;
  variant: string;
}

export interface MeasureOptions {
  /** Symbols to sample, spread evenly across the set. Default: all of them. */
  limit?: number;
}

export const measureVariant = async (
  corpus: Corpus,
  variant: string,
  { limit }: MeasureOptions = {}
): Promise<VariantMeasurement> => {
  const wanted = limit ? sampleSymbols(corpus.symbols, limit) : corpus.symbols;
  const icons: IconMeasurement[] = [];
  for (const symbol of wanted) {
    if (!corpus.has(symbol, variant)) {
      continue;
    }
    // Sequential on purpose. `wanted` is up to 2,085 symbols by default and the
    // caller may sweep several variants, so a `Promise.all` here would open
    // thousands of file handles at once. The work is I/O-bound but bounded by
    // the loop, which is the trade this module wants.
    // oxlint-disable-next-line no-await-in-loop
    const m = measureIcon(await corpus.load(symbol, variant));
    if (Number.isFinite(m.w)) {
      icons.push(m);
    }
  }
  const flat = <T>(pick: (m: IconMeasurement) => T[]) => icons.flatMap(pick);
  return {
    centreX: summarise(icons.map((m) => m.centre[0])),
    centreY: summarise(icons.map((m) => m.centre[1])),
    dots: summarise(flat((m) => m.dots)),
    extentH: summarise(icons.map((m) => m.h)),
    extentMax: summarise(icons.map((m) => Math.max(m.w, m.h))),
    extentW: summarise(icons.map((m) => m.w)),
    gaps: summarise(flat((m) => m.gaps)),
    icons,
    margin: summarise(icons.map((m) => m.margin)),
    onGrid: summarise(icons.map((m) => m.onGrid)),
    onHalf: summarise(icons.map((m) => m.onHalf)),
    radii: summarise(flat((m) => m.radii)),
    strokes: summarise(flat((m) => m.strokes)),
    symbols: icons.length,
    tightestGaps: summarise(
      icons.map((m) => m.tightestGap).filter((g): g is number => g !== null)
    ),
    tightestSeparated: summarise(
      icons
        .map((m) => m.tightestSeparated)
        .filter((g): g is number => g !== null)
    ),
    variant,
  };
};

/**
 * Share of icons with separated shapes that a candidate `minGap` would flag.
 * The test that decides whether a constant is a house rule or a mass-violation
 * generator. Icons whose shapes all overlap or touch are not counted: no gap
 * rule applies to them.
 */
export const flaggedBy = (
  m: Pick<VariantMeasurement, "icons">,
  minGap: number
): number => {
  const withGaps = m.icons.filter((i) => i.tightestSeparated !== null);
  if (withGaps.length === 0) {
    return 0;
  }
  const hit = withGaps.filter(
    (i) => (i.tightestSeparated as number) < minGap
  ).length;
  return hit / withGaps.length;
};

export { K90 };
