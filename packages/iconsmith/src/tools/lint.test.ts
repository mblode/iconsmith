import { describe, expect, it } from "vitest";

import { Canvas, SPEC } from "./canvas.js";
import { format, lint, review } from "./lint.js";
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

  it("names the live area it enforces, not the one the spec asks for", () => {
    // The message said 2..22 while the constants enforced 1..23. `clearance` is
    // still 2 and this rule still is not; the message has to admit that, or the
    // next reader recalibrates against a number nothing checks.
    const issues = lint(canvas(el("e0", "M0.5 0.5L23.5 0.5L23.5 23.5Z")));
    const bleed = issues.find((i) => i.rule === "bleed");
    expect(bleed?.message).toContain("live area is 1..23");
    expect(bleed?.message).toContain("path bounds");
    // At 1.5 units of clearance the path bbox is inside the enforced area and
    // outside the spec's, which is the whole of the disagreement.
    expect(
      rules(lint(canvas(el("e0", "M1.5 1.5L22.5 1.5L22.5 22.5Z"))))
    ).not.toContain("bleed");
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

  it("measures staggered parallel edges, not their endpoints", () => {
    // Vertex-to-vertex over flatten sees only the four endpoints and reports
    // ~4px, which is above minGap. The edges overlap and sit 0.50 apart.
    const issues = lint(
      canvas(el("e0", "M4 12L16 12"), el("e1", "M8 12.5L20 12.5"))
    );
    const gap = issues.find((i) => i.rule === "gap");
    expect(gap?.severity).toBe("warn");
    expect(gap?.message).toContain("0.50px apart");
  });

  it("does not fire `gap` when two strokes cross", () => {
    // `ban`: a slash through a ring. Vertex-to-vertex reported the overhang
    // (endpoint to nearest circle sample ≈ 0.485) and told a generator to
    // move a pair that already intersects.
    const drawn = new Canvas();
    drawn.circle({ cx: 12, cy: 12, r: 8 });
    drawn.line({
      offAxis: true,
      points: [
        [6, 6],
        [18, 18],
      ],
    });
    expect(rules(lint(drawn))).not.toContain("gap");
  });

  it("does not fire `gap` on a 1px centre-line stack", () => {
    // Microscope optical stack: circle bottom at y=7, rect top at y=8.
    // Flatten vertices can sit 0.50 apart around a rounded corner; the
    // edges clear a unit, which is the house floor, not an almost-touch.
    const drawn = new Canvas();
    drawn.circle({ cx: 12, cy: 5, r: 2 });
    drawn.rect({ h: 6, r: 1, w: 3, x: 10.5, y: 8 });
    expect(rules(lint(drawn))).not.toContain("gap");
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

  it("fires `cut` when a notch is tighter than the floor", () => {
    // A horizontal rule stopping at 11 and resuming at 13, crossed by a riser:
    // a 2-unit hole where the set never goes below 3.
    const issues = lint(
      canvas(el("e0", "M4 12H11M13 12H20"), el("e1", "M12 4V20"))
    );
    const cut = issues.find((i) => i.rule === "cut");
    // A warning: the pairing can be wrong, and a cut is a spacing judgement.
    expect(cut?.severity).toBe("warn");
    expect(cut?.message).toContain("e1 cuts e0 by 2.00px at (12.0, 12.0)");
  });

  it("stays quiet at the floor, which is where the set actually draws", () => {
    // 3.00 exactly — `fork-spoon`'s middle tine. The floor is literal, so the
    // tightest thing blode-icons draws must not be a violation.
    const issues = lint(
      canvas(el("e0", "M4 12H10.5M13.5 12H20"), el("e1", "M12 4V20"))
    );
    expect(rules(issues)).not.toContain("cut");
  });

  it("does not report a `gap` as a `cut`", () => {
    // A riser that stops on the rule instead of crossing it: clearance between
    // two shapes, which is `gap`'s question, not a hole in one of them.
    const issues = lint(
      canvas(el("e0", "M4 12H11M13 12H20"), el("e1", "M12 4V11.5"))
    );
    expect(rules(issues)).not.toContain("cut");
  });

  it("fires `off-axis` on an edge between two grid points", () => {
    // (6,6)→(18,12): endpoints both on the grid, slope 1/2, 26.57° — the
    // commonest off-axis angle in the set, and 18.4° off the nearest axis.
    const issues = lint(canvas(el("e0", "M6 6L18 12")));
    const off = issues.find((i) => i.rule === "off-axis");
    // `warn`: the rule fires on 29.3% of Central, which is the specification.
    expect(off?.severity).toBe("warn");
    expect(off?.message).toContain(
      '"e0" has an edge at 26.6°, 18.4° off the nearest permitted axis (45°)'
    );
  });

  it("stays quiet on the permitted axes", () => {
    expect(rules(lint(canvas(el("e0", "M6 6L18 18"))))).not.toContain(
      "off-axis"
    );
    expect(rules(lint(canvas(el("e0", "M6 18L18 6"))))).not.toContain(
      "off-axis"
    );
  });

  it("ignores fills, whose joins are the flattener's angles", () => {
    // 30% of segments in an outline-expanded fill are off-axis against 15% of
    // the stroked ones; the extra is Figma's expander, not anybody's design.
    const fill: LintElement = { d: "M6 6L18 12", id: "e0", strokeWidth: 0 };
    expect(rules(lint(canvas(fill)))).not.toContain("off-axis");
  });

  /** Four edges of a kite are two headings, and reporting each segment made
   *  one diamond look like four problems — the compass's four warnings. */
  it("reports one line per element per distinct angle, with the count", () => {
    const kite = el("e0", "M16 8L13.5 13.5L8 16L10.5 10.5Z");
    const off = lint(canvas(kite)).filter((i) => i.rule === "off-axis");
    expect(off).toHaveLength(2);
    expect(off[0].message).toContain('"e0" has 2 edges at 114.4°');
    expect(off[1].message).toContain('"e0" has an edge at 155.6°');
  });

  /**
   * A declaration is permission to draw, not permission to be silent.
   *
   * The reasoning is worth pinning because a revision had it the other way and
   * it looks reasonable from one angle: `canvas.ts` refuses an undeclared
   * diagonal, so every off-axis edge reaching lint was asked for, so warning
   * seems like telling the drawer off for using the door the spec put there.
   * The flaw is what that leaves behind. If declared means silent, the rule can
   * never fire on any program-drawn icon — the only ones left are the shipped
   * SVGs — and a rule calibrated at 29.3% of the corpus has been turned off for
   * everything the pipeline makes. `SKILL.md` says a `warn` is the prompt to
   * confirm a choice was deliberate, which is exactly this case, and
   * `canvas.ts` puts the declaration in the document so "a reviewer sees it".
   * So: still a warning, addressed to a reviewer rather than to a drawer.
   */
  it("still warns on a declared diagonal, and says it was declared", () => {
    const declared: LintElement = { d: "M6 6L18 12", id: "e0", offAxis: true };
    const found = lint(canvas(declared)).filter((i) => i.rule === "off-axis");
    expect(found).toHaveLength(1);
    expect(found[0].severity).toBe("warn");
    expect(found[0].declared).toBe("off-axis");
    expect(found[0].message).toContain("26.6°");
    expect(found[0].message).toContain("declared");
    // Addressed to a reviewer: there is nothing here to fix.
    expect(found[0].message).toContain("confirm");
  });

  it("marks nothing as declared on an element that never left the axes", () => {
    const declared: LintElement = { d: "M6 6L18 18", id: "e0", offAxis: true };
    // The flag asked and did not need to, so there is no finding to mark.
    expect(lint(canvas(declared)).filter((i) => i.rule === "off-axis")).toEqual(
      []
    );
    expect(lint(canvas(declared)).some((i) => i.declared !== undefined)).toBe(
      false
    );
  });

  it("asks an undeclared diagonal to be fixed or declared", () => {
    const found = lint(canvas(el("e0", "M6 6L18 12"))).find(
      (i) => i.rule === "off-axis"
    );
    expect(found?.declared).toBeUndefined();
    expect(found?.message).toContain("`off-axis` on the line");
  });

  /**
   * `angle.ts`: hand in stroked shapes only. An outline-expanded fill puts a fan
   * of short segments at whatever angle the flattener chose around every round
   * join, so measuring one reports the expander and not a decision.
   *
   * The filter used to be `strokeWidth ?? spec.stroke > 0`, which was true of a
   * `Canvas` — it sets no width at all — so every filled element read as
   * stroked-at-2 from the moment fill mode existed.
   */
  it("measures no angles on a filled drawing, whatever the widths say", () => {
    const kite = el("e0", "M16 8L13.5 13.5L8 16L10.5 10.5Z");
    expect(rules(lint({ elements: [kite], finish: "filled" }))).not.toContain(
      "off-axis"
    );
    expect(rules(lint({ elements: [kite], finish: "outlined" }))).toContain(
      "off-axis"
    );
  });

  it("ignores runs too short to be edges", () => {
    // 1.12 units at 26.57°, below the 1.5 at which `segments.ts` believes a
    // diagonal: at any shorter length the survivors are corner-join residue.
    expect(rules(lint(canvas(el("e0", "M6 6L7 6.5"))))).not.toContain(
      "off-axis"
    );
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

  it("fires `substance` on the single line the loop shipped as `git-branch`", () => {
    // The icon that motivated the rule: one vertical stroke, dead centre, on
    // axis, inside the live area. Every other check here was content with it.
    const issues = lint(canvas(el("e0", "M7 3L7 21")));
    const substance = issues.find((i) => i.rule === "substance");
    expect(substance?.severity).toBe("error");
    expect(substance?.message).toContain("2.0×20.0");
    expect(substance?.message).toContain("single bare stroke");
    expect(rules(issues)).not.toContain("off-axis");
    expect(rules(issues)).not.toContain("bleed");
  });

  it("fires `substance` on a mark smaller than anything the set draws", () => {
    // A lone 4×4 dot: thick enough to clear the minor floor, too small to be
    // an icon. The smallest the corpus goes is 6.8 across its long axis.
    const issues = lint(canvas(el("e0", "M11 11L13 11L13 13L11 13Z")));
    const substance = issues.find((i) => i.rule === "substance");
    expect(substance?.severity).toBe("error");
    expect(substance?.message).toContain("at its widest");
  });

  it("stays quiet on the smallest marks the set actually draws", () => {
    // `chevron-triangle-up-small`'s extent, 8.0×6.2, and `chevron-down-small`'s
    // 10.0×5.6 — both real icons, both must survive an error-severity rule.
    // Squares stand in for the shapes; only the extent is under test.
    expect(
      rules(lint(canvas(el("e0", "M9 9.1L15 9.1L15 13.3L9 13.3Z"))))
    ).not.toContain("substance");
    expect(
      rules(lint(canvas(el("e0", "M8 10.2L16 10.2L16 13.8L8 13.8Z"))))
    ).not.toContain("substance");
  });

  it("fires `substance` on a bar, which is the rule's known false positive", () => {
    // `minus-large`: 18×2, three of the 2,085 icons in the house variant, and
    // the price of the rule. Pinned so nobody discovers it by surprise.
    const issues = lint(canvas(el("e0", "M4 12L20 12")));
    expect(issues.find((i) => i.rule === "substance")?.severity).toBe("error");
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

describe("review", () => {
  it("keeps the questions that passed, not only the failures", () => {
    const checks = review(canvas(el("e0", SQUARE)), { keyline: "square" });
    expect(checks.every((c) => c.status === "pass")).toBe(true);
    expect(checks.map((c) => c.rule)).toEqual([
      "substance",
      "centred",
      "keyline",
      "bleed",
      "gap",
      "cut",
      "off-axis",
      "density",
    ]);
    const keyline = checks.find((c) => c.rule === "keyline");
    expect(keyline?.message).toContain('declared keyline "square"');
    expect(keyline?.message).toContain("18×18");
    expect(checks.find((c) => c.rule === "off-axis")?.message).toContain(
      "0/45/90"
    );
    expect(checks.find((c) => c.rule === "gap")?.message).toContain("1px");
  });

  it("reports a warning as a check rather than dropping the rest of the chain", () => {
    const checks = review(canvas(el("e0", "M6 4L22 4L22 20L6 20Z")));
    const centred = checks.find((c) => c.rule === "centred");
    expect(centred?.status).toBe("warn");
    expect(checks.find((c) => c.rule === "substance")?.status).toBe("pass");
    expect(checks.find((c) => c.rule === "bleed")?.status).toBe("pass");
  });

  it("swaps gap for feature under fill, matching lint", () => {
    const drawn = new Canvas([], { finish: "filled" });
    drawn.rect({ h: 16, w: 16, x: 4, y: 4 });
    const checks = review(drawn);
    expect(checks.map((check) => check.rule)).toContain("feature");
    expect(checks.map((check) => check.rule)).toContain("hole");
    expect(checks.map((check) => check.rule)).not.toContain("gap");
    expect(checks.find((check) => check.rule === "hole")?.status).toBe("pass");
  });

  /**
   * A reader has to be able to tell "the needle is deliberately off 135°" from
   * "the needle happens to be on 135°" — which was the argument for a fourth
   * `waived` state, and is satisfied without one. The declared case is a `warn`
   * and the on-axis case is a `pass`; the two never collapse.
   */
  it("shows a declared diagonal as a warn, not as a pass", () => {
    const checks = review(canvas({ d: "M6 6L18 12", id: "e0", offAxis: true }));
    const axis = checks.filter((c) => c.rule === "off-axis");
    expect(axis).toHaveLength(1);
    expect(axis[0].status).toBe("warn");
    expect(axis[0].message).toContain("declared");
    const clean = review(canvas(el("e0", "M6 6L18 18"))).find(
      (c) => c.rule === "off-axis"
    );
    expect(clean?.status).toBe("pass");
  });

  /**
   * The declaration travels on the canvas, not in the SVG.
   *
   * `Canvas.line` records `offAxis` on the element that needed it; a viewer
   * that re-parses the rendered path gets geometry with no declaration. That
   * round trip is what made the compass's four warnings look like a bug in the
   * rule rather than a bug in the viewer, so the end of the chain is worth
   * pinning: draw it, lint the canvas, and the verdict knows it was asked for.
   */
  it("carries a declaration from the drawing to the verdict", () => {
    const drawn = new Canvas([]);
    drawn.line({
      offAxis: true,
      points: [
        [6, 6],
        [18, 12],
      ],
    });
    const found = lint(drawn).filter((i) => i.rule === "off-axis");
    expect(found).toHaveLength(1);
    expect(found[0].declared).toBe("off-axis");
  });

  it("fires `hole` when a mark sits between a disc and its knockout", () => {
    const drawn = new Canvas([], { finish: "filled" });
    drawn.circle({ cx: 12, cy: 12, r: 8 });
    drawn.rect({ h: 4, r: 0, w: 4, x: 10, y: 10 });
    drawn.hole({ cx: 12, cy: 12, r: 1.5, shape: "circle" });
    const found = lint(drawn).filter((issue) => issue.rule === "hole");
    expect(found).toHaveLength(1);
    expect(found[0]?.severity).toBe("error");
    expect(found[0]?.message).toContain("solid disc");
    expect(found[0]?.message).toContain("cutFrom");
  });

  it("stays quiet when the hole follows the disc", () => {
    const drawn = new Canvas([], { finish: "filled" });
    drawn.circle({ cx: 12, cy: 12, r: 8 });
    drawn.hole({ cx: 12, cy: 12, r: 6, shape: "circle" });
    drawn.rect({ h: 8, r: 0, w: 2, x: 11, y: 4 });
    expect(rules(lint(drawn))).not.toContain("hole");
  });

  it("stays quiet when cutFrom names the disc after a later solid", () => {
    const drawn = new Canvas([], { finish: "filled" });
    const ring = drawn.circle({ cx: 12, cy: 12, r: 8 });
    drawn.rect({ h: 4, r: 0, w: 4, x: 10, y: 10 });
    drawn.hole({ cutFrom: ring, cx: 12, cy: 12, r: 6, shape: "circle" });
    expect(rules(lint(drawn))).not.toContain("hole");
  });

  it("does not call a wide body that contains a later lens a solid disc", () => {
    const drawn = new Canvas([], { finish: "filled" });
    drawn.rect({ h: 10, r: 2, w: 18, x: 3, y: 8 });
    drawn.circle({ cx: 12, cy: 13, r: 4 });
    drawn.hole({ cx: 12, cy: 13, r: 2, shape: "circle" });
    expect(rules(lint(drawn))).not.toContain("hole");
  });
});
