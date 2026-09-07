import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { expect, test } from "vitest";

import {
  createCampaignManifest,
  loadCorpusRecords,
  reportCampaign,
  writeCampaignManifest,
} from "./campaign-manifest.js";

const corpus = {
  sources: [{ id: "blode-icons", records: 2, treeHash: "a".repeat(64) }],
};
const records = [
  { set: "other", slug: "ignore" },
  { set: "blode-icons", slug: "bell" },
  { set: "blode-icons", slug: "airplane" },
];

test("freezes every catalog and development output slot with honest estimates", () => {
  const catalog = createCampaignManifest("catalog", corpus, records);
  expect(catalog.manifest.slots).toHaveLength(8);
  expect(catalog.manifest.slots[0].slotId).toBe(
    "airplane/airplane/16/outlined"
  );
  expect(catalog.resources).toMatchObject({ outputSlots: 8, pairRequests: 4 });

  const developmentCorpus = {
    sources: [{ id: "blode-icons", records: 20, treeHash: "b".repeat(64) }],
  };
  const development = createCampaignManifest(
    "development",
    developmentCorpus,
    []
  );
  expect(development.manifest.slots).toHaveLength(80);
  expect(development.resources).toMatchObject({
    maximumDeadlineHours: 40 / 3,
    outputSlots: 80,
    pairRequests: 40,
  });
  expect(development.manifest.assumptions.deadlineMsPerConceptSizePair).toBe(
    1_200_000
  );
});

test("reports missing and each terminal failure without changing the denominator", () => {
  const frozen = createCampaignManifest("catalog", corpus, records);
  const [accepted] = frozen.manifest.slots;
  const [failed] = frozen.manifest.slots.slice(4);
  const report = reportCampaign(frozen, [
    {
      actualUsd: 1,
      artifactHash: "c".repeat(64),
      elapsedMs: 10,
      requestId: "request-1",
      slotId: accepted.slotId,
      status: "accepted",
    },
    {
      actualUsd: null,
      artifactHash: null,
      elapsedMs: null,
      requestId: "request-2",
      slotId: failed.slotId,
      status: "refused",
    },
  ]);
  expect(report).toMatchObject({
    accepted: 1,
    actualUsd: null,
    expected: 8,
    failures: { refused: 1 },
    missing: 6,
    observed: 2,
    qualified: false,
    unknownCost: 3,
  });
  expect(() =>
    reportCampaign(frozen, [
      {
        actualUsd: 0,
        artifactHash: null,
        elapsedMs: 0,
        requestId: "request-1",
        slotId: accepted.slotId,
        status: "accepted",
      },
    ])
  ).toThrow("artifact hash");
});

test("counts pair-request resources once and never claims campaign qualification", () => {
  const frozen = createCampaignManifest("catalog", corpus, records);
  const [outlined, filled] = frozen.manifest.slots;
  const pair = [outlined, filled].map((slot) => ({
    actualUsd: 2,
    artifactHash: "d".repeat(64),
    elapsedMs: 20,
    requestId: "pair-1",
    slotId: slot.slotId,
    status: "accepted" as const,
  }));
  expect(reportCampaign(frozen, pair)).toMatchObject({
    actualUsd: null,
    elapsedMs: 20,
    qualified: false,
    receiptedUsd: 2,
    requests: 1,
  });
  expect(() =>
    reportCampaign(frozen, [{ ...pair[0], elapsedMs: 1_200_001 }])
  ).toThrow("Over-deadline");
  expect(
    reportCampaign(
      frozen,
      frozen.manifest.slots.map((slot) => ({
        actualUsd: 0,
        artifactHash: null,
        elapsedMs: 1,
        requestId: `failed-${slot.family}-${slot.nativeSize}`,
        slotId: slot.slotId,
        status: "refused" as const,
      }))
    )
  ).toMatchObject({
    accepted: 0,
    coverageComplete: true,
    missing: 0,
    qualified: false,
  });
});

test("writes exact manifests from the current corpus inventory", () => {
  const root = mkdtempSync(path.join(tmpdir(), "campaign-manifest-"));
  try {
    const corpusRoot = path.resolve(import.meta.dirname, "../.corpus");
    const out = path.join(root, "catalog.json");
    const frozen = writeCampaignManifest(
      out,
      "catalog",
      path.join(corpusRoot, "manifest.json"),
      path.join(corpusRoot, "icons.jsonl")
    );
    expect(frozen.manifest.source.concepts).toBe(2221);
    expect(frozen.resources).toMatchObject({
      outputSlots: 8884,
      pairRequests: 4442,
      providerCostUsd: null,
    });
    expect(
      loadCorpusRecords(path.join(corpusRoot, "icons.jsonl"))
    ).toHaveLength(18_658);
    expect(JSON.parse(readFileSync(out, "utf-8")).hash).toBe(frozen.hash);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("an untouched campaign has unknown cost for every missing request", () => {
  const frozen = createCampaignManifest("catalog", corpus, records);
  expect(reportCampaign(frozen, [])).toMatchObject({
    actualUsd: null,
    missing: 8,
    missingRequests: 4,
    requests: 0,
    unknownCost: 4,
  });
});
