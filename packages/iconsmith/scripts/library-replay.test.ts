import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { expect, test } from "vitest";

import { DEFAULT_POLICY } from "../src/pipeline/policy.js";
import { STYLE_COMPILER } from "../src/pipeline/style.js";
import { specAt } from "../src/tools/canvas.js";
import {
  admitLibrarySources,
  replayLibrary,
  replayLibraryIcon,
} from "./library-replay.js";

const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");

test("full-library regression reports actual raster differences and refuses empty source", async () => {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M4 4H20V20H4Z" fill="#000"/></svg>';
  const r = await replayLibraryIcon("box", "filled", svg);
  expect(r.exactReplay).toBe(true);
  expect(r.errors.every((e) => e.meanAbsolutePixelError < 0.001)).toBe(true);
  await expect(
    replayLibraryIcon("missing", "filled", "<svg/>")
  ).rejects.toThrow("No drawable");
});

test.each([
  "source",
  "inventory",
  "semantic",
  "consistent-rewrite",
  "empty",
  "unchanged",
])("replay binds frozen inventory and source identity: %s", async (target) => {
  const root = mkdtempSync(path.join(tmpdir(), "iconsmith-replay-identity-"));
  const svg = '<svg viewBox="0 0 24 24"><path d="M4 4H20V20H4Z"/></svg>';
  const rows = [
    {
      concept: "box",
      file: "box-filled.svg",
      finish: "filled",
      sha256: hash(svg),
    },
  ];
  const manifest = {
    files: 1,
    source: root,
    sourceHash: hash(
      JSON.stringify(rows.map(({ file, sha256 }) => ({ file, sha256 })))
    ),
  };
  let expectedHash = hash(JSON.stringify({ manifest, rows }));
  const inventory = path.join(root, "inventory.json");
  const out = path.join(root, "replay");
  try {
    const changedSvg = svg.replace("20", "18");
    writeFileSync(
      path.join(root, "box-filled.svg"),
      ["source", "consistent-rewrite"].includes(target) ? changedSvg : svg
    );
    if (target === "inventory") {
      manifest.sourceHash = "a".repeat(64);
    }
    if (target === "semantic") {
      rows[0].concept = "different";
      rows[0].finish = "outlined";
    }
    if (target === "consistent-rewrite") {
      rows[0].sha256 = hash(changedSvg);
      manifest.sourceHash = hash(
        JSON.stringify(rows.map(({ file, sha256 }) => ({ file, sha256 })))
      );
    }
    if (target === "empty") {
      rows.splice(0);
      manifest.files = 0;
      manifest.sourceHash = hash("[]");
      expectedHash = hash(JSON.stringify({ manifest, rows }));
    }
    writeFileSync(inventory, JSON.stringify({ manifest, rows }));
    if (target === "unchanged") {
      expect(await replayLibrary(inventory, out, expectedHash)).toMatchObject({
        exactReplay: 1,
        failures: 0,
        inventorySha256: expectedHash,
        sourceIdentityVerified: true,
      });
    } else if (target === "source") {
      expect(await replayLibrary(inventory, out, expectedHash)).toMatchObject({
        exactReplay: 0,
        failures: 1,
        sourceIdentityVerified: false,
      });
      expect(
        JSON.parse(readFileSync(path.join(out, "results.json"), "utf-8"))
          .results[0].error
      ).toContain("frozen inventory");
    } else {
      await expect(replayLibrary(inventory, out, expectedHash)).rejects.toThrow(
        target === "empty" ? "inventory identity" : "inventory byte identity"
      );
    }
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test.each(["valid", "tampered-source", "tampered-revision"])(
  "admission audit preserves pinned source and revision: %s",
  async (kind) => {
    const root = mkdtempSync(path.join(tmpdir(), "admission-audit-"));
    try {
      const svg =
        '<svg viewBox="0 0 24 24"><path d="M4 4H20V20H4Z" fill="black"/></svg>';
      const rows = [
        {
          concept: "box",
          file: "box-filled.svg",
          finish: "filled",
          sha256: hash(svg),
        },
      ];
      const inventory = JSON.stringify({
        manifest: {
          files: 1,
          source: root,
          sourceHash: hash(
            JSON.stringify(rows.map(({ file, sha256 }) => ({ file, sha256 })))
          ),
        },
        rows,
      });
      const revision = JSON.stringify({
        calibration: "unvalidated",
        compiler: STYLE_COMPILER,
        id: "audit",
        masters: { "24": { ...specAt(), grid: 0.25 } },
        parts: [],
        policy: DEFAULT_POLICY,
        references: [],
        rubric: "Audit source reconstruction",
      });
      const inventoryFile = path.join(root, "inventory.json");
      const revisionFile = path.join(root, "revision.json");
      writeFileSync(inventoryFile, inventory);
      writeFileSync(
        revisionFile,
        kind === "tampered-revision" ? `${revision} ` : revision
      );
      writeFileSync(
        path.join(root, "box-filled.svg"),
        kind === "tampered-source" ? svg.replace("20", "18") : svg
      );
      const options = {
        destination: path.join(root, "out"),
        expectedInventorySha256: hash(inventory),
        expectedRevisionSha256: hash(revision),
        inventoryFile,
        master: "24",
        revisionFile,
      };
      if (kind === "tampered-revision") {
        await expect(admitLibrarySources(options)).rejects.toThrow(
          "revision identity mismatch"
        );
      } else {
        const result = await admitLibrarySources(options);
        expect(result).toMatchObject({
          admitted: kind === "valid" ? 1 : 0,
          generationQualified: false,
          refused: kind === "valid" ? 0 : 1,
          sourceIdentityVerified: kind === "valid",
          total: 1,
        });
        const report = JSON.parse(
          readFileSync(
            path.join(options.destination, "admission-results.json"),
            "utf-8"
          )
        );
        expect(report.rows).toHaveLength(1);
        if (kind === "valid") {
          expect(report.rows[0]).toMatchObject({
            assemblyParts: 0,
            dependencyParts: 0,
            indexedParts: 1,
            parts: 1,
            representations: {
              assembly: { status: "not-applicable" },
              indexed: { status: "admitted" },
            },
          });
        }
      }
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  }
);
