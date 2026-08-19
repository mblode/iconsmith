/**
 * Per-concept reach: how much of what the set is asked for the vocabulary can
 * answer.
 *
 * A concept is "reached" when `rankParts` — the same search the drawer's
 * `listParts` runs — returns at least one part for it. That is the honest
 * definition, because it is literally the query the model makes before it
 * decides whether to place a mark or draw one from scratch.
 *
 * TWO NUMBERS, ALWAYS PRINTED TOGETHER, for the same reason concept coverage
 * has two (`corpus/concepts.ts`). `covered` counts either channel: a curated
 * name, or a token shared with an icon the part was extracted from. `byName`
 * counts the curated names alone. They answer different questions and they are
 * far apart — provenance reaches an order of magnitude more concepts than the
 * names do, so quoting `covered` alone makes naming look finished, and quoting
 * `byName` alone makes the vocabulary look unreachable. Neither is true.
 *
 * `gaps` is the point of the exercise. A concept no part answers is not a bug
 * in the search: `database` returns nothing because the set draws no database,
 * and `academia` because it is a synonym no icon spells. That is inventory, and
 * a backlog is what inventory looks like when somebody writes it down.
 */
import type { Part } from "../types.js";
import { rankParts, tokens } from "./search.js";

export interface PartCoverage {
  /** Concepts a curated name reaches — the channel naming moves. */
  byName: number;
  /** Concepts asked of the set. */
  concepts: number;
  /** Concepts at least one part answers, by name or by provenance. */
  covered: number;
  /** The concepts no part answers, sorted. The backlog. */
  gaps: string[];
}

/**
 * Score every concept against the vocabulary.
 *
 * `byName` is measured on the name channel alone rather than "a named part
 * appeared in the shortlist": a generic mark like `circle` rides along on
 * almost any provenance match, and counting those would report naming as
 * having done work provenance did.
 */
export const partCoverage = (
  parts: readonly Part[],
  concepts: readonly string[]
): PartCoverage => {
  const names = parts
    .filter((p) => p.name !== undefined)
    .map((p) => tokens(p.name ?? ""));
  const gaps: string[] = [];
  let byName = 0;
  for (const concept of concepts) {
    const want = tokens(concept);
    if (names.some((n) => n.some((t) => want.includes(t)))) {
      byName += 1;
    }
    if (rankParts(parts, concept, 1).length === 0) {
      gaps.push(concept);
    }
  }
  return {
    byName,
    concepts: concepts.length,
    covered: concepts.length - gaps.length,
    gaps: gaps.toSorted((a, b) => a.localeCompare(b)),
  };
};
