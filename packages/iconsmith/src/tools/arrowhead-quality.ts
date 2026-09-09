import { parsePath } from "../geometry/path.js";
import type { Issue, Subpath } from "../types.js";
import { SPEC } from "./canvas.js";
import type { LintElement, LintTarget } from "./lint.js";

type Point = [number, number];
const EPSILON = 0.001;
const distance = (a: Point, b: Point): number =>
  Math.hypot(a[0] - b[0], a[1] - b[1]);

const painted = (element: LintElement): boolean =>
  element.strokeWidth !== 0 && !element.hole && element.op !== "knockout";

/** Recognise only a separate symmetric, right-angle, two-segment head. */
const head = (path: Subpath): { tip: Point; depth: number } | null => {
  const [first, second] = path.segs;
  if (
    path.closed ||
    path.segs.length !== 2 ||
    first?.t !== "L" ||
    second?.t !== "L"
  ) {
    return null;
  }
  const tip = first.p;
  const a = [path.start[0] - tip[0], path.start[1] - tip[1]];
  const b = [second.p[0] - tip[0], second.p[1] - tip[1]];
  const length = Math.hypot(...a);
  if (
    length < EPSILON ||
    Math.abs(length - Math.hypot(...b)) > EPSILON ||
    Math.abs(a[0] * b[0] + a[1] * b[1]) > EPSILON
  ) {
    return null;
  }
  return { depth: Math.hypot((a[0] + b[0]) / 2, (a[1] + b[1]) / 2), tip };
};

const curveEnds = (path: Subpath): Point[] => {
  if (path.closed) {
    return [];
  }
  const ends: Point[] = [];
  const [first] = path.segs;
  const last = path.segs.at(-1);
  if (first?.t === "C") {
    ends.push(path.start);
  }
  if (last?.t === "C") {
    ends.push([last.p[4], last.p[5]]);
  }
  return ends;
};

/**
 * Development regression for the rejected database-backup construction: a
 * compact chevron attached directly at a curved endpoint. When its depth is
 * less than one stroke width, the head has less than a stroke width of axial
 * reach behind its tip, and the curve compounds that crowded junction.
 *
 * This is a review warning, not an aesthetic verdict or a general arrow rule.
 * Only outlined, separately drawn symmetric 90-degree heads at cubic endpoints
 * are recognised. Straight shafts, standalone checks, filled outlines, SVG arc
 * commands and heads embedded inside longer paths are outside this diagnostic.
 * A clean result cannot establish arrowhead quality. No geometry is changed.
 */
export const arrowheadQualityIssues = (canvas: LintTarget): Issue[] => {
  if ((canvas.finish ?? "outlined") !== "outlined") {
    return [];
  }
  const elements = canvas.elements.filter(painted).map((element) => ({
    element,
    paths: parsePath(element.d),
  }));
  const issues: Issue[] = [];
  for (const { element, paths } of elements) {
    if (paths.length !== 1) {
      continue;
    }
    const candidate = head(paths[0]);
    const width = element.strokeWidth ?? canvas.spec?.stroke ?? SPEC.stroke;
    if (!candidate || candidate.depth >= width - EPSILON) {
      continue;
    }
    const curve = elements.find(
      (other) =>
        other.element.id !== element.id &&
        other.paths.some((path) =>
          curveEnds(path).some((end) => distance(end, candidate.tip) < EPSILON)
        )
    );
    if (curve) {
      issues.push({
        message: `"${element.id}" has a ${candidate.depth.toFixed(2)}-unit arrowhead depth below its ${width.toFixed(2)}-unit stroke width, with its tip directly on curved endpoint "${curve.element.id}". This compact curved junction matches the rejected database-backup construction; inspect the arrowhead at native size and consider more head depth or a tangent shaft extension. This warning does not assess other arrow constructions.`,
        rule: "arrowhead-quality",
        severity: "warn",
      });
    }
  }
  return issues;
};
