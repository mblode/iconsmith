import { createHash } from "node:crypto";

import type { RoleAssignment } from "../src/corpus/concepts.js";
import { resolveSemanticFamily } from "./family-morphology.js";

export const CONSTRUCTION_CLASSES = [
  "organic",
  "container",
  "tool",
  "transport",
  "symbol",
  "dense",
  "narrow",
  "asymmetric",
] as const;
export type ConstructionClass = (typeof CONSTRUCTION_CLASSES)[number];

export interface ConstructionCatalogRecord {
  concepts?: readonly string[];
  set: string;
  slug: string;
  tags?: readonly string[];
}

const RULES: Readonly<Record<ConstructionClass, readonly string[]>> = {
  asymmetric: ["leaf", "rocket", "umbrella", "key", "flag", "feather"],
  container: [
    "archive",
    "bag",
    "basket",
    "bookmark",
    "box",
    "bubble",
    "case",
    "card",
    "drawer",
    "file",
    "folder",
    "inbox",
    "package",
    "shield",
    "trash",
    "window",
    "wallet",
  ],
  dense: [
    "atom",
    "bicycle",
    "circuit",
    "fingerprint",
    "grid",
    "network",
    "qr",
    "scissors",
  ],
  narrow: [
    "anchor",
    "chain",
    "key",
    "needle",
    "paperclip",
    "pin",
    "pipette",
    "thermometer",
    "umbrella",
    "wand",
  ],
  organic: [
    "animal",
    "apple",
    "bird",
    "cloud",
    "flower",
    "hand",
    "heart",
    "jellyfish",
    "leaf",
    "plant",
    "tree",
  ],
  symbol: [
    "arrow",
    "check",
    "chevron",
    "cross",
    "minus",
    "pause",
    "play",
    "plus",
    "sparkle",
    "star",
    "x",
  ],
  tool: [
    "axe",
    "anvil",
    "brush",
    "eyedropper",
    "hammer",
    "pen",
    "pencil",
    "pipette",
    "ruler",
    "scissors",
    "screwdriver",
    "shovel",
    "tube",
    "vial",
    "wrench",
  ],
  transport: [
    "airplane",
    "bicycle",
    "bike",
    "boat",
    "bus",
    "car",
    "rocket",
    "rideshare",
    "scooter",
    "ship",
    "skate",
    "taxi",
    "train",
    "tram",
    "truck",
  ],
};

const words = (values: readonly string[]) =>
  new Set(values.flatMap((value) => value.toLowerCase().split(/[^a-z0-9]+/u)));

/** Metadata routing only. A match does not assert that the drawing has the geometry. */
export const annotateConstructionClasses = (values: readonly string[]) => {
  const exposed = words(values);
  return CONSTRUCTION_CLASSES.flatMap((constructionClass) => {
    const matchedTokens = RULES[constructionClass].filter((token) =>
      exposed.has(token)
    );
    return matchedTokens.length ? [{ constructionClass, matchedTokens }] : [];
  });
};

const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");

export const createConstructionCoverage = (
  records: readonly ConstructionCatalogRecord[],
  catalogRoles: readonly RoleAssignment[]
) => {
  const slugs = new Set(records.map(({ slug }) => slug));
  const normalized = new Map<string, ConstructionCatalogRecord>();
  for (const record of records) {
    const base = record.slug.replace(/-filled$/u, "");
    const slug = base !== record.slug && slugs.has(base) ? base : record.slug;
    const prior = normalized.get(slug);
    normalized.set(slug, {
      concepts: [...(prior?.concepts ?? []), ...(record.concepts ?? [])],
      set: record.set,
      slug,
      tags: [...(prior?.tags ?? []), ...(record.tags ?? [])],
    });
  }
  const seen = new Set<string>();
  const families = [...normalized.values()]
    .filter(({ set }) => set === "blode-icons")
    .flatMap((record) => {
      const family = resolveSemanticFamily(record.slug, catalogRoles);
      if (
        family.source !== "catalog" ||
        family.role !== "canonical" ||
        seen.has(family.key)
      ) {
        return [];
      }
      seen.add(family.key);
      const exposure = [
        record.slug,
        ...(record.concepts ?? []),
        ...(record.tags ?? []),
      ].toSorted();
      const annotations = annotateConstructionClasses(exposure);
      return [
        {
          annotations,
          exposure,
          family: family.key,
          head: family.head,
          status: annotations.length ? "metadata-annotated" : "unclassified",
        } as const,
      ];
    })
    .toSorted((left, right) => left.family.localeCompare(right.family));
  const counts = Object.fromEntries(
    CONSTRUCTION_CLASSES.map((constructionClass) => [
      constructionClass,
      families.filter(({ annotations }) =>
        annotations.some((item) => item.constructionClass === constructionClass)
      ).length,
    ])
  ) as Record<ConstructionClass, number>;
  const body = {
    annotationAuthority: "catalog-token-routing-only" as const,
    classes: CONSTRUCTION_CLASSES,
    counts,
    families,
    familyCount: families.length,
    unclassifiedCount: families.filter(
      ({ status }) => status === "unclassified"
    ).length,
    warnings: [
      "Annotations derive from explicit catalog words; they are not visual geometry labels.",
      "familyCount is the catalog role resolver's canonical-row denominator; it is not an independent semantic-family count and can retain filled or modifier siblings.",
      "Unclassified families remain unclassified rather than inheriting a default class.",
      "Dense, narrow and asymmetric annotations identify review strata, not verified contour properties.",
    ],
  };
  return { hash: hash(JSON.stringify(body)), report: body };
};
