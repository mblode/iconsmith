import { describe, expect, it } from "vitest";

import type { Part } from "../types.js";
import { partCoverage } from "./coverage.js";

const part = (id: string, icons: string[], name?: string): Part => ({
  closed: false,
  d: "M0 0L1 0",
  h: 1,
  icons,
  id,
  instances: icons.length,
  name,
  nodes: 1,
  sizeRange: [1, 1],
  w: 1,
});

const PARTS: Part[] = [
  part("p0", ["folder-1", "folder-open"], "folder"),
  part("p1", ["cloud-sync", "cloud-api"]),
];

describe("partCoverage", () => {
  it("counts a concept the curated name answers on both numbers", () => {
    const c = partCoverage(PARTS, ["folder"]);
    expect(c.covered).toBe(1);
    expect(c.byName).toBe(1);
    expect(c.gaps).toEqual([]);
  });

  it("counts a concept only the provenance answers on the wider number", () => {
    // The point of the pair. `cloud` reaches a shape nothing has named, so it
    // is reach the drawer has and the vocabulary cannot take credit for.
    const c = partCoverage(PARTS, ["cloud"]);
    expect(c.covered).toBe(1);
    expect(c.byName).toBe(0);
  });

  it("reports a concept no part answers as a gap, not as a failure", () => {
    const c = partCoverage(PARTS, ["database"]);
    expect(c.covered).toBe(0);
    expect(c.gaps).toEqual(["database"]);
  });

  it("sorts the gaps, so a re-run diffs against the last one", () => {
    const c = partCoverage(PARTS, ["zebra", "aardvark", "folder"]);
    expect(c.gaps).toEqual(["aardvark", "zebra"]);
    expect(c.concepts).toBe(3);
  });
});
