import paper from "paper";
import sharp from "sharp";
import { expect, test } from "vitest";

import { combinePaths } from "./boolean.js";
import { Canvas } from "./canvas.js";
import { completeProgram, run } from "./dsl.js";
import { programFromDoc } from "./twin.js";

const draw = (s: string) => run(`icon fillet\nfinish filled\n${s}`);
const sharpCorners = (d: string) => {
  const scope = new paper.PaperScope();
  scope.setup(new scope.Size(24, 24));
  try {
    const p = new scope.CompoundPath({ insert: false, pathData: d });
    return (p.children as paper.Path[]).flatMap((path) =>
      path.curves.filter(
        (curve, i, curves) =>
          Math.abs(
            curves[(i + curves.length - 1) % curves.length]
              .getTangentAtTime(1)
              .getDirectedAngle(curve.getTangentAtTime(0))
          ) > 0.1
      )
    );
  } finally {
    scope.project.remove();
  }
};
test("round only new intersections, preserve existing square corners and replay", () => {
  const r = draw("rect 3,3 18x18 r0\nrect 9,15 6x9 r0\nsubtract r1");
  expect(r.errors).toEqual([]);
  const doc = r.canvas.toJSON({ icon: r.icon, keyline: r.keyline });
  expect(doc.draw[0]).toMatchObject({ op: "boolean", radius: 1 });
  expect(sharpCorners(r.canvas.elements[0].d)).toHaveLength(6);
  const program = programFromDoc(doc);
  expect(program).toContain("subtract r1");
  expect(completeProgram(doc, program)).toBe(true);
  expect(Canvas.fromJSON(doc).toSVG()).toBe(r.canvas.toSVG());
  expect(run(program).canvas.toSVG()).toBe(r.canvas.toSVG());
});
test.each([
  ["curved shield", "circle 12,12 r9\nrect 9,15 6x9 r0"],
  ["bell", "rect 5,3 14x18 r4\ncircle 12,21 r4"],
  ["folder", "rect 2,5 20x14 r3\nrect 14,14 9x9 r1"],
  [
    "overlapping cutters",
    "circle 12,12 r9\ncircle 9,20 r4\ncircle 15,20 r4\nunion",
  ],
])("%s gets tangent fillets and replay", (_, source) => {
  const before = draw(`${source}\nsubtract`);
  const after = draw(`${source}\nsubtract r0.5`);
  expect(after.errors).toEqual([]);
  expect(sharpCorners(after.canvas.elements[0].d).length).toBeLessThan(
    sharpCorners(before.canvas.elements[0].d).length
  );
  expect(JSON.stringify(after.canvas.toJSON())).not.toContain('"op":"raw"');
  expect(Canvas.fromJSON(after.canvas.toJSON()).toSVG()).toBe(
    after.canvas.toSVG()
  );
});
test("analytic perpendicular fillet trims one radius from both edges", () => {
  const d = combinePaths(
    "subtract",
    { d: "M0 0H20V20H0Z" },
    { d: "M8 14H12V24H8Z" },
    { radius: 1 }
  );
  const scope = new paper.PaperScope();
  scope.setup(new scope.Size(24, 24));
  try {
    const p = new scope.CompoundPath({ insert: false, pathData: d });
    expect(p.contains(new scope.Point(7.9, 19.9))).toBe(false);
    expect(p.contains(new scope.Point(7, 19))).toBe(true);
    for (const point of [new scope.Point(7, 20), new scope.Point(8, 19)]) {
      expect(p.getNearestPoint(point).getDistance(point)).toBeLessThan(1e-4);
    }
  } finally {
    scope.project.remove();
  }
});
test("invalid rounding refuses atomically", () => {
  const c = new Canvas([], { finish: "filled" });
  c.rect({ h: 18, r: 0, w: 18, x: 3, y: 3 });
  c.rect({ h: 14, r: 0, w: 16, x: 4, y: 10 });
  const before = c.toSVG();
  expect(() => c.combine("subtract", undefined, undefined, 4)).toThrow(
    "does not fit"
  );
  expect(() => c.combine("subtract", undefined, undefined, 0.7)).toThrow(
    "family tier"
  );
  expect(c.toSVG()).toBe(before);
  for (const program of [
    "circle 12,12 r8\ncircle 12,12 r4\nsubtract r1",
    "circle 12,12 r4\ncircle 12,12 r8\nsubtract r1",
    "rect 3,3 10x10 r1\nrect 8,8 10x10 r1\ntrim r1",
  ]) {
    expect(draw(program).errors).not.toEqual([]);
  }
});
test("reversed winding preserves rounded ink", () => {
  const a = { d: "M0 0H20V20H0Z", fillRule: "nonzero" as const };
  expect(
    combinePaths("subtract", a, { d: "M8 14H12V24H8Z" }, { radius: 1 })
  ).toBe(combinePaths("subtract", a, { d: "M8 14V24H12V14Z" }, { radius: 1 }));
});

test("independent SVG arc oracle agrees at native and retina sizes", async () => {
  const d = combinePaths(
    "subtract",
    { d: "M0 0H20V20H0Z" },
    { d: "M8 14H12V24H8Z" },
    { radius: 1 }
  );
  const oracle = "M0 0H20V20H13A1 1 0 0 1 12 19V14H8V19A1 1 0 0 1 7 20H0Z";
  for (const size of [16, 24, 48]) {
    const render = (value: string) =>
      sharp(
        Buffer.from(
          `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-2 -2 24 24"><path d="${value}"/></svg>`
        )
      )
        .resize(size, size)
        .ensureAlpha()
        .raw()
        .toBuffer();
    // eslint-disable-next-line no-await-in-loop
    const [actual, expected] = await Promise.all([render(d), render(oracle)]);
    let error = 0;
    for (let i = 3; i < actual.length; i += 4) {
      error += Math.abs(actual[i] - expected[i]);
    }
    expect(error / (size * size * 255)).toBeLessThan(0.002);
  }
});

test("preserves an unrelated enclosed counter while filleting the outer opening", () => {
  const r = draw(
    "rect 2,2 20x20 r0\nhole circle 6,6 r2\nrect 9,16 6x8 r0\nsubtract r1"
  );
  expect(r.errors).toEqual([]);
  const scope = new paper.PaperScope();
  scope.setup(new scope.Size(24, 24));
  try {
    const p = new scope.CompoundPath({
      fillRule: "nonzero",
      insert: false,
      pathData: r.canvas.elements[0].d,
    });
    expect(p.children).toHaveLength(2);
    expect(p.contains(new scope.Point(6, 6))).toBe(false);
    expect(p.contains(new scope.Point(6, 10))).toBe(true);
  } finally {
    scope.project.remove();
  }
});
