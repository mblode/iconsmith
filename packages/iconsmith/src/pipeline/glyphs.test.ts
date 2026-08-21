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
      // No exception any more, wifi included. `fit` scales each paint to the
      // declared box, and a paint that lands on the box its twin landed on is
      // the whole claim "one skeleton, two paints" makes.
      expect(sameExtent(canvases[0], canvases[1]), name).toBe(true);
    }
  });

  /**
   * A comment is not a program.
   *
   * The reach set shipped filled halves that were a lone `#` note — "host band
   * ribbons — open arcs enclose nothing under fill" — beside a filled
   * thumbnail rendered some other way, and two others with no filled half at
   * all. Every glyph writes ops in both paints, and where the outline enclosed
   * canvas the fill knocks it out rather than swallowing it.
   */
  it("writes ops, not notes, for the filled half of every glyph", () => {
    for (const name of GLYPH_NAMES) {
      const source = GLYPHS[name](name, "filled");
      const ops = source
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line !== "" && !line.startsWith("#"));
      expect(ops.length, name).toBeGreaterThan(3);
      expect(source, name).toContain("finish filled");
      const drawn = run(source, []);
      expect(drawn.errors, name).toEqual([]);
      expect(drawn.canvas.toSVG(), name).toContain('fill="currentColor"');
    }
  });

  it("punches a hoop into a ring rather than painting a disc", () => {
    for (const name of ["compass", "cookie"] as const) {
      const source = GLYPHS[name](name, "filled");
      expect(source, name).toContain("hole circle 12,12 r8");
      const svg = run(source, []).canvas.toSVG();
      // One `<path>` carrying two subpaths under evenodd is what makes the
      // hole a hole; two paths would paint the knockout as ink.
      expect(svg, name).toContain('fill-rule="evenodd"');
    }
  });

  /** The set the dashboard staged, all of it host-drawn. Named rather than
   *  counted, so dropping one is a failure and not a smaller number. */
  it("draws every icon the reach set asked for", () => {
    expect(GLYPH_NAMES.toSorted()).toEqual([
      "briefcase",
      "cake",
      "compass",
      "cookie",
      "database",
      "fingerprint",
      "microscope",
      "strikethrough",
      "umbrella",
      "wifi",
    ]);
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
    expect(glyphFromSlug("briefcase")).toEqual({
      finish: "outlined",
      glyph: "briefcase",
    });
    expect(glyphFromSlug("bananas")).toBeNull();
  });
});

/**
 * A host glyph is available, not preferred.
 *
 * Classifying by slug meant any of these names silently returned the house
 * drawing — including for a caller who had asked for the agent in as many
 * words — which made every badge read `glyph` and made a staged set unable to
 * fail. So the arm has to be named.
 */
describe("reach reaches a host glyph only when asked", () => {
  it("leaves compass / microscope / wifi to the generator by default", () => {
    for (const slug of ["compass", "microscope", "wifi"]) {
      expect(
        classifyReach(slug, () => false),
        slug
      ).toEqual({
        kind: "analog",
      });
    }
    expect(classifyReach("compass", () => false, true)).toEqual({
      kind: "agent",
    });
  });

  it("classifies as glyph on `unkeyed: glyph`, and only for a name it has", () => {
    expect(
      classifyReach("compass", () => false, false, undefined, "glyph")
    ).toEqual({ kind: "glyph" });
    expect(
      classifyReach("bananas", () => false, false, undefined, "glyph")
    ).toEqual({ kind: "analog" });
  });

  it("never displaces an explicitly requested arm", () => {
    // The bug this pins: `unkeyed: "agent"` on a name with a glyph used to come
    // back as a glyph, so the request was silently overruled.
    expect(
      classifyReach("compass", () => false, false, undefined, "agent")
    ).toEqual({ kind: "analog" });
  });

  it("draws compass with no model and a clean panel when asked for", async () => {
    const result = await reach({ name: "compass" }, { unkeyed: "glyph" });
    expect(result.cost).toBeUndefined();
    expect(result.brief).toContain("compass");
    expect(result.program).toContain("diamond 12,12 r5");
    expect(result.issues.filter((i) => i.severity === "error")).toEqual([]);
    // The needle is a `diamond`, so its edges are on 45° and there is nothing
    // for `off-axis` to say — no declaration, and so no warning either.
    expect(result.issues.filter((i) => i.rule === "off-axis")).toEqual([]);
  });
});
