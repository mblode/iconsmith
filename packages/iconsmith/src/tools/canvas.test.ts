import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import sharp from "sharp";
import { expect, test } from "vitest";

import { bbox, parsePath } from "../geometry/path.js";
import { extractParts } from "../parts/extract.js";
import { fingerprint, flatten, match } from "../parts/shape.js";
import type { IconDoc, Part } from "../types.js";
import { Canvas, SPEC } from "./canvas.js";
import { programFromDoc } from "./twin.js";

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

const ASSEMBLY_PARTS: Part[] = [
  {
    closed: false,
    d: "M0 0V4",
    h: 4,
    icons: ["assembly"],
    id: "assembly-child-a",
    instances: 1,
    nodes: 1,
    sizeRange: [4, 4],
    w: 0,
  },
  {
    closed: false,
    d: "M0 0H4",
    h: 0,
    icons: ["assembly"],
    id: "assembly-child-b",
    instances: 1,
    nodes: 1,
    sizeRange: [4, 4],
    w: 4,
  },
  {
    closed: false,
    d: "M0 0V4M0 4H4",
    h: 4,
    icons: ["assembly"],
    id: "assembly",
    instances: 1,
    nodes: 2,
    sizeRange: [4, 4],
    sourceAssembly: {
      children: [
        {
          partHash: "0".repeat(64),
          partId: "assembly-child-a",
          semantics: {
            cap: "round",
            join: "round",
            kind: "stroke",
            strokeWidth: 2,
          },
          x: 0,
          y: 0,
        },
        {
          partHash: "1".repeat(64),
          partId: "assembly-child-b",
          semantics: {
            cap: "round",
            join: "round",
            kind: "stroke",
            strokeWidth: 2,
          },
          x: 0,
          y: 4,
        },
      ],
      finish: "outlined",
      sourceHash: "2".repeat(64),
      viewBox: "0 0 24 24",
    },
    w: 4,
  },
];

const FILLED_ASSEMBLY_PARTS: Part[] = [
  {
    closed: true,
    d: "M0 0H6V6H0Z",
    h: 6,
    icons: ["filled-assembly"],
    id: "filled-child-a",
    instances: 1,
    nodes: 4,
    sizeRange: [6, 6],
    sourceFillRule: "nonzero",
    w: 6,
  },
  {
    closed: true,
    d: "M0 0H6V6H0Z",
    h: 6,
    icons: ["filled-assembly"],
    id: "filled-child-b",
    instances: 1,
    nodes: 4,
    sizeRange: [6, 6],
    sourceFillRule: "nonzero",
    w: 6,
  },
  {
    closed: true,
    d: "M0 0H6V6H0ZM8 0H14V6H8Z",
    h: 6,
    icons: ["filled-assembly"],
    id: "filled-assembly",
    instances: 1,
    nodes: 8,
    sizeRange: [14, 14],
    sourceAssembly: {
      children: [
        {
          partHash: "0".repeat(64),
          partId: "filled-child-a",
          semantics: { fillRule: "nonzero", kind: "fill" },
          x: 0,
          y: 0,
        },
        {
          partHash: "1".repeat(64),
          partId: "filled-child-b",
          semantics: { fillRule: "nonzero", kind: "fill" },
          x: 8,
          y: 0,
        },
      ],
      finish: "filled",
      sourceHash: "2".repeat(64),
      viewBox: "0 0 24 24",
    },
    w: 14,
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

test("a source assembly rotates and scales as one placement while preserving child offsets", () => {
  const c = new Canvas(ASSEMBLY_PARTS);
  const root = c.part({ id: "assembly", scale: 2, turn: 1, x: 3, y: 5 });
  expect(root).toBe("e0");
  expect(c.elements).toHaveLength(2);
  expect(c.describe()).toStrictEqual([
    { h: 8, id: "e0", kind: "part", w: 8, x: 3, y: 5 },
  ]);
  expect(c.toJSON().draw).toStrictEqual([
    { id: "assembly", op: "part", scale: 2, turn: 1, x: 3, y: 5 },
  ]);
  expect(c.toSVG().match(/<path /gu)).toHaveLength(2);
});

test("an assembly-only child cannot be placed outside its owning assembly", () => {
  const parts = ASSEMBLY_PARTS.map((part) =>
    part.id === "assembly-child-a"
      ? { ...part, sourceAssemblyOnly: "assembly" }
      : part
  );
  const c = new Canvas(parts);
  expect(() => c.part({ id: "assembly-child-a", x: 0, y: 0 })).toThrow(
    "private to assembly assembly"
  );
  expect(c.part({ id: "assembly", x: 0, y: 0 })).toBe("e0");
});

test("transform remaps an assembly root after an earlier handle gap", () => {
  const c = new Canvas(ASSEMBLY_PARTS);
  const gap = c.rect({ h: 2, w: 2, x: 1, y: 1 });
  c.remove(gap);
  c.part({ id: "assembly", x: 4, y: 5 });
  expect(c.elements.map(({ id }) => id)).toStrictEqual(["e1", "e2"]);
  c.transform(0.5, 2, 3);
  expect(c.elements.map(({ id }) => id)).toStrictEqual(["e1", "e2"]);
  expect(c.remove("e2").removed).toStrictEqual(["e1", "e2"]);
});

test("a filled assembly owns default and named knockouts as one removable group", () => {
  for (const named of [false, true]) {
    const c = new Canvas(FILLED_ASSEMBLY_PARTS, { finish: "filled" });
    const root = c.part({ id: "filled-assembly", x: 2, y: 2 });
    const continuation = c.elements[1].id;
    const hole = c.hole({
      ...(named ? { cutFrom: continuation } : {}),
      h: 4,
      r: 0,
      shape: "rect",
      w: 6,
      x: 6,
      y: 3,
    });
    expect(c.elements.map(({ id }) => id)).toStrictEqual([
      root,
      continuation,
      hole,
    ]);
    expect(c.toSVG().match(/<path /gu)).toHaveLength(2);
    expect(c.remove(root)).toStrictEqual({
      remaining: 0,
      removed: [root, continuation, hole],
    });
  }
});

test("a filled source assembly subtracts an exterior knockout from every child", () => {
  const c = new Canvas(FILLED_ASSEMBLY_PARTS, { finish: "filled" });
  c.part({ id: "filled-assembly", x: 2, y: 2 });
  const sourceBoundSvg = c.toSVG();
  expect(sourceBoundSvg).toContain(
    '<path d="M2 2L8 2L8 8L2 8Z" fill="currentColor" fill-rule="nonzero" clip-rule="nonzero"/>'
  );
  expect(sourceBoundSvg).toContain(
    '<path d="M10 2L16 2L16 8L10 8Z" fill="currentColor" fill-rule="nonzero" clip-rule="nonzero"/>'
  );

  c.hole({ h: 12, r: 0, shape: "rect", w: 4, x: 7, y: 0 });
  expect(c.bbox()).toStrictEqual({
    h: 6,
    w: 14,
    x0: 2,
    x1: 16,
    y0: 2,
    y1: 8,
  });
  expect(c.toSVG().match(/<path /gu)).toHaveLength(2);
  expect(c.toSVG()).not.toContain("v12");
});

test("transform restores semantic ids after a legacy interleaved assembly knockout", () => {
  const c = new Canvas(FILLED_ASSEMBLY_PARTS, { finish: "filled" });
  const gap = c.rect({ h: 1, r: 0, w: 1, x: 0, y: 0 });
  c.remove(gap);
  const root = c.part({ id: "filled-assembly", x: 2, y: 2 });
  const continuation = c.elements[1].id;
  const hole = c.hole({
    h: 4,
    r: 0,
    shape: "rect",
    w: 6,
    x: 6,
    y: 3,
  });
  c.elements.splice(1, 2, c.elements[2], c.elements[1]);
  expect(c.elements.map(({ id }) => id)).toStrictEqual([
    root,
    hole,
    continuation,
  ]);
  c.transform(0.75, 1, 2);
  expect(c.elements.map(({ id }) => id)).toStrictEqual([
    root,
    continuation,
    hole,
  ]);
  expect(c.elements[1]).toMatchObject({ id: continuation, kind: "part" });
  expect(c.elements[2]).toMatchObject({ id: hole, op: "knockout" });
  expect(c.remove(root).remaining).toBe(0);
});

test("trim treats an outlined source assembly as one editable left operand", () => {
  const c = new Canvas(ASSEMBLY_PARTS);
  const assembly = c.part({ id: "assembly", scale: 3, x: 4, y: 4 });
  const cutter = c.rect({ h: 6, w: 6, x: 8, y: 8 });
  c.combine("trim", assembly, cutter);
  expect(c.elements).toHaveLength(1);
  expect(c.toJSON().draw[0]).toMatchObject({
    left: [{ id: "assembly", op: "part" }],
    op: "boolean",
    operation: "trim",
  });
  expect(c.toSVG()).toContain('stroke="currentColor"');
});

test("a genuinely diagonal endpoint is refused until it is asked for", () => {
  const c = new Canvas();
  // 21.8° off horizontal — well outside the 6° tolerance, so snapping it would
  // be the tool overriding the design. It used to pass through silently, which
  // made every drifted arithmetic result indistinguishable from a designed
  // diagonal. Now it is a decision the caller has to make.
  const diagonal: [number, number][] = [
    [0, 0],
    [10, 4],
  ];
  expect(() => c.line({ points: diagonal })).toThrow(/21\.80°/u);
  c.line({ offAxis: true, points: diagonal });
  const [el] = c.elements;
  if (el.kind !== "line") {
    throw new Error("expected a line element");
  }
  expect(el.points).toStrictEqual(diagonal);
  expect(el.offAxis).toBe(true);
});

test("the off-axis refusal names the angle, the axis and both ways out", () => {
  const c = new Canvas();
  // An error a model has to guess from is an error it retries at random.
  expect(() =>
    c.line({
      points: [
        [4, 11],
        [11, 16.5],
      ],
    })
  ).toThrow(/38\.16°, 6\.84° off the nearest axis \(45°\)/u);
  expect(() =>
    c.line({
      points: [
        [4, 11],
        [11, 16.5],
      ],
    })
  ).toThrow(/offAxis: true/u);
});

test("a near-horizontal leftward segment names the horizontal axis, not 135°", () => {
  // The heading is undirected in [0,180), so a leftward near-horizontal edge
  // sits near 170°. Choosing the axis by linear distance picked 135° while the
  // printed off-by (computed circularly) pointed at 0° — the message
  // contradicted itself. The axis must be the circularly-nearest one.
  const c = new Canvas();
  expect(() =>
    c.line({
      points: [
        [20, 12],
        [4, 15],
      ],
    })
  ).toThrow(/off the nearest axis \(0°\)/u);
});

test("permission is not instruction: an axial line stays unmarked", () => {
  const c = new Canvas();
  // `offAxis` waives the refusal; it does not stop the snap. A caller that
  // passes it and then draws straight lines gets a document that says so.
  c.line({
    offAxis: true,
    points: [
      [4, 4],
      [16, 4.3],
    ],
  });
  const [el] = c.elements;
  if (el.kind !== "line") {
    throw new Error("expected a line element");
  }
  expect(el.points[1][1]).toBe(el.points[0][1]);
  expect(el.offAxis).toBeUndefined();
  expect(c.toJSON().draw[0]).not.toHaveProperty("offAxis");
});

test("an off-axis line survives toJSON → fromJSON unchanged", () => {
  const c = new Canvas();
  c.line({
    offAxis: true,
    points: [
      [4, 11],
      [11, 16.5],
    ],
  });
  const doc = c.toJSON();
  expect(doc.draw[0]).toStrictEqual({
    offAxis: true,
    op: "line",
    points: [
      [4, 11],
      [11, 16.5],
    ],
  });
  // Without the flag in the document this reload would throw, which is the
  // point of recording it: the permission travels with the geometry.
  const back = Canvas.fromJSON(doc);
  expect(back.toJSON()).toStrictEqual(doc);
  expect(back.elements[0].d).toBe(c.elements[0].d);
});

test("transform re-emits an off-axis line without tripping its own guard", () => {
  const c = new Canvas();
  c.line({
    offAxis: true,
    points: [
      [4, 11],
      [11, 16.5],
    ],
  });
  c.transform(0.5, 2, 2);
  const [el] = c.elements;
  if (el.kind !== "line") {
    throw new Error("expected a line element");
  }
  expect(el.offAxis).toBe(true);
  expect(el.points).toStrictEqual([
    [4, 7.5],
    [7.5, 10.25],
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

test("explicit grid mode snaps every emitted part node", () => {
  const c = new Canvas(PARTS, { spec: { ...SPEC, partGeometry: "grid" } });
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

/** A dot's visual diameter: the path it draws, inflated by the stroke that
 *  draws it. The tier is this number, never the path bbox. */
const dotDiameter = (d: string, stroke = SPEC.stroke): number =>
  bbox(parsePath(d)).w + stroke;

test("a dot takes its size from its role, not from a free radius", () => {
  const c = new Canvas();
  const roles = ["terminal", "more", "floating", "node"] as const;
  for (const role of roles) {
    c.dot({ cx: 12, cy: 12, role });
  }
  expect(c.elements.map((e) => dotDiameter(e.d))).toStrictEqual([
    SPEC.dots.terminal,
    SPEC.dots.more,
    SPEC.dots.floating,
    SPEC.dots.node,
  ]);
  // The tier set itself, pinned. These are measured from the corpus; changing
  // one is a change to the house spec, not a refactor.
  expect(SPEC.dots).toStrictEqual({
    floating: 3,
    more: 2.5,
    node: 4,
    terminal: 2,
  });
  // Every role the type admits is drawable, so no role can be added to the
  // union without a measured size to go with it.
  expect(Object.keys(SPEC.dots).toSorted()).toStrictEqual(
    [...roles].toSorted()
  );
});

test("transform preserves every role's diameter, at any scale", () => {
  for (const k of [0.5, 1.6, 3]) {
    const c = new Canvas();
    for (const role of ["terminal", "more", "floating", "node"] as const) {
      c.dot({ cx: 6, cy: 6, role });
    }
    c.transform(k, 1, 1);
    expect(c.elements.map((e) => dotDiameter(e.d))).toStrictEqual([
      SPEC.dots.terminal,
      SPEC.dots.more,
      SPEC.dots.floating,
      SPEC.dots.node,
    ]);
    expect(c.elements.map((e) => e.kind === "dot" && e.role)).toStrictEqual([
      "terminal",
      "more",
      "floating",
      "node",
    ]);
  }
});

test("a dot is a solid disc, never a ring", () => {
  const c = new Canvas();
  for (const role of ["terminal", "more", "floating", "node"] as const) {
    c.dot({ cx: 12, cy: 12, role });
  }
  for (const e of c.elements) {
    // The skeleton is at most one stroke wide, so the stroke closes its own
    // hole — the corpus's own construction for a dot.
    expect(bbox(parsePath(e.d)).w).toBeLessThanOrEqual(SPEC.stroke);
  }
  // The smallest tier is the stroke itself, so it draws no line at all: a
  // zero-length round-capped segment, which is Central's idiom for a dot.
  expect(c.elements[0].d).toBe("M12 12L12 12");
});

test("an unknown dot role is rejected rather than silently sized", () => {
  const c = new Canvas();
  expect(() => c.dot({ cx: 12, cy: 12, role: "huge" as never })).toThrow(
    /dot role/u
  );
});

test("a quarter arc from the top is the first cubic of circle", () => {
  const ring = new Canvas();
  ring.circle({ cx: 12, cy: 12, r: 8 });
  const lobe = new Canvas();
  lobe.arc({ cx: 12, cy: 12, from: "top", r: 8, sweep: "quarter" });
  const circle = ring.elements[0]?.d ?? "";
  const arc = lobe.elements[0]?.d ?? "";
  expect(circle.startsWith(arc)).toBe(true);
  expect(arc.startsWith("M")).toBe(true);
  expect(arc).toContain("C");
  expect(arc.endsWith("Z")).toBe(false);
});

test("ccw is the other semicircle from the same pole", () => {
  const cw = new Canvas();
  cw.arc({ cx: 12, cy: 12, from: "left", r: 8, sweep: "half" });
  const ccw = new Canvas();
  ccw.arc({ ccw: true, cx: 12, cy: 12, from: "left", r: 8, sweep: "half" });
  expect(cw.elements[0]?.d).not.toBe(ccw.elements[0]?.d);
  const doc = cw.toJSON();
  expect(Canvas.fromJSON(doc).toSVG()).toBe(cw.toSVG());
});

test("a filled arc is expanded ink, not refused", () => {
  const c = new Canvas([], { finish: "filled" });
  c.arc({ cx: 12, cy: 12, from: "top", r: 8, sweep: "half" });
  expect(c.elements).toHaveLength(1);
  expect(c.toSVG()).toContain('fill="currentColor"');
});

test("a filled diagonal unions its cap and body subpaths", () => {
  const c = new Canvas([], { finish: "filled" });
  c.line({
    points: [
      [12, 7],
      [15, 4],
    ],
  });
  const shapePath = c.elements[0]?.d ?? "";
  expect(shapePath.match(/M/gu)).toHaveLength(3);
  const winding = parsePath(shapePath).map((subpath) => {
    const points = flatten(subpath, 8);
    let area = 0;
    for (const [index, point] of points.entries()) {
      const next = points[(index + 1) % points.length];
      area += point[0] * next[1] - next[0] * point[1];
    }
    return area;
  });
  expect(
    winding.every((area) => Math.sign(area) === Math.sign(winding[0]))
  ).toBe(true);
  expect(c.elements[0]?.fillRule).toBe("nonzero");
  expect(c.toSVG()).toContain('fill-rule="nonzero"');
  // The stadium keeps its `line` op rather than taking the `raw` escape. The
  // fill rule is derived on replay, not stored: the document is a recipe, and
  // `nonzero` is how a filled diagonal is painted, not what was asked for.
  expect(c.toJSON().draw[0]).toMatchObject({
    op: "line",
    points: [
      [12, 7],
      [15, 4],
    ],
  });
  expect(Canvas.fromJSON(c.toJSON()).toSVG()).toBe(c.toSVG());
  // Why it matters: `raw` has no DSL word, so a diagonal that took the escape
  // vanished from its own program and the saved `.icon` stopped being the
  // drawing. One campaign pair shipped as `filled.icon.partial` with both
  // arrowhead segments missing.
  expect(programFromDoc(c.toJSON())).toContain("line 12,7 15,4");
});

/** An open part with a curve in it. Flattening a curve produces chords, and a
 *  chord is off-axis by construction — the case the straight-edged `PARTS`
 *  fixture above cannot reach. */
const CURVED: Part[] = [
  {
    closed: false,
    d: "M0 0C2 0 4 2 4 4",
    h: 4,
    icons: ["hook"],
    id: "p0002",
    instances: 2,
    name: "hook",
    nodes: 2,
    sizeRange: [4, 4],
    w: 4,
  },
];

test("filled open curves retain a single replayable part and their stroke skeleton", () => {
  const c = new Canvas(CURVED, { finish: "filled" });
  c.part({ id: "p0002", x: 4, y: 4 });
  expect(c.elements).toHaveLength(1);
  expect(c.elements[0].kind).toBe("part");
  expect(c.elements[0].d).toMatch(/[CQ]/u);
  const doc = c.toJSON();
  expect(programFromDoc(doc)).toContain("part p0002 at 4,4");
  expect(Canvas.fromJSON(doc, CURVED).toSVG()).toBe(c.toSVG());
  expect(c.skeletonBbox()).toMatchObject({ x0: 4, x1: 8, y0: 4, y1: 8 });
  c.transform(0.5, 2, 2);
  expect(c.elements).toHaveLength(1);
  expect(c.visualBbox()?.w).toBeCloseTo(4, 2);
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
  // dot keeps its role size — a terminal dot is 2 at every keyline.
  expect(rect.kind === "rect" && rect.r).toBe(1);
  expect(dotDiameter(dot.d)).toBe(SPEC.dots.terminal);
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

test("a transform clips a fixed-width cutter that outgrows its shrinking body", () => {
  const c = new Canvas([], { finish: "filled" });
  c.circle({ cx: 12, cy: 12, r: 8 });
  c.hole({
    points: [
      [8, 8],
      [16, 16],
    ],
    shape: "line",
  });
  c.transform(0.12, 0, 0);
  expect(c.elements).toHaveLength(2);
  expect(c.elements[1].op).toBe("knockout");
  expect(Canvas.fromJSON(c.toJSON()).toSVG()).toBe(c.toSVG());
  expect(c.circle({ cx: 12, cy: 12, r: 1 })).toBe("e2");
});

test("remove and clear keep ids and the log honest", () => {
  const c = new Canvas();
  const a = c.rect({ h: 4, w: 4, x: 2, y: 2 });
  c.circle({ cx: 12, cy: 12, r: 3 });
  expect(c.remove(a)).toStrictEqual({ remaining: 1, removed: [a] });
  expect(() => c.remove(a)).toThrow(/no element/u);
  c.clear();
  expect(c.bbox()).toBeNull();
});

/**
 * Orientation. The clusterer folds a mark and its quarter-turns into one part,
 * so a part the set draws four ways needs four ways to be placed — and exactly
 * four: a free angle would be raw geometry entering through a new door.
 */
test("a turned part keeps x,y as its top-left corner", () => {
  const c = new Canvas(PARTS);
  // "corner" is M0 0L4 0L4 4. A clockwise quarter-turn sends (4,0) to (0,4) and
  // (4,4) to (-4,4), which is off the origin until the placement re-seats it.
  c.part({ id: "p0001", turn: 1, x: 2, y: 3 });
  const b = bbox(parsePath(c.elements[0].d));
  expect([b.x0, b.y0, b.w, b.h]).toStrictEqual([2, 3, 4, 4]);
});

test("a quarter-turn transposes a part's extent", () => {
  const c = new Canvas([{ ...PARTS[0], d: "M0 0L6 0L6 2", h: 2, w: 6 }]);
  c.part({ id: "p0001", turn: 1, x: 0, y: 0 });
  const b = bbox(parsePath(c.elements[0].d));
  expect([b.w, b.h]).toStrictEqual([2, 6]);
});

test("a part placed at each turn survives the round-trip unchanged", () => {
  for (const turn of [0, 1, 2, 3]) {
    const c = new Canvas(PARTS);
    c.part({ id: "p0001", scale: 1.5, turn, x: 3, y: 4 });
    const doc = c.toJSON();
    expect(doc.draw).toStrictEqual([
      { id: "p0001", op: "part", scale: 1.5, turn, x: 3, y: 4 },
    ]);
    const back = Canvas.fromJSON(doc, PARTS);
    expect(back.toSVG()).toBe(c.toSVG());
    expect(back.toJSON()).toStrictEqual(doc);
  }
});

test("a transform re-emits a turned part at the same turn", () => {
  const c = new Canvas(PARTS);
  c.part({ id: "p0001", turn: 3, x: 2, y: 2 });
  c.transform(2, 1, 1);
  const [el] = c.elements;
  expect(el.kind === "part" && el.turn).toBe(3);
});

test("a free angle is not a turn", () => {
  const c = new Canvas(PARTS);
  for (const turn of [1.5, 4, -1, 37]) {
    expect(() => c.part({ id: "p0001", turn, x: 0, y: 0 })).toThrow(
      /quarter-turn/u
    );
  }
});

/**
 * The one claim that spans two modules: the turn index `parts/shape.ts` reports
 * is the turn index this canvas places at. Nothing inside either module can
 * catch a convention drift between them — the clusterer would still merge and
 * the canvas would still draw, just at the wrong orientation — so it is checked
 * end to end, from two icons on disk to the placed path.
 */
test("placing at the recorded turn reproduces the instance that was folded in", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "iconsmith-turn-"));
  const write = (name: string, d: string) =>
    writeFileSync(
      path.join(dir, `${name}.svg`),
      `<svg viewBox="0 0 24 24"><path d="${d}"/></svg>`
    );
  // The same chevron, drawn pointing right and pointing up.
  write("chevron-right", "M4 4L8 9L4 14");
  write("chevron-up", "M16 4L11 8L6 4");
  const { parts } = extractParts(dir);
  const part = parts.find((p) => p.icons.length === 2);
  if (!part?.turns) {
    throw new Error("expected the two chevrons to share one part");
  }
  const turn = part.turns.findIndex((n, i) => i > 0 && n > 0);
  rmSync(dir, { force: true, recursive: true });

  const canonical = fingerprint(parsePath(part.d)[0]);
  const c = new Canvas(parts);
  c.part({ id: part.id, turn, x: 0, y: 0 });
  const placed = fingerprint(parsePath(c.elements[0].d)[0]);
  // Same shape either way — `distance` is turn-invariant — so the check is that
  // the placed drawing is genuinely turned rather than the canonical one again.
  expect(match(canonical, placed).turn).toBe((4 - turn) % 4);
});

/**
 * Chirality. The clusterer folds a mark onto its mirror as well as onto its
 * quarter-turns — over blode-icons 19 mirror pairs had both halves inside one
 * icon, `airdrop`'s two chevrons and `ar-cube-1`'s two faces among them — so
 * one part covers both and the placement says which way round it goes.
 *
 * That is only safe while the reflection is asked for. A check mark, a comma,
 * an `S` and every letterform are chiral, and their mirror is wrong rather than
 * merely turned, so these tests are the guard that no path through `part()`
 * reaches a mirror by accident.
 */

/** Unequal arms, so the mirror is a genuinely different drawing rather than one
 *  of the shape's own quarter-turns. */
const CHIRAL: Part[] = [{ ...PARTS[0], d: "M0 0L0 4L2 4", h: 4, w: 2 }];

test("a part is not mirrored unless flip is asked for", () => {
  const plain = new Canvas(CHIRAL);
  plain.part({ id: "p0001", x: 0, y: 0 });
  for (const turn of [0, 1, 2, 3]) {
    const c = new Canvas(CHIRAL);
    c.part({ id: "p0001", turn, x: 0, y: 0 });
    const [el] = c.elements;
    expect(el.kind === "part" && el.flip).toBeUndefined();
    expect(c.toJSON().draw[0]).not.toHaveProperty("flip");
  }
  // And the geometry, not just the flag: no turn of the unflipped placement is
  // the mirror, which is exactly what the unequal arms buy.
  const mirrored = new Canvas(CHIRAL);
  mirrored.part({ flip: true, id: "p0001", x: 0, y: 0 });
  const a = fingerprint(parsePath(plain.elements[0].d)[0]);
  const b = fingerprint(parsePath(mirrored.elements[0].d)[0]);
  expect(a.norm).not.toStrictEqual(b.norm);
});

test("a flipped part keeps x,y as its top-left corner", () => {
  const c = new Canvas(CHIRAL);
  // Mirroring in x sends the whole drawing to negative x; the placement
  // re-seats it, and a reflection leaves the extent alone.
  c.part({ flip: true, id: "p0001", x: 2, y: 3 });
  const b = bbox(parsePath(c.elements[0].d));
  expect([b.x0, b.y0, b.w, b.h]).toStrictEqual([2, 3, 2, 4]);
});

test("a flipped part survives the round-trip unchanged", () => {
  for (const turn of [0, 1, 2, 3]) {
    const c = new Canvas(CHIRAL);
    c.part({ flip: true, id: "p0001", scale: 1.5, turn, x: 3, y: 4 });
    const doc = c.toJSON();
    expect(doc.draw).toStrictEqual([
      { flip: true, id: "p0001", op: "part", scale: 1.5, turn, x: 3, y: 4 },
    ]);
    const back = Canvas.fromJSON(doc, CHIRAL);
    expect(back.toSVG()).toBe(c.toSVG());
    expect(back.toJSON()).toStrictEqual(doc);
  }
});

test("a transform re-emits a flipped part still flipped", () => {
  const c = new Canvas(CHIRAL);
  c.part({ flip: true, id: "p0001", turn: 3, x: 2, y: 2 });
  const before = c.elements[0].d;
  c.transform(2, 1, 1);
  const [el] = c.elements;
  expect(el.kind === "part" && el.flip).toBe(true);
  // Re-emitted through the primitive, not rewritten: a similarity transform
  // preserves chirality, so the shape must be the same one scaled and moved.
  const a = fingerprint(parsePath(before)[0]);
  const b = fingerprint(parsePath(el.d)[0]);
  expect(match(a, b)).toMatchObject({ flip: false, turn: 0 });
});

/**
 * The second claim that spans two modules, after the turn one above: the
 * `{turn, flip}` `parts/shape.ts` reports is the `{turn, flip}` this canvas
 * places at. A convention drift — reflect-then-turn against turn-then-reflect —
 * would leave both modules working and the orientation silently wrong for every
 * part whose turn is odd, so it is checked end to end from two icons on disk.
 */
test("placing at the recorded flip reproduces the instance that was folded in", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "iconsmith-flip-"));
  const write = (name: string, d: string) =>
    writeFileSync(
      path.join(dir, `${name}.svg`),
      `<svg viewBox="0 0 24 24"><path d="${d}"/></svg>`
    );
  // The same chiral tick, drawn leaning right and leaning left — the shape of
  // `airdrop`'s pair, which the clusterer used to return as two parts.
  write("tick-right", "M4 4L4 14L10 14");
  write("tick-left", "M20 4L20 14L14 14");
  const { parts } = extractParts(dir);
  const part = parts.find((p) => p.icons.length === 2);
  rmSync(dir, { force: true, recursive: true });
  if (!part?.flips) {
    throw new Error("expected the two ticks to fold into one part");
  }
  // Both drawings are one part, and the set uses it both ways round.
  expect(part.flips).toStrictEqual([1, 1]);

  const canonical = fingerprint(parsePath(part.d)[0]);
  const c = new Canvas(parts);
  c.part({ flip: true, id: part.id, x: 0, y: 0 });
  const placed = fingerprint(parsePath(c.elements[0].d)[0]);
  // `distance` is reflection-invariant, so the check is that the placed drawing
  // is genuinely mirrored rather than the canonical one again.
  expect(match(canonical, placed).flip).toBe(true);
});

test("default part placement snaps the anchor without deforming admitted curves", () => {
  const part = {
    ...PARTS[0],
    d: "M0 0C0.5523 0 4.1234 1.8765 4.1234 6",
    h: 6,
    w: 4.1234,
  };
  const c = new Canvas([part]);
  c.part({ id: part.id, scale: 1, x: 3.13, y: 4.88 });
  expect(c.elements[0].d).toBe("M3.25 5C3.8023 5 7.3734 6.8765 7.3734 11");
  const doc = c.toJSON({ icon: "curve" });
  expect(Canvas.fromJSON(doc, [part]).toSVG()).toBe(c.toSVG());
});

test.each(["round", "square"] as const)(
  "filled source curve matches independent SVG stroke pixels with %s caps",
  async (cap) => {
    const c = new Canvas(CURVED, {
      finish: "filled",
      spec: { ...SPEC, stroke: 1.5, strokeCap: cap },
    });
    c.part({ id: "p0002", x: 4, y: 4 });
    const reference = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24"><path d="M4 4C6 4 8 6 8 8" fill="none" stroke="black" stroke-width="1.5" stroke-linecap="${cap}"/></svg>`;
    for (const size of [16, 24, 192]) {
      const raster = (svg: string) =>
        sharp(Buffer.from(svg))
          .resize(size, size)
          .flatten({ background: "white" })
          .greyscale()
          .raw()
          .toBuffer();
      // eslint-disable-next-line no-await-in-loop
      const [actual, expected] = await Promise.all([
        raster(c.toSVG()),
        raster(reference),
      ]);
      let error = 0;
      for (let i = 0; i < actual.length; i += 1) {
        error += Math.abs(actual[i] - expected[i]);
      }
      expect(error / (255 * actual.length)).toBeLessThan(0.01);
    }
  }
);

test("an expanded source part is a complete Boolean cutter with exact replay", () => {
  const c = new Canvas(CURVED, { finish: "filled" });
  c.rect({ h: 16, r: 1, w: 16, x: 2, y: 2 });
  c.part({ id: "p0002", scale: 2, x: 4, y: 4 });
  c.combine("subtract");
  const doc = c.toJSON();
  expect(c.elements).toHaveLength(1);
  expect(Canvas.fromJSON(doc, CURVED).toSVG()).toBe(c.toSVG());
  expect(programFromDoc(doc)).toContain("part p0002");
});
