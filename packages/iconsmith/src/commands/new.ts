import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { styleText } from "node:util";

import type { Command } from "commander";

import { loadBaselines } from "../corpus/baselines.js";
import { FILLED_VARIANT, HOUSE_VARIANT, parseIconSvg } from "../corpus/load.js";
import {
  KIN_FLOOR,
  kinScore,
  pickKin,
  sameLetters,
} from "../pipeline/analog.js";
import { gatewayAsk } from "../pipeline/audit.js";
import {
  DEFAULT_MAX_STEPS,
  loadParts,
  MissingApiKeyError,
} from "../pipeline/generate.js";
import type { Unkeyed } from "../pipeline/generate.js";
import {
  DEFAULT_INVENTORY,
  mergePackIndex,
  packIndexFromSlugs,
} from "../pipeline/mixture.js";
import type { PackIndex } from "../pipeline/mixture.js";
import type { HouseSource } from "../pipeline/reach.js";
import { reach } from "../pipeline/reach.js";
import { specAt } from "../tools/canvas.js";
import type { OpticalSize } from "../tools/canvas.js";
import { format } from "../tools/lint.js";
import type { Finish, Keyline, Part } from "../types.js";
import { assertWritable, readJson } from "./read.js";

const KEYLINES = new Set([
  "circle",
  "landscape",
  "portrait",
  "square",
  "tall",
  "wide",
]);

const SIZES = new Set<OpticalSize>([16, 20, 24]);

const cutFrom = (opts: NewOptions) => {
  const size = Number(opts.size ?? 24);
  if (!SIZES.has(size as OpticalSize)) {
    throw new Error(`Unknown size "${opts.size}". One of: 16, 20, 24.`);
  }
  return specAt({
    radius: Number(opts.radius ?? 3),
    size: size as OpticalSize,
    stroke: Number(opts.stroke ?? 2),
  });
};

interface NewOptions {
  agent?: boolean;
  analog?: boolean;
  corpus?: string;
  finish?: string;
  force?: boolean;
  harness?: boolean | string;
  inventory?: string;
  keyline?: string;
  look?: boolean;
  maxSteps?: string;
  mixture?: boolean;
  /** Draw with the `program` arm: a model-authored JavaScript builder
   *  program, executed in a sandbox, emitting the same `.icon`. */
  program?: boolean;
  model?: string;
  out?: string;
  packsRoot?: string;
  parts?: string;
  radius?: string;
  size?: string;
  stroke?: string;
  tags?: string[];
}

const isFilledSvg = (svg: string): boolean => {
  const shapes = parseIconSvg(svg);
  return shapes.length > 0 && shapes.every((s) => s.filled);
};

const variantOf = (finish: Finish): string =>
  finish === "filled" ? FILLED_VARIANT : HOUSE_VARIANT;

/** Corpus house lookup for both paints. Exported so tests can prove filled
 *  twins compile the filled file rather than adapting the outline. */
export const houseAt = (root: string): HouseSource => {
  const outlinedDir = path.join(root, HOUSE_VARIANT);
  const fileOf = (slug: string, finish: Finish = "outlined") =>
    path.join(root, variantOf(finish), `${slug}.svg`);
  return {
    has: (slug) =>
      existsSync(fileOf(slug, "outlined")) ||
      existsSync(fileOf(slug, "filled")),
    kin: (query) => {
      if (!existsSync(outlinedDir)) {
        return [];
      }
      const names = readdirSync(outlinedDir)
        .filter((f) => f.endsWith(".svg"))
        .map((f) => f.slice(0, -4));
      const [twin] = names
        .filter((slug) => sameLetters(query, slug))
        .toSorted((a, b) => a.length - b.length || a.localeCompare(b));
      if (twin !== undefined) {
        return [twin];
      }
      const shortlist = names
        .map((slug) => ({
          filled: false as boolean,
          score: kinScore(query, slug),
          slug,
        }))
        .filter((c) => c.score > KIN_FLOOR)
        .toSorted((a, b) => b.score - a.score || a.slug.localeCompare(b.slug))
        .slice(0, 12)
        .map((c) => {
          const file = fileOf(c.slug, "outlined");
          return {
            filled: existsSync(file)
              ? isFilledSvg(readFileSync(file, "utf-8"))
              : true,
            slug: c.slug,
          };
        });
      const picked = pickKin(query, shortlist);
      return picked === null ? [] : [picked];
    },
    paths: (slug, finish = "outlined") => {
      const file = fileOf(slug, finish);
      if (!existsSync(file)) {
        return null;
      }
      return parseIconSvg(readFileSync(file, "utf-8")).map((s) => s.d);
    },
  };
};

/** Product default is the sparse gate. `--analog`, `--harness` and
 *  `--program` opt out. */
export const unkeyedOf = (opts: NewOptions): Unkeyed => {
  if (opts.analog) {
    return "analog";
  }
  if (opts.program) {
    return "program";
  }
  if (opts.harness !== undefined && opts.harness !== false) {
    return "harness";
  }
  return "mixture";
};

/** `parts.json` next to the command, or under the corpus, if nobody passed one. */
export const resolveParts = (
  explicit?: string,
  cwd = process.cwd()
): Part[] => {
  const candidates = [
    explicit,
    path.join(cwd, "parts.json"),
    path.join(cwd, "corpus", "parts.json"),
  ].filter((file): file is string => file !== undefined && file.length > 0);
  for (const file of candidates) {
    if (existsSync(file)) {
      return loadParts(file);
    }
  }
  return [];
};

const resolveInventory = async (
  opts: Pick<NewOptions, "inventory" | "packsRoot">
): Promise<PackIndex> => {
  let extra: PackIndex = new Map();
  if (opts.inventory !== undefined) {
    const rows = readJson<unknown>(
      opts.inventory,
      "a pack slug index JSON file"
    );
    if (!Array.isArray(rows)) {
      throw new TypeError("inventory file must be an array of { pack, slug }.");
    }
    extra = packIndexFromSlugs(rows as { pack: string; slug: string }[]);
  }
  if (opts.packsRoot !== undefined && existsSync(opts.packsRoot)) {
    const baselines = await loadBaselines(opts.packsRoot);
    extra = mergePackIndex(
      extra,
      packIndexFromSlugs(
        baselines.entries.map((e) => ({ pack: e.pack, slug: e.icon }))
      )
    );
  }
  return extra.size > 0
    ? mergePackIndex(DEFAULT_INVENTORY, extra)
    : DEFAULT_INVENTORY;
};

const drawNew = async (name: string, opts: NewOptions) => {
  const inventory = await resolveInventory(opts);
  return reach(
    { name, tags: opts.tags },
    {
      ask: opts.look ? gatewayAsk : undefined,
      finish: opts.finish === "filled" ? "filled" : "outlined",
      forceAgent: Boolean(opts.agent),
      harnessCommand:
        typeof opts.harness === "string" && opts.harness.length > 0
          ? opts.harness
          : "claude",
      keyline: (opts.keyline as Keyline | undefined) ?? null,
      maxSteps: Number(opts.maxSteps ?? DEFAULT_MAX_STEPS),
      model: opts.model,
      parts: resolveParts(opts.parts),
      spec: cutFrom(opts),
      unkeyed: unkeyedOf(opts),
    },
    houseAt(opts.corpus ?? "corpus"),
    inventory
  );
};

const reportNew = (
  result: Awaited<ReturnType<typeof reach>>,
  opts: NewOptions,
  json: boolean,
  interactive: boolean
): void => {
  if (opts.out) {
    writeFileSync(opts.out, result.svg);
    if (result.program) {
      writeFileSync(opts.out.replace(/\.svg$/u, ".icon"), result.program);
    }
    if ((result.extras?.length ?? 0) > 0) {
      writeFileSync(
        opts.out.replace(/\.svg$/u, ".parts.json"),
        `${JSON.stringify({ parts: result.extras }, null, 2)}\n`
      );
    }
  }
  if (json) {
    process.stdout.write(
      `${JSON.stringify({
        brief: result.brief ?? null,
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
};

/**
 * `iconsmith new "<name>"` — describe an icon, get one drawn to the house spec.
 *
 * Host DRAW first for a house file or a MARKS key. A filled house file is
 * compiled as filled (`--finish filled`); adapting the outline is only the
 * fallback when that file is missing. An unkeyed name goes through the
 * sparse mixture: cheap host arms, then the gateway / OpenRouter agent.
 * `--analog` is the lab path. `--harness` is a coding-agent CLI.
 * `--agent` forces the tool-calling loop even when a house file exists.
 * `--mixture` is the default and is kept so older scripts still parse.
 * The model never emits a coordinate on any of those paths.
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
      "gateway or OpenRouter model id (`provider/model`)"
    )
    .option(
      "--agent",
      "hire the tool-calling loop even when a house file exists"
    )
    .option(
      "--analog",
      "host constructions / kin replay; default for a new glyph is to hire an agent"
    )
    .option(
      "--mixture",
      "sparse expert routing (default): cheap host arms first, agent if they fail"
    )
    .option(
      "--program",
      "the model writes a JavaScript builder program instead of the .icon by hand"
    )
    .option(
      "--inventory <file>",
      "JSON array of { pack, slug } — names only, merged onto the committed table"
    )
    .option(
      "--packs-root <dir>",
      "baseline pack tree; listings only, files are not opened"
    )
    .option(
      "--harness [command]",
      "draw with a coding-agent CLI (claude, codex); default claude"
    )
    .option(
      "--look",
      "collide analog constructions under a vision look (needs a gateway key)"
    )
    .option(
      "--finish <paint>",
      "outlined (default) or filled; a filled house file is compiled as itself",
      "outlined"
    )
    .option("--corpus <dir>", "corpus root for house-file lookup", "corpus")
    .option("-p, --parts <file>", "parts JSON, so analog can place named rims")
    .option("-o, --out <file>", "write the SVG here instead of stdout")
    .option("--force", "overwrite --out if it already exists")
    .option(
      "--max-steps <n>",
      "turns before it must stop",
      String(DEFAULT_MAX_STEPS)
    )
    .option("--size <px>", "optical size: 16, 20, or 24", "24")
    .option("--stroke <n>", "stroke width in design units", "2")
    .option("--radius <n>", "corner family, Central's radius-N", "3")
    .action(async (name: string, opts: NewOptions) => {
      if (opts.keyline && !KEYLINES.has(opts.keyline)) {
        throw new Error(
          `Unknown keyline "${opts.keyline}". One of: ${[...KEYLINES].join(", ")}.`
        );
      }
      if (
        opts.finish &&
        opts.finish !== "outlined" &&
        opts.finish !== "filled"
      ) {
        throw new Error(
          `Unknown finish "${opts.finish}". One of: outlined, filled.`
        );
      }
      if (opts.out) {
        assertWritable(opts.out, Boolean(opts.force));
      }
      try {
        reportNew(
          await drawNew(name, opts),
          opts,
          program.opts().output === "json",
          Boolean(process.stdout.isTTY) && !process.env.CI
        );
      } catch (error) {
        if (error instanceof MissingApiKeyError) {
          process.stderr.write(`${error.message}\n`);
          process.exitCode = 1;
          return;
        }
        throw error;
      }
    });
};
