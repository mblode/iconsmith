/** A spatial proof for one SVG. Pixel enlargement is inspection, not a master. */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import sharp from "sharp";

import { png } from "../src/tools/render.js";

const [source, destination] = process.argv.slice(2);
if (!source || !destination) {
  throw new Error("Usage: review-proof.ts <source.svg> <new-directory>");
}
mkdirSync(destination, { recursive: false });
const svg = readFileSync(source, "utf-8");
const large = await png(svg, 192);
const native24 = await png(svg, 24);
const native16 = await png(svg, 16);
const pixels24 = await sharp(native24)
  .resize(192, 192, { kernel: "nearest" })
  .png()
  .toBuffer();
const pixels16 = await sharp(native16)
  .resize(192, 192, { kernel: "nearest" })
  .png()
  .toBuffer();
const label = (x: number, y: number, text: string) =>
  `<text x="${x}" y="${y}" fill="#333" font-size="12" font-family="Arial,sans-serif">${text}</text>`;
const artworkX = [40, 292, 544];
const header = [
  "Vector render enlarged",
  "24px raster: 8x pixels",
  "16px raster: 12x pixels",
];
const labels = artworkX.flatMap((x, index) => [
  label(x, 24, header[index]),
  label(x, 44, "TOP / y=0"),
  label(x, 268, "BOTTOM / y=24"),
  label(x, 286, "LEFT x=0     RIGHT x=24"),
]);
const frame =
  Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="776" height="380">
<rect width="776" height="380" fill="white"/>
${labels.join("")}
${label(40, 318, "Native 24px:")}${label(292, 318, "Native 16px:")}
${label(40, 368, "Coordinates describe the normalized 24 x 24 viewport. Enlarged raster pixels do not constitute optical masters.")}
</svg>`);
const proof = await sharp(frame)
  .composite([
    { input: large, left: 40, top: 60 },
    { input: pixels24, left: 292, top: 60 },
    { input: pixels16, left: 544, top: 60 },
    { input: native24, left: 140, top: 300 },
    { input: native16, left: 392, top: 304 },
  ])
  .png()
  .toBuffer();
for (const [name, data] of [
  ["proof.png", proof],
  ["native-24.png", native24],
  ["native-16.png", native16],
] as const) {
  writeFileSync(path.join(destination, name), data);
}
writeFileSync(
  path.join(destination, "proof.json"),
  JSON.stringify(
    {
      coordinateSpace: "normalized displayed 24x24 viewport",
      craftApproved: false,
      opticalMasters: false,
      source: path.resolve(source),
      views: [
        "192px vector rasterization",
        "24px raster enlarged 8x nearest",
        "16px raster enlarged 12x nearest",
      ],
    },
    null,
    2
  )
);
