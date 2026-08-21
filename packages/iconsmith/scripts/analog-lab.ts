/**
 * Unkeyed analog replay, scored by the panel, never by house cosine.
 *
 * `database` has no house SVG. Tag-search lands on `storage` (filled dock) and
 * `server` (stacked trays). This compiles a stroked neighbor onto vocabulary
 * parts and retitles the program `icon database`. Same compiler as keyed
 * reconstruction; no agent, no credits.
 *
 *   npx tsx scripts/analog-lab.ts
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { HOUSE_VARIANT, parseIconSvg } from "../src/corpus/load.js";
import { inspect, measureIcon } from "../src/eval/blindspot.js";
import { extractParts } from "../src/parts/extract.js";
import { nameParts } from "../src/parts/vocabulary.js";
import { preferStroked, replay } from "../src/pipeline/analog.js";
import { run } from "../src/tools/dsl.js";

const VARIANT_DIR = path.join("corpus", HOUSE_VARIANT);
const OUT = path.join(".staging", "analog-lab.json");
const CONCEPT = "database";
/** Stroked neighbors. `storage` is a filled dock — not on this list. */
const ANALOGS = ["server", "server-1", "server-2"] as const;

/** Fill on every parsed shape: `storage`'s dock, not `server`'s trays. */
const isFilled = (svg: string): boolean => {
  const shapes = parseIconSvg(svg);
  return shapes.length > 0 && shapes.every((s) => s.filled);
};

const main = async (): Promise<void> => {
  const parts = nameParts(extractParts(VARIANT_DIR, {}).parts);
  const loaded = ANALOGS.flatMap((slug) => {
    const file = path.join(VARIANT_DIR, `${slug}.svg`);
    if (!existsSync(file)) {
      return [];
    }
    const svg = readFileSync(file, "utf-8");
    return [
      {
        filled: isFilled(svg),
        paths: parseIconSvg(svg).map((s) => s.d),
        slug,
      },
    ];
  });
  const analog = preferStroked(loaded);
  const chosen = loaded.find((c) => c.slug === analog);
  if (!(analog && chosen)) {
    throw new Error(
      `no stroked analog among ${ANALOGS.join(", ")} in ${VARIANT_DIR}`
    );
  }
  const program = replay(CONCEPT, chosen.paths, parts);
  const drawn = run(program, parts);
  const svg = drawn.canvas.toSVG();
  const measurement = await measureIcon(svg);
  const verdict = inspect(CONCEPT, measurement);
  const report = {
    analog,
    cosine: null,
    dslErrors: drawn.errors,
    failed: verdict.failed,
    partOps: program.split("\n").filter((line) => line.startsWith("part "))
      .length,
    program,
  };
  mkdirSync(path.dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
};

await main();
