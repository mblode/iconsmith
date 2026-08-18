/**
 * Which way the straight edges of an icon point.
 *
 * `canvas.ts` snaps every segment it draws to 0/45/90 within 6° and refuses
 * anything further out unless the caller passed `offAxis`, so a new icon goes
 * off-axis only where someone said so. Shipped icons predate that and were
 * never checked, so this measures the same property after the fact: parse an
 * icon, take its straight runs, and report each one's distance from the nearest
 * permitted axis.
 *
 * Two measurement facts decide what a caller should hand in, and both were
 * found the expensive way:
 *
 * 1. **Stroked shapes only.** Roughly a quarter of blode-icons ships as
 *    outline-expanded fills, where a 2-unit stroke has become a closed contour.
 *    Expansion emits a fan of short straight segments around every round join,
 *    at whatever angle the flattener chose: 30% of those segments are off-axis
 *    against 15% of the stroked ones. Measuring them reports Figma's expander,
 *    not anybody's design. Filter to `strokeWidth > 0` before calling in.
 * 2. **`MIN_EDGE`.** Below it the survivors are join residue rather than edges.
 *
 * Measured over 1,640 stroked blode-icons: 85.3% of straight edges are on-axis
 * by count, 86.6% by length. The off-axis 15% is not drift in the usual sense —
 * it lands on rational slopes (atan 1/2 = 26.57°, the 3-4-5 triangle's 36.87°
 * and 53.13°, atan 2 = 63.43°) because the edges run between two grid points.
 * The set's working convention is "endpoints on the grid"; the spec's is
 * "angles at 0/45/90", and 1 edge in 7 shows they are not the same rule.
 *
 * `corpus/audit.ts` also reports an angle distribution and keeps it: that one
 * asks whether the set obeys the *article's* construction rules, at a ±1°
 * tolerance chosen to make a distribution legible, over every segment including
 * expanded fills. This one asks whether an icon obeys the *canvas*, at the
 * canvas's own tolerance, and is what a lint rule can call — `tools` cannot
 * import `corpus`, which sits above it.
 */
import { parsePath } from "../geometry/path.js";
import type { Run } from "../geometry/segments.js";
import { straightRuns } from "../geometry/segments.js";
import type { Subpath } from "../types.js";
// The axes and the tolerance are the canvas's, imported rather than restated.
// The measurement and the primitive must not be able to drift apart: a rule
// that forbids what the canvas draws, or permits what it refuses, is worse than
// no rule. `AXES` is already undirected, which is the range `straightRuns`
// reports in — a line is the same line either way round.
import { ANGLE_TOLERANCE, AXES } from "./canvas.js";

/**
 * Isometric projection puts cube edges 30° off horizontal. Kept as a named
 * constant because the exemption question is live, not because the exemption is
 * on — see `allowIsometric`, which defaults to off and says why.
 */
export const ISOMETRIC_AXES = [30, 150] as const;

/** Degrees either side of 30/150 counted as isometric when the exemption is on. */
export const ISOMETRIC_TOLERANCE = 3;

/**
 * Runs shorter than this are corner-join residue, not edges. At 0.1 — the value
 * `corpus/audit.ts` uses to keep its distribution honest — a third of the
 * off-axis hits are sub-unit slivers inside rounded corners, which nobody drew
 * and nobody can fix. 1.5 is `MIN_DIAGONAL_LENGTH`, the length at which
 * `segments.ts` already believes a diagonal, and above it the survivors are all
 * real edges. Raising it further trades noise for blindness rather than for
 * precision: 3.0 drops the blode-icons count from 1,370 edges to 1,026 but the
 * flagged-icon share only falls from 29.3% to 24.5%.
 */
export const MIN_EDGE = 1.5;

export interface AngleEdge extends Run {
  /** Nearest permitted axis, in [0,180). */
  axis: number;
  /** Within `ISOMETRIC_TOLERANCE` of an isometric axis. */
  isometric: boolean;
  /** Degrees from `axis`. */
  offBy: number;
  /** Position in the icon's straight-run sequence, so a hit can be pointed at. */
  run: number;
}

/** Degrees between two undirected angles: 179° is 1° from horizontal, not 179°. */
const delta = (a: number, b: number): number => {
  const d = Math.abs(a - b) % 180;
  return Math.min(d, 180 - d);
};

const nearestOf = (targets: readonly number[], v: number): number => {
  let [best] = targets;
  for (const t of targets) {
    if (delta(t, v) < delta(best, v)) {
      best = t;
    }
  }
  return best;
};

/** Every straight run long enough to be an edge, measured against the axes.
 *  Pass the subpaths of *stroked* shapes only; see the file comment. */
export const edgeAngles = (
  subpaths: Subpath[],
  minEdge = MIN_EDGE
): AngleEdge[] => {
  const out: AngleEdge[] = [];
  let run = 0;
  for (const r of straightRuns(subpaths)) {
    const index = run;
    run += 1;
    if (r.length < minEdge) {
      continue;
    }
    const axis = nearestOf(AXES, r.angle);
    out.push({
      angle: r.angle,
      axis,
      isometric:
        delta(r.angle, nearestOf(ISOMETRIC_AXES, r.angle)) <=
        ISOMETRIC_TOLERANCE,
      length: r.length,
      offBy: delta(r.angle, axis),
      run: index,
    });
  }
  return out;
};

/** The same, straight from path data. */
export const iconEdgeAngles = (ds: string[], minEdge = MIN_EDGE): AngleEdge[] =>
  ds.flatMap((d) => edgeAngles(parsePath(d), minEdge));

export interface AngleRuleOptions {
  /**
   * Exempt edges within `ISOMETRIC_TOLERANCE` of 30/150. Off by default: the
   * 30° cluster in blode-icons does not survive being looked at. Only 8.4% of
   * the off-axis mass sits within 0.5° of exactly 30°, and widening to ±3°
   * reaches just 15.7% while sweeping in `star-half`, `pin`, `graduate-cap` and
   * `folder-bookmarks`, none of which are isometric. The band is not one
   * cluster either but three spikes — 29.25°, 29.75° and 30.00° — and the
   * flagship cubes (`ar-cube-1`, `ar-cube-2`) sit at 29.36°, so the exemption
   * would miss the very icons that justify it. An exemption should name a
   * projection the set actually draws to; this one would name a coincidence.
   */
  allowIsometric?: boolean;
  tolerance?: number;
}

/**
 * The edges an axis rule would flag: off every permitted axis by more than the
 * canvas's own tolerance.
 */
export const offAxisEdges = (
  edges: AngleEdge[],
  { allowIsometric = false, tolerance = ANGLE_TOLERANCE }: AngleRuleOptions = {}
): AngleEdge[] =>
  edges.filter((e) => e.offBy > tolerance && !(allowIsometric && e.isometric));

export interface AngleBin {
  /** Lower edge of the bin, in degrees. */
  angle: number;
  count: number;
  /** Total run length in the bin: a set is judged by how much line sits at an
   *  angle, not by how many segments were needed to draw it. */
  length: number;
}

/** Length-weighted histogram of undirected angles, `bin` degrees per bucket. */
export const angleHistogram = (edges: AngleEdge[], bin = 1): AngleBin[] => {
  const buckets = new Map<number, AngleBin>();
  for (const e of edges) {
    const key = Math.floor(e.angle / bin) * bin;
    const b = buckets.get(key) ?? { angle: key, count: 0, length: 0 };
    b.count += 1;
    b.length += e.length;
    buckets.set(key, b);
  }
  return [...buckets.values()].toSorted((a, b) => a.angle - b.angle);
};

/** Share of straight-edge length that is on-axis. Reported alongside the count
 *  because one long off-axis edge and one stray sliver are different faults. */
export const onAxisLengthShare = (
  edges: AngleEdge[],
  tolerance = ANGLE_TOLERANCE
): number => {
  const total = edges.reduce((s, e) => s + e.length, 0);
  if (total === 0) {
    return 1;
  }
  const on = edges
    .filter((e) => e.offBy <= tolerance)
    .reduce((s, e) => s + e.length, 0);
  return on / total;
};
