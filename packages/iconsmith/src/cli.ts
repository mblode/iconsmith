import { styleText } from "node:util";

import { Command } from "commander";

import { registerAuditCommands } from "./commands/audit.js";
import { registerConformCommand } from "./commands/conform.js";
import { registerCorpusCommands } from "./commands/corpus.js";
import { registerDrawCommand } from "./commands/draw.js";
import { registerEvalCommand } from "./commands/eval.js";
import { registerLintCommand } from "./commands/lint.js";
import { registerNewCommand } from "./commands/new.js";
import { registerPartsCommand } from "./commands/parts.js";

// stdout carries data only; stderr carries logs, progress, and human hints.
const isInteractive =
  Boolean(process.stdout.isTTY) && !process.env.NO_COLOR && !process.env.CI;

const program = new Command();

program
  .name("iconsmith")
  .description(
    "Icon generation pipeline: extract parts from an icon set, compose new icons in a constrained DSL, conform them to a house spec."
  )
  .version("0.0.1")
  .option("--output <format>", "output format: text or json", "text");

registerPartsCommand(program);
registerDrawCommand(program);
registerLintCommand(program);
registerEvalCommand(program);
registerConformCommand(program);
registerNewCommand(program);
registerAuditCommands(program);
registerCorpusCommands(program);

try {
  await program.parseAsync();
} catch (error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  // An error that named itself keeps its code; only a genuinely unexpected one
  // gets UNEXPECTED, so a caller can branch on bad input without string-matching.
  const code =
    (error as { code?: unknown })?.code === undefined
      ? "UNEXPECTED"
      : String((error as { code: unknown }).code);
  if (program.opts().output === "json") {
    process.stdout.write(
      JSON.stringify({
        code,
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
