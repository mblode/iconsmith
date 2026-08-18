import { expect, test } from "vitest";

import {
  bbox,
  parsePath,
  points,
  q,
  rotateQuarter,
  scale,
  serialise,
  translate,
} from "./path.js";

const expect_eq = (a: unknown, b: unknown, _m?: string) =>
  expect(a).toStrictEqual(b);
const expect_ok = (a: unknown, m?: string) => expect(a, m).toBeTruthy();

test("parses absolute lines into one open subpath", () => {
  const sp = parsePath("M9 13.75L11 15.5L14.5 10.5");
  expect_eq(sp.length, 1);
  expect_eq(sp[0].closed, false);
  expect_eq(sp[0].segs.length, 2);
});

test("relative commands resolve to absolute", () => {
  const a = parsePath("M10 10l5 0l0 5");
  const b = parsePath("M10 10L15 10L15 15");
  expect_eq(serialise(a), serialise(b));
});

test("H and V expand to lines", () => {
  expect_eq(serialise(parsePath("M0 0H10V10")), "M0 0L10 0L10 10");
});

test("Z closes and a following M starts a new subpath", () => {
  const sp = parsePath("M0 0L10 0L10 10ZM20 20L30 20");
  expect_eq(sp.length, 2);
  expect_eq(sp[0].closed, true);
  expect_eq(sp[1].closed, false);
});

test("quadratics are elevated to cubics", () => {
  const sp = parsePath("M0 0Q5 10 10 0");
  expect_eq(sp[0].segs[0].t, "C");
  // A quadratic's cubic control points sit 2/3 of the way to the quad control.
  expect_eq(
    sp[0].segs[0].p.slice(0, 4).map((n) => +n.toFixed(4)),
    [3.3333, 6.6667, 6.6667, 6.6667]
  );
});

test("bbox solves cubic extrema rather than hulling control points", () => {
  // Control points reach y=10, but the curve itself only reaches y=7.5.
  const b = bbox(parsePath("M0 0C0 10 10 10 10 0"));
  expect_eq(+b.y1.toFixed(4), 7.5);
  expect_eq(b.x0, 0);
  expect_eq(b.x1, 10);
});

test("bbox of a circle-like path is tight on all four sides", () => {
  const k = 0.5523;
  const d = `M12 2C${12 + 10 * k} 2 22 ${12 - 10 * k} 22 12C22 ${12 + 10 * k} ${12 + 10 * k} 22 12 22C${12 - 10 * k} 22 2 ${12 + 10 * k} 2 12C2 ${12 - 10 * k} ${12 - 10 * k} 2 12 2Z`;
  const b = bbox(parsePath(d));
  for (const v of [b.x0, b.y0]) {
    expect_ok(Math.abs(v - 2) < 0.01, `expected ~2, got ${v}`);
  }
  for (const v of [b.x1, b.y1]) {
    expect_ok(Math.abs(v - 22) < 0.01, `expected ~22, got ${v}`);
  }
});

test("translate then translate back is identity", () => {
  const [sp] = parsePath("M1 2C3 4 5 6 7 8Z");
  expect_eq(
    serialise([translate(translate(sp, 5, -3), -5, 3)]),
    serialise([sp])
  );
});

test("scale about a point leaves that point fixed", () => {
  const [sp] = parsePath("M10 10L20 20");
  const s = scale(sp, 2, 10, 10);
  expect_eq(s.start, [10, 10]);
  expect_eq(s.segs[0].p, [30, 30]);
});

test("quantise snaps to the sub-grid and kills negative zero", () => {
  expect_eq(q(13.7503), 13.75);
  expect_eq(q(0.1), 0);
  expect_eq(Object.is(q(-0.05), -0), false);
});

test("points returns start plus every segment point", () => {
  expect_eq(points(parsePath("M0 0L1 1C2 2 3 3 4 4")[0]).length, 1 + 1 + 3);
});

test("arcs survive parsing without approximation", () => {
  const sp = parsePath("M0 0A5 5 0 0 1 10 0");
  expect_eq(sp[0].segs[0].t, "A");
  expect_eq(sp[0].segs[0].p, [5, 5, 0, 0, 1, 10, 0]);
});

test("a quarter-turn is exact, and four of them are the identity", () => {
  const [sp] = parsePath("M1 2L5 2C6 2 7 3 7 4L7 8");
  const cw = rotateQuarter(sp, 1);
  // Clockwise in y-down space: the start (1,2) goes to (-2,1).
  expect(cw.start).toStrictEqual([-2, 1]);
  const b = bbox([cw]);
  const before = bbox([sp]);
  expect([b.w, b.h]).toStrictEqual([before.h, before.w]);
  expect(serialise([rotateQuarter(sp, 4)])).toBe(serialise([sp]));
});

test("a turned arc turns its own axis with it", () => {
  const [sp] = parsePath("M0 0A3 2 10 0 1 4 4");
  const [seg] = rotateQuarter(sp, 1).segs;
  if (seg.t !== "A") {
    throw new Error("expected an arc");
  }
  // Radii and sweep are untouched by a rotation; the x-axis rotation is not.
  expect(seg.p).toStrictEqual([3, 2, 100, 0, 1, -4, 4]);
});
