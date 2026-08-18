/**
 * Rendering, for the model's eyes and for scoring.
 *
 * `inkVector`/`cosine` mirror the comparator already used by
 * blode-icons-react/scripts/verify-lucide-mapping.mjs (sharp at density 200,
 * greyscale, blur, cosine over the ink vector) so scores here are directly
 * comparable to the 0.737 cross-set baseline that script measured — the median
 * rendered cosine over the pairs that set exports.
 */
import sharp from "sharp";

/** Raster size for scoring. Must match the comparator, or scores stop being
 *  comparable to the baseline: a different grid changes what the blur means. */
const SIZE = 48;
/** Blur sigma — forgives a few px of stroke placement, not a different shape. */
const BLUR = 1.6;

/** `currentColor` never resolves off-page, so it is pinned to black before
 *  rendering; otherwise every icon is blank and every pair scores 1. */
const svgBuffer = (svg: string): Buffer =>
  Buffer.from(svg.replaceAll("currentColor", "#000"));

/** PNG at true size, on white, for showing the model what it drew. */
export const png = (svg: string, size = 96): Promise<Buffer> =>
  sharp(svgBuffer(svg), { density: (72 * size) / 24 })
    .resize(size, size, { background: "#fff", fit: "contain" })
    .flatten({ background: "#fff" })
    .png()
    .toBuffer();

export interface SheetOptions {
  cols?: number;
  size?: number;
}

/** A contact sheet: the candidate first, then neighbours, all at true size. */
export const sheet = async (
  svgs: string[],
  { cols = 6, size = 72 }: SheetOptions = {}
): Promise<Buffer> => {
  const tiles = await Promise.all(svgs.map((s) => png(s, size)));
  const rows = Math.ceil(tiles.length / cols);
  return sharp({
    create: {
      background: "#fff",
      channels: 3,
      height: rows * size,
      width: cols * size,
    },
  })
    .composite(
      tiles.map((input, i) => ({
        input,
        left: (i % cols) * size,
        top: Math.floor(i / cols) * size,
      }))
    )
    .png()
    .toBuffer();
};

/** Ink = darkness, one value per pixel. Left unnormalised; `cosine` normalises,
 *  which is the same thing the comparator does by pre-normalising each vector. */
export const inkVector = async (svg: string): Promise<number[]> => {
  const raw = await sharp(svgBuffer(svg), { density: 200 })
    .resize(SIZE, SIZE, { background: "#fff", fit: "contain" })
    .flatten({ background: "#fff" })
    .greyscale()
    .blur(BLUR)
    .raw()
    .toBuffer();
  return Array.from(raw, (v) => (255 - v) / 255);
};

export const cosine = (a: number[], b: number[]): number => {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
};

/** Rendered similarity of two SVGs. 0.737 is the cross-set baseline: two mature
 *  sets drawing the same concept. A reconstruction near 1.0 means a bug. */
export const similarity = async (x: string, y: string): Promise<number> =>
  cosine(await inkVector(x), await inkVector(y));
