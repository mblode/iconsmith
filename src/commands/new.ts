import { writeFileSync } from "node:fs";
import { styleText } from "node:util";

import type { Command } from "commander";

import {
  DEFAULT_MAX_STEPS,
  generate,
  loadParts,
  MissingApiKeyError,
} from "../pipeline/generate.js";
import { format } from "../tools/lint.js";
import type { Keyline } from "../types.js";

const KEYLINES = new Set([
  "circle",
  "landscape",
  "portrait",
  "square",
  "tall",
  "wide",
]);

interface NewOptions {
  keyline?: string;
  maxSteps?: string;
  model?: string;
  out?: string;
  parts?: string;
  tags?: string[];
}

/**
 * `forge new "<name>"` — describe an icon, get one drawn to the house spec.
 *
 * The loop's whole guarantee is that the model never emits a coordinate: it
 * calls primitives that quantise to the grid, snap angles and tier radii, so an
 * off-spec result is unrepresentable rather than merely discouraged. This
 * command is a thin shell over that — it resolves a model, hands over the
 * concept, and reports what came back plus whether it linted clean.
 */
export const registerNewCommand = (program: Command): void => {
  program
    .command("new")
    .description("describe an icon; draw it to the house spec")
    .argument("<name>", "icon name, kebab-case (e.g. folder-clock)")
    .option(
      "-t, --tags <tag...>",
      "synonyms that disambiguate the concept (e.g. -t schedule -t deadline)"
    )
    .option("-k, --keyline <name>", "keyline to draw to; omit to let it choose")
    .option(
      "-m, --model <id>",
      "model id; namespaced ids route through the AI Gateway",
      "anthropic/claude-opus-4.5"
    )
    .option(
      "-p, --parts <file>",
      "parts JSON, so it can reuse the set's shapes"
    )
    .option("-o, --out <file>", "write the SVG here instead of stdout")
    .option(
      "--max-steps <n>",
      "turns before it must stop",
      String(DEFAULT_MAX_STEPS)
    )
    .action(async (name: string, opts: NewOptions) => {
      const json = program.opts().output === "json";
      const interactive = Boolean(process.stdout.isTTY) && !process.env.CI;

      if (opts.keyline && !KEYLINES.has(opts.keyline)) {
        throw new Error(
          `Unknown keyline "${opts.keyline}". One of: ${[...KEYLINES].join(", ")}.`
        );
      }

      let result: Awaited<ReturnType<typeof generate>>;
      try {
        result = await generate(
          { name, tags: opts.tags },
          {
            keyline: (opts.keyline as Keyline | undefined) ?? null,
            maxSteps: Number(opts.maxSteps ?? DEFAULT_MAX_STEPS),
            model: opts.model,
            parts: opts.parts ? loadParts(opts.parts) : [],
          }
        );
      } catch (error) {
        if (error instanceof MissingApiKeyError) {
          process.stderr.write(`${error.message}\n`);
          process.exitCode = 1;
          return;
        }
        throw error;
      }

      if (opts.out) {
        writeFileSync(opts.out, result.svg);
      }

      if (json) {
        process.stdout.write(
          `${JSON.stringify({
            clean: result.clean,
            icon: result.doc.icon,
            issues: result.issues,
            steps: result.steps,
            svg: result.svg,
            trace: result.trace,
            written: opts.out ?? null,
          })}\n`
        );
        return;
      }

      if (!opts.out) {
        process.stdout.write(`${result.svg}\n`);
      }

      // Everything below is commentary, so it goes to stderr and leaves stdout
      // as the icon alone — `forge new x > x.svg` has to produce a valid file.
      const label = (text: string, colour: "green" | "red" | "yellow") =>
        interactive ? styleText(colour, text) : text;

      process.stderr.write(`\n${result.text.trim()}\n\n`);
      process.stderr.write(
        `  ${result.steps} step(s): ${result.trace.join(" → ")}\n`
      );
      if (result.issues.length > 0) {
        process.stderr.write(`${format(result.issues)}\n`);
      }
      process.stderr.write(
        result.clean
          ? `  ${label("clean", "green")} — no lint errors\n`
          : `  ${label("off-spec", "red")} — see above\n`
      );
      if (opts.out) {
        process.stderr.write(`  wrote ${opts.out}\n`);
      }
      if (!result.clean) {
        process.exitCode = 1;
      }
    });
};
