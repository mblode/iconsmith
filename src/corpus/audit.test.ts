import { describe, expect, test } from "vitest";

import { auditIcon, freeformShare, onAxisShare } from "./audit.js";

const svg = (...els: string[]) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none">${els.join("")}</svg>`;
const stroked = (d: string, cap = "round") =>
  `<path d="${d}" stroke="currentColor" stroke-width="2" stroke-linecap="${cap}"/>`;
const filled = (d: string) => `<path d="${d}" fill="currentColor"/>`;
/** A quadrant arc's cubic handle length for radius r. */
const K = 0.5523;

describe("angle discipline", () => {
  test("axis-aligned and 45° edges read as on-axis; others report their offset", () => {
    const a = auditIcon(
      "t",
      svg(stroked("M2 2H12"), stroked("M2 2L12 12"), stroked("M2 2L12 8"))
    );
    const off = a.edges.map((e) => Math.round(e.offAxis * 10) / 10);
    // Horizontal, then 45°, then 30.96° — which sits 14.04 off the 45 axis.
    expect(off[0]).toBe(0);
    expect(off[1]).toBe(0);
    expect(off[2]).toBeCloseTo(14, 1);
    expect(onAxisShare(a.edges, 1)).toBeCloseTo(2 / 3, 6);
  });

  test("an edge's direction, not its sense, decides the angle", () => {
    // Right-to-left is the same edge as left-to-right; folding to [0,180)
    // stops one drawing order counting as off-axis.
    const a = auditIcon("t", svg(stroked("M12 2H2")));
    expect(a.edges[0].offAxis).toBe(0);
  });

  test("sub-threshold segments are excluded so residue cannot skew the angles", () => {
    expect(auditIcon("t", svg(stroked("M2 2L2.02 2.05"))).edges).toHaveLength(
      0
    );
  });
});

describe("curve provenance", () => {
  test("an arc between two straight runs is a join-arc", () => {
    const r = 3;
    const k = r * K;
    const d = `M4 2H${20 - r}C${20 - r + k} 2 20 ${2 + r - k} 20 ${2 + r}V20H4Z`;
    const a = auditIcon("t", svg(stroked(d)));
    expect(a.curves.map((c) => c.cls)).toContain("join-arc");
    expect(a.curves.find((c) => c.cls === "join-arc")?.radius).toBeCloseTo(
      r,
      1
    );
  });

  test("a subpath of nothing but arcs is circle-derived, not a join", () => {
    const c = 12 + 8 * K;
    const d =
      `M20 12C20 ${c} ${c} 20 12 20C${24 - c} 20 4 ${c} 4 12` +
      `C4 ${24 - c} ${24 - c} 4 12 4C${c} 4 20 ${24 - c} 20 12Z`;
    const a = auditIcon("t", svg(stroked(d)));
    expect(new Set(a.curves.map((x) => x.cls))).toEqual(
      new Set(["circle-arc"])
    );
  });

  test("a cubic whose control points describe no circle is freeform", () => {
    // Handles pulled to opposite sides: an S-curve cannot be an arc.
    const a = auditIcon("t", svg(stroked("M4 12C4 4 20 20 20 12")));
    expect(a.curves[0].cls).toBe("freeform");
    expect(freeformShare(a.curves)).toBe(1);
  });

  test("a cubic that never leaves its chord is a line, not a curve", () => {
    const a = auditIcon("t", svg(stroked("M4 12C8 12 16 12 20 12")));
    expect(a.curves[0].cls).toBe("line-like");
    // line-like curves are excluded from the freeform denominator: they are not
    // a shaping decision either way.
    expect(freeformShare(a.curves)).toBe(0);
  });
});

describe("caps", () => {
  test("only an element with a visible end contributes a cap", () => {
    // The closed shape has no ends, so its linecap is inert; counting it would
    // report a default attribute rather than a drawing decision.
    const a = auditIcon(
      "t",
      svg(stroked("M4 4H20V20H4Z", "butt"), stroked("M4 12H20", "butt"))
    );
    expect(a.caps).toEqual(["butt"]);
  });

  test("a filled shape has no cap to report", () => {
    expect(auditIcon("t", svg(filled("M4 4H20V20H4Z"))).caps).toEqual([]);
  });
});

describe("open versus closed", () => {
  test("an open shape reports the gap between its ends", () => {
    const a = auditIcon("t", svg(stroked("M4 4H20V20H4V6")));
    expect(a.nearClosed).toHaveLength(1);
    expect(a.nearClosed[0].gap).toBeCloseTo(2, 6);
  });

  test("dot-scale subpaths are not tested for near-closure", () => {
    // `M12 12H12.01` is the dot idiom. Its ends are trivially close, and
    // counting it would measure dots rather than a construction choice.
    expect(
      auditIcon("t", svg(stroked("M12 12H12.01"))).nearClosed
    ).toHaveLength(0);
  });

  test("a closed shape is not reported at all", () => {
    expect(
      auditIcon("t", svg(stroked("M4 4H20V20H4Z"))).nearClosed
    ).toHaveLength(0);
  });
});

describe("zero-area spurs", () => {
  test("a closed subpath enclosing nothing is a spur", () => {
    const a = auditIcon("t", svg(filled("M4 12H20H4Z")));
    expect(a.spurContours).toBe(1);
  });

  test("an open stroked line is NOT a spur", () => {
    // A regression guard. An open polyline encloses no area by definition, so
    // an area-only test flags every straight stroke in the set — which read as
    // half the corpus being broken before this case was separated out.
    const a = auditIcon("t", svg(stroked("M4 12H20"), stroked("M4 4V20")));
    expect(a.spurContours).toBe(0);
  });

  test("a path that retraces itself is counted", () => {
    const a = auditIcon("t", svg(filled("M4 12H20H4V13H4Z")));
    expect(a.spurRetraces).toBeGreaterThan(0);
  });
});

test("opacity is reported wherever it sits", () => {
  const a = auditIcon(
    "t",
    `<svg><g opacity="0.5">${filled("M4 4H20V20H4Z")}</g>` +
      `<path d="M4 12H20" stroke="currentColor" stroke-opacity="0.3"/></svg>`
  );
  expect(a.opacity).toEqual(["0.5", "0.3"]);
});

test("an icon with no edges is fully on-axis rather than a divide by zero", () => {
  expect(onAxisShare([])).toBe(1);
});
