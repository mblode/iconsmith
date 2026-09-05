import { expect, test } from "vitest";

import { parsePath } from "../geometry/path.js";
import { Canvas, specAt } from "../tools/canvas.js";
import { run } from "../tools/dsl.js";
import { lint } from "../tools/lint.js";
import { programFromDoc, visualSize } from "../tools/twin.js";
import { DEFAULT_POLICY } from "./policy.js";
import {
  STYLE_COMPILER,
  createStyleRevision,
  selectStyle,
  compileStyle,
  replayStyle,
} from "./style.js";

const spec = {
  ...specAt({ radius: 0, stroke: 1.5 }),
  strokeJoin: "miter" as const,
};
const outline =
  "icon bookmark\nfinish outlined\nline 19.25,21.25 19.25,2.75 4.75,2.75 4.75,21.25 12,17.25 19.25,21.25 r0 off-axis";
const filled = `${outline.replace("outlined", "filled")} solid`;

test("zero-radius selected style compiles and exactly replays both sharp paints", () => {
  const revision = createStyleRevision({
    calibration: "unvalidated",
    compiler: STYLE_COMPILER,
    id: "sharp",
    masters: { large: spec },
    parts: [],
    policy: DEFAULT_POLICY,
    references: [],
    rubric: "Compare sharp joins and intended topology at native size.",
  });
  const style = selectStyle(revision, "large");
  for (const program of [outline, filled]) {
    const a = compileStyle(style, program);
    expect(replayStyle(style, a)).toBe(a.svg);
  }
  const a = run(outline, [], { spec }).canvas,
    b = run(filled, [], { spec }).canvas;
  expect(a.toSVG()).toContain('stroke-linejoin="miter" stroke-miterlimit="4"');
  expect(parsePath(a.elements[0].d)[0].closed).toBe(true);
  expect(parsePath(b.elements[0].d)).toHaveLength(1);
  expect(visualSize(a)?.h).toBeCloseTo(20.5204, 4);
  expect(visualSize(b)?.h).toBeCloseTo(20.5204, 4);
  expect(visualSize(a)?.w).toBeCloseTo(16, 4);
});

test("sharp rings, nested subtraction and transformed recipes replay", () => {
  const ring = run(outline.replace("outlined", "filled"), [], { spec });
  expect(ring.errors).toEqual([]);
  expect(parsePath(ring.canvas.elements[0].d)).toHaveLength(2);
  const result = run(`${filled}\ncircle 12,10 r2\nsubtract`, [], { spec });
  expect(result.errors).toEqual([]);
  const doc = result.canvas.toJSON({ icon: "cut" });
  expect(Canvas.fromJSON(doc, [], spec).toSVG()).toBe(result.canvas.toSVG());
  expect(run(programFromDoc(doc), [], { spec }).canvas.toSVG()).toBe(
    result.canvas.toSVG()
  );
  const a = run(filled, [], { spec }).canvas;
  a.transform(0.8, 2, 2);
  expect(Canvas.fromJSON(a.toJSON({ icon: "scaled" }), [], spec).toSVG()).toBe(
    a.toSVG()
  );
});

test("miter tip beyond canvas triggers bleed even when centerline fits", () => {
  const result = run(
    "finish outlined\nline 10,4 12,0.75 14,4 r0 off-axis",
    [],
    { spec }
  );
  expect(result.errors).toEqual([]);
  expect(lint(result.canvas).some((i) => i.rule === "bleed")).toBe(true);
});

test("zero-radius styles refuse positive corner requests without tiers", () => {
  const c = new Canvas([], { spec });
  expect(() => c.rect({ h: 10, r: 1, w: 10, x: 4, y: 4 })).toThrow(
    /no positive radius/u
  );
  expect(c.elements).toHaveLength(0);
  expect(
    run("finish filled\nline 4,4 12,12 r0 solid", [], { spec }).errors.length
  ).toBeGreaterThan(0);
});
