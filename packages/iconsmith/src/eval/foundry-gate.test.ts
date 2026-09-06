import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  decidePilot,
  qualifyCraftJudge,
  qualifyInstrument,
} from "./foundry-gate.js";
import type {
  InstrumentTrial,
  PilotEvidence,
  PilotItem,
} from "./foundry-gate.js";

const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");

const trials = (): InstrumentTrial[] =>
  Array.from({ length: 20 }, (_, index) =>
    (["forward", "reverse"] as const).map((order) => ({
      controlRejected: false,
      decision: "correct" as const,
      defect: "blocked-counter",
      evidenceHash: hash(`stimulus-${index}`),
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
        artifactHash: hash(`${item.id}/${variant}`),
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

describe("evidence identity", () => {
  it("rejects the same artifact credited to different concepts", () => {
    const copied = evidence();
    copied.observations = copied.observations.map((entry) => ({
      ...entry,
      artifactHash: hash("one-icon"),
    }));
    expect(decidePilot(copied).outcome).toBe("blocked");
  });
  it("permits identical geometry across variants of one concept", () => {
    const same = evidence();
    same.observations = same.observations.map((entry) => ({
      ...entry,
      artifactHash: hash(entry.item),
    }));
    expect(decidePilot(same).outcome).toBe("pilot-proven");
  });
  it("requires actual forward and reverse orders at the JSON boundary", () => {
    const invalid = trials().map((trial) => ({
      ...trial,
      order: trial.order === "forward" ? "front" : "back",
    }));
    expect(
      qualifyInstrument(["blocked-counter"], invalid as InstrumentTrial[])[0]
        .passed
    ).toBe(false);
  });
  it("rejects repeated stimuli renamed as different pairs", () => {
    const copied = trials().map((trial) => ({
      ...trial,
      evidenceHash: hash("one-pair"),
    }));
    expect(qualifyInstrument(["blocked-counter"], copied)[0].passed).toBe(
      false
    );
  });
  it("requires both orders to bind to the same valid stimulus hash", () => {
    for (const evidenceHash of ["", "not-a-hash", hash("different-stimulus")]) {
      const changed = trials().map((trial, index) =>
        index === 0 ? { ...trial, evidenceHash } : trial
      );
      expect(qualifyInstrument(["blocked-counter"], changed)[0].passed).toBe(
        false
      );
    }
  });
});

describe("human-anchored craft judge", () => {
  const rows = Array.from({ length: 100 }, (_, i) => ({
    criticalDefect: i >= 60,
    evidenceHash: i.toString(16).padStart(64, "0"),
    human: i < 60 ? ("approve" as const) : ("reject" as const),
    predicted: i < 60 ? ("approve" as const) : ("reject" as const),
  }));
  const controls = ["identical-images", "reversed-order"].map((defect) => ({
    correct: 20,
    correctInterval95: [0, 1] as [number, number],
    count: 20,
    defect,
    falseRejectionInterval95: [0, 1] as [number, number],
    falseRejections: 0,
    passed: true,
  }));
  it("reports denominators and qualifies only a labeled controlled sample", () => {
    expect(qualifyCraftJudge(rows, controls)).toMatchObject({
      count: 100,
      coverage: 1,
      criticalRecall: 1,
      precision: 1,
      qualified: true,
    });
    expect(qualifyCraftJudge(rows, []).qualified).toBe(false);
    expect(qualifyCraftJudge(rows, controls.slice(0, 1)).qualified).toBe(false);
    expect(
      qualifyCraftJudge(
        rows,
        controls.map((control) => ({ ...control, correct: 19 }))
      ).qualified
    ).toBe(false);
    expect(
      qualifyCraftJudge(
        rows.map((row) => ({
          ...row,
          predicted: "invalid",
        })) as unknown as Parameters<typeof qualifyCraftJudge>[0],
        controls
      ).qualified
    ).toBe(false);
    expect(
      qualifyCraftJudge(
        rows.map((row) => ({ ...row, human: null })),
        controls
      ).qualified
    ).toBe(false);
  });
  it("abstention, duplicate stimuli and false approvals cannot hide in an average", () => {
    expect(
      qualifyCraftJudge(
        rows.map((row) => ({ ...row, predicted: "uncertain" })),
        controls
      ).qualified
    ).toBe(false);
    expect(
      qualifyCraftJudge(
        rows.map((row) => ({ ...row, evidenceHash: "0".repeat(64) })),
        controls
      ).qualified
    ).toBe(false);
    const bad = rows.map((row, i) =>
      i >= 60 && i < 65 ? { ...row, predicted: "approve" as const } : row
    );
    expect(qualifyCraftJudge(bad, controls)).toMatchObject({
      approved: 65,
      criticalDetected: 35,
      qualified: false,
    });
  });
});
