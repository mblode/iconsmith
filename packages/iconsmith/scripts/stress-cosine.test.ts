/**
 * The stress test's own tests.
 *
 * A perturbation that does not do what its name says produces a number that
 * looks exactly like a finding — `delete-element` drew a fresh random index for
 * every element and so usually deleted nothing, which read as "the metric
 * ignores a missing element" until it was caught. So each perturbation is
 * checked against the property it claims, on synthetic icons rather than the
 * corpus: the corpus is not in the repository, and a test that quietly skips is
 * not a test.
 */
import { describe, expect, it } from "vitest";

import type { CorpusShape } from "../src/corpus/load.js";
import { bbox, parsePath } from "../src/geometry/path.js";
import { cosine, inkVector } from "../src/tools/render.js";
import {
  bestThreshold,
  deleteElement,
  growDot,
  jitterIcon,
  mirrorElement,
  moveElement,
  overlap,
  percentile,
  PERTURBATIONS,
  reverseOne,
  reverseOrder,
  reverseSubpath,
  scaleElement,
  splitElement,
  spread,
  toSvg,
  translateIcon,
} from "./stress-cosine.js";

const stroke = (d: string, strokeWidth = 2): CorpusShape => ({
  cap: "round",
  d,
  filled: false,
  strokeWidth,
});

/** A flag: a closed pennant — asymmetric under a mirror about its own centre —
 *  and the pole it hangs from. */
const flag = (): CorpusShape[] => [
  stroke("M6 6L14 9L6 12Z"),
  stroke("M6 12L6 20"),
];

const circle = (cx: number, cy: number, r: number): CorpusShape =>
  stroke(
    `M${cx + r} ${cy}C${cx + r} ${cy + r * 0.5523} ${cx + r * 0.5523} ${cy + r} ${cx} ${cy + r}` +
      `C${cx - r * 0.5523} ${cy + r} ${cx - r} ${cy + r * 0.5523} ${cx - r} ${cy}` +
      `C${cx - r} ${cy - r * 0.5523} ${cx - r * 0.5523} ${cy - r} ${cx} ${cy - r}` +
      `C${cx + r * 0.5523} ${cy - r} ${cx + r} ${cy - r * 0.5523} ${cx + r} ${cy}Z`
  );

const always = (v: number) => () => v;
const nodes = (shape: CorpusShape): [number, number][] =>
  parsePath(shape.d).flatMap((sp) => [
    sp.start,
    ...sp.segs.map((s): [number, number] =>
      s.t === "C" ? [s.p[4], s.p[5]] : [s.p[0], s.p[1]]
    ),
  ]);

const count = (family: string) =>
  PERTURBATIONS.filter((p) => p.family === family).length;

describe("the two families", () => {
  it("names five perturbations on each side", () => {
    expect(count("preserving")).toBe(5);
    expect(count("breaking")).toBe(5);
  });
});

describe("semantics-preserving perturbations", () => {
  it("translates every node by exactly one unit", () => {
    const moved = translateIcon(flag());
    expect(moved).not.toBeNull();
    const before = bbox(flag().flatMap((s) => parsePath(s.d)));
    const after = bbox((moved as CorpusShape[]).flatMap((s) => parsePath(s.d)));
    expect(after.x0 - before.x0).toBeCloseTo(1);
    expect(after.y0).toBeCloseTo(before.y0);
  });

  it("refuses to translate an icon that already fills the canvas", () => {
    expect(translateIcon([stroke("M1 12L23 12")])).toBeNull();
  });

  it("jitters every node by the grid tolerance and no further", () => {
    const jittered = jitterIcon(flag(), always(0.4));
    const before = flag().flatMap(nodes);
    const after = jittered.flatMap(nodes);
    expect(after).toHaveLength(before.length);
    for (const [i, [x, y]] of after.entries()) {
      expect(Math.abs(x - before[i][0])).toBeCloseTo(0.25);
      expect(Math.abs(y - before[i][1])).toBeCloseTo(0.25);
    }
  });

  it("reverses draw order without changing any geometry", () => {
    const reversed = reverseOrder(flag()) as CorpusShape[];
    expect(reversed.map((s) => s.d)).toEqual(
      flag()
        .map((s) => s.d)
        .toReversed()
    );
  });

  it("reverses one subpath onto the same endpoints", () => {
    const [sp] = parsePath("M6 6L14 6L14 12");
    const back = reverseSubpath(sp);
    expect(back).not.toBeNull();
    expect((back as { start: [number, number] }).start).toEqual([14, 12]);
    const again = reverseSubpath(back as NonNullable<typeof back>);
    expect(again).toEqual(sp);
  });

  it("refuses to reverse a subpath containing an arc", () => {
    const [sp] = parsePath("M6 6A2 2 0 0 1 10 10");
    expect(reverseSubpath(sp)).toBeNull();
  });

  it("picks a reversible subpath when the icon has one", () => {
    const out = reverseOne(flag(), always(0)) as CorpusShape[];
    expect(out).toHaveLength(2);
    expect(out.map((s) => s.d)).not.toEqual(flag().map((s) => s.d));
  });

  it("splits one element into two covering the same ink", () => {
    const out = splitElement(flag(), always(0)) as CorpusShape[];
    expect(out).toHaveLength(3);
    const seam = out.filter((s) => s.d !== flag()[1].d);
    expect(seam.length).toBeGreaterThanOrEqual(2);
  });

  it("splits a closed subpath by walking it as a loop", () => {
    const out = splitElement([stroke("M6 6L14 6L14 12L6 12Z")], always(0));
    expect(out).toHaveLength(2);
    for (const piece of out as CorpusShape[]) {
      expect(piece.d).not.toContain("Z");
    }
  });
});

describe("semantics-breaking perturbations", () => {
  it("deletes exactly one element", () => {
    // The regression: the index used to be drawn inside the filter predicate,
    // which asked a fresh question of every element and usually deleted none.
    for (const r of [0, 0.4, 0.9]) {
      const out = deleteElement(flag(), always(r)) as CorpusShape[];
      expect(out).toHaveLength(1);
    }
  });

  it("refuses to delete from a one-element icon", () => {
    expect(deleteElement([stroke("M6 6L14 6")], always(0))).toBeNull();
  });

  it("mirrors an asymmetric element in place", () => {
    const out = mirrorElement(flag(), always(0)) as CorpusShape[];
    expect(out).not.toBeNull();
    const changed = out.filter((s, i) => s.d !== flag()[i]?.d);
    expect(changed).toHaveLength(1);
    const before = bbox(parsePath(flag()[0].d));
    const after = bbox(parsePath(changed[0].d));
    expect(after.x0).toBeCloseTo(before.x0);
    expect(after.x1).toBeCloseTo(before.x1);
    expect(changed[0].d).not.toBe(flag()[0].d);
  });

  it("refuses an element that is its own mirror image", () => {
    // Both elements here are symmetric about their own centre, so a mirror
    // changes no drawing and the observation does not belong in the family.
    expect(
      mirrorElement([circle(8, 8, 3), stroke("M6 20L18 20")], always(0))
    ).toBeNull();
  });

  it("scales one element by 1.5 about its own centre", () => {
    const out = scaleElement(flag(), always(0)) as CorpusShape[];
    const changed = out.filter((s, i) => s.d !== flag()[i]?.d);
    expect(changed).toHaveLength(1);
    const before = bbox(
      parsePath(flag().find((s) => s.d !== changed[0].d)?.d ?? "")
    );
    const after = bbox(parsePath(changed[0].d));
    expect(after.h / Math.max(before.h, 1)).toBeGreaterThan(1);
  });

  it("refuses a scale that would leave the canvas", () => {
    expect(
      scaleElement([stroke("M2 2L22 22"), stroke("M2 22L22 2")], always(0))
    ).toBeNull();
  });

  it("moves one element to the opposite quadrant", () => {
    const out = moveElement(flag(), always(0)) as CorpusShape[];
    const changed = out.filter((s, i) => s.d !== flag()[i]?.d);
    expect(changed).toHaveLength(1);
    const before = bbox(parsePath(flag()[0].d));
    const after = bbox(parsePath(changed[0].d));
    expect(
      Math.hypot(after.x0 - before.x0, after.y0 - before.y0)
    ).toBeGreaterThan(1);
  });

  it("grows a cap-form dot by widening its stroke two tiers", () => {
    const out = growDot(
      [stroke("M12 6L14 6"), stroke("M8 8V8", 2)],
      always(0)
    ) as CorpusShape[];
    expect(out.some((s) => s.strokeWidth === 3)).toBe(true);
  });

  it("grows a ring dot by its radius, keeping the stroke", () => {
    const dot = circle(8, 8, 0.25);
    const out = growDot(
      [stroke("M12 6L14 6"), dot],
      always(0)
    ) as CorpusShape[];
    const grown = out.find(
      (s) => s.strokeWidth === 2 && s.d !== dot.d && s.d.includes("C")
    );
    expect(grown).toBeDefined();
    const b = bbox(parsePath((grown as CorpusShape).d));
    expect(b.w + 2).toBeCloseTo(4, 1);
  });

  it("refuses an icon with no dot on the ladder", () => {
    expect(growDot(flag(), always(0))).toBeNull();
  });
});

describe("statistics", () => {
  it("reads percentiles off the sorted sample", () => {
    const xs = [0, 1, 2, 3, 4];
    expect(percentile(xs, 0)).toBe(0);
    expect(percentile(xs, 0.5)).toBe(2);
    expect(percentile(xs, 1)).toBe(4);
  });

  it("summarises a sample", () => {
    expect(spread([1, 2, 3])).toEqual({
      max: 3,
      median: 2,
      min: 1,
      n: 3,
      p25: 2,
      p75: 3,
    });
  });

  it("finds the threshold that separates two clean distributions", () => {
    const best = bestThreshold([0.9, 0.95, 1], [0.1, 0.2, 0.3]);
    expect(best.falseAlarm).toBe(0);
    expect(best.missed).toBe(0);
    expect(best.value).toBeCloseTo(0.9);
  });

  it("counts how far the distributions reach into each other", () => {
    expect(overlap([0.5, 1], [0.4, 0.6])).toEqual({
      breakingAbovePreservingMin: 1,
      preservingBelowBreakingMax: 1,
    });
  });
});

describe("the harness itself", () => {
  it("renders a reordered icon to the same raster", async () => {
    // The control. Reversing the order of opaque single-colour strokes cannot
    // change a pixel, so anything but 1 here is a bug in this script rather
    // than a property of the metric.
    const before = flag();
    const after = reverseOrder(before) as CorpusShape[];
    const [a, b] = await Promise.all([
      inkVector(toSvg(before)),
      inkVector(toSvg(after)),
    ]);
    expect(cosine(a, b)).toBe(1);
  });

  it("emits stroke attributes the corpus icons carry", () => {
    const svg = toSvg([stroke("M6 6L14 6")]);
    expect(svg).toContain('viewBox="0 0 24 24"');
    expect(svg).toContain('stroke-width="2"');
    expect(svg).toContain('stroke-linecap="round"');
  });
});
