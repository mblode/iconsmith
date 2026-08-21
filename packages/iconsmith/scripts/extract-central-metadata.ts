/**
 * Lift Central's editorial metadata out of the scraped bundle, once.
 *
 * `central.json` at the repo root is a minified Turbopack chunk — third-party
 * vendor code wearing a `.json` extension, gitignored for the provenance
 * reason `.gitignore` states. It carries the one thing the corpus does not
 * have: **Central's own** titles, categories and aliases for all 2,086
 * symbols.
 *
 * `corpus/build.ts` abstains from giving Central editorial fields, and its
 * reason is right — "giving it blode's categories would assert that Central's
 * editors agreed with blode's, which nobody has checked". That objection is to
 * *borrowing blode's* labels. These are Central's, so it does not apply; the
 * fields were empty because nobody had them, not because they were refused.
 *
 * The output is derived, so it lands in `.corpus/` beside the geometry it
 * describes, under the same `usage: "conditioning"` the source carries. It is
 * never committed: a table of a proprietary set's editorial labels in an MIT
 * repo is the same question the bundle itself raised, with the same answer.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";

/**
 * One symbol's editorial record, as Central states it.
 *
 * Two fields of the four in the bundle. `title` is dropped because it is the
 * aliases comma-joined — the same string, in all 2,086 entries, and a second
 * copy of a list is not a title. `createdAt` is dropped because 2,000 of them
 * share one bulk-import timestamp, so it dates the scrape and not the drawing.
 */
export interface CentralMetadata {
  /** Central's own synonyms, hand-typed free text — `open link`, `a11y`,
   *  `heartbeat`. Not slugs, and not guaranteed to be single words. */
  readonly aliases: readonly string[];
  readonly category: string;
}

/** Each entry in the chunk. Bodies hold no nested braces, so a lazy `[^}]*`
 *  is exact here and does not need a brace matcher. */
const ENTRY = /(?<name>Icon[A-Za-z0-9]+):\s*\{(?<body>[^{}]*)\}/gu;
const FIELD = /(?<key>[a-zA-Z]+):\s*"(?<value>(?:[^"\\]|\\.)*)"/gu;
/** The chunk exports several things; only this one is metadata. */
const BLOCK = /e\.s\(\["iconMetadata",\s*0,\s*\{/u;

/** `IconArrowWall2Right` → `arrow-wall-2-right`. The component names are
 *  machine-derived from the slugs and are consistent; the *aliases* are typed
 *  by hand and are not — `clipboard 2-sparkle` and `Folder-sparkle` both
 *  appear as a leading alias. So the slug comes from the name, and the alias
 *  is what gets normalised. */
export const slugOf = (component: string): string =>
  component
    .replace(/^Icon/u, "")
    .replaceAll(/(?<lower>[a-z])(?<upper>[A-Z])/gu, "$<lower>-$<upper>")
    .replaceAll(/(?<alpha>[A-Za-z])(?<digit>[0-9])/gu, "$<alpha>-$<digit>")
    .replaceAll(/(?<digit>[0-9])(?<alpha>[A-Za-z])/gu, "$<digit>-$<alpha>")
    .toLowerCase();

/** Comparison key: everything that is not a letter or digit, gone. `3d-sphere`
 *  and `Icon3DSphere` disagree on where the hyphens go and on nothing else, and
 *  so do 49 others — `back-10s` against `back-10-s`, `qm3` against `qm-3`. No
 *  hyphenation rule gets all of them, because the set does not have one. */
const compare = (s: string): string =>
  s.toLowerCase().replaceAll(/[^a-z0-9]/gu, "");

/**
 * Resolve a component name against the slugs that actually have SVGs.
 *
 * The disk is the authority on what a slug is called; this file is only the
 * authority on what it means. Where the two spell a name differently the disk
 * wins, and where the disk has never heard of it `slugOf` stands so the row
 * still parses and the caller can report it as unmatched.
 */
export const resolverFor = (
  diskSlugs: readonly string[]
): ((component: string) => string) => {
  const byKey = new Map(diskSlugs.map((slug) => [compare(slug), slug]));
  return (component) => {
    const derived = slugOf(component);
    return byKey.get(compare(derived)) ?? derived;
  };
};

/**
 * Parse the chunk into a slug-keyed table.
 *
 * Keyed by the component name, resolved to a slug. Not by the first alias:
 * the aliases look like the slug and mostly are, but they are hand-typed and
 * 98 of them are not — `clipboard 2-sparkle` carries a space,
 * `Folder-sparkle` a capital. A table keyed off those has 98 rows no SVG on
 * disk answers to, and the failure is silent: the search simply never matches
 * them.
 *
 * `resolve` defaults to `slugOf` so the parser stands alone in a test, and is
 * given {@link resolverFor} in anger, because a derivation that only agrees
 * with itself proves nothing.
 */
export const parseCentral = (
  source: string,
  resolve: (component: string) => string = slugOf
): Record<string, CentralMetadata> => {
  const start = BLOCK.exec(source);
  if (!start) {
    throw new Error(
      "No `iconMetadata` export in that file. This script reads the scraped centralicons.com Turbopack chunk; point it at `central.json` at the repo root."
    );
  }
  const body = source.slice(start.index);
  const records: Record<string, CentralMetadata> = {};
  for (const entry of body.matchAll(ENTRY)) {
    const name = entry.groups?.name ?? "";
    const fields: Record<string, string> = {};
    for (const field of (entry.groups?.body ?? "").matchAll(FIELD)) {
      fields[field.groups?.key ?? ""] = field.groups?.value ?? "";
    }
    if (!(fields.aliases && fields.category && fields.title)) {
      continue;
    }
    const slug = resolve(name);
    // Drop the leading alias: it is the slug in every entry that has a clean
    // one, so keeping it would double-count the term the search already
    // reaches through provenance and make the widening look bigger than it is.
    const aliases = fields.aliases
      .split(",")
      .map((a) => a.trim().toLowerCase())
      .filter((a) => a && a !== slug);
    records[slug] = { aliases, category: fields.category };
  }
  return records;
};

const OUT = ".corpus/central-metadata.json";
/** The slugs that actually have SVGs, written by `corpus build`. */
const ON_DISK = "corpus/corpus.json";

const main = (): void => {
  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const input = args.find((a) => !a.startsWith("--")) ?? "../../central.json";
  const output = OUT;
  if (!existsSync(input)) {
    process.stderr.write(
      `No such file: ${input}\nThis reads the scraped centralicons.com chunk, which is gitignored and therefore not present in a fresh clone. Pass its path as the first argument.\n`
    );
    process.exit(2);
  }
  if (existsSync(output) && !force) {
    process.stderr.write(
      `${output} already exists. Re-run with --force to replace it.\n`
    );
    process.exit(2);
  }
  const disk: string[] = existsSync(ON_DISK)
    ? JSON.parse(readFileSync(ON_DISK, "utf-8")).icons
    : [];
  const records = parseCentral(
    readFileSync(input, "utf-8"),
    disk.length > 0 ? resolverFor(disk) : slugOf
  );
  const count = Object.keys(records).length;
  if (count === 0) {
    throw new Error(
      "Parsed zero records out of a file that has an `iconMetadata` export. The chunk's shape has changed; fix ENTRY/FIELD rather than shipping an empty table."
    );
  }
  writeFileSync(output, `${JSON.stringify(records, null, 2)}\n`);
  const terms = new Set(Object.values(records).flatMap((r) => r.aliases));
  const categories = new Set(Object.values(records).map((r) => r.category));
  process.stdout.write(
    `${count} symbols, ${terms.size} distinct alias terms, ${categories.size} categories → ${output}\n`
  );
  // The only check that means anything: do these keys name icons that exist?
  // A slug the store does not carry reaches nothing, and one the store carries
  // but this table misses is metadata quietly left on the floor.
  if (disk.length > 0) {
    const known = new Set(disk);
    const unmatched = Object.keys(records).filter((s) => !known.has(s));
    const uncovered = disk.filter((s) => !records[s]);
    process.stdout.write(
      `${disk.length - uncovered.length}/${disk.length} icons on disk carry metadata; ${unmatched.length} keys name no icon on disk.\n`
    );
    if (unmatched.length > 0) {
      process.stdout.write(
        `  unmatched: ${unmatched.slice(0, 8).join(", ")}\n`
      );
    }
    if (uncovered.length > 0) {
      process.stdout.write(
        `  uncovered: ${uncovered.slice(0, 8).join(", ")}\n`
      );
    }
  }
};

if (process.argv[1]?.endsWith("extract-central-metadata.ts")) {
  main();
}
