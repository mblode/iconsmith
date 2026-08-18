import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, test } from "vitest";

import { census, nameElement } from "./census.js";

/** A distinctive open shape — enough nodes to fingerprint, and asymmetric so it
 *  cannot be confused with a plain box. `s` scales it; `x`/`y` place it. */
const shape = (s: number, x: number, y: number) =>
  `M${x} ${y}L${x + 6 * s} ${y}L${x + 6 * s} ${y + 2 * s}` +
  `L${x + 10 * s} ${y + 2 * s}L${x + 10 * s} ${y + 8 * s}L${x} ${y + 8 * s}Z`;

const icons = (entries: Record<string, string>): string => {
  const dir = mkdtempSync(path.join(tmpdir(), "census-"));
  for (const [name, d] of Object.entries(entries)) {
    writeFileSync(
      path.join(dir, `${name}.svg`),
      `<svg viewBox="0 0 24 24"><path d="${d}" stroke="currentColor" stroke-width="2"/></svg>`
    );
  }
  return dir;
};

describe("nameElement", () => {
  test("names the object, not the modifier that varies around it", () => {
    const { confidence, name } = nameElement([
      "folder-add",
      "folder-lock",
      "folder-open",
    ]);
    expect(name).toBe("folder");
    expect(confidence).toBe(1);
  });

  test("confidence falls when the icons share no object", () => {
    const { confidence, name } = nameElement(["folder-add", "car", "bell"]);
    expect(confidence).toBeLessThan(0.5);
    expect(name).toBeTruthy();
  });

  test("no icons is no name rather than a crash", () => {
    expect(nameElement([])).toEqual({ confidence: 0, name: "" });
  });
});

describe("census", () => {
  test("an element drawn identically everywhere is uniform", () => {
    const dir = icons({
      "box-add": shape(1, 4, 6),
      "box-edit": shape(1, 4, 6),
      "box-lock": shape(1, 4, 6),
    });
    const r = census(dir);
    expect(r.recurring).toBe(1);
    expect(r.uniform).toBe(1);
    expect(r.sizeSplit).toHaveLength(0);
    expect(r.elements[0].name).toBe("box");
  });

  test("one icon drawing it larger is a size split naming that icon", () => {
    const dir = icons({
      "box-add": shape(1, 4, 6),
      "box-edit": shape(1, 4, 6),
      "box-lock": shape(1, 4, 6),
      "box-wide": shape(1.5, 3, 4),
    });
    const r = census(dir);
    expect(r.sizeSplit).toHaveLength(1);
    expect(r.sizeSplit[0].minority).toEqual(["box-wide"]);
    expect(r.sizeSplit[0].consistentSize).toBe(false);
    expect(r.sizeSplit[0].scaleSpread).toBeGreaterThan(1.4);
  });

  test("the same size in a different place is a place split, not a size one", () => {
    // The distinction the whole census turns on. A rectangle a layout icon
    // moves between slots is doing its job; the same rectangle drawn at two
    // sizes is the defect the article is about.
    const dir = icons({
      "slot-a": shape(1, 3, 3),
      "slot-b": shape(1, 3, 3),
      "slot-c": shape(1, 3, 3),
      "slot-d": shape(1, 10, 10),
    });
    const r = census(dir);
    expect(r.sizeSplit).toHaveLength(0);
    expect(r.placeSplit).toHaveLength(1);
    expect(r.placeSplit[0].minority).toEqual(["slot-d"]);
  });

  test("an element in fewer icons than the floor does not recur yet", () => {
    const r = census(
      icons({ "box-a": shape(1, 4, 6), "box-b": shape(1, 4, 6) })
    );
    expect(r.recurring).toBe(0);
  });

  test("blast radius counts the icons that disagree, not the icons that use it", () => {
    // Ranking by cluster size buries a family where half the members disagree
    // beneath one that merely recurs a lot with two stragglers.
    const many: Record<string, string> = {};
    for (let i = 0; i < 8; i += 1) {
      many[`wide-${i}`] = shape(1, 4, 6);
    }
    many["wide-odd"] = shape(1.5, 3, 4);
    many["thin-a"] = `M2 2L5 2L5 3L8 3L8 7L2 7Z`;
    many["thin-b"] = `M2 2L5 2L5 3L8 3L8 7L2 7Z`;
    many["thin-c"] = `M2 2L5 2L5 3L8 3L8 7L2 7Z`;
    many["thin-d"] = `M12 12L16.5 12L16.5 13.5L24 13.5L24 19.5L12 19.5Z`;
    const r = census(icons(many));
    const ranked = r.sizeSplit.map((e) => e.minority.length);
    expect(ranked).toEqual(ranked.toSorted((a, b) => b - a));
  });
});
