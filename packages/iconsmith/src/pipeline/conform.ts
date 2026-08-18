/**
 * Conform: move an icon between Central's finish variants, and score the result
 * against Central's own answer for the destination.
 *
 * 2,085 symbols × 30 finishes is the controlled experiment the cross-set
 * comparison could never be. Construction is held constant, only the finish
 * varies, and there is ground truth for every pair — so "did the transform get
 * it right" has an actual answer rather than a vibe.
 *
 * Two mechanisms are real and implemented here:
 *
 *   - **Stroke** is not a render attribute. Changing it changes path geometry in
 *     ~90% of icons, because Central shrinks the skeleton by exactly the stroke
 *     increase, half per side, to hold the keyline. Visual extent is therefore
 *     constant across strokes (median delta 0.000px, 1→2). That is
 *     `compensateStroke`.
 *   - **Corner radius** retiers the quarter-turn arcs between straight edges.
 *     ~40% of icons have no such corner and are byte-identical across radius
 *     variants; retiering reproduces Central exactly for a further ~13-18% of
 *     them. That is `retierCorners`.
 *
 * One is not, and is refused rather than faked: **outlined → filled** shares
 * only 7% of its path data and changes subpath count in 58% of icons. It is a
 * different drawing of the same idea, not a transform of this one.
 *
 * On the metric: rendered cosine — the instrument calibrated against 0.737 for
 * `iconsmith eval` — is the wrong tool here and reports 0.98+ for *doing nothing*.
 * It was built to separate two drawings of one concept, not one drawing at two
 * finishes. Conform scores in path distance instead, where the scale has room.
 */
import type {
  Corpus,
  CorpusIcon,
  CorpusShape,
  Variant,
} from "../corpus/load.js";
import { bbox, parsePath, serialise } from "../geometry/path.js";
import { flatten } from "../parts/shape.js";
import type { Segment, Subpath } from "../types.js";

/** Circular arc → cubic handle ratio, the same constant `canvas.ts` draws with. */
const K = 0.5523;
/** Points per curve when flattening for distance. Distance is measured to a
 *  hundredth of a pixel; this is more than enough resolution for that. */
const FLATTEN = 8;
/** Handle and chord tolerance for calling a cubic a corner arc of radius r. */
const CORNER_TOLERANCE = 0.02;
const CHORD_TOLERANCE = 0.05;
/** Below this a shape has no meaningful extent to compensate against. */
const MIN_EXTENT = 1;

type Point = [number, number];
type Map1 = (v: number) => number;

const mapSubpath = (sp: Subpath, fx: Map1, fy: Map1): Subpath => ({
  closed: sp.closed,
  segs: sp.segs.map((s): Segment => {
    if (s.t === "L") {
      return { p: [fx(s.p[0]), fy(s.p[1])], t: "L" };
    }
    if (s.t === "C") {
      return {
        p: [
          fx(s.p[0]),
          fy(s.p[1]),
          fx(s.p[2]),
          fy(s.p[3]),
          fx(s.p[4]),
          fy(s.p[5]),
        ],
        t: "C",
      };
    }
    // An arc's radii are not scaled here: nothing in the corpus uses arcs, and
    // guessing at rx/ry would be a silent distortion if one ever appeared.
    return {
      p: [s.p[0], s.p[1], s.p[2], s.p[3], s.p[4], fx(s.p[5]), fy(s.p[6])],
      t: "A",
    };
  }),
  start: [fx(sp.start[0]), fy(sp.start[1])],
});

const mapPath = (d: string, fx: Map1, fy: Map1): string =>
  serialise(parsePath(d).map((sp) => mapSubpath(sp, fx, fy)));

/** Every shape's path data as one set of subpaths, for a whole-icon bbox. */
const allSubpaths = (shapes: CorpusShape[]): Subpath[] =>
  shapes.flatMap((s) => parsePath(s.d));

/**
 * A shape's stroke width in the destination variant.
 *
 * Measured across 4,521 shape pairs at 1.5→2: 94.7% sit exactly at the variant
 * stroke and move with it — including dots, which Central draws as zero-length
 * round-capped segments whose stroke width *is* the dot's diameter. The rest do
 * not. Thirteen shapes hold a fixed width regardless of variant (`adjust-photo`
 * and its 2.2px marks), and ~228 hairlines run their own schedule (0.25 / 0.5 /
 * 0.75 against strokes 1 / 1.5 / 2). Both are deliberate exceptions, and
 * forcing them onto the variant stroke is a confident wrong answer, so a width
 * that was not the source variant's is left exactly as it is.
 */
const restroke = (width: number, from: number, to: number): number => {
  if (width === 0) {
    return 0;
  }
  return Math.abs(width - from) < 1e-9 ? to : width;
};

/**
 * Hold the visual extent across a stroke change.
 *
 * The keyline is a visual extent — path bounds plus the stroke, half each side
 * — so a heavier stroke has to be drawn on a smaller skeleton to occupy the
 * same box. Each axis shrinks by the full stroke delta, which is an anisotropic
 * scale about the content centre rather than a uniform one: measured against
 * Central, anisotropic beats uniform (median error 0.146px against 0.166px at
 * 1.5→2), because Central holds *both* keyline edges, not the larger one.
 */
export const compensateStroke = (
  shapes: CorpusShape[],
  from: number,
  to: number
): CorpusShape[] => {
  const delta = to - from;
  if (delta === 0 || shapes.length === 0) {
    return shapes;
  }
  const b = bbox(allSubpaths(shapes));
  if (b.w < MIN_EXTENT || b.h < MIN_EXTENT) {
    return shapes;
  }
  const cx = b.x0 + b.w / 2;
  const cy = b.y0 + b.h / 2;
  const kx = (b.w - delta) / b.w;
  const ky = (b.h - delta) / b.h;
  return shapes.map((s) => ({
    ...s,
    d: mapPath(
      s.d,
      (x) => cx + (x - cx) * kx,
      (y) => cy + (y - cy) * ky
    ),
    strokeWidth: restroke(s.strokeWidth, from, to),
  }));
};

const dot = (a: Point, b: Point): number => a[0] * b[0] + a[1] * b[1];
const norm = (a: Point): number => Math.hypot(a[0], a[1]);

interface Corner {
  /** Unit tangent leaving the arc. */
  out: Point;
  /** Unit tangent entering the arc. */
  in: Point;
  /** Where the two tangent lines meet: the unrounded corner point. */
  vertex: Point;
}

/**
 * Is this cubic a quarter-turn corner of radius `r` between two straight edges?
 *
 * The "between two straight edges" half is what separates a rounded rectangle's
 * corner from a circle's quadrant, which has identical handle lengths and an
 * identical chord. Without it the detector rounds circles into lozenges.
 */
const asCorner = (
  seg: Segment,
  cur: Point,
  r: number,
  framed: boolean
): Corner | null => {
  if (seg.t !== "C" || !framed || r <= 0) {
    return null;
  }
  const [c1x, c1y, c2x, c2y, ex, ey] = seg.p;
  const t1: Point = [c1x - cur[0], c1y - cur[1]];
  const t2: Point = [ex - c2x, ey - c2y];
  const h1 = norm(t1);
  const h2 = norm(t2);
  if (h1 < 1e-6 || h2 < 1e-6) {
    return null;
  }
  const perpendicular = Math.abs(dot(t1, t2)) < 1e-3 * h1 * h2;
  const chord = Math.hypot(ex - cur[0], ey - cur[1]);
  const matches =
    Math.abs(h1 - r * K) < CORNER_TOLERANCE &&
    Math.abs(h2 - r * K) < CORNER_TOLERANCE &&
    Math.abs(chord - r * Math.SQRT2) < CHORD_TOLERANCE;
  if (!(perpendicular && matches)) {
    return null;
  }
  const u1: Point = [t1[0] / h1, t1[1] / h1];
  const u2: Point = [t2[0] / h2, t2[1] / h2];
  return {
    in: u1,
    out: u2,
    vertex: [cur[0] + u1[0] * r, cur[1] + u1[1] * r],
  };
};

/** Where a segment leaves the pen. */
const endOf = (seg: Segment): Point => {
  if (seg.t === "A") {
    return [seg.p[5], seg.p[6]];
  }
  if (seg.t === "C") {
    return [seg.p[4], seg.p[5]];
  }
  return [seg.p[0], seg.p[1]];
};

/** Re-point the previous segment at the arc's new start. */
const retarget = (segs: Segment[], p: Point): void => {
  const prev = segs.at(-1);
  if (!prev) {
    return;
  }
  const [px, py] = p;
  if (prev.t === "L") {
    prev.p = [px, py];
  } else if (prev.t === "C") {
    prev.p[4] = px;
    prev.p[5] = py;
  }
};

const retierSubpath = (sp: Subpath, from: number, to: number): Subpath => {
  const isLine = (i: number): boolean => sp.segs[i]?.t === "L";
  const segs: Segment[] = [];
  const [sx, sy] = sp.start;
  let start: Point = [sx, sy];
  let cur: Point = [sx, sy];
  for (const [i, seg] of sp.segs.entries()) {
    const framed =
      (i === 0 || isLine(i - 1)) && (i === sp.segs.length - 1 || isLine(i + 1));
    const corner = asCorner(seg, cur, from, framed);
    if (corner) {
      const ns: Point = [
        corner.vertex[0] - corner.in[0] * to,
        corner.vertex[1] - corner.in[1] * to,
      ];
      const ne: Point = [
        corner.vertex[0] + corner.out[0] * to,
        corner.vertex[1] + corner.out[1] * to,
      ];
      if (segs.length === 0) {
        start = ns;
      } else {
        retarget(segs, ns);
      }
      // Radius 0 is a hard corner: the arc collapses to the vertex itself and
      // becomes a line, rather than a zero-radius cubic no renderer wants.
      segs.push(
        to === 0
          ? { p: [corner.vertex[0], corner.vertex[1]], t: "L" }
          : {
              p: [
                ns[0] + corner.in[0] * to * K,
                ns[1] + corner.in[1] * to * K,
                ne[0] - corner.out[0] * to * K,
                ne[1] - corner.out[1] * to * K,
                ne[0],
                ne[1],
              ],
              t: "C",
            }
      );
      cur = ne;
      continue;
    }
    segs.push(seg);
    cur = endOf(seg);
  }
  return { closed: sp.closed, segs, start };
};

/**
 * Retier every rounded-rect corner from one radius tier to another.
 *
 * Only corners actually drawn at the source radius are touched, so an icon with
 * no such corner comes back unchanged — which is the correct answer for ~40% of
 * the set, whose radius variants are byte-identical.
 */
export const retierCorners = (
  shapes: CorpusShape[],
  from: number,
  to: number
): CorpusShape[] => {
  if (from === to) {
    return shapes;
  }
  return shapes.map((s) => ({
    ...s,
    d: serialise(parsePath(s.d).map((sp) => retierSubpath(sp, from, to))),
  }));
};

export interface ConformResult {
  shapes: CorpusShape[];
  /** Transforms applied, in order. */
  steps: string[];
  svg: string;
  /** Differences between the variants that this cannot synthesise. Non-empty
   *  means the output is not a candidate for the target and the score will say
   *  so; it is reported rather than thrown so a batch run does not stop. */
  unsupported: string[];
}

export const toSVG = (shapes: CorpusShape[]): string => {
  const body = shapes
    .map((s) =>
      s.strokeWidth === 0
        ? `<path d="${s.d}" fill="currentColor"/>`
        : `<path d="${s.d}" stroke="currentColor" stroke-width="${s.strokeWidth}" stroke-linecap="${s.cap}" stroke-linejoin="round" fill="none"/>`
    )
    .join("");
  return `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;
};

/**
 * Move an icon from one variant to another.
 *
 * Order matters: corners retier on the source skeleton, then the whole thing is
 * compensated for the stroke change. Doing it the other way round measures the
 * corner radius against an already-scaled skeleton, and the radius tiers are
 * absolute sizes rather than proportions.
 */
export const conform = (icon: CorpusIcon, to: Variant): ConformResult => {
  const from = icon.variant;
  const steps: string[] = [];
  const unsupported: string[] = [];

  if (from.style !== to.style) {
    unsupported.push(
      `${from.style} → ${to.style} is a redraw, not a transform: the two styles share 7% of their path data and 58% of icons change subpath count.`
    );
  }
  if (from.corner !== to.corner) {
    // The corner axis flips linecap and linejoin together: measured on
    // radius-0 stroke-2, round ships 3,854 round caps to 255 square and every
    // join round, while square ships 2,733 square caps and drops linejoin to
    // miter on all but 241 shapes. Caps are not what moves the extent — round
    // and square caps both project half a stroke past an endpoint — but a
    // mitred join reaches stroke/2·√2 into a right-angle corner where a round
    // one reaches stroke/2, and Central redraws to absorb the difference.
    unsupported.push(
      `${from.corner} → ${to.corner} swaps round joins for mitred ones, which reach further into every corner; Central redraws for it (median 1.0px of path movement).`
    );
  }

  // Both mechanisms assume the path *is* the skeleton. In a filled variant it
  // is the outline of the stroked skeleton, so every corner appears twice at
  // r ± stroke/2 and the extent does not rescale with the stroke. Measured
  // across 1,440 filled stroke pairs, compensating scores worse than doing
  // nothing (0.270px against 0.205px), so filled geometry is left alone rather
  // than moved confidently in the wrong direction.
  const skeletal = from.style === "outlined" && to.style === "outlined";

  let { shapes } = icon;
  if (from.radius !== to.radius) {
    if (skeletal) {
      shapes = retierCorners(shapes, from.radius, to.radius);
      steps.push(`retier corners ${from.radius} → ${to.radius}`);
    } else {
      unsupported.push(
        `radius ${from.radius} → ${to.radius} on a filled icon: the path is an outline rather than a skeleton, so its corners are not the radius being retiered.`
      );
    }
  }
  if (from.stroke !== to.stroke) {
    if (skeletal) {
      shapes = compensateStroke(shapes, from.stroke, to.stroke);
      steps.push(`compensate stroke ${from.stroke} → ${to.stroke}`);
    } else {
      unsupported.push(
        `stroke ${from.stroke} → ${to.stroke} on a filled icon: Central re-expands the outline rather than rescaling it, and compensating measures worse than doing nothing.`
      );
    }
  }
  return { shapes, steps, svg: toSVG(shapes), unsupported };
};

const pointsOf = (shapes: CorpusShape[]): Point[] =>
  allSubpaths(shapes).flatMap((sp) => flatten(sp, FLATTEN));

const nearestMean = (from: Point[], to: Point[]): number => {
  let total = 0;
  for (const [x, y] of from) {
    let best = Number.POSITIVE_INFINITY;
    for (const [u, v] of to) {
      const d = (x - u) ** 2 + (y - v) ** 2;
      if (d < best) {
        best = d;
      }
    }
    total += Math.sqrt(best);
  }
  return total / from.length;
};

/**
 * Symmetric mean nearest-point distance between two drawings, in canvas units.
 *
 * Chosen over rendered cosine because cosine has no room left at this scale:
 * doing nothing at all scores 0.981 between two adjacent stroke variants, so a
 * transform can only ever move the number in the third decimal place. Distance
 * in px is both interpretable and open-ended — 0.25px is a quarter of the grid,
 * and everyone can picture that.
 */
export const pathDistance = (a: CorpusShape[], b: CorpusShape[]): number => {
  const pa = pointsOf(a);
  const pb = pointsOf(b);
  if (pa.length === 0 || pb.length === 0) {
    return Number.NaN;
  }
  return (nearestMean(pa, pb) + nearestMean(pb, pa)) / 2;
};

/**
 * The best a *rescaling* can do for one icon, fitted with the answer in hand.
 *
 * It uses the target's actual bounding box, which no real transform can know —
 * that is the point. For a stroke change, where the mechanism genuinely is a
 * rescale, whatever error survives this is Central redrawing and no better
 * compensation will recover it: it is the honest ceiling.
 *
 * For a radius change it is not a ceiling at all, because retiering a corner is
 * not a rescale of anything; the oracle then sits *above* a working transform.
 * That is why the report calls it a rescale residual and withholds "recovered"
 * whenever it does not bound the treatment.
 */
const oracleFit = (
  source: CorpusShape[],
  target: CorpusShape[]
): CorpusShape[] => {
  const b = bbox(allSubpaths(source));
  const t = bbox(allSubpaths(target));
  if (b.w < MIN_EXTENT || b.h < MIN_EXTENT) {
    return source;
  }
  const cx = b.x0 + b.w / 2;
  const cy = b.y0 + b.h / 2;
  const tcx = t.x0 + t.w / 2;
  const tcy = t.y0 + t.h / 2;
  const kx = t.w / b.w;
  const ky = t.h / b.h;
  return source.map((s) => ({
    ...s,
    d: mapPath(
      s.d,
      (x) => tcx + (x - cx) * kx,
      (y) => tcy + (y - cy) * ky
    ),
  }));
};

export interface ConformScore {
  /** Path data reproduced exactly (within a hundredth of a pixel). */
  exact: boolean;
  /** Error if nothing is done at all: the source against the target. */
  floor: number;
  /** Error left after an affine fitted with the answer in hand: how much of
   *  this pair's difference is pure rescaling. Bounds the treatment only when
   *  rescaling is the actual mechanism. */
  oracle: number;
  symbol: string;
  /** Error after `conform`. */
  treatment: number;
}

export interface ConformReport {
  ceiling: number;
  /** Upper quartile of the treatment. The median goes to zero as soon as most
   *  icons are reproduced, which reads as "nothing left to do" when there is;
   *  this is where the remaining work actually sits. */
  p75: number;
  /** Share of icons conform reproduced exactly. */
  exactRate: number;
  floor: number;
  from: string;
  icons: ConformScore[];
  n: number;
  oracle: number;
  /** Share of the achievable gain the transform actually captured. */
  recovered: number;
  /** Icons whose radius/stroke change conform left untouched because there was
   *  nothing of that kind in them — for which identity is the right answer. */
  unchangedRate: number;
  to: string;
  treatment: number;
  unsupported: string[];
}

export interface ScoreOptions {
  corpus: Corpus;
  from: string;
  /** Symbols to score. Defaults to every symbol present in both variants. */
  symbols?: string[];
  to: string;
}

const quantile = (xs: number[], f: number): number => {
  if (xs.length === 0) {
    return Number.NaN;
  }
  const s = xs.toSorted((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * f))];
};

const median = (xs: number[]): number => {
  if (xs.length === 0) {
    return Number.NaN;
  }
  const s = xs.toSorted((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

/** Within this, two drawings are the same drawing. */
const EXACT = 0.01;

export const scoreConform = async (
  options: ScoreOptions
): Promise<ConformReport> => {
  const { corpus, from, to } = options;
  const fromVariant = corpus.variant(from);
  const toVariant = corpus.variant(to);
  if (!fromVariant) {
    throw new Error(`Unknown variant "${from}".`);
  }
  if (!toVariant) {
    throw new Error(`Unknown variant "${to}".`);
  }

  const symbols = (options.symbols ?? corpus.symbols).filter(
    (s) => corpus.has(s, from) && corpus.has(s, to)
  );
  const icons: ConformScore[] = [];
  let unchanged = 0;
  const unsupported = new Set<string>();

  // Symbols are scored one at a time on purpose: each pair is two small file
  // reads and a lot of arithmetic, so the loop is CPU-bound and fanning it out
  // would only trade throughput for 62,550 open descriptors.
  const scoreOne = async (symbol: string) => {
    const [source, target] = await Promise.all([
      corpus.load(symbol, from),
      corpus.load(symbol, to),
    ]);
    const result = conform(source, toVariant);
    for (const u of result.unsupported) {
      unsupported.add(u);
    }
    const treatment = pathDistance(result.shapes, target.shapes);
    if (!Number.isFinite(treatment)) {
      return;
    }
    if (pathDistance(result.shapes, source.shapes) < EXACT) {
      unchanged += 1;
    }
    icons.push({
      exact: treatment < EXACT,
      floor: pathDistance(source.shapes, target.shapes),
      oracle: pathDistance(
        oracleFit(source.shapes, target.shapes),
        target.shapes
      ),
      symbol,
      treatment,
    });
  };

  const drain = async (i: number): Promise<void> => {
    if (i >= symbols.length) {
      return;
    }
    await scoreOne(symbols[i]);
    await drain(i + 1);
  };
  await drain(0);

  const floor = median(icons.map((i) => i.floor));
  const treatment = median(icons.map((i) => i.treatment));
  const oracle = median(icons.map((i) => i.oracle));
  // Only meaningful when the rescale oracle actually bounds the treatment; for
  // a corner retier it does not, and a ratio against it would read as failure
  // on a transform that landed the answer exactly.
  const achievable = oracle < treatment ? floor - oracle : Number.NaN;
  return {
    ceiling: 0,
    exactRate: icons.filter((i) => i.exact).length / (icons.length || 1),
    floor,
    from,
    icons: icons.toSorted((a, b) => b.treatment - a.treatment),
    n: icons.length,
    oracle,
    p75: quantile(
      icons.map((i) => i.treatment),
      0.75
    ),
    recovered: achievable > 0 ? (floor - treatment) / achievable : Number.NaN,
    to,
    treatment,
    unchangedRate: unchanged / (icons.length || 1),
    unsupported: [...unsupported],
  };
};

const row = (label: string, v: number, note: string): string =>
  `  ${label.padEnd(10)} ${Number.isFinite(v) ? `${v.toFixed(3)}px` : "  n/a  "}  ${note}`;

const pct = (v: number): string =>
  Number.isFinite(v) ? `${(100 * v).toFixed(1)}%` : "n/a";

/**
 * Four numbers, never one — the same discipline `iconsmith eval` reports under, on
 * the scale this experiment actually lives on. Lower is better here: these are
 * distances, not similarities.
 */
export const formatConformReport = (r: ConformReport): string => {
  const lines = [
    `conform ${r.from}`,
    `     -> ${r.to}`,
    `${r.n} symbols, median symmetric path distance (lower is better)`,
    "",
    row("floor", r.floor, "do nothing: the source as the answer"),
    row("treatment", r.treatment, "after conform"),
    row(
      "rescale",
      r.oracle,
      r.oracle < r.treatment
        ? "best possible rescale — the rest is redrawing"
        : "best possible rescale — beaten, so this change is not a rescale"
    ),
    row("exact", r.ceiling, "Central's own answer"),
    "",
    // The median falls to zero as soon as most icons are reproduced, which
    // reads as "nothing left to do" when there is. This is where it sits.
    `  upper quartile of the remaining error: ${r.p75.toFixed(3)}px`,
    Number.isFinite(r.recovered)
      ? `  reproduced exactly: ${pct(r.exactRate)} · recovered ${pct(r.recovered)} of the gain a rescale could reach`
      : `  reproduced exactly: ${pct(r.exactRate)}`,
    `  left unchanged by conform: ${pct(r.unchangedRate)} (identity is correct where the icon has nothing of that kind in it)`,
  ];
  if (r.unsupported.length) {
    lines.push("", "  not synthesised:");
    for (const u of r.unsupported) {
      lines.push(`    - ${u}`);
    }
  }
  const worst = r.icons.slice(0, 5);
  if (worst.length) {
    lines.push(
      "",
      "  furthest from Central's answer:",
      ...worst.map((i) => `    ${i.treatment.toFixed(3)}px  ${i.symbol}`)
    );
  }
  return lines.join("\n");
};
