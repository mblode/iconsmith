import { readdirSync } from "node:fs";
import path from "node:path";

import type { Command } from "commander";
import { Option } from "commander";

import { parseIconSvg } from "../corpus/load.js";
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
import { readJson, readText } from "./read.js";

const KEYLINES = ["circle", "square", "tall", "wide"];

/** Read an existing SVG into a canvas as raw ops, so shipped icons can be
 *  checked without first being expressible in primitives.
 *
 *  Goes through `parseIconSvg` rather than scraping `d=` attributes. Scraping
 *  reads only `<path>`, and 252 icons in the set place a shape as `<circle>`,
 *  `<rect>` or `<ellipse>` — `user` draws its head as a `<circle>` — while 11
 *  carry no `<path>` at all. Those 11 linted as `empty` and the other 241 were
 *  measured with pieces missing, which silently wrongs every extent, gap and
 *  centre this command reports. */
const fromSVG = (svg: string): { canvas: Canvas; strokes: number[] } => {
  const canvas = new Canvas();
  const strokes: number[] = [];
  for (const shape of parseIconSvg(svg)) {
    canvas.raw(shape.d);
    // Kept beside the canvas rather than in it: a `Canvas` draws only strokes,
    // so it has nowhere to record that a shipped shape is a fill. `off-axis`
    // needs the distinction — an outline-expanded fill's round joins are a fan
    // of segments at the flattener's angles, not at anybody's.
    strokes.push(shape.strokeWidth);
  }
  return { canvas, strokes };
};

const iconName = (file: string): string =>
  path.basename(file).replace(/\.svg$/u, "");

/** Every .svg in a directory, sorted, so a run is reproducible and a caller
 *  never has to glob. A whole set is 4,357 files, which a shell expansion
 *  pushes past ARG_MAX on macOS — a directory is the only form in which
 *  "audit this set" is expressible at all. */
const iconsIn = (dir: string): string[] =>
  readdirSync(dir)
    .filter((f) => f.endsWith(".svg"))
    .toSorted()
    .map((f) => path.join(dir, f));

const readManifest = (file: string): CohortManifest =>
  readJson<CohortManifest>(file, "a cohort manifest");

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

/** `iconsmith lint <svg...>` — house-spec violations for existing icons.
 *
 *  Every file on the command line is one cohort corpus: icons are grouped by
 *  the manifest or by name prefix across the whole invocation, so linting a
 *  family together says more than linting its members one at a time. */
export const registerLintCommand = (program: Command): void => {
  program
    .command("lint")
    .description("check SVG icons against the house spec")
    .argument("[files...]", "icon .svg files")
    .option("-d, --dir <path>", "directory of .svg icons, instead of files")
    .addOption(
      new Option("-k, --keyline <name>", "assert a keyline").choices(KEYLINES)
    )
    // No `-c`: it is `--corpus` on bench, eval, modifiers and repair, and one
    // letter meaning two things across a CLI is worse than one flag typed out.
    .option("--cohorts <file>", "JSON map of cohort name to icon names")
    .action(
      (
        args: string[],
        opts: { cohorts?: string; dir?: string; keyline?: string }
      ) => {
        const json = program.opts().output === "json";
        const files = opts.dir ? iconsIn(opts.dir) : args;
        if (files.length === 0) {
          throw new Error(
            opts.dir
              ? `no .svg files in "${opts.dir}".`
              : "no icons to lint. Pass .svg files, or --dir <path>."
          );
        }
        const keyline = (opts.keyline ?? null) as Keyline | null;
        const manifest = opts.cohorts ? readManifest(opts.cohorts) : undefined;

        const drawn = files.map((file) => ({
          ...fromSVG(readText(file, "an .svg icon")),
          file,
          name: iconName(file),
        }));
        const members: CohortMember[] = drawn.flatMap((d) =>
          d.canvas.elements.length > 0
            ? [
                {
                  box: measure(d.canvas.elements.map((e) => e.d)),
                  name: d.name,
                },
              ]
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
          issues: lint(
            {
              elements: d.canvas.elements.map((e, i) => ({
                ...e,
                strokeWidth: d.strokes[i],
              })),
            },
            { cohort: viewFor(d.name), keyline }
          ),
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
      }
    );
};
