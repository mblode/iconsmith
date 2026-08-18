import { writeFileSync } from "node:fs";

import type { Command } from "commander";

import { extractParts, writeParts } from "../parts/extract.js";

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
    .action(
      (
        dir: string,
        opts: { minUses?: number; out?: string; threshold?: number }
      ) => {
        const json = program.opts().output === "json";
        const result = extractParts(dir, {
          minUses: opts.minUses,
          threshold: opts.threshold,
        });
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

        process.stdout.write(
          [
            `icons scanned       ${summary.icons}`,
            `subpath candidates  ${summary.candidates}`,
            `parts               ${summary.parts}`,
            `used by >1 icon     ${summary.shared} (${pct((100 * summary.shared) / summary.parts)})`,
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
