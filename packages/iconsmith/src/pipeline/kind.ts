/**
 * How a concept is drawn, and what a house file is to that drawing.
 *
 * Two products were named (keyed compile, unkeyed analog). Host marks are a
 * third: the model never runs, so 0 `part` ops is not a leak. Scoring a mark
 * against the nearest Central slug without classifying that slug is what made
 * plus-at-1.000 look like a leak and flag-1's swallowtail look like a miss.
 */
import type { MarkName } from "./marks.js";
import { MARKS } from "./marks.js";

/** The DRAW arm. Compile and analog already exist; mark is the host twin. */
export type DrawKind = "analog" | "compile" | "mark";

/**
 * What the house slug is, when one exists.
 *
 * - `same-construction` — reconstruction cosine (plus → plus-large).
 * - `same-concept` — cross-set cosine, target 0.737; do not demand the motif.
 * - `house-motif` — will not copy; cosine stays null.
 * - `none` — no counterpart, or the house file is a lint contradiction
 *   (minus-large is a hairline `substance` forbids).
 */
export type CounterpartClass =
  | "house-motif"
  | "none"
  | "same-concept"
  | "same-construction";

export interface MarkTwin {
  class: CounterpartClass;
  /** House slug in the matching finish variant. Null when we will not score. */
  slug: string | null;
}

/** Nearest house file per mark, classified from the 2026-08-21 twin audit. */
export const MARK_TWINS: Record<MarkName, MarkTwin> = {
  ban: { class: "same-concept", slug: "circle-ban-sign" },
  battery: { class: "same-concept", slug: "battery-empty" },
  equal: { class: "same-construction", slug: "math-equals" },
  flag: { class: "house-motif", slug: null },
  "hamburger-menu": { class: "same-construction", slug: "bars-three" },
  minus: { class: "none", slug: null },
  "more-vertical": { class: "same-concept", slug: "dot-grid-1x3-vertical" },
  plus: { class: "same-construction", slug: "plus-large" },
  timeline: { class: "none", slug: null },
  "view-grid": { class: "house-motif", slug: null },
};

/** Reconstruction cosine is only honest for this class. */
export const quotesReconstruction = (cls: CounterpartClass): boolean =>
  cls === "same-construction";

/** Stage a house sibling for a human look, including cross-set takes. */
export const stagesHouse = (
  twin: MarkTwin
): twin is MarkTwin & { slug: string } => twin.slug !== null;

export const isMarkName = (name: string): name is MarkName =>
  Object.hasOwn(MARKS, name);

/** `plus-filled` → `{ finish: "filled", mark: "plus" }`. */
export const markFromSlug = (
  slug: string
): { finish: "filled" | "outlined"; mark: MarkName } | null => {
  const filled = slug.endsWith("-filled");
  const stem = filled ? slug.slice(0, -"-filled".length) : slug;
  if (!isMarkName(stem)) {
    return null;
  }
  return { finish: filled ? "filled" : "outlined", mark: stem };
};
