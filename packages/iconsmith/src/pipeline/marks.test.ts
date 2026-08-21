import { describe, expect, it } from "vitest";

import { inspect, measureIcon } from "../eval/blindspot.js";
import { run } from "../tools/dsl.js";
import { lint } from "../tools/lint.js";
import { hbar, sameExtent } from "../tools/twin.js";
import type { Finish } from "../types.js";
import { MARK_NAMES, MARKS } from "./marks.js";

const FINISHES: Finish[] = ["outlined", "filled"];

const barSource = (finish: Finish): string =>
  [
    "icon bar",
    "keyline square",
    `finish ${finish}`,
    "",
    hbar(finish, 7, 12, 10),
    "",
  ].join("\n");

describe("marks", () => {
  it("runs every mark in both finishes", () => {
    for (const name of MARK_NAMES) {
      const canvases = FINISHES.map((finish) => {
        const source = MARKS[name](name, finish);
        const drawn = run(source, []);
        expect(drawn.errors, `${name} ${finish}`).toEqual([]);
        expect(source).toContain(`finish ${finish}`);
        if (finish === "filled") {
          expect(drawn.canvas.toSVG()).toContain('fill="currentColor"');
          expect(drawn.canvas.toSVG()).not.toContain("stroke=");
        } else {
          expect(drawn.canvas.toSVG()).toContain('stroke="currentColor"');
        }
        return drawn.canvas;
      });
      expect(sameExtent(canvases[0], canvases[1]), name).toBe(true);
    }
  });

  it("lints without errors in both finishes", () => {
    for (const name of MARK_NAMES) {
      for (const finish of FINISHES) {
        const source = MARKS[name](name, finish);
        const drawn = run(source, []);
        const errors = lint(drawn.canvas, { keyline: drawn.keyline }).filter(
          (issue) => issue.severity === "error"
        );
        expect(errors, `${name} ${finish}`).toEqual([]);
      }
    }
  });

  it("passes the structural panel in both finishes", async () => {
    const cases = MARK_NAMES.flatMap((name) =>
      FINISHES.map((finish) => ({ finish, name }))
    );
    const verdicts = await Promise.all(
      cases.map(async ({ finish, name }) => {
        const drawn = run(MARKS[name](name, finish), []);
        const measurement = await measureIcon(drawn.canvas.toSVG());
        return { failed: inspect(name, measurement).failed, finish, name };
      })
    );
    for (const { failed, finish, name } of verdicts) {
      expect(failed, `${name} ${finish}`).toEqual([]);
    }
  });

  it("parks hamburger bars on the 6-unit grid", () => {
    const outlined = MARKS["hamburger-menu"]("hamburger-menu", "outlined");
    expect(outlined).toContain("line 4,6 20,6");
    expect(outlined).toContain("line 4,12 20,12");
    expect(outlined).toContain("line 4,18 20,18");
    expect(outlined).not.toContain("line 4,8 20,8");
  });

  it("keeps a view-grid tile's inner corner after the stroke", () => {
    const outlined = MARKS["view-grid"]("view-grid", "outlined");
    const filled = MARKS["view-grid"]("view-grid", "filled");
    expect(outlined).toContain("6x6 r2");
    expect(outlined).not.toContain("6x6 r1");
    expect(filled).toContain("8x8 r3");
    expect(filled).not.toContain("6x6 r1");
  });

  it("keeps the outlined battery cap a hollow terminal on the body's right edge", () => {
    const outlined = MARKS.battery("battery", "outlined");
    const filled = MARKS.battery("battery", "filled");
    expect(outlined).toContain("rect 3,8 15x8 r2");
    expect(outlined).not.toContain("rect 3,8 16x8");
    expect(filled).toContain("rect 2,7 17x10 r3");
    expect(outlined).toContain("rect 18,9 3x6 r1");
    expect(outlined).not.toContain("rect 18,10 2x4");
    expect(filled).toContain("rect 17,8 5x8 r2");
    expect(filled).not.toContain("hole rect");
  });

  it("does not run a line through outlined timeline rings", () => {
    const outlined = MARKS.timeline("timeline", "outlined");
    expect(outlined).toContain("dot ");
    expect(outlined).toContain("line ");
    expect(outlined).not.toContain("circle ");
    const filled = MARKS.timeline("timeline", "filled");
    expect(filled).toContain("dot ");
    expect(filled).not.toContain("circle ");
  });

  it("does not overlap the flag and the pole", () => {
    const outlined = MARKS.flag("flag", "outlined");
    expect(outlined).toContain("rect 7,6 11x8");
    expect(outlined).not.toContain("rect 6,4 12x8");
    const filled = MARKS.flag("flag", "filled");
    expect(filled).toContain("rect 5,3 2x18");
    expect(filled).toContain("rect 7,6 12x10");
    expect(filled).not.toContain(" r1");
  });

  it("draws a filled ring as circle plus hole, with the slash as the same line", () => {
    const filled = MARKS.ban("ban", "filled");
    expect(filled).toContain("hole circle");
    expect(filled).toContain("off-axis");
    const outlined = MARKS.ban("ban", "outlined");
    expect(outlined).toContain("off-axis");
    expect(outlined).not.toContain("hole ");
  });

  it("matches hbar twin extent without fit", () => {
    const outlined = run(barSource("outlined"), []);
    const filled = run(barSource("filled"), []);
    expect(outlined.errors).toEqual([]);
    expect(filled.errors).toEqual([]);
    expect(barSource("outlined")).not.toContain("fit");
    expect(barSource("filled")).not.toContain("fit");
    expect(sameExtent(outlined.canvas, filled.canvas)).toBe(true);
  });
});
