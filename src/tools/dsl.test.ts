import { expect, test } from "vitest";

import type { Part } from "../types.js";
import { SPEC } from "./canvas.js";
import { run } from "./dsl.js";

const PARTS: Part[] = [
  {
    closed: true,
    d: "M0 0L8 0L8 6L0 6Z",
    h: 6,
    icons: ["cloud", "rain"],
    id: "p0031",
    instances: 12,
    name: "cloud",
    nodes: 4,
    sizeRange: [6, 10],
    w: 8,
  },
];

/** Visual extent = path bbox + stroke width, half added on each side. */
const extent = (canvas: ReturnType<typeof run>["canvas"]) => {
  const b = canvas.bbox();
  if (!b) {
    throw new Error("empty canvas");
  }
  return {
    cx: b.x0 + b.w / 2,
    cy: b.y0 + b.h / 2,
    h: b.h + SPEC.stroke,
    w: b.w + SPEC.stroke,
  };
};

test("every op parses", () => {
  const r = run(
    `
    # a comment, and a blank line follow

    icon    cloud-rain
    keyline wide
    rect    2,3 8x6 r2
    circle  12,12 r4
    line    4,18 9,18 14,18
    dot     18,18 floating
    part    cloud at 3,4 size 8
    center
    fit
    `,
    PARTS
  );
  expect(r.errors).toStrictEqual([]);
  expect(r.icon).toBe("cloud-rain");
  expect(r.keyline).toBe("wide");
  expect(r.canvas.elements.map((e) => e.kind)).toStrictEqual([
    "rect",
    "circle",
    "line",
    "dot",
    "part",
  ]);
});

test("an unknown op reports the fix instead of throwing", () => {
  const r = run("icon x\nsquiggle 3,3", PARTS);
  expect(r.errors).toHaveLength(1);
  expect(r.errors[0]).toContain("line 2 (squiggle 3,3)");
  expect(r.errors[0]).toContain('unknown op "squiggle"');
  // The message has to name the way out, not just the wall.
  expect(r.errors[0]).toContain("expected one of");
  for (const op of ["rect", "circle", "line", "dot", "part", "center", "fit"]) {
    expect(r.errors[0]).toContain(op);
  }
});

test("an unknown part points at the vocabulary", () => {
  const r = run("part unicorn at center", PARTS);
  expect(r.errors).toHaveLength(1);
  expect(r.errors[0]).toContain('unknown part "unicorn"');
  expect(r.errors[0]).toContain("listParts");
});

test("an unknown keyline and an unknown dot role both name the alternatives", () => {
  const r = run("keyline hexagon\ndot 12,12 enormous", PARTS);
  expect(r.errors).toHaveLength(2);
  expect(r.errors[0]).toContain("wide");
  expect(r.errors[1]).toContain("terminal");
  expect(r.keyline).toBeNull();
});

test("a bad line reports and the rest of the program still runs", () => {
  const r = run("rect nope 8x6\ncircle 12,12 r4", PARTS);
  expect(r.errors).toHaveLength(1);
  expect(r.canvas.elements).toHaveLength(1);
  expect(r.canvas.elements[0].kind).toBe("circle");
});

test("fit on the wide keyline yields a visual extent of exactly 20.0 × 16.0", () => {
  // 9 × 7 is the wide keyline's inner aspect, so both axes bind at once and the
  // result is exact rather than fitted on the tighter axis alone.
  const r = run("keyline wide\nrect 0,0 9x7\nfit", PARTS);
  expect(r.errors).toStrictEqual([]);
  const e = extent(r.canvas);
  expect(e.w).toBe(20);
  expect(e.h).toBe(16);
  expect([e.cx, e.cy]).toStrictEqual([12, 12]);
});

test("fit on the square keyline yields a visual extent of exactly 18.0 × 18.0", () => {
  const r = run("keyline square\nrect 0,0 4x4 r0\nfit", PARTS);
  const e = extent(r.canvas);
  expect([e.w, e.h]).toStrictEqual([18, 18]);
});

test("fit never overflows the keyline on the unbound axis", () => {
  // A tall shape on a wide keyline: height binds, width must come out under 20.
  const r = run("keyline wide\nrect 0,0 4x12 r0\nfit", PARTS);
  const e = extent(r.canvas);
  expect(e.h).toBe(16);
  expect(e.w).toBeLessThanOrEqual(20);
});

test("fit with no keyline declared falls back to square", () => {
  const a = run("rect 0,0 4x4 r0\nfit", PARTS);
  const b = run("keyline square\nrect 0,0 4x4 r0\nfit", PARTS);
  expect(a.canvas.toSVG()).toBe(b.canvas.toSVG());
});

test("center puts the content centre on (12,12)", () => {
  const r = run("rect 0,0 4x4 r0\ncircle 3,3 r1\ncenter", PARTS);
  expect(r.errors).toStrictEqual([]);
  const e = extent(r.canvas);
  expect([e.cx, e.cy]).toStrictEqual([12, 12]);
  // Centring must not resize anything.
  expect([e.w, e.h]).toStrictEqual([6, 6]);
});

test("centre is spelled either way", () => {
  const a = run("rect 0,0 4x4 r0\ncenter", PARTS);
  const b = run("rect 0,0 4x4 r0\ncentre", PARTS);
  expect(a.canvas.toSVG()).toBe(b.canvas.toSVG());
});

test("an anchor names a centre; a bare coordinate names the top-left", () => {
  const anchored = run("part cloud at center size 8", PARTS);
  const placed = run("part cloud at 4,6 size 8", PARTS);
  const a = anchored.canvas.bbox();
  const p = placed.canvas.bbox();
  if (!(a && p)) {
    throw new Error("empty canvas");
  }
  expect([a.x0 + a.w / 2, a.y0 + a.h / 2]).toStrictEqual([12, 12]);
  expect([p.x0, p.y0]).toStrictEqual([4, 6]);
});

test("size sets the part's longest side; fill takes the keyline", () => {
  const sized = run("part cloud at center size 8", PARTS);
  const filled = run("keyline wide\npart cloud fill", PARTS);
  const s = sized.canvas.bbox();
  const f = filled.canvas.bbox();
  if (!(s && f)) {
    throw new Error("empty canvas");
  }
  expect(Math.max(s.w, s.h)).toBe(8);
  // fill scales to the keyline less the stroke: 8×6 into 18×14 binds on width.
  expect(f.w + SPEC.stroke).toBe(20);
});

test("a part placed by the DSL stays a reference in the document", () => {
  const r = run("part cloud at center size 8\nfit", PARTS);
  const doc = r.canvas.toJSON({ icon: r.icon, keyline: r.keyline });
  expect(doc.draw[0].op).toBe("part");
  expect(doc.draw[0]).toMatchObject({ id: "p0031" });
});

test("an empty program is not an error", () => {
  const r = run("# nothing but a comment\n\n", PARTS);
  expect(r.errors).toStrictEqual([]);
  expect(r.canvas.bbox()).toBeNull();
});
