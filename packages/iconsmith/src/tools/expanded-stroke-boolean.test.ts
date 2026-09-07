import { expect, test } from "vitest";

import { parsePath } from "../geometry/path.js";
import { combinePaths } from "./boolean.js";
import { run } from "./dsl.js";
import { expandStroke } from "./stroke.js";

const onlyPath = (program: string): string => {
  const result = run(program);
  expect(result.errors).toEqual([]);
  expect(result.canvas.elements).toHaveLength(1);
  return result.canvas.elements[0]?.d ?? "";
};

test("a closed expanded cutter stays solid through union and subtraction", () => {
  // The concave plus is constructed entirely by the public DSL. PathKit emits
  // its stroke as oppositely oriented inner/outer contours, so treating that
  // band as even-odd leaves four tiny notch holes at the internal corners.
  const counter = onlyPath(
    "finish filled\nrect 10,7 4x10 r1\nrect 7,10 10x4 r1\nunion"
  );
  const outer = onlyPath("finish filled\ncircle 12,12 r10");
  const band = expandStroke(counter, 0.5);
  const expandedCounter = combinePaths(
    "union",
    { d: counter, fillRule: "nonzero" },
    { d: band, fillRule: "nonzero" }
  );

  // One contour proves the stroke's inner contour did not become a parity
  // hole. The final two contours are exactly the outer paint and its counter.
  expect(parsePath(expandedCounter)).toHaveLength(1);
  const paint = combinePaths(
    "subtract",
    { d: outer, fillRule: "nonzero" },
    { d: expandedCounter, fillRule: "nonzero" }
  );
  expect(parsePath(paint)).toHaveLength(2);

  // This is the failure mode the explicit fill rule prevents.
  const parityCounter = combinePaths("union", { d: counter }, { d: band });
  expect(parsePath(parityCounter).length).toBeGreaterThan(1);
});
