import { describe, expect, it } from "vitest";

import { Canvas, SPEC, specAt } from "./canvas.js";

describe("specAt", () => {
  it("keeps the house 24 / stroke-2 / radius-3 cut as SPEC", () => {
    const house = specAt();
    expect(house).toEqual(SPEC);
    expect(house.size).toBe(24);
    expect(house.stroke).toBe(2);
    expect(house.radius).toBe(3);
    expect(house.radiusTiers).toEqual([0.5, 1, 2, 3]);
    expect(house.fillRadiusTiers).toEqual([0.5, 1, 1.5, 2, 3, 4]);
    expect(house.minFeature).toBe(1.5);
    expect(house.minGap).toBe(1);
    expect(house.maxElements).toBe(8);
    expect(house.dots.terminal).toBe(2);
  });

  it("drops hairline corners and terminal dots at 16px", () => {
    const cut = specAt({ size: 16 });
    expect(cut.canvas).toBe(24);
    expect(cut.size).toBe(16);
    expect(cut.radiusTiers).toEqual([1, 2, 3]);
    expect(cut.dots.terminal).toBeUndefined();
    expect(cut.dots.node).toBe(4);
    expect(cut.maxElements).toBe(5);
    expect(cut.minFeature).toBe(2.25);
    expect(cut.minGap).toBe(1.5);
  });

  it("caps outlined tiers at the family radius", () => {
    expect(specAt({ radius: 2 }).radiusTiers).toEqual([0.5, 1, 2]);
    expect(specAt({ radius: 1, size: 16 }).radiusTiers).toEqual([1]);
  });

  it("paints the requested stroke, and snaps corners to the cut's tiers", () => {
    const cut = specAt({ radius: 2, size: 16, stroke: 1.5 });
    const canvas = new Canvas([], { spec: cut });
    expect(canvas.inkWidth).toBe(1.5);
    canvas.rect({ h: 8, r: 0.5, w: 8, x: 8, y: 8 });
    expect(canvas.toSVG()).toContain('stroke-width="1.5"');
    const [drawn] = canvas.elements;
    expect(drawn && "r" in drawn ? drawn.r : undefined).toBe(1);
  });
});
