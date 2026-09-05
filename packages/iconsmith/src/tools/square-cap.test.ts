import sharp from "sharp";
import { expect, test } from "vitest";

import { bbox, parsePath } from "../geometry/path.js";
import { expandStroke } from "./stroke.js";

const image = (body: string) =>
  sharp(
    Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">${body}</svg>`
    )
  )
    .resize(384, 384)
    .ensureAlpha()
    .raw()
    .toBuffer();

test.each(["M4 8L16 8", "M4 4L16 16", "M4 12C4 5 12 4 18 8"])(
  "square cap expansion matches SVG %s",
  async (d) => {
    const expanded = expandStroke(d, 1.5, { cap: "square", join: "miter" });
    const [a, b] = await Promise.all([
      image(
        `<path d="${d}" fill="none" stroke="black" stroke-width="1.5" stroke-linecap="square" stroke-linejoin="miter" stroke-miterlimit="4"/>`
      ),
      image(`<path d="${expanded}" fill="black"/>`),
    ]);
    let difference = 0;
    for (let i = 3; i < a.length; i += 4) {
      difference += Math.abs(a[i] - b[i]);
    }
    expect(difference / (384 * 384 * 255)).toBeLessThan(0.0001);
  }
);

test("diagonal square caps include both tangential and normal extensions", () => {
  const square = bbox(
    parsePath(expandStroke("M4 4L16 16", 1.5, { cap: "square", join: "round" }))
  );
  const round = bbox(parsePath(expandStroke("M4 4L16 16", 1.5)));
  expect(square.x0).toBeCloseTo(4 - 0.75 * Math.SQRT2, 4);
  expect(square.y1).toBeCloseTo(16 + 0.75 * Math.SQRT2, 4);
  expect(round.x0).toBeCloseTo(3.25, 4);
});

test("closed contours ignore caps and omitted cap keeps round behavior", () => {
  const closed = "M4 4L20 4L20 20L4 20Z";
  expect(expandStroke(closed, 1.5, { cap: "square", join: "miter" })).toBe(
    expandStroke(closed, 1.5, { cap: "round", join: "miter" })
  );
  const open = "M4 4L16 16";
  expect(expandStroke(open, 1.5)).toBe(
    expandStroke(open, 1.5, { cap: "round", join: "round" })
  );
});
