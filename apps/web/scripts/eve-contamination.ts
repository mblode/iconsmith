/**
 * How much of the answer does Studio hand the drawer?
 *
 * `pipeline/bench.ts` holds out a **concept closure** — the slug, its cohort in
 * both styles, its Central finishes, its filled twin — because a name-exact
 * holdout withholds nothing: "Excluding the string `folder-open` while leaving
 * eleven folders in the corpus withholds the label and hands over the answer."
 *
 * `lib/studio/arsenal.ts` excludes one slug: the exact target. So a benchmark
 * entry whose closure names nineteen slugs has eighteen of them still eligible
 * to be shown to the drawer, and any of them whose name starts with the concept
 * can additionally enter the tournament as a `library-*` arm and win — which is
 * retrieval, not drawing.
 *
 * This script measures that gap by calling the real `loadStudioArsenal`, not a
 * copy of its ranking. A reimplementation would drift from the thing it audits,
 * and the number would stop meaning anything the day it did.
 *
 *     node --experimental-strip-types apps/web/scripts/eve-contamination.ts
 *     … --split sealed --json
 */
/* oxlint-disable eslint/no-await-in-loop --
   `loadStudioArsenal` is awaited once per concept on purpose: this measures the
   real arsenal, and the module memoises per concept, so a Promise.all would
   only race sixty cache writes to no benefit. */
import { readFileSync } from "node:fs";
import path from "node:path";

import { loadStudioArsenal } from "../lib/studio/arsenal.ts";

const HOUSE = "blode-icons/";
const BENCH = path.join(
  import.meta.dirname,
  "../../../packages/iconsmith/bench/reconstruction.json",
);

interface Entry {
  closure: string[];
  id: string;
  rank: number;
  slug: string;
  split: string;
}

const arg = (name: string, fallback: string): string => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : (process.argv[i + 1] ?? fallback);
};

const split = arg("split", "sealed");
const asJson = process.argv.includes("--json");

const bench = JSON.parse(readFileSync(BENCH, "utf-8")) as { entries: Entry[] };
const entries = bench.entries
  .filter((entry) => entry.split === split)
  .toSorted((a, b) => a.rank - b.rank);

if (entries.length === 0) {
  throw new Error(`no entries in split "${split}"`);
}

interface Row {
  /** Closure members the drawer is shown anyway. */
  leaked: string[];
  /** Closure slugs that can enter the tournament as a `library-*` arm. */
  libraryArms: string[];
  references: number;
  slug: string;
}

const rows: Row[] = [];
for (const entry of entries) {
  // The tags a real request would carry are unknowable here, and supplying
  // guesses would measure this script's imagination rather than the arsenal.
  // The bare name is the floor: every leak counted below happens on the least
  // informative brief a user can send.
  const { references } = await loadStudioArsenal({ name: entry.slug, tags: [] });
  const closure = new Set(
    entry.closure.filter((id) => id.startsWith(HOUSE)).map((id) => id.slice(HOUSE.length)),
  );
  const names = references.map((reference) => reference.name);
  const shown = new Set(names);
  rows.push({
    leaked: names.filter((name) => closure.has(name)),
    // Mirrors `libraryCandidates` in lib/studio/generate.ts: a reference whose
    // slug extends the concept name and which has both paints present.
    libraryArms: names.filter(
      (name) =>
        name.startsWith(`${entry.slug}-`) &&
        !name.endsWith("-filled") &&
        shown.has(`${name}-filled`),
    ),
    references: names.length,
    slug: entry.slug,
  });
}

const totalRefs = rows.reduce((sum, row) => sum + row.references, 0);
const totalLeaked = rows.reduce((sum, row) => sum + row.leaked.length, 0);
const affected = rows.filter((row) => row.leaked.length > 0);
const withArms = rows.filter((row) => row.libraryArms.length > 0);

const summary = {
  affectedConcepts: affected.length,
  concepts: rows.length,
  conceptsWithLibraryArm: withArms.length,
  leakRate: totalLeaked / totalRefs,
  leakedReferences: totalLeaked,
  split,
  totalReferences: totalRefs,
};

if (asJson) {
  console.log(JSON.stringify({ rows, summary }, null, 2));
} else {
  console.log(`split: ${split} — ${rows.length} concepts\n`);
  console.log(
    `closure members shown to the drawer: ${totalLeaked}/${totalRefs} references ` +
      `(${(100 * summary.leakRate).toFixed(1)}%)`,
  );
  console.log(`concepts affected: ${affected.length}/${rows.length}`);
  console.log(
    `concepts where a closure sibling can win as a library arm: ${withArms.length}/${rows.length}\n`,
  );
  const worst = [...affected].toSorted((a, b) => b.leaked.length - a.leaked.length).slice(0, 12);
  for (const row of worst) {
    console.log(
      `  ${row.slug.padEnd(26)} ${String(row.leaked.length).padStart(3)}/${String(row.references).padEnd(3)}  ${row.leaked.slice(0, 4).join(", ")}`,
    );
  }
  if (withArms.length > 0) {
    console.log("\nlibrary arms drawn from the held-out closure:");
    for (const row of withArms) {
      console.log(`  ${row.slug.padEnd(26)} ${row.libraryArms.join(", ")}`);
    }
  }
}
