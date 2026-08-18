/**
 * Conform, tested on synthetic geometry rather than the corpus.
 *
 * The corpus is 247MB and gitignored, so a test that needs it is a test that
 * does not run in CI. Everything here is a hand-built shape whose right answer
 * can be worked out with a pencil, which is also the only way to be sure the
 * corner detector is doing what it claims rather than getting lucky on real
 * icons.
 */
import { describe, expect, it } from "vitest";

import type { CorpusIcon, CorpusShape, Variant } from "../corpus/load.js";
import { bbox, parsePath } from "../geometry/path.js";
import {
  compensateStroke,
  conform,
  pathDistance,
  retierCorners,
  toSVG,
} from "./conform.js";

const K = 0.5523;

const stroked = (d: string, strokeWidth = 2): CorpusShape => ({
  cap: "round",
  d,
  filled: false,
  strokeWidth,
});

const variant = (over: Partial<Variant> = {}): Variant => ({
  corner: "round",
  key: "round-outlined-radius-2-stroke-2",
  radius: 2,
  stroke: 2,
  style: "outlined",
  ...over,
});

/** A square from (4,4) to (20,20): path extent 16, visual extent 18 at stroke 2. */
const SQUARE = "M4 4L20 4L20 20L4 20Z";

/** One corner of radius 2 at the top-right of a box, between two straight runs. */
const CORNER = `M4 4L18 4C${18 + 2 * K} 4 20 ${6 - 2 * K} 20 6L20 20`;

/** A circle of radius 2 centred at (12,12): four quadrants, handles 2K, chord
 *  2√2 — every number the corner test looks at, and it must not be retiered. */
const CIRCLE =
  `M12 10C${12 + 2 * K} 10 14 ${12 - 2 * K} 14 12` +
  `C14 ${12 + 2 * K} ${12 + 2 * K} 14 12 14` +
  `C${12 - 2 * K} 14 10 ${12 + 2 * K} 10 12` +
  `C10 ${12 - 2 * K} ${12 - 2 * K} 10 12 10Z`;

const icon = (
  v: Variant,
  shapes = [stroked(SQUARE, v.stroke)]
): CorpusIcon => ({
  shapes,
  symbol: "test",
  variant: v,
});

const extent = (shapes: CorpusShape[], stroke: number) => {
  const b = bbox(shapes.flatMap((s) => parsePath(s.d)));
  return { h: b.h + stroke, w: b.w + stroke };
};

describe("compensateStroke", () => {
  it("holds the visual extent, which is the whole point of the transform", () => {
    const before = [stroked(SQUARE, 1)];
    expect(extent(before, 1)).toEqual({ h: 17, w: 17 });

    const after = compensateStroke(before, 1, 2);
    const box = extent(after, 2);
    expect(box.w).toBeCloseTo(17, 6);
    expect(box.h).toBeCloseTo(17, 6);
  });

  it("shrinks the skeleton by the stroke delta, half per side", () => {
    const after = compensateStroke([stroked(SQUARE, 1)], 1, 2);
    const b = bbox(after.flatMap((s) => parsePath(s.d)));
    // 16 wide at stroke 1 becomes 15 wide at stroke 2: half a pixel off each edge.
    expect(b.w).toBeCloseTo(15, 6);
    expect(b.x0).toBeCloseTo(4.5, 6);
    expect(b.x1).toBeCloseTo(19.5, 6);
  });

  it("carries the new stroke onto every stroked shape and leaves fills alone", () => {
    const shapes = [
      stroked(SQUARE, 1),
      { ...stroked(SQUARE, 0), filled: true },
    ];
    const [line, fill] = compensateStroke(shapes, 1, 2);
    expect(line.strokeWidth).toBe(2);
    expect(fill.strokeWidth).toBe(0);
  });

  it("moves a shape at the variant stroke and leaves an exception alone", () => {
    // Central holds a handful of shapes at a fixed width across every variant
    // (adjust-photo's 2.2px marks) and runs its hairlines on their own
    // schedule. Both sit off the variant stroke, and forcing them onto it is a
    // confident wrong answer, so only widths that match the source move.
    const shapes = [stroked(SQUARE, 1.5), stroked(SQUARE, 2.2)];
    const [onVariant, exception] = compensateStroke(shapes, 1.5, 2);
    expect(onVariant.strokeWidth).toBe(2);
    expect(exception.strokeWidth).toBe(2.2);
  });

  it("leaves an icon alone when the stroke does not change", () => {
    const shapes = [stroked(SQUARE, 2)];
    expect(compensateStroke(shapes, 2, 2)).toBe(shapes);
  });
});

describe("retierCorners", () => {
  it("opens a rounded corner out to the vertex at radius 0", () => {
    const [corner] = retierCorners([stroked(CORNER)], 2, 0);
    const b = bbox(parsePath(corner.d));
    // The corner arc collapses onto (20,4), so the box reaches the full corner.
    expect(b.x1).toBeCloseTo(20, 6);
    expect(b.y0).toBeCloseTo(4, 6);
    expect(corner.d).not.toContain("C");
  });

  it("tightens a corner to a smaller radius without moving the vertex", () => {
    const [{ d }] = retierCorners([stroked(CORNER)], 2, 1);
    // The straight run now reaches 19 rather than 18: one unit of radius left.
    expect(d).toContain("19");
    expect(bbox(parsePath(d)).x1).toBeCloseTo(20, 6);
  });

  it("does not mistake a circle's quadrant for a corner", () => {
    // Every measurement a corner arc passes, a circle quadrant passes too. Only
    // the straight edges either side tell them apart, and rounding a circle to
    // radius 0 would turn it into a diamond.
    const before = [stroked(CIRCLE)];
    const after = retierCorners(before, 2, 0);
    expect(pathDistance(before, after)).toBeLessThan(0.01);
  });

  it("leaves an icon with no corners of that radius untouched", () => {
    const before = [stroked(SQUARE)];
    const after = retierCorners(before, 2, 3);
    expect(pathDistance(before, after)).toBeLessThan(0.01);
  });
});

describe("conform", () => {
  it("applies both mechanisms and says which it applied", () => {
    const result = conform(
      icon(variant({ radius: 2, stroke: 1 })),
      variant({ radius: 0, stroke: 2 })
    );
    expect(result.steps).toEqual([
      "retier corners 2 → 0",
      "compensate stroke 1 → 2",
    ]);
    expect(result.unsupported).toEqual([]);
  });

  it("refuses to synthesise a style change rather than faking one", () => {
    const result = conform(
      icon(variant()),
      variant({ key: "round-filled-radius-2-stroke-2", style: "filled" })
    );
    expect(result.unsupported).toHaveLength(1);
    expect(result.unsupported[0]).toMatch(/redraw, not a transform/u);
  });

  it("flags a cap change, which moves the visual extent it cannot compensate", () => {
    const result = conform(
      icon(variant()),
      variant({ corner: "square", key: "square-outlined-radius-2-stroke-2" })
    );
    expect(result.unsupported[0]).toMatch(/caps change the visual extent/u);
  });

  it("leaves a filled icon's geometry alone and says why", () => {
    // Measured, not assumed: compensating a filled icon's stroke scores 0.270px
    // against Central where doing nothing scores 0.205px. A transform that is
    // worse than no transform is not a transform.
    const filled = variant({
      key: "round-filled-radius-2-stroke-1",
      stroke: 1,
      style: "filled",
    });
    const source = icon(filled, [{ ...stroked(SQUARE, 0), filled: true }]);
    const result = conform(
      source,
      variant({ key: "round-filled-radius-2-stroke-2", style: "filled" })
    );

    expect(result.steps).toEqual([]);
    expect(pathDistance(result.shapes, source.shapes)).toBe(0);
    expect(result.unsupported[0]).toMatch(/filled icon/u);
  });

  it("is a no-op between a variant and itself", () => {
    const source = icon(variant());
    const result = conform(source, variant());
    expect(result.steps).toEqual([]);
    expect(pathDistance(result.shapes, source.shapes)).toBe(0);
  });
});

describe("pathDistance", () => {
  it("is zero for a drawing against itself and symmetric otherwise", () => {
    const a = [stroked(SQUARE)];
    const b = [stroked("M4 4L20 4L20 20L4 20Z".replace("M4 4", "M5 4"))];
    expect(pathDistance(a, a)).toBe(0);
    expect(pathDistance(a, b)).toBeCloseTo(pathDistance(b, a), 12);
    expect(pathDistance(a, b)).toBeGreaterThan(0);
  });

  it("measures in canvas units, so a 1px shift reads as about 1px", () => {
    const a = [stroked("M4 12L20 12")];
    const b = [stroked("M4 13L20 13")];
    expect(pathDistance(a, b)).toBeCloseTo(1, 1);
  });
});

describe("toSVG", () => {
  it("renders a fill for a filled shape and a stroke for a stroked one", () => {
    const svg = toSVG([
      stroked(SQUARE, 2),
      { ...stroked(SQUARE, 0), filled: true },
    ]);
    expect(svg).toContain('stroke-width="2"');
    expect(svg).toContain('fill="currentColor"');
    expect(svg).toContain('viewBox="0 0 24 24"');
  });
});
