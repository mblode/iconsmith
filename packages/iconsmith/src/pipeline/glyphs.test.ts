import { describe, expect, it } from "vitest";

import { inspect, measureIcon } from "../eval/blindspot.js";
import { offAxisEdges, iconEdgeAngles } from "../tools/angle.js";
import { run } from "../tools/dsl.js";
import { lint } from "../tools/lint.js";
import { sameExtent } from "../tools/twin.js";
import type { Finish } from "../types.js";
import { glyphFromSlug, GLYPH_NAMES, GLYPHS } from "./glyphs.js";
import { classifyReach, reach } from "./reach.js";

const FINISHES: Finish[] = ["outlined", "filled"];

const issuesOf = (name: (typeof GLYPH_NAMES)[number], finish: Finish) => {
  const drawn = run(GLYPHS[name](name, finish), []);
  expect(drawn.errors, `${name} ${finish} dsl`).toEqual([]);
  return {
    drawn,
    issues: lint(drawn.canvas, { keyline: drawn.keyline }),
  };
};

describe("glyphs", () => {
  it("runs every glyph in both finishes", () => {
    for (const name of GLYPH_NAMES) {
      const canvases = FINISHES.map((finish) => {
        const { drawn } = issuesOf(name, finish);
        expect(drawn.canvas.toSVG().length).toBeGreaterThan(40);
        if (finish === "filled") {
          expect(drawn.canvas.toSVG()).toContain('fill="currentColor"');
        } else {
          expect(drawn.canvas.toSVG()).toContain('stroke="currentColor"');
        }
        return drawn.canvas;
      });
      if (name !== "wifi") {
        expect(sameExtent(canvases[0], canvases[1]), name).toBe(true);
      }
    }
  });

  it("lints without errors or the screenshot warnings", () => {
    for (const name of GLYPH_NAMES) {
      for (const finish of FINISHES) {
        const { issues } = issuesOf(name, finish);
        const errors = issues.filter((i) => i.severity === "error");
        expect(errors, `${name} ${finish}`).toEqual([]);
        expect(
          issues.filter((i) => i.rule === "off-axis"),
          `${name} ${finish} off-axis`
        ).toEqual([]);
        if (finish === "outlined") {
          expect(
            issues.filter((i) => i.rule === "gap"),
            `${name} gap`
          ).toEqual([]);
        }
        expect(
          issues.filter((i) => i.rule === "keyline"),
          `${name} ${finish} keyline`
        ).toEqual([]);
      }
    }
  });

  it("passes the structural panel in both finishes", async () => {
    const cases = GLYPH_NAMES.flatMap((name) =>
      FINISHES.map((finish) => ({ finish, name }))
    );
    const verdicts = await Promise.all(
      cases.map(async ({ finish, name }) => {
        const { drawn } = issuesOf(name, finish);
        const measurement = await measureIcon(drawn.canvas.toSVG());
        return { failed: inspect(name, measurement).failed, finish, name };
      })
    );
    for (const { failed, finish, name } of verdicts) {
      expect(failed, `${name} ${finish}`).toEqual([]);
    }
  });

  it("keeps the compass needle on 45°/135°", () => {
    const { drawn } = issuesOf("compass", "outlined");
    const needle = drawn.canvas.elements.find((e) => e.kind === "line");
    expect(needle).toBeDefined();
    const off = offAxisEdges(iconEdgeAngles([needle?.d ?? ""]));
    expect(off).toEqual([]);
    expect(GLYPHS.compass("compass", "outlined")).toContain("diamond 12,12 r5");
  });

  it("places the microscope on tall 16×20, with 1px gaps and empty corners", () => {
    const { drawn, issues } = issuesOf("microscope", "outlined");
    expect(drawn.keyline).toBe("tall");
    expect(GLYPHS.microscope("microscope", "outlined")).toContain(
      "keyline tall"
    );
    const size = drawn.canvas.bbox();
    expect(size).not.toBeNull();
    const w = (size?.w ?? 0) + drawn.canvas.inkWidth;
    const h = (size?.h ?? 0) + drawn.canvas.inkWidth;
    expect(w).toBeCloseTo(16, 0);
    expect(h).toBeGreaterThanOrEqual(19);
    expect(h).toBeLessThanOrEqual(21);
    expect(issues.filter((i) => i.rule === "gap")).toEqual([]);
    expect(issues.filter((i) => i.rule === "keyline")).toEqual([]);
  });

  it("places wifi on the wide 20×16 keyline, not a drifted 20×11.5 fan", () => {
    const { drawn, issues } = issuesOf("wifi", "outlined");
    expect(drawn.keyline).toBe("wide");
    const size = drawn.canvas.bbox();
    expect(size).not.toBeNull();
    const w = (size?.w ?? 0) + drawn.canvas.inkWidth;
    const h = (size?.h ?? 0) + drawn.canvas.inkWidth;
    expect(w).toBeCloseTo(20, 0);
    expect(h).toBeCloseTo(16, 0);
    expect(issues.filter((i) => i.rule === "keyline")).toEqual([]);
  });

  it("decodes a -filled twin", () => {
    expect(glyphFromSlug("compass-filled")).toEqual({
      finish: "filled",
      glyph: "compass",
    });
    expect(glyphFromSlug("wifi")).toEqual({
      finish: "outlined",
      glyph: "wifi",
    });
    expect(glyphFromSlug("briefcase")).toBeNull();
  });
});

describe("reach prefers host glyphs", () => {
  it("classifies compass / microscope / wifi as glyph, not analog or agent", () => {
    expect(classifyReach("compass", () => false)).toEqual({ kind: "glyph" });
    expect(classifyReach("microscope", () => false)).toEqual({ kind: "glyph" });
    expect(classifyReach("wifi", () => false)).toEqual({ kind: "glyph" });
    expect(classifyReach("compass", () => false, true)).toEqual({
      kind: "agent",
    });
  });

  it("draws compass with no model and a clean panel", async () => {
    const result = await reach({ name: "compass" });
    expect(result.cost).toBeUndefined();
    expect(result.brief).toContain("compass");
    expect(result.program).toContain("diamond 12,12 r5");
    expect(result.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(result.issues.filter((i) => i.rule === "off-axis")).toEqual([]);
  });
});
