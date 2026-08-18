import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { Command } from "commander";

import { loadCorpus, sampleSymbols } from "../corpus/load.js";
import {
  conform,
  formatConformReport,
  scoreConform,
} from "../pipeline/conform.js";

interface ConformOptions {
  corpus: string;
  dryRun?: boolean;
  from: string;
  n: string;
  symbol?: string[];
  to: string;
  write?: string;
}

/**
 * `forge conform --from <variant> --to <variant>` — move icons between
 * Central's finish variants and score the result against Central's own answer.
 *
 * The scoring half is the point. Central ships all 30 finishes of all 2,085
 * symbols, so unlike every other measurement in this project there is ground
 * truth for each pair, and "how much of the variant system does this stack
 * reproduce" is a question with a number rather than an opinion.
 */
export const registerConformCommand = (program: Command): void => {
  program
    .command("conform")
    .description("transform icons between corpus variants and score the result")
    .requiredOption("--from <variant>", "source variant key")
    .requiredOption("--to <variant>", "destination variant key")
    .option("--corpus <dir>", "corpus root", "corpus")
    .option("-n, --n <count>", "symbols to score", "200")
    .option("--symbol <name...>", "score these symbols instead of a sample")
    .option("--write <dir>", "write the conformed SVGs to a directory")
    .option("--dry-run", "with --write, report what would be written")
    .action(async (opts: ConformOptions) => {
      const json = program.opts().output === "json";
      const corpus = await loadCorpus(opts.corpus);

      const known = corpus.variants.map((v) => v.key);
      for (const key of [opts.from, opts.to]) {
        if (!corpus.variant(key)) {
          throw new Error(
            `unknown variant "${key}" — expected one of:\n  ${known.join("\n  ")}`
          );
        }
      }
      const to = corpus.variant(opts.to);
      if (!to) {
        throw new Error(`unknown variant "${opts.to}"`);
      }

      const count = Math.trunc(Number(opts.n));
      if (!Number.isFinite(count) || count < 1) {
        throw new Error(`--n must be a positive integer, got "${opts.n}"`);
      }
      const symbols =
        opts.symbol ??
        sampleSymbols(corpus.symbols, Math.min(count, corpus.symbols.length));

      for (const s of symbols) {
        if (!corpus.has(s, opts.from)) {
          throw new Error(`corpus has no "${s}" in ${opts.from}`);
        }
      }

      if (opts.write && !opts.dryRun) {
        mkdirSync(opts.write, { recursive: true });
      }
      const dir = opts.write;
      const written: string[] = dir
        ? await Promise.all(
            symbols.map(async (symbol) => {
              const result = conform(await corpus.load(symbol, opts.from), to);
              const file = path.join(dir, `${symbol}.svg`);
              if (!opts.dryRun) {
                writeFileSync(file, `${result.svg}\n`);
              }
              return file;
            })
          )
        : [];

      const report = await scoreConform({
        corpus,
        from: opts.from,
        symbols,
        to: opts.to,
      });

      if (json) {
        process.stdout.write(`${JSON.stringify({ ...report, written })}\n`);
      } else {
        process.stdout.write(`${formatConformReport(report)}\n`);
        if (written.length) {
          process.stderr.write(
            `${opts.dryRun ? "would write" : "wrote"} ${written.length} file(s) to ${opts.write}\n`
          );
        }
      }
    });
};
