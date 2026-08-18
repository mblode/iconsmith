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
import type { Box, DotRole, DrawOp, IconDoc, Keyline, Part } from "../types.js";

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
export const SPEC = {
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
} as const satisfies {
  canvas: number;
  clearance: number;
  dots: Record<DotRole, number>;
  grid: number;
  keylines: Record<Keyline, readonly [number, number]>;
  minGap: number;
  radiusTiers: readonly number[];
  stroke: number;
};

/** Circular arc → cubic control handle ratio. */
const K = 0.5523;

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
const onCanvas = (v: number) => q(clamp(v, 0, SPEC.canvas), SPEC.grid);
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
 *  result to half the shape, which is geometry rather than style. */
const tierRadius = (r: number): number =>
  r === 0 ? 0 : nearest(SPEC.radiusTiers, r);

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

export type Element =
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
    };

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

export class Canvas {
  elements: Element[] = [];
  log: string[] = [];
  readonly parts: Map<string, Part>;

  constructor(parts: Part[] = []) {
    this.parts = new Map(parts.map((p) => [p.id, p]));
  }

  #push(make: (id: string) => Element): string {
    const id = `e${this.elements.length}`;
    const el = make(id);
    this.elements.push(el);
    this.log.push(`${el.kind} → ${id}`);
    return id;
  }

  /** Rounded rectangle. Radius is snapped to the tier system. */
  rect({
    x,
    y,
    w,
    h,
    r = 2,
  }: {
    h: number;
    r?: number;
    w: number;
    x: number;
    y: number;
  }): string {
    const X = onCanvas(x);
    const Y = onCanvas(y);
    const W = q(w, SPEC.grid);
    const H = q(h, SPEC.grid);
    const R = Math.min(tierRadius(r), W / 2, H / 2);
    return this.#push((id) => ({
      d: rectPath(X, Y, W, H, R),
      h: H,
      id,
      kind: "rect",
      r: R,
      w: W,
      x: X,
      y: Y,
    }));
  }

  circle({ cx, cy, r }: { cx: number; cy: number; r: number }): string {
    const X = onCanvas(cx);
    const Y = onCanvas(cy);
    const R = q(r, SPEC.grid);
    return this.#push((id) => ({
      cx: X,
      cy: Y,
      d: circlePath(X, Y, R),
      id,
      kind: "circle",
      r: R,
    }));
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
      [onCanvas(pts[0][0]), onCanvas(pts[0][1])],
    ];
    let free = false;
    for (let i = 1; i < pts.length; i += 1) {
      const [px, py] = out[i - 1];
      const {
        offBy,
        point: [sx, sy],
      } = snapAngle(px, py, onCanvas(pts[i][0]), onCanvas(pts[i][1]));
      if (offBy > 0) {
        if (!offAxis) {
          throw new Error(offAxisMessage(i, [px, py], [sx, sy], offBy));
        }
        free = true;
      }
      out.push([q(sx, SPEC.grid), q(sy, SPEC.grid)]);
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
    role = "terminal",
  }: {
    cx: number;
    cy: number;
    role?: DotRole;
  }): string {
    const size = SPEC.dots[role];
    if (!size) {
      throw new Error(
        `dot role must be one of ${Object.keys(SPEC.dots).join(", ")} — got "${role}"`
      );
    }
    const X = onCanvas(cx);
    const Y = onCanvas(cy);
    const r = q(Math.max(0, (size - SPEC.stroke) / 2), SPEC.grid);
    return this.#push((id) => ({
      cx: X,
      cy: Y,
      d: r === 0 ? `M${X} ${Y}L${X} ${Y}` : circlePath(X, Y, r),
      id,
      kind: "dot",
      role,
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
            d: serialise(moved, { grid: SPEC.grid }),
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
            d: serialise(moved, { grid: SPEC.grid }),
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
    this.elements = [];
    this.log = [];
    for (const e of src) {
      if (e.kind === "rect") {
        this.rect({
          h: e.h * k,
          r: e.r,
          w: e.w * k,
          x: e.x * k + tx,
          y: e.y * k + ty,
        });
      } else if (e.kind === "circle") {
        this.circle({ cx: e.cx * k + tx, cy: e.cy * k + ty, r: e.r * k });
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
        this.raw(serialise(moved, { grid: SPEC.grid }));
      }
    }
    this.log = log;
    this.log.push(`transform ×${k} +${q(tx, SPEC.grid)},${q(ty, SPEC.grid)}`);
  }

  remove(id: string): { remaining: number; removed: string } {
    const i = this.elements.findIndex((e) => e.id === id);
    if (i === -1) {
      throw new Error(`no element ${id}`);
    }
    this.elements.splice(i, 1);
    this.log.push(`remove ${id}`);
    return { remaining: this.elements.length, removed: id };
  }

  clear(): void {
    this.elements = [];
    this.log.push("clear");
  }

  bbox(): Box | null {
    if (!this.elements.length) {
      return null;
    }
    return bbox(this.elements.flatMap((e) => parsePath(e.d)));
  }

  /** Outline variant: the skeleton, stroked. This is what ships. */
  toSVG({ stroke = SPEC.stroke }: { stroke?: number } = {}): string {
    const { canvas: size } = SPEC;
    const paths = this.elements
      .map(
        (e) =>
          `<path d="${e.d}" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round"/>`
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
    return {
      draw: this.elements.map((e): DrawOp => {
        if (e.kind === "rect") {
          return { h: e.h, op: "rect", r: e.r, w: e.w, x: e.x, y: e.y };
        }
        if (e.kind === "circle") {
          return { cx: e.cx, cy: e.cy, op: "circle", r: e.r };
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
  }

  static fromJSON(doc: IconDoc, parts: Part[] = []): Canvas {
    const c = new Canvas(parts);
    for (const op of doc.draw ?? []) {
      if (op.op === "rect") {
        c.rect(op);
      } else if (op.op === "circle") {
        c.circle(op);
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
    id: string;
    kind: string;
    w: number;
    x: number;
    y: number;
  }[] {
    return this.elements.map((e) => {
      const b = bbox(parsePath(e.d));
      return {
        h: +b.h.toFixed(2),
        id: e.id,
        kind: e.kind,
        w: +b.w.toFixed(2),
        x: +b.x0.toFixed(2),
        y: +b.y0.toFixed(2),
      };
    });
  }
}
