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
/** The same triangle, drawn from the next node round. */
const TRIANGLE_SHIFTED = "M10 0L5 10L0 0Z";
const ELL = "M0 0L0 10L10 10";
/** Unequal arms, so the shape is chiral: its mirror is not also one of its
 *  turns, which an equal-armed L's would be. */
const ELL_CHIRAL = "M0 0L0 10L4 10";
const ELL_CHIRAL_MIRRORED = "M4 0L4 10L0 10";
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
  it("normalises onto the centre, unit-wide on the longer axis", () => {
    const f = fp("M0 0L20 0L20 10L0 10Z");
    const xs = f.norm.map((p) => p[0]);
    const ys = f.norm.map((p) => p[1]);
    expect(Math.min(...xs)).toBeCloseTo(-0.5, 6);
    expect(Math.max(...xs)).toBeCloseTo(0.5, 6);
    expect(Math.min(...ys)).toBeCloseTo(-0.25, 6);
    expect(Math.max(...ys)).toBeCloseTo(0.25, 6);
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

  it("leaves a measurable residual when a start node is shifted", () => {
    // Start-node invariance is approximate, not exact. `resample` spaces points
    // over (i / (n - 1)), so the start point appears at both ends of the run
    // and the samples are not a cycle of period n — but `distance` shifts them
    // modulo n. A ring drawn from another node therefore lands between two
    // samples. Recorded rather than asserted away: a triangle costs 0.033
    // against a 0.06 clustering threshold, so the margin is thin. A square
    // escapes it only because a shifted square is also one of its own turns,
    // and `distance` compares those exactly.
    const shifted = distance(fp(TRIANGLE), fp(TRIANGLE_SHIFTED));
    expect(shifted).toBeGreaterThan(0.03);
    expect(shifted).toBeLessThan(CLUSTER_THRESHOLD);
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

describe("distance under quarter-turns", () => {
  /** A chevron 4 wide and 10 tall, and the same mark at each quarter-turn.
   *  This is the shape class the extractor was splitting: a corner mark used at
   *  four orientations came back as four parts. */
  const TIP = "M0 0L4 5L0 10";
  const TIP_TURNS = ["M10 0L5 4L0 0", "M4 10L0 5L4 0", "M0 10L5 6L10 10"];

  it("matches an open mark against each of its quarter-turns", () => {
    for (const turned of TIP_TURNS) {
      expect(distance(fp(TIP), fp(turned))).toBeLessThan(SAME);
    }
  });

  it("matches a closed ring against its quarter-turn", () => {
    // 8x4 against 4x8: the aspect is transposed, which the old gate rejected
    // outright before any point was compared.
    const wide = fp("M0 0L8 0L8 4L0 4Z");
    const tall = fp("M0 0L4 0L4 8L0 8Z");
    expect(distance(wide, tall)).toBeLessThan(CLUSTER_THRESHOLD);
  });

  it("stays symmetric across a transposed pair", () => {
    // The transposed gate has to take the better of both directions:
    // |2 - 1/0.4| is 0.5 and would reject, |0.4 - 1/2| is 0.1 and would accept.
    const wide = fp("M0 0L10 0L10 5L0 5Z");
    const tall = fp("M0 0L4 0L4 10L0 10Z");
    expect(distance(wide, tall)).toBeCloseTo(distance(tall, wide), 10);
  });

  it("still rejects proportions that no turn can reconcile", () => {
    const wide = fp("M0 0L40 0L40 10L0 10Z");
    const squarish = fp(SQUARE);
    expect(distance(wide, squarish)).toBe(Number.POSITIVE_INFINITY);
    expect(distance(squarish, wide)).toBe(Number.POSITIVE_INFINITY);
  });

  it("does not merge different shapes that share a turned aspect", () => {
    // An 8x4 ellipse and a 4x8 rectangle transpose onto each other's
    // proportions, so the gate opens. Turning must not make them one part.
    const ellipse = fp(
      "M0 2C0 0.9 1.8 0 4 0C6.2 0 8 0.9 8 2C8 3.1 6.2 4 4 4C1.8 4 0 3.1 0 2Z"
    );
    const rect = fp("M0 0L4 0L4 8L0 8Z");
    expect(distance(ellipse, rect)).toBeGreaterThan(CLUSTER_THRESHOLD);
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
    // Reflection is not one of the claimed invariances: reversal and turning
    // are. The arms have to be unequal for this to test anything — an
    // equal-armed L's mirror is also one of its quarter-turns, so it matches at
    // 0 and says nothing about reflection. This pair sits at 0.34.
    expect(distance(fp(ELL_CHIRAL), fp(ELL_CHIRAL_MIRRORED))).toBeGreaterThan(
      CLUSTER_THRESHOLD
    );
  });
});
