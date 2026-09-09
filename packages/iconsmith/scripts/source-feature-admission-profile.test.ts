import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";

import { expect, test } from "vitest";

import { styleHash } from "../src/pipeline/style.js";
import { BLODE_ICONS_SVG_URL } from "./blode-icons.js";
import {
  resolveSourceFeatureAdmissionProfile,
  SOURCE_FEATURE_ADMISSION_PROFILE,
  validateSourceFeatureAdmissionProfile,
} from "./source-feature-admission-profile.js";
import type { SourceFeatureAdmissionProfile } from "./source-feature-admission-profile.js";

const houseSourceUrl = (file: string) => new URL(file, BLODE_ICONS_SVG_URL);
const sourceFileByName = new Map([
  ["bell", "bell-filled.svg"],
  ["bike", "bike-filled.svg"],
  ["branch-simple", "branch-simple.svg"],
  ["color-palette", "color-palette-filled.svg"],
  ["keyframe", "keyframe-filled.svg"],
  ["strawberry", "strawberry.svg"],
  ["zoom-in", "zoom-in-filled.svg"],
]);

const rehash = (profile: SourceFeatureAdmissionProfile) => {
  const { profileHash: _profileHash, ...body } = profile;
  return { ...body, profileHash: styleHash(body) };
};

// A public clone has no sibling source checkout. Keep this exact-source
// measurement unavailable rather than substituting invented source artwork.
test.skipIf(
  [...sourceFileByName.values()].some(
    (file) => !existsSync(houseSourceUrl(file))
  )
)(
  "binds the fixed profile to exact current source bytes and paired raster identities",
  async () => {
    expect(SOURCE_FEATURE_ADMISSION_PROFILE.entries).toHaveLength(7);
    for (const entry of SOURCE_FEATURE_ADMISSION_PROFILE.entries) {
      const file = sourceFileByName.get(entry.sourceName);
      expect(file).toBeDefined();
      // eslint-disable-next-line no-await-in-loop
      const source = await readFile(houseSourceUrl(file as string));
      expect(createHash("sha256").update(source).digest("hex")).toBe(
        entry.sourceSha256
      );
      expect(entry.observations.map(({ nativeSize }) => nativeSize)).toEqual([
        16, 24,
      ]);
      expect(
        entry.observations.map(({ rasterization }) => rasterization.kind)
      ).toEqual(["resampled-source", "native-master"]);
    }
  }
);

test("rejects stale hashes, incomplete pairs, malformed regions and rasterization drift", () => {
  const staleHash = structuredClone(SOURCE_FEATURE_ADMISSION_PROFILE);
  staleHash.entries[0].sourceSha256 = "0".repeat(64);
  expect(() => validateSourceFeatureAdmissionProfile(staleHash)).toThrow(
    "profile hash mismatch"
  );

  const incomplete = structuredClone(SOURCE_FEATURE_ADMISSION_PROFILE);
  incomplete.entries[0].observations = incomplete.entries[0].observations.slice(
    0,
    1
  );
  expect(() =>
    validateSourceFeatureAdmissionProfile(rehash(incomplete))
  ).toThrow("requires paired 16/24 observations");

  const regionDrift = structuredClone(SOURCE_FEATURE_ADMISSION_PROFILE);
  regionDrift.entries[0].observations[1].regions = structuredClone(
    regionDrift.entries[0].observations[1].regions
  );
  regionDrift.entries[0].observations[1].regions[0].x += 0.25;
  expect(() =>
    validateSourceFeatureAdmissionProfile(rehash(regionDrift))
  ).toThrow("paired profiled region declarations differ");

  const invalidBounds = structuredClone(SOURCE_FEATURE_ADMISSION_PROFILE);
  invalidBounds.entries[0].observations[0].regions[0].width = 30;
  expect(() =>
    validateSourceFeatureAdmissionProfile(rehash(invalidBounds))
  ).toThrow("invalid profiled region bounds");

  const invalidCounter = structuredClone(SOURCE_FEATURE_ADMISSION_PROFILE);
  invalidCounter.entries[0].observations[0].regions[0].polarity = "ink";
  expect(() =>
    validateSourceFeatureAdmissionProfile(rehash(invalidCounter))
  ).toThrow("profiled counter contract must be clear");

  const rasterDrift = structuredClone(SOURCE_FEATURE_ADMISSION_PROFILE);
  rasterDrift.entries[0].observations[0].rasterization.kind = "native-master";
  expect(() =>
    validateSourceFeatureAdmissionProfile(rehash(rasterDrift))
  ).toThrow("rasterization identity mismatch");

  const sourceIdentityDrift = structuredClone(SOURCE_FEATURE_ADMISSION_PROFILE);
  sourceIdentityDrift.entries[0].sourceSet = "";
  expect(() =>
    validateSourceFeatureAdmissionProfile(rehash(sourceIdentityDrift))
  ).toThrow("invalid profiled source identity");
});

test("blocks source drift and unmeasured alternative representations without claiming another master", () => {
  const entry = SOURCE_FEATURE_ADMISSION_PROFILE.entries.find(
    ({ sourceName }) => sourceName === "color-palette"
  );
  expect(entry).toBeDefined();
  expect(
    resolveSourceFeatureAdmissionProfile({
      finish: entry?.finish ?? "filled",
      master: "24",
      representation: "indexed",
      sourceName: entry?.sourceName ?? "color-palette",
      sourceOrigin: entry?.sourceOrigin ?? "literal",
      sourceSet: entry?.sourceSet,
      sourceSha256: entry?.sourceSha256 ?? "",
    }).status
  ).toBe("profiled");
  expect(
    resolveSourceFeatureAdmissionProfile({
      finish: "filled",
      master: "24",
      representation: "indexed",
      sourceName: "color-palette",
      sourceOrigin: "literal",
      sourceSet: "blode-icons",
      sourceSha256: "0".repeat(64),
    })
  ).toMatchObject({
    reason: expect.stringContaining("hash mismatch"),
    status: "refused",
  });
  expect(
    resolveSourceFeatureAdmissionProfile({
      finish: "filled",
      master: "24",
      representation: "assembly",
      sourceName: "color-palette",
      sourceOrigin: "literal",
      sourceSet: "blode-icons",
      sourceSha256: entry?.sourceSha256 ?? "",
    })
  ).toMatchObject({
    reason: expect.stringContaining("not independently profiled"),
    status: "refused",
  });
  expect(
    resolveSourceFeatureAdmissionProfile({
      finish: "filled",
      master: "16",
      representation: "indexed",
      sourceName: "color-palette",
      sourceOrigin: "literal",
      sourceSet: "blode-icons",
      sourceSha256: entry?.sourceSha256 ?? "",
    })
  ).toEqual({ status: "not-measured" });
  expect(
    resolveSourceFeatureAdmissionProfile({
      finish: "filled",
      master: "24",
      representation: "indexed",
      sourceName: "color-palette",
      sourceOrigin: "central",
      sourceSet: "central",
      sourceSha256: entry?.sourceSha256 ?? "",
    })
  ).toEqual({ status: "not-measured" });
});

test("deep-freezes the fixed registry without changing its hash or resolved evidence", () => {
  const [entry] = SOURCE_FEATURE_ADMISSION_PROFILE.entries;
  const [observation] = entry.observations;
  const [region] = observation.regions;
  const initialHash = SOURCE_FEATURE_ADMISSION_PROFILE.profileHash;
  const initialResolution = resolveSourceFeatureAdmissionProfile({
    finish: entry.finish,
    master: entry.targetMaster,
    representation: entry.representation,
    sourceName: entry.sourceName,
    sourceOrigin: entry.sourceOrigin,
    sourceSet: entry.sourceSet,
    sourceSha256: entry.sourceSha256,
  });
  const mutable = SOURCE_FEATURE_ADMISSION_PROFILE as unknown as {
    entries: SourceFeatureAdmissionProfile["entries"];
    evidence: Record<string, string>;
  };

  expect(Object.isFrozen(SOURCE_FEATURE_ADMISSION_PROFILE)).toBe(true);
  expect(Object.isFrozen(SOURCE_FEATURE_ADMISSION_PROFILE.entries)).toBe(true);
  expect(Object.isFrozen(entry)).toBe(true);
  expect(Object.isFrozen(entry.observations)).toBe(true);
  expect(Object.isFrozen(observation)).toBe(true);
  expect(Object.isFrozen(observation.rasterization)).toBe(true);
  expect(Object.isFrozen(observation.regions)).toBe(true);
  expect(Object.isFrozen(region)).toBe(true);
  expect(Object.isFrozen(SOURCE_FEATURE_ADMISSION_PROFILE.evidence)).toBe(true);

  expect(() => {
    (mutable.entries as unknown as unknown[]).pop();
  }).toThrow(TypeError);
  expect(() => {
    (entry as { sourceName: string }).sourceName = "mutated";
  }).toThrow(TypeError);
  expect(() => {
    (entry.observations as unknown as unknown[]).pop();
  }).toThrow(TypeError);
  expect(() => {
    (observation.rasterization as { kind: string }).kind = "mutated";
  }).toThrow(TypeError);
  expect(() => {
    (observation.regions as unknown as unknown[]).pop();
  }).toThrow(TypeError);
  expect(() => {
    (region as { x: number }).x += 1;
  }).toThrow(TypeError);
  expect(() => {
    mutable.evidence.mutated = "mutated";
  }).toThrow(TypeError);

  expect(SOURCE_FEATURE_ADMISSION_PROFILE.profileHash).toBe(initialHash);
  expect(
    resolveSourceFeatureAdmissionProfile({
      finish: entry.finish,
      master: entry.targetMaster,
      representation: entry.representation,
      sourceName: entry.sourceName,
      sourceOrigin: entry.sourceOrigin,
      sourceSet: entry.sourceSet,
      sourceSha256: entry.sourceSha256,
    })
  ).toEqual(initialResolution);
});
