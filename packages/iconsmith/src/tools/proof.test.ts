import { createHash } from "node:crypto";

import sharp from "sharp";
import { expect, it } from "vitest";

import { opticalProof } from "./proof.js";
import { png } from "./render.js";

const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M4 18L12 4L20 18" stroke="currentColor" stroke-width="1.8" fill="none"/></svg>';

it.each([16, 20, 24])(
  "retains actual %ipx samples at both device scales on both surfaces",
  async (size) => {
    const evidence = await opticalProof(svg, size);
    const tile = size * 8;
    const column = tile + 32;
    const row = tile + 88;
    await Promise.all(
      [1, 2].map(async (scale, index) => {
        const actual = scale === 1 ? evidence.native : evidence.retina;
        const metadata = await sharp(actual).metadata();
        expect(metadata.width).toBe(size * scale);
        expect(actual).toEqual(await png(svg, size * scale));
        const pixels =
          scale === 1 ? evidence.pixels.native : evidence.pixels.retina;
        expect([pixels.width, pixels.height]).toEqual([
          size * scale,
          size * scale,
        ]);
        expect(pixels.imageSha256).toBe(
          createHash("sha256").update(actual).digest("hex")
        );
        const rawPixels = await sharp(actual)
          .flatten({ background: "white" })
          .greyscale()
          .raw()
          .toBuffer();
        expect(Buffer.from(pixels.rows.flat())).toEqual(rawPixels);
        const expected = await sharp(actual)
          .resize(tile, tile, { kernel: "nearest" })
          .removeAlpha()
          .raw()
          .toBuffer();
        const light = await sharp(evidence.proof)
          .extract({
            height: tile,
            left: (index + 1) * column + 16,
            top: 44,
            width: tile,
          })
          .removeAlpha()
          .raw()
          .toBuffer();
        const dark = await sharp(evidence.proof)
          .extract({
            height: tile,
            left: (index + 1) * column + 16,
            top: row + 44,
            width: tile,
          })
          .removeAlpha()
          .raw()
          .toBuffer();
        expect(light).toEqual(expected);
        expect(dark).toEqual(Buffer.from(expected.map((value) => 255 - value)));
      })
    );
    expect(evidence.metadata.opticalMasterClaim).toBe(false);
  }
);

it("refuses misleading native dimensions", async () => {
  await expect(opticalProof(svg, 16.5)).rejects.toThrow("native size");
});
