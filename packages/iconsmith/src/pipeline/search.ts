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
 */
export const rankParts = (
  parts: readonly Part[],
  query: string,
  limit = DEFAULT_SHORTLIST
): PartMatch[] => {
  const want = tokens(query);
  if (want.length === 0) {
    return [];
  }
  return parts
    .map((part) => {
      const hits = part.icons.filter((icon) => overlap(tokens(icon), want) > 0);
      return {
        hits,
        part,
        score:
          overlap(tokens(part.name ?? part.id), want) * 10 +
          hits.length +
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
  limit = DEFAULT_SHORTLIST
): PartHint[] =>
  rankParts(parts, query, limit).map(({ hits, part }) => ({
    id: part.id,
    name: part.name ?? null,
    seenIn: hits.slice(0, 5),
    usedByIcons: part.icons.length,
  }));
