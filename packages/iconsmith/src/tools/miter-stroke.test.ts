import sharp from "sharp";
import { expect, test } from "vitest";

import { bbox, parsePath } from "../geometry/path.js";
import { combinePaths } from "./boolean.js";
import { expandStroke } from "./stroke.js";

const raster = (svg: string) =>
  sharp(Buffer.from(svg)).resize(384, 384).ensureAlpha().raw().toBuffer();
const wrap = (body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">${body}</svg>`;

test("miter expansion matches SVG ink including closure and concave fold", async () => {
  const d = "M19.25 21.25V2.75H4.75V21.25L12 17.25Z";
  const expanded = expandStroke(d, 1.5, { join: "miter" });
  const source = await raster(
    wrap(
      `<path d="${d}" fill="none" stroke="black" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="miter" stroke-miterlimit="4"/>`
    )
  );
  const actual = await raster(wrap(`<path d="${expanded}" fill="black"/>`));
  let difference = 0;
  for (let i = 3; i < source.length; i += 4) {
    difference += Math.abs(source[i] - actual[i]);
  }
  // Mean alpha discrepancy over the canvas, not an aesthetic score.
  expect(difference / (384 * 384 * 255)).toBeLessThan(0.0001);
  expect(parsePath(expanded)).toHaveLength(2);
  expect(parsePath(expanded).every((p) => p.closed)).toBe(true);
  expect(bbox(parsePath(expanded)).y1).toBeGreaterThan(22.4);
  const solid = combinePaths(
    "union",
    { d: expanded, fillRule: "nonzero" },
    { d, fillRule: "nonzero" }
  );
  expect(parsePath(solid)).toHaveLength(1);
  expect(bbox(parsePath(solid)).y1).toBeCloseTo(22.5204, 4);
});

test("acute miter falls back at the limit and preserves round terminals", () => {
  const d = "M10 20L12 4L14 20";
  const bounded = bbox(
    parsePath(expandStroke(d, 2, { join: "miter", miterLimit: 4 }))
  );
  const extended = bbox(
    parsePath(expandStroke(d, 2, { join: "miter", miterLimit: 20 }))
  );
  expect(bounded.y0).toBeGreaterThan(3);
  expect(extended.y0).toBeLessThan(0);
  expect(bounded.y1).toBeCloseTo(21, 3);
  expect(extended.y1).toBeCloseTo(21, 3);
});

test("round defaults are unchanged and invalid miter settings refuse", () => {
  const d = "M4 12L12 4L20 12";
  expect(expandStroke(d, 2)).toBe(expandStroke(d, 2, { join: "round" }));
  expect(expandStroke(d, 2, { join: "miter" })).toBe(
    expandStroke(d, 2, { join: "miter", miterLimit: 4 })
  );
  for (const miterLimit of [0, -1, 0.5, Infinity, Number.NaN]) {
    expect(() => expandStroke(d, 2, { join: "miter", miterLimit })).toThrow();
  }
});
