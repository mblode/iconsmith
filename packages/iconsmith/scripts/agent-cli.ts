/** Portable, local tools for the host agent. No provider dispatch. */
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { Command, CommanderError, Option } from "commander";

import { registerDrawCommand } from "../src/commands/draw.js";
import { registerLintCommand } from "../src/commands/lint.js";
import { InputError, readText } from "../src/commands/read.js";
import { opticalProof } from "../src/tools/proof.js";
import { librarySiblings, writeLibrarySiblings } from "./library-siblings.js";
import { checkStyle } from "./style-check.js";

const root = path.resolve(import.meta.dirname, "..");
const manifest = JSON.parse(
  readFileSync(path.join(root, "package.json"), "utf-8")
);
const bundledRevision = path.join(root, "dist-agent", "revision.json");
const program = new Command()
  .name("iconsmith")
  .description(
    "Draw and review icons with your coding agent and the bundled Blode family"
  )
  .version(manifest.version)
  .exitOverride()
  .configureOutput({
    writeErr: () => {
      /* The top-level handler renders parser failures once. */
    },
  })
  .addOption(
    new Option("--output <format>", "output format")
      .choices(["text", "json"])
      .default("text")
  )
  .addHelpText(
    "after",
    "\nInstall the agent skill: iconsmith skill --out .agents/skills/iconsmith\nThen ask your agent: Create a bookmark-check icon with iconsmith.\nNo API key is needed. These commands never call a model.\n"
  );

const writeJson = (file: string, value: unknown) =>
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });

/** mkdir without recursive protects existing directories, including empty ones. */
const freshDirectory = (directory: string) => {
  const out = path.resolve(directory);
  mkdirSync(path.dirname(out), { recursive: true });
  try {
    mkdirSync(out);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new InputError(
        `Output directory "${out}" already exists. Choose a new --out directory; existing work is preserved.`,
        error
      );
    }
    throw error;
  }
  return out;
};

program
  .command("skill")
  .description("install the portable skill into a new directory")
  .requiredOption("--out <directory>", "new skill directory")
  .action((opts: { out: string }) => {
    const out = freshDirectory(opts.out);
    cpSync(path.join(root, "SKILL.md"), path.join(out, "SKILL.md"));
    cpSync(path.join(root, "references"), path.join(out, "references"), {
      recursive: true,
    });
    console.log(
      JSON.stringify({
        next: "Open or refresh your agent session, then ask for an icon with iconsmith.",
        skill: path.join(out, "SKILL.md"),
      })
    );
  });

program
  .command("prepare")
  .description("pin the request, house revision and related reference drawings")
  .argument("<concept>", "requested icon name")
  .requiredOption("--out <directory>", "new request directory")
  .action(async (concept: string, opts: { out: string }) => {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(concept)) {
      throw new InputError(
        `Invalid concept "${concept}". Use a lowercase hyphenated icon name, such as bookmark-check.`
      );
    }
    const revision = JSON.parse(readFileSync(bundledRevision, "utf-8"));
    const siblings = librarySiblings(concept);
    const out = freshDirectory(opts.out);
    writeJson(path.join(out, "request.json"), {
      concept,
      finish: "outlined",
      nativeSize: 24,
      status: "draft",
    });
    writeJson(path.join(out, "revision.json"), revision);
    await writeLibrarySiblings(siblings, path.join(out, "references"));
    // Keep source SVGs available for precise element matching, not only a sheet.
    writeJson(path.join(out, "references", "drawings.json"), siblings.siblings);
    console.log(
      JSON.stringify({
        directory: out,
        next: "Have two independent authors create candidate directories with outlined.icon, then run iconsmith check.",
        references: siblings.siblings.length,
        revision: path.join(out, "revision.json"),
      })
    );
  });

program
  .command("check")
  .description(
    "compile a candidate's outlined.icon with exact replay and native proofs"
  )
  .argument("<directory>", "candidate directory containing outlined.icon")
  .option("--revision <file>", "pinned revision.json", bundledRevision)
  .action(async (directory: string, opts: { revision: string }) => {
    await checkStyle(opts.revision, "24", directory, "outlined");
  });

program
  .command("render")
  .description(
    "render an existing SVG at 24px, 2x, and enlarged on light and dark"
  )
  .argument("<svg>", "SVG file (- for stdin)")
  .requiredOption("--out <directory>", "new proof directory")
  .action(async (file: string, opts: { out: string }) => {
    const svg =
      file === "-" ? readFileSync(0, "utf-8") : readText(file, "an SVG file");
    const proof = await opticalProof(svg, 24);
    const out = freshDirectory(opts.out);
    writeFileSync(path.join(out, "proof.png"), proof.proof, { flag: "wx" });
    writeFileSync(path.join(out, "native.png"), proof.native, { flag: "wx" });
    writeFileSync(path.join(out, "retina.png"), proof.retina, { flag: "wx" });
    writeJson(path.join(out, "proof.json"), {
      ...proof.metadata,
      craftApproved: false,
      sourceSha256: createHash("sha256").update(svg).digest("hex"),
    });
    console.log(
      JSON.stringify({
        assessment: "render-only",
        craftApproved: false,
        directory: out,
      })
    );
  });

registerDrawCommand(program);
registerLintCommand(program);

const describe = (command: Command): unknown => ({
  arguments: command.registeredArguments.map((argument) => ({
    description: argument.description,
    name: argument.name(),
    required: argument.required,
    type: "string",
    variadic: argument.variadic,
  })),
  commands: command.commands.map(describe),
  description: command.description(),
  name: command.name(),
  options: command.options.map((option) => ({
    default: option.defaultValue ?? null,
    description: option.description,
    enum: option.argChoices ?? null,
    flags: option.flags,
    name: option.attributeName(),
    required: option.mandatory,
    type: option.required || option.optional ? "string" : "boolean",
  })),
});
program
  .command("schema")
  .description("describe commands, arguments and options as JSON")
  .action(() => console.log(JSON.stringify(describe(program))));

try {
  await program.parseAsync();
} catch (error) {
  if (error instanceof CommanderError && error.exitCode === 0) {
    process.exitCode = 0;
  } else {
    const failure = error as Error & {
      code?: string;
      path?: string;
      cause?: { code?: string };
    };
    const code = failure.code ?? "COMMAND_FAILED";
    const message = failure.message ?? String(error);
    const hint =
      error instanceof CommanderError
        ? "Run iconsmith schema or iconsmith <command> --help for accepted arguments."
        : "Check the named input and choose a new output path if it already exists.";
    if (program.opts().output === "json") {
      console.log(
        JSON.stringify({
          code,
          details: {
            cause: failure.cause?.code ?? null,
            path: failure.path ?? null,
          },
          error: true,
          hint,
          message,
        })
      );
      console.error(hint);
    } else {
      console.error(`${code}: ${message}\n${hint}`);
    }
    process.exitCode = 1;
  }
}
