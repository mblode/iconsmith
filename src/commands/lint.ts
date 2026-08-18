import { readFileSync } from "node:fs";

import type { Command } from "commander";

import { Canvas } from "../tools/canvas.js";
import { format, lint } from "../tools/lint.js";
import type { Issue, Keyline } from "../types.js";

const KEYLINES = new Set(["circle", "square", "tall", "wide"]);

/** Read an existing SVG into a canvas as raw ops, so shipped icons can be
 *  checked without first being expressible in primitives. */
const fromSVG = (svg: string): Canvas => {
  const canvas = new Canvas();
  for (const m of svg.matchAll(/\sd="(?<data>[^"]+)"/gu)) {
    canvas.raw(m.groups?.data ?? "");
  }
  return canvas;
};

/** `forge lint <svg...>` — house-spec violations for existing icons. */
export const registerLintCommand = (program: Command): void => {
  program
    .command("lint")
    .description("check SVG icons against the house spec")
    .argument("<files...>", "icon .svg files")
    .option("-k, --keyline <name>", "assert a keyline: circle|square|wide|tall")
    .action((files: string[], opts: { keyline?: string }) => {
      const json = program.opts().output === "json";
      if (opts.keyline && !KEYLINES.has(opts.keyline)) {
        throw new Error(
          `unknown keyline "${opts.keyline}" — expected one of ${[...KEYLINES].join(", ")}`
        );
      }
      const keyline = (opts.keyline ?? null) as Keyline | null;

      const report: { file: string; issues: Issue[] }[] = files.map((file) => ({
        file,
        issues: lint(fromSVG(readFileSync(file, "utf-8")), { keyline }),
      }));

      const errors = report.reduce(
        (n, r) => n + r.issues.filter((i) => i.severity === "error").length,
        0
      );
      const warns = report.reduce(
        (n, r) => n + r.issues.filter((i) => i.severity === "warn").length,
        0
      );

      if (json) {
        process.stdout.write(
          `${JSON.stringify({ errors, files: report, warnings: warns })}\n`
        );
      } else {
        for (const r of report.filter((x) => x.issues.length > 0)) {
          process.stdout.write(`${r.file}\n${format(r.issues)}\n\n`);
        }
        process.stderr.write(
          `${files.length} file(s): ${errors} error(s), ${warns} warning(s)\n`
        );
      }
      if (errors > 0) {
        process.exitCode = 1;
      }
    });
};
