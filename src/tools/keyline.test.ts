import { describe, expect, it } from "vitest";

import type { KeylineMetrics } from "./keyline.js";
import {
  clusterExtents,
  conformance,
  measureKeyline,
  nearestKeyline,
  visualExtent,
} from "./keyline.js";
import { parsePieces } from "./legibility.js";

const svg = (body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none">${body}</svg>`;

describe("visual extent", () => {
  it("inflates a stroked path by half its stroke per side", () => {
    // A 16-unit box drawn with a 2 stroke has an 18-unit visual extent: the
    // square keyline. Reading the path bbox alone reports 16 and calls a
    // conforming icon off-system.
    const pieces = parsePieces(
      svg(
        '<path d="M4 4L20 4L20 20L4 20Z" stroke="currentColor" stroke-width="2"/>'
      ),
      2
    );
    expect(visualExtent(pieces)).toMatchObject({ vx: 18, vy: 18 });
  });

  it("inflates a filled contour by nothing", () => {
    // The distinction that matters across a quarter of this corpus: a filled
    // shape has no stroke, so its visual extent is its outline. Adding a stroke
    // to it would overstate every filled brand glyph by a full 2 units.
    const pieces = parsePieces(
      svg('<path d="M4 4L20 4L20 20L4 20Z" fill="currentColor"/>'),
      2
    );
    expect(visualExtent(pieces)).toMatchObject({ vx: 16, vy: 16 });
  });

  it("grows each piece by its own stroke, not by one shared value", () => {
    const pieces = parsePieces(
      svg(
        `<path d="M4 4L20 4L20 20L4 20Z" fill="currentColor"/>
         <path d="M11 2H13" stroke="currentColor" stroke-width="2"/>`
      ),
      2
    );
    // The filled box reaches y 4..20; the stroked cap reaches y 1, not y 2.
    expect(visualExtent(pieces).vy).toBeCloseTo(19, 5);
  });
});

describe("keylines", () => {
  it("names the nearest optical shape and the distance to it", () => {
    expect(nearestKeyline(20, 20)).toEqual({ deviation: 0, nearest: "circle" });
    expect(nearestKeyline(18, 18)).toEqual({ deviation: 0, nearest: "square" });
    expect(nearestKeyline(20, 16)).toEqual({ deviation: 0, nearest: "wide" });
    expect(nearestKeyline(16, 20)).toEqual({ deviation: 0, nearest: "tall" });
  });

  it("measures deviation on the worse axis, not the average", () => {
    // 20×18 is on-size in x and 2 out in y. Averaging would call it 1.0 away
    // and hide the fact that it is a shape the four keylines do not describe.
    expect(nearestKeyline(20, 18).deviation).toBe(2);
  });

  it("bands a deviation into on, near or off", () => {
    expect(conformance(0)).toBe("on");
    expect(conformance(0.5)).toBe("on");
    expect(conformance(1)).toBe("near");
    expect(conformance(1.5)).toBe("near");
    expect(conformance(2)).toBe("off");
  });
});

describe("silhouette area", () => {
  it("makes a circle-keyline disc and a square-keyline square the same size", async () => {
    // The article's claim, as arithmetic. A disc drawn to the circle keyline
    // (20 across) covers 314 units; a square drawn to the square keyline (18
    // across) covers 324. Within 3% — which is why the two keylines are
    // different sizes in the first place.
    const disc = await measureKeyline(
      "disc",
      svg('<circle cx="12" cy="12" r="10" fill="currentColor"/>')
    );
    const box = await measureKeyline(
      "box",
      svg('<path d="M3 3L21 3L21 21L3 21Z" fill="currentColor"/>')
    );
    expect(box.hullArea).toBeCloseTo(324, 0);
    expect(box.hullArea / disc.hullArea).toBeLessThan(1.05);
  });

  it("and the same-box pairing the keylines exist to prevent does not", async () => {
    // Draw the disc to the square's box instead and it loses 27% of its area,
    // which is the amount by which it would read smaller than its neighbours.
    const disc = await measureKeyline(
      "disc",
      svg('<circle cx="12" cy="12" r="9" fill="currentColor"/>')
    );
    const box = await measureKeyline(
      "box",
      svg('<path d="M3 3L21 3L21 21L3 21Z" fill="currentColor"/>')
    );
    expect(box.hullArea / disc.hullArea).toBeGreaterThan(1.25);
  });
});

describe("ink anisotropy", () => {
  it("is near 1 for a circle and high for a long thin bar", async () => {
    const round = await measureKeyline(
      "round",
      svg(
        '<circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2"/>'
      )
    );
    const bar = await measureKeyline(
      "bar",
      svg('<path d="M3 12H21" stroke="currentColor" stroke-width="2"/>')
    );
    expect(round.anisotropy).toBeLessThan(1.2);
    expect(bar.anisotropy).toBeGreaterThan(3);
    expect(bar.axisDeg).toBeLessThan(10);
  });
});

const extentOnly = (vx: number, vy: number): KeylineMetrics => ({
  anisotropy: 1,
  axisDeg: 0,
  deviation: 0,
  filledOnly: false,
  hullArea: 0,
  inkArea: 0,
  name: `${vx}x${vy}`,
  nearest: "square",
  vx,
  vy,
});

describe("extent clustering", () => {
  it("ranks the extents the set actually uses", () => {
    const m = extentOnly;
    const clusters = clusterExtents([
      m(20, 20),
      m(20, 20),
      m(20.1, 19.9),
      m(18, 18),
    ]);
    expect(clusters[0]).toEqual({ count: 3, vx: 20, vy: 20 });
    expect(clusters[1]).toEqual({ count: 1, vx: 18, vy: 18 });
  });
});
