import { describe, expect, it } from "vitest";

import type { Calibration } from "./calibration.js";
import { scoreGate } from "./judge.js";
import type { GateTrial } from "./judge.js";
import { buildReport, formatMetrics } from "./report.js";

const calibration = (over: Partial<Calibration> = {}): Calibration => ({
  builtAt: "2026-08-19T00:00:00.000Z",
  conformance: {
    baseline: { gate: 0.999, set: "tabler", strict: 0.222 },
    ceiling: { gate: 0.966, n: 2221, set: "blode-icons", strict: 0.338 },
    excluded: [{ reason: "outline-expanded fills", set: "phosphor" }],
    floor: { gate: 0.98, n: 8794, sets: ["tabler", "lucide"], strict: 0.2 },
    packs: [],
  },
  judge: { note: "not measured" },
  procedure: {},
  records: 18_658,
  sample: 300,
  semantic: {
    bank: 2203,
    baseline: 0.2,
    baselineMargin: 0,
    baselineN: 300,
    ceiling: 0.263,
    ceilingMargin: 0,
    ceilingN: 300,
    floor: 0.02,
    floorMargin: 0,
    floorN: 300,
    model: "siglip",
    prompt: "p",
    separation: { auc: 0.72, usable: true, verdict: "semantic: ok" },
  },
  style: {
    baseline: 0.5,
    baselineN: 300,
    ceiling: 0.8,
    ceilingN: 300,
    floor: 0.4,
    floorN: 300,
    k: 10,
    model: "dino",
    separation: { auc: 0.8, usable: true, verdict: "style: ok" },
  },
  ...over,
});

const treatments = {
  conformanceGate: 0.9,
  conformanceStrict: 0.25,
  judge: 6,
  semantic: 0.21,
  style: 0.52,
};

const passingGate = scoreGate(
  Array.from({ length: 20 }, (_, i) => ({
    answer: "a",
    icon: `i${i}`,
    pick: "a",
  })) as GateTrial[]
);

describe("buildReport", () => {
  it("reports each metric against its own measured scale", () => {
    const r = buildReport(
      calibration(),
      treatments,
      { disqualified: 3, n: 27 },
      passingGate
    );
    expect(r.style?.reach).toBeCloseTo((0.52 - 0.4) / (0.5 - 0.4));
    expect(r.semantic?.reach).toBeCloseTo((0.21 - 0.02) / (0.2 - 0.02));
    expect(r.conformance.strict.ceiling).toBe(0.338);
    expect(r.acceptance).toEqual({
      contractVersion: null,
      envelopeValid: false,
      evidencePresent: false,
      qualification: false,
      reasons: ["Acceptance evidence was not supplied"],
    });
  });

  it("validates supplied acceptance evidence in the existing report", () => {
    const r = buildReport(
      calibration(),
      treatments,
      { disqualified: 0, n: 30 },
      passingGate,
      {
        contractVersion: "wrong-version",
        expectedSlots: [],
        gates: [],
        outputs: [],
        uncertainty: { method: "", resamplingCount: 0, seed: "" },
      }
    );
    expect(r.acceptance).toMatchObject({
      contractVersion: "wrong-version",
      envelopeValid: false,
      evidencePresent: true,
      qualification: false,
    });
    expect(r.acceptance.reasons).toContain(
      "Acceptance contract or expected-slot identity is invalid"
    );
  });

  it("never puts a conformance ceiling at 1", () => {
    const r = buildReport(
      calibration(),
      treatments,
      { disqualified: 0, n: 30 },
      passingGate
    );
    expect(r.conformance.gate.ceiling).toBeLessThan(1);
    expect(r.conformance.strict.ceiling).toBeLessThan(1);
  });

  it("counts disqualified icons into the conformance n and out of the rest", () => {
    // A pipeline that scores well on the three icons that survived the gate is
    // not a good pipeline, so the gate's denominator is every icon.
    const r = buildReport(
      calibration(),
      treatments,
      { disqualified: 3, n: 27 },
      passingGate
    );
    expect(r.conformance.gate.n).toBe(30);
    expect(r.style?.n).toBe(27);
    expect(r.disqualified).toBe(3);
  });

  it("discards the judge column when the judge failed its sanity gate", () => {
    const failing = scoreGate(
      Array.from({ length: 20 }, (_, i) => ({
        answer: "a",
        icon: `i${i}`,
        pick: i < 10 ? "a" : "b",
      })) as GateTrial[]
    );
    const r = buildReport(
      calibration(),
      treatments,
      { disqualified: 0, n: 30 },
      failing
    );
    expect(r.judge).toBeNull();
    expect(r.unavailable.join(" ")).toContain("FAILED");
  });

  it("discards a metric that cannot tell its own baseline from its own floor", () => {
    // The same discipline the judge is held to. A style metric whose baseline
    // beats its floor 48% of the time is not a weak signal to discount; a reach
    // computed against a scale that narrow is the sampling noise, amplified.
    const r = buildReport(
      calibration({
        style: {
          baseline: 0.907,
          baselineN: 300,
          ceiling: 0.914,
          ceilingN: 300,
          floor: 0.91,
          floorN: 300,
          k: 10,
          model: "dino",
          separation: {
            auc: 0.476,
            usable: false,
            verdict: "style: DISCARDED — baseline beats floor only 48%",
          },
        },
      }),
      treatments,
      { disqualified: 0, n: 30 },
      passingGate
    );
    expect(r.style).toBeNull();
    expect(r.unavailable.join(" ")).toContain("DISCARDED");
  });

  it("reports null and a reason when a metric was never calibrated", () => {
    const r = buildReport(
      calibration({ style: { note: "no DINO sidecars on disk" } }),
      treatments,
      { disqualified: 0, n: 30 },
      passingGate
    );
    expect(r.style).toBeNull();
    expect(r.unavailable.join(" ")).toContain("no DINO sidecars");
  });

  it("reports null and a reason when calibration exists but the candidates were not embedded", () => {
    // The distinction matters: "we never measured this" and "this scored zero"
    // are different facts, and one number cannot carry both.
    const r = buildReport(
      calibration(),
      { ...treatments, style: null },
      { disqualified: 0, n: 30 },
      passingGate
    );
    expect(r.style?.treatment).toBeNull();
    expect(r.style?.reach).toBeNull();
    expect(r.unavailable.join(" ")).toContain("embed.py");
  });
});

describe("formatMetrics", () => {
  it("says conformance is a gate and names the excluded fill sets", () => {
    const c = calibration();
    const text = formatMetrics(
      buildReport(c, treatments, { disqualified: 3, n: 27 }, passingGate)
    );
    expect(text).toContain("GATE, never averaged");
    expect(text).toContain("phosphor");
    expect(text).toContain("3 disqualified");
    expect(text).toContain("acceptance — UNQUALIFIED (no evidence)");
    expect(text).toContain("Acceptance evidence was not supplied");
  });

  it("prints the reason a metric is missing instead of dropping the row", () => {
    const c = calibration({ semantic: { note: "no SigLIP sidecars" } });
    const text = formatMetrics(
      buildReport(c, treatments, { disqualified: 0, n: 30 }, null)
    );
    expect(text).toContain("not reported:");
    expect(text).toContain("no SigLIP sidecars");
    expect(text).toContain("judge: not run");
  });
});
