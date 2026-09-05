/** Circular fillets for compiler-owned polyline corners. No grid snapping here. */
type Point = [number, number];
const EPS = 1e-8;
const distance = (a: Point, b: Point) => Math.hypot(b[0] - a[0], b[1] - a[1]);
const fmt = (n: number) => String(Number(n.toFixed(6)));
const pair = (p: Point) => `${fmt(p[0])} ${fmt(p[1])}`;

/** Repeated first/last vertex closes the contour. Reject overlapping fillets. */
export const roundedLinePath = (input: Point[], radius: number): string => {
  if (
    !Number.isFinite(radius) ||
    radius <= 0 ||
    input.some((p) => p.some((n) => !Number.isFinite(n)))
  ) {
    throw new Error("Rounded line needs finite vertices and a positive radius");
  }
  const last = input.at(-1);
  const closed =
    input.length > 2 && last !== undefined && distance(input[0], last) < EPS;
  const points = closed ? input.slice(0, -1) : input;
  if (points.length < 3) {
    throw new Error("Rounded line needs at least three distinct vertices");
  }
  const n = points.length;
  const lengths = points.map((p, i) =>
    !closed && i === n - 1 ? Infinity : distance(p, points[(i + 1) % n])
  );
  if (lengths.some((v) => v < EPS)) {
    throw new Error("Rounded line has a zero-length edge");
  }
  const corners = points.map((p, i) => {
    if (!closed && (i === 0 || i === n - 1)) {
      return { curves: "", entry: p, exit: p, trim: 0 };
    }
    const prev = points[(i + n - 1) % n];
    const next = points[(i + 1) % n];
    const before = lengths[(i + n - 1) % n];
    const after = lengths[i];
    const u: Point = [(p[0] - prev[0]) / before, (p[1] - prev[1]) / before];
    const v: Point = [(next[0] - p[0]) / after, (next[1] - p[1]) / after];
    const turn = Math.atan2(
      u[0] * v[1] - u[1] * v[0],
      u[0] * v[0] + u[1] * v[1]
    );
    if (Math.PI - Math.abs(turn) < EPS) {
      throw new Error("Rounded line cannot reverse direction at a vertex");
    }
    if (Math.abs(turn) < EPS) {
      return { curves: "", entry: p, exit: p, trim: 0 };
    }
    const trim = radius * Math.tan(Math.abs(turn) / 2);
    const entry: Point = [p[0] - u[0] * trim, p[1] - u[1] * trim];
    const exit: Point = [p[0] + v[0] * trim, p[1] + v[1] * trim];
    const sign = Math.sign(turn);
    const centre: Point = [
      entry[0] - u[1] * radius * sign,
      entry[1] + u[0] * radius * sign,
    ];
    const start = Math.atan2(entry[1] - centre[1], entry[0] - centre[0]);
    const count = Math.ceil(Math.abs(turn) / (Math.PI / 2)),
      step = turn / count;
    let curves = "";
    for (let j = 0; j < count; j += 1) {
      const a = start + j * step,
        b = a + step,
        k = (4 / 3) * Math.tan(step / 4);
      const p0: Point = [
        centre[0] + radius * Math.cos(a),
        centre[1] + radius * Math.sin(a),
      ];
      const p1: Point =
        j === count - 1
          ? exit
          : [
              centre[0] + radius * Math.cos(b),
              centre[1] + radius * Math.sin(b),
            ];
      const c0: Point = [
        p0[0] - k * radius * Math.sin(a),
        p0[1] + k * radius * Math.cos(a),
      ];
      const c1: Point = [
        p1[0] + k * radius * Math.sin(b),
        p1[1] - k * radius * Math.cos(b),
      ];
      curves += `C${pair(c0)} ${pair(c1)} ${pair(p1)}`;
    }
    return { curves, entry, exit, trim };
  });
  for (let i = 0; i < (closed ? n : n - 1); i += 1) {
    if (corners[i].trim + corners[(i + 1) % n].trim > lengths[i] + EPS) {
      throw new Error(
        "Rounded line radius does not fit adjacent edges; choose a smaller tier or lengthen the edges"
      );
    }
  }
  let d = `M${pair(corners[0].entry)}${corners[0].curves}`;
  for (let i = 1; i < n; i += 1) {
    d += `L${pair(corners[i].entry)}${corners[i].curves}`;
  }
  return closed ? `${d}Z` : d;
};
