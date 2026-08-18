import { styleText } from "node:util";

import { Command } from "commander";

import { registerDrawCommand } from "./commands/draw.js";
import { registerEvalCommand } from "./commands/eval.js";
import { registerLintCommand } from "./commands/lint.js";
import { registerPartsCommand } from "./commands/parts.js";

// stdout carries data only; stderr carries logs, progress, and human hints.
const isInteractive =
  Boolean(process.stdout.isTTY) && !process.env.NO_COLOR && !process.env.CI;

const program = new Command();

program
  .name("forge")
  .description(
    "Icon generation pipeline: extract parts from an icon set, compose new icons in a constrained DSL, conform them to a house spec."
  )
  .version("0.0.1")
  .option("--output <format>", "output format: text or json", "text")
  .option("--no-input", "never prompt; fail if a required value is missing");

registerPartsCommand(program);
registerDrawCommand(program);
registerLintCommand(program);
registerEvalCommand(program);

try {
  await program.parseAsync();
} catch (error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (program.opts().output === "json") {
    process.stdout.write(
      JSON.stringify({
        code: "UNEXPECTED",
        details: {},
        error: true,
        message,
      })
    );
  } else {
    const label = isInteractive ? styleText("red", "Error:") : "Error:";
    process.stderr.write(`${label} ${message}\n`);
  }
  process.exitCode = 1;
}
