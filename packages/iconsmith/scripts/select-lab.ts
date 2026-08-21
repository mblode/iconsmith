/**
 * Cheap SELECT lab: what the agent would be shown, with no drawing.
 *
 * Generation here is not "paint an icon". It is "choose a handful of house
 * marks and write a ten-line program". If five attempts see the same shortlist,
 * five drawings are one experiment. This prints the five islands for the demo
 * concepts so the next paid run is an A/B of searches, not luck.
 *
 *   npx tsx scripts/select-lab.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { loadAliases } from "../src/corpus/aliases.js";
import { HOUSE_VARIANT } from "../src/corpus/load.js";
import { extractParts } from "../src/parts/extract.js";
import { nameParts } from "../src/parts/vocabulary.js";
import type { Concept } from "../src/pipeline/prompt.js";
import {
  hintDiversity,
  islands,
  SELECT_KINDS,
} from "../src/pipeline/select.js";

const VARIANT_DIR = path.join("corpus", HOUSE_VARIANT);
const OUT = path.join(".staging", "select-lab.json");

const CONCEPTS: Concept[] = [
  {
    category: "Code",
    name: "pull-request",
    tags: ["merge request", "branch", "review", "git"],
  },
  {
    category: "Devices",
    name: "database",
    tags: ["db", "cylinder", "storage", "server"],
  },
];

const main = async (): Promise<void> => {
  const parts = nameParts(extractParts(VARIANT_DIR, {}).parts);
  const { aliases } = await loadAliases();
  const report = CONCEPTS.map((concept) => {
    const plans = islands(concept, parts, aliases, SELECT_KINDS.length);
    return {
      concept: concept.name,
      diversity: hintDiversity(plans),
      islands: plans.map((p) => ({
        kind: p.kind,
        size: p.hints.length,
        top: p.hints.slice(0, 8).map((h) => ({
          id: h.id,
          name: h.name,
          seenIn: h.seenIn,
        })),
      })),
    };
  });
  mkdirSync(path.dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
};

await main();
