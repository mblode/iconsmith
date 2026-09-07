import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import sharp from "sharp";
import { expect, test } from "vitest";

import { candidateSheet } from "./ai-control-campaign-prep.js";

const sha = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

test("keeps mixed-size native and enlarged evidence fully visible and unscaled", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "control-sheet-"));
  const names = [
    "enlarged-light.png",
    "1x-light.png",
    "2x-light.png",
    "enlarged-dark.png",
    "1x-dark.png",
    "2x-dark.png",
  ];
  const dimensions = [192, 24, 48, 192, 24, 48];
  try {
    const evidence: Record<string, string> = {};
    const inputs = await Promise.all(
      names.map(async (name, index) => {
        const size = dimensions[index] ?? 0;
        const bytes = await sharp({
          create: {
            background: {
              alpha: 1,
              b: (index + 1) * 20,
              g: (index + 1) * 15,
              r: (index + 1) * 10,
            },
            channels: 4,
            height: size,
            width: size,
          },
        })
          .png()
          .toBuffer();
        const directory = path.join(root, `S001-${index}`);
        mkdirSync(directory);
        const relative = path.join(`S001-${index}`, name);
        writeFileSync(path.join(root, relative), bytes);
        evidence[relative] = sha(bytes);
        return bytes;
      })
    );
    const sheet = await candidateSheet(root, evidence);
    expect(await sharp(sheet).metadata()).toMatchObject({
      height: 464,
      width: 624,
    });
    await Promise.all(
      inputs.map(async (input, index) => {
        const size = dimensions[index] ?? 0;
        const crop = await sharp(sheet)
          .extract({
            height: size,
            left: (index % 3) * 208 + Math.floor((208 - size) / 2),
            top:
              Math.floor(index / 3) * 232 + 24 + Math.floor((208 - size) / 2),
            width: size,
          })
          .raw()
          .toBuffer();
        const original = await sharp(input).raw().toBuffer();
        expect(crop).toEqual(original);
      })
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});
