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
