import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { HOUSE_VARIANT, parseIconSvg } from "../corpus/load.js";
import { extractParts } from "../parts/extract.js";
import { nameParts } from "../parts/vocabulary.js";
import { run } from "../tools/dsl.js";
import { cosine, inkVector } from "../tools/render.js";
import type { Part } from "../types.js";
import {
  CompileError,
  compileArm,
  compileIcon,
  compilePaint,
  finishProgram,
} from "./reconstruct.js";

const VARIANT_DIR = path.join("corpus", HOUSE_VARIANT);
const present = existsSync(path.join(VARIANT_DIR, "pull-request.svg"));

const PATH = "M4 4L12 4L12 12L4 12Z";
/** Same handle ratio `canvas.ts` and `load.ts` use for a cubic circle. */
const K = 0.5523;

const ringPath = (cx: number, cy: number, r: number): string => {
  const c = r * K;
  return (
    `M${cx} ${cy - r}C${cx + c} ${cy - r} ${cx + r} ${cy - c} ${cx + r} ${cy}` +
    `C${cx + r} ${cy + c} ${cx + c} ${cy + r} ${cx} ${cy + r}` +
    `C${cx - c} ${cy + r} ${cx - r} ${cy + c} ${cx - r} ${cy}` +
    `C${cx - r} ${cy - c} ${cx - c} ${cy - r} ${cx} ${cy - r}Z`
  );
};

const ovalPath = (cx: number, cy: number, rx: number, ry: number): string => {
  const hx = rx * K;
  const hy = ry * K;
  return (
    `M${cx + rx} ${cy}C${cx + rx} ${cy + hy} ${cx + hx} ${cy + ry} ${cx} ${cy + ry}` +
    `C${cx - hx} ${cy + ry} ${cx - rx} ${cy + hy} ${cx - rx} ${cy}` +
    `C${cx - rx} ${cy - hy} ${cx - hx} ${cy - ry} ${cx} ${cy - ry}` +
    `C${cx + hx} ${cy - ry} ${cx + rx} ${cy - hy} ${cx + rx} ${cy}Z`
  );
};

const box = (): Part => ({
  closed: true,
  d: PATH,
  h: 8,
  icons: ["box"],
  id: "p-box",
  instances: 1,
  name: "box",
  nodes: 4,
  sizeRange: [8, 8],
  w: 8,
});

describe.skipIf(!present)("compileIcon", () => {
  it("replays pull-request from house parts instead of asking a model", async () => {
    const parts = nameParts(extractParts(VARIANT_DIR, {}).parts);
    const house = readFileSync(
      path.join(VARIANT_DIR, "pull-request.svg"),
      "utf-8"
    );
    const extras: Part[] = [];
    const source = compileIcon(
      "pull-request",
      parseIconSvg(house).map((s) => s.d),
      parts,
      extras
    );
    expect(source).toContain("circle 6,6 r2");
    expect(source).toContain("circle 6,18 r2");
    expect(source).toContain("circle 18,18 r2");
    expect(source).toContain("part ");
    expect(source).toContain("p0391");
    const drawn = run(source, [...parts, ...extras]);
    expect(drawn.errors).toEqual([]);
    const score = cosine(
      await inkVector(drawn.canvas.toSVG()),
      await inkVector(house)
    );
    expect(score).toBeGreaterThan(0.99);
  }, 30_000);

  it("does not scale a small star medoid up to the house star", async () => {
    const parts = nameParts(extractParts(VARIANT_DIR, {}).parts);
    const house = readFileSync(path.join(VARIANT_DIR, "star.svg"), "utf-8");
    const extras: Part[] = [];
    const source = compileIcon(
      "star",
      parseIconSvg(house).map((s) => s.d),
      parts,
      extras
    );
    expect(source).toContain("part star-0");
    expect(source).not.toContain("p0150");
    expect(source).not.toContain(" flip");
    const drawn = run(source, [...parts, ...extras]);
    expect(drawn.errors).toEqual([]);
    const score = cosine(
      await inkVector(drawn.canvas.toSVG()),
      await inkVector(house)
    );
    expect(score).toBeGreaterThan(0.99);
  }, 30_000);
});

describe("compileIcon circles", () => {
  it("emits circle for a circular subpath even when a part matches", () => {
    const oval: Part = {
      ...box(),
      d: ovalPath(6, 6, 2.2, 1.8),
      h: 3.6,
      id: "p-oval",
      w: 4.4,
    };
    const source = compileIcon("ring", [ringPath(6, 6, 2)], [oval]);
    expect(source).toContain("circle 6,6 r2");
    expect(source).not.toContain("part ");
  });

  it("does not treat a square as a circle", () => {
    expect(compileIcon("box", [PATH], [box()])).not.toContain("circle ");
    expect(compileIcon("box", [PATH], [box()])).toContain("part p-box");
  });

  it("does not treat an oval as a circle", () => {
    const d = ovalPath(12, 12, 8, 3);
    const rim: Part = {
      ...box(),
      d,
      h: 6,
      id: "ellipse-flat",
      name: "ellipse-flat",
      w: 16,
    };
    const source = compileIcon("tray", [d], [rim]);
    expect(source).not.toContain("circle ");
    expect(source).toContain("part ellipse-flat");
  });

  it("places the house path when the vocabulary is empty", () => {
    const extras: Part[] = [];
    const source = compileIcon("box", [PATH], [], extras);
    expect(source).toContain("part box-0");
    expect(extras).toHaveLength(1);
    expect(run(source, extras).errors).toEqual([]);
  });

  it("uses the house path when the cluster medoid is a smaller cousin", () => {
    const tiny: Part = {
      ...box(),
      d: "M0 0L4 0L4 4L0 4Z",
      h: 4,
      sizeRange: [4, 16],
      w: 4,
    };
    const extras: Part[] = [];
    const source = compileIcon(
      "box",
      ["M0 0L16 0L16 16L0 16Z"],
      [tiny],
      extras
    );
    expect(source).toContain("part box-0");
    expect(source).not.toContain("part p-box");
    expect(extras).toHaveLength(1);
    expect(run(source, [tiny, ...extras]).errors).toEqual([]);
  });
});

describe("compileArm", () => {
  it("draws from target paths with no model and no cost", async () => {
    const result = await compileArm()(
      { name: "box" },
      { parts: [box()], targetPaths: [PATH] }
    );
    expect(result.program).toContain("part p-box");
    expect(result.trace).toContain("part");
    expect(result.brief).toBe("compile box");
    expect(result.cost).toBeUndefined();
    expect(result.svg).toContain("<svg");
    expect(result.doc.icon).toBe("box");
  });

  it("throws when the run is not keyed", async () => {
    await expect(
      compileArm()({ name: "box" }, { parts: [box()] })
    ).rejects.toThrow(CompileError);
  });

  it("places an unmatched house path as a local part when the vocabulary is empty", async () => {
    const result = await compileArm()(
      { name: "box" },
      { parts: [], targetPaths: [PATH] }
    );
    expect(result.program).toContain("part box-0");
    expect(result.trace).toContain("part");
    expect(result.cost).toBeUndefined();
  });

  it("draws a circular target as circle with no vocabulary", async () => {
    const result = await compileArm()(
      { name: "ring" },
      { parts: [], targetPaths: [ringPath(6, 6, 2)] }
    );
    expect(result.program).toContain("circle 6,6 r2");
    expect(result.trace).toContain("circle");
    expect(result.cost).toBeUndefined();
  });

  /**
   * `fingerprint`'s error. The compiler declared `keyline square` on every
   * icon and never measured, so a reconstruction of Central's own drawing was
   * failed for not being 18×18 — an error the icon could only clear by being
   * rescaled, which would make it a different drawing.
   */
  it("does not fail its own icon for missing a keyline it never aimed at", async () => {
    // 18.5×19.8 visual extent, which is `fingerprint`'s: portrait to within
    // half a unit, and nothing like the square the compiler used to claim.
    const result = await compileArm()(
      { name: "fingerprint" },
      { parts: [], targetPaths: ["M3 3.1L19.5 3.1L19.5 21.9L3 21.9Z"] }
    );
    expect(result.program).not.toContain("keyline square");
    expect(result.issues.filter((i) => i.rule === "keyline")).toEqual([]);
    expect(result.clean).toBe(true);
  });

  it("declares the keyline it measured, so the claim is a reading", async () => {
    const result = await compileArm()(
      { name: "square" },
      { parts: [], targetPaths: ["M4 4L20 4L20 20L4 20Z"] }
    );
    expect(result.program).toContain("keyline square");
    expect(result.doc.keyline).toBe("square");
    expect(result.issues.filter((i) => i.severity === "error")).toEqual([]);
  });

  it("says nothing about a keyline when the extent lands between them", async () => {
    const result = await compileArm()(
      { name: "sliver" },
      { parts: [], targetPaths: ["M7 4L14 4L14 20L7 20Z"] }
    );
    expect(result.program).not.toContain("keyline");
    const keyline = result.issues.find((i) => i.rule === "keyline");
    // A warning, not an error: an undeclared extent that sits on no key shape
    // is a prompt to check, and 24% of Central's own icons are in that state.
    expect(keyline?.severity).toBe("warn");
  });
});

describe("compilePaint", () => {
  it("stamps finish filled so a solid house file is not restroked", () => {
    expect(finishProgram("icon plus\npart plus-0 at 4,4 size 16\n", "filled"))
      .toBe(`icon plus
finish filled
part plus-0 at 4,4 size 16
`);
    const painted = compilePaint("plus", [PATH], "filled");
    expect(painted.source).toContain("finish filled");
    expect(painted.program.canvas.finish).toBe("filled");
    expect(painted.program.errors).toEqual([]);
    expect(painted.program.canvas.toSVG()).toMatch(/fill="currentColor"/u);
  });

  it("expands an open house stroke into filled bars instead of a blank", () => {
    const painted = compilePaint("tick", ["M4 12L12 20L20 4"], "filled");
    expect(painted.program.errors).toEqual([]);
    expect(painted.program.canvas.toSVG()).toMatch(/<path/u);
    expect(painted.program.canvas.toSVG()).not.toBe(
      `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">\n\n</svg>`
    );
  });

  it("keeps a filled evenodd compound as one part so holes stay holes", () => {
    const evenodd = "M2 2H22V22H2ZM8 8H16V16H8Z";
    const painted = compilePaint("lock", [evenodd], "filled");
    expect(painted.extras).toHaveLength(1);
    expect(painted.source.match(/^part /gmu)?.length).toBe(1);
    expect(painted.program.canvas.toSVG()).toContain('fill-rule="evenodd"');
    expect(painted.program.errors).toEqual([]);
  });

  it("compileArm uses options.finish so a filled house is not restroked", async () => {
    const result = await compileArm()(
      { name: "plus" },
      { finish: "filled", targetPaths: [PATH] }
    );
    expect(result.program).toContain("finish filled");
    expect(result.doc.finish).toBe("filled");
    expect(result.extras?.length).toBeGreaterThan(0);
  });
});
