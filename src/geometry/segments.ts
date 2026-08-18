/**
 * Straight-run direction, as pure path maths.
 *
 * Lives here rather than beside either caller because two layers need it: the
 * census in `pipeline/` measures the whole corpus, and the slash rule in
 * `tools/` checks one icon. `tools` cannot import `pipeline`, so the shared
 * half comes down to `geometry` instead of being written twice — and an angle
 * convention written twice is an angle convention that disagrees with itself.
 */
import type { Subpath } from "../types.js";

/** Below this a run is a join artefact, not a diagonal anyone drew. */
export const MIN_DIAGONAL_LENGTH = 1.5;
/** Degrees off horizontal or vertical before a run counts as diagonal. */
export const MIN_OFF_AXIS = 15;

export type Direction = "balanced" | "falling" | "none" | "rising";

export interface Run {
  /**
   * Undirected angle in [0, 180). Undirected on purpose: a line is the same
   * line whichever end the path started from, and in SVG — where y grows
   * downward — an angle above 90° is the one that rises to the right.
   */
  angle: number;
  length: number;
}

/** Every straight run in a set of subpaths. Curves and arcs are skipped: a
 *  flattened curve would let one circle contribute equal rising and falling
 *  length and drown the signal. */
export const straightRuns = (subpaths: Subpath[]): Run[] => {
  const out: Run[] = [];
  for (const sp of subpaths) {
    let cur = sp.start;
    for (const s of sp.segs) {
      if (s.t === "L") {
        const dx = s.p[0] - cur[0];
        const dy = s.p[1] - cur[1];
        let angle = (Math.atan2(dy, dx) * 180) / Math.PI;
        if (angle < 0) {
          angle += 180;
        }
        out.push({ angle: angle % 180, length: Math.hypot(dx, dy) });
        cur = [s.p[0], s.p[1]];
      } else if (s.t === "C") {
        cur = [s.p[4], s.p[5]];
      } else {
        cur = [s.p[5], s.p[6]];
      }
    }
  }
  return out;
};

const offAxis = (angle: number): number =>
  Math.min(angle, Math.abs(angle - 90), Math.abs(180 - angle));

export const isDiagonal = (r: Run): boolean =>
  r.length >= MIN_DIAGONAL_LENGTH && offAxis(r.angle) >= MIN_OFF_AXIS;

/** Rising and falling lengths within this ratio of each other are a draw. */
const BALANCED = 1.25;

/** Which way a set of runs reads overall. */
export const directionOf = (runs: Run[]): Direction => {
  let rising = 0;
  let falling = 0;
  for (const r of runs) {
    if (!isDiagonal(r)) {
      continue;
    }
    if (r.angle > 90) {
      rising += r.length;
    } else {
      falling += r.length;
    }
  }
  if (rising === 0 && falling === 0) {
    return "none";
  }
  const hi = Math.max(rising, falling);
  const lo = Math.min(rising, falling);
  if (lo > 0 && hi / lo <= BALANCED) {
    return "balanced";
  }
  return rising > falling ? "rising" : "falling";
};
