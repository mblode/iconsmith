import sharp from "sharp";
import { expect, test } from "vitest";

import { Canvas, specAt } from "./canvas.js";
import { run } from "./dsl.js";
import { programFromDoc } from "./twin.js";

const spec = {
  ...specAt({ radius: 0, stroke: 1.5 }),
  strokeJoin: "miter" as const,
};
const base =
  "finish filled\nline 5,3 19,3 19,21 12,17 5,21 5,3 r0 solid off-axis";
const alpha = async (svg: string, x: number, y: number) => {
  const { data, info } = await sharp(Buffer.from(svg))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return data[(y * info.width + x) * info.channels + 3];
};

test("legacy holes cut a nonzero solid and replay without changing the recipe", async () => {
  const program = `${base}\nhole rect 8.25,7.25 1.5x7.5 r0\nhole rect 14.25,7.25 1.5x7.5 r0`;
  const result = run(program, [], { spec });
  expect(result.errors).toEqual([]);
  const svg = result.canvas.toSVG();
  expect(await alpha(svg, 9, 10)).toBeLessThan(100);
  expect(await alpha(svg, 15, 10)).toBeLessThan(100);
  expect(await alpha(svg, 12, 10)).toBe(255);
  const doc = result.canvas.toJSON({ icon: "pause" });
  expect(Canvas.fromJSON(doc, [], spec).toSVG()).toBe(svg);
  expect(run(programFromDoc(doc), [], { spec }).canvas.toSVG()).toBe(svg);
});
test("overlapping holes remove their shared region from a nonzero parent", async () => {
  const result = run(
    `${base}\nhole rect 7,7 6x6 r0\nhole rect 11,7 6x6 r0`,
    [],
    { spec }
  );
  expect(result.errors).toEqual([]);
  const svg = result.canvas.toSVG();
  expect(await alpha(svg, 8, 9)).toBe(0);
  expect(await alpha(svg, 12, 9)).toBe(0);
  expect(await alpha(svg, 15, 9)).toBe(0);
});
test("hole cuts an expanded ring without refilling its existing counter", async () => {
  const result = run(
    "finish filled\nline 4,4 20,4 20,20 4,20 4,4 r0\nhole rect 10,3.5 3x1 r0",
    [],
    { spec }
  );
  expect(result.errors).toEqual([]);
  const svg = result.canvas.toSVG();
  expect(await alpha(svg, 12, 12)).toBe(0);
  expect(await alpha(svg, 11, 4)).toBeLessThan(await alpha(svg, 7, 4));
});
