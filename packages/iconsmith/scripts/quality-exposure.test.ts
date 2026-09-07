import { expect, test } from "vitest";

import {
  appendExposureLedger,
  assertExposureLedger,
  createExposureLedger,
  validateNovelSplits,
} from "./quality-exposure.js";

const hash = (letter: string) => letter.repeat(64);
const identity = {
  catalogHash: hash("a"),
  clusterHash: hash("b"),
  libraryHash: hash("c"),
};
const entry = {
  aliases: ["bike"],
  artifactHash: hash("d"),
  clusterId: "wheels-two",
  id: "selection/bicycle",
  kind: "candidate" as const,
  lineage: [
    {
      artifactHash: hash("e"),
      clusterId: "wheels-two",
      semanticFamily: "bicycle",
    },
  ],
  semanticFamily: "bicycle",
};
const family = (name: string, cluster: string, aliases: string[] = []) => ({
  aliases,
  clusterIds: [cluster],
  family: name,
});

test("creates immutable chained receipts and rejects mutation or identity drift", () => {
  const first = createExposureLedger(identity, [entry]);
  const reordered = createExposureLedger(
    {
      catalogHash: hash("a"),
      clusterHash: hash("b"),
      libraryHash: hash("c"),
    },
    [entry]
  );
  expect(reordered.receiptHash).toBe(first.receiptHash);
  const second = appendExposureLedger(first, [
    { ...entry, artifactHash: hash("f"), id: "cache/bicycle", kind: "cache" },
  ]);
  expect(second.previousHash).toBe(first.receiptHash);
  expect(second.qualification).toBe(false);
  expect(() =>
    assertExposureLedger({
      ...first,
      entries: [{ ...entry, aliases: ["cycle"] }],
    })
  ).toThrow("hash mismatch");
  expect(() =>
    appendExposureLedger(first, [], { ...identity, libraryHash: hash("f") })
  ).toThrow("identity changed");
  expect(() =>
    createExposureLedger({ catalogHash: hash("a") } as typeof identity, [entry])
  ).toThrow("exact catalog");
});
test("fails closed on missing or unclassified transitive lineage", () => {
  expect(() =>
    createExposureLedger(identity, [{ ...entry, lineage: [] }])
  ).toThrow("Missing lineage");
  expect(() =>
    createExposureLedger(identity, [
      { ...entry, lineage: [{ ...entry.lineage[0], clusterId: null }] },
    ])
  ).toThrow("Unclassified derivative lineage");
  expect(() =>
    createExposureLedger(identity, [{ ...entry, clusterId: null }])
  ).toThrow("Unclassified exposure");
});
test("finds exposure and cross-batch family, alias, and derivative leakage", () => {
  const result = validateNovelSplits({
    batches: [
      {
        families: [
          family("cycle", "fresh-a", ["bike"]),
          family("bell", "shared"),
        ],
        id: "novel-a",
      },
      {
        families: [family("bike", "shared"), family("plane", "wheels-two")],
        id: "novel-b",
      },
    ],
    identity,
    ledger: createExposureLedger(identity, [entry]),
  });
  expect(result).toMatchObject({
    declaredInputsClear: false,
    qualification: false,
    scope: "declared-metadata-only",
  });
  expect(result.reasons).toEqual(
    expect.arrayContaining([
      "Previously exposed family or alias: bike",
      "Previously exposed derivative cluster: wheels-two",
      "Novel batches overlap by family or alias: bike",
      "Novel batches overlap by derivative cluster: shared",
    ])
  );
});
test("eligibility remains split hygiene and unknown metadata is rejected", () => {
  const ledger = createExposureLedger(identity, [entry]);
  expect(
    validateNovelSplits({
      batches: [
        { families: [family("cloud", "cloud-shape")], id: "a" },
        { families: [family("leaf", "leaf-shape")], id: "b" },
      ],
      identity,
      ledger,
    })
  ).toEqual({
    declaredInputsClear: true,
    qualification: false,
    reasons: [],
    scope: "declared-metadata-only",
  });
  expect(
    validateNovelSplits({
      batches: [
        {
          families: [{ aliases: [], clusterIds: [], family: "unknown" }],
          id: "a",
        },
        { families: [family("leaf", "leaf-shape")], id: "b" },
      ],
      identity,
      ledger,
    }).reasons
  ).toContain("Unclassified novel family: unknown");
});
