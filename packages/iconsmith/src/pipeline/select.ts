/**
 * SELECT as a policy, not as luck.
 *
 * The harness used to search once, stuff the same shortlist into every brief,
 * and draw N times. That estimates the noise of one hill. If the shortlist is
 * the wrong object — `brain` for `database`, `sparkle` for `git` — five samples
 * are five copies of the mistake, and cosine then climbs the silhouette of
 * that mistake. Independent N is A/B of drawings. This module is A/B of
 * *searches*, which is what actually generates the icon: the program is a
 * handful of `part` ops chosen from whatever SELECT put in front of the model.
 *
 * Five named policies, one per typical best-of-N slot. They are islands, not
 * seeds: each withholds a different slice of the ranking so a later pick()
 * compares systems rather than five rolls of one system.
 */
import type { Part } from "../types.js";
import type { Concept } from "./prompt.js";
import type { Aliases, PartHint } from "./search.js";
import { DEFAULT_SHORTLIST, searchParts } from "./search.js";

const SELECT_KINDS = ["slug", "tagged", "exact", "contrast", "empty"] as const;

export type SelectKind = (typeof SELECT_KINDS)[number] | "auto";

export interface SelectIsland {
  hints: PartHint[];
  kind: SelectKind;
}

/** A hit that is about this concept, not about a tag it shares with a
 *  different icon. `branch` and `git` otherwise flood the shortlist with
 *  `code-tree` and `sparkle`; `database` as a name currently ranks `brain`
 *  parts via aliases. */
export const aboutConcept = (h: PartHint, name: string): boolean =>
  h.seenIn.some(
    (icon) =>
      icon === name || icon.startsWith(`${name}-`) || icon.includes(name)
  ) || h.name === name;

const queryOf = (concept: Concept): string =>
  `${concept.name} ${concept.tags?.join(" ") ?? ""} ${concept.category ?? ""}`;

const exactHints = (
  parts: readonly Part[],
  concept: Concept,
  aliases: Aliases
): PartHint[] =>
  searchParts(parts, concept.name, DEFAULT_SHORTLIST, aliases).filter((h) =>
    h.seenIn.includes(concept.name)
  );

/** The provenance family tagged search leans on. Withholding it is how an
 *  island escapes that hill — `database` otherwise always sees `server`. */
const dominantSeen = (hints: readonly PartHint[]): string | null => {
  const freq = new Map<string, number>();
  for (const h of hints) {
    for (const icon of h.seenIn) {
      const family = icon.replace(/-\d+$/u, "");
      freq.set(family, (freq.get(family) ?? 0) + 1);
    }
  }
  return [...freq].toSorted((a, b) => b[1] - a[1])[0]?.[0] ?? null;
};

const contrastHints = (tagged: readonly PartHint[]): PartHint[] => {
  const dominant = dominantSeen(tagged);
  if (!dominant) {
    return [];
  }
  return tagged.filter(
    (h) => !h.seenIn.some((icon) => icon.replace(/-\d+$/u, "") === dominant)
  );
};

const slugHints = (
  parts: readonly Part[],
  concept: Concept,
  aliases: Aliases
): PartHint[] =>
  searchParts(parts, concept.name, DEFAULT_SHORTLIST, aliases).filter((h) =>
    aboutConcept(h, concept.name)
  );

const taggedHints = (
  parts: readonly Part[],
  concept: Concept,
  aliases: Aliases
): PartHint[] => {
  const tags = concept.tags ?? [];
  return searchParts(
    parts,
    queryOf(concept),
    DEFAULT_SHORTLIST,
    aliases
  ).filter((h) =>
    tags.some((tag) => h.seenIn.some((icon) => icon.includes(tag)))
  );
};

/** What one policy puts in the brief. */
export const selectHints = (
  kind: SelectKind,
  concept: Concept,
  parts: readonly Part[],
  aliases: Aliases
): PartHint[] => {
  const slug = slugHints(parts, concept, aliases);
  const tagged = taggedHints(parts, concept, aliases);
  switch (kind) {
    case "auto": {
      // The hill we already live on: slug if anything is about the concept,
      // otherwise the tag fallback that used to be silent. Named as a policy
      // so N=1 still screens the current system rather than a new one.
      return (slug.length > 0 ? slug : tagged).slice(0, DEFAULT_SHORTLIST);
    }
    case "slug": {
      return slug.slice(0, DEFAULT_SHORTLIST);
    }
    case "tagged": {
      return tagged.slice(0, DEFAULT_SHORTLIST);
    }
    case "exact": {
      return exactHints(parts, concept, aliases).slice(0, DEFAULT_SHORTLIST);
    }
    case "contrast": {
      return contrastHints(tagged).slice(0, DEFAULT_SHORTLIST);
    }
    case "empty": {
      return [];
    }
    default: {
      throw new Error(`unknown select kind "${kind}"`);
    }
  }
};

/** Named parts always ship, so `part folder` still resolves on an empty island.
 *  Search hits join them so an unnamed cylinder the query found is addressable. */
export const assembleAddressable = (
  parts: readonly Part[],
  hints: readonly PartHint[]
): Part[] => {
  const byId = new Map(parts.map((p) => [p.id, p]));
  const seen = new Set<string>();
  const addressable: Part[] = [];
  for (const p of [
    ...hints.map((h) => byId.get(h.id)),
    ...parts.filter((part) => part.name),
  ]) {
    if (p && !seen.has(p.id)) {
      seen.add(p.id);
      addressable.push(p);
    }
  }
  return addressable;
};

export const assembleVocabulary = (
  concept: Concept,
  parts: readonly Part[],
  aliases: Aliases,
  kind: SelectKind = "auto"
): { addressable: Part[]; hints: PartHint[] } => {
  const hints = selectHints(kind, concept, parts, aliases);
  return { addressable: assembleAddressable(parts, hints), hints };
};

/** N islands, cycling the named policies. N=5 is one of each; N=1 is the
 *  screen, which stays on `slug` so a smoke run still tests the current hill. */
export const islands = (
  concept: Concept,
  parts: readonly Part[],
  aliases: Aliases,
  n: number
): SelectIsland[] => {
  const kinds = n <= 1 ? (["auto"] as const) : SELECT_KINDS;
  return Array.from({ length: n }, (_, i) => {
    const kind = kinds[i % kinds.length] ?? "slug";
    return { hints: selectHints(kind, concept, parts, aliases), kind };
  });
};

/** One minus the mean pairwise Jaccard over hint ids: 0 means every island
 *  offered the same marks — N independent draws would have been the same
 *  experiment N times — and 1 means they shared none. */
export const hintDiversity = (plans: readonly SelectIsland[]): number => {
  if (plans.length < 2) {
    return 0;
  }
  const sets = plans.map((p) => new Set(p.hints.map((h) => h.id)));
  let pair = 0;
  let jaccard = 0;
  for (let i = 0; i < sets.length; i += 1) {
    for (let j = i + 1; j < sets.length; j += 1) {
      const a = sets[i];
      const b = sets[j];
      if (!(a && b)) {
        continue;
      }
      const union = new Set([...a, ...b]);
      if (union.size === 0) {
        continue;
      }
      const inter = [...a].filter((id) => b.has(id)).length;
      jaccard += inter / union.size;
      pair += 1;
    }
  }
  return pair === 0 ? 0 : 1 - jaccard / pair;
};
