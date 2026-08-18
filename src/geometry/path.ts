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
const TOKEN = /[MmLlHhVvCcSsQqTtAaZz]|-?\d*\.?\d+(?:e[-+]?\d+)?/gu;
const ALPHA = /[A-Za-z]/u;

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
  /** Reflection state for S/T shorthand. */
  px: number;
  py: number;
  prevCubic: boolean;
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
};

const closePath: Handler = (s) => {
  if (s.cur) {
    s.cur.closed = true;
    flush(s);
  }
  s.cx = s.sx;
  s.cy = s.sy;
  s.prevCubic = false;
};

const horizontal: Handler = (s) => {
  const x = s.rel ? s.cx + s.args[0] : s.args[0];
  s.cur?.segs.push(lineTo(x, s.cy));
  s.cx = x;
  s.prevCubic = false;
};

const vertical: Handler = (s) => {
  const y = s.rel ? s.cy + s.args[0] : s.args[0];
  s.cur?.segs.push(lineTo(s.cx, y));
  s.cy = y;
  s.prevCubic = false;
};

const straight: Handler = (s) => {
  const x = s.rel ? s.cx + s.args[0] : s.args[0];
  const y = s.rel ? s.cy + s.args[1] : s.args[1];
  s.cur?.segs.push(lineTo(x, y));
  s.cx = x;
  s.cy = y;
  s.prevCubic = false;
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
};

// Quadratics are elevated to cubics so downstream code sees one curve type.
const quadratic: Handler = (s) => {
  const pts = abs(s.args, s.rel, s.cx, s.cy);
  const { cx, cy } = s;
  let [qx, qy, ex, ey] = pts;
  if (s.up === "T") {
    // T has no control point of its own: reflect the previous one.
    [qx, qy] = s.prevCubic ? [2 * cx - s.px, 2 * cy - s.py] : [cx, cy];
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
  s.prevCubic = true;
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
export const parsePath = (d: string): Subpath[] => {
  const toks = String(d).match(TOKEN) ?? [];
  const s: ParseState = {
    args: [],
    cur: null,
    cx: 0,
    cy: 0,
    prevCubic: false,
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
      args.push(Number(toks[i]));
      i += 1;
    }
    s.args = args;
    s.rel = cmd !== up;
    s.up = up;
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
export const bbox = (subpaths: Subpath[]): Box => {
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
 * One reflection is enough. Composed with the four quarter-turns above it
 * generates all eight symmetries of the square, so a mirror about any axis —
 * vertical, horizontal or either diagonal — is `mirrorX` plus a turn.
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
