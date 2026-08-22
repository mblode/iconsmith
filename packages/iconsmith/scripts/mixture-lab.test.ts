import { describe, expect, it } from "vitest";

import { evidenceOf, gate, packIndexFromSlugs } from "../src/pipeline/mixture.js";

import { labNames } from "./mixture-lab.js";

describe("mixture-lab", () => {
  it("defaults to the four demo names", () => {
    expect(labNames(["tsx", "mixture-lab.ts"])).toEqual([
      "plus",
      "home",
      "database",
      "xyzzy",
    ]);
    expect(labNames(["tsx", "mixture-lab.ts", "wifi"])).toEqual(["wifi"]);
  });

  it("classifies the demo set without a model", () => {
    const inventory = packIndexFromSlugs([
      { pack: "heroicons", slug: "database" },
      { pack: "lucide", slug: "database" },
      { pack: "remix", slug: "database" },
      { pack: "tabler", slug: "database" },
    ]);
    expect(gate(evidenceOf({ name: "plus" })).class).toBe("keyed-mark");
    expect(gate(evidenceOf({ name: "home" })).class).toBe("analog-family");
    expect(
      gate(evidenceOf({ name: "database" }, {}, { inventory })).class
    ).toBe("pack-inventory");
    expect(gate(evidenceOf({ name: "xyzzy" })).class).toBe("net-new");
  });
});
