/**
 * Twin construction: one skeleton, two paints, matching visual extent.
 */
import { expect, test } from "vitest";

import type { Finish } from "../types.js";
import { run } from "./dsl.js";
import {
  frame,
  hbar,
  mass,
  program,
  ring,
  sameExtent,
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

test("sameExtent is false when sizes differ by more than 0.01", () => {
  expect(sameExtent(sized(18, 18, 0), sized(18.02, 18, 0))).toBe(false);
});
