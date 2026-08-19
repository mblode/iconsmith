import { describe, expect, it } from "vitest";

import {
  bothScores,
  centroidCosine,
  registeredCosine,
  registeredSimilarity,
  shiftedCosine,
  WINDOW,
} from "./registration.js";
import { cosine, inkVector, similarity } from "./render.js";

const svg = (body: string) =>
  `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;
const stroke = (d: string) =>
  svg(
    `<path d="${d}" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`
  );

const BOX = stroke("M4 4L20 4L20 20L4 20Z");
/** The same drawing, one unit right — the perturbation that inverted the
 *  unregistered metric. */
const SHIFTED = stroke("M5 4L21 4L21 20L5 20Z");
const BAR = stroke("M4 12L20 12");

/** Two elements, and the same two with one of them moved across the canvas.
 *  This is `move-element`: a broken drawing that must stay broken. */
const TWO = svg(
  `<path d="M4 4L10 4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M4 8L10 8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`
);
const TWO_MOVED = svg(
  `<path d="M4 4L10 4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M14 18L20 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`
);

describe("registration", () => {
  it("scores an icon against itself at 1", async () => {
    expect(await registeredSimilarity(BOX, BOX)).toBeCloseTo(1, 6);
  });

  it("forgives a whole-icon 1-unit shift the unregistered metric punished", async () => {
    const plain = await similarity(BOX, SHIFTED);
    const registered = await registeredSimilarity(BOX, SHIFTED);
    expect(plain).toBeLessThan(0.99);
    expect(registered).toBeGreaterThan(0.99);
  });

  it("still calls a different drawing a different drawing", async () => {
    // The 0.737 cross-set baseline: two mature sets drawing the same concept.
    // A bar is not a box at any alignment.
    expect(await registeredSimilarity(BOX, BAR)).toBeLessThan(0.737);
  });

  it("leaves an element moved across the canvas broken", async () => {
    const plain = await similarity(TWO, TWO_MOVED);
    const registered = await registeredSimilarity(TWO, TWO_MOVED);
    // Sliding the whole raster cannot put a moved element back: the rest of the
    // drawing moves with it. Forgiving this is the failure mode the window
    // exists to avoid, so the gain is small and the score stays low.
    expect(registered - plain).toBeLessThan(0.05);
    expect(registered).toBeLessThan(0.737);
  });

  it("never scores below the unregistered metric, since no shift is in the window", async () => {
    const pairs: [string, string][] = [
      [BOX, SHIFTED],
      [BOX, BAR],
      [TWO, TWO_MOVED],
    ];
    const inks = await Promise.all(
      pairs.map(([x, y]) => Promise.all([inkVector(x), inkVector(y)]))
    );
    for (const [a, b] of inks) {
      expect(registeredCosine(a, b)).toBeGreaterThanOrEqual(cosine(a, b));
      expect(registeredCosine(a, b, 0)).toBeCloseTo(cosine(a, b), 12);
    }
  });

  it("reports both scores for one pair, so a transition run stays comparable", async () => {
    const both = await bothScores(BOX, SHIFTED);
    // `plain` must be the committed metric to the last decimal, or a run that
    // records both is not comparable with one that recorded only the old.
    expect(both.plain).toBeCloseTo(await similarity(BOX, SHIFTED), 12);
    expect(both.registered).toBeCloseTo(
      await registeredSimilarity(BOX, SHIFTED),
      12
    );
    // The gap is the diagnostic: this pair gained by sliding, and a candidate
    // whose whole gain looks like this one won the below-chance direction.
    expect(both.registered).toBeGreaterThan(both.plain);
  });

  it("slides by whole pixels and drops the ink that leaves the raster", () => {
    // A 2x2 raster with one lit pixel top-left; sliding it onto the other lit
    // pixel scores 1, and sliding it off the edge leaves nothing to compare.
    const a = [1, 0, 0, 0];
    const b = [0, 0, 0, 1];
    expect(shiftedCosine(a, b, 1, 1)).toBeCloseTo(1, 12);
    expect(shiftedCosine(a, b, 0, 0)).toBe(0);
    expect(shiftedCosine(a, b, -2, -2)).toBe(0);
  });

  it("registers ±1 canvas unit on the 48px scoring raster", () => {
    expect(WINDOW).toBe(2);
  });

  it("aligns centres of mass, which is not the same as best alignment", () => {
    // The candidate that was measured and rejected: it moves to *a* alignment,
    // not the best one, so it can score below the plain cosine.
    const a = [0, 1, 1, 0];
    const b = [1, 0, 0, 1];
    expect(centroidCosine(a, b)).toBeLessThanOrEqual(registeredCosine(a, b, 1));
    expect(centroidCosine([0, 0, 0, 0], b)).toBe(cosine([0, 0, 0, 0], b));
  });

  it("refuses a raster that is not square", () => {
    expect(() => registeredCosine([1, 0, 1], [1, 0, 1])).toThrow(/square/u);
  });
});
