/**
 * Filled and outlined are one skeleton, two paints.
 *
 * Outlined is a centre-line stroke. Filled is that stroke expanded into a
 * solid whose outer edge is the ink the outline already occupied; interiors
 * that were canvas become holes. Host-side helpers emit the DSL; the model
 * never emits a coordinate.
 *
 * Visual extent is the path bbox plus inkWidth — 0 when filled (the path is
 * the boundary) and the house stroke when outlined. That is the quantity that
 * matches in 94% of house pairs.
 */
import type { Finish, Keyline } from "../types.js";
import { SPEC } from "./canvas.js";
import type { Spec } from "./canvas.js";

/** The house stroke, and half of it. Prefer the spec argument on each helper. */
export const BAR = SPEC.stroke;
export const HALF = BAR / 2;

const paint = (spec: Spec): { bar: number; half: number } => ({
  bar: spec.stroke,
  half: spec.stroke / 2,
});

interface Sized {
  bbox: () => { h: number; w: number } | null;
  inkWidth: number;
}

const radius = (r?: number): string => (r === undefined ? "" : ` r${r}`);

const rect = (x: number, y: number, w: number, h: number, r?: number): string =>
  `rect ${x},${y} ${w}x${h}${radius(r)}`;

/**
 * Visual size lint uses: path bbox + inkWidth.
 * inkWidth is 0 when filled (path IS the boundary) and SPEC.stroke when outlined.
 * This is the quantity that matches in 94% of house pairs.
 */
export const visualSize = (canvas: Sized): { h: number; w: number } | null => {
  const box = canvas.bbox();
  if (!box) {
    return null;
  }
  return { h: box.h + canvas.inkWidth, w: box.w + canvas.inkWidth };
};

/** True when both visual sizes exist and each axis differs by at most `tol` (default 0.01). */
export const sameExtent = (a: Sized, b: Sized, tol = 0.01): boolean => {
  const left = visualSize(a);
  const right = visualSize(b);
  if (!(left && right)) {
    return false;
  }
  return Math.abs(left.w - right.w) <= tol && Math.abs(left.h - right.h) <= tol;
};

/**
 * Horizontal bar. Outlined `line x,y x+w,y`. Filled is a 2-wide rect on the
 * same centre-line, half a stroke past both endpoints, so a lone bar occupies
 * the same visual extent as the stroked line (round caps add a stroke to the
 * length). Thickening only the short axis leaves the filled twin two units
 * short — a four-bar box hides that, a lone bar does not.
 */
export const hbar = (
  finish: Finish,
  x: number,
  y: number,
  w: number,
  spec: Spec = SPEC
): string => {
  const { bar, half } = paint(spec);
  return finish === "filled"
    ? rect(x - half, y - half, w + bar, bar)
    : `line ${x},${y} ${x + w},${y}`;
};

/** Vertical bar. Same cap rule as {@link hbar}, on the long axis. */
export const vbar = (
  finish: Finish,
  x: number,
  y: number,
  h: number,
  spec: Spec = SPEC
): string => {
  const { bar, half } = paint(spec);
  return finish === "filled"
    ? rect(x - half, y - half, bar, h + bar)
    : `line ${x},${y} ${x},${y + h}`;
};

/**
 * A ring. `r` is the outlined centre-line radius.
 * Outlined: `circle cx,cy r{r}`
 * Filled:   `circle cx,cy r{r+HALF}` then `hole circle cx,cy r{r-HALF}`
 * so the visual outer is r+1 and the hole is r-1 (stroke 2).
 * Return an array of DSL lines (hole must immediately follow the circle).
 */
export const ring = (
  finish: Finish,
  cx: number,
  cy: number,
  r: number,
  spec: Spec = SPEC
): string[] => {
  const { half } = paint(spec);
  return finish === "filled"
    ? [
        `circle ${cx},${cy} r${r + half}`,
        `hole circle ${cx},${cy} r${r - half}`,
      ]
    : [`circle ${cx},${cy} r${r}`];
};

/**
 * A hollow frame. `x,y,w,h,r` are the outlined centre-line rect.
 * Outlined: `rect x,y wxh r{r}`
 * Filled: expanded by HALF on each side, plus a concentric hole inset by HALF,
 * inner radius max(0, r-HALF).
 */
export const frame = (
  finish: Finish,
  x: number,
  y: number,
  w: number,
  h: number,
  r?: number,
  spec: Spec = SPEC
): string[] => {
  const { bar, half } = paint(spec);
  if (finish !== "filled") {
    return [rect(x, y, w, h, r)];
  }
  const outerR = r === undefined ? undefined : r + half;
  const innerR = r === undefined ? undefined : Math.max(0, r - half);
  return [
    rect(x - half, y - half, w + bar, h + bar, outerR),
    `hole ${rect(x + half, y + half, w - bar, h - bar, innerR)}`,
  ];
};

/**
 * The filled silhouette of a stroked closed rect. Outlined keeps the
 * centre-line; filled expands by half a stroke on every side and adds half a
 * stroke to the corner, so the outer edge is the ink the outline already
 * occupied. Use this for a body (minus, battery, a grid tile). A joint that
 * must stay flush with a neighbour expands on the free sides only — write
 * that by hand, do not call this.
 */
export const mass = (
  finish: Finish,
  x: number,
  y: number,
  w: number,
  h: number,
  r?: number,
  spec: Spec = SPEC
): string => {
  const { bar, half } = paint(spec);
  return finish === "filled"
    ? rect(
        x - half,
        y - half,
        w + bar,
        h + bar,
        r === undefined ? undefined : r + half
      )
    : rect(x, y, w, h, r);
};

/** Assemble a .icon program. Always declare finish before geometry.
 *  `keyline` plus `fit` only when the drawing occupies that box — a declared
 *  miss is an error, not a warning. Trailing blank line, matching marks.ts. */
export const program = (
  slug: string,
  finish: Finish,
  keyline: Keyline | null,
  ops: string[]
): string =>
  [
    `icon ${slug}`,
    ...(keyline === null ? [] : [`keyline ${keyline}`]),
    `finish ${finish}`,
    "",
    ...ops,
    ...(keyline === null ? [] : ["fit"]),
    "",
  ].join("\n");

/**
 * A square rotated 45°: vertices on the axes, every edge on 45/135.
 *
 * `reach` is the centre-to-vertex distance, so equal run and equal rise.
 * A kite that is merely grid-legal (2 wide, 4 tall) sits ~20° off 135° —
 * that is the compass needle that lint flags. Outlined is one closed
 * polyline; filled is four two-point bars, because a polyline encloses
 * nothing under fill.
 */
export const lozenge = (
  _finish: Finish,
  cx: number,
  cy: number,
  reach: number
): string[] => [`diamond ${cx},${cy} r${reach}`];

/**
 * Concentric upper half-arcs: a wifi fan, an umbrella canopy stack.
 *
 * `half from left` is the upper semicircle (left → top → right). The
 * emitter sits on the shared centre so the visual box is the outer arc
 * plus whatever is drawn below it — for wifi, a `dot` on that centre
 * is a 20×11.5 fan; a `dot` several units below is how the drawing
 * occupies `wide` 20×16 on purpose.
 */
export const fan = (
  _finish: Finish,
  cx: number,
  cy: number,
  radii: readonly number[]
): string[] => radii.map((r) => `arc ${cx},${cy} r${r} half from left`);

const OFF_AXIS = "off-axis";

/** Split a closed or open polyline into two-point segments. Filled `line`
 *  only paints a two-point bar; a diamond written as one op has to become
 *  four before the other paint can run. */
const splitPolyline = (line: string): string[] => {
  const tokens = line.trim().split(/\s+/u).slice(1);
  const off = tokens.includes(OFF_AXIS);
  const points = tokens.filter((t) => t !== OFF_AXIS);
  if (points.length < 3) {
    return [line];
  }
  const flag = off ? ` ${OFF_AXIS}` : "";
  const out: string[] = [];
  for (let i = 1; i < points.length; i += 1) {
    if (points[i] === points[0] && i === points.length - 1 && out.length > 0) {
      // Closing vertex: last segment already listed if it is a real edge.
    }
    out.push(`line ${points[i - 1]} ${points[i]}${flag}`);
  }
  return out;
};

/**
 * The same program in the other paint.
 *
 * Swaps `finish`, splits polylines so filled bars can run, and leaves
 * `arc` / `circle` / `rect` as the primitives they are: filled `arc` is
 * the annular sector, filled `circle` a solid (call {@link ring} when
 * the outlined circle was a hoop). `part` is unchanged.
 */
export const adaptProgram = (source: string, finish: Finish): string => {
  const lines = source.split("\n");
  const out: string[] = [];
  let sawFinish = false;
  let headerAt = 0;
  for (const [i, line] of lines.entries()) {
    const trimmed = line.trim();
    if (/^icon\b/u.test(trimmed) || /^keyline\b/u.test(trimmed)) {
      headerAt = i + 1;
    }
    if (/^finish\b/u.test(trimmed)) {
      out.push(`finish ${finish}`);
      sawFinish = true;
      continue;
    }
    if (finish === "filled" && /^line\b/u.test(trimmed)) {
      out.push(...splitPolyline(trimmed));
      continue;
    }
    out.push(line);
  }
  if (!sawFinish) {
    out.splice(headerAt, 0, `finish ${finish}`);
  }
  return out.join("\n");
};
