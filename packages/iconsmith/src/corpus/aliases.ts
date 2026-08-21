/**
 * The words an icon answers to, beyond its filename.
 *
 * `pipeline/search.ts` ranks a part by tokenising the slugs of the icons it was
 * extracted from. That reaches whatever words happen to be in a filename and
 * nothing else — a search for `open link` finds nothing while
 * `square-arrow-top-right` sits in the set, and `part-coverage.v1.json` records
 * the cost: 548 of 2,201 concepts reachable by provenance, 76 by a curated
 * name.
 *
 * Both sets already carry a synonym list. Nobody had read either one.
 *
 * - blode-icons: `_concepts.json`, the blessed concept → slug map a person
 *   maintains. 2,203 entries. Inverted here, so `ufo` answers `abduction`.
 * - Central: `.corpus/central-metadata.json`, its editors' own aliases, lifted
 *   out of the scraped bundle by `scripts/extract-central-metadata.ts`. 2,073
 *   icons, 1,246 distinct terms.
 *
 * One table, keyed by slug, because the two sets share their slugs and a search
 * that reached one and not the other would report a route as worse when it was
 * only being asked a different question — the property `search.ts`'s header
 * exists to protect.
 *
 * Absent files degrade to an empty table rather than throwing, the way
 * `eval/vectors.ts` degrades without its embedding sidecars. `iconsmith parts`
 * has to work in a fresh clone, where neither file exists.
 *
 * TWO TABLES, AND THE SECOND ONE IS THE HONEST ONE.
 *
 * `_concepts.json` is both a source of aliases and the list of concepts
 * coverage is scored against. Feed it to the search and coverage rises from
 * 24.9% to 88.7% — because every key in that file points at a slug the set
 * draws, so aliasing it makes it reachable *by construction*. That is the same
 * trap `corpus/concepts.ts` documents one level up, where 1,522 tautological
 * `add-image → add-image` entries take nominal coverage to 99.8% and
 * informative coverage nowhere.
 *
 * So `independent` holds only sources that did not supply the concept list.
 * Central's editors have never seen blode's concept map, so their synonyms
 * scored against it are evidence; blode's own map scored against itself is a
 * restatement. Measured: 548 → 928 independent, 548 → 1,974 with the house map
 * folded in. Both are true and only the first is a result.
 *
 * The drawer gets `aliases`, the full table — a model looking for a shape
 * should reach every word anybody has written down, and the tautology costs it
 * nothing. Coverage gets `independent`, and the report prints both.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

/** Slug → the words it also answers to. Lowercased, deduplicated, and never
 *  containing the slug itself: the slug is already reached by provenance, and
 *  counting it again would make the widening look bigger than it is. */
export type SlugAliases = ReadonlyMap<string, readonly string[]>;

export const NO_ALIASES: SlugAliases = new Map();

/** Written by `scripts/extract-central-metadata.ts` into the derived store. */
const CENTRAL = ".corpus/central-metadata.json";
/** The blessed map, in the blode-icons checkout beside this one. */
const HOUSE = "packages/blode-icons-react/icons-data/_concepts.json";
const HOUSE_REPO = path.join(process.env.HOME ?? "", "Code/mblode/blode-icons");

/**
 * A read where absence is the normal case.
 *
 * `commands/read.ts` reads loudly — it names the file, the kind wanted and the
 * fix — because a command told to read a file and handed a missing one has been
 * given a wrong argument. Neither file here is an argument: both are optional
 * sidecars, missing in a fresh clone and in CI, and `iconsmith parts` must run
 * without them. `corpus/build.ts:187` has the same helper for the same reason.
 */
const optionalJson = async <T>(file: string): Promise<T | null> => {
  try {
    return JSON.parse(await readFile(file, "utf-8")) as T;
  } catch {
    return null;
  }
};

const add = (
  into: Map<string, string[]>,
  slug: string,
  terms: readonly string[]
): void => {
  const seen = into.get(slug) ?? [];
  for (const raw of terms) {
    const term = raw.trim().toLowerCase();
    if (term && term !== slug && !seen.includes(term)) {
      seen.push(term);
    }
  }
  into.set(slug, seen);
};

export interface AliasSources {
  /** Central's extracted metadata. Default `.corpus/central-metadata.json`.
   *  Independent of the concept list, so it counts toward `independent`. */
  central?: string;
  /** blode's `_concepts.json`. Default the sibling checkout. This is also
   *  where the concept list comes from, so it is deliberately kept out of
   *  `independent` — see the file header. */
  house?: string;
}

/**
 * Load both tables and merge them.
 *
 * Reports what it found rather than only what it built, because an empty table
 * and a table nobody wired up look identical at the call site, and the second
 * one is a bug.
 */
export const loadAliases = async (
  sources: AliasSources = {}
): Promise<{
  aliases: SlugAliases;
  from: string[];
  independent: SlugAliases;
}> => {
  const merged = new Map<string, string[]>();
  const independent = new Map<string, string[]>();
  const from: string[] = [];

  const central = await optionalJson<Record<string, { aliases?: string[] }>>(
    sources.central ?? CENTRAL
  );
  if (central) {
    for (const [slug, record] of Object.entries(central)) {
      add(merged, slug, record.aliases ?? []);
      add(independent, slug, record.aliases ?? []);
    }
    from.push(`central (${Object.keys(central).length} icons)`);
  }

  const house = await optionalJson<{ concepts: Record<string, string> }>(
    sources.house ?? path.join(HOUSE_REPO, HOUSE)
  );
  if (house?.concepts) {
    for (const [concept, slug] of Object.entries(house.concepts)) {
      add(merged, slug, [concept]);
    }
    from.push(`blode-icons (${Object.keys(house.concepts).length} concepts)`);
  }

  // A slug whose only alias was itself is dropped, so `.size` counts icons the
  // table actually widens rather than icons it has a row for.
  for (const table of [merged, independent]) {
    for (const [slug, terms] of table) {
      if (terms.length === 0) {
        table.delete(slug);
      }
    }
  }
  return { aliases: merged, from, independent };
};
