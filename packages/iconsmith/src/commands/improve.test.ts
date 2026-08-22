import { describe, expect, it } from "vitest";

import { inventoryNames, splitConcepts } from "./improve.js";

describe("splitConcepts", () => {
  it("halves an unnamed list and keeps an explicit split", () => {
    expect(splitConcepts(["a", "b", "c", "d"])).toEqual({
      feedback: ["a", "b"],
      selection: ["c", "d"],
    });
    expect(splitConcepts(["only"])).toEqual({
      feedback: ["only"],
      selection: [],
    });
    expect(splitConcepts(["a", "b"], ["a"], ["b"])).toEqual({
      feedback: ["a"],
      selection: ["b"],
    });
  });
});

describe("inventoryNames", () => {
  it("reads names and pack consensus, never geometry", () => {
    const loaded = inventoryNames([
      {
        name: "database",
        packs: 4,
        sets: ["heroicons", "lucide", "remix", "tabler"],
      },
      "wifi",
    ]);
    expect(loaded.names).toEqual(["database", "wifi"]);
    expect(loaded.packs.get("database")).toEqual([
      "heroicons",
      "lucide",
      "remix",
      "tabler",
    ]);
  });

  it("refuses a d field on an inventory row", () => {
    expect(() =>
      inventoryNames([{ d: "M0 0", name: "database", sets: ["lucide"] }])
    ).toThrow(/d/u);
  });
});
