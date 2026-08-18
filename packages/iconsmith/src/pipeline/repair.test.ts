/**
 * The mechanical fix path, tested on the distinctions it exists to draw.
 *
 * Every test here is really the same question asked about a different value:
 * is this residue, or is it a decision? Getting that wrong in the safe
 * direction costs coverage; getting it wrong in the other direction silently
 * redraws a shipped icon, so the boundary cases are the tests that matter.
 */
import { mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { CorpusIcon, CorpusShape, Variant } from "../corpus/load.js";
import { parsePath } from "../geometry/path.js";
import {
  classifyStroke,
  dropContour,
  editSource,
  editsFor,
  isSpurCandidate,
  repairIcon,
  repairSet,
  verifyIcon,
} from "./repair.js";

const first = (d: string) => parsePath(d)[0];

const shape = (over: Partial<CorpusShape> = {}): CorpusShape => ({
  cap: "round",
  d: "M4 4L20 4L20 20L4 20Z",
  filled: false,
  strokeWidth: 2,
  ...over,
});

const icon = (shapes: CorpusShape[], symbol = "test"): CorpusIcon => ({
  shapes,
  symbol,
  variant: {
    corner: "round",
    key: "round-outlined-radius-3-stroke-2",
    radius: 3,
    stroke: 2,
    style: "outlined",
  } satisfies Variant,
});

describe("classifyStroke", () => {
  it("leaves the house stroke and filled shapes alone", () => {
    expect(classifyStroke(2).kind).toBe("keep");
    expect(classifyStroke(0).kind).toBe("keep");
  });

  it("snaps float residue back to the house stroke", () => {
    // Measured in the corpus: 1.995 and 2.05556 are transform residue.
    expect(classifyStroke(1.995)).toMatchObject({ kind: "snap", width: 2 });
    expect(classifyStroke(2.05556)).toMatchObject({ kind: "snap", width: 2 });
  });

  it("refuses to snap a deliberately thinner line", () => {
    // 1.8 is the single commonest off-tier width in the set. Whatever it is,
    // it is not a failed attempt at 2, and snapping it would be a redraw.
    for (const w of [0.75, 1, 1.5, 1.8, 2.2, 2.5, 3.5]) {
      expect(classifyStroke(w).kind).toBe("review");
    }
  });

  it("denoises a deliberate width without changing its weight", () => {
    // 1.90004 is 1.9 carrying float dust. It stays 1.9; it does not become 2.
    const v = classifyStroke(1.90004);
    expect(v.kind).toBe("denoise");
    expect(v.width).toBe(1.9);
  });

  it("does not leave float dust of its own behind", () => {
    // Math.round(1.90004 / 0.05) * 0.05 is 1.9000000000000001.
    expect(String(classifyStroke(1.90004).width)).toBe("1.9");
  });

  it("draws the residue boundary where the corpus does", () => {
    // The window has to clear 1.995 without reaching 1.9.
    expect(classifyStroke(1.95).kind).toBe("snap");
    expect(classifyStroke(1.9).kind).toBe("review");
  });
});

describe("isSpurCandidate", () => {
  it("flags a closed contour that doubles back on itself", () => {
    expect(isSpurCandidate(first("M4 4L12 4L4 4Z"), false)).toBe(true);
  });

  it("flags a closed contour inside a stroked shape, not just a filled one", () => {
    // Gating on the shape's fill missed the eleven stroked-only icons the
    // corpus audit found: a closed contour is just as dead either way.
    expect(isSpurCandidate(first("M4 4L12 4L4 4Z"), false)).toBe(true);
  });

  it("ignores an open path, which encloses nothing by construction", () => {
    // Every straight stroke in the set encloses no area. Testing area without
    // testing closure would flag half the corpus, which was this module's
    // first bug.
    expect(isSpurCandidate(first("M4 4L20 20"), false)).toBe(false);
  });

  it("ignores an ordinary filled shape", () => {
    expect(isSpurCandidate(first("M4 4L20 4L20 20L4 20Z"), true)).toBe(false);
  });

  it("ignores a contour with no extent worth measuring", () => {
    expect(isSpurCandidate(first("M12 12L12.001 12L12 12Z"), true)).toBe(false);
  });

  it("flags a thin sliver as a candidate and leaves removal to the proof", () => {
    // 1.8px across with a whisker of area. It is a candidate on the audit's
    // definition and it genuinely renders, so the render test is what has to
    // reject it — candidacy is detection, not permission.
    expect(isSpurCandidate(first("M4 4L12 4L12 4.002Z"), true)).toBe(true);
  });
});

describe("dropContour", () => {
  it("leaves the surviving contours byte-identical", () => {
    // The claim of a spur removal is that nothing else moved. Reusing the
    // original text of each kept contour makes that true rather than likely.
    const keep = "M4 4L20 4L20 20L4 20Z";
    expect(dropContour(`${keep}M4 4L12 4L4 4Z`, 1)).toBe(keep);
  });

  it("refuses when text and parse disagree about contour count", () => {
    const d = "M4 4L20 4";
    expect(dropContour(d, 7)).toBe(d);
  });
});

describe("repairIcon", () => {
  it("reports a fix per shape with what it was and what it became", () => {
    const result = repairIcon(icon([shape({ strokeWidth: 1.995 })]));
    expect(result.fixes).toHaveLength(1);
    expect(result.fixes[0]).toMatchObject({
      after: "2",
      before: "1.995",
      kind: "snap-stroke",
      shape: 0,
    });
    expect(result.shapes[0].strokeWidth).toBe(2);
  });

  it("routes a deliberate width to review rather than changing it", () => {
    const result = repairIcon(icon([shape({ strokeWidth: 1.8 })]));
    expect(result.fixes).toEqual([]);
    expect(result.review).toHaveLength(1);
    expect(result.shapes[0].strokeWidth).toBe(1.8);
  });

  it("strips a dead contour from a stroked shape too", () => {
    // The earlier version of this gated on the shape being filled, which missed
    // the eleven stroked-only icons the corpus audit found. A closed contour
    // enclosing nothing is dead whichever kind of shape holds it.
    const spurred = "M4 4L20 4L20 20L4 20ZM4 4L12 4L4 4Z";
    const stroked = repairIcon(icon([shape({ d: spurred })]));
    expect(stroked.fixes.map((f) => f.kind)).toContain("remove-spur");
    expect(parsePath(stroked.shapes[0].d)).toHaveLength(1);
  });

  it("leaves the surviving contours byte-identical", () => {
    // The claim of a spur removal is that nothing else moved. Reusing the
    // original text of each kept contour is what makes that true rather than
    // merely likely.
    const keep = "M4 4L20 4L20 20L4 20Z";
    const result = repairIcon(
      icon([
        shape({ d: `${keep}M4 4L12 4L4 4Z`, filled: true, strokeWidth: 0 }),
      ])
    );
    expect(result.shapes[0].d).toBe(keep);
  });

  it("does nothing to an icon that is already clean", () => {
    const result = repairIcon(icon([shape()]));
    expect(result.fixes).toEqual([]);
    expect(result.review).toEqual([]);
  });
});

describe("verifyIcon", () => {
  it("proves a stroke snap leaves the render where it was", async () => {
    const v = await verifyIcon(icon([shape({ strokeWidth: 1.995 })]));
    expect(v.fixes).toHaveLength(1);
    expect(v.inert).toBe(true);
    expect(v.score).toBeGreaterThanOrEqual(0.9995);
  });

  it("proves a spur removal leaves the render where it was", async () => {
    const v = await verifyIcon(
      icon([
        shape({
          d: "M4 4L20 4L20 20L4 20ZM4 4L12 4L4 4Z",
          filled: true,
          strokeWidth: 0,
        }),
      ])
    );
    expect(v.fixes[0].kind).toBe("remove-spur");
    expect(v.score).toBeGreaterThanOrEqual(0.9995);
  });

  it("scores an untouched icon without rendering it", async () => {
    const v = await verifyIcon(icon([shape()]));
    expect(v.score).toBe(1);
    expect(v.inert).toBe(true);
  });
  /**
   * The guard that keeps corrected icons away from the user's shipped package
   * and from the corpus. It was verified by hand when written, which is not the
   * same as being pinned: a refactor that drops the check would leave every
   * other test passing while the fix path silently gained the ability to
   * overwrite 2,085 shipped SVGs. These are the two paths that must always
   * throw.
   */
  it.each([
    "corpus/round-outlined-radius-3-stroke-2",
    "/Users/someone/Code/blode-icons/packages/blode-icons-react/icons-svg",
  ])("refuses to write over %s", async (out) => {
    await expect(
      repairSet({
        corpus: {
          has: () => false,
          load: () => {
            throw new Error("must not load: the guard runs first");
          },
          symbols: [],
        } as never,
        out,
      })
    ).rejects.toThrow(/Refusing to write/u);
  });
});

describe("editSource", () => {
  const SRC =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none">\n' +
    '<path d="M4 4L20 20" stroke="currentColor" stroke-width="1.995"/>\n' +
    "</svg>\n";

  it("leaves the header, attribute order and whitespace exactly as found", () => {
    // Re-serialising added width and height to all 98 staged files, which
    // changes how an inlined icon scales, and buried the real fixes in a diff
    // where every line read as changed.
    const out = editSource(SRC, 1, [
      { attrs: { "stroke-width": "2" }, shape: 0 },
    ]);
    expect(out?.split("\n")[0]).toBe(SRC.split("\n")[0]);
    expect(out?.endsWith("</svg>\n")).toBe(true);
    expect(out).toContain('stroke-width="2"');
    expect(out).not.toContain("1.995");
  });

  it("changes exactly one line", () => {
    const out = editSource(SRC, 1, [
      { attrs: { "stroke-width": "2" }, shape: 0 },
    ]);
    const before = SRC.split("\n");
    const after = (out ?? "").split("\n");
    const changed = before.filter((line, i) => line !== after[i]).length;
    expect(changed).toBe(1);
  });

  it("inserts an attribute the element does not carry", () => {
    const out = editSource(SRC, 1, [
      { attrs: { "stroke-linecap": "round" }, shape: 0 },
    ]);
    expect(out).toContain('stroke-linecap="round"');
    expect(out?.split("\n")[0]).toBe(SRC.split("\n")[0]);
  });

  it("refuses when the element count does not match the shape count", () => {
    // An icon whose markup cannot be indexed confidently is left alone rather
    // than edited at a guessed offset.
    expect(editSource(SRC, 2, [{ attrs: { d: "M0 0" }, shape: 0 }])).toBeNull();
  });

  it("refuses a geometry edit on a synthesised element", () => {
    // The loader builds `d` for a <circle> from cx/cy/r. Writing one back would
    // be authoring geometry, not editing it.
    const circle =
      '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="6"/></svg>';
    expect(
      editSource(circle, 1, [{ attrs: { d: "M0 0" }, shape: 0 }])
    ).toBeNull();
  });
});

describe("editsFor", () => {
  it("emits only the attributes that actually changed", () => {
    const before = [shape({ strokeWidth: 1.995 }), shape()];
    const after = [shape({ strokeWidth: 2 }), shape()];
    expect(editsFor(before, after)).toEqual([
      { attrs: { "stroke-width": "2" }, shape: 0 },
    ]);
  });

  it("does not write a stroke width onto a filled shape", () => {
    const before = [shape({ filled: true, strokeWidth: 0 })];
    const after = [shape({ filled: true, strokeWidth: 2 })];
    expect(editsFor(before, after)).toEqual([]);
  });
});

const SVG = (w: string) =>
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none">\n' +
  `<path d="M4 4L20 20" stroke="currentColor" stroke-width="${w}"/>\n` +
  "</svg>\n";

describe("the written set matches the reported set", () => {
  /** A corpus of two icons, one repairable and one already clean. */
  const stubCorpus = (svgs: Record<string, string>) => ({
    has: (s: string) => s in svgs,
    load: (s: string) =>
      Promise.resolve(
        icon(
          [shape({ d: "M4 4L20 20", strokeWidth: s === "dirty" ? 1.995 : 2 })],
          s
        )
      ),
    origin: "test",
    pathTo: (s: string) => s,
    root: "test",
    svg: (s: string) => Promise.resolve(svgs[s]),
    symbols: Object.keys(svgs),
    variant: () => {},
    variants: [],
  });

  it("writes exactly the icons it reports as fixed, and no others", async () => {
    const out = await mkdtemp(path.join(tmpdir(), "iconsmith-staging-"));
    const corpus = stubCorpus({ clean: SVG("2"), dirty: SVG("1.995") });

    // A file left behind by an earlier run. Two of these survived into a real
    // staging directory, carried geometry from a since-fixed bug, and appeared
    // in no section of the report.
    await writeFile(path.join(out, "ghost.svg"), "<svg/>");

    const r = await repairSet({
      corpus: corpus as never,
      out,
      variant: "round-outlined-radius-3-stroke-2",
    });

    const entries = await readdir(out);
    const written = entries
      .filter((f) => f.endsWith(".svg"))
      .map((f) => f.replace(/\.svg$/u, ""))
      .toSorted();
    expect(written).toEqual(r.fixed.map((v) => v.icon).toSorted());
    expect(written).not.toContain("ghost");
  });

  it("writes nothing under --dry-run", async () => {
    const out = await mkdtemp(path.join(tmpdir(), "iconsmith-staging-"));
    const corpus = stubCorpus({ dirty: SVG("1.995") });
    const r = await repairSet({
      corpus: corpus as never,
      dryRun: true,
      out,
      variant: "round-outlined-radius-3-stroke-2",
    });
    expect(r.fixed.length).toBeGreaterThan(0);
    const files = await readdir(out);
    expect(files).toEqual([]);
  });
});
