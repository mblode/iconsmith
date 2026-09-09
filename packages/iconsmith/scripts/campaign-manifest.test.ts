import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { expect, test } from "vitest";

import { DEFAULT_POLICY } from "../src/pipeline/policy.js";
import { STYLE_COMPILER } from "../src/pipeline/style.js";
import { specAt } from "../src/tools/canvas.js";
import {
  createCampaignManifest,
  createReliabilityReplayManifest,
  prepareDevelopmentCampaignInputs,
  loadCorpusRecords,
  reportCampaign,
  writeCampaignManifest,
} from "./campaign-manifest.js";
import { DEVELOPMENT_FAMILIES } from "./quality-population.js";

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

const corpusRoot = path.resolve(import.meta.dirname, "../.corpus");
// The exact population is private. The portable manifest controls above still
// run when this separate cached-inventory measurement cannot be made.
test.skipIf(
  ["manifest.json", "icons.jsonl"].some(
    (file) => !existsSync(path.join(corpusRoot, file))
  )
)("writes exact manifests from the current corpus inventory", () => {
  const root = mkdtempSync(path.join(tmpdir(), "campaign-manifest-"));
  try {
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

const preparationFixture = () => {
  const root = mkdtempSync(path.join(tmpdir(), "development-prep-"));
  const revision = {
    calibration: "unvalidated",
    compiler: STYLE_COMPILER,
    id: "input-test",
    masters: { "16": specAt({ size: 16 }), "24": specAt({ size: 24 }) },
    parts: [],
    policy: DEFAULT_POLICY,
    references: ["16", "24"].map((master) => ({
      master,
      name: "house-control",
      provenance: {
        date: "2026-09-08",
        icon: "control",
        origin: "literal",
        set: "blode-icons",
      },
      svg: '<svg viewBox="0 0 24 24"><path d="M4 4H20V20H4Z"/></svg>',
    })),
    rubric: "Development test rubric",
  };
  const meanings = Object.fromEntries(
    DEVELOPMENT_FAMILIES.map(({ concept }) => [
      concept,
      [concept, "alternative-one", "alternative-two"],
    ])
  );
  const options = {
    baseRevisionFile: path.join(root, "revision.json"),
    corpusManifestFile: path.join(root, "corpus.json"),
    meaningsFile: path.join(root, "meanings.json"),
    out: path.join(root, "out"),
  };
  writeFileSync(options.baseRevisionFile, JSON.stringify(revision));
  writeFileSync(options.corpusManifestFile, JSON.stringify(corpus));
  writeFileSync(options.meaningsFile, JSON.stringify(meanings));
  return { meanings, options, revision, root };
};

test("prepares all development slots through canonical inputs without overwriting", () => {
  const f = preparationFixture();
  try {
    const result = prepareDevelopmentCampaignInputs(f.options);
    expect(result).toMatchObject({
      outputSlots: 80,
      pairRequests: 40,
      providerCalls: 0,
      qualified: false,
    });
    expect(result.artifacts).toHaveLength(22);
    expect(
      JSON.parse(
        readFileSync(path.join(f.options.out, "base-revision.json"), "utf-8")
      )
    ).toEqual(f.revision);
    expect(() => prepareDevelopmentCampaignInputs(f.options)).toThrow();
  } finally {
    rmSync(f.root, { force: true, recursive: true });
  }
});

test.each(["missing-meaning", "wrong-master", "stale-compiler"])(
  "refuses %s before creating an input bundle",
  (failure) => {
    const f = preparationFixture();
    try {
      if (failure === "missing-meaning") {
        delete f.meanings["cloud-upload"];
        writeFileSync(f.options.meaningsFile, JSON.stringify(f.meanings));
      }
      if (failure === "wrong-master") {
        f.revision.masters["16"] = specAt({ size: 24 });
        writeFileSync(f.options.baseRevisionFile, JSON.stringify(f.revision));
      }
      if (failure === "stale-compiler") {
        writeFileSync(
          f.options.baseRevisionFile,
          JSON.stringify({ ...f.revision, compiler: "stale" })
        );
      }
      expect(() => prepareDevelopmentCampaignInputs(f.options)).toThrow();
      expect(() =>
        readFileSync(path.join(f.options.out, "manifest.json"))
      ).toThrow();
    } finally {
      rmSync(f.root, { force: true, recursive: true });
    }
  }
);

test("freezes a declared development order without losing or reusing slots", () => {
  const original = createCampaignManifest("development", corpus, []);
  const order = [
    "folder-lock",
    ...DEVELOPMENT_FAMILIES.map(({ concept }) => concept).filter(
      (concept) => concept !== "folder-lock"
    ),
  ];
  const reordered = createCampaignManifest("development", corpus, [], order);
  expect(
    reordered.manifest.slots.slice(0, 4).map(({ concept }) => concept)
  ).toEqual(Array.from({ length: 4 }, () => "folder-lock"));
  expect(
    reordered.manifest.slots.map(({ slotId }) => slotId).toSorted()
  ).toEqual(original.manifest.slots.map(({ slotId }) => slotId).toSorted());
  expect(reordered.hash).not.toBe(original.hash);
  expect(createCampaignManifest("development", corpus, [], order)).toEqual(
    reordered
  );
  expect(() =>
    createCampaignManifest("development", corpus, [], order.slice(1))
  ).toThrow("every frozen concept");
  expect(() =>
    createCampaignManifest(
      "development",
      corpus,
      [],
      [order[0], ...order.slice(0, -1)]
    )
  ).toThrow("every frozen concept");
  expect(() =>
    createCampaignManifest("catalog", corpus, records, order)
  ).toThrow("every frozen concept");
});

test("development preparation carries a complete declared order into the hashed manifest", () => {
  const f = preparationFixture();
  try {
    const order = DEVELOPMENT_FAMILIES.map(
      ({ concept }) => concept
    ).toReversed();
    prepareDevelopmentCampaignInputs({ ...f.options, conceptOrder: order });
    const actual = JSON.parse(
      readFileSync(path.join(f.options.out, "manifest.json"), "utf-8")
    );
    expect(actual).toEqual(
      createCampaignManifest("development", corpus, [], order)
    );
  } finally {
    rmSync(f.root, { force: true, recursive: true });
  }
});

test("reliability replay preserves twelve requested slots in centralized accounting", () => {
  const frozen = createReliabilityReplayManifest(corpus);
  expect(frozen.resources).toMatchObject({
    maximumDeadlineHours: 2,
    outputSlots: 12,
    pairRequests: 6,
  });
  expect(
    frozen.manifest.requests.filter(({ role }) => role === "failure")
  ).toHaveLength(4);
  expect(
    frozen.manifest.requests.filter(({ role }) => role === "control")
  ).toHaveLength(2);
  expect(frozen.manifest.concepts).toHaveLength(5);
  const report = reportCampaign(frozen, []);
  expect(report).toMatchObject({
    coverageComplete: false,
    expected: 12,
    missing: 12,
    missingRequests: 6,
    observed: 0,
    qualified: false,
    unknownCost: 6,
  });
  expect(frozen.manifest.slots.map(({ slotId }) => slotId)).toContain(
    "hammer/hammer-check/16/filled"
  );
});
