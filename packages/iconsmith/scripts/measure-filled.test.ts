/**
 * The measurements this file guards are the ones a wrong answer would be
 * invisible in: a hole counted as a solid, a `<circle>` element dropped, an
 * extent measured without the stroke. Every case is a string literal, so the
 * suite runs whether or not the corpus is present.
 */
import { describe, expect, it } from "vitest";

import { parsePath } from "../src/geometry/path.js";
import {
  analyseIcon,
  classify,
  conformance,
  jointModes,
  parseFilledElements,
} from "./measure-filled.js";

const svg = (body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none">${body}</svg>`;

/** A 20-unit square with a 4-unit square hole, knocked out by nesting under
 *  `evenodd` — the construction 1,195 icons of the set declare. */
const RING_EVENODD = svg(
  '<path fill-rule="evenodd" clip-rule="evenodd" d="M2 2H22V22H2Z M10 10H14V14H10Z" fill="currentColor"/>'
);

/** The same shape knocked out by winding direction alone, under the default
 *  `nonzero` — the construction a boolean subtract produces, and 486 of the
 *  set's knockouts use it. */
const RING_NONZERO = svg(
  '<path d="M2 2H22V22H2Z M10 10V14H14V10Z" fill="currentColor"/>'
);

describe("reading the elements", () => {
  it("keeps `<circle>` elements, which carry no `d` of their own", () => {
    const els = parseFilledElements(
      svg('<circle cx="12" cy="12" r="8" fill="currentColor"/>')
    );
    expect(els).toHaveLength(1);
    expect(els[0].d).toMatch(/^M20 12/u);
    expect(els[0].fillRule).toBe("nonzero");
    expect(els[0].strokeWidth).toBe(0);
  });

  it("reads the fill rule off the element that declares it", () => {
    const els = parseFilledElements(RING_EVENODD);
    expect(els[0].fillRule).toBe("evenodd");
  });

  it("records the stroke a filled icon still carries", () => {
    const els = parseFilledElements(
      svg('<path d="M2 2H22" stroke="currentColor" stroke-width="2"/>')
    );
    expect(els[0].strokeWidth).toBe(2);
  });
});

describe("finding the knockouts", () => {
  it("counts a nested evenodd subpath as a hole, not a solid", () => {
    const icon = analyseIcon("ring", RING_EVENODD);
    expect(icon.holes).toHaveLength(1);
    expect(icon.solids).toHaveLength(1);
    expect(icon.holes[0].box).toMatchObject({ h: 4, w: 4 });
  });

  it("counts a counter-wound nonzero subpath as a hole", () => {
    const icon = analyseIcon("ring", RING_NONZERO);
    expect(icon.holes).toHaveLength(1);
  });

  it("does not call a co-wound nonzero subpath a hole — it paints over", () => {
    const icon = analyseIcon(
      "over",
      svg('<path d="M2 2H22V22H2Z M10 10H14V14H10Z" fill="currentColor"/>')
    );
    expect(icon.holes).toHaveLength(0);
    expect(icon.solids).toHaveLength(2);
  });

  it("counts a shape buried in another element rather than calling it a hole", () => {
    const icon = analyseIcon(
      "buried",
      svg(
        '<path d="M2 2H22V22H2Z" fill="currentColor"/><path d="M10 10H14V14H10Z" fill="currentColor"/>'
      )
    );
    expect(icon.holes).toHaveLength(0);
    expect(icon.buriedShapes).toBe(1);
  });
});

describe("the visual extent", () => {
  it("is the bare bbox when nothing is stroked", () => {
    const icon = analyseIcon(
      "square",
      svg('<path d="M2 2H22V22H2Z" fill="currentColor"/>')
    );
    expect(icon.extent.w).toBe(20);
    expect(icon.margin).toBe(2);
  });

  it("grows a stroked element by half its own stroke on each side", () => {
    const icon = analyseIcon(
      "stroked",
      svg('<path d="M3 3H21V21H3Z" stroke="currentColor" stroke-width="2"/>')
    );
    expect(icon.extent.w).toBe(20);
    expect(icon.margin).toBe(2);
  });
});

describe("which primitive would have drawn it", () => {
  it("calls a disc a disc", () => {
    const [sp] = parseFilledElements(
      svg('<circle cx="12" cy="12" r="8" fill="currentColor"/>')
    ).flatMap((e) => parsePath(e.d));
    expect(classify(sp)).toBe("disc");
  });

  it("calls an axis-aligned box a rect", () => {
    const [sp] = parsePath("M2 2H22V22H2Z");
    expect(classify(sp)).toBe("rect");
  });

  it("calls a diagonal silhouette neither", () => {
    const [sp] = parsePath("M12 2L22 22L2 22Z");
    expect(classify(sp)).toBe("other");
  });
});

describe("the extent vocabulary", () => {
  it("buckets joint extents and orders them by count", () => {
    expect(
      jointModes([
        { h: 20, w: 20 },
        { h: 19.9, w: 20.1 },
        { h: 18, w: 18 },
      ])
    ).toEqual([
      { count: 2, h: 20, w: 20 },
      { count: 1, h: 18, w: 18 },
    ]);
  });

  it("scores an extent against a keyline on its worse axis", () => {
    expect(conformance([{ h: 20, w: 20.4 }], [[20, 20]])).toBe(1);
    expect(conformance([{ h: 20, w: 20.6 }], [[20, 20]])).toBe(0);
  });
});
