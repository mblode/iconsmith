import { describe, expect, it } from "vitest";

import { arrowheadQualityIssues } from "./arrowhead-quality.js";
import { run } from "./dsl.js";

const check = (program: string) => {
  const drawing = run(`icon arrow-test\nfinish outlined\n${program}`);
  expect(drawing.errors).toEqual([]);
  return arrowheadQualityIssues(drawing.canvas);
};

describe("compact curved arrowhead junction", () => {
  it("warns on the original rejected database-backup arrow geometry", () => {
    const issues = check(
      "arc 17,17 r4 three-quarter from right\nline 15.5,11.5 17,13 15.5,14.5"
    );
    expect(issues).toEqual([
      expect.objectContaining({ rule: "arrowhead-quality", severity: "warn" }),
    ]);
    expect(issues[0].message).toContain("1.50-unit arrowhead depth");
  });

  it("clears the revised head with greater depth and tangent extension", () => {
    expect(
      check(
        "arc 17,17 r4 three-quarter from right\nline 17,13 19,13\nline 17,11 19,13 17,15"
      )
    ).toEqual([]);
  });

  it.each([
    "arc 17,17 r4 three-quarter from bottom\nline 19.5,15.5 21,17 22.5,15.5",
    "arc 17,17 r4 three-quarter from left\nline 18.5,19.5 17,21 18.5,22.5",
    "arc 17,17 r4 three-quarter from top\nline 11.5,18.5 13,17 14.5,18.5",
  ])("recognises rotated crowded junctions: %s", (program) => {
    expect(check(program)).toHaveLength(1);
  });

  it("does not reject a compact head on a straight shaft", () => {
    expect(check("line 8,13 17,13\nline 15.5,11.5 17,13 15.5,14.5")).toEqual(
      []
    );
  });

  it("does not classify separate checks or unrelated corners as arrows", () => {
    expect(
      check(
        "arc 17,17 r4 three-quarter from right\nline 8,12 10,14 14,10\nline 4,5 5.5,6.5 4,8"
      )
    ).toEqual([]);
  });

  it("does not infer an aesthetic failure for larger direct heads", () => {
    expect(
      check("arc 17,17 r4 three-quarter from right\nline 15,11 17,13 15,15")
    ).toEqual([]);
  });

  it("skips filled drawings and leaves the original geometry unchanged", () => {
    const drawing = run(
      "arc 17,17 r4 three-quarter from right\nline 15.5,11.5 17,13 15.5,14.5"
    );
    const before = JSON.stringify(drawing.canvas.elements);
    expect(arrowheadQualityIssues(drawing.canvas)).toHaveLength(1);
    expect(JSON.stringify(drawing.canvas.elements)).toBe(before);
    expect(
      arrowheadQualityIssues({
        elements: drawing.canvas.elements,
        finish: "filled",
      })
    ).toEqual([]);
  });
});
