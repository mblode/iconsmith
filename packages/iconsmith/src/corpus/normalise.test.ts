import { describe, expect, test } from "vitest";

import { canonicalSvg, normaliseIconSvg } from "./normalise.js";

describe("inherited presentation attributes", () => {
  test("a stroke declared on the root reaches the paths that state none", () => {
    // Lucide and Tabler draw this way. Read element-only, every icon in both
    // sets is unstroked, has zero edges, and reports 0.0% off-axis — which
    // looks like a finding and is a parse failure.
    const { shapes } = normaliseIconSvg(
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 2H12"/></svg>'
    );
    expect(shapes).toHaveLength(1);
    expect(shapes[0].strokeWidth).toBe(2);
  });

  test("an element that states its own attribute keeps it", () => {
    const { shapes } = normaliseIconSvg(
      '<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M2 2H12" stroke-width="1.5"/></svg>'
    );
    expect(shapes[0].strokeWidth).toBe(1.5);
  });

  test('an element that says stroke="none" does not inherit one', () => {
    // Every Tabler icon opens with a full-canvas hit area drawn exactly like
    // this. Inheriting the root stroke onto it would put a 2-unit stroke round
    // the whole canvas.
    const { shapes } = normaliseIconSvg(
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke="none" d="M0 0h24v24H0z"/><path d="M4 4H20"/></svg>'
    );
    expect(shapes).toHaveLength(1);
    expect(shapes[0].d).toContain("M4 4");
  });
});

describe("invisible elements", () => {
  test("a shape that is neither filled nor stroked is dropped", () => {
    // It draws nothing, so counting it as ink pins the visual extent to the
    // hit area — which is what put every Tabler icon `off` every keyline.
    const { shapes } = normaliseIconSvg(
      '<svg viewBox="0 0 24 24"><path fill="none" stroke="none" d="M0 0h24v24H0z"/><path fill="#000" d="M4 4H20V8H4Z"/></svg>'
    );
    expect(shapes).toHaveLength(1);
  });
});

describe("viewBox scaling", () => {
  test("a 256-unit drawing is scaled to the 24 grid, stroke included", () => {
    const { scale, shapes } = normaliseIconSvg(
      '<svg viewBox="0 0 256 256"><path d="M0 0H256" stroke="#000" stroke-width="16"/></svg>'
    );
    expect(scale).toBeCloseTo(24 / 256, 10);
    expect(shapes[0].strokeWidth).toBeCloseTo(1.5, 10);
    expect(shapes[0].d).toBe("M0 0L24 0");
  });

  test("a non-zero viewBox origin is translated away before scaling", () => {
    const { shapes } = normaliseIconSvg(
      '<svg viewBox="4 4 16 16"><path d="M4 4H20" stroke="#000" stroke-width="2"/></svg>'
    );
    expect(shapes[0].d).toBe("M0 0L24 0");
  });

  test("a 24-unit set is left alone, so the calibration corpus is unmoved", () => {
    const src =
      '<svg viewBox="0 0 24 24" fill="none"><path d="M2 2H12" stroke="#000" stroke-width="2"/></svg>';
    const { scale, shapes } = normaliseIconSvg(src);
    expect(scale).toBe(1);
    expect(shapes[0].d).toBe("M2 2H12");
  });
});

describe("canonicalSvg", () => {
  test("round-trips fill, stroke width and cap", () => {
    const src =
      '<svg viewBox="0 0 24 24"><path d="M2 2H12" stroke="#000" stroke-width="1.5" stroke-linecap="round"/><path d="M4 4H8V8H4Z" fill="#000"/></svg>';
    const before = normaliseIconSvg(src).shapes;
    const after = normaliseIconSvg(canonicalSvg(before)).shapes;
    expect(after).toEqual(before);
  });
});
