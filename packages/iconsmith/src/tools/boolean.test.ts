import sharp from "sharp";
import { expect, test } from "vitest";

import { bbox, parsePath } from "../geometry/path.js";
import { combinePaths } from "./boolean.js";
import { Canvas, SPEC } from "./canvas.js";
import { completeProgram, run } from "./dsl.js";
import { programFromDoc } from "./twin.js";

const filled = (source: string) =>
  run(`icon boolean-test\nfinish filled\n${source}`);

test("subtract crosses the outside edge without adding ink and retains curves", async () => {
  const result = filled("rect 3,3 18x18 r3\ncircle 19,18 r5\nsubtract");
  expect(result.errors).toEqual([]);
  const svg = result.canvas.toSVG();
  expect(svg).not.toContain("mask");
  expect(svg).toContain("C");
  const { data, info } = await sharp(Buffer.from(svg))
    .resize(240, 240)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const alpha = (x: number, y: number) =>
    data[(y * info.width + x) * info.channels + 3];
  expect(alpha(30, 180)).toBeGreaterThan(200);
  expect(alpha(190, 180)).toBe(0);
  expect(alpha(235, 180)).toBe(0);
  expect(bbox(parsePath(result.canvas.elements[0].d)).x1).toBeLessThanOrEqual(
    21
  );
});

test("union cutters before subtraction avoids overlapping-counter XOR", () => {
  const r = filled(
    "rect 2,2 20x20 r3\ncircle 10,12 r4\ncircle 14,12 r4\nunion\nsubtract"
  );
  expect(r.errors).toEqual([]);
  const doc = r.canvas.toJSON({ icon: r.icon, keyline: r.keyline });
  const program = programFromDoc(doc);
  expect(completeProgram(doc, program)).toBe(true);
  expect(run(program).canvas.toSVG()).toBe(r.canvas.toSVG());
  expect(Canvas.fromJSON(doc).toSVG()).toBe(r.canvas.toSVG());
  expect(program).toContain("union\nsubtract");
  expect(() => Canvas.fromJSON({ ...doc, finish: "outlined" })).toThrow(
    "Boolean recipes require filled shapes"
  );
  expect(JSON.stringify(doc)).not.toContain('"op":"raw"');
});

test("invalid or empty Boolean operations are atomic", () => {
  const c = new Canvas([], { finish: "filled" });
  c.rect({ h: 8, r: 1, w: 8, x: 5, y: 5 });
  c.rect({ h: 10, r: 1, w: 10, x: 4, y: 4 });
  const before = c.toSVG();
  expect(() => c.combine("subtract")).toThrow("entire shape");
  expect(c.toSVG()).toBe(before);
  expect(() => c.combine("union", "missing", "e1")).toThrow();
  expect(c.toSVG()).toBe(before);
  expect(
    run("rect 3,3 8x8\nrect 5,5 8x8\nunion").errors.length
  ).toBeGreaterThan(0);
  expect(() =>
    combinePaths("union", { d: "M0 0L4 4" }, { d: "M0 0L4 0L4 4Z" })
  ).toThrow("closed");
});

test("Boolean recipes retain existing compound counters", async () => {
  const r = filled(
    "circle 12,12 r8\nhole circle 12,12 r4\nrect 12,2 10x20 r1\nsubtract"
  );
  expect(r.errors).toEqual([]);
  const { data, info } = await sharp(Buffer.from(r.canvas.toSVG()))
    .resize(240, 240)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const alpha = (x: number, y: number) =>
    data[(y * info.width + x) * info.channels + 3];
  expect(alpha(110, 120)).toBe(0);
  expect(alpha(60, 120)).toBeGreaterThan(200);
  expect(alpha(180, 120)).toBe(0);
});

test("source contour mode preserves cubic handles and snaps placement, with exact replay", () => {
  const part = {
    closed: true,
    d: "M0 0C0 1.1046 0.8954 2 2 2L2 0Z",
    h: 2,
    icons: [],
    id: "curve",
    instances: 1,
    name: "curve",
    nodes: 3,
    sizeRange: [2, 2] as [number, number],
    w: 2,
  };
  const spec = { ...SPEC, partGeometry: "source" as const };
  const c = new Canvas([part], { finish: "filled", spec });
  c.part({ id: "curve", scale: 1, x: 3.1, y: 4.1 });
  const paths = parsePath(c.elements[0].d);
  expect(paths[0].start).toEqual([3, 4]);
  expect(paths[0].segs[0]).toEqual({ p: [3, 5.1046, 3.8954, 6, 5, 6], t: "C" });
  const doc = c.toJSON();
  expect(Canvas.fromJSON(doc, [part], spec).toSVG()).toBe(c.toSVG());
  expect(run(programFromDoc(doc), [part], { spec }).canvas.toSVG()).toBe(
    c.toSVG()
  );
  const legacy = new Canvas([part], {
    finish: "filled",
    spec: { ...SPEC, partGeometry: "grid" },
  });
  legacy.part({ id: "curve", x: 3, y: 4 });
  expect(legacy.toSVG()).not.toBe(c.toSVG());
});

test("trim preserves outlined curves, removes the cutter and replays as strokes", async () => {
  const r = run(
    "icon trimmed\nfinish outlined\nrect 3,3 18x18 r3\nrect 12,12 12x12 r1\ntrim"
  );
  expect(r.errors).toEqual([]);
  expect(r.canvas.elements).toHaveLength(1);
  expect(parsePath(r.canvas.elements[0].d).some((p) => !p.closed)).toBe(true);
  expect(r.canvas.elements[0].d).toMatch(/[cC]/u);
  const doc = r.canvas.toJSON();
  expect(run(programFromDoc(doc)).canvas.toSVG()).toBe(r.canvas.toSVG());
  expect(Canvas.fromJSON(doc).toSVG()).toBe(r.canvas.toSVG());
  expect(() => Canvas.fromJSON({ ...doc, finish: "filled" })).toThrow(
    "Trim requires outlined"
  );
  const { data, info } = await sharp(Buffer.from(r.canvas.toSVG()))
    .resize(240, 240)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const alpha = (x: number, y: number) =>
    data[(y * info.width + x) * info.channels + 3];
  expect(alpha(30, 120)).toBeGreaterThan(200);
  expect(alpha(210, 180)).toBe(0);
  expect(alpha(120, 180)).toBe(0);
  const open = combinePaths(
    "trim",
    { d: "M2 12C5 2 19 2 22 12" },
    { d: "M10 0H14V24H10Z" }
  );
  expect(parsePath(open)).toHaveLength(2);
});

test("a square Boolean cutter keeps its explicit zero radius on replay", () => {
  const r = filled(
    "circle 12,12 r4\nhole circle 12,12 r2\nrect 9,13 6x3 r0\nsubtract"
  );
  expect(r.errors).toEqual([]);
  const program = programFromDoc(r.canvas.toJSON());
  expect(program).toContain("6x3 r0");
  expect(run(program).canvas.toSVG()).toBe(r.canvas.toSVG());
});

test("holes appended after union stay transparent through further composition and replay", async () => {
  const source =
    "rect 3,3 12x18 r2\nrect 9,3 12x18 r2\nunion\nhole circle 12,12 r3";
  await Promise.all(
    ["", "\nrect 19,5 3x14 r1\nunion"].map(async (suffix) => {
      const result = filled(source + suffix);
      expect(result.errors).toEqual([]);
      const svg = result.canvas.toSVG();
      const { data, info } = await sharp(Buffer.from(svg))
        .resize(240, 240)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      expect(data[(120 * info.width + 120) * info.channels + 3]).toBe(0);
      expect(data[(120 * info.width + 50) * info.channels + 3]).toBeGreaterThan(
        200
      );
      const doc = result.canvas.toJSON();
      expect(Canvas.fromJSON(doc).toSVG()).toBe(svg);
      expect(run(programFromDoc(doc)).canvas.toSVG()).toBe(svg);
    })
  );
});

test.each([16, 24, 48])(
  "hole line matches a continuous negative stroke at %ipx",
  async (size) => {
    const r = filled("circle 12,12 r10\nhole line 6,12 10,16 18,8");
    expect(r.errors).toEqual([]);
    // Independent mask oracle removes one continuous stroke, without Booleans.
    const oracle = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><defs><mask id="cut"><rect width="24" height="24" fill="white"/><path d="M6 12L10 16L18 8" fill="none" stroke="black" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></mask></defs><circle cx="12" cy="12" r="10" mask="url(#cut)"/></svg>`;
    const pixels = (svg: string) =>
      sharp(Buffer.from(svg)).resize(size, size).ensureAlpha().raw().toBuffer();
    const actual = await pixels(r.canvas.toSVG());
    const expected = await pixels(oracle);
    const alphaErrors = [...actual]
      .filter((_, i) => i % 4 === 3)
      .map((a, i) => Math.abs(a - expected[i * 4 + 3]));
    expect(Math.max(...alphaErrors)).toBeLessThan(12);
    const doc = r.canvas.toJSON();
    expect(Canvas.fromJSON(doc).toSVG()).toBe(r.canvas.toSVG());
    expect(run(programFromDoc(doc)).canvas.toSVG()).toBe(r.canvas.toSVG());
  }
);

test.each([
  "rect 2,2 20x20 r3",
  "rect 2,2 12x20 r3\nrect 10,2 12x20 r3\nunion",
])(
  "overlapping and duplicate holes subtract monotonically from %s",
  async (base) => {
    const source = `${base}\nhole circle 10,12 r4\nhole circle 14,12 r4`;
    const pixel = (program: string) =>
      sharp(Buffer.from(filled(program).canvas.toSVG()))
        .resize(240, 240)
        .ensureAlpha()
        .raw()
        .toBuffer();
    const actual = await pixel(source);
    expect(actual[(120 * 240 + 120) * 4 + 3]).toBe(0);
    expect(await pixel(`${source}\nhole circle 10,12 r4`)).toEqual(actual);
    const nested = filled(`${source}\nrect 19,5 3x14 r1\nunion`);
    expect(nested.errors).toEqual([]);
    const doc = nested.canvas.toJSON();
    expect(run(programFromDoc(doc)).canvas.toSVG()).toBe(nested.canvas.toSVG());
    const nestedPixels = await pixel(`${source}\nrect 19,5 3x14 r1\nunion`);
    expect(nestedPixels[(120 * 240 + 120) * 4 + 3]).toBe(0);
  }
);

test("cutters outside a curved silhouette cannot add ink or inflate fitted bounds", async () => {
  const r = filled("circle 12,12 r8\nhole rect 15,5 5x14 r0");
  const { data, info } = await sharp(Buffer.from(r.canvas.toSVG()))
    .resize(240, 240)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  expect(data[(55 * info.width + 195) * info.channels + 3]).toBe(0);
  const clipped = filled("rect 4,4 16x16 r0\nhole rect 12,0 12x24 r0");
  expect(clipped.errors).toEqual([]);
  expect(clipped.canvas.visualBbox()).toMatchObject({
    x0: 4,
    x1: 12,
    y0: 4,
    y1: 20,
  });
  expect(clipped.canvas.skeletonBbox()).toMatchObject({
    x0: 4,
    x1: 12,
    y0: 4,
    y1: 20,
  });
});

test("a covering hole produces empty ink with no inverted silhouette", () => {
  const r = filled("circle 12,12 r4\nhole rect 0,0 24x24 r0");
  expect(r.errors).toEqual([]);
  expect(r.canvas.toSVG()).toContain('d=""');
  expect(r.canvas.visualBbox()).toBeNull();
});

test("trim preserves disjoint compound contours and removes contained contours", () => {
  const result = combinePaths(
    "trim",
    { d: "M2 2L6 2M12 12L18 12" },
    { d: "M10 10H20V20H10Z" }
  );
  expect(parsePath(result)).toHaveLength(1);
  expect(bbox(parsePath(result))).toMatchObject({ x0: 2, x1: 6, y0: 2, y1: 2 });
});
