import { describe, expect, it } from "vitest";

import { Canvas, SPEC } from "./canvas.js";
import { format, lint } from "./lint.js";
import type { LintElement } from "./lint.js";

const el = (id: string, d: string): LintElement => ({ d, id });
const canvas = (...elements: LintElement[]) => ({ elements });
const rules = (issues: { rule: string }[]) => issues.map((i) => i.rule);

/** 16×16 path bbox centred on (12,12): an 18×18 visual extent once the 2px
 *  stroke is counted, which is exactly the square keyline. */
const SQUARE = "M4 4L20 4L20 20L4 20Z";

describe("lint", () => {
  it("stays quiet on a clean icon", () => {
    expect(lint(canvas(el("e0", SQUARE)))).toEqual([]);
    expect(format(lint(canvas(el("e0", SQUARE))))).toBe(
      "clean — no violations"
    );
  });

  it("accepts the same icon against the keyline it declares", () => {
    expect(lint(canvas(el("e0", SQUARE)), { keyline: "square" })).toEqual([]);
  });

  it("fires `centred` when the content centre drifts off (12,12)", () => {
    const issues = lint(canvas(el("e0", "M6 4L22 4L22 20L6 20Z")));
    expect(rules(issues)).toContain("centred");
    const centred = issues.find((i) => i.rule === "centred");
    // A warning, not an error: a cohort that agrees on an off-centre box
    // outranks this rule, and `cohort-align` is what blocks a commit.
    expect(centred?.severity).toBe("warn");
    expect(centred?.message).toContain("(14.00, 12.00)");
  });

  it("fires `keyline` as a warning when the visual extent matches none", () => {
    // 10×10 bbox → 12×12 extent, which is no keyline in the system.
    const issues = lint(canvas(el("e0", "M7 7L17 7L17 17L7 17Z")));
    const keyline = issues.find((i) => i.rule === "keyline");
    expect(keyline?.severity).toBe("warn");
    expect(keyline?.message).toContain("12.0×12.0");
  });

  it("fires `keyline` as an error when it mismatches a declared one", () => {
    const issues = lint(canvas(el("e0", SQUARE)), { keyline: "circle" });
    const keyline = issues.find((i) => i.rule === "keyline");
    expect(keyline?.severity).toBe("error");
    expect(keyline?.message).toContain("wants 20×20");
  });

  it("fires `bleed` when geometry reaches the canvas edge", () => {
    const issues = lint(canvas(el("e0", "M0 0L24 0L24 24L0 24Z")));
    expect(rules(issues)).toContain("bleed");
    expect(issues.find((i) => i.rule === "bleed")?.severity).toBe("error");
  });

  it("fires `gap` when two elements sit closer than the minimum", () => {
    // Derived from the spec rather than written out, so recalibrating `minGap`
    // against the corpus does not silently turn this test into a no-op.
    // Half the minimum, so the pair is inside it however it is calibrated.
    const gapPx = SPEC.minGap / 2;
    const half = gapPx / 2;
    const issues = lint(
      canvas(
        el("e0", `M4 ${12 - half}L20 ${12 - half}`),
        el("e1", `M4 ${12 + half}L20 ${12 + half}`)
      )
    );
    const gap = issues.find((i) => i.rule === "gap");
    expect(gap?.severity).toBe("warn");
    expect(gap?.message).toContain(`e0 and e1 are ${gapPx.toFixed(2)}px apart`);
  });

  it("does not fire `gap` for a shape nested inside another", () => {
    // The distance is measured polyline-to-polyline; a bbox comparison would
    // call these two overlapping and report a violation that is not there.
    const issues = lint(
      canvas(el("e0", SQUARE), el("e1", "M10 10L14 10L14 14L10 14Z"))
    );
    expect(rules(issues)).not.toContain("gap");
    expect(issues).toEqual([]);
  });

  it("fires `density` past eight elements", () => {
    const lines = Array.from({ length: 9 }, (_, i) =>
      el(`e${i}`, `M${4 + i * 2} 8L${4 + i * 2} 16`)
    );
    const issues = lint(canvas(...lines));
    expect(rules(issues)).toContain("density");
    // Spaced exactly at the minimum gap, so density is the only complaint here.
    expect(rules(issues)).not.toContain("gap");
  });

  it("fires `empty`, and only `empty`, on an empty canvas", () => {
    expect(lint(canvas())).toEqual([
      { message: "Canvas is empty.", rule: "empty", severity: "error" },
    ]);
  });

  it("formats issues one per line", () => {
    const out = format(lint(canvas(el("e0", "M6 4L22 4L22 20L6 20Z"))));
    expect(out.split("\n")[0]).toMatch(/^\[warn\] centred: /u);
  });
});

describe("lint over a real canvas", () => {
  it("reads a Canvas directly", () => {
    const c = new Canvas();
    c.rect({ h: 16, r: 0, w: 16, x: 4, y: 4 });
    expect(lint(c)).toEqual([]);
  });
});
