import { describe, expect, it } from "vitest";

import { parseSpread } from "./noise-floor.js";

describe("deriving the acceptance threshold", () => {
  it("reads the spread the seeded run reports", () => {
    const out = [
      "reconstruction eval — 30/30 benchmark icons, run seed 1",
      "reconstruction eval — 30/30 benchmark icons, run seed 2",
      "    treatment  0.612  ████  this pipeline (median)",
      "  spread 0.043 — a later change smaller than this has moved nothing.",
    ].join("\n");
    expect(parseSpread(out)).toEqual({ spread: 0.043, treatment: 0.612 });
  });

  it("refuses a run where a replicate never drew anything", () => {
    const out = [
      "reconstruction eval — 30/30 benchmark icons, run seed 1",
      "reconstruction eval — 0/30 benchmark icons, run seed 2",
      "  spread 0.672 — a later change smaller than this has moved nothing.",
    ].join("\n");
    expect(() => parseSpread(out)).toThrow(/drew no icons at all/u);
  });

  it("refuses replicates that scored different numbers of icons", () => {
    const out = [
      "reconstruction eval — 30/30 benchmark icons, run seed 1",
      "reconstruction eval — 6/30 benchmark icons, run seed 2",
      "  spread 0.065 — a later change smaller than this has moved nothing.",
    ].join("\n");
    expect(() => parseSpread(out)).toThrow(/different numbers of icons/u);
  });

  it("refuses a run that hit its spend cap", () => {
    const out = [
      "reconstruction eval — 30/30 benchmark icons, run seed 1",
      "reconstruction eval — 30/30 benchmark icons, run seed 2",
      "Stopped after $8.42 of a $7.00 cap.",
      "  spread 0.065 — a later change smaller than this has moved nothing.",
    ].join("\n");
    expect(() => parseSpread(out)).toThrow(/spend cap/u);
  });

  it("refuses a single-seed run rather than inventing a floor", () => {
    expect(() => parseSpread("    treatment  0.612")).toThrow(/--seeds/u);
  });
});
