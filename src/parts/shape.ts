/**
 * Shape fingerprinting: turn a subpath into something comparable.
 *
 * Two folders drawn a year apart are the same *part* even when no coordinate
 * matches, so exact signatures under-count badly (they find 4,888 "distinct"
 * shapes, 78% of them singletons). Fingerprinting resamples each subpath to a
 * fixed number of points and normalises position and scale, so near-duplicates
 * collapse and the real vocabulary shows through.
 */

import { bbox } from "../geometry/path.js";
import type { Fingerprint, Segment, Subpath } from "../types.js";

type Point = [number, number];

const SAMPLES = 48;
/** Points per cubic when flattening. Twelve is well past the point where a
 *  16px icon curve stops changing shape under resampling. */
const PER_CURVE = 12;
/** Beyond this aspect gap two shapes cannot match, so skip the O(n^2) loop. */
const ASPECT_TOLERANCE = 0.35;
/** Stand-in aspect for a zero-height shape, so a flat line never divides by 0. */
const FLAT_ASPECT = 999;
/** Quarter-turns of `b` tried against `a`: none, a quarter, a half, three
 *  quarters. A corner mark used at four orientations is one part, not four. */
const HALF_TURN = 2;
const THREE_QUARTER_TURN = 3;

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

const cubicAt = (
  a: number,
  b: number,
  c: number,
  d: number,
  t: number
): number => {
  const m = 1 - t;
  return m * m * m * a + 3 * m * m * t * b + 3 * m * t * t * c + t * t * t * d;
};

/** Where a segment ends. Arcs report their endpoint, which is why flattening
 *  an arc falls back to its chord. */
const endpoint = (s: Segment): Point => {
  if (s.t === "C") {
    return [s.p[4], s.p[5]];
  }
  if (s.t === "A") {
    return [s.p[5], s.p[6]];
  }
  return [s.p[0], s.p[1]];
};

/** Flatten a subpath to a dense polyline. Arcs fall back to their chord. */
export const flatten = (sp: Subpath, per = PER_CURVE): Point[] => {
  const out: Point[] = [[...sp.start]];
  let [cx, cy] = sp.start;
  for (const s of sp.segs) {
    const [ex, ey] = endpoint(s);
    if (s.t === "C") {
      const [c1x, c1y, c2x, c2y] = s.p;
      for (let i = 1; i <= per; i += 1) {
        const t = i / per;
        out.push([cubicAt(cx, c1x, c2x, ex, t), cubicAt(cy, c1y, c2y, ey, t)]);
      }
    } else {
      out.push([ex, ey]);
    }
    cx = ex;
    cy = ey;
  }
  if (sp.closed) {
    out.push([...sp.start]);
  }
  return out;
};

/** Resample a polyline to `n` points spaced by equal arc length. */
export const resample = (poly: Point[], n = SAMPLES): Point[] => {
  const segLen: number[] = [];
  let total = 0;
  for (let i = 1; i < poly.length; i += 1) {
    const [x, y] = poly[i];
    const [px, py] = poly[i - 1];
    const d = Math.hypot(x - px, y - py);
    segLen.push(d);
    total += d;
  }
  if (total === 0) {
    const [only] = poly;
    return Array.from({ length: n }, (): Point => [...only]);
  }
  const out: Point[] = [];
  let seg = 0;
  let acc = 0;
  for (let i = 0; i < n; i += 1) {
    const target = (i / (n - 1)) * total;
    while (seg < segLen.length - 1 && acc + segLen[seg] < target) {
      acc += segLen[seg];
      seg += 1;
    }
    const t = segLen[seg] > 0 ? (target - acc) / segLen[seg] : 0;
    const [ax, ay] = poly[seg];
    const [bx, by] = poly[seg + 1];
    out.push([lerp(ax, bx, t), lerp(ay, by, t)]);
  }
  return out;
};

/**
 * Position- and scale-normalised sample points, plus the metrics a caller needs
 * to decide whether two shapes are the same part or merely similar.
 *
 * Points are seated on the bbox *centre*, not its corner, so that turning one
 * shape and turning the other put the same points in correspondence. Seated on
 * a corner, `distance(a, b)` and `distance(b, a)` disagreed by up to 0.004 once
 * quarter-turns were compared, because each turn re-seats to a different corner.
 */
export const fingerprint = (sp: Subpath): Fingerprint => {
  const b = bbox([sp]);
  const size = Math.max(b.w, b.h) || 1;
  const cx = (b.x0 + b.x1) / 2;
  const cy = (b.y0 + b.y1) / 2;
  const norm: Point[] = resample(flatten(sp)).map(([x, y]) => [
    (x - cx) / size,
    (y - cy) / size,
  ]);
  return {
    aspect: b.h === 0 ? FLAT_ASPECT : b.w / b.h,
    bbox: b,
    closed: sp.closed,
    curves: sp.segs.filter((s) => s.t === "C").length,
    nodes: sp.segs.length,
    norm,
    size,
  };
};

/** Aspect of the same shape after a quarter-turn: w/h becomes h/w. */
const transposeAspect = (aspect: number): number =>
  aspect === 0 ? FLAT_ASPECT : 1 / aspect;

/**
 * Aspect folded so a shape and its quarter-turn report the same number —
 * 2.2x3.6 and 3.6x2.2 both give 1.64. Callers that bucket on aspect must fold
 * it, or a turned instance never even reaches `distance`: over blode-icons that
 * split one corner mark into eight "parts" at ranks 11-22.
 */
export const foldedAspect = (aspect: number): number =>
  Math.max(aspect, transposeAspect(aspect));

/**
 * Rotation matrices for the four quarter-turns, as [xx, xy, yx, yy].
 * `norm` is centred, so turning it is a pure rotation about the origin: the
 * same points as fingerprinting the turned subpath, with no re-flatten and no
 * re-resample. Applied inside the comparison loop rather than to a turned copy
 * — building four turned arrays per call cost more than the arithmetic saves.
 *
 * Clockwise in y-down screen space, and in the same index order as
 * `geometry/path.ts`'s `rotateQuarter`, so the index `match` reports is the
 * index the canvas can place at. Which of the four an index names does not
 * affect `distance`, which minimises over all of them; it matters only because
 * the index now leaves this file.
 */
const TURNS: readonly (readonly [number, number, number, number])[] = [
  [1, 0, 0, 1],
  [0, -1, 1, 0],
  [-1, 0, 0, -1],
  [0, 1, -1, 0],
];

/** Sample order tried forwards and backwards. The same ring drawn
 *  anticlockwise is the same ring; this is traversal direction, not chirality. */
const REVERSALS = [false, true] as const;

/**
 * Compared with and without a reflection in x — but the reflection is offered
 * only at the even quarter-turns.
 *
 * `mirrorX` at turn 0 is m_x and at turn 2 is m_y, so the transforms tried are
 * the four quarter-turns plus the two **axis** reflections: six of the square's
 * eight symmetries. The two diagonal reflections (`mirrorX` at turns 1 and 3)
 * are excluded deliberately, because they map an angle to its complement,
 * θ → 90-θ. Over blode-icons that folds a 32° oblique onto a 68° one
 * (`"M0 1.25L2 0"` onto `"M2 0L0 5"`) and an 8x8.75 hexagon onto an 18x14
 * rounded rectangle. Admitting them would quietly undo the work of the
 * off-axis canvas guard and lint rule, which exist to make an oblique's angle
 * an explicit, reviewable property.
 *
 * The evidence is two corpora, measured twice. Against the pristine 201-part
 * extraction, the axis set folds 81 pairs of which 19 co-occur inside a single
 * icon; adding the diagonals folds 31 more for only 4 further co-occurrences.
 * Central agrees at 80/19 against 120/21. Measured again on the *residue* after
 * this fold, 33 diagonal-only pairs remain over blode-icons and 16 over
 * Central, with 3 and 1 co-occurrences between them — still noise.
 *
 * The consequence, which is a trade and not an oversight: a mark the set draws
 * mirrored *and* quarter-turned no longer folds, since m_x∘R_1 is a diagonal
 * reflection. `turnsToTry` offers only the odd turns for an aspect-transposed
 * pair, which is exactly where that case lives.
 *
 * The cost is countable, so it is counted rather than waved at. On blode-icons
 * it is four pairs: a U arc against a bracket, two rounded U-brackets at 16x7
 * and 12x7, a small blob against a 16x7 ellipse, and
 * `"M0 4C3.75 4 5.75 1.75 7 0"` against `"M0 0C1.25 1.75 3 3.25 5.25 3.75"`.
 * On Central it is two. Only the last of the four looks like one mark genuinely
 * lost; the other three are different proportions that a 48-point fingerprint
 * happens to bring within 0.06 — the same weak discrimination that produces the
 * junk, arriving at the right answer by luck.
 *
 * So the trade is not symmetric, and that asymmetry is the argument: the
 * exclusion loses a handful of true folds and blocks an order of magnitude more
 * false ones.
 *
 * The set of transforms is therefore not a group. It does not need to be:
 * `match` minimises over a set, it never composes two of them.
 *
 * Reflection is NOT a free invariance downstream: a check mark, a comma, an `S`
 * and every letterform are chiral, so their mirror is wrong rather than merely
 * turned. `canvas.part` therefore refuses to reflect unless `flip` is asked for
 * by name, exactly as `turn` and `line ... off-axis` are asked for.
 */
const BOTH_REFLECTIONS = [false, true] as const;
const NO_REFLECTION = [false] as const;

const reflectionsFor = (q: number): readonly boolean[] =>
  q % 2 === 0 ? BOTH_REFLECTIONS : NO_REFLECTION;

/**
 * Which quarter-turns of `b` are worth comparing against `a`. A half-turn keeps
 * the aspect, a quarter-turn transposes it, so the two cases need separate
 * gates rather than one wider tolerance — widening it to cover transposition
 * would let genuinely different proportions through as well.
 *
 * Each gate takes the better of the two directions so `distance` stays
 * symmetric: |2 - 1/0.4| is 0.5 but |0.4 - 1/2| is 0.1, and the pair must agree.
 */
const turnsToTry = (a: Fingerprint, b: Fingerprint): number[] => {
  const out: number[] = [];
  if (Math.abs(a.aspect - b.aspect) <= ASPECT_TOLERANCE) {
    out.push(0, HALF_TURN);
  }
  const gap = Math.min(
    Math.abs(a.aspect - transposeAspect(b.aspect)),
    Math.abs(b.aspect - transposeAspect(a.aspect))
  );
  if (gap <= ASPECT_TOLERANCE) {
    out.push(1, THREE_QUARTER_TURN);
  }
  return out;
};

export interface Match {
  /** Mean point distance between the two, in normalised units. */
  d: number;
  /** Whether `b` had to be reflected in x to reach the distance reported.
   *  Meaningless when `d` is infinite: nothing was compared. */
  flip: boolean;
  /** Clockwise quarter-turns that carry `b` onto `a`, applied *after* `flip`.
   *  Meaningless when `d` is infinite: nothing was compared. */
  turn: number;
}

/**
 * How alike two fingerprints are, and under which placement of `b`.
 *
 * Closed shapes are compared at every rotation of their sample order, because
 * the same ring drawn from a different start node is the same shape; both open
 * and closed are compared at all four quarter-turns and at both reflections,
 * because a shape used at another orientation — or mirrored — is the same part.
 *
 * The placement falls out of the comparison the clusterer already runs, and
 * cannot be recovered afterwards without running it again, which is why it is
 * returned rather than left for a caller to work out. The convention is
 * `rotate(turn) ∘ reflect(flip)`: reflect first, then turn, which is the order
 * `canvas.part` applies them in.
 */
export const match = (a: Fingerprint, b: Fingerprint): Match => {
  if (a.closed !== b.closed) {
    return { d: Number.POSITIVE_INFINITY, flip: false, turn: 0 };
  }
  // Aspect is cheap and prunes most non-matches before the O(n^2) loop. A
  // reflection in x preserves w and h exactly, so it needs no gate of its own:
  // whatever `turnsToTry` admits for `b` it admits for `b` mirrored.
  const turns = turnsToTry(a, b);
  if (turns.length === 0) {
    return { d: Number.POSITIVE_INFINITY, flip: false, turn: 0 };
  }
  const n = a.norm.length;
  const rotations = a.closed ? n : 1;
  let best = Number.POSITIVE_INFINITY;
  let bestTurn = 0;
  let bestFlip = false;
  for (const q of turns) {
    const [xx, xy, yx, yy] = TURNS[q];
    for (const reflect of reflectionsFor(q)) {
      for (const reverse of REVERSALS) {
        for (let r = 0; r < rotations; r += 1) {
          let sum = 0;
          for (let i = 0; i < n; i += 1) {
            const [px, py] = a.norm[i];
            const k = (i + r) % n;
            const [rx, by] = b.norm[reverse ? n - 1 - k : k];
            const bx = reflect ? -rx : rx;
            const dx = px - (xx * bx + xy * by);
            const dy = py - (yx * bx + yy * by);
            // `Math.hypot` guards against overflow that cannot happen here —
            // both operands are normalised into [-1, 1] — and costs 14.4s
            // against 7.5s over blode-icons for an identical parts list.
            // oxlint-disable-next-line prefer-modern-math-apis
            sum += Math.sqrt(dx * dx + dy * dy);
            // Already worse than the best placement found; the rest cannot help.
            if (sum / n >= best) {
              break;
            }
          }
          const d = sum / n;
          if (d < best) {
            best = d;
            bestTurn = q;
            bestFlip = reflect;
          }
        }
      }
    }
  }
  return { d: best, flip: bestFlip, turn: bestTurn };
};

/** Mean point distance alone, for callers with no use for the orientation. */
export const distance = (a: Fingerprint, b: Fingerprint): number =>
  match(a, b).d;
