/**
 * The drawing surface the model works on.
 *
 * The invariant this file exists to enforce: **the model never emits a
 * coordinate that isn't already spec-conformant.** Every primitive quantises to
 * the sub-grid, snaps angles to 0/45/90, and takes its corner radius from the
 * tier system. The model chooses what and where; this chooses how.
 *
 * That is what stops style drift. A model emitting free path data writes drift
 * into the set at the rate it writes icons; a model calling `rect()` cannot.
 */
import {
  bbox,
  mirrorX,
  parsePath,
  q,
  rotateQuarter,
  scale,
  serialise,
  translate,
} from "../geometry/path.js";
import { roundedLinePath } from "../geometry/rounded-line.js";
import { flatten } from "../parts/shape.js";
import type {
  BooleanDrawOp,
  Box,
  DotRole,
  DrawOp,
  Finish,
  IconDoc,
  Keyline,
  Part,
  Subpath,
} from "../types.js";
import { combinePaths } from "./boolean.js";
import type { BooleanOperand, BooleanOperation } from "./boolean.js";
import { SPEC, needsStrokeBounds } from "./spec.js";
import type { Spec } from "./spec.js";
import { expandStroke } from "./stroke.js";

export { SPEC, specAt } from "./spec.js";
export type { OpticalSize, Spec } from "./spec.js";

/** Circular arc → cubic control handle ratio. */
const K = 0.5523;

/**
 * Where an open arc starts. The four poles of the circle, so both endpoints
 * stay on the grid: a free start angle would put the node off 0.25, which is
 * the one thing `circle` never does.
 */
export const ARC_FROM = ["bottom", "left", "right", "top"] as const;
export type ArcFrom = (typeof ARC_FROM)[number];

/** How far the arc travels, in named quarters. A full turn is `circle`. */
export const ARC_SWEEP = ["half", "quarter", "three-quarter"] as const;
export type ArcSweep = (typeof ARC_SWEEP)[number];

const FROM_ANGLE: Record<ArcFrom, number> = {
  bottom: Math.PI / 2,
  left: Math.PI,
  right: 0,
  top: -Math.PI / 2,
};

const SWEEP_STEPS: Record<ArcSweep, number> = {
  half: 2,
  quarter: 1,
  "three-quarter": 3,
};

/**
 * Degrees of slop forgiven before a segment counts as off-axis.
 *
 * Exported because a lint rule that measures the same property after the fact
 * must measure it at the same threshold — see `angle.ts`. A rule that forbids
 * what the canvas draws, or permits what it refuses, is worse than no rule.
 */
export const ANGLE_TOLERANCE = 6;

/**
 * The permitted axes, undirected, in [0,180): a line is the same line either
 * way round. `angle.ts` measures shipped icons against this same list.
 */
export const AXES = [0, 45, 90, 135] as const;

/** The same axes as directed headings, for comparing against an `atan2`
 *  result in [-180,180]. Both ends of 0 and 180 are present so a heading near
 *  either bound finds its axis without wrapping. */
const HEADINGS = [...AXES, ...AXES.map((a) => a - 180), 180];

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));
const onCanvas = (v: number, spec: Spec) =>
  q(clamp(v, 0, spec.canvas), spec.grid);
const nearest = (targets: readonly number[], v: number): number => {
  if (!targets.length) {
    throw new Error("This style has no positive radius tiers; use r0");
  }
  let [best] = targets;
  for (const t of targets) {
    if (Math.abs(t - v) < Math.abs(best - v)) {
      best = t;
    }
  }
  return best;
};

/** Quarter-turns in a full turn. */
const TURN_COUNT = 4;

/**
 * The only orientations a part can be placed at. Named quarter-turns, not an
 * angle: `turn 37` is off-spec geometry entering through a new door, and the
 * whole point of this file is that such geometry is unrepresentable.
 */
const quarterTurn = (t: number): number => {
  if (!Number.isInteger(t) || t < 0 || t >= TURN_COUNT) {
    throw new Error(
      `turn must be a whole quarter-turn 0-3 (0°, 90°, 180°, 270° clockwise) — got ${t}`
    );
  }
  return t;
};

/** Corner radii come from the tier system, never from the caller verbatim. The
 *  tiers do not vary with shape size: a flat set matches the corpus better than
 *  any size-conditioned split measured against it. Callers still clamp the
 *  result to half the shape, which is geometry rather than style.
 *
 *  Which tier set is asked for depends on the finish, not on the shape: a
 *  filled corner is a boundary and a stroked one is a centre line, so they are
 *  measurably different distributions. See `SPEC.fillRadiusTiers`. */
const tierRadius = (r: number, finish: Finish, spec: Spec): number =>
  r === 0
    ? 0
    : nearest(finish === "filled" ? spec.fillRadiusTiers : spec.radiusTiers, r);

/**
 * Snap a segment onto the nearest permitted axis when it is within tolerance.
 *
 * Returns the resulting endpoint and how far the *requested* segment sat from
 * its axis, so the caller can tell a slip that was corrected from an angle that
 * was meant. The distance is measured here, on the pre-quantisation angle,
 * rather than recomputed from the emitted points: `line` puts every node on the
 * 0.25 grid afterwards, and on a short segment that rounding can move the angle
 * by more than the tolerance it was just judged against. What is being judged
 * is the caller's intent, not this file's own rounding.
 */
const snapAngle = (
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  toleranceDeg = ANGLE_TOLERANCE
): { offBy: number; point: [number, number] } => {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  if (len === 0) {
    return { offBy: 0, point: [x1, y1] };
  }
  const ang = (Math.atan2(dy, dx) * 180) / Math.PI;
  const near = nearest(HEADINGS, ang);
  const offBy = Math.abs(near - ang);
  if (offBy > toleranceDeg) {
    return { offBy, point: [x1, y1] };
  }
  const rad = (near * Math.PI) / 180;
  return {
    offBy: 0,
    point: [x0 + len * Math.cos(rad), y0 + len * Math.sin(rad)],
  };
};

/** Undirected heading of a segment, in [0,180). */
const heading = (
  [x0, y0]: [number, number],
  [x1, y1]: [number, number]
): number => {
  const deg = (Math.atan2(y1 - y0, x1 - x0) * 180) / Math.PI;
  return ((deg % 180) + 180) % 180;
};

/** Why a segment was refused, and both ways out of it. The angle and the axis
 *  are in the text because "off-axis" alone does not say whether the caller was
 *  half a degree out or forty. */
/** Circular distance between two undirected headings in [0,180). */
const axisGap = (a: number, b: number): number => {
  const d = Math.abs(a - b) % 180;
  return Math.min(d, 180 - d);
};

const offAxisMessage = (
  i: number,
  from: [number, number],
  to: [number, number],
  offBy: number
): string => {
  const ang = heading(from, to);
  // Circular, not linear: `nearest(AXES, ang)` measures `|axis - ang|`, so a
  // near-horizontal 170° reads as 35° from 135° instead of 10° from 0°/180° —
  // naming an axis the printed `offBy` (computed circularly by `snapAngle`)
  // contradicts. Pick the axis the same way the tolerance check did.
  const [firstAxis] = AXES;
  let axis: number = firstAxis;
  for (const candidate of AXES) {
    if (axisGap(candidate, ang) < axisGap(axis, ang)) {
      axis = candidate;
    }
  }
  return (
    `line segment ${i} (${from[0]},${from[1]} → ${to[0]},${to[1]}) runs at ${ang.toFixed(2)}°, ` +
    `${offBy.toFixed(2)}° off the nearest axis (${axis}°). ` +
    "Off-axis edges are legitimate — 29.3% of stroked icons in the set have one, on rational " +
    "slopes between two grid points — but they are asked for, not arrived at: pass " +
    "`offAxis: true` (`off-axis` in the DSL) if that is the shape, or move an endpoint onto the axis."
  );
};

/**
 * What an element does to the ink: adds to it, or takes it away.
 *
 * Carried as an intersection rather than as a member of every variant of the
 * union because it is orthogonal to `kind` — a knockout is a rect, a circle,
 * or a line-bar that happens to be subtracted, not a seventh kind of shape —
 * and because `hole()` is the only thing that ever writes it. Absent means
 * `add`, so an element written before this existed still means what it meant.
 */
export type Op = "add" | "knockout";

export type Element = {
  /** Derived from a solid modifier recipe; zero means this element is already ink. */
  strokeWidth?: number;
  fillRule?: "nonzero";
  op?: Op;
} & (
  | {
      /** Present when the arc runs counter-clockwise. Absent, not `false`,
       *  when it follows `circle` (top → right → bottom → left). */
      ccw?: true;
      cx: number;
      cy: number;
      d: string;
      from: ArcFrom;
      id: string;
      kind: "arc";
      weight?: "detail";
      r: number;
      sweep: ArcSweep;
    }
  | { cx: number; cy: number; d: string; id: string; kind: "circle"; r: number }
  | {
      cx: number;
      cy: number;
      d: string;
      id: string;
      kind: "diamond";
      /** Centre to vertex as asked for, before the filled paint's half-stroke
       *  padding. One number describes both paints. */
      reach: number;
    }
  | {
      cx: number;
      cy: number;
      d: string;
      id: string;
      kind: "dot";
      role: DotRole;
    }
  | {
      d: string;
      id: string;
      kind: "line";
      solid?: true;
      weight?: "detail";
      r?: number;
      /** Set only when a segment actually ended up off every axis, so the
       *  document records the geometry rather than the permission. */
      offAxis?: boolean;
      points: [number, number][];
    }
  | {
      d: string;
      /** Set only when the part was actually reflected, so the document records
       *  the geometry rather than how it was requested. */
      flip?: true;
      id: string;
      kind: "part";
      partId: string;
      scale: number;
      turn: number;
      x: number;
      y: number;
    }
  | { d: string; id: string; kind: "raw"; composition?: BooleanDrawOp }
  | {
      d: string;
      h: number;
      id: string;
      kind: "rect";
      r: number;
      w: number;
      x: number;
      y: number;
    }
);

const rectPath = (
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): string => {
  if (!r) {
    return `M${x} ${y}L${x + w} ${y}L${x + w} ${y + h}L${x} ${y + h}Z`;
  }
  const c = r * K;
  return (
    `M${x + r} ${y}L${x + w - r} ${y}C${x + w - r + c} ${y} ${x + w} ${y + r - c} ${x + w} ${y + r}` +
    `L${x + w} ${y + h - r}C${x + w} ${y + h - r + c} ${x + w - r + c} ${y + h} ${x + w - r} ${y + h}` +
    `L${x + r} ${y + h}C${x + r - c} ${y + h} ${x} ${y + h - r + c} ${x} ${y + h - r}` +
    `L${x} ${y + r}C${x} ${y + r - c} ${x + r - c} ${y} ${x + r} ${y}Z`
  );
};

const circlePath = (x: number, y: number, r: number): string => {
  const c = r * K;
  return (
    `M${x} ${y - r}C${x + c} ${y - r} ${x + r} ${y - c} ${x + r} ${y}` +
    `C${x + r} ${y + c} ${x + c} ${y + r} ${x} ${y + r}` +
    `C${x - c} ${y + r} ${x - r} ${y + c} ${x - r} ${y}` +
    `C${x - r} ${y - c} ${x - c} ${y - r} ${x} ${y - r}Z`
  );
};

const atCircle = (
  cx: number,
  cy: number,
  r: number,
  a: number
): [number, number] => [cx + r * Math.cos(a), cy + r * Math.sin(a)];

/**
 * Open circular arc as cubics, the same K `circlePath` uses.
 *
 * Clockwise matches `circle` (top → right → bottom → left). `ccw` is the
 * other semicircle from the same start, so a wifi fan and a U-shape are
 * both `half from left`, one of them flipped. Quarters only: a free sweep
 * is an angle, and an angle is a coordinate.
 */
export const arcPath = (
  cx: number,
  cy: number,
  r: number,
  from: ArcFrom,
  sweep: ArcSweep,
  ccw = false
): string => {
  const steps = SWEEP_STEPS[sweep];
  const dir = ccw ? -1 : 1;
  const h = r * K;
  let a = FROM_ANGLE[from];
  const [x0, y0] = atCircle(cx, cy, r, a);
  let d = `M${x0} ${y0}`;
  for (let i = 0; i < steps; i += 1) {
    const a0 = a;
    a += dir * (Math.PI / 2);
    const [sx, sy] = atCircle(cx, cy, r, a0);
    const [x1, y1] = atCircle(cx, cy, r, a);
    const t0x = dir * -Math.sin(a0) * h;
    const t0y = dir * Math.cos(a0) * h;
    const t1x = dir * -Math.sin(a) * h;
    const t1y = dir * Math.cos(a) * h;
    d += `C${sx + t0x} ${sy + t0y} ${x1 - t1x} ${y1 - t1y} ${x1} ${y1}`;
  }
  return d;
};

/** The quantised circle, before it is decided whether it adds ink or removes
 *  it. Shared, like `#rectElement`, so a knockout cannot reach the document by
 *  any route a solid did not already take. A free function rather than a
 *  method because — unlike a rect, whose corners are tiered per finish —
 *  nothing about a circle depends on the canvas. */
const circleElement = (
  id: string,
  { cx, cy, r }: { cx: number; cy: number; r: number },
  spec: Spec
): Element => {
  const x = onCanvas(cx, spec);
  const y = onCanvas(cy, spec);
  const rr = q(r, spec.grid);
  return { cx: x, cy: y, d: circlePath(x, y, rr), id, kind: "circle", r: rr };
};

export interface CanvasOptions {
  /**
   * Stroked (the default, and what every existing document is) or filled.
   *
   * Chosen once for the whole document. Not a per-element property and not two
   * `Canvas` classes, and both were live options. Measured, in
   * `bench/filled-language.v1.json`: 2,078 of 2,085 filled icons carry no
   * stroke anywhere, and the 7 that mix one in are the set being inconsistent
   * rather than a construction to copy. So the finish is a fact about the
   * icon; making it per-element would offer a mixture nobody draws while
   * forcing every rule downstream to ask each element what it is. Two classes
   * were rejected from the other side: `transform`, `bbox`, `remove`,
   * `describe` and the whole document format are identical between the
   * finishes, and `Canvas` is the type in the signature of every tool, every
   * lint call and the DSL, so a second class would fork all of them in order
   * to vary three methods.
   *
   * Fixed at construction rather than settable, because a primitive already
   * drawn means a different thing under the other finish — a `dot` is a circle
   * one stroke narrower than its tier when it will be stroked and exactly its
   * tier when it will be filled, and a corner takes its radius from a
   * different tier set. A canvas that could change finish mid-drawing would
   * silently restate what it had already drawn.
   */
  finish?: Finish;
  /** Stroke, family radius, and optical size. Defaults to the house 24/2/3 cut. */
  spec?: Spec;
}

/** The shapes a knockout may take. Rect and circle are what the corpus cuts
 *  with (23.8% / 22.3% of 1,807 holes). Line is the same two-point bar
 *  `#filledBar` already draws as a solid — a tick cut out of a badge is that
 *  stroke subtracted, not a free path. Every knockout still goes through the
 *  solid builder, so there is no second path by which a coordinate could
 *  reach the document. */
export type HoleShape =
  | { cx: number; cy: number; r: number; shape: "circle" }
  | {
      offAxis?: boolean;
      points: [number, number][];
      shape: "line";
    }
  | { h: number; r?: number; shape: "rect"; w: number; x: number; y: number };

const strokeStyle = (spec: Spec) => ({
  cap: spec.strokeCap ?? "round",
  join: spec.strokeJoin ?? "round",
});

const sharpLinePath = (points: [number, number][]): string => {
  const closed =
    points.length > 2 &&
    points[0][0] === points.at(-1)?.[0] &&
    points[0][1] === points.at(-1)?.[1];
  for (let i = 1; i < points.length; i += 1) {
    if (
      points[i][0] === points[i - 1][0] &&
      points[i][1] === points[i - 1][1]
    ) {
      throw new Error("Sharp line contains a zero-length segment");
    }
  }
  const vertices = closed ? points.slice(0, -1) : points;
  return (
    vertices.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x} ${y}`).join("") +
    (closed ? "Z" : "")
  );
};

const validateSolidLine = (
  solid: boolean,
  r: number | undefined,
  out: [number, number][]
): void => {
  if (
    solid &&
    (r === undefined ||
      out[0][0] !== out.at(-1)?.[0] ||
      out[0][1] !== out.at(-1)?.[1])
  ) {
    throw new Error(
      "Solid line requires an explicitly closed contour and radius"
    );
  }
};

const validateLineKnockout = (op: Extract<DrawOp, { op: "line" }>): void => {
  if (op.knockout && (op.r !== undefined || op.solid || op.weight)) {
    throw new Error(
      "Rounded, solid or detail line knockouts require explicit subtraction"
    );
  }
};

interface LineArgs {
  weight?: "detail";
  solid?: boolean;
  offAxis?: boolean;
  r?: number;
  points: [number, number][];
}

export class Canvas {
  elements: Element[] = [];
  log: string[] = [];
  readonly parts: Map<string, Part>;

  /** Stroked or filled. See {@link Finish}: chosen once, for the document. */
  readonly finish: Finish;
  /** The cut this canvas draws under. Stroke, radius family, optical size. */
  readonly spec: Spec;

  /**
   * Ids are minted from a counter, never from `elements.length`.
   *
   * `remove` splices, so a length-derived id is reissued the moment anything
   * but the last element is deleted: draw three, remove the middle, draw one
   * more, and the new element is called `e2` alongside the surviving `e2`.
   * `describe` then reports two elements under one handle, and both `placed`
   * and `remove` resolve it to the older one — so the model reads the wrong
   * bounds back and deletes the wrong shape, without either side erroring.
   */
  #seq = 0;

  /**
   * Bumped by every mutation. The loop uses it as the cheap answer to "is what
   * I rendered still what is on the canvas": a `render` or `lint` result is
   * only about the drawing if it was taken at the current version.
   */
  #version = 0;

  constructor(
    parts: Part[] = [],
    { finish = "outlined", spec = SPEC }: CanvasOptions = {}
  ) {
    this.parts = new Map(parts.map((p) => [p.id, p]));
    this.finish = finish;
    this.spec = spec;
  }

  /** Mutation count. Monotonic, and meaningless as an absolute number: only
   *  whether it has changed since a reading was taken means anything. */
  get version(): number {
    return this.#version;
  }

  /**
   * How wide the ink sits either side of the path: the house stroke, or zero
   * when the finish is filled and the path *is* the boundary.
   *
   * The one number that turns "visual extent = path bbox + stroke" into a
   * statement true of both finishes, which is why `fit`, `part ... fill` and
   * `lint` all read it rather than `SPEC.stroke`. The distinction is the one
   * `CLAUDE.md` names as this domain's most common mistake, and the
   * measurement confirms it is the only adjustment needed: filled and outlined
   * twins occupy the same *visual* extent in 94% of 2,085 pairs, so with this
   * substitution every keyline, clearance and centring rule carries over
   * unchanged.
   */
  get inkWidth(): number {
    return this.finish === "filled" ? 0 : this.spec.stroke;
  }

  /** @param at index to insert at; appends when omitted. Only `hole` passes
   *  it, to sit a knockout with the solid it cuts. */
  #push(make: (id: string) => Element, at?: number): string {
    const id = `e${this.#seq}`;
    this.#seq += 1;
    const el = make(id);
    if (at === undefined) {
      this.elements.push(el);
    } else {
      this.elements.splice(at, 0, el);
    }
    this.#version += 1;
    this.log.push(`${el.op === "knockout" ? "hole " : ""}${el.kind} → ${id}`);
    return id;
  }

  /** The quantised rect, before it is decided whether it adds ink or removes
   *  it. Shared so a knockout cannot reach the document by any route a solid
   *  did not already take. */
  #rectElement(
    id: string,
    {
      x,
      y,
      w,
      h,
      r = 2,
    }: { h: number; r?: number; w: number; x: number; y: number }
  ): Element {
    const X = onCanvas(x, this.spec);
    const Y = onCanvas(y, this.spec);
    const W = q(w, this.spec.grid);
    const H = q(h, this.spec.grid);
    const R = Math.min(tierRadius(r, this.finish, this.spec), W / 2, H / 2);
    return {
      d: rectPath(X, Y, W, H, R),
      h: H,
      id,
      kind: "rect",
      r: R,
      w: W,
      x: X,
      y: Y,
    };
  }

  /** Rounded rectangle. Radius is snapped to the tier system. */
  rect(args: {
    h: number;
    r?: number;
    w: number;
    x: number;
    y: number;
  }): string {
    return this.#push((id) => this.#rectElement(id, args));
  }

  circle(args: { cx: number; cy: number; r: number }): string {
    return this.#push((id) => circleElement(id, args, this.spec));
  }

  /**
   * Open circular arc. The model names a pole, a named sweep, and optionally
   * `ccw`; the cubics are the same ones `circle` already draws. A polyline
   * of grid points is a different primitive, and approximating a curve with
   * one is how an umbrella canopy becomes a zigzag.
   *
   * Filled, this is that stroke expanded with the selected caps — the same
   * twin `#filledBar` is for a two-point `line`. An open arc still encloses
   * no area; the fill is the ink, not a pie of the sweep.
   */
  arc(args: {
    ccw?: boolean;
    cx: number;
    cy: number;
    from: ArcFrom;
    r: number;
    sweep: ArcSweep;
    weight?: "detail";
  }): string {
    const width = this.#strokeWidth(args.weight);
    const cx = onCanvas(args.cx, this.spec);
    const cy = onCanvas(args.cy, this.spec);
    const r = q(args.r, this.spec.grid);
    const ccw = Boolean(args.ccw);
    const centerline = arcPath(cx, cy, r, args.from, args.sweep, ccw);
    let d = centerline;
    if (this.finish === "filled") {
      d = expandStroke(centerline, width, strokeStyle(this.spec));
    }
    return this.#push((id) => ({
      ...(ccw ? { ccw: true as const } : {}),
      cx,
      cy,
      d,
      from: args.from,
      id,
      kind: "arc" as const,
      ...(this.finish === "filled" ? { fillRule: "nonzero" as const } : {}),
      r,
      sweep: args.sweep,
      ...(args.weight ? { weight: args.weight } : {}),
      ...(args.weight && this.finish === "outlined"
        ? { strokeWidth: width }
        : {}),
    }));
  }

  /** Combine two complete solid groups. Operands stay editable in the recipe;
   * only host-computed path data is cached on the rendered element. */
  combine(
    operation: BooleanOperation,
    leftId?: string,
    rightId?: string,
    radius?: number
  ): string {
    this.#checkCompositionFinish(operation);
    const groups = this.#groups();
    const left = leftId
      ? groups.find((g) => g[0].id === leftId)
      : groups.at(-2);
    const right = rightId
      ? groups.find((g) => g[0].id === rightId)
      : groups.at(-1);
    if (!left || !right || left === right) {
      throw new Error("Boolean operation needs two different solid groups");
    }
    if (operation === "trim" && left.some((e) => e.strokeWidth === 0)) {
      throw new Error(
        "Trim requires an outlined centerline, not a solid modifier"
      );
    }
    const recipe = (elements: Element[]): DrawOp[] => {
      const c = new Canvas([...this.parts.values()], {
        finish: "filled",
        spec: this.spec,
      });
      c.elements.push(...elements);
      return c.toJSON().draw;
    };
    const op: BooleanDrawOp = {
      left: recipe(left),
      op: "boolean",
      operation,
      ...(radius === undefined ? {} : { radius }),
      right: recipe(right),
    };
    // Compute before changing this canvas; errors leave both operands intact.
    const data = this.#compositionData(op);
    const used = new Set([...left, ...right]);
    this.elements.splice(
      0,
      this.elements.length,
      ...this.elements.filter((e) => !used.has(e))
    );
    return this.#push((id) => ({
      composition: op,
      ...data,
      fillRule: "nonzero",
      id,
      kind: "raw",
    }));
  }

  #checkCompositionFinish(operation: BooleanOperation): void {
    if (
      operation === "trim"
        ? this.finish !== "outlined"
        : this.finish !== "filled"
    ) {
      throw new Error(
        operation === "trim"
          ? "Trim requires outlined paths"
          : "Boolean recipes require filled shapes"
      );
    }
  }

  #compositionData(op: BooleanDrawOp): { d: string; strokeWidth?: number } {
    this.#checkCompositionFinish(op.operation);
    if (
      op.radius !== undefined &&
      (op.operation === "trim" ||
        !this.spec.fillRadiusTiers.includes(op.radius))
    ) {
      throw new Error(
        "Intersection radius must be an explicit filled family tier"
      );
    }
    const operand = (draw: DrawOp[], finish: Finish) => {
      if (draw.some((item) => item.op === "raw")) {
        throw new Error("Raw paths cannot enter a Boolean recipe");
      }
      const c = Canvas.fromJSON(
        { draw, finish, icon: null, keyline: null },
        [...this.parts.values()],
        this.spec
      );
      const groups = c.#groups();
      if (groups.length !== 1) {
        throw new Error("A Boolean operand must be one solid group");
      }
      return {
        ...Canvas.#filledGroup(groups[0]),
        strokeWidth: groups[0][0].strokeWidth,
      };
    };
    const left = operand(op.left, this.finish);
    if (op.operation === "trim" && left.strokeWidth === 0) {
      throw new Error(
        "Trim requires an outlined centerline, not a solid modifier"
      );
    }
    return {
      d: combinePaths(op.operation, left, operand(op.right, "filled"), {
        radius: op.radius,
      }),
      ...(op.operation === "trim" && left.strokeWidth !== undefined
        ? { strokeWidth: left.strokeWidth }
        : {}),
    };
  }

  /**
   * Cut a shape out of a solid: the subtract op the primitives were missing.
   *
   * The largest gap the measurement found. 932 of 2,085 filled icons — 44.7% —
   * knock a hole out of a solid, 1,807 holes in all, and no combination of
   * `rect`, `circle`, `line`, `dot` and `part` could express one, because
   * every primitive added ink and nothing could take it away. Without this the
   * drawer reaches at most half the filled set however well it draws.
   *
   * It is as constrained as the shapes it borrows. `hole` does not build
   * geometry: it calls the same `rect` and `circle` builders a solid does, so
   * a knockout is quantised to the same grid, tiered against the same radius
   * set and clamped to the same canvas. There is no coordinate here that could
   * not have been written as a solid, which is what keeps the invariant true
   * in fill mode: the model still says *what* and *where*, never *how*.
   *
   * The hole is stored immediately after the solid it cuts, and that ordering
   * is the whole data structure — there is no back-reference to keep in step
   * through a `transform`, a `remove` or a round trip through `toJSON`.
   * Serialization subtracts the union of its cutters from each solid. Cutter
   * overlap never restores ink; portions outside the solid never add ink.
   *
   * @param shape which primitive to cut with, and where.
   * @param cutFrom id of the solid to cut. Defaults to the most recent one,
   *   which is the order a drawing is actually made in; naming it is for a
   *   drawer that comes back to an earlier shape.
   */
  hole(shape: HoleShape & { cutFrom?: string }): string {
    if (this.finish !== "filled") {
      throw new Error(
        "hole only means something in a filled icon: there is no solid to cut " +
          'out of a stroked one. Set the finish to "filled" (`finish filled` ' +
          "in the DSL) before drawing, or draw the gap with two shapes instead."
      );
    }
    const target = this.#solidFor(shape.cutFrom);
    if (shape.shape === "line") {
      return this.#holeLine(target, shape);
    }
    const make = (id: string): Element => ({
      ...(shape.shape === "circle"
        ? circleElement(id, shape, this.spec)
        : this.#rectElement(id, shape)),
      op: "knockout",
    });
    // Built once to measure it, then handed to `#push` as-is: `#push` mints the
    // id, and a probe that minted its own would burn one on every call.
    const probe = make("probe");
    return this.#push((id) => ({ ...probe, id }), this.#groupEnd(target));
  }

  /**
   * Cut the filled bar of each segment. Axis-aligned bars are `hole rect`
   * (the same builder `#filledBar` uses as ink). A diagonal is that stadium
   * subtracted, stored as a `line` so `fit` re-emits it as a hole.
   */
  #holeLine(
    target: number,
    {
      offAxis = false,
      points: pts,
    }: { offAxis?: boolean; points: [number, number][] }
  ): string {
    if (!Array.isArray(pts) || pts.length < 2) {
      throw new Error("hole line needs >= 2 points");
    }
    const out: [number, number][] = [
      [onCanvas(pts[0][0], this.spec), onCanvas(pts[0][1], this.spec)],
    ];
    let free = false;
    for (let i = 1; i < pts.length; i += 1) {
      const [px, py] = out[i - 1];
      const {
        offBy,
        point: [sx, sy],
      } = snapAngle(
        px,
        py,
        onCanvas(pts[i][0], this.spec),
        onCanvas(pts[i][1], this.spec)
      );
      if (offBy > 0) {
        if (!offAxis) {
          throw new Error(offAxisMessage(i, [px, py], [sx, sy], offBy));
        }
        free = true;
      }
      out.push([q(sx, this.spec.grid), q(sy, this.spec.grid)]);
    }
    let last = "";
    for (let i = 1; i < out.length; i += 1) {
      last = this.#holeBar(target, out[i - 1], out[i], free);
    }
    return last;
  }

  /** A round-capped bar with the same measured extent as an outlined line.
   *
   * The cap circles deliberately overlap the rectangular body. A filled bar's
   * caller renders this path with `nonzero`, unioning those subpaths instead of
   * letting `evenodd` cancel their joins into white dots.
   */
  #barPath(a: [number, number], b: [number, number]): string {
    if (this.spec.strokeCap === "square") {
      return expandStroke(sharpLinePath([a, b]), this.spec.stroke, {
        cap: "square",
        join: this.spec.strokeJoin ?? "round",
      });
    }
    const half = this.spec.stroke / 2;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    if (
      Math.abs(dx) < this.spec.grid / 2 ||
      Math.abs(dy) < this.spec.grid / 2
    ) {
      return rectPath(
        Math.min(a[0], b[0]) - half,
        Math.min(a[1], b[1]) - half,
        Math.abs(dx) + this.spec.stroke,
        Math.abs(dy) + this.spec.stroke,
        half
      );
    }
    const len = Math.hypot(dx, dy) || 1;
    const px = (-dy / len) * half;
    const py = (dx / len) * half;
    // Endpoints already obey the placement grid. Normal offsets describe the
    // stroke envelope, not new model vertices: snapping them changes weight.
    const body =
      `M${a[0] + px} ${a[1] + py}L${a[0] - px} ${a[1] - py}` +
      `L${b[0] - px} ${b[1] - py}L${b[0] + px} ${b[1] + py}Z`;
    return circlePath(a[0], a[1], half) + circlePath(b[0], b[1], half) + body;
  }

  #holeBar(
    target: number,
    a: [number, number],
    b: [number, number],
    offAxis: boolean
  ): string {
    const make = (id: string): Element => ({
      d: this.#barPath(a, b),
      fillRule: "nonzero",
      id,
      kind: "line",
      op: "knockout",
      points: [a, b],
      ...(offAxis ? { offAxis: true as const } : {}),
    });
    const probe = make("probe");
    return this.#push((id) => ({ ...probe, id }), this.#groupEnd(target));
  }

  /** Index of the solid a hole is to be cut from, by id or by recency. */
  #solidFor(id?: string): number {
    if (id === undefined) {
      const last = this.elements.findLastIndex((e) => e.op !== "knockout");
      if (last === -1) {
        throw new Error(
          "there is nothing to cut a hole in yet — draw the solid first, then " +
            "knock the hole out of it"
        );
      }
      return last;
    }
    const i = this.elements.findIndex((e) => e.id === id);
    if (i === -1) {
      throw new Error(`no element ${id}`);
    }
    if (this.elements[i].op === "knockout") {
      throw new Error(
        `${id} is itself a hole, and a hole in a hole is just solid again — ` +
          "cut both out of the shape they sit in instead"
      );
    }
    return i;
  }

  /** One past the last element belonging to the solid at `i`: itself, plus the
   *  run of knockouts already cut from it. */
  #groupEnd(i: number): number {
    let end = i + 1;
    while (end < this.elements.length && this.elements[end].op === "knockout") {
      end += 1;
    }
    return end;
  }

  /** A cut only removes ink. Union cutters with their own fill rules before
   * subtracting; parity would restore ink wherever two cutters overlap.
   * Shared by final SVG and nested Boolean operands. Recipes stay editable. */
  static #filledGroup(group: Element[]): BooleanOperand {
    const [solid, ...holes] = group;
    const base = {
      d: solid.d,
      fillRule: solid.fillRule ?? ("evenodd" as const),
    };
    if (holes.length === 0) {
      return base;
    }
    let cutter: BooleanOperand = holes[0];
    for (const hole of holes.slice(1)) {
      cutter = {
        d: combinePaths("union", cutter, hole),
        fillRule: "nonzero",
      };
    }
    return {
      d: combinePaths("subtract", base, cutter, { allowEmpty: true }),
      fillRule: "nonzero",
    };
  }

  /** The elements as they serialise: each solid followed by its holes. */
  #groups(): Element[][] {
    const out: Element[][] = [];
    for (const e of this.elements) {
      if (e.op === "knockout" && out.length > 0) {
        out.at(-1)?.push(e);
      } else {
        out.push([e]);
      }
    }
    return out;
  }

  /**
   * Polyline. Every segment is angle-snapped against its predecessor, and a
   * segment that lands further than {@link ANGLE_TOLERANCE} from every axis is
   * refused unless `offAxis` was asked for.
   *
   * The refusal is the whole point, and so is the fact that it can be waived.
   * 29.3% of stroked icons in the corpus have an off-axis edge, and they are
   * not sloppiness: they cluster on rational slopes — atan(1/2) = 26.57°, the
   * 3-4-5 triangle's 36.87° and 53.13°, atan(3) = 71.57° — because the edge
   * runs between two grid points. `airdrop` is `M4 11L11 16.5`: grid-legal
   * endpoints, 38.16°, 6.84° off 45°, and deliberate. A canvas that forced
   * every angle onto an axis would refuse to draw a third of the set.
   *
   * So the escape hatch stays, but it is asked for by name, like `raw`. Before,
   * it opened by itself: anything past 6° was returned untouched and silently,
   * so a model whose arithmetic drifted got the drift back as geometry and
   * nothing downstream could tell that apart from a designed diagonal. Now the
   * request lands in the `IconDoc`, where a reviewer sees it.
   *
   * The flag is permission, not instruction: segments within tolerance still
   * snap, and `offAxis` is recorded on the element only if one actually stayed
   * off-axis.
   *
   * Permission to draw, specifically, and not permission to be silent —
   * `lint.ts` still raises its `off-axis` warning on a declared diagonal, which
   * is the reviewer seeing it that this paragraph is about.
   */
  #strokeWidth(weight?: "detail"): number {
    if (weight === undefined) {
      return this.spec.stroke;
    }
    const width = this.spec.detailStroke;
    if (
      weight !== "detail" ||
      width === undefined ||
      !Number.isFinite(width) ||
      width <= 0 ||
      width > this.spec.stroke
    ) {
      throw new Error(
        "Detail strokes require a positive detailStroke no greater than the family stroke"
      );
    }
    return width;
  }

  line(args: LineArgs): string {
    if (args.weight === undefined) {
      return this.#line(args);
    }
    const width = this.#strokeWidth(args.weight);
    const c = new Canvas([], {
      finish: this.finish,
      spec: { ...this.spec, stroke: width },
    });
    c.#line(args);
    const [e] = c.elements;
    if (e.kind !== "line") {
      throw new Error("Detail line must retain its recipe");
    }
    return this.#push((id) => ({
      ...e,
      id,
      weight: "detail",
      ...(this.finish === "outlined" && !args.solid
        ? { strokeWidth: width }
        : {}),
    }));
  }

  #line({
    solid = false,
    offAxis = false,
    r = needsStrokeBounds(this.spec) ? 0 : undefined,
    points: pts,
  }: {
    solid?: boolean;
    offAxis?: boolean;
    r?: number;
    points: [number, number][];
  }): string {
    if (!Array.isArray(pts) || pts.length < 2) {
      throw new Error("line needs >= 2 points");
    }
    if (r !== undefined && (!Number.isFinite(r) || r < 0)) {
      throw new Error("Line radius must be finite and nonnegative");
    }
    const out: [number, number][] = [
      [onCanvas(pts[0][0], this.spec), onCanvas(pts[0][1], this.spec)],
    ];
    let free = false;
    for (let i = 1; i < pts.length; i += 1) {
      const [px, py] = out[i - 1];
      const {
        offBy,
        point: [sx, sy],
      } = snapAngle(
        px,
        py,
        onCanvas(pts[i][0], this.spec),
        onCanvas(pts[i][1], this.spec)
      );
      if (offBy > 0) {
        if (!offAxis) {
          throw new Error(offAxisMessage(i, [px, py], [sx, sy], offBy));
        }
        free = true;
      }
      out.push([q(sx, this.spec.grid), q(sy, this.spec.grid)]);
    }
    validateSolidLine(solid, r, out);
    if (r !== undefined) {
      // Radius describes the centerline in both paints, not the outer ink.
      const radius = tierRadius(r, "outlined", this.spec);
      const centerline =
        radius === 0 ? sharpLinePath(out) : roundedLinePath(out, radius);
      const painted = this.finish === "filled" || solid;
      let d = painted
        ? expandStroke(centerline, this.spec.stroke, strokeStyle(this.spec))
        : centerline;
      if (solid) {
        d = combinePaths(
          "union",
          { d, fillRule: "nonzero" },
          { d: centerline, fillRule: "nonzero" }
        );
      }
      return this.#push((id) => ({
        d,
        id,
        kind: "line",
        ...(painted ? { fillRule: "nonzero" as const } : {}),
        ...(solid && this.finish === "outlined"
          ? { strokeWidth: 0 as const }
          : {}),
        points: out,
        r: radius,
        ...(solid ? { solid: true as const } : {}),
        ...(free ? { offAxis: true } : {}),
      }));
    }
    if (this.finish === "filled") {
      // An open polyline encloses no area. The filled twin is that stroke
      // expanded to a bar: axis-aligned becomes a 2-wide rect; a diagonal
      // becomes a stadium of the same visual width. A polyline with more
      // than two points still has no inside, so it is still refused.
      if (out.length !== 2) {
        throw new Error(
          "a polyline paints nothing in a filled icon: it encloses no area, " +
            "so the fill has no inside to cover. Draw each segment as its " +
            "own line, or as the thin rect that segment is."
        );
      }
      return this.#filledBar(out[0], out[1], free);
    }
    const rest = out
      .slice(1)
      .map(([x, y]) => `L${x} ${y}`)
      .join("");
    const d = `M${out[0][0]} ${out[0][1]}${rest}`;
    return this.#push((id) =>
      free
        ? { d, id, kind: "line", offAxis: true, points: out }
        : { d, id, kind: "line", points: out }
    );
  }

  /** The filled twin of a two-point stroke: same visual extent as outlined. */
  #filledBar(
    a: [number, number],
    b: [number, number],
    offAxis = false
  ): string {
    // Re-derive ink from grid-constrained endpoints. Keep the line recipe so
    // transforms preserve stroke weight rather than scaling stored dimensions.
    const painted = (d: string): string =>
      this.#push((id) => ({
        d,
        fillRule: "nonzero" as const,
        id,
        kind: "line" as const,
        points: [a, b] as [number, number][],
        ...(offAxis ? { offAxis: true as const } : {}),
      }));
    return painted(this.#barPath(a, b));
  }

  /**
   * A square rotated 45°: vertices on the axes, every edge on 45/135.
   *
   * `reach` is centre to vertex. Equal run and equal rise, so a kite that is
   * only grid-legal — 2 wide and 4 tall, 20.6° off 135° — cannot be written
   * here. Outlined is the closed polyline; filled is that lozenge expanded by
   * half a stroke, one subpath, so a compass needle is one mark not four
   * stadiums.
   */
  diamond({
    cx,
    cy,
    reach,
  }: {
    cx: number;
    cy: number;
    reach: number;
  }): string {
    const pad = this.finish === "filled" ? this.spec.stroke / 2 : 0;
    const r = q(reach + pad, this.spec.grid);
    const x = onCanvas(cx, this.spec);
    const y = onCanvas(cy, this.spec);
    const n: [number, number] = [x, y - r];
    const e: [number, number] = [x + r, y];
    const s: [number, number] = [x, y + r];
    const w: [number, number] = [x - r, y];
    // One op for both paints. The lozenge took the `raw` escape, and
    // `programFromDoc` drops `raw`: a droplet whose point is a filled diamond
    // saved a program holding only its round base, which then paired as a bare
    // disc against a bare ring and tripped the restamp rule — two failures
    // from one missing word.
    //
    // Both finishes carry the op, not just the filled one. A stroked diamond
    // stored as a polyline quantises its vertices while a filled one quantises
    // its radius, so after a `fit` the two paints disagree by a fraction of a
    // grid step and the twin `extent` rule — which allows 0.01 — calls it a
    // mismatch. One op means one quantisation.
    const d = `M${n[0]} ${n[1]}L${e[0]} ${e[1]}L${s[0]} ${s[1]}L${w[0]} ${w[1]}Z`;
    return this.#push((id) => ({
      cx: x,
      cy: y,
      d,
      id,
      kind: "diamond" as const,
      reach,
    }));
  }

  /**
   * A dot sized by its role, not by a free radius. The role — not the resulting
   * radius — is what survives, so a dot keeps its meaning through a `fit`.
   *
   * The role's number is a **visual** diameter, so the skeleton is drawn one
   * stroke narrower than the tier: a `more` dot is a circle of radius 0.25
   * stroked at 2, which is exactly how the corpus draws one, and a `terminal`
   * dot is Central's zero-length round-capped segment, where the cap alone is
   * the dot. Drawing the tier as the path diameter instead — as this did —
   * renders every dot a full stroke wider than its role, which at `node` is a
   * 6-unit ring rather than a 4-unit dot.
   */
  dot({
    cx,
    cy,
    role: requested,
  }: {
    cx: number;
    cy: number;
    role?: string;
  }): string {
    const role =
      requested ??
      (this.spec.dots.terminal === undefined ? "node" : "terminal");
    const size = this.spec.dots[role];
    if (!size) {
      throw new Error(
        `dot role must be one of ${Object.keys(this.spec.dots).join(", ")} — got "${role}"`
      );
    }
    const X = onCanvas(cx, this.spec);
    const Y = onCanvas(cy, this.spec);
    // The role's number is a visual diameter either way; what changes is how
    // much of it the stroke supplies. Filled, none of it does, so the disc is
    // drawn at the full tier.
    const r = q(Math.max(0, (size - this.inkWidth) / 2), this.spec.grid);
    return this.#push((id) => ({
      cx: X,
      cy: Y,
      d: r === 0 ? `M${X} ${Y}L${X} ${Y}` : circlePath(X, Y, r),
      id,
      kind: "dot",
      role: role as DotRole,
    }));
  }

  /**
   * Place a part from the extracted vocabulary, scaled, turned and positioned.
   *
   * `turn` is a count of quarter-turns, not an angle. The clusterer merges a
   * mark with its quarter-turns — over blode-icons that is what makes the
   * horizontal and vertical strokes one part covering 808 icons instead of two
   * — so a part that the set draws at four orientations needs four ways to be
   * placed. A free angle would be a coordinate by another name and is refused:
   * the four turns are the only ones that keep every node on the grid.
   *
   * `flip` reflects the part in x before turning it. The clusterer folds a mark
   * and its mirror into one part for the same reason it folds quarter-turns —
   * over blode-icons 19 mirror pairs put both halves inside a single icon, a
   * cube's two faces and a basket's two sides among them, several at
   * fingerprint distance 0.000 — so the vocabulary carries one word and the
   * placement carries the reflection.
   *
   * It has to be asked for by name, and that is the whole safeguard. Reflection
   * is the one symmetry that can be plainly *wrong*: a check mark, a comma, an
   * `S` and every letterform are chiral, and a mirrored one is a mistake rather
   * than an orientation. A default of `false` means a model can only produce a
   * backwards glyph deliberately — the same bargain as `turn` and `off-axis`.
   *
   * `x, y` stays the top-left of what is drawn, so a turned or flipped part
   * lands where the caller aimed even though the transform moves the corner.
   */
  part({
    id,
    x,
    y,
    flip = false,
    scale: k = 1,
    turn = 0,
  }: {
    flip?: boolean;
    id: string;
    scale?: number;
    turn?: number;
    x: number;
    y: number;
  }): string {
    const p = this.parts.get(id);
    if (!p) {
      throw new Error(
        `unknown part ${id} — call listParts to see the vocabulary`
      );
    }
    const preserve = this.spec.partGeometry !== "grid";
    const px = preserve ? q(x, this.spec.grid) : x;
    const py = preserve ? q(y, this.spec.grid) : y;
    const t = quarterTurn(turn);
    // Reflect then turn, the order `parts/shape.ts` compares under, so a
    // `{turn, flip}` the clusterer measured places back as the same shape.
    const placed = parsePath(p.d).map((sp) =>
      rotateQuarter(flip ? mirrorX(sp) : sp, t)
    );
    const b = bbox(placed);
    const moved = placed.map((sp) =>
      translate(scale(sp, k), px - b.x0 * k, py - b.y0 * k)
    );
    if (this.finish === "filled" && !p.closed) {
      // The vocabulary is extracted from a stroked set, so most of its marks
      // are open runs. Filling the path as-is encloses nothing. The filled
      // twin is the same stroke expanded to a bar, segment by segment — the
      // same bargain `#filledBar` already makes for a two-point `line`.
      return this.#fillOpenPart(moved);
    }
    return this.#push((elId) =>
      flip
        ? {
            d: serialise(
              moved,
              preserve ? undefined : { grid: this.spec.grid }
            ),
            flip: true,
            id: elId,
            kind: "part",
            partId: id,
            scale: k,
            turn: t,
            x: px,
            y: py,
          }
        : {
            d: serialise(
              moved,
              preserve ? undefined : { grid: this.spec.grid }
            ),
            id: elId,
            kind: "part",
            partId: id,
            scale: k,
            turn: t,
            x: px,
            y: py,
          }
    );
  }

  /** Expand an open part into the filled bars of its centre-line, one
   *  segment at a time. A zero-length run is skipped; a part with no
   *  remaining length is still nothing, and is refused.
   *
   *  Each bar declares whether it is off-axis, measured from its own two
   *  points at the same {@link ANGLE_TOLERANCE} `line` judges by. Leaving the
   *  flag off — as this did — is what made a filled part unfittable: all 48
   *  bars of `circle-placeholder-dashed-1` came out unpermitted, element 1 of
   *  them running (21,13.25) → (20.75,14.5), and `transform` re-emits a bar
   *  through `line`, which refused it and took the whole drawing down with it.
   *
   *  This does not widen the escape the AGENTS.md invariant names. That escape
   *  is a *model* asking for a free angle by name, and it still is: nothing
   *  here reaches a coordinate the model wrote. These points come off a curve
   *  the vocabulary already holds, flattened by `flatten` — a chord of a curve
   *  is off-axis by construction, so refusing it is the angle guarantee
   *  misfiring on geometry the library itself produced. And the flag stays a
   *  statement about geometry rather than permission: it is set per bar from
   *  the angle that bar actually runs at, so an axial bar carries nothing and
   *  `lint`'s `off-axis` warning still fires on exactly the diagonals. */
  #fillOpenPart(moved: readonly Subpath[]): string {
    let last = "";
    const min = this.spec.grid / 2;
    for (const sp of moved) {
      const poly = flatten(sp);
      for (let i = 1; i < poly.length; i += 1) {
        const a = poly[i - 1];
        const b = poly[i];
        if (Math.hypot(b[0] - a[0], b[1] - a[1]) < min) {
          continue;
        }
        const from: [number, number] = [
          q(a[0], this.spec.grid),
          q(a[1], this.spec.grid),
        ];
        const to: [number, number] = [
          q(b[0], this.spec.grid),
          q(b[1], this.spec.grid),
        ];
        last = this.#filledBar(
          from,
          to,
          snapAngle(from[0], from[1], to[0], to[1]).offBy > 0
        );
      }
    }
    if (last === "") {
      throw new Error(
        "an open part painted nothing when filled: every segment was shorter " +
          "than the grid. Use a closed part, or draw the shape with rect/circle."
      );
    }
    return last;
  }

  /** Import existing path data unchanged, so any icon can enter a document. */
  raw(d: string, fillRule?: "nonzero"): string {
    return this.#push((id) => ({
      d,
      id,
      kind: "raw",
      ...(fillRule ? { fillRule } : {}),
    }));
  }

  /**
   * Uniform similarity transform: `p' = k·p + (tx, ty)`.
   *
   * Every element is re-emitted through its own primitive rather than having its
   * path data rewritten, so the result is as spec-conformant as it was when
   * drawn — radii re-tier against the new size, dots keep their role size, and a
   * part stays a reference. Rewriting `d` in place, as the reference JS did,
   * left `toJSON` describing the pre-transform shape.
   */
  transform(k: number, tx: number, ty: number): void {
    // The replay runs on a scratch canvas and is swapped in only once every
    // element has landed, because re-emitting can throw and a transform that
    // cannot finish is a transform that did not happen.
    //
    // Replaying onto `this` — as this did — kept whatever prefix got through.
    // Measured: `part circle-placeholder-dashed-1` under a filled finish is 48
    // elements over 20×20, and a `fit` on it came back as 1 element over 2×3.
    // 47 of the 48 silently destroyed, and `runDsl` reports the throw as a DSL
    // error and hands the wreckage to lint and pairing anyway — which is where
    // an impossible "extent 2.0x3.0 does not match 18.0x18.0" reading came
    // from. The failure a reviewer sees has to be the one that happened.
    if (this.elements.some((e) => e.kind === "raw" && e.composition)) {
      throw new Error("Transform the operands before Boolean composition");
    }
    const src = this.elements;
    const next = new Canvas([...this.parts.values()], {
      finish: this.finish,
      spec: this.spec,
    });
    for (const e of src) {
      // A knockout re-emits through the same builder as the solid it borrows
      // from, and lands back at the end of the run — which, replaying in
      // order, is exactly where it started. That is why the hole's tie to its
      // solid is the element order and not a stored id: an id would have to be
      // remapped here, and the remap is the kind of bookkeeping that survives
      // review and not the next change.
      if (e.op === "knockout" && e.kind === "circle") {
        next.hole({
          cx: e.cx * k + tx,
          cy: e.cy * k + ty,
          r: e.r * k,
          shape: "circle",
        });
      } else if (e.op === "knockout" && e.kind === "rect") {
        next.hole({
          h: e.h * k,
          r: e.r,
          shape: "rect",
          w: e.w * k,
          x: e.x * k + tx,
          y: e.y * k + ty,
        });
      } else if (e.op === "knockout" && e.kind === "line") {
        next.hole({
          offAxis: e.offAxis,
          points: e.points.map(([x, y]) => [x * k + tx, y * k + ty]),
          shape: "line",
        });
      } else if (e.kind === "rect") {
        next.rect({
          h: e.h * k,
          r: e.r,
          w: e.w * k,
          x: e.x * k + tx,
          y: e.y * k + ty,
        });
      } else if (e.kind === "circle") {
        next.circle({ cx: e.cx * k + tx, cy: e.cy * k + ty, r: e.r * k });
      } else if (e.kind === "arc") {
        next.arc({
          ccw: e.ccw,
          cx: e.cx * k + tx,
          cy: e.cy * k + ty,
          from: e.from,
          r: e.r * k,
          sweep: e.sweep,
          weight: e.weight,
        });
      } else if (e.kind === "diamond") {
        next.diamond({
          cx: e.cx * k + tx,
          cy: e.cy * k + ty,
          reach: e.reach * k,
        });
      } else if (e.kind === "dot") {
        next.dot({ cx: e.cx * k + tx, cy: e.cy * k + ty, role: e.role });
      } else if (e.kind === "line") {
        // A similarity transform preserves every angle, so a line that was
        // permitted off-axis must stay permitted or re-emitting it would throw.
        next.line({
          offAxis: e.offAxis,
          points: e.points.map(([x, y]) => [x * k + tx, y * k + ty]),
          r: e.r,
          solid: e.solid,
          weight: e.weight,
        });
      } else if (e.kind === "part") {
        // A similarity transform preserves chirality, so the reflection has to
        // be carried through — dropping it would silently un-mirror the part.
        next.part({
          flip: e.flip,
          id: e.partId,
          scale: e.scale * k,
          turn: e.turn,
          x: e.x * k + tx,
          y: e.y * k + ty,
        });
      } else {
        const moved = parsePath(e.d).map((sp) =>
          translate(scale(sp, k), tx, ty)
        );
        next.raw(serialise(moved, { grid: next.spec.grid }), e.fillRule);
      }
    }
    // Re-emitting mints fresh ids, but a fit is not a redraw: the handles the
    // model is holding must still name the same shapes afterwards. The
    // elements come back in order, one per source element, so the original ids
    // go back on. The counter never has to be rewound: the ids that were spent
    // were minted on the scratch canvas, which is thrown away with them.
    for (const [i, e] of next.elements.entries()) {
      e.id = src[i].id;
    }
    this.elements = next.elements;
    // The whole transform is one mutation, and an identity transform is none.
    // `fit` returns the identity when the drawing is already fitted, and
    // calling it a second time is not progress — leaving the version alone is
    // what lets the loop see that.
    this.#version += k === 1 && tx === 0 && ty === 0 ? 0 : 1;
    this.log.push(
      `transform ×${k} +${q(tx, this.spec.grid)},${q(ty, this.spec.grid)}`
    );
  }

  /**
   * Delete an element.
   *
   * Removing a solid removes the holes cut from it too. They are not
   * independent shapes: a knockout only means anything as the absence of the
   * ink it sits in, and leaving one behind would silently reattach it to
   * whichever solid happened to precede it — a hole appearing in an unrelated
   * shape. The returned `removed` names everything that went.
   */
  remove(id: string): { remaining: number; removed: string[] } {
    const i = this.elements.findIndex((e) => e.id === id);
    if (i === -1) {
      throw new Error(`no element ${id}`);
    }
    const end = this.elements[i].op === "knockout" ? i + 1 : this.#groupEnd(i);
    const gone = this.elements.splice(i, end - i).map((e) => e.id);
    this.#version += 1;
    this.log.push(`remove ${gone.join(", ")}`);
    return { remaining: this.elements.length, removed: gone };
  }

  clear(): void {
    this.elements = [];
    this.#version += 1;
    this.log.push("clear");
  }

  bbox(): Box | null {
    if (!this.elements.length) {
      return null;
    }
    const paths =
      this.finish === "filled"
        ? this.#groups().flatMap((group) =>
            parsePath(Canvas.#filledGroup(group).d)
          )
        : this.elements.flatMap((e) => parsePath(e.d));
    return paths.length ? bbox(paths) : null;
  }

  /**
   * The drawing with its ink taken back off — what a uniform scale acts on.
   *
   * Under a stroked finish every element is a skeleton already, so this is the
   * path bbox and the caller adds `inkWidth` back. Under a filled finish the
   * two kinds of path have to be told apart:
   *
   * - A disc, a slab, a lozenge: the size *is* the design, and scaling it is
   *   right.
   * - An expanded line or arc: a stroke expanded into a solid, whose
   *   thickness is ink at the spec width. Scaling that makes the icon heavier
   *   than the house draws it.
   *
   * A `line` keeps its `points` and an `arc` its centre and radius, so the
   * stroke-derived ones can give back the skeleton they were grown from. A
   * `raw` escape cannot, and is measured as it stands.
   */
  visualBbox(): Box | null {
    if (
      this.finish === "outlined" &&
      (needsStrokeBounds(this.spec) ||
        this.elements.some((e) => e.strokeWidth !== undefined)) &&
      this.elements.length
    ) {
      return bbox(
        this.elements.flatMap((e) =>
          parsePath(
            e.strokeWidth === 0
              ? e.d
              : expandStroke(e.d, e.strokeWidth ?? this.spec.stroke, {
                  cap:
                    e.kind === "dot"
                      ? "round"
                      : (this.spec.strokeCap ?? "round"),
                  join: this.spec.strokeJoin ?? "round",
                })
          )
        )
      );
    }
    const box = this.bbox();
    if (!box) {
      return null;
    }
    const half = this.inkWidth / 2;
    return {
      h: box.h + 2 * half,
      w: box.w + 2 * half,
      x0: box.x0 - half,
      x1: box.x1 + half,
      y0: box.y0 - half,
      y1: box.y1 + half,
    };
  }

  skeletonBbox(): Box | null {
    if (!this.elements.length) {
      return null;
    }
    if (this.finish !== "filled") {
      return this.bbox();
    }
    const solids = this.#groups().flatMap((group) => {
      const { d } = Canvas.#filledGroup(group);
      return d ? [{ ...group[0], d }] : [];
    });
    if (!solids.length) {
      return null;
    }
    const boxes = solids.map((e) => {
      const half =
        ((e.kind === "line" || e.kind === "arc") && e.weight
          ? (this.spec.detailStroke ?? this.spec.stroke)
          : this.spec.stroke) / 2;
      const painted = bbox(parsePath(e.d));
      if (
        (this.spec.strokeJoin === "miter" ||
          this.spec.strokeCap === "square") &&
        e.kind === "line" &&
        e.points
      ) {
        return bbox(parsePath(sharpLinePath(e.points)));
      }
      if (e.kind === "line" || e.kind === "arc" || e.kind === "diamond") {
        return {
          x0: painted.x0 + half,
          x1: painted.x1 - half,
          y0: painted.y0 + half,
          y1: painted.y1 - half,
        };
      }
      return painted;
    });
    const x0 = Math.min(...boxes.map((b) => b.x0));
    const y0 = Math.min(...boxes.map((b) => b.y0));
    const x1 = Math.max(...boxes.map((b) => b.x1));
    const y1 = Math.max(...boxes.map((b) => b.y1));
    return { h: y1 - y0, w: x1 - x0, x0, x1, y0, y1 };
  }

  /**
   * How much of the painted extent is ink rather than drawing, per axis — the
   * constant term in `extent(k) = k · skeleton + ink`.
   *
   * One stroke on both axes when the drawing is stroked. When it is filled it
   * is whatever the stroke-derived elements contribute at the boundary: a full
   * stroke where a bar is the outermost mark, nothing where a disc is.
   */
  inkExtent(): { x: number; y: number } {
    if (this.finish !== "filled") {
      if (
        this.spec.strokeJoin === "miter" ||
        this.spec.strokeCap === "square" ||
        this.elements.some((e) => e.strokeWidth !== undefined)
      ) {
        const ink = this.visualBbox(),
          skeleton = this.bbox();
        if (ink && skeleton) {
          return { x: ink.w - skeleton.w, y: ink.h - skeleton.h };
        }
      }
      return { x: this.inkWidth, y: this.inkWidth };
    }
    const painted = this.bbox();
    const skeleton = this.skeletonBbox();
    if (!(painted && skeleton)) {
      return { x: 0, y: 0 };
    }
    return { x: painted.w - skeleton.w, y: painted.h - skeleton.h };
  }

  /**
   * The shipping SVG, in whichever finish the document declares.
   *
   * Outlined: the skeleton, stroked, one `<path>` per element, unchanged.
   *
   * Filled: one path per solid, with its cutters unioned and subtracted.
   * SVG output and subsequent Boolean composition resolve the same geometry.
   *
   * `stroke` is ignored under a filled finish rather than refused: `render`
   * and the eval harness pass the house width to everything they draw, and a
   * filled icon has no stroke for it to change.
   */
  toSVG({ stroke }: { stroke?: number } = {}): string {
    const width = stroke ?? this.spec.stroke;
    const { canvas: size } = this.spec;
    const paths =
      this.finish === "filled"
        ? this.#groups()
            .map((g) => {
              const { d, fillRule } = Canvas.#filledGroup(g);
              return `<path d="${d}" fill="currentColor" fill-rule="${fillRule}" clip-rule="${fillRule}"/>`;
            })
            .join("\n")
        : this.elements
            .map((e) =>
              e.strokeWidth === 0
                ? `<path d="${e.d}" fill="currentColor" fill-rule="nonzero"/>`
                : `<path d="${e.d}" stroke="currentColor" stroke-width="${e.strokeWidth ?? width}" stroke-linecap="${e.kind === "dot" ? "round" : (this.spec.strokeCap ?? "round")}" stroke-linejoin="${this.spec.strokeJoin ?? "round"}"${this.spec.strokeJoin === "miter" ? ' stroke-miterlimit="4"' : ""}/>`
            )
            .join("\n");
    return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" fill="none" xmlns="http://www.w3.org/2000/svg">\n${paths}\n</svg>`;
  }

  /**
   * The document format. This — not path data — is the source of truth: it is
   * diffable, it re-renders at any stroke width or keyline, and a part is stored
   * as a reference so editing the part updates every icon using it.
   */
  toJSON({
    icon = null,
    keyline = null,
  }: { icon?: string | null; keyline?: Keyline | null } = {}): IconDoc {
    const doc: IconDoc = {
      draw: this.elements.map((e): DrawOp => {
        // `knockout` is written only when it is true, like `offAxis` and
        // `flip`: the key appears with the geometry it describes, so a diff
        // showing it shows a shape that changed from ink to absence.
        const cut = e.op === "knockout" ? { knockout: true as const } : null;
        if (e.kind === "raw" && e.composition) {
          return structuredClone(e.composition);
        }
        if (e.kind === "rect") {
          return {
            h: e.h,
            op: "rect",
            r: e.r,
            w: e.w,
            x: e.x,
            y: e.y,
            ...cut,
          };
        }
        if (e.kind === "circle") {
          return { cx: e.cx, cy: e.cy, op: "circle", r: e.r, ...cut };
        }
        if (e.kind === "arc") {
          return {
            cx: e.cx,
            cy: e.cy,
            from: e.from,
            op: "arc" as const,
            r: e.r,
            sweep: e.sweep,
            ...(e.ccw ? { ccw: true as const } : {}),
            ...(e.weight ? { weight: e.weight } : {}),
          };
        }
        if (e.kind === "diamond") {
          return { cx: e.cx, cy: e.cy, op: "diamond", reach: e.reach };
        }
        if (e.kind === "dot") {
          return { cx: e.cx, cy: e.cy, op: "dot", role: e.role };
        }
        if (e.kind === "line") {
          // Written only when it is true, so a document gains the key when it
          // gains the geometry — a diff that shows `offAxis` shows a real
          // change of shape, not a change of how the line was requested.
          return {
            op: "line",
            points: e.points,
            ...(e.offAxis ? { offAxis: true } : {}),
            ...(e.r === undefined ? {} : { r: e.r }),
            ...(e.solid ? { solid: true as const } : {}),
            ...(e.weight ? { weight: e.weight } : {}),
            ...cut,
          };
        }
        if (e.kind === "part") {
          const op = {
            id: e.partId,
            op: "part" as const,
            scale: e.scale,
            turn: e.turn,
            x: e.x,
            y: e.y,
          };
          // Written only when true, for the same reason as `line`'s `offAxis`:
          // the key appears with the geometry it describes.
          return e.flip ? { ...op, flip: true } : op;
        }
        // Escape hatch: geometry the primitives cannot express is kept verbatim
        // rather than approximated. Fidelity beats format purity.
        return {
          d: e.d,
          op: "raw",
          ...(e.fillRule ? { fillRule: e.fillRule } : {}),
        };
      }),
      icon,
      keyline,
    };
    // Same rule again: an outlined document is every document written before
    // fill mode existed, so it carries no key rather than an explicit default.
    return this.finish === "filled" ? { ...doc, finish: "filled" } : doc;
  }

  static fromJSON(doc: IconDoc, parts: Part[] = [], spec: Spec = SPEC): Canvas {
    const c = new Canvas(parts, { finish: doc.finish ?? "outlined", spec });
    for (const op of doc.draw ?? []) {
      if (op.op === "rect") {
        if (op.knockout) {
          c.hole({
            h: op.h,
            r: op.r,
            shape: "rect",
            w: op.w,
            x: op.x,
            y: op.y,
          });
        } else {
          c.rect(op);
        }
      } else if (op.op === "circle") {
        if (op.knockout) {
          c.hole({ cx: op.cx, cy: op.cy, r: op.r, shape: "circle" });
        } else {
          c.circle(op);
        }
      } else if (op.op === "arc") {
        c.arc(op);
      } else if (op.op === "diamond") {
        c.diamond(op);
      } else if (op.op === "dot") {
        c.dot(op);
      } else if (op.op === "line") {
        validateLineKnockout(op);
        if (op.knockout) {
          c.hole({
            offAxis: op.offAxis,
            points: op.points,
            shape: "line",
          });
        } else {
          c.line({
            offAxis: op.offAxis,
            points: op.points,
            r: op.r,
            solid: op.solid,
            weight: op.weight,
          });
        }
      } else if (op.op === "part") {
        c.part(op);
      } else if (op.op === "boolean") {
        const data = c.#compositionData(op);
        c.#push((id) => ({
          composition: structuredClone(op),
          ...data,
          fillRule: "nonzero",
          id,
          kind: "raw",
        }));
      } else if (op.op === "raw") {
        c.raw(op.d, op.fillRule);
      } else {
        throw new Error(`unknown op ${JSON.stringify(op)}`);
      }
    }
    return c;
  }

  describe(): {
    h: number;
    /** Present only on a knockout, so what is read back says whether a shape
     *  puts ink down or takes it away — the one thing about a filled drawing
     *  that its bounds cannot show. */
    hole?: true;
    id: string;
    kind: string;
    w: number;
    x: number;
    y: number;
  }[] {
    return this.elements.map((e) => {
      const b = bbox(parsePath(e.d));
      const shape = {
        h: +b.h.toFixed(2),
        id: e.id,
        kind: e.kind,
        w: +b.w.toFixed(2),
        x: +b.x0.toFixed(2),
        y: +b.y0.toFixed(2),
      };
      return e.op === "knockout" ? { ...shape, hole: true as const } : shape;
    });
  }
}
