/**
 * The recurring-element consistency census.
 *
 * The article's most emphasised rule: "if a folder shows up in ten different
 * icons, it's the same folder". The parts vocabulary already answers whether a
 * shape recurs — its fingerprint is position-, scale- and rotation-invariant,
 * which is exactly what makes "the same folder, drawn smaller" cluster with its
 * siblings. What it cannot answer is whether the *drawing* agrees, because that
 * invariance deliberately discards the extent and position the question is
 * about.
 *
 * So the census recovers, for every icon that uses an element, the box that
 * element actually occupies, and hands those boxes to `cohort` — the module
 * that already models "a family that must agree on its box", including the
 * tolerance, the plurality gate and the notion of a split. Keying that machinery
 * on an element cluster instead of a name prefix keeps the two analyses
 * comparable, and means a split found here means the same thing as a split
 * found there.
 *
 * A split is not automatically a defect. `folder-open` sits where it does
 * because it shares its cohort box with the family it toggles against, and an
 * arrow that points four ways is four drawings on purpose. This module reports
 * and ranks; it does not convict.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { bbox, parsePath } from "../geometry/path.js";
import { extractParts } from "../parts/extract.js";
import { distance, fingerprint } from "../parts/shape.js";
import { buildCohorts, COHORT_TOLERANCE, splits } from "../tools/cohort.js";
import type { CohortAxis, Cohort } from "../tools/cohort.js";
import type { Box, Fingerprint, Part } from "../types.js";

/** Clustering distance below which two subpaths are the same element. The
 *  parts vocabulary's own default; kept identical so the census describes the
 *  same vocabulary the rest of the project uses. */
const THRESHOLD = 0.06;
/** An element in fewer icons than this is not yet a recurring element. */
const MIN_ICONS = 3;
/** Name tokens that describe a modifier rather than the object it modifies.
 *  Without this the folder cluster gets called "add". */
const MODIFIERS = new Set([
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "add",
  "alt",
  "check",
  "down",
  "edit",
  "left",
  "lock",
  "minus",
  "off",
  "on",
  "open",
  "plus",
  "remove",
  "right",
  "simple",
  "up",
  "x",
]);

export interface ElementInstance {
  box: Box;
  icon: string;
  /** Fingerprint distance from the cluster's canonical drawing. */
  distance: number;
}

export interface RecurringElement {
  /** True when the element is drawn at one size everywhere. This is the
   *  article's claim — "it's the same folder" — and the one a split of which is
   *  a defect under any reading. */
  consistentSize: boolean;
  /** True when it also sits in one place. Far weaker evidence: a rectangle in a
   *  layout icon and a bracket in a focus icon are *supposed* to move, so a
   *  position split is a question rather than a finding. */
  consistentPlace: boolean;
  id: string;
  instances: ElementInstance[];
  /** Node count of the canonical drawing. A folder outline has a dozen; a bare
   *  line has two. Because the fingerprint is scale-invariant — the property
   *  that makes "the same folder, drawn smaller" cluster correctly — every
   *  square in the set also lands in one cluster regardless of size, and its
   *  "size split" is a fact about the alphabet rather than a defect. Node count
   *  is how a distinctive object is told from a primitive. */
  nodes: number;
  /** Name derived from the icon names that contain it. */
  name: string;
  /** Share of the element's icons whose name contains that token. Below about
   *  a half the name is a guess and the element is effectively unnamed. */
  nameConfidence: number;
  /** Icons that disagree with the element's own convention — the instances
   *  outside the largest group on its worst axis. This is the blast radius: an
   *  element in 439 icons where 435 agree is a 4-icon problem, not a 439-icon
   *  one, and ranking by cluster size buries the families that genuinely
   *  disagree beneath the ones that merely recur a lot. */
  minority: string[];
  /** The top two groups tie, so neither side is obviously the fix. A decision
   *  rather than a correction. */
  even: boolean;
  /** Largest instance extent divided by smallest. */
  scaleSpread: number;
  /** Where the element sits, as a cohort of boxes. */
  placeCohort: Cohort;
  placeSplits: CohortAxis[];
  /** How large the element is, as a cohort of boxes moved to a common origin,
   *  so the axes read as width and height agreement rather than edge position. */
  sizeCohort: Cohort;
  sizeSplits: CohortAxis[];
}

export interface CensusOptions {
  minIcons?: number;
  threshold?: number;
  tolerance?: number;
}

export interface CensusReport {
  /** Elements drawn at one size everywhere. */
  consistentSize: number;
  /** Elements drawn at one size AND in one place. */
  uniform: number;
  elements: RecurringElement[];
  /** Elements recurring in at least `minIcons` icons. */
  recurring: number;
  /** Distinct names derived, for comparison against the article's "over 155". */
  named: number;
  /** Elements drawn at two or more sizes, worst blast radius first. The
   *  deliverable list. */
  sizeSplit: RecurringElement[];
  /** Elements at one size but several positions: the review tier. */
  placeSplit: RecurringElement[];
  icons: number;
}

/**
 * A name for an element, from the icons that contain it. The commonest
 * non-modifier token wins: a cluster living in `folder-add`, `folder-lock` and
 * `folder-open` is the folder, not the add.
 */
export const nameElement = (
  icons: string[]
): { confidence: number; name: string } => {
  const counts = new Map<string, number>();
  for (const icon of icons) {
    for (const token of new Set(icon.split("-"))) {
      if (!MODIFIERS.has(token)) {
        counts.set(token, (counts.get(token) ?? 0) + 1);
      }
    }
  }
  let best = "";
  let hits = 0;
  for (const [token, n] of counts) {
    // Ties go to the longer token: between "file" and "text" at equal counts
    // the longer one is more often the object and less often a qualifier.
    if (n > hits || (n === hits && token.length > best.length)) {
      best = token;
      hits = n;
    }
  }
  return {
    confidence: icons.length === 0 ? 0 : hits / icons.length,
    name: best,
  };
};

interface IconShape {
  box: Box;
  fp: Fingerprint;
}

const D_ATTR = /\sd="(?<d>[^"]+)"/gu;

/** Every subpath of one icon, fingerprinted and boxed. */
const shapesOf = (svg: string): IconShape[] => {
  const out: IconShape[] = [];
  for (const m of svg.matchAll(D_ATTR)) {
    for (const sp of parsePath(m.groups?.d ?? "")) {
      if (sp.segs.length > 0) {
        out.push({ box: bbox([sp]), fp: fingerprint(sp) });
      }
    }
  }
  return out;
};

/**
 * Where a part sits inside one icon. Searches only that icon's own subpaths,
 * because `Part.icons` has already established that it is in there — so this
 * recovers a position rather than re-deciding a match, and costs a handful of
 * comparisons instead of the whole vocabulary.
 *
 * An icon that uses the same element twice contributes only its closest
 * instance: a cohort takes one box per icon.
 */
const locate = (
  canonical: Fingerprint,
  shapes: IconShape[],
  threshold: number
): { box: Box; distance: number } | null => {
  let best: { box: Box; distance: number } | null = null;
  for (const s of shapes) {
    const d = distance(canonical, s.fp);
    if (d <= threshold && (best === null || d < best.distance)) {
      best = { box: s.box, distance: d };
    }
  }
  return best;
};

const extent = (b: Box) => Math.max(b.w, b.h);

/** Blast radius first: the count of icons that actually disagree. */
const byRadius = (a: RecurringElement, b: RecurringElement) =>
  b.minority.length - a.minority.length;

/** Icons outside the largest group, across every split axis. */
const minorityOf = (axes: CohortAxis[]): string[] => {
  const out = new Set<string>();
  for (const a of axes) {
    for (const g of a.groups.slice(1)) {
      for (const m of g.members) {
        out.add(m);
      }
    }
  }
  return [...out].toSorted();
};

const describe = (
  part: Part,
  instances: ElementInstance[],
  tolerance: number
): RecurringElement => {
  const icons = instances.map((i) => i.icon);
  const opts = { manifest: { [part.id]: icons }, tolerance };
  // One cohort per element: `buildCohorts` is keyed by a manifest, so naming
  // the element as the cohort makes the element's icons its members. Reusing it
  // rather than re-clustering keeps this comparable to the cohort audit, and
  // inherits its tolerance and its plurality gate.
  const [placeCohort] = buildCohorts(
    instances.map((i) => ({ box: i.box, name: i.icon })),
    opts
  );
  // The same machinery asked a different question: move every instance to a
  // common origin and the axes stop describing where an edge sits and start
  // describing how wide and how tall the element is. Without this separation a
  // rectangle that a layout icon legitimately moves between slots reads as the
  // same defect as a folder drawn at two sizes.
  const [sizeCohort] = buildCohorts(
    instances.map((i) => ({
      box: { h: i.box.h, w: i.box.w, x0: 0, x1: i.box.w, y0: 0, y1: i.box.h },
      name: i.icon,
    })),
    opts
  );
  const placeSplits = splits(placeCohort);
  const sizeSplits = splits(sizeCohort);
  const sizes = instances.map((i) => extent(i.box)).filter((n) => n > 0);
  const { confidence, name } = nameElement(icons);
  const worst = sizeSplits.length > 0 ? sizeSplits : placeSplits;
  return {
    consistentPlace: placeSplits.length === 0,
    consistentSize: sizeSplits.length === 0,
    even: worst.some((a) => a.even),
    id: part.id,
    instances,
    minority: minorityOf(worst),
    name,
    nameConfidence: confidence,
    nodes: part.nodes,
    placeCohort,
    placeSplits,
    scaleSpread:
      sizes.length === 0 ? 1 : Math.max(...sizes) / Math.min(...sizes),
    sizeCohort,
    sizeSplits,
  };
};

/**
 * Run the census over a directory of icons. Read-only.
 */
export const census = (
  dir: string,
  {
    minIcons = MIN_ICONS,
    threshold = THRESHOLD,
    tolerance = COHORT_TOLERANCE,
  }: CensusOptions = {}
): CensusReport => {
  const { parts } = extractParts(dir, { minUses: minIcons, threshold });
  const files = readdirSync(dir).filter((f) => f.endsWith(".svg"));
  const shapes = new Map<string, IconShape[]>();
  for (const file of files) {
    shapes.set(
      path.basename(file, ".svg"),
      shapesOf(readFileSync(path.join(dir, file), "utf-8"))
    );
  }

  const elements: RecurringElement[] = [];
  for (const part of parts) {
    const canonical = fingerprint(parsePath(part.d)[0]);
    const instances: ElementInstance[] = [];
    for (const icon of part.icons) {
      const hit = locate(canonical, shapes.get(icon) ?? [], threshold);
      if (hit) {
        instances.push({ box: hit.box, distance: hit.distance, icon });
      }
    }
    if (instances.length >= minIcons) {
      elements.push(describe(part, instances, tolerance));
    }
  }

  return {
    consistentSize: elements.filter((e) => e.consistentSize).length,
    elements,
    icons: files.length,
    named: new Set(elements.map((e) => e.name).filter(Boolean)).size,
    placeSplit: elements
      .filter((e) => e.consistentSize && !e.consistentPlace)
      .toSorted(byRadius),
    recurring: elements.length,
    sizeSplit: elements.filter((e) => !e.consistentSize).toSorted(byRadius),
    uniform: elements.filter((e) => e.consistentSize && e.consistentPlace)
      .length,
  };
};

/** Re-exported so a caller reporting a split can quote how far the minority
 *  sits from the convention without reaching past this module. */
export { drift } from "../tools/cohort.js";
export { MIN_ICONS, THRESHOLD };
