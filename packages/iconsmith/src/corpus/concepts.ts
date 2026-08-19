/**
 * Concept coverage: one question, one blessed answer — and the backlog of
 * questions the set cannot answer at all.
 *
 * `_concepts.json` maps a UI intent to exactly one slug. It covered 113 of
 * blode's 2,221 icons when this module was written, which is 5.1%, so "which
 * icon do I use for X?" had no answer for nineteen icons in twenty. This module
 * proposes the rest.
 *
 * ## Nothing here writes `_concepts.json`
 *
 * The file's whole value is that a question has one *blessed* answer. A model
 * that fills it silently destroys exactly the property it exists to provide, so
 * everything here returns proposals carrying a `source` — `curated`,
 * `tag-derived`, `lucide-derived`, `inferred` — and a human greps for what was
 * blessed versus guessed. `commands/concepts.ts` writes them to review files
 * and to a `_concepts.proposed.json` that a person copies across.
 *
 * ## The ceiling is 1,588, not 2,221
 *
 * A concept per icon would invent distinctions the set does not make.
 * `airplane`, `airplane-up` and `airplane-down` are one concept with a
 * direction modifier, and `_cohorts.json` already says so. Two groupings are
 * allowed, and only two: a stated cohort of two or more members, and a run of
 * slugs differing by a trailing index. Measured against the store, that leaves
 * **1,588 canonical icons** out of 2,221 — 547 variants, 51 directions and 35
 * states fold into them.
 *
 * A stated cohort is the manifest's word. `cohortOf` falls back to a name
 * prefix when no manifest names an icon, and that fallback is deliberately
 * *not* used here: a prefix is not a swap graph, and the inferred `square`
 * cohort holds 38 icons running from `square-arrow-down` to `square-user`.
 * Collapsing those would answer four questions with one icon, and review cannot
 * recover a concept whose icon never appeared. Splitting one concept in two is
 * the recoverable error, so that is the direction this errs in.
 *
 * ## Third-party sets contribute names and keywords only
 *
 * The gap ranking reads `slug` off third-party records and nothing else, and
 * the Lucide pass reads `tags.json`. No geometry, no path data, no rendering.
 * Those sets are `analysis-only`: they may be measured and counted, and they
 * may not reach the drawer. See `pipeline/licence.ts`.
 */
import type { CohortManifest } from "../tools/cohort.js";

/**
 * What an icon is, relative to the family it sits in.
 *
 * `canonical` is the one icon a concept resolves to. The rest are modifiers on
 * it, split out rather than lumped into one `variant` bucket because the three
 * kinds fail differently in review: a direction is almost always right to fold,
 * a state usually is, and a bare `variant` is the bucket that needs eyes.
 *
 * `filled` never occurs at identity level in this store — `sources.ts` folds
 * `folder-open-filled` into `folder-open`'s renderings — and is kept because a
 * caller measuring an unfolded directory would otherwise mis-file every one of
 * blode's ~1,100 filled files as a `variant`.
 */
export type ConceptRole =
  | "canonical"
  | "direction"
  | "filled"
  | "state"
  | "variant";

/**
 * Where a concept came from, so a reviewer can grep for what was guessed.
 *
 * Ordered by how much a human should trust it: `curated` is already blessed,
 * `tag-derived` is an editor's own word for the icon, `lucide-derived` is a
 * mature set's word for the same drawing, and `inferred` is the slug with its
 * numeric suffix removed — true by construction and uninformative by the same
 * token.
 */
export type ConceptSource =
  | "curated"
  | "inferred"
  | "lucide-derived"
  | "tag-derived";

/** The fields of an `IconRecord` this module reads. Structural rather than the
 *  record type itself, so a caller can propose over a hand-written list without
 *  measuring geometry it does not have. */
export interface ConceptIcon {
  cohort: string | null;
  concepts: string[];
  set: string;
  slug: string;
  tags: string[];
}

export interface RoleAssignment {
  /** The cohort key this icon was filed under, or its own slug when no stated
   *  cohort names it. */
  family: string;
  /** The family's canonical icon. Equal to `slug` when `role` is `canonical`. */
  head: string;
  role: ConceptRole;
  slug: string;
}

export interface ConceptProposal {
  concept: string;
  /** Roughly, how safe this is to bless unread. See `confidenceOf`. */
  confidence: "high" | "low" | "medium";
  role: ConceptRole;
  slug: string;
  source: ConceptSource;
  /** Why this concept, in one line, for the review file. */
  why: string;
}

/** A word that names more than one canonical icon. Surfacing it is the
 *  deliverable: a concept with two answers is precisely what `_concepts.json`
 *  exists to prevent, so it goes to a human rather than being resolved by
 *  whichever icon sorted first. */
export interface ConceptConflict {
  /** Canonical slugs the word maps to, sorted. */
  candidates: string[];
  /** `curated-slug` is the sharpest of the three: an icon is *named* the word,
   *  and a blessed concept already points that word at a different icon. Ten of
   *  blode's 1,588 canonicals are in this state — `back`, `brush`, `call`,
   *  `code`, `expand`, `info`, `location`, `mute`, `user`, `video` — and they
   *  are the whole of the disagreement between the curated file and the set's
   *  own naming. Nothing mechanical should break that tie. */
  kind: "curated-slug" | "lucide-keyword" | "tag";
  word: string;
}

export interface GapEntry {
  name: string;
  /** How many of the seven packs draw a name; the rank. */
  packs: number;
  /** Which ones, sorted. Named so a reviewer can see whether "five packs" is
   *  five independent takes or one set counted through its forks. */
  sets: string[];
}

/**
 * Whether a concept tells a caller something the filename did not.
 *
 * `add-image → add-image` is true by construction and therefore worth nothing:
 * anyone who could type the concept already had the slug. 1,522 of the 3,718
 * proposals the live store yields are of that shape, and counting them is what
 * turns a measured 59.2% coverage into a flattering 99.8%. So the test is on
 * the *entry*, not on its `source`:
 * 63 `inferred` proposals are informative — `basket → basket-1`, `store →
 * store-1` — because stripping a drawing revision yields a word the file
 * system never offered, and 30 `curated` ones are not, because a person once
 * blessed a slug against itself.
 */
export const isInformative = (concept: string, slug: string): boolean =>
  concept !== slug;

export interface ConceptCoverage {
  /** Icons whose role is `canonical` — the denominator. */
  canonical: number;
  /** Canonical icons carrying at least one concept. */
  covered: number;
  /** `covered / canonical`, 4 dp. 1 when there are no canonical icons. */
  coverage: number;
  /** Every icon by role, so the denominator can be audited. */
  roles: Record<ConceptRole, number>;
  /** Canonical icons with no concept, sorted; capped by the caller. */
  uncovered: string[];
}

/** A concept naming two icons. The one thing this file treats as a build
 *  failure rather than a review item. */
export interface ConceptDuplicate {
  concept: string;
  slugs: string[];
}

const TRAILING_INDEX = /-\d+$/u;
const FILLED = /-filled$/u;
const NON_SLUG = /[^a-z0-9]+/gu;

/** Cohort keys the manifest uses to say "this icon is deliberately alone".
 *  A `solo:` cohort is a statement that there is no family, so its member is
 *  its own canonical and not the head of anything. */
const SOLO = "solo:";

/** Tokens that make an icon a direction of its family rather than a concept of
 *  its own. `bottom`/`top` are here beside `down`/`up` because blode uses both
 *  spellings — `chevron-bottom` and `arrow-down` are the same icon rotated. */
const DIRECTIONS = new Set([
  "back",
  "backward",
  "bottom",
  "down",
  "downward",
  "east",
  "forward",
  "horizontal",
  "left",
  "north",
  "right",
  "south",
  "top",
  "up",
  "upward",
  "vertical",
  "west",
]);

/** Tokens that make an icon a state of its family. `off`/`on` and the
 *  slash/mute pair are the ones that actually recur; the rest are here because
 *  they read as states to a reviewer and mis-filing them as `variant` would put
 *  work in the queue that nobody needs to do. */
const STATES = new Set([
  "active",
  "closed",
  "disabled",
  "empty",
  "full",
  "half",
  "inactive",
  "lock",
  "locked",
  "mute",
  "muted",
  "off",
  "on",
  "open",
  "paused",
  "slash",
  "unlock",
  "unlocked",
]);

/** Slug-shape a free-text tag: lowercase, non-alphanumerics to hyphens. Tags
 *  are prose — "credit card", "e-mail" — and a concept key is a slug. */
export const slugifyTag = (tag: string): string =>
  tag.toLowerCase().replace(NON_SLUG, "-").replaceAll(/^-|-$/gu, "");

/** The slug with a trailing `-1`, `-2` … removed. `car-1` and `car-2` are one
 *  question; the number is a drawing revision, not a distinction a caller can
 *  choose between. */
export const unnumbered = (slug: string): string =>
  slug.replace(TRAILING_INDEX, "");

/**
 * The canonical member of a family.
 *
 * Mechanical and reviewable, in the order the ticket states: an existing
 * `_concepts.json` value wins, because a human already blessed it; otherwise
 * the shortest unnumbered name, because the set's own convention is that the
 * plain word is the plain icon and the modifiers hang qualifiers off it; ties
 * broken alphabetically so two runs agree.
 */
export const headOf = (
  members: readonly string[],
  curated: ReadonlySet<string>
): string => {
  const sorted = [...members].toSorted((a, b) => a.localeCompare(b));
  const blessed = sorted.find((m) => curated.has(m));
  if (blessed) {
    return blessed;
  }
  const plain = sorted.filter((m) => !TRAILING_INDEX.test(m));
  const pool = plain.length > 0 ? plain : sorted;
  let [best] = pool;
  for (const m of pool) {
    if (m.length < best.length) {
      best = m;
    }
  }
  return best;
};

/** The role a member plays against its head: the suffix the head does not
 *  have, read token by token. A member that is not an extension of the head's
 *  name at all is a `variant` — `pause` inside the `play` cohort. */
const roleAgainst = (slug: string, head: string): ConceptRole => {
  if (slug === head) {
    return "canonical";
  }
  if (FILLED.test(slug)) {
    return "filled";
  }
  const extra = (
    slug.startsWith(`${head}-`) ? slug.slice(head.length + 1) : slug
  ).split("-");
  if (extra.some((t) => DIRECTIONS.has(t))) {
    return "direction";
  }
  if (extra.some((t) => STATES.has(t))) {
    return "state";
  }
  return "variant";
};

/**
 * File every icon into a family and give it a role.
 *
 * Only manifest cohorts with two or more members form a family. Everything
 * else — a `solo:` cohort, an inferred prefix, a cohort the manifest states
 * with one member — is its own canonical. That is the conservative direction:
 * an inferred prefix that is wrong splits a concept in two, which review
 * merges; a stated cohort that is wrong merges two concepts into one, which
 * review cannot recover because the losing icon never appears.
 */
export const assignRoles = (
  icons: readonly ConceptIcon[],
  manifest: CohortManifest
): RoleAssignment[] => {
  const stated = new Set(
    Object.keys(manifest).filter((k) => !k.startsWith(SOLO))
  );
  const families = new Map<string, string[]>();
  for (const icon of icons) {
    if (icon.cohort !== null && stated.has(icon.cohort)) {
      families.set(icon.cohort, [
        ...(families.get(icon.cohort) ?? []),
        icon.slug,
      ]);
    }
  }
  const curated = new Set(
    icons.filter((i) => i.concepts.length > 0).map((i) => i.slug)
  );
  const heads = new Map<string, string>();
  for (const [key, members] of families) {
    if (members.length > 1) {
      heads.set(key, headOf(members, curated));
    }
  }
  const statedMembers = new Set(
    [...families].flatMap(([, m]) => (m.length > 1 ? m : []))
  );

  // The numbered family: the one grouping safe to make without a manifest.
  // `chart-2` … `chart-8` are eight drawings of a chart, not eight questions,
  // and `_cohorts.json` names none of them. Left ungrouped they are eight
  // canonicals competing for the word `chart`, seven of which lose it and end
  // up with no concept at all — 145 of the 1,744, which is the whole of the gap
  // between 91.7% coverage and complete. The grouping is narrow on purpose: it
  // fires only where slugs differ by a trailing index, which is the set's own
  // spelling for "another go at the same drawing".
  const numbered = new Map<string, string[]>();
  for (const icon of icons) {
    if (statedMembers.has(icon.slug)) {
      continue;
    }
    const stem = unnumbered(icon.slug);
    numbered.set(stem, [...(numbered.get(stem) ?? []), icon.slug]);
  }
  for (const [stem, members] of numbered) {
    if (members.length > 1) {
      heads.set(`#${stem}`, headOf(members, curated));
    }
  }

  return icons
    .map((icon) => {
      const family =
        icon.cohort !== null && heads.has(icon.cohort)
          ? icon.cohort
          : `#${unnumbered(icon.slug)}`;
      const head = heads.get(family);
      if (head === undefined) {
        return {
          family: icon.slug,
          head: icon.slug,
          role: "canonical" as ConceptRole,
          slug: icon.slug,
        };
      }
      return {
        family,
        head,
        role: roleAgainst(icon.slug, head),
        slug: icon.slug,
      };
    })
    .toSorted((a, b) => a.slug.localeCompare(b.slug));
};

/** Coverage against the canonical population, which is the only denominator
 *  that means anything: a direction variant is not supposed to have a concept,
 *  and counting it as uncovered would put the ceiling out of reach by design. */
export const coverageOf = (
  icons: readonly ConceptIcon[],
  roles: readonly RoleAssignment[],
  { sample = 40 }: { sample?: number } = {}
): ConceptCoverage => {
  const conceptsBySlug = new Map(icons.map((i) => [i.slug, i.concepts]));
  const counts: Record<ConceptRole, number> = {
    canonical: 0,
    direction: 0,
    filled: 0,
    state: 0,
    variant: 0,
  };
  const uncovered: string[] = [];
  let canonical = 0;
  let covered = 0;
  for (const r of roles) {
    counts[r.role] += 1;
    if (r.role !== "canonical") {
      continue;
    }
    canonical += 1;
    if ((conceptsBySlug.get(r.slug) ?? []).length > 0) {
      covered += 1;
    } else {
      uncovered.push(r.slug);
    }
  }
  return {
    canonical,
    coverage:
      canonical === 0 ? 1 : Math.round((covered / canonical) * 1e4) / 1e4,
    covered,
    roles: counts,
    uncovered: uncovered
      .toSorted((a, b) => a.localeCompare(b))
      .slice(0, sample),
  };
};

/**
 * The two coverage numbers, which only mean anything side by side.
 *
 * `nominal` counts every concept. `informative` counts only the ones that pass
 * `isInformative`. A caller that reports one without the other is reporting a
 * number that can be moved without doing any work: appending `slug → slug` for
 * every icon takes nominal coverage to 100% and leaves informative coverage
 * exactly where it was. The gap between them is the honest picture, so every
 * function here returns the pair and every renderer prints both.
 */
export interface CoveragePair {
  informative: ConceptCoverage;
  nominal: ConceptCoverage;
}

/** Coverage measured twice over the same roles, once with the tautological
 *  entries stripped. */
export const coveragePair = (
  icons: readonly ConceptIcon[],
  roles: readonly RoleAssignment[],
  options: { sample?: number } = {}
): CoveragePair => ({
  informative: coverageOf(
    icons.map((i) => ({
      ...i,
      concepts: i.concepts.filter((c) => isInformative(c, i.slug)),
    })),
    roles,
    options
  ),
  nominal: coverageOf(icons, roles, options),
});

/** A concept naming two icons, which is the one state `_concepts.json` cannot
 *  be allowed to reach. Note that the file's own shape (concept → slug) makes
 *  this unrepresentable *there*; it becomes possible the moment proposals are
 *  merged, which is why the check lives on the merged map and on the store. */
export const duplicateConcepts = (
  pairs: readonly { concept: string; slug: string }[]
): ConceptDuplicate[] => {
  const bySlug = new Map<string, Set<string>>();
  for (const { concept, slug } of pairs) {
    bySlug.set(concept, (bySlug.get(concept) ?? new Set()).add(slug));
  }
  return [...bySlug]
    .filter(([, slugs]) => slugs.size > 1)
    .map(([concept, slugs]) => ({
      concept,
      slugs: [...slugs].toSorted((a, b) => a.localeCompare(b)),
    }))
    .toSorted((a, b) => a.concept.localeCompare(b.concept));
};

/** A mechanically-derived concept thrown away, and why. Reported rather than
 *  dropped silently: the count is the check on the filter, and a filter nobody
 *  can see is indistinguishable from a bug. */
export interface RejectedProposal {
  concept: string;
  reason: RejectionReason;
  slug: string;
}

export type RejectionReason = "not-a-slug" | "truncated-number";

/** `_concepts.json`'s own key grammar, copied from
 *  `blode-icons-react/scripts/validate-icons-data.mts`. A key must start with a
 *  letter, so `100`, `3-00`, `2g` and `1v1` are not keys that file can hold. */
const CONCEPT_KEY = /^[a-z](?:[a-z0-9-]*[a-z0-9])?$/u;
/** Ends in a digit — checked only on `inferred` concepts, where it means the
 *  stem rule cut a number in half. */
const ENDS_IN_DIGIT = /\d$/u;

/**
 * Whether a derived concept is junk, and which kind.
 *
 * Two classes, both counted against the 2,123 informative concepts the three
 * derived passes propose from the live store, of which 19 are thrown away:
 *
 * - **`not-a-slug` (14 entries).** The target file rejects any key that does
 *   not start with a letter, so proposing one is proposing a file that fails
 *   its own validator. The class is `100 → battery-full`, `50 →
 *   battery-medium`, `3-00`/`9-00` → the clock faces, `360 → panorama-view`,
 *   `1v1 → people-versus`, `3d-scan → spatial-capture`, `8-ball →
 *   fortune-teller-ball`, `720p`/`1080p → hd` and `2g`…`5g` → `signal`. Mostly
 *   these are a tag reading what the drawing *depicts* — a gauge reading, a
 *   clock position — rather than a word a caller types; `1v1` and `3d-scan` are
 *   the two that a person might want, and they need a key spelled differently
 *   before they can exist at all.
 * - **`truncated-number` (5 entries).** `unnumbered("aspect-ratio-16-9")` is
 *   `aspect-ratio-16`. The stem rule reads a trailing number as a drawing
 *   revision, which it is for `basket-1`; in a slug ending in a *pair* of
 *   numbers it is half a ratio, and the result names nothing while reading like
 *   a numbered variant. All five are `aspect-ratio-*`.
 *
 * Both classes are small on purpose. The filter exists so the number this
 * command is asked to raise is not inflated one level down; a filter that threw
 * away hundreds would be a different claim needing different evidence.
 *
 * Tautological entries are never rejected, only ignored. They are not written
 * to `_concepts.json`, so there is nothing to filter, and rejecting one would
 * release its word for a later pass to take — which is the one job those
 * entries do. See the pass-2 comment in `proposeConcepts`.
 */
export const rejectionOf = (
  concept: string,
  slug: string,
  source: ConceptSource
): RejectionReason | null => {
  // `curated` is a person's decision and is never second-guessed here; the
  // filter exists to police mechanical derivation, not the blessed file.
  if (source === "curated" || !isInformative(concept, slug)) {
    return null;
  }
  if (!CONCEPT_KEY.test(concept)) {
    return "not-a-slug";
  }
  if (source === "inferred" && ENDS_IN_DIGIT.test(concept)) {
    return "truncated-number";
  }
  return null;
};

export interface ProposeOptions {
  icons: readonly ConceptIcon[];
  /** `lucide-static/tags.json`: icon name → keywords. Keywords only; this
   *  module never sees a Lucide drawing. */
  lucideTags?: Readonly<Record<string, readonly string[]>>;
  manifest: CohortManifest;
}

export interface ProposalReport {
  conflicts: ConceptConflict[];
  coverage: { after: CoveragePair; before: CoveragePair };
  /** Proposals that would collide with each other or with a curated concept.
   *  Empty by construction — every pass checks the claimed set before adding —
   *  and reported so the claim is checked rather than asserted. */
  duplicates: ConceptDuplicate[];
  proposals: ConceptProposal[];
  /** Derived concepts the junk filter threw away. See `rejectionOf`. */
  rejected: RejectedProposal[];
  roles: RoleAssignment[];
  /** Proposals grouped by source, for the report line. */
  bySource: Record<ConceptSource, number>;
  /** How many proposals are worth something — `bySource` counted through
   *  `isInformative`, so the two lines cannot disagree. */
  informative: number;
}

/** Word → the canonical icons it names. Tags and Lucide keywords are indexed
 *  the same way; the two passes differ only in where the words come from. */
const indexWords = (
  entries: Iterable<readonly [string, Iterable<string>]>
): Map<string, Set<string>> => {
  const index = new Map<string, Set<string>>();
  for (const [slug, words] of entries) {
    for (const raw of words) {
      const word = slugifyTag(raw);
      if (word.length > 0) {
        index.set(word, (index.get(word) ?? new Set()).add(slug));
      }
    }
  }
  return index;
};

/** A word naming one canonical icon becomes a concept; a word naming two goes
 *  to the queue rather than to whichever slug sorted first. A word already
 *  claimed is neither: it has an answer, and re-listing it would pad the queue
 *  with work that is done. */
const resolveWords = (
  index: ReadonlyMap<string, Set<string>>,
  kind: ConceptConflict["kind"],
  isClaimed: (word: string) => boolean,
  take: (word: string, slug: string) => void
): ConceptConflict[] => {
  const conflicts: ConceptConflict[] = [];
  for (const [word, slugs] of index) {
    if (isClaimed(word)) {
      continue;
    }
    if (slugs.size > 1) {
      conflicts.push({
        candidates: [...slugs].toSorted((a, b) => a.localeCompare(b)),
        kind,
        word,
      });
      continue;
    }
    const [slug] = [...slugs];
    take(word, slug);
  }
  return conflicts;
};

const confidenceOf = (source: ConceptSource): ConceptProposal["confidence"] => {
  if (source === "curated") {
    return "high";
  }
  return source === "inferred" ? "medium" : "low";
};

/**
 * The four passes, in trust order, each claiming only words no earlier pass
 * took.
 *
 * 1. **Curated.** Whatever `_concepts.json` already says, carried through so
 *    the later passes cannot take a blessed word for a different icon.
 * 2. **Cohort collapse.** Every canonical gets its own unnumbered slug as a
 *    concept. Mechanical, and the pass that does the volume — but almost all of
 *    that volume is the slug pointing at itself, which takes *nominal* coverage
 *    to 99.8% and informative coverage nowhere. It is a word reservation, not
 *    an answer; see the pass-2 comment in the body.
 * 3. **Tags.** A tag proposes a concept only when it names exactly one
 *    canonical icon. Multi-icon tags go to the conflict queue untouched.
 * 4. **Lucide keywords.** Same rule, over a vocabulary blode mostly does not
 *    share — 1,767 Lucide names carry 13,829 keywords, and only 635 of the
 *    seven packs' names collide with a blode slug at all, so this pass is
 *    where synonyms for things blode draws but has no word for come from.
 *
 * Pass 2 runs before the two synonym passes on purpose. A slug-derived concept
 * is uninformative but certain, and letting a tag claim `folder` for
 * `folder-cloud` before `folder` itself has claimed it would answer the plain
 * question with a qualified icon.
 */
export const proposeConcepts = ({
  icons,
  lucideTags = {},
  manifest,
}: ProposeOptions): ProposalReport => {
  const roles = assignRoles(icons, manifest);
  const before = coveragePair(icons, roles);
  const canonical = new Map(
    roles.filter((r) => r.role === "canonical").map((r) => [r.slug, r])
  );

  const proposals: ConceptProposal[] = [];
  const rejected: RejectedProposal[] = [];
  const claimed = new Map<string, string>();
  const claim = (
    concept: string,
    slug: string,
    source: ConceptSource,
    why: string
  ): void => {
    const role = canonical.get(slug)?.role ?? "variant";
    if (concept.length === 0 || claimed.has(concept)) {
      return;
    }
    const reason = rejectionOf(concept, slug, source);
    if (reason !== null) {
      rejected.push({ concept, reason, slug });
      return;
    }
    claimed.set(concept, slug);
    proposals.push({
      concept,
      confidence: confidenceOf(source),
      role,
      slug,
      source,
      why,
    });
  };

  // 1. Curated.
  for (const icon of icons) {
    for (const concept of icon.concepts) {
      claim(concept, icon.slug, "curated", "already in _concepts.json");
    }
  }

  // 2. Cohort collapse: the canonical answers under its own name.
  //
  // 1,487 of these are the slug pointing at itself, and they are kept for one
  // reason: they *reserve* the word. Without the reservation, pass 3 would let
  // `folder-cloud`'s "folder" tag answer "which icon for a folder?" with a
  // folder-in-the-cloud, and pass 4 would do the same with Lucide's keywords.
  // That is their whole job, and it is done by the time this function returns —
  // so they are never written to `_concepts.json` and never counted as
  // informative coverage. The 63 that *are* informative (`basket → basket-1`)
  // earn their place by naming something the file system does not.
  //
  // The stem falls back to the full slug when another icon already holds it —
  // `call` loses `call` to the curated concept pointing at `phone` — because a
  // canonical with no concept at all is worse than one with a clumsy name. The
  // slug is unique in the set, so this branch always succeeds and coverage is
  // complete by construction rather than by luck.
  for (const [slug, r] of canonical) {
    const stem = unnumbered(slug);
    const why =
      r.family === slug
        ? "no stated cohort; the icon is its own canonical"
        : `canonical of family "${r.family}"`;
    // A rejected stem falls back to the slug for the same reason a taken one
    // does: the reservation still has to happen, or a tag would claim
    // `aspect-ratio-16` for something else. The rejection is recorded here
    // rather than inside `claim`, which never sees the stem.
    const reason = rejectionOf(stem, slug, "inferred");
    if (reason !== null) {
      rejected.push({ concept: stem, reason, slug });
    }
    claim(
      claimed.has(stem) || reason !== null ? slug : stem,
      slug,
      "inferred",
      why
    );
  }

  const conflicts: ConceptConflict[] = [];
  for (const [slug] of canonical) {
    const holder = claimed.get(slug);
    if (holder !== undefined && holder !== slug) {
      conflicts.push({
        candidates: [holder, slug].toSorted((a, b) => a.localeCompare(b)),
        kind: "curated-slug",
        word: slug,
      });
    }
  }

  // 3. Tags, one canonical each.
  const tagConflicts = resolveWords(
    indexWords(
      icons
        .filter((i) => canonical.has(i.slug))
        .map((i) => [i.slug, i.tags] as const)
    ),
    "tag",
    (word) => claimed.has(word),
    (word, slug) => {
      claim(word, slug, "tag-derived", `sole icon tagged "${word}"`);
    }
  );

  // 4. Lucide keywords, which transfer only where Lucide and blode name the
  //    same drawing and the keyword names one canonical here.
  const lucideConflicts = resolveWords(
    indexWords(
      Object.entries(lucideTags).flatMap(([name, keywords]) => {
        const hit = canonical.get(name) ?? canonical.get(unnumbered(name));
        return hit ? [[hit.slug, keywords] as const] : [];
      })
    ),
    "lucide-keyword",
    (word) => claimed.has(word),
    (word, slug) => {
      claim(word, slug, "lucide-derived", `Lucide keyword for "${slug}"`);
    }
  );
  conflicts.push(...tagConflicts, ...lucideConflicts);

  const conceptsBySlug = new Map<string, string[]>();
  for (const p of proposals) {
    conceptsBySlug.set(p.slug, [
      ...(conceptsBySlug.get(p.slug) ?? []),
      p.concept,
    ]);
  }
  const after = coveragePair(
    icons.map((i) => ({ ...i, concepts: conceptsBySlug.get(i.slug) ?? [] })),
    roles
  );

  const bySource: Record<ConceptSource, number> = {
    curated: 0,
    inferred: 0,
    "lucide-derived": 0,
    "tag-derived": 0,
  };
  for (const p of proposals) {
    bySource[p.source] += 1;
  }

  return {
    bySource,
    conflicts: conflicts.toSorted((a, b) => a.word.localeCompare(b.word)),
    coverage: { after, before },
    duplicates: duplicateConcepts(proposals),
    informative: proposals.filter((p) => isInformative(p.concept, p.slug))
      .length,
    proposals: proposals.toSorted((a, b) => a.concept.localeCompare(b.concept)),
    rejected: rejected.toSorted((a, b) => a.concept.localeCompare(b.concept)),
    roles,
  };
};

/**
 * Every word the house set can already be asked for.
 *
 * A raw slug comparison is the wrong test and produces a confidently wrong
 * backlog: it reports `calendar`, `camera`, `folder`, `plus` and `trash` as
 * things blode does not draw, when blode draws all five under `calendar-1`,
 * `camera-1`, `folder-1`, `plus-medium` and `trash-1`. Against slugs alone the
 * head of the ranking is 145 names at 4+ packs, and it is mostly this artefact.
 * Against slugs, unnumbered slugs, concepts and slugified tags — 5,085 words —
 * it is 62, and those 62 are real.
 */
export const houseVocabulary = (icons: readonly ConceptIcon[]): Set<string> => {
  const vocab = new Set<string>();
  for (const icon of icons) {
    vocab.add(icon.slug);
    vocab.add(unnumbered(icon.slug));
    for (const concept of icon.concepts) {
      vocab.add(concept);
    }
    for (const tag of icon.tags) {
      const word = slugifyTag(tag);
      if (word.length > 0) {
        vocab.add(word);
      }
    }
  }
  return vocab;
};

export interface GapOptions {
  /** Minimum packs that must draw a name before it is worth a ticket. 1 lists
   *  everything, which is 8,000 names and not a backlog. */
  minPacks?: number;
  /** The `analysis-only` sets to count. `lucide-static` is excluded by the
   *  caller: it is the same drawings as `lucide` at a different version, and
   *  counting both would give every Lucide name a free second vote. */
  names: readonly { set: string; slug: string }[];
  vocabulary: ReadonlySet<string>;
}

/**
 * The generation backlog: names mature sets draw that this one has no word for,
 * ranked by how many packs draw each.
 *
 * Names only. Nothing here opens an SVG, and the input is `{set, slug}` pairs
 * precisely so that it cannot: the shape carries no path data to read.
 */
export const rankGaps = ({
  minPacks = 3,
  names,
  vocabulary,
}: GapOptions): GapEntry[] => {
  const packs = new Map<string, Set<string>>();
  for (const { set, slug } of names) {
    packs.set(slug, (packs.get(slug) ?? new Set()).add(set));
  }
  return [...packs]
    .filter(([name, sets]) => sets.size >= minPacks && !vocabulary.has(name))
    .map(([name, sets]) => ({
      name,
      packs: sets.size,
      sets: [...sets].toSorted((a, b) => a.localeCompare(b)),
    }))
    .toSorted((a, b) => b.packs - a.packs || a.name.localeCompare(b.name));
};
