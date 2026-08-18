/**
 * The construction audit: does the set obey the rules the article states?
 *
 * The rules being tested are Cursor's, and Central is a different set that may
 * legitimately differ. So every check here reports a *distribution* and a list
 * of outliers rather than a verdict, and every threshold is a named constant
 * whose sensitivity is reported alongside the count. A rule that flags half the
 * set is a rule against this set rather than for it — the SPEC recalibration
 * already found two of those — and the way to notice is to see the whole curve,
 * not a single number.
 */
import { bbox, parsePath } from "../geometry/path.js";
import { flatten } from "../parts/shape.js";
import type { Segment, Subpath } from "../types.js";
import { parseIconSvg } from "./load.js";

/** Straight segments shorter than this are construction residue, not edges:
 *  including them makes the angle distribution noise. */
const MIN_EDGE = 0.1;
/** Degrees either side of an axis still counted as on-axis. */
const ANGLE_TOLERANCE = 1;
/** Radial deviation, as a fraction of the fitted radius, within which a cubic
 *  is a circular arc rather than a freeform curve. */
const ARC_TOLERANCE = 0.02;
/** A cubic whose sampled points sit this close to its own chord is drawn as a
 *  curve but reads as a line. */
const STRAIGHT_TOLERANCE = 0.01;
/** |signed area| below this makes a subpath a zero-area spur rather than a
 *  shape. In a 24-unit box a real shape is orders of magnitude above it. */
const SPUR_AREA = 0.01;
/** Two anchors closer than this are the same point. */
const COINCIDENT = 0.01;
/** A subpath whose whole extent is under this draws only its caps. */
const DEGENERATE_EXTENT = 0.05;
/** Below this extent a subpath is a dot or a tick, not a shape that could have
 *  been "closed instead of left open". Testing those for near-closure measures
 *  the dot idiom rather than a construction choice. */
const MIN_SHAPE_EXTENT = 1;
const SAMPLES = 12;

const cubicAt = (a: number, b: number, c: number, d: number, t: number) => {
  const s = 1 - t;
  return s * s * s * a + 3 * s * s * t * b + 3 * s * t * t * c + t * t * t * d;
};

const endOf = (s: Segment): [number, number] => {
  if (s.t === "C") {
    return [s.p[4], s.p[5]];
  }
  if (s.t === "A") {
    return [s.p[5], s.p[6]];
  }
  return [s.p[0], s.p[1]];
};

const dist = (a: [number, number], b: [number, number]) =>
  Math.hypot(a[0] - b[0], a[1] - b[1]);

/** Anchor points in order: the subpath start, then each segment's endpoint. */
const anchors = (sp: Subpath): [number, number][] => [
  [...sp.start] as [number, number],
  ...sp.segs.map(endOf),
];

/** Circle through three points, or null when they are collinear. */
const circleThrough = (
  a: [number, number],
  b: [number, number],
  c: [number, number]
): { cx: number; cy: number; r: number } | null => {
  const d =
    2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]));
  if (Math.abs(d) < 1e-9) {
    return null;
  }
  const sa = a[0] * a[0] + a[1] * a[1];
  const sb = b[0] * b[0] + b[1] * b[1];
  const sc = c[0] * c[0] + c[1] * c[1];
  const cx = (sa * (b[1] - c[1]) + sb * (c[1] - a[1]) + sc * (a[1] - b[1])) / d;
  const cy = (sa * (c[0] - b[0]) + sb * (a[0] - c[0]) + sc * (b[0] - a[0])) / d;
  return { cx, cy, r: Math.hypot(a[0] - cx, a[1] - cy) };
};

export type CurveClass =
  /** A circular arc between two straight segments: the article's construction. */
  | "join-arc"
  /** A circular arc in an all-curve subpath — a circle or an ellipse. */
  | "circle-arc"
  /** A circular arc next to another curve. */
  | "blend-arc"
  /** A cubic whose control points do not describe an arc. */
  | "freeform"
  /** A cubic that is straight enough to be a line. */
  | "line-like";

export interface CurveAudit {
  cls: CurveClass;
  radius: number | null;
}

/**
 * Classify one cubic. The test is geometric rather than a handle-length
 * heuristic: sample the curve, fit a circle to its ends and midpoint, and ask
 * how far the rest of the curve strays from it. Handle symmetry alone accepts
 * shapes that are visibly not arcs.
 */
const classifyCubic = (
  p0: [number, number],
  seg: Segment & { t: "C" },
  prev: Segment | undefined,
  next: Segment | undefined,
  allCurves: boolean
): CurveAudit => {
  const [c1x, c1y, c2x, c2y, ex, ey] = seg.p;
  const pts: [number, number][] = [];
  for (let i = 0; i <= SAMPLES; i += 1) {
    const t = i / SAMPLES;
    pts.push([
      cubicAt(p0[0], c1x, c2x, ex, t),
      cubicAt(p0[1], c1y, c2y, ey, t),
    ]);
  }
  const chord = dist(p0, [ex, ey]);
  if (chord > 1e-9) {
    // Distance from the chord, normalised: a curve that never leaves its own
    // chord is a line drawn as a cubic.
    const off = Math.max(
      ...pts.map((q) => {
        const t =
          ((q[0] - p0[0]) * (ex - p0[0]) + (q[1] - p0[1]) * (ey - p0[1])) /
          (chord * chord);
        const px = p0[0] + t * (ex - p0[0]);
        const py = p0[1] + t * (ey - p0[1]);
        return Math.hypot(q[0] - px, q[1] - py);
      })
    );
    if (off / chord < STRAIGHT_TOLERANCE) {
      return { cls: "line-like", radius: null };
    }
  }
  const fit = circleThrough(pts[0], pts[SAMPLES / 2], pts[SAMPLES]);
  if (!fit || fit.r < 1e-6) {
    return { cls: "freeform", radius: null };
  }
  const dev = Math.max(
    ...pts.map((q) =>
      Math.abs(Math.hypot(q[0] - fit.cx, q[1] - fit.cy) - fit.r)
    )
  );
  if (dev / fit.r > ARC_TOLERANCE) {
    return { cls: "freeform", radius: null };
  }
  if (allCurves) {
    return { cls: "circle-arc", radius: fit.r };
  }
  const flanked = prev?.t === "L" && next?.t === "L";
  return { cls: flanked ? "join-arc" : "blend-arc", radius: fit.r };
};

export interface EdgeAudit {
  angle: number;
  length: number;
  /** Degrees from the nearest of 0/45/90/135. */
  offAxis: number;
}

export interface IconAudit {
  /** Linecap of each stroked element that actually has a visible cap. A closed
   *  subpath has no ends, so its linecap is inert and counting it would report
   *  a default attribute rather than a drawing decision. */
  caps: string[];
  curves: CurveAudit[];
  edges: EdgeAudit[];
  /** Opacity values found on any element or group. */
  opacity: string[];
  /** Open subpaths whose ends nearly meet: gap, and the subpath's extent. */
  nearClosed: { extent: number; gap: number }[];
  /** Closed or filled subpaths that enclose no area but have length: the
   *  residue of a stroke the design tool already converted to outlines. An
   *  *open* stroked subpath encloses nothing by definition, so including those
   *  would flag every straight line in the set. */
  spurContours: number;
  /** Anchors inside a subpath where the path retraces itself exactly. */
  spurRetraces: number;
  subpaths: number;
  symbol: string;
}

const signedArea = (sp: Subpath): number => {
  const poly = flatten(sp, 8);
  let a = 0;
  for (let i = 0; i < poly.length; i += 1) {
    const [x0, y0] = poly[i];
    const [x1, y1] = poly[(i + 1) % poly.length];
    a += x0 * y1 - x1 * y0;
  }
  return a / 2;
};

/** Walk one subpath's segments, appending edges and classified curves, and
 *  returning the number of exact retraces found inside it. */
const collectSegments = (
  sp: Subpath,
  edges: EdgeAudit[],
  curves: CurveAudit[]
): number => {
  const pts = anchors(sp);
  const allCurves = sp.segs.every((seg) => seg.t !== "L");
  let retraces = 0;
  for (let i = 0; i < sp.segs.length; i += 1) {
    const seg = sp.segs[i];
    const from = pts[i];
    const to = pts[i + 1];
    // A retrace: the path leaves a point and comes straight back to where it
    // was, enclosing nothing.
    if (i > 0 && dist(pts[i - 1], to) < COINCIDENT) {
      retraces += 1;
    }
    if (seg.t === "L") {
      const length = dist(from, to);
      if (length >= MIN_EDGE) {
        let angle =
          (Math.atan2(to[1] - from[1], to[0] - from[0]) * 180) / Math.PI;
        angle = ((angle % 180) + 180) % 180;
        const offAxis = Math.min(
          ...[0, 45, 90, 135, 180].map((a) => Math.abs(a - angle))
        );
        edges.push({ angle, length, offAxis });
      }
    } else if (seg.t === "C") {
      const prev = sp.segs[i - 1] ?? (sp.closed ? sp.segs.at(-1) : undefined);
      const next = sp.segs[i + 1] ?? (sp.closed ? sp.segs[0] : undefined);
      curves.push(classifyCubic(from, seg, prev, next, allCurves));
    }
  }
  return retraces;
};

const OPACITY = /\bopacity\s*=\s*"(?<value>[^"]*)"/gu;

export const auditIcon = (symbol: string, svg: string): IconAudit => {
  const shapes = parseIconSvg(svg);
  const edges: EdgeAudit[] = [];
  const curves: CurveAudit[] = [];
  const nearClosed: { extent: number; gap: number }[] = [];
  let spurContours = 0;
  let spurRetraces = 0;
  let subpaths = 0;

  const caps: string[] = [];
  for (const shape of shapes) {
    let capVisible = false;
    for (const sp of parsePath(shape.d)) {
      subpaths += 1;
      const pts = anchors(sp);
      const b = bbox([sp]);
      const extent = Math.max(b.w, b.h);

      if (
        (sp.closed || shape.filled) &&
        Math.abs(signedArea(sp)) < SPUR_AREA &&
        extent > DEGENERATE_EXTENT
      ) {
        spurContours += 1;
      }
      if (!sp.closed) {
        if (extent > DEGENERATE_EXTENT) {
          capVisible = true;
        }
        if (extent >= MIN_SHAPE_EXTENT) {
          nearClosed.push({
            extent,
            gap: dist(pts[0], pts.at(-1) as [number, number]),
          });
        }
      }

      spurRetraces += collectSegments(sp, edges, curves);
    }
    if (shape.strokeWidth > 0 && capVisible) {
      caps.push(shape.cap);
    }
  }

  OPACITY.lastIndex = 0;
  const opacity = [...svg.matchAll(OPACITY)].map((m) => m.groups?.value ?? "");

  return {
    caps,
    curves,
    edges,
    nearClosed,
    opacity,
    spurContours,
    spurRetraces,
    subpaths,
    symbol,
  };
};

export const onAxisShare = (
  edges: EdgeAudit[],
  tol = ANGLE_TOLERANCE
): number =>
  edges.length === 0
    ? 1
    : edges.filter((e) => e.offAxis <= tol).length / edges.length;

export const freeformShare = (curves: CurveAudit[]): number => {
  const shaped = curves.filter((c) => c.cls !== "line-like");
  return shaped.length === 0
    ? 0
    : shaped.filter((c) => c.cls === "freeform").length / shaped.length;
};

export { ANGLE_TOLERANCE, ARC_TOLERANCE, MIN_EDGE, SPUR_AREA };
