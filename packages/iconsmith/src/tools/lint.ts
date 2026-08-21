/**
 * House-spec checks over a drawn icon.
 *
 * Split by who can act on the result: `error` blocks a commit, `warn` is a
 * judgment call the model is told about and a human arbitrates. `lint` returns
 * only those; `review` keeps the questions that passed, so a viewer can show
 * the whole chain (keyline, gap, hole, axes) rather than a blank "clean". Nothing
 * here repairs geometry — repair belongs to the primitives, which never emit a
 * violation in the first place. This catches composition mistakes: bad keyline,
 * off-centre, elements too close, empty canvas, and — `substance` — a canvas
 * with a stroke on it that nobody would call an icon.
 *
 * Fill mode changes two of these and nothing else. `bleed`'s live area moves
 * with the ink (`LIVE_INSET`) and `gap` is replaced by `feature`
 * (`featureIssues`), because a filled icon's shapes are supposed to touch.
 * Everything else — keyline, centring, substance, cut, off-axis, density —
 * carries over untouched, which is a measured result rather than an
 * assumption: a filled icon and its outlined twin occupy the same visual
 * extent in 94% of the 2,085 pairs in `bench/filled-language.v1.json`.
 *
 * One rule here is not about the icon at all. `cohort-align` compares it to the
 * icons it swaps with, because an icon that is individually perfect and out of
 * step with its family still makes a list twitch when it is toggled in. See
 * `cohort.ts`; that comparison also decides whether `centred` has anything
 * useful to say.
 */
import { bbox, parsePath, polylineDistance } from "../geometry/path.js";
import { flatten } from "../parts/shape.js";
import type { Box, Finish, Issue, Keyline } from "../types.js";
import { iconEdgeAngles, offAxisEdges } from "./angle.js";
import { SPEC } from "./canvas.js";
import type { Spec } from "./canvas.js";
import type { CohortView } from "./cohort.js";
import { verdict } from "./cohort.js";
import { cuts } from "./cut.js";

/** The shape lint needs from a canvas: drawn path data with a name to blame. */
export interface LintElement {
  d: string;
  id: string;
  /**
   * The program asked for this geometry off 0/45/90 by name.
   *
   * `Canvas.line` writes it only when a segment *actually* stayed off every
   * axis, so it is the geometry and the permission at once — a line that asked
   * and did not need to has no flag.
   *
   * It does not silence the rule, and the reasoning is worth keeping because
   * an earlier revision had it the other way round. `canvas.ts` calls the flag
   * "permission, not instruction" and puts the request in the `IconDoc` so
   * that "a reviewer sees it"; suppressing the finding is the one outcome that
   * defeats that purpose. Worse, it would make the rule structurally dead on
   * the path that matters: the canvas *refuses* an undeclared diagonal, so
   * every off-axis edge that reaches lint from a program is declared by
   * construction, and declared-means-silent leaves nothing for the rule to
   * ever say about a generated icon. It is calibrated at 29.3% of the corpus
   * precisely because it is meant to fire and be read.
   *
   * So a declared diagonal warns, carrying {@link Issue.declared} so the
   * message can ask a reviewer to agree rather than telling them to fix it.
   *
   * Absent on a caller reading a shipped SVG, which carries no declaration —
   * an unasked-for diagonal in the corpus is exactly what the rule is for.
   */
  offAxis?: boolean;
  /**
   * 0 for a filled shape, and the house width when omitted.
   *
   * A caller reading shipped SVGs has the real widths and should pass them.
   * A `Canvas` sets no width at all, which is why the finish is consulted
   * rather than this field alone: before fill mode a canvas only ever drew
   * strokes, so the default was the truth, and afterwards every filled element
   * inherited a 2 it does not have. See {@link offAxisIssues}.
   */
  strokeWidth?: number;
  /**
   * A knockout (`hole`). Canvas writes `op: "knockout"`; a document
   * round-trip may set `hole` instead. Absent means ink.
   */
  hole?: boolean;
  /**
   * The primitive that drew this element. Present on a `Canvas`; absent
   * when linting a shipped SVG. Hole targeting uses it so a wide body
   * that happens to contain a later knockout is not called a solid disc.
   */
  kind?: string;
  /** Canvas knockout flag. Same meaning as {@link hole}. */
  op?: "add" | "knockout";
}

export interface LintTarget {
  elements: LintElement[];
  /**
   * The finish the drawing is in. Absent means `outlined`, so a bare
   * `{ elements }` — which is what `commands/lint.ts` builds from a shipped
   * SVG, and what every caller built before fill mode — is judged exactly as
   * it was. A `Canvas` carries its own finish, so passing one is enough.
   */
  finish?: Finish;
  /** The cut to judge against. Absent means the house 24/2/3 spec. */
  spec?: Spec;
}

export interface LintOptions {
  /**
   * Where this icon stands among the icons it swaps with. Supplying it turns on
   * `cohort-align` and lets a cohort agreement outrank the per-icon `centred`
   * rule; omitting it leaves lint judging the icon alone, as it always has.
   */
  cohort?: CohortView | null;
  /** The keyline the icon claims. Null means "match whichever fits". */
  keyline?: Keyline | null;
}

const CENTRE_TOLERANCE = 0.25;
/** Half a unit is stricter than the set's own practice: 61% of visual extents
 *  land on a whole unit, so ±1 is the window that measures intent. */
const KEYLINE_TOLERANCE = 1;
/**
 * The live area, as an inset on the path bounds, per finish.
 *
 * Both are the same rule stated twice: the visual extent must stay inside the
 * 24-unit canvas. In stroke mode the ink hangs half a width past the path, so
 * the path bounds have to stop a unit short of the edge, which is the 1..23
 * this rule has always enforced. Filled, the path *is* the boundary, so the
 * same rule is 0..24 — and the inset has to move with the finish, or a filled
 * icon whose visual extent exactly matches its outlined twin's, which 94% of
 * them do, would fail a rule its twin passes.
 *
 * The failure rates confirm the translation rather than assume it. Path bounds
 * at 1..23 fail 54 of the 2,085 outlined icons (2.6%); a visual extent at or
 * outside the canvas edge fails 2.4% of the 2,085 filled ones. Two readings of
 * one rule landing within 0.2 points of each other is what a correct
 * translation looks like.
 */
const LIVE_INSET_FILLED = 0;
const TOUCHING = 0.01;
/** Segments per curve when flattening for distance. Coarser than fingerprinting
 *  needs, because a gap only has to be measured to a fraction of a px. */
const FLATTEN_STEPS = 6;

const near = (a: number, b: number, tol: number): boolean =>
  Math.abs(a - b) <= tol;

/** The closest keyline to an extent, named with the distance to it, so an
 *  off-keyline warning says which way to move rather than only that it should. */
const nearestName = (vx: number, vy: number): string => {
  let best = "";
  let bestGap = Number.POSITIVE_INFINITY;
  for (const [name, [w, h]] of Object.entries(SPEC.keylines)) {
    const gap = Math.max(Math.abs(vx - w), Math.abs(vy - h));
    if (gap < bestGap) {
      bestGap = gap;
      best = `${name} ${w}×${h} (${gap.toFixed(1)} away)`;
    }
  }
  return best;
};

/** Closest approach between two elements, or null when either draws nothing.
 *  Flatten turns curves into polylines; distance is then segment-to-segment.
 *  Vertex-to-vertex over flatten is endpoints-only for a straight, so it
 *  reported a 0.485 overhang on a slash that already crossed a ring (`ban`)
 *  and missed staggered parallels whose edges sat under `minGap`. */
const minDistance = (a: LintElement, b: LintElement): number | null => {
  const pa = parsePath(a.d).flatMap((sp) => flatten(sp, FLATTEN_STEPS));
  const pb = parsePath(b.d).flatMap((sp) => flatten(sp, FLATTEN_STEPS));
  return polylineDistance(pa, pb);
};

/**
 * Off-centre content, as a warning rather than an error, and silent when the
 * icon agrees with the icons it swaps with. A family aligned off-centre is
 * deliberate work: nudging one member onto (12,12) to satisfy this rule breaks
 * an alignment and introduces the flicker `cohort-align` exists to catch.
 */
const centring = (
  b: Box,
  agreesWithCohort: boolean,
  spec: Spec
): Issue | null => {
  const centre = spec.canvas / 2;
  const cx = b.x0 + b.w / 2;
  const cy = b.y0 + b.h / 2;
  if (
    agreesWithCohort ||
    (near(cx, centre, CENTRE_TOLERANCE) && near(cy, centre, CENTRE_TOLERANCE))
  ) {
    return null;
  }
  return {
    message: `Content centre is (${cx.toFixed(2)}, ${cy.toFixed(2)}); the house spec is (${centre}, ${centre}) within ${CENTRE_TOLERANCE}. Shift by (${(centre - cx).toFixed(2)}, ${(centre - cy).toFixed(2)}) unless the icons this one swaps with sit here too.`,
    rule: "centred",
    severity: "warn",
  };
};

/** Every keyline as `name w×h`, built from the spec so the message cannot
 *  describe a different set of shapes than the check tests against. */
const KEYLINE_LIST = Object.entries(SPEC.keylines)
  .map(([name, [w, h]]) => `${name} ${w}×${h}`)
  .join(", ");

/**
 * Visual extent against the keyline the icon claims, or against all of them
 * when it claims none.
 *
 * The two rungs are deliberate. Claiming a keyline and missing it is an
 * **error**: the icon states an intent and does not meet it, which is a
 * contradiction inside one document rather than a judgement about the house
 * style. Sitting on no keyline at all is a **warning**, because the corpus
 * itself does not obey one — 24% of Central's icons sit more than a unit from
 * every named shape even after `landscape` and `portrait` were added, and
 * Central's own documentation calls the key shapes "merely guidelines".
 * A rule that failed those 500 icons would be a rule against the set rather
 * than for it, and would teach everyone to ignore the linter.
 *
 * The ±1 tolerance is the set's own practice: 61% of visual extents land on a
 * whole unit, so a half-unit window is stricter than the thing it measures.
 */
const keylineIssue = (
  vx: number,
  vy: number,
  keyline: Keyline | null
): Issue | null => {
  if (keyline) {
    const [kw, kh] = SPEC.keylines[keyline];
    if (near(vx, kw, KEYLINE_TOLERANCE) && near(vy, kh, KEYLINE_TOLERANCE)) {
      return null;
    }
    return {
      message: `Visual extent is ${vx.toFixed(1)}×${vy.toFixed(1)}; keyline "${keyline}" wants ${kw}×${kh} (±${KEYLINE_TOLERANCE}). Scale by ${Math.max(kw / vx, kh / vy).toFixed(3)}.`,
      rule: "keyline",
      severity: "error",
    };
  }
  const fits = Object.values(SPEC.keylines).some(
    ([w, h]) => near(vx, w, KEYLINE_TOLERANCE) && near(vy, h, KEYLINE_TOLERANCE)
  );
  return fits
    ? null
    : {
        message: `Visual extent ${vx.toFixed(1)}×${vy.toFixed(1)} matches no keyline within ±${KEYLINE_TOLERANCE} (${KEYLINE_LIST}). Nearest is ${nearestName(vx, vy)}. Off-keyline is legal — Central's key shapes are guidelines — so treat this as a prompt to check the size was chosen, not drifted.`,
        rule: "keyline",
        severity: "warn",
      };
};

/**
 * Geometry outside the live area.
 *
 * Two things about this rule are not what they look like, and both are
 * deliberate rather than settled.
 *
 * It measures the **path bbox**, not the visual extent — the only rule here
 * that does. Every other measurement in this file inflates by the stroke, half
 * a width per side, because that is what a reader sees. This one does not, and
 * the constants are the compensation: `SPEC.clearance` is 2 and `prompt.ts`
 * tells the model 2, but 2 units of clearance measured on the visual extent
 * fails 771 of the house variant's 2,085 icons (37.0%) — the same 37% that
 * `canvas.ts` records against its own `clearance` figure. Measured on the path
 * bbox at 1 unit, which is what the constants below actually say, it fails 54
 * (2.6%). The other two readings: path bbox at 2 fails 233 (11.2%), visual
 * extent at 1 fails 148 (7.1%).
 *
 * So the enforced rule is *not* the spec's rule, and this is an error-severity
 * gate, so the gap is load-bearing. It is left alone here on purpose: closing
 * it either way is a design decision about the 165-icon wide family that
 * `canvas.ts` documents as unresolved, not a bug to be patched by a linter.
 * What was fixed is the message, which claimed to enforce 2..22 while enforcing
 * 1..23 — it is now built from the constants so it cannot drift again.
 */
/**
 * The floors below which a drawing is not a drawing.
 *
 * Both are read off the corpus rather than chosen, and both sit inside a gap in
 * the measured distribution rather than against its edge, because a threshold
 * that touches a real value is one corpus revision away from being wrong.
 *
 * Across all 30 corpus variants — 62,550 icons — the minor visual dimension
 * (the smaller of the two) has a hard floor of 2.0 in the twelve outlined
 * variants, and the next value up is 5.2. Exactly three icons sit on that
 * floor: `minus-small`, `minus-medium`, `minus-large`, whose subject *is* a
 * bar. Nothing occupies 2.0..5.2 except `dot-grid-1x3-*` at exactly 4.0, so
 * `MIN_MINOR = 3` is the midpoint of the only stretch of that axis the set has
 * never used. The major dimension's floor is 6.8 (`chevron-triangle-up-small`
 * in the radius-1 and radius-2 outlined variants); `MIN_MAJOR = 6` clears it
 * and fires on nothing in any variant.
 *
 * A fraction-of-the-smallest-keyline threshold, the obvious form for this rule,
 * does not survive the measurement: the smallest keyline dimension is 16, and
 * even a quarter of it — 4.0 — lands on `dot-grid`, while 0.4 of it takes out
 * the whole `chevron-*-small` family. The set draws deliberately small marks,
 * so the only defensible floor is far below any fraction worth writing down.
 */
const MIN_MINOR = 3;
const MIN_MAJOR = 6;

/**
 * A drawing with no substance: too thin to have a second dimension, or too
 * small to be any icon the set draws.
 *
 * This is the rule that makes `clean` mean "finished". Every other check here
 * is a question about a drawing that exists — is it centred, does it sit on a
 * keyline, are its edges on an axis — and a single stroke answers all of them
 * acceptably. `M7 3L7 21` is a 2×20 vertical line, dead centre, on no keyline
 * (a warning), on axis, and it linted clean; the generation loop shipped it as
 * `git-branch` and the eval panel counted it as a success.
 *
 * `error` rather than `warn`, which is the opposite of the call made for
 * `off-axis` (29.3% of the set) and for the no-keyline case (24%), because the
 * false-positive rate is three orders of magnitude smaller: 3 of 2,085 icons
 * per outlined variant, 0.14%, and 0 in the filled variants. The rule this file
 * already gates on, `bleed`, fails 2.6% of the same set. The cost is precise
 * and worth naming: under an error gate the loop cannot draw the `minus`
 * family, whose subject is a single bar. One concept, against a failure mode
 * that silently scores an abandoned icon as a good one.
 */
const substanceIssue = (vx: number, vy: number): Issue | null => {
  const minor = Math.min(vx, vy);
  const major = Math.max(vx, vy);
  if (minor >= MIN_MINOR && major >= MIN_MAJOR) {
    return null;
  }
  const why =
    minor < MIN_MINOR
      ? `is ${minor.toFixed(1)} across its short axis, which is the stroke and nothing else — the drawing is a single bare stroke`
      : `is ${major.toFixed(1)} at its widest, smaller than any icon in the set (the smallest is chevron-triangle-small at 6.8)`;
  return {
    message: `Visual extent ${vx.toFixed(1)}×${vy.toFixed(1)} ${why}. This is an unfinished icon, not a spare one: draw the elements that make the subject readable. If the subject genuinely is a bar or a dot, this rule is wrong for it and the icon needs a human.`,
    rule: "substance",
    severity: "error",
  };
};

const bleedIssue = (b: Box, finish: Finish, spec: Spec): Issue | null => {
  const lo = finish === "filled" ? LIVE_INSET_FILLED : spec.stroke / 2;
  const hi = spec.canvas - lo;
  return b.x0 < lo || b.y0 < lo || b.x1 > hi || b.y1 > hi
    ? {
        message: `Geometry reaches the canvas edge; the live area is ${lo}..${hi}, measured on the path bounds rather than the visual extent.`,
        rule: "bleed",
        severity: "error",
      }
    : null;
};

/** Minimum gap, measured edge-to-edge on flattened polylines rather than
 *  vertex-to-vertex or by bbox, so two nested shapes are not falsely
 *  reported as touching and two staggered parallels are not missed. */
const gapIssues = (els: LintElement[], spec: Spec): Issue[] => {
  const issues: Issue[] = [];
  for (let i = 0; i < els.length; i += 1) {
    for (let j = i + 1; j < els.length; j += 1) {
      const gap = minDistance(els[i], els[j]);
      if (gap !== null && gap > TOUCHING && gap < spec.minGap) {
        issues.push({
          message: `${els[i].id} and ${els[j].id} are ${gap.toFixed(2)}px apart; minimum is ${spec.minGap}px. Move them apart or knock one out of the other.`,
          rule: "gap",
          severity: "warn",
        });
      }
    }
  }
  return issues;
};

/**
 * Fill mode's replacement for `gap`, and the inversion is the point.
 *
 * `gap` asks whether two elements are too close, and in a filled icon the
 * question is meaningless: a hole shares its edge with the solid it is cut
 * from, so the tightest distance between them is zero by construction, and
 * only 1.4% of the set's 6,693 filled solid pairs are separated at all.
 * Running `gap` here would fire on the icons that are drawn correctly and stay
 * silent on the ones that are not — a rule against the set, which is the thing
 * this file refuses to be.
 *
 * What actually goes wrong when a filled icon is drawn badly is a feature too
 * small to survive: a hole so narrow it closes up at 16px, where one design
 * unit is 0.667px and a feature needs 1.5 units to clear a whole pixel. That
 * is `SPEC.minFeature`, and it sits in the tail of the set's practice rather
 * than at its mode — the smallest dimension of the 1,807 measured holes has
 * median 3.0, p25 2.0, p10 1.95, and the threshold catches 6.6% of them.
 *
 * `warn`, the tier `gap` sits in, for the same reason: the set itself ships
 * work below the line (`safari` alone has 11 holes under 0.44 units), so this
 * is a prompt to look, not a gate.
 */
const isHole = (e: LintElement): boolean =>
  e.hole === true || e.op === "knockout";

const boxOf = (e: LintElement): Box => bbox(parsePath(e.d));

const containsBox = (outer: Box, inner: Box): boolean =>
  inner.x0 >= outer.x0 - TOUCHING &&
  inner.y0 >= outer.y0 - TOUCHING &&
  inner.x1 <= outer.x1 + TOUCHING &&
  inner.y1 <= outer.y1 + TOUCHING;

const centreOf = (b: Box): [number, number] => [b.x0 + b.w / 2, b.y0 + b.h / 2];

const nearCentre = (a: Box, b: Box): boolean => {
  const [ax, ay] = centreOf(a);
  const [bx, by] = centreOf(b);
  const tol = Math.max(1.5, 0.2 * Math.min(a.w, a.h));
  return Math.hypot(ax - bx, ay - by) <= tol;
};

/** A disc or square frame that a concentric hole would turn into a ring. */
const isDisc = (e: LintElement, b: Box): boolean => {
  if (e.kind === "dot" || e.kind === "line" || e.kind === "arc") {
    return false;
  }
  if (e.kind === "circle") {
    return true;
  }
  const minor = Math.min(b.w, b.h);
  return minor > 0 && Math.max(b.w, b.h) / minor <= 1.2;
};

interface SolidGroup { holes: LintElement[]; solid: LintElement }

const groupsOf = (els: LintElement[]): SolidGroup[] => {
  const groups: SolidGroup[] = [];
  for (const e of els) {
    if (isHole(e) && groups.length > 0) {
      groups.at(-1)?.holes.push(e);
    } else if (!isHole(e)) {
      groups.push({ holes: [], solid: e });
    }
  }
  return groups;
};

/**
 * A hole that cut the wrong solid and left a disc uncut.
 *
 * `Canvas.hole` defaults to the most recently drawn solid. A mark between
 * `circle` and `hole` takes the knockout — or is refused if the hole does
 * not fit — and the circle ships as a solid disc. `cutFrom` stores the
 * hole with the named solid, so that order is quiet.
 *
 * Filled only. The earlier solid has to look like a disc or square frame
 * (a wide body that merely contains a later lens is not one), the hole
 * has to sit inside it and share its centre, and the intervening mark
 * has to sit inside it too — a mark between a ring and its counter.
 */
const holeIssues = (els: LintElement[], finish: Finish): Issue[] => {
  if (finish !== "filled") {
    return [];
  }
  const groups = groupsOf(els);
  const issues: Issue[] = [];
  for (let i = 0; i < groups.length; i += 1) {
    const { holes, solid } = groups[i];
    const host = boxOf(solid);
    for (const hole of holes) {
      const cut = boxOf(hole);
      for (let j = 0; j < i; j += 1) {
        const earlier = groups[j];
        if (earlier.holes.length > 0) {
          continue;
        }
        const disc = boxOf(earlier.solid);
        if (
          !isDisc(earlier.solid, disc) ||
          !containsBox(disc, cut) ||
          !containsBox(disc, host) ||
          !nearCentre(disc, cut)
        ) {
          continue;
        }
        issues.push({
          message: `${hole.id} sits inside ${earlier.solid.id} but cuts ${solid.id}; ${earlier.solid.id} ships as a solid disc — \`cutFrom ${earlier.solid.id}\`, or draw the hole immediately after the ring.`,
          rule: "hole",
          severity: "error",
        });
      }
    }
  }
  return issues;
};

const featureIssues = (els: LintElement[], spec: Spec): Issue[] =>
  els.flatMap((e) => {
    const b = bbox(parsePath(e.d));
    const minor = Math.min(b.w, b.h);
    return minor >= spec.minFeature
      ? []
      : [
          {
            message: `${e.id} is ${minor.toFixed(2)}px across its short axis; below ${spec.minFeature}px a filled feature closes up at ${spec.size}px. Widen it, or drop it — a hole nobody can see is ink nobody asked for.`,
            rule: "feature",
            severity: "warn" as const,
          },
        ];
  });

/** Nothing in blode-icons or Central cuts below this. The floor is literal
 *  rather than approached: `fork-spoon` and `knife-spoon` cut the middle tine
 *  by exactly 3.00 where the bowl crosses it, and the next cut up is 4.08. A
 *  floor guards against work the set would not do; this one sits exactly at
 *  the tightest thing it does. */
const MIN_CUT = 3;

/**
 * A notch too small to read as a notch.
 *
 * Not a duplicate of `gap`, which is the minimum perpendicular ink distance
 * between two elements — "are these two too close". A cut is the arc length
 * removed *along* the interrupted stroke — "is the hole big enough to read as
 * a hole". A 2px stroke crossing a background at 45° needs ~2.8 units of notch
 * to leave the visual gap a perpendicular crossing gets from 2. See `cut.ts`
 * for the definition and its four failure modes.
 *
 * `warn` rather than `error` for two reasons, both structural: the detector
 * can mis-pair two loose ends into a cut nobody drew, and a cut is a spacing
 * judgement, which is the tier `gap` already sits in.
 */
const cutIssues = (els: LintElement[]): Issue[] =>
  cuts(els)
    .filter((c) => c.length < MIN_CUT)
    .map((c) => {
      const [a, b] = c.interrupted;
      // A cut splits a subpath, not necessarily a `<path>`: usually one element
      // holds both sides of the notch and naming it twice reads as a typo.
      const notched = a === b ? a : `${a} and ${b}`;
      return {
        message: `${c.interrupter} cuts ${notched} by ${c.length.toFixed(2)}px at (${c.at[0].toFixed(1)}, ${c.at[1].toFixed(1)}); minimum is ${MIN_CUT}px. Widen the notch or move ${c.interrupter} clear of it.`,
        rule: "cut",
        severity: "warn" as const,
      };
    });

/**
 * Straight edges that sit on no permitted axis.
 *
 * The measurement is `angle.ts`'s, at `canvas.ts`'s own tolerance and against
 * `canvas.ts`'s own axes, both imported rather than restated: a rule that
 * forbade what the primitives draw, or permitted what they refuse, would be
 * worse than no rule. Stroked shapes only — a quarter of the set ships as
 * outline-expanded fills whose round joins are a fan of short segments at
 * whatever angle the flattener chose (30% off-axis, against 15% for the
 * stroked shapes), so measuring them reports Figma's expander rather than
 * anybody's design.
 *
 * `warn` rather than `error` because at that tolerance it fires on 480 of
 * 1,640 stroked blode-icons (29.3%) and 475 of 1,622 in Central (29.3%).
 * Central is the specification; a rule that failed 29% of the specification
 * set would be a rule against the set, which is the same doctrine that keeps
 * the no-keyline case a warning.
 *
 * No isometric exemption. The 30° band does not survive being looked at: only
 * 8.4% of the off-axis mass is within 0.5° of exactly 30°, the band is three
 * spikes rather than one cluster, ±3° sweeps in `star-half`, `pin` and
 * `graduate-cap`, and the cubes that motivate the exemption (`ar-cube-1` and
 * `ar-cube-2` at 29.36°, `ar-scan-cube` at 29.75°) fall outside it anyway.
 */
/**
 * One line per element per distinct angle, not per segment.
 *
 * A closed diamond has four edges and two distinct headings, so measuring
 * per segment reports the same two facts twice each — four warnings naming one
 * element, with two angles repeated. That reads as four problems and is one.
 * The count is kept in the message, because "two edges at 114.4°" and "one
 * edge at 114.4°" are different drawings.
 */
const offAxisFindings = (
  e: LintElement
): { angle: number; axis: number; count: number; offBy: number }[] => {
  const groups = new Map<
    string,
    { angle: number; axis: number; count: number; offBy: number }
  >();
  for (const edge of offAxisEdges(iconEdgeAngles([e.d]))) {
    const key = `${edge.angle.toFixed(1)}@${edge.axis}`;
    const seen = groups.get(key);
    if (seen) {
      seen.count += 1;
    } else {
      groups.set(key, {
        angle: edge.angle,
        axis: edge.axis,
        count: 1,
        offBy: edge.offBy,
      });
    }
  }
  return [...groups.values()];
};

const edgeWord = (n: number): string => (n === 1 ? "an edge" : `${n} edges`);

/**
 * Off-axis findings, one per element per distinct heading.
 *
 * Filled drawings are skipped whole rather than filtered by width. `angle.ts`
 * says to hand in stroked shapes only — an outline-expanded fill puts a fan of
 * short segments at whatever angle the flattener chose around every round join,
 * 30% of them off-axis against 15% of the stroked ones, so measuring one
 * reports the expander and not a decision. `strokeWidth` cannot carry that
 * distinction on its own: a `Canvas` sets no width, so every filled element
 * read as stroked-at-2 the moment fill mode existed. The finish is the field
 * that knows, and it is the same swap `gap`/`feature` already makes.
 */
const offAxisIssues = (
  els: LintElement[],
  spec: Spec,
  finish: Finish
): Issue[] => {
  if (finish === "filled") {
    return [];
  }
  const issues: Issue[] = [];
  for (const e of els.filter((x) => (x.strokeWidth ?? spec.stroke) > 0)) {
    for (const f of offAxisFindings(e)) {
      const at = `"${e.id}" has ${edgeWord(f.count)} at ${f.angle.toFixed(1)}°, ${f.offBy.toFixed(1)}° off the nearest permitted axis (${f.axis}°)`;
      issues.push(
        e.offAxis
          ? {
              declared: "off-axis",
              message: `${at}, and the program declared \`off-axis\` for it. Nothing to fix — confirm the diagonal is the drawing. Off-axis edges are 29.3% of the set's stroked icons, so this is the set's own habit rather than drift.`,
              rule: "off-axis",
              severity: "warn",
            }
          : {
              message: `${at}. The house axes are 0/45/90; an edge between two grid points is not automatically on one. If the diagonal is the shape, say so — \`off-axis\` on the line — and this becomes a confirmation rather than a fix.`,
              rule: "off-axis",
              severity: "warn",
            }
      );
    }
  }
  return issues;
};

/**
 * The same finding twice is one finding.
 *
 * Rules are composed here rather than being one pass, so two of them can reach
 * the same conclusion about the same pair — and a caller that lints a drawing
 * once per finish concatenates. A duplicate reads as a second problem, which is
 * the difference between "four things are wrong with the compass" and "one
 * thing is". Identity is the rule and the message: the message names the
 * element and the measurement, so two identical strings are the same fact.
 */
const dedupe = (issues: Issue[]): Issue[] => {
  const seen = new Set<string>();
  return issues.filter((i) => {
    const key = `${i.severity}\u0000${i.rule}\u0000${i.message}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
};

/** Everything the house spec has to say about a drawing. */
export const lint = (
  canvas: LintTarget,
  { cohort = null, keyline = null }: LintOptions = {}
): Issue[] => {
  const els = canvas.elements;
  if (els.length === 0) {
    return [{ message: "Canvas is empty.", rule: "empty", severity: "error" }];
  }

  const finish = canvas.finish ?? "outlined";
  const spec = canvas.spec ?? SPEC;
  const b = bbox(els.flatMap((e) => parsePath(e.d)));
  // Visual extent includes half the ink on each side — the distinction that
  // invalidated the previous revision's keyline measurements, and the one
  // adjustment fill mode needs to inherit every extent rule unchanged: a
  // filled path *is* its own boundary, so there is nothing to add. That the
  // rules then carry over is measured, not assumed — filled and outlined twins
  // occupy the same visual extent in 94% of 2,085 pairs.
  const ink = finish === "filled" ? 0 : spec.stroke;
  const vx = b.w + ink;
  const vy = b.h + ink;

  // Cohort first: whether the icon agrees with what it swaps with decides
  // whether its own centring is worth mentioning at all.
  const cohortVerdict = cohort ? verdict(cohort) : null;
  const issues: Issue[] = (cohortVerdict?.messages ?? []).map((message) => ({
    message,
    rule: "cohort-align",
    severity: "error" as const,
  }));

  for (const issue of [
    // First, because a drawing that fails this answers every question below it
    // acceptably and means none of the answers.
    substanceIssue(vx, vy),
    centring(b, cohortVerdict?.agrees ?? false, spec),
    keylineIssue(vx, vy, keyline),
    bleedIssue(b, finish, spec),
  ]) {
    if (issue) {
      issues.push(issue);
    }
  }
  // The one rule that swaps rather than adapts. See `featureIssues`: in a
  // filled icon shapes are meant to touch, so "how far apart are these" has no
  // answer worth having and "is this feature big enough to see" does.
  issues.push(
    ...(finish === "filled" ? featureIssues(els, spec) : gapIssues(els, spec)),
    ...holeIssues(els, finish),
    ...cutIssues(els),
    ...offAxisIssues(els, spec, finish)
  );

  if (els.length > spec.maxElements) {
    issues.push({
      message: `${els.length} elements. At ${spec.size}px the ceiling is ${spec.maxElements}; fewer, larger marks survive.`,
      rule: "density",
      severity: "warn",
    });
  }
  return dedupe(issues);
};

/**
 * Three states, because a declared diagonal is a `warn` and not a fourth thing.
 *
 * An earlier revision had a `waived` state here, on the reasoning that "the
 * compass needle is deliberately off 135°" and "the compass needle happens to
 * be on 135°" are different drawings and must not collapse into one `pass`.
 * They are different, and they still do not collapse: the declared case is a
 * `warn` carrying {@link Issue.declared} and the on-axis case is a `pass`. The
 * distinction the fourth state was introduced to protect is the reason it is
 * not needed.
 */
export type CheckStatus = "error" | "pass" | "warn";

/** One house-spec question, including the ones that passed. `lint` returns
 *  only failures; the viewer needs the rest of the chain so a clean card
 *  still says *why* it is clean (keyline, gap, axes), not only that it is. */
export interface Check {
  message: string;
  rule: string;
  status: CheckStatus;
}

/**
 * The keyline an extent may honestly claim, or null when it sits on none.
 *
 * Exported because {@link keylineIssue} holds a *declared* keyline to an
 * **error**: an icon that states an intent and misses it is a contradiction
 * inside one document. That rung only works if whatever writes the `keyline`
 * line can check the claim before making it, and `reconstruct.ts` could not —
 * it wrote `keyline square` on every compile without measuring anything, so
 * `fingerprint` at 18.5×19.8, which is the portrait 18×20 to within half a
 * unit, was failed for missing a box it had never been aimed at. A rule that
 * strict needs a way to tell the truth beside it.
 */
export const declarableKeyline = (vx: number, vy: number): Keyline | null => {
  for (const [name, [w, h]] of Object.entries(SPEC.keylines)) {
    if (near(vx, w, KEYLINE_TOLERANCE) && near(vy, h, KEYLINE_TOLERANCE)) {
      return name as Keyline;
    }
  }
  return null;
};

const matchedKeyline = (vx: number, vy: number): string | null => {
  const name = declarableKeyline(vx, vy);
  if (name === null) {
    return null;
  }
  const [w, h] = SPEC.keylines[name];
  return `${name} ${w}×${h}`;
};

const passMessage = (
  rule: string,
  ctx: {
    box: Box;
    finish: Finish;
    keyline: Keyline | null;
    n: number;
    spec: Spec;
    vx: number;
    vy: number;
  }
): string => {
  switch (rule) {
    case "bleed": {
      const lo =
        ctx.finish === "filled" ? LIVE_INSET_FILLED : ctx.spec.stroke / 2;
      return `Path bounds sit inside the live area ${lo}..${ctx.spec.canvas - lo}.`;
    }
    case "centred": {
      const cx = ctx.box.x0 + ctx.box.w / 2;
      const cy = ctx.box.y0 + ctx.box.h / 2;
      return `Content centre (${cx.toFixed(2)}, ${cy.toFixed(2)}) sits on (${ctx.spec.canvas / 2}, ${ctx.spec.canvas / 2}).`;
    }
    case "cohort-align": {
      return "Agrees with the icons it swaps with.";
    }
    case "cut": {
      return `Every notch along a stroke is at least ${MIN_CUT}px.`;
    }
    case "density": {
      return `${ctx.n} element(s), under the ceiling of ${ctx.spec.maxElements} at ${ctx.spec.size}px.`;
    }
    case "feature": {
      return `Every filled feature is at least ${ctx.spec.minFeature}px across its short axis.`;
    }
    case "gap": {
      return `Every separated pair is at least ${ctx.spec.minGap}px apart, or coincident.`;
    }
    case "hole": {
      return "Every hole cuts the solid it sits in — none left a disc uncut.";
    }
    case "keyline": {
      if (ctx.keyline) {
        const [w, h] = SPEC.keylines[ctx.keyline];
        return `Visual extent ${ctx.vx.toFixed(1)}×${ctx.vy.toFixed(1)} matches declared keyline "${ctx.keyline}" (${w}×${h}).`;
      }
      const hit = matchedKeyline(ctx.vx, ctx.vy);
      return hit
        ? `Visual extent ${ctx.vx.toFixed(1)}×${ctx.vy.toFixed(1)} matches ${hit}.`
        : `Visual extent ${ctx.vx.toFixed(1)}×${ctx.vy.toFixed(1)} was compared to the key shapes.`;
    }
    case "off-axis": {
      return "Every stroked edge sits on 0/45/90.";
    }
    case "substance": {
      return `Visual extent ${ctx.vx.toFixed(1)}×${ctx.vy.toFixed(1)} has a second dimension — this is a drawing, not a stroke.`;
    }
    default: {
      return "Passed.";
    }
  }
};

/**
 * The same questions `lint` asks, with the passes kept.
 *
 * Order matches `lint`: substance, centring, keyline, bleed, then gap or
 * feature, then hole (filled), then cut, off-axis, density. Cohort alignment leads when a
 * family was supplied. A rule that fired more than once (two gaps) keeps
 * every failure; a rule that fired none gets one pass line.
 */
export const review = (
  canvas: LintTarget,
  options: LintOptions = {}
): Check[] => {
  const issues = lint(canvas, options);
  if (canvas.elements.length === 0) {
    return issues.map((i) => ({
      message: i.message,
      rule: i.rule,
      status: i.severity,
    }));
  }
  const finish = canvas.finish ?? "outlined";
  const spec = canvas.spec ?? SPEC;
  const b = bbox(canvas.elements.flatMap((e) => parsePath(e.d)));
  const ink = finish === "filled" ? 0 : spec.stroke;
  const ctx = {
    box: b,
    finish,
    keyline: options.keyline ?? null,
    n: canvas.elements.length,
    spec,
    vx: b.w + ink,
    vy: b.h + ink,
  };
  const rules = [
    ...(options.cohort ? ["cohort-align"] : []),
    "substance",
    "centred",
    "keyline",
    "bleed",
    finish === "filled" ? "feature" : "gap",
    ...(finish === "filled" ? ["hole"] : []),
    "cut",
    "off-axis",
    "density",
  ];
  const checks: Check[] = [];
  for (const rule of rules) {
    const found = issues.filter((i) => i.rule === rule);
    if (found.length === 0) {
      checks.push({ message: passMessage(rule, ctx), rule, status: "pass" });
      continue;
    }
    checks.push(
      ...found.map((i) => ({
        message: i.message,
        rule: i.rule,
        status: i.severity as CheckStatus,
      }))
    );
  }
  return checks;
};

export const format = (issues: Issue[]): string =>
  issues.length > 0
    ? issues.map((i) => `[${i.severity}] ${i.rule}: ${i.message}`).join("\n")
    : "clean — no violations";
