/** Explicit fillets at operand intersections, preserving every other contour.
 * Paper owns cubic subdivision and circular arcs; no path flattening or fitting. */
import type paper from "paper";

const EPS = 1e-6;
const failure = () =>
  new Error(
    "Intersection radius does not fit; choose a smaller tier or change the operands"
  );
const cross = (a: paper.Point, b: paper.Point) => a.x * b.y - a.y * b.x;

interface CurveRun {
  length: number;
  getTangentAtTime: (time: number) => paper.Point;
  getPointAtTime: (time: number) => paper.Point;
  getTimeAt: (offset: number) => number;
}

const tangentCircle = (before: CurveRun, after: CurveRun, radius: number) => {
  const u = before.getTangentAtTime(1);
  const v = after.getTangentAtTime(0);
  const turn = Math.atan2(cross(u, v), u.dot(v));
  if (Math.abs(turn) < EPS) {
    return null;
  }
  if (Math.abs(turn) > Math.PI - EPS) {
    throw failure();
  }
  const side = Math.sign(turn);
  const trim = radius * Math.tan(Math.abs(turn) / 2);
  if (trim >= Math.min(before.length, after.length)) {
    throw failure();
  }
  let t = before.getTimeAt(before.length - trim);
  let s = after.getTimeAt(trim);
  const centre = (curve: CurveRun, time: number) => {
    const tangent = curve.getTangentAtTime(time);
    return curve
      .getPointAtTime(time)
      .add(tangent.rotate(90, tangent.multiply(0)).multiply(radius * side));
  };
  // Solve equality of the two offset curves. A damped Newton step keeps both
  // tangencies on the original adjacent cubics, never their extrapolations.
  for (let iteration = 0; iteration < 40; iteration += 1) {
    const a = centre(before, t),
      b = centre(after, s),
      delta = a.subtract(b);
    if (delta.length < 1e-8) {
      const start = before.getPointAtTime(t);
      const end = after.getPointAtTime(s);
      const radial = start.subtract(a);
      const endRadial = end.subtract(a);
      const sweep = Math.atan2(cross(radial, endRadial), radial.dot(endRadial));
      if (Math.sign(sweep) !== side || Math.abs(sweep) > Math.PI - EPS) {
        throw failure();
      }
      return {
        centre: a,
        end,
        middle: a.add(
          radial.rotate((sweep * 90) / Math.PI, radial.multiply(0))
        ),
        s,
        start,
        t,
      };
    }
    const derivative = (curve: CurveRun, time: number) => {
      const lo = Math.max(0, time - 1e-5);
      const hi = Math.min(1, time + 1e-5);
      return centre(curve, hi)
        .subtract(centre(curve, lo))
        .divide(hi - lo);
    };
    const da = derivative(before, t),
      db = derivative(after, s).multiply(-1);
    const determinant = cross(da, db);
    if (Math.abs(determinant) < 1e-10) {
      throw failure();
    }
    const dt = -cross(delta, db) / determinant;
    const ds = -cross(da, delta) / determinant;
    let accepted = false;
    for (let scale = 1; scale > 1 / 1024; scale /= 2) {
      const nt = t + dt * scale;
      const ns = s + ds * scale;
      if (nt <= EPS || nt >= 1 - EPS || ns <= EPS || ns >= 1 - EPS) {
        continue;
      }
      if (centre(before, nt).getDistance(centre(after, ns)) >= delta.length) {
        continue;
      }
      t = nt;
      s = ns;
      accepted = true;
      break;
    }
    if (!accepted) {
      throw failure();
    }
  }
  throw failure();
};

const validateTopology = (paths: paper.Path[], finished: paper.Path[]) => {
  for (let i = 0; i < finished.length; i += 1) {
    for (let j = i + 1; j < finished.length; j += 1) {
      if (
        finished[i].getIntersections(finished[j]).length ||
        paths[i].contains(paths[j].interiorPoint) !==
          finished[i].contains(finished[j].interiorPoint) ||
        paths[j].contains(paths[i].interiorPoint) !==
          finished[j].contains(finished[i].interiorPoint)
      ) {
        throw failure();
      }
    }
  }
};

export const roundIntersections = (
  scope: paper.PaperScope,
  result: paper.PathItem,
  intersections: readonly paper.Point[],
  radius: number
): paper.PathItem => {
  if (!Number.isFinite(radius) || radius <= 0) {
    throw failure();
  }
  const paths =
    result instanceof scope.Path ? [result] : (result.children as paper.Path[]);
  let rounded = 0;
  const output = new scope.CompoundPath({ fillRule: "nonzero", insert: false });
  for (const source of paths) {
    if (!source.closed) {
      throw new Error("Intersection rounding requires closed contours");
    }
    const { curves } = source;
    const offsets = [0];
    for (const curve of curves) {
      offsets.push((offsets.at(-1) ?? 0) + curve.length);
    }
    const { length } = source;
    const wrap = (offset: number) => {
      const value = ((offset % length) + length) % length;
      return length - value < EPS ? 0 : value;
    };
    const sharp = curves.map(
      (curve, i) =>
        Math.abs(
          curves[(i + curves.length - 1) % curves.length]
            .getTangentAtTime(1)
            .getDirectedAngle(curve.getTangentAtTime(0))
        ) > 0.01
    );
    const corners = curves.flatMap((curve, i) => {
      if (
        !sharp[i] ||
        !intersections.some((point) => point.getDistance(curve.point1) < 1e-4)
      ) {
        return [];
      }
      const at = offsets[i];
      let previous = (i + curves.length - 1) % curves.length;
      while (!sharp[previous] && previous !== i) {
        previous = (previous + curves.length - 1) % curves.length;
      }
      let next = (i + 1) % curves.length;
      while (!sharp[next] && next !== i) {
        next = (next + 1) % curves.length;
      }
      const beforeLength = wrap(at - offsets[previous]) || length;
      const afterLength = wrap(offsets[next] - at) || length;
      const run = (start: number, extent: number): CurveRun => ({
        getPointAtTime: (time) =>
          source.getPointAt(wrap(start + time * extent)),
        getTangentAtTime: (time) =>
          source.getTangentAt(
            wrap(start + Math.max(1e-8, Math.min(1 - 1e-8, time)) * extent)
          ),
        getTimeAt: (offset) => offset / extent,
        length: extent,
      });
      const fillet = tangentCircle(
        run(at - beforeLength, beforeLength),
        run(at, afterLength),
        radius
      );
      if (!fillet) {
        return [];
      }
      return [
        {
          ...fillet,
          from: at - (1 - fillet.t) * beforeLength,
          to: at + fillet.s * afterLength,
        },
      ];
    });
    rounded += corners.length;
    const target = new scope.Path({ insert: false });
    const appendRange = (start: number, end: number) => {
      let current = start;
      while (current < end - EPS) {
        const position = wrap(current);
        const index = curves.findIndex(
          (_, i) => position < offsets[i + 1] - EPS
        );
        const i = Math.max(0, index);
        const local = Math.max(0, position - offsets[i]);
        const extent = Math.min(curves[i].length - local, end - current);
        if (extent < EPS) {
          throw failure();
        }
        const from = local < EPS ? 0 : curves[i].getTimeAt(local);
        const to =
          local + extent >= curves[i].length - EPS
            ? 1
            : curves[i].getTimeAt(local + extent);
        const part = curves[i].getPart(from, to);
        if (!target.segments.length) {
          target.moveTo(part.point1);
        }
        target.cubicCurveTo(
          part.point1.add(part.handle1),
          part.point2.add(part.handle2),
          part.point2
        );
        current += extent;
      }
    };
    if (!corners.length) {
      output.addChild(source.clone({ insert: false }));
      continue;
    }
    for (let i = 0; i < corners.length; i += 1) {
      const corner = corners[i];
      const previous = corners[(i + corners.length - 1) % corners.length];
      const start = previous.to - (i === 0 ? length : 0);
      if (start >= corner.from - EPS) {
        throw failure();
      }
      appendRange(start, corner.from);
      target.arcTo(corner.middle, corner.end);
    }
    if (
      target.lastSegment.point.getDistance(target.firstSegment.point) > 1e-5
    ) {
      throw failure();
    }
    target.firstSegment.handleIn = target.lastSegment.handleIn;
    target.lastSegment.remove();
    target.closePath();
    // Self crossings and crossings into another preserved contour are invalid.
    if (target.getCrossings(target).length) {
      throw failure();
    }
    if (
      Math.sign(target.area) !== Math.sign(source.area) ||
      Math.abs(target.area) < EPS
    ) {
      throw failure();
    }
    output.addChild(target);
  }
  validateTopology(paths, output.children as paper.Path[]);
  if (!rounded) {
    throw new Error("No sharp operand intersections to round");
  }
  return output;
};
