import { describe, expect, it } from "vitest";

import { mergeIssues, pairPrograms } from "./pair.js";

const RING = ["icon ring", "finish outlined", "", "circle 12,12 r8", ""].join(
  "\n"
);

const RING_FILLED = [
  "icon ring",
  "finish filled",
  "",
  "circle 12,12 r9",
  "hole circle 12,12 r7",
  "",
].join("\n");

const DISC = ["icon ring", "finish filled", "", "circle 12,12 r8", ""].join(
  "\n"
);

describe("mergeIssues", () => {
  it("appends a finding the base list does not already carry", () => {
    const base = [{ message: "a", rule: "gap", severity: "warn" as const }];
    expect(
      mergeIssues(base, [
        { message: "a", rule: "gap", severity: "warn" },
        { message: "b", rule: "extent", severity: "error" },
      ])
    ).toEqual([
      { message: "a", rule: "gap", severity: "warn" },
      { message: "b", rule: "extent", severity: "error" },
    ]);
  });
});

describe("pairPrograms", () => {
  it("is quiet on a ring that occupies one extent in both paints", () => {
    expect(pairPrograms([], "outlined", RING, RING_FILLED)).toEqual([]);
  });

  it("fails a filled disc that restamps a stroked ring", () => {
    const issues = pairPrograms([], "outlined", RING, DISC);
    expect(issues.some((issue) => issue.rule === "extent")).toBe(true);
    expect(issues.every((issue) => issue.severity === "error")).toBe(true);
  });
});
