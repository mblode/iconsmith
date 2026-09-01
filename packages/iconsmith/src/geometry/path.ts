import type { Box, Segment, Subpath } from "../types.js";

const lineTo = (x: number, y: number): Segment => ({ p: [x, y], t: "L" });
const curveTo = (p: number[]): Segment => ({
  p: [p[0], p[1], p[2], p[3], p[4], p[5]],
  t: "C",
});
const arcTo = (p: number[]): Segment => ({
  p: [p[0], p[1], p[2], p[3], p[4], p[5], p[6]],
  t: "A",
});

/**
 * Path data parsing and serialisation.
 *
 * Scope is deliberately narrow: the whole blode-icons set is M/L/C/H/V/Z with
 * 46 arcs in 4,193 files, so this handles the full SVG grammar on input but
 * only ever emits M/L/C/Z. Everything is resolved to absolute coordinates and
 * split into subpaths, because a subpath is the unit a "part" is defined at.
 *
 * No dependencies — this is the bottom of the stack and stays that way.
 */

const ARITY: Record<string, number> = {
  A: 7,
  C: 6,
  H: 1,
  L: 2,
  M: 2,
  Q: 4,
  S: 4,
  T: 2,
  V: 1,
  Z: 0,
};
// The exponent accepts `e` and `E`. `ILLEGAL` below permits both, so a capital
// `E` cleared that screen but was then not matched here — it vanished and every
// argument after it shifted, the exact silent mis-parse the screen exists to
// stop. `1E1` read as the two tokens `1` and `1`.
const TOKEN = /[MmLlHhVvCcSsQqTtAaZz]|-?\d*\.?\d+(?:[eE][-+]?\d+)?/gu;
const ALPHA = /[A-Za-z]/u;
/** Everything path data is allowed to be made of: command letters, the pieces
 *  of a number, and the separators between them. */
const ILLEGAL = /[^MmLlHhVvCcSsQqTtAaZz\d.eE+\-,\s]/u;
/** Characters of context either side of an offset in an error message. */
const EXCERPT = 12;

/**
 * Path data this parser refuses, rather than reading past.
 *
 * The tokeniser matches command letters and numbers and skips everything else,
 * so a stray character does not stop the parse — it vanishes, and because
 * arguments are consumed by arity, every argument after it shifts by one.
 * `Lnan nan` becomes `L` with the `a` of each `nan` read as a coordinate: two
 * NaNs, no complaint, and the rest of the path read out of step. That is how
 * `corpus/round-filled-radius-1-stroke-1.5/burger.svg` measured as a
 * two-shape icon when it draws three.
 *
 * Named after `InputError` in `commands/read.ts` and following its rule: say
 * which file, what was expected, and what to do about it. Separate from it
 * because `geometry/` is the bottom of the stack and imports nothing.
 */
export class PathError extends Error {
  readonly code = "PATH";
  /** The file the path data came from, when the caller named one. */
  readonly source?: string;
  constructor(message: string, source?: string) {
    super(message);
    this.name = "PathError";
    this.source = source;
  }
}

/** The path data around an offset, so a message can show the damage. */
const excerpt = (d: string, at: number): string => {
  const from = Math.max(0, at - EXCERPT);
  const to = Math.min(d.length, at + EXCERPT);
  return `${from > 0 ? "…" : ""}${d.slice(from, to)}${to < d.length ? "…" : ""}`;
};

const fail = (
  d: string,
  source: string | undefined,
  at: number,
  what: string
): PathError => {
  const where = source ? ` in "${source}"` : "";
  return new PathError(
    `Cannot parse the path data${where}: ${what} at offset ${at}, in "${excerpt(d, at)}". ` +
      "Path data is command letters, numbers and separators; anything else is dropped by the " +
      "tokeniser and shifts every argument after it. Fix the source, or drop the shape.",
    source
  );
};

export interface ParsePathOptions {
  /** File the path data came from, so an error can name it. */
  source?: string;
}

const abs = (a: number[], rel: boolean, cx: number, cy: number): number[] => {
  const out: number[] = [];
  for (let k = 0; k < a.length; k += 2) {
    out.push(rel ? cx + a[k] : a[k], rel ? cy + a[k + 1] : a[k + 1]);
  }
  return out;
};

/**
 * Parser state, threaded through one handler per command letter. Splitting the
 * command dispatch out of the loop keeps each rule readable on its own; the
 * loop only knows how to tokenise and how many arguments a letter takes.
 */
interface ParseState {
  /** Arguments of the command being handled, still in the command's own frame. */
  args: number[];
  cur: Subpath | null;
  /** Current point. */
  cx: number;
  cy: number;
  /** Reflection state for S/T shorthand: the last control point, and which
   *  curve kind put it there. `S` reflects only after `C`/`S`, `T` only after
   *  `Q`/`T`; a `T` after a cubic, or an `S` after a quadratic, takes the
   *  current point as its control instead of reflecting the wrong kind. */
  px: number;
  py: number;
  prevCubic: boolean;
  prevQuad: boolean;
  rel: boolean;
  /** Subpath start, restored by Z. */
  sx: number;
  sy: number;
  subpaths: Subpath[];
  up: string;
}

const flush = (s: ParseState) => {
  if (s.cur && s.cur.segs.length > 0) {
    s.subpaths.push(s.cur);
  }
  s.cur = null;
};

type Handler = (s: ParseState) => void;

const moveTo: Handler = (s) => {
  flush(s);
  const x = s.rel ? s.cx + s.args[0] : s.args[0];
  const y = s.rel ? s.cy + s.args[1] : s.args[1];
  s.cur = { closed: false, segs: [], start: [x, y] };
  s.cx = x;
  s.sx = x;
  s.cy = y;
  s.sy = y;
  s.prevCubic = false;
  s.prevQuad = false;
};

const closePath: Handler = (s) => {
  if (s.cur) {
    s.cur.closed = true;
    flush(s);
  }
  s.cx = s.sx;
  s.cy = s.sy;
  s.prevCubic = false;
  s.prevQuad = false;
};

const horizontal: Handler = (s) => {
  const x = s.rel ? s.cx + s.args[0] : s.args[0];
  s.cur?.segs.push(lineTo(x, s.cy));
  s.cx = x;
  s.prevCubic = false;
  s.prevQuad = false;
};

const vertical: Handler = (s) => {
  const y = s.rel ? s.cy + s.args[0] : s.args[0];
  s.cur?.segs.push(lineTo(s.cx, y));
  s.cy = y;
  s.prevCubic = false;
  s.prevQuad = false;
};

const straight: Handler = (s) => {
  const x = s.rel ? s.cx + s.args[0] : s.args[0];
  const y = s.rel ? s.cy + s.args[1] : s.args[1];
  s.cur?.segs.push(lineTo(x, y));
  s.cx = x;
  s.cy = y;
  s.prevCubic = false;
  s.prevQuad = false;
};

const cubic: Handler = (s) => {
  const pts = abs(s.args, s.rel, s.cx, s.cy);
  s.cur?.segs.push(curveTo(pts));
  const [c2x, c2y, ex, ey] = pts.slice(2);
  s.px = c2x;
  s.py = c2y;
  s.cx = ex;
  s.cy = ey;
  s.prevCubic = true;
  s.prevQuad = false;
};

const smoothCubic: Handler = (s) => {
  const pts = abs(s.args, s.rel, s.cx, s.cy);
  const [rx, ry] = s.prevCubic
    ? [2 * s.cx - s.px, 2 * s.cy - s.py]
    : [s.cx, s.cy];
  const [c2x, c2y, ex, ey] = pts;
  s.cur?.segs.push(curveTo([rx, ry, c2x, c2y, ex, ey]));
  s.px = c2x;
  s.py = c2y;
  s.cx = ex;
  s.cy = ey;
  s.prevCubic = true;
  s.prevQuad = false;
};

// Quadratics are elevated to cubics so downstream code sees one curve type.
const quadratic: Handler = (s) => {
  const pts = abs(s.args, s.rel, s.cx, s.cy);
  const { cx, cy } = s;
  let [qx, qy, ex, ey] = pts;
  if (s.up === "T") {
    // T has no control point of its own: reflect the previous one.
    [qx, qy] = s.prevQuad ? [2 * cx - s.px, 2 * cy - s.py] : [cx, cy];
    [ex, ey] = pts;
  }
  s.cur?.segs.push(
    curveTo([
      cx + (2 / 3) * (qx - cx),
      cy + (2 / 3) * (qy - cy),
      ex + (2 / 3) * (qx - ex),
      ey + (2 / 3) * (qy - ey),
      ex,
      ey,
    ])
  );
  s.px = qx;
  s.py = qy;
  s.cx = ex;
  s.cy = ey;
  s.prevCubic = false;
  s.prevQuad = true;
};

// Arcs are rare (46 in the whole set). Kept verbatim rather than
// approximated, so nothing is silently distorted.
const arc: Handler = (s) => {
  const ex = s.rel ? s.cx + s.args[5] : s.args[5];
  const ey = s.rel ? s.cy + s.args[6] : s.args[6];
  s.cur?.segs.push(
    arcTo([s.args[0], s.args[1], s.args[2], s.args[3], s.args[4], ex, ey])
  );
  s.cx = ex;
  s.cy = ey;
  s.prevCubic = false;
  s.prevQuad = false;
};

const HANDLERS: Record<string, Handler> = {
  A: arc,
  C: cubic,
  H: horizontal,
  L: straight,
  M: moveTo,
  Q: quadratic,
  S: smoothCubic,
  T: quadratic,
  V: vertical,
  Z: closePath,
};

/** Parse path data into subpaths of absolute segments. */
export const parsePath = (
  d: string,
  opts: ParsePathOptions = {}
): Subpath[] => {
  const text = String(d);
  const { source } = opts;
  const stray = text.search(ILLEGAL);
  if (stray !== -1) {
    throw fail(text, source, stray, `unexpected "${text[stray]}"`);
  }
  const found = [...text.matchAll(TOKEN)];
  const toks = found.map((m) => m[0]);
  /** Where a token started, for a message; past the end once they run out. */
  const at = (k: number): number => found[k]?.index ?? text.length;
  const s: ParseState = {
    args: [],
    cur: null,
    cx: 0,
    cy: 0,
    prevCubic: false,
    prevQuad: false,
    px: 0,
    py: 0,
    rel: false,
    subpaths: [],
    sx: 0,
    sy: 0,
    up: "",
  };
  let cmd: string | null = null;
  let i = 0;

  while (i < toks.length) {
    if (ALPHA.test(toks[i])) {
      cmd = toks[i];
      i += 1;
    }
    if (!cmd) {
      break;
    }
    const up = cmd.toUpperCase();
    const n = ARITY[up];
    if (n === undefined) {
      break;
    }
    const args: number[] = [];
    for (let k = 0; k < n; k += 1) {
      const tok = toks[i];
      const v = Number(tok);
      if (!Number.isFinite(v)) {
        throw fail(
          text,
          source,
          at(i),
          tok === undefined
            ? `the "${cmd}" command runs out of arguments after ${k} of ${n}`
            : `argument ${k + 1} of ${n} to the "${cmd}" command is "${tok}", not a number`
        );
      }
      args.push(v);
      i += 1;
    }
    s.args = args;
    s.rel = cmd !== up;
    s.up = up;
    // A drawing command after Z with no intervening M starts a new subpath at
    // the close point (SVG 8.3.3). Without this the handlers' `s.cur?.segs`
    // no-op silently drops the geometry while the current point still advances,
    // the same class of quiet loss the stray-character screen exists to stop.
    if (s.cur === null && up !== "M" && up !== "Z") {
      s.cur = { closed: false, segs: [], start: [s.cx, s.cy] };
      s.sx = s.cx;
      s.sy = s.cy;
    }
    HANDLERS[up](s);
    if (up === "M") {
      // A second coordinate pair after M is an implicit L.
      cmd = s.rel ? "l" : "L";
    }
  }
  flush(s);
  return s.subpaths;
};

/** Round to the sub-grid, then trim the float noise rounding leaves behind. */
export const q = (n: number, grid = 0.25): number => {
  const r = Math.round(n / grid) * grid;
  return Object.is(r, -0) ? 0 : Number(r.toFixed(4));
};

/** Serialise subpaths back to path data. Emits M/L/C/A/Z only. */
export const serialise = (
  subpaths: Subpath[],
  { grid = null }: { grid?: number | null } = {}
): string => {
  const f = (n: number) => (grid ? q(n, grid) : Number(n.toFixed(4)));
  return subpaths
    .map((sp: Subpath) => {
      let out = `M${f(sp.start[0])} ${f(sp.start[1])}`;
      for (const s of sp.segs) {
        if (s.t === "L") {
          out += `L${f(s.p[0])} ${f(s.p[1])}`;
        } else if (s.t === "C") {
          out += `C${s.p.map(f).join(" ")}`;
        } else {
          out += `A${s.p.slice(0, 5).join(" ")} ${f(s.p[5])} ${f(s.p[6])}`;
        }
      }
      return out + (sp.closed ? "Z" : "");
    })
    .join("");
};

/** Every on-path and control point of a subpath, in order. */
export const points = (sp: Subpath): [number, number][] => {
  const pts: [number, number][] = [sp.start];
  for (const s of sp.segs) {
    if (s.t === "C") {
      pts.push([s.p[0], s.p[1]], [s.p[2], s.p[3]], [s.p[4], s.p[5]]);
    } else if (s.t === "A") {
      pts.push([s.p[5], s.p[6]]);
    } else {
      pts.push([s.p[0], s.p[1]]);
    }
  }
  return pts;
};

/** The on-path end point of a segment, whichever form it takes. */
const endOf = (seg: Segment): [number, number] => {
  if (seg.t === "C") {
    return [seg.p[4], seg.p[5]];
  }
  if (seg.t === "A") {
    return [seg.p[5], seg.p[6]];
  }
  return [seg.p[0], seg.p[1]];
};

const cubicAt = (a: number, b: number, c: number, d: number, t: number) => {
  const m = 1 - t;
  return m * m * m * a + 3 * m * m * t * b + 3 * m * t * t * c + t * t * t * d;
};

/** Roots of the derivative, clamped to the [0,1] parameter range. */
const cubicExtrema = (a: number, b: number, c: number, d: number): number[] => {
  const A = 3 * (-a + 3 * b - 3 * c + d);
  const B = 6 * (a - 2 * b + c);
  const C = 3 * (b - a);
  const out: number[] = [];
  if (Math.abs(A) < 1e-12) {
    if (Math.abs(B) > 1e-12) {
      out.push(-C / B);
    }
  } else {
    const disc = B * B - 4 * A * C;
    if (disc >= 0) {
      const s = Math.sqrt(disc);
      out.push((-B + s) / (2 * A), (-B - s) / (2 * A));
    }
  }
  return out.filter((t) => t > 0 && t < 1);
};

/**
 * Tight bounding box, solving cubic extrema rather than using control points —
 * a control-point hull overestimates and would corrupt every keyline measurement.
 */
export const bbox = (subpaths: readonly Subpath[]): Box => {
  let x0 = Number.POSITIVE_INFINITY;
  let y0 = Number.POSITIVE_INFINITY;
  let x1 = Number.NEGATIVE_INFINITY;
  let y1 = Number.NEGATIVE_INFINITY;
  const hit = (x: number, y: number) => {
    if (x < x0) {
      x0 = x;
    }
    if (y < y0) {
      y0 = y;
    }
    if (x > x1) {
      x1 = x;
    }
    if (y > y1) {
      y1 = y;
    }
  };
  for (const sp of subpaths) {
    let [cx, cy] = sp.start;
    hit(cx, cy);
    for (const seg of sp.segs) {
      if (seg.t === "C") {
        const [c1x, c1y, c2x, c2y, cex, cey] = seg.p;
        // Both axes are resolved at the same t, so every hit is a point the
        // curve actually passes through.
        for (const t of [
          ...cubicExtrema(cx, c1x, c2x, cex),
          ...cubicExtrema(cy, c1y, c2y, cey),
        ]) {
          hit(cubicAt(cx, c1x, c2x, cex, t), cubicAt(cy, c1y, c2y, cey, t));
        }
      }
      const [ex, ey] = endOf(seg);
      hit(ex, ey);
      cx = ex;
      cy = ey;
    }
  }
  return { h: y1 - y0, w: x1 - x0, x0, x1, y0, y1 };
};

const translateSeg = (seg: Segment, dx: number, dy: number): Segment => {
  if (seg.t === "A") {
    return arcTo([...seg.p.slice(0, 5), seg.p[5] + dx, seg.p[6] + dy]);
  }
  if (seg.t === "C") {
    return curveTo(seg.p.map((v, k) => (k % 2 === 0 ? v + dx : v + dy)));
  }
  return lineTo(seg.p[0] + dx, seg.p[1] + dy);
};

/** Translate a subpath so its bbox corner sits at the origin. */
export const translate = (sp: Subpath, dx: number, dy: number): Subpath => ({
  closed: sp.closed,
  segs: sp.segs.map((seg) => translateSeg(seg, dx, dy)),
  start: [sp.start[0] + dx, sp.start[1] + dy],
});

const scaleSeg = (
  seg: Segment,
  k: number,
  f: (v: number, isX: boolean) => number
): Segment => {
  if (seg.t === "A") {
    return arcTo([
      seg.p[0] * k,
      seg.p[1] * k,
      seg.p[2],
      seg.p[3],
      seg.p[4],
      f(seg.p[5], true),
      f(seg.p[6], false),
    ]);
  }
  if (seg.t === "C") {
    return curveTo(seg.p.map((v, k2) => f(v, k2 % 2 === 0)));
  }
  return lineTo(f(seg.p[0], true), f(seg.p[1], false));
};

/**
 * Clockwise quarter-turns about the origin, as [xx, xy, yx, yy], applied as
 * `x' = xx·x + xy·y`, `y' = yx·x + yy·y`.
 *
 * Clockwise in y-down screen space: index 1 sends (1,0) to (0,1), a point on
 * the right edge moving to the bottom. The same four turns are what
 * `parts/shape.ts` compares under, so an index means one thing everywhere.
 */
const QUARTER: readonly (readonly [number, number, number, number])[] = [
  [1, 0, 0, 1],
  [0, -1, 1, 0],
  [-1, 0, 0, -1],
  [0, 1, -1, 0],
];
const QUARTER_DEG = 90;

/**
 * Turn a subpath by whole quarter-turns clockwise about the origin.
 *
 * Only quarter-turns, because only quarter-turns keep a shape on the grid: a
 * free angle moves every node off it, which is the drift the primitives exist
 * to prevent. Callers re-seat the result themselves — turning about the origin
 * moves the bbox corner, and where it should land is the caller's business.
 */
export const rotateQuarter = (sp: Subpath, turns: number): Subpath => {
  const t = ((Math.trunc(turns) % 4) + 4) % 4;
  const [xx, xy, yx, yy] = QUARTER[t];
  const r = (x: number, y: number): [number, number] => [
    xx * x + xy * y,
    yx * x + yy * y,
  ];
  const rotateSeg = (seg: Segment): Segment => {
    if (seg.t === "A") {
      // Rotating the path rotates the ellipse's own axis with it; the radii and
      // the sweep flag are unchanged, since a rotation preserves orientation.
      const [ex, ey] = r(seg.p[5], seg.p[6]);
      return arcTo([
        seg.p[0],
        seg.p[1],
        seg.p[2] + t * QUARTER_DEG,
        seg.p[3],
        seg.p[4],
        ex,
        ey,
      ]);
    }
    if (seg.t === "C") {
      const out: number[] = [];
      for (let i = 0; i < 6; i += 2) {
        out.push(...r(seg.p[i], seg.p[i + 1]));
      }
      return curveTo(out);
    }
    return lineTo(...r(seg.p[0], seg.p[1]));
  };
  return {
    closed: sp.closed,
    segs: sp.segs.map(rotateSeg),
    start: r(sp.start[0], sp.start[1]),
  };
};

/**
 * Reflect a subpath in the y-axis: `x' = -x`, y unchanged.
 *
 * One reflection is enough for any mirror a caller needs: composed with the
 * quarter-turns above, `mirrorX` reaches all four of the square's reflections —
 * vertical at turn 0, horizontal at turn 2, and the two diagonals at 1 and 3.
 * (The clusterer deliberately compares under only the first two; that is its
 * choice to make, and this function stays general.)
 *
 * A reflection reverses orientation, which is why the arc's sweep flag has to
 * invert and its x-axis rotation negate; the radii and the large-arc flag are
 * unaffected. As with `rotateQuarter`, callers re-seat the result themselves.
 */
export const mirrorX = (sp: Subpath): Subpath => {
  const mirrorSeg = (seg: Segment): Segment => {
    if (seg.t === "A") {
      return arcTo([
        seg.p[0],
        seg.p[1],
        -seg.p[2],
        seg.p[3],
        seg.p[4] ? 0 : 1,
        -seg.p[5],
        seg.p[6],
      ]);
    }
    if (seg.t === "C") {
      return curveTo(seg.p.map((v, i) => (i % 2 === 0 ? -v : v)));
    }
    return lineTo(-seg.p[0], seg.p[1]);
  };
  return {
    closed: sp.closed,
    segs: sp.segs.map(mirrorSeg),
    start: [-sp.start[0], sp.start[1]],
  };
};

export const scale = (sp: Subpath, k: number, ox = 0, oy = 0): Subpath => {
  const f = (v: number, isX: boolean) =>
    isX ? ox + (v - ox) * k : oy + (v - oy) * k;
  return {
    closed: sp.closed,
    segs: sp.segs.map((seg) => scaleSeg(seg, k, f)),
    start: [f(sp.start[0], true), f(sp.start[1], false)],
  };
};

type PolyPoint = [number, number];

const clamp01 = (t: number): number => Math.min(1, Math.max(0, t));

/**
 * Closest approach between two finite segments.
 *
 * Crossing segments are 0. Vertex-to-vertex over flatten cannot say that:
 * a straight is two endpoints, so a slash through a ring reports the
 * overhang (~0.485 on `ban`) instead of the intersection, and two
 * staggered parallel edges report a corner gap instead of the
 * perpendicular one. This is the quantity `lint` means by "apart".
 */
const segmentDistance = (
  a0: PolyPoint,
  a1: PolyPoint,
  b0: PolyPoint,
  b1: PolyPoint
): number => {
  const d1x = a1[0] - a0[0];
  const d1y = a1[1] - a0[1];
  const d2x = b1[0] - b0[0];
  const d2y = b1[1] - b0[1];
  const rx = a0[0] - b0[0];
  const ry = a0[1] - b0[1];
  const a = d1x * d1x + d1y * d1y;
  const e = d2x * d2x + d2y * d2y;
  const f = d2x * rx + d2y * ry;
  const degenerates = 1e-12;
  let s: number;
  let t: number;
  if (a <= degenerates && e <= degenerates) {
    return Math.hypot(rx, ry);
  }
  if (a <= degenerates) {
    s = 0;
    t = clamp01(f / e);
  } else {
    const c = d1x * rx + d1y * ry;
    if (e <= degenerates) {
      t = 0;
      s = clamp01(-c / a);
    } else {
      const b = d1x * d2x + d1y * d2y;
      const denom = a * e - b * b;
      s = denom === 0 ? 0 : clamp01((b * f - c * e) / denom);
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = clamp01(-c / a);
      } else if (t > 1) {
        t = 1;
        s = clamp01((b - c) / a);
      }
    }
  }
  const cx = a0[0] + s * d1x - (b0[0] + t * d2x);
  const cy = a0[1] + s * d1y - (b0[1] + t * d2y);
  return Math.hypot(cx, cy);
};

/**
 * Closest approach between two polylines, or null when either is empty.
 *
 * Segment-to-segment, so a pair of staggered parallel edges reports the
 * perpendicular gap rather than the vertex-to-vertex overestimate, and
 * crossing strokes report 0 rather than an endpoint overhang.
 */
export const polylineDistance = (
  a: readonly PolyPoint[],
  b: readonly PolyPoint[]
): number | null => {
  if (a.length === 0 || b.length === 0) {
    return null;
  }
  const segs = (poly: readonly PolyPoint[]): [PolyPoint, PolyPoint][] => {
    if (poly.length === 1) {
      return [[poly[0], poly[0]]];
    }
    const out: [PolyPoint, PolyPoint][] = [];
    for (let i = 1; i < poly.length; i += 1) {
      out.push([poly[i - 1], poly[i]]);
    }
    return out;
  };
  let min = Number.POSITIVE_INFINITY;
  for (const [a0, a1] of segs(a)) {
    for (const [b0, b1] of segs(b)) {
      const d = segmentDistance(a0, a1, b0, b1);
      if (d < min) {
        min = d;
      }
    }
  }
  return min;
};
