import sharp from "sharp";
import { expect, test } from "vitest";

import { bbox, parsePath } from "../geometry/path.js";
import { Canvas, specAt } from "./canvas.js";
import { run } from "./dsl.js";
import { expandStroke } from "./stroke.js";
import { adaptProgram, programFromDoc } from "./twin.js";

const spec = specAt({ radius: 1, size: 24, stroke: 1.5 });
const source =
  "icon ribbon\nfinish outlined\nline 5,3 19,3 19,22 12,17.25 5,22 5,3 r1 off-axis";
test("round caps preserve diagonal ink extent", () => {
  const paths = parsePath(expandStroke("M4 4L12 12", 1.5));
  const box = bbox(paths);
  expect(box.x0).toBeCloseTo(3.25, 4);
  expect(box.y0).toBeCloseTo(3.25, 4);
  expect(box.x1).toBeCloseTo(12.75, 4);
  expect(box.y1).toBeCloseTo(12.75, 4);
  expect(paths.every((p) => p.closed)).toBe(true);
});
test("closed rounded stroke is a ring with matching extent and exact recipes", async () => {
  const outlined = run(source, [], { spec }).canvas;
  const filled = run(adaptProgram(source, "filled", spec), [], { spec });
  expect(filled.errors).toEqual([]);
  const a = outlined.bbox();
  const b = filled.canvas.bbox();
  if (!a || !b) {
    throw new Error("Missing bounds");
  }
  expect(b.w).toBeCloseTo(a.w + spec.stroke, 3);
  expect(b.h).toBeCloseTo(a.h + spec.stroke, 3);
  const svg = filled.canvas.toSVG();
  const doc = filled.canvas.toJSON({ icon: "ribbon" });
  expect(Canvas.fromJSON(doc, [], spec).toSVG()).toBe(svg);
  expect(run(programFromDoc(doc), [], { spec }).canvas.toSVG()).toBe(svg);
  const { data, info } = await sharp(Buffer.from(svg))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  expect(data[(10 * info.width + 12) * info.channels + 3]).toBe(0);
  expect(data[(10 * info.width + 5) * info.channels + 3]).toBeGreaterThan(0);
});
test("expanded curves work as Boolean cutters", () => {
  const result = run(
    "finish filled\nrect 2,2 20x20 r1\nline 6,10 10,14 17,7 r1\nsubtract",
    [],
    { spec }
  );
  expect(result.errors).toEqual([]);
  expect(result.canvas.elements).toHaveLength(1);
  expect(
    Canvas.fromJSON(result.canvas.toJSON({ icon: "cut" }), [], spec).toSVG()
  ).toBe(result.canvas.toSVG());
});
test("invalid geometry refuses atomically", () => {
  for (const width of [0, -1, Number.NaN, Infinity]) {
    expect(() => expandStroke("M1 1L2 2", width)).toThrow();
  }
  expect(() => expandStroke("", 1)).toThrow();
  const canvas = new Canvas([], { finish: "filled", spec });
  canvas.rect({ h: 20, w: 20, x: 2, y: 2 });
  const before = canvas.toSVG();
  expect(() =>
    canvas.line({
      points: [
        [2, 2],
        [2.25, 2],
        [2.25, 2.25],
      ],
      r: 1,
    })
  ).toThrow();
  expect(canvas.toSVG()).toBe(before);
});
test("transforms preserve rounded stroke recipes", () => {
  const { canvas } = run(adaptProgram(source, "filled", spec), [], { spec });
  canvas.transform(0.8, 2, 2);
  expect(canvas.elements[0]).toMatchObject({ r: 1 });
  expect(
    Canvas.fromJSON(canvas.toJSON({ icon: "ribbon" }), [], spec).toSVG()
  ).toBe(canvas.toSVG());
});

test("explicit solid fills the closed interior and retains its recipe", async () => {
  const program = `${adaptProgram(source, "filled", spec)} solid`;
  const result = run(program, [], { spec });
  expect(result.errors).toEqual([]);
  const doc = result.canvas.toJSON({ icon: "ribbon" });
  expect(doc.draw[0]).toMatchObject({ solid: true });
  const svg = result.canvas.toSVG();
  expect(Canvas.fromJSON(doc, [], spec).toSVG()).toBe(svg);
  expect(run(programFromDoc(doc), [], { spec }).canvas.toSVG()).toBe(svg);
  const { data, info } = await sharp(Buffer.from(svg))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  expect(data[(10 * info.width + 12) * info.channels + 3]).toBe(255);
  result.canvas.transform(0.8, 2, 2);
  expect(result.canvas.elements[0]).toMatchObject({ solid: true });
  expect(
    Canvas.fromJSON(result.canvas.toJSON({ icon: "ribbon" }), [], spec).toSVG()
  ).toBe(result.canvas.toSVG());
});
test("solid requires an explicitly closed contour and radius", () => {
  for (const program of [
    "finish filled\nline 2,2 12,2 12,12 r1 solid",
    "finish filled\nline 2,2 12,2 12,12 2,2 solid",
  ]) {
    const result = run(program, [], { spec });
    expect(result.errors.join(" ")).toMatch(/Solid line requires/u);
    expect(result.canvas.elements).toHaveLength(0);
  }
  expect(() =>
    adaptProgram(
      `${adaptProgram(source, "filled", spec)} solid`,
      "outlined",
      spec
    )
  ).toThrow(/authored outlined/u);
});
test("solid parent and counter survive nested Boolean replay", () => {
  const program = `${adaptProgram(
    source,
    "filled",
    spec
  )} solid\nline 9,10 11,12\nline 11,12 15,8\nunion\nsubtract`;
  const result = run(program, [], { spec });
  expect(result.errors).toEqual([]);
  const svg = result.canvas.toSVG();
  expect(
    Canvas.fromJSON(result.canvas.toJSON({ icon: "ribbon" }), [], spec).toSVG()
  ).toBe(svg);
  expect(
    run(programFromDoc(result.canvas.toJSON({ icon: "ribbon" })), [], {
      spec,
    }).canvas.toSVG()
  ).toBe(svg);
});
