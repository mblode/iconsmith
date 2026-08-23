/* oxlint-disable prefer-named-capture-group -- the web tsconfig targets ES2017; positional groups keep this server parser compatible */
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { asReferences, bbox, parseIconSvg, parsePath, serialise } from "iconsmith";
import type { Concept, Part, Provenance, Reference } from "iconsmith";

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

const elementPattern =
  /React\.createElement\("(path|circle|ellipse|rect|line|polyline|polygon)", \{ ([^}]*) \}\)/gu;
const attributePattern = /([A-Za-z][A-Za-z0-9]*): (?:("(?:[^"\\]|\\.)*")|(-?\d+(?:\.\d+)?))/gu;

const xmlName = (name: string): string =>
  name.replaceAll(/([a-z0-9])([A-Z])/gu, "$1-$2").toLowerCase();

const xmlAttributes = (source: string): string => {
  attributePattern.lastIndex = 0;
  return [...source.matchAll(attributePattern)]
    .map((match) => {
      const [, name, quoted, number] = match;
      const value = quoted ? (JSON.parse(quoted) as string) : number;
      if (!(name && value !== undefined)) {
        return null;
      }
      return `${xmlName(name)}="${String(value)
        .replaceAll("&", "&amp;")
        .replaceAll('"', "&quot;")}"`;
    })
    .filter((attribute): attribute is string => attribute !== null)
    .join(" ");
};

/** Read the published house package as data. Its generated ESM components use
 * extensionless internal imports, so native Node cannot import them directly;
 * the element payload remains a stable, much smaller interface than executing
 * React components inside the generation worker. */
const svgFromModule = (source: string): string | null => {
  elementPattern.lastIndex = 0;
  const elements = [...source.matchAll(elementPattern)].map((match) => {
    const [, tag, rawAttributes] = match;
    const attributes = xmlAttributes(rawAttributes ?? "");
    return tag ? `<${tag}${attributes ? ` ${attributes}` : ""}/>` : "";
  });
  if (elements.length === 0) {
    return null;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" color="#000">${elements.join("")}</svg>`;
};

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

const packageDirectory = (): string => {
  let cursor = process.cwd();
  for (let depth = 0; depth < 6; depth += 1) {
    const candidate = path.join(cursor, "node_modules", "blode-icons-react", "dist");
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = path.dirname(cursor);
    if (parent === cursor) {
      break;
    }
    cursor = parent;
  }
  throw new Error("The installed blode-icons-react house library could not be found.");
};

const selectedSlugs = async (concept: Concept): Promise<string[]> => {
  const files = await readdir(packageDirectory());
  const slugs = new Set(
    files.filter((file) => file.endsWith(".js")).map((file) => file.slice(0, -3)),
  );
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

const loadReferences = async (concept: Concept): Promise<Reference[]> => {
  const directory = packageDirectory();
  const slugs = await selectedSlugs(concept);
  const icons = await Promise.all(
    slugs.map(async (slug) => {
      const svg = svgFromModule(await readFile(path.join(directory, `${slug}.js`), "utf-8"));
      return svg ? { name: slug, svg, tags: words(slug) } : null;
    }),
  );
  return asReferences(
    icons.filter((icon): icon is NonNullable<typeof icon> => icon !== null),
    HOUSE_PROVENANCE,
  );
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
  const loading = (async () => {
    const references = await loadReferences(concept);
    return { parts: partsFrom(references), references };
  })();
  cache.set(key, loading);
  return loading;
};
