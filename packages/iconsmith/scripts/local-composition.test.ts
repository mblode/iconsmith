import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import sharp from "sharp";
import { expect, it } from "vitest";

import { stageComposition } from "./local-composition.js";

it("preserves exact sketch bytes with a separate, unapproved composition role", async () => {
  const out = mkdtempSync(path.join(tmpdir(), "iconsmith-composition-"));
  try {
    const input = path.join(out, "input.png");
    const bytes = await sharp({
      create: { background: "white", channels: 4, height: 24, width: 24 },
    })
      .png()
      .toBuffer();
    writeFileSync(input, bytes);
    expect(
      await stageComposition(
        { path: input, source: "Synthetic test fixture" },
        out
      )
    ).toEqual(["composition.png"]);
    expect(readFileSync(path.join(out, "composition.png"))).toEqual(bytes);
    expect(
      JSON.parse(readFileSync(path.join(out, "composition.json"), "utf-8"))
    ).toMatchObject({
      craftApproved: false,
      role: "composition-hypothesis",
      source: "Synthetic test fixture",
      styleReference: false,
    });
  } finally {
    rmSync(out, { force: true, recursive: true });
  }
});

it("rejects mislabeled SVG and missing provenance before model invocation", async () => {
  const out = mkdtempSync(path.join(tmpdir(), "iconsmith-composition-"));
  try {
    const input = path.join(out, "input.png");
    writeFileSync(
      input,
      '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><circle cx="12" cy="12" r="8"/></svg>'
    );
    await expect(
      stageComposition({ path: input, source: "SVG fixture" }, out)
    ).rejects.toThrow("single PNG");
    await expect(
      stageComposition({ path: input, source: " " }, out)
    ).rejects.toThrow("source description");
    expect(await stageComposition(undefined, out)).toEqual([]);
  } finally {
    rmSync(out, { force: true, recursive: true });
  }
});
