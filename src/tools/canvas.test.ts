import { expect, test } from "vitest";

import { bbox, parsePath } from "../geometry/path.js";
import type { IconDoc, Part } from "../types.js";
import { Canvas, SPEC } from "./canvas.js";

const PARTS: Part[] = [
  {
    closed: false,
    d: "M0 0L4 0L4 4",
    h: 4,
    icons: ["box"],
    id: "p0001",
    instances: 3,
    name: "corner",
    nodes: 3,
    sizeRange: [4, 4],
    w: 4,
  },
];

/** Every node the path actually passes through. Cubic control handles are
 *  deliberately excluded: a circular arc's handle sits at r×0.5523 from the
 *  node, which is not a grid multiple and cannot be without deforming the arc. */
const nodesOf = (d: string): number[] => {
  const out: number[] = [];
  for (const sp of parsePath(d)) {
    out.push(sp.start[0], sp.start[1]);
    for (const s of sp.segs) {
      if (s.t === "C") {
        out.push(s.p[4], s.p[5]);
      } else if (s.t === "A") {
        out.push(s.p[5], s.p[6]);
      } else {
        out.push(s.p[0], s.p[1]);
      }
    }
  }
  return out;
};

const onGrid = (v: number) =>
  Math.abs(v / SPEC.grid - Math.round(v / SPEC.grid)) < 1e-9;

test("an off-axis endpoint within tolerance comes out exactly on-axis", () => {
  const c = new Canvas();
  c.line({
    points: [
      [11, 15],
      [16, 9.4],
    ],
  });
  const [el] = c.elements;
  if (el.kind !== "line") {
    throw new Error("expected a line element");
  }
  expect(el.points).toStrictEqual([
    [11, 15],
    [16.25, 9.75],
  ]);
  // Exactly 45°: equal run and rise, not merely close to it.
  expect(el.points[1][0] - el.points[0][0]).toBe(
    -(el.points[1][1] - el.points[0][1])
  );
});

test("a genuinely diagonal endpoint is left alone", () => {
  const c = new Canvas();
  // 21.8° off horizontal — well outside the 6° tolerance, so it is the model's
  // intent, not a slip, and snapping it would be the tool overriding the design.
  c.line({
    points: [
      [0, 0],
      [10, 4],
    ],
  });
  const [el] = c.elements;
  if (el.kind !== "line") {
    throw new Error("expected a line element");
  }
  expect(el.points).toStrictEqual([
    [0, 0],
    [10, 4],
  ]);
});

test("a vertical-ish segment snaps to exactly vertical", () => {
  const c = new Canvas();
  c.line({
    points: [
      [6, 4],
      [6.5, 18],
    ],
  });
  const [el] = c.elements;
  if (el.kind !== "line") {
    throw new Error("expected a line element");
  }
  expect(el.points[1][0]).toBe(el.points[0][0]);
});

test("a requested radius of 1.7 becomes a tier radius, never 1.7", () => {
  const c = new Canvas();
  // The tiers do not vary with shape size — a flat set matches the corpus
  // better than any size-conditioned split measured against it — so both
  // rectangles land on the same tier. The small one is still clamped to half
  // its own side, which is geometry rather than style.
  c.rect({ h: 10, r: 1.7, w: 10, x: 2, y: 2 });
  c.rect({ h: 4, r: 1.7, w: 4, x: 2, y: 2 });
  const radii = c.elements.map((e) => (e.kind === "rect" ? e.r : null));
  expect(radii).toStrictEqual([2, 2]);
  for (const r of radii) {
    expect(SPEC.radiusTiers as readonly number[]).toContain(r);
  }
});

test("r: 0 stays square — the tier system does not invent a radius", () => {
  const c = new Canvas();
  c.rect({ h: 10, r: 0, w: 10, x: 2, y: 2 });
  expect(c.elements[0].kind === "rect" && c.elements[0].r).toBe(0);
});

test("a radius can never exceed half the shorter side", () => {
  const c = new Canvas();
  c.rect({ h: 1, r: 2, w: 12, x: 2, y: 2 });
  expect(c.elements[0].kind === "rect" && c.elements[0].r).toBe(0.5);
});

test("every emitted node lands on the 0.25 grid, whatever goes in", () => {
  const c = new Canvas(PARTS);
  c.rect({ h: 6.61, r: 1.7, w: 7.3, x: 2.13, y: 3.87 });
  c.circle({ cx: 11.94, cy: 12.06, r: 3.4 });
  c.line({
    points: [
      [1.1, 2.2],
      [9.37, 2.31],
      [14.88, 8.02],
    ],
  });
  c.dot({ cx: 5.13, cy: 18.44, role: "floating" });
  c.part({ id: "p0001", scale: 1.37, x: 3.13, y: 4.88 });
  for (const e of c.elements) {
    for (const v of nodesOf(e.d)) {
      expect(onGrid(v), `${e.kind} node ${v} is off-grid`).toBe(true);
    }
  }
});

test("coordinates are clamped onto the canvas", () => {
  const c = new Canvas();
  c.circle({ cx: -5, cy: 40, r: 2 });
  expect(
    c.elements[0].kind === "circle" && [c.elements[0].cx, c.elements[0].cy]
  ).toStrictEqual([0, SPEC.canvas]);
});

test("a dot takes its size from its role, not from a free radius", () => {
  const c = new Canvas();
  for (const role of ["terminal", "more", "floating"] as const) {
    c.dot({ cx: 12, cy: 12, role });
  }
  const extents = c.elements.map((e) => bbox(parsePath(e.d)).w);
  expect(extents).toStrictEqual([
    SPEC.dots.terminal,
    SPEC.dots.more,
    SPEC.dots.floating,
  ]);
});

test("an unknown dot role is rejected rather than silently sized", () => {
  const c = new Canvas();
  expect(() => c.dot({ cx: 12, cy: 12, role: "huge" as never })).toThrow(
    /dot role/u
  );
});

test("toJSON → fromJSON → toSVG round-trips identically", () => {
  const c = new Canvas(PARTS);
  c.rect({ h: 6.61, r: 1.7, w: 7.3, x: 2.13, y: 3.87 });
  c.circle({ cx: 11.94, cy: 12.06, r: 3.4 });
  c.line({
    points: [
      [11, 15],
      [16, 9.4],
    ],
  });
  c.dot({ cx: 5, cy: 18, role: "more" });
  c.part({ id: "p0001", scale: 1.5, x: 3, y: 4 });
  const doc = c.toJSON({ icon: "thing", keyline: "wide" });
  const back = Canvas.fromJSON(doc, PARTS);
  expect(back.toSVG()).toBe(c.toSVG());
  expect(back.toJSON({ icon: "thing", keyline: "wide" })).toStrictEqual(doc);
});

test("raw ops survive the round-trip unchanged", () => {
  const d = "M3.14159 4.2C5.1 6.7 7.3 8.9 9.11 10.13Z";
  const c = new Canvas();
  c.raw(d);
  const doc = c.toJSON();
  expect(doc.draw).toStrictEqual([{ d, op: "raw" }]);
  expect(Canvas.fromJSON(doc).elements[0].d).toBe(d);
  expect(Canvas.fromJSON(doc).toSVG()).toBe(c.toSVG());
});

test("a dot survives the round-trip as a dot, keeping its role", () => {
  const c = new Canvas();
  c.dot({ cx: 5, cy: 18, role: "floating" });
  const doc = c.toJSON();
  expect(doc.draw).toStrictEqual([
    { cx: 5, cy: 18, op: "dot", role: "floating" },
  ]);
});

test("fromJSON rejects an op it does not know", () => {
  const doc = {
    draw: [{ op: "spiral" }],
    icon: null,
    keyline: null,
  } as unknown as IconDoc;
  expect(() => Canvas.fromJSON(doc)).toThrow(/unknown op/u);
});

test("transform re-emits through the primitives, so the result is still on-spec", () => {
  const c = new Canvas();
  c.rect({ h: 5, r: 1, w: 5, x: 2, y: 2 });
  c.dot({ cx: 4, cy: 4, role: "terminal" });
  c.transform(1.6, 0.3, 0.3);
  const [rect, dot] = c.elements;
  // The radius re-tiers against the new size instead of scaling off-spec, and a
  // dot keeps its role size — a terminal dot is 1.5 at every keyline.
  expect(rect.kind === "rect" && rect.r).toBe(1);
  expect(bbox(parsePath(dot.d)).w).toBe(SPEC.dots.terminal);
  for (const e of c.elements) {
    for (const v of nodesOf(e.d)) {
      expect(onGrid(v)).toBe(true);
    }
  }
});

test("transform keeps the document description in step with the path data", () => {
  const c = new Canvas();
  c.rect({ h: 4, r: 0, w: 4, x: 2, y: 2 });
  c.transform(2, 1, 1);
  const doc = c.toJSON();
  expect(Canvas.fromJSON(doc).toSVG()).toBe(c.toSVG());
  expect(doc.draw[0]).toStrictEqual({
    h: 8,
    op: "rect",
    r: 0,
    w: 8,
    x: 5,
    y: 5,
  });
});

test("remove and clear keep ids and the log honest", () => {
  const c = new Canvas();
  const a = c.rect({ h: 4, w: 4, x: 2, y: 2 });
  c.circle({ cx: 12, cy: 12, r: 3 });
  expect(c.remove(a)).toStrictEqual({ remaining: 1, removed: a });
  expect(() => c.remove(a)).toThrow(/no element/u);
  c.clear();
  expect(c.bbox()).toBeNull();
});
