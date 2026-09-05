import { expect, test } from "vitest";

import { parsePath } from "../geometry/path.js";
import { roundedLinePath } from "../geometry/rounded-line.js";
import { Canvas, specAt } from "./canvas.js";
import { run } from "./dsl.js";
import { programFromDoc, adaptProgram } from "./twin.js";

const spec = specAt({ radius: 1, size: 24, stroke: 1.5 });
const program =
  "icon ribbon\nfinish outlined\nline 5,3 19,3 19,22 12,17.25 5,22 5,3 r1 off-axis";

test("convex and concave fillets have tangent-continuous line/curve joins", () => {
  const [path] = parsePath(
    roundedLinePath(
      [
        [5, 3],
        [19, 3],
        [19, 22],
        [12, 17.25],
        [5, 22],
        [5, 3],
      ],
      1
    )
  );
  expect(path.closed).toBe(true);
  let prev = path.start;
  const spans = path.segs.map((seg) => {
    if (seg.t === "A") {
      throw new Error("Unexpected arc");
    }
    const end: [number, number] = seg.t === "L" ? seg.p : [seg.p[4], seg.p[5]];
    const startT =
      seg.t === "L"
        ? [end[0] - prev[0], end[1] - prev[1]]
        : [seg.p[0] - prev[0], seg.p[1] - prev[1]];
    const endT =
      seg.t === "L" ? startT : [end[0] - seg.p[2], end[1] - seg.p[3]];
    prev = end;
    return { endT, startT };
  });
  // Z supplies the closing straight edge; test its tangent too.
  const closing = [path.start[0] - prev[0], path.start[1] - prev[1]];
  spans.push({ endT: closing, startT: closing });
  for (let i = 0; i < spans.length; i += 1) {
    const a = spans[i].endT,
      b = spans[(i + 1) % spans.length].startT;
    const denominator = Math.hypot(...a) * Math.hypot(...b);
    expect(denominator).toBeGreaterThan(0);
    expect(Math.abs(a[0] * b[1] - a[1] * b[0]) / denominator).toBeLessThan(
      0.00002
    );
    expect((a[0] * b[0] + a[1] * b[1]) / denominator).toBeGreaterThan(0.99999);
  }
});
test("open path preserves endpoints and constructs a quarter circle", () => {
  const [path] = parsePath(
    roundedLinePath(
      [
        [2, 2],
        [10, 2],
        [10, 10],
      ],
      2
    )
  );
  expect(path.start).toEqual([2, 2]);
  expect(path.segs[0]).toEqual({ p: [8, 2], t: "L" });
  const [, arc] = path.segs;
  expect(arc.t).toBe("C");
  expect(arc.p.slice(-2)).toEqual([10, 4]);
  expect(path.segs.at(-1)?.p).toEqual([10, 10]);
});
test.each([
  [
    [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
      [0, 0],
    ],
    1,
  ],
  [
    [
      [0, 0],
      [2, 0],
      [0, 0],
      [0, 2],
    ],
    1,
  ],
  [
    [
      [0, 0],
      [0, 0],
      [2, 2],
    ],
    1,
  ],
  [
    [
      [0, 0],
      [2, 0],
      [2, 2],
    ],
    Infinity,
  ],
  [
    [
      [0, 0],
      [Number.NaN, 0],
      [2, 2],
    ],
    1,
  ],
] as [[number, number][], number][])(
  "rejects invalid or overlapping corner geometry (%j)",
  (points, r) => {
    expect(() => roundedLinePath(points, r)).toThrow();
  }
);
test("DSL, document, serialized program and transformed recipe retain rounding", () => {
  const result = run(program, [], { spec });
  expect(result.errors).toEqual([]);
  const { canvas } = result;
  const svg = canvas.toSVG();
  const doc = canvas.toJSON({ icon: "ribbon" });
  expect(Canvas.fromJSON(doc, [], spec).toSVG()).toBe(svg);
  expect(programFromDoc(doc)).toContain(" r1");
  expect(run(programFromDoc(doc), [], { spec }).canvas.toSVG()).toBe(svg);
  canvas.transform(0.8, 2, 2);
  expect(canvas.elements[0]).toMatchObject({ kind: "line", r: 1 });
  expect(
    Canvas.fromJSON(canvas.toJSON({ icon: "ribbon" }), [], spec).toSVG()
  ).toBe(canvas.toSVG());
});
test("tiering, atomic failure and filled conversion", () => {
  const canvas = new Canvas([], { spec });
  canvas.line({
    points: [
      [3, 3],
      [12, 3],
      [12, 12],
    ],
    r: 0.9,
  });
  expect(canvas.elements[0]).toMatchObject({ r: 1 });
  const before = canvas.toSVG();
  expect(() =>
    canvas.line({
      points: [
        [3, 3],
        [3.25, 3],
        [3.25, 3.25],
      ],
      r: 1,
    })
  ).toThrow(/does not fit/u);
  expect(canvas.toSVG()).toBe(before);
  const filled = run(adaptProgram(program, "filled", spec), [], { spec });
  expect(filled.errors).toEqual([]);
  expect(filled.canvas.elements[0]).toMatchObject({ r: 1 });
  expect(run("line 2,2 8,2 8,8 r1 r2", [], { spec }).errors.join(" ")).toMatch(
    /one radius/u
  );
});
