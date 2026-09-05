import sharp from "sharp";
import { expect, test } from "vitest";

import { Canvas, specAt } from "../tools/canvas.js";
import { run } from "../tools/dsl.js";
import { lint } from "../tools/lint.js";
import { programFromDoc } from "../tools/twin.js";
import { DEFAULT_POLICY } from "./policy.js";
import {
  STYLE_COMPILER,
  compileStyle,
  createStyleRevision,
  replayStyle,
  selectStyle,
} from "./style.js";
import { createTools } from "./tools.js";

const spec = { ...specAt(), detailStroke: 1.8 };
const revision = (master = spec) =>
  createStyleRevision({
    calibration: "unvalidated",
    compiler: STYLE_COMPILER,
    id: "detail",
    masters: { large: master },
    parts: [],
    policy: DEFAULT_POLICY,
    references: [],
    rubric: "Compare optical detail weight with the enclosing ring",
  });

test.each([
  "line 5,8 19,8 detail",
  "line 5,5 19,19 detail",
  "line 5,18 5,6 18,6 r1 detail",
])("detail expansion independently matches stroked SVG: %s", async (op) => {
  const style = selectStyle(revision(), "large");
  const artifacts = ["outlined", "filled"].map((p) =>
    compileStyle(style, `finish ${p}\n${op}`)
  );
  for (const a of artifacts) {
    expect(replayStyle(style, a)).toBe(a.svg);
  }
  expect(artifacts[0].svg).toContain('stroke-width="1.8"');
  const [a, b] = await Promise.all(
    artifacts.map((x) =>
      sharp(Buffer.from(x.svg)).resize(384, 384).ensureAlpha().raw().toBuffer()
    )
  );
  let difference = 0;
  for (let i = 3; i < a.length; i += 4) {
    difference += Math.abs(a[i] - b[i]);
  }
  expect(difference / (384 * 384 * 255)).toBeLessThan(0.0001);
});

test("detail role survives documents, transforms and nested trim", () => {
  const result = run("line 4,8 20,8 detail", [], { spec });
  expect(result.errors).toEqual([]);
  result.canvas.transform(0.75, 2, 2);
  expect(result.canvas.toSVG()).toContain('stroke-width="1.8"');
  result.canvas.rect({ h: 12, r: 0, w: 8, x: 2, y: 2 });
  result.canvas.combine("trim");
  const doc = result.canvas.toJSON({ icon: "trim-detail" });
  const svg = result.canvas.toSVG();
  expect(svg).toContain('stroke-width="1.8"');
  expect(Canvas.fromJSON(doc, [], spec).toSVG()).toBe(svg);
  expect(run(programFromDoc(doc), [], { spec }).canvas.toSVG()).toBe(svg);
});

test("detail paint controls bounds and true mixed-weight spacing", () => {
  const result = run("line 4,4 4,20\nline 6.5,4 6.5,20 detail", [], {
    spec: { ...spec, minGap: 0.7 },
  });
  expect(result.errors).toEqual([]);
  expect(result.canvas.visualBbox()?.x1).toBeCloseTo(7.4, 4);
  expect(lint(result.canvas).find((i) => i.rule === "gap")?.message).toContain(
    "0.60px"
  );
  const filled = run("finish filled\nline 4,4 4,20 detail", [], {
    spec,
  }).canvas;
  expect(filled.visualBbox()?.w).toBeCloseTo(1.8, 4);
  expect(filled.skeletonBbox()?.w).toBeCloseTo(0, 4);
});

test("detail admission refuses missing or invalid widths, preserving defaults", async () => {
  expect(run("line 4,4 20,4 detail").errors.length).toBe(1);
  expect(() => revision({ ...spec, detailStroke: 2.1 })).toThrow();
  expect(() => revision({ ...spec, detailStroke: 0 })).toThrow();
  const toolset = createTools({ spec });
  await toolset.tools.line.execute?.(
    {
      points: [
        [4, 4],
        [20, 4],
      ],
      weight: "detail",
    },
    { messages: [], toolCallId: "detail" }
  );
  expect(toolset.canvas.toSVG()).toContain('stroke-width="1.8"');
  const ordinary = "circle 12,12 r9\nline 8,12 16,12";
  expect(run(ordinary, [], { spec }).canvas.toSVG()).toBe(
    run(ordinary).canvas.toSVG()
  );
  const c = run("line 4,4 20,4 detail", [], { spec }).canvas;
  const doc = c.toJSON({ icon: "unsupported-hole" });
  expect(() =>
    Canvas.fromJSON(
      {
        ...doc,
        draw: [{ ...doc.draw[0], knockout: true }] as never,
        finish: "filled",
      },
      [],
      spec
    )
  ).toThrow(/subtraction/u);
});
