import { bbox, parsePath } from "../geometry/path.js";
import { flatten } from "../parts/shape.js";
import type { Issue, Subpath } from "../types.js";
import type { LintTarget } from "./lint.js";
import { SPEC } from "./spec.js";

const circle = (path: Subpath) => {
  // flatten() treats arcs as chords: unsupported rather than mismeasured.
  if (
    !path.closed ||
    path.segs.length < 4 ||
    path.segs.some((s) => s.t !== "C")
  ) {
    return null;
  }
  const box = bbox([path]);
  const radius = (box.w + box.h) / 4;
  if (radius <= 0 || Math.abs(box.w - box.h) > radius * 0.01) {
    return null;
  }
  const x = box.x0 + box.w / 2;
  const y = box.y0 + box.h / 2;
  if (
    flatten(path).some(
      ([px, py]) =>
        Math.abs(Math.hypot(px - x, py - y) - radius) > radius * 0.01
    )
  ) {
    return null;
  }
  return { radius, x, y };
};

const isTick = (path: Subpath): boolean => {
  if (path.closed || path.segs.length !== 2) {
    return false;
  }
  const [a, b] = path.segs;
  if (a.t !== "L" || b.t !== "L") {
    return false;
  }
  const dx1 = a.p[0] - path.start[0];
  const dy1 = a.p[1] - path.start[1];
  const dx2 = b.p[0] - a.p[0];
  const dy2 = b.p[1] - a.p[1];
  return (
    dx1 > 0 &&
    dy1 > 0 &&
    dx2 > 0 &&
    dy2 < 0 &&
    Math.abs(Math.atan2(dy1, dx1) - Math.PI / 4) < Math.PI / 30 &&
    Math.abs(Math.atan2(-dy2, dx2) - Math.PI / 4) < Math.PI / 30 &&
    Math.hypot(dx2, dy2) > Math.hypot(dx1, dy1) * 1.2
  );
};

/**
 * Warn on a conventional upright tick displaced inside a cubic circular ring.
 * Measure subpaths separately, so a magnifier handle cannot drag its centre.
 * Filled art, arcs, rotated/curved ticks and multi-mark interiors are outside
 * scope. This never rewrites or quantizes admitted source geometry.
 * The quarter-stroke allowance admits modest optical offsets; it is a
 * development regression threshold, not a calibrated aesthetic acceptance gate.
 */
export const enclosureAlignmentIssues = (canvas: LintTarget): Issue[] => {
  if (canvas.finish === "filled") {
    return [];
  }
  const spec = canvas.spec ?? SPEC;
  const paths = canvas.elements
    .filter((e) => e.strokeWidth !== 0 && !e.hole && e.op !== "knockout")
    .flatMap((e) =>
      parsePath(e.d).map((path, index) => ({
        id: `${e.id} subpath ${index + 1}`,
        path,
        width: e.strokeWidth ?? spec.stroke,
      }))
    );
  const issues: Issue[] = [];
  for (const host of paths) {
    const ring = circle(host.path);
    if (!ring) {
      continue;
    }
    const contained = paths.filter(
      (mark) =>
        mark !== host &&
        flatten(mark.path).every(
          ([x, y]) =>
            Math.hypot(x - ring.x, y - ring.y) + (mark.width + host.width) / 2 <
            ring.radius
        )
    );
    if (contained.length !== 1 || !isTick(contained[0].path)) {
      continue;
    }
    const [mark] = contained;
    const box = bbox([mark.path]);
    const dx = box.x0 + box.w / 2 - ring.x;
    const dy = box.y0 + box.h / 2 - ring.y;
    const tolerance = host.width / 4;
    if (Math.max(Math.abs(dx), Math.abs(dy)) <= tolerance) {
      continue;
    }
    issues.push({
      message: `${mark.id} tick bounds centre is offset (${dx.toFixed(2)}, ${dy.toFixed(2)}) units from ${host.id} circular enclosure centre (${ring.x.toFixed(2)}, ${ring.y.toFixed(2)}), beyond the ${tolerance.toFixed(2)}-unit quarter-stroke allowance. Inspect local optical balance at native size; whole-icon centring does not establish mark alignment.`,
      rule: "enclosure-alignment",
      severity: "warn",
    });
  }
  return issues;
};
