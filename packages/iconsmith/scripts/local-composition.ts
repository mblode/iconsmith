/** Preserve a visual composition hypothesis without admitting its geometry. */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import sharp from "sharp";

export interface CompositionInput {
  path: string;
  source: string;
}

export const COMPOSITION_INSTRUCTIONS =
  "composition.png is an unapproved composition hypothesis, not a style reference or an answer key. Its source is recorded in composition.json. Use its silhouette and spatial relationships only when they improve the requested concept. Correct its defects against the pinned style and native-size evidence. Reconstruct with admitted parts and constrained primitives; never trace or import its path data. If an essential curve cannot be expressed, report the missing representation instead of replacing it with visibly unsuitable geometry. The independent reviewer does not see this hypothesis.";

export const stageComposition = async (
  input: CompositionInput | undefined,
  out: string
): Promise<string[]> => {
  if (!input) {
    return [];
  }
  if (!input.source.trim()) {
    throw new Error("A composition requires a source description.");
  }
  const bytes = readFileSync(input.path);
  const metadata = await sharp(bytes, {
    limitInputPixels: 4096 ** 2,
  }).metadata();
  if (
    metadata.format !== "png" ||
    !metadata.width ||
    !metadata.height ||
    metadata.width > 4096 ||
    metadata.height > 4096 ||
    (metadata.pages ?? 1) !== 1
  ) {
    throw new Error(
      "A composition must be a single PNG of at most 4096px per side."
    );
  }
  // Decode before provider invocation; metadata alone may describe a truncated PNG.
  await sharp(bytes, { limitInputPixels: 4096 ** 2 })
    .raw()
    .toBuffer();
  writeFileSync(path.join(out, "composition.png"), bytes);
  writeFileSync(
    path.join(out, "composition.json"),
    JSON.stringify(
      {
        craftApproved: false,
        height: metadata.height,
        role: "composition-hypothesis",
        sha256: createHash("sha256").update(bytes).digest("hex"),
        source: input.source,
        styleReference: false,
        width: metadata.width,
      },
      null,
      2
    )
  );
  return ["composition.png"];
};
