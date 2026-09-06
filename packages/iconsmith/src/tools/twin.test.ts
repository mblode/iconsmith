/**
 * Twin construction: one skeleton, two paints, matching visual extent.
 */
import { expect, test } from "vitest";

import type { Finish, Part } from "../types.js";
import { run } from "./dsl.js";
import {
  adaptProgram,
  frame,
  hbar,
  lozenge,
  mass,
  program,
  programFromDoc,
  ring,
  sameExtent,
  twinPairIssues,
  vbar,
  visualSize,
} from "./twin.js";

const draw = (finish: Finish, ops: string[]) => {
  const drawn = run([`finish ${finish}`, ...ops].join("\n"));
  expect(drawn.errors).toEqual([]);
  return drawn.canvas;
};

const box = (finish: Finish): string[] => [
  hbar(finish, 4, 4, 16),
  vbar(finish, 20, 4, 16),
  hbar(finish, 4, 20, 16),
  vbar(finish, 4, 4, 16),
];

test("hbar / vbar twins occupy the same visual extent", () => {
  expect(
    sameExtent(draw("outlined", box("outlined")), draw("filled", box("filled")))
  ).toBe(true);
});

test("a lone hbar occupies the same visual extent (a closed box cannot hide the caps)", () => {
  expect(
    sameExtent(
      draw("outlined", [hbar("outlined", 7, 12, 10)]),
      draw("filled", [hbar("filled", 7, 12, 10)])
    )
  ).toBe(true);
  expect(hbar("filled", 7, 12, 10)).toBe("rect 6,11 12x2");
  expect(
    sameExtent(
      draw("outlined", [vbar("outlined", 12, 7, 10)]),
      draw("filled", [vbar("filled", 12, 7, 10)])
    )
  ).toBe(true);
});

test("mass expands a closed stroke so the filled outer edge is the outlined ink", () => {
  expect(
    sameExtent(
      draw("outlined", [mass("outlined", 4, 10, 16, 4, 2)]),
      draw("filled", [mass("filled", 4, 10, 16, 4, 2)])
    )
  ).toBe(true);
  expect(mass("filled", 4, 10, 16, 4, 2)).toBe("rect 3,9 18x6 r3");
});

test("ring twins occupy the same visual extent, as circle plus hole", () => {
  const outlined = ring("outlined", 12, 12, 8);
  const filled = ring("filled", 12, 12, 8);
  expect(sameExtent(draw("outlined", outlined), draw("filled", filled))).toBe(
    true
  );
  const filledSrc = filled.join("\n");
  expect(filledSrc).toContain("hole circle");
  expect(filledSrc.split("\n").some((line) => line.startsWith("line "))).toBe(
    false
  );
  const outlinedSrc = outlined.join("\n");
  expect(outlinedSrc).toContain("circle");
  expect(outlinedSrc).not.toContain("hole");
});

test("frame twins occupy the same visual extent, with a hole rect when filled", () => {
  const outlined = frame("outlined", 4, 4, 16, 16, 2);
  const filled = frame("filled", 4, 4, 16, 16, 2);
  expect(sameExtent(draw("outlined", outlined), draw("filled", filled))).toBe(
    true
  );
  expect(filled.join("\n")).toContain("hole rect");
});

test("a filled program declares finish before geometry and never writes a line", () => {
  const src = program("bar", "filled", "square", [hbar("filled", 6, 12, 12)]);
  const finishAt = src.indexOf("finish filled");
  const geomAt = src.search(/^rect /mu);
  expect(finishAt).toBeGreaterThanOrEqual(0);
  expect(geomAt).toBeGreaterThan(finishAt);
  expect(src.split("\n").some((line) => line.startsWith("line "))).toBe(false);
});

test("program omits keyline and fit when the drawing does not occupy a box", () => {
  const src = program("bar", "filled", null, [hbar("filled", 6, 12, 12)]);
  expect(src).not.toContain("keyline");
  expect(src).not.toContain("fit");
  expect(src).toContain("finish filled");
});

test("visualSize is bbox + inkWidth: 18 when filled, 20 when outlined", () => {
  expect(visualSize(draw("filled", ["rect 3,3 18x18 r0"]))).toEqual({
    h: 18,
    w: 18,
  });
  expect(visualSize(draw("outlined", ["rect 3,3 18x18 r0"]))).toEqual({
    h: 20,
    w: 20,
  });
});

const sized = (w: number, h: number, inkWidth: number) => ({
  bbox: () => ({ h, w }),
  inkWidth,
});

/**
 * 0.01 was equality, not tolerance: it errored on 178 of the 2,085 house
 * pairs (91.46% pass) where 0.5 errors on 53 (97.46%), and max-axis |delta|
 * is p90 0.004 — so the whole 0.01–0.5 band is quantiser noise, 125 pairs of
 * it. Beyond half a unit a paint has missed the extent, and still fails.
 */
test("sameExtent allows half a unit per axis, and nothing past it", () => {
  expect(sameExtent(sized(18, 18, 0), sized(18.02, 18, 0))).toBe(true);
  expect(sameExtent(sized(18, 18, 0), sized(18.5, 18, 0))).toBe(true);
  expect(sameExtent(sized(18, 18, 0), sized(18.51, 18, 0))).toBe(false);
  expect(sameExtent(sized(18, 18, 0), sized(18, 18.6, 0))).toBe(false);
  // A disc restamping a stroked ring loses a whole stroke, four times the tol.
  expect(sameExtent(sized(16, 16, 2), sized(16, 16, 0))).toBe(false);
});

const paint = (w: number, h: number, inkWidth: number, finish: Finish) => ({
  bbox: () => ({ h, w }),
  elements: [{ d: `M2 2H${2 + w}V${2 + h}H2Z`, id: "box" }],
  finish,
  inkWidth,
});

/** One tolerance, not two: the pair path must not restate a stricter number. */
test("twinPairIssues pairs at sameExtent's tolerance", () => {
  const extents = (filledW: number) =>
    twinPairIssues(
      paint(18, 18, 2, "outlined"),
      paint(filledW, 20, 0, "filled")
    ).filter((issue) => issue.rule === "extent");
  expect(extents(19.5)).toEqual([]);
  expect(extents(19.4)).toHaveLength(1);
});

test("a lozenge is a 45° diamond in both paints", () => {
  expect(lozenge("outlined", 12, 12, 5)).toEqual(["diamond 12,12 r5"]);
  expect(lozenge("filled", 12, 12, 5)).toEqual(["diamond 12,12 r5"]);
  expect(
    sameExtent(
      draw("outlined", lozenge("outlined", 12, 12, 5)),
      draw("filled", lozenge("filled", 12, 12, 5))
    )
  ).toBe(true);
});

test("adaptProgram splits a closed polyline so filled bars can run", () => {
  const outlined = [
    "icon diamond",
    "finish outlined",
    "line 12,7 17,12 12,17 7,12 12,7",
  ].join("\n");
  const filled = adaptProgram(outlined, "filled");
  expect(filled).toContain("finish filled");
  expect(filled.split("\n").filter((l) => l.startsWith("line "))).toHaveLength(
    4
  );
  const drawn = run(filled);
  expect(drawn.errors).toEqual([]);
});

const HOOP = [
  "icon hoop",
  "keyline circle",
  "finish outlined",
  "circle 12,12 r9",
].join("\n");

/** The bug this rules out is a black disc where a ring belongs: relabelling
 *  the finish leaves `circle` meaning "solid" and swallows the interior. */
test("adaptProgram punches a stroked circle into a ring, not a solid disc", () => {
  const filled = adaptProgram(HOOP, "filled");
  expect(filled).toContain("circle 12,12 r10");
  expect(filled).toContain("hole circle 12,12 r8");
  const drawn = run(filled);
  expect(drawn.errors).toEqual([]);
  const knockouts = drawn.canvas.elements.filter((e) => e.op === "knockout");
  expect(knockouts).toHaveLength(1);
  // Two subpaths in one `<path>` under evenodd is what makes the hole a hole.
  expect(drawn.canvas.toSVG().match(/<path/gu)).toHaveLength(1);
});

test("adaptProgram punches a stroked rect into a frame, not a slab", () => {
  const filled = adaptProgram(
    ["icon card", "finish outlined", "rect 3,7.5 18x11 r2"].join("\n"),
    "filled"
  );
  expect(filled).toContain("rect 2,6.5 20x13 r3");
  expect(filled).toContain("hole rect 4,8.5 16x9 r1");
});

test("adaptProgram treats a rect with no radius as r2, matching the DSL default", () => {
  // `dsl.ts`'s rectArgs defaults an absent radius to 2, so `rect …` and
  // `rect … r2` are the same drawing. The adapter used to read a missing token
  // as "no radius" and emit none, so the twin replayed a tier off — outer too
  // tight, hole too round. The two spellings must adapt identically.
  const body = "icon card\nfinish outlined\nrect 3,7.5 18x11";
  expect(adaptProgram(body, "filled")).toBe(
    adaptProgram(`${body} r2`, "filled")
  );
  expect(adaptProgram(body, "filled")).toContain("rect 2,6.5 20x13 r3");
});

/** A circle no wider than the stroke has no hole to knock out: its own ink
 *  closes it. Emitting one would be refused as a hole outside its solid. */
test("adaptProgram leaves a stroke-width circle solid", () => {
  const filled = adaptProgram(
    ["icon pip", "finish outlined", "circle 12,12 r1"].join("\n"),
    "filled"
  );
  expect(filled).toContain("circle 12,12 r2");
  expect(filled).not.toContain("hole");
});

test("both paints of an adapted program occupy the same visual extent", () => {
  for (const ops of [
    "circle 12,12 r9",
    "rect 3,7.5 18x11 r2",
    "diamond 12,12 r5",
    "dot 12,12 floating",
  ]) {
    const outlined = ["icon x", "finish outlined", ops].join("\n");
    const filled = adaptProgram(outlined, "filled");
    const drawn = run(filled);
    expect(drawn.errors, ops).toEqual([]);
    expect(sameExtent(run(outlined).canvas, drawn.canvas), ops).toBe(true);
  }
});

test("a filled arc includes the round caps of its outlined stroke", () => {
  const outlined = [
    "icon x",
    "finish outlined",
    "arc 12,14 r9 half from left",
  ].join("\n");
  const filled = adaptProgram(outlined, "filled");
  expect(filled).toContain("arc 12,14 r9 half from left");
  const drawn = run(filled);
  expect(drawn.errors).toEqual([]);
  expect(visualSize(drawn.canvas).h).toBeCloseTo(11, 6);
  expect(visualSize(drawn.canvas).w).toBeCloseTo(20, 6);
  expect(visualSize(run(outlined).canvas).h).toBeCloseTo(11, 6);
});

/** The derivation is invertible on the closed primitives, which is the
 *  property that says it is a re-paint and not a reshape. */
test("adaptProgram round-trips a ring and a frame back to their centre lines", () => {
  for (const ops of ["circle 12,12 r9", "rect 3,7.5 18x11 r2"]) {
    const outlined = ["icon x", "finish outlined", ops].join("\n");
    expect(adaptProgram(adaptProgram(outlined, "filled"), "outlined")).toBe(
      outlined
    );
  }
});

test("twinPairIssues is quiet on a ring that occupies one extent", () => {
  const outlined = draw("outlined", ring("outlined", 12, 12, 8));
  const filled = draw("filled", ring("filled", 12, 12, 8));
  expect(twinPairIssues(outlined, filled)).toEqual([]);
});

test("twinPairIssues fails a filled disc that restamps a stroked ring", () => {
  const outlined = draw("outlined", ring("outlined", 12, 12, 8));
  const filled = draw("filled", ["circle 12,12 r8"]);
  const issues = twinPairIssues(outlined, filled);
  expect(issues.some((issue) => issue.rule === "extent")).toBe(true);
  expect(issues.find((issue) => issue.rule === "extent")?.severity).toBe(
    "error"
  );
  expect(issues.some((issue) => issue.rule === "paint")).toBe(true);
});

test("twinPairIssues is quiet on overlapping discs that are a cloud", () => {
  const outlined = draw("outlined", [
    "circle 8,12 r5",
    "circle 16,12 r5",
    "circle 12,9 r5.5",
  ]);
  const filled = draw("filled", [
    "circle 8,12 r5",
    "circle 16,12 r5",
    "circle 12,9 r6",
  ]);
  expect(
    twinPairIssues(outlined, filled).some((issue) => issue.rule === "paint")
  ).toBe(false);
});

test("twinPairIssues still sees a restamp after fit to the same keyline", () => {
  const outlined = run(
    [
      "icon hoop",
      "keyline circle",
      "finish outlined",
      "circle 12,12 r8",
      "fit",
    ].join("\n")
  ).canvas;
  const filled = run(
    [
      "icon hoop",
      "keyline circle",
      "finish filled",
      "circle 12,12 r8",
      "fit",
    ].join("\n")
  ).canvas;
  const issues = twinPairIssues(outlined, filled);
  expect(issues.some((issue) => issue.rule === "paint")).toBe(true);
  expect(issues.find((issue) => issue.rule === "paint")?.message).toContain(
    "fit"
  );
});

test("twinPairIssues fails a finish-stamped outline posing as filled", () => {
  const outlined = draw("outlined", ring("outlined", 12, 12, 8));
  const issues = twinPairIssues(outlined, outlined);
  expect(issues.some((issue) => issue.rule === "finish")).toBe(true);
});

test("twinPairIssues fails an empty paint", () => {
  const outlined = draw("outlined", ring("outlined", 12, 12, 8));
  const empty = {
    bbox: () => null,
    elements: [],
    finish: "filled" as const,
    inkWidth: 0,
  };
  expect(
    twinPairIssues(outlined, empty).some((issue) => issue.rule === "empty")
  ).toBe(true);
});

test("adaptProgram leaves an op it does not model untouched", () => {
  const outlined = [
    "icon parted",
    "finish outlined",
    "part folder at 4,4 size 16",
    "# a note",
  ].join("\n");
  const filled = adaptProgram(outlined, "filled");
  expect(filled).toContain("part folder at 4,4 size 16");
  expect(filled).toContain("# a note");
});

test("programFromDoc writes the paint the canvas already ran", () => {
  const outlined = draw("outlined", ["circle 12,12 r8"]);
  const source = programFromDoc(
    outlined.toJSON({ icon: "ring", keyline: "circle" })
  );
  expect(source).toContain("icon ring");
  expect(source).toContain("keyline circle");
  expect(source).toContain("finish outlined");
  expect(source).toContain("circle 12,12 r8");
  const filled = draw("filled", ["circle 12,12 r9", "hole circle 12,12 r7"]);
  expect(programFromDoc(filled.toJSON({ icon: "ring" }))).toContain(
    "hole circle 12,12 r7"
  );
});

test("programFromDoc emits a scaled part's multiplier, so it round-trips", () => {
  // `scale` is the document's exact multiplier and therefore replays without
  // consulting the vocabulary for a target span. A quarter turn still changes
  // the part's painted extent, but it does not change that multiplier.
  const part: Part = {
    closed: true,
    d: "M0 0H8V4H0Z",
    h: 4,
    icons: ["tab"],
    id: "tab",
    instances: 1,
    name: "tab",
    nodes: 4,
    sizeRange: [8, 8],
    w: 8,
  };
  for (const line of [
    "part tab at 4,4 size 16",
    "part tab at 4,4 size 16 turn cw",
  ]) {
    const doc = run(`icon x\n${line}\n`, [part]).canvas.toJSON({ icon: "x" });
    const emitted = programFromDoc(doc, [part]);
    expect(emitted).toContain(
      `part tab at 4,4 scale 2${line.endsWith("turn cw") ? " turn cw" : ""}`
    );
    const replayed = run(emitted, [part]).canvas.toJSON({ icon: "x" });
    expect(replayed).toStrictEqual(doc);
  }
});

test("a derived filled twin meets itself at every joint", () => {
  // `line` snaps each vertex against the previous *snapped* one, so a polyline
  // is a chain. Splitting the source text gave every bar the raw coordinate
  // and let it re-snap from its own start: this dart's third vertex is
  // `13.5,12.5` in the stroked paint, and the filled twin used to put its
  // third bar's start back at `13,12`. Nothing looked for the gap, because the
  // bounding box is set by the outer vertices and those agreed.
  const outlined = program("dart", "outlined", "wide", [
    "line 4,12 20,6 13,12 20,18 4,12 off-axis",
  ]);
  const stroked = run(outlined);
  const twin = run(adaptProgram(outlined, "filled"));

  const [chain] = stroked.canvas.elements;
  if (chain.kind !== "line") {
    throw new Error("expected the stroked paint to be one polyline");
  }
  const bars = twin.canvas.elements.map((el) => {
    if (el.kind !== "line") {
      throw new Error("expected every filled bar to keep its line op");
    }
    return el.points;
  });

  expect(bars).toHaveLength(chain.points.length - 1);
  for (const [i, bar] of bars.entries()) {
    expect(
      bar[0],
      `bar ${i} starts where the stroked paint does`
    ).toStrictEqual(chain.points[i]);
    expect(bar[1], `bar ${i} ends where the stroked paint does`).toStrictEqual(
      chain.points[i + 1]
    );
  }
  expect(visualSize(twin.canvas)).toStrictEqual(visualSize(stroked.canvas));
});

test("a filled diagonal survives its own program", () => {
  // `raw` has no DSL word, so `programFromDoc` dropped it and the saved
  // `.icon` stopped being the drawing — the reason one campaign pair shipped
  // as `filled.icon.partial` with both arrowhead segments missing.
  const source = program("arrow", "filled", "square", [
    "line 12,7 15,4 off-axis",
  ]);
  const drawn = run(source);
  const doc = drawn.canvas.toJSON({ icon: "arrow", keyline: "square" });
  expect(doc.draw.some((op) => op.op === "raw")).toBe(false);
  const replay = run(programFromDoc(doc));
  expect(replay.canvas.toSVG()).toBe(drawn.canvas.toSVG());
});

test("a filled droplet keeps its point in its own program", () => {
  // The `droplet` run drew a round base and a diamond for the point, and the
  // diamond took the `raw` escape. `programFromDoc` drops `raw`, so the saved
  // program held only the circle — which then paired as a bare disc against a
  // bare ring and tripped the restamp rule too. Two failures, one missing op,
  // on a pair the judge had scored 10/10 on all four numbers.
  const source = program("droplet", "filled", "tall", [
    "circle 12,15 r6",
    "diamond 12,11 r5",
  ]);
  const drawn = run(source);
  expect(drawn.errors).toStrictEqual([]);
  const doc = drawn.canvas.toJSON({ icon: "droplet", keyline: "tall" });
  expect(doc.draw.some((op) => op.op === "raw")).toBe(false);
  expect(programFromDoc(doc)).toContain("diamond ");
  const replay = run(programFromDoc(doc));
  expect(replay.canvas.toSVG()).toBe(drawn.canvas.toSVG());
});

test("both paints of a diamond agree on their extent after a fit", () => {
  // Stored as a polyline the stroked diamond quantised its vertices while the
  // filled lozenge quantised its radius, so a `fit` left the two paints a
  // fraction of a grid step apart and `sameExtent`, which then allowed only
  // 0.01, called it a mismatch. The tolerance is 0.5 now and would absorb it;
  // the assertion stays exact, because the fix was to the quantising.
  const outlined = program("compass", "outlined", "square", [
    "circle 12,12 r8",
    "diamond 12,12 r5",
  ]);
  const stroked = run(outlined);
  const twin = run(adaptProgram(outlined, "filled"));
  expect(visualSize(twin.canvas)).toStrictEqual(visualSize(stroked.canvas));
});
