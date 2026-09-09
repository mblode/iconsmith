import { describe, expect, it } from "vitest";

import { enclosureAlignmentIssues } from "./enclosure-alignment.js";
import type { LintTarget } from "./lint.js";

// Blode source magnifier: ring and handle in one admitted element.
const host =
  "m20 20-3.95-3.95M18 11c0 3.866-3.134 7-7 7s-7-3.134-7-7 3.134-7 7-7 7 3.134 7 7Z";
const target = (mark: string, d = host): LintTarget => ({
  elements: [
    { d, id: "host" },
    { d: mark, id: "mark" },
  ],
});

describe("enclosure alignment", () => {
  it("diagnoses rejected search-check using the ring rather than compound extent", () => {
    const issues = enclosureAlignmentIssues(target("M7 10.5L9.5 13L13.5 9"));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      rule: "enclosure-alignment",
      severity: "warn",
    });
    expect(issues[0].message).toContain("(-0.75, 0.00)");
    expect(issues[0].message).toContain("(11.00, 11.00)");
  });
  it("clears corrected tick without changing source curves", () => {
    const canvas = target("M7.75 10.5L10.25 13L14.25 9");
    const before = JSON.stringify(canvas);
    expect(enclosureAlignmentIssues(canvas)).toEqual([]);
    expect(JSON.stringify(canvas)).toBe(before);
  });
  it("allows modest optical offset", () => {
    expect(enclosureAlignmentIssues(target("M7.5 10.5L10 13L14 9"))).toEqual(
      []
    );
  });
  it.each([
    "M9 9L11 11L13 9",
    "M11 7L11 11L14 14",
    "M8 11L14 11",
    "M19 19L21 21L25 17",
  ])("ignores unrelated or exterior marks: %s", (mark) => {
    expect(enclosureAlignmentIssues(target(mark))).toEqual([]);
  });
  it("does not classify square as circle", () => {
    expect(
      enclosureAlignmentIssues(
        target("M7 10.5L9.5 13L13.5 9", "M4 4L18 4L18 18L4 18Z")
      )
    ).toEqual([]);
  });
  it("leaves multiple marks and filled artwork for review", () => {
    const canvas = target("M7 10.5L9.5 13L13.5 9");
    expect(enclosureAlignmentIssues({ ...canvas, finish: "filled" })).toEqual(
      []
    );
    canvas.elements.push({ d: "M10 7L12 7", id: "extra" });
    expect(enclosureAlignmentIssues(canvas)).toEqual([]);
  });
});
