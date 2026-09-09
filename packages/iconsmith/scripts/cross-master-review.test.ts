import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import sharp from "sharp";
import { expect, test } from "vitest";

import { png } from "../src/tools/render.js";
import {
  readCrossMasterReview,
  reviewCrossMasterEvidence,
  writeCrossMasterReview,
} from "./cross-master-review.js";
import type { CrossMasterEvidence } from "./cross-master-review.js";

const hash = (bytes: string | Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

const fixtures = async (
  root: string,
  shifted = false,
  modifierEvidence?: "present" | "not-applicable"
) => {
  const evidence: CrossMasterEvidence[] = [];
  for (const nativeSize of [16, 24] as const) {
    for (const finish of ["outlined", "filled"] as const) {
      const stem = `${nativeSize}-${finish}`;
      const nativeFile = path.join(root, `${stem}.png`);
      const svgFile = path.join(root, `${stem}.svg`);
      const maskFile = path.join(root, `${stem}.mask.png`);
      const svg = `<svg viewBox="0 0 ${nativeSize} ${nativeSize}"><path fill="${finish === "filled" ? "#000" : "#777"}" d="M1 1H${nativeSize - 1}V${nativeSize - 1}Z"/></svg>`;
      // Fixture files intentionally share one temporary directory.
      // eslint-disable-next-line no-await-in-loop
      writeFileSync(nativeFile, await png(svg, nativeSize));
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
        modifierEvidence,
        ...(modifierEvidence === "not-applicable"
          ? {}
          : {
              modifierMaskFile: maskFile,
              modifierMaskSha256: hash(readFileSync(maskFile)),
            }),
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
    expect(shifted.complete).toBe(false);
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

test("keeps modifier layout unresolved when masks are absent", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "cross-master-"));
  try {
    const evidence = await fixtures(root, false, "not-applicable");
    const undeclared = evidence.map(({ modifierEvidence: _, ...row }) => row);
    const result = await reviewCrossMasterEvidence(undeclared);
    expect(result.complete).toBe(false);
    expect(result.receipt.issues).toEqual([
      "folder/folder-lock/outlined: unknown modifier evidence",
      "folder/folder-lock/filled: unknown modifier evidence",
    ]);
    expect(result.receipt.comparisons).toContainEqual(
      expect.objectContaining({ modifierAssessment: "unknown" })
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("requires masks for declared modifiers and binds applicability identity", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "cross-master-"));
  try {
    const noModifier = await fixtures(root, false, "not-applicable");
    const missingMask = noModifier.map((row) => ({
      ...row,
      modifierEvidence: "present" as const,
    }));
    const missing = await reviewCrossMasterEvidence(missingMask);
    expect(missing.complete).toBe(false);
    expect(missing.receipt.issues.join(" ")).toContain(
      "missing modifier sibling evidence"
    );

    const inconsistent = noModifier.map((row, index) =>
      index === 0 ? { ...row, modifierEvidence: "present" as const } : row
    );
    const mismatch = await reviewCrossMasterEvidence(inconsistent);
    expect(mismatch.complete).toBe(false);
    expect(mismatch.receipt.issues.join(" ")).toContain(
      "modifier applicability mismatch"
    );

    const masked = await fixtures(root);
    await expect(
      reviewCrossMasterEvidence([
        { ...masked[0], modifierEvidence: "not-applicable" },
        ...masked.slice(1),
      ])
    ).rejects.toThrow("cannot include a modifier mask");
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("keeps explicitly declared no-modifier families complete", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "cross-master-"));
  try {
    const result = await reviewCrossMasterEvidence(
      await fixtures(root, false, "not-applicable")
    );
    expect(result.complete).toBe(true);
    expect(result.receipt.issues).toEqual([]);
    expect(result.receipt.comparisons).toContainEqual(
      expect.objectContaining({ modifierAssessment: "not-applicable" })
    );
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

test.each(["svg", "native"] as const)(
  "rejects rehashed mismatched %s evidence",
  async (changed) => {
    const root = mkdtempSync(path.join(tmpdir(), "cross-master-binding-"));
    try {
      const evidence = await fixtures(root);
      const [row] = evidence;
      const otherSvg =
        '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/></svg>';
      if (changed === "svg") {
        writeFileSync(row.svgFile, otherSvg);
        row.svgSha256 = hash(otherSvg);
      } else {
        const otherNative = await png(otherSvg, row.nativeSize);
        writeFileSync(row.nativeImageFile, otherNative);
        row.nativeImageSha256 = hash(otherNative);
      }
      await expect(reviewCrossMasterEvidence(evidence)).rejects.toThrow(
        "does not match the bound SVG"
      );
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  }
);

test("accepts identical native pixels with a different PNG encoding", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "cross-master-binding-"));
  try {
    const evidence = await fixtures(root);
    const [row] = evidence;
    const encoded = await sharp(readFileSync(row.nativeImageFile))
      .png({ compressionLevel: 0 })
      .toBuffer();
    expect(hash(encoded)).not.toBe(row.nativeImageSha256);
    writeFileSync(row.nativeImageFile, encoded);
    row.nativeImageSha256 = hash(encoded);
    const result = await reviewCrossMasterEvidence(evidence);
    expect(result.complete).toBe(true);
    expect(result.reviewRequired).toBe(true);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("rejects a non-native master from serialized input", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "cross-master-binding-"));
  try {
    const evidence = await fixtures(root);
    const malformed = structuredClone(evidence);
    Object.assign(malformed[0], { nativeSize: 20 });
    await expect(reviewCrossMasterEvidence(malformed)).rejects.toThrow(
      "requires native16 or native24"
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});
