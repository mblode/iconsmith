/**
 * Will this icon survive a smaller optical cut?
 *
 * The question this answers is not "is this icon complicated" — it is "when the
 * same drawing is refit onto a smaller grid at a heavier relative stroke, does
 * any of its white space close up". Those are different questions, and only the
 * second one costs a designer an afternoon.
 *
 * The arithmetic that drives everything here: refitting a 24-unit drawing onto
 * a 16-unit grid scales every distance by 2/3, while the stroke goes 1.5 → 1.25,
 * a factor of 5/6. Ink shrinks more slowly than the space between it. So the
 * white gap between two strokes, which is their centre-line distance minus one
 * full stroke width (half a stroke belongs to each), goes
 *
 *     gap@24 = d − 1.5        →        gap@16 = (2/3)·d − 1.25
 *
 * and a drawing whose tightest gap is 2.5 units at 24 (a comfortable 1.0 of
 * white) lands at 0.42 of white on the 16 grid. That is the whole failure mode,
 * and it is arithmetic rather than judgement, which is why it can be measured
 * across a set rather than reviewed icon by icon.
 *
 * Everything is reported in **device pixels at the render size**, not in grid
 * units, because that is the only frame in which "does this merge" has an
 * answer. On the 16 grid at 16px, one unit is one pixel; at 12px it is 0.75.
 *
 * One complication the arithmetic has to carry: 242 of the 2,085 icons in the
 * outlined corpus carry no stroke at all (they are filled brand glyphs — Apple,
 * Anthropic, Behance) and another 303 mix filled shapes into a stroked drawing.
 * A filled contour has no stroke to subtract, so the white gap between two
 * pieces is their centre-line distance minus half of *each* piece's own stroke.
 * Treating everything as a 1.25 stroke understates the white in a quarter of
 * the set, which is why stroke is read per path rather than assumed.
 *
 * Rendering is delegated to `render.ts` — this module measures, it does not
 * rasterise.
 */
import sharp from "sharp";

import { bbox, parsePath } from "../geometry/path.js";
import { flatten } from "../parts/shape.js";
import type { Subpath } from "../types.js";
import { cosine, png } from "./render.js";

/** The cut being measured from, and the cut being measured for. */
export interface CutSpec {
  /** Grid the source is drawn on. */
  fromGrid: number;
  /** Stroke width in source grid units. */
  fromStroke: number;
  /** Grid the refit lands on. */
  toGrid: number;
  /** Stroke width in target grid units. */
  toStroke: number;
}

/** Central's 24@1.5 outline cut, refit to the 16@1.25 cut. */
export const CUT_24_TO_16: CutSpec = {
  fromGrid: 24,
  fromStroke: 1.5,
  toGrid: 16,
  toStroke: 1.25,
};

/** Segments per curve when flattening. Coarser than fingerprinting needs: a
 *  gap only has to be measured to a fraction of a stroke. */
const FLATTEN_STEPS = 8;
/**
 * Centre-lines closer than one source stroke width are overlapping ink, not a
 * gap. This is the correction that makes the whole measure mean anything: this
 * set routinely butts one stroke into another without making the coordinates
 * exactly coincident — `add-image` starts its mountain line 1.00 unit from the
 * frame's corner, `agents` overlaps three heads at 0.88 — and with a 1.5 stroke
 * those already share ink at 24. A refit cannot close a gap that was never
 * open, so these pairs are one piece of ink and this measure says nothing about
 * them. The threshold is the source stroke itself rather than a constant,
 * because that is the definition of overlapping.
 */
/**
 * White gap at the source cut below which two pieces are abutting rather than
 * separated, in source grid units.
 *
 * This is the correction that makes the whole measure mean anything. The set
 * routinely butts one stroke into another without making the coordinates
 * coincident — `add-image` starts its mountain line 1.00 unit from the frame's
 * corner, `agents` overlaps three heads at 0.88 — and with a 1.5 stroke those
 * already share ink. A refit cannot close a gap that was never open, so such
 * pairs are one piece of ink and this measure says nothing about them. Whether
 * the resulting pile-up is a problem is what `countJunctions` answers.
 */
const JOINED_EPSILON = 0.05;
/** Points closer than this along the same subpath are immediate neighbours.
 *  Measured in source grid units. */
const SELF_EXCLUSION = 2.5;
/**
 * How far a path must travel to come back to a given distance before that
 * counts as folding back on itself rather than simply curving.
 *
 * Without this every smooth stroke reports a false gap. On a circle of radius
 * 9 the chord between two points 2.5 of arc apart is 2.49 — so a plain
 * `circle`, one path with nothing near it, reported a 1.14-unit gap that was
 * just the arc-length exclusion window measured across the curve. A genuine
 * fold travels much further than the distance it closes; a curve travels about
 * the same. Two is the line between those.
 */
const FOLD_RATIO = 2;
/** Polyline samples around a circle, ellipse or rounded rect. */
const SHAPE_STEPS = 48;
/** Raster grid for the fidelity comparison, matching `render.inkVector`. */
const VECTOR_SIZE = 48;
const VECTOR_BLUR = 1.6;

type Point = [number, number];

/** One drawn path: its flattened outline and the stroke it carries. A filled
 *  shape has stroke 0, and that zero is load-bearing everywhere below. */
export interface Piece {
  closed: boolean;
  poly: Point[];
  segs: number;
  stroke: number;
}

export interface LegibilityMetrics {
  /** True when the icon carries no stroke at all: a filled glyph, which scales
   *  rather than being refit, and whose risk is thin filled features closing. */
  filledOnly: boolean;
  /** Smallest enclosed counter, in device px² at the small render size. Null
   *  when the icon encloses nothing. */
  counterArea: number | null;
  /** Mean darkness over the em at the target size, 0-1. */
  inkDensity: number;
  /** Junctions where three or more stroke directions meet. */
  junctions: number;
  /** Total centre-line length, in target grid units. */
  length: number;
  /**
   * The tightest white gap between two distinct pieces of ink, in device px at
   * the small render size. This is the number that predicts merging. Null when
   * the icon has only one piece of ink that never approaches itself.
   */
  minGap: number | null;
  /** The same gap before the refit, in source grid units: the white a designer
   *  reads off the 24 drawing today. */
  minGapSource: number | null;
  name: string;
  segments: number;
  /**
   * How many distinct pairs of ink sit closer than `gapTight` after the refit.
   * The difference between "one spot to nudge" and "packed throughout", which
   * is the difference between a mechanical fix and a redraw — the tightest gap
   * alone cannot tell those apart.
   */
  tightPairs: number;
  /** Cosine between the icon rendered small and rendered large: how much of the
   *  shape survives rasterisation at the small size. 1.0 is lossless. */
  smallFidelity: number;
  subpaths: number;
}

const dist = (a: Point, b: Point): number =>
  Math.hypot(a[0] - b[0], a[1] - b[1]);

/** Cumulative arc length along a polyline, for the self-proximity exclusion. */
const arcLengths = (poly: Point[]): number[] => {
  const out = [0];
  for (let i = 1; i < poly.length; i += 1) {
    out.push(out[i - 1] + dist(poly[i - 1], poly[i]));
  }
  return out;
};

const polyLength = (poly: Point[]): number => {
  let total = 0;
  for (let i = 1; i < poly.length; i += 1) {
    total += dist(poly[i - 1], poly[i]);
  }
  return total;
};

/** White between two pieces at the source cut: half of each stroke lies between
 *  their centre lines, so the ink closing the gap is the mean of the two. */
const sourceGap = (d: number, a: Piece, b: Piece): number =>
  d - (a.stroke + b.stroke) / 2;

/** Shoelace area of a closed polyline. */
const area = (poly: Point[]): number => {
  let sum = 0;
  for (let i = 0; i < poly.length; i += 1) {
    const [x0, y0] = poly[i];
    const [x1, y1] = poly[(i + 1) % poly.length];
    sum += x0 * y1 - x1 * y0;
  }
  return Math.abs(sum) / 2;
};

/**
 * Closest approach between two pieces of ink, as a raw centre-line distance.
 *
 * Whether that distance counts as a gap at all is the caller's decision, and it
 * depends on both pieces' strokes: contact is a property of the pair, not of a
 * point pair. Two strokes that meet or cross pass through every distance from
 * zero upward as the polyline is sampled, so filtering near-contact point pairs
 * here would leave an arbitrarily small survivor and report a gap that is not
 * there.
 */
const closestApproach = (a: Point[], b: Point[]): number | null => {
  let min = Number.POSITIVE_INFINITY;
  for (const p of a) {
    for (const q of b) {
      const d = dist(p, q);
      if (d < min) {
        min = d;
      }
    }
  }
  return Number.isFinite(min) ? min : null;
};

/** The same, within one subpath: a stroke folding back near itself. A pair
 *  counts only where the path travelled `FOLD_RATIO` times further than the
 *  distance it closed, which is what separates a fold from a curve. */
const selfApproach = (poly: Point[], exclusion: number): number | null => {
  const s = arcLengths(poly);
  let min = Number.POSITIVE_INFINITY;
  for (let i = 0; i < poly.length; i += 1) {
    for (let j = i + 1; j < poly.length; j += 1) {
      const arc = s[j] - s[i];
      if (arc < exclusion) {
        continue;
      }
      const d = dist(poly[i], poly[j]);
      if (arc < d * FOLD_RATIO) {
        continue;
      }
      if (d < min) {
        min = d;
      }
    }
  }
  return Number.isFinite(min) ? min : null;
};

/**
 * Places where three or more stroke directions meet.
 *
 * Counted from subpath endpoints: an endpoint contributes one direction, and a
 * polyline passing within half a stroke of it contributes two, because ink
 * continues out either side. Three or more is a junction — the place where a
 * heavier relative stroke piles ink into a blob.
 *
 * What this misses: a subpath crossing itself, and junctions drawn as one
 * continuous path rather than as separate strokes meeting.
 */
const countJunctions = (polys: Point[][], stroke: number): number => {
  const reach = stroke / 2;
  let total = 0;
  for (const [i, poly] of polys.entries()) {
    for (const end of [poly[0], poly.at(-1) as Point]) {
      let degree = 1;
      for (const [j, other] of polys.entries()) {
        if (i === j) {
          continue;
        }
        const near = other.some((p) => dist(p, end) <= reach);
        if (near) {
          const isEnd =
            dist(other[0], end) <= reach ||
            dist(other.at(-1) as Point, end) <= reach;
          degree += isEnd ? 1 : 2;
        }
      }
      if (degree >= 3) {
        total += 1;
      }
    }
  }
  // Each junction is found once per endpoint sitting on it, so a three-stroke
  // meeting point is counted three times.
  return Math.round(total / 3);
};

/** Ink as a vector, from an already-rendered PNG. Decoding, not rendering:
 *  the raster comes from `render.png` so there is one rasteriser in the tree. */
const vector = async (buf: Buffer): Promise<number[]> => {
  const raw = await sharp(buf)
    .resize(VECTOR_SIZE, VECTOR_SIZE, { fit: "fill" })
    .greyscale()
    .blur(VECTOR_BLUR)
    .raw()
    .toBuffer();
  return Array.from(raw, (v) => (255 - v) / 255);
};

/** Mean darkness over the em, from an already-rendered PNG. */
const density = async (buf: Buffer): Promise<number> => {
  const raw = await sharp(buf).greyscale().raw().toBuffer();
  let sum = 0;
  for (const v of raw) {
    sum += (255 - v) / 255;
  }
  return sum / raw.length;
};

export interface MeasureOptions {
  cut?: CutSpec;
  /** The size the icon must still read at. The brief is 16px legible to 12px. */
  smallSize?: number;
  /** Reference render, treated as the shape the small one is judged against. */
  referenceSize?: number;
  /** White gap, in device px, under which a pair counts toward `tightPairs`. */
  tightPairLimit?: number;
}

/**
 * Measure one icon against a target cut.
 *
 * `svg` is the source drawing, unmodified — nothing here rewrites geometry.
 * The refit is modelled by arithmetic on the measurements, because the 16px cut
 * does not exist yet and inventing one to measure it would measure the
 * invention.
 */
/** Points around a circle or ellipse, sampled finely enough that the polyline's
 *  chord error is well under the tolerances anything here measures. */
const ellipsePoly = (cx: number, cy: number, rx: number, ry: number): Point[] =>
  Array.from({ length: SHAPE_STEPS }, (_, i) => {
    const a = (i / SHAPE_STEPS) * 2 * Math.PI;
    return [cx + rx * Math.cos(a), cy + ry * Math.sin(a)] as Point;
  });

/** Points around a rectangle, with quarter-ellipse corners when it is rounded. */
const rectPoly = (
  x: number,
  y: number,
  w: number,
  h: number,
  rx: number,
  ry: number
): Point[] => {
  const r = Math.min(rx, w / 2);
  const t = Math.min(ry, h / 2);
  if (r <= 0 || t <= 0) {
    return [
      [x, y],
      [x + w, y],
      [x + w, y + h],
      [x, y + h],
    ];
  }
  const per = Math.max(2, Math.round(SHAPE_STEPS / 4));
  const arc = (cx: number, cy: number, from: number): Point[] =>
    Array.from({ length: per + 1 }, (_, i) => {
      const a = from + (i / per) * (Math.PI / 2);
      return [cx + r * Math.cos(a), cy + t * Math.sin(a)] as Point;
    });
  return [
    ...arc(x + w - r, y + t, -Math.PI / 2),
    ...arc(x + w - r, y + h - t, 0),
    ...arc(x + r, y + h - t, Math.PI / 2),
    ...arc(x + r, y + t, Math.PI),
  ];
};

const num = (attrs: string, name: string): number => {
  const m = new RegExp(`\\s${name}="(?<v>[-\\d.]+)"`, "u").exec(attrs);
  return m?.groups?.v === undefined ? 0 : Number(m.groups.v);
};

/**
 * Split an SVG into pieces, reading each element's own stroke.
 *
 * `stroke-width` is taken from the element when present, falls back to the
 * cut's stroke when an element is stroked without saying how wide, and is zero
 * when the element is filled only.
 *
 * `<circle>`, `<ellipse>` and `<rect>` are read as well as `<path>`: 239 of the
 * 2,085 files place a shape that way — `user` draws its head as a `<circle>` —
 * and a parser that only saw `<path>` would silently measure those icons with a
 * whole shape missing, which is the failure mode most likely to put a wrong
 * number into a report.
 *
 * Not handled, and small enough to name: the 6 files carrying a `<clipPath>`,
 * whose clip geometry is measured as if it were drawn.
 */
export const parsePieces = (svg: string, fallbackStroke: number): Piece[] => {
  const out: Piece[] = [];
  for (const el of svg.matchAll(
    /<(?<tag>path|circle|ellipse|rect)\b(?<attrs>[^>]*)>/gu
  )) {
    const attrs = el.groups?.attrs ?? "";
    const stroked = /\sstroke="(?!none)/u.test(attrs);
    const width = /\sstroke-width="(?<w>[\d.]+)"/u.exec(attrs)?.groups?.w;
    const stroke = stroked ? Number(width ?? fallbackStroke) : 0;

    if (el.groups?.tag === "path") {
      const data = /\sd="(?<d>[^"]+)"/u.exec(attrs)?.groups?.d;
      if (!data) {
        continue;
      }
      for (const sp of parsePath(data) as Subpath[]) {
        out.push({
          closed: sp.closed,
          poly: flatten(sp, FLATTEN_STEPS),
          segs: sp.segs.length,
          stroke,
        });
      }
      continue;
    }

    let poly: Point[] = [];
    if (el.groups?.tag === "circle") {
      const r = num(attrs, "r");
      poly = ellipsePoly(num(attrs, "cx"), num(attrs, "cy"), r, r);
    } else if (el.groups?.tag === "ellipse") {
      poly = ellipsePoly(
        num(attrs, "cx"),
        num(attrs, "cy"),
        num(attrs, "rx"),
        num(attrs, "ry")
      );
    } else {
      const rx = num(attrs, "rx");
      poly = rectPoly(
        num(attrs, "x"),
        num(attrs, "y"),
        num(attrs, "width"),
        num(attrs, "height"),
        rx,
        num(attrs, "ry") || rx
      );
    }
    if (poly.length > 0) {
      out.push({ closed: true, poly, segs: poly.length, stroke });
    }
  }
  return out;
};

export const measureLegibility = async (
  name: string,
  svg: string,
  {
    cut = CUT_24_TO_16,
    referenceSize = 96,
    smallSize = 16,
    tightPairLimit = 1,
  }: MeasureOptions = {}
): Promise<LegibilityMetrics> => {
  const pieces = parsePieces(svg, cut.fromStroke);
  const polys = pieces.map((p) => p.poly);

  // Source units → target grid units → device px at the small render.
  const refit = cut.toGrid / cut.fromGrid;

  // Half of each piece's stroke stands between their centre lines, so the ink
  // closing the gap is the mean of the two strokes — 1.25 for two stroked
  // paths, 0 for two filled contours, 0.625 for one of each.
  const strokeRatio = cut.toStroke / cut.fromStroke;
  const targetGapPx = (d: number, a: Piece, b: Piece) =>
    (d * refit - ((a.stroke + b.stroke) / 2) * strokeRatio) *
    (smallSize / cut.toGrid);

  let tightest: number | null = null;
  let tightestSource: number | null = null;
  let tightPairs = 0;
  const consider = (d: number | null, a: Piece, b: Piece) => {
    if (d === null || sourceGap(d, a, b) < JOINED_EPSILON) {
      return;
    }
    const px = targetGapPx(d, a, b);
    if (tightest === null || px < tightest) {
      tightest = px;
      tightestSource = sourceGap(d, a, b);
    }
    if (px < tightPairLimit) {
      tightPairs += 1;
    }
  };
  for (let i = 0; i < pieces.length; i += 1) {
    consider(selfApproach(polys[i], SELF_EXCLUSION), pieces[i], pieces[i]);
    for (let j = i + 1; j < pieces.length; j += 1) {
      consider(closestApproach(polys[i], polys[j]), pieces[i], pieces[j]);
    }
  }

  const minGap: number | null = tightest;

  // Smallest counter: the enclosed area less the ring the stroke eats. Inset by
  // half a stroke all round, so A − P·s/2 + π(s/2)², clamped at zero.
  // Smallest counter: the enclosed white a stroked outline enrings, less the
  // ring the stroke itself eats — A − P·s/2 + π(s/2)², clamped at zero.
  //
  // Only stroked pieces have counters. A closed *filled* contour encloses ink,
  // not white: its enclosed area is the mark. Counting that as a counter marks
  // small solid shapes — `sparkle`, the small chevron triangles — as losing an
  // interior they never had.
  let counter: number | null = null;
  for (const piece of pieces) {
    if (!(piece.closed && piece.stroke > 0)) {
      continue;
    }
    const { poly } = piece;
    const inset = (piece.stroke * strokeRatio) / 2;
    const open = Math.max(
      0,
      area(poly) * refit * refit -
        polyLength(poly) * refit * inset +
        Math.PI * inset * inset
    );
    if (counter === null || open < counter) {
      counter = open;
    }
  }

  const px = smallSize / cut.toGrid;

  const [small, big] = await Promise.all([
    png(svg, smallSize),
    png(svg, referenceSize),
  ]);
  const [vs, vb, ink] = await Promise.all([
    vector(small),
    vector(big),
    density(small),
  ]);

  return {
    counterArea: counter === null ? null : counter * px * px,
    filledOnly: pieces.length > 0 && pieces.every((p) => p.stroke === 0),
    inkDensity: ink,
    junctions: countJunctions(polys, cut.fromStroke),
    length: polys.reduce((n, p) => n + polyLength(p), 0) * refit,
    minGap,
    minGapSource: tightestSource,
    name,
    segments: pieces.reduce((n, p) => n + p.segs, 0),
    smallFidelity: cosine(vs, vb),
    subpaths: pieces.length,
    tightPairs,
  };
};

export type Band = "mechanical" | "needs-redraw" | "needs-review";

/**
 * Where the bands sit, in device px at the small render size.
 *
 * These are not quantiles of the corpus — they are the pixel arithmetic of
 * rasterisation. A gap needs about one whole device pixel of background to read
 * as a gap; below half a pixel the two strokes share every pixel they touch and
 * merge into one mark whatever the renderer does. The band edges are those two
 * facts, and `bandSensitivity` reports how much the answer moves if you
 * disagree with them.
 */
export interface Thresholds {
  /** Below this white gap, ink merges: a redraw decision. */
  gapMerge: number;
  /** Below this, the gap survives but is not comfortable: a human should look. */
  gapTight: number;
  /** Below this counter area (device px²), an enclosed space fills in. */
  counterMin: number;
  /** At or above this, ink is piling up at meeting points. */
  junctionMax: number;
  /** Below this rendered fidelity, the small raster is not the same shape. */
  fidelityMin: number;
  /** At or above this many tight pairs, the drawing is packed throughout
   *  rather than tight in one place, and nudging will not save it. */
  tightPairsMax: number;
}

/**
 * Four of these five are pixel arithmetic; one is a distributional cut, and the
 * difference is stated rather than blurred.
 *
 * `gapMerge` 0.5 and `gapTight` 1.0: a gap needs about one whole device pixel
 * of background to read as a gap, and below half a pixel the two strokes share
 * every pixel they touch and merge whatever the rasteriser does.
 * `counterMin` 1.0 px²: an enclosed space smaller than one pixel is not one.
 * `tightPairsMax` 6: the 90th percentile of the corpus — above it, tight spots
 * are the drawing's character rather than a defect in it.
 * `fidelityMin` is the only one with no pixel derivation: it is the 5th
 * percentile of the corpus at the size being measured. It is a "look at the
 * unusual ones" signal, not a pass/fail, and it is deliberately weak.
 */
export const DEFAULT_THRESHOLDS: Thresholds = {
  counterMin: 1,
  fidelityMin: 0.956,
  gapMerge: 0.5,
  gapTight: 1,
  junctionMax: 4,
  tightPairsMax: 6,
};

export interface Verdict {
  band: Band;
  /** Every threshold this icon failed, worst first. Empty when mechanical. */
  reasons: string[];
}

/** Band one icon. A single merge-level failure is enough to demand a redraw:
 *  the others compound the case but do not, alone, force a design decision. */
export const band = (
  m: LegibilityMetrics,
  t: Thresholds = DEFAULT_THRESHOLDS
): Verdict => {
  const redraw: string[] = [];
  const review: string[] = [];

  if (m.minGap !== null && m.minGap < t.gapMerge) {
    redraw.push(`gap ${m.minGap.toFixed(2)}px < ${t.gapMerge}`);
  } else if (m.minGap !== null && m.minGap < t.gapTight) {
    review.push(`gap ${m.minGap.toFixed(2)}px < ${t.gapTight}`);
  }
  if (m.counterArea !== null && m.counterArea < t.counterMin) {
    redraw.push(`counter ${m.counterArea.toFixed(2)}px² < ${t.counterMin}`);
  }
  if (m.tightPairs >= t.tightPairsMax) {
    redraw.push(`${m.tightPairs} tight pairs`);
  } else if (m.tightPairs >= 2) {
    review.push(`${m.tightPairs} tight pairs`);
  }
  if (m.smallFidelity < t.fidelityMin) {
    review.push(`fidelity ${m.smallFidelity.toFixed(3)} < ${t.fidelityMin}`);
  }
  if (m.junctions >= t.junctionMax) {
    review.push(`${m.junctions} junctions`);
  }

  if (redraw.length > 0) {
    return { band: "needs-redraw", reasons: [...redraw, ...review] };
  }
  if (review.length > 0) {
    return { band: "needs-review", reasons: review };
  }
  return { band: "mechanical", reasons: [] };
};

/**
 * How much the bands move when the thresholds do.
 *
 * A triage whose headline number is an artefact of one chosen constant is not a
 * finding. This reports the band sizes across a sweep of the gap thresholds, so
 * the reader can see whether the split is a property of the set or of the knob.
 */
export const bandSensitivity = (
  metrics: LegibilityMetrics[],
  sweep: number[],
  base: Thresholds = DEFAULT_THRESHOLDS
): { counts: Record<Band, number>; gapMerge: number }[] =>
  sweep.map((gapMerge) => {
    const counts: Record<Band, number> = {
      mechanical: 0,
      "needs-redraw": 0,
      "needs-review": 0,
    };
    for (const m of metrics) {
      counts[band(m, { ...base, gapMerge }).band] += 1;
    }
    return { counts, gapMerge };
  });

/** The bounding box of an icon's ink, for callers that want to report extent
 *  alongside the bands. Kept here so a triage run parses each file once. */
export const inkBox = (svg: string) =>
  bbox(
    [...svg.matchAll(/\sd="(?<data>[^"]+)"/gu)].flatMap((m) =>
      parsePath(m.groups?.data ?? "")
    )
  );
