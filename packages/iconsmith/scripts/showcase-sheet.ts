/**
 * Regenerate `docs/showcase.png`, the contact sheet the README leads with.
 *
 * The README claims the pipeline draws icons; the only way to check that claim
 * is to look at the icons. So the image is built from the retained run rather
 * than drawn by hand: every tile is read out of
 * `output/ten-icons-repaired-2026-09-09/<concept>/<paint>.svg` at generation
 * time, which means a tile cannot show a shape the repo does not hold, and a
 * re-run after a new set lands cannot leave a stale picture behind.
 *
 *   npx tsx scripts/showcase-sheet.ts
 *
 * Rerun it whenever SET or the SVGs it names change.
 */
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

import sharp from "sharp";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const SET = path.join(ROOT, "output/ten-icons-repaired-2026-09-09");
const OUT = path.join(ROOT, "docs");

/** Review order from the run's own `validation.json`, not alphabetical: the
 *  sheet and the record should be read in the same sequence. */
const CONCEPTS = [
  "folder-lock",
  "shield-check",
  "clock-check",
  "jellyfish",
  "satellite-dish",
  "camera-sparkle",
  "bookmark-play",
  "key",
  "headphones",
  "leaf",
];

const COLS = 5;
const TILE_W = 176;
const TILE_H = 120;
const PAD = 28;
/** 24px drawn at 2×. The stroke scales with it, so a tile is the icon's own
 *  geometry enlarged, not a redrawn one. */
const ICON = 2;
const BAND = 42;
const INK = "#18181b";
const LABEL = "#71717a";

/** The icon's own markup, minus its document wrapper, positioned. `fill="none"`
 *  lives on that wrapper, so it is restated here: the D544 board lost it in the
 *  same move and had to be rebuilt as v2. */
const place = (svg: string, x: number, y: number): string => {
  const body = svg
    .replace(/^[\s\S]*?<svg[^>]*>/u, "")
    .replace(/<\/svg>\s*$/u, "");
  return `<g fill="none" transform="translate(${x} ${y}) scale(${ICON})" color="${INK}">${body.trim()}</g>`;
};

const read = (concept: string, paint: string): string =>
  readFileSync(path.join(SET, concept, `${paint}.svg`), "utf-8");

const block = (paint: string, top: number): string => {
  const parts = [
    `<text x="${PAD}" y="${top - 12}" font-family="Menlo, monospace" font-size="13" fill="${LABEL}">${paint}</text>`,
  ];
  for (const [i, concept] of CONCEPTS.entries()) {
    const x = PAD + (i % COLS) * TILE_W;
    const y = top + Math.floor(i / COLS) * TILE_H;
    parts.push(
      place(read(concept, paint), x + (TILE_W - 24 * ICON) / 2, y + 16),
      `<text x="${x + TILE_W / 2}" y="${y + 16 + 24 * ICON + 26}" text-anchor="middle" font-family="Menlo, monospace" font-size="13" fill="${LABEL}">${concept}</text>`
    );
  }
  return parts.join("\n");
};

const rows = Math.ceil(CONCEPTS.length / COLS);
const blockH = rows * TILE_H;
const firstTop = PAD + BAND;
const secondTop = firstTop + blockH + BAND;
const width = PAD * 2 + COLS * TILE_W;
const height = secondTop + blockH + PAD;

const sheet = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<rect width="${width}" height="${height}" fill="#f7f7f8"/>
${block("outlined", firstTop)}
${block("filled", secondTop)}
</svg>
`;

mkdirSync(OUT, { recursive: true });
await sharp(Buffer.from(sheet), { density: 144 })
  .png()
  .toFile(path.join(OUT, "showcase.png"));

process.stderr.write(
  `${CONCEPTS.length * 2} icons on a ${width}×${height} sheet at 2×\n`
);
