import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { Command } from "commander";
import { Option } from "commander";

import { loadAliases } from "../corpus/aliases.js";
import type { StyleSelection } from "../parts/extract.js";
import { extractParts, writeParts } from "../parts/extract.js";
import { nameParts } from "../parts/vocabulary.js";
import type { PartCoverage } from "../pipeline/coverage.js";
import { partCoverage } from "../pipeline/coverage.js";
import type { Part } from "../types.js";
import { assertDirectory, InputError } from "./read.js";

const pct = (n: number) => `${Math.round(n)}%`;
const share = (n: number, of: number) =>
  `${n} (${((100 * n) / Math.max(1, of)).toFixed(1)}%)`;

/** The set the concepts belong to. Coverage asks what *this* set is asked for. */
const HOUSE_SET = "blode-icons";

/**
 * Every concept the house set answers, from the record store.
 *
 * Read here rather than through `concepts.ts`'s loader, which is private and
 * also pulls Lucide's keywords, the cohort manifest and a path inside the house
 * set's own repository — none of which a coverage count wants.
 *
 * The store holds the concepts as they were measured, so the count is 2,201
 * where the blessed `_concepts.json` has 2,203: two of its entries name icons
 * the store was not built with. Reading the blessed file instead would mean
 * reaching outside this package for a difference of two.
 */
const houseConcepts = (store: string): string[] => {
  const file = path.join(path.resolve(store), "icons.jsonl");
  let text: string;
  try {
    text = readFileSync(file, "utf-8");
  } catch (error) {
    throw new InputError(
      `No corpus store at ${path.resolve(store)}. Run \`iconsmith corpus build\` first.`,
      error
    );
  }
  const seen = new Set<string>();
  for (const line of text.split("\n")) {
    if (line.length === 0) {
      continue;
    }
    const rec = JSON.parse(line) as {
      concepts?: string[];
      provenance?: { set?: string };
      set?: string;
    };
    if ((rec.set ?? rec.provenance?.set) !== HOUSE_SET) {
      continue;
    }
    for (const concept of rec.concepts ?? []) {
      seen.add(concept);
    }
  }
  return [...seen].toSorted((a, b) => a.localeCompare(b));
};

/**
 * Coverage on three channels, because two of them are quotable and one is not.
 *
 * `covered` is provenance alone — the old number, and the one every earlier
 * measurement was taken against. `independent` adds a source that has never
 * seen this concept list. `all` adds the house's own concept map, which is
 * where the list came from, so it rises almost by definition; it is reported
 * because the drawer really does search that wide, and labelled because a
 * reader who saw only it would think the vocabulary was nearly complete.
 *
 * The same discipline as `corpus/concepts.ts`' informative-vs-nominal pair and
 * `partCoverage`'s own covered-vs-byName pair: quote them together, or quote
 * the narrow one.
 */
const coverageOf = async (
  parts: Part[],
  concepts: string[]
): Promise<Coverage> => {
  const { aliases, from, independent } = await loadAliases();
  const provenance = partCoverage(parts, concepts);
  const widest = partCoverage(parts, concepts, aliases);
  return {
    all: widest.covered,
    byName: provenance.byName,
    concepts: provenance.concepts,
    covered: provenance.covered,
    from,
    // The backlog is what the *widest* search still cannot reach. A gap list
    // taken from the narrow number is a list of missing synonyms with real
    // inventory buried in it, and the point of the file is to separate those.
    gaps: widest.gaps,
    independent: partCoverage(parts, concepts, independent).covered,
  };
};

interface Coverage extends PartCoverage {
  /** Every table, the house's own map included. Not a result on its own. */
  all: number;
  /** Which alias tables were found. An empty table and an unwired one look the
   *  same from the number, and the second is a bug. */
  from: string[];
  /** Sources that did not also supply the concept list. */
  independent: number;
}

const coverageText = (c: Coverage): string[] => [
  `concepts            ${c.concepts}`,
  `  a part answers    ${share(c.covered, c.concepts)}`,
  `  a name answers    ${share(c.byName, c.concepts)}`,
  `  + other sets say  ${share(c.independent, c.concepts)}`,
  // Named for what it is on the line itself, because this is the number that
  // gets copied into a summary without its caveat.
  `  + our own map     ${share(c.all, c.concepts)} (scored against itself)`,
  `alias tables        ${c.from.length > 0 ? c.from.join(", ") : "none found"}`,
  `no part             ${c.gaps.length}`,
];

/** `iconsmith parts <dir>` — cluster every subpath in an icon set into a vocabulary. */
export const registerPartsCommand = (program: Command): void => {
  program
    .command("parts")
    .description("extract a parts vocabulary from a directory of SVG icons")
    .argument("<dir>", "directory of .svg icons")
    .option("-o, --out <file>", "write parts JSON to this path")
    .option("--coverage", "report how many concepts at least one part answers")
    .option(
      "-s, --store <dir>",
      "corpus store the concepts come from",
      ".corpus"
    )
    .option("--gaps <file>", "write the concepts no part answers to this path")
    .option("--threshold <n>", "cluster distance threshold", Number.parseFloat)
    .option(
      "--min-uses <n>",
      "drop parts used by fewer icons",
      Number.parseFloat
    )
    .addOption(
      new Option(
        "--styles <which>",
        "which drawing style to extract from"
      ).choices(["auto", "stroked", "expanded", "all"])
    )
    .action(
      async (
        dir: string,
        opts: {
          coverage?: boolean;
          gaps?: string;
          minUses?: number;
          out?: string;
          store: string;
          styles?: StyleSelection;
          threshold?: number;
        }
      ) => {
        const json = program.opts().output === "json";
        assertDirectory(dir, "a directory of .svg icons");
        const extracted = extractParts(dir, {
          minUses: opts.minUses,
          styles: opts.styles,
          threshold: opts.threshold,
        });
        // Named here rather than in the extractor: clustering is a measurement
        // and naming is a judgement, and a vocabulary read off one set should
        // not be able to change what another set extracts.
        const result = {
          ...extracted,
          parts: nameParts(extracted.parts, opts.threshold),
        };
        const { summary } = result;

        // Only when asked: the store is a built artefact, and a command that
        // reads it unbidden fails on a fresh clone for a number nobody wanted.
        const coverage =
          opts.coverage === true || opts.gaps !== undefined
            ? await coverageOf(result.parts, houseConcepts(opts.store))
            : null;
        if (coverage && opts.gaps) {
          writeFileSync(
            opts.gaps,
            `${JSON.stringify(
              {
                all: coverage.all,
                byName: coverage.byName,
                concepts: coverage.concepts,
                covered: coverage.covered,
                // The tables that were loaded, so a file written without them
                // is distinguishable from one written with them and no effect.
                from: coverage.from,
                gaps: coverage.gaps,
                independent: coverage.independent,
                names: result.parts.filter((p) => p.name).length,
                parts: result.parts.length,
              },
              null,
              2
            )}\n`
          );
          process.stderr.write(`wrote ${opts.gaps}\n`);
        }

        if (opts.out) {
          writeParts(result, opts.out);
          process.stderr.write(`wrote ${opts.out}\n`);
        }

        if (json) {
          // With `-o` the parts went to the file, so stdout carries the summary
          // alone; without it, the whole extraction.
          const body = opts.out ? summary : result;
          process.stdout.write(
            `${JSON.stringify(coverage ? { ...body, coverage } : body)}\n`
          );
          return;
        }

        const { styles } = summary;
        // The split is printed whether or not it excluded anything: a set that
        // is all one style is a fact worth seeing, and a set that is not is a
        // fact the reader must see to trust the parts list.
        process.stdout.write(
          [
            `icons scanned       ${summary.scanned}`,
            `  stroked           ${styles.stroked}`,
            `  outline-expanded  ${styles.expanded}`,
            `extracted from      ${summary.icons} (${styles.used})`,
            `subpath candidates  ${summary.candidates}`,
            `parts               ${summary.parts}`,
            `used by >1 icon     ${summary.shared} (${pct((100 * summary.shared) / summary.parts)})`,
            `named               ${result.parts.filter((p) => p.name).length}`,
            ...Object.entries(summary.coverage).map(
              ([n, c]) => `icon coverage top ${n.padEnd(4)}${pct(c)}`
            ),
            ...(coverage ? coverageText(coverage) : []),
            "",
          ].join("\n")
        );
      }
    );
};

/** Exposed so the eval command can persist a vocabulary without re-deriving it. */
export const dumpParts = (file: string, data: unknown): void => {
  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
};
