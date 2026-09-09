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
import type {
  DrawOp,
  Finish,
  IconDoc,
  Issue,
  Keyline,
  Part,
} from "../types.js";
import { Canvas, SPEC } from "./canvas.js";
import type { Spec } from "./canvas.js";
import { lint } from "./lint.js";
import type { LintTarget } from "./lint.js";

/** The house stroke, and half of it. Prefer the spec argument on each helper. */

const paint = (spec: Spec): { bar: number; half: number } => ({
  bar: spec.stroke,
  half: spec.stroke / 2,
});

interface Sized {
  visualBbox?: () => { h: number; w: number } | null;
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
  if (canvas.visualBbox) {
    const box = canvas.visualBbox();
    return box ? { h: box.h, w: box.w } : null;
  }
  const box = canvas.bbox();
  if (!box) {
    return null;
  }
  return { h: box.h + canvas.inkWidth, w: box.w + canvas.inkWidth };
};

/**
 * How far two visual extents may sit apart and still be one skeleton.
 *
 * 0.01u was a coordinate-equality test wearing a tolerance's clothes, and it
 * errored on 1 in 12 of the designer's own drawings. Measured over `corpus/`
 * with this same per-axis rule, n=2,085 pairs: 0.01 passes 91.46% (178 fail),
 * 0.25 passes 95.59% (92 fail), 0.50 passes 97.46% (53 fail). The max-axis
 * |delta| distribution is bimodal — p50 0.000, p90 0.004, p95 0.198, p99
 * 1.155 — so a paint either lands on the extent or misses it by a unit, and
 * everything in the 0.01–0.5 band is quantiser noise. That band holds 125 of
 * the 2,085 house pairs, every one of them called an error at 0.01. A real
 * mismatch clears 0.5 fourfold: a filled disc restamping a stroked ring loses
 * a whole stroke, 2u.
 *
 * The 94% quoted in this module's header and in `lint.ts` is a *signed
 * longest-side* statistic (`scripts/measure-filled.ts:607,633`), a different
 * measurement from this per-axis one; reproducing it over the same corpus
 * gives 94.3%, which is what says the numbers above were measured right.
 */
const EXTENT_TOL = 0.5;

/**
 * True when both visual sizes exist and each axis differs by at most `tol`
 * (default {@link EXTENT_TOL}).
 */
export const sameExtent = (a: Sized, b: Sized, tol = EXTENT_TOL): boolean => {
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

/** `12,7.5` → `[12, 7.5]`. Null when the token is not a pair, so a malformed
 *  op is passed through untouched rather than silently reshaped. */
const asPair = (token: string | undefined): [number, number] | null => {
  const m = token?.match(/^(?<x>-?[\d.]+),(?<y>-?[\d.]+)$/u)?.groups;
  if (!m) {
    return null;
  }
  const x = Number(m.x);
  const y = Number(m.y);
  return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : null;
};

const fmt = (n: number): string => String(Number(n.toFixed(4)));

const pointsOf = (points: readonly [number, number][]): string =>
  points.map(([x, y]) => `${fmt(x)},${fmt(y)}`).join(" ");

/**
 * The points the stroked paint actually draws, written back as one `line`.
 *
 * `line()` snaps each vertex against the *previous snapped* one, so a polyline
 * is a chain: `line 4,12 20,6 13,12 20,18 4,12 off-axis` lands its third
 * vertex on `13.5,12.5`, not on `13,12`. Splitting the source text instead
 * gave every filled bar the raw coordinate and let it re-snap from its own
 * start, so bar 2 ended at `13.5,12.5` while bar 3 began at `13,12` and the
 * filled twin came apart at every joint — a gap in the drawing that no rule
 * looked for, because the bounding box is set by the outer vertices and those
 * agreed.
 *
 * Running the one op through a scratch canvas reproduces the chain exactly:
 * `line` snaps only within itself, so nothing else in the program can change
 * the answer.
 */
const snappedLine = (line: string, spec: Spec): string => {
  const tokens = line.trim().split(/\s+/u).slice(1);
  const offAxis = tokens.includes(OFF_AXIS);
  const points = tokens
    .filter((t) => t !== OFF_AXIS)
    .map(asPair)
    .filter((p): p is [number, number] => p !== null);
  if (points.length < 2) {
    return line;
  }
  try {
    const canvas = new Canvas([], { finish: "outlined", spec });
    canvas.line({ offAxis, points });
    const [el] = canvas.elements;
    if (el?.kind !== "line") {
      return line;
    }
    return `line ${pointsOf(el.points)}${offAxis ? ` ${OFF_AXIS}` : ""}`;
  } catch {
    // A refused segment is the stroked paint's problem to report, not this
    // one's to hide. Pass the op through and let the filled run say so too.
    return line;
  }
};

const asRadius = (token: string | undefined): number | null => {
  const m = token?.match(/^r(?<r>-?[\d.]+)$/u)?.groups;
  const v = m ? Number(m.r) : Number.NaN;
  return Number.isFinite(v) ? v : null;
};

/** `18x11` → `[18, 11]`. */
const asSize = (token: string | undefined): [number, number] | null => {
  const m = token?.match(/^(?<w>-?[\d.]+)x(?<h>-?[\d.]+)$/u)?.groups;
  if (!m) {
    return null;
  }
  const w = Number(m.w);
  const h = Number(m.h);
  return Number.isFinite(w) && Number.isFinite(h) ? [w, h] : null;
};

/** Quarter-grid, the only grid a coordinate in this language may land on. */
const g = (v: number): number => Math.round(v * 4) / 4;

const num = (v: number): string => String(g(v));

interface Op {
  /** Tokens after the op word. */
  args: string[];
  /** Verbatim source, so anything this module does not understand survives. */
  raw: string;
  word: string;
}

const parseOp = (line: string): Op => {
  const trimmed = line.trim();
  const [word = "", ...args] = trimmed.split(/\s+/u);
  return { args, raw: line, word: word.toLowerCase() };
};

const CIRCLE = "circle";
const RECT = "rect";

/**
 * A stroked circle is a hoop, so its ink is an annulus.
 *
 * This is the whole of the outlined→filled derivation in one example. The
 * previous revision emitted `circle` unchanged under the other finish, which
 * is a *solid disc* — and that is why the filled compass rendered as a black
 * circle with the needle lost inside it. A ring is not a disc with a different
 * paint; it is the ink the outline occupied, and the hole is where the canvas
 * always was.
 *
 * A circle no wider than the stroke is the exception, and it is geometry
 * rather than a special case: its own stroke closes the hole, so the ink is a
 * disc and there is nothing to knock out.
 */
const filledCircle = (args: string[], half: number): string[] | null => {
  const centre = asPair(args[0]);
  const r = asRadius(args[1]);
  if (!centre || r === null) {
    return null;
  }
  const [cx, cy] = centre;
  const at = `${num(cx)},${num(cy)}`;
  if (r <= half) {
    return [`${CIRCLE} ${at} r${num(r + half)}`];
  }
  return [
    `${CIRCLE} ${at} r${num(r + half)}`,
    `hole ${CIRCLE} ${at} r${num(r - half)}`,
  ];
};

/** A stroked rect is a frame, so its ink is a border. Same argument as
 *  {@link filledCircle}; a rect no thicker than the stroke on either axis is
 *  a bar, and its ink is the solid. */
const filledRect = (args: string[], bar: number): string[] | null => {
  const at = asPair(args[0]);
  const size = asSize(args[1]);
  if (!at || !size) {
    return null;
  }
  const half = bar / 2;
  const [x, y] = at;
  const [w, h] = size;
  // An absent radius token is `r2`, not `r0`: `dsl.ts`'s rectArgs defaults it
  // to 2. Reading it as "no radius" and emitting none made the twin replay
  // back to that default rather than to the stroked corner (outer r+half, hole
  // r-half), so a plain `rect` came out one tier too tight outside and one too
  // round inside. Default it here and always emit the derived radii.
  const r = asRadius(args[2]) ?? 2;
  const corner = (v: number): string => ` r${num(v)}`;
  const outer = `${RECT} ${num(x - half)},${num(y - half)} ${num(w + bar)}x${num(h + bar)}${corner(r + half)}`;
  if (w <= bar || h <= bar) {
    return [outer];
  }
  return [
    outer,
    `hole ${RECT} ${num(x + half)},${num(y + half)} ${num(w - bar)}x${num(h - bar)}${corner(Math.max(0, r - half))}`,
  ];
};

/** The centre-line a solid-plus-hole pair was expanded from: {@link
 *  filledCircle} run backwards. */
const outlinedRing = (
  solid: string[],
  hole: string[] | null,
  half: number
): string[] | null => {
  const centre = asPair(solid[0]);
  const outer = asRadius(solid[1]);
  if (!centre || outer === null) {
    return null;
  }
  const at = `${num(centre[0])},${num(centre[1])}`;
  const inner = hole ? asRadius(hole[1]) : null;
  const r = inner === null ? outer - half : (outer + inner) / 2;
  return [`${CIRCLE} ${at} r${num(r)}`];
};

/**
 * {@link filledRect} run backwards.
 *
 * The hole is not consulted, and that is not an oversight: a frame's outer
 * edge already fixes the centre-line, since both the outer edge and the hole
 * were derived from it half a stroke either way. A lone solid — a mass, with
 * no hole — inverts through the same inset, so one expression covers both.
 */
const outlinedFrame = (solid: string[], bar: number): string[] | null => {
  const at = asPair(solid[0]);
  const size = asSize(solid[1]);
  if (!at || !size) {
    return null;
  }
  const half = bar / 2;
  // Absent radius is `r2` (see {@link filledRect}); reading it as none made the
  // outlined twin of a default-radius solid replay a tier too round.
  const r = asRadius(solid[2]) ?? 2;
  const corner = ` r${num(Math.max(0, r - half))}`;
  return [
    `${RECT} ${num(at[0] + half)},${num(at[1] + half)} ${num(size[0] - bar)}x${num(size[1] - bar)}${corner}`,
  ];
};

const isHeader = (word: string): boolean =>
  word === "icon" || word === "keyline" || word === "cohort";

/** The filled ink of one stroked op, or null when this module does not model
 *  the op and the line should survive verbatim. */
const grow = (op: Op, bar: number, half: number): string[] | null => {
  if (op.word === CIRCLE) {
    return filledCircle(op.args, half);
  }
  if (op.word === RECT) {
    return filledRect(op.args, bar);
  }
  return null;
};

/** {@link grow} backwards: the centre line a solid, optionally paired with the
 *  hole it was knocked out with, was expanded from. */
const shrink = (
  op: Op,
  hole: string[] | null,
  bar: number,
  half: number
): string[] | null => {
  if (op.word === CIRCLE) {
    return outlinedRing(op.args, hole, half);
  }
  if (op.word === RECT) {
    return outlinedFrame(op.args, bar);
  }
  return null;
};

/**
 * The same drawing in the other paint, derived rather than relabelled.
 *
 * "Filled and outlined are one skeleton, two paints" is only true if something
 * actually re-paints it. Swapping the `finish` line and leaving the ops alone
 * does not: under `filled` a `circle` is a disc and a `rect` is a slab, so a
 * ring becomes a blob and a frame becomes a tile. Every icon in the reach set
 * that is not a host glyph went through that path, which is why their filled
 * cards were solid shapes with the interior detail swallowed.
 *
 * So the closed primitives are re-derived here — `circle` → {@link ring},
 * `rect` → {@link frame}, and back — and the open ones are left alone because
 * `canvas.ts` already paints them as the ink they occupied: a two-point `line`
 * expands to a bar, an `arc` to a capped stroke outline, a `diamond` to a lozenge
 * grown by half a stroke, a `dot` to its tier. A polyline is split into its
 * segments, because an open run encloses nothing and fill has no inside to
 * cover.
 *
 * What is deliberately *not* attempted: turning a hoop into a mass. A designer
 * filling a briefcase paints the body solid and knocks out the clasp, and that
 * is a composition decision the skeleton does not contain. This derivation
 * preserves the visual extent and every interior — the property that is
 * checkable — and `glyphs.ts` is where a chosen filled composition goes.
 */
const rejectDetailAdaptation = (ops: ReturnType<typeof parseOp>[]): void => {
  if (
    ops.some(
      (op) =>
        (op.word === "line" || op.word === "arc") && op.args.includes("detail")
    )
  ) {
    throw new Error("Detail weight requires an authored counterpart");
  }
};

export const adaptProgram = (
  source: string,
  finish: Finish,
  spec: Spec = SPEC
): string => {
  const { bar, half } = paint(spec);
  const ops = source.split("\n").map(parseOp);
  rejectDetailAdaptation(ops);
  const out: string[] = [];
  let sawFinish = false;
  let headerAt = 0;
  for (let i = 0; i < ops.length; i += 1) {
    const op = ops[i];
    if (
      finish === "outlined" &&
      op.word === "line" &&
      op.args.includes("solid")
    ) {
      throw new Error(
        "Explicit solid contour requires an authored outlined counterpart"
      );
    }
    if (isHeader(op.word)) {
      headerAt = out.length + 1;
    }
    if (op.word === "finish") {
      out.push(`finish ${finish}`);
      sawFinish = true;
      continue;
    }
    if (finish === "filled") {
      if (op.word === "line") {
        if (op.args.some((arg) => /^r/iu.test(arg))) {
          out.push(op.raw);
        } else {
          out.push(...splitPolyline(snappedLine(op.raw.trim(), spec)));
        }
        continue;
      }
      const grown = grow(op, bar, half);
      if (grown) {
        out.push(...grown);
        continue;
      }
      out.push(op.raw);
      continue;
    }
    // Filled → outlined. A knockout only means anything as the absence inside
    // the solid before it, so the pair collapses to one centre-line shape and
    // the hole is consumed rather than emitted as a second stroke.
    if (op.word === "hole") {
      continue;
    }
    const next = ops[i + 1];
    const paired =
      next?.word === "hole" && next.args[0]?.toLowerCase() === op.word
        ? next.args.slice(1)
        : null;
    out.push(...(shrink(op, paired, bar, half) ?? [op.raw]));
  }
  if (!sawFinish) {
    out.splice(headerAt, 0, `finish ${finish}`);
  }
  return out.join("\n");
};

const TURN_WORD: Record<number, string> = {
  1: "cw",
  2: "half",
  3: "ccw",
};

const lineOf = (op: Extract<DrawOp, { op: "line" }>): string => {
  const hole = op.knockout ? "hole " : "";
  const axis = op.offAxis ? " off-axis" : "";
  return `${hole}line ${pointsOf(op.points)}${op.r === undefined ? "" : ` r${fmt(op.r)}`}${axis}${op.solid ? " solid" : ""}${op.weight ? " detail" : ""}`;
};

const partOf = (op: Extract<DrawOp, { op: "part" }>): string => {
  const bits = [`part ${op.id}`, "at", `${fmt(op.x)},${fmt(op.y)}`];
  if (op.scale !== 1) {
    // The multiplier belongs to the replay contract rather than the display
    // grid. Preserve its full numeric value so one-third does not become a
    // different document after serialization.
    bits.push("scale", String(op.scale));
  }
  const turn = TURN_WORD[op.turn];
  if (turn) {
    bits.push("turn", turn);
  }
  if (op.flip) {
    bits.push("flip");
  }
  return bits.join(" ");
};

const opLine = (op: DrawOp): string | null => {
  if (op.op === "boolean") {
    return [
      ...op.left.map(opLine),
      ...op.right.map(opLine),
      `${op.operation}${op.radius === undefined ? "" : ` r${op.radius}`}`,
    ].join("\n");
  }
  if (op.op === "raw") {
    return null;
  }
  if (op.op === "circle") {
    const hole = op.knockout ? "hole " : "";
    return `${hole}circle ${fmt(op.cx)},${fmt(op.cy)} r${fmt(op.r)}`;
  }
  if (op.op === "rect") {
    const hole = op.knockout ? "hole " : "";
    const corner = ` r${fmt(op.r)}`;
    return `${hole}rect ${fmt(op.x)},${fmt(op.y)} ${fmt(op.w)}x${fmt(op.h)}${corner}`;
  }
  if (op.op === "line") {
    return lineOf(op);
  }
  if (op.op === "arc") {
    const ccw = op.ccw ? " ccw" : "";
    return `arc ${fmt(op.cx)},${fmt(op.cy)} r${fmt(op.r)} ${op.sweep} from ${op.from}${ccw}${op.weight ? " detail" : ""}`;
  }
  if (op.op === "dot") {
    return `dot ${fmt(op.cx)},${fmt(op.cy)} ${op.role}`;
  }
  if (op.op === "diamond") {
    return `diamond ${fmt(op.cx)},${fmt(op.cy)} r${fmt(op.reach)}`;
  }
  return partOf(op);
};

/**
 * The DSL a canvas already ran, so the other paint can be derived.
 *
 * The model never wrote these coordinates — the primitives did. Emitting
 * them back is how generate and harness pair a single paint: adapt the
 * program, then {@link twinPairIssues}. A `raw` escape has no DSL word
 * and is dropped; pairing then sees whatever else the canvas drew.
 */
export const programFromDoc = (
  doc: IconDoc,
  _parts: readonly Part[] = []
): string => {
  const lines = [`icon ${doc.icon ?? "icon"}`];
  if (doc.keyline) {
    lines.push(`keyline ${doc.keyline}`);
  }
  lines.push(`finish ${doc.finish ?? "outlined"}`);
  for (const op of doc.draw) {
    const line = opLine(op);
    if (line !== null) {
      lines.push(line);
    }
  }
  return `${lines.join("\n")}\n`;
};

/** One paint of a twin pair: lintable, and sized the way {@link sameExtent} is. */
export type TwinPaint = LintTarget & Sized;

const isHole = (e: { hole?: boolean; op?: string }): boolean =>
  e.hole === true || e.op === "knockout";

/**
 * A ring restamped as a disc.
 *
 * `sameExtent` cannot see this after `fit`: both paints scale onto the
 * same keyline, so a filled disc of a stroked ring occupies the box and
 * looks paired. House filled rings knock a hole immediately after the
 * circle. A bare outlined circle against a bare filled circle with no
 * knockout is that restamp — sun (disc + rays) and clock (disc + hands)
 * have other marks and stay quiet. A cloud of overlapping discs is not
 * a ring: only one hoop against one disc is the restamp.
 */
const restampIssues = (outlined: TwinPaint, filled: TwinPaint): Issue[] => {
  const hoops = outlined.elements.filter(
    (e) => e.kind === "circle" && !isHole(e)
  );
  const disc = filled.elements.filter((e) => e.kind === "circle" && !isHole(e));
  const holes = filled.elements.filter((e) => isHole(e));
  const outlinedElse = outlined.elements.filter(
    (e) => !(e.kind === "circle" && !isHole(e))
  );
  const filledElse = filled.elements.filter(
    (e) => !(e.kind === "circle" && !isHole(e)) && !isHole(e)
  );
  if (
    hoops.length !== 1 ||
    disc.length !== 1 ||
    holes.length > 0 ||
    outlinedElse.length > 0 ||
    filledElse.length > 0
  ) {
    return [];
  }
  return [
    {
      message:
        "Filled restamped a ring as a disc. Knock a hole immediately after the circle — `fit` to the same keyline does not hide a missing knockout.",
      rule: "paint",
      severity: "error",
    },
  ];
};

/**
 * Whether two paints are one skeleton.
 *
 * `sameExtent` catches a flood-fill or a restamped finish (a filled disc
 * of a stroked ring shrinks by a stroke). After `fit` that shrink
 * disappears, so {@link restampIssues} reads the construction. Forcing
 * each paint through the rule that belongs to it catches a finish
 * mix-up: `gap` on a filled drawing, `feature` on an outlined one.
 * Empty tiles fail here rather than looking like a quiet pair.
 */
export const twinPairIssues = (
  outlined: TwinPaint,
  filled: TwinPaint,
  // Carried from {@link sameExtent}, not restated. A second literal here is
  // how the pair path kept erroring at 0.01 while the primitive said 0.5.
  tol = EXTENT_TOL
): Issue[] => {
  const issues: Issue[] = [];
  if (outlined.elements.length === 0 || filled.elements.length === 0) {
    issues.push({
      message: "A twin pair needs both paints; an empty tile is a failed twin.",
      rule: "empty",
      severity: "error",
    });
    return issues;
  }
  issues.push(...restampIssues(outlined, filled));
  const left = visualSize(outlined);
  const right = visualSize(filled);
  if (!sameExtent(outlined, filled, tol)) {
    const outlinedBox = left
      ? `${left.w.toFixed(1)}×${left.h.toFixed(1)}`
      : "none";
    const filledBox = right
      ? `${right.w.toFixed(1)}×${right.h.toFixed(1)}`
      : "none";
    issues.push({
      message: `Filled visual extent ${filledBox} does not match outlined ${outlinedBox}. Expand the stroke — do not flood the bbox or restamp finish.`,
      rule: "extent",
      severity: "error",
    });
  }
  if (outlined.finish === "filled") {
    issues.push({
      message: "Outlined paint is stamped `filled`. The pair swapped finishes.",
      rule: "finish",
      severity: "error",
    });
  }
  if (filled.finish !== undefined && filled.finish !== "filled") {
    issues.push({
      message: `Filled paint is stamped \`${filled.finish}\`. A twin is two paints, not one program with the wrong label.`,
      rule: "finish",
      severity: "error",
    });
  }
  const outlinedLint = lint({
    elements: outlined.elements,
    finish: "outlined",
    spec: outlined.spec,
  });
  const filledLint = lint({
    elements: filled.elements,
    finish: "filled",
    spec: filled.spec,
  });
  // `feature` is fill-only: a hole too thin to survive at 16px.
  issues.push(...filledLint.filter((issue) => issue.rule === "feature"));
  // Filled shapes are meant to touch or to knock out. Linting the filled
  // solids as outlined is how a second fill sitting 0.5px off another
  // (a hole drawn as ink) shows up as `gap`.
  const asOutlined = lint({
    elements: filled.elements,
    finish: "outlined",
    spec: filled.spec,
  });
  for (const issue of asOutlined.filter((row) => row.rule === "gap")) {
    issues.push({
      ...issue,
      message: `${issue.message} Filled solids that sit that close should coincide or be a hole, not a second fill.`,
    });
  }
  for (const issue of [...outlinedLint, ...filledLint]) {
    if (issue.severity === "error") {
      issues.push(issue);
    }
  }
  return issues;
};
