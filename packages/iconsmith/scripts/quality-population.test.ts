import { expect, test } from "vitest";

import { FAMILY_CLASSES } from "./family-morphology.js";
import { createCatalogAuditSample } from "./quality-population.js";

test("selects one canonical per resolved family across morphology strata", () => {
  const tokens = ["folder", "wheel", "upload", "leaf", "bell", "symbol"];
  const records = tokens.flatMap((token) =>
    Array.from({ length: 20 }, (_, index) => ({
      set: "blode-icons",
      slug: `${token}-${index + 1}`,
    }))
  );
  const roles = records.map(({ slug }) => ({
    family: `family:${slug}`,
    head: slug,
    role: "canonical" as const,
    slug,
  }));
  const first = createCatalogAuditSample(records, roles, "catalog-audit-v1");
  expect(first).toEqual(
    createCatalogAuditSample(records, roles, "catalog-audit-v1")
  );
  expect(first.manifest).toMatchObject({
    familyCount: 100,
    independence: "catalog-semantic-family",
    purpose: "development-blind-audit",
    qualificationEligible: false,
  });
  expect(first.manifest.slots).toHaveLength(400);
  expect(
    new Set(first.manifest.families.map(({ family }) => family)).size
  ).toBe(100);
  expect(
    FAMILY_CLASSES.every((morphology) =>
      first.manifest.families.some((row) => row.morphology === morphology)
    )
  ).toBe(true);
});
