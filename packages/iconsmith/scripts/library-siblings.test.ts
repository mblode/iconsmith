import { describe, expect, it } from "vitest";

import { librarySiblings } from "./library-siblings.js";

describe("library siblings", () => {
  it("ranks the set's own drawings of a reused element first", () => {
    const result = librarySiblings("square-check");
    expect(result.conceptTags).toContain("checkbox");
    expect(result.siblings[0]?.name).toBe("circle-check");
    expect(result.siblings.map((s) => s.name)).not.toContain("square-check");
    expect(result.excluded).toContain("square-check.svg");
    for (const sibling of result.siblings) {
      expect(sibling.svg).not.toContain("lucide");
      expect(sibling.because.length).toBe(sibling.score);
    }
  });
  it("reads each sibling's strokes back as DSL the author can place", () => {
    const [circleCheck] = librarySiblings("square-check").siblings;
    expect(circleCheck?.elements).toEqual([
      {
        // 4.5 by 5.5 is 5.7 degrees off 45, so the canvas pulls it onto the axis.
        dsl: "line 15,9.5 10.5,15 8.5,13",
        h: 5.5,
        kind: "line",
        quantised: true,
        w: 6.5,
        x: 8.5,
        y: 9.5,
      },
      {
        dsl: "circle 12,12 r9",
        h: 18,
        kind: "circle",
        quantised: false,
        w: 18,
        x: 3,
        y: 3,
      },
    ]);
    const all = librarySiblings("square-check", { limit: 200 }).siblings;
    const exact = all
      .find((s) => s.name === "bubble-check")
      ?.elements.find((e) => e.kind === "line");
    expect(exact).toMatchObject({
      dsl: "line 9.75,11.25 11.25,12.75 14.75,9.25",
      quantised: false,
    });
    expect(all.find((s) => s.name === "check-circle-2")?.elements[0]?.dsl).toBe(
      "line 8,13 10.75,15.5 15,9 off-axis"
    );
    expect(all.find((s) => s.name === "bookmark-check")?.elements).toEqual([]);
  });
  it("excludes Lucide-derived drawings and honours the finish", () => {
    const outlined = librarySiblings("arrow-up-right", { limit: 200 });
    expect(outlined.excluded).toContain("arrow-up-right.svg");
    expect(outlined.siblings.every((s) => !s.name.endsWith("-filled"))).toBe(
      true
    );
    const filled = librarySiblings("square-check", { finish: "filled" });
    expect(filled.siblings.length).toBeGreaterThan(0);
    expect(filled.excluded).toContain("square-check-filled.svg");
  });
  it("returns nothing for an unknown concept with no shared tokens", () => {
    expect(librarySiblings("zzzz").siblings).toEqual([]);
  });
});
