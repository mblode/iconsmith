import { styleText } from "node:util";

import { Command, Option } from "commander";

import { registerAuditCommands } from "./commands/audit.js";
import { registerConceptsCommand } from "./commands/concepts.js";
import { registerConformCommand } from "./commands/conform.js";
import { registerCorpusCommands } from "./commands/corpus.js";
import { registerDrawCommand } from "./commands/draw.js";
import { registerEvalCommand } from "./commands/eval.js";
import { registerImproveCommand } from "./commands/improve.js";
import { registerLintCommand } from "./commands/lint.js";
import { registerNewCommand } from "./commands/new.js";
import { registerPartsCommand } from "./commands/parts.js";

// stdout carries data only; stderr carries logs, progress, and human hints.
const isInteractive =
  Boolean(process.stdout.isTTY) &&
  !process.env.NO_COLOR &&
  !process.env.CI &&
  process.env.TERM !== "dumb";

const program = new Command();

program
  .name("iconsmith")
  .description(
    "Icon generation pipeline: extract parts from an icon set, compose new icons in a constrained DSL, conform them to a house spec."
  )
  .version("0.0.1")
  .addOption(
    new Option("--output <format>", "output format")
      .choices(["text", "json"])
      .default("text")
  )
  .addHelpText(
    "after",
    "\nFrom the repository root, after npm run build:local:\n" +
      "  npm run iconsmith -- draw examples/square-check.icon -o square-check.svg\n" +
      "\nFor pinned-style AI generation: npm run generate:local -- --help\n"
  );

registerPartsCommand(program);
registerDrawCommand(program);
registerLintCommand(program);
registerEvalCommand(program);
registerConformCommand(program);
registerNewCommand(program);
registerImproveCommand(program);
registerAuditCommands(program);
registerCorpusCommands(program);
registerConceptsCommand(program);

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
