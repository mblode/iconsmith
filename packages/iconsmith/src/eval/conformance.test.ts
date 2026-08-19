import { existsSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { loadRecords } from "../pipeline/bench.js";
import {
  calibrateConformance,
  ConformanceCalibrationError,
  countIssues,
  PACK_VARIANTS,
  packRates,
  passesGate,
  passesStrict,
} from "./conformance.js";
import type { ConformanceRecord } from "./conformance.js";

/** `usage` decides whether a pack may stand for third-party practice, and it
 *  is the record's own field: the house set and Central are `conditioning`,
 *  everything under someone else's licence is `analysis-only`. */
const record = (
  set: string,
  variant: string,
  lints: { errors: number; warnings: number }[],
  usage = "analysis-only"
): ConformanceRecord => ({
  provenance: { set, usage },
  renderings: lints.map((lint) => ({ lint, variant })),
});

describe("the gate", () => {
  it("passes an icon with warnings but no errors", () => {
    expect(passesGate({ errors: 0, warnings: 3 })).toBe(true);
    expect(passesStrict({ errors: 0, warnings: 3 })).toBe(false);
  });

  it("counts by severity", () => {
    expect(
      countIssues([
        { message: "", rule: "empty", severity: "error" },
        { message: "", rule: "centred", severity: "warn" },
        { message: "", rule: "gap", severity: "warn" },
      ])
    ).toEqual({ errors: 1, warnings: 2 });
  });
});

describe("packRates", () => {
  it("reads one rendering per icon, not all of them", () => {
    // Central ships 30 finishes of every symbol. Counting all of them would
    // weight Central 30× and measure stroke width rather than conformance, so
    // only the house variant is read and the other finishes are ignored —
    // including the deliberately filthy ones below.
    const records = Array.from({ length: 60 }, () => ({
      provenance: { set: "central", usage: "conditioning" },
      renderings: [
        {
          lint: { errors: 0, warnings: 0 },
          variant: "round-outlined-radius-3-stroke-2",
        },
        {
          lint: { errors: 5, warnings: 5 },
          variant: "square-filled-radius-0-stroke-1",
        },
        {
          lint: { errors: 5, warnings: 5 },
          variant: "round-filled-radius-1-stroke-2",
        },
      ],
    }));
    const [central] = packRates(records);
    expect(central.n).toBe(60);
    expect(central.strict).toBe(1);
  });

  it("skips a rendering that is not the pack's chosen variant", () => {
    const records = Array.from({ length: 60 }, () =>
      record("lucide", "solid", [{ errors: 9, warnings: 9 }])
    );
    expect(packRates(records)).toEqual([]);
  });

  it("drops a pack too small for its rate to mean anything", () => {
    const records = Array.from({ length: 3 }, () =>
      record("radix", "regular", [{ errors: 0, warnings: 0 }])
    );
    expect(packRates(records)).toEqual([]);
  });

  it("marks the fill sets as unusable for a stroke floor", () => {
    for (const set of ["phosphor", "radix", "remix"]) {
      expect(PACK_VARIANTS[set].stroke).toBe(false);
    }
  });
});

describe("calibrateConformance", () => {
  const house = Array.from({ length: 100 }, (_, i) =>
    record(
      "blode-icons",
      "outlined",
      [{ errors: i < 5 ? 1 : 0, warnings: i < 60 ? 1 : 0 }],
      "conditioning"
    )
  );
  const tabler = Array.from({ length: 200 }, (_, i) =>
    record("tabler", "outline", [{ errors: 0, warnings: i < 180 ? 1 : 0 }])
  );
  const lucide = Array.from({ length: 100 }, () =>
    record("lucide", "regular", [{ errors: 0, warnings: 1 }])
  );

  it("takes the ceiling from the house set and never from 1", () => {
    const c = calibrateConformance([...house, ...tabler]);
    expect(c.ceiling.set).toBe("blode-icons");
    expect(c.ceiling.gate).toBeCloseTo(0.95);
    expect(c.ceiling.strict).toBeCloseTo(0.4);
    expect(c.ceiling.strict).toBeLessThan(1);
  });

  it("pools the floor by icon, so a small pack cannot outweigh a large one", () => {
    const c = calibrateConformance([...house, ...tabler, ...lucide]);
    // tabler 20/200 strict + lucide 0/100 = 20/300, not the mean of 0.1 and 0.
    expect(c.floor.strict).toBeCloseTo(20 / 300);
    expect(c.floor.n).toBe(300);
  });

  it("takes the baseline from the best single third-party pack", () => {
    const c = calibrateConformance([...house, ...tabler, ...lucide]);
    expect(c.baseline.set).toBe("tabler");
  });

  it("keeps fill sets out of the floor and names why", () => {
    const phosphor = Array.from({ length: 100 }, () =>
      record("phosphor", "regular", [{ errors: 0, warnings: 0 }])
    );
    const c = calibrateConformance([...house, ...tabler, ...phosphor]);
    expect(c.floor.sets).not.toContain("phosphor");
    expect(c.excluded.map((e) => e.set)).toContain("phosphor");
    expect(c.excluded.find((e) => e.set === "phosphor")?.reason).toContain(
      "outline-expanded"
    );
    // A perfect fill set would have dragged the floor to 1 and made every
    // reach negative. It is reported and not averaged.
    expect(c.floor.strict).toBeLessThan(0.2);
  });

  it("refuses to calibrate with no house set rather than assuming a ceiling of 1", () => {
    expect(() => calibrateConformance(tabler)).toThrow(
      ConformanceCalibrationError
    );
  });

  it("refuses to calibrate with no third-party stroke pack", () => {
    expect(() => calibrateConformance(house)).toThrow(
      ConformanceCalibrationError
    );
  });

  it("keeps Central out of the third-party floor", () => {
    // blode-icons is ~96% Central-derived, so a Central rate is the house set's
    // own practice under another name. Counting it as third-party would make
    // the house spec look universal, which is the opposite of what the floor is
    // measuring.
    const central = Array.from({ length: 200 }, () =>
      record(
        "central",
        "round-outlined-radius-3-stroke-2",
        [{ errors: 0, warnings: 0 }],
        "conditioning"
      )
    );
    const c = calibrateConformance([...house, ...tabler, ...central]);
    expect(c.floor.sets).not.toContain("central");
    expect(c.baseline.set).toBe("tabler");
  });
});

describe("against the real store", () => {
  const store = ".corpus/icons.jsonl";
  it.skipIf(!existsSync(store))(
    "shows the house spec is non-trivial: the house set beats every third-party pack on the strict rate",
    () => {
      const records = loadRecords(store) as unknown as ConformanceRecord[];
      const c = calibrateConformance(records);
      expect(c.ceiling.set).toBe("blode-icons");
      expect(c.ceiling.strict).toBeGreaterThan(c.baseline.strict);
      // If a professional set already satisfied the spec, the spec would be
      // describing icon design in general rather than this house.
      expect(c.baseline.strict).toBeLessThan(0.5);
      expect(c.ceiling.strict).toBeLessThan(1);
    }
  );
});
