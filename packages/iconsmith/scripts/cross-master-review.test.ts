import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import sharp from "sharp";
import { expect, test } from "vitest";

import {
  readCrossMasterReview,
  reviewCrossMasterEvidence,
  writeCrossMasterReview,
} from "./cross-master-review.js";
import type { CrossMasterEvidence } from "./cross-master-review.js";

const hash = (bytes: string | Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

const fixtures = async (root: string, shifted = false) => {
  const evidence: CrossMasterEvidence[] = [];
  for (const nativeSize of [16, 24] as const) {
    for (const finish of ["outlined", "filled"] as const) {
      const stem = `${nativeSize}-${finish}`;
      const nativeFile = path.join(root, `${stem}.png`);
      const svgFile = path.join(root, `${stem}.svg`);
      const maskFile = path.join(root, `${stem}.mask.png`);
      const svg = `<svg viewBox="0 0 ${nativeSize} ${nativeSize}"><path d="M1 1H${nativeSize - 1}V${nativeSize - 1}Z"/></svg>`;
      // Fixture files intentionally share one temporary directory.
      // eslint-disable-next-line no-await-in-loop
      await sharp({
        create: {
          background: finish === "filled" ? "#000" : "#777",
          channels: 4,
          height: nativeSize,
          width: nativeSize,
        },
      })
        .png()
        .toFile(nativeFile);
      const left =
        nativeSize === 24 && shifted ? 15 : Math.round(nativeSize / 2);
      // eslint-disable-next-line no-await-in-loop
      await sharp({
        create: {
          background: { alpha: 0, b: 0, g: 0, r: 0 },
          channels: 4,
          height: nativeSize,
          width: nativeSize,
        },
      })
        .composite([
          {
            input: Buffer.from(
              '<svg width="2" height="2"><rect width="2" height="2" fill="black"/></svg>'
            ),
            left,
            top: Math.round(nativeSize / 2),
          },
        ])
        .png()
        .toFile(maskFile);
      writeFileSync(svgFile, svg);
      evidence.push({
        concept: "folder-lock",
        family: "folder",
        finish,
        modifierMaskFile: maskFile,
        modifierMaskSha256: hash(readFileSync(maskFile)),
        nativeImageFile: nativeFile,
        nativeImageSha256: hash(readFileSync(nativeFile)),
        nativeSize,
        svgFile,
        svgSha256: hash(svg),
      });
    }
  }
  return evidence;
};

test("rejects an empty cross-master evidence population", async () => {
  await expect(reviewCrossMasterEvidence([])).rejects.toThrow("empty");
});

test("binds deliberately different masters and keeps paint distinction advisory", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "cross-master-"));
  try {
    const result = await reviewCrossMasterEvidence(await fixtures(root));
    expect(result).toMatchObject({
      complete: true,
      receipt: { status: "pending-independent-review" },
      reviewRequired: true,
    });
    expect(result.receipt.comparisons).toContainEqual(
      expect.objectContaining({ advisory: "measured-paint-distinction-only" })
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("detects shifted or missing modifier sibling evidence", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "cross-master-"));
  try {
    const shifted = await reviewCrossMasterEvidence(await fixtures(root, true));
    expect(shifted.reviewRequired).toBe(true);
    expect(shifted.receipt.issues.join(" ")).toContain("shifted modifier");
    const complete = await fixtures(root);
    const missing = complete.slice(1);
    const missingResult = await reviewCrossMasterEvidence(missing);
    expect(missingResult).toMatchObject({
      complete: false,
      reviewRequired: true,
    });
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("writes a review sheet and stale-checks every receipt member", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "cross-master-"));
  try {
    const evidence = await fixtures(root);
    const out = path.join(root, "out");
    await writeCrossMasterReview(out, evidence);
    expect(readFileSync(path.join(out, "review.png"))).not.toHaveLength(0);
    await expect(
      readCrossMasterReview(path.join(out, "receipt.json"))
    ).resolves.toMatchObject({ complete: true });
    writeFileSync(evidence[0].svgFile, "changed");
    await expect(
      readCrossMasterReview(path.join(out, "receipt.json"))
    ).rejects.toThrow("hash mismatch");
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});
