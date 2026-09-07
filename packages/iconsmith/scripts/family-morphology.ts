import { unnumbered } from "../src/corpus/concepts.js";
import type { ConceptRole, RoleAssignment } from "../src/corpus/concepts.js";
/** Source-derived family morphology. Describes relationships, never reusable path data. */
import { parseIconSvg } from "../src/corpus/load.js";
import { bbox, parsePath } from "../src/geometry/path.js";
import type { FamilySource } from "./family-parts.js";

export const FAMILY_CLASSES = [
  "badge-container",
  "circular-mechanism",
  "directional",
  "organic",
  "status-object",
  "symbolic",
] as const;
export type FamilyClass = (typeof FAMILY_CLASSES)[number];

const tokens = (values: readonly string[]) =>
  new Set(values.flatMap((value) => value.toLowerCase().split(/[^a-z0-9]+/u)));

/** Classification uses catalog exposure (concept, aliases and donor names), not geometry guessing. */
export const classifyFamily = (
  concept: string,
  aliases: readonly string[] = [],
  sourceNames: readonly string[] = []
): FamilyClass => {
  const words = tokens([concept, ...aliases, ...sourceNames]);
  if (
    ["folder", "file", "shield", "card", "bookmark"].some((x) => words.has(x))
  ) {
    return "badge-container";
  }
  if (["bicycle", "bike", "clock", "gear", "wheel"].some((x) => words.has(x))) {
    return "circular-mechanism";
  }
  if (["arrow", "upload", "download", "send"].some((x) => words.has(x))) {
    return "directional";
  }
  if (
    ["bell", "camera", "key", "rocket", "umbrella"].some((x) => words.has(x))
  ) {
    return "status-object";
  }
  if (["hand", "leaf", "jellyfish"].some((x) => words.has(x))) {
    return "organic";
  }
  return "symbolic";
};

export interface SourceMorphology {
  paintedAspect: "landscape" | "portrait" | "square";
  closedContours: number;
  finish: FamilySource["finish"];
  name: string;
  openContours: number;
  paintedShapes: number;
  roundCaps: boolean;
  squareCaps: boolean;
}

export interface FamilyMorphology {
  familyClass: FamilyClass;
  family: FamilyResolution;
  guidance: Record<"16" | "24", string[]>;
  sources: SourceMorphology[];
  warnings: string[];
}

export interface FamilyResolution {
  head: string;
  key: string;
  role: ConceptRole | "unknown";
  source: "catalog" | "numbered" | "unknown";
}

/** Uses the catalog's canonical assignment when supplied; only numbered variants are safe to infer. */
export const resolveSemanticFamily = (
  concept: string,
  catalogRoles: readonly RoleAssignment[] = []
): FamilyResolution => {
  const assigned = catalogRoles.find(({ slug }) => slug === concept);
  if (assigned) {
    return {
      head: assigned.head,
      key: assigned.family,
      role: assigned.role,
      source: "catalog",
    };
  }
  const stem = unnumbered(concept);
  if (stem !== concept) {
    return { head: stem, key: `#${stem}`, role: "variant", source: "numbered" };
  }
  return { head: concept, key: concept, role: "unknown", source: "unknown" };
};

const describeSource = (source: FamilySource): SourceMorphology => {
  const shapes = parseIconSvg(source.svg);
  const paths = shapes.flatMap((shape) => parsePath(shape.d));
  const painted = shapes.map((shape) => {
    const box = bbox(parsePath(shape.d));
    const half = shape.strokeWidth / 2;
    return {
      x0: box.x0 - half,
      x1: box.x1 + half,
      y0: box.y0 - half,
      y1: box.y1 + half,
    };
  });
  const width = painted.length
    ? Math.max(...painted.map(({ x1 }) => x1)) -
      Math.min(...painted.map(({ x0 }) => x0))
    : 0;
  const height = painted.length
    ? Math.max(...painted.map(({ y1 }) => y1)) -
      Math.min(...painted.map(({ y0 }) => y0))
    : 0;
  const ratio = width / Math.max(height, Number.EPSILON);
  let paintedAspect: SourceMorphology["paintedAspect"] = "square";
  if (ratio > 1.1) {
    paintedAspect = "landscape";
  } else if (ratio < 0.9) {
    paintedAspect = "portrait";
  }
  return {
    closedContours: paths.filter((path) => path.closed).length,
    finish: source.finish,
    name: source.name,
    openContours: paths.filter((path) => !path.closed).length,
    paintedAspect,
    paintedShapes: shapes.length,
    roundCaps: /stroke-linecap=["']round["']/u.test(source.svg),
    squareCaps: /stroke-linecap=["']square["']/u.test(source.svg),
  };
};

export const describeFamilyMorphology = (input: {
  aliases?: readonly string[];
  catalogRoles?: readonly RoleAssignment[];
  concept: string;
  sources: readonly FamilySource[];
}): FamilyMorphology => {
  const sources = input.sources.map(describeSource);
  const familyClass = classifyFamily(
    input.concept,
    input.aliases,
    sources.map(({ name }) => name)
  );
  const family = resolveSemanticFamily(input.concept, input.catalogRoles);
  const shared = [
    "Preserve the admitted sources' silhouette, aspect, cap intent, contour topology and negative hierarchy; do not copy their paths.",
    "Keep modifier placement and repeated-element rhythm consistent across paints while allowing source-supported paint topology.",
  ];
  const classGuidance: Record<FamilyClass, string> = {
    "badge-container":
      "Keep the container silhouette primary; place the modifier within a stable corner zone and preserve its counter topology.",
    "circular-mechanism":
      "Keep repeated circles equal and aligned; preserve open counters and simplify crowded junctions before shrinking them.",
    directional:
      "Preserve direction, shaft-to-head proportion and terminal treatment at native size.",
    organic:
      "Preserve source curvature and asymmetric balance; avoid flattening admitted contours onto the construction grid.",
    "status-object":
      "Preserve the object's characteristic crown, shoulder and base profile; keep the status modifier subordinate but legible.",
    symbolic:
      "Preserve the dominant silhouette and counter topology measured in the admitted family.",
  };
  return {
    family,
    familyClass,
    guidance: {
      "16": [
        ...shared,
        classGuidance[familyClass],
        "At native 16px, open every intended counter to a stable device pixel and simplify secondary detail that crowds the silhouette.",
      ],
      "24": [
        ...shared,
        classGuidance[familyClass],
        "At native 24px, retain source-supported nuance without adding detail absent from the family.",
      ],
    },
    sources,
    warnings:
      family.source === "unknown"
        ? [
            "Semantic family is ungrouped; treat the construction class as routing guidance only.",
          ]
        : [],
  };
};
