import { describe, expect, it } from "vitest";

import { exceedsCostBudget } from "./cost.js";

describe("exceedsCostBudget", () => {
  it("allows the exact USD and call boundary", () => {
    expect(
      exceedsCostBudget(
        { calls: 20, usd: 0.25 },
        { maxCalls: 20, maxUsd: 0.25 }
      )
    ).toBe(false);
  });

  it("rejects one extra call or microdollar", () => {
    expect(
      exceedsCostBudget(
        { calls: 21, usd: 0.25 },
        { maxCalls: 20, maxUsd: 0.25 }
      )
    ).toBe(true);
    expect(
      exceedsCostBudget(
        { calls: 20, usd: 0.250001 },
        { maxCalls: 20, maxUsd: 0.25 }
      )
    ).toBe(true);
  });

  it("rejects unknown spend", () => {
    expect(
      exceedsCostBudget({ calls: 1, usd: null }, { maxCalls: 20, maxUsd: 0.25 })
    ).toBe(true);
  });
});
