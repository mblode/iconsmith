import { existsSync } from "node:fs";

import { describe, expect, test } from "vitest";

import { parsePath } from "../geometry/path.js";
import { SPEC } from "../tools/canvas.js";
import {
  HOUSE_VARIANT,
  loadCorpus,
  parseIconSvg,
  parseVariantKey,
  sampleSymbols,
  variantKey,
} from "./load.js";
import {
  circleRadius,
  cornerRadii,
  flaggedBy,
  histogram,
  measureIcon,
  measureVariant,
  summarise,
  visualExtent,
} from "./measure.js";

const variant = parseVariantKey(HOUSE_VARIANT) as NonNullable<
  ReturnType<typeof parseVariantKey>
>;

const icon = (
  shapes: { cap?: "butt" | "round"; d: string; sw?: number }[]
) => ({
  shapes: shapes.map((s) => ({
    cap: s.cap ?? "butt",
    d: s.d,
    filled: s.sw === 0,
    strokeWidth: s.sw ?? 2,
  })),
  symbol: "test",
  variant,
});

test("a variant key decomposes into its four axes", () => {
  expect(parseVariantKey("round-outlined-radius-2-stroke-1.5")).toEqual({
    corner: "round",
    key: "round-outlined-radius-2-stroke-1.5",
    radius: 2,
    stroke: 1.5,
    style: "outlined",
  });
  expect(parseVariantKey("square-filled-radius-0-stroke-2")?.corner).toBe(
    "square"
  );
  expect(parseVariantKey("corpus.json")).toBeNull();
});

test("variantKey is the inverse of parseVariantKey", () => {
  for (const key of [
    HOUSE_VARIANT,
    "round-filled-radius-0-stroke-1",
    "square-outlined-radius-0-stroke-1.5",
  ]) {
    expect(variantKey(parseVariantKey(key) as never)).toBe(key);
  }
});

describe("parseIconSvg", () => {
  test("reads every shape element, not just <path>", () => {
    const shapes = parseIconSvg(
      '<svg><path d="M1 1L2 2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' +
        '<circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2"/>' +
        '<rect x="2" y="4" width="20" height="16" rx="3" stroke="currentColor" stroke-width="2"/>' +
        "</svg>"
    );
    expect(shapes).toHaveLength(3);
    expect(shapes[0].cap).toBe("round");
    // The circle survives as measurable geometry rather than an empty `d`.
    expect(circleRadius(parsePath(shapes[1].d)[0])).toBeCloseTo(9, 2);
  });

  test("a filled shape has stroke width 0, so extent maths needs no branch", () => {
    const [shape] = parseIconSvg(
      '<svg><path d="M0 0L1 1" fill="currentColor"/></svg>'
    );
    expect(shape.strokeWidth).toBe(0);
    expect(shape.filled).toBe(true);
  });
});

test("visual extent is the path bbox inflated by the stroke, half per side", () => {
  // A 10×10 box stroked at 2 covers 12×12 of the canvas, and its top-left ink
  // starts at 4, not 5. Comparing the bare bbox instead is the error this
  // project measures wrong most often.
  const { box, h, w } = visualExtent(
    icon([{ d: "M5 5H15V15H5Z", sw: 2 }]).shapes
  );
  expect(w).toBe(12);
  expect(h).toBe(12);
  expect(box.x0).toBe(4);
  expect(box.x1).toBe(16);
});

describe("cornerRadii", () => {
  test("reads a symmetric arc between two straight runs as its radius", () => {
    const k = 3 * 0.5523;
    const d = `M5 2H${17 - 3}C${17 - 3 + k} 2 17 ${2 + 3 - k} 17 5V19H5Z`;
    const [corner] = cornerRadii(parsePath(d));
    expect(corner.r).toBeCloseTo(3, 1);
    expect(corner.size).toBeCloseTo(17, 0);
  });

  test("a circle is not a corner", () => {
    // Four quadrant cubics with no straight segment between them: a radius, but
    // not a rounded corner, and counting it would bias the tier calibration
    // towards whatever sizes of circle the set happens to use.
    const c = 12 + 9 * 0.5523;
    const d =
      `M21 12C21 ${c} ${c} 21 12 21C${24 - c} 21 3 ${c} 3 12` +
      `C3 ${24 - c} ${24 - c} 3 12 3C${c} 3 21 ${24 - c} 21 12Z`;
    expect(cornerRadii(parsePath(d))).toHaveLength(0);
  });
});

test("circleRadius accepts a circle and rejects a rounded rectangle", () => {
  const c = 12 + 4 * 0.5523;
  const circle =
    `M16 12C16 ${c} ${c} 16 12 16C${24 - c} 16 8 ${c} 8 12` +
    `C8 ${24 - c} ${24 - c} 8 12 8C${c} 8 16 ${24 - c} 16 12Z`;
  expect(circleRadius(parsePath(circle)[0])).toBeCloseTo(4, 2);
  expect(circleRadius(parsePath("M4 4H20V20H4Z")[0])).toBeNull();
});

describe("measureIcon", () => {
  test("an ink gap is the centre-line distance less one stroke width", () => {
    // Two vertical strokes 4 apart at stroke 2: the ink between them is 2.
    const m = measureIcon(
      icon([
        { d: "M8 4V20", sw: 2 },
        { d: "M12 4V20", sw: 2 },
      ])
    );
    expect(m.gaps).toHaveLength(1);
    expect(m.gaps[0]).toBeCloseTo(2, 6);
    expect(m.tightestGap).toBeCloseTo(2, 6);
    expect(m.tightestSeparated).toBeCloseTo(2, 6);
  });

  test("gaps are measured between elements, never inside one", () => {
    // Both strokes live in a single `<path>`, so this is compound geometry.
    // Counting its internal spacing is what pushes the low percentiles of any
    // gap distribution to zero.
    const m = measureIcon(icon([{ d: "M8 4V20M12 4V20", sw: 2 }]));
    expect(m.gaps).toHaveLength(0);
    expect(m.tightestGap).toBeNull();
    expect(m.tightestSeparated).toBeNull();
  });

  test("a round cap on a zero-length segment is a dot of the stroke width", () => {
    const m = measureIcon(icon([{ cap: "round", d: "M12 12H12.01", sw: 2.2 }]));
    expect(m.dots).toEqual([2.2]);
  });

  test("grid discipline counts design anchors, not curve endpoints", () => {
    expect(measureIcon(icon([{ d: "M4 4H20V20" }])).onGrid).toBe(1);
    expect(measureIcon(icon([{ d: "M4.1 4H20V20" }])).onGrid).toBeCloseTo(
      5 / 6,
      6
    );
  });
});

describe("summarise", () => {
  test("percentiles interpolate and stay monotonic", () => {
    const d = summarise([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(d.n).toBe(10);
    expect(d.median).toBe(5.5);
    expect(d.min).toBe(1);
    expect(d.max).toBe(10);
    expect(d.p25).toBeLessThan(d.median);
    expect(d.median).toBeLessThan(d.p75);
  });

  test("non-finite values are dropped rather than corrupting the sort", () => {
    const d = summarise([3, Number.NaN, 1, Number.POSITIVE_INFINITY, 2]);
    expect(d.n).toBe(3);
    expect(d.median).toBe(2);
  });

  test("an empty sample reports n=0 rather than throwing", () => {
    expect(summarise([]).n).toBe(0);
  });
});

test("histogram ranks buckets by frequency", () => {
  expect(histogram([1, 1.05, 1, 3, 2.98], 0.25)[0]).toEqual([1, 3]);
});

test("sampleSymbols spreads deterministically across the set", () => {
  const symbols = Array.from({ length: 100 }, (_, i) => `s${i}`);
  const a = sampleSymbols(symbols, 10);
  expect(a).toEqual(sampleSymbols(symbols, 10));
  expect(a).toHaveLength(10);
  expect(a[0]).toBe("s0");
  expect(a[1]).toBe("s10");
  expect(sampleSymbols(symbols, 500)).toHaveLength(100);
});

test("flaggedBy ignores icons whose shapes all overlap or touch", () => {
  const m = {
    icons: [
      { tightestSeparated: 0.5 },
      { tightestSeparated: 3 },
      { tightestSeparated: null },
    ],
  } as Parameters<typeof flaggedBy>[0];
  expect(flaggedBy(m, 1)).toBe(0.5);
  expect(flaggedBy(m, 0.25)).toBe(0);
});

// The corpus is 247MB and gitignored. These are the tests that hold the spec to
// the set it claims to describe, so they run whenever it is present.
const corpusPresent = existsSync("corpus/corpus.json");

describe.skipIf(!corpusPresent)("against the corpus", () => {
  test("the index covers every symbol in every variant", async () => {
    const corpus = await loadCorpus("corpus");
    expect(corpus.origin).toContain("central");
    expect(corpus.variants).toHaveLength(30);
    expect(corpus.symbols.length).toBeGreaterThan(2000);
    expect(corpus.variant(HOUSE_VARIANT)).toMatchObject({
      corner: "round",
      radius: 3,
      stroke: 2,
      style: "outlined",
    });
    expect(corpus.has(corpus.symbols[0], HOUSE_VARIANT)).toBe(true);
    expect(corpus.has("not-an-icon", HOUSE_VARIANT)).toBe(false);
  });

  test("the variant axes are not a full product", async () => {
    const corpus = await loadCorpus("corpus");
    // `square` ships only at radius 0, so the grid is 5 corner options
    // (square-0, round-0/1/2/3) × 3 strokes × 2 styles = 30, not 48. Anything
    // that enumerates corner × radius will ask for 18 cells that do not exist.
    const square = corpus.variants.filter((v) => v.corner === "square");
    expect(square).toHaveLength(6);
    expect(square.every((v) => v.radius === 0)).toBe(true);
    expect(corpus.variant("square-outlined-radius-2-stroke-2")).toBeUndefined();
  });

  test("svg hands back the source, and refuses a variant that is not there", async () => {
    const corpus = await loadCorpus("corpus");
    const source = await corpus.svg(corpus.symbols[0], HOUSE_VARIANT);
    expect(source).toContain('viewBox="0 0 24 24"');
    await expect(corpus.svg(corpus.symbols[0], "nope")).rejects.toThrow(
      /Unknown corpus variant/u
    );
  });

  test("every loaded icon yields measurable geometry", async () => {
    const corpus = await loadCorpus("corpus");
    const m = await measureVariant(corpus, HOUSE_VARIANT, { limit: 40 });
    expect(m.symbols).toBe(40);
    expect(m.extentW.median).toBeGreaterThan(0);
    expect(Number.isFinite(m.extentW.max)).toBe(true);
  });

  test("the calibrated spec does not flag most of the set it describes", async () => {
    const corpus = await loadCorpus("corpus");
    const m = await measureVariant(corpus, HOUSE_VARIANT, { limit: 300 });
    // The floor exists to catch outliers. If it ever flags a majority, it has
    // stopped describing this set and started describing a different one.
    expect(flaggedBy(m, SPEC.minGap)).toBeLessThan(0.25);
    // Stroke and canvas are claims about the corpus, not preferences.
    expect(m.strokes.median).toBe(SPEC.stroke);
    expect(m.extentMax.median).toBeLessThanOrEqual(SPEC.canvas);
  });
});
