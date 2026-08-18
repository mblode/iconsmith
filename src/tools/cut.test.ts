import { describe, expect, it } from "vitest";

import { cuts } from "./cut.js";

const shape = (d: string, id: string) => ({ d, id });

/** A circular arc as cubics, so a fixture's ends carry the circle's real
 *  tangents rather than a chord's. Split at 90°, past which one cubic stops
 *  approximating a circle at all. */
const arc = (
  cx: number,
  cy: number,
  r: number,
  from: number,
  to: number
): string => {
  const at = (a: number): [number, number] => [
    cx + r * Math.cos(a),
    cy + r * Math.sin(a),
  ];
  const steps = Math.ceil(Math.abs(to - from) / (Math.PI / 2));
  const step = (to - from) / steps;
  const h = (4 / 3) * Math.tan(step / 4) * r;
  let d = `M${at(from).join(" ")}`;
  for (let i = 0; i < steps; i += 1) {
    const a0 = from + i * step;
    const a1 = a0 + step;
    const [x0, y0] = at(a0);
    const [x1, y1] = at(a1);
    d += `C${x0 - h * Math.sin(a0)} ${y0 + h * Math.cos(a0)} ${x1 + h * Math.sin(a1)} ${y1 - h * Math.cos(a1)} ${x1} ${y1}`;
  }
  return d;
};

describe("cuts", () => {
  it("measures the missing span of a straight stroke", () => {
    // A horizontal rule stopping at 9 and resuming at 15, with a vertical
    // stroke through the hole: a 6-unit cut.
    const found = cuts([
      shape("M2 12H9M15 12H22", "rule"),
      shape("M12 6V18", "riser"),
    ]);
    expect(found).toHaveLength(1);
    expect(found[0].length).toBeCloseTo(6, 6);
    expect(found[0].chord).toBeCloseTo(6, 6);
    expect(found[0].at).toEqual([12, 12]);
    expect(found[0].interrupter).toBe("riser");
    expect(found[0].interrupted).toEqual(["rule", "rule"]);
  });

  it("reports one cut per interruption", () => {
    const found = cuts([
      shape("M2 12H6M9 12H15M18 12H22", "rule"),
      shape("M7.5 6V18", "left"),
      shape("M16.5 6V18", "right"),
    ]);
    expect(found.map((c) => c.length)).toEqual([3, 3]);
    expect(found.map((c) => c.interrupter).toSorted()).toEqual([
      "left",
      "right",
    ]);
  });

  it("credits the shapes on both sides when they are different elements", () => {
    const found = cuts([
      shape("M2 12H9", "west"),
      shape("M15 12H22", "east"),
      shape("M12 6V18", "riser"),
    ]);
    expect(found).toHaveLength(1);
    expect(found[0].interrupted).toEqual(["west", "east"]);
  });

  it("measures along the contour, not across it", () => {
    // Two arcs of a radius-8 circle with a 0.5 rad hole at the top, crossed by
    // a spoke. Arc length is rΔ = 4; the chord is 2r·sin(Δ/2) = 3.959.
    const r = 8;
    const gap = 0.5;
    const found = cuts([
      shape(arc(12, 12, r, -Math.PI / 2 + gap / 2, Math.PI), "ring-a"),
      shape(arc(12, 12, r, Math.PI, (3 * Math.PI) / 2 - gap / 2), "ring-b"),
      shape("M12 12L12 2", "spoke"),
    ]);
    expect(found).toHaveLength(1);
    expect(found[0].chord).toBeCloseTo(2 * r * Math.sin(gap / 2), 2);
    expect(found[0].length).toBeCloseTo(r * gap, 1);
    expect(found[0].length).toBeGreaterThan(found[0].chord);
  });

  it("ignores a hole nothing sits in", () => {
    expect(cuts([shape("M2 12H9M15 12H22", "rule")])).toEqual([]);
  });

  it("ignores a shape that stops at the stroke instead of crossing it", () => {
    // The riser terminates a unit short on both sides: clearance, which is
    // lint's `gap` rule, not a knockout.
    expect(
      cuts([shape("M2 12H9M15 12H22", "rule"), shape("M12 6V11", "riser")])
    ).toEqual([]);
  });

  it("ignores an open path whose ends are merely loose", () => {
    // A check mark crossed by a rule: two free ends, pointing nowhere near
    // each other, so nothing pairs.
    expect(
      cuts([shape("M6 12L10 16L18 8", "check"), shape("M2 14H22", "rule")])
    ).toEqual([]);
  });

  it("stitches fragments that share endpoints before looking for ends", () => {
    // The frame is four `M` commands meeting at four corners — the way Central
    // emits an outline. Every endpoint is shared, so there are no free ends and
    // the diagonal through it cuts nothing.
    expect(
      cuts([
        shape("M4 4H20M20 4V20M20 20H4M4 20V4", "frame"),
        shape("M2 2L22 22", "slash"),
      ])
    ).toEqual([]);
  });

  it("ignores a closed shape, which has no free ends to pair", () => {
    expect(
      cuts([shape("M4 4H20V20H4Z", "frame"), shape("M2 2L22 22", "slash")])
    ).toEqual([]);
  });

  it("returns nothing for an empty canvas", () => {
    expect(cuts([])).toEqual([]);
  });
});
