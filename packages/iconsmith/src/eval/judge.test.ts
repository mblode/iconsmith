import { describe, expect, it } from "vitest";

import {
  GATE_THRESHOLD,
  pair,
  parsePick,
  scoreGate,
  slotFor,
} from "./judge.js";
import type { GateTrial, Slot } from "./judge.js";

describe("presentation order", () => {
  it("is stable for one seed and icon", () => {
    expect(slotFor(1, "folder-open")).toBe(slotFor(1, "folder-open"));
  });

  it("varies across icons, so the judge cannot learn the position", () => {
    const slots = new Set<Slot>(
      Array.from({ length: 40 }, (_, i) => slotFor(1, `icon-${i}`))
    );
    expect(slots.size).toBe(2);
  });

  it("puts the candidate in the slot it reports", () => {
    const candidate = Buffer.from("candidate");
    const other = Buffer.from("other");
    const p = pair(candidate, other, 1, "bell");
    expect(p[p.candidate]).toBe(candidate);
  });
});

const trials = (right: number, total: number): GateTrial[] =>
  Array.from({ length: total }, (_, i) => ({
    answer: "a",
    icon: `i${i}`,
    pick: i < right ? "a" : "b",
  }));

describe("scoreGate", () => {
  it("passes at the threshold", () => {
    const g = scoreGate(trials(18, 20));
    expect(g.accuracy).toBe(GATE_THRESHOLD);
    expect(g.passed).toBe(true);
  });

  it("discards the column just below the threshold, with no partial credit", () => {
    // A "weak but usable" judge is exactly the one that gets averaged into a
    // headline and quietly moves it.
    const g = scoreGate(trials(17, 20));
    expect(g.passed).toBe(false);
    expect(g.verdict).toContain("discarded");
  });

  it("counts an unparseable answer as a miss", () => {
    const g = scoreGate([
      { answer: "a", icon: "x", pick: null },
      ...trials(19, 19),
    ]);
    expect(g.accuracy).toBeLessThan(1);
  });

  it("fails with no trials rather than passing vacuously", () => {
    expect(scoreGate([]).passed).toBe(false);
  });
});

describe("parsePick", () => {
  it("reads either case", () => {
    expect(parsePick('{"pick": "A"}')).toBe("a");
    expect(parsePick('{"pick": "b", "why": "…"}')).toBe("b");
  });

  it("is null when the judge did not pick", () => {
    expect(parsePick('{"why": "both are fine"}')).toBeNull();
  });
});
