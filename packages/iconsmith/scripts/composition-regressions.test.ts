import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  compileStyle,
  createStyleRevision,
  replayStyle,
  selectStyle,
} from "../src/pipeline/style.js";
import { run } from "../src/tools/dsl.js";
import { lint, review } from "../src/tools/lint.js";

const fixture = (name: string) =>
  readFileSync(
    new URL(`../bench/composition-regressions/${name}`, import.meta.url),
    "utf-8"
  );
const style = selectStyle(
  createStyleRevision(JSON.parse(fixture("revision.json"))),
  "24"
);

// These are observed user rejections, not synthetic shapes chosen to pass a rule.
// The revised programs remain author edits, not sealed or approved craft examples.
describe("user-reported composition defects through the real pinned compiler", () => {
  it.each([
    ["search-check", "enclosure-alignment"],
    ["database-backup", "arrowhead-quality"],
  ])(
    "surfaces %s locally without confusing exact replay with visual acceptance",
    (name, rule) => {
      for (const state of ["rejected", "revised"]) {
        const program = fixture(`${name}-${state}.icon`);
        const artifact = compileStyle(style, program);
        expect(() => replayStyle(style, artifact)).not.toThrow();
        const drawing = run(program, [...style.parts], { spec: style.spec });
        const findings = lint(drawing.canvas);
        expect(findings.filter((issue) => issue.severity === "error")).toEqual(
          []
        );
        if (state === "rejected") {
          expect(findings).toEqual(
            expect.arrayContaining([
              expect.objectContaining({ rule, severity: "warn" }),
            ])
          );
          expect(review(drawing.canvas)).toEqual(
            expect.arrayContaining([
              expect.objectContaining({ rule, status: "warn" }),
            ])
          );
        } else {
          expect(findings.some((issue) => issue.rule === rule)).toBe(false);
        }
      }
    }
  );
});
