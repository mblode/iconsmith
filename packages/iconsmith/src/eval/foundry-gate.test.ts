import { describe, expect, it } from "vitest";

import { decidePilot, qualifyInstrument } from "./foundry-gate.js";
import type {
  InstrumentTrial,
  PilotEvidence,
  PilotItem,
} from "./foundry-gate.js";

const trials = (): InstrumentTrial[] =>
  Array.from({ length: 20 }, (_, index) =>
    (["forward", "reverse"] as const).map((order) => ({
      controlRejected: false,
      decision: "correct" as const,
      defect: "blocked-counter",
      order,
      pairId: `pair-${index}`,
    }))
  ).flat();
const evidence = (): PilotEvidence => {
  const items: PilotItem[] = Array.from({ length: 6 }, (_, index) =>
    (["development", "development", "completion", "novel-family"] as const).map(
      (split, variant) => ({
        id: `item-${index}-${variant}`,
        morphology: `group-${index}`,
        split,
        variants: ["16-outline", "24-outline"],
      })
    )
  ).flat();
  return {
    actualUsd: 5,
    ceilingUsd: 10,
    frozenManifestHash: "a".repeat(64),
    holdoutExposed: false,
    items,
    observations: items.flatMap((item) =>
      item.variants.map((variant) => ({
        accepted: true,
        artifactHash: "b".repeat(64),
        exactReplay: true,
        familyPassed: true,
        item: item.id,
        manualArtworkEdits: 0,
        newlyGenerated: true,
        variant,
      }))
    ),
    observedManifestHash: "a".repeat(64),
    requiredDefects: ["blocked-counter"],
    trials: trials(),
  };
};

describe("foundry advancement", () => {
  it("requires all concepts, variants and instrument classes", () => {
    expect(decidePilot(evidence()).outcome).toBe("pilot-proven");
    const missing = evidence();
    missing.observations = missing.observations.slice(1);
    expect(decidePilot(missing).outcome).toBe("blocked");
    expect(
      decidePilot({ ...evidence(), requiredDefects: ["unmeasured"] }).outcome
    ).toBe("blocked");
  });
  it("does not count reversed or repeated trials as distinct pairs", () => {
    expect(
      qualifyInstrument(["blocked-counter"], trials().slice(0, 38))[0].passed
    ).toBe(false);
    const repeated = [...trials(), ...trials()];
    expect(qualifyInstrument(["blocked-counter"], repeated)[0].passed).toBe(
      false
    );
    expect(qualifyInstrument(["blocked-counter"], repeated)[0].count).toBe(20);
  });
  it("counts abstention and reversed-order failure, reporting uncertainty", () => {
    const dataset = trials().map((trial, index) =>
      index < 6 ? { ...trial, decision: "abstain" as const } : trial
    );
    const [result] = qualifyInstrument(["blocked-counter"], dataset);
    expect(result.correct).toBe(17);
    expect(result.passed).toBe(false);
    expect(result.correctInterval95[0]).toBeLessThan(0.85);
  });
  it("blocks unknown spend, exposed holdouts and failed family checks", () => {
    expect(decidePilot({ ...evidence(), actualUsd: null }).outcome).toBe(
      "blocked"
    );
    expect(decidePilot({ ...evidence(), actualUsd: 11 }).outcome).toBe(
      "blocked"
    );
    expect(decidePilot({ ...evidence(), holdoutExposed: true }).outcome).toBe(
      "blocked"
    );
    const failed = evidence();
    failed.observations = failed.observations.map((entry, index) =>
      index === 0 ? { ...entry, familyPassed: false } : entry
    );
    expect(decidePilot(failed).outcome).toBe("blocked");
  });
  it("cannot pass by dropping a failed concept or returning a reconstruction", () => {
    expect(
      decidePilot({ ...evidence(), items: evidence().items.slice(1) }).outcome
    ).toBe("blocked");
    const copied = evidence();
    copied.observations = copied.observations.map((entry) => ({
      ...entry,
      newlyGenerated: false,
    }));
    expect(decidePilot(copied).outcome).toBe("blocked");
  });
});
