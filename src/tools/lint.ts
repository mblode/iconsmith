/**
 * House-spec checks over a drawn icon.
 *
 * Split by who can act on the result: `error` blocks a commit, `warn` is a
 * judgment call the model is told about and a human arbitrates. Nothing here
 * repairs geometry — repair belongs to the primitives, which never emit a
 * violation in the first place. This catches composition mistakes: bad keyline,
 * off-centre, elements too close, empty canvas.
 */
import { bbox, parsePath } from "../geometry/path.js";
import { flatten } from "../parts/shape.js";
import type { Issue, Keyline } from "../types.js";
import { SPEC } from "./canvas.js";

/** The shape lint needs from a canvas: drawn path data with a name to blame. */
export interface LintElement {
  d: string;
  id: string;
}

export interface LintTarget {
  elements: LintElement[];
}

export interface LintOptions {
  /** The keyline the icon claims. Null means "match whichever fits". */
  keyline?: Keyline | null;
}

const CENTRE = 12;
const CENTRE_TOLERANCE = 0.25;
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

export const lint = (
  canvas: LintTarget,
  { keyline = null }: LintOptions = {}
): Issue[] => {
  const issues: Issue[] = [];
  const els = canvas.elements;
  if (els.length === 0) {
    return [{ message: "Canvas is empty.", rule: "empty", severity: "error" }];
  }

  const all = els.flatMap((e) => parsePath(e.d));
  const b = bbox(all);
  // Visual extent includes half the stroke on each side — the distinction that
  // invalidated the previous revision's keyline measurements.
  const vx = b.w + SPEC.stroke;
  const vy = b.h + SPEC.stroke;

  const cx = b.x0 + b.w / 2;
  const cy = b.y0 + b.h / 2;
  if (
    !(near(cx, CENTRE, CENTRE_TOLERANCE) && near(cy, CENTRE, CENTRE_TOLERANCE))
  ) {
    issues.push({
      message: `Content centre is (${cx.toFixed(2)}, ${cy.toFixed(2)}); must be (12, 12) within ${CENTRE_TOLERANCE}. Shift by (${(CENTRE - cx).toFixed(2)}, ${(CENTRE - cy).toFixed(2)}).`,
      rule: "centred",
      severity: "error",
    });
  }

  const fits = Object.values(SPEC.keylines).some(
    ([w, h]) => near(vx, w, KEYLINE_TOLERANCE) && near(vy, h, KEYLINE_TOLERANCE)
  );
  if (keyline) {
    const [kw, kh] = SPEC.keylines[keyline];
    if (!(near(vx, kw, KEYLINE_TOLERANCE) && near(vy, kh, KEYLINE_TOLERANCE))) {
      issues.push({
        message: `Visual extent is ${vx.toFixed(1)}×${vy.toFixed(1)}; keyline "${keyline}" wants ${kw}×${kh} (±${KEYLINE_TOLERANCE}). Scale by ${Math.max(kw / vx, kh / vy).toFixed(3)}.`,
        rule: "keyline",
        severity: "error",
      });
    }
  } else if (!fits) {
    issues.push({
      message: `Visual extent ${vx.toFixed(1)}×${vy.toFixed(1)} matches no keyline (circle 20×20, square 18×18, wide 20×16, tall 16×20).`,
      rule: "keyline",
      severity: "warn",
    });
  }

  if (
    b.x0 < LIVE_MIN ||
    b.y0 < LIVE_MIN ||
    b.x1 > LIVE_MAX ||
    b.y1 > LIVE_MAX
  ) {
    issues.push({
      message: "Geometry reaches the canvas edge; the live area is 2..22.",
      rule: "bleed",
      severity: "error",
    });
  }

  // Minimum gap, measured between flattened polylines rather than bboxes, so
  // two nested shapes are not falsely reported as touching.
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
