/**
 * The panel's own tests.
 *
 * A structural check that does not measure what its name says is worse than no
 * check: it passes a candidate that a human can see is off-spec, with a number
 * beside it. So each one is asserted against a synthetic icon built to violate
 * exactly that property and nothing else, and the anti-gaming properties — that
 * regrouping cannot change a verdict, that an empty run fails — are asserted
 * directly rather than assumed.
 */
import { describe, expect, it } from "vitest";

import {
  CHECKS,
  floorFor,
  inspect,
  measureIcon,
  panel,
  wilsonUpper,
} from "./blindspot.js";

const svg = (body: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none">${body}</svg>`;

const stroked = (...ds: string[]): string =>
  svg(
    ds
      .map(
        (d) =>
          `<path d="${d}" stroke="currentColor" stroke-width="2" fill="none"/>`
      )
      .join("")
  );

/** A rounded rectangle, in the corner radius the house draws at. */
const rounded = (x: number, y: number, w: number, h: number, r = 3): string =>
  `M${x + r} ${y}H${x + w - r}A${r} ${r} 0 0 1 ${x + w} ${y + r}V${y + h - r}` +
  `A${r} ${r} 0 0 1 ${x + w - r} ${y + h}H${x + r}A${r} ${r} 0 0 1 ${x} ${y + h - r}` +
  `V${y + r}A${r} ${r} 0 0 1 ${x + r} ${y}Z`;

/** A 16×16 rounded square centred on the canvas: visual extent 18×18, 3u clear
 *  on every side, dead centre, nothing in the corners. Passes everything. */
const SQUARE = rounded(4, 4, 16, 16);
const good = stroked(SQUARE);

const check = (name: string) => {
  const found = CHECKS.find((c) => c.name === name);
  if (!found) {
    throw new Error(`no check named ${name}`);
  }
  return found;
};

describe("measureIcon", () => {
  it("takes visual extent as the bbox plus the stroke, half per side", async () => {
    const m = await measureIcon(good);
    expect(m.extent.x).toBeCloseTo(18, 6);
    expect(m.extent.y).toBeCloseTo(18, 6);
    expect(m.margin.left).toBeCloseTo(3, 6);
    expect(m.margin.bottom).toBeCloseTo(3, 6);
    expect(m.centre.x).toBeCloseTo(12, 6);
  });

  it("counts marks across elements, not elements", async () => {
    const one = await measureIcon(stroked(`${SQUARE}M10 10H14`));
    const two = await measureIcon(stroked(SQUARE, "M10 10H14"));
    expect(one.elements).toBe(1);
    expect(two.elements).toBe(2);
    expect(one.marks).toBe(two.marks);
  });

  it("reads shapes the SVG draws as <circle> rather than <path>", async () => {
    const m = await measureIcon(
      svg(
        '<circle cx="12" cy="12" r="8" stroke="currentColor" stroke-width="2" fill="none"/>'
      )
    );
    expect(m.marks).toBe(1);
    expect(m.extent.x).toBeCloseTo(18, 1);
  });

  it("puts nearly no ink in the corners for a centred icon", async () => {
    const m = await measureIcon(good);
    expect(m.cornerInk).toBeLessThan(0.001);
  });

  it("finds the ink when it is in a corner", async () => {
    // A mark drawn inside the top-left 4×4 square, and nothing else near it.
    const m = await measureIcon(stroked("M2.5 2.5H3.5", SQUARE));
    expect(m.cornerInk).toBeGreaterThan(0.01);
  });

  it("survives an icon that draws nothing", async () => {
    const m = await measureIcon(svg(""));
    expect(m.marks).toBe(0);
    expect(m.cornerInk).toBe(0);
    expect(inspect("empty", m).failed).toContain("element-count");
  });
});

describe("the checks", () => {
  it("passes an icon drawn to the spec", async () => {
    expect(inspect("square", await measureIcon(good)).failed).toEqual([]);
  });

  it("fails an icon that outgrows the keyline box", async () => {
    // 20×20 of geometry plus a 2u stroke: 22×22 of visual extent.
    const m = await measureIcon(stroked("M2 2H22V22H2V2Z"));
    expect(inspect("big", m).failed).toContain("extent");
    expect(inspect("big", m).failed).toContain("margins");
  });

  it("fails an icon that is off centre by more than the grid tolerance", async () => {
    const m = await measureIcon(stroked(rounded(5, 4, 16, 16)));
    expect(m.centre.x).toBeCloseTo(13, 6);
    expect(inspect("shifted", m).failed).toEqual(["centred"]);
  });

  it("forgives a hair over the box, because that is the flattener", async () => {
    // 0.01u past the 20×20 box: a tenth of the error a person could see, and
    // the size of the mismatch between a circular arc and its cubic.
    const m = await measureIcon(stroked("M1.995 2H22.005V22H1.995V2Z"));
    expect(m.extent.x).toBeGreaterThan(20);
    expect(check("extent").holds({ ...m, extent: { x: 20.01, y: 20 } })).toBe(
      true
    );
    expect(check("extent").holds({ ...m, extent: { x: 20.5, y: 20 } })).toBe(
      false
    );
  });

  it("fails a busy icon on marks, and cannot be talked out of it by regrouping", async () => {
    const marks = Array.from({ length: 10 }, (_, i) => `M${4 + i} 4V20`);
    const asMany = await measureIcon(stroked(...marks));
    const asOne = await measureIcon(stroked(marks.join("")));
    expect(asOne.elements).toBe(1);
    expect(inspect("many", asMany).failed).toContain("element-count");
    expect(inspect("one", asOne).failed).toContain("element-count");
  });

  it("fails a sharp-cornered shape drawn out to the keyline", async () => {
    // Not a false positive: the house takes its corner radius from a tier
    // system, and a square that runs its ink into the corner squares is the
    // shape the 0.43% corpus figure exists to describe. The same square at
    // radius 3 puts nothing there.
    const sharp = await measureIcon(stroked("M4 4H20V20H4V4Z"));
    expect(sharp.cornerInk).toBeGreaterThan(0.03);
    expect(inspect("sharp", sharp).failed).toEqual(["corners-empty"]);
    expect(inspect("round", await measureIcon(good)).failed).toEqual([]);
  });

  it("fails an icon that fills a corner", async () => {
    const m = await measureIcon(stroked("M2 2H4V4H2V2Z"));
    expect(inspect("cornered", m).failed).toContain("corners-empty");
  });

  it("names the measurement that failed, not just the rule", async () => {
    const verdict = inspect(
      "big",
      await measureIcon(stroked("M2 2H22V22H2V2Z"))
    );
    expect(verdict.reasons.join(" ")).toMatch(/24\.00|22\.00/u);
  });
});

describe("floors", () => {
  it("sits under what the corpus itself achieves, on every check", () => {
    for (const c of CHECKS) {
      expect(floorFor(c)).toBeLessThan(c.corpusRate);
      // A floor above the corpus rate would fail the set the targets came from;
      // a floor at zero would pass anything.
      expect(floorFor(c)).toBeGreaterThan(0.5);
    }
  });
});

describe("wilsonUpper", () => {
  it("is the observed rate for a large sample and much more for a small one", () => {
    expect(wilsonUpper(700, 1000)).toBeCloseTo(0.7, 1);
    expect(wilsonUpper(17, 24)).toBeGreaterThan(0.85);
    expect(wilsonUpper(0, 0)).toBe(0);
    expect(wilsonUpper(0, 20)).toBeLessThan(0.2);
  });

  it("lets a 24-icon run draw as badly as the corpus without failing", () => {
    // The corpus centres 72% of its icons; the floor is 59%. A 24-icon run that
    // lands 4 points under the corpus rate must not be rejected for it.
    expect(wilsonUpper(16, 24)).toBeGreaterThan(floorFor(check("centred")));
  });

  it("still fails a run that is genuinely much worse", () => {
    expect(wilsonUpper(8, 24)).toBeLessThan(floorFor(check("centred")));
  });
});

describe("panel", () => {
  it("passes a set drawn to the spec and says what it does not mean", async () => {
    const report = await panel(
      Array.from({ length: 8 }, (_, i) => ({ name: `icon-${i}`, svg: good }))
    );
    expect(report.usable).toBe(true);
    expect(report.verdict).toMatch(/^PASS/u);
    expect(report.verdict).toMatch(/not evidence the drawings are good/u);
  });

  it("fails a set that is off-spec in a way cosine cannot see", async () => {
    // Every icon 0.75u off centre — well inside the cosine noise band, and a
    // straight fail here.
    const off = stroked("M4.75 4H20.75V20H4.75V4Z");
    const report = await panel(
      Array.from({ length: 20 }, (_, i) => ({ name: `icon-${i}`, svg: off }))
    );
    expect(report.usable).toBe(false);
    expect(report.verdict).toMatch(/^FAIL/u);
    expect(report.checks.find((c) => c.name === "centred")?.usable).toBe(false);
    expect(report.checks.find((c) => c.name === "extent")?.usable).toBe(true);
  });

  it("names failing icons, capped, so a broken set does not print itself", async () => {
    const off = stroked("M4.75 4H20.75V20H4.75V4Z");
    const report = await panel(
      Array.from({ length: 20 }, (_, i) => ({ name: `icon-${i}`, svg: off }))
    );
    const centred = report.checks.find((c) => c.name === "centred");
    expect(centred?.failures).toHaveLength(5);
    expect(centred?.failures[0]).toMatch(/icon-0 — centre/u);
  });

  it("treats an empty run as a failure", async () => {
    const report = await panel([]);
    expect(report.usable).toBe(false);
    expect(report.verdict).toMatch(/nothing to measure/u);
  });
});
