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
 */
export const fingerprint = (sp: Subpath): Fingerprint => {
  const b = bbox([sp]);
  const size = Math.max(b.w, b.h) || 1;
  const norm: Point[] = resample(flatten(sp)).map(([x, y]) => [
    (x - b.x0) / size,
    (y - b.y0) / size,
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

/**
 * Mean point distance between two fingerprints, in normalised units.
 * Closed shapes are compared at every rotation of their sample order, because
 * the same ring drawn from a different start node is the same shape.
 */
export const distance = (a: Fingerprint, b: Fingerprint): number => {
  if (a.closed !== b.closed) {
    return Number.POSITIVE_INFINITY;
  }
  // Aspect ratio is cheap and prunes most non-matches before the O(n^2) loop.
  if (Math.abs(a.aspect - b.aspect) > ASPECT_TOLERANCE) {
    return Number.POSITIVE_INFINITY;
  }
  const n = a.norm.length;
  const rotations = a.closed ? n : 1;
  let best = Number.POSITIVE_INFINITY;
  for (const flip of [false, true]) {
    const bn = flip ? b.norm.toReversed() : b.norm;
    for (let r = 0; r < rotations; r += 1) {
      let sum = 0;
      for (let i = 0; i < n; i += 1) {
        const [px, py] = a.norm[i];
        const [qx, qy] = bn[(i + r) % n];
        sum += Math.hypot(px - qx, py - qy);
        // Already worse than the best rotation found; the rest cannot help.
        if (sum / n >= best) {
          break;
        }
      }
      const d = sum / n;
      if (d < best) {
        best = d;
      }
    }
  }
  return best;
};
