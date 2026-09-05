import { expect, test } from "vitest";

import { bbox, parsePath } from "../geometry/path.js";
import { Canvas, specAt } from "./canvas.js";
import { run } from "./dsl.js";
import { programFromDoc } from "./twin.js";

test.each([1.25, 1.5, 1.875, 2.5])(
  "axial strokes preserve width and center at %s",
  (stroke) => {
    const spec = specAt({ radius: 1, size: 16, stroke });
    for (const points of [
      [
        [6, 6],
        [6, 14],
      ],
      [
        [6, 6],
        [14, 6],
      ],
    ] as [number, number][][]) {
      const c = new Canvas([], { finish: "filled", spec });
      c.line({ points });
      const b = bbox(parsePath(c.elements[0].d));
      expect(b.x0).toBeCloseTo(6 - stroke / 2, 10);
      expect(b.y0).toBeCloseTo(6 - stroke / 2, 10);
      expect(points[0][0] === points[1][0] ? b.w : b.h).toBeCloseTo(stroke, 10);
      c.transform(0.75, 3, 3);
      const doc = c.toJSON({ icon: "bar" });
      expect(Canvas.fromJSON(doc, [], spec).toSVG()).toBe(c.toSVG());
      expect(run(programFromDoc(doc), [], { spec }).canvas.toSVG()).toBe(
        c.toSVG()
      );
    }
  }
);
test("axial knockout preserves fractional center and its selected target on replay", () => {
  const spec = specAt({ radius: 1, size: 16, stroke: 1.875 });
  const c = new Canvas([], { finish: "filled", spec });
  const target = c.rect({ h: 20, w: 20, x: 2, y: 2 });
  c.circle({ cx: 20, cy: 20, r: 1 });
  c.hole({
    cutFrom: target,
    points: [
      [6, 6],
      [6, 14],
    ],
    shape: "line",
  });
  const hole = c.elements.find((e) => e.op === "knockout");
  if (!hole) {
    throw new Error("Missing hole");
  }
  const b = bbox(parsePath(hole.d));
  expect(b.w).toBe(1.875);
  expect(b.x0).toBe(5.0625);
  const doc = c.toJSON({ icon: "counter" });
  expect(doc.draw[1]).toMatchObject({ knockout: true, op: "line" });
  expect(Canvas.fromJSON(doc, [], spec).toSVG()).toBe(c.toSVG());
  expect(run(programFromDoc(doc), [], { spec }).canvas.toSVG()).toBe(c.toSVG());
});
