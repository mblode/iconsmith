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
import type {
  Box,
  DotRole,
  DrawOp,
  Finish,
  IconDoc,
  Keyline,
  Part,
} from "../types.js";

/**
 * The house spec, calibrated against the corpus.
 *
 * Every number here is measured from Central's `round-outlined-radius-3-stroke-2`
 * variant — 2,085 icons, verified byte-identical to blode-icons' own SVGs, so it
 * is the set this project draws for, not a proxy for it. `src/corpus/measure.ts`
 * reproduces every figure quoted below.
 *
 * The previous revision took its numbers from an article about Cursor's icon
 * set. Cursor packs looser than Central, and applying its constants marked most
 * of the base set as broken: its ~3.75px minimum gap flags 89% of Central's own
 * icons, its 2.5px clearance flags 76%. Cursor is the inspiration; the corpus is
 * the specification. Where they disagree, the corpus wins and the article's
 * value is recorded in the comment.
 */
const HOUSE = {
  // Unchanged: the whole corpus draws on a 24×24 viewBox.
  canvas: 24,
  // Measured: margin from the visual extent to the nearest canvas edge, n=2085,
  // mode 2.0 (46% of icons), median 2.00. A 2.0 rule flags 37%; the article's
  // 2.5 flags 76%, which is a rule against the set rather than for it.
  //
  // UNRESOLVED, and left that way on purpose: 165 icons have a visual extent of
  // 22 units in x (52 more in y), which leaves 1 unit of clearance, not 2. They
  // are not scattered — they are a coherent family of things that are wide by
  // nature: banknote-1, battery-full, battery-empty, aspect-ratio-16-9,
  // arrow-expand-hor, arc. So either there is a fifth optical shape at 22 that
  // runs at 1-unit clearance, or that family bleeds and should be pulled in.
  // Both readings are defensible and the choice is a design call, not a
  // measurement, so neither is encoded here. Whoever decides it should also
  // decide whether `clearance` becomes per-keyline.
  clearance: 2,
  // Measured: dot diameters across all 2,085 icons of the house variant, taken
  // as **visual** extent — path bounds plus the stroke, half per side.
  //
  // A dot is a solid disc, which in this set means one of two constructions:
  // a zero-length round-capped segment, Central's idiom, where the stroke width
  // *is* the diameter; or a circle whose own stroke closes its hole (2r ≤
  // stroke), i.e. visual diameter ≤ 2×stroke = 4. A circle wider than that is a
  // ring, and counting rings is what fills a dot census with clock faces and
  // buttons. n=446 dots over 163 icons. Icon-weighted, four modes:
  //
  //   3.0  45 icons (27.6%), 105 dots — dice pips, calendar day marks, eyes
  //   2.0  35 icons (21.5%), 117 dots — every cap-form dot, by construction
  //   4.0  27 icons (16.6%),  61 dots — dot grids, bezier handles, chart points
  //   2.5  20 icons (12.3%),  34 dots — list bullets, task dots, info marks
  //
  // Together they are 77.9% of dot-bearing icons and 71.1% of dots exactly
  // (73.8% within 0.125). There is no fifth mode to find: the next candidates
  // are 3.5 (7 icons), 2.2 (5 — `adjust-photo`'s fixed-width marks, which
  // `conform.ts` already treats as a deliberate exception), 2.4 (4), 2.67 (4).
  //
  // `node` is new, and it is the corpus correcting the article twice over. The
  // article's largest tier is a 4.0 "status/attention badge". 4.0 is real and is
  // the second-commonest dot — but Central never draws a badge at it:
  // `email-2-unread`'s badge is a 7.0 disc, off the dot scale entirely. 4.0 is
  // the node size: the cells of `dot-grid-3x3`, the handles of `bezier-curve`,
  // the points of `insights` and `point-chart`, the centres of `target` and
  // `radar`.
  //
  // Rejected, each with the count that rejects it. 1.5, the article's "fine
  // detail": 25 dots but only 4 icons, and all four are one family (blur,
  // unblur, persona, threed), so it is a texture rather than a role. 1.75, the
  // article's "dots in a row": zero occurrences, and the 51 groups of three or
  // more same-size dots in the set are drawn at 2.0 / 3.0 / 4.0 like every other
  // dot, so a row has no size of its own. Both are also undrawable in the house
  // idiom — no solid disc can be narrower than the 2.0 stroke that draws it.
  dots: { floating: 3, more: 2.5, node: 4, terminal: 2 },
  // Fill mode's corner radii, and the one number in this object that is *not*
  // read off the outlined variant. Source: `bench/filled-language.v1.json`,
  // 7,018 corners over the 2,085 icons that exist in both
  // `round-filled-radius-3-stroke-2` and the house outlined variant.
  //
  // `radiusTiers` matches 78.4% of outlined corners and only 43.4% of filled
  // ones, so fill mode cannot reuse it: the commonest filled corner is 4.0
  // (2,640 corners, 37.6%) and 4 is not a house tier at all. The reason is
  // geometric rather than stylistic. An outlined corner is a *centre-line*
  // radius; the filled twin is the same skeleton's boundary, which on the
  // outside of a turn sits half a stroke further out and on the inside half a
  // stroke further in. So the fill tiers are the house tiers offset by ±1 and
  // unioned with themselves, everything at or below 0 dropping out into the
  // hard corner `tierRadius` already passes through:
  //
  //   outer   [0.5,1,2,3] + 1  ->  [1.5, 2, 3, 4]
  //   inner   [0.5,1,2,3] - 1  ->  [  0, 0, 1, 2]
  //   union                        [0.5, 1, 1.5, 2, 3, 4]
  //
  // That derived set matches 83.2% of filled corners exactly — fill mode
  // conforms about as well as stroke mode does to its own tiers (78.4%), and
  // nearly twice as well as it does to the house tiers.
  //
  // Rejected: [0.5, 1, 2, 2.5, 3, 4], which measures better still at 86.1%.
  // Its extra tier is 2.5 (356 corners), and 2.5 is not any house tier plus or
  // minus half a stroke — it is a fitted constant, and fitting one here would
  // be the same move `radiusTiers` rejected when it dropped the size-
  // conditioned split that scored worse than the flat set. The 2.9 points are
  // the price of a rule that can be derived rather than looked up.
  fillRadiusTiers: [0.5, 1, 1.5, 2, 3, 4],
  // Unchanged. Measured: 65.9% of design anchors (subpath starts and straight
  // segment ends) land on 0.25, 63.3% on 0.5 — quarter steps are rare but real,
  // so the finer grid stays.
  grid: 0.25,
  // Unchanged, and confirmed as the four commonest visual extents in the set.
  // Joint (w,h) modes, n=2085: 20×20 (349), 18×18 (314), 20×16 (106),
  // 16×20 (63). Only 44% of icons land within 0.5 of one of the four, so this
  // is the vocabulary of intended sizes, not a law every icon obeys.
  //
  // `landscape` and `portrait` are new, and they are the set correcting the
  // spec rather than the other way round. Counting within the same ±0.5 window
  // as the 44% above, they are the two commonest extents the original four did
  // not describe: 20×18 (77 icons) and 18×20 (76). Both sit exactly between
  // square and circle — one step off square on a single axis — and their
  // subjects are consistent: 20×18 holds cameras, bags, folders, coin stacks;
  // 18×20 holds pages, files, bells, cups, hourglasses. Naming the two lifts
  // conformance from 44.1% to 54.2% at the same tolerance without moving a
  // single icon.
  //
  // Deliberately not added: a fifth wide shape at 22 units. See `clearance`.
  keylines: {
    circle: [20, 20],
    landscape: [20, 18],
    portrait: [18, 20],
    square: [18, 18],
    tall: [16, 20],
    wide: [20, 16],
  },
  // Fill mode's replacement for `minGap`, and it measures the opposite thing.
  // `minGap` asks whether two shapes are too close; in a filled icon the
  // shapes are *meant* to touch — a hole shares its edge with the solid it is
  // cut from, and only 1.4% of the 6,693 filled solid pairs in the set are
  // apart at all. What can go wrong instead is a feature too small to survive
  // being rendered: at the 16px the set is drawn for, one design unit is
  // 0.667px, so a feature needs 1.5 units to clear a pixel.
  //
  // 1.5 is the legibility floor and it also sits in the tail of the set's own
  // practice rather than at its mode: the smallest dimension of the 1,807
  // holes has median 3.0, p25 2.0, p10 1.95, and 1.5 fires on 6.6% of them
  // (0.5% of solids). The same doctrine as `minGap`, which sits at p10 of the
  // gap distribution rather than at its 2.0 mode — a floor catches outliers.
  // The set's own tail is real: `safari` alone ships 11 holes under 0.44.
  minFeature: 1.5,
  // Measured as an **ink gap** — centre-line distance minus one stroke width —
  // between separate `<path>` elements, taking each icon's tightest positive
  // gap: n=1306, median 2.00, p25 1.16, p10 0.83. Pairs that overlap or touch
  // are excluded; they are compound construction, not spacing, and counting
  // them drags every low percentile below zero.
  //
  // 1.0 flags 14% of icons that have separated shapes. 2.0 — the modal designed
  // gap — flags 47%, and the article's ~3.75 flags 89%. A floor is for catching
  // outliers, so it sits at the tail, not at the mode.
  minGap: 1,
  // Measured: symmetric-handle corner arcs, n=6188. A flat tier set matches
  // 78.4% of them exactly; the article's [0.25, 1, 2] matches 23.9% with a
  // median error of a full pixel, because it has no 3 and 3 is 38% of all
  // corners in this set. Conditioning tiers on shape size scored worse than the
  // flat set (71–76%), so the size split is gone.
  radiusTiers: [0.5, 1, 2, 3],
  // Unchanged. Measured: 97.5% of stroked shapes are exactly 2.
  stroke: 2,
} as const;

/** Optical size the drawing is meant to be shown at, in CSS pixels. The design
 *  grid stays 24; this is the cut. 16px drops hairline corners and terminal
 *  dots because they do not survive a two-thirds scale. */
export type OpticalSize = 16 | 20 | 24;

export interface Spec {
  canvas: number;
  clearance: number;
  dots: Record<string, number>;
  fillRadiusTiers: readonly number[];
  grid: number;
  keylines: Record<Keyline, readonly [number, number]>;
  /** Density ceiling. Smaller optical sizes allow fewer marks. */
  maxElements: number;
  minFeature: number;
  minGap: number;
  /** Family corner, Central's `radius-N`. Caps the outlined tier set. */
  radius: number;
  radiusTiers: readonly number[];
  size: OpticalSize;
  stroke: number;
}

const HOUSE_RADIUS_TIERS = [0.5, 1, 2, 3] as const;
const HOUSE_DOTS: Record<DotRole, number> = { ...HOUSE.dots };

/** Fill tiers are outlined tiers unioned with themselves offset by ±half a
 *  stroke — the derivation behind `HOUSE.fillRadiusTiers`. */
const fillTiersFrom = (
  radiusTiers: readonly number[],
  stroke: number
): number[] => {
  const half = stroke / 2;
  const seen = new Set<number>();
  for (const t of radiusTiers) {
    for (const v of [t, t + half, t - half]) {
      if (v > 0) {
        seen.add(v);
      }
    }
  }
  return [...seen].toSorted((a, b) => a - b);
};

const densityFor = (size: OpticalSize): number => {
  if (size <= 16) {
    return 5;
  }
  if (size <= 20) {
    return 6;
  }
  return 8;
};

/**
 * A cut of the house spec. The design viewBox stays 24; `size` is what it is
 * shown at. Stroke and family radius are the other two knobs Central already
 * names (`stroke-2`, `radius-3`).
 *
 * At 16px, one design unit is 0.667px: the 0.5 radius tier and the 2.0
 * terminal dot fall under a pixel and drop out, `minFeature` grows so a hole
 * still clears a device pixel, and density tightens. The model never picks
 * those numbers — `specAt` does, and the canvas snaps to what remains.
 */
export const specAt = ({
  radius = 3,
  size = 24,
  stroke = 2,
}: {
  radius?: number;
  size?: OpticalSize;
  stroke?: number;
} = {}): Spec => {
  if (size === 24 && stroke === 2 && radius === 3) {
    return {
      canvas: HOUSE.canvas,
      clearance: HOUSE.clearance,
      dots: { ...HOUSE.dots },
      fillRadiusTiers: HOUSE.fillRadiusTiers,
      grid: HOUSE.grid,
      keylines: HOUSE.keylines,
      maxElements: 8,
      minFeature: HOUSE.minFeature,
      minGap: HOUSE.minGap,
      radius: 3,
      radiusTiers: HOUSE.radiusTiers,
      size: 24,
      stroke: 2,
    };
  }
  const radiusTiers = HOUSE_RADIUS_TIERS.filter(
    (t) => t <= radius && (size >= 24 || t >= 1)
  );
  const unitPx = size / HOUSE.canvas;
  const dots = Object.fromEntries(
    Object.entries(HOUSE_DOTS).filter(
      ([, d]) => size >= 24 || d * unitPx >= 1.5
    )
  );
  return {
    canvas: HOUSE.canvas,
    clearance: HOUSE.clearance,
    dots: Object.keys(dots).length > 0 ? dots : { node: HOUSE_DOTS.node },
    fillRadiusTiers: fillTiersFrom(radiusTiers, stroke),
    grid: HOUSE.grid,
    keylines: HOUSE.keylines,
    maxElements: densityFor(size),
    minFeature: Math.max(HOUSE.minFeature, 1.5 / unitPx),
    minGap: HOUSE.minGap * (HOUSE.canvas / size),
    radius,
    radiusTiers,
    size,
    stroke,
  };
};

/** House cut: 24px, stroke 2, radius 3. Every existing call site. */
export const SPEC: Spec = specAt();

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
const offAxisMessage = (
  i: number,
  from: [number, number],
  to: [number, number],
  offBy: number
): string => {
  const ang = heading(from, to);
  const axis = nearest(AXES, ang);
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
 * union because it is orthogonal to `kind` — a knockout is a rect or a circle
 * that happens to be subtracted, not a seventh kind of shape — and because
 * `hole()` is the only thing that ever writes it. Absent means `add`, so an
 * element written before this existed still means what it meant.
 */
export type Op = "add" | "knockout";

export type Element = {
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
      r: number;
      sweep: ArcSweep;
    }
  | { cx: number; cy: number; d: string; id: string; kind: "circle"; r: number }
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
  | { d: string; id: string; kind: "raw" }
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

const POLES_CW: readonly ArcFrom[] = ["right", "bottom", "left", "top"];

/** The pole an arc lands on after its named sweep. */
const poleAfter = (from: ArcFrom, sweep: ArcSweep, ccw: boolean): ArcFrom => {
  const i = POLES_CW.indexOf(from);
  const dir = ccw ? -1 : 1;
  return POLES_CW[(i + dir * SWEEP_STEPS[sweep] + POLES_CW.length * 4) % 4];
};

/** Cubic body of an open arc, plus the endpoints, so a filled twin can offset
 *  the same sweep rather than re-derive it. */
const arcCommands = (
  cx: number,
  cy: number,
  r: number,
  from: ArcFrom,
  sweep: ArcSweep,
  ccw: boolean
): { cubics: string; end: [number, number]; start: [number, number] } => {
  const steps = SWEEP_STEPS[sweep];
  const dir = ccw ? -1 : 1;
  const h = r * K;
  let a = FROM_ANGLE[from];
  const start = atCircle(cx, cy, r, a);
  let cubics = "";
  let end = start;
  for (let i = 0; i < steps; i += 1) {
    const a0 = a;
    a += dir * (Math.PI / 2);
    const [sx, sy] = atCircle(cx, cy, r, a0);
    const [x1, y1] = atCircle(cx, cy, r, a);
    const t0x = dir * -Math.sin(a0) * h;
    const t0y = dir * Math.cos(a0) * h;
    const t1x = dir * -Math.sin(a) * h;
    const t1y = dir * Math.cos(a) * h;
    cubics += `C${sx + t0x} ${sy + t0y} ${x1 - t1x} ${y1 - t1y} ${x1} ${y1}`;
    end = [x1, y1];
  }
  return { cubics, end, start };
};

/**
 * The filled twin of an open arc: that stroke expanded into an annular
 * sector whose outer edge is the ink the outline already occupied. Round
 * caps at both poles match `#filledBar`. A radius at or below half a stroke
 * collapses to a pie, the same way a `terminal` dot is the cap alone.
 */
export const filledArcPath = (
  cx: number,
  cy: number,
  r: number,
  from: ArcFrom,
  sweep: ArcSweep,
  ccw: boolean,
  half: number
): string => {
  const outer = arcCommands(cx, cy, r + half, from, sweep, ccw);
  if (r <= half) {
    return `M${outer.start[0]} ${outer.start[1]}${outer.cubics}L${cx} ${cy}Z`;
  }
  const inner = arcCommands(
    cx,
    cy,
    r - half,
    poleAfter(from, sweep, ccw),
    sweep,
    !ccw
  );
  // Radial closes at the poles, no extra cap discs: three wifi bands
  // would otherwise be 9 cap-subpaths and blow the 9-mark panel cap,
  // and caps centred on the outer radius would sit a stroke past the
  // outlined visual edge.
  return (
    `M${outer.start[0]} ${outer.start[1]}${outer.cubics}` +
    `L${inner.start[0]} ${inner.start[1]}${inner.cubics}Z`
  );
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

/** The shapes a knockout may take. The same two the corpus cuts with — 23.8%
 *  of its 1,807 holes are rects and 22.3% are discs — and deliberately no
 *  others: `hole` routes straight into `rect` and `circle`, so a knockout is
 *  quantised, tiered and clamped by exactly the code that draws a solid and
 *  there is no second path by which a coordinate could reach the document. */
export type HoleShape =
  | { cx: number; cy: number; r: number; shape: "circle" }
  | { h: number; r?: number; shape: "rect"; w: number; x: number; y: number };

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
   * Filled, this is that stroke expanded into an annular sector — the same
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
  }): string {
    const cx = onCanvas(args.cx, this.spec);
    const cy = onCanvas(args.cy, this.spec);
    const r = q(args.r, this.spec.grid);
    const ccw = Boolean(args.ccw);
    const d =
      this.finish === "filled"
        ? filledArcPath(
            cx,
            cy,
            r,
            args.from,
            args.sweep,
            ccw,
            this.spec.stroke / 2
          )
        : arcPath(cx, cy, r, args.from, args.sweep, ccw);
    return this.#push((id) => ({
      ...(ccw ? { ccw: true as const } : {}),
      cx,
      cy,
      d,
      from: args.from,
      id,
      kind: "arc" as const,
      r,
      sweep: args.sweep,
    }));
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
   * Serialisation reads it back the way the corpus writes it: one `<path>` per
   * solid, holding the solid's subpath and then its holes' subpaths, under
   * `fill-rule="evenodd"`. Grouping per solid rather than emitting one path
   * for the whole icon is deliberate — under `evenodd` two solids that
   * overlapped would cancel where they met and paint a hole nobody asked for.
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
    const make = (id: string): Element => ({
      ...(shape.shape === "circle"
        ? circleElement(id, shape, this.spec)
        : this.#rectElement(id, shape)),
      op: "knockout",
    });
    // Built once to measure it, then handed to `#push` as-is: `#push` mints the
    // id, and a probe that minted its own would burn one on every call.
    const probe = make("probe");
    const inside = bbox(parsePath(this.elements[target].d));
    const cut = bbox(parsePath(probe.d));
    if (
      cut.x0 < inside.x0 ||
      cut.y0 < inside.y0 ||
      cut.x1 > inside.x1 ||
      cut.y1 > inside.y1
    ) {
      throw new Error(
        `that hole is not inside ${this.elements[target].id}: it spans ` +
          `${cut.x0}..${cut.x1} x ${cut.y0}..${cut.y1}, the solid spans ` +
          `${inside.x0}..${inside.x1} x ${inside.y0}..${inside.y1}. Under ` +
          "`evenodd` the part that hangs outside would paint ink rather than " +
          "remove it, so the shape would come out inverted. Shrink the hole, " +
          "or draw the piece you want as a solid."
      );
    }
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
  line({
    offAxis = false,
    points: pts,
  }: {
    offAxis?: boolean;
    points: [number, number][];
  }): string {
    if (!Array.isArray(pts) || pts.length < 2) {
      throw new Error("line needs >= 2 points");
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
      return this.#filledBar(out[0], out[1]);
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
  #filledBar(a: [number, number], b: [number, number]): string {
    const bar = this.spec.stroke;
    const half = bar / 2;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    if (Math.abs(dy) < this.spec.grid / 2) {
      const x = Math.min(a[0], b[0]);
      return this.rect({
        h: bar,
        w: Math.abs(dx) + bar,
        x: x - half,
        y: a[1] - half,
      });
    }
    if (Math.abs(dx) < this.spec.grid / 2) {
      const y = Math.min(a[1], b[1]);
      return this.rect({
        h: Math.abs(dy) + bar,
        w: bar,
        x: a[0] - half,
        y: y - half,
      });
    }
    const len = Math.hypot(dx, dy) || 1;
    const px = (-dy / len) * half;
    const py = (dx / len) * half;
    const qn = (v: number): number => q(v, this.spec.grid);
    const body =
      `M${qn(a[0] + px)} ${qn(a[1] + py)}L${qn(b[0] + px)} ${qn(b[1] + py)}` +
      `L${qn(b[0] - px)} ${qn(b[1] - py)}L${qn(a[0] - px)} ${qn(a[1] - py)}Z`;
    return this.raw(
      circlePath(qn(a[0]), qn(a[1]), qn(half)) +
        circlePath(qn(b[0]), qn(b[1]), qn(half)) +
        body
    );
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
    if (this.finish !== "filled") {
      return this.line({ points: [n, e, s, w, n] });
    }
    return this.raw(
      `M${n[0]} ${n[1]}L${e[0]} ${e[1]}L${s[0]} ${s[1]}L${w[0]} ${w[1]}Z`
    );
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
    if (this.finish === "filled" && !p.closed) {
      // The vocabulary is extracted from a stroked set, so most of its marks
      // are open runs. Filled, an open run encloses nothing and paints
      // nothing — the same silent blank `line` is refused for.
      throw new Error(
        `part ${id} is an open mark, extracted from the stroked set, and an ` +
          "open mark paints nothing when it is filled rather than stroked. " +
          "Use a closed part, or draw the shape with rect/circle and hole."
      );
    }
    const t = quarterTurn(turn);
    // Reflect then turn, the order `parts/shape.ts` compares under, so a
    // `{turn, flip}` the clusterer measured places back as the same shape.
    const placed = parsePath(p.d).map((sp) =>
      rotateQuarter(flip ? mirrorX(sp) : sp, t)
    );
    const b = bbox(placed);
    const moved = placed.map((sp) =>
      translate(scale(sp, k), x - b.x0 * k, y - b.y0 * k)
    );
    return this.#push((elId) =>
      flip
        ? {
            d: serialise(moved, { grid: this.spec.grid }),
            flip: true,
            id: elId,
            kind: "part",
            partId: id,
            scale: k,
            turn: t,
            x,
            y,
          }
        : {
            d: serialise(moved, { grid: this.spec.grid }),
            id: elId,
            kind: "part",
            partId: id,
            scale: k,
            turn: t,
            x,
            y,
          }
    );
  }

  /** Import existing path data unchanged, so any icon can enter a document. */
  raw(d: string): string {
    return this.#push((id) => ({ d, id, kind: "raw" }));
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
    const { elements: src, log } = this;
    const seq = this.#seq;
    const version = this.#version;
    this.elements = [];
    this.log = [];
    for (const e of src) {
      // A knockout re-emits through the same builder as the solid it borrows
      // from, and lands back at the end of the run — which, replaying in
      // order, is exactly where it started. That is why the hole's tie to its
      // solid is the element order and not a stored id: an id would have to be
      // remapped here, and the remap is the kind of bookkeeping that survives
      // review and not the next change.
      if (e.op === "knockout" && e.kind === "circle") {
        this.hole({
          cx: e.cx * k + tx,
          cy: e.cy * k + ty,
          r: e.r * k,
          shape: "circle",
        });
      } else if (e.op === "knockout" && e.kind === "rect") {
        this.hole({
          h: e.h * k,
          r: e.r,
          shape: "rect",
          w: e.w * k,
          x: e.x * k + tx,
          y: e.y * k + ty,
        });
      } else if (e.kind === "rect") {
        this.rect({
          h: e.h * k,
          r: e.r,
          w: e.w * k,
          x: e.x * k + tx,
          y: e.y * k + ty,
        });
      } else if (e.kind === "circle") {
        this.circle({ cx: e.cx * k + tx, cy: e.cy * k + ty, r: e.r * k });
      } else if (e.kind === "arc") {
        this.arc({
          ccw: e.ccw,
          cx: e.cx * k + tx,
          cy: e.cy * k + ty,
          from: e.from,
          r: e.r * k,
          sweep: e.sweep,
        });
      } else if (e.kind === "dot") {
        this.dot({ cx: e.cx * k + tx, cy: e.cy * k + ty, role: e.role });
      } else if (e.kind === "line") {
        // A similarity transform preserves every angle, so a line that was
        // permitted off-axis must stay permitted or re-emitting it would throw.
        this.line({
          offAxis: e.offAxis,
          points: e.points.map(([x, y]) => [x * k + tx, y * k + ty]),
        });
      } else if (e.kind === "part") {
        // A similarity transform preserves chirality, so the reflection has to
        // be carried through — dropping it would silently un-mirror the part.
        this.part({
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
        this.raw(serialise(moved, { grid: this.spec.grid }));
      }
    }
    // Re-emitting mints fresh ids, but a fit is not a redraw: the handles the
    // model is holding must still name the same shapes afterwards. The
    // elements come back in order, one per source element, so the original ids
    // go back on and the counter is rewound to where it was.
    for (const [i, e] of this.elements.entries()) {
      e.id = src[i].id;
    }
    this.#seq = seq;
    // Re-emitting bumped the version once per element; the whole transform is
    // one mutation, and an identity transform is none. `fit` returns the
    // identity when the drawing is already fitted, and calling it a second
    // time is not progress — leaving the version alone is what lets the loop
    // see that.
    this.#version = version + (k === 1 && tx === 0 && ty === 0 ? 0 : 1);
    this.log = log;
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
    return bbox(this.elements.flatMap((e) => parsePath(e.d)));
  }

  /**
   * The shipping SVG, in whichever finish the document declares.
   *
   * Outlined: the skeleton, stroked, one `<path>` per element, unchanged.
   *
   * Filled: one `<path>` per solid, holding the solid's subpath followed by
   * the subpaths of the holes cut from it, carrying `fill="currentColor"`,
   * `fill-rule="evenodd" clip-rule="evenodd"` and no stroke at all. That is
   * how the set writes them — 57.3% of its filled icons declare `evenodd`,
   * every one of the 1,807 holes is a subpath inside the element it cuts
   * rather than a separate element, and 2,078 of 2,085 carry no stroke.
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
            .map(
              (g) =>
                `<path d="${g.map((e) => e.d).join("")}" fill="currentColor" fill-rule="evenodd" clip-rule="evenodd"/>`
            )
            .join("\n")
        : this.elements
            .map(
              (e) =>
                `<path d="${e.d}" stroke="currentColor" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>`
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
          return e.ccw
            ? {
                ccw: true as const,
                cx: e.cx,
                cy: e.cy,
                from: e.from,
                op: "arc" as const,
                r: e.r,
                sweep: e.sweep,
              }
            : {
                cx: e.cx,
                cy: e.cy,
                from: e.from,
                op: "arc" as const,
                r: e.r,
                sweep: e.sweep,
              };
        }
        if (e.kind === "dot") {
          return { cx: e.cx, cy: e.cy, op: "dot", role: e.role };
        }
        if (e.kind === "line") {
          // Written only when it is true, so a document gains the key when it
          // gains the geometry — a diff that shows `offAxis` shows a real
          // change of shape, not a change of how the line was requested.
          return e.offAxis
            ? { offAxis: true, op: "line", points: e.points }
            : { op: "line", points: e.points };
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
        return { d: e.d, op: "raw" };
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
      } else if (op.op === "dot") {
        c.dot(op);
      } else if (op.op === "line") {
        c.line({ offAxis: op.offAxis, points: op.points });
      } else if (op.op === "part") {
        c.part(op);
      } else if (op.op === "raw") {
        c.raw(op.d);
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
