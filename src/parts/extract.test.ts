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
