import { describe, expect, it } from "vitest";

import type { LegibilityMetrics } from "./legibility.js";
import {
  band,
  bandSensitivity,
  CUT_24_TO_16,
  DEFAULT_THRESHOLDS,
  measureLegibility,
} from "./legibility.js";

const svg = (body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none">${body}</svg>`;

/** A filled bar one unit tall, for the no-stroke cases. */
const filled = (y: number) =>
  `<path d="M4 ${y}L20 ${y}L20 ${y + 1}L4 ${y + 1}Z" fill="currentColor"/>`;

const stroked = (d: string, width = 1.5) =>
  `<path d="${d}" stroke="currentColor" stroke-width="${width}"/>`;

/** Two horizontal rules `apart` units between centre lines. */
const pair = (apart: number) =>
  svg(
    `${stroked(`M4 ${12 - apart / 2}H20`)}${stroked(`M4 ${12 + apart / 2}H20`)}`
  );

describe("gap measurement", () => {
  it("converts a centre-line distance into white at the target cut", async () => {
    // 4.0 apart at 24 with a 1.5 stroke is 2.5 of white. Refit: 4·(2/3) = 2.67
    // between centres, less the 1.25 stroke, is 1.42 device px at 16.
    const m = await measureLegibility("pair", pair(4));
    expect(m.minGap).toBeCloseTo(4 * (2 / 3) - 1.25, 2);
    expect(m.minGapSource).toBeCloseTo(2.5, 2);
  });

  it("says nothing about strokes that already overlap at the source", async () => {
    // 1.2 apart with a 1.5 stroke is ink sharing ink: a join drawn as two
    // paths. A refit cannot close a gap that was never open.
    const m = await measureLegibility("joined", pair(1.2));
    expect(m.minGap).toBeNull();
  });

  it("does not read a smooth curve as folding back on itself", async () => {
    // The regression that moved the corpus headline by 500 icons: the
    // arc-length exclusion window, measured across a curve, looks exactly like
    // two strokes a window's width apart. A lone circle has no gap at all.
    const m = await measureLegibility(
      "circle",
      svg('<circle cx="12" cy="12" r="9" stroke="currentColor" />')
    );
    expect(m.subpaths).toBe(1);
    expect(m.minGap).toBeNull();
  });
});

describe("stroke is read per element", () => {
  it("subtracts no stroke between two filled contours", async () => {
    // A filled glyph has no stroke to widen, so its white gap is the whole
    // centre-line distance. Treating it as a 1.25 stroke understates the white
    // in the quarter of the corpus that is filled.
    const m = await measureLegibility("filled", svg(filled(8) + filled(14)));
    expect(m.filledOnly).toBe(true);
    // 5.0 between the nearest contours, no stroke subtracted either side.
    expect(m.minGapSource).toBeCloseTo(5, 1);
  });

  it("subtracts half a stroke when only one side carries one", async () => {
    const m = await measureLegibility(
      "mixed",
      svg(`${stroked("M4 8H20")}${filled(14)}`)
    );
    expect(m.filledOnly).toBe(false);
    // 6.0 apart, less half of the one stroke present.
    expect(m.minGapSource).toBeCloseTo(6 - 0.75, 1);
  });
});

describe("shape elements", () => {
  it("reads circle, rect and ellipse, not only path", async () => {
    // 239 of the corpus's 2,085 files place a shape this way — `user` draws its
    // head as a `<circle>`. A path-only parser measures those icons with a
    // whole shape missing and reports a clean number for a crowded icon.
    const m = await measureLegibility(
      "shapes",
      svg(
        `<circle cx="7" cy="7" r="3" stroke="currentColor"/>
         <rect x="14" y="14" width="6" height="6" rx="1" stroke="currentColor"/>
         <ellipse cx="7" cy="18" rx="3" ry="2" stroke="currentColor"/>`
      )
    );
    expect(m.subpaths).toBe(3);
    expect(m.minGap).not.toBeNull();
  });
});

const metric = (over: Partial<LegibilityMetrics>): LegibilityMetrics => ({
  counterArea: null,
  filledOnly: false,
  inkDensity: 0.2,
  junctions: 0,
  length: 40,
  minGap: 3,
  minGapSource: 3,
  name: "m",
  segments: 6,
  smallFidelity: 0.98,
  subpaths: 2,
  tightPairs: 0,
  ...over,
});

describe("banding", () => {
  it("passes an icon whose ink stays a pixel apart", () => {
    expect(band(metric({})).band).toBe("mechanical");
  });

  it("demands a redraw when ink merges", () => {
    const v = band(metric({ minGap: 0.2 }));
    expect(v.band).toBe("needs-redraw");
    expect(v.reasons[0]).toContain("gap");
  });

  it("demands a redraw when a counter fills in", () => {
    expect(band(metric({ counterArea: 0.3 })).band).toBe("needs-redraw");
  });

  it("separates one tight spot from a drawing packed throughout", () => {
    // The distinction the tightest gap alone cannot make: both of these have
    // the same minimum, and only one of them can be fixed by nudging.
    expect(band(metric({ minGap: 0.8, tightPairs: 1 })).band).toBe(
      "needs-review"
    );
    expect(band(metric({ minGap: 0.8, tightPairs: 12 })).band).toBe(
      "needs-redraw"
    );
  });

  it("treats an icon with no measurable gap as nothing to merge", () => {
    expect(band(metric({ minGap: null })).band).toBe("mechanical");
  });
});

describe("sensitivity", () => {
  it("reports band sizes across a threshold sweep", () => {
    const metrics = [0.3, 0.6, 0.9, 1.4].map((g) => metric({ minGap: g }));
    const sweep = bandSensitivity(metrics, [0.25, 0.5, 1], DEFAULT_THRESHOLDS);
    expect(sweep.map((s) => s.counts["needs-redraw"])).toEqual([0, 1, 3]);
    // Mechanical is bounded by gapTight, so it does not move with gapMerge.
    expect(new Set(sweep.map((s) => s.counts.mechanical)).size).toBe(1);
  });
});

describe("the cut", () => {
  it("states the two cuts being compared", () => {
    expect(CUT_24_TO_16).toEqual({
      fromGrid: 24,
      fromStroke: 1.5,
      toGrid: 16,
      toStroke: 1.25,
    });
  });
});
