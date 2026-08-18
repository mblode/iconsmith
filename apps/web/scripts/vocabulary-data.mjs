/**
 * Regenerate `lib/vocabulary.json`, the parts the landing page draws.
 *
 * The page renders each part as live inline SVG rather than shipping
 * `packages/iconsmith/docs/vocabulary.png`. That sheet is a review artifact:
 * red debug labels, portrait, ragged last row. Inline paths take `currentColor`
 * instead, so the grid works in both themes and stays crisp at any size.
 *
 *   node scripts/vocabulary-data.mjs
 *
 * Re-run it whenever the vocabulary changes. Committed rather than imported
 * across the workspace: Next cannot serve assets from outside the app
 * directory, and a relative path into packages/ survives local dev and breaks
 * on Vercel.
 */
import { writeFileSync } from "node:fs";
import path from "node:path";

const { VOCABULARY, bbox, parsePath } = await import("iconsmith");

// Matches packages/iconsmith/scripts/vocabulary-sheet.ts: drawn at true aspect
// but not true size, because a 1x2 mark beside a 20x14 one at true scale is a
// dot next to a drawing.
const BOX = 17;
const MAX_SCALE = 4;
const STROKE = 2;

const parts = VOCABULARY.map((p) => {
  const b = bbox(parsePath(p.d));
  const scale = Math.min(BOX / Math.max(b.w, 0.01), BOX / Math.max(b.h, 0.01), MAX_SCALE);
  return {
    d: p.d,
    dx: 12 - (b.w * scale) / 2 - b.x0 * scale,
    dy: 12 - (b.h * scale) / 2 - b.y0 * scale,
    name: p.name,
    note: p.note,
    scale,
    strokeWidth: STROKE / scale,
    sure: p.sure,
  };
});

const out = path.resolve(import.meta.dirname, "../lib/vocabulary.json");
writeFileSync(out, `${JSON.stringify(parts, null, 2)}\n`);
console.log(`wrote ${parts.length} parts to ${out}`);
