/**
 * The optical shapes, audited.
 *
 * The claim under test, from the Cursor article: "Underneath both sizes sits a
 * system of optical shapes: Square, Circle, Horizontal, and Vertical. Each one
 * is sized so that icons built on different shapes still read as the same size
 * — for instance a circle has to be drawn slightly larger than a square to look
 * equally big."
 *
 * That is a falsifiable statement, and it is falsifiable in a specific way. If
 * the four keylines really are compensated, then an icon that fills the circle
 * keyline and an icon that fills the square keyline should cover roughly the
 * same *area*, despite the circle being the wider box. The arithmetic says they
 * should: a 20-diameter disc covers 314 square units, an 18-square covers 324,
 * within 3% of each other, while a 20-square would cover 400 and read as
 * obviously bigger. So silhouette area, not bounding box, is where the
 * compensation shows up, and that is what this module measures.
 *
 * Three cautions built into the measurements:
 *
 * 1. **Visual extent is the path bbox inflated by the stroke, half per side** —
 *    and by *each piece's own* stroke, since a quarter of this corpus mixes
 *    filled shapes into stroked drawings and a filled contour inflates by
 *    nothing. This is the mistake that has produced the most wrong measurements
 *    in this problem domain.
 * 2. **Rendered ink area is not perceived size.** It conflates how big a shape
 *    is with how much detail is inside it: a busy square icon carries more ink
 *    than a bare circle at any size. Both are reported, and where they disagree
 *    the hull is the one that answers the article's claim.
 * 3. **Off-keyline is not off-system.** Central calls its key shapes "merely
 *    guidelines", and diagonal subjects in particular are fitted by eye. The
 *    deviation distribution is reported so near-misses can be told apart from
 *    genuinely unrelated extents.
 */
import sharp from "sharp";

import type { Keyline } from "../types.js";
import type { Piece } from "./legibility.js";
import { parsePieces } from "./legibility.js";
import { png } from "./render.js";

/** The four optical shapes, as visual extents in canvas units. */
export const KEYLINES: Record<Keyline, readonly [number, number]> = {
  circle: [20, 20],
  square: [18, 18],
  tall: [16, 20],
  wide: [20, 16],
};

/** Raster grid for the ink measurements. Every corpus icon is a 24-unit
 *  viewBox, so one grid means one scale and areas are comparable. */
const RASTER = 48;
const UNITS_PER_PX = 24 / RASTER;
/** Ink below this darkness is antialiasing, not mark. */
const INK_FLOOR = 0.15;

type Point = [number, number];

export interface KeylineMetrics {
  /** Angle of the ink's long axis, degrees from horizontal, 0–180. */
  axisDeg: number;
  /** Ratio of the ink's principal spreads. 1.0 is isotropic; 2.0 is twice as
   *  long as it is wide. Measured from the raster, so it reflects where the ink
   *  actually is rather than where the bounding box happens to fall. */
  anisotropy: number;
  /** Max deviation, in units, from `nearest` on either axis. */
  deviation: number;
  filledOnly: boolean;
  /** Silhouette area in square units: the convex hull of the ink, inflated by
   *  the stroke. The measure the article's claim is actually about. */
  hullArea: number;
  /** Rendered ink in square units — darkness summed over the raster. */
  inkArea: number;
  name: string;
  /** The keyline this icon is closest to, whatever the distance. */
  nearest: Keyline;
  /** Visual extent, path bbox plus each piece's own stroke, half per side. */
  vx: number;
  vy: number;
}

const hypot2 = (dx: number, dy: number) => dx * dx + dy * dy;

const cross = (o: Point, a: Point, b: Point) =>
  (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

/** Andrew's monotone chain. Returns the hull in order, or the input when it is
 *  too small to have one. */
const convexHull = (pts: Point[]): Point[] => {
  if (pts.length < 3) {
    return pts;
  }
  const sorted = pts.toSorted((a, b) => a[0] - b[0] || a[1] - b[1]);
  const half = (input: Point[]): Point[] => {
    const out: Point[] = [];
    for (const p of input) {
      let last = out.at(-1);
      let prev = out.at(-2);
      while (prev && last && cross(prev, last, p) <= 0) {
        out.pop();
        last = out.at(-1);
        prev = out.at(-2);
      }
      out.push(p);
    }
    out.pop();
    return out;
  };
  return [...half(sorted), ...half(sorted.toReversed())];
};

const polygonArea = (poly: Point[]): number => {
  let sum = 0;
  for (let i = 0; i < poly.length; i += 1) {
    const [x0, y0] = poly[i];
    const [x1, y1] = poly[(i + 1) % poly.length];
    sum += x0 * y1 - x1 * y0;
  }
  return Math.abs(sum) / 2;
};

const perimeter = (poly: Point[]): number => {
  let total = 0;
  for (let i = 0; i < poly.length; i += 1) {
    const [x0, y0] = poly[i];
    const [x1, y1] = poly[(i + 1) % poly.length];
    total += Math.sqrt(hypot2(x1 - x0, y1 - y0));
  }
  return total;
};

/**
 * Visual extent: every piece's own bounding box grown by half its own stroke on
 * each side, then unioned. A filled contour grows by nothing, which is why this
 * cannot be done by measuring the whole path bbox and adding one stroke.
 */
export const visualExtent = (
  pieces: Piece[]
): { vx: number; vy: number; x0: number; y0: number } => {
  let x0 = Number.POSITIVE_INFINITY;
  let y0 = Number.POSITIVE_INFINITY;
  let x1 = Number.NEGATIVE_INFINITY;
  let y1 = Number.NEGATIVE_INFINITY;
  for (const piece of pieces) {
    const half = piece.stroke / 2;
    for (const [x, y] of piece.poly) {
      x0 = Math.min(x0, x - half);
      y0 = Math.min(y0, y - half);
      x1 = Math.max(x1, x + half);
      y1 = Math.max(y1, y + half);
    }
  }
  return Number.isFinite(x0)
    ? { vx: x1 - x0, vy: y1 - y0, x0, y0 }
    : { vx: 0, vy: 0, x0: 0, y0: 0 };
};

/** Which keyline an extent is closest to, and by how far on its worse axis. */
export const nearestKeyline = (
  vx: number,
  vy: number
): { deviation: number; nearest: Keyline } => {
  let best: { deviation: number; nearest: Keyline } = {
    deviation: Number.POSITIVE_INFINITY,
    nearest: "square",
  };
  for (const [name, [w, h]] of Object.entries(KEYLINES) as [
    Keyline,
    readonly [number, number],
  ][]) {
    const deviation = Math.max(Math.abs(vx - w), Math.abs(vy - h));
    if (deviation < best.deviation) {
      best = { deviation, nearest: name };
    }
  }
  return best;
};

/** Ink area and the shape of its distribution, from the raster. */
const inkStats = async (
  svg: string
): Promise<{ anisotropy: number; axisDeg: number; inkArea: number }> => {
  const raw = await sharp(await png(svg, RASTER))
    .greyscale()
    .raw()
    .toBuffer();
  let mass = 0;
  let sx = 0;
  let sy = 0;
  const ink: number[] = [];
  for (const [i, v] of raw.entries()) {
    const d = (255 - v) / 255;
    ink.push(d);
    if (d > INK_FLOOR) {
      const x = i % RASTER;
      const y = Math.floor(i / RASTER);
      mass += d;
      sx += d * x;
      sy += d * y;
    }
  }
  let darkness = 0;
  for (const d of ink) {
    darkness += d;
  }
  const inkArea = darkness * (UNITS_PER_PX * UNITS_PER_PX);
  if (mass === 0) {
    return { anisotropy: 1, axisDeg: 0, inkArea };
  }
  const cx = sx / mass;
  const cy = sy / mass;
  let mxx = 0;
  let myy = 0;
  let mxy = 0;
  for (const [i, d] of ink.entries()) {
    if (d <= INK_FLOOR) {
      continue;
    }
    const dx = (i % RASTER) - cx;
    const dy = Math.floor(i / RASTER) - cy;
    mxx += d * dx * dx;
    myy += d * dy * dy;
    mxy += d * dx * dy;
  }
  mxx /= mass;
  myy /= mass;
  mxy /= mass;
  // Eigenvalues of the 2×2 second-moment matrix.
  const mid = (mxx + myy) / 2;
  const diff = Math.sqrt(hypot2((mxx - myy) / 2, mxy));
  const big = mid + diff;
  const small = Math.max(mid - diff, 1e-9);
  const angle = (Math.atan2(2 * mxy, mxx - myy) / 2) * (180 / Math.PI);
  return {
    anisotropy: Math.sqrt(big / small),
    axisDeg: ((angle % 180) + 180) % 180,
    inkArea,
  };
};

export interface KeylineOptions {
  /** Stroke assumed for a stroked element that does not state its width. */
  stroke?: number;
}

/** Measure one icon against the optical shapes. */
export const measureKeyline = async (
  name: string,
  svg: string,
  { stroke = 2 }: KeylineOptions = {}
): Promise<KeylineMetrics> => {
  const pieces = parsePieces(svg, stroke);
  const { vx, vy } = visualExtent(pieces);
  const { deviation, nearest } = nearestKeyline(vx, vy);

  // Silhouette: the hull of every centre line, grown by the stroke that draws
  // it. Growing a convex region by r adds perimeter·r + πr².
  const hull = convexHull(pieces.flatMap((p) => p.poly));
  let widestStroke = 0;
  for (const p of pieces) {
    widestStroke = Math.max(widestStroke, p.stroke);
  }
  const widest = widestStroke / 2;
  const hullArea =
    hull.length >= 3
      ? polygonArea(hull) + perimeter(hull) * widest + Math.PI * widest * widest
      : 0;

  const { anisotropy, axisDeg, inkArea } = await inkStats(svg);
  return {
    anisotropy,
    axisDeg,
    deviation,
    filledOnly: pieces.length > 0 && pieces.every((p) => p.stroke === 0),
    hullArea,
    inkArea,
    name,
    nearest,
    vx,
    vy,
  };
};

/** Conformance bands, in units of deviation from the nearest keyline. */
export const CONFORMANCE = {
  /** A refit away — the same shape, slightly the wrong size. */
  near: 1.5,
  /** Far enough that it is a different extent, not a mis-sized keyline. */
  off: 1.5,
  /** Within the grid's own quantum: on the keyline. */
  on: 0.5,
} as const;

export type Conformance = "near" | "off" | "on";

export const conformance = (deviation: number): Conformance => {
  if (deviation <= CONFORMANCE.on) {
    return "on";
  }
  return deviation <= CONFORMANCE.near ? "near" : "off";
};

/** Extents that recur often enough to look like a shape the set uses, rather
 *  than the tail of a distribution. Rounded to the drawing grid. */
export const clusterExtents = (
  metrics: KeylineMetrics[],
  grid = 0.5
): { count: number; vx: number; vy: number }[] => {
  const q = (n: number) => Math.round(n / grid) * grid;
  const counts = new Map<string, { count: number; vx: number; vy: number }>();
  for (const m of metrics) {
    const vx = q(m.vx);
    const vy = q(m.vy);
    const key = `${vx}x${vy}`;
    const hit = counts.get(key);
    if (hit) {
      hit.count += 1;
    } else {
      counts.set(key, { count: 1, vx, vy });
    }
  }
  return [...counts.values()].toSorted((a, b) => b.count - a.count);
};
