/**
 * The record an arm leaves about its own drawing, and the two ways the reach
 * set's version of it could lie.
 */
import { describe, expect, it } from "vitest";

import type { Issue } from "../types.js";
import { thinking, traceOf } from "./thinking.js";

const PROGRAM = [
  "icon compass",
  "keyline circle",
  "finish outlined",
  "",
  "circle 12,12 r9",
  "diamond 12,12 r5",
  "fit",
  "# a note",
].join("\n");

const warn: Issue = {
  message: "off the keyline",
  rule: "keyline",
  severity: "warn",
};
const error: Issue = { message: "empty", rule: "empty", severity: "error" };

describe("thinking", () => {
  it("fills every field, so a missing key cannot read as a pass", () => {
    const record = thinking({
      brief: "compile fingerprint",
      finish: "outlined",
      issues: [],
      policy: "compile",
      program: PROGRAM,
    });
    expect(Object.keys(record).toSorted()).toEqual([
      "brief",
      "clean",
      "finish",
      "issues",
      "policy",
      "program",
      "steps",
      "suppressed",
      "trace",
    ]);
    expect(record.clean).toBe(true);
    expect(record.trace).toEqual([
      "icon",
      "keyline",
      "finish",
      "circle",
      "diamond",
      "fit",
    ]);
    expect(record.steps).toBe(6);
  });

  /** `compass` recorded `clean: true` beside a non-empty `issues`. A status
   *  that can contradict its own evidence is worse than no status. */
  it("derives clean from the findings rather than taking a second opinion", () => {
    const build = (issues: Issue[]) =>
      thinking({
        brief: "b",
        finish: "filled",
        issues,
        policy: "glyph",
        program: PROGRAM,
      });
    expect(build([]).clean).toBe(true);
    // A warning is a judgement a human arbitrates, not a block.
    expect(build([warn]).clean).toBe(true);
    expect(build([error]).clean).toBe(false);
    expect(build([warn, error]).clean).toBe(false);
  });

  it("keeps a waiver, so a deliberate diagonal stays distinguishable", () => {
    const record = thinking({
      brief: "b",
      finish: "outlined",
      issues: [],
      policy: "glyph",
      program: PROGRAM,
      suppressed: [
        {
          declared: "off-axis",
          findings: 2,
          reason: "the program asked for the diagonal by name",
          rule: "off-axis",
          subject: "e1",
        },
      ],
    });
    expect(record.suppressed).toHaveLength(1);
    expect(record.clean).toBe(true);
  });
});

describe("traceOf", () => {
  it("strips comments and blanks, and lowercases the op", () => {
    expect(traceOf("RECT 3,3 18x18\n\n# note\nfit  # trailing")).toEqual([
      "rect",
      "fit",
    ]);
  });

  it("has nothing to report for a program that is only a comment", () => {
    expect(traceOf("# host band ribbons — open arcs enclose nothing")).toEqual(
      []
    );
  });
});
