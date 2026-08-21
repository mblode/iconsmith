/**
 * Fill mode: the finish, the knockout, and the rules that invert with them.
 *
 * One file rather than three additions to `canvas.test.ts`, `dsl.test.ts` and
 * `lint.test.ts`, because fill mode is one feature and its three halves only
 * mean anything together — a `hole` that quantises but serialises into the
 * wrong element paints the icon inside out, and neither file alone would
 * notice. The stroke-mode assertions those files already hold are the other
 * half of this: they are what says the invariant is unchanged.
 */
import { expect, test } from "vitest";

import { bbox, parsePath } from "../geometry/path.js";
import type { Finish, Part } from "../types.js";
import { Canvas, SPEC } from "./canvas.js";
import { run } from "./dsl.js";
import { lint } from "./lint.js";

const filled = (parts: Part[] = []) => new Canvas(parts, { finish: "filled" });
const rules = (issues: { rule: string }[]) => issues.map((i) => i.rule);

const OPEN_PART: Part = {
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
};

const CLOSED_PART: Part = {
  ...OPEN_PART,
  closed: true,
  d: "M0 0L4 0L4 4L0 4Z",
  id: "p0002",
  name: "square",
};

test("the finish is fixed at construction and defaults to outlined", () => {
  expect(new Canvas().finish).toBe("outlined");
  expect(new Canvas().inkWidth).toBe(SPEC.stroke);
  expect(filled().finish).toBe("filled");
  expect(filled().inkWidth).toBe(0);
});

test("a filled document serialises as one evenodd path per solid", () => {
  const c = filled();
  c.rect({ h: 12, r: 2, w: 12, x: 6, y: 6 });
  c.hole({ cx: 12, cy: 12, r: 3, shape: "circle" });
  c.rect({ h: 2, r: 0, w: 2, x: 2, y: 2 });

  const svg = c.toSVG();
  const paths = [...svg.matchAll(/<path [^>]*\/>/gu)].map((m) => m[0]);
  // Two solids, so two elements; the hole is a subpath of the first, which is
  // how the corpus writes every one of its 1,807 knockouts.
  expect(paths).toHaveLength(2);
  expect(paths[0]).toContain('fill="currentColor"');
  expect(paths[0]).toContain('fill-rule="evenodd"');
  expect(paths[0]).toContain('clip-rule="evenodd"');
  expect(svg).not.toContain("stroke");
  // The hole's subpath sits inside the solid's element, not beside it: the
  // fill rule does not reach across elements.
  expect((paths[0].match(/M/gu) ?? []).length).toBe(2);
  expect((paths[1].match(/M/gu) ?? []).length).toBe(1);
});

test("an outlined document serialises exactly as it always did", () => {
  const c = new Canvas();
  c.rect({ h: 12, w: 12, x: 6, y: 6 });
  const svg = c.toSVG();
  expect(svg).toContain('stroke="currentColor"');
  expect(svg).toContain(`stroke-width="${SPEC.stroke}"`);
  expect(svg).not.toContain("fill-rule");
});

test("a knockout is quantised and tiered by the code that draws a solid", () => {
  const c = filled();
  c.rect({ h: 20, r: 4, w: 20, x: 2, y: 2 });
  const id = c.hole({
    h: 8.13,
    r: 2.9,
    shape: "rect",
    w: 8.13,
    x: 8.13,
    y: 8.13,
  });
  const el = c.elements.find((e) => e.id === id);
  expect(el).toMatchObject({
    h: 8.25,
    kind: "rect",
    r: 3,
    w: 8.25,
    x: 8.25,
    y: 8.25,
  });
  expect(el?.op).toBe("knockout");
});

test("a hole outside the solid it cuts is refused, not inverted", () => {
  const c = filled();
  c.rect({ h: 8, r: 0, w: 8, x: 8, y: 8 });
  expect(() => c.hole({ cx: 16, cy: 12, r: 3, shape: "circle" })).toThrow(
    /not inside e0/u
  );
});

test("a hole needs a solid, and cannot be cut out of another hole", () => {
  const c = filled();
  expect(() => c.hole({ cx: 12, cy: 12, r: 2, shape: "circle" })).toThrow(
    /nothing to cut a hole in/u
  );
  c.rect({ h: 12, r: 0, w: 12, x: 6, y: 6 });
  const hole = c.hole({ cx: 12, cy: 12, r: 3, shape: "circle" });
  expect(() =>
    c.hole({ cutFrom: hole, cx: 12, cy: 12, r: 1, shape: "circle" })
  ).toThrow(/hole in a hole/u);
});

test("cutFrom reaches back past a later solid, and the hole sits with it", () => {
  const c = filled();
  const body = c.rect({ h: 10, r: 0, w: 10, x: 2, y: 2 });
  c.rect({ h: 6, r: 0, w: 6, x: 14, y: 14 });
  c.hole({ cutFrom: body, cx: 7, cy: 7, r: 2, shape: "circle" });
  // Order is the structure: the hole is stored with the solid it cuts, so the
  // groups serialise correctly without any stored back-reference.
  expect(c.elements.map((e) => e.op ?? "add")).toEqual([
    "add",
    "knockout",
    "add",
  ]);
  expect(c.toSVG().match(/<path/gu)).toHaveLength(2);
});

test("a filled canvas refuses geometry that would paint nothing", () => {
  const c = filled([OPEN_PART, CLOSED_PART]);
  expect(() =>
    c.line({
      offAxis: true,
      points: [
        [4, 4],
        [8, 4],
        [12, 8],
      ],
    })
  ).toThrow(/polyline paints nothing in a filled icon/u);
  expect(() => c.part({ id: OPEN_PART.id, x: 4, y: 4 })).toThrow(/open mark/u);
  expect(() => c.part({ id: CLOSED_PART.id, x: 4, y: 4 })).not.toThrow();
});

test("a filled two-point line is the stroke expanded to a bar", () => {
  const c = filled();
  c.line({
    points: [
      [4, 12],
      [20, 12],
    ],
  });
  expect(c.elements).toHaveLength(1);
  expect(c.elements[0]).toMatchObject({
    h: 2,
    kind: "rect",
    w: 18,
    x: 3,
    y: 11,
  });
});

test("hole is unreachable while the finish is outlined", () => {
  const c = new Canvas();
  c.rect({ h: 12, w: 12, x: 6, y: 6 });
  expect(() => c.hole({ cx: 12, cy: 12, r: 3, shape: "circle" })).toThrow(
    /only means something in a filled icon/u
  );
});

/** The radius a 20×20 rect comes out with, per finish. */
const ask = (finish: Finish, r: number): number | null => {
  const c = new Canvas([], { finish });
  const id = c.rect({ h: 20, r, w: 20, x: 2, y: 2 });
  const el = c.elements.find((e) => e.id === id);
  return el && "r" in el ? el.r : null;
};

/** The drawn diameter of a `node` dot, per finish. */
const dotDiameter = (finish: Finish): number => {
  const c = new Canvas([], { finish });
  c.dot({ cx: 12, cy: 12, role: "node" });
  return bbox(parsePath(c.elements[0].d)).w;
};

test("a filled corner takes the filled tiers, an outlined one does not", () => {
  // The commonest filled corner in the set is 4, which is not a house tier at
  // all: an outlined 3 is a centre line and its filled twin is the boundary,
  // half a stroke further out.
  expect(ask("filled", 3.8)).toBe(4);
  expect(ask("outlined", 3.8)).toBe(3);
  expect(ask("filled", 1.4)).toBe(1.5);
  expect(ask("outlined", 1.4)).toBe(1);
  expect(SPEC.fillRadiusTiers).toEqual([0.5, 1, 1.5, 2, 3, 4]);
});

test("a filled dot is the full tier, a stroked one is a stroke narrower", () => {
  expect(dotDiameter("filled")).toBe(SPEC.dots.node);
  expect(dotDiameter("outlined")).toBe(SPEC.dots.node - SPEC.stroke);
});

test("a transform preserves the holes and what they are cut from", () => {
  const c = filled();
  c.rect({ h: 10, r: 2, w: 10, x: 4, y: 4 });
  c.hole({ cx: 9, cy: 9, r: 2, shape: "circle" });
  c.rect({ h: 4, r: 0, w: 4, x: 16, y: 16 });
  const before = c.elements.map((e) => e.id);

  c.transform(1.5, 1, 1);

  expect(c.elements.map((e) => e.id)).toEqual(before);
  expect(c.elements.map((e) => e.op ?? "add")).toEqual([
    "add",
    "knockout",
    "add",
  ]);
  expect(c.toSVG().match(/<path/gu)).toHaveLength(2);
});

test("removing a solid takes its holes with it", () => {
  const c = filled();
  const body = c.rect({ h: 10, r: 0, w: 10, x: 4, y: 4 });
  c.hole({ cx: 9, cy: 9, r: 2, shape: "circle" });
  const other = c.rect({ h: 4, r: 0, w: 4, x: 16, y: 16 });

  // Otherwise the orphaned hole would reattach to whatever element preceded
  // it and appear as a hole in an unrelated shape.
  expect(c.remove(body)).toEqual({ remaining: 1, removed: ["e0", "e1"] });
  expect(c.elements.map((e) => e.id)).toEqual([other]);
});

test("a filled document round-trips through toJSON and fromJSON", () => {
  const c = filled();
  c.rect({ h: 12, r: 2, w: 12, x: 6, y: 6 });
  c.hole({ cx: 12, cy: 12, r: 3, shape: "circle" });
  const doc = c.toJSON({ icon: "ring", keyline: "square" });

  expect(doc.finish).toBe("filled");
  expect(doc.draw[1]).toMatchObject({ knockout: true, op: "circle" });
  // Written only when true, like `offAxis` and `flip`.
  expect(doc.draw[0]).not.toHaveProperty("knockout");

  const back = Canvas.fromJSON(doc);
  expect(back.finish).toBe("filled");
  expect(back.toSVG()).toBe(c.toSVG());
  expect(back.toJSON({ icon: "ring", keyline: "square" })).toStrictEqual(doc);
});

test("an outlined document gains no finish key", () => {
  const c = new Canvas();
  c.rect({ h: 12, w: 12, x: 6, y: 6 });
  expect(c.toJSON()).not.toHaveProperty("finish");
});

test("the DSL declares a finish and cuts holes with it", () => {
  const r = run(`
    icon ring
    keyline circle
    finish filled
    circle 12,12 r10
    hole circle 12,12 r6
  `);
  expect(r.errors).toEqual([]);
  expect(r.finish).toBe("filled");
  expect(r.canvas.elements.map((e) => e.op ?? "add")).toEqual([
    "add",
    "knockout",
  ]);
  expect(r.canvas.toSVG()).toContain('fill-rule="evenodd"');
});

test("the DSL refuses a finish declared after geometry, or an unknown one", () => {
  const late = run("rect 4,4 8x8\nfinish filled");
  expect(late.errors).toHaveLength(1);
  expect(late.errors[0]).toMatch(/before anything is drawn/u);

  const unknown = run("finish glossy");
  expect(unknown.errors[0]).toMatch(/unknown finish "glossy"/u);
  // The scan takes the first *valid* declaration, so a bad one leaves the
  // canvas at the default rather than at half a state.
  expect(unknown.finish).toBe("outlined");
});

test("the DSL's hole needs a shape it knows", () => {
  const r = run("finish filled\ncircle 12,12 r8\nhole blob 12,12 r2");
  expect(r.errors[0]).toMatch(/hole needs a shape to cut with/u);
});

test("`fit` scales a filled drawing to the keyline without a stroke allowance", () => {
  const r = run(`
    keyline square
    finish filled
    rect 8,8 4x4 r0
    fit
  `);
  expect(r.errors).toEqual([]);
  // Filled, the path bbox *is* the visual extent, so the drawing fills the
  // whole 18×18 keyline rather than stopping a stroke short of it.
  const b = r.canvas.bbox();
  expect(b?.w).toBe(18);
  expect(b?.h).toBe(18);
  expect(lint(r.canvas, { keyline: "square" })).toEqual([]);
});

test("lint measures a filled extent without adding a stroke to it", () => {
  const c = filled();
  // An 18×18 path, which filled *is* the square keyline and stroked would be
  // 20×20 — so a wrong reading here would report the wrong keyline entirely.
  c.rect({ h: 18, r: 0, w: 18, x: 3, y: 3 });
  expect(lint(c, { keyline: "square" })).toEqual([]);
  expect(
    lint({ elements: c.elements }, { keyline: "square" }).map((i) => i.rule)
  ).toContain("keyline");
});

test("bleed's live area moves with the ink", () => {
  const edge = "M0 0L24 0L24 24L0 24Z";
  // Stroked, geometry on the canvas edge bleeds by a full stroke half-width.
  expect(rules(lint({ elements: [{ d: edge, id: "e0" }] }))).toContain("bleed");
  // Filled, the path is the boundary, so the same path exactly fills the
  // canvas — and a filled icon whose visual extent matches its outlined
  // twin's, which 94% of them do, must not fail a rule its twin passes.
  expect(
    rules(lint({ elements: [{ d: edge, id: "e0" }], finish: "filled" }))
  ).not.toContain("bleed");
  expect(
    rules(
      lint({
        elements: [{ d: "M-1 0L24 0L24 24L-1 24Z", id: "e0" }],
        finish: "filled",
      })
    )
  ).toContain("bleed");
});

test("fill mode swaps the gap rule for a minimum feature size", () => {
  const c = filled();
  c.rect({ h: 16, r: 0, w: 16, x: 4, y: 4 });
  // A hole shares its edge with the solid it cuts, so `gap` would fire on
  // every correctly drawn filled icon. It must not be running at all.
  c.hole({ h: 4, r: 0, shape: "rect", w: 4, x: 6, y: 6 });
  expect(rules(lint(c))).not.toContain("gap");

  const thin = filled();
  thin.rect({ h: 16, r: 0, w: 16, x: 4, y: 4 });
  thin.hole({ h: 8, r: 0, shape: "rect", w: 1, x: 10, y: 8 });
  const feature = lint(thin).find((i) => i.rule === "feature");
  expect(feature?.severity).toBe("warn");
  expect(feature?.message).toContain(String(SPEC.minFeature));
  // And the threshold is the legibility floor, not the set's mode: a 2-unit
  // hole is the commonest size the corpus ships and must stay silent.
  const ok = filled();
  ok.rect({ h: 16, r: 0, w: 16, x: 4, y: 4 });
  ok.hole({ h: 2, r: 0, shape: "rect", w: 2, x: 11, y: 11 });
  expect(rules(lint(ok))).not.toContain("feature");
});

test("the feature rule stays out of stroke mode, and gap stays out of fill", () => {
  const stroked = new Canvas();
  stroked.line({
    points: [
      [4, 4],
      [20, 4],
    ],
  });
  stroked.line({
    points: [
      [4, 4.5],
      [20, 4.5],
    ],
  });
  const issues = rules(lint(stroked));
  expect(issues).toContain("gap");
  expect(issues).not.toContain("feature");
});

test("a filled arc is that stroke expanded, not refused", () => {
  const c = filled();
  c.arc({ cx: 12, cy: 14, from: "left", r: 9, sweep: "half" });
  expect(c.elements).toHaveLength(1);
  expect(c.elements[0].kind).toBe("arc");
  expect(c.toSVG()).toContain('fill="currentColor"');
  expect(c.toSVG()).not.toContain("stroke=");
});
