import { expect, test } from "vitest";

import {
  bbox,
  mirrorX,
  parsePath,
  PathError,
  points,
  polylineDistance,
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

test("a mirror is exact, and two of them are the identity", () => {
  const [sp] = parsePath("M1 2L5 2C6 2 7 3 7 4L7 8");
  const m = mirrorX(sp);
  expect(m.start).toStrictEqual([-1, 2]);
  const b = bbox([m]);
  const before = bbox([sp]);
  // A reflection swaps left for right and leaves the extent alone.
  expect([b.w, b.h]).toStrictEqual([before.w, before.h]);
  expect(serialise([mirrorX(m)])).toBe(serialise([sp]));
});

test("a mirrored arc inverts its sweep", () => {
  const [sp] = parsePath("M0 0A3 2 10 0 1 4 4");
  const [seg] = mirrorX(sp).segs;
  if (seg.t !== "A") {
    throw new Error("expected an arc");
  }
  // Reflection reverses orientation, so the sweep flag has to invert and the
  // x-axis rotation negate; the radii and the large-arc flag are unaffected.
  expect(seg.p).toStrictEqual([3, 2, -10, 0, 0, -4, 4]);
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

// --- Non-finite arguments ------------------------------------------------
//
// The tokeniser skips what it does not recognise, so a stray character used to
// vanish and shift every argument after it by one. `Lnan nan` read the `a` of
// each `nan` as a coordinate and produced NaN without complaint; the whole
// record store was built through this parser, so it is worth pinning down both
// that the malformed case throws and that the well-formed cases still do not.

test("a NaN coordinate is refused, naming the text and the offset", () => {
  // Verbatim from corpus/round-filled-radius-1-stroke-1.5/burger.svg, which is
  // the one file in 90,650 that ships this.
  const d = "M4 10.5Lnan nanL20.9839 10.5C21 11 21 12 21 12";
  expect(() => parsePath(d)).toThrow(PathError);
  expect(() => parsePath(d)).toThrow(/nan/u);
  expect(() => parsePath(d)).toThrow(/offset 8/u);
});

test("the error names the source file when the caller knows it", () => {
  const source = "corpus/round-filled-radius-1-stroke-1.5/burger.svg";
  try {
    parsePath("M4 10.5Lnan nan", { source });
    expect_ok(false, "should have thrown");
  } catch (error) {
    expect_ok(error instanceof PathError);
    expect((error as PathError).source).toBe(source);
    expect((error as Error).message).toContain(source);
  }
});

test("a command that runs out of arguments is refused, not read as NaN", () => {
  expect(() => parsePath("M4 10.5L20")).toThrow(/runs out of arguments/u);
});

test("a stray letter elsewhere in the data is refused too", () => {
  // Not a NaN: `x` is simply dropped by the tokeniser, and the four numbers
  // that follow then parse as two perfectly plausible lines.
  expect(() => parsePath("M0 0L1 2 x 3 4")).toThrow(PathError);
});

test("exponents, negatives and implicit repeats still parse unchanged", () => {
  // Regression guard: every measurement in the repo goes through this parser,
  // so the check above must not narrow what it accepts. `1e-3` exercises the
  // exponent branch of the token pattern, the bare pairs after `L` and `M`
  // exercise implicit repetition, and `-` doubles as a separator.
  const sp = parsePath("M-1 1e-3L2-3 4 5.5l-1-1M6 6 7 7");
  expect_eq(sp.length, 2);
  expect_eq(serialise(sp), "M-1 0.001L2 -3L4 5.5L3 4.5M6 6L7 7");
  expect_ok(
    points(sp[0]).every(([x, y]) => Number.isFinite(x) && Number.isFinite(y))
  );
});

test("a capital-E exponent parses, rather than being dropped as a stray", () => {
  // `E` cleared the illegal-character screen but was not matched by the token
  // pattern, so `1E1` read as the two tokens `1` and `1` and every argument
  // after shifted — the exact silent shift the screen exists to prevent.
  expect_eq(serialise(parsePath("M0 0L1E1 4")), "M0 0L10 4");
  // The lowercase form was always accepted; both must agree.
  expect_eq(
    serialise(parsePath("M0 0L1e1 4")),
    serialise(parsePath("M0 0L1E1 4"))
  );
});

test("a drawing command after Z opens a new subpath at the close point", () => {
  // `s.cur` is null after Z, so the segment handlers' `s.cur?.segs` used to
  // no-op and drop the geometry while the current point advanced. Per SVG a
  // command after Z begins a new subpath at the close point.
  const sp = parsePath("M0 0L10 0L10 10ZL5 5L2 2");
  expect_eq(sp.length, 2);
  expect_eq(sp[0].closed, true);
  expect_eq(sp[1].closed, false);
  expect_eq(sp[1].start, [0, 0]);
  expect_eq(sp[1].segs.length, 2);
});

test("T reflects only after a quadratic, S only after a cubic", () => {
  // One `prevCubic` flag was set by C, S, Q and T alike, so a `T` after a
  // cubic reflected the cubic's control point (a bulge) instead of taking the
  // current point. After `C … 5 0`, `T10 0` must run straight to (10,0): the
  // elevated cubic's controls sit on y=0.
  const afterCubic = parsePath("M0 0C0 5 5 5 5 0T10 0");
  expect_eq(
    afterCubic[0].segs[1].p.map((n) => +n.toFixed(4)),
    [5, 0, 6.6667, 0, 10, 0]
  );
  // A `T` after a quadratic still reflects, unchanged.
  const afterQuad = parsePath("M0 0Q5 5 10 0T20 0");
  expect_eq(
    afterQuad[0].segs[1].p.map((n) => +n.toFixed(4)),
    [13.3333, -3.3333, 16.6667, -3.3333, 20, 0]
  );
});

test("polylineDistance is segment-to-segment, not vertex-to-vertex", () => {
  // Staggered parallels: endpoints are ~4px apart, the edges sit 0.50 apart.
  expect(
    polylineDistance(
      [
        [4, 12],
        [16, 12],
      ],
      [
        [8, 12.5],
        [20, 12.5],
      ]
    )
  ).toBeCloseTo(0.5, 6);
  // Crossing segments are coincident, not an endpoint overhang.
  expect(
    polylineDistance(
      [
        [6, 6],
        [18, 18],
      ],
      [
        [6, 18],
        [18, 6],
      ]
    )
  ).toBeCloseTo(0, 6);
  expect(polylineDistance([], [[0, 0]])).toBeNull();
});
