import type { Command } from "commander";

import { evaluate, formatReport } from "../pipeline/eval.js";
import type { Part } from "../types.js";
import { readJson } from "./read.js";

const loadParts = (path?: string): Part[] => {
  if (!path) {
    return [];
  }
  const raw = readJson<unknown>(path, "an icon set JSON file");
  return Array.isArray(raw)
    ? (raw as Part[])
    : ((raw as { parts?: Part[] }).parts ?? []);
};

/**
 * `iconsmith eval` — reconstruction eval. Generates icons the set already has, from
 * name and tags alone, and scores them against the real drawing.
 *
 * The report is deliberately four numbers. A bare treatment score is unreadable:
 * without the floor it could be noise, and without the 0.737 cross-set baseline
 * there is nothing to say whether it is good.
 */
export const registerEvalCommand = (program: Command): void => {
  program
    .command("eval")
    .description("score generated icons against the real ones they reconstruct")
    .requiredOption(
      "-d, --dir <path>",
      "icon set directory (icons-svg + icons-data)"
    )
    .option("-n, --count <n>", "icons to hold out", Number.parseFloat, 10)
    .option("--seed <n>", "hold-out seed", Number.parseFloat, 1)
    .option("--model <id>", "model id")
    .option("--max-steps <n>", "tool steps per icon", Number.parseFloat)
    .option("--concurrency <n>", "icons in flight", Number.parseFloat, 2)
    .option("-p, --parts <file>", "parts JSON")
    .action(
      async (opts: {
        concurrency: number;
        count: number;
        dir: string;
        maxSteps?: number;
        model?: string;
        parts?: string;
        seed: number;
      }) => {
        const json = program.opts().output === "json";
        const report = await evaluate({
          concurrency: opts.concurrency,
          dir: opts.dir,
          maxSteps: opts.maxSteps,
          model: opts.model,
          n: opts.count,
          onIcon: (score) => {
            if (!json) {
              process.stderr.write(
                `  ${score.icon} ${score.score.toFixed(3)}${score.clean ? "" : " (lint dirty)"}\n`
              );
            }
          },
          parts: loadParts(opts.parts),
          seed: opts.seed,
        });

        process.stdout.write(
          json ? `${JSON.stringify(report)}\n` : `${formatReport(report)}\n`
        );

        // A score this high means the harness is comparing something to itself.
        if (report.suspect) {
          process.stderr.write(`${report.suspect}\n`);
          process.exitCode = 1;
        }
      }
    );
};
