/** Native raster evidence shared by the checker and independent reviewer. */
import { createHash } from "node:crypto";

import sharp from "sharp";

import { png } from "./render.js";

/** Exact samples from encoded image bytes, in local zero-based pixel coordinates. */
export const rasterSamples = async (input: Uint8Array) => {
  const { data, info } = await sharp(input)
    .flatten({ background: "white" })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return {
    height: info.height,
    imageSha256: createHash("sha256").update(input).digest("hex"),
    rows: Array.from({ length: info.height }, (_, y) => [
      ...data.subarray(y * info.width, (y + 1) * info.width),
    ]),
    width: info.width,
  };
};

const label = (x: number, y: number, text: string, fill: string) =>
  `<text x="${x}" y="${y}" fill="${fill}" font-size="11" font-family="Arial,sans-serif">${text}</text>`;

export const opticalProof = async (svg: string, nativeSize: number) => {
  if (!Number.isInteger(nativeSize) || nativeSize < 8 || nativeSize > 48) {
    throw new Error("Optical evidence requires a native size from 8 to 48px.");
  }
  const tile = nativeSize * 8;
  const column = tile + 32;
  const row = tile + 88;
  const width = column * 3;
  const height = row * 2;
  const native = await png(svg, nativeSize);
  const retina = await png(svg, nativeSize * 2);
  const vector = await png(svg, tile);
  const [nativePixels, retinaPixels] = await Promise.all(
    [native, retina].map(rasterSamples)
  );
  const enlarged = await Promise.all(
    [native, retina].map((input) =>
      sharp(input).resize(tile, tile, { kernel: "nearest" }).png().toBuffer()
    )
  );
  const images = [vector, ...enlarged];
  const titles = [
    "Enlarged vector",
    `${nativeSize}px / 1x: pixels enlarged 8x`,
    `${nativeSize}px / 2x: pixels enlarged 4x`,
  ];
  const labels = [0, 1].flatMap((surface) => {
    const color = surface ? "white" : "black";
    return titles.flatMap((title, index) => [
      label(index * column + 16, surface * row + 20, title, color),
      label(
        index * column + 16,
        surface * row + 36,
        "TOP y=0 / LEFT x=0",
        color
      ),
      label(
        index * column + 16,
        surface * row + tile + 66,
        "BOTTOM y=24 / RIGHT x=24",
        color
      ),
    ]);
  });
  const frame = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="white"/><rect y="${row}" width="${width}" height="${row}" fill="black"/>${labels.join("")}</svg>`
  );
  const dark = await Promise.all(
    images.map((input) =>
      sharp(input).negate({ alpha: false }).png().toBuffer()
    )
  );
  const proof = await sharp(frame)
    .composite(
      [...images, ...dark].map((input, index) => ({
        input,
        left: (index % 3) * column + 16,
        top: Math.floor(index / 3) * row + 44,
      }))
    )
    .png()
    .toBuffer();
  return {
    metadata: {
      coordinateSpace: "24x24 SVG viewport",
      deviceScales: [1, 2],
      nativeSize,
      opticalMasterClaim: false,
      surfaces: ["black-on-white", "white-on-black monochrome inversion"],
    },
    native,
    pixels: {
      coordinateSpace: "zero-based image pixels; rows[y][x]",
      grayscale: "0 black, 255 white, flattened on white",
      native: nativePixels,
      retina: retinaPixels,
    },
    proof,
    retina,
  };
};
