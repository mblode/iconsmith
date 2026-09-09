import { describe, expect, it } from "vitest";

import type { Part } from "../types.js";
import { rankParts } from "./search.js";

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
  part("p0", ["square-arrow-top-right"]),
  part("p1", ["link-chain"], "link"),
];

const ALIASES = new Map([
  ["square-arrow-top-right", ["open", "new", "open link", "box"]],
]);

describe("rankParts with aliases", () => {
  it("finds a part through a word no filename spells", () => {
    // The whole case for the table. `open link` is what somebody types when
    // they mean this icon, and nothing in `square-arrow-top-right` says it.
    expect(rankParts(PARTS, "open", 5)).toHaveLength(0);
    expect(rankParts(PARTS, "open", 5, ALIASES).map((m) => m.part.id)).toEqual([
      "p0",
    ]);
  });

  it("ranks an alias hit below a curated name for the same word", () => {
    // `link` is p1's deliberate label and p0's third-party synonym. A table
    // that let the synonym win would put the wrong shape in front of a model
    // that asked the vocabulary a direct question.
    const ranked = rankParts(PARTS, "link", 5, ALIASES);
    expect(ranked.map((m) => m.part.id)).toEqual(["p1", "p0"]);
  });

  it("counts an icon matched both ways once", () => {
    // Otherwise a part whose provenance is rich in a word scores twice for one
    // piece of evidence, and the ranking drifts toward whatever the alias file
    // happens to repeat.
    const both = new Map([["link-chain", ["link", "chain"]]]);
    const withTable = rankParts(PARTS, "link", 5, both);
    const without = rankParts(PARTS, "link", 5);
    expect(withTable[0].hits).toEqual(without[0].hits);
  });

  it("changes nothing when the table is empty", () => {
    // The default. A caller that has not been wired up must get exactly the
    // old ranking, or the coverage delta is not attributable to the wiring.
    expect(rankParts(PARTS, "arrow", 5, new Map())).toEqual(
      rankParts(PARTS, "arrow", 5)
    );
  });

  it("does not offer assembly-only child dependencies for direct placement", () => {
    const privateChild = {
      ...part("private-arrow-shaft", ["arrow-up"], "arrow"),
      sourceAssemblyOnly: "arrow-up-source",
    };
    expect(rankParts([...PARTS, privateChild], "arrow", 5)).toEqual([
      expect.objectContaining({ part: expect.objectContaining({ id: "p0" }) }),
    ]);
  });
});
