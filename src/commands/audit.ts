import type { Command } from "commander";

import { census } from "../corpus/census.js";
import { HOUSE_VARIANT, loadCorpus } from "../corpus/load.js";
import { analyse, formatReport } from "../pipeline/modifiers.js";
import { formatRepairReport, repairSet } from "../pipeline/repair.js";

/**
 * The three audits and the fix path, exposed.
 *
 * All four were written and then reachable only from a test, which meant
 * `iconsmith --help` under-reported what the tool does — the worst of both, since
 * the code is maintained but nobody can run it.
 */

interface ModifiersOptions {
  corpus: string;
  min: string;
  variant: string;
}

interface ElementsOptions {
  dir: string;
  min: string;
}

interface RepairOpts {
  corpus: string;
  dryRun?: boolean;
  out: string;
  symbol?: string[];
  variant: string;
}

export const registerAuditCommands = (program: Command): void => {
  program
    .command("modifiers")
    .description("audit badge size, slot and clearance across the set")
    .option("-c, --corpus <dir>", "corpus root", "corpus")
    .option("-v, --variant <key>", "variant to measure", HOUSE_VARIANT)
    .option("-m, --min <n>", "minimum instances for a modifier to count", "2")
    .action(async (opts: ModifiersOptions) => {
      const json = program.opts().output === "json";
      const report = await analyse({
        corpus: await loadCorpus(opts.corpus),
        minInstances: Number(opts.min),
        variant: opts.variant,
      });
      process.stdout.write(
        json ? `${JSON.stringify(report)}\n` : `${formatReport(report)}\n`
      );
    });

  program
    .command("elements")
    .description("census recurring elements and the families that disagree")
    .requiredOption("-d, --dir <path>", "directory of .svg icons")
    .option("-m, --min <n>", "minimum icons for an element to count", "3")
    .action((opts: ElementsOptions) => {
      const json = program.opts().output === "json";
      const report = census(opts.dir, { minIcons: Number(opts.min) });
      if (json) {
        process.stdout.write(`${JSON.stringify(report)}\n`);
        return;
      }
      const split = report.elements.filter(
        (e) => !(e.consistentSize && e.consistentPlace)
      );
      process.stdout.write(
        `${report.elements.length} recurring element(s); ${split.length} disagree.\n`
      );
      for (const e of split.slice(0, 25)) {
        process.stdout.write(
          `  ${e.name ?? e.id} — ${e.instances.length} icon(s)${
            e.even ? " (even split: no majority)" : ""
          }\n`
        );
      }
    });

  program
    .command("repair")
    .description("apply the mechanical fixes, proving each one changes nothing")
    .option("-c, --corpus <dir>", "corpus root", "corpus")
    .option("-v, --variant <key>", "variant to repair", HOUSE_VARIANT)
    .option("-o, --out <dir>", "staging directory", ".staging")
    .option("--symbol <name...>", "repair these symbols instead of the set")
    .option("--dry-run", "report what would change and write nothing")
    .action(async (opts: RepairOpts) => {
      const json = program.opts().output === "json";
      const report = await repairSet({
        corpus: await loadCorpus(opts.corpus),
        dryRun: Boolean(opts.dryRun),
        out: opts.dryRun ? undefined : `${opts.out}/${opts.variant}`,
        symbols: opts.symbol,
        variant: opts.variant,
      });
      process.stdout.write(
        json ? `${JSON.stringify(report)}\n` : `${formatRepairReport(report)}\n`
      );
    });
};
