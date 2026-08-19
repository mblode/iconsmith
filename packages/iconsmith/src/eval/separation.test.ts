import { describe, expect, it } from "vitest";

import { auc, SEPARATION_THRESHOLD, separation } from "./separation.js";

describe("auc", () => {
  it("is 1 when every baseline observation beats every floor one", () => {
    expect(auc([3, 4, 5], [0, 1, 2])).toBe(1);
  });

  it("is 0.5 for identical samples, counting ties as half", () => {
    expect(auc([1, 2, 3], [1, 2, 3])).toBe(0.5);
  });

  it("goes below 0.5 when the floor beats the baseline", () => {
    // Measured on this corpus, DINO style lands here: the "unrelated icon"
    // sample scores slightly *above* the "same concept" one.
    expect(auc([0.907], [0.91])).toBeLessThan(0.5);
  });

  it("is 0.5 rather than NaN for an empty sample", () => {
    expect(auc([], [1, 2])).toBe(0.5);
  });
});

describe("separation", () => {
  it("passes a metric whose baseline clearly beats its floor", () => {
    const s = separation("semantic", [1, 1, 1, 0], [0, 0, 0, 0]);
    expect(s.usable).toBe(true);
    expect(s.auc).toBeGreaterThanOrEqual(SEPARATION_THRESHOLD);
  });

  it("discards a metric at chance, and says the number out loud", () => {
    const s = separation("style", [0.9, 0.91, 0.92], [0.9, 0.91, 0.92]);
    expect(s.usable).toBe(false);
    expect(s.verdict).toContain("DISCARDED");
    expect(s.verdict).toContain("50%");
  });
});
