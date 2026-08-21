/**
 * Is "ask an agent to write a program" the right architecture?
 *
 * Two products have been sharing one pipeline:
 *
 *   1. **Keyed** — the house icon exists. That is reconstruction. A compiler
 *      that matches each house subpath to a vocabulary part and replays the
 *      placement should near-copy it. Cosine near 1.0 is success, not a leak.
 *   2. **Unkeyed** — the house icon does not exist. That is invention in the
 *      set's language. Analogical replay (copy how `storage` is built) is the
 *      prior; a coding agent guessing from tags is not.
 *
 * This script scores a compiler on `pull-request` and names the nearest
 * analogs for `database`. No agent, no credits.
 *
 *   npx tsx scripts/architect-lab.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { parseIconSvg, HOUSE_VARIANT } from "../src/corpus/load.js";
import { inspect, measureIcon } from "../src/eval/blindspot.js";
import { extractParts } from "../src/parts/extract.js";
import { nameParts } from "../src/parts/vocabulary.js";
import { compileIcon } from "../src/pipeline/reconstruct.js";
import { run } from "../src/tools/dsl.js";
import { cosine, inkVector } from "../src/tools/render.js";
import type { Part } from "../src/types.js";

const VARIANT_DIR = path.join("corpus", HOUSE_VARIANT);

const primitivePr = `icon pull-request
keyline square
circle 6,6 r2
circle 6,18 r2
circle 18,18 r2
line 6,8 6,16
line 14,4 12,6 14,8
line 13,6 15,6 18,9 18,16 off-axis
fit
`;

const score = async (
  label: string,
  source: string,
  parts: Part[],
  house: string,
  houseInk: number[]
): Promise<void> => {
  const program = run(source, parts);
  const svg = program.canvas.toSVG();
  const ink = await inkVector(svg);
  const measurement = await measureIcon(svg);
  const verdict = inspect(label, measurement);
  process.stdout.write(
    `${JSON.stringify(
      {
        cosine: cosine(ink, houseInk),
        dslErrors: program.errors,
        label,
        ops: source.split("\n").filter(Boolean).length,
        panel: verdict.failed,
        program: source,
      },
      null,
      2
    )}\n`
  );
};

const analog = (slug: string): { elements: number; slug: string } => {
  const file = path.join(VARIANT_DIR, `${slug}.svg`);
  const svg = readFileSync(file, "utf-8");
  return { elements: parseIconSvg(svg).length, slug };
};

const main = async (): Promise<void> => {
  const parts = nameParts(extractParts(VARIANT_DIR, {}).parts);
  const house = readFileSync(
    path.join(VARIANT_DIR, "pull-request.svg"),
    "utf-8"
  );
  const houseInk = await inkVector(house);
  const compiled = compileIcon(
    "pull-request",
    parseIconSvg(house).map((s) => s.d),
    parts
  );
  await score("primitive-approx", primitivePr, parts, house, houseInk);
  await score("compile-parts", compiled, parts, house, houseInk);
  process.stdout.write(
    `${JSON.stringify(
      {
        analogs: ["storage", "server", "server-1", "hard-drive"].flatMap(
          (slug) => {
            try {
              return [analog(slug)];
            } catch {
              return [];
            }
          }
        ),
        houseElements: parseIconSvg(house).length,
        label: "database-analogs",
      },
      null,
      2
    )}\n`
  );
};

await main();
