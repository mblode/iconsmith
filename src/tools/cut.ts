/**
 * Cut measurement: how much of a background stroke is removed where a
 * foreground shape crosses it.
 *
 * A cut is the notch a designer leaves in a back shape so a front shape reads
 * as being in front of it. It is measured **along the interrupted stroke** —
 * the arc length of the missing piece — not perpendicular to it. That makes it
 * a different quantity from lint's `gap` rule, which is the minimum
 * perpendicular ink distance between two elements: `gap` answers "are these two
 * shapes too close", a cut answers "is the hole big enough to read as a hole".
 * The two are related but not interchangeable — a 2px-wide stroke crossing a
 * background at 45° needs ~2.8 units of notch to leave the same visual gap a
 * perpendicular crossing gets from 2.
 *
 * ## The definition, and where it fails
 *
 * Subpaths are stitched first, and that step is not optional. Central emits
 * outlines as a run of fragments that share endpoints — `calender-5`'s frame is
 * eight `M` commands meeting at four corners, and a bullet dot in `list-bullets`
 * is twenty overlapping arclets. Reading raw subpath endpoints as loose ends
 * inflates blode-icons from 182 cuts to 309 — the extra 127 are fragment
 * boundaries in the middle of a continuous stroke. Endpoints within
 * {@link JOIN} of each other are therefore joined into one contour before
 * anything is measured.
 *
 * A cut is then a pair of **free ends** — endpoints left over once stitching is
 * done — that satisfy three tests:
 *
 * 1. **Span.** They are between {@link MIN_SPAN} and {@link MAX_SPAN} apart.
 *    Below the floor the two ends are the same point (a closed contour drawn
 *    open); above the ceiling the background is not notched, it is truncated —
 *    a design move with different rules.
 * 2. **Continuity.** Each end's outgoing tangent points at the other, within
 *    {@link CONTINUITY_DEGREES}. This is what separates a cut from a path that
 *    is merely open: a check mark's two ends are far apart and point away from
 *    each other, so no pair passes. A stroke that stops and restarts leaves
 *    ends that still aim along the contour they were drawing.
 * 3. **A crossing.** Some other contour's ink runs through the span — within
 *    {@link BRIDGE_TOLERANCE} of the chord's interior — *and* reaches
 *    {@link CROSS_DEPTH} past the interrupted stroke on both sides. Without any
 *    bridge test, an arc that simply does not close (a moon, an open bracket)
 *    reads as a cut of itself. Without the both-sides half, so does every shape
 *    that merely stops short of a background: `folder-download` ends its arrow a
 *    unit above the folder's bottom edge, which is clearance, not a knockout.
 *    Requiring the crossing takes blode-icons from 380 detections to 182
 *    and lifts the smallest from 0.79 to 3.00; everything it removes is a
 *    `gap` between two shapes, not a hole in one.
 *
 * ## What it measures, in blode-icons and Central
 *
 * 122 of 2,221 blode-icons outline icons contain a cut, 182 cuts in total;
 * Central's `round-outlined-radius-3-stroke-2` gives 122 icons and 183 cuts,
 * which is the same set measured twice and is the point — blode-icons is ~96%
 * Central-derived. Lengths run 3.00 to 14.0, median 8.2, p25 6.1, p10 5.1.
 * **Nothing in either set cuts below 3.0 units on a 24 grid.** The floor is
 * literal rather than approached: `fork-spoon` and `knife-spoon` cut the middle
 * tine by exactly 3.00 where the bowl crosses it, and the next cut up is 4.08.
 *
 * The distribution has no upper mode. A cut and a truncation are the same
 * construction at different sizes, so the tail runs on until the background is
 * barely there; {@link MAX_SPAN} stops reporting at half the canvas because
 * past that the background is absent rather than notched. That ceiling is a
 * reporting choice and does not touch the floor, which is what a rule needs.
 *
 * Known failure modes, in the order they bite:
 *
 * - **Two ends of unrelated shapes that happen to line up.** Two parallel
 *   strokes whose ends meet end-on with a third shape between them read as one
 *   cut. Rare, and it fails towards over-reporting, which is the safe direction
 *   for a measurement whose distribution is being inspected by hand.
 * - **Truncation vs. notch.** The ceiling at {@link MAX_SPAN} is a judgement,
 *   not a measurement, and nothing past it is reported by this or by lint.
 * - **Curved contours.** The missing piece is reconstructed as a circular arc
 *   through both ends, tangent to both. Exact for the circles and straight
 *   lines that make up almost all of this corpus, and an underestimate of a
 *   few percent for an S-shaped span, which no icon in the set has.
 * - **Filled shapes.** A cut in a filled shape is a hole in a closed outline,
 *   not a pair of free ends. Nothing here sees it.
 *
 * ## The rule this supports, deliberately not wired in
 *
 * `cut`, severity `warn`, floor 3.0 units on the 24 grid: "X and Y leave a
 * N-unit cut at (x, y); the set never cuts below 3." It flags 0 of the 182
 * cuts the two corpora draw, which is the point — a floor is a guard against
 * work the set would not do, and this one is placed exactly at the tightest
 * thing it does do. `warn` rather than `error` because the detector can
 * mis-pair two loose ends, and because a cut is a spacing judgement, which is
 * the tier `gap` already sits in.
 *
 * The article this project takes its vocabulary from is ambiguous here and the
 * ambiguity resolves against its prose. It states the rule as "never less than
 * 3 grid units on a 16px grid" — 4.5 on a 24 grid — while its own diagram
 * labels cuts of 3 and 3.5 on 24-unit drawings. The corpus matches the diagram:
 * the minimum is exactly 3.0 on 24, and a 4.5 floor would flag 8 of 182 cuts
 * (4.4%), including `fork-spoon`, which is the same construction the diagram
 * illustrates. Read the article's numbers as 24-grid units; in its own 16-grid
 * language the floor is 2, not 3.
 */

import { parsePath } from "../geometry/path.js";
import { flatten, resample } from "../parts/shape.js";

type Point = [number, number];

/** The shape lint and the canvas both speak: drawn path data with a name. */
export interface CutShape {
  d: string;
  id: string;
}

export interface Cut {
  /** Midpoint of the missing span, so a message can point at it. */
  at: Point;
  /** Straight-line distance between the two ends. */
  chord: number;
  /** Ids of the shapes whose stroke stops and restarts. Equal when one element
   *  holds both sides, which is the common case — a cut splits a subpath, not
   *  necessarily a `<path>`. */
  interrupted: [string, string];
  /** Id of the shape sitting in the gap. */
  interrupter: string;
  /** Arc length of the missing piece, along the reconstructed contour. */
  length: number;
}

/** Two endpoints this close were drawn as one point: the path data is a run of
 *  fragments, not two strokes that nearly meet. Central rounds to 5 decimals,
 *  so anything above float noise and below the 0.25 sub-grid works. */
const JOIN = 0.05;
/** Below this the two ends are one point, not a gap. */
const MIN_SPAN = 0.5;
/** Above this the background is absent rather than notched — half the canvas.
 *  The measured distribution has no mode to cut at, so this is a reporting
 *  ceiling; the floor a rule is built on sits far below it. */
const MAX_SPAN = 12;
/** How far an end's tangent may swing off the chord and still count as
 *  continuing across it. 70° is loose on purpose — a notch in a tight curve
 *  turns hard, and the bridge test carries most of the discrimination. */
const CONTINUITY_DEGREES = 70;
/** How close another contour must come to the chord's interior to count as
 *  running through the gap. Two units: the corpus draws at stroke 2, so a
 *  crossing centreline can sit a full stroke off the chord and still be ink
 *  inside the hole. */
const BRIDGE_TOLERANCE = 2;
/** Fraction of the chord at each end that does not count as "interior" — ink
 *  near an endpoint is a neighbour, not a bridge. */
const CHORD_MARGIN = 0.15;
/** How far past the interrupted stroke the interrupter must reach, on both
 *  sides, to count as passing through rather than stopping at it. Half a unit
 *  is a quarter of a stroke width: enough to exclude a shape that terminates on
 *  the line, small enough to admit one that only just clears it. */
const CROSS_DEPTH = 0.5;
/** How far beyond the chord's ends, in chord lengths, ink still counts towards
 *  the crossing test. A stroke crossing at 45° leaves the span sideways. */
const CROSS_REACH = 0.5;
/** Points per curve when flattening. Matches lint: a cut only has to be
 *  measured to a fraction of a unit. */
const FLATTEN_STEPS = 8;
/** Spacing of the resampled points the bridge test scans. A 0.4-unit step puts
 *  the worst-case miss at 0.2, well inside `BRIDGE_TOLERANCE`. */
const SAMPLE_STEP = 0.4;
/** Cap on resampled points per contour, so a pathological path cannot make the
 *  bridge scan quadratic in icon size. */
const MAX_SAMPLES = 400;
/** Baseline length for the endpoint tangent. Long enough not to ride the noise
 *  of one flattened step, short enough to track a curve. */
const TANGENT_BASELINE = 0.8;
/** Below this the arc-length correction is under a thousandth of the chord, and
 *  dividing by sin(α) is numerically worse than not bothering. */
const STRAIGHT = 1e-3;

const CONTINUITY = Math.cos((CONTINUITY_DEGREES * Math.PI) / 180);

/** One open subpath as drawn: a dense resampling for distance tests, which
 *  element drew it, and which stitched contour it belongs to. */
interface Fragment {
  contour: number;
  dense: Point[];
  shape: number;
}

interface FreeEnd {
  /** Index of the fragment this end belongs to, for its tangent. */
  fragment: number;
  /** Unit vector pointing away from the ink, i.e. along the missing piece. */
  dir: Point;
  pt: Point;
}

const polyLength = (poly: Point[]): number => {
  let total = 0;
  for (let i = 1; i < poly.length; i += 1) {
    total += Math.hypot(
      poly[i][0] - poly[i - 1][0],
      poly[i][1] - poly[i - 1][1]
    );
  }
  return total;
};

const unit = (dx: number, dy: number): Point => {
  const m = Math.hypot(dx, dy);
  return m === 0 ? [0, 0] : [dx / m, dy / m];
};

/** Open subpaths only: a closed contour has no free ends and cannot be cut in
 *  the sense this file measures. `contour` is filled in by {@link stitch}. */
const fragments = (shapes: CutShape[]): Fragment[] => {
  const out: Fragment[] = [];
  for (const [shape, el] of shapes.entries()) {
    for (const sp of parsePath(el.d)) {
      if (sp.closed) {
        continue;
      }
      const poly = flatten(sp, FLATTEN_STEPS);
      const len = polyLength(poly);
      if (len === 0) {
        continue;
      }
      const n = Math.min(
        MAX_SAMPLES,
        Math.max(2, Math.ceil(len / SAMPLE_STEP) + 1)
      );
      out.push({ contour: out.length, dense: resample(poly, n), shape });
    }
  }
  return out;
};

const ends = (f: Fragment): [Point, Point] => [
  f.dense[0],
  f.dense.at(-1) as Point,
];

const coincide = (a: Point, b: Point): boolean =>
  Math.abs(a[0] - b[0]) <= JOIN && Math.abs(a[1] - b[1]) <= JOIN;

/**
 * Union fragments whose endpoints meet, so a stroke drawn as eight `M`
 * commands is one contour with two loose ends rather than eight with sixteen.
 * Fragment counts are small (the largest icon in blode-icons has 84), so the
 * pairwise scan is cheaper than the spatial index that would replace it.
 */
const stitch = (fs: Fragment[]): void => {
  const parent = fs.map((_, i) => i);
  const find = (i: number): number => {
    let r = i;
    while (parent[r] !== r) {
      r = parent[r];
    }
    return r;
  };
  for (let i = 0; i < fs.length; i += 1) {
    for (let j = i + 1; j < fs.length; j += 1) {
      const touching = ends(fs[i]).some((a) =>
        ends(fs[j]).some((b) => coincide(a, b))
      );
      if (touching) {
        parent[find(i)] = find(j);
      }
    }
  }
  for (const [i, f] of fs.entries()) {
    f.contour = find(i);
  }
};

/** The outward tangent at one end of a contour, measured over a fixed baseline
 *  rather than one flattened step. */
const tangent = (dense: Point[], atStart: boolean): Point => {
  const back = Math.min(
    dense.length - 1,
    Math.max(1, Math.round(TANGENT_BASELINE / SAMPLE_STEP))
  );
  const [tip, inward] = atStart
    ? [dense[0], dense[back]]
    : [dense.at(-1) as Point, dense[dense.length - 1 - back]];
  return unit(tip[0] - inward[0], tip[1] - inward[1]);
};

/** Endpoints left loose once stitching is done. An endpoint that meets any
 *  other endpoint — including the far end of its own fragment, which makes a
 *  ring drawn open — is interior to a stroke, not the edge of a hole. */
const freeEnds = (fs: Fragment[]): FreeEnd[] => {
  const all = fs.flatMap((f, fragment) =>
    ends(f).map((pt, side) => ({ fragment, pt, side }))
  );
  return all
    .filter((e) =>
      all.every(
        (o) =>
          (o.fragment === e.fragment && o.side === e.side) ||
          !coincide(o.pt, e.pt)
      )
    )
    .map((e) => ({
      dir: tangent(fs[e.fragment].dense, e.side === 0),
      fragment: e.fragment,
      pt: e.pt,
    }));
};

/**
 * The contour sitting in the span between two ends, or null when nothing is.
 * Distance is measured to the chord's interior, so a shape running alongside
 * one of the ends does not qualify as bridging the gap between them.
 */
const bridge = (a: Point, b: Point, fs: Fragment[], skip: Set<number>) => {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  for (const [i, c] of fs.entries()) {
    if (skip.has(c.contour)) {
      continue;
    }
    let inGap = false;
    let above = false;
    let below = false;
    for (const p of c.dense) {
      const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2;
      if (t < -CROSS_REACH || t > 1 + CROSS_REACH) {
        continue;
      }
      // Signed perpendicular offset: which side of the interrupted stroke this
      // point of the interrupter sits on.
      const s = ((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / Math.sqrt(len2);
      if (
        t >= CHORD_MARGIN &&
        t <= 1 - CHORD_MARGIN &&
        Math.abs(s) <= BRIDGE_TOLERANCE
      ) {
        inGap = true;
      }
      if (s > CROSS_DEPTH) {
        above = true;
      }
      if (s < -CROSS_DEPTH) {
        below = true;
      }
    }
    if (inGap && above && below) {
      return i;
    }
  }
  return null;
};

/**
 * Arc length of a circular arc with the given chord, where α is the angle
 * between the chord and the tangent at its ends. R = c / (2 sin α) and the arc
 * subtends 2α, so the length is c·α/sin α. Degenerates to the chord as α → 0,
 * which is the straight-stroke case and the majority of the corpus.
 */
const arcLength = (chord: number, alpha: number): number =>
  alpha < STRAIGHT ? chord : (chord * alpha) / Math.sin(alpha);

/** A candidate pairing of two free ends, kept only if it beats every other
 *  claim on either end. */
interface Candidate {
  alpha: number;
  chord: number;
  i: number;
  interrupter: number;
  j: number;
}

const candidate = (
  loose: FreeEnd[],
  fs: Fragment[],
  i: number,
  j: number
): Candidate | null => {
  const a = loose[i];
  const b = loose[j];
  const dx = b.pt[0] - a.pt[0];
  const dy = b.pt[1] - a.pt[1];
  const chord = Math.hypot(dx, dy);
  if (chord < MIN_SPAN || chord > MAX_SPAN) {
    return null;
  }
  const [ux, uy] = unit(dx, dy);
  const ca = a.dir[0] * ux + a.dir[1] * uy;
  const cb = b.dir[0] * -ux + b.dir[1] * -uy;
  if (ca < CONTINUITY || cb < CONTINUITY) {
    return null;
  }
  const interrupter = bridge(
    a.pt,
    b.pt,
    fs,
    new Set([fs[a.fragment].contour, fs[b.fragment].contour])
  );
  if (interrupter === null) {
    return null;
  }
  // Both tangents are reconstructing the same arc, so their half-angles agree
  // in the ideal case; averaging absorbs the flattening error in the real one.
  const alpha = (Math.acos(Math.min(1, ca)) + Math.acos(Math.min(1, cb))) / 2;
  return { alpha, chord, i, interrupter, j };
};

/**
 * Every cut in an icon: places where one contour's stroke stops and restarts
 * with another shape in the gap.
 *
 * Ends are matched shortest-span-first and each end is claimed once, so a
 * background interrupted twice yields two cuts rather than one cut and a
 * chain of overlapping candidates.
 */
export const cuts = (shapes: CutShape[]): Cut[] => {
  const fs = fragments(shapes);
  stitch(fs);
  const loose = freeEnds(fs);
  const found: Candidate[] = [];
  for (let i = 0; i < loose.length; i += 1) {
    for (let j = i + 1; j < loose.length; j += 1) {
      const c = candidate(loose, fs, i, j);
      if (c) {
        found.push(c);
      }
    }
  }
  found.sort((x, y) => x.chord - y.chord);

  const claimed = new Set<number>();
  const out: Cut[] = [];
  for (const c of found) {
    if (claimed.has(c.i) || claimed.has(c.j)) {
      continue;
    }
    claimed.add(c.i);
    claimed.add(c.j);
    const a = loose[c.i].pt;
    const b = loose[c.j].pt;
    out.push({
      at: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2],
      chord: c.chord,
      interrupted: [
        shapes[fs[loose[c.i].fragment].shape].id,
        shapes[fs[loose[c.j].fragment].shape].id,
      ],
      interrupter: shapes[fs[c.interrupter].shape].id,
      length: arcLength(c.chord, c.alpha),
    });
  }
  return out;
};
