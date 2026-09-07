/** Curve-aware host geometry. Never exposed as a model-facing path API. */
import paper from "paper";

import { parsePath } from "../geometry/path.js";
import { roundIntersections } from "./boolean-round.js";

export type BooleanOperation = "subtract" | "trim" | "union";
export interface BooleanOperand {
  d: string;
  fillRule?: "evenodd" | "nonzero";
}

/** Positive filled overlap, excluding tangent contact and overlapping bboxes.
 * Used for diagnostics only; this does not change the submitted geometry. */
export const pathsOverlap = (left: string, right: string): boolean => {
  if ([left, right].some((d) => parsePath(d).some((p) => !p.closed))) {
    return false;
  }
  const scope = new paper.PaperScope();
  scope.setup(new scope.Size(24, 24));
  try {
    const make = (d: string) =>
      new scope.CompoundPath({
        fillRule: "evenodd",
        insert: false,
        pathData: d,
      });
    const intersection = make(left).intersect(make(right), { insert: false });
    return (
      (intersection instanceof scope.Path ||
        intersection instanceof scope.CompoundPath) &&
      Math.abs(intersection.area) > 1e-6
    );
  } finally {
    scope.project.remove();
  }
};

/** Keep cubic curves and computed intersections; do not flatten or grid-snap
 * the result. Inputs have already passed through the constrained builders. */
export const combinePaths = (
  operation: BooleanOperation,
  left: BooleanOperand,
  right: BooleanOperand,
  { allowEmpty = false, radius }: { allowEmpty?: boolean; radius?: number } = {}
): string => {
  if (!["subtract", "trim", "union"].includes(operation)) {
    throw new Error("Unsupported Boolean operation");
  }
  if (radius !== undefined && operation === "trim") {
    throw new Error("Intersection rounding requires filled Boolean operands");
  }
  for (const [index, input] of [left, right].entries()) {
    const paths = parsePath(input.d);
    if (
      !paths.length ||
      ((operation !== "trim" || index === 1) &&
        paths.some((path) => !path.closed))
    ) {
      throw new Error("Boolean operands must be nonempty closed shapes");
    }
  }
  // Each operation owns its scope: no shared scene, active project or leaked item.
  const scope = new paper.PaperScope();
  scope.setup(new scope.Size(24, 24));
  try {
    const make = (input: BooleanOperand): paper.PathItem =>
      new scope.CompoundPath({
        fillRule: input.fillRule ?? "evenodd",
        insert: false,
        pathData: input.d,
      });
    const a = make(left);
    const b = make(right);
    // Paper's non-tracing subtraction requires individual paths. Snapshot and
    // clone children: subtraction can otherwise mutate the parent's child list.
    const trim = () =>
      new scope.CompoundPath({
        insert: false,
        pathData: [...a.children]
          .map(
            (child) =>
              (child as paper.Path)
                .clone({ insert: false })
                .subtract(b, { insert: false, trace: false }).pathData
          )
          .join(""),
      });
    let result: paper.PathItem;
    if (operation === "trim") {
      result = trim();
    } else if (operation === "union") {
      result = a.unite(b, { insert: false });
    } else {
      result = a.subtract(b, { insert: false });
    }
    const data = (
      radius === undefined
        ? result
        : roundIntersections(
            scope,
            result,
            a.getIntersections(b).map((location) => location.point),
            radius
          )
    ).pathData;
    if (!data && !allowEmpty) {
      throw new Error("Boolean operation removes the entire shape");
    }
    parsePath(data);
    return data;
  } finally {
    scope.project.remove();
  }
};
