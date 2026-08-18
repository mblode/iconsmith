import { writeFileSync } from "node:fs";

import type { Command } from "commander";
import { Option } from "commander";

import type { StyleSelection } from "../parts/extract.js";
import { extractParts, writeParts } from "../parts/extract.js";
import { nameParts } from "../parts/vocabulary.js";

const pct = (n: number) => `${Math.round(n)}%`;

/** `forge parts <dir>` — cluster every subpath in an icon set into a vocabulary. */
export const registerPartsCommand = (program: Command): void => {
  program
    .command("parts")
    .description("extract a parts vocabulary from a directory of SVG icons")
    .argument("<dir>", "directory of .svg icons")
    .option("-o, --out <file>", "write parts JSON to this path")
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
      (
        dir: string,
        opts: {
          minUses?: number;
          out?: string;
          styles?: StyleSelection;
          threshold?: number;
        }
      ) => {
        const json = program.opts().output === "json";
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

        if (opts.out) {
          writeParts(result, opts.out);
          process.stderr.write(`wrote ${opts.out}\n`);
        }

        if (json) {
          process.stdout.write(
            `${JSON.stringify(opts.out ? summary : result)}\n`
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
            "",
          ].join("\n")
        );
      }
    );
};

/** Exposed so the eval command can persist a vocabulary without re-deriving it. */
export const dumpParts = (path: string, data: unknown): void => {
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
};
