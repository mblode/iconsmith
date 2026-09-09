import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { expect, test } from "vitest";

import {
  freezeSynonymKey,
  freezeQualificationReceipt,
  ingestHumanLabels,
  validateSynonymAdjudication,
  validatePopulationSeparation,
  validateQualificationReceipt,
} from "./quality-labels.js";

const image = "a".repeat(64);
const svg = "b".repeat(64);
const provenance = [
  {
    id: "Q001",
    nativeImageSha256: image,
    status: "needs-human-review",
    svgSha256: svg,
  },
];
const complete = {
  craftRating: 9,
  criticalDefect: false,
  defects: [],
  familyFit: true,
  humanIdentity: "reviewer-1",
  id: "Q001",
  nativeImageSha256: image,
  nativeLegibility: true,
  recognition: "cloud upload",
  shipUnchanged: true,
  svgSha256: svg,
};

test("ingests complete hash-bound human labels into critic observations", () => {
  expect(
    ingestHumanLabels(
      provenance,
      [[complete]],
      [{ evidenceHash: image, predicted: "approve" }]
    )
  ).toEqual({
    observations: [
      {
        criticalDefect: false,
        evidenceHash: image,
        human: "approve",
        predicted: "approve",
      },
    ],
    pending: [],
    submitted: 1,
    total: 1,
  });
});

test("keeps sealed qualification evidence disjoint from development", () => {
  const separated = validatePopulationSeparation({
    development: [{ evidenceHash: "1".repeat(64), id: "development-1" }],
    sealed: [{ evidenceHash: "2".repeat(64), id: "sealed-1" }],
    sealedLabelsExposedBeforePrediction: false,
  });
  expect(separated.hash).toMatch(/^[a-f0-9]{64}$/u);
  expect(() =>
    validatePopulationSeparation({
      development: [{ evidenceHash: "1".repeat(64), id: "same" }],
      sealed: [{ evidenceHash: "2".repeat(64), id: "same" }],
      sealedLabelsExposedBeforePrediction: false,
    })
  ).toThrow("overlap");
  expect(() =>
    validatePopulationSeparation({
      development: [
        { evidenceHash: "3".repeat(64), family: "bicycle", id: "dev-bike" },
      ],
      sealed: [
        {
          evidenceHash: "4".repeat(64),
          family: "bicycle",
          id: "sealed-bike",
        },
      ],
      sealedLabelsExposedBeforePrediction: false,
    })
  ).toThrow("overlap");
  expect(() =>
    validatePopulationSeparation({
      development: [],
      sealed: [{ evidenceHash: "2".repeat(64), id: "sealed-1" }],
      sealedLabelsExposedBeforePrediction: true,
    })
  ).toThrow("exposed");
});

test("keeps incomplete labels pending and rejects tampered evidence", () => {
  expect(
    ingestHumanLabels(provenance, [[{ ...complete, craftRating: null }]], [])
  ).toMatchObject({ observations: [], pending: ["Q001"] });
  expect(() =>
    ingestHumanLabels(
      provenance,
      [[{ ...complete, nativeImageSha256: "c".repeat(64) }]],
      []
    )
  ).toThrow("identity mismatch");
});

test("rejects fabricated approval semantics and missing sealed predictions", () => {
  expect(() =>
    ingestHumanLabels(
      provenance,
      [[{ ...complete, criticalDefect: true }]],
      [{ evidenceHash: image, predicted: "reject" }]
    )
  ).toThrow("cannot ship");
  expect(() => ingestHumanLabels(provenance, [[complete]], [])).toThrow(
    "Missing critic prediction"
  );
});

test("retains omitted provenance as pending and rejects malformed identities", () => {
  expect(ingestHumanLabels(provenance, [], [])).toEqual({
    observations: [],
    pending: ["Q001"],
    submitted: 0,
    total: 1,
  });
  expect(() =>
    ingestHumanLabels([...provenance, ...provenance], [], [])
  ).toThrow("Duplicate provenance");
  expect(() =>
    ingestHumanLabels(
      provenance,
      [],
      [{ evidenceHash: "bad", predicted: "approve" }]
    )
  ).toThrow("Invalid or duplicate");
});

test("persists and validates the exact sealed instrument and roster files", () => {
  const root = mkdtempSync(path.join(tmpdir(), "qualification-receipt-"));
  try {
    const instrument = path.join(root, "instrument.json");
    const roster = path.join(root, "roster.json");
    const receipt = path.join(root, "receipt.json");
    writeFileSync(instrument, "instrument-v1");
    writeFileSync(roster, "roster-v1");
    freezeQualificationReceipt(receipt, instrument, roster);
    expect(
      validateQualificationReceipt(receipt, instrument, roster)
    ).toMatchObject({
      labelsExposedBeforePrediction: false,
    });
    writeFileSync(roster, "changed");
    expect(() =>
      validateQualificationReceipt(receipt, instrument, roster)
    ).toThrow("pinned inputs changed");
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("binds free descriptions to an independent emitted-lineage adjudication", () => {
  const key = freezeSynonymKey([
    {
      id: "s001",
      meaningProvenanceHash: "3".repeat(64),
      synonyms: ["heart", "love symbol"],
      target: "heart",
    },
  ]);
  const recognition = {
    description: "a heart outline",
    evidenceHash: "4".repeat(64),
    id: "s001",
  };
  const adjudication = {
    adjudicatorBaseModelLineage: "claude",
    adjudicatorModel: "claude-opus",
    decision: "match" as const,
    evidence: "Description names an accepted synonym",
    id: "s001",
    keyHash: key.hash,
    recognitionEvidenceHash: recognition.evidenceHash,
    recognizerBaseModelLineage: "gpt",
  };
  expect(
    validateSynonymAdjudication({
      adjudications: [adjudication],
      keyHash: key.hash,
      recognitions: [recognition],
    })
  ).toEqual({
    productionSealEligible: false,
    rows: [{ decision: "match", id: "s001", recognitionSuccess: true }],
    runtimeAccessRestrictionVerified: false,
  });
  expect(() =>
    validateSynonymAdjudication({
      adjudications: [{ ...adjudication, adjudicatorBaseModelLineage: "gpt" }],
      keyHash: key.hash,
      recognitions: [recognition],
    })
  ).toThrow("linkage");
  expect(() =>
    validateSynonymAdjudication({
      adjudications: [
        { ...adjudication, recognitionEvidenceHash: "5".repeat(64) },
      ],
      keyHash: key.hash,
      recognitions: [recognition],
    })
  ).toThrow("linkage");
});

test("preserves unknown and mismatch rows in the recognition denominator", () => {
  const keyHash = "6".repeat(64);
  const recognitions = [
    { description: null, evidenceHash: "7".repeat(64), id: "s001" },
    { description: "a square", evidenceHash: "8".repeat(64), id: "s002" },
  ];
  const common = {
    adjudicatorBaseModelLineage: "claude",
    adjudicatorModel: "claude-opus",
    evidence: "Compared sealed text to key",
    keyHash,
    recognizerBaseModelLineage: "gpt",
  };
  expect(
    validateSynonymAdjudication({
      adjudications: [
        {
          ...common,
          decision: "uncertain",
          id: "s001",
          recognitionEvidenceHash: "7".repeat(64),
        },
        {
          ...common,
          decision: "mismatch",
          id: "s002",
          recognitionEvidenceHash: "8".repeat(64),
        },
      ],
      keyHash,
      recognitions,
    }).rows
  ).toEqual([
    { decision: "unknown", id: "s001", recognitionSuccess: false },
    { decision: "mismatch", id: "s002", recognitionSuccess: false },
  ]);
});
