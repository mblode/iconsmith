import { describe, expect, it } from "vitest";

import { EMPTY_USAGE } from "./cost.js";
import { gatewayCostTracker } from "./gateway.js";

const usage = (inputTokens: number) => ({
  inputTokens,
  outputTokens: 0,
});

const measuredUsage = (inputTokens: number) => ({
  ...EMPTY_USAGE,
  inputTokens,
});

describe("gatewayCostTracker", () => {
  it("sums exact Gateway metadata when every captured call reports cost", async () => {
    const tracker = gatewayCostTracker();
    tracker.capture({
      providerMetadata: { gateway: { cost: "0.03" } },
      usage: usage(1000),
    });
    tracker.capture({
      providerMetadata: { gateway: { cost: "0.03" } },
      usage: usage(1000),
    });

    expect(tracker.observed("google/gemini-3.5-flash-lite")).toEqual({
      calls: 2,
      usd: 0.06,
    });
    await expect(
      tracker.measure({
        calls: 2,
        model: "google/gemini-3.5-flash-lite",
        operation: "test",
        usage: measuredUsage(2000),
      })
    ).resolves.toMatchObject({ calls: 2, source: "gateway", usd: 0.06 });
  });

  it("never treats partial Gateway metadata as the whole bill", async () => {
    const tracker = gatewayCostTracker();
    tracker.capture({
      providerMetadata: { gateway: { cost: "0.03" } },
      usage: usage(1000),
    });
    tracker.capture({ usage: usage(1000) });

    expect(tracker.observed("google/gemini-3.5-flash-lite")).toMatchObject({
      calls: 2,
      usd: 0.0006,
    });
    await expect(
      tracker.measure({
        calls: 2,
        model: "google/gemini-3.5-flash-lite",
        operation: "test",
        usage: measuredUsage(2000),
      })
    ).resolves.toMatchObject({
      calls: 2,
      source: "rate-table",
      usd: 0.0006,
    });
  });

  it("reports an unknown total when neither complete metadata nor usage can price it", async () => {
    const tracker = gatewayCostTracker();
    tracker.capture({
      providerMetadata: { gateway: { cost: "0.03" } },
      usage: usage(1000),
    });
    tracker.capture({ usage: {} });

    expect(tracker.observed("unlisted/model")).toEqual({
      calls: 2,
      usd: null,
    });
    await expect(
      tracker.measure({
        calls: 2,
        model: "unlisted/model",
        operation: "test",
        usage: measuredUsage(1000),
      })
    ).resolves.toMatchObject({ calls: 2, source: "unpriced", usd: null });
  });

  it("does not price an empty usage report as a free call", async () => {
    const tracker = gatewayCostTracker();
    tracker.capture({ usage: {} });

    expect(tracker.observed("google/gemini-3.5-flash-lite")).toEqual({
      calls: 1,
      usd: null,
    });
    await expect(
      tracker.measure({
        model: "google/gemini-3.5-flash-lite",
        operation: "test",
        usage: { ...EMPTY_USAGE },
      })
    ).resolves.toMatchObject({ calls: 1, source: "unpriced", usd: null });
  });
});
