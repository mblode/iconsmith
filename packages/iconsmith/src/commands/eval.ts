import { writeFileSync } from "node:fs";
import path from "node:path";

import type { Command } from "commander";

import { extractParts } from "../parts/extract.js";
import {
  benchmarkExclusions,
  loadBenchmark,
  loadRecords,
  refreshClosures,
  selectBenchmark,
  slice,
  strataCounts,
} from "../pipeline/bench.js";
import type { BenchmarkEntry } from "../pipeline/bench.js";
import type { EvalOptions } from "../pipeline/eval.js";
import {
  evaluate,
  evaluateSeeds,
  formatReport,
  formatSpread,
  scored,
} from "../pipeline/eval.js";
import type { Part } from "../types.js";
import { readJson } from "./read.js";

const loadParts = (file?: string): Part[] => {
  if (!file) {
    return [];
  }
  const raw = readJson<unknown>(file, "an icon set JSON file");
  return Array.isArray(raw)
    ? (raw as Part[])
    : ((raw as { parts?: Part[] }).parts ?? []);
};

/**
 * Extract the parts vocabulary from the non-benchmark files only.
 *
 * The strict form of the guarantee `redactParts` gives cheaply: a cluster
 * centroid is shaped by every member, so a part extracted from a set that
 * still contains the held-out icons carries a trace of them even after their
 * names are stripped. Passing a `select` predicate that skips the whole
 * concept closure means the withheld drawings never enter the clusterer.
 */
const extractNonBenchmarkParts = (
  dir: string,
  entries: readonly BenchmarkEntry[]
): Part[] => {
  const excluded = benchmarkExclusions(entries);
  return extractParts(path.join(dir, "icons-svg"), {
    select: (file) =>
      file.endsWith(".svg") &&
      !file.endsWith("-filled.svg") &&
      !excluded.has(path.basename(file, ".svg")),
  }).parts;
};

/**
 * `iconsmith bench` — build the committed benchmark from a corpus store.
 *
 * Run rarely and committed. Nothing at eval time calls this: the file is the
 * contract, and the seed is only provenance. That is the whole fix for two
 * runs a month apart having sampled different icons.
 */
const registerBenchCommand = (program: Command): void => {
  program
    .command("bench")
    .description("select and write the committed reconstruction benchmark")
    .option("-c, --corpus <file>", "corpus store", ".corpus/icons.jsonl")
    .option("-o, --out <file>", "benchmark file", "bench/reconstruction.json")
    .option("--set <id>", "which set to draw from", "blode-icons")
    .option("-n, --size <n>", "entries to select", Number.parseFloat, 120)
    .option(
      "--seed <n>",
      "selection seed (provenance only)",
      Number.parseFloat,
      1
    )
    .option("--dry-run", "print the selection without writing it")
    .action(
      (opts: {
        corpus: string;
        dryRun?: boolean;
        out: string;
        seed: number;
        set: string;
        size: number;
      }) => {
        const json = program.opts().output === "json";
        const records = loadRecords(opts.corpus);
        const benchmark = selectBenchmark(records, {
          seed: opts.seed,
          set: opts.set,
          size: opts.size,
        });
        if (!opts.dryRun) {
          writeFileSync(opts.out, `${JSON.stringify(benchmark, null, 2)}\n`);
        }
        const counts = strataCounts(benchmark.entries);
        process.stdout.write(
          json
            ? `${JSON.stringify({ counts, entries: benchmark.entries.length, file: opts.out, written: !opts.dryRun })}\n`
            : `${[
                `${benchmark.entries.length} entries from ${benchmark.corpus.records} records${opts.dryRun ? " (dry run)" : ` → ${opts.out}`}`,
                ...Object.entries(counts).map(
                  ([axis, buckets]) =>
                    `  ${axis.padEnd(9)} ${Object.entries(buckets)
                      .toSorted((a, b) => b[1] - a[1])
                      .map(([k, v]) => `${k} ${v}`)
                      .join(" · ")}`
                ),
              ].join("\n")}\n`
        );
      }
    );
};

/**
 * `iconsmith eval` — reconstruction eval. Generates icons the set already has, from
 * name and tags alone, and scores them against the real drawing.
 *
 * The report is deliberately four numbers. A bare treatment score is unreadable:
 * without the floor it could be noise, and without the 0.737 cross-set baseline
 * there is nothing to say whether it is good.
 *
 * The sample comes from a committed benchmark rather than a seeded shuffle, and
 * what is withheld is each entry's concept closure rather than its name. `--seed`
 * still exists, but it now labels the replicate and picks the floor comparisons;
 * it does not choose the icons. The baseline protocol is n=30 × 3 seeds — three
 * runs of `--slice 30` at seeds 1, 2, 3 — and the seed-to-seed spread is the
 * number without which no later result means anything.
 */
export const registerEvalCommand = (program: Command): void => {
  registerBenchCommand(program);
  program
    .command("eval")
    .description("score generated icons against the real ones they reconstruct")
    .requiredOption(
      "-d, --dir <path>",
      "icon set directory (icons-svg + icons-data)"
    )
    .option(
      "-b, --bench <file>",
      "committed benchmark",
      "bench/reconstruction.json"
    )
    .option(
      "--slice <n>",
      "run only the first n benchmark entries",
      Number.parseFloat
    )
    .option(
      "-c, --corpus <file>",
      "corpus store, to re-measure each entry's concept closure against the set as it stands now",
      ".corpus/icons.jsonl"
    )
    .option(
      "--seed <n>",
      "run seed (replicate label, floor draws)",
      Number.parseFloat,
      1
    )
    .option(
      "--seeds <list>",
      "comma-separated run seeds; runs each and reports the seed-to-seed spread. The baseline protocol is `--slice 30 --seeds 1,2,3`",
      (v: string) => v.split(",").map((n) => Number(n.trim()))
    )
    .option("--model <id>", "model id")
    .option("--max-steps <n>", "tool steps per icon", Number.parseFloat)
    .option("--concurrency <n>", "icons in flight", Number.parseFloat, 2)
    .option(
      "--max-spend <usd>",
      "abort once spend passes this, rather than discovering the cost afterwards",
      Number.parseFloat
    )
    .option("-p, --parts <file>", "parts JSON")
    .option(
      "--extract-parts",
      "extract the vocabulary from the non-benchmark files instead of reading --parts"
    )
    .option(
      "--set <id>",
      "which set --dir holds; only house sets may condition a generation",
      "blode-icons"
    )
    .action(
      async (opts: {
        bench: string;
        concurrency: number;
        corpus: string;
        dir: string;
        extractParts?: boolean;
        maxSpend?: number;
        maxSteps?: number;
        model?: string;
        parts?: string;
        seed: number;
        seeds?: number[];
        set: string;
        slice?: number;
      }) => {
        const json = program.opts().output === "json";
        const file = loadBenchmark(opts.bench);
        // Union with a freshly measured closure, never a replacement. Concepts
        // are still landing on blode-icons — 113 of 2,221 records carry one —
        // and each one that lands widens what a run must withhold. A corpus
        // built without them must not be able to narrow it back.
        let entries = slice(file.entries, opts.slice);
        try {
          entries = refreshClosures(entries, loadRecords(opts.corpus));
        } catch (error) {
          process.stderr.write(
            `  ! could not read ${opts.corpus} (${(error as Error).message}); ` +
              "running against the closures committed in the benchmark file.\n"
          );
        }

        const options = {
          benchmark: entries,
          concurrency: opts.concurrency,
          dir: opts.dir,
          maxSpendUsd: opts.maxSpend,
          maxSteps: opts.maxSteps,
          model: opts.model,
          // A generation that threw has no score to print, and printing one
          // would be the same lie the report used to tell.
          onIcon: (score) => {
            if (!json) {
              process.stderr.write(
                scored(score)
                  ? `  ${score.icon} ${score.score.toFixed(3)}${score.clean ? "" : " (lint dirty)"}\n`
                  : `  ${score.icon} failed: ${score.error}\n`
              );
            }
          },
          parts: opts.extractParts
            ? extractNonBenchmarkParts(opts.dir, entries)
            : loadParts(opts.parts),
          // Every icon the run does not hold out is shown to the model, so the
          // set at --dir is conditioning material. Naming it is how a run
          // against someone else's pack fails with a LicenceError on the first
          // line of output instead of quietly putting a third-party drawing on
          // a contact sheet. `licenses` is left unset rather than asserted:
          // the operator names the set, and the set is what is checked.
          provenance: {
            date: new Date().toISOString().slice(0, 10),
            origin: "original",
            set: opts.set,
            usage: "conditioning",
          },
        } satisfies Omit<EvalOptions, "seed">;

        // One report or several, but the spend cap spans the whole thing: a
        // three-seed baseline that capped each replicate separately would cost
        // three times what the operator asked for.
        const spread = opts.seeds
          ? await evaluateSeeds(options, opts.seeds)
          : null;
        const runs = spread
          ? spread.runs
          : [await evaluate({ ...options, seed: opts.seed })];

        process.stdout.write(
          json
            ? `${JSON.stringify(spread ?? runs[0])}\n`
            : `${spread ? formatSpread(spread) : formatReport(runs[0])}\n`
        );

        // A score this high means the harness is comparing something to
        // itself. A capped run produced real per-icon scores from an
        // incomplete sample; exiting 0 would let a scheduled comparison read a
        // prefix as a result. Either, in any replicate, fails the command.
        for (const note of runs.flatMap((r) => [r.suspect, r.aborted])) {
          if (note) {
            process.stderr.write(`${note}\n`);
            process.exitCode = 1;
          }
        }
      }
    );
};
