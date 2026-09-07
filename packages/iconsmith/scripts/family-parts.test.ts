import { expect, test } from "vitest";

import { DEFAULT_POLICY } from "../src/pipeline/policy.js";
import {
  compileStyle,
  selectStyle,
  createStyleRevision,
  STYLE_COMPILER,
} from "../src/pipeline/style.js";
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
        svg: '<svg><path fill="black" stroke="black" d="M4 4H20V20H4Z"/></svg>',
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
test("preserves nonzero source ink instead of imposing parity counters", async () => {
  await expect(
    admitFamilyParts(revision(), "24", [
      {
        finish: "filled",
        name: "box",
        provenance,
        svg: '<svg viewBox="0 0 24 24"><path d="M4 4H20V20H4ZM8 8H16V16H8Z"/></svg>',
      },
    ])
  ).resolves.toMatchObject({
    definition: { parts: [{ part: { sourceFillRule: "nonzero" } }] },
  });
});

test("outlined family keeps filled source boundaries and mixed solid details replayable", async () => {
  const result = await admitFamilyParts(revision(), "24", [
    {
      finish: "outlined",
      name: "boundary",
      provenance,
      svg: '<svg viewBox="0 0 24 24" fill="none"><path fill="currentColor" fill-rule="evenodd" d="M4 4H20V20H4ZM8 8H16V16H8Z"/><path stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M9 12H15"/></svg>',
    },
  ]);
  const selection = selectStyle(result, "24");
  const artifact = compileStyle(
    selection,
    "icon boundary\nfinish outlined\npart boundary-outlined-0 at 4,4\npart boundary-outlined-1 at 9,12"
  );
  expect(artifact.svg).toContain('fill-rule="evenodd"');
  expect(artifact.svg).toContain('stroke-width="2"');
  const { run, completeProgram } = await import("../src/tools/dsl.js");
  const { Canvas } = await import("../src/tools/canvas.js");
  const drawn = run(artifact.program, [...selection.parts], {
    spec: selection.spec,
  });
  const doc = drawn.canvas.toJSON({ icon: drawn.icon, keyline: drawn.keyline });
  expect(
    completeProgram(doc, artifact.program, selection.parts, {
      spec: selection.spec,
    })
  ).toBe(true);
  expect(
    Canvas.fromJSON(doc, [...selection.parts], selection.spec).toSVG()
  ).toBe(artifact.svg);
});
