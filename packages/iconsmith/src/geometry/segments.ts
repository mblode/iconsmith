/** Straight path runs for angle validation; curves and arcs stay excluded. */
import type { Subpath } from "../types.js";

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
