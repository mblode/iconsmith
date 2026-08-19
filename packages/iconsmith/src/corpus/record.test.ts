import { describe, expect, test } from "vitest";

import type { Rendering } from "./record.js";
import {
  buildRecord,
  measureRendering,
  RECORD_SCHEMA_VERSION,
  stableStringify,
} from "./record.js";

const svg = (...els: string[]) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none">${els.join("")}</svg>`;
const stroked = (d: string, w = 2) =>
  `<path d="${d}" stroke="currentColor" stroke-width="${w}" stroke-linecap="round"/>`;
const filled = (d: string) => `<path d="${d}" fill="currentColor"/>`;

const measure = (body: string, canonical = true): Rendering =>
  measureRendering({
    bytes: body.length,
    canonical,
    path: "a/b.svg",
    sha256: "0".repeat(64),
    svg: body,
    variant: "outlined",
  }).rendering;

describe("the rendering carries what a measurer already knows", () => {
  test("visual extent is the piece bbox grown by each piece's own stroke", () => {
    // The mistake this guards is the one AGENTS.md names: growing the whole
    // path bbox by one stroke conflates a rendering fact with a design fact.
    // Here the fill contributes nothing and the stroke contributes 1 a side.
    const r = measure(svg(stroked("M4 4H20"), filled("M8 8H16V16H8Z")));
    expect(r.extent).toEqual({ vx: 18, vy: 13, x0: 3, y0: 3 });
  });

  test("off-axis edges are counted from stroked shapes only", () => {
    // A filled contour has no edges in the sense the rule means; counting one
    // measures the outline expander, not the drawing.
    const r = measure(svg(stroked("M2 2L12 8"), filled("M2 20L12 22V23Z")));
    expect(r.angles.edges).toBe(1);
    expect(r.angles.offAxis).toBe(1);
    expect(r.angles.offAxisShare).toBe(1);
    expect(r.angles.worstOffBy).toBeCloseTo(14, 0);
  });

  test("distinct stroke widths survive as themselves", () => {
    // Passing one uniform stroke to lint is what drags apparent conformance
    // from ~85% to ~70%, so the record has to keep the real ones.
    const r = measure(svg(stroked("M4 4H20", 2), stroked("M4 8H20", 1.5)));
    expect(r.strokes).toEqual([1.5, 2]);
    expect(r.style).toBe("outlined");
  });

  test("a mixed icon says so rather than picking a side", () => {
    expect(
      measure(svg(stroked("M4 4H20"), filled("M8 8H16V16H8Z"))).style
    ).toBe("mixed");
  });
});

describe("float vectors stay out of the record", () => {
  test("only the canonical rendering is fingerprinted", () => {
    const body = svg(stroked("M4 4H20"));
    expect(
      measureRendering({
        bytes: 1,
        canonical: true,
        path: "p",
        sha256: "x",
        svg: body,
        variant: "v",
      }).fingerprints
    ).toHaveLength(1);
    expect(
      measureRendering({
        bytes: 1,
        canonical: false,
        path: "p",
        sha256: "x",
        svg: body,
        variant: "v",
      }).fingerprints
    ).toHaveLength(0);
  });

  test("no field of the rendering is a float vector", () => {
    // The rule the format depends on: a 64-point fingerprint or a 2,304-value
    // ink vector inlined here turns a greppable file into an index-shaped one.
    const r = measure(svg(stroked("M4 4H20"), filled("M8 8H16V16H8Z")));
    for (const value of Object.values(r)) {
      if (Array.isArray(value)) {
        expect(value.length).toBeLessThan(32);
      }
    }
    // Both vector slots are addresses the writer stamps in, and both are null
    // until it does — nothing float-shaped is ever constructed here.
    expect(r.fingerprints).toBeNull();
    expect(r.ink).toBeNull();
  });
});

describe("a defective file is recorded, not swallowed and not fatal", () => {
  test("a path with a non-numeric coordinate is dropped and named", () => {
    // `corpus/round-filled-radius-1-stroke-1.5/burger.svg` ships `Lnan nan`.
    // Crashing loses the other 92,662 files; measuring it silently reports an
    // icon with a shape missing as if it were clean.
    const r = measure(svg(stroked("M4 4Lnan nanL20 4"), stroked("M4 8H20")));
    expect(r.defects).toEqual(["nan-path"]);
    expect(r.shapes).toBe(1);
  });
});

describe("determinism", () => {
  test("stableStringify sorts keys at every depth", () => {
    expect(stableStringify({ a: { c: 2, d: [3, 2] }, b: 1 })).toBe(
      '{"a":{"c":2,"d":[3,2]},"b":1}'
    );
  });

  test("arrays keep their order, so renderings stay in variant order", () => {
    expect(stableStringify([{ b: 1 }, { a: 2 }])).toBe('[{"b":1},{"a":2}]');
  });

  test("every float is at 4 dp, which is 1/400th of a stroke on the 24 grid", () => {
    const line = stableStringify(
      measure(svg(stroked("M4.123456 4H19.987654")))
    );
    expect(line).not.toMatch(/\d\.\d{5}/u);
  });

  test("no timestamp reaches a record; the build date lives in the manifest", () => {
    const r = buildRecord({
      provenance: {
        homepage: "o",
        licence: "MIT",
        set: "s",
        usage: "conditioning",
        version: null,
      },
      renderings: [],
      set: "s",
      slug: "x",
    });
    expect(stableStringify(r)).not.toMatch(/\d{4}-\d{2}-\d{2}T/u);
    expect(r.schema).toBe(RECORD_SCHEMA_VERSION);
  });
});

describe("the record is the identity, not the file", () => {
  test("renderings sort by variant however the walk found them", () => {
    const one = (variant: string): Rendering =>
      ({ ...measure(svg(stroked("M4 4H20"))), variant }) as Rendering;
    const r = buildRecord({
      provenance: {
        homepage: "o",
        licence: "MIT",
        set: "blode",
        usage: "conditioning",
        version: null,
      },
      renderings: [one("outlined"), one("filled")],
      set: "blode",
      slug: "folder-open",
    });
    expect(r.id).toBe("blode/folder-open");
    expect(r.renderings.map((x) => x.variant)).toEqual(["filled", "outlined"]);
  });

  test("usage is carried verbatim from the source, never derived", () => {
    const r = buildRecord({
      provenance: {
        homepage: "https://lucide.dev",
        licence: "ISC",
        set: "lucide",
        usage: "analysis-only",
        version: null,
      },
      renderings: [],
      set: "lucide",
      slug: "banana",
    });
    expect(r.provenance.usage).toBe("analysis-only");
  });
});
