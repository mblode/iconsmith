import { readFileSync } from "node:fs";
import path from "node:path";

import type { Command } from "commander";

import { Canvas } from "../tools/canvas.js";
import type {
  Cohort,
  CohortManifest,
  CohortMember,
  CohortView,
} from "../tools/cohort.js";
import {
  buildCohorts,
  cohortOf,
  drift,
  measure,
  splits,
} from "../tools/cohort.js";
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

const iconName = (file: string): string =>
  path.basename(file).replace(/\.svg$/u, "");

const readManifest = (file: string): CohortManifest =>
  JSON.parse(readFileSync(file, "utf-8")) as CohortManifest;

/** One cohort's split axes, as a human reads them: the convention first, then
 *  what disagrees with it and by how much. */
const summarise = (c: Cohort): string =>
  splits(c)
    .map((a) => {
      const groups = a.groups
        .map(
          (g, i) =>
            `  ${String(g.members.length).padStart(3)}x  ${a.axis} ${g.lo.toFixed(2)}..${g.hi.toFixed(2)}` +
            `${i === 0 ? "  (majority)" : `  (+${drift(a, g).toFixed(2)}px)`}  ${g.members.join(", ")}`
        )
        .join("\n");
      return `cohort ${c.name} disagrees on ${a.axis} across ${a.groups.length} groups${a.even ? " (evenly split)" : ""}\n${groups}`;
    })
    .join("\n");

/** `forge lint <svg...>` — house-spec violations for existing icons.
 *
 *  Every file on the command line is one cohort corpus: icons are grouped by
 *  the manifest or by name prefix across the whole invocation, so linting a
 *  family together says more than linting its members one at a time. */
export const registerLintCommand = (program: Command): void => {
  program
    .command("lint")
    .description("check SVG icons against the house spec")
    .argument("<files...>", "icon .svg files")
    .option("-k, --keyline <name>", "assert a keyline: circle|square|wide|tall")
    .option("-c, --cohorts <file>", "JSON map of cohort name to icon names")
    .action((files: string[], opts: { cohorts?: string; keyline?: string }) => {
      const json = program.opts().output === "json";
      if (opts.keyline && !KEYLINES.has(opts.keyline)) {
        throw new Error(
          `unknown keyline "${opts.keyline}" — expected one of ${[...KEYLINES].join(", ")}`
        );
      }
      const keyline = (opts.keyline ?? null) as Keyline | null;
      const manifest = opts.cohorts ? readManifest(opts.cohorts) : undefined;

      const drawn = files.map((file) => ({
        canvas: fromSVG(readFileSync(file, "utf-8")),
        file,
        name: iconName(file),
      }));
      const members: CohortMember[] = drawn.flatMap((d) =>
        d.canvas.elements.length > 0
          ? [{ box: measure(d.canvas.elements.map((e) => e.d)), name: d.name }]
          : []
      );
      const cohorts = buildCohorts(members, { manifest });
      const byName = new Map(cohorts.map((c) => [c.name, c]));
      const viewFor = (name: string): CohortView | null => {
        const cohort = byName.get(cohortOf(name, manifest));
        return cohort ? { cohort, name } : null;
      };

      const report: { file: string; issues: Issue[] }[] = drawn.map((d) => ({
        file: d.file,
        issues: lint(d.canvas, { cohort: viewFor(d.name), keyline }),
      }));
      const split = cohorts.filter((c) => splits(c).length > 0);

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
          `${JSON.stringify({ cohorts: split, errors, files: report, warnings: warns })}\n`
        );
      } else {
        for (const r of report.filter((x) => x.issues.length > 0)) {
          process.stdout.write(`${r.file}\n${format(r.issues)}\n\n`);
        }
        for (const c of split) {
          process.stdout.write(`${summarise(c)}\n\n`);
        }
        process.stderr.write(
          `${files.length} file(s): ${errors} error(s), ${warns} warning(s), ${split.length} cohort split(s)\n`
        );
      }
      if (errors > 0) {
        process.exitCode = 1;
      }
    });
};
