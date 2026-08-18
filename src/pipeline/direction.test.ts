/**
 * Direction measurement, tested on lines whose slope is obvious by eye.
 *
 * The corpus is gitignored, so anything needing it cannot run in CI. Every
 * fixture is a single straight line whose direction can be read off its
 * coordinates — which also pins the one thing most likely to be silently wrong
 * here, that SVG's y axis grows downward and "rising" is therefore a *negative*
 * slope.
 */
import { describe, expect, it } from "vitest";

import type { CorpusIcon, CorpusShape, Variant } from "../corpus/load.js";
import {
  isDiagonal,
  measureComposition,
  measureIcon,
  namedAxis,
  straightSegments,
} from "./direction.js";

const shape = (d: string): CorpusShape => ({
  cap: "round",
  d,
  filled: false,
  strokeWidth: 2,
});

const icon = (symbol: string, ds: string[]): CorpusIcon => ({
  shapes: ds.map((d) => shape(d)),
  symbol,
  variant: {
    corner: "round",
    key: "round-outlined-radius-3-stroke-2",
    radius: 3,
    stroke: 2,
    style: "outlined",
  } satisfies Variant,
});

/** Bottom-left to top-right: x grows, y shrinks. */
const RISING = "M4 20L20 4";
/** Top-left to bottom-right: both grow. This is the slash direction. */
const FALLING = "M4 4L20 20";
const HORIZONTAL = "M4 12L20 12";
const VERTICAL = "M12 4L12 20";

describe("straightSegments", () => {
  it("reads an angle that does not depend on which end the path starts at", () => {
    const [forward] = straightSegments(icon("a", [RISING]));
    const [backward] = straightSegments(icon("a", ["M20 4L4 20"]));
    expect(forward.angle).toBeCloseTo(backward.angle, 9);
  });

  it("ignores curve and arc segments, counting only straight runs", () => {
    const curve = "M4 4C8 4 12 8 12 12";
    expect(straightSegments(icon("a", [curve]))).toHaveLength(0);
  });
});

describe("isDiagonal", () => {
  it("rejects horizontal and vertical runs", () => {
    for (const d of [HORIZONTAL, VERTICAL]) {
      expect(
        straightSegments(icon("a", [d])).filter((s) => isDiagonal(s))
      ).toEqual([]);
    }
  });

  it("rejects a run too short to be a deliberate slant", () => {
    // A 1px diagonal is a corner cut, not a direction.
    const tiny = "M12 12L12.7 11.3";
    expect(
      straightSegments(icon("a", [tiny])).filter((s) => isDiagonal(s))
    ).toEqual([]);
  });

  it("accepts a clear slant", () => {
    expect(
      straightSegments(icon("a", [RISING])).filter((s) => isDiagonal(s))
    ).toHaveLength(1);
  });
});

describe("measureIcon", () => {
  it("calls a bottom-left to top-right line rising, despite y growing downward", () => {
    expect(measureIcon(icon("a", [RISING])).direction).toBe("rising");
  });

  it("calls a top-left to bottom-right line falling", () => {
    expect(measureIcon(icon("a", [FALLING])).direction).toBe("falling");
  });

  it("reports no direction when nothing is diagonal", () => {
    const m = measureIcon(icon("a", [HORIZONTAL, VERTICAL]));
    expect(m.direction).toBe("none");
    expect(m.rising).toBe(0);
    expect(m.falling).toBe(0);
  });

  it("reports balanced when both axes are drawn about equally", () => {
    // An X. Neither direction wins, and calling it either would be a coin toss
    // recorded as a fact.
    expect(measureIcon(icon("a", [RISING, FALLING])).direction).toBe(
      "balanced"
    );
  });

  it("lets the longer diagonal decide when one clearly dominates", () => {
    const short = "M11 13L13 11";
    expect(measureIcon(icon("a", [FALLING, short])).direction).toBe("falling");
  });

  it("flags a name-slash regardless of how long its diagonal is", () => {
    expect(measureIcon(icon("bell-off", [FALLING])).slashByName).toBe(true);
    expect(measureIcon(icon("no-flash", [FALLING])).slashByName).toBe(true);
    expect(measureIcon(icon("eye-slash", [FALLING])).slashByName).toBe(true);
    expect(measureIcon(icon("bell", [FALLING])).slashByName).toBe(false);
  });
});

describe("namedAxis", () => {
  it("gives opposite arrowheads on one axis the same answer", () => {
    // The point of measuring the axis rather than the arrowhead: these two are
    // the same line, and neither is evidence against the other.
    expect(namedAxis("arrow-up-right")).toBe("rising");
    expect(namedAxis("arrow-down-left")).toBe("rising");
    expect(namedAxis("arrow-up-left")).toBe("falling");
    expect(namedAxis("arrow-down-right")).toBe("falling");
  });

  it("only reads adjacent tokens, so a distant word does not name an axis", () => {
    expect(namedAxis("arrow-up")).toBeNull();
    expect(namedAxis("panel-right-collapse-up")).toBeNull();
    expect(namedAxis("square-arrow-top-right")).toBe("rising");
  });
});

describe("measureComposition", () => {
  const BIG = "M2 2L16 2L16 16L2 16Z";
  const SMALL_TR = "M18 4L22 4L22 8L18 8Z";
  const SMALL_BL = "M2 18L6 18L6 22L2 22Z";

  it("says where the smaller mark sits", () => {
    expect(measureComposition(icon("a", [BIG, SMALL_TR]))?.quadrant).toBe(
      "top-right"
    );
    expect(measureComposition(icon("a", [BIG, SMALL_BL]))?.quadrant).toBe(
      "bottom-left"
    );
  });

  it("declines when the two marks are comparable in size", () => {
    // Not a big element and a small one — just two elements. The rule has
    // nothing to say here and neither should the measurement.
    const left = "M2 2L10 2L10 20L2 20Z";
    const right = "M14 2L22 2L22 20L14 20Z";
    expect(measureComposition(icon("a", [left, right]))).toBeNull();
  });

  it("declines when the icon is not two marks", () => {
    expect(measureComposition(icon("a", [BIG]))).toBeNull();
    expect(measureComposition(icon("a", [BIG, SMALL_TR, SMALL_BL]))).toBeNull();
  });
});
