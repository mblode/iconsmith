import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
/* eslint-disable no-await-in-loop -- fixture files are built in manifest order */
import { tmpdir } from "node:os";
import path from "node:path";

import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { buildNativePresentationReceipt } from "./family-construction-native-sheet.js";

describe("family construction native sheet", () => {
  it("keeps actual pixels distinct from a disclosed uniform enlargement", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "iconsmith-native-sheet-"));
    const boardDirectory = path.join(root, "board");
    const out = path.join(root, "receipt");
    mkdirSync(boardDirectory);
    const outputs = [];
    for (const finish of ["outlined", "filled"] as const) {
      for (const master of ["16", "24"] as const) {
        const native = [];
        for (const surface of ["light", "dark"] as const) {
          const file = `${finish}-${master}-${surface}.png`;
          writeFileSync(
            path.join(boardDirectory, file),
            await sharp({
              create: {
                background: surface === "dark" ? "#111" : "#fff",
                channels: 3,
                height: Number(master),
                width: Number(master),
              },
            })
              .png()
              .toBuffer()
          );
          native.push({ file, surface });
        }
        outputs.push({ finish, master, native });
      }
    }
    writeFileSync(
      path.join(boardDirectory, "manifest.json"),
      JSON.stringify({
        cases: [{ family: "fixture", mode: "reconstruction", outputs }],
      })
    );

    const receipt = await buildNativePresentationReceipt({
      boardDirectory,
      out,
    });

    expect(receipt.presentation.actual.scale).toBe(1);
    expect(receipt.presentation.enlarged).toMatchObject({
      kernel: "nearest",
      scale: 4,
    });
    expect(readFileSync(path.join(out, "native-actual-size.png"))).not.toEqual(
      readFileSync(path.join(out, "native-uniform-4x.png"))
    );
  });
});
