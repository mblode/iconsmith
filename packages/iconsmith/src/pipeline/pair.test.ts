import { describe, expect, it } from "vitest";

import { adaptProgram } from "../tools/twin.js";
import {
  mergeIssues,
  paintsDiverge,
  pairAdapted,
  pairFamily,
  pairPrograms,
} from "./pair.js";

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
    expect(issues.some((issue) => issue.rule === "paint")).toBe(true);
    expect(issues.every((issue) => issue.severity === "error")).toBe(true);
  });

  it("fails a restamp after fit, when extent alone would match the keyline", () => {
    const outlined = [
      "icon ring",
      "keyline circle",
      "finish outlined",
      "circle 12,12 r8",
      "fit",
    ].join("\n");
    const filled = [
      "icon ring",
      "keyline circle",
      "finish filled",
      "circle 12,12 r8",
      "fit",
    ].join("\n");
    const issues = pairPrograms([], "outlined", outlined, filled);
    expect(issues.some((issue) => issue.rule === "paint")).toBe(true);
  });
});

describe("pairFamily", () => {
  it("downgrades extent to a warn for house-divergent families only", () => {
    const tick = [
      "icon check",
      "finish outlined",
      "",
      "line 20,6 9,17 4,12 off-axis",
      "",
    ].join("\n");
    const disc = [
      "icon check",
      "finish filled",
      "",
      "circle 12,12 r10",
      "hole line 20,6 9,17 4,12 off-axis",
      "",
    ].join("\n");
    const raw = pairPrograms([], "outlined", tick, disc);
    const softened = pairFamily([], "outlined", tick, disc, "check");
    expect(paintsDiverge("arrow")).toBe(true);
    expect(paintsDiverge("check")).toBe(true);
    expect(paintsDiverge("chevron")).toBe(true);
    expect(paintsDiverge("lock")).toBe(false);
    expect(raw.some((i) => i.rule === "extent" && i.severity === "error")).toBe(
      true
    );
    expect(
      softened.some((i) => i.rule === "extent" && i.severity === "warn")
    ).toBe(true);
    expect(
      softened.some((i) => i.rule === "extent" && i.severity === "error")
    ).toBe(false);
    expect(
      pairFamily([], "outlined", RING, DISC, "ring").some(
        (i) => i.rule === "extent" && i.severity === "error"
      )
    ).toBe(true);
  });
});

describe("pairAdapted", () => {
  it("is quiet when the other paint is the derived twin", () => {
    expect(pairAdapted([], "outlined", RING)).toEqual([]);
  });

  it("fails a filled disc that restamps the derived hoop", () => {
    const issues = pairAdapted([], "filled", DISC);
    expect(issues.some((issue) => issue.rule === "paint")).toBe(true);
    expect(issues.every((issue) => issue.severity === "error")).toBe(true);
  });

  /**
   * A half-arc is the case extent can never pass on this path: `filledArcPath`
   * omits the cap discs that `visualSize` adds to all four sides, so the
   * derived twin reads one unit shorter than the drawing it was derived from.
   * As an error that failed `paintAccepted` before the judge ran — 11 of 42
   * paints in a post-fix eval had extent as their only error.
   */
  it("warns rather than errors on an extent the derivation itself moved", () => {
    const arc = [
      "icon arc",
      "finish outlined",
      "",
      "arc 12,14 r9 half from left",
      "",
    ].join("\n");
    expect(
      pairPrograms([], "outlined", arc, adaptProgram(arc, "filled")).some(
        (i) => i.rule === "extent" && i.severity === "error"
      )
    ).toBe(true);
    const issues = pairAdapted([], "outlined", arc);
    expect(
      issues.some((i) => i.rule === "extent" && i.severity === "warn")
    ).toBe(true);
    expect(issues.filter((i) => i.severity === "error")).toEqual([]);
  });
});
