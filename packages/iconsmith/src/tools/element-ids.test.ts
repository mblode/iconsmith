/**
 * Element handles, and the canvas version built on top of them.
 *
 * Ids used to be minted from `elements.length`, which is stable only while
 * nothing is ever deleted. `remove` splices, so the first non-terminal removal
 * hands the next element an id that is already in use — and every read path
 * (`describe`, `placed`, `remove` itself) resolves a duplicate to the *older*
 * element, so nothing errors and the model quietly reasons about a scene that
 * does not exist.
 */
import { describe, expect, it } from "vitest";

import { Canvas } from "./canvas.js";

describe("element ids", () => {
  it("does not reissue an id after a non-terminal removal", () => {
    const c = new Canvas();
    const a = c.line({ points: [[4, 4] as [number, number], [20, 4]] });
    const b = c.line({ points: [[4, 12] as [number, number], [20, 12]] });
    const d = c.line({ points: [[4, 20] as [number, number], [20, 20]] });
    expect([a, b, d]).toEqual(["e0", "e1", "e2"]);

    c.remove(b);
    const fresh = c.circle({ cx: 12, cy: 12, r: 4 });

    const ids = c.describe().map((e) => e.id);
    expect(fresh).not.toBe(d);
    expect(new Set(ids).size).toBe(c.elements.length);
    expect(ids).toEqual(["e0", "e2", "e3"]);
  });

  it("resolves a fresh id to the element just drawn, not an older one", () => {
    const c = new Canvas();
    c.line({ points: [[4, 4] as [number, number], [20, 4]] });
    const mid = c.line({ points: [[4, 12] as [number, number], [20, 12]] });
    c.line({ points: [[4, 20] as [number, number], [20, 20]] });
    c.remove(mid);

    const fresh = c.circle({ cx: 12, cy: 12, r: 4 });
    const found = c.describe().find((e) => e.id === fresh);
    // The bug's signature: `find` returned a `line` here, with the older
    // element's bounds, for a circle the model had just drawn.
    expect(found?.kind).toBe("circle");
    expect(found?.w).toBeCloseTo(8, 5);

    // And `remove` resolved the same duplicate, deleting the wrong shape.
    c.remove(fresh);
    expect(c.describe().map((e) => e.kind)).toEqual(["line", "line"]);
  });

  it("keeps the model's handles across a transform", () => {
    const c = new Canvas();
    const a = c.rect({ h: 6, w: 6, x: 4, y: 4 });
    const b = c.circle({ cx: 16, cy: 16, r: 3 });
    c.transform(1.5, 1, 1);
    expect(c.describe().map((e) => e.id)).toEqual([a, b]);

    // The counter is rewound with them, so the next element is still fresh.
    expect(c.rect({ h: 2, w: 2, x: 2, y: 2 })).toBe("e2");
  });
});

describe("canvas version", () => {
  it("advances on every mutation and on nothing else", () => {
    const c = new Canvas();
    expect(c.version).toBe(0);

    const id = c.rect({ h: 8, w: 8, x: 4, y: 4 });
    const drawn = c.version;
    expect(drawn).toBeGreaterThan(0);

    // Reads do not count as change: this is the whole reason the loop can use
    // the version to ask "is the render I am looking at still the drawing".
    c.describe();
    c.bbox();
    c.toSVG();
    c.toJSON();
    expect(c.version).toBe(drawn);

    c.transform(2, 0, 0);
    expect(c.version).toBe(drawn + 1);

    c.remove(id);
    expect(c.version).toBe(drawn + 2);

    c.clear();
    expect(c.version).toBe(drawn + 3);
  });

  it("counts a whole transform as one change, and an identity as none", () => {
    const c = new Canvas();
    c.rect({ h: 8, w: 8, x: 4, y: 4 });
    c.circle({ cx: 12, cy: 12, r: 3 });
    const before = c.version;

    c.transform(1.5, 0, 0);
    expect(c.version).toBe(before + 1);

    // A second `fit` over an already-fitted drawing is the identity, and the
    // loop reads it as the model adding nothing rather than as progress.
    const fitted = c.version;
    c.transform(1, 0, 0);
    expect(c.version).toBe(fitted);
  });
});
