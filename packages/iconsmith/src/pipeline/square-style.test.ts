import sharp from "sharp";
import { expect, test } from "vitest";

import { Canvas, specAt } from "../tools/canvas.js";
import { run } from "../tools/dsl.js";
import { programFromDoc, visualSize } from "../tools/twin.js";
import { DEFAULT_POLICY } from "./policy.js";
import {
  STYLE_COMPILER,
  compileStyle,
  createStyleRevision,
  replayStyle,
  selectStyle,
} from "./style.js";

const spec = {
  ...specAt({ radius: 1, stroke: 1.5 }),
  strokeCap: "square" as const,
};
const raster = (svg: string) =>
  sharp(Buffer.from(svg)).resize(384, 384).ensureAlpha().raw().toBuffer();

test.each(["line 4,4 16,16", "arc 12,12 r7 half from top"])(
  "selected square caps pair and replay %s",
  async (op) => {
    const style = selectStyle(
      createStyleRevision({
        calibration: "unvalidated",
        compiler: STYLE_COMPILER,
        id: "square-cap",
        masters: { large: spec },
        parts: [],
        policy: DEFAULT_POLICY,
        references: [],
        rubric: "Compare cap shape and bounds",
      }),
      "large"
    );
    const artifacts = ["outlined", "filled"].map((paint) =>
      compileStyle(style, `finish ${paint}\n${op}`)
    );
    for (const a of artifacts) {
      expect(replayStyle(style, a)).toBe(a.svg);
    }
    expect(artifacts[0].svg).toContain('stroke-linecap="square"');
    const [a, b] = await Promise.all(artifacts.map((x) => raster(x.svg)));
    let difference = 0;
    for (let i = 3; i < a.length; i += 4) {
      difference += Math.abs(a[i] - b[i]);
    }
    expect(difference / (384 * 384 * 255)).toBeLessThan(0.0001);
    const sizes = artifacts.map((x) =>
      visualSize(run(x.program, [], { spec }).canvas)
    );
    if (!sizes[0] || !sizes[1]) {
      throw new Error("Missing bounds");
    }
    expect(sizes[0].w).toBeCloseTo(sizes[1].w, 3);
    expect(sizes[0]?.h).toBeCloseTo(sizes[1].h, 3);
  }
);

test("trim exposes square caps and preserves its nested recipe", () => {
  const r = run("finish outlined\nline 4,8 20,8\nrect 2,2 8x12 r0\ntrim", [], {
    spec,
  });
  expect(r.errors).toEqual([]);
  expect(r.canvas.visualBbox()?.x0).toBeCloseTo(9.25, 3);
  const doc = r.canvas.toJSON({ icon: "trim" });
  expect(Canvas.fromJSON(doc, [], spec).toSVG()).toBe(r.canvas.toSVG());
  expect(run(programFromDoc(doc), [], { spec }).canvas.toSVG()).toBe(
    r.canvas.toSVG()
  );
});

test("dot roles remain round discs in a square-cap style", async () => {
  const dotSpec = { ...specAt(), strokeCap: "square" as const };
  const a = run("finish outlined\ndot 12,12 terminal", [], {
    spec: dotSpec,
  }).canvas;
  const b = run("finish filled\ndot 12,12 terminal", [], {
    spec: dotSpec,
  }).canvas;
  expect(a.toSVG()).toContain('stroke-linecap="round"');
  expect(visualSize(a)).toEqual(visualSize(b));
  const [left, right] = await Promise.all([
    raster(a.toSVG()),
    raster(b.toSVG()),
  ]);
  let difference = 0;
  for (let i = 3; i < left.length; i += 4) {
    difference += Math.abs(left[i] - right[i]);
  }
  expect(difference / (384 * 384 * 255)).toBeLessThan(0.0001);
});
