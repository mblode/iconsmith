/**
 * The fourteen icons an image model is shown before it proposes anything.
 *
 * An image model asked for "a calendar icon" returns the internet's median
 * calendar. Asked for one *beside fourteen icons from this set*, it returns
 * something much closer to the set's idiom — which is the only part of its
 * output this pipeline keeps, since the drawing itself is thrown away by
 * `compose.ts` and only the composition survives.
 *
 * The fourteen are three kinds, and the split is the point:
 *
 * - **Four style anchors**, chosen to span the *idiom*, not the concept: a
 *   container, a circular form, a bare stroke, a dense detail piece. They are
 *   there to fix stroke weight, corner feel and density, and a concept-nearest
 *   set does that badly — five calendars agree about everything except what a
 *   calendar is.
 * - **Up to six concept-nearest**, scored by the same function `compare` uses
 *   in `tools.ts`. Not a second scorer: two notions of "nearest" in one
 *   pipeline means the proposal is conditioned on one neighbourhood and judged
 *   against another, and contradictory evidence is worse than less evidence.
 * - **Up to four cohort siblings**, by `cohortOf` — the icons this one will
 *   swap with in place. They carry the family's box, which is the thing a
 *   proposal is most likely to get wrong and the drawer's `cohort` op is least
 *   able to fix afterwards.
 *
 * Two constraints hold this file honest. It takes `Reference[]` — the branded
 * type whose sole constructor is `asReference` — so the eval's leak filter and
 * the licence gate both apply here without this module knowing either exists.
 * And it never reads disk: there is no path by which an icon that was not
 * already handed in can reach an image model.
 */
import { cohortOf } from "../tools/cohort.js";
import type { CohortManifest } from "../tools/cohort.js";
import type { Reference } from "./licence.js";
import { nearest } from "./tools.js";

/** Four axes of the idiom, each as candidate names in preference order. The
 *  first name present in the corpus wins its axis; an axis that matches
 *  nothing falls through to the spread below.
 *
 *  Names, not a measurement, because "spans the idiom" is a design judgement:
 *  a container with a tiered radius, a circle with interior marks, a bare
 *  stroke run with terminals and a diagonal, and something dense enough to
 *  show how small detail is handled. */
const ANCHOR_AXES: readonly (readonly string[])[] = [
  ["folder-1", "folder", "briefcase", "archive"],
  ["clock", "clock-1", "compass", "timer"],
  ["arrow-up-right", "arrow-right", "share", "arrow-up"],
  ["calendar-1", "calendar", "dot-grid-3x3", "grid"],
];

const ANCHORS = 4;
const CONCEPT = 6;
const SIBLINGS = 4;
export interface ReferenceOptions {
  /** The icon being proposed, for the nearest and sibling slots. */
  concept: string;
  /** Cohort manifest, when one is loaded; `cohortOf` infers without it. */
  manifest?: CohortManifest;
  /** Synonyms, scored alongside the name — the same input `compare` takes. */
  tags?: string[];
}

/** The three kinds, kept apart so a caller can say what each one is for, plus
 *  the flat sheet in the order they are shown. */
export interface ReferenceSlots {
  all: Reference[];
  anchors: Reference[];
  concept: Reference[];
  siblings: Reference[];
}

/**
 * Style anchors: four icons that span the idiom.
 *
 * The fallback is a deterministic spread over the corpus in name order rather
 * than a random draw, so two runs of the same benchmark are conditioned on the
 * same anchors. A shifting anchor set would put a second uncontrolled variable
 * into an A/B whose whole purpose is to isolate one.
 */
const anchorsOf = (corpus: Reference[]): Reference[] => {
  const byName = new Map(corpus.map((r) => [r.name, r]));
  const picked: Reference[] = [];
  const taken = new Set<string>();
  for (const axis of ANCHOR_AXES) {
    for (const name of axis) {
      const hit = byName.get(name);
      if (hit && !taken.has(hit.name)) {
        picked.push(hit);
        taken.add(hit.name);
        break;
      }
    }
  }
  if (picked.length === ANCHORS) {
    return picked;
  }
  const sorted = corpus.toSorted((a, b) => a.name.localeCompare(b.name));
  for (let i = 0; i < ANCHORS && picked.length < ANCHORS; i += 1) {
    const at = sorted[Math.floor((i / ANCHORS) * sorted.length)];
    if (at && !taken.has(at.name)) {
      picked.push(at);
      taken.add(at.name);
    }
  }
  return picked;
};

/** The fourteen, deduplicated across the three kinds: an icon that is both the
 *  nearest concept and a cohort sibling is shown once and counted once. */
export const referenceSet = (
  corpus: readonly Reference[],
  { concept, manifest, tags }: ReferenceOptions
): ReferenceSlots => {
  const pool = corpus.filter((r) => r.name !== concept);
  const taken = new Set<string>();
  const keep = (list: Reference[], limit: number): Reference[] => {
    const out: Reference[] = [];
    for (const r of list) {
      if (out.length >= limit) {
        break;
      }
      if (taken.has(r.name)) {
        continue;
      }
      taken.add(r.name);
      out.push(r);
    }
    return out;
  };

  const anchors = keep(anchorsOf([...pool]), ANCHORS);
  const conceptNear = keep(
    nearest(pool, `${concept} ${tags?.join(" ") ?? ""}`, CONCEPT),
    CONCEPT
  );
  const family = cohortOf(concept, manifest);
  const siblings = keep(
    pool.filter((r) => cohortOf(r.name, manifest) === family),
    SIBLINGS
  );

  return {
    all: [...anchors, ...conceptNear, ...siblings],
    anchors,
    concept: conceptNear,
    siblings,
  };
};
