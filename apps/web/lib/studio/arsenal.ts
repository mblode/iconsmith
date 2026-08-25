import { asReferences, bbox, parseIconSvg, parsePath, serialise } from "iconsmith";
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
  const slugs = new Set(Object.keys(houseIcons));
  const ranked = [...slugs]
    .map((slug) => ({ score: scoreName(slug, concept), slug }))
    // The current answer is the thing the tournament is trying to beat. Do not
    // condition a fresh candidate or image proposal on the rejected geometry.
    .filter((row) => row.slug.replace(/-filled$/u, "") !== concept.name)
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
  const loading = Promise.resolve({ parts: partsFrom(references), references });
  cache.set(key, loading);
  return loading;
};
