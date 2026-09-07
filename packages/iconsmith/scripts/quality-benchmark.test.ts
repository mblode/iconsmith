import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { expect, test } from "vitest";

import { DEFAULT_POLICY } from "../src/pipeline/policy.js";
import {
  createStyleRevision,
  compileStyle,
  selectStyle,
  STYLE_COMPILER,
} from "../src/pipeline/style.js";
import { specAt } from "../src/tools/spec.js";
import {
  DEVELOPMENT_FAMILIES,
  exportAudit,
  freezeDevelopment,
} from "./quality-benchmark.js";

const revision = createStyleRevision({
  calibration: "unvalidated",
  compiler: STYLE_COMPILER,
  id: "audit-fixture",
  masters: { large: specAt(), small: specAt({ size: 16 }) },
  parts: [
    {
      master: "small",
      part: {
        closed: true,
        d: "M0 0C0.123 2.456 3.789 4.321 8 8L8 0Z",
        h: 8,
        icons: [],
        id: "curve",
        instances: 1,
        nodes: 2,
        sizeRange: [8, 8],
        w: 8,
      },
      provenance: { date: "2026-09-07", origin: "original" },
    },
  ],
  policy: DEFAULT_POLICY,
  references: [],
  rubric: "Fixture only",
});
const selection = selectStyle(revision, "small");
const artifact = compileStyle(
  selection,
  "icon cloud-upload\nfinish filled\ncircle 12,12 r8\npart curve at 4,4"
);
const context = {
  artifact,
  revision: revision.definition,
  terminal: { deadlineExceeded: false, status: "delivered" },
};

test("audit preserves failed variants, manual provenance and missing rows", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "quality-audit-"));
  try {
    const manifest = path.join(root, "frozen");
    freezeDevelopment(manifest);
    const out = path.join(root, "audit");
    const result = await exportAudit(
      out,
      [
        {
          actualUsd: null,
          authorship: "manual",
          concept: "cloud-upload",
          elapsedMs: null,
          family: "cloud",
          finish: "filled",
          model: null,
          ...context,
          artifact: { ...artifact, program: `${artifact.program}\nunknown` },
          source: "test-fixture",
        },
      ],
      path.join(manifest, "manifest.json")
    );
    expect(result).toEqual({ count: 1, missing: 79, qualified: false });
    const receipt = JSON.parse(
      readFileSync(path.join(out, "provenance.json"), "utf-8")
    );
    expect(receipt.artifacts[0]).toMatchObject({
      authorship: "manual",
      replay: false,
      status: "construction-failed",
    });
    expect(
      JSON.parse(readFileSync(path.join(out, "human-review.json"), "utf-8"))[0]
        .approved
    ).toBeNull();
    const wrong = path.join(root, "wrong-paint");
    await exportAudit(
      wrong,
      [
        {
          actualUsd: null,
          authorship: "model",
          concept: "cloud-upload",
          elapsedMs: null,
          family: "cloud",
          finish: "filled",
          model: "test",
          ...context,
          artifact: compileStyle(
            selection,
            "icon cloud-upload\nfinish outlined\ncircle 12,12 r8"
          ),
          source: "test-fixture",
        },
      ],
      path.join(manifest, "manifest.json")
    );
    expect(
      JSON.parse(readFileSync(path.join(wrong, "provenance.json"), "utf-8"))
        .artifacts[0]
    ).toMatchObject({
      paintMatches: false,
      replay: false,
      status: "construction-failed",
    });
    const file = path.join(manifest, "manifest.json");
    const modified = JSON.parse(readFileSync(file, "utf-8"));
    modified.manifest.families[0].concept = "changed";
    writeFileSync(file, JSON.stringify(modified));
    await expect(
      exportAudit(path.join(root, "other"), [], file)
    ).rejects.toThrow("manifest changed");
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("audit binds native identity, original SVG and dependencies", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "quality-pinned-"));
  try {
    const frozen = path.join(root, "frozen");
    freezeDevelopment(frozen);
    const manifest = path.join(frozen, "manifest.json");
    const input = {
      ...context,
      actualUsd: null,
      authorship: "model" as const,
      concept: "cloud-upload",
      elapsedMs: null,
      family: "cloud",
      finish: "filled" as const,
      model: null,
      source: "fixture",
    };
    await exportAudit(path.join(root, "valid"), [input], manifest);
    const receipt = JSON.parse(
      readFileSync(path.join(root, "valid/provenance.json"), "utf-8")
    );
    expect(receipt.artifacts[0]).toMatchObject({
      nativeSize: 16,
      replay: true,
      revisionHash: revision.hash,
    });
    expect(receipt.missing).toContainEqual({
      concept: "cloud-upload",
      family: "cloud",
      finish: "filled",
      nativeSize: 24,
      status: "not-generated",
    });
    expect(readFileSync(path.join(root, "valid/Q001.svg"), "utf-8")).toBe(
      artifact.svg
    );
    await expect(
      exportAudit(path.join(root, "duplicate"), [input, input], manifest)
    ).rejects.toThrow("Duplicate");
    await expect(
      exportAudit(
        path.join(root, "tampered"),
        [{ ...input, artifact: { ...artifact, svg: "<svg/>" } }],
        manifest
      )
    ).rejects.toThrow("hash mismatch");
    await expect(
      exportAudit(
        path.join(root, "missing-context"),
        [{ ...input, revision: {} }],
        manifest
      )
    ).rejects.toThrow();
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("blind audit batches contain at most twenty genuine native stimuli", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "quality-batches-"));
  try {
    const frozen = path.join(root, "frozen");
    freezeDevelopment(frozen);
    const inputs = DEVELOPMENT_FAMILIES.map(({ concept, family }) => ({
      ...context,
      actualUsd: null,
      artifact: compileStyle(
        selection,
        `icon ${concept}\nfinish filled\ncircle 12,12 r8`
      ),
      authorship: "model" as const,
      concept,
      elapsedMs: null,
      family,
      finish: "filled" as const,
      model: null,
      source: "fixture",
    }));
    inputs.push({
      ...inputs[0],
      artifact: compileStyle(
        selectStyle(revision, "large"),
        inputs[0].artifact.program
      ),
    });
    await exportAudit(
      path.join(root, "audit"),
      inputs,
      path.join(frozen, "manifest.json")
    );
    const batches = JSON.parse(
      readFileSync(path.join(root, "audit/batches.json"), "utf-8")
    );
    expect(batches.map((batch: { count: number }) => batch.count)).toEqual([
      20, 1,
    ]);
    const labels = JSON.parse(
      readFileSync(path.join(root, "audit/batch-001.labels.json"), "utf-8")
    );
    expect(
      labels.every(
        (label: {
          humanIdentity: unknown;
          recognition: unknown;
          svgSha256: string;
        }) =>
          label.humanIdentity === null &&
          label.recognition === null &&
          label.svgSha256.length === 64
      )
    ).toBe(true);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("deadline failures retain successful geometry replay without claiming construction failed", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "quality-deadline-"));
  try {
    freezeDevelopment(path.join(root, "frozen"));
    await exportAudit(
      path.join(root, "audit"),
      [
        {
          ...context,
          actualUsd: null,
          authorship: "model",
          concept: "cloud-upload",
          elapsedMs: 600_001,
          family: "cloud",
          finish: "filled",
          model: "fixture",
          source: "fixture",
          terminal: { deadlineExceeded: true, status: "delivered" },
        },
      ],
      path.join(root, "frozen/manifest.json")
    );
    const receipt = JSON.parse(
      readFileSync(path.join(root, "audit/provenance.json"), "utf-8")
    );
    expect(receipt.artifacts[0]).toMatchObject({
      replay: true,
      status: "deadline-exhausted",
    });
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});
