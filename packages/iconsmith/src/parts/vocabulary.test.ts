import { existsSync } from "node:fs";

import { describe, expect, it } from "vitest";

import type { Part } from "../types.js";
import { extractParts } from "./extract.js";
import { nameParts, VOCABULARY } from "./vocabulary.js";

/** A part carrying one of the vocabulary's own reference drawings. */
const partOf = (d: string, id: string): Part => ({
  closed: d.trimEnd().endsWith("Z"),
  d,
  h: 1,
  icons: [],
  id,
  instances: 1,
  nodes: 1,
  sizeRange: [1, 1],
  w: 1,
});

describe("VOCABULARY", () => {
  it("has no duplicate names", () => {
    const names = VOCABULARY.map((v) => v.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("names every mark it claims to, and only once", () => {
    const parts = VOCABULARY.map((v, i) => partOf(v.d, `p${i}`));
    const named = nameParts(parts);
    expect(named.map((p) => p.name)).toEqual(VOCABULARY.map((v) => v.name));
  });
});

describe("nameParts", () => {
  it("leaves a part no name recognises alone", () => {
    const [named] = nameParts([partOf("M0 0L1 0.4L0.2 1.4L1.3 2Z", "p0")]);
    expect(named.name).toBeUndefined();
  });

  it("does not mutate the parts it is given", () => {
    const part = partOf(VOCABULARY[0].d, "p0");
    nameParts([part]);
    expect(part.name).toBeUndefined();
  });

  it("gives a name to the part that fits it best, not the first that fits", () => {
    // The reference drawing itself scores 0, so it must win over a near miss
    // that is still inside the threshold — this is what stops one name
    // landing on a proportion variant of the mark it was read off.
    const [{ d, name }] = VOCABULARY;
    const named = nameParts([partOf("M0 0L6 0.3", "near"), partOf(d, "exact")]);
    expect(named.find((p) => p.name === name)?.id).toBe("exact");
  });
});

// The set the names were read off. Gitignored and 247MB, so the check runs
// whenever it is present — see `corpus/measure.test.ts`.
const HOUSE = "corpus/round-outlined-radius-3-stroke-2";

describe.skipIf(!existsSync(HOUSE))("against the set it was read off", () => {
  it("lands every name on a part of the real extraction, one name each", () => {
    // The reference drawings are pairwise distinguishable — the test above
    // proves that — but pairwise is not enough here. `nameParts` assigns
    // greedily over the whole extraction, so a name added later can sit nearer
    // to a part an earlier name was read off, take it, and leave that earlier
    // name matching nothing at all. Nothing about the vocabulary's source shows
    // that; only running it against the set does.
    const { parts } = extractParts(HOUSE);
    const named = nameParts(parts).filter((p) => p.name !== undefined);

    expect(named).toHaveLength(VOCABULARY.length);
    expect(new Set(named.map((p) => p.name)).size).toBe(VOCABULARY.length);
  });
});
