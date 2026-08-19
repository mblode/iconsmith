import { describe, expect, it } from "vitest";

import { parseSpread } from "./noise-floor.js";

describe("deriving the acceptance threshold", () => {
  it("reads the spread the seeded run reports", () => {
    const out = [
      "    treatment  0.612  ████  this pipeline (median)",
      "  spread 0.043 — a later change smaller than this has moved nothing.",
    ].join("\n");
    expect(parseSpread(out)).toEqual({ spread: 0.043, treatment: 0.612 });
  });

  it("refuses a single-seed run rather than inventing a floor", () => {
    expect(() => parseSpread("    treatment  0.612")).toThrow(/--seeds/u);
  });
});
