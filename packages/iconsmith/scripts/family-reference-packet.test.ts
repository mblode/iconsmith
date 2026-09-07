import { expect, test } from "vitest";

import { DEFAULT_POLICY } from "../src/pipeline/policy.js";
import {
  createStyleRevision,
  selectStyle,
  STYLE_COMPILER,
} from "../src/pipeline/style.js";
import { SPEC } from "../src/tools/canvas.js";
import type { FamilySource } from "./family-parts.js";
import {
  applyFamilyReferencePacket,
  createFamilyReferencePacket,
  parseFamilyReferencePacket,
  verifyFamilyPacketInventory,
} from "./family-reference-packet.js";

const source: FamilySource = {
  finish: "filled",
  name: "box",
  provenance: {
    date: "2026-09-07",
    licenses: ["MIT"],
    origin: "literal",
    set: "blode-icons",
  },
  svg: '<svg viewBox="0 0 24 24"><path fill-rule="evenodd" d="M4 4H20V20H4ZM8 8H16V16H8Z"/></svg>',
};
const revision = () =>
  createStyleRevision({
    calibration: "unvalidated",
    compiler: STYLE_COMPILER,
    id: "family-packet-test",
    masters: { "16": { ...SPEC, size: 16 }, "24": SPEC },
    parts: [],
    policy: DEFAULT_POLICY,
    references: [],
    rubric: "test",
  });
const packet = () =>
  createFamilyReferencePacket({
    concept: "package-lock",
    excludedFamilies: ["package-lock"],
    excludedSourceHashes: [],
    librarySet: "blode-icons",
    librarySourceHash: "a".repeat(64),
    sources: [
      {
        admissionRequested: true,
        intent: {
          evidence: "square body with a retained counter",
          polarity: "body",
          treatment: "preserve modifier above the body",
        },
        source,
      },
    ],
  });

test("reuses one source choice while admitting independently per master", async () => {
  const shared = packet();
  const at16 = await applyFamilyReferencePacket(revision(), "16", shared);
  const at24 = await applyFamilyReferencePacket(at16.revision, "24", shared);
  expect(at16.admissions[0].admission).toBe("admitted");
  expect(at16.admissions[0]).toMatchObject({
    familyClass: "symbolic",
    guidance: expect.arrayContaining([expect.stringContaining("native 16px")]),
  });
  expect(at24.admissions[0].admission).toBe("admitted");
  expect(selectStyle(at24.revision, "16").parts).toHaveLength(1);
  expect(selectStyle(at24.revision, "24").parts).toHaveLength(1);
  expect(at24.packet.packetHash).toBe(at16.packet.packetHash);
  expect(at24.admissions[0].guidance).toContain(
    "At native 24px, retain source-supported nuance without adding detail absent from the family."
  );
  expect(at24.applicationHash).not.toBe(at16.applicationHash);
  const reapplied = await applyFamilyReferencePacket(
    at24.revision,
    "24",
    shared
  );
  expect(selectStyle(reapplied.revision, "24").parts).toHaveLength(1);
  expect(selectStyle(reapplied.revision, "24").references).toHaveLength(1);
});

test("rejects packet and source tampering, missing masters, and donor switching", async () => {
  const shared = packet();
  expect(() =>
    parseFamilyReferencePacket({ ...shared, concept: "different" })
  ).toThrow("packet hash mismatch");
  expect(() =>
    parseFamilyReferencePacket({
      ...shared,
      sources: [{ ...shared.sources[0], svg: "<svg/>" }],
    })
  ).toThrow();
  await expect(
    applyFamilyReferencePacket(revision(), "20", shared)
  ).rejects.toThrow("Unavailable style master");
  expect(() =>
    verifyFamilyPacketInventory(
      shared,
      [{ ...source, svg: '<svg viewBox="0 0 24 24"/>' }],
      shared.librarySourceHash,
      shared.librarySet,
      shared.excludedFamilies,
      new Set()
    )
  ).toThrow("source switched");
  expect(() =>
    verifyFamilyPacketInventory(
      shared,
      [
        {
          ...source,
          provenance: { ...source.provenance, icon: "different.svg" },
        },
      ],
      shared.librarySourceHash,
      shared.librarySet,
      shared.excludedFamilies,
      new Set()
    )
  ).toThrow("provenance mismatch");
  expect(() =>
    verifyFamilyPacketInventory(
      shared,
      [source],
      shared.librarySourceHash,
      shared.librarySet,
      ["box"],
      new Set([shared.sources[0].sha256])
    )
  ).toThrow("exclusion identity mismatch");
  const aliasExcluded = createFamilyReferencePacket({
    concept: "package-lock",
    excludedFamilies: ["bicycle"],
    excludedSourceHashes: [],
    librarySet: "blode-icons",
    librarySourceHash: shared.librarySourceHash,
    sources: [
      {
        admissionRequested: false,
        intent: { evidence: "wheel", polarity: "modifier", treatment: "" },
        source,
      },
    ],
  });
  expect(() =>
    verifyFamilyPacketInventory(
      aliasExcluded,
      [source],
      aliasExcluded.librarySourceHash,
      aliasExcluded.librarySet,
      ["bicycle"],
      new Set([aliasExcluded.sources[0].sha256])
    )
  ).toThrow("Currently excluded donor leaked");
  expect(() =>
    createFamilyReferencePacket({
      concept: "package-lock",
      excludedFamilies: [],
      excludedSourceHashes: [shared.sources[0].sha256],
      librarySet: "blode-icons",
      librarySourceHash: "c".repeat(64),
      sources: [
        {
          admissionRequested: false,
          intent: { evidence: "shape", polarity: "body", treatment: "" },
          source,
        },
      ],
    })
  ).toThrow("Excluded source leaked");
});

test("keeps a target admission refusal explicit and reference-only", async () => {
  const bad = createFamilyReferencePacket({
    concept: "package-lock",
    excludedFamilies: [],
    excludedSourceHashes: [],
    librarySet: "blode-icons",
    librarySourceHash: "b".repeat(64),
    sources: [
      {
        admissionRequested: true,
        intent: { evidence: "shape", polarity: "modifier", treatment: "" },
        source: { ...source, svg: '<svg><mask id="m"/></svg>' },
      },
    ],
  });
  const applied = await applyFamilyReferencePacket(revision(), "16", bad);
  expect(applied.admissions[0].admission).toContain(
    "unsupported source semantics"
  );
  expect(selectStyle(applied.revision, "16").references).toHaveLength(1);
  expect(selectStyle(applied.revision, "16").parts).toHaveLength(0);
});
