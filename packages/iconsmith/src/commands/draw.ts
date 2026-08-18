import { readFileSync } from "node:fs";

import type { Command } from "commander";

import { run } from "../tools/dsl.js";
import { format, lint } from "../tools/lint.js";
import type { Part } from "../types.js";
import { readJson, readText } from "./read.js";

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
    .action((file: string, opts: { doc?: boolean; parts?: string }) => {
      const json = program.opts().output === "json";
      const source =
        file === "-"
          ? readFileSync(0, "utf-8")
          : readText(file, "a DSL program");
      const result = run(source, loadParts(opts.parts));

      for (const err of result.errors) {
        process.stderr.write(`${err}\n`);
      }

      const issues = lint(result.canvas, { keyline: result.keyline });
      const svg = result.canvas.toSVG();
      const doc = result.canvas.toJSON({
        icon: result.icon,
        keyline: result.keyline,
      });

      if (json) {
        process.stdout.write(
          `${JSON.stringify({ doc, errors: result.errors, issues, svg })}\n`
        );
      } else {
        process.stdout.write(
          `${opts.doc ? JSON.stringify(doc, null, 2) : svg}\n`
        );
        if (issues.length > 0) {
          process.stderr.write(`${format(issues)}\n`);
        }
      }

      // A parse error is a failed run; a lint warning is not.
      if (
        result.errors.length > 0 ||
        issues.some((i) => i.severity === "error")
      ) {
        process.exitCode = 1;
      }
    });
};
