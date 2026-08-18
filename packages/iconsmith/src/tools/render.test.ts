import { describe, expect, it } from "vitest";

import { cosine, inkVector, png, sheet, similarity } from "./render.js";

const svg = (body: string) =>
  `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;
const stroke = (d: string) =>
  svg(
    `<path d="${d}" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`
  );

const BOX = stroke("M4 4L20 4L20 20L4 20Z");
const SHIFTED = stroke("M5 4L21 4L21 20L5 20Z");
const BAR = stroke("M4 12L20 12");

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

describe("render", () => {
  it("scores an icon against itself at 1", async () => {
    expect(await similarity(BOX, BOX)).toBeCloseTo(1, 6);
  });

  it("forgives a 1px shift more than a different drawing", async () => {
    const shifted = await similarity(BOX, SHIFTED);
    const different = await similarity(BOX, BAR);
    expect(shifted).toBeGreaterThan(different);
    // The blur tolerates designer disagreement, not a different shape: a shift
    // must stay above the 0.737 cross-set baseline, a different drawing below.
    expect(shifted).toBeGreaterThan(0.737);
    expect(different).toBeLessThan(0.737);
  });

  it("renders the comparator's 48×48 greyscale grid", async () => {
    const ink = await inkVector(BOX);
    expect(ink).toHaveLength(48 * 48);
    expect(Math.max(...ink)).toBeGreaterThan(0);
    expect(Math.min(...ink)).toBeGreaterThanOrEqual(0);
  });

  it("emits a PNG at the requested size and a sheet that tiles", async () => {
    const one = await png(BOX, 32);
    expect(one.subarray(0, 4)).toEqual(PNG_MAGIC);
    const many = await sheet([BOX, BAR, BOX], { cols: 2, size: 32 });
    expect(many.subarray(0, 4)).toEqual(PNG_MAGIC);
    expect(many.length).toBeGreaterThan(one.length);
  });

  it("returns 0 rather than NaN when one side is blank", () => {
    expect(cosine([0, 0], [1, 1])).toBe(0);
    expect(cosine([1, 0], [0, 1])).toBe(0);
    expect(cosine([1, 2], [2, 4])).toBeCloseTo(1, 12);
  });
});
