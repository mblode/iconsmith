/**
 * Bucketing is the half of the clusterer that no `distance` test can cover:
 * two candidates in different buckets are never compared at all, so a bucket
 * key that splits a turned instance from its original loses the merge silently
 * — the parts list just quietly grows. These tests run the real extractor over
 * a directory so the bucket and the metric are exercised together.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { extractParts } from "./extract.js";

/** A chevron 4 wide and 10 tall, and the same mark turned a quarter-turn to
 *  10 wide and 4 tall — the transposition that used to split one part in two. */
const CHEVRON = "M4 4L8 9L4 14";
const CHEVRON_TURNED = "M16 4L11 8L6 4";
/** Nothing like a chevron, and it must survive as its own part. */
const STROKE = "M4 4L4 14";

const dir = mkdtempSync(path.join(tmpdir(), "icon-forge-parts-"));

const icon = (name: string, d: string) => {
  writeFileSync(
    path.join(dir, `${name}.svg`),
    `<svg viewBox="0 0 24 24"><path d="${d}"/></svg>`
  );
};

icon("chevron-right", CHEVRON);
icon("chevron-up", CHEVRON_TURNED);
icon("stroke", STROKE);

afterAll(() => {
  rmSync(dir, { force: true, recursive: true });
});

describe("extractParts clustering", () => {
  const result = extractParts(dir);

  it("gives a mark and its quarter-turn one part between them", () => {
    const chevron = result.parts.find((p) => p.icons.length === 2);
    expect(chevron?.icons).toEqual(["chevron-right", "chevron-up"]);
  });

  it("does not merge everything it now compares", () => {
    expect(result.summary.parts).toBe(2);
    const stroke = result.parts.find((p) => p.icons.length === 1);
    expect(stroke?.icons).toEqual(["stroke"]);
  });
});

describe("recorded orientations", () => {
  const result = extractParts(dir);

  it("records which turn each instance was drawn at", () => {
    const chevron = result.parts.find((p) => p.icons.length === 2);
    const turns = chevron?.turns ?? [0, 0, 0, 0];
    // Two instances, one at the canonical orientation and one a quarter-turn
    // from it — which is the whole reason the two icons share a part.
    expect(turns.reduce((a, b) => a + b, 0)).toBe(chevron?.instances);
    expect(turns[0]).toBe(1);
    expect(turns[1] + turns[3]).toBe(1);
  });

  it("leaves a part the set only draws one way at the identity turn", () => {
    const stroke = result.parts.find((p) => p.icons.length === 1);
    expect(stroke?.turns).toStrictEqual([1, 0, 0, 0]);
  });
});

/**
 * The style split. The residue an outline-expanded icon contributes is not
 * subtly wrong-looking — it is a 16x2 rectangle, the outline of a straight
 * stroke — so the fixtures below make it exactly that, and a test can ask
 * whether that rectangle became a part.
 */
const STROKED = 'stroke="currentColor" stroke-width="2"';
/** A chevron, drawn in stroke. Real vocabulary. */
const MARK = `<path d="${CHEVRON}" ${STROKED}/>`;
/** The body of a horizontal stroke, expanded: no stroke, just its contour. */
const BODY = '<path d="M4 11H20V13H4Z" fill="currentColor"/>';
/** A filled diamond of the kind that sits inside an otherwise stroked drawing
 *  — a dot, a sparkle, a solid arrowhead. Real vocabulary, and filled. */
const INLAY = '<path d="M12 8L16 12L12 16L8 12Z" fill="currentColor"/>';

const styleDir = mkdtempSync(path.join(tmpdir(), "icon-forge-styles-"));
const expandedDir = mkdtempSync(path.join(tmpdir(), "icon-forge-expanded-"));

const write = (into: string, name: string, body: string) => {
  writeFileSync(
    path.join(into, `${name}.svg`),
    `<svg viewBox="0 0 24 24" fill="none">${body}</svg>`
  );
};

write(styleDir, "stroked-a", MARK);
write(styleDir, "stroked-b", MARK);
write(styleDir, "mixed", `${MARK}${INLAY}`);
write(styleDir, "expanded-a", BODY);
write(styleDir, "expanded-b", BODY);
write(expandedDir, "expanded-a", BODY);
write(expandedDir, "expanded-b", BODY);

afterAll(() => {
  rmSync(styleDir, { force: true, recursive: true });
  rmSync(expandedDir, { force: true, recursive: true });
});

/** Is this part the 16x2 rectangle only an expanded stroke draws? */
const isResidue = (p: { h: number; w: number }) => p.w === 16 && p.h === 2;

describe("drawing styles", () => {
  it("counts each style and reports which one it used", () => {
    const { summary } = extractParts(styleDir);
    expect(summary.styles).toStrictEqual({
      expanded: 2,
      stroked: 3,
      used: "stroked",
    });
    expect(summary.scanned).toBe(5);
    expect(summary.icons).toBe(3);
  });

  it("keeps stroke residue out of the vocabulary by default", () => {
    const { parts } = extractParts(styleDir);
    expect(parts.some(isResidue)).toBe(false);
  });

  it("keeps the filled shapes inside a stroked icon", () => {
    // The verdict is per icon, not per path: `mixed` carries a filled diamond
    // and it has to survive, or the rule throws away every dot and sparkle in
    // the set along with the residue.
    const { parts } = extractParts(styleDir);
    const inlay = parts.find((p) => p.icons.includes("mixed") && p.closed);
    expect(inlay?.icons).toStrictEqual(["mixed"]);
  });

  it("lets a caller ask for the residue anyway", () => {
    const { parts, summary } = extractParts(styleDir, { styles: "all" });
    expect(summary.icons).toBe(5);
    expect(parts.some(isResidue)).toBe(true);
  });

  it("extracts from a wholly expanded set rather than returning nothing", () => {
    const { parts, summary } = extractParts(expandedDir);
    // Nothing here is residue relative to anything else — this is the set's own
    // vocabulary, and an empty list would be the worse answer.
    expect(summary.styles.used).toBe("all");
    expect(parts.some(isResidue)).toBe(true);
  });

  it("takes only expanded icons when asked for them", () => {
    const { parts, summary } = extractParts(styleDir, { styles: "expanded" });
    expect(summary.icons).toBe(2);
    expect(parts.every(isResidue)).toBe(true);
  });
});
