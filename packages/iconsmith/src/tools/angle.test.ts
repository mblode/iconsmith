import { expect, test } from "vitest";

import { parsePath } from "../geometry/path.js";
import {
  angleHistogram,
  edgeAngles,
  iconEdgeAngles,
  ISOMETRIC_TOLERANCE,
  MIN_EDGE,
  offAxisEdges,
  onAxisLengthShare,
} from "./angle.js";
import { ANGLE_TOLERANCE, AXES, Canvas } from "./canvas.js";

/** Fixtures whose angles are arithmetic rather than eyeballed. */
const SQUARE = "M4 4L20 4L20 20L4 20L4 4";
/** 8 across, 8 down: exactly 45°, falling. */
const DIAGONAL = "M4 4L12 12";
/** 8 across, 8 up: 135° undirected, the rising diagonal. */
const RISING = "M4 12L12 4";
/** dx 7, dy 5.5 — `airdrop`'s beam. atan(5.5/7) = 38.157°. */
const AIRDROP = "M4 11L11 16.5";
/** dx 8, dy 4.6188 = 8·tan30: a true isometric edge. */
const ISO = "M4 4L12 8.6188";

const anglesOf = (d: string) => edgeAngles(parsePath(d)).map((e) => e.angle);

test("axis-aligned edges are 0 and 90, with nothing off-axis", () => {
  const edges = edgeAngles(parsePath(SQUARE));
  expect(edges.map((e) => e.angle)).toEqual([0, 90, 0, 90]);
  expect(edges.every((e) => e.offBy === 0)).toBe(true);
  expect(offAxisEdges(edges)).toHaveLength(0);
  expect(onAxisLengthShare(edges)).toBe(1);
});

test("both diagonals land on an axis, and are told apart", () => {
  expect(anglesOf(DIAGONAL)).toEqual([45]);
  expect(anglesOf(RISING)).toEqual([135]);
  expect(offAxisEdges(iconEdgeAngles([DIAGONAL, RISING]))).toHaveLength(0);
});

test("a near-horizontal edge is measured against 0, not against 135", () => {
  // 179° is 1° off horizontal. Measuring it as |179 - 135| would call a
  // near-perfect edge 44° out and put the worst offenders at the top of a
  // report that should be empty.
  const [edge] = edgeAngles(parsePath("M4 12L20 11.72"));
  expect(edge.angle).toBeCloseTo(179, 0);
  expect(edge.axis).toBe(0);
  expect(edge.offBy).toBeLessThan(1.1);
  expect(offAxisEdges([edge])).toHaveLength(0);
});

test("airdrop's beam is 38.2 degrees and 6.8 off the nearest axis", () => {
  const [edge] = edgeAngles(parsePath(AIRDROP));
  expect(edge.angle).toBeCloseTo(38.157, 3);
  expect(edge.axis).toBe(45);
  expect(edge.offBy).toBeCloseTo(6.843, 3);
  // Just past the canvas's 6° slop: the rule catches it, a looser one would not.
  expect(offAxisEdges([edge])).toHaveLength(1);
  expect(offAxisEdges([edge], { tolerance: 7 })).toHaveLength(0);
});

test("an isometric edge is flagged by default and exempt on request", () => {
  const [edge] = edgeAngles(parsePath(ISO));
  expect(edge.angle).toBeCloseTo(30, 3);
  expect(edge.isometric).toBe(true);
  expect(offAxisEdges([edge])).toHaveLength(1);
  expect(offAxisEdges([edge], { allowIsometric: true })).toHaveLength(0);
  // The exemption is a band, not a point: `ar-cube-1` sits at 29.36°.
  const [cube] = edgeAngles(parsePath("M4 4L11.5 8.22"));
  expect(cube.angle).toBeCloseTo(29.36, 1);
  expect(cube.isometric).toBe(true);
  // …and it is bounded. 45 - 6 = 39 is off-axis but not isometric, so an
  // isometric exemption cannot become a licence for everything diagonal.
  expect(edgeAngles(parsePath(AIRDROP))[0].isometric).toBe(false);
});

test("runs shorter than MIN_EDGE are dropped, and the run index survives", () => {
  // A long edge, then a 0.5-unit sliver at 45°, then another long edge.
  const d = "M2 12L14 12L14.5 12.5L14.5 20";
  expect(edgeAngles(parsePath(d), 10)).toHaveLength(1);
  const kept = edgeAngles(parsePath(d), MIN_EDGE);
  expect(kept).toHaveLength(2);
  // The dropped sliver still consumed index 1, so `run` points at the segment
  // in the icon rather than at a position in the filtered list.
  expect(kept.map((e) => e.run)).toEqual([0, 2]);
});

test("the histogram is length-weighted, not count-weighted", () => {
  // Two short 45° edges against one long horizontal: counts say 45 wins.
  const bins = angleHistogram(
    iconEdgeAngles(["M0 0L2 2", "M4 0L6 2", "M0 12L20 12"])
  );
  expect(bins.map((b) => b.angle)).toEqual([0, 45]);
  expect(bins[0]).toMatchObject({ count: 1, length: 20 });
  expect(bins[1].count).toBe(2);
  expect(bins[1].length).toBeCloseTo(2 * Math.SQRT2 * 2, 6);
});

test("length share weighs one long stray above several short ones", () => {
  const share = onAxisLengthShare(iconEdgeAngles([SQUARE, AIRDROP]));
  // The square's 64 units against airdrop's 8.9-unit beam.
  expect(share).toBeCloseTo(64 / (64 + Math.hypot(7, 5.5)), 6);
});

test("the canvas snaps within tolerance, exactly, after grid quantising", () => {
  // A line asked for 44.2° comes back at 45.000, not 44.9: `snapAngle` moves
  // the endpoint and `q` then puts it back on the grid, and the two agree. If
  // they did not, every canvas-drawn diagonal would sit just inside the rule.
  const c = new Canvas();
  c.line({
    points: [
      [4, 4],
      [16, 15.5],
    ],
  });
  c.rect({ h: 8, w: 8, x: 8, y: 8 });
  const edges = iconEdgeAngles(c.elements.map((e) => e.d));
  expect(edges.length).toBeGreaterThan(0);
  expect(offAxisEdges(edges)).toEqual([]);
});

test("the canvas emits an off-axis edge only when it was asked to", () => {
  // The gap this rule exists to close, and what closed it. `snapAngle` snaps
  // *within* 6°; past that the canvas now refuses unless `offAxis` is passed,
  // so an off-axis edge in new work is a decision rather than arithmetic drift.
  // Shipped icons still have to be measured, which is why the rule is not
  // import-only: this is airdrop's beam, and it is legitimate.
  const c = new Canvas();
  expect(() =>
    c.line({
      points: [
        [4, 11],
        [11, 16.5],
      ],
    })
  ).toThrow(/off the nearest axis/u);
  c.line({
    offAxis: true,
    points: [
      [4, 11],
      [11, 16.5],
    ],
  });
  const [edge] = iconEdgeAngles(c.elements.map((e) => e.d));
  expect(edge.angle).toBeCloseTo(38.157, 3);
  expect(offAxisEdges([edge])).toHaveLength(1);
});

test("the axes and tolerance are the canvas's own, not a copy", () => {
  // One definition, imported. This file used to restate both and keep a test
  // that read `canvas.ts` looking for divergence; the constants are exported
  // now, so there is nothing left to diverge.
  expect(ANGLE_TOLERANCE).toBe(6);
  expect([...AXES]).toEqual([0, 45, 90, 135]);
  // Undirected, which is the range `straightRuns` reports in.
  expect(Math.max(...AXES)).toBeLessThan(180);
});

test("ISOMETRIC_TOLERANCE stays narrower than the axis spacing", () => {
  // At 22.5 the bands would meet and every diagonal would read as isometric.
  expect(ISOMETRIC_TOLERANCE).toBeLessThan(45 / 2);
});
