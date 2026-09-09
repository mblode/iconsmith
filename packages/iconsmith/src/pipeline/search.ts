/**
 * The one vocabulary search.
 *
 * Three callers ask the same question of the parts list — the drawer's
 * `listParts` tool, SELECT's shortlist in `route.ts`, and the coverage report in
 * `coverage.ts` — and they have to ask it the same way. Two rankings would mean
 * SELECT shortlists by one notion of relevance and the model searches by
 * another, and the disagreement would read as a route being worse when it is
 * only being asked a different question; a coverage number measured against a
 * third would report reach the drawer does not have.
 *
 * `route.ts` used to restate `listParts`' scoring with a note saying it was
 * "worth folding together the next time that file is open". This is that fold.
 * It lives in its own module rather than in `tools.ts` because `route.ts`
 * already imports `generate.ts`, which imports `tools.ts` — importing it back
 * would be a cycle.
 */
import type { Part } from "../types.js";

/** Words a part or icon name is searched by. `arrow-up-2` → arrow, up, 2. */
export const tokens = (s: string): string[] =>
  s
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter(Boolean);

export const overlap = (a: string[], b: string[]): number => {
  const set = new Set(b);
  return a.filter((t) => set.has(t)).length;
};

/**
 * Slug → the words it also answers to, from `corpus/aliases.ts`.
 *
 * Restated here as a bare `ReadonlyMap` rather than imported, so that
 * `pipeline/` does not depend on `corpus/`. The layering DAG in
 * `scripts/check-boundaries.ts` runs `geometry ← parts ← tools ← pipeline ←
 * commands`; `corpus/` is not in it, which makes an import from here legal to
 * the checker and wrong to the design. `commands/` loads the table and passes
 * it down, which is the direction the arrows already point.
 */
export type Aliases = ReadonlyMap<string, readonly string[]>;

/**
 * What an alias hit is worth against a slug hit, which is worth 1.
 *
 * Below a slug because it is one inference further from the shape: the set says
 * this *icon* means "open link", and the part is a piece of that icon, so the
 * piece may or may not be the part that means it. Above zero because the whole
 * point is that a word nobody put in a filename still has to reach the drawing.
 *
 * A half was picked before the coverage number was measured, on that reasoning
 * alone, so that the number is a test of the choice rather than a description
 * of it.
 */
const ALIAS_WEIGHT = 0.5;

/** Marks named per shortlist. Enough that a concept drawn from several parts
 *  finds all of them, few enough that the shortlist is a shortlist. */
export const DEFAULT_SHORTLIST = 24;

/**
 * A part the vocabulary search turned up.
 *
 * No `w`/`h`. `listParts` reports them because a model deciding whether to
 * place a mark wants its proportions; a shortlist carried *into* a run is a set
 * of things to look up, and a size on it is a size the shortlist is suggesting
 * be drawn at. See `route.ts`'s file header.
 */
export interface PartHint {
  readonly id: string;
  readonly name: string | null;
  /** Icons the part was extracted from — why it matched, and the only useful
   *  thing to say about a part carrying no name. */
  readonly seenIn: readonly string[];
  readonly usedByIcons: number;
}

/** A ranked match, before a caller shapes it into whatever it reports. */
export interface PartMatch {
  /** The part's source icons that matched the query. */
  readonly hits: readonly string[];
  readonly part: Part;
}

/**
 * Rank the part vocabulary against a query.
 *
 * A name is a deliberate label and outranks provenance by an order of
 * magnitude; among the unnamed, more matching source icons ranks higher, and a
 * part used by few icons that all match beats one used by a hundred where three
 * do.
 *
 * A part is searchable by the icons it was extracted from, not only by a
 * curated name. Naming is expensive and lags: of 1,106 parts in the house
 * vocabulary 91 carry one, so most of the shapes would otherwise be unreachable
 * — a search for "database" would find nothing while the cylinder it wanted sat
 * in the set, unnamed. The provenance is free and already recorded, so it is
 * what the query runs against as well.
 *
 * `aliases` widens that provenance from the icon's filename to the words its
 * set says it means. It is the third rung of the same ladder and is weighted
 * accordingly: a curated **name** is a deliberate label about this shape and
 * scores 10; a matching source **slug** is provenance and scores 1; a matching
 * **alias** is somebody's synonym for an icon this shape appeared in, one
 * inference further out, and scores below a slug without scoring zero. It never
 * promotes a part above one the slug itself answered, which is what keeps a
 * query for `folder` returning the folder before the thing tagged "folder".
 *
 * Empty by default, so a caller that has not been wired up gets exactly the old
 * ranking and the difference between the two is attributable to this argument.
 */
export const rankParts = (
  parts: readonly Part[],
  query: string,
  limit = DEFAULT_SHORTLIST,
  aliases: Aliases = new Map()
): PartMatch[] => {
  const want = tokens(query);
  if (want.length === 0) {
    return [];
  }
  return parts
    .filter((part) => !part.sourceAssemblyOnly)
    .map((part) => {
      const direct = part.icons.filter(
        (icon) => overlap(tokens(icon), want) > 0
      );
      // Only icons the slug did not already answer. An icon matched both ways
      // is one match, not two, or a part whose provenance is rich in a word
      // would be counted twice for the same evidence.
      const byAlias = part.icons.filter(
        (icon) =>
          !direct.includes(icon) &&
          overlap(tokens((aliases.get(icon) ?? []).join(" ")), want) > 0
      );
      const hits = [...direct, ...byAlias];
      return {
        hits,
        part,
        score:
          overlap(tokens(part.name ?? part.id), want) * 10 +
          direct.length +
          byAlias.length * ALIAS_WEIGHT +
          hits.length / Math.max(1, part.icons.length),
      };
    })
    .filter((s) => s.score > 0)
    .toSorted(
      (a, b) => b.score - a.score || b.part.icons.length - a.part.icons.length
    )
    .slice(0, limit)
    .map(({ hits, part }) => ({ hits, part }));
};

/** `rankParts` as a shortlist: the fields a stage carries between stages. */
export const searchParts = (
  parts: readonly Part[],
  query: string,
  limit = DEFAULT_SHORTLIST,
  aliases: Aliases = new Map()
): PartHint[] =>
  rankParts(parts, query, limit, aliases).map(({ hits, part }) => ({
    id: part.id,
    name: part.name ?? null,
    seenIn: hits.slice(0, 5),
    usedByIcons: part.icons.length,
  }));
