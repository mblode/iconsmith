import { describe, expect, test } from "vitest";

import type { RoleAssignment } from "../src/corpus/concepts.js";
import {
  annotateConstructionClasses,
  createConstructionCoverage,
} from "./family-construction-coverage.js";

const roles: RoleAssignment[] = [
  { family: "#cloud", head: "cloud", role: "canonical", slug: "cloud" },
  {
    family: "#bicycle",
    head: "bicycle",
    role: "canonical",
    slug: "bicycle",
  },
  {
    family: "#hammer",
    head: "hammer",
    role: "canonical",
    slug: "hammer",
  },
  { family: "#cloud", head: "cloud", role: "state", slug: "cloud-upload" },
];

describe("construction coverage", () => {
  test("uses explicit metadata for multiple review strata without a default", () => {
    expect(annotateConstructionClasses(["bicycle"])).toEqual([
      { constructionClass: "transport", matchedTokens: ["bicycle"] },
      { constructionClass: "dense", matchedTokens: ["bicycle"] },
    ]);
    expect(annotateConstructionClasses(["cloud"])).toEqual([
      { constructionClass: "organic", matchedTokens: ["cloud"] },
    ]);
    expect(annotateConstructionClasses(["labor pipette"])).toEqual([
      { constructionClass: "tool", matchedTokens: ["pipette"] },
      { constructionClass: "narrow", matchedTokens: ["pipette"] },
    ]);
  });

  test("counts canonical semantic families once and preserves unknown coverage", () => {
    const first = createConstructionCoverage(
      [
        { set: "blode-icons", slug: "cloud" },
        { set: "blode-icons", slug: "cloud-upload" },
        { set: "blode-icons", slug: "bicycle" },
        { set: "blode-icons", slug: "bicycle-filled" },
        { concepts: ["mallet"], set: "blode-icons", slug: "hammer" },
        { set: "other", slug: "train" },
      ],
      roles
    );
    const second = createConstructionCoverage(
      [
        { concepts: ["mallet"], set: "blode-icons", slug: "hammer" },
        { set: "blode-icons", slug: "bicycle" },
        { set: "blode-icons", slug: "cloud-upload" },
        { set: "blode-icons", slug: "cloud" },
      ],
      roles
    );

    expect(first.hash).toBe(second.hash);
    expect(first.report.familyCount).toBe(3);
    expect(first.report.unclassifiedCount).toBe(0);
    expect(first.report.counts).toMatchObject({
      dense: 1,
      tool: 1,
      transport: 1,
    });
    expect(
      first.report.families.find(({ head }) => head === "cloud")
    ).toMatchObject({
      status: "metadata-annotated",
    });
  });
});
