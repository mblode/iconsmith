import { describe, expect, it } from "vitest";

import { styleScore } from "./style.js";
import type { Embeddings } from "./vectors.js";

/** A stand-in for a sidecar, so these tests need no `.f32` on disk. */
const fake = (rows: Record<string, number[]>): Embeddings => {
  const vectors = new Map(
    Object.entries(rows).map(([id, v]) => {
      const norm = Math.hypot(...v);
      return [id, new Float32Array(v.map((x) => x / norm))] as const;
    })
  );
  return {
    builtAt: "",
    dim: 2,
    get: (id) => vectors.get(id) ?? null,
    has: (id) => vectors.has(id),
    ids: [...vectors.keys()],
    model: "fake",
    rows: vectors.size,
  };
};

const unit = (v: number[]): Float32Array => {
  const norm = Math.hypot(...v);
  return new Float32Array(v.map((x) => x / norm));
};

describe("styleScore", () => {
  const house = fake({
    // Ten icons spread around the unit circle, plus one twin sitting exactly
    // on the probe.
    ...Object.fromEntries(
      Array.from({ length: 10 }, (_, i) => [
        `h/${i}`,
        [Math.cos((i * Math.PI) / 10), Math.sin((i * Math.PI) / 10)],
      ])
    ),
    "h/twin": [1, 0],
  });
  const ids = [...house.ids];

  it("returns null rather than a short median when too few neighbours survive", () => {
    // A median over three neighbours is a different measurement from a median
    // over ten, and reporting it as the same is how a calibration stops meaning
    // anything.
    expect(
      styleScore(unit([1, 0]), house, ids, {
        exclude: new Set(ids.slice(0, 9)),
      })
    ).toBeNull();
  });

  it("drops the excluded neighbours from the neighbourhood", () => {
    const withTwin = styleScore(unit([1, 0]), house, ids) ?? 0;
    const withoutTwin =
      styleScore(unit([1, 0]), house, ids, {
        exclude: new Set(["h/twin", "h/0"]),
      }) ?? 0;
    // Without the exclusion the nearest neighbour is the icon itself, which is
    // the whole failure this parameter exists to prevent.
    expect(withTwin).toBeGreaterThan(withoutTwin);
  });

  it("takes a median rather than a max, so one near-twin cannot carry a score", () => {
    const far = fake({
      ...Object.fromEntries(
        Array.from({ length: 10 }, (_, i) => [`f/${i}`, [0, i + 1]])
      ),
      "f/twin": [1, 0],
    });
    const score = styleScore(unit([1, 0]), far, [...far.ids]) ?? 1;
    // f/twin scores 1; every other neighbour scores 0. A max would report 1.
    expect(score).toBeLessThan(0.5);
  });
});
