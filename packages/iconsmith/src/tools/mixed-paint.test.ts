import sharp from "sharp";
import { expect, test } from "vitest";

import { Canvas, specAt } from "./canvas.js";
import { run } from "./dsl.js";
import { lint } from "./lint.js";
import { programFromDoc } from "./twin.js";

const spec = {
  ...specAt({ radius: 0, stroke: 1.5 }),
  strokeJoin: "miter" as const,
};
const program =
  "finish outlined\ncircle 12,12 r9\nline 10,9 14,12 10,15 10,9 r0 solid off-axis";
test("solid modifier paints inside outlined icon and replays", async () => {
  const r = run(program, [], { spec });
  expect(r.errors).toEqual([]);
  expect(r.canvas.elements[1].strokeWidth).toBe(0);
  const svg = r.canvas.toSVG();
  expect(svg).toContain('fill="currentColor" fill-rule="nonzero"');
  const { data, info } = await sharp(Buffer.from(svg))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  expect(data[(12 * info.width + 11) * info.channels + 3]).toBe(255);
  expect(data[(12 * info.width + 6) * info.channels + 3]).toBe(0);
  const doc = r.canvas.toJSON({ icon: "play" });
  expect(Canvas.fromJSON(doc, [], spec).toSVG()).toBe(svg);
  expect(run(programFromDoc(doc), [], { spec }).canvas.toSVG()).toBe(svg);
  r.canvas.transform(0.8, 2, 2);
  expect(
    Canvas.fromJSON(r.canvas.toJSON({ icon: "play" }), [], spec).toSVG()
  ).toBe(r.canvas.toSVG());
});
test("solid ink is not expanded again in bounds or edge diagnostics", () => {
  const r = run("finish outlined\nline 2,2 22,2 22,22 2,22 2,2 r0 solid", [], {
    spec,
  });
  expect(r.errors).toEqual([]);
  expect(r.canvas.visualBbox()?.w).toBeCloseTo(21.5, 4);
  expect(r.canvas.visualBbox()?.x0).toBeCloseTo(1.25, 4);
  expect(lint(r.canvas).some((i) => i.rule === "bleed")).toBe(false);
});
test("mixed gap uses the remaining stroke half-width only", () => {
  const r = run(
    "finish outlined\nline 4,4 4,20 r0\nline 6,8 10,8 10,16 6,16 6,8 r0 solid",
    [],
    { spec }
  );
  expect(r.errors).toEqual([]);
  // Ink edges x4.75 and x5.25 leave0.5, not a1.25 centerline gap.
  expect(lint(r.canvas).some((i) => i.rule === "gap")).toBe(true);
});

test("trim refuses a solid modifier without losing its paint", () => {
  const c = run(
    "finish outlined\nline 4,4 12,4 12,12 4,4 r0 solid\nrect 2,2 8x8 r0",
    [],
    { spec }
  ).canvas;
  const before = c.toSVG();
  expect(() => c.combine("trim")).toThrow(/solid modifier/u);
  expect(c.toSVG()).toBe(before);
});
