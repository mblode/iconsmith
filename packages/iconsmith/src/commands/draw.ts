import { readFileSync, writeFileSync } from "node:fs";

import type { Command } from "commander";

import { run } from "../tools/dsl.js";
import { format, lint } from "../tools/lint.js";
import type { Part } from "../types.js";
import { assertWritable, readJson, readText } from "./read.js";

const loadParts = (path?: string): Part[] => {
  if (!path) {
    return [];
  }
  const raw = readJson<unknown>(path, "a parts JSON file");
  if (Array.isArray(raw)) {
    return raw as Part[];
  }
  return (raw as { parts?: Part[] }).parts ?? [];
};

/** `iconsmith draw <program>` — run a DSL program and emit the icon. */
export const registerDrawCommand = (program: Command): void => {
  program
    .command("draw")
    .description("run an icon DSL program and emit SVG")
    .argument("<file>", "DSL program (- for stdin)")
    .option("-p, --parts <file>", "parts JSON, for `part` ops")
    .option("--doc", "emit the icon document instead of SVG")
    .option("-o, --out <file>", "write here instead of stdout")
    .option("--force", "overwrite --out if it already exists")
    .action(
      (
        file: string,
        opts: {
          doc?: boolean;
          force?: boolean;
          out?: string;
          parts?: string;
        }
      ) => {
        const json = program.opts().output === "json";
        // Checked before the program runs, so a clobber is refused while the
        // work that would have overwritten the file still exists. `new` has
        // guarded this since it was written; `draw` could only redirect, which
        // is the one path in this CLI where a shell operator could destroy an
        // icon nobody asked it to touch.
        if (opts.out) {
          assertWritable(opts.out, Boolean(opts.force));
        }
        const source =
          file === "-"
            ? readFileSync(0, "utf-8")
            : readText(file, "a DSL program");
        const result = run(source, loadParts(opts.parts));

        for (const err of result.errors) {
          process.stderr.write(`${err}\n`);
        }

        const issues = lint(result.canvas, { keyline: result.keyline });
        const invalid =
          result.errors.length > 0 ||
          issues.some((issue) => issue.severity === "error");
        const svg = result.canvas.toSVG();
        const doc = result.canvas.toJSON({
          icon: result.icon,
          keyline: result.keyline,
        });

        const body = opts.doc ? JSON.stringify(doc, null, 2) : svg;
        if (opts.out && !invalid) {
          writeFileSync(opts.out, `${body}\n`, {
            flag: opts.force ? "w" : "wx",
          });
        }
        if (json) {
          process.stdout.write(
            `${JSON.stringify({
              ...(invalid
                ? {
                    code: "DRAW_INVALID",
                    details: { errors: result.errors, issues },
                    error: true,
                    message: "Drawing failed compilation or geometry checks.",
                  }
                : {}),
              doc,
              errors: result.errors,
              issues,
              svg,
            })}\n`
          );
        } else if (opts.out) {
          if (!invalid) {
            process.stderr.write(`wrote ${opts.out}\n`);
          }
          if (issues.length > 0) {
            process.stderr.write(`${format(issues)}\n`);
          }
        } else {
          process.stdout.write(`${body}\n`);
          if (issues.length > 0) {
            process.stderr.write(`${format(issues)}\n`);
          }
        }

        // A parse error is a failed run; a lint warning is not.
        if (invalid) {
          process.exitCode = 1;
        }
      }
    );
};
