import { readFileSync } from "node:fs";

import { asReferences, bbox, nameParts, parseIconSvg, parsePath, serialise } from "iconsmith";
import type { Concept, Part, Provenance, Reference } from "iconsmith";

import houseIconsJson from "./house-icons.json" with { type: "json" };

/**
 * Licensed house drawings, snapshotted from `blode-icons-react` so Studio does
 * not readdir `node_modules` at request time. Eve's Vercel service cwd is not
 * the Next app root; walking from there threw "house library could not be
 * found" before a single paint ran. Re-run `node scripts/house-data.mjs` after
 * bumping the package.
 */
const houseIcons: Record<string, string> = houseIconsJson;

/**
 * An eval-only widening of the one slug `selectedSlugs` already withholds.
 *
 * `pipeline/bench.ts` holds out a **concept closure** — the slug, its cohort in
 * both styles, its Central finishes, its filled twin — because a name-exact
 * holdout withholds nothing: "Excluding the string `folder-open` while leaving
 * eleven folders in the corpus withholds the label and hands over the answer."
 * This file withholds one slug, so a benchmark entry whose closure names
 * nineteen leaves eighteen eligible to be shown to the drawer. Measured over
 * the sealed split by `scripts/eve-contamination.ts`: 434 of 1,499 selected
 * references, 29.0%.
 *
 * That is correct for the product — a request for `folder-open` should still
 * see the other folders, which is how the set stays one set — and wrong for a
 * measurement, where those eighteen are the answer. So the widening is opt-in
 * and lives here rather than in the request: `StudioRequest` is copied by the
 * model under test, and a holdout the model can drop is not a holdout.
 *
 * Unset (the default, and every deployment) leaves `selectedSlugs` byte for
 * byte what it was, because the as-shipped arm of an eval has to be the
 * shipped thing rather than a reconstruction of it.
 *
 *     ICONSMITH_EVAL_HOLDOUT=/abs/path/holdout.json
 *     { "emoji-wink": ["emoji-wink-tongue", "emoji-wink-tongue-filled"], ... }
 */
const holdout = ((): ReadonlyMap<string, ReadonlySet<string>> => {
  const file = process.env.ICONSMITH_EVAL_HOLDOUT;
  if (!file) {
    return new Map();
  }
  // Deliberately not caught. A holdout file that was asked for and could not be
  // read must stop the run: the alternative is a measurement that silently
  // becomes the contaminated one it was built to be compared against.
  const raw = JSON.parse(readFileSync(file, "utf-8")) as Record<string, string[]>;
  return new Map(Object.entries(raw).map(([name, slugs]) => [name, new Set(slugs)]));
})();

const HOUSE_PROVENANCE: Provenance = {
  date: "2026-08-23",
  licenses: ["MIT"],
  origin: "original",
  set: "blode-icons",
};

const STYLE_ANCHORS = ["folder-1", "clock", "arrow-up-right", "calendar-1"] as const;
const MAX_LIBRARY_ICONS = 36;
const MAX_PARTS = 96;
const MAX_PARTS_PER_ICON = 8;

const words = (value: string): string[] =>
  value
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter(Boolean);

const scoreName = (slug: string, concept: Concept): number => {
  const base = slug.replace(/-filled$/u, "");
  const query = new Set(words(`${concept.name} ${concept.tags?.join(" ") ?? ""}`));
  const overlap = words(base).filter((word) => query.has(word)).length;
  return (
    (base === concept.name ? 100 : 0) +
    (base.startsWith(`${concept.name}-`) ? 40 : 0) +
    (base.includes(concept.name) ? 20 : 0) +
    overlap * 10 -
    (slug.endsWith("-filled") ? 1 : 0)
  );
};

const selectedSlugs = (concept: Concept): string[] => {
  const withheld = holdout.get(concept.name);
  const slugs = new Set(Object.keys(houseIcons));
  const ranked = [...slugs]
    .map((slug) => ({ score: scoreName(slug, concept), slug }))
    // The current answer is the thing the tournament is trying to beat. Do not
    // condition a fresh candidate or image proposal on the rejected geometry.
    .filter((row) => row.slug.replace(/-filled$/u, "") !== concept.name)
    // Empty unless an eval asked for it. `libraryCandidates` in
    // `lib/studio/generate.ts` filters the references this returns, so a slug
    // withheld here cannot enter the tournament as a `library-*` arm either —
    // both leakage channels close at this one line.
    .filter((row) => !withheld?.has(row.slug))
    .filter((row) => row.score > 0)
    .toSorted((a, b) => b.score - a.score || a.slug.localeCompare(b.slug))
    .slice(0, MAX_LIBRARY_ICONS)
    .map((row) => row.slug);
  return [...new Set([...STYLE_ANCHORS.filter((slug) => slugs.has(slug)), ...ranked])];
};

const loadReferences = (concept: Concept): Reference[] => {
  const icons = selectedSlugs(concept).flatMap((slug) => {
    const svg = houseIcons[slug];
    return svg ? [{ name: slug, svg, tags: words(slug) }] : [];
  });
  return asReferences(icons, HOUSE_PROVENANCE);
};

const partsFrom = (references: readonly Reference[]): Part[] => {
  const parts: Part[] = [];
  for (const reference of references) {
    if (reference.name.endsWith("-filled")) {
      continue;
    }
    let index = 0;
    try {
      for (const shape of parseIconSvg(reference.svg)) {
        if (index >= MAX_PARTS_PER_ICON) {
          break;
        }
        for (const subpath of parsePath(shape.d)) {
          if (index >= MAX_PARTS_PER_ICON) {
            break;
          }
          const box = bbox([subpath]);
          const w = box.x1 - box.x0;
          const h = box.y1 - box.y0;
          const size = Math.max(w, h);
          if (size < 1.2 || parts.length >= MAX_PARTS) {
            continue;
          }
          index += 1;
          parts.push({
            closed: subpath.closed,
            d: serialise([subpath]),
            flips: [1, 0],
            h,
            icons: [reference.name],
            id: `${reference.name}-${index}`,
            instances: 1,
            name: `${reference.name}-${index}`,
            nodes: subpath.segs.length,
            sizeRange: [size, size],
            turns: [1, 0, 0, 0],
            w,
          });
        }
      }
    } catch {
      // One exotic brand path must not remove the ordinary house vocabulary.
    }
  }
  return parts;
};

export interface StudioArsenal {
  parts: Part[];
  references: Reference[];
}

const cache = new Map<string, Promise<StudioArsenal>>();

export const loadStudioArsenal = (concept: Concept): Promise<StudioArsenal> => {
  const key = `${concept.name}\0${concept.tags?.join("\0") ?? ""}`;
  const existing = cache.get(key);
  if (existing) {
    return existing;
  }
  const references = loadReferences(concept);
  /**
   * Name the extraction against the curated vocabulary before handing it over.
   *
   * Without this the drawer is offered 96 parts called `folder-1-1`, `clock-2`,
   * `rewrite-2-3` — every one named for the file it was sliced out of. Nothing
   * can reason about `rewrite-2-3`; `listParts("pencil")` matches none of them,
   * so the model composes a pencil out of `rect` and `line` instead of placing
   * one. Measured before this line existed: zero `part` ops on seven of eight
   * paints in a tournament, which then failed `houseDerived` and was rejected
   * on provenance before its quality was ever read.
   *
   * `nameParts` matches by SHAPE rather than by id — each vocabulary entry is
   * fingerprinted and paired with its nearest part under `NAME_THRESHOLD`,
   * best pair first, each name claimed once. That is what makes the vocabulary
   * survive re-extraction, and it is the step `packages/iconsmith` has always
   * run and this file never did. `dsl.ts` states the reason plainly: "Nothing
   * can reason about `p0031`; everything can reason about `cloud`."
   *
   * A part the vocabulary does not recognise keeps its provenance name, which
   * `searchParts` still reaches through the icons it was extracted from.
   */
  const loading = Promise.resolve({
    parts: nameParts(partsFrom(references)),
    references,
  });
  cache.set(key, loading);
  return loading;
};
