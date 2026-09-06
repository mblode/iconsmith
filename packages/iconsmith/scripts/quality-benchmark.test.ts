import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { expect, test } from "vitest";

import { exportAudit, freezeDevelopment } from "./quality-benchmark.js";

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
          program: "icon cloud-upload\nfinish filled\ncircle 12,12 r8\nunknown",
          source: "test-fixture",
        },
      ],
      path.join(manifest, "manifest.json")
    );
    expect(result).toEqual({ count: 1, missing: 39, qualified: false });
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
          program: "icon cloud-upload\nfinish outlined\ncircle 12,12 r8",
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
