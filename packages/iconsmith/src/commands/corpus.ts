import type { Command } from "commander";

import type { BuildReport, CheckReport, StatsReport } from "../corpus/build.js";
import { buildCorpus, checkCorpus, corpusStats } from "../corpus/build.js";

/**
 * `corpus build | check | stats`.
 *
 * `build` walks every source in the registry, measures every file once and
 * writes the record store. `check` re-hashes the source trees and exits 1 when
 * one has moved under the store. `stats` reads the store back.
 *
 * There is no `--dry-run` on `build` in the sense the other mutating commands
 * mean it: everything it writes goes to `.corpus/`, which is derived and
 * gitignored, and a build that wrote nothing would report nothing either. `-o`
 * takes it somewhere else, which is the same guarantee by a different route.
 */

interface BuildOpts {
  concurrency: string;
  full?: boolean;
  out: string;
  vectors?: boolean;
}

interface CheckOpts {
  concurrency: string;
  out: string;
}

const buildText = (r: BuildReport): string => {
  const lines = [
    `${r.manifest.records.toLocaleString()} record(s), ${r.manifest.renderings.toLocaleString()} rendering(s) in ${(r.ms / 1000).toFixed(1)}s → ${r.out}`,
  ];
  for (const s of r.manifest.sources) {
    lines.push(
      `  ${s.id.padEnd(14)} ${String(s.records).padStart(6)} records  ${String(s.renderings).padStart(6)} files  ${s.usage}  ${s.licence}${s.reused > 0 ? `  (${s.reused} reused)` : ""}`
    );
  }
  if (r.manifest.missing.length > 0) {
    lines.push(`  not on this machine: ${r.manifest.missing.join(", ")}`);
  }
  const fp = r.manifest.sidecars["fingerprints.f32"];
  const ink = r.manifest.sidecars["ink.f32"];
  lines.push(
    `  sidecars: fingerprints.f32 ${fp.rows.toLocaleString()}×${fp.dim}, ink.f32 ${ink.rows.toLocaleString()}×${ink.dim}${r.manifest.vectors ? "" : " (--vectors not run)"}`
  );
  return lines.join("\n");
};

const checkText = (r: CheckReport): string =>
  r.ok
    ? `ok — ${r.sources.length} source tree(s) match the manifest`
    : r.issues.map((i) => `[${i.kind}] ${i.detail}`).join("\n");

const statsText = (r: StatsReport): string => {
  const lines = [
    `${r.records.toLocaleString()} record(s), ${r.renderings.toLocaleString()} rendering(s), built ${r.builtAt}`,
    `  conditioning: ${(r.usage.conditioning ?? 0).toLocaleString()}   analysis-only: ${(r.usage["analysis-only"] ?? 0).toLocaleString()}`,
    // Canonical icons only. A direction variant is not supposed to answer a
    // question of its own, and counting it would put the ceiling out of reach.
    `  concepts: ${r.concepts.covered.toLocaleString()}/${r.concepts.canonical.toLocaleString()} canonical icons (${(r.concepts.coverage * 100).toFixed(1)}%)`,
  ];
  for (const s of r.bySet) {
    const conf = Object.entries(s.conformance)
      .toSorted(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k} ${v}`)
      .join(" / ");
    lines.push(
      `  ${s.id.padEnd(14)} ${String(s.records).padStart(6)} records  off-axis ${s.offAxisShare === null ? "  n/a" : `${(s.offAxisShare * 100).toFixed(1)}%`}  keyline ${conf}`
    );
  }
  return lines.join("\n");
};

export const registerCorpusCommands = (program: Command): void => {
  const corpus = program
    .command("corpus")
    .description("build, verify and summarise the icon record store");

  corpus
    .command("build")
    .description("measure every icon on this machine into .corpus/")
    .option("-o, --out <dir>", "store directory", ".corpus")
    .option("--full", "re-measure everything, ignoring the previous store")
    .option("--vectors", "also render ink vectors (slow: sharp dominates)")
    .option("-j, --concurrency <n>", "files read at once", "16")
    .action(async (opts: BuildOpts) => {
      const report = await buildCorpus({
        concurrency: Number(opts.concurrency),
        full: Boolean(opts.full),
        out: opts.out,
        vectors: Boolean(opts.vectors),
      });
      process.stdout.write(
        program.opts().output === "json"
          ? `${JSON.stringify(report)}\n`
          : `${buildText(report)}\n`
      );
    });

  corpus
    .command("check")
    .description("re-hash every source tree and compare against the manifest")
    .option("-o, --out <dir>", "store directory", ".corpus")
    .option("-j, --concurrency <n>", "files read at once", "16")
    .action(async (opts: CheckOpts) => {
      const report = await checkCorpus({
        concurrency: Number(opts.concurrency),
        out: opts.out,
      });
      process.stdout.write(
        program.opts().output === "json"
          ? `${JSON.stringify(report)}\n`
          : `${checkText(report)}\n`
      );
      if (!report.ok) {
        process.exitCode = 1;
      }
    });

  corpus
    .command("stats")
    .description("summarise the store by set, usage and licence")
    .option("-o, --out <dir>", "store directory", ".corpus")
    .action(async (opts: { out: string }) => {
      const report = await corpusStats({ out: opts.out });
      process.stdout.write(
        program.opts().output === "json"
          ? `${JSON.stringify(report)}\n`
          : `${statsText(report)}\n`
      );
    });
};
