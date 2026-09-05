import { expect, test } from "vitest";

import { bbox, parsePath } from "../geometry/path.js";
import { Canvas, specAt } from "./canvas.js";
import { run } from "./dsl.js";
import { programFromDoc } from "./twin.js";

const points: [number, number][] = [
  [6, 6],
  [18, 18],
];
const widthOf = (d: string, normal: [number, number]) => {
  const body = parsePath(d).find((p) => p.segs.every((s) => s.t === "L"));
  if (!body) {
    throw new Error("Missing straight bar body");
  }
  const values = [body.start, ...body.segs.map((s) => s.p.slice(-2))].map(
    (p) => p[0] * normal[0] + p[1] * normal[1]
  );
  return Math.max(...values) - Math.min(...values);
};
test.each([1.25, 1.5, 2, 2.5])(
  "filled diagonal preserves %s width and cap diameter",
  (stroke) => {
    const c = new Canvas([], {
      finish: "filled",
      spec: specAt({ radius: 1, size: 24, stroke }),
    });
    c.line({ points });
    expect(
      widthOf(c.elements[0].d, [-1 / Math.sqrt(2), 1 / Math.sqrt(2)])
    ).toBeCloseTo(stroke, 10);
    for (const cap of parsePath(c.elements[0].d).slice(0, 2)) {
      const b = bbox([cap]);
      expect(b.w).toBeCloseTo(stroke, 10);
      expect(b.h).toBeCloseTo(stroke, 10);
    }
  }
);
test("off-axis expansion and knockout use the same correct width and replay", () => {
  const spec = specAt({ radius: 1, size: 24, stroke: 1.5 });
  const diagonal: [number, number][] = [
    [6, 7],
    [18, 15],
  ];
  const len = Math.hypot(12, 8);
  const normal: [number, number] = [-8 / len, 12 / len];
  const c = new Canvas([], { finish: "filled", spec });
  c.rect({ h: 20, r: 1, w: 20, x: 2, y: 2 });
  c.hole({ offAxis: true, points: diagonal, shape: "line" });
  expect(widthOf(c.elements[1].d, normal)).toBeCloseTo(1.5, 10);
  const doc = c.toJSON({ icon: "cut" });
  expect(Canvas.fromJSON(doc, [], spec).toSVG()).toBe(c.toSVG());
  const replay = run(programFromDoc(doc), [], { spec });
  expect(replay.errors).toEqual([]);
  expect(replay.canvas.toSVG()).toBe(c.toSVG());
});
test("similarity transform preserves diagonal ink weight", () => {
  const spec = specAt({ radius: 1, size: 24, stroke: 1.5 });
  const c = new Canvas([], { finish: "filled", spec });
  c.line({ points });
  c.transform(0.5, 3, 3);
  expect(
    widthOf(c.elements[0].d, [-1 / Math.sqrt(2), 1 / Math.sqrt(2)])
  ).toBeCloseTo(1.5, 10);
});
