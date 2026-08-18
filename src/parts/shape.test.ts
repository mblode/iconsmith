import { describe, expect, it } from "vitest";

import { parsePath, scale, translate } from "../geometry/path.js";
import type { Subpath } from "../types.js";
import { distance, fingerprint, flatten, resample } from "./shape.js";

const sub = (d: string): Subpath => parsePath(d)[0];
const fp = (d: string) => fingerprint(sub(d));

const SQUARE = "M0 0L10 0L10 10L0 10Z";
/** The same ring, drawn from the next node round. */
const SQUARE_ROTATED = "M10 0L10 10L0 10L0 0Z";
/** The same ring, drawn anticlockwise. */
const SQUARE_REVERSED = "M0 0L0 10L10 10L10 0Z";
const TRIANGLE = "M0 0L10 0L5 10Z";
const ELL = "M0 0L0 10L10 10";
const ELL_MIRRORED = "M10 0L10 10L0 10";
const ROUNDED =
  "M0 4C0 1.8 1.8 0 4 0C6.2 0 8 1.8 8 4C8 6.2 6.2 8 4 8C1.8 8 0 6.2 0 4Z";

/** Loose enough to absorb resampling error, tight relative to the 0.06 the
 *  extractor clusters at — an "identical" shape must be far below that. */
const SAME = 0.02;
const CLUSTER_THRESHOLD = 0.06;

describe("flatten", () => {
  it("walks lines and closes the ring back to the start", () => {
    expect(flatten(sub(SQUARE))).toEqual([
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
      [0, 0],
    ]);
  });

  it("subdivides curves and leaves an open path open", () => {
    const poly = flatten(sub("M0 0C0 5 5 10 10 10"), 8);
    expect(poly).toHaveLength(1 + 8);
    expect(poly.at(-1)).toEqual([10, 10]);
    // A subdivided curve bows off its own chord; a chord fallback would not.
    expect(poly[4][0]).toBeLessThan(5);
  });
});

describe("resample", () => {
  it("spaces points by equal arc length along the polyline", () => {
    const pts = resample(
      [
        [0, 0],
        [4, 0],
      ],
      5
    );
    expect(pts).toEqual([
      [0, 0],
      [1, 0],
      [2, 0],
      [3, 0],
      [4, 0],
    ]);
  });

  it("collapses a zero-length polyline to repeats of its only point", () => {
    const pts = resample(
      [
        [3, 7],
        [3, 7],
      ],
      4
    );
    expect(pts).toEqual([
      [3, 7],
      [3, 7],
      [3, 7],
      [3, 7],
    ]);
  });
});

describe("fingerprint", () => {
  it("normalises into the unit box on the longer axis", () => {
    const f = fp("M0 0L20 0L20 10L0 10Z");
    const xs = f.norm.map((p) => p[0]);
    const ys = f.norm.map((p) => p[1]);
    expect(Math.min(...xs)).toBeCloseTo(0, 6);
    expect(Math.max(...xs)).toBeCloseTo(1, 6);
    expect(Math.max(...ys)).toBeCloseTo(0.5, 6);
    expect(f.aspect).toBeCloseTo(2, 6);
    expect(f.size).toBe(20);
  });

  it("records closedness, node and curve counts", () => {
    const f = fp(ROUNDED);
    expect(f.closed).toBe(true);
    expect(f.nodes).toBe(4);
    expect(f.curves).toBe(4);
  });
});

describe("distance invariances", () => {
  it("is zero against itself", () => {
    expect(distance(fp(SQUARE), fp(SQUARE))).toBeCloseTo(0, 10);
  });

  it("ignores translation", () => {
    const moved = fingerprint(translate(sub(SQUARE), 137, -42));
    expect(distance(fp(SQUARE), moved)).toBeLessThan(SAME);
  });

  it("ignores scale", () => {
    const bigger = fingerprint(scale(sub(SQUARE), 7.5));
    expect(distance(fp(SQUARE), bigger)).toBeLessThan(SAME);
  });

  it("ignores translation and scale together", () => {
    const both = fingerprint(translate(scale(sub(ROUNDED), 0.3), -60, 12));
    expect(distance(fp(ROUNDED), both)).toBeLessThan(SAME);
  });

  it("ignores direction of travel", () => {
    expect(distance(fp(SQUARE), fp(SQUARE_REVERSED))).toBeLessThan(SAME);
  });

  it("ignores which node a closed ring starts from", () => {
    expect(distance(fp(SQUARE), fp(SQUARE_ROTATED))).toBeLessThan(
      CLUSTER_THRESHOLD
    );
  });

  it("leaves a measurable residual when a ring is rotated", () => {
    // Rotation invariance is approximate, not exact. `resample` spaces points
    // over (i / (n - 1)), so the start point appears at both ends of the run
    // and the samples are not a cycle of period n — but `distance` rotates them
    // modulo n. A rotated ring therefore lands between two samples. Recorded
    // rather than asserted away: the worst case here (a half-turn on a square)
    // is 0.043 against a 0.06 clustering threshold, so the margin is thin.
    const halfTurn = distance(fp(SQUARE), fp("M10 10L0 10L0 0L10 0Z"));
    expect(halfTurn).toBeGreaterThan(0.04);
    expect(halfTurn).toBeLessThan(CLUSTER_THRESHOLD);
  });

  it("ignores start node and direction on a curved ring", () => {
    const reversed =
      "M0 4C0 6.2 1.8 8 4 8C6.2 8 8 6.2 8 4C8 1.8 6.2 0 4 0C1.8 0 0 1.8 0 4Z";
    expect(distance(fp(ROUNDED), fp(reversed))).toBeLessThan(SAME);
  });

  it("matches an open path drawn backwards", () => {
    expect(distance(fp(ELL), fp("M10 10L0 10L0 0"))).toBeLessThan(SAME);
  });

  it("is symmetric", () => {
    const a = fp(SQUARE);
    const b = fp(SQUARE_ROTATED);
    expect(distance(a, b)).toBeCloseTo(distance(b, a), 6);
  });

  it("keeps every invariance inside the clustering threshold", () => {
    for (const other of [SQUARE_ROTATED, SQUARE_REVERSED]) {
      expect(distance(fp(SQUARE), fp(other))).toBeLessThan(CLUSTER_THRESHOLD);
    }
  });
});

describe("distance discrimination", () => {
  it("separates genuinely different closed shapes", () => {
    expect(distance(fp(SQUARE), fp(TRIANGLE))).toBeGreaterThan(
      CLUSTER_THRESHOLD
    );
  });

  it("separates a ring from a rounded ring of the same aspect", () => {
    expect(distance(fp(SQUARE), fp(ROUNDED))).toBeGreaterThan(
      CLUSTER_THRESHOLD
    );
  });

  it("never matches an open path against a closed one", () => {
    expect(distance(fp(ELL), fp(SQUARE))).toBe(Number.POSITIVE_INFINITY);
  });

  it("rejects a mismatched aspect ratio outright", () => {
    expect(distance(fp(SQUARE), fp("M0 0L40 0L40 10L0 10Z"))).toBe(
      Number.POSITIVE_INFINITY
    );
  });

  it("does not treat a mirrored open path as identical", () => {
    // Reflection is not one of the claimed invariances: reversal is. An L and
    // its mirror image are different parts and must stay apart.
    expect(distance(fp(ELL), fp(ELL_MIRRORED))).toBeGreaterThan(
      CLUSTER_THRESHOLD
    );
  });
});
