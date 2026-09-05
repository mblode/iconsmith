import type { DotRole, Keyline } from "../types.js";

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
  /** Optional measured width for named detail lines; never a per-line number. */
  detailStroke?: number;
  /** Explicit sharp joins use SVG miter limit 4; default remains round. */
  strokeJoin?: "round" | "miter";
  strokeCap?: "round" | "square";
  /** Preserve admitted source contours; placement still uses the grid. Legacy default is grid. */
  partGeometry?: "grid" | "source";
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

/** Non-round stroke envelopes require actual painted bounds. */
export const needsStrokeBounds = (spec: Spec): boolean =>
  spec.strokeJoin === "miter" || spec.strokeCap === "square";
