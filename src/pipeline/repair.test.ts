/**
 * The mechanical fix path, tested on the distinctions it exists to draw.
 *
 * Every test here is really the same question asked about a different value:
 * is this residue, or is it a decision? Getting that wrong in the safe
 * direction costs coverage; getting it wrong in the other direction silently
 * redraws a shipped icon, so the boundary cases are the tests that matter.
 */
import { describe, expect, it } from "vitest";

import type { CorpusIcon, CorpusShape, Variant } from "../corpus/load.js";
import { parsePath } from "../geometry/path.js";
import {
  classifyStroke,
  isSpur,
  repairIcon,
  repairSet,
  verifyIcon,
} from "./repair.js";

const first = (d: string) => parsePath(d)[0];

const shape = (over: Partial<CorpusShape> = {}): CorpusShape => ({
  cap: "round",
  d: "M4 4L20 4L20 20L4 20Z",
  filled: false,
  strokeWidth: 2,
  ...over,
});

const icon = (shapes: CorpusShape[], symbol = "test"): CorpusIcon => ({
  shapes,
  symbol,
  variant: {
    corner: "round",
    key: "round-outlined-radius-3-stroke-2",
    radius: 3,
    stroke: 2,
    style: "outlined",
  } satisfies Variant,
});

describe("classifyStroke", () => {
  it("leaves the house stroke and filled shapes alone", () => {
    expect(classifyStroke(2).kind).toBe("keep");
    expect(classifyStroke(0).kind).toBe("keep");
  });

  it("snaps float residue back to the house stroke", () => {
    // Measured in the corpus: 1.995 and 2.05556 are transform residue.
    expect(classifyStroke(1.995)).toMatchObject({ kind: "snap", width: 2 });
    expect(classifyStroke(2.05556)).toMatchObject({ kind: "snap", width: 2 });
  });

  it("refuses to snap a deliberately thinner line", () => {
    // 1.8 is the single commonest off-tier width in the set. Whatever it is,
    // it is not a failed attempt at 2, and snapping it would be a redraw.
    for (const w of [0.75, 1, 1.5, 1.8, 2.2, 2.5, 3.5]) {
      expect(classifyStroke(w).kind).toBe("review");
    }
  });

  it("denoises a deliberate width without changing its weight", () => {
    // 1.90004 is 1.9 carrying float dust. It stays 1.9; it does not become 2.
    const v = classifyStroke(1.90004);
    expect(v.kind).toBe("denoise");
    expect(v.width).toBe(1.9);
  });

  it("does not leave float dust of its own behind", () => {
    // Math.round(1.90004 / 0.05) * 0.05 is 1.9000000000000001.
    expect(String(classifyStroke(1.90004).width)).toBe("1.9");
  });

  it("draws the residue boundary where the corpus does", () => {
    // The window has to clear 1.995 without reaching 1.9.
    expect(classifyStroke(1.95).kind).toBe("snap");
    expect(classifyStroke(1.9).kind).toBe("review");
  });
});

describe("isSpur", () => {
  it("removes a closed contour that doubles back on itself", () => {
    // Out and back along one line: real extent, no area, paints nothing.
    expect(isSpur(first("M4 4L12 4L4 4Z"))).toBe(true);
  });

  it("removes a sub-pixel point", () => {
    expect(isSpur(first("M12 12L12.01 12L12.01 12.01L12 12.01Z"))).toBe(true);
  });

  it("keeps a thin sliver that actually renders", () => {
    // `bag-2-sparkle` carries one of these: 1.8px across with a whisker of
    // area. Deleting it would change the picture, so it is not a spur.
    expect(isSpur(first("M4 4L12 4L12 4.3Z"))).toBe(false);
  });

  it("keeps an open path, which encloses nothing by construction", () => {
    // Every straight stroke in the set matches "no enclosed area". Testing
    // area without testing closure would delete the drawing.
    expect(isSpur(first("M4 4L20 20"))).toBe(false);
  });

  it("keeps an ordinary filled shape", () => {
    expect(isSpur(first("M4 4L20 4L20 20L4 20Z"))).toBe(false);
  });
});

describe("repairIcon", () => {
  it("reports a fix per shape with what it was and what it became", () => {
    const result = repairIcon(icon([shape({ strokeWidth: 1.995 })]));
    expect(result.fixes).toHaveLength(1);
    expect(result.fixes[0]).toMatchObject({
      after: "2",
      before: "1.995",
      kind: "snap-stroke",
      shape: 0,
    });
    expect(result.shapes[0].strokeWidth).toBe(2);
  });

  it("routes a deliberate width to review rather than changing it", () => {
    const result = repairIcon(icon([shape({ strokeWidth: 1.8 })]));
    expect(result.fixes).toEqual([]);
    expect(result.review).toHaveLength(1);
    expect(result.shapes[0].strokeWidth).toBe(1.8);
  });

  it("only strips spurs from filled shapes", () => {
    const spurred = "M4 4L20 4L20 20L4 20ZM4 4L12 4L4 4Z";
    const stroked = repairIcon(icon([shape({ d: spurred })]));
    expect(stroked.fixes).toEqual([]);

    const filled = repairIcon(
      icon([shape({ d: spurred, filled: true, strokeWidth: 0 })])
    );
    expect(filled.fixes[0].kind).toBe("remove-spur");
    expect(parsePath(filled.shapes[0].d)).toHaveLength(1);
  });

  it("leaves the surviving contours byte-identical", () => {
    // The claim of a spur removal is that nothing else moved. Reusing the
    // original text of each kept contour is what makes that true rather than
    // merely likely.
    const keep = "M4 4L20 4L20 20L4 20Z";
    const result = repairIcon(
      icon([
        shape({ d: `${keep}M4 4L12 4L4 4Z`, filled: true, strokeWidth: 0 }),
      ])
    );
    expect(result.shapes[0].d).toBe(keep);
  });

  it("does nothing to an icon that is already clean", () => {
    const result = repairIcon(icon([shape()]));
    expect(result.fixes).toEqual([]);
    expect(result.review).toEqual([]);
  });
});

describe("verifyIcon", () => {
  it("proves a stroke snap leaves the render where it was", async () => {
    const v = await verifyIcon(icon([shape({ strokeWidth: 1.995 })]));
    expect(v.fixes).toHaveLength(1);
    expect(v.inert).toBe(true);
    expect(v.score).toBeGreaterThanOrEqual(0.9995);
  });

  it("proves a spur removal leaves the render where it was", async () => {
    const v = await verifyIcon(
      icon([
        shape({
          d: "M4 4L20 4L20 20L4 20ZM4 4L12 4L4 4Z",
          filled: true,
          strokeWidth: 0,
        }),
      ])
    );
    expect(v.fixes[0].kind).toBe("remove-spur");
    expect(v.score).toBeGreaterThanOrEqual(0.9995);
  });

  it("scores an untouched icon without rendering it", async () => {
    const v = await verifyIcon(icon([shape()]));
    expect(v.score).toBe(1);
    expect(v.inert).toBe(true);
  });
  /**
   * The guard that keeps corrected icons away from the user's shipped package
   * and from the corpus. It was verified by hand when written, which is not the
   * same as being pinned: a refactor that drops the check would leave every
   * other test passing while the fix path silently gained the ability to
   * overwrite 2,085 shipped SVGs. These are the two paths that must always
   * throw.
   */
  it.each([
    "corpus/round-outlined-radius-3-stroke-2",
    "/Users/someone/Code/blode-icons/packages/blode-icons-react/icons-svg",
  ])("refuses to write over %s", async (out) => {
    await expect(
      repairSet({
        corpus: {
          has: () => false,
          load: () => {
            throw new Error("must not load: the guard runs first");
          },
          symbols: [],
        } as never,
        out,
      })
    ).rejects.toThrow(/Refusing to write/u);
  });
});
