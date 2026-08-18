/**
 * House-spec checks over a drawn icon.
 *
 * Split by who can act on the result: `error` blocks a commit, `warn` is a
 * judgment call the model is told about and a human arbitrates. Nothing here
 * repairs geometry — repair belongs to the primitives, which never emit a
 * violation in the first place. This catches composition mistakes: bad keyline,
 * off-centre, elements too close, empty canvas.
 *
 * One rule here is not about the icon at all. `cohort-align` compares it to the
 * icons it swaps with, because an icon that is individually perfect and out of
 * step with its family still makes a list twitch when it is toggled in. See
 * `cohort.ts`; that comparison also decides whether `centred` has anything
 * useful to say.
 */
import { bbox, parsePath } from "../geometry/path.js";
import { flatten } from "../parts/shape.js";
import type { Box, Issue, Keyline } from "../types.js";
import { SPEC } from "./canvas.js";
import type { CohortView } from "./cohort.js";
import { verdict } from "./cohort.js";
import { cuts } from "./cut.js";

/** The shape lint needs from a canvas: drawn path data with a name to blame. */
export interface LintElement {
  d: string;
  id: string;
}

export interface LintTarget {
  elements: LintElement[];
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

const CENTRE = 12;
const CENTRE_TOLERANCE = 0.25;
/** Half a unit is stricter than the set's own practice: 61% of visual extents
 *  land on a whole unit, so ±1 is the window that measures intent. */
const KEYLINE_TOLERANCE = 1;
const LIVE_MIN = 1;
const LIVE_MAX = 23;
const MAX_ELEMENTS = 8;
/** Below this two points are the same point, not a gap worth reporting. */
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

/** Closest approach between two elements, or null when either draws nothing. */
const minDistance = (a: LintElement, b: LintElement): number | null => {
  const pa = parsePath(a.d).flatMap((sp) => flatten(sp, FLATTEN_STEPS));
  const pb = parsePath(b.d).flatMap((sp) => flatten(sp, FLATTEN_STEPS));
  if (pa.length === 0 || pb.length === 0) {
    return null;
  }
  let min = Number.POSITIVE_INFINITY;
  for (const p of pa) {
    for (const qq of pb) {
      const d = Math.hypot(p[0] - qq[0], p[1] - qq[1]);
      if (d < min) {
        min = d;
      }
    }
  }
  return min;
};

/**
 * Off-centre content, as a warning rather than an error, and silent when the
 * icon agrees with the icons it swaps with. A family aligned off-centre is
 * deliberate work: nudging one member onto (12,12) to satisfy this rule breaks
 * an alignment and introduces the flicker `cohort-align` exists to catch.
 */
const centring = (b: Box, agreesWithCohort: boolean): Issue | null => {
  const cx = b.x0 + b.w / 2;
  const cy = b.y0 + b.h / 2;
  if (
    agreesWithCohort ||
    (near(cx, CENTRE, CENTRE_TOLERANCE) && near(cy, CENTRE, CENTRE_TOLERANCE))
  ) {
    return null;
  }
  return {
    message: `Content centre is (${cx.toFixed(2)}, ${cy.toFixed(2)}); the house spec is (12, 12) within ${CENTRE_TOLERANCE}. Shift by (${(CENTRE - cx).toFixed(2)}, ${(CENTRE - cy).toFixed(2)}) unless the icons this one swaps with sit here too.`,
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

const bleedIssue = (b: Box): Issue | null =>
  b.x0 < LIVE_MIN || b.y0 < LIVE_MIN || b.x1 > LIVE_MAX || b.y1 > LIVE_MAX
    ? {
        message: "Geometry reaches the canvas edge; the live area is 2..22.",
        rule: "bleed",
        severity: "error",
      }
    : null;

/** Minimum gap, measured between flattened polylines rather than bboxes, so two
 *  nested shapes are not falsely reported as touching. */
const gapIssues = (els: LintElement[]): Issue[] => {
  const issues: Issue[] = [];
  for (let i = 0; i < els.length; i += 1) {
    for (let j = i + 1; j < els.length; j += 1) {
      const gap = minDistance(els[i], els[j]);
      if (gap !== null && gap > TOUCHING && gap < SPEC.minGap) {
        issues.push({
          message: `${els[i].id} and ${els[j].id} are ${gap.toFixed(2)}px apart; minimum is ${SPEC.minGap}px. Move them apart or knock one out of the other.`,
          rule: "gap",
          severity: "warn",
        });
      }
    }
  }
  return issues;
};

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

export const lint = (
  canvas: LintTarget,
  { cohort = null, keyline = null }: LintOptions = {}
): Issue[] => {
  const els = canvas.elements;
  if (els.length === 0) {
    return [{ message: "Canvas is empty.", rule: "empty", severity: "error" }];
  }

  const b = bbox(els.flatMap((e) => parsePath(e.d)));
  // Visual extent includes half the stroke on each side — the distinction that
  // invalidated the previous revision's keyline measurements.
  const vx = b.w + SPEC.stroke;
  const vy = b.h + SPEC.stroke;

  // Cohort first: whether the icon agrees with what it swaps with decides
  // whether its own centring is worth mentioning at all.
  const cohortVerdict = cohort ? verdict(cohort) : null;
  const issues: Issue[] = (cohortVerdict?.messages ?? []).map((message) => ({
    message,
    rule: "cohort-align",
    severity: "error" as const,
  }));

  for (const issue of [
    centring(b, cohortVerdict?.agrees ?? false),
    keylineIssue(vx, vy, keyline),
    bleedIssue(b),
  ]) {
    if (issue) {
      issues.push(issue);
    }
  }
  issues.push(...gapIssues(els), ...cutIssues(els));

  if (els.length > MAX_ELEMENTS) {
    issues.push({
      message: `${els.length} elements. Blode icons are median 3-4; consider reducing detail.`,
      rule: "density",
      severity: "warn",
    });
  }
  return issues;
};

export const format = (issues: Issue[]): string =>
  issues.length > 0
    ? issues.map((i) => `[${i.severity}] ${i.rule}: ${i.message}`).join("\n")
    : "clean — no violations";
