import { expect, test } from "vitest";

import { DEFAULT_POLICY } from "../src/pipeline/policy.js";
import { createStyleRevision, STYLE_COMPILER } from "../src/pipeline/style.js";
import { SPEC } from "../src/tools/canvas.js";
import { admitFamilyParts } from "./family-parts.js";

const revision = () =>
  createStyleRevision({
    calibration: "unvalidated",
    compiler: STYLE_COMPILER,
    id: "family-test",
    masters: { "24": SPEC },
    parts: [],
    policy: DEFAULT_POLICY,
    references: [],
    rubric: "test",
  });
const provenance = {
  date: "2026-09-07",
  licenses: ["MIT"],
  origin: "literal" as const,
  set: "blode-icons",
};
test("keeps a source compound and counter together in an immutable revision", async () => {
  const initial = revision();
  const result = await admitFamilyParts(initial, "24", [
    {
      finish: "filled",
      name: "box",
      provenance,
      svg: '<svg viewBox="0 0 24 24"><path fill-rule="evenodd" d="M4 4H20V20H4ZM8 8H16V16H8Z"/></svg>',
    },
  ]);
  expect(initial.definition.parts).toHaveLength(0);
  expect(result.definition.parts).toHaveLength(1);
  expect(result.definition.parts[0].part.d.match(/M/gu)).toHaveLength(2);
});
test("refuses mismatched paint and unsupported masks", async () => {
  await expect(
    admitFamilyParts(revision(), "24", [
      {
        finish: "outlined",
        name: "box",
        provenance,
        svg: '<svg><path d="M4 4H20V20H4Z"/></svg>',
      },
    ])
  ).rejects.toThrow("incompatible");
  await expect(
    admitFamilyParts(revision(), "24", [
      {
        finish: "filled",
        name: "box",
        provenance,
        svg: '<svg><mask id="m"/></svg>',
      },
    ])
  ).rejects.toThrow("unsupported");
});
test("rejects nonzero compounds whose counters would change under part filling", async () => {
  await expect(
    admitFamilyParts(revision(), "24", [
      {
        finish: "filled",
        name: "box",
        provenance,
        svg: '<svg viewBox="0 0 24 24"><path d="M4 4H20V20H4ZM8 8H16V16H8Z"/></svg>',
      },
    ])
  ).rejects.toThrow("source fidelity failed");
});
