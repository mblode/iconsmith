/** Deterministic sibling lookup over the whole bundled blode-icons library. */
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import { z } from "zod";

import { sheet } from "../src/tools/render.js";
import { BLODE_ICONS_PACKAGE } from "./blode-icons.js";

const metadataSchema = z
  .object({
    category: z.string().optional(),
    icon: z.string(),
    tags: z.array(z.string()).default([]),
  })
  .passthrough();

interface LibrarySibling {
  /** Shared tags, shared cohort, and name tokens that link it to the concept. */
  readonly because: readonly string[];
  readonly name: string;
  readonly score: number;
  readonly svg: string;
}

export interface LibrarySiblingsResult {
  readonly concept: string;
  readonly conceptTags: readonly string[];
  /** Library files that are the concept itself, a byte twin, or Lucide-derived. */
  readonly excluded: readonly string[];
  readonly finish: "outlined" | "filled";
  readonly siblings: readonly LibrarySibling[];
}

const sha256 = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const tokens = (name: string) =>
  new Set(name.split("-").filter((t) => t.length > 2));
const normalise = (tag: string) =>
  tag
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, " ")
    .trim();

const readTags = (dataDirectory: string, name: string): string[] => {
  const file = path.join(dataDirectory, `${name}.json`);
  if (!existsSync(file)) {
    return [];
  }
  const parsed = metadataSchema.parse(JSON.parse(readFileSync(file, "utf-8")));
  return parsed.tags.map(normalise).filter((t) => t.length > 0);
};

const cohortOf = (
  name: string,
  cohorts: Readonly<Record<string, readonly string[]>>
): string | null =>
  Object.entries(cohorts).find(([, members]) => members.includes(name))?.[0] ??
  null;

/** Rank every library drawing by how much it shares with the requested concept. */
export const librarySiblings = (
  concept: string,
  {
    finish = "outlined",
    library = BLODE_ICONS_PACKAGE,
    limit = 24,
  }: {
    finish?: "outlined" | "filled";
    library?: string;
    limit?: number;
  } = {}
): LibrarySiblingsResult => {
  const svgDirectory = path.join(library, "icons-svg");
  const dataDirectory = path.join(library, "icons-data");
  const cohorts = z
    .record(z.array(z.string()))
    .parse(
      JSON.parse(
        readFileSync(path.join(dataDirectory, "_cohorts.json"), "utf-8")
      )
    );
  const conceptTags = new Set(readTags(dataDirectory, concept));
  const conceptTokens = tokens(concept);
  const conceptCohort = cohortOf(concept, cohorts);
  const conceptFile = path.join(svgDirectory, `${concept}.svg`);
  const conceptHash = existsSync(conceptFile)
    ? sha256(readFileSync(conceptFile, "utf-8"))
    : null;
  const excluded: string[] = [];
  const siblings: LibrarySibling[] = [];
  for (const file of readdirSync(svgDirectory).toSorted()) {
    if (!/^[a-z][a-z0-9-]*\.svg$/u.test(file)) {
      continue;
    }
    const filled = file.endsWith("-filled.svg");
    if (filled !== (finish === "filled")) {
      continue;
    }
    const name = file.replace(/(?:-filled)?\.svg$/u, "");
    const svg = readFileSync(path.join(svgDirectory, file), "utf-8");
    if (
      name === concept ||
      sha256(svg) === conceptHash ||
      svg.includes('class="lucide')
    ) {
      excluded.push(file);
      continue;
    }
    const because = [
      ...readTags(dataDirectory, name)
        .filter((tag) => conceptTags.has(tag))
        .map((tag) => `tag:${tag}`),
      ...(conceptCohort !== null && cohortOf(name, cohorts) === conceptCohort
        ? [`cohort:${conceptCohort}`]
        : []),
      ...[...tokens(name)]
        .filter((token) => conceptTokens.has(token))
        .map((token) => `name:${token}`),
    ];
    if (because.length > 0) {
      siblings.push({ because, name, score: because.length, svg });
    }
  }
  siblings.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return {
    concept,
    conceptTags: [...conceptTags].toSorted(),
    excluded,
    finish,
    siblings: siblings.slice(0, limit),
  };
};

/** Write `siblings.json` and a `siblings.png` contact sheet into a new directory. */
const writeLibrarySiblings = async (
  result: LibrarySiblingsResult,
  out: string
): Promise<void> => {
  if (existsSync(out)) {
    throw new Error(`Refusing to overwrite ${out}`);
  }
  mkdirSync(out, { recursive: true });
  writeFileSync(
    path.join(out, "siblings.json"),
    `${JSON.stringify(
      {
        ...result,
        siblings: result.siblings.map(({ svg, ...rest }) => ({
          ...rest,
          svgHash: sha256(svg),
        })),
      },
      null,
      2
    )}\n`
  );
  if (result.siblings.length > 0) {
    writeFileSync(
      path.join(out, "siblings.png"),
      await sheet(
        result.siblings.map((s) => s.svg),
        { cols: 6, size: 96 }
      )
    );
  }
};

if (process.argv[1]?.endsWith("library-siblings.ts")) {
  const [concept, out, finish] = process.argv.slice(2);
  if (!(concept && out)) {
    console.error(
      "Usage: library-siblings.ts <concept> <new-output-directory> [outlined|filled]"
    );
    process.exit(1);
  }
  const result = librarySiblings(concept, {
    finish: finish === "filled" ? "filled" : "outlined",
  });
  await writeLibrarySiblings(result, out);
  for (const sibling of result.siblings) {
    console.log(`${sibling.name}\t${sibling.because.join(" ")}`);
  }
  console.log(
    `${result.siblings.length} siblings for ${concept}; ${result.excluded.length} excluded; sheet at ${path.join(out, "siblings.png")}`
  );
}
