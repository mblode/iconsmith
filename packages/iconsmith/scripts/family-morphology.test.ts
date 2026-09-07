import { expect, test } from "vitest";

import {
  classifyFamily,
  describeFamilyMorphology,
  resolveSemanticFamily,
} from "./family-morphology.js";
import type { FamilySource } from "./family-parts.js";

const source = (name: string, svg: string): FamilySource => ({
  finish: "outlined",
  name,
  provenance: { date: "2026-09-07", origin: "literal", set: "blode-icons" },
  svg,
});

test("classifies catalog exposure from concepts, aliases, and donor names", () => {
  expect(classifyFamily("secure", ["folder lock"])).toBe("badge-container");
  expect(classifyFamily("cycle", [], ["bicycle-2"])).toBe("circular-mechanism");
  expect(classifyFamily("jellyfish")).toBe("organic");
});

test("derives morphology and master guidance without retaining geometry", () => {
  const result = describeFamilyMorphology({
    concept: "folder-lock",
    sources: [
      source(
        "folder-2",
        '<svg viewBox="0 0 24 24" fill="none"><path stroke="currentColor" stroke-linecap="round" d="M3 6H10L12 8H21V20H3Z"/><path stroke="currentColor" stroke-linecap="square" d="M8 12V16"/></svg>'
      ),
    ],
  });
  expect(result.familyClass).toBe("badge-container");
  expect(result.sources).toEqual([
    expect.objectContaining({
      closedContours: 1,
      openContours: 1,
      paintedAspect: "landscape",
      roundCaps: true,
      squareCaps: true,
    }),
  ]);
  expect(result.guidance["16"].join(" ")).toContain("device pixel");
  expect(JSON.stringify(result)).not.toContain("M3 6");
});

test("resolves catalog and numbered families and leaves unsupported grouping explicit", () => {
  const roles = [
    {
      family: "folder",
      head: "folder",
      role: "state" as const,
      slug: "folder-lock",
    },
  ];
  expect(resolveSemanticFamily("folder-lock", roles)).toMatchObject({
    head: "folder",
    source: "catalog",
  });
  expect(resolveSemanticFamily("cloud-2")).toMatchObject({
    head: "cloud",
    source: "numbered",
  });
  expect(resolveSemanticFamily("cloud-upload")).toMatchObject({
    head: "cloud-upload",
    role: "unknown",
    source: "unknown",
  });
});
